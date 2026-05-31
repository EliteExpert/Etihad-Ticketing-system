import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder
} from 'discord.js';
import {
  boardingPassApiUrl,
  BUSINESS_ROLE_ID,
  ETIHAD_TAIL_EMOJI,
  FIRST_ROLE_ID,
  FLIGHT_COLOR,
  FLIGHT_MANAGER_ROLE_ID,
  FLIGHT_PING_ROLE_ID,
  GUEST_TIER_ORDER,
  GUEST_TIERS,
  MILES_EMOJI,
  SHOP_COOLDOWN_MS,
  SHOP_ITEMS,
  SUPPORT_COLORS,
  SUPPORT_PING_ROLE_ID,
  SUPPORT_REQUESTS_CHANNEL_ID
} from './config.js';
import { commands } from './commands/index.js';
import { ensureMilesUser, loadMilesStore, saveMilesStore } from './data/milesStore.js';
import { footerMedia, media, modal, text } from './utils/components.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in environment.');
}

const rest = new REST({ version: '10' }).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

const sessions = new Map();
const supportTicketsByUser = new Map();
const supportTicketsByThread = new Map();

const form1 = modal('form_1', 'Form 1', [
  { id: 'flight_number', label: 'Enter the flight number' },
  { id: 'departure_airport', label: 'Enter Departure airport' },
  { id: 'arrival_airport', label: 'Enter Arrival Airport' },
  { id: 'iata1', label: 'Enter departure airport IATA code' },
  { id: 'iata2', label: 'Enter arrival airport IATA code' }
]);
const form2 = modal('form_2', 'Form 2', [
  { id: 'date', label: 'Enter the date of the flight' },
  { id: 'timestamp1', label: 'Enter the server opening time in GMT' },
  { id: 'boarding_time', label: 'Enter the Boarding time in GMT' },
  { id: 'timestamp2', label: 'Enter the Departure time in GMT' },
  { id: 'closing_time', label: 'Enter Gate closing time in GMT' }
]);
const form3 = modal('form_3', 'Form 3', [
  { id: 'link', label: 'Discord event link' },
  { id: 'banner', label: 'Flight banner link' },
  { id: 'aircraft', label: 'Aircraft to be flown' }
]);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});
client.once(Events.ClientReady, c => console.log(`Logged in as ${c.user.tag}`));

function classConfig(customIdOrClass) {
  if (customIdOrClass === 'business_class' || customIdOrClass === 'business') {
    return {
      name: 'Business class',
      shortName: 'Business',
      roleId: BUSINESS_ROLE_ID,
      varKey: '{business.name}',
      classType: 'business',
      zone: '2',
      skywardsNumber: '87654321',
      additionalInfo: 'Priority boarding',
      milesRange: [250, 500]
    };
  }

  if (customIdOrClass === 'first_class' || customIdOrClass === 'first') {
    return {
      name: 'First class',
      shortName: 'First',
      roleId: FIRST_ROLE_ID,
      varKey: '{first.name}',
      classType: 'first',
      zone: '1',
      skywardsNumber: '271646124',
      additionalInfo: 'Chauffeur available',
      milesRange: [500, 1000]
    };
  }

  return {
    name: 'Economy class',
    shortName: 'Economy',
    roleId: null,
    varKey: '{economy.name}',
    classType: 'economy',
    zone: '3',
    skywardsNumber: '12345678',
    additionalInfo: 'Enjoy your flight!',
    milesRange: [100, 200]
  };
}

function emptyClassNames() {
  return {
    '{economy.name}': [],
    '{business.name}': [],
    '{first.name}': []
  };
}

function formatPassengerList(classNames) {
  const labels = {
    '{economy.name}': 'Economy',
    '{business.name}': 'Business',
    '{first.name}': 'First'
  };
  const booked = Object.entries(classNames)
    .filter(([, names]) => names.length > 0)
    .map(([key, names]) => `- ${labels[key]}: ${names.join(' ')}`);
  return booked.length ? booked.join('\n') : 'No passengers booked yet.';
}

function addBookingMention(classNames, cls, userId) {
  const mention = `<@${userId}>`;
  for (const key of Object.keys(classNames)) {
    classNames[key] = classNames[key].filter(name => name !== mention);
  }
  classNames[cls.varKey].push(mention);
}

function removeBookingMention(classNames, userId) {
  const mention = `<@${userId}>`;
  for (const key of Object.keys(classNames)) {
    classNames[key] = classNames[key].filter(name => name !== mention);
  }
}

function userIdFromMention(mention) {
  return mention.match(/^<@!?(\d+)>$/)?.[1] ?? null;
}

function memberHasRole(member, roleId) {
  if (member?.roles?.cache?.has?.(roleId)) return true;
  if (Array.isArray(member?.roles)) return member.roles.includes(roleId);
  return false;
}

function hasFlightManagementAccess(interaction) {
  return memberHasRole(interaction.member, FLIGHT_MANAGER_ROLE_ID);
}

