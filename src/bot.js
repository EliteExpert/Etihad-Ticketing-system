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

if (!token || !clientId || !guildId) {
  throw new Error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in environment.');
}

const commands = [
  new SlashCommandBuilder()
    .setName('create_flight')
    .setDescription('Post a component v2 flight announcement with class buttons.')
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
const itinerarySessions = new Map();

const passengerForm = new ModalBuilder()
  .setCustomId('passenger_form')
  .setTitle('Passenger details')
  .addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('first_name')
        .setLabel('Passenger name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('{first.name}')
    )
  );

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, c => {
  console.log(`Logged in as ${c.user.tag}`);
});

function classDisplayName(classId) {
  return {
    eco_class: 'Economy class',
    business_class: 'Business class',
    first_class: 'First class'
  }[classId];
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'create_flight') {
      const targetChannelId = interaction.options.getChannel('channel', true).id;
      sessions.set(interaction.user.id, {
        channelId: targetChannelId,
        eventLink: 'https://discord.com/events/your-server-id/your-event-id',
        banner: 'https://via.placeholder.com/400x400',
        from: 'Abu Dhabi (AUH)',
        to: 'London (LHR)',
        flightNo: 'EY 12',
        date: '2026-05-01',
        departureGmt: '18:00',
        aircraft: 'Boeing 787-9'
      });

      const state = sessions.get(interaction.user.id);
      const channel = await client.channels.fetch(state.channelId);

      const container = new ContainerBuilder()
        .addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems({ media: { url: state.banner } })
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `> An Emirates flight has been dispatched from **${state.from}** to **${state.to}**.\n` +
              `**Flight**: ${state.flightNo}\n` +
              `**Date**: ${state.date}\n` +
              `**Departure (GMT)**: ${state.departureGmt}\n` +
              `**Aircraft**: ${state.aircraft}`
          )
        )
        .addActionRowComponents(row =>
          row.addComponents(
            new ButtonBuilder().setCustomId('eco_class').setLabel('Economy class').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('business_class').setLabel('Business class').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('first_class').setLabel('First class').setStyle(ButtonStyle.Danger)
          )
        );

      await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
      await interaction.reply({ content: `✅ Announcement posted in <#${state.channelId}>.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.isButton()) {
      if (['eco_class', 'business_class', 'first_class'].includes(interaction.customId)) {
        itinerarySessions.set(interaction.user.id, { classId: interaction.customId, sourceMessageId: interaction.message.id });
        await interaction.showModal(passengerForm);
        return;
      }

      if (interaction.customId === 'get_itinerary') {
        await interaction.reply({
          content: '📡 API request block placeholder: request intentionally left blank for now.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'passenger_form') {
      const info = itinerarySessions.get(interaction.user.id);
      const base = sessions.get(interaction.user.id);
      const firstName = interaction.fields.getTextInputValue('first_name');

      if (!info || !base) {
        await interaction.reply({ content: 'Session expired. Please click a class button again.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        components: [
          new ContainerBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `✅ Passenger captured: **${firstName}**\nSelected class: **${classDisplayName(info.classId)}**`
              )
            )
            .addActionRowComponents(row =>
              row.addComponents(
                new ButtonBuilder().setLabel('Flight event link').setStyle(ButtonStyle.Link).setURL(base.eventLink),
                new ButtonBuilder().setCustomId('get_itinerary').setLabel('Get itinerary').setStyle(ButtonStyle.Primary)
              )
            )
        ]
      });

      itinerarySessions.delete(interaction.user.id);
    }
  } catch (error) {
    console.error(error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Error while processing this action.', flags: MessageFlags.Ephemeral });
    }
  }
});

client.login(token);
