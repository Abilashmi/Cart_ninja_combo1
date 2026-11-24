import { boxMessage, formatAmount, formatThreshold, measureOf, offerLabel, progressOf } from '../../utils/combo-weight.shared.js';

/**
 * The box progress meter for tier-priced combos (Classic Combo designs), in
 * React: the admin preview route and the builder's live preview. The
 * storefront draws the same thing in plain JS (renderWeightMeter in
 * combo-page[.]js.jsx); both use the shared core (progressOf, boxMessage,
 * offerLabel), so every measure (weight, quantity, value) reads the same.
 *   view = { tiers, unit, maxGrams, messages, enabled, measure, currencySymbol }
 *   box  = computeBox() result
 * config.tier_progress_style: 'milestones' (default; a dot per tier with its
 * offer) or 'bar' (a plain bar with threshold ticks).
 */
export default function WeightMeter({ view, box, config = {}, style }) {
  const tiers = view.tiers || [];
  const measure = measureOf(view);
  const symbol = view.currencySymbol || '';
  const fmtView = { ...view, measure, currencySymbol: symbol };
  const progress = progressOf(fmtView, box);
  // The message names the offer ("10% OFF unlocked!"), like the milestones.
  const offered = (t) => (t ? { ...t, label: offerLabel(t, measure, symbol) } : t);
  const msg = boxMessage(fmtView, { ...box, tier: offered(box.tier), nextTier: offered(box.nextTier) });
  const milestones = (config.tier_progress_style || 'milestones') !== 'bar';
  const success = config.progress_success_color || '#16a34a';
  const textColor = config.progress_text_color || '#374151';
  const barColor = box.overMax ? '#dc2626' : (box.tier && view.enabled ? success : (config.progress_bar_color || '#111827'));
  const toneColor = msg.tone === 'error' ? '#b91c1c' : msg.tone === 'success' ? success : textColor;
  const amount = box.amount === undefined ? box.grams : box.amount;
  const showMax = view.maxGrams != null && measure !== 'value';
  const heading = config.progress_text || 'Your box';

  return (
    <div data-brix-tier-meter={milestones ? 'milestones' : 'bar'} style={{ padding: '16px 20px', background: '#fff', borderBottom: '1px solid #eee', ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 10, color: textColor }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{heading}</span>
        <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {formatAmount(fmtView, amount, box.decimals)}
          {showMax && <span style={{ fontWeight: 500, color: '#6b7280' }}> / {formatAmount(fmtView, view.maxGrams, box.decimals)} max</span>}
        </span>
      </div>
      <div style={{ position: 'relative', padding: milestones ? '0 9px' : 0 }}>
        <div
          role="progressbar" aria-label={heading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.percent)}
          style={{ position: 'relative', height: milestones ? 8 : 10, borderRadius: 10, background: '#e5e7eb' }}
        >
          <div style={{ height: '100%', width: `${progress.percent}%`, background: barColor, borderRadius: 10, transition: 'width 0.4s ease, background 0.3s' }} />
          {milestones && progress.marks.map((mark) => (
            <span
              key={mark.tier.id || mark.tier.min_grams}
              style={{
                position: 'absolute', top: '50%', left: `${mark.percent}%`, width: 18, height: 18, borderRadius: '50%',
                transform: 'translate(-50%, -50%)', boxSizing: 'border-box',
                background: mark.hit && view.enabled ? success : '#fff',
                border: `2px solid ${mark.hit && view.enabled ? success : mark.next ? barColor : '#d1d5db'}`,
                color: '#fff', fontSize: 11, lineHeight: '14px', textAlign: 'center', fontWeight: 800,
              }}
            >{mark.hit && view.enabled ? '✓' : ''}</span>
          ))}
        </div>
        {tiers.length > 0 && (
          <div style={{ position: 'relative', height: milestones ? 36 : 30, marginTop: milestones ? 10 : 4 }}>
            {progress.marks.map((mark) => {
              const left = mark.percent;
              const reached = mark.hit;
              return (
                <div
                  key={mark.tier.id || mark.tier.min_grams}
                  style={{
                    position: 'absolute', left: `${left}%`, top: 0,
                    transform: left > 85 ? 'translateX(-100%)' : left < 15 ? 'none' : 'translateX(-50%)',
                    fontSize: 11, lineHeight: 1.3, whiteSpace: 'nowrap', textAlign: left > 85 ? 'right' : left < 15 ? 'left' : 'center',
                    color: reached ? success : '#6b7280', fontWeight: reached ? 700 : 500,
                  }}
                >
                  {!milestones && <div style={{ width: 2, height: 6, background: 'currentColor', margin: '0 auto 2px' }} />}
                  {milestones && view.enabled && <div style={{ fontWeight: 800, color: reached ? success : textColor }}>{offerLabel(mark.tier, measure, symbol)}</div>}
                  <div>{formatThreshold(fmtView, mark.tier)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div aria-live="polite" style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: toneColor }}>{msg.text}</div>
      {measure === 'weight' && box.unweighedKeys?.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}>
          {box.unweighedKeys.length} selected item{box.unweighedKeys.length === 1 ? ' has' : 's have'} no weight and {box.unweighedKeys.length === 1 ? "doesn't" : "don't"} count toward the box.
        </div>
      )}
    </div>
  );
}
