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

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'create_flight') {
      sessions.set(interaction.user.id, {
        channelId: interaction.options.getChannel('channel', true).id,
        form1: null,
        form2: null,
        form3: null
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
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('proceed_2').setLabel('Proceed').setStyle(ButtonStyle.Primary)
            )
          ]
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
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('proceed_3').setLabel('Proceed').setStyle(ButtonStyle.Primary)
            )
          ]
        });
        return;
      }

      if (interaction.customId === 'form_3') {
        s.form3 = {
          'flight-details-3.link': interaction.fields.getTextInputValue('link'),
          'flight-details-3.banner': interaction.fields.getTextInputValue('banner'),
          'flight-details-3.aircraft': interaction.fields.getTextInputValue('aircraft')
        };

        const data = { ...s.form1, ...s.form2, ...s.form3 };
        const ch = await client.channels.fetch(s.channelId);
        if (!ch || !ch.isTextBased()) {
          throw new Error('Selected channel is not a text channel.');
        }

        const container = new ContainerBuilder();
        const bannerUrl = data['flight-details-3.banner'];
        const isHttpUrl = /^https?:\/\//i.test(bannerUrl);
        if (isHttpUrl) {
          container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems({ media: { url: bannerUrl } }));
        }

        container
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `> An Emirates flight has been dispatched from **${data['flight-details.departure-airport']}** to **${data['flight-details.arrival-airport']}**.\n` +
                `**Flight**: ${data['flight-details.flight-number']}\n` +
                `**Date**: ${data['flight-details2.date']}\n` +
                `**Check-in opens (GMT)**: ${data['flight-details2.timestamp1']}\n` +
                `**Boarding (GMT)**: ${data['flight-details2.boarding-time']}\n` +
                `**Departure (GMT)**: ${data['flight-details2.timestamp2']}\n` +
                `**Gate closes (GMT)**: ${data['flight-details2.closing-time']}\n` +
                `**Aircraft**: ${data['flight-details-3.aircraft']}\n` +
                `**Event link**: ${data['flight-details-3.link']}\n` +
                `${isHttpUrl ? '' : '⚠️ Banner was skipped because the provided link is not a valid http(s) URL.'}`
            )
          )
          .addActionRowComponents(row =>
            row.addComponents(
              new ButtonBuilder().setCustomId('eco_class').setLabel('Economy class').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('business_class').setLabel('Business class').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId('first_class').setLabel('First class').setStyle(ButtonStyle.Danger)
            )
          );

        await ch.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        sessions.delete(interaction.user.id);
        await interaction.reply({ content: `All forms completed. Message sent to <#${s.channelId}>.`, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'proceed_2') {
        await interaction.showModal(form2);
        return;
      }
      if (interaction.customId === 'proceed_3') {
        await interaction.showModal(form3);
        return;
      }

      if (['eco_class', 'business_class', 'first_class'].includes(interaction.customId)) {
        await interaction.reply({ content: 'Class selected.', flags: MessageFlags.Ephemeral });
      }
    }
  } catch (error) {
    console.error(error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Error while processing request.', flags: MessageFlags.Ephemeral });
    }
  }
});

client.login(token);
