// Mirrors the date/recurrence helpers in frontend/src/App.jsx so the
// scheduler fires reminders using the exact same "does this event occur on
// this date" logic as the client. All dates are handled as UTC-getter based
// Date objects representing a device's local wall-clock time (see
// scheduler.js for how the device's real UTC "now" is shifted into this
// space using tz_offset_minutes).

function pad(n) {
  return String(n).padStart(2, "0");
}

export function toKey(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDaysUTC(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function occursOn(event, dateKey) {
  const target = fromKey(dateKey);
  const base = fromKey(event.date);
  if (target < base) return false;
  const recurType = event.recurrence_type || "none";
  if (recurType === "none") {
    return event.date === dateKey;
  }
  if (event.recurrence_end_date && dateKey > event.recurrence_end_date) return false;
  switch (recurType) {
    case "daily":
      return true;
    case "weekly":
      return target.getUTCDay() === base.getUTCDay();
    case "monthly":
      return target.getUTCDate() === base.getUTCDate();
    case "yearly":
      return target.getUTCDate() === base.getUTCDate() && target.getUTCMonth() === base.getUTCMonth();
    default:
      return false;
  }
}
