/**
 * BRIX dynamic shipping for Cash on Delivery orders: one copy of the rules,
 * used by the server (cod.server.js prices every COD quote and order with
 * it), the admin (COD → Customize → Shipping: live preview and test
 * calculator) and the tests. Pure: no DB, no network; time comes from ctx.now.
 *
 * Used only while the COD settings say shippingMode: 'advanced'. Otherwise COD
 * charges the flat shippingFee / freeShippingAbove as before (cod.shared.js
 * codCharges). The config is stored on its own (php_backend/cod_shipping.php):
 * PIN code lists don't fit the COD settings blob.
 *
 * How a delivery option is priced (quoteShipping):
 *   1. "Don't deliver to" areas and "Don't deliver" rules block the order.
 *   2. Each option must be offered there (its zones), fit its order value and
 *      weight limits and its cut-off time, and not be hidden by a rule.
 *   3. Price = the first matching price rule (or the cheapest / dearest, by
 *      `priority`), else the option's price for the address's zone, else its
 *      own price. Free from `freeAbove`, or when every item ships free.
 *   4. Shipping discount rules take their % off (they add up, max 100%).
 *   5. Extra charges (handling, remote area, fragile, oversized, packages) are
 *      added; on a free-shipping order only those marked alsoWhenFree.
 * Rates use the items that ship and aren't "ship free" products (their value,
 * count and weight); order-value conditions use the whole order after discounts.
 */

export const SHIP_LIMITS = Object.freeze({
  methods: 8, zones: 20, rules: 50, charges: 20, tiers: 20, zoneRates: 20,
  states: 40, cities: 300, pins: 3000, pinsTotal: 10000, products: 50, collections: 25, tags: 20,
  holidays: 60, slots: 8, dates: 14, amount: 10_000_000, grams: 10_000_000,
});

export const METHOD_KINDS = ['standard', 'express', 'same_day', 'next_day', 'scheduled'];
export const RATE_TYPES = ['flat', 'free', 'per_item', 'weight', 'tiers', 'percent'];
export const TIER_MEASURES = ['value', 'quantity', 'weight'];
export const RULE_ACTIONS = ['rate', 'free', 'discount', 'hide', 'block'];
export const CHARGE_KINDS = ['handling', 'remote', 'fragile', 'oversized', 'packages', 'custom'];
export const CHARGE_PER = ['order', 'item', 'unit', 'package'];
export const PRIORITY_MODES = ['first', 'lowest', 'highest'];

export const INDIAN_STATES = Object.freeze([
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]);

// Ready-made zones the admin can start from (the merchant can edit them).
export const ZONE_PRESETS = Object.freeze({
  metro: { name: 'Metro cities', cities: ['Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad'], states: [], pins: [] },
  remote: {
    name: 'Remote areas', cities: [], pins: [],
    states: ['Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Tripura', 'Jammu and Kashmir', 'Ladakh', 'Andaman and Nicobar Islands', 'Lakshadweep'],
  },
  local: { name: 'Local', cities: [], states: [], pins: [] },
});

// Old and new names of the same city, so a "Bangalore" address finds "Bengaluru".
const CITY_ALIASES = {
  bangalore: 'bengaluru', bombay: 'mumbai', calcutta: 'kolkata', madras: 'chennai', gurgaon: 'gurugram',
  pondicherry: 'puducherry', trivandrum: 'thiruvananthapuram', cochin: 'kochi', mysore: 'mysuru', baroda: 'vadodara',
  allahabad: 'prayagraj', 'new delhi': 'delhi', poona: 'pune', mangalore: 'mangaluru', belgaum: 'belagavi',
};

/* ───────────────────────── defaults ───────────────────────── */

export const METHOD_PRESETS = Object.freeze({
  standard: { name: 'Standard delivery', description: '', rate: { type: 'flat', amount: 0 }, days: { min: 3, max: 5 } },
  // Shoppers see the description next to the delivery date ("Arrives today"), so most presets need none.
  express: { name: 'Express delivery', description: '', rate: { type: 'flat', amount: 99 }, days: { min: 1, max: 2 } },
  same_day: { name: 'Same-day delivery', description: '', rate: { type: 'flat', amount: 149 }, days: { min: 0, max: 0 }, cutoff: '12:00' },
  next_day: { name: 'Next-day delivery', description: '', rate: { type: 'flat', amount: 99 }, days: { min: 1, max: 1 }, cutoff: '16:00' },
  scheduled: {
    name: 'Scheduled delivery', description: 'Pick a day and time', rate: { type: 'flat', amount: 49 }, days: { min: 1, max: 1 },
    schedule: { firstDay: 1, lastDay: 7, slots: ['10:00-13:00', '13:00-17:00', '17:00-21:00'] },
  },
});

export const DEFAULT_DELIVERY = Object.freeze({
  processingDays: 1, // working days to pack before dispatch (0 = same day)
  workDays: [1, 2, 3, 4, 5, 6], // 0 = Sunday … 6 = Saturday; dispatch and delivery days
  holidays: [], // 'YYYY-MM-DD'
  cutoff: '14:00', // orders after this start the next working day
  timezone: 'Asia/Kolkata',
  showEta: true,
});

export function newMethod(kind = 'standard', id = null) {
  const p = METHOD_PRESETS[kind] || METHOD_PRESETS.standard;
  return {
    id: id || (kind === 'standard' ? 'standard' : `${kind}-${randomId()}`),
    kind: METHOD_KINDS.includes(kind) ? kind : 'standard',
    enabled: true,
    name: p.name,
    description: p.description || '',
    rate: { ...p.rate },
    zoneRates: [],
    freeAbove: 0,
    zones: [],
    minOrder: 0,
    maxOrder: 0,
    maxGrams: 0,
    days: { ...p.days },
    zoneDays: [],
    cutoff: p.cutoff || '',
    schedule: p.schedule ? { ...p.schedule, slots: [...p.schedule.slots] } : null,
  };
}

/** A fresh default config (one Standard option, free, no zones or rules). */
export function defaultShipping() {
  return {
    version: 1,
    methods: [newMethod('standard')],
    zones: [],
    rules: [],
    charges: [],
    priority: 'first',
    blocked: { zones: [], states: [], cities: [], pins: [], message: '' },
    freeItems: { products: [], collections: [], tags: [] },
    delivery: { ...DEFAULT_DELIVERY, workDays: [...DEFAULT_DELIVERY.workDays], holidays: [] },
  };
}

/** The advanced config that charges what the simple settings charge (the starting point when a store switches). */
export function shippingFromSimple(settings = {}) {
  const fee = Number(settings.shippingFee) || 0;
  const config = defaultShipping();
  const standard = config.methods[0];
  standard.rate = fee > 0 ? { type: 'flat', amount: fee } : { type: 'free' };
  standard.freeAbove = fee > 0 ? Number(settings.freeShippingAbove) || 0 : 0;
  return config;
}

export function randomId() {
  return Math.random().toString(36).slice(2, 8);
}

