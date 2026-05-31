import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { GUEST_TIERS, SHOP_ITEMS } from '../../config.js';

const tierChoices = Object.entries(GUEST_TIERS).map(([value, tier]) => ({ name: tier.label, value }));
const shopChoices = Object.entries(SHOP_ITEMS).map(([value, item]) => ({ name: item.label, value }));

export const adminCommand = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Admin tools for Etihad Guest, miles, and support.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('user_info')
      .setDescription('Inspect a passenger account.')
      .addUserOption(option => option.setName('user').setDescription('Passenger to inspect').setRequired(true))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('add_miles')
      .setDescription('Add miles to a passenger.')
      .addUserOption(option => option.setName('user').setDescription('Passenger to update').setRequired(true))
      .addIntegerOption(option => option.setName('amount').setDescription('Miles to add').setMinValue(1).setRequired(true))
      .addStringOption(option => option.setName('reason').setDescription('Reason for the adjustment').setRequired(false))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove_miles')
      .setDescription('Remove miles from a passenger.')
      .addUserOption(option => option.setName('user').setDescription('Passenger to update').setRequired(true))
      .addIntegerOption(option => option.setName('amount').setDescription('Miles to remove').setMinValue(1).setRequired(true))
      .addStringOption(option => option.setName('reason').setDescription('Reason for the adjustment').setRequired(false))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('set_tier')
      .setDescription('Set a passenger Etihad Guest tier and sync their role.')
      .addUserOption(option => option.setName('user').setDescription('Passenger to update').setRequired(true))
      .addStringOption(option =>
        option
          .setName('tier')
          .setDescription('Tier to assign')
          .setRequired(true)
          .addChoices(...tierChoices)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('sync_tier_role')
      .setDescription('Re-apply the passenger current tier role.')
      .addUserOption(option => option.setName('user').setDescription('Passenger to sync').setRequired(true))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('reset_shop_cooldown')
      .setDescription('Reset shop cooldowns for a passenger.')
      .addUserOption(option => option.setName('user').setDescription('Passenger to update').setRequired(true))
      .addStringOption(option =>
        option
          .setName('item')
          .setDescription('Specific item to reset. Leave blank for all.')
          .setRequired(false)
          .addChoices(...shopChoices)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('close_support')
      .setDescription('Force close an open support ticket.')
      .addUserOption(option => option.setName('user').setDescription('Passenger ticket to close').setRequired(true))
  );
