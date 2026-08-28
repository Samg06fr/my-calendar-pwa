import "dotenv/config";
import express from "express";
import cors from "cors";
import webpush from "web-push";
import cron from "node-cron";
import {
  upsertDevice,
  upsertSubscription,
  getAllDevicesWithSubscriptions,
  replaceEventsForDevice,
} from "./db.js";
import { checkReminders } from "./scheduler.js";

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PORT, CORS_ORIGIN } = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Run `npm run generate-vapid` first.");
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const app = express();
app.use(cors({ origin: CORS_ORIGIN && CORS_ORIGIN !== "*" ? CORS_ORIGIN.split(",") : true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/subscribe", (req, res) => {
  const { subscription, deviceId } = req.body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth || !deviceId) {
    return res.status(400).json({ error: "subscription and deviceId are required" });
  }
  upsertDevice(deviceId);
  upsertSubscription(deviceId, subscription);
  res.json({ ok: true });
});

app.post("/api/events", (req, res) => {
  const { deviceId, events, tzOffsetMinutes } = req.body || {};
  if (!deviceId || !Array.isArray(events)) {
    return res.status(400).json({ error: "deviceId and events[] are required" });
  }
  upsertDevice(deviceId, tzOffsetMinutes);
  replaceEventsForDevice(deviceId, events);
  res.json({ ok: true, count: events.length });
});

// Manual trigger for end-to-end testing: sends an immediate test push to a device.
app.post("/api/test-notification", async (req, res) => {
  const { deviceId } = req.body || {};
  const devices = getAllDevicesWithSubscriptions();
  const device = devices.find((d) => d.deviceId === deviceId);
  if (!device) return res.status(404).json({ error: "No active subscription for this deviceId" });

  try {
    await webpush.sendNotification(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      JSON.stringify({ title: "Test notification", body: "Push notifications are working.", url: "/" })
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = Number(PORT) || 4000;
app.listen(port, () => {
  console.log(`Calendar backend listening on port ${port}`);
});

// Check every minute for reminders that need to fire.
cron.schedule("* * * * *", () => {
  checkReminders().catch((err) => console.error("checkReminders failed:", err));
});