/* ───────────────────────── small parsers ───────────────────────── */

const ID_RE = /^[a-z0-9_-]{1,40}$/i;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLOT_RE = /^(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/;
const TAG_RE = /^[\w\- .:/&]{1,40}$/;
const CITY_RE = /^[\p{L}\p{M} .'()-]{2,60}$/u;
const GID = {
  product: /^gid:\/\/shopify\/Product\/\d{1,20}$/,
  collection: /^gid:\/\/shopify\/Collection\/\d{1,20}$/,
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function num(value, fallback, min, max) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
const money = (value, fallback = 0) => round2(num(value, fallback, 0, SHIP_LIMITS.amount));
const grams = (value, fallback = 0) => Math.round(num(value, fallback, 0, SHIP_LIMITS.grams));
const int = (value, fallback, min, max) => Math.trunc(num(value, fallback, min, max));
const text = (value, max, fallback = '') => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : fallback);
const list = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : []);
const ident = (value, fallback) => (ID_RE.test(String(value ?? '')) ? String(value) : fallback);

export function normState(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normCity(value) {
  const key = String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  return CITY_ALIASES[key] || key;
}

const STATE_BY_KEY = new Map(INDIAN_STATES.map((s) => [normState(s), s]));

/** A known Indian state's own name ("tamil nadu" → "Tamil Nadu"), else null. */
export function canonicalState(value) {
  return STATE_BY_KEY.get(normState(value)) || null;
}

/**
 * One PIN code entry, normalised: '560001' (exact), '560001-560099' (range,
 * ends included) or '560*' (every PIN code starting 560; 1–5 digits). null if
 * it isn't one.
 */
export function parsePinEntry(raw) {
  const s = String(raw ?? '').trim().replace(/\s*(?:-|–|—|to)\s*/gi, '-').replace(/\s+/g, '');
  if (/^[1-9]\d{5}$/.test(s)) return s;
  let m = /^([1-9]\d{5})-([1-9]\d{5})$/.exec(s);
  if (m) {
    const [a, b] = [m[1], m[2]].sort();
    return a === b ? a : `${a}-${b}`;
  }
  m = /^([1-9]\d{0,4})\*?$/.exec(s);
  if (m) return `${m[1]}*`;
  return null;
}

/** Text the merchant pasted → its entries (as typed) for the editor. Ranges may have spaces around the dash. */
export function splitPinText(textValue) {
  return String(textValue || '')
    .replace(/\s*(?:–|—|-)\s*/g, '-')
    .replace(/\s+to\s+/gi, '-')
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** { pins: normalised unique entries, bad: entries that aren't PIN codes }. */
export function parsePinList(value) {
  const pins = [];
  const bad = [];
  const seen = new Set();
  for (const raw of list(value).flatMap((v) => splitPinText(v))) {
    const pin = parsePinEntry(raw);
    if (!pin) { bad.push(raw); continue; }
    if (!seen.has(pin)) { seen.add(pin); pins.push(pin); }
  }
  return { pins, bad };
}

export function pinMatches(entry, pin) {
  if (!pin) return false;
  if (entry.endsWith('*')) return pin.startsWith(entry.slice(0, -1));
  const dash = entry.indexOf('-');
  if (dash > 0) return pin >= entry.slice(0, dash) && pin <= entry.slice(dash + 1);
  return entry === pin;
}

function parseStates(value) {
  return [...new Set(list(value).map(canonicalState).filter(Boolean))].slice(0, SHIP_LIMITS.states);
}

function parseCities(value) {
  const seen = new Set();
  const out = [];
  for (const raw of list(value)) {
    const c = text(String(raw ?? ''), 60);
    if (!CITY_RE.test(c) || seen.has(normCity(c))) continue;
    seen.add(normCity(c));
    out.push(c);
  }
  return out.slice(0, SHIP_LIMITS.cities);
}

export function parseShipTags(value) {
  const seen = new Set();
  return list(value).map((t) => String(t ?? '').trim()).filter((t) => TAG_RE.test(t) && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, SHIP_LIMITS.tags);
}

function parseRefs(value, kind, max) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((r) => (typeof r === 'string' ? { id: r, title: '' } : { id: String(r?.id ?? ''), title: text(r?.title, 120) }))
    .filter((r) => GID[kind].test(r.id) && !seen.has(r.id) && seen.add(r.id))
    .slice(0, max);
}

/* ───────────────────────── sanitizer ───────────────────────── */

export function sanitizeRate(raw, fallback = { type: 'flat', amount: 0 }) {
  const r = raw && typeof raw === 'object' ? raw : fallback;
  const type = RATE_TYPES.includes(r.type) ? r.type : fallback.type;
  if (type === 'free') return { type };
  if (type === 'flat') return { type, amount: money(r.amount) };
  if (type === 'per_item') return { type, amount: money(r.amount), first: money(r.first) };
  if (type === 'weight') {
    return { type, base: money(r.base), baseGrams: grams(r.baseGrams, 500), step: money(r.step), stepGrams: Math.max(1, grams(r.stepGrams, 500)) };
  }
  if (type === 'percent') {
    return { type, percent: round2(num(r.percent, 0, 0, 100)), min: money(r.min), max: money(r.max) };
  }
  // tiers: sorted by `from`, unique, the first always from 0.
  const by = TIER_MEASURES.includes(r.by) ? r.by : 'value';
  const seen = new Set();
  const tiers = (Array.isArray(r.tiers) ? r.tiers : [])
    .map((t) => ({ from: by === 'value' ? money(t?.from) : by === 'quantity' ? int(t?.from, 0, 0, 100000) : grams(t?.from), amount: money(t?.amount) }))
    .sort((a, b) => a.from - b.from)
    .filter((t) => !seen.has(t.from) && seen.add(t.from))
    .slice(0, SHIP_LIMITS.tiers);
  if (!tiers.length) tiers.push({ from: 0, amount: 0 });
  tiers[0].from = 0;
  return { type, by, tiers };
}

// `budget` ({ left }): PIN code entries still allowed in the whole config (SHIP_LIMITS.pinsTotal).
function sanitizePlace(raw, budget = null) {
  const p = raw && typeof raw === 'object' ? raw : {};
  let pins = parsePinList(p.pins).pins.slice(0, SHIP_LIMITS.pins);
  if (budget) {
    pins = pins.slice(0, Math.max(0, budget.left));
    budget.left -= pins.length;
  }
  return { states: parseStates(p.states), cities: parseCities(p.cities), pins };
}

function sanitizeWhen(raw, zoneIds, methodIds, budget) {
  const w = raw && typeof raw === 'object' ? raw : {};
  const ids = (value, allowed) => [...new Set(list(value).map(String).filter((id) => allowed.has(id)))];
  return {
    zones: ids(w.zones, zoneIds),
    ...sanitizePlace(w, budget),
    methods: ids(w.methods, methodIds),
    minValue: money(w.minValue),
    maxValue: money(w.maxValue),
    minQty: int(w.minQty, 0, 0, 100000),
    maxQty: int(w.maxQty, 0, 0, 100000),
    minGrams: grams(w.minGrams),
    maxGrams: grams(w.maxGrams),
    products: parseRefs(w.products, 'product', SHIP_LIMITS.products),
    collections: parseRefs(w.collections, 'collection', SHIP_LIMITS.collections),
    tags: parseShipTags(w.tags),
    itemMatch: w.itemMatch === 'all' ? 'all' : 'any',
  };
}

function sanitizeMethod(raw, i, zoneIds) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const kind = METHOD_KINDS.includes(m.kind) ? m.kind : 'standard';
  const p = METHOD_PRESETS[kind];
  const zoneRows = (rows, mapRow) => {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => zoneIds.has(String(r?.zone)) && !seen.has(String(r.zone)) && seen.add(String(r.zone)))
      .slice(0, SHIP_LIMITS.zoneRates)
      .map(mapRow);
  };
  const days = m.days && typeof m.days === 'object' ? m.days : p.days;
  const dMin = int(days.min, p.days.min, 0, 60);
  const sched = kind === 'scheduled' ? (m.schedule && typeof m.schedule === 'object' ? m.schedule : p.schedule) : null;
  const first = sched ? int(sched.firstDay, 1, 1, 30) : 0;
  return {
    id: ident(m.id, i === 0 ? 'standard' : `${kind}-${i}`),
    kind,
    enabled: m.enabled !== false,
    name: text(m.name, 60) || p.name,
    description: text(m.description, 120),
    rate: sanitizeRate(m.rate, p.rate),
    zoneRates: zoneRows(m.zoneRates, (r) => ({ zone: String(r.zone), rate: sanitizeRate(r.rate, p.rate) })),
    freeAbove: money(m.freeAbove),
    zones: [...new Set(list(m.zones).map(String).filter((id) => zoneIds.has(id)))],
    minOrder: money(m.minOrder),
    maxOrder: money(m.maxOrder),
    maxGrams: grams(m.maxGrams),
    days: { min: dMin, max: Math.max(dMin, int(days.max, p.days.max, 0, 60)) },
    zoneDays: zoneRows(m.zoneDays, (r) => {
      const min = int(r.min, dMin, 0, 60);
      return { zone: String(r.zone), min, max: Math.max(min, int(r.max, min, 0, 60)) };
    }),
    cutoff: kind === 'same_day' || kind === 'next_day' ? (TIME_RE.test(m.cutoff || '') ? m.cutoff : p.cutoff) : '',
    schedule: sched ? {
      firstDay: first,
      lastDay: Math.max(first, int(sched.lastDay, 7, 1, 30)),
      slots: [...new Set(list(sched.slots).map((s) => String(s).replace(/\s+/g, '')).filter((s) => {
        const mm = SLOT_RE.exec(s);
        return mm && mm[1] < mm[3];
      }))].sort().slice(0, SHIP_LIMITS.slots),
    } : null,
  };
}

const CHARGE_DEFAULTS = {
  handling: { name: 'Handling fee', per: 'order', alsoWhenFree: false },
  remote: { name: 'Remote area charge', per: 'order', alsoWhenFree: true },
  fragile: { name: 'Fragile item handling', per: 'unit', alsoWhenFree: true, tags: ['fragile'] },
  oversized: { name: 'Oversized item charge', per: 'unit', alsoWhenFree: true, tags: ['oversized'] },
  packages: { name: 'Extra package charge', per: 'package', alsoWhenFree: true },
  custom: { name: 'Extra charge', per: 'order', alsoWhenFree: false },
};

export function newCharge(kind = 'handling') {
  const d = CHARGE_DEFAULTS[kind] || CHARGE_DEFAULTS.custom;
  return {
    id: `c-${randomId()}`, kind: CHARGE_KINDS.includes(kind) ? kind : 'custom', enabled: true, name: d.name,
    amount: kind === 'packages' ? 50 : kind === 'remote' ? 60 : 20, percent: 0, per: d.per, packageGrams: kind === 'packages' ? 10000 : 0,
    alsoWhenFree: d.alsoWhenFree, when: { ...emptyWhen(), tags: d.tags ? [...d.tags] : [] },
  };
}

export function emptyWhen() {
  return {
    zones: [], states: [], cities: [], pins: [], methods: [], minValue: 0, maxValue: 0, minQty: 0, maxQty: 0,
    minGrams: 0, maxGrams: 0, products: [], collections: [], tags: [], itemMatch: 'any',
  };
}

export function newRule(action = 'rate') {
  return {
    id: `r-${randomId()}`, name: '', enabled: true, when: emptyWhen(),
    then: action === 'rate' ? { type: 'rate', rate: { type: 'flat', amount: 0 } }
      : action === 'discount' ? { type: 'discount', percent: 50 }
        : action === 'block' ? { type: 'block', message: '' } : { type: action },
  };
}

export function newZone(preset = 'local') {
  const p = ZONE_PRESETS[preset] || ZONE_PRESETS.local;
  return { id: `z-${randomId()}`, name: p.name, states: [...p.states], cities: [...p.cities], pins: [...p.pins] };
}

function sanitizeThen(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const type = RULE_ACTIONS.includes(t.type) ? t.type : 'rate';
  if (type === 'rate') return { type, rate: sanitizeRate(t.rate) };
  if (type === 'discount') return { type, percent: round2(num(t.percent, 0, 0, 100)) };
  if (type === 'block') return { type, message: text(t.message, 160) };
  return { type };
}

const CLEAN = new WeakSet();

/**
 * A complete, valid shipping config from untrusted input (the admin's draft,
 * or what's stored). Numbers may come as text. Invalid entries are dropped,
 * so the admin checks them first with shippingErrors().
 */
export function sanitizeShipping(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const zones = [];
  const zoneIdSet = new Set();
  // Zones first, then "Don't deliver to", then rules and charges share what's left.
  const budget = { left: SHIP_LIMITS.pinsTotal };
  for (const [i, z] of (Array.isArray(c.zones) ? c.zones : []).entries()) {
    if (zones.length >= SHIP_LIMITS.zones) break;
    const id = ident(z?.id, `z-${i}`);
    if (zoneIdSet.has(id)) continue;
    const place = sanitizePlace(z, budget);
    zoneIdSet.add(id);
    zones.push({ id, name: text(z?.name, 40) || `Zone ${zones.length + 1}`, ...place });
  }
  const methods = [];
  const methodIdSet = new Set();
  for (const [i, m] of (Array.isArray(c.methods) ? c.methods : []).entries()) {
    if (methods.length >= SHIP_LIMITS.methods) break;
    const method = sanitizeMethod(m, i, zoneIdSet);
    if (methodIdSet.has(method.id)) method.id = `${method.kind}-${i}-${randomId()}`;
    methodIdSet.add(method.id);
    methods.push(method);
  }
  if (!methods.length) methods.push(newMethod('standard'));
  const b = c.blocked && typeof c.blocked === 'object' ? c.blocked : {};
  const blockedPlace = sanitizePlace(b, budget);
  const rules = (Array.isArray(c.rules) ? c.rules : []).slice(0, SHIP_LIMITS.rules).map((r, i) => ({
    id: ident(r?.id, `r-${i}`),
    name: text(r?.name, 60),
    enabled: r?.enabled !== false,
    when: sanitizeWhen(r?.when, zoneIdSet, methodIdSet, budget),
    then: sanitizeThen(r?.then),
  }));
  const charges = (Array.isArray(c.charges) ? c.charges : []).slice(0, SHIP_LIMITS.charges).map((ch, i) => {
    const kind = CHARGE_KINDS.includes(ch?.kind) ? ch.kind : 'custom';
    const d = CHARGE_DEFAULTS[kind];
    const per = CHARGE_PER.includes(ch?.per) ? ch.per : d.per;
    return {
      id: ident(ch?.id, `c-${i}`),
      kind,
      enabled: ch?.enabled !== false,
      name: text(ch?.name, 60) || d.name,
      amount: money(ch?.amount),
      percent: round2(num(ch?.percent, 0, 0, 100)),
      per,
      packageGrams: per === 'package' ? Math.max(1, grams(ch?.packageGrams, 10000)) : 0,
      alsoWhenFree: typeof ch?.alsoWhenFree === 'boolean' ? ch.alsoWhenFree : d.alsoWhenFree,
      when: sanitizeWhen(ch?.when, zoneIdSet, methodIdSet, budget),
    };
  });
  const fi = c.freeItems && typeof c.freeItems === 'object' ? c.freeItems : {};
  const d = c.delivery && typeof c.delivery === 'object' ? c.delivery : {};
  const workDays = [...new Set(list(d.workDays).map((x) => int(x, -1, -1, 6)).filter((x) => x >= 0))].sort();
  const out = {
    version: 1,
    methods,
    zones,
    rules,
    charges,
    priority: PRIORITY_MODES.includes(c.priority) ? c.priority : 'first',
    blocked: {
      zones: [...new Set(list(b.zones).map(String).filter((id) => zoneIdSet.has(id)))],
      ...blockedPlace,
      message: text(b.message, 160),
    },
    freeItems: {
      products: parseRefs(fi.products, 'product', SHIP_LIMITS.products),
      collections: parseRefs(fi.collections, 'collection', SHIP_LIMITS.collections),
      tags: parseShipTags(fi.tags),
    },
    delivery: {
      processingDays: int(d.processingDays, DEFAULT_DELIVERY.processingDays, 0, 30),
      workDays: workDays.length ? workDays : [...DEFAULT_DELIVERY.workDays],
      holidays: [...new Set(list(d.holidays).map((h) => String(h).trim()).filter((h) => DATE_RE.test(h)))].sort().slice(-SHIP_LIMITS.holidays),
      cutoff: TIME_RE.test(d.cutoff || '') ? d.cutoff : DEFAULT_DELIVERY.cutoff,
      timezone: validTimezone(d.timezone) ? d.timezone : DEFAULT_DELIVERY.timezone,
      showEta: d.showEta !== false,
    },
  };
  CLEAN.add(out);
  return out;
}

function validTimezone(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; }
}

