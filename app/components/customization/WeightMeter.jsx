import { boxMessage, formatWeight, tierLabel } from '../../utils/combo-weight.shared.js';

/**
 * The weight meter for weight-priced combos, in React: the admin preview
 * route and the builder's live preview. The storefront draws the same thing
 * in plain JS (renderWeightMeter in combo-page[.]js.jsx); both word it with
 * the shared core's boxMessage().
 *   view = { tiers, unit, maxGrams, messages, enabled }
 *   box  = computeBox() result
 */
export default function WeightMeter({ view, box, config = {}, style }) {
  const tiers = view.tiers || [];
  const top = tiers.length ? tiers[tiers.length - 1].min_grams : 1000;
  const scale = view.maxGrams != null ? view.maxGrams : Math.round(top * 1.2);
  const percent = scale > 0 ? Math.min(100, (box.grams / scale) * 100) : 0;
  const msg = boxMessage(view, box);
  const success = config.progress_success_color || '#16a34a';
  const textColor = config.progress_text_color || '#374151';
  const barColor = box.overMax ? '#dc2626' : (box.tier && view.enabled ? success : (config.progress_bar_color || '#111827'));
  const toneColor = msg.tone === 'error' ? '#b91c1c' : msg.tone === 'success' ? success : textColor;

  return (
    <div style={{ padding: '16px 20px', background: '#fff', borderBottom: '1px solid #eee', ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 10, color: textColor }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{config.progress_text || 'Your box'}</span>
        <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {formatWeight(box.grams, view.unit)}
          {view.maxGrams != null && <span style={{ fontWeight: 500, color: '#6b7280' }}> / {formatWeight(view.maxGrams, view.unit)} max</span>}
        </span>
      </div>
      <div
        role="progressbar" aria-label="Box weight" aria-valuemin={0} aria-valuemax={scale} aria-valuenow={Math.round(box.grams)}
        style={{ position: 'relative', height: 10, borderRadius: 10, background: '#e5e7eb', overflow: 'hidden' }}
      >
        <div style={{ height: '100%', width: `${percent}%`, background: barColor, borderRadius: 10, transition: 'width 0.4s ease, background 0.3s' }} />
      </div>
      {view.enabled && tiers.length > 0 && (
        <div style={{ position: 'relative', height: 30, marginTop: 4 }}>
          {tiers.map((tier) => {
            const left = scale > 0 ? Math.min(100, (tier.min_grams / scale) * 100) : 0;
            const reached = box.grams >= tier.min_grams && !box.overMax;
            return (
              <div
                key={tier.id || tier.min_grams}
                title={tierLabel(tier, view.unit)}
                style={{
                  position: 'absolute', left: `${left}%`, top: 0,
                  transform: left > 90 ? 'translateX(-100%)' : left < 10 ? 'none' : 'translateX(-50%)',
                  fontSize: 11, lineHeight: 1.3, whiteSpace: 'nowrap', textAlign: 'center',
                  color: reached ? success : '#6b7280', fontWeight: reached ? 700 : 500,
                }}
              >
                <div style={{ width: 2, height: 6, background: 'currentColor', margin: '0 auto 2px' }} />
                {formatWeight(tier.min_grams, view.unit)}
              </div>
            );
          })}
        </div>
      )}
      <div aria-live="polite" style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: toneColor }}>{msg.text}</div>
      {box.unweighedKeys?.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}>
          {box.unweighedKeys.length} selected item{box.unweighedKeys.length === 1 ? ' has' : 's have'} no weight and {box.unweighedKeys.length === 1 ? "doesn't" : "don't"} count toward the box.
        </div>
      )}
    </div>
  );
}
