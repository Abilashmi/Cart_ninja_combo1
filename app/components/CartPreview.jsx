import { useState, useEffect, useRef } from 'react';
import { useCartEditor } from '../context/CartEditorContext';
import { Icon, Button } from '@shopify/polaris';
import {
  CartIcon, DesktopIcon, MobileIcon,
  GiftCardFilledIcon, DeliveryFilledIcon, StarFilledIcon, RewardIcon,
  DiscountFilledIcon, DiscountCodeIcon, CashDollarIcon, MagicIcon,
} from '@shopify/polaris-icons';
import { upsellProducts } from '../data/mockData';

const SECTION_TIPS = {
  progressBar: 'Free shipping progress bars boost AOV by 20–30% on average — customers deliberately add items to unlock the reward.',
  announcements: 'Cart-level announcements with urgency or benefit messaging keep up to 20% more shoppers engaged all the way to checkout.',
  couponSlider: 'Surfacing coupons directly in the cart captures up to 40% more completions — shoppers stay in flow. Add per-coupon countdown timers to multiply urgency.',
  upsellProducts: 'In-cart recommendations drive 10–30% higher order values. Amazon attributes ~35% of its revenue to upsell suggestions.',
  checkoutButton: 'A high-contrast checkout button improves checkout initiation by up to 25% — pick a color that commands attention and stands out.',
  header: 'Showing item count and cart total in the header reassures shoppers and actively boosts checkout confidence.',
  design: 'Visual consistency between cart and storefront builds trust — brand consistency improves conversion by up to 23%.',
  general: 'Slide-out cart drawers convert up to 20% better than full cart page redirects by keeping shoppers in the purchase flow.',
  emptyCart: 'Empty cart states with product recommendations convert 2–3× better — turning every visit into a new product discovery.',
  customCSS: 'Custom-styled cart experiences that match your storefront increase brand recognition and boost buyer confidence.',
};

const SECTION_LABELS = {
  design: 'Design',
  general: 'General',
  header: 'Header',
  announcements: 'Announcements',
  progressBar: 'Progress Bar',
  couponSlider: 'Coupon Slider',
  upsellProducts: 'Upsell Products',
  emptyCart: 'Empty Cart',
  checkoutButton: 'Checkout Button',
  customCSS: 'Custom CSS',
};

const POSITIONED_SECTIONS = {
  progressBar: 'position',
  couponSlider: 'position',
  upsellProducts: 'position',
};

function getPositionLabel(position) {
  if (position === 'top') return 'Top';
  if (position === 'bottom') return 'Bottom';
  return '';
}

function getSectionLabel(section, body) {
  const baseLabel = SECTION_LABELS[section] ?? section;
  const positionKey = POSITIONED_SECTIONS[section];
  if (!positionKey) return baseLabel;

  const sectionState = body?.[section];
  const positionLabel = getPositionLabel(sectionState?.[positionKey]);
  return positionLabel ? `${baseLabel} - ${positionLabel}` : baseLabel;
}

const COUPON_ICON_MAP = {
  discount: DiscountCodeIcon,
  gift: GiftCardFilledIcon,
  shipping: DeliveryFilledIcon,
  star: StarFilledIcon,
  percent: DiscountFilledIcon,
  cash: CashDollarIcon,
};

const TIER_ICON_MAP = {
  gift: GiftCardFilledIcon,
  shipping: DeliveryFilledIcon,
  star: StarFilledIcon,
  trophy: RewardIcon,
  diamond: DiscountFilledIcon,
};

const MOCK_PREVIEW_COUPONS = [
  {
    id: 'preview-1', code: 'SAVE20', labelText: 'SAVE20', description: '20% off your order',
    bgColor: '#4f46e5', textColor: '#ffffff', icon: 'discount', borderRadius: 8,
    buttonText: 'Apply', buttonBgColor: '#000000', buttonTextColor: '#ffffff',
  },
  {
    id: 'preview-2', code: 'FREESHIP', labelText: 'FREESHIP', description: 'Free shipping',
    bgColor: '#059669', textColor: '#ffffff', icon: 'shipping', borderRadius: 8,
    buttonText: 'Apply', buttonBgColor: '#000000', buttonTextColor: '#ffffff',
  },
];

