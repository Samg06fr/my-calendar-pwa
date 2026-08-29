import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Plus, X, Pencil, ChevronLeft, ChevronRight, Clock, FileText, Paperclip, Bell, Repeat, Trash2, Check, Smartphone, Copy } from "lucide-react";
import { loadKey, saveKey } from "./db";
import { subscribeToPush } from "./push";
import { ensureAccount, joinAccountByCode, pullAccountData, pushAccountData } from "./sync";

/* ---------------------------------------------------------
   TOKENS
--------------------------------------------------------- */
const T = {
  bg: "#221D19",
  surface: "#2A2420",
  surfaceRaised: "#332B25",
  border: "#453A32",
  borderSoft: "#3A312B",
  text: "#EDE3D8",
  textMuted: "#9C8E80",
  textFaint: "#6E6156",
  accent: "#C9A24B",
  danger: "#B5654A",
};

const PRESET_COLORS = [
  { id: "terracotta", name: "Terracotta", hex: "#C97B5E" },
  { id: "sage", name: "Sage", hex: "#8A9A7B" },
  { id: "mustard", name: "Mustard", hex: "#C9A24B" },
  { id: "dustyrose", name: "Dusty Rose", hex: "#C98B96" },
  { id: "plum", name: "Plum", hex: "#86678A" },
  { id: "teal", name: "Teal", hex: "#5B8A87" },
  { id: "rust", name: "Rust", hex: "#B5754A" },
  { id: "slate", name: "Slate", hex: "#6C7A96" },
];

