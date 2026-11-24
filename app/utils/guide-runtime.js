/**
 * What pages need from the guided setup (components/guide/), without
 * importing it:
 *  - guideOwnsModule(id): the guide is walking the merchant through this
 *    feature, so the page's own older tour (FBT's setup tour, Build a
 *    Combo's ComboSetupTour) must not start on top of it.
 *  - useGuideReveal(handler): the guide asks the page to show a step's
 *    element that sits behind state (a tab, a builder section); `handler(id)`
 *    gets the step's data-tour id and opens whatever holds it. Accordion rows
 *    with aria-expanded need nothing: the guide clicks them itself.
 */
import { useEffect, useRef } from 'react';

export const GUIDE_REVEAL_EVENT = 'brix:guide-reveal';

/** Set by GuideProvider while it renders, so it is in place before any page's mount effects run. */
export function setGuideActiveModule(moduleId) {
  if (typeof window !== 'undefined') window.__brixGuideModule = moduleId || null;
}

export function guideOwnsModule(moduleId) {
  return typeof window !== 'undefined' && window.__brixGuideModule === moduleId;
}

export function useGuideReveal(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onReveal = (event) => { if (event?.detail?.id) ref.current?.(event.detail.id); };
    window.addEventListener(GUIDE_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(GUIDE_REVEAL_EVENT, onReveal);
  }, []);
}
