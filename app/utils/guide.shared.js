/**
 * Guided setup (onboarding questions + the right-side setup panel): which
 * features exist, how the payment answer picks COD, and the merchant's saved
 * progress. Pure functions, used the same way by the browser
 * (components/guide/GuideProvider.jsx) and the server
 * (services/guide-state.server.js, routes/api.onboarding.jsx), so a patch the
 * browser applies to its own copy gives the same state the server stores.
 *
 * Saved state (app-data metafield brix.onboarding):
 *   status    new | active | paused | completed | dismissed
 *   payment   prepaid | postpaid | both | null
 *   modules   the features picked, in setup order (COD first)
 *   current   { module, step } the step the tour is on, or null
 *   collapsed the panel folded to its header
 *   progress  per feature { step, done: [step ids], tour, verifiedAt, updatedAt }
 *             tour = not_started | in_progress | completed | skipped;
 *             "completed" only ever comes from the server's check that the
 *             feature's settings are saved (completeModule), never from Next.
 */
import { GUIDE_TOURS, guideStepIds } from '../config/guide-tours.js';

export const GUIDE_PAYMENTS = ['prepaid', 'postpaid', 'both'];
// Every feature the guide can set up, in the order it is offered and set up.
export const GUIDE_MODULE_IDS = ['cod', 'cart', 'fbt', 'combo', 'packs', 'coupon', 'discounts', 'brix_ai'];
export const GUIDE_STATUSES = ['new', 'active', 'paused', 'completed', 'dismissed'];
export const TOUR_STATES = ['not_started', 'in_progress', 'completed', 'skipped'];
const FINISHED = ['completed', 'skipped'];

/** Postpaid (Cash on Delivery) and Both start with COD Checkout picked. */
export const paymentWantsCod = (payment) => payment === 'postpaid' || payment === 'both';

/**
 * The picks after the payment answer changes. COD is added for postpaid /
 * both; for prepaid it is taken off only when the guide added it (`codAuto`),
 * never when the merchant picked it.
 */
export function selectionForPayment(payment, picked = [], { codAuto = false } = {}) {
  const set = new Set(Array.isArray(picked) ? picked : []);
  let auto = codAuto;
  if (paymentWantsCod(payment)) {
    if (!set.has('cod')) { set.add('cod'); auto = true; }
  } else if (codAuto && set.has('cod')) {
    set.delete('cod');
    auto = false;
  }
  return { modules: orderModules([...set], payment), codAuto: auto };
}

/** Known features, once each, in setup order; COD first for postpaid / both. */
export function orderModules(ids, payment) {
  const picked = new Set((Array.isArray(ids) ? ids : []).filter((id) => GUIDE_MODULE_IDS.includes(id)));
  const ordered = GUIDE_MODULE_IDS.filter((id) => picked.has(id));
  if (paymentWantsCod(payment) && ordered.includes('cod')) return ['cod', ...ordered.filter((id) => id !== 'cod')];
  return ordered;
}

export const guideSteps = (moduleId) => GUIDE_TOURS[moduleId]?.steps || [];
export const guideStep = (current) => (current ? guideSteps(current.module)[current.step] || null : null);

export function emptyGuideState() {
  return { v: 1, status: 'new', payment: null, modules: [], current: null, collapsed: false, progress: {}, startedAt: null, completedAt: null, updatedAt: null };
}

const iso = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);
const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
};

function cleanProgress(moduleId, raw) {
  const ids = guideStepIds(moduleId);
  const done = [...new Set((Array.isArray(raw?.done) ? raw.done : []).filter((id) => ids.includes(id)))];
  const step = clampInt(raw?.step, 0, Math.max(ids.length - 1, 0), 0);
  const tour = TOUR_STATES.includes(raw?.tour) ? raw.tour : (done.length || step > 0 ? 'in_progress' : 'not_started');
  return { step, done, tour, verifiedAt: iso(raw?.verifiedAt), updatedAt: iso(raw?.updatedAt) };
}