const REMINDER_OPTIONS = [
  { value: "none", label: "No reminder" },
  { value: "0", label: "At start time" },
  { value: "5", label: "5 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

const RECUR_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const HOUR_HEIGHT = 64;

/* ---------------------------------------------------------
   DATE HELPERS  (dates handled as local YYYY-MM-DD strings)
--------------------------------------------------------- */
function pad(n) { return String(n).padStart(2, "0"); }
function toKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fromKey(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function addMonths(date, n) { const d = new Date(date); d.setMonth(d.getMonth() + n); return d; }
function startOfWeek(date) { const d = new Date(date); d.setDate(d.getDate() - d.getDay()); return d; }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function isSameDay(a, b) { return toKey(a) === toKey(b); }
function timeToMinutes(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function minutesToLabel(mins) {
  let h = Math.floor(mins / 60) % 24; const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM"; let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${pad(m)} ${ampm}`;
}
function formatTimeRange(start, end) { return `${minutesToLabel(timeToMinutes(start))} – ${minutesToLabel(timeToMinutes(end))}`; }
function longDateLabel(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* ---------------------------------------------------------
   DEVICE ID (for associating this browser/install with the
   server-side push subscription + reminder scheduler)
--------------------------------------------------------- */
function getDeviceId() {
  let id = localStorage.getItem("cal:deviceId");
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || uid() + uid();
    localStorage.setItem("cal:deviceId", id);
  }
  return id;
}

/* ---------------------------------------------------------
   RECURRENCE EXPANSION
--------------------------------------------------------- */
function occursOn(event, dateKey) {
  const target = fromKey(dateKey);
  const base = fromKey(event.date);
  if (target < base) return false;
  if (event.recurrence?.type === "none" || !event.recurrence) {
    return event.date === dateKey;
  }
  if (event.recurrence.endDate && dateKey > event.recurrence.endDate) return false;
  switch (event.recurrence.type) {
    case "daily":
      return true;
    case "weekly":
      return target.getDay() === base.getDay();
    case "monthly":
      return target.getDate() === base.getDate();
    case "yearly":
      return target.getDate() === base.getDate() && target.getMonth() === base.getMonth();
    default:
      return false;
  }
}
function eventsForDate(events, dateKey) {
  return events.filter((e) => occursOn(e, dateKey))
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

/* ---------------------------------------------------------
   SWIPE HOOK
--------------------------------------------------------- */
function useSwipe(onLeft, onRight) {
  const startX = useRef(null);
  const startY = useRef(null);
  const onTouchStart = (e) => { startX.current = e.touches[0].clientX; startY.current = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    const dy = e.changedTouches[0].clientY - startY.current;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onLeft(); else onRight();
    }
    startX.current = null; startY.current = null;
  };
  return { onTouchStart, onTouchEnd };
}

/* ---------------------------------------------------------
   TIME SCROLL PICKER
--------------------------------------------------------- */
function ScrollColumn({ items, value, onChange, itemLabel }) {
  const ref = useRef(null);
  const ITEM_H = 36;
  const isProgrammatic = useRef(false);

  useEffect(() => {
    const idx = items.indexOf(value);
    if (ref.current && idx >= 0) {
      isProgrammatic.current = true;
      ref.current.scrollTop = idx * ITEM_H;
      const t = setTimeout(() => { isProgrammatic.current = false; }, 50);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line
  }, []);

  const handleScroll = () => {
    if (!ref.current || isProgrammatic.current) return;
    const idx = Math.round(ref.current.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    if (items[clamped] !== value) onChange(items[clamped]);
  };

  const handleClick = (idx) => {
    if (ref.current) ref.current.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
    onChange(items[idx]);
  };

  return (
    <div style={{ position: "relative", height: ITEM_H * 3, width: 64, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute", top: ITEM_H, left: 0, right: 0, height: ITEM_H,
          background: T.surfaceRaised, borderRadius: 8, pointerEvents: "none", border: `1px solid ${T.border}`,
        }}
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        style={{
          height: "100%", overflowY: "scroll", scrollSnapType: "y mandatory",
          paddingTop: ITEM_H, paddingBottom: ITEM_H, scrollbarWidth: "none",
        }}
        className="no-scrollbar"
      >
        {items.map((it, idx) => (
          <div
            key={it}
            onClick={() => handleClick(idx)}
            style={{
              height: ITEM_H, display: "flex", alignItems: "center", justifyContent: "center",
              scrollSnapAlign: "center", cursor: "pointer",
              color: it === value ? T.text : T.textFaint,
              fontSize: it === value ? 16 : 14,
              fontWeight: it === value ? 600 : 400,
              transition: "color .15s, font-size .15s",
            }}
          >
            {itemLabel ? itemLabel(it) : pad(it)}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimePicker({ label, value, onChange }) {
  const [h, m] = value.split(":").map(Number);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  const [typedMode, setTypedMode] = useState(false);
  const [typedVal, setTypedVal] = useState(value);

  useEffect(() => { setTypedVal(value); }, [value]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: T.textMuted, letterSpacing: 0.3 }}>{label}</span>
        <button
          onClick={() => setTypedMode((v) => !v)}
          style={{ fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {typedMode ? "Scroll" : "Type"}
        </button>
      </div>
      {typedMode ? (
        <input
          type="time"
          value={typedVal}
          onChange={(e) => { setTypedVal(e.target.value); onChange(e.target.value); }}
          style={{
            background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 8,
            color: T.text, padding: "8px 10px", fontSize: 15, width: 150,
          }}
        />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <ScrollColumn items={hours} value={h} onChange={(nh) => onChange(`${pad(nh)}:${pad(m)}`)} />
          <span style={{ color: T.textFaint, fontSize: 18 }}>:</span>
          <ScrollColumn items={minutes} value={m} onChange={(nm) => onChange(`${pad(h)}:${pad(nm)}`)} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   EVENT CARD (agenda-style, Google-Calendar-ish)
--------------------------------------------------------- */
function EventBlock({ event, color, style, onClick, dense }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "absolute",
        left: style.left, width: style.width, top: style.top, height: Math.max(style.height, dense ? 20 : 34),
        background: `${color.hex}26`,
        borderLeft: `3px solid ${color.hex}`,
        borderRadius: 6,
        padding: dense ? "2px 6px" : "4px 8px",
        overflow: "hidden",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
        <span style={{ color: T.text, fontSize: dense ? 11 : 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {event.title || "Untitled"}
        </span>
        {!dense && style.height > 30 && (
          <span style={{ color: T.textMuted, fontSize: 10.5, whiteSpace: "nowrap", flexShrink: 0 }}>
            {minutesToLabel(timeToMinutes(event.startTime))}
          </span>
        )}
      </div>
      {style.height > 44 && event.notes && (
        <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>
          {truncate(event.notes, 40)}
        </div>
      )}
    </div>
  );
}

function truncate(str, max) {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, Math.floor(max - 0.5 * 6)) + " ...";
}

/* ---------------------------------------------------------
   DAY VIEW
--------------------------------------------------------- */
function DayView({ date, events, colors, onEventClick }) {
  const dayEvents = eventsForDate(events, toKey(date));
  const scrollRef = useRef(null);
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, (nowMinutes / 60) * HOUR_HEIGHT - 150);
    }
    // eslint-disable-next-line
  }, [date]);

  // simple overlap layout: assign column index for overlapping events
  const laidOut = useMemo(() => {
    const sorted = [...dayEvents].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    const cols = [];
    return sorted.map((ev) => {
      const s = timeToMinutes(ev.startTime), e = timeToMinutes(ev.endTime);
      let col = 0;
      while (cols[col] !== undefined && cols[col] > s) col++;
      cols[col] = e;
      return { ev, col };
    });
  }, [dayEvents]);
  const maxCol = laidOut.reduce((m, x) => Math.max(m, x.col), 0) + 1;

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
      <div style={{ position: "relative", height: HOUR_HEIGHT * 24 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ position: "absolute", top: h * HOUR_HEIGHT, left: 0, right: 0, height: HOUR_HEIGHT, borderTop: `1px solid ${T.borderSoft}` }}>
            <span style={{ position: "absolute", top: -8, left: 8, fontSize: 11, color: T.textFaint }}>
              {minutesToLabel(h * 60)}
            </span>
          </div>
        ))}
        {isSameDay(date, new Date()) && (
          <div style={{ position: "absolute", top: (nowMinutes / 60) * HOUR_HEIGHT, left: 52, right: 8, height: 2, background: T.accent, zIndex: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, background: T.accent, position: "absolute", left: -4, top: -3 }} />
          </div>
        )}
        {laidOut.map(({ ev, col }) => {
          const s = timeToMinutes(ev.startTime), e = timeToMinutes(ev.endTime);
          const color = colors.find((c) => c.id === ev.colorId) || colors[0];
          const width = `calc((100% - 60px) / ${maxCol} - 4px)`;
          return (
            <EventBlock
              key={ev.instanceKey || ev.id}
              event={ev}
              color={color}
              onClick={() => onEventClick(ev)}
              style={{
                left: `calc(52px + (100% - 60px) / ${maxCol} * ${col})`,
                width,
                top: (s / 60) * HOUR_HEIGHT + 1,
                height: Math.max(((e - s) / 60) * HOUR_HEIGHT - 2, 18),
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   WEEK VIEW
--------------------------------------------------------- */
function WeekView({ date, events, colors, onEventClick, onSelectDay }) {
  const start = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const scrollRef = useRef(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 6 * HOUR_HEIGHT; }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, paddingLeft: 44 }}>
        {days.map((d) => (
          <div
            key={toKey(d)}
            onClick={() => onSelectDay(d)}
            style={{ flex: 1, textAlign: "center", padding: "8px 2px", cursor: "pointer" }}
          >
            <div style={{ fontSize: 10.5, color: T.textMuted }}>{DAY_NAMES[d.getDay()]}</div>
            <div style={{
              fontSize: 14, marginTop: 2, color: isSameDay(d, new Date()) ? T.bg : T.text,
              background: isSameDay(d, new Date()) ? T.accent : "transparent",
              width: 26, height: 26, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto",
              fontWeight: 600,
            }}>
              {d.getDate()}
            </div>
          </div>
        ))}
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        <div style={{ position: "relative", height: HOUR_HEIGHT * 24, display: "flex" }}>
          <div style={{ width: 44, position: "relative" }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ position: "absolute", top: h * HOUR_HEIGHT - 6, right: 4, fontSize: 9.5, color: T.textFaint }}>
                {minutesToLabel(h * 60)}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayEvents = eventsForDate(events, toKey(d));
            return (
              <div key={toKey(d)} style={{ flex: 1, position: "relative", borderLeft: `1px solid ${T.borderSoft}` }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} style={{ position: "absolute", top: h * HOUR_HEIGHT, left: 0, right: 0, borderTop: `1px solid ${T.borderSoft}` }} />
                ))}
                {dayEvents.map((ev) => {
                  const s = timeToMinutes(ev.startTime), e = timeToMinutes(ev.endTime);
                  const color = colors.find((c) => c.id === ev.colorId) || colors[0];
                  return (
                    <EventBlock
                      key={ev.instanceKey || ev.id}
                      event={ev}
                      color={color}
                      dense
                      onClick={() => onEventClick(ev)}
                      style={{ left: 1, width: "calc(100% - 4px)", top: (s / 60) * HOUR_HEIGHT + 1, height: ((e - s) / 60) * HOUR_HEIGHT - 2 }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   MONTH VIEW
--------------------------------------------------------- */
function MonthView({ date, events, colors, onSelectDay }) {
  const start = startOfWeek(startOfMonth(date));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const month = date.getMonth();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={{ flex: 1, textAlign: "center", padding: "8px 0", fontSize: 11, color: T.textMuted }}>{d}</div>
        ))}
      </div>
      <div style={{ flex: 1, display: "grid", gridTemplateRows: "repeat(6, 1fr)", overflow: "hidden" }}>
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} style={{ display: "flex", borderBottom: `1px solid ${T.borderSoft}` }}>
            {cells.slice(row * 7, row * 7 + 7).map((d) => {
              const dayEvents = eventsForDate(events, toKey(d));
              const inMonth = d.getMonth() === month;
              return (
                <div
                  key={toKey(d)}
                  onClick={() => onSelectDay(d)}
                  style={{
                    flex: 1, borderRight: `1px solid ${T.borderSoft}`, padding: 4, cursor: "pointer",
                    opacity: inMonth ? 1 : 0.35, display: "flex", flexDirection: "column", minWidth: 0,
                  }}
                >
                  <div style={{
                    fontSize: 12, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 999, color: isSameDay(d, new Date()) ? T.bg : T.text,
                    background: isSameDay(d, new Date()) ? T.accent : "transparent", fontWeight: 600,
                  }}>
                    {d.getDate()}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 3, overflow: "hidden" }}>
                    {dayEvents.slice(0, 3).map((ev) => {
                      const color = colors.find((c) => c.id === ev.colorId) || colors[0];
                      return (
                        <div key={ev.instanceKey || ev.id} style={{
                          fontSize: 9.5, color: T.text, background: `${color.hex}30`, borderLeft: `2px solid ${color.hex}`,
                          borderRadius: 3, padding: "1px 3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {ev.title || "Untitled"}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div style={{ fontSize: 9, color: T.textFaint }}>+{dayEvents.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   EVENT FORM (add / edit)
--------------------------------------------------------- */
function closestQuarterHour(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  const rounded = Math.round(mins / 15) * 15;
  return `${pad(Math.floor(rounded / 60) % 24)}:${pad(rounded % 60)}`;
}

function EventForm({ initial, colors, onSave, onDelete, onCancel }) {
  const now = new Date();
  const defaultStart = closestQuarterHour(now);
  const defaultEnd = (() => {
    const [h, m] = defaultStart.split(":").map(Number);
    const total = (h * 60 + m + 15) % (24 * 60);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  })();

  const [title, setTitle] = useState(initial?.title || "");
  const [startTime, setStartTime] = useState(initial?.startTime || defaultStart);
  const [endTime, setEndTime] = useState(initial?.endTime || defaultEnd);
  const [dateKey, setDateKey] = useState(initial?.date || toKey(now));
  const [notes, setNotes] = useState(initial?.notes || "");
  const [resources, setResources] = useState(initial?.resources || "");
  const [colorId, setColorId] = useState(initial?.colorId || colors[0].id);
  const [recurType, setRecurType] = useState(initial?.recurrence?.type || "none");
  const [reminder, setReminder] = useState(initial?.reminder ?? "none");
  const [showColorAdd, setShowColorAdd] = useState(false);
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#C97B5E");

  const isEditing = !!initial;

  const handleSubmit = () => {
    if (!title.trim()) { return; }
    const payload = {
      id: initial?.id || uid(),
      title: title.trim(),
      date: dateKey,
      startTime, endTime,
      notes: notes.trim(),
      resources: resources.trim(),
      colorId,
      recurrence: recurType === "none" ? { type: "none" } : { type: recurType, endDate: null },
      reminder,
    };
    onSave(payload, showColorAdd ? { name: newColorName || "Custom", hex: newColorHex } : null);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50,
      overflowY: "auto", WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ minHeight: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{
        background: T.surface, width: "100%", maxWidth: 480,
        borderRadius: "18px 18px 0 0", padding: "18px 18px calc(28px + env(safe-area-inset-bottom))", border: `1px solid ${T.border}`, borderBottom: "none",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ color: T.text, fontSize: 17, fontWeight: 700, fontFamily: "Georgia, serif" }}>
            {isEditing ? "Edit event" : "New event"}
          </span>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} color={T.textMuted} />
          </button>
        </div>

        {/* Title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Event title"
          style={{
            width: "100%", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: "12px 12px", color: T.text, fontSize: 16, marginBottom: 14, boxSizing: "border-box",
          }}
        />

        {/* Date */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>Date</div>
          <input
            type="date"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
            style={{ background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "8px 10px", fontSize: 14 }}
          />
        </div>

        {/* Times */}
        <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
          <TimePicker label="Start" value={startTime} onChange={setStartTime} />
          <TimePicker label="End" value={endTime} onChange={setEndTime} />
        </div>
        <div style={{ fontSize: 12, color: T.textFaint, marginTop: -8, marginBottom: 16 }}>{formatTimeRange(startTime, endTime)}</div>

        {/* Color */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>Color</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {colors.map((c) => (
              <div
                key={c.id}
                onClick={() => setColorId(c.id)}
                title={c.name}
                style={{
                  width: 28, height: 28, borderRadius: 999, background: c.hex, cursor: "pointer",
                  border: colorId === c.id ? `2.5px solid ${T.text}` : `2.5px solid transparent`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {colorId === c.id && <Check size={14} color="#1a1512" />}
              </div>
            ))}
            <div
              onClick={() => setShowColorAdd((v) => !v)}
              style={{
                width: 28, height: 28, borderRadius: 999, border: `1.5px dashed ${T.textFaint}`,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              }}
            >
              <Plus size={14} color={T.textFaint} />
            </div>
          </div>
          {showColorAdd && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              <input type="color" value={newColorHex} onChange={(e) => setNewColorHex(e.target.value)} style={{ width: 34, height: 34, border: "none", background: "none", cursor: "pointer" }} />
              <input
                value={newColorName}
                onChange={(e) => setNewColorName(e.target.value)}
                placeholder="Name this color…"
                style={{ flex: 1, background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 10px", color: T.text, fontSize: 13 }}
              />
            </div>
          )}
        </div>

        {/* Recurrence */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
            <Repeat size={12} /> Repeats
          </div>
          <select
            value={recurType}
            onChange={(e) => setRecurType(e.target.value)}
            style={{ width: "100%", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 10px", color: T.text, fontSize: 14 }}
          >
            {RECUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Reminder */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
            <Bell size={12} /> Reminder
          </div>
          <select
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
            style={{ width: "100%", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 10px", color: T.text, fontSize: 14 }}
          >
            {REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
            <FileText size={12} /> Notes
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Add a note…"
            style={{ width: "100%", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.text, fontSize: 13, resize: "none", boxSizing: "border-box", fontFamily: "inherit" }}
          />
        </div>

        {/* Resources */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
            <Paperclip size={12} /> Resources
          </div>
          <textarea
            value={resources}
            onChange={(e) => setResources(e.target.value)}
            rows={2}
            placeholder="Links, files, references…"
            style={{ width: "100%", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.text, fontSize: 13, resize: "none", boxSizing: "border-box", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          {isEditing && (
            <button
              onClick={() => onDelete(initial.id)}
              style={{ background: "none", border: `1px solid ${T.danger}`, color: T.danger, borderRadius: 10, padding: "11px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            style={{
              flex: 1, background: title.trim() ? T.accent : T.borderSoft, color: title.trim() ? "#241C10" : T.textFaint,
              border: "none", borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 700, cursor: title.trim() ? "pointer" : "default",
            }}
          >
            {isEditing ? "Save changes" : "Add event"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   EVENT DETAIL MODAL
--------------------------------------------------------- */
function EventDetail({ event, color, onEdit, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50, overflowY: "auto", WebkitOverflowScrolling: "touch" }}
    >
      <div style={{ minHeight: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: T.surface, width: "100%", maxWidth: 480, borderRadius: "18px 18px 0 0", padding: "20px 20px calc(20px + env(safe-area-inset-bottom))", border: `1px solid ${T.border}`, borderBottom: "none" }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} color={T.textMuted} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: -8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: color.hex, marginTop: 6, flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: T.text, fontSize: 18, fontWeight: 700, fontFamily: "Georgia, serif" }}>{event.title}</span>
            <span style={{ color: T.textMuted, fontSize: 12.5, whiteSpace: "nowrap" }}>{formatTimeRange(event.startTime, event.endTime)}</span>
          </div>
        </div>
        <div style={{ marginLeft: 20, marginTop: 10 }}>
          <div style={{ color: T.textFaint, fontSize: 12 }}>{longDateLabel(fromKey(event.date))}</div>
          {event.recurrence?.type !== "none" && (
            <div style={{ color: T.textFaint, fontSize: 11.5, display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
              <Repeat size={11} /> {RECUR_OPTIONS.find((o) => o.value === event.recurrence.type)?.label}
            </div>
          )}
          {event.notes && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}><FileText size={11} /> Notes</div>
              <div style={{ color: T.text, fontSize: 13.5, lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>
                {event.notes}
              </div>
            </div>
          )}
          {event.resources && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}><Paperclip size={11} /> Resources</div>
              <div style={{ color: T.text, fontSize: 13.5, lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                {event.resources}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={onEdit}
          style={{
            marginTop: 20, width: "100%", background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.text,
            borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          }}
        >
          <Pencil size={14} /> Edit event
        </button>
      </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   SYNC SHEET (view this device's code / link to another calendar)
--------------------------------------------------------- */
function SyncSheet({ code, onJoin, onClose }) {
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState(null); // null | "joining" | "error" | "copied"

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("copied");
      setTimeout(() => setStatus(null), 1500);
    } catch (e) { /* clipboard unavailable — code is still shown on screen */ }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setStatus("joining");
    try {
      await onJoin(joinCode.trim());
    } catch (e) {
      setStatus("error");
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50, overflowY: "auto", WebkitOverflowScrolling: "touch" }}
    >
      <div style={{ minHeight: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: T.surface, width: "100%", maxWidth: 480, borderRadius: "18px 18px 0 0", padding: "20px 20px calc(20px + env(safe-area-inset-bottom))", border: `1px solid ${T.border}`, borderBottom: "none" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ color: T.text, fontSize: 17, fontWeight: 700, fontFamily: "Georgia, serif" }}>Sync devices</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} color={T.textMuted} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>
          This device's sync code — enter it on another device to share this calendar:
        </div>
        <div
          onClick={handleCopy}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: "pointer",
            background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8,
          }}
        >
          <span style={{ color: T.accent, fontSize: 22, fontWeight: 700, letterSpacing: 3, fontFamily: "Georgia, serif" }}>{code}</span>
          <Copy size={16} color={T.textFaint} />
        </div>
        {status === "copied" && <div style={{ fontSize: 11.5, color: T.accent, marginBottom: 10 }}>Copied to clipboard</div>}

        <div style={{ height: 1, background: T.borderSoft, margin: "18px 0" }} />

        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>
          Have a code from another device? Enter it here to link this one to that calendar:
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={joinCode}
            onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setStatus(null); }}
            placeholder="ABC123"
            maxLength={6}
            style={{
              flex: 1, background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 8,
              padding: "10px 12px", color: T.text, fontSize: 16, letterSpacing: 2, boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleJoin}
            disabled={!joinCode.trim() || status === "joining"}
            style={{
              background: T.accent, color: "#241C10", border: "none", borderRadius: 8,
              padding: "0 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            Link
          </button>
        </div>
        {status === "error" && (
          <div style={{ fontSize: 11.5, color: T.danger, marginTop: 8 }}>
            Couldn't find a calendar with that code. Double-check it and try again.
          </div>
        )}
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 12 }}>
          Linking replaces this device's events with the other calendar's.
        </div>
      </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   MAIN APP
--------------------------------------------------------- */
export default function CalendarApp() {
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState([]);
  const [colors, setColors] = useState(PRESET_COLORS);
  const [view, setView] = useState("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [detailEvent, setDetailEvent] = useState(null);
  const [firedReminders, setFiredReminders] = useState({});
  const [notifPermission, setNotifPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [account, setAccount] = useState(null); // { accountId, code }
  const [showSyncSheet, setShowSyncSheet] = useState(false);
  const deviceIdRef = useRef(typeof window !== "undefined" ? getDeviceId() : null);
  const skipNextPushRef = useRef(false); // true right after we've just written data *from* a pull

  // Load persisted local state, then link/create a sync account and
  // reconcile with whatever's on the backend (see reconcileWithBackend).
  useEffect(() => {
    (async () => {
      const [ev, cl] = await Promise.all([
        loadKey("cal:events", []),
        loadKey("cal:colors", PRESET_COLORS),
      ]);
      setEvents(ev);
      setColors(cl && cl.length ? cl : PRESET_COLORS);
      setLoaded(true);

      const acct = await ensureAccount();
      if (!acct) return; // offline or no backend configured — stays local-only for now
      setAccount(acct);

      const remote = await pullAccountData(acct.accountId);
      if (remote && (remote.events.length > 0 || remote.colors.length > 0)) {
        // Backend already has data for this account (e.g. synced from
        // another device, or a previous session) — it wins.
        skipNextPushRef.current = true;
        setEvents(remote.events);
        setColors(remote.colors.length ? remote.colors : PRESET_COLORS);
      } else if (ev.length > 0 || cl.length > 0) {
        // Fresh account but this device already has local events — seed
        // the backend with what's here.
        pushAccountData(acct.accountId, deviceIdRef.current, ev, cl.length ? cl : PRESET_COLORS);
      }
    })();
  }, []);

  useEffect(() => { if (loaded) saveKey("cal:events", events); }, [events, loaded]);
  useEffect(() => { if (loaded) saveKey("cal:colors", colors); }, [colors, loaded]);

  // Push subscription is already active if permission was previously granted
  // (e.g. re-opening the installed PWA) — re-subscribe silently so the
  // backend has a fresh subscription + the deviceId is registered.
  useEffect(() => {
    if (loaded && notifPermission === "granted" && account) {
      subscribeToPush(deviceIdRef.current, account.accountId);
    }
  }, [loaded, notifPermission, account]);

  // Two-way sync: push this device's events/colors to the backend whenever
  // they change, so both the reminder scheduler and any other linked
  // device see the update. Skipped once right after a pull just wrote
  // these same values in, to avoid an immediate redundant round-trip.
  useEffect(() => {
    if (!loaded || !account) return;
    if (skipNextPushRef.current) { skipNextPushRef.current = false; return; }
    pushAccountData(account.accountId, deviceIdRef.current, events, colors).then((code) => {
      // The backend self-heals a stale accountId (e.g. after a database
      // reset) by re-creating it with a fresh code — reflect that in the
      // Sync sheet so the code shown always actually resolves.
      if (code && code !== account.code) setAccount((prev) => (prev ? { ...prev, code } : prev));
    });
  }, [events, colors, loaded, account]);

  // Re-pull whenever the app regains focus (e.g. switching back from
  // another app, or waking the laptop) so changes made on another linked
  // device show up here without needing a full reload.
  useEffect(() => {
    if (!account) return;
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const remote = await pullAccountData(account.accountId);
      if (remote) {
        skipNextPushRef.current = true;
        setEvents(remote.events);
        setColors(remote.colors.length ? remote.colors : PRESET_COLORS);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [account]);

  const handleJoinAccount = async (code) => {
    const acct = await joinAccountByCode(code);
    const remote = await pullAccountData(acct.accountId);
    skipNextPushRef.current = true;
    setEvents(remote?.events || []);
    setColors(remote?.colors?.length ? remote.colors : PRESET_COLORS);
    setAccount(acct);
    setShowSyncSheet(false);
    if (notifPermission === "granted") {
      subscribeToPush(deviceIdRef.current, acct.accountId);
    }
  };

  // Reminder polling (works while app is open in a tab) — this is a
  // foreground-only fallback; background/closed-app reminders are handled
  // by the server-side Web Push scheduler instead.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const now = new Date();
      const todayKey = toKey(now);
      const yesterdayKey = toKey(addDays(now, -1));
      [todayKey, yesterdayKey].forEach((dk) => {
        eventsForDate(events, dk).forEach((ev) => {
          if (!ev.reminder || ev.reminder === "none") return;
          const eventStart = new Date(fromKey(ev.date));
          const [h, m] = ev.startTime.split(":").map(Number);
          eventStart.setHours(h, m, 0, 0);
          const fireAt = new Date(eventStart.getTime() - Number(ev.reminder) * 60000);
          const key = `${ev.id}_${dk}`;
          if (now >= fireAt && now < eventStart && !firedReminders[key]) {
            new Notification(ev.title, { body: `${formatTimeRange(ev.startTime, ev.endTime)}${ev.notes ? " — " + truncate(ev.notes, 60) : ""}` });
            setFiredReminders((prev) => ({ ...prev, [key]: true }));
          }
        });
      });
    }, 20000);
    return () => clearInterval(interval);
  }, [events, firedReminders]);

  const requestNotifications = () => {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission().then((perm) => {
      setNotifPermission(perm);
      if (perm === "granted" && account) {
        subscribeToPush(deviceIdRef.current, account.accountId);
      }
    });
  };

  const goPrev = useCallback(() => {
    setCurrentDate((d) => view === "day" ? addDays(d, -1) : view === "week" ? addDays(d, -7) : addMonths(d, -1));
  }, [view]);
  const goNext = useCallback(() => {
    setCurrentDate((d) => view === "day" ? addDays(d, 1) : view === "week" ? addDays(d, 7) : addMonths(d, 1));
  }, [view]);
  const swipeHandlers = useSwipe(goNext, goPrev);

  const handleSave = (payload, newColor) => {
    let colorId = payload.colorId;
    if (newColor) {
      const id = "custom_" + uid();
      setColors((prev) => [...prev, { id, name: newColor.name, hex: newColor.hex }]);
      colorId = id;
    }
    const finalPayload = { ...payload, colorId };
    setEvents((prev) => {
      const exists = prev.some((e) => e.id === finalPayload.id);
      return exists ? prev.map((e) => (e.id === finalPayload.id ? finalPayload : e)) : [...prev, finalPayload];
    });
    setShowForm(false);
    setEditingEvent(null);
    setDetailEvent(null);
  };

  const handleDelete = (id) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setShowForm(false);
    setEditingEvent(null);
    setDetailEvent(null);
  };

  const headerLabel = useMemo(() => {
    if (view === "day") return longDateLabel(currentDate);
    if (view === "week") {
      const s = startOfWeek(currentDate), e = addDays(s, 6);
      const sameMonth = s.getMonth() === e.getMonth();
      return sameMonth
        ? `${MONTH_NAMES[s.getMonth()]} ${s.getDate()}–${e.getDate()}`
        : `${MONTH_NAMES[s.getMonth()].slice(0,3)} ${s.getDate()} – ${MONTH_NAMES[e.getMonth()].slice(0,3)} ${e.getDate()}`;
    }
    return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  }, [view, currentDate]);

  if (!loaded) {
    return (
      <div style={{ height: "100%", minHeight: 640, background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: T.textMuted, fontSize: 14 }}>Loading your calendar…</span>
      </div>
    );
  }

  return (
    <div style={{
      height: "100%", minHeight: 640, background: T.bg, display: "flex", flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", position: "relative", overflow: "hidden",
      paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)",
    }}>
      <style>{`.no-scrollbar::-webkit-scrollbar{display:none} input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.7)} input[type="time"]::-webkit-calendar-picker-indicator{filter:invert(0.7)}`}</style>

      {/* Header — top padding accounts for the iOS status bar / notch when
          running as an installed standalone app (env(safe-area-inset-top)
          is 0 in a normal browser tab, so this is a no-op there). */}
      <div style={{ padding: "16px 16px 10px", paddingTop: "max(16px, env(safe-area-inset-top))", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={goPrev} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
              <ChevronLeft size={18} color={T.textMuted} />
            </button>
            <span style={{ color: T.text, fontSize: 17, fontWeight: 700, fontFamily: "Georgia, serif", minWidth: 150, textAlign: "center" }}>
              {headerLabel}
            </span>
            <button onClick={goNext} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
              <ChevronRight size={18} color={T.textMuted} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setShowSyncSheet(true)} title="Sync devices" style={{ background: "none", border: "none", cursor: "pointer" }}>
              <Smartphone size={16} color={T.textFaint} />
            </button>
            {notifPermission !== "granted" && notifPermission !== "unsupported" && (
              <button onClick={requestNotifications} title="Enable reminders" style={{ background: "none", border: "none", cursor: "pointer" }}>
                <Bell size={16} color={T.textFaint} />
              </button>
            )}
            <button
              onClick={() => setCurrentDate(new Date())}
              style={{ fontSize: 11.5, color: T.accent, background: "none", border: `1px solid ${T.border}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer" }}
            >
              Today
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          {["day", "week", "month"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                flex: 1, textTransform: "capitalize", fontSize: 12.5, fontWeight: 600,
                padding: "6px 0", borderRadius: 8, border: `1px solid ${view === v ? T.accent : T.border}`,
                background: view === v ? `${T.accent}20` : "transparent",
                color: view === v ? T.accent : T.textMuted, cursor: "pointer",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div {...swipeHandlers} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {view === "day" && <DayView date={currentDate} events={events} colors={colors} onEventClick={setDetailEvent} />}
        {view === "week" && <WeekView date={currentDate} events={events} colors={colors} onEventClick={setDetailEvent} onSelectDay={(d) => { setCurrentDate(d); setView("day"); }} />}
        {view === "month" && <MonthView date={currentDate} events={events} colors={colors} onSelectDay={(d) => { setCurrentDate(d); setView("day"); }} />}
      </div>

      {/* Add button — capped ~1/12th of screen */}
      <button
        onClick={() => { setEditingEvent(null); setShowForm(true); }}
        aria-label="Add event"
        style={{
          position: "fixed", right: "calc(18px + env(safe-area-inset-right))", bottom: "calc(22px + env(safe-area-inset-bottom))",
          width: "clamp(46px, 8vw, 60px)", height: "clamp(46px, 8vw, 60px)",
          borderRadius: 999, background: T.accent, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 6px 18px rgba(0,0,0,0.4)", zIndex: 20,
        }}
      >
        <Plus size={24} color="#241C10" />
      </button>

      {/* Modals */}
      {showForm && (
        <EventForm
          initial={editingEvent}
          colors={colors}
          onCancel={() => { setShowForm(false); setEditingEvent(null); }}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
      {detailEvent && !showForm && (
        <EventDetail
          event={detailEvent}
          color={colors.find((c) => c.id === detailEvent.colorId) || colors[0]}
          onEdit={() => { setEditingEvent(detailEvent); setShowForm(true); }}
          onClose={() => setDetailEvent(null)}
        />
      )}
      {showSyncSheet && account && (
        <SyncSheet
          code={account.code}
          onJoin={handleJoinAccount}
          onClose={() => setShowSyncSheet(false)}
        />
      )}
    </div>
  );
}
