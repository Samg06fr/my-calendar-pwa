import { openDB } from "idb";

const DB_NAME = "calendar-app";
const DB_VERSION = 1;
const STORE_NAME = "kv";

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function loadKey(key, fallback) {
  try {
    const db = await getDB();
    const value = await db.get(STORE_NAME, key);
    if (value === undefined) return fallback;
    return value;
  } catch (e) {
    return fallback;
  }
}

export async function saveKey(key, value) {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, value, key);
  } catch (e) {
    /* noop */
  }
}