function hasAdminAccess(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function normalizeShopKey(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveShopItem(value) {
  if (!value) return [null, null];
  if (SHOP_ITEMS[value]) return [value, SHOP_ITEMS[value]];

  const normalized = normalizeShopKey(value);
  if (SHOP_ITEMS[normalized]) return [normalized, SHOP_ITEMS[normalized]];

  return Object.entries(SHOP_ITEMS).find(([, item]) => normalizeShopKey(item.label) === normalized) ?? [null, null];
}

function formatRelativeTime(timestamp) {
  return `<t:${Math.floor(timestamp / 1000)}:R>`;
}

function activeShopCooldown(milesUser, itemKey) {
  const expiresAt = milesUser.shopCooldowns?.[itemKey] ?? 0;
  return expiresAt > Date.now() ? expiresAt : null;
}

function currentGuestTierKey(milesUser) {
  return milesUser.guest?.tier ?? null;
}

function tierRank(tierKey) {
  return GUEST_TIER_ORDER.indexOf(tierKey);
}

function formatTierBenefits(tier) {
  return tier.benefits.map(benefit => `- ${benefit}`).join('\n');
}

function formatGuestSummary(user, milesUser) {
  const tierKey = currentGuestTierKey(milesUser);
  const tier = tierKey ? GUEST_TIERS[tierKey] : null;
  const cooldowns = Object.entries(milesUser.shopCooldowns ?? {})
    .filter(([, expiresAt]) => expiresAt > Date.now())
    .map(([key, expiresAt]) => `- ${SHOP_ITEMS[key]?.label ?? key}: ${formatRelativeTime(expiresAt)}`)
    .join('\n');

  return (
    `Passenger: ${user}\n` +
    `Tier: **${tier?.label ?? 'No account'}**${tier ? ` <@&${tier.roleId}>` : ''}\n` +
    `Balance: ${MILES_EMOJI} **${milesUser.balance} miles**\n` +
    `Flights attended: **${milesUser.flights.length}**\n` +
    `Purchases: **${milesUser.purchases.length}**\n` +
    `Active cooldowns:\n${cooldowns || 'None'}`
  );
}

async function syncGuestTierRole(interaction, tierKey, userId = interaction.user.id) {
  const guild = interaction.guild;
  if (!guild) return { ok: false, reason: 'This can only be used inside the server.' };

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.roles?.cache) return { ok: false, reason: 'I could not fetch your server member profile.' };

  const tierRoleIds = Object.values(GUEST_TIERS).map(tier => tier.roleId);
  const targetRoleId = GUEST_TIERS[tierKey].roleId;
  const targetRole = await guild.roles.fetch(targetRoleId).catch(() => null);
  if (!targetRole) return { ok: false, reason: `The role <@&${targetRoleId}> could not be found.` };

  await member.roles.remove(tierRoleIds.filter(roleId => roleId !== targetRoleId)).catch(() => null);

  try {
    await member.roles.add(targetRoleId, `Etihad Guest ${GUEST_TIERS[tierKey].label} tier`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `I could not assign <@&${targetRoleId}>. Please check my Manage Roles permission and role position.`
    };
  }
}

async function removeGuestTierRoles(interaction, userId) {
  const guild = interaction.guild;
  if (!guild) return { ok: false, reason: 'This can only be used inside the server.' };

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.roles?.cache) return { ok: false, reason: 'I could not fetch that server member profile.' };

  try {
    await member.roles.remove(Object.values(GUEST_TIERS).map(tier => tier.roleId), 'Etihad Guest account revoked');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'I could not remove all tier roles. Please check my Manage Roles permission and role position.'
    };
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function flightRecord(session, cls, miles) {
  const data = session.flightData;
  return {
    flight: data['flight-details.flight-number'],
    departureAirport: data['flight-details.departure-airport'],
    arrivalAirport: data['flight-details.arrival-airport'],
    classType: cls.classType,
    className: cls.shortName,
    miles,
    date: data['flight-details2.date'],
    completedAt: new Date().toISOString()
  };
}

function formatMilesAwards(awards) {
  if (!awards.length) return 'No passengers were booked, so no miles were distributed.';
  return awards.map(award => `- **${award.displayName}**: ${MILES_EMOJI} ${award.miles} miles (${award.className})`).join('\n');
}

function messageTextWithAttachments(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  for (const attachment of message.attachments.values()) {
    parts.push(attachment.url);
  }
  return parts.join('\n') || '(No text content)';
}

function displayTime() {
  return `<t:${Math.floor(Date.now() / 1000)}:f>`;
}

function supportStatusText(ticket) {
  if (ticket.status === 'closed') return `Closed${ticket.closedBy ? ` by <@${ticket.closedBy}>` : ''}`;
  if (ticket.claimedBy) return `Claimed by <@${ticket.claimedBy}> - in progress`;
  return 'Waiting for staff';
}

function supportColor(ticket) {
  if (ticket.status === 'closed') return SUPPORT_COLORS.closed;
  if (ticket.claimedBy) return SUPPORT_COLORS.inProgress;
  return SUPPORT_COLORS.unclaimed;
}

function buildSupportActions(userId, ticket) {
  if (ticket.status === 'closed') return [];

  const row = new ActionRowBuilder();
  if (!ticket.claimedBy) {
    row.addComponents(new ButtonBuilder().setCustomId(`support_claim:${userId}`).setLabel('Claim').setStyle(ButtonStyle.Success));
  }
  row.addComponents(new ButtonBuilder().setCustomId(`support_close:${userId}`).setLabel('Close').setStyle(ButtonStyle.Danger));
  return [row];
}

function buildSupportRequestContainer(user, content, ticket) {
  return new ContainerBuilder()
    .setAccentColor(supportColor(ticket))
    .addTextDisplayComponents(
      text(
        `**Etihad Support Request**\n` +
          `Passenger: <@${user.id}>\n` +
          `Status: ${supportStatusText(ticket)}\n` +
          `Ping: <@&${SUPPORT_PING_ROLE_ID}>\n\n` +
          `**Message**\n${content}\n\n` +
          `${displayTime()}`
      )
    );
}

function buildSupportConnectingContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.inProgress)
    .addTextDisplayComponents(
      text(
        '<:EtihadTail:1500012291188461660> **Etihad Airways** <:Dot:1510674589020328148> __We have received your message and are connecting you with a customer service agent.__\n\n' +
          'Hello and welcome to **<:support:1500907655466844231> Etihad Customer Service Centre**.\n\n' +
          'Thank you for contacting us. A member of our support team will be with you shortly to assist you as quickly and efficiently as possible.\n\n' +
          '<:support:1500907655466844231> **Etihad Airways Customer Service**\n' +
          '-# **BEYOND BORDERS**'
      )
    );
}

function buildSupportConnectedContainer(agent) {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.inProgress)
    .addTextDisplayComponents(text(`Connected. ${agent} has been selected for your inquiry. Please be patient while they review your request.`));
}

function buildSupportClosedContainer() {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.closed)
    .addTextDisplayComponents(text('Your Etihad support request has been closed. Thank you for contacting us.'));
}

function buildRelayContainer(authorName, content) {
  return new ContainerBuilder()
    .setAccentColor(SUPPORT_COLORS.relay)
    .addTextDisplayComponents(text(`**${authorName}**\n${content}\n\n${displayTime()}`));
}

async function updateSupportRequestMessage(ticket, content) {
  const supportChannel = await client.channels.fetch(SUPPORT_REQUESTS_CHANNEL_ID);
  if (!supportChannel?.isTextBased()) throw new Error('Support requests channel is not a text channel.');
  const requestMessage = await supportChannel.messages.fetch(ticket.requestMessageId);
  const user = await client.users.fetch(ticket.userId);
  await requestMessage.edit({
    components: [buildSupportRequestContainer(user, content, ticket), ...buildSupportActions(ticket.userId, ticket)],
    flags: MessageFlags.IsComponentsV2
  });
}

async function createSupportRequest(message, content) {
  const supportChannel = await client.channels.fetch(SUPPORT_REQUESTS_CHANNEL_ID);
  if (!supportChannel?.isTextBased()) throw new Error('Support requests channel is not a text channel.');

  const ticket = {
    userId: message.author.id,
    userTag: message.author.tag,
    requestMessageId: null,
    threadId: null,
    claimedBy: null,
    closedBy: null,
    status: 'pending'
  };

  const requestMessage = await supportChannel.send({
    components: [buildSupportRequestContainer(message.author, content, ticket), ...buildSupportActions(message.author.id, ticket)],
    flags: MessageFlags.IsComponentsV2
  });

  ticket.requestMessageId = requestMessage.id;
  supportTicketsByUser.set(message.author.id, ticket);
  await message.reply({ components: [buildSupportConnectingContainer()], flags: MessageFlags.IsComponentsV2 });
}

