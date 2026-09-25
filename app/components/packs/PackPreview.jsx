/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useState } from 'react';
import { mergeCustomization } from '../../utils/packs.shared.js';

/**
 * Admin-side preview of the storefront Packs widget. It mirrors the storefront
 * templates and customization (app/storefront/packs-widget.js) but ONLY renders
 * values it is given — tier prices come from the shared/server calculation, so
 * the preview can never disagree with what the server computed.
 *
 * Props:
 *  - template: 'same_variant' | 'choose_each_item' | 'visual_offer'
 *  - customization: partial or full customization object (merged over defaults)
 *  - tiers: [{ name, quantity, badge, discountType, subtotal, savings, price, formatted? }]
 *  - productImage: string
 *  - formatMoney: (number) => string
 */
export default function PackPreview({ template, customization, tiers, productImage, formatMoney }) {
  const custom = mergeCustomization(customization);
  const [selected, setSelected] = useState(0);
  const { colors, borders, typography, spacing, content, savings, images } = custom;
  const active = Math.min(selected, Math.max(0, tiers.length - 1));
  const border = `${borders.width}px ${borders.style} ${colors.border}`;

  const saveText = (tier) => {
    if (!savings.visible || !(tier.savings > 0)) return null;
    if (savings.mode === 'save_percent') return `Save ${Math.round((tier.savings / tier.subtotal) * 1000) / 10}%`;
    return `Save ${formatMoney(tier.savings)}`;
  };

  const widgetStyle = {
    margin: 0, padding: spacing.cardPadding, background: colors.background, color: colors.text, border, borderRadius: borders.radius,
    boxShadow: borders.shadow ? '0 2px 10px rgba(0,0,0,.14)' : 'none', boxSizing: 'border-box',
  };
  const isVisual = template === 'visual_offer';

  return (
    <section style={widgetStyle} aria-label="Storefront preview">
      <div style={{ textAlign: typography.alignment }}>
        {content.heading && <h3 style={{ margin: '0 0 4px', fontSize: typography.headingSize, fontWeight: typography.fontWeight, color: colors.text }}>{content.heading}</h3>}
        {content.subheading && <p style={{ margin: `0 0 ${spacing.cardGap + 4}px`, fontSize: typography.descriptionSize, opacity: 0.75 }}>{content.subheading}</p>}
      </div>
      <div role="radiogroup" style={{ display: 'grid', gap: spacing.cardGap, gridTemplateColumns: isVisual ? 'repeat(auto-fit, minmax(130px, 1fr))' : '1fr' }}>
        {tiers.length === 0 && <div style={{ fontSize: 13, opacity: 0.7 }}>Add valid tiers to preview prices.</div>}
        {tiers.map((tier, index) => {
          const isSelected = index === active;
          const save = saveText(tier);
          return (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(index)}
              style={{
                position: 'relative', display: 'grid', alignItems: 'center', columnGap: 12, rowGap: 6, width: '100%', padding: spacing.cardPadding, paddingTop: isVisual ? spacing.cardPadding + 6 : spacing.cardPadding,
                gridTemplateColumns: isVisual ? (images.position === 'left' ? 'auto 1fr auto' : '1fr') : 'auto 1fr auto',
                background: isSelected ? colors.selectedCard : colors.cardBackground, color: colors.text, textAlign: isVisual && images.position !== 'left' ? 'center' : 'left', justifyItems: isVisual && images.position !== 'left' ? 'center' : 'stretch',
                border: isSelected ? `${borders.width}px ${borders.style} ${colors.primary}` : border, borderRadius: borders.radius, font: 'inherit', cursor: 'pointer', boxShadow: isSelected ? `0 0 0 1px ${colors.primary}` : 'none',
              }}
            >
              {!isVisual && <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${isSelected ? colors.primary : colors.border}`, background: isSelected ? `radial-gradient(${colors.primary} 40%, transparent 45%)` : 'transparent' }} />}
              {isVisual && images.enabled && productImage && <img src={productImage} alt="" style={{ width: { small: 48, medium: 72, large: 104 }[images.size], height: { small: 48, medium: 72, large: 104 }[images.size], objectFit: 'cover', borderRadius: borders.radius / 2 }} />}
              <span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: isVisual && images.position !== 'left' ? 'center' : 'flex-start', fontSize: typography.packTitleSize, fontWeight: typography.fontWeight }}>
                  {tier.name || `Buy ${tier.quantity}`}
                  {tier.badge && <span style={{ padding: '2px 8px', background: colors.badge, color: colors.text, borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', ...(isVisual ? { position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' } : {}) }}>{tier.badge}</span>}
                </span>
                <span style={{ display: 'block', fontSize: typography.descriptionSize, opacity: 0.75 }}>{tier.quantity} item{tier.quantity === 1 ? '' : 's'}</span>
              </span>
              <span style={{ textAlign: isVisual && images.position !== 'left' ? 'center' : 'right', color: colors.price }}>
                {tier.savings > 0 && <span style={{ display: 'block', fontSize: typography.descriptionSize, textDecoration: 'line-through', opacity: 0.6 }}>{formatMoney(tier.subtotal)}</span>}
                <strong style={{ display: 'block', fontSize: typography.priceSize, fontWeight: typography.fontWeight }}>{formatMoney(tier.price)}</strong>
                {save && <span style={{ display: 'block', fontSize: typography.descriptionSize, fontWeight: 600, color: colors.discount }}>{save}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {template === 'choose_each_item' && tiers[active] && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {Array.from({ length: Math.min(tiers[active].quantity, 6) }, (_, index) => (
            <label key={index} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'center', fontSize: typography.descriptionSize }}>
              <span>Item {index + 1}</span>
              <select disabled style={{ padding: 8, font: 'inherit', border: `1px solid ${colors.border}`, borderRadius: borders.radius / 2, background: colors.cardBackground, color: colors.text }}><option>Choose a variant</option></select>
            </label>
          ))}
        </div>
      )}
      {content.promoText && <p style={{ margin: '12px 0 0', fontSize: typography.descriptionSize, opacity: 0.8, textAlign: typography.alignment }}>{content.promoText}</p>}
      <button type="button" style={{ display: 'block', width: '100%', marginTop: spacing.buttonSpacing, padding: '13px 16px', background: colors.button, color: colors.buttonText, border: 0, borderRadius: borders.radius, font: 'inherit', fontWeight: 700, cursor: 'default' }}>{content.cta || 'Add Pack to Cart'}</button>
    </section>
  );
}
