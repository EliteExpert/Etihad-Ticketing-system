import { ChannelType, SlashCommandBuilder } from 'discord.js';

export const createFlightCommand = new SlashCommandBuilder()
  .setName('create_flight')
  .setDescription('Run 3 forms in sequence, then post class buttons.')
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel to send the final message in')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );
