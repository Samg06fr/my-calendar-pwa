const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function subscribeToPush(deviceId) {
  if (!(await isPushSupported())) return null;
  if (!API_BASE) return null;

  const registration = await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await sendSubscription(existing, deviceId);
    return existing;
  }

  const res = await fetch(`${API_BASE}/api/vapid-public-key`);
  if (!res.ok) return null;
  const { publicKey } = await res.json();

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await sendSubscription(subscription, deviceId);
  return subscription;
}

async function sendSubscription(subscription, deviceId) {
  try {
    await fetch(`${API_BASE}/api/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, deviceId }),
    });
  } catch (e) {
    /* offline / backend unreachable — subscription stays local, will retry next load */
  }
}

export async function syncEventsToBackend(deviceId, events) {
  if (!API_BASE) return;
  try {
    await fetch(`${API_BASE}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, events }),
    });
  } catch (e) {
    /* offline / backend unreachable — reminders will sync on next successful save */
  }
}