/** The first picked feature not yet set up or skipped, looking after `after` first, then from the start. */
export function nextUnfinishedModule(state, after = null) {
  const modules = state?.modules || [];
  const open = (id) => !FINISHED.includes(state?.progress?.[id]?.tour);
  const from = after ? modules.indexOf(after) + 1 : 0;
  return modules.slice(from).find(open) || modules.slice(0, from).find(open) || null;
}

/** Any value → a valid saved state (unknown features, steps and fields dropped). */
export function sanitizeGuideState(raw) {
  if (!raw || typeof raw !== 'object') return emptyGuideState();
  const payment = GUIDE_PAYMENTS.includes(raw.payment) ? raw.payment : null;
  const modules = orderModules(raw.modules, payment);
  const progress = {};
  for (const id of GUIDE_MODULE_IDS) {
    if (raw.progress && raw.progress[id] && typeof raw.progress[id] === 'object') progress[id] = cleanProgress(id, raw.progress[id]);
  }
  let current = null;
  if (raw.current && typeof raw.current === 'object' && modules.includes(raw.current.module)) {
    current = { module: raw.current.module, step: clampInt(raw.current.step, 0, Math.max(guideSteps(raw.current.module).length - 1, 0), 0) };
  }
  let status = GUIDE_STATUSES.includes(raw.status) ? raw.status : 'new';
  if ((status === 'active' || status === 'paused') && !modules.length) status = 'new';
  const state = {
    v: 1, status, payment, modules, current, collapsed: raw.collapsed === true, progress,
    startedAt: iso(raw.startedAt), completedAt: iso(raw.completedAt), updatedAt: iso(raw.updatedAt),
  };
  // Running with no step: carry on with the next feature not set up, else it's finished.
  if (status === 'active' && !current) {
    const next = nextUnfinishedModule(state);
    if (next) state.current = { module: next, step: progress[next]?.tour === 'in_progress' ? progress[next].step : 0 };
    else { state.status = 'completed'; }
  }
  if (state.status !== 'completed') state.completedAt = null;
  return state;
}

/**
 * Merges a patch onto the saved state (top-level fields replaced, `progress`
 * merged per feature; `reset: true` clears all progress first) and stamps
 * the times. `trusted` = the server's own completion check: only then may a
 * feature's tour become "completed" or get a verifiedAt.
 */
export function applyGuidePatch(state, patch, { now = new Date(), trusted = false } = {}) {
  const base = sanitizeGuideState(state);
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...base, progress: p.reset === true ? {} : { ...base.progress } };
  for (const key of ['status', 'payment', 'modules', 'current', 'collapsed']) {
    if (key in p) next[key] = p[key];
  }
  if (!trusted && next.status === 'completed' && base.status !== 'completed') next.status = base.status === 'new' ? 'new' : 'active';
  if (p.progress && typeof p.progress === 'object') {
    for (const [id, value] of Object.entries(p.progress)) {
      if (!GUIDE_MODULE_IDS.includes(id)) continue;
      if (value === null) { delete next.progress[id]; continue; }
      if (!value || typeof value !== 'object') continue;
      const merged = { ...(next.progress[id] || {}), ...value, updatedAt: now.toISOString() };
      if (!trusted) {
        merged.verifiedAt = next.progress[id]?.verifiedAt || null;
        if (merged.tour === 'completed' && next.progress[id]?.tour !== 'completed') merged.tour = 'in_progress';
      }
      next.progress[id] = merged;
    }
  }
  const stamp = now.toISOString();
  if (next.status === 'active' && !base.startedAt) next.startedAt = stamp;
  if (next.status === 'completed' && base.status !== 'completed') next.completedAt = stamp;
  if (p.reset === true) { next.startedAt = stamp; next.completedAt = null; }
  next.updatedAt = stamp;
  return sanitizeGuideState(next);
}

