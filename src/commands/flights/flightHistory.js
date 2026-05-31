import { SlashCommandBuilder } from 'discord.js';

export const flightHistoryCommand = new SlashCommandBuilder()
  .setName('flight_history')
  .setDescription('View your attended flights and Etihad miles balance.');
