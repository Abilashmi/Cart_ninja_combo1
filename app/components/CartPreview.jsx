import { useState, useEffect, useRef, useCallback } from 'react';
import { useCartEditor } from '../context/CartEditorContext';
import { Icon, Button } from '@shopify/polaris';
import {
  CartIcon, DesktopIcon, MobileIcon,
  GiftCardFilledIcon, DeliveryFilledIcon, StarFilledIcon, RewardIcon,
  DiscountFilledIcon, DiscountCodeIcon, CashDollarIcon,
} from '@shopify/polaris-icons';
import { upsellProducts } from '../data/mockData';
import { PreviewLockBadge } from './plan/PlanGate';
import { useCurrency } from './CurrencyContext';


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
    bgColor: '#1a9de0', textColor: '#ffffff', icon: 'discount', borderRadius: 8,
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

const BRAND = '#1a9de0';

function HighlightZone({ sectionId, activeSection, label, children, className, style, onSectionClick }) {
  const [hovered, setHovered] = useState(false);
  const ids = Array.isArray(sectionId) ? sectionId : [sectionId];
  const primaryId = ids[0];
  const isActive = activeSection !== '' && ids.includes(activeSection);
  const highlightLabel = label ?? SECTION_LABELS[activeSection] ?? activeSection;
  const hoverLabel = SECTION_LABELS[primaryId] ?? primaryId;

  return (
    <div
      className={className ?? ''}
      style={{
        position: 'relative',
        cursor: 'pointer',
        outline: isActive
          ? `2px solid ${BRAND}`
          : hovered ? `2px dashed ${BRAND}` : '2px solid transparent',
        outlineOffset: -2,
        background: isActive
          ? `rgba(26,157,224,0.06)`
          : hovered ? `rgba(26,157,224,0.03)` : undefined,
        transition: 'outline 0.12s, background 0.12s',
        ...style,
      }}
      onClick={(e) => { e.stopPropagation(); onSectionClick?.(primaryId); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}

      {/* Active: solid blue border + section name tag */}
      {isActive && (
        <div style={{ position: 'absolute', inset: 0, border: `2px solid ${BRAND}`, background: `rgba(26,157,224,0.08)`, pointerEvents: 'none', zIndex: 99 }}>
          <span style={{ position: 'absolute', top: 0, left: 0, background: BRAND, color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 7px', lineHeight: '15px', letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {highlightLabel}
          </span>
        </div>
      )}

      {/* Hover (not active): section label badge */}
      {!isActive && hovered && (
        <div style={{ position: 'absolute', top: 4, left: 4, background: `rgba(26,157,224,0.9)`, color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 7px', lineHeight: '15px', borderRadius: 3, letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 50 }}>
          {hoverLabel}
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
  const { symbol: currencySymbol } = useCurrency();
  const tiers = pb.tiers;
  if (!tiers.length) return null;

  const colors = pb.colors || {};
  const bgColor = colors.background || '#e5e7eb';
  const fillColor = colors.fill || '#10b981';
  const iconColor = colors.icon || '#2563eb';
  const msgColor = colors.message || '#10b981';
  const isCount = pb.mode === 'count';
  const currentValue = isCount ? MOCK_CART_COUNT : CART_TOTAL;
  const maxThreshold = tiers[tiers.length - 1].minimumSpend;
  const fillPct = Math.min(100, (currentValue / maxThreshold) * 100);
  const nextTier = tiers.find((t) => currentValue < t.minimumSpend);
  const diff = nextTier ? nextTier.minimumSpend - currentValue : 0;
  const amountStr = isCount ? `${diff} item${diff !== 1 ? 's' : ''}` : `${currencySymbol}${diff}`;
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
            <div style={{ fontSize: '13px', fontWeight: 500, color: msgColor, lineHeight: 1.5 }}>{buildMessageLine()}</div>
            {nextTier.title && (
              <div style={{ fontSize: '12px', fontWeight: 700, color: iconColor, lineHeight: 1.4 }}>Unlock: {nextTier.title}</div>
            )}
          </>
        ) : (
          <div style={{ fontSize: '13px', fontWeight: 700, color: msgColor }}>{pb.completionMessage || "🎉 You've unlocked free shipping!"}</div>
        )}
      </div>

      <div style={{ position: 'relative', paddingBottom: '56px', margin: '0 36px' }}>
        <div style={{ height: '8px', borderRadius: `${radius}px`, backgroundColor: bgColor, position: 'relative', overflow: 'visible' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${fillPct}%`, backgroundColor: fillColor, borderRadius: `${radius}px`, transition: 'width 0.3s ease' }} />
        </div>

        {tiers.map((tier) => {
          const pct = Math.min(100, (tier.minimumSpend / maxThreshold) * 100);
          const unlocked = currentValue >= tier.minimumSpend;
          const IconComp = TIER_ICON_MAP[tier.icon] ?? GiftCardFilledIcon;
          return (
            <div key={tier.id} style={{ position: 'absolute', left: `${pct}%`, top: '4px', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: unlocked ? fillColor : '#ffffff', border: `2px solid ${fillColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)', flexShrink: 0 }}>
                <span style={{ color: unlocked ? '#ffffff' : iconColor, display: 'flex', lineHeight: 0 }}>
                  <IconComp width="13" height="13" fill="currentColor" />
                </span>
              </div>
              {/* left:50% + translateX(-50%) centres the label under the icon's midpoint, preventing edge-tier overflow */}
              <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                {unlocked ? (
                  <>
                    <div style={{ fontSize: '7px', fontWeight: 700, color: '#059669', background: '#d1fae5', padding: '1px 5px', borderRadius: '3px', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>REACHED</div>
                    {(tier.title || tier.description) && (
                      <div style={{ fontSize: '8px', color: iconColor, fontWeight: 600, whiteSpace: 'nowrap' }}>{tier.title || tier.description}</div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: '9px', color: '#374151', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '5px', padding: '2px 6px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {isCount ? `${tier.minimumSpend}` : `${currencySymbol}${tier.minimumSpend}`}
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
      <div style={{ backgroundColor: '#ffffff', borderRadius: `${coupon.borderRadius}px`, border: '1px solid #e5e7eb', borderLeft: `3px solid ${coupon.bgColor}`, padding: '10px 9px', display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0, height: '100%', boxSizing: 'border-box' }}>
        {timer}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ color: coupon.bgColor, display: 'flex', lineHeight: 0, flexShrink: 0 }}><IconComp width="14" height="14" fill="currentColor" /></span>
          <span style={{ fontSize: '10px', fontWeight: 700, color: coupon.bgColor, letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{coupon.labelText}</span>
        </div>
        {!isVertical && <div style={{ fontSize: '9px', color: '#6b7280', lineHeight: 1.3, flex: 1 }}>{coupon.description}</div>}
        <button style={{ marginTop: 'auto', alignSelf: 'center', padding: '3px 4px', borderRadius: '4px', border: `1px solid ${coupon.bgColor}`, backgroundColor: 'transparent', color: coupon.bgColor, fontSize: '9px', fontWeight: 600, cursor: 'pointer', width: '68%', textAlign: 'center' }}>
          {coupon.buttonText}
        </button>
      </div>
    );
  }

  if (template === 'bold-vibrant') {
    return (
      <div style={{ backgroundColor: coupon.bgColor, borderRadius: `${coupon.borderRadius}px`, padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', minWidth: 0, textAlign: 'center', boxShadow: `0 2px 8px ${coupon.bgColor}55`, height: '100%', boxSizing: 'border-box' }}>
        {timer}
        <span style={{ color: coupon.textColor, display: 'flex', lineHeight: 0 }}><IconComp width="20" height="20" fill="currentColor" /></span>
        <div style={{ fontSize: '11px', fontWeight: 800, color: coupon.textColor, letterSpacing: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{coupon.labelText}</div>
        {!isVertical && <div style={{ fontSize: '8px', color: coupon.textColor, opacity: 0.85, lineHeight: 1.3, flex: 1 }}>{coupon.description}</div>}
        <button style={{ marginTop: 'auto', padding: '4px 6px', borderRadius: '4px', border: 'none', backgroundColor: coupon.buttonBgColor, color: coupon.buttonTextColor, fontSize: '9px', fontWeight: 700, cursor: 'pointer', width: '68%', textAlign: 'center', letterSpacing: '0.5px' }}>
          {coupon.buttonText}
        </button>
      </div>
    );
  }

  // classic-banner (default)
  return (
    <div style={{ backgroundColor: coupon.bgColor, color: coupon.textColor, borderRadius: `${coupon.borderRadius}px`, padding: '10px 9px', display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0, height: '100%', boxSizing: 'border-box' }}>
      {timer}
      <div style={{ display: 'flex', flexDirection: isVertical ? 'column' : 'row', alignItems: isVertical ? 'center' : 'flex-start', gap: '5px' }}>
        <span style={{ color: coupon.textColor, display: 'flex', lineHeight: 0, flexShrink: 0 }}><IconComp width={isVertical ? 18 : 14} height={isVertical ? 18 : 14} fill="currentColor" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{coupon.labelText}</div>
          {!isVertical && <div style={{ fontSize: '9px', opacity: 0.85, lineHeight: 1.3 }}>{coupon.description}</div>}
        </div>
      </div>
      <button style={{ marginTop: 'auto', padding: '3px 4px', borderRadius: '4px', border: 'none', backgroundColor: coupon.buttonBgColor, color: coupon.buttonTextColor, fontSize: '9px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, alignSelf: 'center', width: '60%', textAlign: 'center' }}>
        {coupon.buttonText}
      </button>
    </div>
  );
}

const SINGLE_ALIGN_TO_JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

function CouponSliderPreview({ cs }) {
  const displayCoupons = cs.selectedCoupons.length > 0 ? cs.selectedCoupons : MOCK_PREVIEW_COUPONS;
  const isGrid = cs.layout === 'grid';
  const isVertical = cs.alignment === 'vertical';
  const isSingle = displayCoupons.length === 1;

  const containerStyle = isSingle
    ? { display: 'flex', gap: '6px', justifyContent: SINGLE_ALIGN_TO_JUSTIFY[cs.singleCouponAlignment] || 'flex-start' }
    : isGrid
      ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }
      : { display: 'flex', gap: '6px', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' };

  return (
    <div className="cart-preview-coupon-section">
      {cs.sectionTitle && (
        <div style={{ fontSize: `${cs.titleFontSize}px`, fontWeight: 600, color: cs.titleColor, textAlign: cs.titleTextAlign, marginBottom: '8px' }}>
          {cs.sectionTitle}
        </div>
      )}
      <div style={containerStyle}>
        {displayCoupons.map((coupon) => (
          <div key={coupon.id} style={{ minWidth: 0, width: isSingle ? '140px' : (!isGrid && !isVertical) ? '140px' : (!isGrid && isVertical) ? '86px' : undefined, flexShrink: (isGrid && !isSingle) ? undefined : 0, display: 'flex', flexDirection: 'column' }}>
            <CouponCard coupon={coupon} template={cs.template} isVertical={isVertical} />
          </div>
        ))}
      </div>
    </div>
  );
}

function UpsellPreview({ upsell, checkoutBg, checkoutText }) {
  // Manual rules show every selected product; only AI mode is capped by limit.
  // Mirror the storefront so the preview count matches what customers see.
  const manualCount = (upsell.manualRules || []).reduce(
    (sum, r) => sum + ((r.upsellProductIds || r.upsellProducts || []).length), 0
  );
  const count = upsell.useAI ? (upsell.limit || 3) : (manualCount || upsell.limit || 3);
  const products = upsellProducts.slice(0, Math.max(1, count));
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

export function CartPreview({ onSave, onDiscard, isDirty, saveStatus = 'idle' }) {
  const { previewMode, setPreviewMode, previewDevice, setPreviewDevice, activeSection, navigateToSection, header, body, footer, settings } = useCartEditor();
  const { symbol: currencySymbol } = useCurrency();

  const designTheme = settings.design?.theme;
  const isDarkTheme = designTheme === "dark";
  const drawerBg = isDarkTheme ? "#1a1a2e" : "#ffffff";
  const drawerTextColor = isDarkTheme ? "#e0e0e0" : "#1a1a1a";
  const previewRootRef = useRef(null);
  const isDesktop = previewDevice === 'desktop';
  const isEmpty = previewMode === 'empty';
  const activeSectionLabel = getSectionLabel(activeSection, body);

  // Replay animation each time the animation setting changes
  const [animKey, setAnimKey] = useState(0);
  const prevAnimRef = useRef(settings.design?.animation);
  useEffect(() => {
    if (settings.design?.animation !== prevAnimRef.current) {
      prevAnimRef.current = settings.design?.animation;
      setAnimKey((k) => k + 1);
    }
  }, [settings.design?.animation]);

  const replayAnimation = useCallback(() => setAnimKey((k) => k + 1), []);

  const animation = settings.design?.animation ?? 'slide';
  const animClass = animation !== 'none' ? `cart-preview-anim-${animation}` : '';

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
    <div ref={previewRootRef} style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden', background: '#f0f1f3' }}>

      {/* ── Preview header ── */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px', background: '#f0f1f3', borderBottom: '1px solid #e1e3e5', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6d7175', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Live Preview</span>
        <div style={{ display: 'flex', border: '1px solid #c9cccf', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          {[{ key: 'desktop', src: DesktopIcon }, { key: 'mobile', src: MobileIcon }].map(({ key, src }) => (
            <button key={key} onClick={() => setPreviewDevice(key)}
              style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 10px', border: 'none', fontSize: 11, fontWeight: 500, cursor: 'pointer', background: previewDevice === key ? '#202223' : '#fff', color: previewDevice === key ? '#fff' : '#6d7175', borderLeft: key === 'mobile' ? '1px solid #c9cccf' : 'none' }}
            >
              <Icon source={src} />
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
          {animation !== 'none' && (
            <button onClick={replayAnimation} title="Replay animation" style={{ padding: '3px 8px', border: '1px solid #c9cccf', borderRadius: 5, background: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer', color: '#6d7175', letterSpacing: '0.3px' }}>
              ▶ Replay
            </button>
          )}
          <Button onClick={onDiscard} disabled={saveStatus === 'saving' || !isDirty} size="slim">Discard</Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={saveStatus === 'saving' || saveStatus === 'saved' || !isDirty}
            loading={saveStatus === 'saving'}
            size="slim"
          >
            Save
          </Button>
        </div>
      </div>

      {/* ── Stage: centers the device frame ── */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: '16px 12px', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Device frame ── */}
        <div style={{ width: isDesktop ? 360 : 320, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: isDesktop ? 10 : 36, border: isDesktop ? '1px solid #d0d0d0' : '3px solid #1a1a1a', background: '#f9f9f9', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>

          {/* Browser chrome (desktop) */}
          {isDesktop && (
            <div style={{ flexShrink: 0, height: 36, background: '#e8e8e8', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10, borderBottom: '1px solid #d0d0d0' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff6f61', display: 'block' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffca55', display: 'block' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3ddc84', display: 'block' }} />
              </div>
              <div style={{ flex: 1, height: 20, background: '#fff', borderRadius: 4, border: '1px solid #ccc' }} />
            </div>
          )}

          {/* Phone top chrome (mobile) */}
          {!isDesktop && <div className="cart-preview-phone-chrome top" />}

          {/* ── Screen area ── */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#f8f8f8' }}>
              {/* Store grid background */}
              <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 39px,#e8e8e8 39px,#e8e8e8 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,#e8e8e8 39px,#e8e8e8 40px)', opacity: 0.4 }} />

              {/* Cart Drawer */}
              <div key={animKey} className={animClass} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '100%', display: 'flex', flexDirection: 'column', background: drawerBg, color: drawerTextColor, boxShadow: '-4px 0 20px rgba(0,0,0,0.12)', overflow: 'hidden' }}>

                {/* Design/CSS global overlay */}
                {['design', 'customCSS'].includes(activeSection) && (
                  <div style={{ position: 'absolute', inset: 0, border: `2px solid ${BRAND}`, background: `rgba(26,157,224,0.08)`, pointerEvents: 'none', zIndex: 100 }}>
                    <span style={{ position: 'absolute', top: 0, left: 0, background: BRAND, color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 7px', lineHeight: '15px', letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{activeSectionLabel}</span>
                  </div>
                )}

                {/* ── HEADER ── */}
                <HighlightZone sectionId="header" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', backgroundColor: header.bgColor, color: header.textColor, borderBottom: header.borderBottom ? '1px solid #e1e3e5' : 'none', flexShrink: 0 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: header.textColor }}>{header.title} {!isEmpty ? '(1)' : '(0)'}</h3>
                    <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: header.textColor, padding: 0, lineHeight: 1 }}>
                      {header.closeStyle === 'icon' ? '×' : 'Close'}
                    </button>
                  </div>
                </HighlightZone>

                {/* ── BODY (scrollable) ── */}
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 8px' }}>

                  {/* Announcements — show when enabled, or show muted placeholder when section is active */}
                  {(body.announcements.enabled || activeSection === 'announcements') && (
                    <HighlightZone sectionId="announcements" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                      <div
                        className={body.announcements.enabled ? 'cart-preview-announcement' : 'cart-preview-announcement cart-preview-announcement--disabled'}
                        style={{ backgroundColor: body.announcements.bgColor, color: body.announcements.textColor, fontSize: `${body.announcements.fontSize}px`, textAlign: body.announcements.textAlign || 'center', fontWeight: body.announcements.bold ? 700 : 400, fontStyle: body.announcements.italic ? 'italic' : 'normal' }}
                      >
                        {body.announcements.text || 'Your announcement text here…'}
                      </div>
                    </HighlightZone>
                  )}

                  {/* Progress Bar — TOP */}
                  {showProgressBar && pb.position === 'top' && (
                    <HighlightZone sectionId="progressBar" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                      <ProgressBarPreview pb={pb} />
                      <PreviewLockBadge featureKey="progress_bar" />
                    </HighlightZone>
                  )}

                  {/* Coupon Slider — TOP */}
                  {showCouponSlider && cs.position === 'top' && (
                    <HighlightZone sectionId="couponSlider" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                      <CouponSliderPreview cs={cs} />
                    </HighlightZone>
                  )}

                  {/* Upsell — TOP */}
                  {showUpsell && up.position === 'top' && (
                    <HighlightZone sectionId="upsellProducts" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                      <UpsellPreview upsell={up} checkoutBg={footer.checkoutButton.bgColor} checkoutText={footer.checkoutButton.textColor} />
                      <PreviewLockBadge featureKey="ai_cart_upsell" />
                    </HighlightZone>
                  )}

                  {/* Empty state OR Cart items */}
                  {isEmpty ? (
                    <HighlightZone sectionId="emptyCart" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center', gap: 10 }}>
                        <div style={{ fontSize: 40, color: '#c9cccf' }}><Icon source={CartIcon} /></div>
                        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#202223' }}>{body.emptyCart.message}</h4>
                        <p style={{ margin: 0, fontSize: 13, color: '#6d7175' }}>Add items to unlock rewards</p>
                        {body.emptyCart.showContinueShopping && (
                          <button onClick={(e) => { e.stopPropagation(); setPreviewMode('items'); }} style={{ marginTop: 4, padding: '8px 18px', border: '1px solid #c9cccf', borderRadius: 7, background: '#fff', fontSize: 13, cursor: 'pointer', color: '#202223' }}>Continue shopping</button>
                        )}
                      </div>
                    </HighlightZone>
                  ) : (
                    <div style={{ padding: '10px 18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6d7175', marginBottom: 10 }}>
                        <span>Items included</span>
                        <span>1 ITEMS</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid #f1f2f3' }}>
                        <div style={{ width: 56, height: 56, background: '#f1f2f3', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="#8c9196" strokeWidth="1.5" style={{ width: 20, height: 20 }}>
                            <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#202223' }}>Sample Product</div>
                          <div style={{ fontSize: 12, color: '#6d7175' }}>{currencySymbol}{CART_TOTAL} (1 × {currencySymbol}{CART_TOTAL})</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
                            <button style={{ width: 24, height: 24, border: '1px solid #c9cccf', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>1</span>
                            <button style={{ width: 24, height: 24, border: '1px solid #c9cccf', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                          </div>
                        </div>
                        <button style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#8c9196', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                      </div>
                    </div>
                  )}

                  {/* Upsell — BOTTOM */}
                  {showUpsell && up.position === 'bottom' && (
                    <HighlightZone sectionId="upsellProducts" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                      <UpsellPreview upsell={up} checkoutBg={footer.checkoutButton.bgColor} checkoutText={footer.checkoutButton.textColor} />
                      <PreviewLockBadge featureKey="ai_cart_upsell" />
                    </HighlightZone>
                  )}

                  {/* Empty cart recommendations */}
                  {isEmpty && body.emptyCart.showRecommendations && !up.showWhenEmpty && (
                    <div style={{ padding: '12px 18px', borderTop: '1px solid #e1e3e5' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Recommended For You</div>
                      {upsellProducts.slice(0, 2).map((product) => (
                        <div key={product.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                          <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg,#f1f2f3,#e8e9eb)', borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b0b3b8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                            </svg>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{product.title}</div>
                            <div style={{ fontSize: 11, color: '#6d7175' }}>{product.price}</div>
                          </div>
                          <button style={{ padding: '5px 12px', borderRadius: 5, border: 'none', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', backgroundColor: footer.checkoutButton.bgColor, color: footer.checkoutButton.textColor }}>Add</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Progress Bar — BOTTOM */}
                  {showProgressBar && pb.position === 'bottom' && (
                    <HighlightZone sectionId="progressBar" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                      <ProgressBarPreview pb={pb} />
                      <PreviewLockBadge featureKey="progress_bar" />
                    </HighlightZone>
                  )}

                  {/* Coupon Slider — BOTTOM */}
                  {showCouponSlider && cs.position === 'bottom' && (
                    <HighlightZone sectionId="couponSlider" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                      <CouponSliderPreview cs={cs} />
                    </HighlightZone>
                  )}
                </div>

                {/* ── FOOTER ── */}
                {!isEmpty && (
                  <HighlightZone sectionId="checkoutButton" activeSection={activeSection} label={activeSectionLabel} onSectionClick={navigateToSection}>
                    <div style={{ padding: '12px 18px', borderTop: '1px solid #e1e3e5', flexShrink: 0, background: drawerBg }}>
                      {/* Subtotal */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: '#6d7175' }}>Subtotal</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{currencySymbol}{CART_TOTAL}</span>
                      </div>
                      {/* Total */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>Total</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{currencySymbol}{CART_TOTAL}</span>
                      </div>
                      {/* Checkout button */}
                      {!isDesktop && footer.checkoutButton.mobileButtonType === 'swipe' ? (
                        <div style={{ background: footer.checkoutButton.bgColor, borderRadius: `${footer.checkoutButton.borderRadius}px`, height: 44, display: 'flex', alignItems: 'center', overflow: 'hidden', position: 'relative', cursor: 'pointer' }}>
                          <div style={{ width: 38, height: 38, margin: 3, borderRadius: `${Math.max(footer.checkoutButton.borderRadius - 2, 4)}px`, background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.18)', flexShrink: 0, zIndex: 1, position: 'relative' }}>
                            <span style={{ color: footer.checkoutButton.bgColor, fontSize: 16, lineHeight: 1 }}>›</span>
                          </div>
                          <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', color: footer.checkoutButton.textColor, fontSize: 12, fontWeight: 600, letterSpacing: '0.3px', pointerEvents: 'none' }}>Swipe to checkout</span>
                        </div>
                      ) : (
                        <button style={{ width: '100%', padding: '11px', border: 'none', borderRadius: `${footer.checkoutButton.borderRadius}px`, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: footer.checkoutButton.bgColor, color: footer.checkoutButton.textColor }}>
                          {footer.checkoutButton.text} →
                        </button>
                      )}
                      {/* Footer note */}
                      <div style={{ textAlign: 'center', fontSize: 11, color: '#8c9196', marginTop: 6 }}>{footer.checkoutButton.footerText}</div>
                    </div>
                  </HighlightZone>
                )}
              </div>{/* end cart-preview-drawer */}
          </div>{/* end screen area */}

          {!isDesktop && <div className="cart-preview-phone-chrome bottom" />}
        </div>{/* end device frame */}
      </div>{/* end stage */}

    </div>
  );
}
