const STORAGE_KEY = "cartninja_feature_state";
const CHANGE_EVENT = "featureStateChanged";

const DEFAULTS = {
  cart_drawer: true,
  progress_bar: false,
  coupon_slider: false,
  upsells: false,
  trust_badges: false,
  fbt: true,
  coupon_banner: true,
  coupon_creator: true,
  combo_forge: true,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function get(key) {
  return load()[key] ?? true;
}

function set(key, value) {
  const state = load();
  state[key] = value;
  save(state);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, value } }));
}

function toggle(key) {
  const current = get(key);
  set(key, !current);
  return !current;
}

function getAll() {
  return load();
}

function reset() {
  save({ ...DEFAULTS });
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { reset: true } }));
}

function subscribe(cb) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function getSettings(key) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + "_settings");
    const data = raw ? JSON.parse(raw) : {};
    return data[key] || null;
  } catch { return null; }
}

function setSettings(key, value) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + "_settings");
    const data = raw ? JSON.parse(raw) : {};
    data[key] = value;
    localStorage.setItem(STORAGE_KEY + "_settings", JSON.stringify(data));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, settings: value } }));
  } catch { /* ignore */ }
}

function removeSettings(key) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + "_settings");
    const data = raw ? JSON.parse(raw) : {};
    delete data[key];
    localStorage.setItem(STORAGE_KEY + "_settings", JSON.stringify(data));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, settings: null } }));
  } catch { /* ignore */ }
}

export const featureStore = { get, set, toggle, getAll, reset, subscribe, DEFAULTS, getSettings, setSettings, removeSettings };
