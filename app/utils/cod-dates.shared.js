/**
 * Date ranges for the COD dashboard (app.cod.jsx), counted in the shop's time
 * zone: "Today" is the shop's today, wherever the merchant opens the admin.
 * Pure, no imports: used by the loader, the page and the tests.
 *
 * A range is two calendar days, from and to (YYYY-MM-DD, both included).
 * resolveCodRange() turns the page URL (?range=last7, or ?from=…&to=…) into
 * one, with the UTC instants it starts and ends at (startMs, endMs: the
 * start of the day after `to`).
 */

export const COD_RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
];
export const COD_RANGE_DEFAULT = 'last30';
export const COD_RANGE_MAX_DAYS = 366;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

function zoneParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/** A time zone Intl knows, else 'UTC'. */
export function safeTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** The calendar day ('YYYY-MM-DD') an instant falls on in `timeZone`. */
export function localDate(date, timeZone) {
  const p = zoneParts(new Date(date), safeTimeZone(timeZone));
  return ymdOf(p.y, p.m, p.d);
}

/** The hour (0-23) an instant falls in, in `timeZone`. */
export function localHour(date, timeZone) {
  return zoneParts(new Date(date), safeTimeZone(timeZone)).h;
}

const utcOf = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const ymdFromUtc = (t) => { const d = new Date(t); return ymdOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };

/** A real calendar day written YYYY-MM-DD (not 2026-02-30). */
export function isYmd(value) {
  return YMD_RE.test(String(value || '')) && ymdFromUtc(utcOf(value)) === value;
}

/** `ymd` moved by `n` calendar days. */
export function addDays(ymd, n) {
  return ymdFromUtc(utcOf(ymd) + n * DAY_MS);
}

/** Calendar days from `from` to `to`, both included. */
export function dayCount(from, to) {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS) + 1;
}

/** The UTC instant (ms) the calendar day `ymd` starts at in `timeZone` (handles DST shifts). */
export function startOfDayMs(ymd, timeZone) {
  const tz = safeTimeZone(timeZone);
  const guess = utcOf(ymd);
  const offset = (t) => {
    const p = zoneParts(new Date(t), tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
  };
  const first = guess - offset(guess);
  const second = guess - offset(first);
  return second;
}

/** "18 Oct – 24 Oct 2026", "24 Oct 2026" (a single day). */
export function rangeText(from, to) {
  const f = (ymd, withYear) => new Date(utcOf(ymd)).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  if (from === to) return f(to, true);
  return `${f(from, from.slice(0, 4) !== to.slice(0, 4))} – ${f(to, true)}`;
}

/**
 * The range a request asks for: { range: preset id } or { from, to }. Bad or
 * missing values give the default (last 30 days); a custom range is clamped
 * to end today and span at most COD_RANGE_MAX_DAYS.
 * → { preset ('custom' for picked days), label, from, to, days, startMs, endMs, today }
 */
export function resolveCodRange({ range, from, to } = {}, { now = new Date(), timeZone = 'UTC' } = {}) {
  const tz = safeTimeZone(timeZone);
  const today = localDate(now, tz);
  let preset = COD_RANGE_PRESETS.some((p) => p.id === range) ? range : null;
  let start;
  let end;
  if (!preset && isYmd(from) && isYmd(to)) {
    start = from <= to ? from : to;
    end = from <= to ? to : from;
    if (end > today) end = today;
    if (start > end) start = end;
    if (dayCount(start, end) > COD_RANGE_MAX_DAYS) start = addDays(end, -(COD_RANGE_MAX_DAYS - 1));
    preset = 'custom';
  } else {
    if (!preset) preset = COD_RANGE_DEFAULT;
    const [y, m] = today.split('-').map(Number);
    end = today;
    if (preset === 'today') start = today;
    else if (preset === 'yesterday') { start = addDays(today, -1); end = start; }
    else if (preset === 'last7') start = addDays(today, -6);
    else if (preset === 'last30') start = addDays(today, -29);
    else if (preset === 'last90') start = addDays(today, -89);
    else if (preset === 'thisMonth') start = ymdOf(y, m, 1);
    else if (preset === 'lastMonth') {
      start = m === 1 ? ymdOf(y - 1, 12, 1) : ymdOf(y, m - 1, 1);
      end = addDays(ymdOf(y, m, 1), -1);
    }
  }
  const label = preset === 'custom' ? rangeText(start, end) : COD_RANGE_PRESETS.find((p) => p.id === preset).label;
  return {
    preset, label, from: start, to: end, today, days: dayCount(start, end),
    startMs: startOfDayMs(start, tz), endMs: startOfDayMs(addDays(end, 1), tz),
  };
}

/** Every calendar day of the range, oldest first. */
export function rangeDays(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length <= COD_RANGE_MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}
