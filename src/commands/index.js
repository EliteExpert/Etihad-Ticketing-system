import { etihadGuestCommand } from './guest/etihadGuest.js';
import { createFlightCommand } from './flights/createFlight.js';
import { flightHistoryCommand } from './flights/flightHistory.js';
import { milesShopCommand } from './miles/milesShop.js';

export const commands = [createFlightCommand, flightHistoryCommand, milesShopCommand, etihadGuestCommand].map(command => command.toJSON());
