/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
/**
 * Wraps every /app page (routes/app.jsx). With no panel showing it is a plain
 * block, so pages look exactly as before. While the tour runs, the steps
 * panel sits on the right (beside the page on wide screens; over it, and
 * folding away, on narrow ones); `--brix-guide-space` on <html> then tells
 * fixed widgets on the right (support chat, BrixBar) to keep clear of it.
 * Guide closed, only the pill at the bottom stays. The questions are a box
 * in the middle of the screen (GuideQuestions).
 */
import { useEffect } from 'react';
import { useGuide } from './GuideProvider';
import GuidePanel, { GuidePill } from './GuidePanel';
import GuideSpotlight from './GuideSpotlight';
import GuideQuestions from './GuideQuestions';
import { GUIDE_CSS, GUIDE_PANEL_WIDTH } from './guide-styles';

export default function GuideShell({ children }) {
  const g = useGuide();
  const open = g.panelVisible;

  useEffect(() => {
    const root = document.documentElement;
    const wide = window.matchMedia('(min-width: 1100px)');
    const apply = () => {
      if (open && wide.matches) root.style.setProperty('--brix-guide-space', `${GUIDE_PANEL_WIDTH}px`);
      else root.style.removeProperty('--brix-guide-space');
    };
    apply();
    wide.addEventListener?.('change', apply);
    return () => { wide.removeEventListener?.('change', apply); root.style.removeProperty('--brix-guide-space'); };
  }, [open]);

  return (
    <div className={`brx-gs${open ? ' has-panel' : ''}${g.onHome ? ' is-home' : ''}`}>
      <style>{GUIDE_CSS}</style>
      <div className="brx-gs-main">{children}</div>
      {open && <GuidePanel />}
      {g.pillVisible && <GuidePill />}
      {g.questionsVisible && <GuideQuestions />}
      <GuideSpotlight />
    </div>
  );
}
