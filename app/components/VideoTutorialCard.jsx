/* ─── VideoTutorialCard ───
 * A single, self-contained premium video-tutorial card: thumbnail (16:9,
 * gradient placeholder + glassmorphism play button + duration badge),
 * heading, clamped description, and a footer with category/difficulty
 * badges plus a "Watch Video" button. The whole card is clickable.
 */

export const VIDEO_CARD_STYLES = `
.brix-vt-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  transition: transform 250ms ease, box-shadow 250ms ease, border-color 250ms ease;
  cursor: pointer;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  outline: none;
  box-sizing: border-box;
}
.brix-vt-card:hover,
.brix-vt-card:focus-visible {
  transform: translateY(-4px);
  box-shadow: 0 14px 32px rgba(0,0,0,0.12), 0 4px 10px rgba(0,0,0,0.06);
  border-color: var(--brix-vt-accent, #1a9de0);
}
.brix-vt-card:focus-visible {
  box-shadow: 0 14px 32px rgba(0,0,0,0.12), 0 0 0 3px var(--brix-vt-accent-soft, rgba(26,157,224,0.35));
}
.brix-vt-thumb-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: #f3f4f6;
}
.brix-vt-thumb-img {
  position: absolute;
  inset: 0;
  transition: transform 250ms ease;
}
.brix-vt-card:hover .brix-vt-thumb-img,
.brix-vt-card:focus-visible .brix-vt-thumb-img {
  transform: scale(1.03);
}
.brix-vt-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 55%);
}
.brix-vt-play {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(1);
  background: rgba(255,255,255,0.22);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 250ms ease, background 250ms ease;
}
.brix-vt-card:hover .brix-vt-play,
.brix-vt-card:focus-visible .brix-vt-play {
  transform: translate(-50%, -50%) scale(1.1);
  background: rgba(255,255,255,0.32);
}
.brix-vt-duration {
  position: absolute;
  bottom: 14px;
  right: 10px;
  background: rgba(17,24,39,0.75);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  letter-spacing: 0.02em;
}
.brix-vt-progress-track {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(255,255,255,0.35);
}
.brix-vt-progress-fill {
  height: 100%;
  background: var(--brix-vt-accent, #1a9de0);
  transition: width 300ms ease;
}
.brix-vt-watched {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(16,185,129,0.25);
  border: 1px solid rgba(110,231,183,0.6);
  border-radius: 999px;
  padding: 3px 9px;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.brix-vt-heading {
  font-size: 20px;
  font-weight: 700;
  margin-top: 16px;
  color: #111827;
  line-height: 1.3;
}
.brix-vt-desc {
  font-size: 14px;
  line-height: 1.7;
  color: #6b7280;
  margin-top: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.brix-vt-footer {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.brix-vt-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.brix-vt-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  white-space: nowrap;
}
.brix-vt-watch-btn {
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 250ms ease, color 250ms ease;
  background: transparent;
  border: 1.5px solid var(--brix-vt-accent, #1a9de0);
  color: var(--brix-vt-accent, #1a9de0);
  white-space: nowrap;
}
.brix-vt-card:hover .brix-vt-watch-btn,
.brix-vt-card:focus-visible .brix-vt-watch-btn {
  background: var(--brix-vt-accent, #1a9de0);
  color: #fff;
}
@media (prefers-color-scheme: dark) {
  .brix-vt-card { background: #111827; border-color: #1f2937; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
  .brix-vt-card:hover, .brix-vt-card:focus-visible { box-shadow: 0 14px 32px rgba(0,0,0,0.55); }
  .brix-vt-thumb-wrap { background: #1f2937; }
  .brix-vt-heading { color: #f9fafb; }
  .brix-vt-desc { color: #9ca3af; }
}
@media (max-width: 640px) {
  .brix-vt-card { max-width: 100%; }
}
`;

const DIFFICULTY_STYLES = {
  Beginner:     { bg: '#dcfce7', color: '#15803d' },
  Intermediate: { bg: '#fef3c7', color: '#92400e' },
  Advanced:     { bg: '#fee2e2', color: '#b91c1c' },
};

export default function VideoTutorialCard({
  title,
  description,
  category,
  difficulty = 'Beginner',
  duration,
  accent = '#1a9de0',
  watched = false,
  progressPct = 0,
  onPlay,
}) {
  const diff = DIFFICULTY_STYLES[difficulty] || DIFFICULTY_STYLES.Beginner;

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlay?.();
    }
  };

  return (
    <div
      className="brix-vt-card"
      style={{ '--brix-vt-accent': accent, '--brix-vt-accent-soft': `${accent}59` }}
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={handleKeyDown}
      aria-label={`Watch tutorial: ${title}`}
    >
      <div className="brix-vt-thumb-wrap">
        <div className="brix-vt-thumb-img" style={{ background: `linear-gradient(135deg, ${accent}38, ${accent}0d)` }} />
        <div className="brix-vt-overlay" />
        {watched && (
          <div className="brix-vt-watched">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>Watched</span>
          </div>
        )}
        <div className="brix-vt-play" aria-label={`Play video: ${title}`}>
          <div style={{ width: 0, height: 0, borderTop: '11px solid transparent', borderBottom: '11px solid transparent', borderLeft: '18px solid #fff', marginLeft: 4 }} />
        </div>
        <span className="brix-vt-duration">{duration}</span>
        {progressPct > 0 && (
          <div className="brix-vt-progress-track" aria-hidden="true">
            <div className="brix-vt-progress-fill" style={{ width: `${Math.min(100, progressPct)}%` }} />
          </div>
        )}
      </div>

      <div className="brix-vt-heading">{title}</div>
      <div className="brix-vt-desc">{description}</div>

      <div className="brix-vt-footer">
        <div className="brix-vt-badges">
          {category && <span className="brix-vt-badge" style={{ background: `${accent}18`, color: accent }}>{category}</span>}
          <span className="brix-vt-badge" style={{ background: diff.bg, color: diff.color }}>{difficulty}</span>
        </div>
        <button
          type="button"
          className="brix-vt-watch-btn"
          onClick={(e) => { e.stopPropagation(); onPlay?.(); }}
        >
          Watch Video
        </button>
      </div>
    </div>
  );
}
