import webpush from "web-push";
import {
  getAllDevicesWithSubscriptions,
  getEventsForDevice,
  hasFired,
  markFired,
  removeSubscription,
} from "./db.js";
import { toKey, addDaysUTC, occursOn, timeToMinutes, fromKey } from "./dateHelpers.js";

function truncate(str, max) {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, Math.floor(max - 0.5 * 6)) + " ...";
}

function minutesToLabel(mins) {
  let h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatTimeRange(start, end) {
  return `${minutesToLabel(timeToMinutes(start))} – ${minutesToLabel(timeToMinutes(end))}`;
}

// Runs once a minute. For every device with an active push subscription,
// checks whether any of its events have a reminder whose fire window
// (eventStart - reminderOffset .. eventStart) contains "now", using the
// same recurrence + reminder logic as the client's foreground poller.
export async function checkReminders() {
  const realNowMs = Date.now();
  const devices = getAllDevicesWithSubscriptions();

  for (const device of devices) {
    const events = getEventsForDevice(device.deviceId);
    if (events.length === 0) continue;

    // Shift the real UTC clock into this device's local wall-clock space.
    // JS getTimezoneOffset() semantics: local = UTC - offsetMinutes.
    const deviceLocalNow = new Date(realNowMs - device.tzOffsetMinutes * 60000);
    const todayKey = toKey(deviceLocalNow);
    const yesterdayKey = toKey(addDaysUTC(deviceLocalNow, -1));

    for (const dateKey of [todayKey, yesterdayKey]) {
      for (const ev of events) {
        if (!ev.reminder || ev.reminder === "none") continue;
        if (!occursOn(ev, dateKey)) continue;

        const [h, m] = ev.start_time.split(":").map(Number);
        const eventStartLocal = fromKey(dateKey);
        eventStartLocal.setUTCHours(h, m, 0, 0);
        // Convert the device-local wall-clock instant back to a real UTC instant.
        const eventStartMs = eventStartLocal.getTime() + device.tzOffsetMinutes * 60000;
        const fireAtMs = eventStartMs - Number(ev.reminder) * 60000;

        if (realNowMs >= fireAtMs && realNowMs < eventStartMs) {
          if (hasFired(device.deviceId, ev.id, dateKey)) continue;
          await sendReminderPush(device, ev);
          markFired(device.deviceId, ev.id, dateKey);
        }
      }
    }
  }
}

async function sendReminderPush(device, ev) {
  const subscription = {
    endpoint: device.endpoint,
    keys: { p256dh: device.p256dh, auth: device.auth },
  };
  const payload = JSON.stringify({
    title: ev.title || "Untitled event",
    body: `${formatTimeRange(ev.start_time, ev.end_time)}${ev.notes ? " — " + truncate(ev.notes, 60) : ""}`,
    tag: `event-${ev.id}`,
    url: "/",
  });

  try {
    await webpush.sendNotification(subscription, payload);
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Subscription is no longer valid (uninstalled, permission revoked, etc.)
      removeSubscription(device.deviceId);
    } else {
      console.error(`Push send failed for device ${device.deviceId}:`, err.statusCode, err.body);
    }
  }
}
