import { useEffect, useState } from 'react';
import { announcementMessages, clampInterval } from '../utils/announcement.shared.js';

/**
 * Cart Editor preview of the announcement bar. One message = static text;
 * 2+ = one at a time, auto-rotating every `interval` seconds (paused on
 * hover) with optional ‹ › arrows. Same behaviour as the storefront's
 * #cc-announcement-bar in cart_drawer_inline.js.
 */
export function AnnouncementRotator({ ann, className, style, placeholder }) {
  const messages = announcementMessages(ann);
  const count = messages.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const autoRotate = ann?.autoRotate !== false;
  const showArrows = ann?.showArrows !== false;
  const seconds = clampInterval(ann?.interval ?? 4);

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  useEffect(() => {
    if (count < 2 || !autoRotate || paused) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), seconds * 1000);
    return () => clearInterval(t);
  }, [count, autoRotate, paused, seconds]);

  if (count < 2) {
    return <div className={className} style={style}>{messages[0] || placeholder}</div>;
  }

  const go = (e, step) => {
    e.stopPropagation();
    setIndex((i) => (i + step + count) % count);
  };
  const arrowStyle = { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.3em', lineHeight: 1, padding: '0 4px', opacity: 0.85, flexShrink: 0 };
  const current = messages[Math.min(index, count - 1)];

  return (
    <div
      className={`${className} cart-preview-announcement--rotating`}
      style={{ ...style, display: 'flex', alignItems: 'center', gap: 6 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {showArrows && <button type="button" aria-label="Previous announcement" style={arrowStyle} onClick={(e) => go(e, -1)}>‹</button>}
      <div key={index} className="cart-preview-announcement-msg" style={{ flex: 1, minWidth: 0, textAlign: style?.textAlign || 'center' }}>
        {current}
      </div>
      {showArrows && <button type="button" aria-label="Next announcement" style={arrowStyle} onClick={(e) => go(e, 1)}>›</button>}
    </div>
  );
}
