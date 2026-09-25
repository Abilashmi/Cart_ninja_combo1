import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Local (browser) draft persistence for the Pack builder.
 *
 * - Scoped per shop AND per Pack (`new` or the Pack id), so one Pack's draft
 *   can never be restored into another and a stale draft never silently
 *   appears on a fresh "Create Pack".
 * - A previously stored draft is only *offered* (`pendingDraft`) — it is applied
 *   only when the merchant chooses Restore, and can always be discarded.
 * - Autosave is debounced and driven purely by "form differs from baseline";
 *   after a successful save the baseline is reset and the draft cleared, and
 *   autosave keeps working for further edits (no one-shot "skip" flag).
 * - The stored value holds builder form data only — no tokens or credentials.
 */

const PREFIX = 'brix-packs-draft';
const AUTOSAVE_DELAY_MS = 600;

export function draftKey(shop, packId) {
  return `${PREFIX}:${shop || 'shop'}:${packId || 'new'}`;
}

function readDraft(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.form) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(key, form) {
  try { window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), form })); } catch { /* storage full/blocked — draft is best effort */ }
}

function removeDraft(key) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * @param {string} key                Result of draftKey()
 * @param {object} form               Current builder form state (JSON-serialisable)
 * @param {object} initial            Server/default form the builder started from
 * @param {number|null} serverUpdatedAt  ms timestamp of the saved Pack (edit mode) — older drafts are ignored
 */
export default function usePackDraft(key, form, initial, serverUpdatedAt = null) {
  const [baselineJson, setBaselineJson] = useState(() => JSON.stringify(initial));
  const [pendingDraft, setPendingDraft] = useState(null);
  const [checked, setChecked] = useState(false);
  const [lastAutosave, setLastAutosave] = useState(null);
  const formJson = JSON.stringify(form);
  const dirty = formJson !== baselineJson;
  const keyRef = useRef(key);
  keyRef.current = key;

  // Look for an existing draft once per key (client only).
  useEffect(() => {
    const stored = readDraft(key);
    const stale = stored && serverUpdatedAt && stored.savedAt <= serverUpdatedAt;
    const identical = stored && JSON.stringify(stored.form) === baselineJson;
    if (stale || identical) removeDraft(key);
    setPendingDraft(stored && !stale && !identical ? stored : null);
    setChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Debounced autosave; paused while a stored draft is waiting for a decision.
  useEffect(() => {
    if (!checked || pendingDraft) return undefined;
    if (!dirty) { removeDraft(keyRef.current); return undefined; }
    const timer = setTimeout(() => { writeDraft(keyRef.current, JSON.parse(formJson)); setLastAutosave(Date.now()); }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [formJson, dirty, checked, pendingDraft]);

  // Warn on tab close / reload only when there is unsaved work.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const discardDraft = useCallback(() => { removeDraft(keyRef.current); setPendingDraft(null); }, []);
  const takeDraft = useCallback(() => { const draft = pendingDraft; setPendingDraft(null); return draft; }, [pendingDraft]);
  /** Call after a successful server save with the form the server now holds. */
  const markSaved = useCallback((savedForm) => { removeDraft(keyRef.current); setBaselineJson(JSON.stringify(savedForm)); setLastAutosave(null); }, []);
  /** Drop the local draft AND the new-pack draft (used after first save of a new Pack). */
  const clearKey = useCallback((otherKey) => removeDraft(otherKey), []);

  return { dirty, pendingDraft, lastAutosave, discardDraft, takeDraft, markSaved, clearKey };
}
