import { useEffect, useState } from 'react';

// One step of a guided tour: dims the page, rings the target element and floats
// a callout card next to it. Selector-based (the target is found in the DOM,
// waiting for it to mount), so a tour can point at elements owned by other
// components without threading refs. Non-blocking: the dim layer does not
// intercept clicks, so the merchant can simply do what the step says.
//
// `element` is the resolved DOM node, or null for a centered card (no target).
// eslint-disable-next-line react/prop-types
export default function TourPointer({ element, stepNumber, totalSteps, title, children, nextLabel = 'Next', onNext, onBack, canGoBack, onSkip, nextDisabled = false, hideNext = false, centered = false }) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    setRect(null);
    if (!element) return undefined;
    try { element.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old browsers */ }
    const update = () => {
      const r = element.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom });
    };
    update();
    const settle = setTimeout(update, 350); // once the smooth scroll has settled
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      clearTimeout(settle);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [element]);

  if (!centered && !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardWidth = centered ? Math.min(460, vw - 32) : 320;
  const cardHeight = 170;
  const margin = 16;
  let cardTop;
  let cardLeft;
  if (centered) {
    cardTop = Math.max(margin, (vh - 320) / 2);
    cardLeft = (vw - cardWidth) / 2;
  } else {
    const below = vh - rect.bottom;
    const above = rect.top;
    if (rect.height > vh * 0.6) {
      // A target that fills the screen (a grid of cards): park the callout in the
      // top-right corner so it never sits on top of what the merchant must click.
      cardTop = margin;
      cardLeft = vw - cardWidth - margin;
    } else {
      if (below >= cardHeight + margin) cardTop = rect.bottom + 12;
      else if (above >= cardHeight + margin) cardTop = rect.top - cardHeight - 12;
      else cardTop = vh - cardHeight - margin;
      cardTop = Math.max(margin, Math.min(cardTop, vh - cardHeight - margin));
      cardLeft = Math.min(Math.max(rect.left, margin), vw - cardWidth - margin);
    }
  }

  return (
    <>
      {centered ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,17,0.5)', zIndex: 10500, pointerEvents: 'none' }} />
      ) : (
        <div
          data-testid="tour-spotlight"
          style={{
            position: 'fixed', top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8,
            borderRadius: 10, border: '2px solid #008060', boxShadow: '0 0 0 4000px rgba(15,17,17,0.5)',
            pointerEvents: 'none', zIndex: 10500, transition: 'all .25s ease',
          }}
        />
      )}
      <div
        role="dialog"
        aria-label={title}
        data-testid="tour-card"
        style={{
          position: 'fixed', top: cardTop, left: cardLeft, width: cardWidth, background: '#202223', color: '#fff',
          borderRadius: 12, padding: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.35)', zIndex: 10501,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: '#9aa0a3', textTransform: 'uppercase' }}>Step {stepNumber} of {totalSteps}</span>
            <span aria-hidden="true" style={{ display: 'flex', gap: 4 }}>
              {Array.from({ length: totalSteps }, (_, i) => (
                <span key={i} style={{ width: i + 1 === stepNumber ? 14 : 5, height: 5, borderRadius: 3, background: i + 1 <= stepNumber ? '#22c55e' : '#45484a', transition: 'width .2s' }} />
              ))}
            </span>
          </span>
          <button type="button" onClick={onSkip} aria-label="Skip setup tour" style={{ border: 'none', background: 'transparent', color: '#9aa0a3', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}>&times;</button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#c9cccf', lineHeight: 1.5, marginBottom: 14 }}>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={onSkip} style={{ border: 'none', background: 'transparent', color: '#9aa0a3', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>Skip tour</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canGoBack && (
              <button type="button" onClick={onBack} style={{ border: '1px solid #45484a', background: 'transparent', color: '#e3e5e7', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 8 }}>Back</button>
            )}
            {!hideNext && <button type="button" onClick={onNext} disabled={nextDisabled} style={{ border: 'none', background: '#008060', color: '#fff', cursor: nextDisabled ? 'default' : 'pointer', opacity: nextDisabled ? 0.6 : 1, fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8 }}>{nextLabel}</button>}
          </div>
        </div>
      </div>
    </>
  );
}