/** Collection ids the config's rules, charges and free items look at (the server checks only these). */
export function referencedCollections(config) {
  const ids = new Set();
  const add = (refs) => (refs || []).forEach((r) => ids.add(r.id));
  for (const r of config.rules || []) add(r.when?.collections);
  for (const ch of config.charges || []) add(ch.when?.collections);
  add(config.freeItems?.collections);
  return [...ids];
}

/* ───────────────────────── validation for the admin ───────────────────────── */

const isAmount = (v) => v === '' || v === null || v === undefined || (Number.isFinite(Number(v)) && Number(v) >= 0);
const blank = (v) => v === '' || v === null || v === undefined;

function rateErrors(rate, path, e) {
  if (!rate || !RATE_TYPES.includes(rate.type)) { e[`${path}.type`] = 'Choose how this is priced.'; return; }
  const amt = (key, msg = 'Enter an amount of 0 or more.') => { if (!isAmount(rate[key])) e[`${path}.${key}`] = msg; };
  if (rate.type === 'flat') { if (blank(rate.amount)) e[`${path}.amount`] = 'Enter the price (0 for free).'; else amt('amount'); }
  if (rate.type === 'per_item') { amt('amount'); amt('first'); if (blank(rate.amount)) e[`${path}.amount`] = 'Enter the price per item.'; }
  if (rate.type === 'weight') {
    amt('base'); amt('step');
    if (!(Number(rate.baseGrams) >= 0)) e[`${path}.baseGrams`] = 'Enter a weight of 0 or more.';
    if (Number(rate.step) > 0 && !(Number(rate.stepGrams) > 0)) e[`${path}.stepGrams`] = 'Enter the weight each extra charge covers.';
  }
  if (rate.type === 'percent') {
    if (!(Number(rate.percent) > 0 && Number(rate.percent) <= 100)) e[`${path}.percent`] = 'Enter a percentage from 0.01 to 100.';
    amt('min'); amt('max');
    if (Number(rate.max) > 0 && Number(rate.min) > Number(rate.max)) e[`${path}.max`] = 'The most must be more than the least.';
  }
  if (rate.type === 'tiers') {
    const tiers = Array.isArray(rate.tiers) ? rate.tiers : [];
    if (!tiers.length) e[`${path}.tiers`] = 'Add at least one price.';
    const seen = new Set();
    tiers.forEach((t, i) => {
      if (i > 0 && !(Number(t.from) > 0)) e[`${path}.tiers.${i}.from`] = 'Enter where this price starts.';
      else if (seen.has(Number(t.from))) e[`${path}.tiers.${i}.from`] = 'Two prices start at the same point.';
      seen.add(Number(i === 0 ? 0 : t.from));
      if (blank(t.amount) || !isAmount(t.amount)) e[`${path}.tiers.${i}.amount`] = 'Enter a price (0 for free).';
    });
  }
}

function rangeErrors(obj, path, e, pairs) {
  for (const [min, max, label] of pairs) {
    if (!isAmount(obj[min])) e[`${path}.${min}`] = 'Enter 0 or more.';
    if (!isAmount(obj[max])) e[`${path}.${max}`] = 'Enter 0 or more.';
    else if (Number(obj[max]) > 0 && Number(obj[min]) > Number(obj[max])) e[`${path}.${max}`] = `The most ${label} must be more than the least.`;
  }
}

function placeErrors(place, path, e) {
  const { bad } = parsePinList(place.pins);
  if (bad.length) e[`${path}.pins`] = `Not PIN codes: ${bad.slice(0, 4).join(', ')}${bad.length > 4 ? '…' : ''}. Use 560001, 560001-560099 or 560*.`;
  const badCities = list(place.cities).filter((c) => !CITY_RE.test(text(String(c ?? ''), 60)));
  if (badCities.length) e[`${path}.cities`] = `Check these city names: ${badCities.slice(0, 3).join(', ')}`;
}

/**
 * Problems in the admin's draft, keyed by path (e.g. "methods.0.rate.amount").
 * Empty object = saves as typed.
 */
export function shippingErrors(draft) {
  const e = {};
  if (!draft || typeof draft !== 'object') return { config: 'Shipping settings are missing.' };
  const methods = Array.isArray(draft.methods) ? draft.methods : [];
  if (!methods.some((m) => m.enabled !== false)) e['methods'] = 'Turn on at least one delivery option.';
  methods.forEach((m, i) => {
    const p = `methods.${i}`;
    if (!text(m.name, 60)) e[`${p}.name`] = 'Enter the name shoppers see.';
    rateErrors(m.rate, `${p}.rate`, e);
    (m.zoneRates || []).forEach((r, j) => rateErrors(r.rate, `${p}.zoneRates.${j}.rate`, e));
    if (!isAmount(m.freeAbove)) e[`${p}.freeAbove`] = 'Enter an amount of 0 or more.';
    rangeErrors(m, p, e, [['minOrder', 'maxOrder', 'order value']]);
    if (!isAmount(m.maxGrams)) e[`${p}.maxGrams`] = 'Enter 0 or more.';
    const dMin = Number(m.days?.min);
    const dMax = Number(m.days?.max);
    if (!(Number.isInteger(dMin) && dMin >= 0 && dMin <= 60)) e[`${p}.days.min`] = 'Enter 0 to 60 days.';
    if (!(Number.isInteger(dMax) && dMax >= 0 && dMax <= 60)) e[`${p}.days.max`] = 'Enter 0 to 60 days.';
    else if (dMax < dMin) e[`${p}.days.max`] = 'Must be at least the fastest.';
    if ((m.kind === 'same_day' || m.kind === 'next_day') && !TIME_RE.test(m.cutoff || '')) e[`${p}.cutoff`] = 'Enter a time like 14:00.';
    if (m.kind === 'scheduled') {
      const s = m.schedule || {};
      const first = Number(s.firstDay);
      const last = Number(s.lastDay);
      if (!(Number.isInteger(first) && first >= 1 && first <= 30)) e[`${p}.schedule.firstDay`] = 'Enter 1 to 30 days.';
      if (!(Number.isInteger(last) && last >= 1 && last <= 30)) e[`${p}.schedule.lastDay`] = 'Enter 1 to 30 days.';
      else if (last < first) e[`${p}.schedule.lastDay`] = 'Must be on or after the first day.';
      const badSlots = list(s.slots).filter((x) => { const mm = SLOT_RE.exec(String(x).replace(/\s+/g, '')); return !mm || mm[1] >= mm[3]; });
      if (badSlots.length) e[`${p}.schedule.slots`] = `Use times like 10:00-13:00: ${badSlots.slice(0, 3).join(', ')}`;
    }
  });
  (draft.zones || []).forEach((z, i) => {
    const p = `zones.${i}`;
    if (!text(z.name, 40)) e[`${p}.name`] = 'Name this zone.';
    if (!list(z.states).length && !list(z.cities).length && !parsePinList(z.pins).pins.length) e[`${p}.where`] = 'Add states, cities or PIN codes.';
    placeErrors(z, p, e);
  });
  const places = [...(draft.zones || []), draft.blocked || {}, ...(draft.rules || []).map((r) => r.when || {}), ...(draft.charges || []).map((c) => c.when || {})];
  const totalPins = places.reduce((n, z) => n + parsePinList(z.pins).pins.length, 0);
  if (totalPins > SHIP_LIMITS.pinsTotal) e['zones'] = `Up to ${SHIP_LIMITS.pinsTotal.toLocaleString('en-IN')} PIN code entries in all, across zones, rules, charges and Don't deliver to (you have ${totalPins.toLocaleString('en-IN')}). Use ranges like 110001-110099 or prefixes like 110*.`;
  for (const [key, w] of [['rules', draft.rules], ['charges', draft.charges]]) {
    (w || []).forEach((x, i) => {
      if (parsePinList(x.when?.pins).pins.length > SHIP_LIMITS.pins) e[`${key}.${i}.when.pins`] = `Up to ${SHIP_LIMITS.pins.toLocaleString('en-IN')} PIN code entries here. Put long lists in a zone.`;
    });
  }
  (draft.zones || []).forEach((z, i) => {
    if (parsePinList(z.pins).pins.length > SHIP_LIMITS.pins) e[`zones.${i}.pins`] = `Up to ${SHIP_LIMITS.pins.toLocaleString('en-IN')} PIN code entries in one zone. Use ranges or prefixes, or split it into two zones.`;
  });
  placeErrors(draft.blocked || {}, 'blocked', e);
  const whenErrors = (w, p) => {
    if (!w) return;
    rangeErrors(w, p, e, [['minValue', 'maxValue', 'order value'], ['minQty', 'maxQty', 'items'], ['minGrams', 'maxGrams', 'weight']]);
    placeErrors(w, p, e);
  };
  (draft.rules || []).forEach((r, i) => {
    const p = `rules.${i}`;
    whenErrors(r.when, `${p}.when`);
    if (r.then?.type === 'rate') rateErrors(r.then.rate, `${p}.then.rate`, e);
    if (r.then?.type === 'discount' && !(Number(r.then.percent) > 0 && Number(r.then.percent) <= 100)) e[`${p}.then.percent`] = 'Enter 1 to 100%.';
  });
  (draft.charges || []).forEach((ch, i) => {
    const p = `charges.${i}`;
    if (!text(ch.name, 60)) e[`${p}.name`] = 'Enter the name shoppers see.';
    if (!isAmount(ch.amount) || blank(ch.amount)) e[`${p}.amount`] = 'Enter an amount of 0 or more.';
    if (ch.per === 'order' && !(num(ch.percent, 0, 0, 1000) <= 100)) e[`${p}.percent`] = 'Enter 0 to 100%.';
    if (ch.per === 'package' && !(Number(ch.packageGrams) > 0)) e[`${p}.packageGrams`] = 'Enter how much one package holds.';
    whenErrors(ch.when, `${p}.when`);
  });
  const collections = new Set([
    ...(draft.rules || []).flatMap((r) => (r.when?.collections || []).map((c) => c.id)),
    ...(draft.charges || []).flatMap((c) => (c.when?.collections || []).map((x) => x.id)),
    ...(draft.freeItems?.collections || []).map((c) => c.id),
  ]);
  if (collections.size > SHIP_LIMITS.collections) e['rules'] = `Rules, charges and free items can look at up to ${SHIP_LIMITS.collections} collections in all (you have ${collections.size}).`;
  const d = draft.delivery || {};
  const proc = Number(d.processingDays);
  if (!(Number.isInteger(proc) && proc >= 0 && proc <= 30)) e['delivery.processingDays'] = 'Enter 0 to 30 days.';
  if (!list(d.workDays).length) e['delivery.workDays'] = 'Pick at least one working day.';
  if (!TIME_RE.test(d.cutoff || '')) e['delivery.cutoff'] = 'Enter a time like 14:00.';
  const badHolidays = list(d.holidays).filter((h) => !DATE_RE.test(String(h).trim()));
  if (badHolidays.length) e['delivery.holidays'] = `Use dates like 2026-11-01: ${badHolidays.slice(0, 3).join(', ')}`;
  return e;
}

