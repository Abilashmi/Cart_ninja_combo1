/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
/**
 * Points at the current guided-setup step's element (config/guide-tours.js):
 *  1. waits for the step's page (route) — on another page it shows nothing
 *     (the panel offers "Go to this step");
 *  2. asks the page to show it (`brix:guide-reveal`, utils/guide-runtime.js)
 *     and clicks the step's `reveal` row when it is folded
 *     (aria-expanded / aria-selected "false") or the target isn't there;
 *  3. finds the target by its data-tour id (first one on screen), scrolls it
 *     into view and rings it, dimming the rest of the page;
 *  4. a tooltip next to it repeats the step with Back / Next;
 *  5. the merchant's own click on the step's `click` element moves the tour on
 *     (programmatic clicks, like the reveal above, don't count);
 *  6. a target that never shows gets a card saying so, with Skip step;
 *     while it is missing the search carries on, so it recovers by itself.
 * The ring and dim never take clicks: the page stays fully usable.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Icon } from '@shopify/polaris';
import { XIcon } from '@shopify/polaris-icons';
import { useT } from '../../i18n/admin';
import { useGuide } from './GuideProvider';
import { GUIDE_MODULE_META, homeCustomizeTarget } from './guide-meta';
import { guideStep, guideSteps, stepOnPage } from '../../utils/guide.shared.js';
import { GUIDE_REVEAL_EVENT } from '../../utils/guide-runtime';

const FIND_WAIT_MS = 5000;
const POLL_MS = 200;
const SLOW_POLL_MS = 800;
const REVEAL_SETTLE_MS = 90;
// When the step's row is checked (and clicked if still folded) after the step starts.
const REVEAL_CHECKS_MS = [REVEAL_SETTLE_MS, 500, 1100, 1800];
const PAD = 6;
const TIP_W = 300;
const TIP_GAP = 12;
const EDGE = 12;

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const tourSelector = (id) => `[data-tour="${String(id).replace(/"/g, '')}"]`;
const shown = (el) => Boolean(el && el.isConnected && el.getClientRects().length > 0);
const firstShown = (id) => (id ? Array.from(document.querySelectorAll(tourSelector(id))).find(shown) || null : null);
// A wrapper (span / div around a Polaris Button) is clicked through its own button.
const CONTROL = 'button, a[href], [role="button"], [role="tab"], [role="switch"]';
const clickable = (el) => (el.matches(CONTROL) ? el : el.querySelector(CONTROL) || el);

// The panel as a column (wide screens) takes the right side: keep the tooltip left of it.
function usableRight() {
  const aside = document.querySelector('[data-guide-aside]');
  if (aside && getComputedStyle(aside).position === 'sticky') return aside.getBoundingClientRect().left;
  return window.innerWidth;
}

function placeTip(rect, tipH) {
  const vw = usableRight();
  const vh = window.innerHeight;
  const h = tipH || 170;
  const left = Math.min(Math.max(rect.left, EDGE), Math.max(EDGE, vw - TIP_W - EDGE));
  const below = vh - (rect.top + rect.height + PAD);
  const above = rect.top - PAD;
  const rightSpace = vw - (rect.left + rect.width + PAD);
  const besideRight = { top: Math.min(Math.max(rect.top, EDGE), vh - h - EDGE), left: rect.left + rect.width + PAD + TIP_GAP };
  // A setting in an editor's left sidebar: beside it, over the preview, so the next rows stay visible.
  if (rect.left < 24 && rect.width <= 520 && rightSpace >= TIP_W + TIP_GAP + EDGE) return besideRight;
  if (below >= h + TIP_GAP + EDGE) return { top: rect.top + rect.height + PAD + TIP_GAP, left };
  if (above >= h + TIP_GAP + EDGE) return { top: rect.top - PAD - TIP_GAP - h, left };
  // Beside it (tall targets such as an open settings section).
  if (rightSpace >= TIP_W + TIP_GAP + EDGE) return besideRight;
  if (rect.left - PAD >= TIP_W + TIP_GAP + EDGE) return { top: Math.min(Math.max(rect.top, EDGE), vh - h - EDGE), left: rect.left - PAD - TIP_GAP - TIP_W };
  return { top: Math.max(EDGE, vh - h - EDGE), left };
}

export default function GuideSpotlight() {
  const t = useT();
  const g = useGuide();
  const location = useLocation();
  // Only while the tour runs and the guide is open (cancelled tour / closed guide = no highlight).
  const cur = g.spotlightOn ? g.state.current : null;
  const realStep = guideStep(cur);
  const onPage = Boolean(realStep) && stepOnPage(realStep, location.pathname);
  // On Home, a step that lives on the feature's page is reached through its
  // card: the spotlight points at that card's Customize button (not a step).
  const entry = !onPage && Boolean(realStep) && g.onHome;
  const name = cur ? t(GUIDE_MODULE_META[cur.module].name) : '';
  const step = onPage ? realStep : entry
    ? { target: homeCustomizeTarget(cur.module), title: t('admin.guide.entry_title', { name }), body: t('admin.guide.entry_body', { name }) }
    : null;
  const stepKey = step ? `${cur.module}:${onPage ? cur.step : 'entry'}:${location.pathname}` : null;

  const [target, setTarget] = useState(null);
  const [missing, setMissing] = useState(false);
  const [rect, setRect] = useState(null);
  const [search, setSearch] = useState(0); // bumped to look for the target again
  const [tipH, setTipH] = useState(0);
  const tipRef = useRef(null);
  const gRef = useRef(g);
  gRef.current = g;
  // The step its element was last revealed for: a step reveals once, so a
  // later search (the element went away) never pulls the page back to it.
  const revealedFor = useRef(null);
  // The step on screen now: a tracker set up for an earlier step (its element
  // vanishing as the page changes) must not restart the new step's search.
  const stepKeyRef = useRef(stepKey);
  stepKeyRef.current = stepKey;

  // 1-3: show and find the target.
  useEffect(() => {
    setTarget(null);
    setMissing(false);
    setRect(null);
    if (!stepKey || !step) return undefined;
    let cancelled = false;
    let timer;
    const timers = [];
    const started = Date.now();
    const prior = revealedFor.current?.key === stepKey ? revealedFor.current : null;
    let revealed = Boolean(prior);

    // Opens the step's row when it's folded. A page that sets itself up as it
    // mounts (the Cart Editor) can fold it again right after, so it's checked
    // a few more times early on; later the merchant's own clicks are left alone.
    const openRow = () => {
      if (cancelled) return;
      const holder = firstShown(step.reveal);
      if (!holder) return;
      const trigger = clickable(holder);
      const folded = trigger.getAttribute('aria-expanded') === 'false' || trigger.getAttribute('aria-selected') === 'false';
      if (folded || !firstShown(step.target)) trigger.click();
    };
    const reveal = () => {
      revealed = true;
      revealedFor.current = { key: stepKey, at: Date.now() };
      try { window.dispatchEvent(new CustomEvent(GUIDE_REVEAL_EVENT, { detail: { id: step.revealEvent || step.reveal || step.target } })); } catch { /* old browsers */ }
      if (!step.reveal) return;
      for (const ms of REVEAL_CHECKS_MS) timers.push(setTimeout(openRow, ms));
    };
    // Looking again within the same step (its element was redrawn): the open-checks
    // still due keep their times; the event is never sent twice.
    if (prior && step.reveal) {
      for (const ms of REVEAL_CHECKS_MS) {
        const due = prior.at + ms - Date.now();
        if (due >= 0) timers.push(setTimeout(openRow, due));
      }
    }

    const tick = () => {
      if (cancelled) return;
      if (!revealed) { reveal(); timer = setTimeout(tick, REVEAL_SETTLE_MS + 60); return; }
      const found = firstShown(step.target);
      if (found) { setMissing(false); setTarget(found); return; }
      const late = Date.now() - started > FIND_WAIT_MS;
      if (late) setMissing(true);
      timer = setTimeout(tick, late ? SLOW_POLL_MS : POLL_MS);
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, search]);

  // Follow the target as the page scrolls, resizes or redraws.
  useEffect(() => {
    if (!target) return undefined;
    let last = '';
    const trackedKey = stepKeyRef.current;
    const update = () => {
      if (stepKeyRef.current !== trackedKey) return; // an earlier step's element: nothing to do
      // Gone = removed, hidden, or no longer the step's element (React can reuse a
      // node and just change its data-tour, e.g. the Packs builder's step wrapper).
      if (!shown(target) || !target.matches(tourSelector(step.target))) {
        // Gone: a window the merchant closed moves the tour on, and so does the
        // merchant going on to the next step themselves (a builder's own Continue
        // showing the next step's element); anything else is looked for again.
        // (Never for the Home pointer: leaving Home for the feature's page isn't a step done.)
        const following = onPage && cur && guideSteps(cur.module)[cur.step + 1];
        const from = cur && { module: cur.module, step: cur.step };
        if (onPage && step?.advanceWhenGone) gRef.current.advanceWhenGone(from);
        else if (following && stepOnPage(following, window.location.pathname) && firstShown(following.target)) gRef.current.advanceByClick(from);
        else setSearch((n) => n + 1);
        return;
      }
      const r = target.getBoundingClientRect();
      const key = [r.top, r.left, r.width, r.height].map(Math.round).join(',');
      if (key !== last) { last = key; setRect({ top: r.top, left: r.left, width: r.width, height: r.height }); }
    };
    try {
      const r = target.getBoundingClientRect();
      target.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? 'start' : 'center', inline: 'nearest', behavior: 'smooth' });
    } catch { /* old browsers */ }
    update();
    const interval = setInterval(update, 200);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(interval);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // A floating panel (narrow screens) that covers the target folds itself away,
  // once per step: opened again from the pill, it stays open.
  const foldedFor = useRef(null);
  useEffect(() => {
    if (!rect || foldedFor.current === stepKey) return;
    const aside = document.querySelector('[data-guide-aside]');
    if (!aside || getComputedStyle(aside).position !== 'fixed') return;
    const a = aside.getBoundingClientRect();
    const overlaps = rect.left < a.right && rect.left + rect.width > a.left && rect.top < a.bottom && rect.top + rect.height > a.top;
    if (overlaps) { foldedFor.current = stepKey; gRef.current.setCollapsed(true); }
  }, [rect, stepKey]);

  // 5: the merchant's own click on the step's element.
  useEffect(() => {
    if (!stepKey || !step?.click) return undefined;
    const from = { module: cur.module, step: cur.step };
    const onClick = (event) => {
      if (!event.isTrusted) return;
      if (!event.target?.closest?.(tourSelector(step.click))) return;
      setTimeout(() => gRef.current.advanceByClick(from), 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  useIsoLayoutEffect(() => {
    const h = tipRef.current ? tipRef.current.offsetHeight : 0;
    if (h && h !== tipH) setTipH(h);
  });

  if (!stepKey || !step) return null;
  const total = guideSteps(cur.module).length;
  const isSave = onPage && step.kind === 'save';
  const checking = g.verify.module === cur.module && g.verify.phase === 'checking';
  const kicker = (
    <div className="brx-gs-tip-k">
      <span>{entry
        ? t('admin.guide.feature_of', { n: g.state.modules.indexOf(cur.module) + 1, total: g.state.modules.length })
        : t('admin.guide.step_count', { n: cur.step + 1, total })}</span>
      <button type="button" className="brx-gs-iconbtn" onClick={g.pause} aria-label={t('admin.guide.pause')} title={t('admin.guide.pause')} data-guide-tip-cancel><Icon source={XIcon} /></button>
    </div>
  );
  const actions = (
    <div className="brx-gs-tip-a">
      {onPage && cur.step > 0 && <button type="button" className="brx-gs-btn" onClick={g.prev} data-guide-tip-back>{t('admin.guide.back')}</button>}
      <button type="button" className="brx-gs-btn brx-gs-btn--primary" disabled={checking} onClick={g.next} data-guide-tip-next>
        {t(isSave ? 'admin.guide.check_finish' : 'admin.guide.next')}
      </button>
    </div>
  );

  if (missing && !rect) {
    const area = typeof window !== 'undefined' ? usableRight() : 800;
    return (
      <div ref={tipRef} className="brx-gs-tip" role="dialog" aria-label={step.title} data-guide-missing style={{ top: 80, left: Math.max(EDGE, (area - TIP_W) / 2) }}>
        {kicker}
        <div className="brx-gs-tip-t">{t('admin.guide.missing_title')}</div>
        <div>{t('admin.guide.missing_help', { title: step.title })}</div>
        <div className="brx-gs-tip-a">
          {entry && <button type="button" className="brx-gs-btn brx-gs-btn--primary" onClick={g.next}>{t('admin.guide.next')}</button>}
          {onPage && (isSave
            ? <button type="button" className="brx-gs-btn" onClick={g.skipModule}>{t('admin.guide.skip_feature')}</button>
            : <button type="button" className="brx-gs-btn" onClick={() => g.goToStep(cur.module, cur.step + 1)} data-guide-skip-step>{t('admin.guide.skip_step')}</button>)}
          {isSave && <button type="button" className="brx-gs-btn brx-gs-btn--primary" disabled={checking} onClick={g.next}>{t('admin.guide.check_finish')}</button>}
        </div>
      </div>
    );
  }
  if (!rect) return null;

  const tip = placeTip(rect, tipH);
  return (
    <>
      <div className="brx-gs-ring" data-guide-ring data-guide-target={step.target} aria-hidden="true"
        style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
      <div ref={tipRef} className="brx-gs-tip" role="dialog" aria-label={step.title} data-guide-tip style={{ top: tip.top, left: tip.left }}>
        {kicker}
        <div className="brx-gs-tip-t">{step.title}</div>
        <div>{checking ? t('admin.guide.checking') : step.body}</div>
        {actions}
      </div>
    </>
  );
}
