/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useEffect, useMemo, useState } from 'react';
import { mergeCustomization, tierLabel, calculateTierFromPrices, LEGACY_DESIGN_MAP } from '../../utils/packs.shared.js';

// Each design preset is a structurally different layout — kept identical to
// layoutOf in extensions/cart-drawer/assets/packs_widget.js so the preview matches the store:
//   tabs -> pack tabs over one panel, stacked -> one card of rows, visual ->
//   pack tabs + one photo picker per item. Removed layouts map to their closest
//   current one (LEGACY_DESIGN_MAP); the old "image cards" template becomes tabs.
export function layoutOf(preset, template) {
  if (preset === 'tabs' || preset === 'stacked' || preset === 'visual') return preset;
  if (LEGACY_DESIGN_MAP[preset]) return LEGACY_DESIGN_MAP[preset];
  return template === 'visual_offer' ? 'tabs' : 'stacked';
}

/**
 * Admin-side preview of the storefront Packs widget. It mirrors the storefront
 * templates and customization (extensions/cart-drawer/assets/packs_widget.js) but ONLY renders
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
 *  - productTitle: shown instead of Shopify's "Default Title" for single-variant products
 */
export default function PackPreview({ template, packType, variants, customization, tiers, productImage, formatMoney, productTitle }) {
  const custom = mergeCustomization(customization);
  const [selected, setSelected] = useState(0);
  const [chosen, setChosen] = useState([]);
  const [openPicker, setOpenPicker] = useState(null);
  const { colors, borders, typography, spacing, content, savings, images, design, buttons } = custom;
  const buttonBase = {
    flex: '1 1 0', padding: `${buttons.paddingY}px 16px`, borderRadius: buttons.radius, font: 'inherit', fontSize: buttons.fontSize, fontWeight: buttons.fontWeight,
    textTransform: buttons.uppercase ? 'uppercase' : 'none', letterSpacing: buttons.uppercase ? '.04em' : 'normal', cursor: 'default',
  };
  const layout = layoutOf(design.preset, template);
  const sellable = useMemo(() => (Array.isArray(variants) ? variants.filter((variant) => variant.availableForSale !== false) : []), [variants]);
  // Same rule as perItem() in packs_widget.js: one choice per item for Mix &
  // Match, and in Pack tabs / Visual picker whenever there's more than one variant.
  const perItem = sellable.length > 0 && (packType === 'mix_match' || ((layout === 'tabs' || layout === 'visual') && sellable.length > 1));
  const multiVariant = !perItem && sellable.length > 1;
  const [activeVariantId, setActiveVariantId] = useState(() => sellable[0]?.id || null);
  const active = Math.min(selected, Math.max(0, tiers.length - 1));
  const border = `${borders.width}px ${borders.style} ${colors.border}`;

  useEffect(() => {
    if (!multiVariant) return;
    if (!sellable.some((variant) => variant.id === activeVariantId)) setActiveVariantId(sellable[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiVariant, sellable]);

  // One variant for every item: prices follow the picked variant.
  const displayTiers = useMemo(() => {
    if (!multiVariant) return tiers;
    const activeVariant = sellable.find((variant) => variant.id === activeVariantId) || sellable[0];
    const unitPrice = activeVariant ? activeVariant.price : 0;
    return tiers.map((tier) => {
      const prices = Array.from({ length: Math.max(0, tier.quantity) }, () => unitPrice);
      const calc = calculateTierFromPrices(prices, tier);
      return { ...tier, subtotal: calc.subtotal, discountAmount: calc.discountAmount, price: calc.price, savings: calc.savings, effectiveUnitPrice: calc.effectiveUnitPrice };
    });
  }, [multiVariant, tiers, sellable, activeVariantId]);

  const activeTier = displayTiers[active];
  useEffect(() => {
    if (!perItem || !activeTier) return;
    setChosen((current) => Array.from({ length: Math.max(0, activeTier.quantity) }, (_, index) => current[index] || sellable[0]?.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perItem, sellable, activeTier?.quantity]);
  // One variant per item: the chosen pack's price comes from the picked items.
  const itemCalc = useMemo(() => {
    if (!perItem || !activeTier) return null;
    const prices = chosen.slice(0, activeTier.quantity).map((id) => sellable.find((variant) => variant.id === id)?.price ?? 0);
    return calculateTierFromPrices(prices.length ? prices : [0], activeTier);
  }, [perItem, sellable, activeTier, chosen]);

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
  const showImage = Boolean(images.enabled && productImage);
  const imageSize = { small: 48, medium: 72, large: 104 }[images.size];
  const imageEl = showImage ? <img src={productImage} alt="" style={{ display: 'block', width: imageSize, height: imageSize, objectFit: 'cover', borderRadius: borders.radius / 2, flexShrink: 0 }} /> : null;
  const badgeStyle = { padding: '2px 8px', background: colors.badge, color: colors.text, borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const metaText = (tier) => `${tier.quantity} item${tier.quantity === 1 ? '' : 's'}${tier.savings > 0 && tier.quantity > 0 ? ` · ${formatMoney(tier.price / tier.quantity)} each` : ''}`;
  const titleBlock = (tier) => (
    <span style={{ minWidth: 0 }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: typography.packTitleSize, fontWeight: typography.fontWeight }}>
        {tierLabel(tier)}
        {tier.badge && <span style={badgeStyle}>{tier.badge}</span>}
      </span>
      <span style={{ display: 'block', fontSize: typography.descriptionSize, opacity: 0.75 }}>{metaText(tier)}</span>
    </span>
  );
  const priceBlock = (tier) => {
    const save = saveText(tier);
    return (
      <span style={{ textAlign: 'right', color: colors.price }}>
        {tier.savings > 0 && <span style={{ display: 'block', fontSize: typography.descriptionSize, textDecoration: 'line-through', opacity: 0.6 }}>{formatMoney(tier.subtotal)}</span>}
        <strong style={{ display: 'block', fontSize: typography.priceSize, fontWeight: typography.fontWeight }}>{formatMoney(tier.price)}</strong>
        {save && <span style={{ display: 'block', fontSize: typography.descriptionSize, fontWeight: 600, color: colors.discount }}>{save}</span>}
      </span>
    );
  };

  const priced = (tier, index) => (itemCalc && index === active ? { ...tier, ...itemCalc, quantity: tier.quantity } : tier);
  const selectStyle = { width: '100%', padding: 8, font: 'inherit', border: `1px solid ${colors.border}`, borderRadius: borders.radius / 2, background: colors.cardBackground, color: colors.text };
  const variantOf = (id) => sellable.find((variant) => variant.id === id) || null;
  const photoOf = (variant) => variant?.image || productImage;
  const nameOf = (variant) => {
    const title = variant?.title;
    return !title || title === 'Default Title' ? (productTitle || 'Product') : title;
  };
  const setItem = (item, value) => setChosen((current) => current.map((v, ci) => (ci === item ? value : v)));
  const itemCount = (tier) => Math.min(tier.quantity, 6);
  const labelText = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: typography.descriptionSize };
  const plainSelect = (label, value, onChange) => (
    <select aria-label={label} value={value || ''} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
      {sellable.map((variant) => <option key={variant.id} value={variant.id}>{variant.title} — {formatMoney(variant.price)}</option>)}
    </select>
  );

  // Design 1 (Pack tabs): one plain dropdown per item, stacked vertically.
  const itemSelects = (tier) => (perItem ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: itemCount(tier) }, (_, item) => (
        <label key={item} style={labelText}><span>Item {item + 1}</span>{plainSelect(`Item ${item + 1} variant`, chosen[item], (value) => setItem(item, value))}</label>
      ))}
    </div>
  ) : null);

  // Design 2 (Stacked packs): the variant photo once per item.
  const tiles = (tier) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {multiVariant && <label style={labelText}><span>{tier.quantity > 1 ? `Variant (all ${tier.quantity} items)` : 'Variant'}</span>{plainSelect('Variant', activeVariantId, setActiveVariantId)}</label>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap }}>
        {Array.from({ length: itemCount(tier) }, (_, item) => {
          const variant = perItem ? variantOf(chosen[item]) : (multiVariant ? variantOf(activeVariantId) : sellable[0] || null);
          const photo = photoOf(variant);
          return (
            <div key={item} style={{ flex: '1 1 0', minWidth: 84, maxWidth: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 8, background: colors.cardBackground, border, borderRadius: borders.radius, fontSize: typography.descriptionSize, textAlign: 'center' }}>
              {photo ? <img src={photo} alt="" style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: borders.radius / 2, background: '#f1f2f4' }} /> : <span style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', borderRadius: borders.radius / 2, background: '#f1f2f4' }} />}
              <span style={{ fontWeight: 600 }}>{nameOf(variant)}</span>
              {perItem && plainSelect(`Item ${item + 1} variant`, chosen[item], (value) => setItem(item, value))}
            </div>
          );
        })}
      </div>
    </div>
  );

  // Design 3 (Visual picker): a dropdown per item showing the variant photo in
  // the closed box and in every option.
  const photo44 = (variant) => {
    const photo = photoOf(variant);
    return photo ? <img src={photo} alt="" style={{ display: 'block', width: 44, height: 44, flexShrink: 0, objectFit: 'cover', borderRadius: borders.radius / 2, background: '#f1f2f4' }} /> : <span style={{ display: 'block', width: 44, height: 44, flexShrink: 0, borderRadius: borders.radius / 2, background: '#f1f2f4' }} />;
  };
  const imageDropdown = (key, label, value, onPick) => {
    const current = variantOf(value) || sellable[0];
    const open = openPicker === key;
    return (
      <div key={key} style={{ position: 'relative' }}>
        <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpenPicker(open ? null : key)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: colors.cardBackground, color: colors.text, border: `1px solid ${open ? colors.primary : colors.border}`, borderRadius: borders.radius / 2, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
          {photo44(current)}
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 11, opacity: 0.7 }}>{label}</span>
            <span style={{ fontWeight: 600 }}>{current?.title}</span>
          </span>
          {current && <span style={{ fontSize: typography.descriptionSize, opacity: 0.8 }}>{formatMoney(current.price)}</span>}
          <span aria-hidden="true" style={{ opacity: 0.6 }}>▾</span>
        </button>
        {open && (
          <ul role="listbox" aria-label={label} style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: 'calc(100% + 4px)', maxHeight: 280, overflow: 'auto', margin: 0, padding: 4, listStyle: 'none', background: colors.cardBackground, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: borders.radius / 2, boxShadow: '0 8px 24px rgba(0,0,0,.14)' }}>
            {sellable.map((variant) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- admin preview only; the storefront dropdown has full keyboard support
              <li key={variant.id} role="option" aria-selected={variant.id === current?.id} onClick={() => { onPick(variant.id); setOpenPicker(null); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: variant.id === current?.id ? colors.selectedCard : 'transparent' }}>
                {photo44(variant)}
                <span style={{ flex: 1, fontWeight: 600 }}>{variant.title}</span>
                <span style={{ fontSize: typography.descriptionSize, opacity: 0.8 }}>{formatMoney(variant.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  const imageDropdowns = (tier) => {
    if (perItem) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: itemCount(tier) }, (_, item) => imageDropdown(`item-${item}`, `Item ${item + 1}`, chosen[item], (value) => setItem(item, value)))}</div>;
    if (multiVariant) return <div>{imageDropdown('all', tier.quantity > 1 ? `Variant (all ${tier.quantity} items)` : 'Variant', activeVariantId, setActiveVariantId)}</div>;
    return tiles(tier);
  };

  const renderTabs = () => {
    const current = activeTier ? priced(activeTier, active) : null;
    return (
      <>
        <div role="radiogroup" style={{ display: 'flex', gap: spacing.cardGap, paddingTop: 8 }}>
          {displayTiers.map((tier, index) => {
            const isSelected = index === active;
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(index)}
                style={{
                  position: 'relative', flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '12px 8px 10px',
                  background: isSelected ? colors.selectedCard : colors.cardBackground, color: colors.text, textAlign: 'center', font: 'inherit', cursor: 'pointer',
                  border: `${borders.width}px ${borders.style} ${isSelected ? colors.primary : colors.border}`, borderRadius: borders.radius, boxShadow: isSelected ? `0 0 0 1px ${colors.primary}` : 'none',
                }}
              >
                {tier.badge && <span style={{ ...badgeStyle, position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', fontSize: 9, padding: '1px 7px' }}>{tier.badge}</span>}
                <span style={{ fontSize: typography.packTitleSize, fontWeight: typography.fontWeight, lineHeight: 1.2 }}>{tierLabel(tier)}</span>
                <span style={{ fontSize: typography.descriptionSize, opacity: 0.8 }}>{formatMoney(priced(tier, index).price)}</span>
              </button>
            );
          })}
        </div>
        {current && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: spacing.cardGap, padding: spacing.cardPadding, background: colors.cardBackground, border, borderRadius: borders.radius }}>
            {itemSelects(current)}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {imageEl}
              <span style={{ flex: 1, minWidth: 0 }}>{titleBlock(current)}</span>
              {priceBlock(current)}
            </div>
          </div>
        )}
      </>
    );
  };

  // Designs 2 and 3: packs as rows; the chosen row opens underneath.
  const renderRows = () => (
    <div role="radiogroup" style={{ background: colors.cardBackground, border, borderRadius: borders.radius }}>
      {displayTiers.map((tier, index) => {
        const isSelected = index === active;
        const shown = priced(tier, index);
        const rowImage = layout === 'visual' ? imageEl : null;
        return (
          <div key={index} style={{ borderTop: index ? border : 'none', background: isSelected ? colors.selectedCard : 'transparent', boxShadow: isSelected ? `inset 3px 0 0 ${colors.primary}` : 'none' }}>
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(index)}
              style={{ display: 'grid', gridTemplateColumns: rowImage ? 'auto auto 1fr auto' : 'auto 1fr auto', alignItems: 'center', columnGap: 16, width: '100%', padding: spacing.cardPadding, background: 'transparent', color: colors.text, border: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
            >
              <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: `2px solid ${isSelected ? colors.primary : colors.border}`, background: isSelected ? `radial-gradient(${colors.primary} 40%, transparent 45%)` : 'transparent' }} />
              {rowImage}
              {titleBlock(shown)}
              {priceBlock(shown)}
            </button>
            {isSelected && <div style={{ padding: `0 ${spacing.cardPadding}px ${spacing.cardPadding}px` }}>{layout === 'visual' ? imageDropdowns(shown) : tiles(shown)}</div>}
          </div>
        );
      })}
    </div>
  );

  return (
    <section style={widgetStyle} aria-label="Storefront preview">
      <div style={{ textAlign: typography.alignment }}>
        {content.heading && <h3 style={{ margin: '0 0 4px', fontSize: typography.headingSize, fontWeight: typography.fontWeight, color: colors.text }}>{content.heading}</h3>}
        {content.subheading && <p style={{ margin: `0 0 ${spacing.cardGap + 4}px`, fontSize: typography.descriptionSize, opacity: 0.75 }}>{content.subheading}</p>}
      </div>
      {displayTiers.length === 0 && <div style={{ fontSize: 13, opacity: 0.7 }}>Add valid tiers to preview prices.</div>}
      {layout === 'tabs' ? renderTabs() : renderRows()}

      {content.promoText && <p style={{ margin: '12px 0 0', fontSize: typography.descriptionSize, opacity: 0.8, textAlign: typography.alignment }}>{content.promoText}</p>}
      <div style={{ display: 'flex', flexDirection: buttonDirection(buttons), gap: 10, marginTop: spacing.buttonSpacing }}>
        <button type="button" style={{ ...buttonBase, background: colors.button, color: colors.buttonText, border: `${buttons.borderWidth}px solid ${buttons.addBorder}` }}>{content.cta || 'Add Pack to Cart'}</button>
        {content.showBuyNow !== false && (
          <button type="button" style={{ ...buttonBase, background: buttons.buyNowBackground, color: buttons.buyNowText, border: `${buttons.borderWidth}px solid ${buttons.buyNowBorder}` }}>{content.buyNow || 'Buy Now'}</button>
        )}
      </div>
    </section>
  );
}

// Same as .brix-packs-actions in packs_widget.js: stacked or side by side,
// Buy Now first when the merchant puts it first.
function buttonDirection(buttons) {
  const reversed = buttons.order === 'buy_first';
  if (buttons.layout === 'stacked') return reversed ? 'column-reverse' : 'column';
  return reversed ? 'row-reverse' : 'row';
}
