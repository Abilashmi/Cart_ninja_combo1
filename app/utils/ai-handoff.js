// Client-side handoff from the global Brix AI page to a module page's existing
// BrixBar chat. The global page writes one record to sessionStorage and
// navigates; the module's BrixBar reads it once on arrival, shows the merchant's
// original message in its own chat, and sends it through the normal chat path.
//
// sessionStorage (not router state) so the record survives a full reload of the
// embedded iframe; a one-shot consume so a refresh or back/forward can never
// run the request a second time. No backend or database involved.
import { AI_MODULE_ROUTES, resolveHandoffTarget } from '../config/ai-module-routes';

export const HANDOFF_SOURCE = 'global-ai';
// Fired by the receiving chat once a handoff has been accepted, so the module
// page can react (e.g. the Cart Editor opening the relevant accordion section).
export const HANDOFF_RECEIVED_EVENT = 'brixHandoffReceived';

const STORAGE_KEY = 'brix-ai-handoff';
const CONSUMED_KEY = 'brix-ai-handoff-consumed';
const MAX_AGE_MS = 2 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_REMEMBERED_IDS = 20;

// Also tracked in memory so a storage failure can't turn into a double run.
const consumedInMemory = new Set();

// Fallback for when sessionStorage is unusable (the embedded admin iframe can
// block storage): navigation between app pages is client-side, so a module-level
// variable survives it. Only ever used when storage failed, so a working
// storage remains the single source of truth (and refresh-safe).
let memoryRecord = null;

function defaultStorage() {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

function newId() {
  try { if (typeof window !== 'undefined' && window.crypto?.randomUUID) return `ai-handoff-${window.crypto.randomUUID()}`; } catch { /* fall through */ }
  return `ai-handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readConsumed(storage) {
  try {
    const list = JSON.parse(storage?.getItem(CONSUMED_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// Returns the stored record, or null if it could not be written (unknown
// module, empty message, or invalid input) — the caller should then just
// send the message in the current chat instead of navigating.
export function createHandoff({ message, targetModule, targetFeatures = [] }, storage = defaultStorage()) {
  const text = String(message ?? '').trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH || !AI_MODULE_ROUTES[targetModule]) return null;
  const record = {
    handoffId: newId(),
    message: text,
    source: HANDOFF_SOURCE,
    targetModule,
    targetFeature: targetFeatures[0] || null,
    targetFeatures: [...targetFeatures],
    createdAt: Date.now(),
  };
  try {
    if (!storage) throw new Error('no storage');
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
    memoryRecord = null;
  } catch {
    memoryRecord = record;
  }
  return record;
}

// One call for a sender: decides whether `message` belongs to a module page
// other than `currentPath`, and if so writes the handoff. Returns
// { target, ackText } (navigate to target.route, show ackText), or null to just
// handle the message in the current chat.
export function prepareHandoff(message, currentPath, storage = defaultStorage()) {
  const target = resolveHandoffTarget(message, currentPath);
  if (!target) return null;
  const record = createHandoff({ message, targetModule: target.module, targetFeatures: target.features }, storage);
  if (!record) return null;
  return { target, ackText: `I'll take you to ${target.label} so I can take care of that.` };
}

function isValid(r, now) {
  return !!r
    && r.source === HANDOFF_SOURCE
    && typeof r.handoffId === 'string' && r.handoffId.length > 0
    && typeof r.message === 'string' && r.message.trim().length > 0 && r.message.length <= MAX_MESSAGE_LENGTH
    && !!AI_MODULE_ROUTES[r.targetModule]
    && Array.isArray(r.targetFeatures)
    && Number.isFinite(r.createdAt)
    && r.createdAt <= now + 60 * 1000;
}

// Takes the pending handoff for `currentModule` exactly once.
//   { handoff }  accepted — it is now consumed and gone from storage
//   { error }    'invalid' (unreadable/tampered record, discarded)
//   {}           nothing to do: no handoff, expired, already consumed, or meant
//                for a different module (left in place for that module)
export function consumeHandoff(currentModule, storage = defaultStorage(), now = Date.now()) {
  let raw = null;
  try { raw = storage ? storage.getItem(STORAGE_KEY) : null; } catch { raw = null; }
  if (!raw && memoryRecord) raw = JSON.stringify(memoryRecord);
  if (!raw) return {};

  const discard = () => {
    memoryRecord = null;
    try { storage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  let record;
  try { record = JSON.parse(raw); } catch { discard(); return { error: 'invalid' }; }
  if (!isValid(record, now)) { discard(); return { error: 'invalid' }; }
  if (now - record.createdAt > MAX_AGE_MS) { discard(); return {}; }
  if (record.targetModule !== currentModule) return {};

  const seen = readConsumed(storage);
  if (consumedInMemory.has(record.handoffId) || seen.includes(record.handoffId)) { discard(); return {}; }

  // Mark consumed before doing anything else, so a second caller in the same
  // tick (StrictMode's doubled effects, two chats mounting) is refused.
  consumedInMemory.add(record.handoffId);
  try { storage?.setItem(CONSUMED_KEY, JSON.stringify([...seen, record.handoffId].slice(-MAX_REMEMBERED_IDS))); } catch { /* memory set still guards */ }
  discard();
  return { handoff: record };
}

export function notifyHandoffReceived(handoff) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(HANDOFF_RECEIVED_EVENT, {
    detail: { module: handoff.targetModule, feature: handoff.targetFeature, features: handoff.targetFeatures },
  }));
}
