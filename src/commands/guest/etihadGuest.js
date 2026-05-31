import { SlashCommandBuilder } from 'discord.js';

export const etihadGuestCommand = new SlashCommandBuilder()
  .setName('etihad_guest')
  .setDescription('Create your Etihad Guest account.')
  .addSubcommand(subcommand =>
    subcommand.setName('create').setDescription('Create your free Bronze Etihad Guest account.')
  );
