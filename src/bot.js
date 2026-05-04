import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  REST,
  Routes,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ContainerBuilder
} from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const boardingPassApiUrl =
  process.env.BOARDING_PASS_API_URL ??
  'https://etihad-ticketing-system-backend.onrender.com/generate-boarding-pass';

const BUSINESS_ROLE_ID = '1499998210163478609';
const FIRST_ROLE_ID = '1499998296209625258';

if (!token || !clientId || !guildId) {
  throw new Error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in environment.');
}

const commands = [
  new SlashCommandBuilder()
    .setName('create_flight')
    .setDescription('Run 3 forms in sequence, then post class buttons.')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send the final message in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

const sessions = new Map();

function modal(customId, title, fields) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(title);
  m.addComponents(
    ...fields.map(f =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(f.id)
          .setLabel(f.label)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(f.placeholder ?? '')
      )
    )
  );
  return m;
}

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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, c => console.log(`Logged in as ${c.user.tag}`));

function classConfig(customIdOrClass) {
  if (customIdOrClass === 'business_class' || customIdOrClass === 'business') {
    return {
      name: 'Business class',
      roleId: BUSINESS_ROLE_ID,
      varKey: '{business.name}',
      classType: 'business',
      zone: '2',
      skywardsNumber: '87654321',
      additionalInfo: 'Priority boarding'
    };
  }

  if (customIdOrClass === 'first_class' || customIdOrClass === 'first') {
    return {
      name: 'First class',
      roleId: FIRST_ROLE_ID,
      varKey: '{first.name}',
      classType: 'first',
      zone: '1',
      skywardsNumber: '271646124',
      additionalInfo: 'Chauffeur available'
    };
  }

  return {
    name: 'Economy class',
    roleId: null,
    varKey: '{economy.name}',
    classType: 'economy',
    zone: '3',
    skywardsNumber: '12345678',
    additionalInfo: 'Enjoy your flight!'
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

function buildFlightContainer(data, classNames) {
  const container = new ContainerBuilder();
  const bannerUrl = data['flight-details-3.banner'];

  if (/^https?:\/\//i.test(bannerUrl)) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems({ media: { url: bannerUrl } }));
  }

  return container
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> An Etihad flight has been dispatched from **${data['flight-details.departure-airport']}** to **${data['flight-details.arrival-airport']}**.\n` +
          `\n` +
          `**Flight**: ${data['flight-details.flight-number']}\n` +
          `**Date**: ${data['flight-details2.date']}\n` +
          `**Check-in opens (GMT)**: ${data['flight-details2.timestamp1']}\n` +
          `**Boarding (GMT)**: ${data['flight-details2.boarding-time']}\n` +
          `**Departure (GMT)**: ${data['flight-details2.timestamp2']}\n` +
          `**Gate closes (GMT)**: ${data['flight-details2.closing-time']}\n` +
          `**Aircraft**: ${data['flight-details-3.aircraft']}\n` +
          `\n` +
          `**Passengers booked**\n${formatPassengerList(classNames)}`
      )
    )
    .addActionRowComponents(row =>
      row.addComponents(
        new ButtonBuilder().setCustomId('eco_class').setLabel('Economy class').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('business_class').setLabel('Business class').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('first_class').setLabel('First class').setStyle(ButtonStyle.Danger)
      )
    );
}

async function editFlightMessage(session, sourceMessage = null) {
  const components = [buildFlightContainer(session.flightData, session.classNames)];
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

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'create_flight') {
      sessions.set(interaction.user.id, {
        channelId: interaction.options.getChannel('channel', true).id,
        messageId: null,
        form1: null,
        form2: null,
        form3: null,
        flightData: null,
        eventLink: null,
        bookings: {},
        classNames: emptyClassNames()
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

        const sentMessage = await ch.send({ components: [buildFlightContainer(s.flightData, s.classNames)], flags: MessageFlags.IsComponentsV2 });
        s.messageId = sentMessage.id;
        sessions.set(sentMessage.id, s);

        await interaction.reply({ content: `All forms completed. Message sent to <#${s.channelId}>.`, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'proceed_2') return void (await interaction.showModal(form2));
      if (interaction.customId === 'proceed_3') return void (await interaction.showModal(form3));

      if (['eco_class', 'business_class', 'first_class'].includes(interaction.customId)) {
        const s = sessions.get(interaction.message.id);
        if (!s?.eventLink || !s.flightData) {
          await interaction.reply({ content: 'No saved flight data found. Please run /create_flight again.', flags: MessageFlags.Ephemeral });
          return;
        }

        const cls = classConfig(interaction.customId);
        const member = interaction.member;
        if (cls.roleId) {
          const hasRole = member?.roles?.cache?.has?.(cls.roleId);
          if (!hasRole) {
            await interaction.reply({ content: `You need the required role for ${cls.name}.`, flags: MessageFlags.Ephemeral });
            return;
          }
        }

        const passengerName = interaction.member?.displayName ?? interaction.user.username;
        addBookingMention(s.classNames, cls, interaction.user.id);
        s.bookings[interaction.user.id] = { classType: cls.classType, passengerName };

        await editFlightMessage(s, interaction.message);

        const bookingContainer = new ContainerBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `# ${cls.name} booking\nPassenger: **${passengerName}**\nSaved as: \`${cls.varKey}\`\nUse the buttons below to continue.`
            )
          )
          .addActionRowComponents(row =>
            row.addComponents(
              new ButtonBuilder().setLabel('Flight event link').setStyle(ButtonStyle.Link).setURL(s.eventLink),
              new ButtonBuilder().setCustomId(`get_itinerary:${interaction.message.id}:${cls.classType}`).setLabel('Get itinerary').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`opt_out:${interaction.message.id}`).setLabel('Opt out').setStyle(ButtonStyle.Secondary)
            )
          )
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

        await interaction.reply({ components: [bookingContainer], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        return;
      }

      if (interaction.customId.startsWith('opt_out:')) {
        const [, messageId] = interaction.customId.split(':');
        const s = sessions.get(messageId);

        if (!s?.flightData) {
          await interaction.reply({ content: 'No saved flight data found. Please book again from the flight message.', flags: MessageFlags.Ephemeral });
          return;
        }

        removeBookingMention(s.classNames, interaction.user.id);
        delete s.bookings[interaction.user.id];
        await editFlightMessage(s);

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
        const payload = buildBoardingPassPayload(s, cls, booking.passengerName);
        const imageUrl = await generateBoardingPass(payload);

        const itineraryContainer = new ContainerBuilder();
        if (imageUrl) {
          itineraryContainer
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('Your boarding pass is ready:'))
            .addMediaGalleryComponents(new MediaGalleryBuilder().addItems({ media: { url: imageUrl } }));
        } else {
          itineraryContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('Your boarding pass was generated, but no image URL was returned.')
          );
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
