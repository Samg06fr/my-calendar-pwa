import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DB_PATH || "./data/calendar.db";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    tz_offset_minutes INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    device_id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- One row per account holding the full events/colors arrays as JSON.
  -- Kept as opaque blobs (rather than a normalized events table) because
  -- the frontend and scheduler both only ever need the whole array at once,
  -- and this guarantees the synced shape matches the client's IndexedDB
  -- model exactly with no lossy column mapping.
  CREATE TABLE IF NOT EXISTS account_data (
    account_id TEXT PRIMARY KEY,
    events_json TEXT NOT NULL DEFAULT '[]',
    colors_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fired_reminders (
    device_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    date_key TEXT NOT NULL,
    fired_at TEXT NOT NULL,
    PRIMARY KEY (device_id, event_id, date_key)
  );
`);

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — avoids visual ambiguity

function generateCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  }
  return code;
}

export function createAccount() {
  const id = crypto.randomUUID();
  let code;
  // Extremely unlikely to collide at 32^6 combinations, but guard anyway.
  do {
    code = generateCode();
  } while (getAccountByCode(code));
  db.prepare(`INSERT INTO accounts (id, code, created_at) VALUES (?, ?, datetime('now'))`).run(id, code);
  return { id, code };
}

export function getAccountByCode(code) {
  return db.prepare(`SELECT * FROM accounts WHERE code = ?`).get((code || "").toUpperCase().trim());
}

export function accountExists(accountId) {
  return !!db.prepare(`SELECT 1 FROM accounts WHERE id = ?`).get(accountId);
}

export function getAccountById(accountId) {
  return db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId);
}

// Self-heals a stale/orphaned accountId — e.g. a device that had an
// accountId cached locally from before the (non-persistent, free-tier)
// database was reset. Rather than forcing the device to start over with a
// brand-new id (which would orphan whatever it just pushed), re-create the
// accounts-table row under the SAME id with a freshly generated code, so
// existing devices/data referencing that id stay linked. Returns the
// account's current (possibly newly generated) code either way.
export function ensureAccountRow(accountId) {
  const existing = getAccountById(accountId);
  if (existing) return existing.code;

  let code;
  do {
    code = generateCode();
  } while (getAccountByCode(code));
  db.prepare(`INSERT INTO accounts (id, code, created_at) VALUES (?, ?, datetime('now'))`).run(accountId, code);
  return code;
}

export function upsertDevice(deviceId, accountId, tzOffsetMinutes) {
  db.prepare(
    `INSERT INTO devices (device_id, account_id, tz_offset_minutes, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(device_id) DO UPDATE SET account_id = excluded.account_id, tz_offset_minutes = excluded.tz_offset_minutes, updated_at = excluded.updated_at`
  ).run(deviceId, accountId, tzOffsetMinutes ?? 0);
}

export function upsertSubscription(deviceId, subscription) {
  db.prepare(
    `INSERT INTO subscriptions (device_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(device_id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(deviceId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
}

export function removeSubscription(deviceId) {
  db.prepare(`DELETE FROM subscriptions WHERE device_id = ?`).run(deviceId);
}

export function upsertAccountData(accountId, events, colors) {
  db.prepare(
    `INSERT INTO account_data (account_id, events_json, colors_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET events_json = excluded.events_json, colors_json = excluded.colors_json, updated_at = excluded.updated_at`
  ).run(accountId, JSON.stringify(events || []), JSON.stringify(colors || []));
}

export function getAccountData(accountId) {
  const row = db.prepare(`SELECT events_json, colors_json FROM account_data WHERE account_id = ?`).get(accountId);
  if (!row) return { events: [], colors: [] };
  return { events: JSON.parse(row.events_json), colors: JSON.parse(row.colors_json) };
}

export function getAllDevicesWithSubscriptions() {
  return db.prepare(`
    SELECT d.device_id AS deviceId, d.account_id AS accountId, d.tz_offset_minutes AS tzOffsetMinutes,
           s.endpoint, s.p256dh, s.auth
    FROM devices d
    JOIN subscriptions s ON s.device_id = d.device_id
  `).all();
}

export function getDevicesForAccount(accountId) {
  return db.prepare(`
    SELECT d.device_id AS deviceId, s.endpoint, s.p256dh, s.auth
    FROM devices d
    JOIN subscriptions s ON s.device_id = d.device_id
    WHERE d.account_id = ?
  `).all(accountId);
}

export function hasFired(deviceId, eventId, dateKey) {
  return !!db.prepare(
    `SELECT 1 FROM fired_reminders WHERE device_id = ? AND event_id = ? AND date_key = ?`
  ).get(deviceId, eventId, dateKey);
}

export function markFired(deviceId, eventId, dateKey) {
  db.prepare(
    `INSERT OR IGNORE INTO fired_reminders (device_id, event_id, date_key, fired_at) VALUES (?, ?, ?, datetime('now'))`
  ).run(deviceId, eventId, dateKey);
}