/* ───────────────────────── calendar ───────────────────────── */

const DAY_MS = 86_400_000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAY_NAMES = WD;

const utcOf = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => ymd(utcOf(d) + n * DAY_MS);
const dowOf = (d) => new Date(utcOf(d)).getUTCDay();
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The date ('YYYY-MM-DD') and minutes since midnight at `now` in `timeZone`. */
export function zonedNow(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

function calendar(delivery) {
  const holidays = new Set(delivery.holidays);
  const work = new Set(delivery.workDays);
  const isWork = (d) => work.has(dowOf(d)) && !holidays.has(d);
  const nextWork = (d) => { // d itself when it's a working day
    let x = d;
    for (let i = 0; i < 120 && !isWork(x); i++) x = addDays(x, 1);
    return x;
  };
  const addWork = (d, n) => {
    let x = nextWork(d);
    for (let i = 0; i < n; i++) x = nextWork(addDays(x, 1));
    return x;
  };
  return { isWork, nextWork, addWork };
}

/** "Tue, 28 Oct". */
export function dateLabel(d) {
  return `${WD[dowOf(d)]}, ${Number(d.slice(8, 10))} ${MO[Number(d.slice(5, 7)) - 1]}`;
}

/** "Today" / "Tomorrow" / "Tue, 28 Oct" / "28–30 Oct" / "30 Oct – 2 Nov". */
export function etaLabel(from, to, today) {
  if (from === to) {
    if (today && from === today) return 'Today';
    if (today && from === addDays(today, 1)) return 'Tomorrow';
    return dateLabel(from);
  }
  const [fd, fm, td, tm] = [Number(from.slice(8, 10)), MO[Number(from.slice(5, 7)) - 1], Number(to.slice(8, 10)), MO[Number(to.slice(5, 7)) - 1]];
  return fm === tm ? `${fd}–${td} ${fm}` : `${fd} ${fm} – ${td} ${tm}`;
}

/** "10:00-13:00" → "10 AM – 1 PM". */
export function slotLabel(slot) {
  const m = SLOT_RE.exec(String(slot || ''));
  if (!m) return String(slot || '');
  const fmt = (hhmm) => {
    const h = Number(hhmm.slice(0, 2));
    const mi = hhmm.slice(3, 5);
    const h12 = h % 12 || 12;
    return `${h12}${mi !== '00' ? `:${mi}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
  };
  return `${fmt(m[1])} – ${fmt(m[3])}`;
}

/* ───────────────────────── matching ───────────────────────── */

function destKey(dest) {
  if (!dest || typeof dest !== 'object') return null;
  const pin = /^[1-9]\d{5}$/.test(String(dest.pincode || '').trim()) ? String(dest.pincode).trim() : '';
  const city = normCity(dest.city);
  const state = normState(dest.state);
  if (!pin && !city && !state) return null;
  return { pin, city, state, country: String(dest.country || 'IN').toUpperCase() };
}

function hasPlace(p) {
  return Boolean(p && ((p.states && p.states.length) || (p.cities && p.cities.length) || (p.pins && p.pins.length)));
}

function inPlace(p, d) {
  if (!d || !p) return false;
  return (p.pins || []).some((x) => pinMatches(x, d.pin))
    || (p.cities || []).some((c) => normCity(c) === d.city)
    || (p.states || []).some((s) => normState(s) === d.state);
}

// Zones / states / cities / PIN codes of a condition: empty = anywhere.
function whereMatches(w, env) {
  const zoneList = w.zones || [];
  if (!zoneList.length && !hasPlace(w)) return true;
  if (!env.d) return false;
  return zoneList.some((id) => env.zoneIds.includes(id)) || inPlace(w, env.d);
}

function hasItemFilter(f) {
  return Boolean(f && ((f.products && f.products.length) || (f.collections && f.collections.length) || (f.tags && f.tags.length)));
}

function itemMatches(f, line) {
  if (!hasItemFilter(f)) return false;
  return (f.products || []).some((p) => p.id === line.productId)
    || (f.collections || []).some((c) => line.collections.has(c.id))
    || (f.tags || []).some((t) => line.tags.has(t.toLowerCase()));
}

function whenMatches(w, env, method) {
  if (!w) return true;
  if ((w.methods || []).length && (!method || !w.methods.includes(method.id))) return false;
  if (!whereMatches(w, env)) return false;
  const inRange = (x, min, max) => !(min > 0 && x < min) && !(max > 0 && x > max);
  if (!inRange(env.value, w.minValue, w.maxValue)) return false;
  if (!inRange(env.quantity, w.minQty, w.maxQty)) return false;
  if (!inRange(env.grams, w.minGrams, w.maxGrams)) return false;
  if (hasItemFilter(w)) {
    const hits = env.lines.filter((l) => itemMatches(w, l)).length;
    if (!hits || (w.itemMatch === 'all' && hits !== env.lines.length)) return false;
  }
  return true;
}

/* ───────────────────────── pricing ───────────────────────── */

/** What `rate` costs for these measures ({ value, quantity, grams } of the items that pay shipping). */
export function rateAmount(rate, m) {
  if (!rate) return 0;
  switch (rate.type) {
    case 'free': return 0;
    case 'flat': return round2(rate.amount);
    case 'per_item': {
      if (m.quantity <= 0) return 0;
      const first = rate.first > 0 ? rate.first : rate.amount;
      return round2(first + (m.quantity - 1) * rate.amount);
    }
    case 'weight': {
      const extra = m.grams > rate.baseGrams && rate.step > 0 ? Math.ceil((m.grams - rate.baseGrams) / rate.stepGrams) : 0;
      return round2(rate.base + extra * rate.step);
    }
    case 'percent': {
      let v = (m.value * rate.percent) / 100;
      if (rate.min > 0) v = Math.max(v, rate.min);
      if (rate.max > 0) v = Math.min(v, rate.max);
      return round2(v);
    }
    case 'tiers': {
      const x = rate.by === 'quantity' ? m.quantity : rate.by === 'weight' ? m.grams : m.value;
      let amount = rate.tiers[0]?.amount || 0;
      for (const t of rate.tiers) if (x >= t.from) amount = t.amount;
      return round2(amount);
    }
    default: return 0;
  }
}

/** Short words for a rate, for the admin ("₹50 flat", "₹20 per item", …). `fmt` formats money. */
export function describeRate(rate, fmt = (n) => String(n)) {
  if (!rate) return '';
  const g = (x) => (x >= 1000 && x % 100 === 0 ? `${x / 1000} kg` : `${x} g`);
  switch (rate.type) {
    case 'free': return 'Free';
    case 'flat': return Number(rate.amount) > 0 ? `${fmt(Number(rate.amount))} flat` : 'Free';
    case 'per_item': return `${fmt(Number(rate.amount) || 0)} per item${Number(rate.first) > 0 ? ` (first ${fmt(Number(rate.first))})` : ''}`;
    case 'weight': return `${fmt(Number(rate.base) || 0)} up to ${g(Number(rate.baseGrams) || 0)}${Number(rate.step) > 0 ? `, then ${fmt(Number(rate.step))} per ${g(Number(rate.stepGrams) || 0)}` : ''}`;
    case 'percent': return `${Number(rate.percent) || 0}% of order value`;
    case 'tiers': return `${(rate.tiers || []).length} price${(rate.tiers || []).length === 1 ? '' : 's'} by ${rate.by === 'quantity' ? 'item count' : rate.by === 'weight' ? 'weight' : 'order value'}`;
    default: return '';
  }
}

const RULE_PRICE = new Set(['rate', 'free']);

function ruleName(r, i) {
  return r.name || `Rule ${i + 1}`;
}

/**
 * Price and dates for every delivery option of `config` for one order.
 *
 * ctx = {
 *   destination: { pincode, city, state } | null   (null before the address is known),
 *   subtotal: order value after discounts,
 *   lines: [{ productId, quantity, value (line total), unitGrams, tags: [], collections: [gid], requiresShipping }],
 *   now: Date,
 *   choice: { option, date, slot }   (what the shopper picked, if anything),
 *   fmt: money formatter for the admin's step labels (optional),
 * }
 *
 * Returns {
 *   blocked: null | { message },        no delivery to this address
 *   noShipping: true when nothing in the order needs shipping (shipping 0),
 *   zone: { id, name } | null,          the address's zone (first in the merchant's list)
 *   options: [{ id, kind, name, description, price, free, eta, dates, slots, freeIn, steps }],
 *   unavailable: [{ id, name, reason }],
 *   selected: option | null, date, slot,
 *   choiceError: null | 'option' | 'date' | 'slot'   (what the shopper picked is no longer offered),
 *   measures: { value, quantity, grams, missingWeight },
 * }
 */
export function quoteShipping(rawConfig, ctx = {}) {
  const config = CLEAN.has(rawConfig) ? rawConfig : sanitizeShipping(rawConfig);
  const fmt = typeof ctx.fmt === 'function' ? ctx.fmt : (n) => String(n);
  const d = destKey(ctx.destination);
  const allLines = (Array.isArray(ctx.lines) ? ctx.lines : []).map((l) => ({
    productId: String(l.productId || ''),
    quantity: Math.max(0, Number(l.quantity) || 0),
    value: Math.max(0, Number(l.value) || 0),
    unitGrams: Math.max(0, Number(l.unitGrams) || 0),
    hasWeight: Number(l.unitGrams) > 0,
    tags: new Set((l.tags || []).map((t) => String(t).toLowerCase())),
    collections: new Set(l.collections || []),
    requiresShipping: l.requiresShipping !== false,
  }));
  const shippable = allLines.filter((l) => l.requiresShipping);
  const counted = shippable.filter((l) => !itemMatches(config.freeItems, l));
  const lineSum = (ls) => ls.reduce((s, l) => s + l.value, 0);
  const subtotal = Number.isFinite(Number(ctx.subtotal)) && ctx.subtotal !== null ? Math.max(0, Number(ctx.subtotal)) : lineSum(allLines);
  const allValue = lineSum(allLines);
  // Order discounts are shared over the lines by value.
  const countedValue = allValue > 0 ? round2((subtotal * lineSum(counted)) / allValue) : 0;
  const measures = {
    value: countedValue,
    quantity: counted.reduce((s, l) => s + l.quantity, 0),
    grams: counted.reduce((s, l) => s + l.unitGrams * l.quantity, 0),
    missingWeight: counted.filter((l) => !l.hasWeight).length,
  };
  const empty = { blocked: null, noShipping: false, zone: null, options: [], unavailable: [], selected: null, date: null, slot: null, choiceError: null, measures };
  if (allLines.length && !shippable.length) return { ...empty, noShipping: true };

  const zoneIds = d ? config.zones.filter((z) => inPlace(z, d)).map((z) => z.id) : [];
  const zone = zoneIds.length ? config.zones.find((z) => z.id === zoneIds[0]) : null;
  const env = { d, zoneIds, value: round2(subtotal), quantity: measures.quantity, grams: measures.grams, lines: shippable };
  const result = { ...empty, zone: zone ? { id: zone.id, name: zone.name } : null };

  // 1. Don't deliver here.
  const notHere = config.blocked.message || 'We don’t deliver to this address yet. Please try another address.';
  if (d && (config.blocked.zones.some((id) => zoneIds.includes(id)) || inPlace(config.blocked, d))) {
    return { ...result, blocked: { message: notHere, by: 'area' } };
  }
  for (const [i, r] of config.rules.entries()) {
    if (r.enabled && r.then.type === 'block' && !r.when.methods.length && whenMatches(r.when, env, null)) {
      return { ...result, blocked: { message: r.then.message || notHere, by: ruleName(r, i) } };
    }
  }

  const tz = config.delivery.timezone;
  const now = zonedNow(ctx.now instanceof Date ? ctx.now : new Date(ctx.now ?? Date.now()), tz);
  const cal = calendar(config.delivery);
  const today = now.date;
  // The day work on the order starts: today before the cut-off on a working day, else the next working day.
  const start = cal.isWork(today) && now.minutes < minutesOf(config.delivery.cutoff) ? today : cal.nextWork(addDays(today, 1));
  const dispatch = cal.addWork(start, config.delivery.processingDays);
  const firstZoneRow = (rows) => {
    for (const id of zoneIds) {
      const row = rows.find((r) => r.zone === id);
      if (row) return row;
    }
    return null;
  };
  const allCountedFree = shippable.length > 0 && counted.length === 0;

  for (const m of config.methods) {
    if (!m.enabled) continue;
    const no = (reason) => result.unavailable.push({ id: m.id, name: m.name, reason });
    if (m.zones.length && !m.zones.some((id) => zoneIds.includes(id))) { no(d ? 'Not offered in this area' : 'Needs the address'); continue; }
    if (m.minOrder > 0 && env.value < m.minOrder) { no(`Order value below ${fmt(m.minOrder)}`); continue; }
    if (m.maxOrder > 0 && env.value > m.maxOrder) { no(`Order value above ${fmt(m.maxOrder)}`); continue; }
    if (m.maxGrams > 0 && env.grams > m.maxGrams) { no(`Heavier than ${m.maxGrams / 1000} kg`); continue; }

    let eta = null;
    let dates = null;
    if (m.kind === 'same_day') {
      if (!cal.isWork(today) || now.minutes >= minutesOf(m.cutoff)) { no(`After the ${m.cutoff} cut-off, or not a working day`); continue; }
      eta = { from: today, to: today };
    } else if (m.kind === 'next_day') {
      if (now.minutes >= minutesOf(m.cutoff)) { no(`After the ${m.cutoff} cut-off`); continue; }
      const day = cal.nextWork(addDays(today, 1));
      eta = { from: day, to: day };
    } else if (m.kind === 'scheduled') {
      const s = m.schedule;
      const earliest = cal.addWork(start, Math.max(config.delivery.processingDays, s.firstDay));
      const last = addDays(today, s.lastDay);
      dates = [];
      for (let x = earliest; x <= last && dates.length < SHIP_LIMITS.dates; x = addDays(x, 1)) if (cal.isWork(x)) dates.push(x);
      if (!dates.length) { no('No delivery days in the booking window'); continue; }
    } else {
      const days = firstZoneRow(m.zoneDays) || m.days;
      eta = { from: cal.addWork(dispatch, days.min), to: cal.addWork(dispatch, days.max) };
    }

    const steps = [];
    const matching = config.rules.map((r, i) => ({ r, i })).filter(({ r }) => r.enabled && whenMatches(r.when, env, m));
    const hide = matching.find(({ r }) => r.then.type === 'hide' || r.then.type === 'block');
    if (hide) { no(`Hidden by "${ruleName(hide.r, hide.i)}"`); continue; }

    const ratePrice = (rate) => rateAmount(rate, measures);
    let base;
    let free = false;
    const priced = matching.filter(({ r }) => RULE_PRICE.has(r.then.type))
      .map(({ r, i }) => ({ name: ruleName(r, i), price: r.then.type === 'free' ? 0 : ratePrice(r.then.rate), free: r.then.type === 'free' || r.then.rate.type === 'free' }));
    if (priced.length) {
      const pick = config.priority === 'lowest' ? priced.reduce((a, b) => (b.price < a.price ? b : a))
        : config.priority === 'highest' ? priced.reduce((a, b) => (b.price > a.price ? b : a))
          : priced[0];
      base = pick.price;
      free = pick.free;
      steps.push({ label: `Rule "${pick.name}"`, amount: base });
    } else {
      const zr = firstZoneRow(m.zoneRates);
      const rate = zr ? zr.rate : m.rate;
      base = ratePrice(rate);
      free = rate.type === 'free';
      const zName = zr ? config.zones.find((z) => z.id === zr.zone)?.name : null;
      steps.push({ label: zName ? `${zName} price (${describeRate(rate, fmt)})` : `Price (${describeRate(rate, fmt)})`, amount: base });
    }
    if (allCountedFree && base > 0) { base = 0; free = true; steps.push({ label: 'Every item ships free', amount: 0 }); }
    let freeIn = 0;
    if (m.freeAbove > 0 && base > 0) {
      if (env.value >= m.freeAbove) { base = 0; free = true; steps.push({ label: `Free from ${fmt(m.freeAbove)}`, amount: 0 }); } else freeIn = round2(m.freeAbove - env.value);
    }
    const off = Math.min(100, matching.filter(({ r }) => r.then.type === 'discount').reduce((s, { r }) => s + r.then.percent, 0));
    if (off > 0 && base > 0) {
      const cut = round2((base * off) / 100);
      base = round2(base - cut);
      steps.push({ label: `Shipping discount ${off}%`, amount: -cut });
    }
    if (base === 0) free = true;

    let extra = 0;
    for (const ch of config.charges) {
      if (!ch.enabled || (free && !ch.alsoWhenFree) || !whenMatches(ch.when, env, m)) continue;
      const hits = hasItemFilter(ch.when) ? shippable.filter((l) => itemMatches(ch.when, l)) : counted;
      let amt = 0;
      if (ch.per === 'order') amt = ch.amount + (env.value * ch.percent) / 100;
      else if (ch.per === 'item') amt = ch.amount * hits.length;
      else if (ch.per === 'unit') amt = ch.amount * hits.reduce((s, l) => s + l.quantity, 0);
      else amt = ch.amount * Math.max(0, Math.ceil(measures.grams / ch.packageGrams) - 1);
      amt = round2(amt);
      if (amt > 0) { extra += amt; steps.push({ label: ch.name, amount: amt, charge: true }); }
    }

    const price = round2(base + extra);
    result.options.push({
      id: m.id,
      kind: m.kind,
      name: m.name,
      description: m.description,
      price,
      free: price === 0,
      eta: eta && config.delivery.showEta ? { ...eta, label: etaLabel(eta.from, eta.to, today) } : null,
      dates: dates ? dates.map((x) => ({ date: x, label: etaLabel(x, x, today) })) : null,
      slots: dates && m.schedule.slots.length ? m.schedule.slots.map((s) => ({ id: s, label: slotLabel(s) })) : null,
      freeIn,
      steps,
    });
  }

  // What the shopper picked, when it's still offered; else the first option.
  const choice = ctx.choice && typeof ctx.choice === 'object' ? ctx.choice : {};
  let selected = result.options.find((o) => o.id === choice.option) || null;
  if (choice.option && !selected) result.choiceError = 'option';
  if (!selected) selected = result.options[0] || null;
  result.selected = selected;
  if (selected?.dates) {
    const date = selected.dates.find((x) => x.date === choice.date)?.date || null;
    if (choice.date && !date && !result.choiceError) result.choiceError = 'date';
    result.date = date || selected.dates[0].date;
    if (selected.slots) {
      const slot = selected.slots.find((x) => x.id === choice.slot)?.id || null;
      if (choice.slot && !slot && !result.choiceError) result.choiceError = 'slot';
      result.slot = slot || selected.slots[0].id;
    }
  }
  return result;
}

/** The part of a quoteShipping result shoppers may see (no rule names or price steps). */
export function deliveryForShopper(result) {
  if (!result || result.noShipping) return null;
  return {
    zone: result.zone?.name || null,
    options: result.options.map((o) => ({
      id: o.id, kind: o.kind, name: o.name, description: o.description, price: o.price, free: o.free,
      eta: o.eta, dates: o.dates, slots: o.slots, freeIn: o.freeIn,
    })),
    selected: result.selected?.id || null,
    date: result.date,
    slot: result.slot,
  };
}

/** "Express delivery · Tue, 28 Oct, 10 AM – 1 PM" / "Standard delivery · arrives 28–30 Oct" — for the order note. */
export function deliverySummary(result) {
  const o = result?.selected;
  if (!o) return '';
  if (result.date) return `${o.name} on ${dateLabel(result.date)}${result.slot ? `, ${slotLabel(result.slot)}` : ''}`;
  return o.eta ? `${o.name}, arrives ${o.eta.from === o.eta.to ? dateLabel(o.eta.from) : etaLabel(o.eta.from, o.eta.to)}` : o.name;
}
