import { mkdir, readFile, writeFile } from 'node:fs/promises';

const MILES_DATA_DIR = new URL('../../data/', import.meta.url);
const MILES_DATA_FILE = new URL('../../data/miles.json', import.meta.url);

export async function loadMilesStore() {
  try {
    const raw = await readFile(MILES_DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.users ? parsed : { users: {} };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(error);
    return { users: {} };
  }
}

export async function saveMilesStore(store) {
  await mkdir(MILES_DATA_DIR, { recursive: true });
  await writeFile(MILES_DATA_FILE, JSON.stringify(store, null, 2));
}

export function ensureMilesUser(store, userId) {
  store.users[userId] ??= { balance: 0, flights: [], purchases: [], shopCooldowns: {}, guest: null };
  store.users[userId].balance ??= 0;
  store.users[userId].flights ??= [];
  store.users[userId].purchases ??= [];
  store.users[userId].shopCooldowns ??= {};
  store.users[userId].guest ??= null;
  return store.users[userId];
}