/** Patch: the tour moves to `step` of `module` (the feature is then in progress unless already finished). */
export function goToStepPatch(state, module, step) {
  const prev = state?.progress?.[module];
  const tour = prev?.tour === 'completed' ? 'completed' : 'in_progress';
  return { status: 'active', current: { module, step }, progress: { [module]: { step, tour } } };
}

/** Patch: the step was passed (Next or the merchant clicked its element). */
export function stepDonePatch(state, module, stepId) {
  const done = state?.progress?.[module]?.done || [];
  return done.includes(stepId) ? null : { progress: { [module]: { done: [...done, stepId] } } };
}

/**
 * Patch (server only, after the settings were found saved): the feature is
 * set up and the tour moves on to the next feature not finished, or ends.
 */
export function completeModulePatch(state, module, now = new Date()) {
  const ids = guideStepIds(module);
  const marked = { ...state, progress: { ...(state?.progress || {}), [module]: { ...(state?.progress?.[module] || {}), tour: 'completed' } } };
  const next = nextUnfinishedModule(marked, module);
  return {
    status: next ? 'active' : 'completed',
    current: next ? { module: next, step: 0 } : null,
    progress: {
      [module]: { tour: 'completed', done: ids, step: Math.max(ids.length - 1, 0), verifiedAt: now.toISOString() },
      ...(next ? { [next]: { step: 0, tour: state?.progress?.[next]?.tour === 'completed' ? 'completed' : 'in_progress' } } : {}),
    },
  };
}

/** Patch: leave this feature for now and go on to the next one. */
export function skipModulePatch(state, module) {
  const marked = { ...state, progress: { ...(state?.progress || {}), [module]: { ...(state?.progress?.[module] || {}), tour: 'skipped' } } };
  const next = nextUnfinishedModule(marked, module);
  return {
    status: next ? 'active' : 'completed',
    current: next ? { module: next, step: state?.progress?.[next]?.step || 0 } : null,
    progress: {
      [module]: { tour: state?.progress?.[module]?.tour === 'completed' ? 'completed' : 'skipped' },
      ...(next ? { [next]: { tour: 'in_progress' } } : {}),
    },
  };
}

/** Patch: start over (every feature's progress cleared; settings are never touched). */
export function restartPatch(state) {
  const first = state?.modules?.[0] || null;
  return { reset: true, status: first ? 'active' : 'new', collapsed: false, current: first ? { module: first, step: 0 } : null };
}

/** Counts for the panel and the Home cards. */
export function guideSummary(state) {
  const perModule = {};
  let stepsTotal = 0;
  let stepsDone = 0;
  let modulesDone = 0;
  for (const id of state?.modules || []) {
    const total = guideSteps(id).length;
    const p = state.progress?.[id];
    const done = Math.min(p?.done?.length || 0, total);
    const tour = p?.tour || 'not_started';
    perModule[id] = { total, done, tour, step: p?.step || 0 };
    stepsTotal += total;
    stepsDone += done;
    if (tour === 'completed') modulesDone += 1;
  }
  return { modulesTotal: (state?.modules || []).length, modulesDone, stepsTotal, stepsDone, perModule };
}

/**
 * A feature's statuses, each one separate: the tour (not_started |
 * in_progress | completed | skipped), configured (its settings are saved) and
 * active (switched on for shoppers). `configured` / `active` null = unknown.
 */
export function moduleStatuses(state, setup, moduleId) {
  const tour = state?.progress?.[moduleId]?.tour || 'not_started';
  const s = setup?.[moduleId] || {};
  return { tour, configured: typeof s.configured === 'boolean' ? s.configured : null, active: typeof s.active === 'boolean' ? s.active : null };
}

/** Does the step live on this page? ('/app' and '/app/' are both Home.) */
export function stepOnPage(step, pathname) {
  if (!step) return false;
  const trim = (p) => String(p || '').replace(/\/+$/, '') || '/';
  return trim(step.route) === trim(pathname);
}
