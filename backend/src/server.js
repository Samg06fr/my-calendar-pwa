import "dotenv/config";
import express from "express";
import cors from "cors";
import webpush from "web-push";
import cron from "node-cron";
import {
  createAccount,
  getAccountByCode,
  accountExists,
  upsertDevice,
  upsertSubscription,
  getAllDevicesWithSubscriptions,
  upsertAccountData,
  getAccountData,
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
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Creates a brand-new sync account (a fresh, empty calendar identity).
// Called automatically the first time the app runs on a device with no
// account linked yet.
app.post("/api/account", (req, res) => {
  const { id, code } = createAccount();
  res.json({ accountId: id, code });
});

// Resolves a human-typed sync code (from another device) to an accountId,
// so this device can link itself to an existing calendar.
app.post("/api/account/join", (req, res) => {
  const { code } = req.body || {};
  const account = getAccountByCode(code);
  if (!account) return res.status(404).json({ error: "No account found for that code" });
  res.json({ accountId: account.id, code: account.code });
});

app.get("/api/account/:accountId/data", (req, res) => {
  const { accountId } = req.params;
  if (!accountExists(accountId)) return res.status(404).json({ error: "Unknown accountId" });
  res.json(getAccountData(accountId));
});

app.post("/api/subscribe", (req, res) => {
  const { subscription, deviceId, accountId, tzOffsetMinutes } = req.body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth || !deviceId || !accountId) {
    return res.status(400).json({ error: "subscription, deviceId, and accountId are required" });
  }
  upsertDevice(deviceId, accountId, tzOffsetMinutes);
  upsertSubscription(deviceId, subscription);
  res.json({ ok: true });
});

// Two-way sync: this device pushes its current events/colors up (becoming
// the account's latest state), and gets back whatever is currently stored
// (which may include changes made from another device since this device's
// last sync).
app.post("/api/sync", (req, res) => {
  const { deviceId, accountId, tzOffsetMinutes, events, colors } = req.body || {};
  if (!deviceId || !accountId || !Array.isArray(events) || !Array.isArray(colors)) {
    return res.status(400).json({ error: "deviceId, accountId, events[], and colors[] are required" });
  }
  upsertDevice(deviceId, accountId, tzOffsetMinutes);
  upsertAccountData(accountId, events, colors);
  res.json({ ok: true });
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