const CART_TOTAL = 489;
const MOCK_CART_COUNT = 1;

function HighlightZone({ sectionId, activeSection, label, children, className, style }) {
  const ids = Array.isArray(sectionId) ? sectionId : [sectionId];
  const isActive = activeSection !== '' && ids.includes(activeSection);
  const highlightLabel = label ?? SECTION_LABELS[activeSection] ?? activeSection;

  return (
    <div className={`preview-highlight-zone ${isActive ? 'is-active' : ''} ${className ?? ''}`} style={style}>
      {children}
      {isActive && (
        <div className="preview-highlight-overlay">
          <span className="preview-highlight-tag">{highlightLabel}</span>
        </div>
      )}
    </div>
  );
}

function CouponTimerDisplay({ coupon }) {
  const totalSeconds = (coupon.timerHours ?? 0) * 3600 + (coupon.timerMinutes ?? 15) * 60;
  const [remaining, setRemaining] = useState(totalSeconds);

  useEffect(() => { setRemaining(totalSeconds); }, [totalSeconds]);

  useEffect(() => {
    if (remaining <= 0) return;
    const interval = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(interval);
  }, [remaining]);

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const expired = remaining <= 0;

  const bgColor = coupon.timerBgColor ?? '#fef2f2';
  const textColor = coupon.timerTextColor ?? '#991b1b';
  const accentColor = coupon.timerAccentColor ?? '#dc2626';
  const timerLabel = coupon.timerLabel ?? 'Offer expires in';
  const expiredLabel = coupon.timerExpiredLabel ?? 'Offer expired!';

  return (
    <div style={{ marginTop: '5px', backgroundColor: bgColor, borderRadius: '4px', padding: '3px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
      <span style={{ fontSize: '8px', color: textColor, fontWeight: 500, lineHeight: 1.3 }}>
        {expired ? expiredLabel : timerLabel}
      </span>
      {!expired && (
        <span style={{ fontSize: '9px', color: accentColor, fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {h > 0 && `${pad(h)}:`}{pad(m)}:{pad(s)}
        </span>
      )}
    </div>
  );
}

function ProgressBarPreview({ pb }) {
  const tiers = pb.tiers;
  if (!tiers.length) return null;

  const isCount = pb.mode === 'count';
  const currentValue = isCount ? MOCK_CART_COUNT : CART_TOTAL;
  const maxThreshold = tiers[tiers.length - 1].minimumSpend;
  const fillPct = Math.min(100, (currentValue / maxThreshold) * 100);
  const nextTier = tiers.find((t) => currentValue < t.minimumSpend);
  const diff = nextTier ? nextTier.minimumSpend - currentValue : 0;
  const amountStr = isCount ? `${diff} item${diff !== 1 ? 's' : ''}` : `₹${diff}`;
  const radius = pb.borderRadius;

  const buildMessageLine = () => {
    const template = pb.messageTemplate || "You're {amount} away";
    const parts = template.split('{amount}');
    if (parts.length === 1) return <span>{parts[0]}</span>;
    return <>{parts[0]}<strong style={{ fontWeight: 700 }}>{amountStr}</strong>{parts[1]}</>;
  };

  return (
    <div className="cart-preview-progress">
      <div style={{ textAlign: 'center', marginBottom: '14px' }}>
        {nextTier ? (
          <>
            <div style={{ fontSize: '13px', fontWeight: 500, color: pb.colors.message, lineHeight: 1.5 }}>{buildMessageLine()}</div>
            {nextTier.title && (
              <div style={{ fontSize: '12px', fontWeight: 700, color: pb.colors.icon, lineHeight: 1.4 }}>Unlock: {nextTier.title}</div>
            )}
          </>
        ) : (
          <div style={{ fontSize: '13px', fontWeight: 700, color: pb.colors.message }}>{pb.completionMessage}</div>
        )}
      </div>

      <div style={{ position: 'relative', paddingBottom: '52px', margin: '0 12px' }}>
        <div style={{ height: '8px', borderRadius: `${radius}px`, backgroundColor: pb.colors.background, position: 'relative', overflow: 'visible' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${fillPct}%`, backgroundColor: pb.colors.fill, borderRadius: `${radius}px`, transition: 'width 0.3s ease' }} />
        </div>

        {tiers.map((tier) => {
          const pct = Math.min(100, (tier.minimumSpend / maxThreshold) * 100);
          const unlocked = currentValue >= tier.minimumSpend;
          const IconComp = TIER_ICON_MAP[tier.icon] ?? GiftCardFilledIcon;
          return (
            <div key={tier.id} style={{ position: 'absolute', left: `${pct}%`, top: '4px', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: unlocked ? pb.colors.fill : '#ffffff', border: `2px solid ${pb.colors.fill}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)', flexShrink: 0 }}>
                <span style={{ color: unlocked ? '#ffffff' : pb.colors.icon, display: 'flex', lineHeight: 0 }}>
                  <IconComp width="13" height="13" fill="currentColor" />
                </span>
              </div>
              <div style={{ position: 'absolute', top: '100%', marginTop: '6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                {unlocked ? (
                  <>
                    <div style={{ fontSize: '7px', fontWeight: 700, color: '#059669', background: '#d1fae5', padding: '1px 5px', borderRadius: '3px', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>REACHED</div>
                    {(tier.title || tier.description) && (
                      <div style={{ fontSize: '8px', color: pb.colors.icon, fontWeight: 600, whiteSpace: 'nowrap' }}>{tier.title || tier.description}</div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: '9px', color: '#374151', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '5px', padding: '2px 6px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {isCount ? `${tier.minimumSpend}` : `₹${tier.minimumSpend}`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CouponCard({ coupon, template, isVertical }) {
  const timer = coupon.timerEnabled ? <CouponTimerDisplay coupon={coupon} /> : null;
  const IconComp = COUPON_ICON_MAP[coupon.icon] ?? DiscountCodeIcon;

  if (template === 'minimal-card') {
    return (
      <div style={{ backgroundColor: '#ffffff', borderRadius: `${coupon.borderRadius}px`, border: '1px solid #e5e7eb', borderLeft: `3px solid ${coupon.bgColor}`, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, height: '100%', boxSizing: 'border-box' }}>
        {timer}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ color: coupon.bgColor, display: 'flex', lineHeight: 0, flexShrink: 0 }}><IconComp width="14" height="14" fill="currentColor" /></span>
          <span style={{ fontSize: '10px', fontWeight: 700, color: coupon.bgColor, letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{coupon.labelText}</span>
        </div>
        {!isVertical && <div style={{ fontSize: '9px', color: '#6b7280', lineHeight: 1.3, flex: 1 }}>{coupon.description}</div>}
        <button style={{ marginTop: 'auto', padding: '3px 0', borderRadius: '4px', border: `1px solid ${coupon.bgColor}`, backgroundColor: 'transparent', color: coupon.bgColor, fontSize: '9px', fontWeight: 600, cursor: 'pointer', width: '100%', textAlign: 'center' }}>
          {coupon.buttonText}
        </button>
      </div>
    );
  }

  if (template === 'bold-vibrant') {
    return (
      <div style={{ backgroundColor: coupon.bgColor, borderRadius: `${coupon.borderRadius}px`, padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: 0, textAlign: 'center', boxShadow: `0 2px 8px ${coupon.bgColor}55`, height: '100%', boxSizing: 'border-box' }}>
        {timer}
        <span style={{ color: coupon.textColor, display: 'flex', lineHeight: 0 }}><IconComp width="20" height="20" fill="currentColor" /></span>
        <div style={{ fontSize: '11px', fontWeight: 800, color: coupon.textColor, letterSpacing: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{coupon.labelText}</div>
        {!isVertical && <div style={{ fontSize: '8px', color: coupon.textColor, opacity: 0.85, lineHeight: 1.3, flex: 1 }}>{coupon.description}</div>}
        <button style={{ marginTop: 'auto', padding: '4px 10px', borderRadius: '4px', border: 'none', backgroundColor: coupon.buttonBgColor, color: coupon.buttonTextColor, fontSize: '9px', fontWeight: 700, cursor: 'pointer', width: '100%', textAlign: 'center', letterSpacing: '0.5px' }}>
          {coupon.buttonText}
        </button>
      </div>
    );
  }

  // classic-banner (default)
  return (
    <div style={{ backgroundColor: coupon.bgColor, color: coupon.textColor, borderRadius: `${coupon.borderRadius}px`, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, height: '100%', boxSizing: 'border-box' }}>
      {timer}
      <div style={{ display: 'flex', flexDirection: isVertical ? 'column' : 'row', alignItems: isVertical ? 'center' : 'flex-start', gap: '5px' }}>
        <span style={{ color: coupon.textColor, display: 'flex', lineHeight: 0, flexShrink: 0 }}><IconComp width={isVertical ? 18 : 14} height={isVertical ? 18 : 14} fill="currentColor" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{coupon.labelText}</div>
          {!isVertical && <div style={{ fontSize: '9px', opacity: 0.85, lineHeight: 1.3 }}>{coupon.description}</div>}
        </div>
        <button style={{ marginTop: 'auto', padding: isVertical ? '4px 6px' : '3px 6px', borderRadius: '4px', border: 'none', backgroundColor: coupon.buttonBgColor, color: coupon.buttonTextColor, fontSize: '9px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, alignSelf: isVertical ? 'stretch' : 'center', textAlign: 'center' }}>
          {coupon.buttonText}
        </button>
      </div>
    </div>
  );
}

function CouponSliderPreview({ cs }) {
  const displayCoupons = cs.selectedCoupons.length > 0 ? cs.selectedCoupons : MOCK_PREVIEW_COUPONS;
  const isGrid = cs.layout === 'grid';
  const isVertical = cs.alignment === 'vertical';

  return (
    <div className="cart-preview-coupon-section">
      {cs.sectionTitle && (
        <div style={{ fontSize: `${cs.titleFontSize}px`, fontWeight: 600, color: cs.titleColor, textAlign: cs.titleTextAlign, marginBottom: '8px' }}>
          {cs.sectionTitle}
        </div>
      )}
      <div style={isGrid ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } : { display: 'flex', gap: '6px', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {displayCoupons.map((coupon) => (
          <div key={coupon.id} style={{ minWidth: 0, width: (!isGrid && !isVertical) ? '140px' : (!isGrid && isVertical) ? '86px' : undefined, flexShrink: isGrid ? undefined : 0, display: 'flex', flexDirection: 'column' }}>
            <CouponCard coupon={coupon} template={cs.template} isVertical={isVertical} />
          </div>
        ))}
      </div>
    </div>
  );
}

function UpsellPreview({ upsell, checkoutBg, checkoutText }) {
  const products = upsellProducts.slice(0, upsell.limit);
  const isHorizontal = upsell.direction === 'horizontal';
  const isGrid = upsell.layout === 'grid';

  return (
    <div className="cart-preview-upsell-section">
      <div className="cart-preview-upsell-title" style={{ color: upsell.titleColor }}>{upsell.title}</div>
      {isHorizontal ? (
        <div style={isGrid ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px' } : { display: 'flex', gap: '7px', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {products.map((product) => (
            <div key={product.id} style={{ flexShrink: isGrid ? undefined : 0, width: isGrid ? undefined : '100px', border: '1px solid #e1e3e5', borderRadius: '7px', overflow: 'hidden', backgroundColor: '#fff', display: 'flex', flexDirection: 'column' }}>
              <div style={{ height: '70px', background: '#f1f2f3', flexShrink: 0 }} />
              <div style={{ padding: '5px 6px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ fontSize: '10px', fontWeight: 500, lineHeight: 1.3, marginBottom: '3px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{product.title}</div>
                <div style={{ fontSize: '11px', color: '#202223', fontWeight: 700 }}>{product.price}</div>
                {product.compareAtPrice && <div style={{ fontSize: '9px', color: '#6d7175', textDecoration: 'line-through' }}>{product.compareAtPrice}</div>}
                <button style={{ marginTop: 'auto', paddingTop: '5px', width: '100%', padding: '4px', borderRadius: '4px', border: 'none', backgroundColor: checkoutBg, color: checkoutText, fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}>
                  {upsell.buttonText}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        products.map((product) => (
          <div key={product.id} className="cart-preview-upsell-item">
            <div className="cart-preview-upsell-image" />
            <div className="cart-preview-upsell-info">
              <div className="cart-preview-upsell-name">{product.title}</div>
              <div className="cart-preview-upsell-price">{product.price}</div>
            </div>
            <button className="cart-preview-upsell-add" style={{ backgroundColor: checkoutBg, color: checkoutText }}>
              {upsell.buttonText}
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function CartPreview({ onSave, onDiscard, isDirty }) {
  const { previewMode, previewDevice, setPreviewDevice, activeSection, header, body, footer } = useCartEditor();
  const previewRootRef = useRef(null);
  const isDesktop = previewDevice === 'desktop';
  const isEmpty = previewMode === 'empty';
  const activeTip = activeSection ? SECTION_TIPS[activeSection] : null;
  const activeSectionLabel = getSectionLabel(activeSection, body);

  const pb = body.progressBar;
  const cs = body.couponSlider;
  const up = body.upsellProducts;

  const showProgressBar = pb.enabled && (!isEmpty || pb.showWhenEmpty);
  const showCouponSlider = cs.enabled && (!isEmpty || cs.showWhenEmpty);
  const showUpsell = up.enabled && (!isEmpty || up.showWhenEmpty);

  useEffect(() => {
    if (!activeSection || !previewRootRef.current) return;

    const activeZone = previewRootRef.current.querySelector('.preview-highlight-zone.is-active');
    if (!activeZone) return;

    const scrollActiveZoneIntoView = () => {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      activeZone.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    };

    const frameId = window.requestAnimationFrame(scrollActiveZoneIntoView);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    activeSection,
    previewDevice,
    previewMode,
    pb.position,
    cs.position,
    up.position,
    showProgressBar,
    showCouponSlider,
    showUpsell,
  ]);

  return (
    <div className="cart-editor-right" ref={previewRootRef}>
      {/* Preview Stage Header */}
      <div className="cart-preview-stage-header">
        <span className="cart-preview-stage-title">Live Preview</span>
        <div className="cart-editor-segmented">
          <button
            className={`segmented-btn ${isDesktop ? 'active' : ''}`}
            onClick={() => setPreviewDevice('desktop')}
          >
            <Icon source={DesktopIcon} />
            Desktop
          </button>
          <button
            className={`segmented-btn ${!isDesktop ? 'active' : ''}`}
            onClick={() => setPreviewDevice('mobile')}
          >
            <Icon source={MobileIcon} />
            Mobile
          </button>
        </div>
      </div>

      {/* Device Frame Stage */}
      <div className="cart-preview-stage">
        {activeTip && (
          <div className="cart-preview-stage-tip">
            <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderLeft: '3px solid #6366f1', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ minWidth: '20px', width: '20px', height: '20px', borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                <Icon source={MagicIcon} />
              </span>
              <p style={{ margin: 0, fontSize: '13px', color: '#312e81', lineHeight: 1.6 }}>{activeTip}</p>
            </div>
          </div>
        )}

        <div className="cart-preview-stage-inner">
          <div className={`cart-preview-frame ${isDesktop ? 'desktop' : 'mobile'}`}>
            {isDesktop && (
              <div className="cart-preview-browser-chrome">
                <div className="browser-dots"><span /><span /><span /></div>
                <div className="browser-bar" />
              </div>
            )}
            {!isDesktop && <div className="cart-preview-phone-chrome top" />}

            <div className="cart-preview-screen">
              <div className="cart-preview-store-bg">
                <div className="store-bg-grid" />
              </div>

              {/* Cart Drawer */}
              <div className={`cart-preview-drawer ${isDesktop ? 'desktop' : 'mobile'}`} style={{ position: 'relative' }}>
                {['design', 'general', 'customCSS'].includes(activeSection) && (
                  <div className="preview-highlight-overlay">
                    <span className="preview-highlight-tag">{activeSectionLabel}</span>
                  </div>
                )}

                {/* Header */}
                <HighlightZone sectionId="header" activeSection={activeSection} label={activeSectionLabel} className="cart-preview-header-zone">
                  <div
                    className="cart-preview-header"
                    style={{ backgroundColor: header.bgColor, color: header.textColor, borderBottom: header.borderBottom ? '1px solid #e1e3e5' : 'none' }}
                  >
                    <h3 style={{ color: header.textColor }}>{header.title} {!isEmpty ? '(1)' : '(0)'}</h3>
                    <button className="cart-preview-close" style={{ color: header.textColor }}>
                      {header.closeStyle === 'icon' ? '×' : 'Close'}
                    </button>
                  </div>
                </HighlightZone>

                <div className="cart-preview-body">
                  {/* Announcements */}
                  {body.announcements.enabled && (
                    <HighlightZone sectionId="announcements" activeSection={activeSection} label={activeSectionLabel}>
                      <div
                        className="cart-preview-announcement"
                        style={{ backgroundColor: body.announcements.bgColor, color: body.announcements.textColor, fontSize: `${body.announcements.fontSize}px` }}
                      >
                        {body.announcements.text}
                      </div>
                    </HighlightZone>
                  )}

                  {/* Progress Bar — TOP */}
                  {showProgressBar && pb.position === 'top' && (
                    <HighlightZone sectionId="progressBar" activeSection={activeSection} label={activeSectionLabel}>
                      <ProgressBarPreview pb={pb} />
                    </HighlightZone>
                  )}

                  {/* Coupon Slider — TOP */}
                  {showCouponSlider && cs.position === 'top' && (
                    <HighlightZone sectionId="couponSlider" activeSection={activeSection} label={activeSectionLabel}>
                      <CouponSliderPreview cs={cs} />
                    </HighlightZone>
                  )}

                  {/* Upsell — TOP */}
                  {showUpsell && up.position === 'top' && (
                    <HighlightZone sectionId="upsellProducts" activeSection={activeSection} label={activeSectionLabel}>
                      <UpsellPreview upsell={up} checkoutBg={footer.checkoutButton.bgColor} checkoutText={footer.checkoutButton.textColor} />
                    </HighlightZone>
                  )}

                  {/* Empty state OR Cart items */}
                  {isEmpty ? (
                    <HighlightZone sectionId="emptyCart" activeSection={activeSection} label={activeSectionLabel} className="cart-preview-empty-zone">
                      <div className="cart-preview-empty">
                        <div className="cart-preview-empty-icon"><Icon source={CartIcon} /></div>
                        <h4>{body.emptyCart.message}</h4>
                        <p>Add items to unlock rewards</p>
                        {body.emptyCart.showContinueShopping && (
                          <button className="cart-preview-continue-btn">Continue shopping</button>
                        )}
                      </div>
                    </HighlightZone>
                  ) : (
                    <div className="cart-preview-items-section">
                      <div className="cart-preview-items-header">
                        <span>Items included</span>
                        <span>1 ITEMS</span>
                      </div>
                      <div className="cart-preview-item">
                        <div className="cart-preview-item-image">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                        </div>
                        <div className="cart-preview-item-details">
                          <div className="cart-preview-item-title">Sample Product</div>
                          <div className="cart-preview-item-price">₹{CART_TOTAL} (1 × ₹{CART_TOTAL})</div>
                          <div className="cart-preview-item-quantity">
                            <button>−</button>
                            <span>1</span>
                            <button>+</button>
                          </div>
                        </div>
                        <button className="cart-preview-item-remove">×</button>
                      </div>
                    </div>
                  )}

                  {/* Upsell — BOTTOM */}
                  {showUpsell && up.position === 'bottom' && (
                    <HighlightZone sectionId="upsellProducts" activeSection={activeSection} label={activeSectionLabel}>
                      <UpsellPreview upsell={up} checkoutBg={footer.checkoutButton.bgColor} checkoutText={footer.checkoutButton.textColor} />
                    </HighlightZone>
                  )}

                  {/* Empty cart recommendations */}
                  {isEmpty && body.emptyCart.showRecommendations && !up.showWhenEmpty && (
                    <div className="cart-preview-upsell-section">
                      <div className="cart-preview-upsell-title">Recommended For You</div>
                      {upsellProducts.slice(0, 2).map((product) => (
                        <div key={product.id} className="cart-preview-upsell-item">
                          <div className="cart-preview-upsell-image" />
                          <div className="cart-preview-upsell-info">
                            <div className="cart-preview-upsell-name">{product.title}</div>
                            <div className="cart-preview-upsell-price">{product.price}</div>
                          </div>
                          <button className="cart-preview-upsell-add" style={{ backgroundColor: footer.checkoutButton.bgColor, color: footer.checkoutButton.textColor }}>
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Progress Bar — BOTTOM */}
                  {showProgressBar && pb.position === 'bottom' && (
                    <HighlightZone sectionId="progressBar" activeSection={activeSection} label={activeSectionLabel}>
                      <ProgressBarPreview pb={pb} />
                    </HighlightZone>
                  )}

                  {/* Coupon Slider — BOTTOM */}
                  {showCouponSlider && cs.position === 'bottom' && (
                    <HighlightZone sectionId="couponSlider" activeSection={activeSection} label={activeSectionLabel}>
                      <CouponSliderPreview cs={cs} />
                    </HighlightZone>
                  )}
                </div>

                {/* Footer */}
                {!isEmpty && (
                  <HighlightZone sectionId="checkoutButton" activeSection={activeSection} label={activeSectionLabel}>
                    <div className="cart-preview-footer">
                      <div className="cart-preview-totals">
                        <span className="cart-preview-subtotal-label">Subtotal</span>
                        <span className="cart-preview-subtotal-value">₹{CART_TOTAL}</span>
                      </div>
                      <div className="cart-preview-total">
                        <span className="cart-preview-total-label">Total</span>
                        <span className="cart-preview-total-value">₹{CART_TOTAL}</span>
                      </div>
                      {!isDesktop && footer.checkoutButton.mobileButtonType === 'swipe' ? (
                        <div style={{ background: footer.checkoutButton.bgColor, borderRadius: `${footer.checkoutButton.borderRadius}px`, height: '44px', display: 'flex', alignItems: 'center', overflow: 'hidden', position: 'relative', cursor: 'pointer' }}>
                          <div style={{ width: '38px', height: '38px', margin: '3px', borderRadius: `${Math.max(footer.checkoutButton.borderRadius - 2, 4)}px`, background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.18)', flexShrink: 0, zIndex: 1, position: 'relative' }}>
                            <span style={{ color: footer.checkoutButton.bgColor, fontSize: '16px', lineHeight: 1 }}>›</span>
                          </div>
                          <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', color: footer.checkoutButton.textColor, fontSize: '12px', fontWeight: 600, letterSpacing: '0.3px', pointerEvents: 'none' }}>
                            Swipe to checkout
                          </span>
                        </div>
                      ) : (
                        <button
                          className="cart-preview-checkout-btn"
                          style={{ backgroundColor: footer.checkoutButton.bgColor, color: footer.checkoutButton.textColor, borderRadius: `${footer.checkoutButton.borderRadius}px` }}
                        >
                          {footer.checkoutButton.text} →
                        </button>
                      )}
                      <div className="cart-preview-footer-text">{footer.checkoutButton.footerText}</div>
                    </div>
                  </HighlightZone>
                )}
              </div>
            </div>

            {!isDesktop && <div className="cart-preview-phone-chrome bottom" />}
          </div>
        </div>

        <div className="cart-preview-stage-footer">
          <Button onClick={onDiscard} size="slim">Discard</Button>
          <Button variant="primary" onClick={onSave} disabled={!isDirty} size="slim">Save</Button>
        </div>
      </div>
    </div>
  );
}
