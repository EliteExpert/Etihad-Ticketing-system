import { SlashCommandBuilder } from 'discord.js';
import { GUEST_TIERS } from '../../config.js';

const upgradeChoices = Object.entries(GUEST_TIERS)
  .filter(([value]) => value !== 'bronze')
  .map(([value, tier]) => ({ name: `${tier.label} - ${tier.price} miles`, value }));

export const etihadGuestCommand = new SlashCommandBuilder()
  .setName('etihad_guest')
  .setDescription('Create and manage your Etihad Guest account.')
  .addSubcommand(subcommand =>
    subcommand.setName('create').setDescription('Create your free Bronze Etihad Guest account.')
  )
  .addSubcommand(subcommand => subcommand.setName('profile').setDescription('View your Etihad Guest account and tier benefits.'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('upgrade')
      .setDescription('Upgrade your Etihad Guest tier with miles.')
      .addStringOption(option =>
        option
          .setName('tier')
          .setDescription('Tier to upgrade to')
          .setRequired(true)
          .addChoices(...upgradeChoices)
      )
  );
