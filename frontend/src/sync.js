const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const ACCOUNT_ID_KEY = "cal:accountId";
const SYNC_CODE_KEY = "cal:syncCode";

export function getLocalAccount() {
  const accountId = localStorage.getItem(ACCOUNT_ID_KEY);
  const code = localStorage.getItem(SYNC_CODE_KEY);
  if (!accountId || !code) return null;
  return { accountId, code };
}

function saveLocalAccount(accountId, code) {
  localStorage.setItem(ACCOUNT_ID_KEY, accountId);
  localStorage.setItem(SYNC_CODE_KEY, code);
}

// If the backend had to self-heal this accountId (e.g. its accounts-table
// row was lost to a database reset and got recreated under the same id),
// it comes back with a fresh code. Keep localStorage in sync so the Sync
// sheet always shows a code that actually resolves.
export function reconcileCode(accountId, code) {
  if (code && code !== localStorage.getItem(SYNC_CODE_KEY)) {
    saveLocalAccount(accountId, code);
  }
}

// Ensures this device has a sync account. If one isn't linked locally yet,
// silently creates a fresh (empty) one on the backend so multi-device sync
// works with zero required setup — the user only has to do something if
// they want to link a *second* device to the same calendar.
export async function ensureAccount() {
  const existing = getLocalAccount();
  if (existing) return existing;
  if (!API_BASE) return null;

  const res = await fetch(`${API_BASE}/api/account`, { method: "POST" });
  if (!res.ok) return null;
  const { accountId, code } = await res.json();
  saveLocalAccount(accountId, code);
  return { accountId, code };
}

// Links this device to an existing calendar via a code typed in from
// another device. Returns the linked account, or throws if the code is
// invalid/unreachable.
export async function joinAccountByCode(code) {
  if (!API_BASE) throw new Error("No backend configured");
  const res = await fetch(`${API_BASE}/api/account/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Could not find a calendar with that code");
  }
  const { accountId, code: normalizedCode } = await res.json();
  saveLocalAccount(accountId, normalizedCode);
  return { accountId, code: normalizedCode };
}

export async function pullAccountData(accountId) {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/account/${accountId}/data`);
    if (!res.ok) return null;
    return await res.json(); // { events, colors }
  } catch (e) {
    return null; // offline — caller falls back to local data
  }
}

// Returns the account's current code (which may differ from what was
// passed in, if the backend had to self-heal a stale accountId), or null
// if the push failed (offline / backend unreachable).
export async function pushAccountData(accountId, deviceId, events, colors) {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        deviceId,
        tzOffsetMinutes: new Date().getTimezoneOffset(),
        events,
        colors,
      }),
    });
    if (!res.ok) return null;
    const { code } = await res.json();
    reconcileCode(accountId, code);
    return code;
  } catch (e) {
    return null; // offline — will push again next time events change or app reloads
  }
}
