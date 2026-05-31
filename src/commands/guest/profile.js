import { SlashCommandBuilder } from 'discord.js';

export const profileCommand = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('View your public Etihad Guest profile.');