async function forwardUserMessageToSupport(message, ticket, content) {
  if (ticket.status === 'closed') {
    supportTicketsByUser.delete(message.author.id);
    await createSupportRequest(message, content);
    return;
  }

  if (ticket.threadId) {
    const thread = await client.channels.fetch(ticket.threadId);
    if (!thread?.isTextBased()) throw new Error('Saved support thread is not a text channel.');
    await thread.send({ components: [buildRelayContainer(message.author.tag, content)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const supportChannel = await client.channels.fetch(SUPPORT_REQUESTS_CHANNEL_ID);
  if (!supportChannel?.isTextBased()) throw new Error('Support requests channel is not a text channel.');
  await supportChannel.send({ components: [buildRelayContainer(`${message.author.tag} added a message`, content)], flags: MessageFlags.IsComponentsV2 });
  await message.reply('Your message has been added to your support request. Please wait while we connect you to an agent.');
}

function buildFlightContainer(data, classNames, finished = false) {
  const container = new ContainerBuilder().setAccentColor(FLIGHT_COLOR);
  const bannerUrl = data['flight-details-3.banner'];
  const statusText = finished ? '\n\n**Flight finished**' : '';

  if (/^https?:\/\//i.test(bannerUrl)) {
    container.addMediaGalleryComponents(media(bannerUrl));
  }

  return container
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      text(
        `> An Etihad flight has been dispatched from **${data['flight-details.departure-airport']}** to **${data['flight-details.arrival-airport']}**.\n` +
          `\n` +
          `<@&${FLIGHT_PING_ROLE_ID}>\n` +
          `\n` +
          `<:aircraft:1500907338218082384> **Flight**: ${data['flight-details.flight-number']}\n` +
          `<:eycalendar:1500907411618271253> **Date**: ${data['flight-details2.date']}\n` +
          `<:eyclock:1500907384510480454> **Check-in opens (GMT)**: ${data['flight-details2.timestamp1']}\n` +
          `<:eyclock:1500907384510480454> **Boarding (GMT)**: ${data['flight-details2.boarding-time']}\n` +
          `<:eyclock:1500907384510480454> **Departure (GMT)**: ${data['flight-details2.timestamp2']}\n` +
          `<:eyclock:1500907384510480454> **Gate closes (GMT)**: ${data['flight-details2.closing-time']}\n` +
          `<:EtihadTail:1500012291188461660> **Aircraft**: ${data['flight-details-3.aircraft']}\n` +
          `\n` +
          `<:user:1500907475644186874> **Passengers booked**\n${formatPassengerList(classNames)}${statusText}`
      )
    )
    .addActionRowComponents(row =>
      row.addComponents(
        new ButtonBuilder().setCustomId('eco_class').setLabel('Economy class').setStyle(ButtonStyle.Success).setDisabled(finished),
        new ButtonBuilder().setCustomId('business_class').setLabel('Business class').setStyle(ButtonStyle.Primary).setDisabled(finished),
        new ButtonBuilder().setCustomId('first_class').setLabel('First class').setStyle(ButtonStyle.Danger).setDisabled(finished),
        new ButtonBuilder().setCustomId('opt_out').setLabel('Opt out').setStyle(ButtonStyle.Secondary).setDisabled(finished),
        new ButtonBuilder()
          .setCustomId('finish_flight')
          .setLabel(finished ? 'Flight finished' : 'Finish flight')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(finished)
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addMediaGalleryComponents(footerMedia());
}

async function editFlightMessage(session, sourceMessage = null) {
  const components = [buildFlightContainer(session.flightData, session.classNames, session.finished)];
  if (sourceMessage?.id === session.messageId) {
    await sourceMessage.edit({ components });
    return;
  }

  const channel = await client.channels.fetch(session.channelId);
  if (!channel?.isTextBased()) throw new Error('Saved channel is not a text channel.');
  const message = await channel.messages.fetch(session.messageId);
  await message.edit({ components });
}

function buildBoardingPassPayload(session, cls, passengerName) {
  const data = session.flightData;
  return {
    class: cls.classType,
    passenger_name: passengerName,
    flight: data['flight-details.flight-number'],
    departure_date: data['flight-details2.date'],
    departure_time: data['flight-details2.closing-time'],
    zone: cls.zone,
    boarding_at: data['flight-details2.boarding-time'],
    gate_closes_at: data['flight-details2.closing-time'],
    departing_from: data['flight-details.iata1'],
    arriving_at: data['flight-details.iata2'],
    skywards_number: cls.skywardsNumber,
    additional_info: cls.additionalInfo
  };
}

async function generateBoardingPass(payload) {
  const response = await fetch(boardingPassApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const message = result?.error ?? `Boarding pass API returned ${response.status}`;
    throw new Error(message);
  }

  return result.image_url ?? result.output ?? result.download_url;
}

async function finishFlight(session) {
  if (session.finished) return session.milesAwards ?? [];

  const store = await loadMilesStore();
  const awards = [];

  for (const [varKey, mentions] of Object.entries(session.classNames)) {
    const cls = classConfig(varKey === '{business.name}' ? 'business' : varKey === '{first.name}' ? 'first' : 'economy');
    for (const mention of mentions) {
      const userId = userIdFromMention(mention);
      if (!userId) continue;

      const miles = randomInt(cls.milesRange[0], cls.milesRange[1]);
      const user = ensureMilesUser(store, userId);
      const displayName = session.bookings[userId]?.passengerName ?? `User ${userId}`;
      user.balance += miles;
      user.flights.push(flightRecord(session, cls, miles));
      awards.push({ userId, displayName, miles, className: cls.shortName });
    }
  }

  await saveMilesStore(store);
  session.finished = true;
  session.milesAwards = awards;
  return awards;
}

function buildHistoryContainer(user, milesUser) {
  const flights = milesUser.flights.slice(-10).reverse();
  const history = flights.length
    ? flights
        .map(flight => `- **${flight.flight}**: ${flight.departureAirport} to ${flight.arrivalAirport} | ${flight.className} | ${MILES_EMOJI} +${flight.miles} miles`)
        .join('\n')
    : 'No attended flights yet.';

  return new ContainerBuilder()
    .setAccentColor(FLIGHT_COLOR)
    .addTextDisplayComponents(
      text(`${ETIHAD_TAIL_EMOJI} **${user.username}'s Flight History**\n` + `Total balance: ${MILES_EMOJI} **${milesUser.balance} miles**\n\n` + `${history}`)
    );
}

function buildGuestContainer(user, milesUser, notice = null) {
  const tierKey = currentGuestTierKey(milesUser);
  const currentTier = tierKey ? GUEST_TIERS[tierKey] : null;
  const tierLines = GUEST_TIER_ORDER.map(key => {
    const tier = GUEST_TIERS[key];
    const marker = key === tierKey ? 'Current' : `${MILES_EMOJI} ${tier.price} miles`;
    return `- **${tier.label}** <@&${tier.roleId}>: ${marker}\n${formatTierBenefits(tier)}`;
  }).join('\n\n');

  return new ContainerBuilder()
    .setAccentColor(FLIGHT_COLOR)
    .addTextDisplayComponents(
      text(
        `${ETIHAD_TAIL_EMOJI} **Etihad Guest**\n` +
          `Passenger: ${user}\n` +
          `Tier: **${currentTier?.label ?? 'No account yet'}**${currentTier ? ` <@&${currentTier.roleId}>` : ''}\n` +
          `Balance: ${MILES_EMOJI} **${milesUser.balance} miles**\n\n` +
          `${notice ? `${notice}\n\n` : ''}` +
          `**Tiers and benefits**\n${tierLines}`
      )
    );
}

function buildProfileEmbed(user, milesUser) {
  const tierKey = currentGuestTierKey(milesUser);
  const tier = tierKey ? GUEST_TIERS[tierKey] : null;
  const benefits = tier ? formatTierBenefits(tier) : 'Create a free Bronze account with `/etihad_guest create`.';

  return new EmbedBuilder()
    .setColor(FLIGHT_COLOR)
    .setTitle(`${ETIHAD_TAIL_EMOJI} ${user.username}'s Etihad Guest Profile`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(
      `Current tier: **${tier?.label ?? 'No account yet'}**${tier ? ` <@&${tier.roleId}>` : ''}\n` +
        `Balance: ${MILES_EMOJI} **${milesUser.balance} miles**`
    )
    .addFields({ name: `${tier?.label ?? 'Guest'} benefits`, value: benefits });
}

function buildProfileActions(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`profile_flights:${userId}`).setLabel('View flights attended').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`profile_tiers:${userId}`).setLabel('View all tiers/upgrade').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`profile_shop:${userId}`).setLabel('Miles shop').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildTierUpgradeComponents(user, milesUser, notice = null) {
  const currentTierKey = currentGuestTierKey(milesUser);
  const upgradeOptions = currentTierKey ? GUEST_TIER_ORDER.filter(key => key !== 'bronze' && tierRank(key) > tierRank(currentTierKey)).map(key => ({
    label: GUEST_TIERS[key].label,
    value: key,
    description: `${GUEST_TIERS[key].price} miles`
  })) : [];
  const components = [buildGuestContainer(user, milesUser, notice)];

  if (upgradeOptions.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`guest_upgrade_select:${user.id}`)
          .setPlaceholder('Select a tier to upgrade')
          .addOptions(upgradeOptions)
      )
    );
  }

  return components;
}

function buildShopContainer(user, milesUser, purchaseText = null) {
  const shopList = Object.entries(SHOP_ITEMS)
    .map(([key, item]) => {
      const cooldown = activeShopCooldown(milesUser, key);
      const cooldownText = cooldown ? `\n  Cooldown: available ${formatRelativeTime(cooldown)}` : '';
      return `- **${item.label}**: ${MILES_EMOJI} ${item.price} miles\n  ${item.description}${cooldownText}`;
    })
    .join('\n');
  const purchased = milesUser.purchases.length
    ? `\n\nRecent purchases:\n${milesUser.purchases.slice(-3).reverse().map(item => `- ${item.label} (${MILES_EMOJI} ${item.price} miles)`).join('\n')}`
    : '';

  return new ContainerBuilder()
    .setAccentColor(FLIGHT_COLOR)
    .addTextDisplayComponents(
      text(
        `**Etihad Miles Shop**\n` +
          `Passenger: ${user}\n` +
          `Balance: ${MILES_EMOJI} **${milesUser.balance} miles**\n\n` +
          `${purchaseText ? `${purchaseText}\n\n` : ''}` +
          `${shopList}${purchased}`
      )
    );
}

client.on(Events.MessageCreate, async message => {
  try {
    if (message.author.bot) return;

    if (!message.guild) {
      const content = messageTextWithAttachments(message);
      const ticket = supportTicketsByUser.get(message.author.id);
      if (!ticket) {
        await createSupportRequest(message, content);
        return;
      }
      await forwardUserMessageToSupport(message, ticket, content);
      return;
    }

    const userId = supportTicketsByThread.get(message.channel.id);
    if (!userId) return;

    const ticket = supportTicketsByUser.get(userId);
    if (!ticket || ticket.status === 'closed') return;

    const user = await client.users.fetch(userId);
    await user.send({
      components: [buildRelayContainer(message.member?.displayName ?? message.author.username, messageTextWithAttachments(message))],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    console.error(error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('support_close_confirm:')) {
      const userId = interaction.customId.split(':')[1];
      const ticket = supportTicketsByUser.get(userId);
      if (!ticket) {
        await interaction.update({ content: 'This support request could not be found.', components: [] });
        return;
      }

      ticket.status = 'closed';
      ticket.closedBy = interaction.user.id;
      supportTicketsByUser.delete(userId);
      if (ticket.threadId) supportTicketsByThread.delete(ticket.threadId);

      await updateSupportRequestMessage(ticket, 'Support request closed.');
      const user = await client.users.fetch(userId);
      await user.send({ components: [buildSupportClosedContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => null);

      if (ticket.threadId) {
        const thread = await client.channels.fetch(ticket.threadId).catch(() => null);
        if (thread?.isTextBased()) {
          await thread.send({ components: [buildRelayContainer('Etihad Support', `Closed by <@${interaction.user.id}>.`)], flags: MessageFlags.IsComponentsV2 });
          await thread.setArchived(true).catch(() => null);
        }
      }

      await interaction.update({ content: 'Support request closed.', components: [] });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('support_close_cancel:')) {
      await interaction.update({ content: 'Close cancelled.', components: [] });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('support_close:')) {
      const userId = interaction.customId.split(':')[1];
      await interaction.reply({
        content: 'Close this support request?',
        flags: MessageFlags.Ephemeral,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`support_close_confirm:${userId}`).setLabel('Confirm close').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`support_close_cancel:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
          )
        ]
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('support_claim:')) {
      const userId = interaction.customId.split(':')[1];
      const ticket = supportTicketsByUser.get(userId);
      if (!ticket) {
        await interaction.reply({ content: 'This support request could not be found.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (ticket.threadId) {
        await interaction.reply({ content: `This support request is already claimed in <#${ticket.threadId}>.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const thread = await interaction.message.startThread({
        name: `support-${ticket.userTag}`.replace(/[^a-z0-9-_]/gi, '-').slice(0, 90),
        autoArchiveDuration: 1440
      });

      ticket.threadId = thread.id;
      ticket.claimedBy = interaction.user.id;
      ticket.status = 'claimed';
      supportTicketsByThread.set(thread.id, userId);

      const user = await client.users.fetch(userId);
      await interaction.update({
        components: [buildSupportRequestContainer(user, 'Support request claimed. Continue in the created thread.', ticket), ...buildSupportActions(userId, ticket)],
        flags: MessageFlags.IsComponentsV2
      });
      await thread.send({ components: [buildRelayContainer('Etihad Support', `Claimed by <@${interaction.user.id}>. Messages sent here will be relayed to ${user}.`)], flags: MessageFlags.IsComponentsV2 });
      await user.send({ components: [buildSupportConnectedContainer(interaction.user)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('profile_')) {
      const [action, profileUserId] = interaction.customId.split(':');
      if (profileUserId !== interaction.user.id) {
        await interaction.reply({ content: 'Only the profile owner can use these buttons.', flags: MessageFlags.Ephemeral });
        return;
      }

      const store = await loadMilesStore();
      const milesUser = ensureMilesUser(store, interaction.user.id);

      if (action === 'profile_flights') {
        await interaction.reply({ components: [buildHistoryContainer(interaction.user, milesUser)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        return;
      }

      if (action === 'profile_tiers') {
        await interaction.reply({ components: buildTierUpgradeComponents(interaction.user, milesUser), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        return;
      }

      if (action === 'profile_shop') {
        await interaction.reply({ components: [buildShopContainer(interaction.user, milesUser)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        return;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('guest_upgrade_select:')) {
      const profileUserId = interaction.customId.split(':')[1];
      if (profileUserId !== interaction.user.id) {
        await interaction.reply({ content: 'Only the profile owner can use this menu.', flags: MessageFlags.Ephemeral });
        return;
      }

      const targetTierKey = interaction.values[0];
      const targetTier = GUEST_TIERS[targetTierKey];
      const store = await loadMilesStore();
      const milesUser = ensureMilesUser(store, interaction.user.id);
      const currentTierKey = currentGuestTierKey(milesUser);
      let notice;

      if (!currentTierKey) {
        notice = 'Create a free Bronze Etihad Guest account before upgrading.';
      } else if (tierRank(targetTierKey) <= tierRank(currentTierKey)) {
        notice = `You are already ${GUEST_TIERS[currentTierKey].label} or higher.`;
      } else if (milesUser.balance < targetTier.price) {
        notice = `You need ${MILES_EMOJI} ${targetTier.price - milesUser.balance} more miles to upgrade to **${targetTier.label}**.`;
      } else {
        const roleSync = await syncGuestTierRole(interaction, targetTierKey);
        if (!roleSync.ok) {
          notice = roleSync.reason;
        } else {
          milesUser.balance -= targetTier.price;
          milesUser.guest = { ...milesUser.guest, tier: targetTierKey, upgradedAt: new Date().toISOString() };
          await saveMilesStore(store);
          notice = `Upgraded to **${targetTier.label}** for ${MILES_EMOJI} ${targetTier.price} miles.`;
        }
      }

      await interaction.update({ components: buildTierUpgradeComponents(interaction.user, milesUser, notice), flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'admin') {
      if (!hasAdminAccess(interaction)) {
        await interaction.reply({ content: 'Administrator permission is required for this command.', flags: MessageFlags.Ephemeral });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      const targetUser = interaction.options.getUser('user', true);
      const store = await loadMilesStore();
      const milesUser = ensureMilesUser(store, targetUser.id);
      let response = null;

      if (subcommand === 'user_info') {
        response = formatGuestSummary(targetUser, milesUser);
      }

      if (subcommand === 'add_miles' || subcommand === 'remove_miles') {
        const amount = interaction.options.getInteger('amount', true);
        const reason = interaction.options.getString('reason') ?? 'No reason provided';
        const delta = subcommand === 'add_miles' ? amount : -amount;
        milesUser.balance = Math.max(0, milesUser.balance + delta);
        milesUser.adjustments ??= [];
        milesUser.adjustments.push({
          adminId: interaction.user.id,
          amount: delta,
          reason,
          createdAt: new Date().toISOString()
        });
        await saveMilesStore(store);
        response = `${targetUser} now has ${MILES_EMOJI} **${milesUser.balance} miles**.\nAdjustment: **${delta > 0 ? '+' : ''}${delta}**\nReason: ${reason}`;
      }

      if (subcommand === 'set_tier') {
        const tierKey = interaction.options.getString('tier', true);
        const roleSync = await syncGuestTierRole(interaction, tierKey, targetUser.id);
        if (!roleSync.ok) {
          response = roleSync.reason;
        } else {
          milesUser.guest ??= { createdAt: new Date().toISOString() };
          milesUser.guest = { ...milesUser.guest, tier: tierKey, upgradedAt: new Date().toISOString() };
          await saveMilesStore(store);
          response = `${targetUser} has been set to **${GUEST_TIERS[tierKey].label}** <@&${GUEST_TIERS[tierKey].roleId}>.`;
        }
      }

      if (subcommand === 'sync_tier_role') {
        const tierKey = currentGuestTierKey(milesUser);
        if (!tierKey) {
          response = `${targetUser} does not have an Etihad Guest account yet.`;
        } else {
          const roleSync = await syncGuestTierRole(interaction, tierKey, targetUser.id);
          response = roleSync.ok ? `Synced ${targetUser}'s **${GUEST_TIERS[tierKey].label}** role.` : roleSync.reason;
        }
      }

      if (subcommand === 'reset_shop_cooldown') {
        const itemKey = interaction.options.getString('item');
        if (itemKey) {
          delete milesUser.shopCooldowns[itemKey];
          response = `Reset ${SHOP_ITEMS[itemKey].label} cooldown for ${targetUser}.`;
        } else {
          milesUser.shopCooldowns = {};
          response = `Reset all shop cooldowns for ${targetUser}.`;
        }
        await saveMilesStore(store);
      }

      if (subcommand === 'close_support') {
        const ticket = supportTicketsByUser.get(targetUser.id);
        if (!ticket || ticket.status === 'closed') {
          response = `${targetUser} does not have an open support ticket.`;
        } else {
          ticket.status = 'closed';
          ticket.closedBy = interaction.user.id;
          supportTicketsByUser.delete(targetUser.id);
          if (ticket.threadId) supportTicketsByThread.delete(ticket.threadId);
          await updateSupportRequestMessage(ticket, 'Support request force closed by an administrator.').catch(() => null);
          const user = await client.users.fetch(targetUser.id).catch(() => null);
          await user?.send({ components: [buildSupportClosedContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
          response = `Closed the open support ticket for ${targetUser}.`;
        }
      }

      await interaction.reply({
        components: [new ContainerBuilder().setAccentColor(FLIGHT_COLOR).addTextDisplayComponents(text(`**Admin**\n${response}`))],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'security') {
      if (!hasAdminAccess(interaction)) {
        await interaction.reply({ content: 'Administrator permission is required for this command.', flags: MessageFlags.Ephemeral });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      const targetUser = interaction.options.getUser('user', true);
      const store = await loadMilesStore();
      const milesUser = ensureMilesUser(store, targetUser.id);
      let response = null;

      if (subcommand === 'audit') {
        const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
        const tierRoles = Object.values(GUEST_TIERS)
          .filter(tier => member?.roles?.cache?.has(tier.roleId))
          .map(tier => `${tier.label} <@&${tier.roleId}>`)
          .join('\n');
        const ticket = supportTicketsByUser.get(targetUser.id);

        response =
          `${formatGuestSummary(targetUser, milesUser)}\n\n` +
          `Tier roles on member:\n${tierRoles || 'None'}\n\n` +
          `Support ticket: **${ticket ? supportStatusText(ticket) : 'None'}**`;
      }

      if (subcommand === 'revoke_guest') {
        const roleRemoval = await removeGuestTierRoles(interaction, targetUser.id);
        milesUser.guest = null;
        milesUser.shopCooldowns = {};
        await saveMilesStore(store);
        response = roleRemoval.ok
          ? `Revoked ${targetUser}'s Etihad Guest account and removed tier roles.`
          : `Revoked ${targetUser}'s stored Etihad Guest account.\n${roleRemoval.reason}`;
      }

      await interaction.reply({
        components: [new ContainerBuilder().setAccentColor(FLIGHT_COLOR).addTextDisplayComponents(text(`**Security**\n${response}`))],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'flight_history') {
      const store = await loadMilesStore();
      const milesUser = ensureMilesUser(store, interaction.user.id);
      await interaction.reply({ components: [buildHistoryContainer(interaction.user, milesUser)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'profile') {
      const store = await loadMilesStore();
      const milesUser = ensureMilesUser(store, interaction.user.id);
      await interaction.reply({ embeds: [buildProfileEmbed(interaction.user, milesUser)], components: buildProfileActions(interaction.user.id) });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'etihad_guest') {
      const subcommand = interaction.options.getSubcommand();
      const store = await loadMilesStore();
      const milesUser = ensureMilesUser(store, interaction.user.id);
      let notice = null;

      if (subcommand === 'create') {
        if (milesUser.guest) {
          await interaction.reply({ content: 'You already have an Etihad Guest account.', flags: MessageFlags.Ephemeral });
          return;
        } else {
          milesUser.guest = { tier: 'bronze', createdAt: new Date().toISOString(), upgradedAt: null };
          const roleSync = await syncGuestTierRole(interaction, 'bronze');
          await saveMilesStore(store);
          notice = roleSync.ok ? 'Your free Bronze Etihad Guest account has been created.' : `Your free Bronze Etihad Guest account has been created.\n${roleSync.reason}`;
        }
      }

      await interaction.reply({ components: [buildGuestContainer(interaction.user, milesUser, notice)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'miles_shop') {
      const selectedItem = interaction.options.getString('item');
      const store = await loadMilesStore();
      const milesUser = ensureMilesUser(store, interaction.user.id);
      let purchaseText = null;

      if (selectedItem) {
        const [selectedKey, item] = resolveShopItem(selectedItem);
        const cooldown = selectedKey ? activeShopCooldown(milesUser, selectedKey) : null;
        if (!item) {
          purchaseText = 'That shop item could not be found.';
        } else if (cooldown) {
          purchaseText = `**${item.label}** is on cooldown until ${formatRelativeTime(cooldown)}.`;
        } else if (milesUser.balance < item.price) {
          purchaseText = `You need ${MILES_EMOJI} ${item.price - milesUser.balance} more miles to buy **${item.label}**.`;
        } else {
          milesUser.balance -= item.price;
          milesUser.shopCooldowns[selectedKey] = Date.now() + SHOP_COOLDOWN_MS;
          milesUser.purchases.push({ key: selectedKey, label: item.label, price: item.price, boughtAt: new Date().toISOString() });
          await saveMilesStore(store);
          purchaseText = `Purchased **${item.label}** for ${MILES_EMOJI} ${item.price} miles.`;
        }
      }

      await interaction.reply({ components: [buildShopContainer(interaction.user, milesUser, purchaseText)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'create_flight') {
      if (!hasFlightManagementAccess(interaction)) {
        await interaction.reply({ content: `You need the <@&${FLIGHT_MANAGER_ROLE_ID}> role to create flights.`, flags: MessageFlags.Ephemeral });
        return;
      }

      sessions.set(interaction.user.id, {
        creatorId: interaction.user.id,
        channelId: interaction.options.getChannel('channel', true).id,
        messageId: null,
        form1: null,
        form2: null,
        form3: null,
        flightData: null,
        eventLink: null,
        bookings: {},
        classNames: emptyClassNames(),
        finished: false,
        milesAwards: []
      });
      await interaction.showModal(form1);
      return;
    }

    if (interaction.isModalSubmit()) {
      const s = sessions.get(interaction.user.id);
      if (!s) {
        await interaction.reply({ content: 'No active session. Run /create_flight again.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (interaction.customId === 'form_1') {
        s.form1 = {
          'flight-details.flight-number': interaction.fields.getTextInputValue('flight_number'),
          'flight-details.departure-airport': interaction.fields.getTextInputValue('departure_airport'),
          'flight-details.arrival-airport': interaction.fields.getTextInputValue('arrival_airport'),
          'flight-details.iata1': interaction.fields.getTextInputValue('iata1'),
          'flight-details.iata2': interaction.fields.getTextInputValue('iata2')
        };
        await interaction.reply({
          content: 'Form 1 submitted. Press **Proceed** to continue to Form 2.',
          flags: MessageFlags.Ephemeral,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('proceed_2').setLabel('Proceed').setStyle(ButtonStyle.Primary))]
        });
        return;
      }

      if (interaction.customId === 'form_2') {
        s.form2 = {
          'flight-details2.date': interaction.fields.getTextInputValue('date'),
          'flight-details2.timestamp1': interaction.fields.getTextInputValue('timestamp1'),
          'flight-details2.boarding-time': interaction.fields.getTextInputValue('boarding_time'),
          'flight-details2.timestamp2': interaction.fields.getTextInputValue('timestamp2'),
          'flight-details2.closing-time': interaction.fields.getTextInputValue('closing_time')
        };
        await interaction.reply({
          content: 'Form 2 submitted. Press **Proceed** to continue to Form 3.',
          flags: MessageFlags.Ephemeral,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('proceed_3').setLabel('Proceed').setStyle(ButtonStyle.Primary))]
        });
        return;
      }

      if (interaction.customId === 'form_3') {
        s.form3 = {
          'flight-details-3.link': interaction.fields.getTextInputValue('link'),
          'flight-details-3.banner': interaction.fields.getTextInputValue('banner'),
          'flight-details-3.aircraft': interaction.fields.getTextInputValue('aircraft')
        };
        s.eventLink = s.form3['flight-details-3.link'];
        s.flightData = { ...s.form1, ...s.form2, ...s.form3 };

        const ch = await client.channels.fetch(s.channelId);
        if (!ch || !ch.isTextBased()) throw new Error('Selected channel is not a text channel.');

        const sentMessage = await ch.send({ components: [buildFlightContainer(s.flightData, s.classNames, s.finished)], flags: MessageFlags.IsComponentsV2 });
        s.messageId = sentMessage.id;
        sessions.set(sentMessage.id, s);

        await interaction.reply({ content: `All forms completed. Message sent to <#${s.channelId}>.`, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'proceed_2') return void (await interaction.showModal(form2));
      if (interaction.customId === 'proceed_3') return void (await interaction.showModal(form3));

      if (interaction.customId === 'finish_flight') {
        const s = sessions.get(interaction.message.id);
        if (!s?.flightData) {
          await interaction.reply({ content: 'No saved flight data found for this flight.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (!hasFlightManagementAccess(interaction)) {
          await interaction.reply({ content: `You need the <@&${FLIGHT_MANAGER_ROLE_ID}> role to finish flights.`, flags: MessageFlags.Ephemeral });
          return;
        }
        if (s.finished) {
          await interaction.reply({ content: 'This flight has already been finished.', flags: MessageFlags.Ephemeral });
          return;
        }

        const awards = await finishFlight(s);
        await editFlightMessage(s, interaction.message);
        await interaction.reply({
          components: [new ContainerBuilder().setAccentColor(FLIGHT_COLOR).addTextDisplayComponents(text(`**Flight finished**\n${formatMilesAwards(awards)}`))],
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
        });
        return;
      }

      if (['eco_class', 'business_class', 'first_class'].includes(interaction.customId)) {
        const s = sessions.get(interaction.message.id);
        if (!s?.eventLink || !s.flightData) {
          await interaction.reply({ content: 'No saved flight data found. Please run /create_flight again.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (s.finished) {
          await interaction.reply({ content: 'This flight has already finished.', flags: MessageFlags.Ephemeral });
          return;
        }

        const cls = classConfig(interaction.customId);
        const member = interaction.member;
        if (cls.roleId && !member?.roles?.cache?.has?.(cls.roleId)) {
          await interaction.reply({ content: `You need the required role for ${cls.name}.`, flags: MessageFlags.Ephemeral });
          return;
        }

        const passengerName = interaction.member?.displayName ?? interaction.user.username;
        addBookingMention(s.classNames, cls, interaction.user.id);
        s.bookings[interaction.user.id] = { classType: cls.classType, passengerName };
        await editFlightMessage(s, interaction.message);

        const bookingContainer = new ContainerBuilder()
          .setAccentColor(FLIGHT_COLOR)
          .addTextDisplayComponents(text(`# ${cls.name} booking\nPassenger: **${passengerName}**\nSaved as: \`${cls.varKey}\`\nUse the buttons below to continue.`))
          .addActionRowComponents(row =>
            row.addComponents(
              new ButtonBuilder().setLabel('Flight event link').setStyle(ButtonStyle.Link).setURL(s.eventLink),
              new ButtonBuilder().setCustomId(`get_itinerary:${interaction.message.id}:${cls.classType}`).setLabel('Get itinerary').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`opt_out:${interaction.message.id}`).setLabel('Opt out').setStyle(ButtonStyle.Secondary)
            )
          )
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
          .addMediaGalleryComponents(footerMedia());

        await interaction.reply({ components: [bookingContainer], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        return;
      }

      if (interaction.customId === 'opt_out' || interaction.customId.startsWith('opt_out:')) {
        const [, savedMessageId] = interaction.customId.split(':');
        const messageId = savedMessageId ?? interaction.message.id;
        const s = sessions.get(messageId);
        if (!s?.flightData) {
          await interaction.reply({ content: 'No saved flight data found. Please book again from the flight message.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (s.finished) {
          await interaction.reply({ content: 'This flight has already finished.', flags: MessageFlags.Ephemeral });
          return;
        }

        removeBookingMention(s.classNames, interaction.user.id);
        delete s.bookings[interaction.user.id];
        await editFlightMessage(s, interaction.message);
        await interaction.reply({ content: 'You have been removed from the passenger list.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (interaction.customId.startsWith('get_itinerary:')) {
        const [, messageId] = interaction.customId.split(':');
        const s = sessions.get(messageId);
        if (!s?.flightData) {
          await interaction.reply({ content: 'No saved flight data found. Please book again from the flight message.', flags: MessageFlags.Ephemeral });
          return;
        }

        const booking = s.bookings[interaction.user.id];
        if (!booking) {
          await interaction.reply({ content: 'You are not currently booked on this flight.', flags: MessageFlags.Ephemeral });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cls = classConfig(booking.classType);
        const imageUrl = await generateBoardingPass(buildBoardingPassPayload(s, cls, booking.passengerName));
        const itineraryContainer = new ContainerBuilder().setAccentColor(FLIGHT_COLOR);
        if (imageUrl) {
          itineraryContainer.addTextDisplayComponents(text('Your boarding pass is ready:')).addMediaGalleryComponents(media(imageUrl));
        } else {
          itineraryContainer.addTextDisplayComponents(text('Your boarding pass was generated, but no image URL was returned.'));
        }

        await interaction.editReply({ components: [itineraryContainer], flags: MessageFlags.IsComponentsV2 });
      }
    }
  } catch (error) {
    console.error(error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Error while processing request.', flags: MessageFlags.Ephemeral });
    } else if (interaction.isRepliable() && interaction.deferred) {
      await interaction.editReply({ content: `Error while processing request: ${error.message}` });
    }
  }
});

client.login(token);
