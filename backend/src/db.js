import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DB_PATH || "./data/calendar.db";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
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

  CREATE TABLE IF NOT EXISTS events (
    device_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    notes TEXT,
    reminder TEXT,
    recurrence_type TEXT NOT NULL DEFAULT 'none',
    recurrence_end_date TEXT,
    PRIMARY KEY (device_id, id)
  );

  CREATE TABLE IF NOT EXISTS fired_reminders (
    device_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    date_key TEXT NOT NULL,
    fired_at TEXT NOT NULL,
    PRIMARY KEY (device_id, event_id, date_key)
  );
`);

export function upsertDevice(deviceId, tzOffsetMinutes) {
  db.prepare(
    `INSERT INTO devices (device_id, tz_offset_minutes, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(device_id) DO UPDATE SET tz_offset_minutes = excluded.tz_offset_minutes, updated_at = excluded.updated_at`
  ).run(deviceId, tzOffsetMinutes ?? 0);
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

export function replaceEventsForDevice(deviceId, events) {
  const del = db.prepare(`DELETE FROM events WHERE device_id = ?`);
  const insert = db.prepare(`
    INSERT INTO events (device_id, id, title, date, start_time, end_time, notes, reminder, recurrence_type, recurrence_end_date)
    VALUES (@deviceId, @id, @title, @date, @startTime, @endTime, @notes, @reminder, @recurrenceType, @recurrenceEndDate)
  `);
  const tx = db.transaction((rows) => {
    del.run(deviceId);
    for (const ev of rows) {
      insert.run({
        deviceId,
        id: ev.id,
        title: ev.title || "",
        date: ev.date,
        startTime: ev.startTime,
        endTime: ev.endTime,
        notes: ev.notes || "",
        reminder: ev.reminder || "none",
        recurrenceType: ev.recurrence?.type || "none",
        recurrenceEndDate: ev.recurrence?.endDate || null,
      });
    }
  });
  tx(events);
}

export function getAllDevicesWithSubscriptions() {
  return db.prepare(`
    SELECT d.device_id AS deviceId, d.tz_offset_minutes AS tzOffsetMinutes,
           s.endpoint, s.p256dh, s.auth
    FROM devices d
    JOIN subscriptions s ON s.device_id = d.device_id
  `).all();
}

export function getEventsForDevice(deviceId) {
  return db.prepare(`SELECT * FROM events WHERE device_id = ?`).all(deviceId);
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
