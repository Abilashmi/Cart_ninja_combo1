/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { mergeCustomization, tierLabel, calculateTierFromPrices } from '../../utils/packs.shared.js';

function Checkmark({ size = 11, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5L6.5 12L13 4.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Each design preset is a structurally different layout — kept identical to
// layoutOf in app/storefront/packs-widget.js so the preview matches the store:
//   classic -> 'list', highlight -> 'chips' (compact selector), premium -> 'cards'.
// Packs saved with the old "image cards" template keep their card layout.
export function layoutOf(preset, template) {
  if (preset === 'highlight') return 'chips';
  if (preset === 'premium' || template === 'visual_offer') return 'cards';
  return 'list';
}

/**
 * Admin-side preview of the storefront Packs widget. It mirrors the storefront
 * templates and customization (app/storefront/packs-widget.js) but ONLY renders
 * values it is given — tier prices come from the shared/server calculation, so
 * the preview can never disagree with what the server computed.
 *
 * Props:
 *  - template: 'same_variant' | 'choose_each_item' | 'visual_offer'
 *  - packType: 'same_variant' | 'mix_match' (variant coverage/behavior; template only drives layout)
 *  - variants: live variants this Pack covers — [{ id, title, price, availableForSale }],
 *    only passed when there's more than the one anchor variant to preview.
 *  - customization: partial or full customization object (merged over defaults)
 *  - tiers: [{ name, quantity, badge, discountType, subtotal, savings, price, formatted? }]
 *  - productImage: string
 *  - formatMoney: (number) => string
 *  - compact: true for a phone-width preview (offer cards drop to 2 columns, like the storefront)
 */
export default function PackPreview({ template, packType, variants, customization, tiers, productImage, formatMoney, compact = false }) {
  const custom = mergeCustomization(customization);
  const [selected, setSelected] = useState(0);
  const [chosen, setChosen] = useState([]);
  const multiVariant = packType !== 'mix_match' && Array.isArray(variants) && variants.length > 1;
  const [activeVariantId, setActiveVariantId] = useState(() => variants?.[0]?.id || null);
  const { colors, borders, typography, spacing, content, savings, images, design } = custom;
  const active = Math.min(selected, Math.max(0, tiers.length - 1));
  const border = `${borders.width}px ${borders.style} ${colors.border}`;

  // Same Variant covering more than one variant: prices depend on whichever
  // variant is "selected" — simulated here with a switcher, mirroring how the
  // storefront widget reacts to the theme's real variant picker.
  useEffect(() => {
    if (!multiVariant) return;
    if (!variants.some((variant) => variant.id === activeVariantId)) setActiveVariantId(variants[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiVariant, variants]);

  const displayTiers = useMemo(() => {
    if (!multiVariant) return tiers;
    const activeVariant = variants.find((variant) => variant.id === activeVariantId) || variants[0];
    const unitPrice = activeVariant ? activeVariant.price : 0;
    return tiers.map((tier) => {
      const prices = Array.from({ length: Math.max(0, tier.quantity) }, () => unitPrice);
      const calc = calculateTierFromPrices(prices, tier);
      return { ...tier, subtotal: calc.subtotal, discountAmount: calc.discountAmount, price: calc.price, savings: calc.savings, effectiveUnitPrice: calc.effectiveUnitPrice };
    });
  }, [multiVariant, tiers, variants, activeVariantId]);

  const activeTier = displayTiers[active];
  const mixMatchVariants = packType === 'mix_match' && Array.isArray(variants) && variants.length > 0 ? variants : null;
  useEffect(() => {
    if (!mixMatchVariants || !activeTier) return;
    setChosen((current) => Array.from({ length: Math.max(0, activeTier.quantity) }, (_, index) => current[index] || mixMatchVariants[0]?.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixMatchVariants, activeTier?.quantity]);
  const mixMatchCalc = useMemo(() => {
    if (!mixMatchVariants || !activeTier) return null;
    const prices = chosen.map((id) => mixMatchVariants.find((variant) => variant.id === id)?.price ?? 0);
    return calculateTierFromPrices(prices.length ? prices : [0], activeTier);
  }, [mixMatchVariants, activeTier, chosen]);

  const saveWord = (savings.label || 'Save').trim() || 'Save';
  const saveText = (tier) => {
    if (!savings.visible || !(tier.savings > 0)) return null;
    if (savings.mode === 'save_percent') return `${saveWord} ${Math.round((tier.savings / tier.subtotal) * 1000) / 10}%`;
    return `${saveWord} ${formatMoney(tier.savings)}`;
  };

  const widgetStyle = {
    margin: 0, padding: spacing.cardPadding, background: colors.background, color: colors.text, border, borderRadius: borders.radius,
    boxShadow: borders.shadow ? '0 2px 10px rgba(0,0,0,.14)' : 'none', boxSizing: 'border-box',
  };
  const layout = layoutOf(design.preset, template);
  const isCards = layout === 'cards';
  const isChips = layout === 'chips';
  const cardsCentered = isCards && images.position !== 'left';
  const showImage = Boolean(images.enabled && productImage);
  const imageSize = { small: 48, medium: 72, large: 104 }[images.size];
  const imageEl = showImage ? <img src={productImage} alt="" style={{ display: 'block', width: imageSize, height: imageSize, objectFit: 'cover', borderRadius: borders.radius / 2, flexShrink: 0 }} /> : null;
  const badgeStyle = { padding: '2px 8px', background: colors.badge, color: colors.text, borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const metaText = (tier) => (cardsCentered ? (tier.savings > 0 && tier.quantity > 0 ? `${formatMoney(tier.price / tier.quantity)} each` : `${tier.quantity} item${tier.quantity === 1 ? '' : 's'}`) : `${tier.quantity} item${tier.quantity === 1 ? '' : 's'}${tier.savings > 0 && tier.quantity > 0 ? ` · ${formatMoney(tier.price / tier.quantity)} each` : ''}`);
  const titleBlock = (tier, { center = false, inlineBadge = true } = {}) => (
    <span style={{ minWidth: 0 }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: center ? 'center' : 'flex-start', fontSize: typography.packTitleSize, fontWeight: typography.fontWeight }}>
        {tierLabel(tier)}
        {inlineBadge && tier.badge && <span style={badgeStyle}>{tier.badge}</span>}
      </span>
      <span style={{ display: 'block', fontSize: typography.descriptionSize, opacity: 0.75 }}>{metaText(tier)}</span>
    </span>
  );
  const priceBlock = (tier, { center = false, pill = false, selectedCard = false } = {}) => {
    const save = saveText(tier);
    return (
      <span style={{ textAlign: center ? 'center' : 'right', color: colors.price }}>
        {tier.savings > 0 && <span style={{ display: 'block', fontSize: typography.descriptionSize, textDecoration: 'line-through', opacity: 0.6 }}>{formatMoney(tier.subtotal)}</span>}
        <strong style={{ display: 'block', fontSize: typography.priceSize, fontWeight: typography.fontWeight }}>{formatMoney(tier.price)}</strong>
        {save && <span style={{ display: pill ? 'inline-block' : 'block', marginTop: pill ? 6 : 0, padding: pill ? '3px 8px' : 0, borderRadius: 999, whiteSpace: pill ? 'nowrap' : 'normal', background: pill ? (selectedCard ? colors.cardBackground : colors.selectedCard) : 'transparent', fontSize: pill ? 11 : typography.descriptionSize, fontWeight: 600, color: colors.discount }}>{save}</span>}
      </span>
    );
  };

  // Mix & Match chooser, shown for the selected tier (inline for list/cards,
  // under the summary panel for the compact selector).
  const chooser = (tier) => (
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 10, marginTop: isChips ? spacing.cardGap : 0, padding: `14px ${spacing.cardPadding}px`, background: colors.selectedCard, border: `${borders.width}px ${borders.style} ${colors.primary}`, borderRadius: borders.radius }}>
      <span style={{ fontSize: typography.descriptionSize, opacity: 0.75 }}>Choose a variant for each item in this pack.</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {Array.from({ length: Math.min(tier.quantity, 6) }, (_, item) => (
          <label key={item} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 130px', minWidth: 110, fontSize: typography.descriptionSize }}>
            <span>Item {item + 1}</span>
            {mixMatchVariants ? (
              <select
                value={chosen[item] || ''}
                onChange={(event) => setChosen((current) => current.map((value, ci) => (ci === item ? event.target.value : value)))}
                style={{ width: '100%', padding: 8, font: 'inherit', border: `1px solid ${colors.border}`, borderRadius: borders.radius / 2, background: colors.cardBackground, color: colors.text }}
              >
                {mixMatchVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.title} — {formatMoney(variant.price)}</option>)}
              </select>
            ) : (
              <select disabled style={{ width: '100%', padding: 8, font: 'inherit', border: `1px solid ${colors.border}`, borderRadius: borders.radius / 2, background: colors.cardBackground, color: colors.text }}><option>No variants to choose from</option></select>
            )}
          </label>
        ))}
      </div>
      {mixMatchCalc && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: typography.descriptionSize, paddingTop: 4, borderTop: `1px solid ${colors.border}` }}>
          <span>Subtotal: <strong>{formatMoney(mixMatchCalc.subtotal)}</strong></span>
          <span>Pack price: <strong>{formatMoney(mixMatchCalc.price)}</strong></span>
          {mixMatchCalc.savings > 0 && <span style={{ color: colors.discount }}>Savings: <strong>{formatMoney(mixMatchCalc.savings)}</strong></span>}
        </div>
      )}
    </div>
  );

  const renderListOrCard = (tier, index) => {
    const isSelected = index === active;
    return (
      <Fragment key={index}>
        <button
          type="button"
          role="radio"
          aria-checked={isSelected}
          onClick={() => setSelected(index)}
          style={{
            position: 'relative', display: 'grid', alignItems: 'center', alignContent: 'start', columnGap: 16, rowGap: 8, width: '100%', padding: spacing.cardPadding, paddingTop: cardsCentered ? spacing.cardPadding + 8 : spacing.cardPadding,
            gridTemplateColumns: isCards ? (cardsCentered ? '1fr' : 'auto 1fr auto') : (showImage ? 'auto auto 1fr auto' : 'auto 1fr auto'),
            background: isSelected ? colors.selectedCard : colors.cardBackground, color: colors.text, textAlign: cardsCentered ? 'center' : 'left', justifyItems: cardsCentered ? 'center' : 'stretch',
            border: isSelected ? `${borders.width}px ${borders.style} ${colors.primary}` : border, borderRadius: borders.radius, font: 'inherit', cursor: 'pointer', boxShadow: isSelected ? `0 0 0 1px ${colors.primary}` : 'none',
          }}
        >
          {!isCards && (
            <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: `2px solid ${isSelected ? colors.primary : colors.border}`, background: isSelected ? `radial-gradient(${colors.primary} 40%, transparent 45%)` : 'transparent' }} />
          )}
          {isCards && isSelected && (
            <span aria-hidden="true" style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', background: colors.primary, color: colors.buttonText }}><Checkmark color={colors.buttonText} /></span>
          )}
          {cardsCentered && tier.badge && <span style={{ ...badgeStyle, position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)' }}>{tier.badge}</span>}
          {imageEl}
          {isCards && !showImage && (
            <span aria-hidden="true" style={{ fontSize: typography.headingSize * 1.5, fontWeight: 800, lineHeight: 1, color: colors.primary }}>
              {tier.quantity}<small style={{ fontSize: '.5em', fontWeight: 700, marginLeft: 1 }}>×</small>
            </span>
          )}
          {titleBlock(tier, { center: cardsCentered, inlineBadge: !cardsCentered })}
          {priceBlock(tier, { center: cardsCentered, pill: isCards, selectedCard: isSelected })}
        </button>
        {/* Directly below the SELECTED tier, not after the whole list — reads as
            "here's what you're building for the pack you just picked". Spans every
            grid column so it never squeezes into one narrow card column. */}
        {packType === 'mix_match' && isSelected && chooser(tier)}
      </Fragment>
    );
  };

  const renderChip = (tier, index) => {
    const isSelected = index === active;
    const pct = tier.subtotal > 0 ? Math.round((tier.savings / tier.subtotal) * 1000) / 10 : 0;
    return (
      <button
        key={index}
        type="button"
        role="radio"
        aria-checked={isSelected}
        onClick={() => setSelected(index)}
        style={{
          position: 'relative', flex: '1 1 0', minWidth: 72, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '12px 8px 10px',
          background: isSelected ? colors.primary : colors.cardBackground, color: isSelected ? colors.buttonText : colors.text,
          border: `${borders.width}px ${borders.style} ${isSelected ? colors.primary : colors.border}`, borderRadius: borders.radius, font: 'inherit', textAlign: 'center', cursor: 'pointer',
        }}
      >
        {tier.badge && <span style={{ ...badgeStyle, position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', fontSize: 9, padding: '1px 7px' }}>{tier.badge}</span>}
        <span style={{ fontSize: typography.packTitleSize, fontWeight: typography.fontWeight, lineHeight: 1.2 }}>{tierLabel(tier)}</span>
        {savings.visible && tier.savings > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? 'inherit' : colors.discount, opacity: isSelected ? 0.9 : 1 }}>{saveWord} {pct}%</span>}
      </button>
    );
  };

  return (
    <section style={widgetStyle} aria-label="Storefront preview">
      <div style={{ textAlign: typography.alignment }}>
        {content.heading && <h3 style={{ margin: '0 0 4px', fontSize: typography.headingSize, fontWeight: typography.fontWeight, color: colors.text }}>{content.heading}</h3>}
        {content.subheading && <p style={{ margin: `0 0 ${spacing.cardGap + 4}px`, fontSize: typography.descriptionSize, opacity: 0.75 }}>{content.subheading}</p>}
      </div>
      {multiVariant && (
        <div style={{ margin: `0 0 ${spacing.cardGap}px`, fontSize: typography.descriptionSize }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ opacity: 0.75 }}>Preview as variant (simulates the storefront&apos;s own variant picker)</span>
            <select value={activeVariantId || ''} onChange={(event) => setActiveVariantId(event.target.value)} style={{ padding: 8, font: 'inherit', border: `1px solid ${colors.border}`, borderRadius: borders.radius / 2, background: colors.cardBackground, color: colors.text }}>
              {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.title} — {formatMoney(variant.price)}</option>)}
            </select>
          </label>
        </div>
      )}
      {displayTiers.length === 0 && <div style={{ fontSize: 13, opacity: 0.7 }}>Add valid tiers to preview prices.</div>}
      {isChips ? (
        <>
          <div role="radiogroup" style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap, paddingTop: 8 }}>
            {displayTiers.map(renderChip)}
          </div>
          {activeTier && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: spacing.cardGap, padding: spacing.cardPadding, background: colors.selectedCard, border: `${borders.width}px ${borders.style} ${colors.primary}`, borderRadius: borders.radius }}>
              {imageEl}
              <span style={{ flex: 1, minWidth: 0 }}>{titleBlock(activeTier)}</span>
              {priceBlock(activeTier)}
            </div>
          )}
          {packType === 'mix_match' && activeTier && chooser(activeTier)}
        </>
      ) : (
        <div role="radiogroup" style={{ display: 'grid', gap: spacing.cardGap, gridTemplateColumns: cardsCentered ? `repeat(${compact ? 2 : Math.min(Math.max(displayTiers.length, 1), 4)}, minmax(0, 1fr))` : '1fr' }}>
          {displayTiers.map(renderListOrCard)}
        </div>
      )}

      {content.promoText && <p style={{ margin: '12px 0 0', fontSize: typography.descriptionSize, opacity: 0.8, textAlign: typography.alignment }}>{content.promoText}</p>}
      <button type="button" style={{ display: 'block', width: '100%', marginTop: spacing.buttonSpacing, padding: '13px 16px', background: colors.button, color: colors.buttonText, border: 0, borderRadius: borders.radius, font: 'inherit', fontWeight: 700, cursor: 'default' }}>{content.cta || 'Add Pack to Cart'}</button>
    </section>
  );
}
