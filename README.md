# My Calendar

A day/week/month calendar PWA with swipe navigation, color-coded events,
recurrence, and real Web Push reminders — ported from a Claude.ai artifact
into a standalone, installable app.

**Live app:** https://my-calendar-pwa.vercel.app
**Backend API:** https://my-calendar-backend-clfn.onrender.com
**Source:** https://github.com/Samg06fr/my-calendar-pwa

## Install it on your phone

**iPhone (Safari):**
1. Open https://my-calendar-pwa.vercel.app in Safari
2. Tap the Share icon (square with an arrow) → **Add to Home Screen** → **Add**
3. Open the app from your Home Screen, tap the bell icon in the top bar, and allow notifications when prompted

**Android (Chrome):**
1. Open https://my-calendar-pwa.vercel.app in Chrome
2. Tap the ⋮ menu → **Install app** (or you'll see an automatic "Add to Home screen" banner)
3. Open the installed app, tap the bell icon, and allow notifications when prompted

Once notifications are enabled, reminders you set on events will arrive as
push notifications even if the app is closed — a server checks every minute
and sends them at the right time.

## Project layout

```
frontend/   Vite + React PWA (the calendar UI)
backend/    Express + SQLite push-notification service
render.yaml Render Blueprint for the backend
```

## Local development

**Frontend:**
```
cd frontend
npm install
npm run dev
```
Runs at http://localhost:5173. By default it points at
`http://localhost:4000` for the API (see `.env.development`).

**Backend:**
```
cd backend
npm install
npm run generate-vapid   # writes VAPID keys into backend/.env (first time only)
npm start
```
Runs at http://localhost:4000.

## How reminders work

1. The frontend stores events in IndexedDB (on-device, offline-capable).
2. Whenever notifications are enabled and events change, the frontend syncs
   a copy of the events (plus the device's timezone offset) to the backend.
3. A cron job on the backend checks every minute whether any event's
   reminder window has been entered, using the same recurrence + offset
   logic as the UI, and sends a Web Push notification via VAPID.
4. The service worker (`frontend/public/sw.js`) receives the push and shows
   the notification, even if the tab/app is closed.

See the end of the project's build conversation for the full list of
implementation decisions and known limitations (Render free-tier cold
starts, SQLite persistence caveats, etc.).
