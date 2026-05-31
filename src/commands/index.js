import { adminCommand } from './admin/admin.js';
import { securityCommand } from './admin/security.js';
import { etihadGuestCommand } from './guest/etihadGuest.js';
import { profileCommand } from './guest/profile.js';
import { createFlightCommand } from './flights/createFlight.js';
import { flightHistoryCommand } from './flights/flightHistory.js';
import { milesShopCommand } from './miles/milesShop.js';

export const commands = [createFlightCommand, flightHistoryCommand, milesShopCommand, etihadGuestCommand, profileCommand, adminCommand, securityCommand].map(command =>
  command.toJSON()
);
