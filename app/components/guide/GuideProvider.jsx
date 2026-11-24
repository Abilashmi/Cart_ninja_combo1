/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
/**
 * Guided setup state in the browser (one copy for every /app page, mounted by
 * routes/app.jsx). Starts from the saved state the app loader read
 * (brix.onboarding), applies every change at once with the same rules the
 * server uses (utils/guide.shared.js) and saves it to /api/onboarding in the
 * background, one request at a time (changes made meanwhile are merged into
 * the next one). Whether a feature is set up is only ever decided by the
 * server's check (`verify`).
 *
 * Home's loader adds `guideHome` = { existing, modules }: whether the store
 * already set something up (then the questions don't open by themselves) and
 * each feature's configured / active.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useMatches, useNavigate } from 'react-router';
import {
  applyGuidePatch, sanitizeGuideState, goToStepPatch, stepDonePatch, skipModulePatch, restartPatch,
  guideSteps, guideStep, stepOnPage, orderModules, nextUnfinishedModule,
} from '../../utils/guide.shared.js';
import { setGuideActiveModule } from '../../utils/guide-runtime';

const GuideContext = createContext(null);
export const useGuide = () => useContext(GuideContext);

export const GUIDE_API = '/api/onboarding';
const SAVE_DELAY_MS = 400;
const RETRY_MS = 5000;
// After the merchant clicks a Save button: check at these delays (the save takes a moment).
const SAVE_CLICK_CHECKS = [1500, 2500, 3500, 5000];
const DONE_FLASH_MS = 1400;

const isHome = (pathname) => /^\/app\/?$/.test(pathname || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two queued patches → one (later fields win; progress merged per feature; reset kept).
function mergePatch(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const out = { ...a, ...b };
  if (b.reset) {
    out.reset = true;
    out.progress = { ...(b.progress || {}) };
  } else if (a.progress || b.progress) {
    out.progress = { ...(a.progress || {}) };
    for (const [id, v] of Object.entries(b.progress || {})) {
      out.progress[id] = v === null ? null : { ...(a.progress?.[id] || {}), ...v };
    }
  }
  return out;
}

async function postJson(body) {
  const res = await fetch(GUIDE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export function GuideProvider({ initialState, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  // Home's loader data, when Home is the page (read here so the server-rendered page already has the panel).
  const homeData = matches.find((m) => m.data && typeof m.data === 'object' && m.data.guideHome)?.data?.guideHome || null;

  const [state, setState] = useState(() => sanitizeGuideState(initialState));
  const stateRef = useRef(state);
  const [stored, setStored] = useState(Boolean(initialState));
  const [modulesStatus, setModulesStatus] = useState(homeData?.modules || null);
  const [existing, setExisting] = useState(typeof homeData?.existing === 'boolean' ? homeData.existing : null);
  // The questions opened by hand (Home's "Guided setup"), or to change the picked features.
  const [questionsOpen, setQuestionsOpen] = useState(false);
  // How the questions were opened again: 'edit' ("Change features": progress
  // kept) | 'restart' ("Restart": progress cleared on Start) | null (first time).
  const [questionsMode, setQuestionsMode] = useState(null);
  const editing = Boolean(questionsMode);
  // The "You're all set" summary, shown on Home once the guide is finished.
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [verify, setVerify] = useState({ module: null, phase: 'idle', unknown: false });
  const [saveError, setSaveError] = useState(false);
  const verifying = useRef(false);
  const autoOnboardRef = useRef(false);
  const locRef = useRef(location.pathname);
  locRef.current = location.pathname;

  // Home's fresh statuses each time Home loads.
  useEffect(() => {
    if (!homeData) return;
    if (homeData.modules) setModulesStatus(homeData.modules);
    if (typeof homeData.existing === 'boolean') setExisting(homeData.existing);
  }, [homeData]);

  /* ── saving ─────────────────────────────────────────────── */
  const queue = useRef({ pending: null, timer: null, inflight: null });
  const flush = useCallback(async () => {
    const q = queue.current;
    clearTimeout(q.timer);
    q.timer = null;
    while (q.inflight) await q.inflight;
    if (!q.pending) return;
    const patch = q.pending;
    q.pending = null;
    q.inflight = postJson({ intent: 'patch', patch })
      .then(() => { setSaveError(false); setStored(true); })
      .catch(() => {
        // Keep it for the next save; try again a little later.
        setSaveError(true);
        q.pending = mergePatch(patch, q.pending);
        if (!q.timer) q.timer = setTimeout(() => { flushRef.current(); }, RETRY_MS);
      })
      .finally(() => { q.inflight = null; });
    await q.inflight;
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Unsaved progress goes out before the admin page closes.
  useEffect(() => {
    const onHide = () => {
      const q = queue.current;
      if (!q.pending) return;
      try {
        fetch(GUIDE_API, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'patch', patch: q.pending }) });
        q.pending = null;
      } catch { /* next visit starts from the last saved step */ }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  /** Apply a patch (or a function of the current state returning one) now, save it soon. */
  const update = useCallback((patchOrFn) => {
    const patch = typeof patchOrFn === 'function' ? patchOrFn(stateRef.current) : patchOrFn;
    if (!patch) return stateRef.current;
    const next = applyGuidePatch(stateRef.current, patch);
    stateRef.current = next;
    setState(next);
    const q = queue.current;
    q.pending = mergePatch(q.pending, patch);
    clearTimeout(q.timer);
    q.timer = setTimeout(() => { flushRef.current(); }, SAVE_DELAY_MS);
    return next;
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(GUIDE_API);
      const data = await res.json();
      if (data?.ok) {
        if (data.modules) setModulesStatus(data.modules);
        if (typeof data.existing === 'boolean') setExisting(data.existing);
      }
    } catch { /* the cards keep their last statuses */ }
  }, []);

  /* ── moving around ──────────────────────────────────────── */
  const goToRoute = useCallback((step) => {
    if (step && !stepOnPage(step, locRef.current)) navigate(step.route + (step.search || ''));
  }, [navigate]);

  const goToStep = useCallback((module, stepIndex, { follow = true } = {}) => {
    const steps = guideSteps(module);
    const index = Math.min(Math.max(stepIndex, 0), steps.length - 1);
    update((s) => goToStepPatch(s, module, index));
    setVerify({ module: null, phase: 'idle', unknown: false });
    if (follow) goToRoute(steps[index]);
  }, [update, goToRoute]);

  /** A feature from its saved step (or its first one). */
  const openModule = useCallback((module) => {
    const p = stateRef.current.progress?.[module];
    const step = p && p.tour !== 'completed' ? p.step : 0;
    goToStep(module, step);
  }, [goToStep]);

  // A feature set up (or skipped): back to Home, where the next feature's card
  // gets the spotlight on its Customize button; all done = the summary there.
  const toHome = useCallback(() => { if (!isHome(locRef.current)) navigate('/app'); }, [navigate]);
  const finishFlash = useCallback((module, nextState) => {
    setVerify({ module, phase: 'done', unknown: false });
    setTimeout(() => {
      setVerify((v) => (v.module === module && v.phase === 'done' ? { module: null, phase: 'idle', unknown: false } : v));
      if (nextState.status === 'completed') setFinishedOpen(true);
      toHome();
    }, DONE_FLASH_MS);
  }, [toHome]);

  /**
   * The server reads the feature's own settings. Saved → the feature is set up
   * and the guide moves on to the next picked feature. `silent` = no message
   * when nothing is saved yet (checks the merchant didn't ask for).
   */
  const verifyModule = useCallback(async (module, { silent = false, delays = [0] } = {}) => {
    if (verifying.current) return false;
    verifying.current = true;
    if (!silent) setVerify({ module, phase: 'checking', unknown: false });
    let result = null;
    try {
      await flushRef.current();
      for (const delay of delays) {
        if (delay) await sleep(delay);
        try { result = await postJson({ intent: 'verify', module }); } catch { result = null; }
        if (result?.verified) break;
        // Gone elsewhere meanwhile (another step or feature): stop checking.
        if (stateRef.current.current?.module !== module) break;
      }
    } finally {
      verifying.current = false;
    }
    if (result?.verified && result.state) {
      const nextState = sanitizeGuideState(result.state);
      stateRef.current = nextState;
      setState(nextState);
      setStored(true);
      setModulesStatus((m) => ({ ...(m || {}), [module]: { ...((m || {})[module] || {}), configured: true } }));
      finishFlash(module, nextState);
      refreshStatus();
      return true;
    }
    if (!silent) setVerify({ module, phase: 'failed', unknown: !result || Boolean(result.unknown) });
    return false;
  }, [finishFlash, refreshStatus]);

  const next = useCallback(() => {
    const s = stateRef.current;
    const cur = s.current;
    const step = guideStep(cur);
    if (!cur || !step) return;
    // Not on the step's page (e.g. Home, where its card's Customize is pointed at): open it, skip nothing.
    if (!stepOnPage(step, locRef.current)) { goToRoute(step); return; }
    if (step.kind === 'save') { verifyModule(cur.module); return; }
    update((st) => stepDonePatch(st, cur.module, step.id));
    goToStep(cur.module, cur.step + 1);
  }, [update, goToStep, goToRoute, verifyModule]);

  const prev = useCallback(() => {
    const cur = stateRef.current.current;
    if (cur && cur.step > 0) goToStep(cur.module, cur.step - 1);
  }, [goToStep]);

  // `from` = the step the caller saw: a second call for the same step (double click) does nothing.
  const isAt = (cur, from) => !from || (cur && cur.module === from.module && cur.step === from.step);

  /** The merchant clicked the step's own element: the page does what the click does, the tour moves on. */
  const advanceByClick = useCallback((from) => {
    const cur = stateRef.current.current;
    const step = guideStep(cur);
    if (!cur || !step || !isAt(cur, from)) return;
    if (step.kind === 'save') { verifyModule(cur.module, { delays: SAVE_CLICK_CHECKS }); return; }
    update((st) => stepDonePatch(st, cur.module, step.id));
    goToStep(cur.module, cur.step + 1, { follow: false });
  }, [update, goToStep, verifyModule]);

  /** The step's element went away by the merchant's hand (a window closed): carry on. */
  const advanceWhenGone = useCallback((from) => {
    const cur = stateRef.current.current;
    const step = guideStep(cur);
    if (!cur || !step?.advanceWhenGone || !isAt(cur, from)) return;
    update((st) => stepDonePatch(st, cur.module, step.id));
    goToStep(cur.module, cur.step + 1, { follow: false });
  }, [update, goToStep]);

  // A save step left for another page (e.g. the editor went back to its list after saving):
  // check quietly whether the feature is now saved.
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    const before = lastPath.current;
    lastPath.current = location.pathname;
    const s = stateRef.current;
    const step = guideStep(s.current);
    if (s.status !== 'active' || step?.kind !== 'save') return;
    if (stepOnPage(step, before) && !stepOnPage(step, location.pathname)) verifyModule(s.current.module, { silent: true, delays: [800] });
  }, [location.pathname, verifyModule]);

  /* ── answers and the whole guide ─────────────────────────── */
  // Starts the guide with the answers (first time, or after "Restart": every
  // feature's progress cleared), or, from "Change features", updates them and
  // keeps the progress. Then Home, where the first feature's Customize button
  // gets the spotlight.
  const start = useCallback((payment, picked) => {
    const modules = orderModules(picked, payment);
    if (!modules.length) return;
    const s = stateRef.current;
    if (questionsMode === 'restart') {
      update({ ...restartPatch({ ...s, modules }), payment, modules, progress: { [modules[0]]: { step: 0, tour: 'in_progress' } } });
    } else {
      const keepCurrent = s.current && modules.includes(s.current.module) ? s.current : null;
      const probe = { ...s, modules, payment };
      const first = keepCurrent ? keepCurrent.module : nextUnfinishedModule(probe) || modules[0];
      const step = keepCurrent ? keepCurrent.step : 0;
      update({ status: 'active', payment, modules, collapsed: false, current: { module: first, step }, progress: { [first]: { step, tour: s.progress?.[first]?.tour === 'completed' ? 'completed' : 'in_progress' } } });
    }
    const wasRestart = questionsMode === 'restart';
    setQuestionsOpen(false);
    setQuestionsMode(null);
    setFinishedOpen(false);
    if (!modulesStatus) refreshStatus();
    if (wasRestart) toHome();
  }, [update, refreshStatus, modulesStatus, questionsMode, toHome]);

  /**
   * "Cancel tour" (also the tooltip's ×): the highlight stops, the steps panel
   * stays open (with "Resume tour"). Only closing the guide (`setCollapsed`)
   * hides the panel, leaving the pill.
   */
  const pause = useCallback(() => { update({ status: 'paused' }); setVerify({ module: null, phase: 'idle', unknown: false }); }, [update]);
  /** "Resume tour": the highlight comes back where the tour was (Home points at the feature's Customize). */
  const resume = useCallback(() => { update({ status: 'active', collapsed: false }); }, [update]);
  const skipModule = useCallback(() => {
    const cur = stateRef.current.current;
    if (!cur) return;
    const s = update((st) => skipModulePatch(st, cur.module));
    setVerify({ module: null, phase: 'idle', unknown: false });
    if (s.status === 'completed') setFinishedOpen(true);
    toHome();
  }, [update, toHome]);
  /**
   * "Restart": the questions again from Question 1, already answered; "Start
   * setup" then starts the guide over (every feature's progress cleared, the
   * features' own settings untouched). × / Cancel = nothing changes.
   */
  const restart = useCallback(() => {
    setQuestionsMode('restart');
    setQuestionsOpen(true);
  }, []);
  /** "Change features": the questions box from Question 1, already answered; the progress stays (on any page). */
  const editFeatures = useCallback(() => {
    setQuestionsMode('edit');
    setQuestionsOpen(true);
  }, []);
  /** The questions' "Skip for now" / Cancel / ×. */
  const closeQuestions = useCallback(() => {
    const wasEditing = editing;
    setQuestionsOpen(false);
    setQuestionsMode(null);
    if (wasEditing || stateRef.current.modules.length) return;
    // Opened by hand by a store the questions don't open for anyway: nothing to save.
    if (!autoOnboardRef.current) return;
    // A new store's "Not now" is kept, so the questions stay closed after a refresh.
    update({ status: 'dismissed' });
  }, [update, editing]);
  const closeFinished = useCallback(() => setFinishedOpen(false), []);
  /** Home's "Guided setup" button: reopens a started guide as it was, else the questions. */
  const openSetup = useCallback(() => {
    const s = stateRef.current;
    if (s.modules.length && (s.status === 'active' || s.status === 'paused')) { update({ collapsed: false }); return; }
    if (s.status === 'completed') { setFinishedOpen(true); return; }
    setQuestionsOpen(true);
  }, [update]);
  const setCollapsed = useCallback((collapsed) => update({ collapsed }), [update]);

  /* ── the app embed a feature needs ───────────────────────── */
  // { [handle]: { checked, enabled, name, editorUrl, loading } } for this visit.
  const [embeds, setEmbeds] = useState({});
  const checkEmbed = useCallback(async (handle) => {
    if (!handle) return;
    setEmbeds((m) => ({ ...m, [handle]: { ...(m[handle] || {}), loading: true } }));
    try {
      const res = await fetch(`/api/theme-embed-status?handle=${encodeURIComponent(handle)}`);
      const data = await res.json();
      setEmbeds((m) => ({ ...m, [handle]: { checked: Boolean(data?.checked), enabled: data?.enabled !== false, name: data?.name || '', editorUrl: data?.editorUrl || '', loading: false } }));
    } catch {
      // Unknown: say nothing rather than a warning that may be wrong.
      setEmbeds((m) => ({ ...m, [handle]: { checked: false, enabled: true, loading: false } }));
    }
  }, []);

  /* ── what shows ──────────────────────────────────────────── */
  const onHome = isHome(location.pathname);
  const running = state.status === 'active' && Boolean(state.current);
  // A store that never saved an answer and has nothing set up gets the questions by itself (Home only).
  const autoOnboard = !stored && existing === false;
  autoOnboardRef.current = autoOnboard;
  // The questions: a box in the middle of the screen. By itself only on Home for a
  // new store; opened by hand ("Guided setup", "Change features") on any page.
  const questionsVisible = editing || questionsOpen || (onHome && !running && state.status === 'new' && autoOnboard);
  // The guide is started (running, or its tour cancelled) and not closed.
  const started = state.modules.length > 0 && Boolean(state.current) && (state.status === 'active' || state.status === 'paused');
  // The side panel: the guided steps until the merchant closes the guide (and the summary once it's all done).
  const panelVisible = (started && !state.collapsed && !questionsVisible) || (onHome && finishedOpen && state.status === 'completed');
  // The highlight: only while the tour runs and the guide is open.
  const spotlightOn = running && !state.collapsed && !questionsVisible;
  // Guide closed: the pill at the bottom brings it back.
  const pillVisible = started && state.collapsed && !questionsVisible;

  // Pages' own older tours stay off while the guide walks through their feature.
  setGuideActiveModule(running ? state.current.module : null);

  const value = useMemo(() => ({
    state, stored, modulesStatus, existing, verify, saveError, onHome, running, panelVisible, pillVisible, spotlightOn, questionsVisible, editing, questionsMode, embeds,
    start, next, prev, goToStep, openModule, advanceByClick, advanceWhenGone, verifyModule,
    pause, resume, skipModule, restart, editFeatures, closeQuestions, closeFinished, openSetup, setCollapsed, refreshStatus, checkEmbed,
  }), [state, stored, modulesStatus, existing, verify, saveError, onHome, running, panelVisible, pillVisible, spotlightOn, questionsVisible, editing, questionsMode, embeds,
    start, next, prev, goToStep, openModule, advanceByClick, advanceWhenGone, verifyModule,
    pause, resume, skipModule, restart, editFeatures, closeQuestions, closeFinished, openSetup, setCollapsed, refreshStatus, checkEmbed]);

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}
