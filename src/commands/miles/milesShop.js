import { SlashCommandBuilder } from 'discord.js';
import { SHOP_ITEMS } from '../../config.js';

export const milesShopCommand = new SlashCommandBuilder()
  .setName('miles_shop')
  .setDescription('View or buy rewards with your Etihad miles.')
  .addStringOption(option =>
    option
      .setName('item')
      .setDescription('Reward to buy. Leave blank to view the shop.')
      .setRequired(false)
      .addChoices(...Object.entries(SHOP_ITEMS).map(([value, item]) => ({ name: `${item.label} - ${item.price} miles`, value })))
  );
