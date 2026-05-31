import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const securityCommand = new SlashCommandBuilder()
  .setName('security')
  .setDescription('Security checks and account controls.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('audit')
      .setDescription('Audit a passenger Guest account, roles, cooldowns, and support status.')
      .addUserOption(option => option.setName('user').setDescription('Passenger to audit').setRequired(true))
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('revoke_guest')
      .setDescription('Remove a passenger Guest account and all tier roles.')
      .addUserOption(option => option.setName('user').setDescription('Passenger to revoke').setRequired(true))
  );
