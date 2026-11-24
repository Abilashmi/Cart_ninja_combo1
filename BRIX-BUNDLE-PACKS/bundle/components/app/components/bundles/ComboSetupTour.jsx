import { useCallback, useEffect, useRef, useState } from 'react';
import TourPointer from '../tour/TourPointer';
import { EmbedSteps } from './CartDrawerEmbedBanner';
import { cartDrawerEmbedEditorUrl } from '../../config/theme-extension';
import {
  COMBO_TOUR_EVENT, COMBO_TOUR_STEPS, readTour, dismissTour, finishTour, goToStep, nextStepOnPage, setTourShop,
} from '../../utils/combo-tour';

// The Build a Combo setup tour. Mounted by each screen that owns steps
// (`page`: 'dashboard' | 'picker' | 'builder'); it shows only the current
// step's card when that step belongs to the page it is mounted on, so the tour
// carries on across the route changes of the combo flow.
//
//  - `beforeStep(stepId)`: the page can open something the step points at
//    (e.g. the builder opens the Coupon section before pointing at it).
//  - A target that never appears is skipped (or ends the tour on the first
//    step), so a plan-gated or missing element can't strand the merchant.

const TARGET_WAIT_MS = 4000;

function useTourState() {
  const [state, setState] = useState(() => (typeof window === 'undefined' ? null : readTour()));
  useEffect(() => {
    const sync = () => setState(readTour());
    sync();
    window.addEventListener(COMBO_TOUR_EVENT, sync);
    return () => window.removeEventListener(COMBO_TOUR_EVENT, sync);
  }, []);
  return state;
}

// Resolves a selector to its element, waiting for it to mount.
function useTargetElement(selector, active, onMissing) {
  const [element, setElement] = useState(null);
  const missingRef = useRef(onMissing);
  missingRef.current = onMissing;
  useEffect(() => {
    setElement(null);
    if (!active || !selector) return undefined;
    const started = Date.now();
    let timer;
    const tick = () => {
      const found = Array.from(document.querySelectorAll(selector)).find((n) => n.getClientRects().length > 0) || null;
      if (found) { setElement(found); return; }
      if (Date.now() - started > TARGET_WAIT_MS) { missingRef.current?.(); return; }
      timer = setTimeout(tick, 250);
    };
    tick();
    return () => clearTimeout(timer);
  }, [selector, active]);
  return element;
}

function EmbedStep({ shop, onFinish, onBack, canGoBack, onSkip, total, number }) {
  const [status, setStatus] = useState({ state: 'checking' }); // checking | on | off | unknown
  const editorUrl = shop ? cartDrawerEmbedEditorUrl(shop) : null;

  const check = useCallback(async () => {
    setStatus({ state: 'checking' });
    try {
      const res = await fetch('/api/theme-embed-status');
      const data = await res.json();
      if (!data?.checked) setStatus({ state: 'unknown', editorUrl: data?.editorUrl });
      else setStatus({ state: data.enabled ? 'on' : 'off', editorUrl: data?.editorUrl });
    } catch {
      setStatus({ state: 'unknown' });
    }
  }, []);
  useEffect(() => { check(); }, [check]);

  const link = status.editorUrl || editorUrl;
  const chip = {
    checking: { text: 'Checking your theme…', bg: '#3a3d3f', fg: '#c9cccf' },
    on: { text: 'On. Your combo pages will show up.', bg: '#0f3d2a', fg: '#7ee2a8' },
    off: { text: 'Off. Combo pages will not show yet.', bg: '#4a2a12', fg: '#ffc58a' },
    unknown: { text: "We couldn't check. Please confirm it is on.", bg: '#3a3d3f', fg: '#c9cccf' },
  }[status.state];

  return (
    <TourPointer
      centered
      element={null}
      stepNumber={number}
      totalSteps={total}
      title="Last step: turn on the app embed"
      nextLabel="Finish"
      onNext={onFinish}
      onBack={onBack}
      canGoBack={canGoBack}
      onSkip={onSkip}
    >
      <div data-testid="tour-embed-step">
        <p style={{ margin: '0 0 10px' }}>
          Combo pages are shown by the <strong>Cart Drawer app embed</strong>. Until it is switched on in your theme, your combo will not appear on your store.
        </p>
        <div data-testid="tour-embed-status" style={{ background: chip.bg, color: chip.fg, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>{chip.text}</div>
        {status.state !== 'on' && (
          <>
            <div style={{ background: '#fff', color: '#202223', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 12.5 }}>
              <EmbedSteps />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {link && (
                <a href={link} target="_blank" rel="noreferrer" style={{ background: '#fff', color: '#202223', textDecoration: 'none', fontWeight: 600, fontSize: 13, padding: '7px 14px', borderRadius: 8 }}>Open theme editor</a>
              )}
              <button type="button" onClick={check} disabled={status.state === 'checking'} style={{ border: '1px solid #45484a', background: 'transparent', color: '#e3e5e7', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 8 }}>
                {status.state === 'checking' ? 'Checking…' : "I've turned it on, check again"}
              </button>
            </div>
          </>
        )}
      </div>
    </TourPointer>
  );
}

// eslint-disable-next-line react/prop-types
export default function ComboSetupTour({ page, shop, beforeStep }) {
  setTourShop(shop); // before anything reads the saved state
  const tour = useTourState();
  const active = tour?.status === 'active';
  const step = active ? COMBO_TOUR_STEPS[tour.step] : null;
  const ownsStep = !!step && step.page === page;
  const total = COMBO_TOUR_STEPS.length;

  const advance = useCallback(() => {
    const from = tour?.step ?? 0;
    if (from >= total - 1) { finishTour(); return; }
    goToStep(from + 1);
  }, [tour, total]);

  const back = useCallback(() => {
    const prev = nextStepOnPage((tour?.step ?? 0) - 1, -1, page);
    if (prev !== -1) goToStep(prev);
  }, [tour, page]);

  const skip = useCallback(() => dismissTour(tour?.step ?? 0), [tour]);

  // A target that never shows up is skipped; on the first step it just ends.
  const onMissing = useCallback(() => {
    if ((tour?.step ?? 0) === 0) dismissTour(0);
    else advance();
  }, [tour, advance]);

  const element = useTargetElement(step?.target, ownsStep && !!step?.target, onMissing);

  // Let the page open whatever the step points at (once per step).
  useEffect(() => {
    if (ownsStep && step?.beforeStep) beforeStep?.(step.beforeStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownsStep, step?.id]);

  // Some steps finish by themselves when the merchant does the thing asked.
  useEffect(() => {
    if (!ownsStep || !step?.advanceOnClick) return undefined;
    const onClick = (e) => {
      if (e.target?.closest?.(step.advanceOnClick)) setTimeout(advance, 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [ownsStep, step, advance]);

  if (!ownsStep) return null;

  if (step.kind === 'embed') {
    return (
      <EmbedStep
        shop={shop}
        number={tour.step + 1}
        total={total}
        onFinish={() => finishTour()}
        onBack={back}
        canGoBack={nextStepOnPage(tour.step - 1, -1, page) !== -1}
        onSkip={skip}
      />
    );
  }

  return (
    <TourPointer
      element={element}
      stepNumber={tour.step + 1}
      totalSteps={total}
      title={step.title}
      nextLabel={step.nextLabel || 'Next'}
      hideNext={!!step.hideNext}
      onNext={() => (step.clickTarget && element ? element.click() : advance())}
      onBack={back}
      canGoBack={nextStepOnPage(tour.step - 1, -1, page) !== -1}
      onSkip={skip}
    >
      {step.body}
    </TourPointer>
  );
}
