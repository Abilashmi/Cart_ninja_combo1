import { useCallback, useEffect, useRef, useState } from 'react';
import { useLoaderData, useParams } from 'react-router';
import { getCurrencySymbol } from '../utils/currency.shared';
import { loadComboPageData } from '../services/combo-page.server';
import { CdoPreviewBar } from '../components/CdoPreviewBar';

// Small inline SVG icons in place of plain-text Unicode glyphs (✓ ✕ ‹ › ← →
// ⚠) — 1em/currentColor so each inherits the calling element's own
// font-size/color inline styles with no other props needed.
function IconCheck() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <polyline points="4 12 10 18 20 6" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ display: 'block' }}>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}
function IconChevronLeft() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <polyline points="15 5 8 12 15 19" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <polyline points="9 5 16 12 9 19" />
    </svg>
  );
}
function IconWarning() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M12 3 L22 20 L2 20 Z" />
      <line x1="12" y1="10" x2="12" y2="15" />
      <circle cx="12" cy="17.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export const loader = async ({ params, request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const templateId = params.templateId;
  const embed = url.searchParams.get('embed') === '1';

  if (!templateId) throw new Response('Template ID required', { status: 400 });
  if (!shop) throw new Response('Shop parameter required', { status: 400 });

  const data = await loadComboPageData(shop, templateId);
  return { ...data, embed };
};

// Mirrors the builder's device-toggle preview (app.bundles.customize.jsx
// ComboPreview) but for a real responsive page there's no toggle — this
// tracks the same breakpoint the builder's own CSS uses (768px).
//
// When embedded (see combo-page[.]js.jsx), matchMedia here evaluates against
// the IFRAME's own nested browsing context, not the shopper's actual browser
// width — a Shopify Page's content column is often narrower than 767px even
// on a wide desktop screen, so the grid would wrongly fall back to
// mobile_columns. The parent page has the real width, so it posts it in
// (brix-combo-viewport); we request it on mount (brix-combo-ready) since the
// parent's iframe 'load' handler can otherwise race ahead of this listener.
function useIsMobile(embed) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!embed || typeof window === 'undefined') return;
    const handler = (e) => {
      if (!e.data || e.data.type !== 'brix-combo-viewport') return;
      if (typeof e.data.width === 'number') setIsMobile(e.data.width < 768);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: 'brix-combo-ready' }, '*');
    return () => window.removeEventListener('message', handler);
  }, [embed]);

  return isMobile;
}

// container_padding_{side}_desktop/mobile — the outer content wrapper's
// padding in the builder's generic (layout2/layout4) render path.
function getContainerPadding(config, isMobile) {
  const side = (s) => (isMobile
    ? config[`container_padding_${s}_mobile`]
    : config[`container_padding_${s}_desktop`]);
  return {
    paddingTop: side('top'), paddingRight: side('right'),
    paddingBottom: side('bottom'), paddingLeft: side('left'),
  };
}

// title_container_*/description_container_* padding+margin, each with a
// `_mobile` variant that falls back to the desktop value when unset —
// matches app.bundles.customize.jsx ComboPreview's titlePadding/descriptionPadding.
function getBoxSpacing(config, prefix, isMobile) {
  const get = (part) => {
    const desktop = config[`${prefix}_${part}`];
    if (!isMobile) return desktop;
    const mobile = config[`${prefix}_${part}_mobile`];
    return mobile ?? desktop;
  };
  return {
    paddingTop: get('padding_top'), paddingRight: get('padding_right'),
    paddingBottom: get('padding_bottom'), paddingLeft: get('padding_left'),
    marginTop: get('margin_top'), marginRight: get('margin_right'),
    marginBottom: get('margin_bottom'), marginLeft: get('margin_left'),
  };
}

function getBannerSizing(config, isMobile) {
  const bannerWidth = isMobile
    ? (config.banner_width_mobile || config.banner_width_desktop || 100)
    : (config.banner_width_desktop || 100);
  const bannerHeight = isMobile
    ? (config.banner_height_mobile || config.banner_height_desktop || 120)
    : (config.banner_height_desktop || 180);
  const finalBannerHeight = config.banner_fit_mode === 'adapt' ? 'auto' : `${bannerHeight}px`;
  const bannerObjectFit = config.banner_fit_mode === 'cover' || config.banner_fit_mode === 'contain'
    ? config.banner_fit_mode
    : 'initial';
  const bannerUrl = (isMobile && config.banner_image_mobile_url)
    ? config.banner_image_mobile_url
    : config.banner_image_url;
  return { bannerWidth, finalBannerHeight, bannerObjectFit, bannerUrl };
}

function getProductSizing(config, isMobile) {
  const productTitleSize = isMobile ? (config.product_title_size_mobile || 14) : (config.product_title_size_desktop || 16);
  const productPriceSize = isMobile ? (config.product_price_size_mobile || 14) : (config.product_price_size_desktop || 15);
  const ratio = config.product_image_ratio || 'square';
  const productImageAspectRatio = ratio === 'portrait' ? '3 / 4' : ratio === 'rectangle' ? '4 / 3' : '1 / 1';
  return { productTitleSize, productPriceSize, productImageAspectRatio };
}

// Matches app.bundles.customize.jsx ComboPreview's heading typography derivation
// (headingFontFamily/Letter Spacing/Line Height/Text Transform/title width) so
// the storefront heading can't drift from what the builder renders.
function getHeadingStyle(config) {
  const fontFamily = config.heading_font_family && config.heading_font_family !== 'inherit'
    ? `'${config.heading_font_family}', sans-serif`
    : 'inherit';
  return {
    fontFamily,
    letterSpacing: `${config.heading_letter_spacing ?? 0}px`,
    lineHeight: config.heading_line_height ?? 1.2,
    textTransform: config.heading_text_transform || 'none',
  };
}

function getTitleWidthStyle(config) {
  const mode = config.title_max_width_mode || 'auto';
  if (mode === 'full') return { width: '100%' };
  if (mode === 'custom') return { width: '100%', maxWidth: `${config.title_max_width_custom ?? 400}px` };
  return { width: `${config.title_width || 100}%` };
}

// Poppins/Montserrat/Roboto aren't loaded on the storefront by default (Inter
// is, via the <link> in the root document head) — this fetches only the
// chosen font's stylesheet, matching ComboPreview's on-demand Google Fonts load.
function GoogleFontLink({ family }) {
  if (!family || family === 'inherit' || family === 'Inter') return null;
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700;800&display=swap`;
  return <link rel="stylesheet" href={href} />;
}

function Lightbox({ images, onClose, onPrev, onNext, goTo }) {
  const [idx, setIdx] = useState(0);
  const img = images[idx];
  if (!img) return null;

  const prev = () => { const n = idx <= 0 ? images.length - 1 : idx - 1; setIdx(n); onPrev?.(); };
  const next = () => { const n = idx >= images.length - 1 ? 0 : idx + 1; setIdx(n); onNext?.(); };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer',
    }}>
      {images.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); prev(); }} style={{
            position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
            width: '48px', height: '48px', borderRadius: '50%',
            fontSize: '24px', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}><IconChevronLeft /></button>
          <button onClick={(e) => { e.stopPropagation(); next(); }} style={{
            position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
            width: '48px', height: '48px', borderRadius: '50%',
            fontSize: '24px', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}><IconChevronRight /></button>
        </>
      )}
      <button onClick={onClose} style={{
        position: 'absolute', top: '20px', right: '20px',
        background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
        width: '40px', height: '40px', borderRadius: '50%',
        fontSize: '20px', cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}><IconClose /></button>

      <img
        src={img.url} alt={img.altText || ''}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '85vw', maxHeight: '75vh', objectFit: 'contain',
          borderRadius: '8px', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      />

      {images.length > 1 && (
        <div onClick={(e) => e.stopPropagation()} style={{
          position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: '8px', padding: '10px 16px',
          background: 'rgba(0,0,0,0.6)', borderRadius: '12px',
        }}>
          {images.map((im, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setIdx(i); goTo?.(i); }}
              style={{
                width: '48px', height: '48px', borderRadius: '6px',
                border: i === idx ? '2px solid #fff' : '2px solid transparent',
                overflow: 'hidden', cursor: 'pointer', padding: 0,
                opacity: i === idx ? 1 : 0.5,
              }}>
              <img src={im.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceSummary({ totalSelected, totalPrice, finalPrice, discountApplicable }) {
  if (totalSelected === 0) return null;
  return (
    <div style={{
      display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline',
      gap: '8px', margin: '0 0 8px', fontSize: '15px',
    }}>
      {discountApplicable ? (
        <>
          <span style={{ textDecoration: 'line-through', color: '#999', fontSize: '13px' }}>
            ${totalPrice.toFixed(2)}
          </span>
          <span style={{ color: '#22c55e', fontWeight: 800 }}>
            ${finalPrice.toFixed(2)}
          </span>
        </>
      ) : (
        <span style={{ fontWeight: 700 }}>${totalPrice.toFixed(2)}</span>
      )}
    </div>
  );
}

function ProgressBar({ selectedCount, maxProducts, config }) {
  if (!config.show_progress_bar) return null;
  const threshold = parseInt(maxProducts) || 5;
  const percent = Math.min(100, Math.floor((selectedCount / threshold) * 100));
  const isUnlocked = selectedCount >= threshold;
  const remaining = Math.max(0, threshold - selectedCount);
  const barColor = isUnlocked
    ? (config.progress_success_color || '#22c55e')
    : (config.progress_bar_color || '#000');
  const textColor = config.progress_text_color || '#333';

  return (
    <div style={{
      width: `${config.progress_bar_width || 100}%`,
      margin: '8px auto 16px', padding: '0 5px', boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        fontSize: '13px', fontWeight: '700', marginBottom: '10px',
      }}>
        <div>
          {isUnlocked ? (
            <span style={{ fontWeight: 700, color: textColor, textTransform: 'uppercase' }}>
              {config.discount_unlocked_text || 'DISCOUNT UNLOCKED!'}
            </span>
          ) : (
            <span style={{ textTransform: 'uppercase', fontWeight: 700, color: textColor, letterSpacing: '0.5px' }}>
              ADD {remaining} MORE FOR {config.discount_text || 'DISCOUNT'}
            </span>
          )}
        </div>
        <div style={{ color: textColor, fontWeight: 800 }}>{percent}%</div>
      </div>
      <div style={{
        height: '12px', borderRadius: '12px', width: '100%', boxSizing: 'border-box',
        background: '#e0e0e0', overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          height: '100%', width: `${percent}%`, background: barColor,
          borderRadius: '12px', transition: 'width 0.5s ease, background 0.4s',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
            transform: 'translateX(-100%)',
            animation: 'combo-shimmer 2s infinite',
          }} />
        </div>
      </div>
    </div>
  );
}

function ProductCard({ product, config, selectedMap, onAdd, onQtyChange, onRemove, onImageClick, isMobile = false }) {
  const btnBg = config.add_btn_bg || config.product_add_btn_color || '#000';
  const btnTextColor = config.add_btn_text_color || config.product_add_btn_text_color || '#fff';
  const btnRadius = config.add_btn_border_radius ?? 8;
  const btnFontWeight = config.add_btn_font_weight || config.product_add_btn_font_weight || 600;
  const btnFontSize = isMobile
    ? (config.add_btn_font_size_mobile ?? config.add_btn_font_size ?? config.product_add_btn_font_size ?? 14)
    : (config.add_btn_font_size ?? config.product_add_btn_font_size ?? 14);
  const addBtnText = config.add_btn_text || config.product_add_btn_text || 'Add';
  const cardRadius = config.card_border_radius || 12;
  const textColor = config.text_color || '#1a1a1a';
  const primaryColor = config.primary_color || '#000000';
  const highlightColor = config.selection_highlight_color || '#22c55e';
  const showAddBtn = config.show_add_to_cart_btn !== false;
  const showQtySelector = config.show_quantity_selector !== false;
  const showSelectionTick = config.show_selection_tick !== false;
  const variantsDisplay = config.product_card_variants_display || 'static';
  const enableHover = !!config.enable_product_hover;
  const hoverMode = config.product_hover_mode || 'second_image';
  const { productTitleSize, productPriceSize, productImageAspectRatio } = getProductSizing(config, isMobile);
  const cardPadding = config.product_card_padding ?? 10;

  const variants = product.variants || [];
  const hasVariants = variants.length > 1;

  const [pendingVariantId, setPendingVariantId] = useState(
    variants[0]?.id || product.variantId || ''
  );
  const [imgIndex, setImgIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [showVariantPopup, setShowVariantPopup] = useState(false);

  const activeVariantId = pendingVariantId;
  const activeVariant = variants.find((v) => String(v.id) === String(activeVariantId));
  const selection = selectedMap[activeVariantId];
  const isAdded = !!selection;
  const qty = selection?.qty || 0;
  const displayPrice = activeVariant?.price != null ? parseFloat(activeVariant.price) : parseFloat(product.price || 0);

  // Other sizes/variants of this same product already in the combo, so
  // switching the selector doesn't make them appear to vanish.
  const otherAdded = hasVariants
    ? variants.filter((v) => String(v.id) !== String(activeVariantId) && selectedMap[v.id])
    : [];

  const images = (product.images && product.images.length > 0)
    ? product.images
    : (product.image ? [product.image] : []);
  const safeImgIndex = imgIndex >= images.length ? 0 : imgIndex;
  const displayImage = activeVariant?.image || images[safeImgIndex] || product.image;

  const handleVariantSelect = (variantId) => {
    setPendingVariantId(variantId);
  };

  const handleAddClick = () => {
    if (isAdded) {
      if (!showQtySelector) { onRemove(activeVariantId); return; }
      handleInc();
      return;
    }
    if (hasVariants && variantsDisplay === 'popup') {
      setShowVariantPopup(true);
      return;
    }
    onAdd(product, activeVariantId, 1);
  };

  const handleInc = () => {
    if (!isAdded) {
      onAdd(product, activeVariantId, 1);
    } else {
      onQtyChange(activeVariantId, qty + 1);
    }
  };

  const handleDec = () => {
    if (!isAdded) return;
    if (qty <= 1) onRemove(activeVariantId);
    else onQtyChange(activeVariantId, qty - 1);
  };

  const showVariantSelect = hasVariants
    && variantsDisplay !== 'popup'
    && (variantsDisplay !== 'hover' || isHovered || isMobile);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={!showAddBtn && !isAdded ? handleAddClick : undefined}
      style={{
        border: `2px solid ${isAdded ? highlightColor : '#eee'}`,
        borderRadius: `${cardRadius}px`,
        overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column',
        position: 'relative', transition: 'border-color 0.2s',
        cursor: !showAddBtn && !isAdded ? 'pointer' : 'default',
      }}>
      {isAdded && showSelectionTick && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 4,
          background: highlightColor, color: '#fff',
          width: 22, height: 22, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }}><IconCheck /></div>
      )}

      {showVariantPopup && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', inset: 0, zIndex: 5,
            background: 'rgba(255,255,255,0.98)',
            display: 'flex', flexDirection: 'column', padding: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#666' }}>Pick Options</span>
            <button type="button" onClick={() => setShowVariantPopup(false)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}><IconClose /></button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {variants.map((v) => (
              <div key={v.id}
                onClick={() => { setPendingVariantId(v.id); onAdd(product, v.id, 1); setShowVariantPopup(false); }}
                style={{
                  padding: 8, border: '1px solid #eee', borderRadius: 8, textAlign: 'center',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                  background: pendingVariantId === v.id ? highlightColor : '#f9f9f9',
                  color: pendingVariantId === v.id ? '#fff' : '#333',
                }}
              >
                {v.title}
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          width: '100%', aspectRatio: productImageAspectRatio,
          background: '#f5f5f5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', cursor: 'pointer', position: 'relative',
        }}>
        <div onClick={() => onImageClick(product)} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {displayImage ? (
            <img src={displayImage.url} alt={displayImage.altText || product.title}
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                transition: 'transform 0.3s ease, opacity 0.3s ease',
                transform: isHovered && enableHover ? 'scale(1.05)' : 'scale(1)',
                opacity: isHovered && enableHover ? 0 : 1,
              }}
            />
          ) : (
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          )}
        </div>

        {enableHover && isHovered && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.95)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 12, boxSizing: 'border-box', textAlign: 'center',
          }}>
            {hoverMode === 'second_image' && product.secondImageSrc ? (
              <img src={product.secondImageSrc} alt="Hover view" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : hoverMode === 'description' && product.descriptionHtml ? (
              <div style={{
                fontSize: 13, color: '#333', lineHeight: 1.5, fontWeight: 500,
                display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}
                dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
              />
            ) : null}
          </div>
        )}

        {hasVariants && variantsDisplay === 'hover' && isHovered && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'rgba(255,255,255,0.95)', padding: 10, borderTop: '1px solid #eee',
            zIndex: 3, display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 80, overflowY: 'auto',
          }}>
            {variants.map((v) => (
              <div key={v.id}
                onClick={(e) => { e.stopPropagation(); handleVariantSelect(v.id); }}
                style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                  border: pendingVariantId === v.id ? `1px solid ${highlightColor}` : '1px solid #ddd',
                  background: pendingVariantId === v.id ? highlightColor : 'white',
                  color: pendingVariantId === v.id ? 'white' : 'black',
                }}
              >
                {v.title}
              </div>
            ))}
          </div>
        )}

        {!enableHover && !activeVariant?.image && images.length > 1 && (
          <>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); setImgIndex((i) => (i <= 0 ? images.length - 1 : i - 1)); }}
              style={{
                position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)',
                width: '26px', height: '26px', borderRadius: '50%', border: 'none',
                background: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><IconChevronLeft /></button>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); setImgIndex((i) => (i >= images.length - 1 ? 0 : i + 1)); }}
              style={{
                position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)',
                width: '26px', height: '26px', borderRadius: '50%', border: 'none',
                background: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><IconChevronRight /></button>
            <div style={{
              position: 'absolute', bottom: '6px', left: '50%', transform: 'translateX(-50%)',
              display: 'flex', gap: '4px',
            }}>
              {images.map((_, i) => (
                <span key={i} onClick={(e) => { e.stopPropagation(); setImgIndex(i); }} style={{
                  width: '6px', height: '6px', borderRadius: '50%', cursor: 'pointer',
                  background: i === safeImgIndex ? primaryColor : 'rgba(0,0,0,0.25)',
                }} />
              ))}
            </div>
          </>
        )}
      </div>
      <div style={{ padding: `${cardPadding}px`, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{
          fontSize: `${productTitleSize}px`, fontWeight: 500, lineHeight: 1.3, marginBottom: '4px',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden', color: textColor,
        }}>
          {product.title}
        </div>

        {showVariantSelect && (
          <select
            value={activeVariantId || ''}
            onChange={(e) => handleVariantSelect(e.target.value)}
            style={{
              marginBottom: '8px', fontSize: '12px', padding: '5px 6px',
              border: '1px solid #ddd', borderRadius: '6px', background: '#fff', color: textColor,
            }}
          >
            {variants.map((v) => (
              <option key={v.id} value={v.id}>{v.title}</option>
            ))}
          </select>
        )}

        {otherAdded.length > 0 && (
          <div style={{ fontSize: '11px', color: highlightColor, marginBottom: '6px' }}>
            Also in combo: {otherAdded.map((v) => `${v.title} ×${selectedMap[v.id].qty}`).join(', ')}
          </div>
        )}

        <div style={{ fontSize: `${productPriceSize}px`, fontWeight: 600, color: primaryColor, marginBottom: '8px' }}>
          {getCurrencySymbol(product.currency)}{displayPrice.toFixed(2)}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 0 0', borderTop: '1px solid #eee',
          justifyContent: 'space-between',
        }}>
          {showQtySelector && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button type="button" onClick={handleDec}
                style={{
                  width: 30, height: 30, border: '1px solid #ddd', background: '#f9f9f9',
                  borderRadius: '6px 0 0 6px', cursor: 'pointer', fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                }}>−</button>
              <span style={{
                width: 35, textAlign: 'center', fontWeight: 700, fontSize: 14,
                border: '1px solid #ddd', borderLeft: 'none', borderRight: 'none', padding: '6px 0',
              }}>{qty}</span>
              <button type="button" onClick={handleInc}
                style={{
                  width: 30, height: 30, border: '1px solid #ddd', background: '#f9f9f9',
                  borderRadius: '0 6px 6px 0', cursor: 'pointer', fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                }}>+</button>
            </div>
          )}
          {showAddBtn && (
            <button type="button" onClick={handleAddClick}
              style={{
                flex: 1, background: isAdded ? '#ff4d4d' : btnBg, color: btnTextColor,
                border: 'none', padding: '8px 12px', marginLeft: 4,
                borderRadius: `${btnRadius}px`, cursor: 'pointer',
                fontWeight: btnFontWeight, fontSize: `${btnFontSize}px`,
                transition: 'all 0.2s',
              }}>
              {addBtnText}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Generic product grid used by Layout2/Layout4 — mirrors
// app.bundles.customize.jsx ComboPreview's renderProductsGrid(): a plain
// (non-configurable) arrow style whenever grid_layout_type is 'slider',
// otherwise a responsive grid using desktop/mobile column counts.
function GenericProductGrid({ products, config, isMobile, selectedMap, onAdd, onQtyChange, onRemove, onImageClick }) {
  const sliderRef = useRef(null);
  const gridColumns = isMobile ? (config.mobile_columns || 2) : (config.desktop_columns || 3);
  const gridGap = Number(config.products_gap ?? 12);
  const isSlider = config.grid_layout_type === 'slider';

  return (
    <div style={{ width: `${config.grid_width || 100}%`, margin: '0 auto' }}>
      <div style={{ position: 'relative', width: '100%' }}>
        {isSlider && (
          <>
            <button type="button" onClick={() => sliderRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
              style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                width: 36, height: 36, borderRadius: '50%', background: '#fff', border: '1px solid #ddd',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                zIndex: 10, boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
              }}><IconChevronLeft /></button>
            <button type="button" onClick={() => sliderRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                width: 36, height: 36, borderRadius: '50%', background: '#fff', border: '1px solid #ddd',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                zIndex: 10, boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
              }}><IconChevronRight /></button>
          </>
        )}
        <div ref={sliderRef} style={{
          display: isSlider ? 'flex' : 'grid',
          gridTemplateColumns: isSlider ? 'none' : `repeat(${gridColumns}, minmax(0, 1fr))`,
          flexDirection: isSlider ? 'row' : 'column', flexWrap: 'nowrap', gap: gridGap,
          width: '100%', boxSizing: 'border-box', alignItems: 'stretch',
          overflowX: isSlider ? 'auto' : 'visible', overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch', scrollSnapType: isSlider ? 'x mandatory' : 'none',
          paddingLeft: isSlider ? 20 : 0, paddingRight: isSlider ? 20 : 0,
          scrollbarWidth: 'none',
        }}>
          {products.map((product) => (
            <div key={product.id} style={{
              minWidth: isSlider ? (isMobile ? 220 : 280) : 'auto',
              width: isSlider ? (isMobile ? 220 : 280) : 'auto',
              flexShrink: 0, scrollSnapAlign: 'start',
            }}>
              <ProductCard product={product} config={config} isMobile={isMobile}
                selectedMap={selectedMap} onAdd={onAdd} onQtyChange={onQtyChange}
                onRemove={onRemove} onImageClick={onImageClick}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Layout2Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selectedMap, onAdd, onQtyChange, onRemove, onImageClick,
                          totalSelected, maxProducts, onCheckout,
                          totalPrice, finalPrice, discountApplicable, isMobile = false,
                          selectedProducts, onReset, barCurrencySymbol }) {
  const tabs = [];
  if (config.show_tab_all !== false) {
    tabs.push({ label: config.tab_all_label || 'Collections', value: 'all' });
  }
  for (let i = 1; i <= (config.tab_count || 8); i++) {
    const handle = config[`col_${i}`];
    if (handle) {
      const col = collectionNameMap[handle];
      tabs.push({
        label: col || config[`step_${i}_title`] || handle,
        value: handle,
      });
    }
  }

  const [activeTab, setActiveTab] = useState('all');

  const tabAlignment = config.tab_alignment || 'left';
  const tabFontSize = config.tab_font_size || 13;
  const tabRadius = config.tab_border_radius ?? 25;
  const activeBg = config.tab_active_bg_color || config.selection_highlight_color || '#5e1c5f';
  const tabBg = config.tab_bg_color || '#fff';
  const tabText = config.tab_text_color || '#444';
  const tabActiveText = config.tab_active_text_color || '#fff';
  const tabPaddingV = config.tab_padding_vertical || 8;
  const tabPaddingH = config.tab_padding_horizontal || 18;
  const tabMarginTop = config.tab_margin_top ?? 0;
  const tabMarginBottom = config.tab_margin_bottom ?? 24;

  const textColor = config.text_color || '#1a1a1a';
  const headingColor = config.heading_color || '#333';
  const descriptionColor = config.description_color || '#666';
  const headingSize = isMobile ? (config.heading_size_mobile ?? config.heading_size ?? 22) : (config.heading_size ?? 32);
  const descriptionSize = isMobile ? (config.description_size_mobile ?? config.description_size ?? 13) : (config.description_size ?? 16);
  const headingAlign = isMobile ? (config.heading_align_mobile || config.heading_align || 'left') : (config.heading_align || 'left');
  const descriptionAlign = isMobile ? (config.description_align_mobile || config.description_align || 'left') : (config.description_align || 'left');
  const headingFontWeight = config.heading_font_weight || '700';
  const descriptionFontWeight = config.description_font_weight || '400';
  const titleBox = getBoxSpacing(config, 'title_container', isMobile);
  const descBox = getBoxSpacing(config, 'description_container', isMobile);
  const containerPad = getContainerPadding(config, isMobile);
  const { bannerWidth, finalBannerHeight, bannerObjectFit, bannerUrl } = getBannerSizing(config, isMobile);

  let activeProducts = [];
  if (activeTab === 'all') {
    const seen = new Set();
    tabs.forEach((t) => {
      if (t.value !== 'all') {
        (productsByHandle[t.value] || []).forEach((p) => {
          if (!seen.has(p.id)) { seen.add(p.id); activeProducts.push(p); }
        });
      }
    });
  } else {
    activeProducts = productsByHandle[activeTab] || [];
  }

  return (
    <div style={{ background: '#eef1f5', padding: 16 }}>
      <div style={{
        fontFamily: 'inherit', color: textColor,
        paddingTop: containerPad.paddingTop, paddingRight: containerPad.paddingRight,
        paddingBottom: containerPad.paddingBottom, paddingLeft: containerPad.paddingLeft,
        background: config.bg_color || '#f9f9f9', maxWidth: '100%', margin: '0 auto',
        border: '1px solid #e5e5e5', borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
        position: 'relative', overflow: 'hidden',
      }}>
        {config.show_banner !== false && bannerUrl && (
          <div style={{
            position: 'relative', width: `${bannerWidth}%`, margin: '0 auto',
            height: finalBannerHeight, overflow: 'hidden',
          }}>
            <img src={bannerUrl} alt="Banner"
              style={{ width: '100%', height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%', objectFit: bannerObjectFit }}
            />
          </div>
        )}

        {config.show_title_description !== false && (
          <div style={{ ...getTitleWidthStyle(config), margin: '0 auto' }}>
            <div style={{
              textAlign: headingAlign,
              paddingTop: titleBox.paddingTop, paddingRight: titleBox.paddingRight,
              paddingBottom: titleBox.paddingBottom, paddingLeft: titleBox.paddingLeft,
              marginTop: titleBox.marginTop, marginRight: titleBox.marginRight,
              marginBottom: titleBox.marginBottom, marginLeft: titleBox.marginLeft,
            }}>
              <h1 style={{ fontSize: `${headingSize}px`, margin: 0, marginBottom: 4, color: headingColor, fontWeight: headingFontWeight, textAlign: headingAlign, ...getHeadingStyle(config) }}>
                {config.collection_title || 'Create Your Combo'}
              </h1>
            </div>
            {config.collection_description && (
              <div style={{
                textAlign: descriptionAlign,
                paddingTop: descBox.paddingTop, paddingRight: descBox.paddingRight,
                paddingBottom: descBox.paddingBottom, paddingLeft: descBox.paddingLeft,
                marginTop: descBox.marginTop, marginRight: descBox.marginRight,
                marginBottom: descBox.marginBottom, marginLeft: descBox.marginLeft,
              }}>
                <p style={{ fontSize: `${descriptionSize}px`, color: descriptionColor, fontWeight: descriptionFontWeight, textAlign: descriptionAlign }}>
                  {config.collection_description}
                </p>
              </div>
            )}
          </div>
        )}

        {tabs.length > 0 && (
          <div style={{
            width: `${config.tabs_width || 100}%`, margin: '0 auto',
            marginTop: `${tabMarginTop}px`, marginBottom: `${tabMarginBottom}px`,
          }}>
            <div style={{
              padding: '12px 20px', display: 'flex', justifyContent: tabAlignment,
              gap: '10px', overflowX: 'auto', borderBottom: '1px solid #eee',
              background: '#fff', scrollbarWidth: 'thin',
            }}>
              {tabs.map((tab, idx) => {
                const isActive = tab.value === activeTab;
                return (
                  <button key={idx} type="button" onClick={() => setActiveTab(tab.value)} style={{
                    padding: `${tabPaddingV}px ${tabPaddingH}px`,
                    borderRadius: `${tabRadius}px`,
                    border: `1px solid ${isActive ? activeBg : config.tab_border_color || '#eee'}`,
                    background: isActive ? activeBg : tabBg,
                    color: isActive ? tabActiveText : tabText,
                    fontSize: `${tabFontSize}px`, fontWeight: 600,
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.3s ease',
                  }}>
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ padding: '20px' }}>
          <PriceSummary totalSelected={totalSelected} totalPrice={totalPrice} finalPrice={finalPrice} discountApplicable={discountApplicable} />
          <ProgressBar selectedCount={totalSelected} maxProducts={maxProducts} config={config} />
          {activeProducts.length === 0 ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              background: '#f9fafb', borderRadius: '8px',
              border: '2px dashed #e1e3e5', color: '#8c9196', fontSize: '13px',
            }}>
              <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
                </svg>
              </div>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>No products in this tab</div>
            </div>
          ) : (
            <GenericProductGrid products={activeProducts} config={config} isMobile={isMobile}
              selectedMap={selectedMap} onAdd={onAdd} onQtyChange={onQtyChange}
              onRemove={onRemove} onImageClick={onImageClick}
            />
          )}
        </div>

      </div>
      <CdoPreviewBar
        config={config}
        selectedProducts={selectedProducts}
        totalPrice={totalPrice}
        finalPrice={finalPrice}
        isMobile={isMobile}
        currencySymbol={barCurrencySymbol}
        onCheckoutClick={onCheckout}
        onResetClick={onReset}
      />
    </div>
  );
}

function Layout3Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selectedMap, onAdd, onQtyChange, onRemove, onImageClick,
                          totalSelected, maxProducts, onCheckout,
                          totalPrice, finalPrice, discountApplicable, isMobile = false,
                          selectedProducts, onReset, barCurrencySymbol }) {
  const primaryColor = config.primary_color || '#20D060';
  const textColor = config.text_color || '#111';
  const bannerObjectFit = config.banner_fit_mode === 'contain' ? 'contain' : 'cover';

  // Nav pills — one per configured collection (col_1..col_4), plus an "All" pill.
  const tabs = [];
  if (config.show_tab_all !== false) {
    tabs.push({ label: config.title_1 || 'All Packs', value: 'all' });
  }
  for (let i = 1; i <= 4; i++) {
    const handle = config[`col_${i}`];
    if (handle) {
      tabs.push({ label: collectionNameMap[handle] || config[`title_${i}`] || handle, value: handle });
    }
  }
  const [activeTab, setActiveTab] = useState('all');
  let activeProducts = [];
  if (activeTab === 'all') {
    const seen = new Set();
    tabs.forEach((t) => {
      if (t.value !== 'all') {
        (productsByHandle[t.value] || []).forEach((p) => {
          if (!seen.has(p.id)) { seen.add(p.id); activeProducts.push(p); }
        });
      }
    });
  } else {
    activeProducts = productsByHandle[activeTab] || [];
  }

  // Banner slider — banner_1/2/3_image/title/subtitle, auto-rotating.
  const banners = [1, 2, 3].map((i) => ({
    image: config[`banner_${i}_image`],
    title: config[`banner_${i}_title`],
    subtitle: config[`banner_${i}_subtitle`],
  })).filter((b) => b.image);
  const [currentSlide, setCurrentSlide] = useState(0);
  useEffect(() => {
    if (!config.enable_banner_slider || banners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % banners.length);
    }, (config.slider_speed || 5) * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enable_banner_slider, config.slider_speed, banners.length]);

  // Countdown timer + optional bundle title/subtitle rotation on reset.
  const titles = (config.bundle_titles || '').split(',').map((t) => t.trim()).filter(Boolean);
  const subtitles = (config.bundle_subtitles || '').split(',').map((t) => t.trim()).filter(Boolean);
  const [bundleIndex, setBundleIndex] = useState(0);
  const initialSeconds = Number(config.timer_hours || 0) * 3600 + Number(config.timer_minutes || 0) * 60 + Number(config.timer_seconds || 0);
  const [timeLeft, setTimeLeft] = useState(initialSeconds);
  useEffect(() => {
    if (timeLeft <= 0) {
      if (config.auto_reset_timer) {
        setTimeLeft(initialSeconds);
        if (config.change_bundle_on_timer_end && titles.length > 0) {
          setBundleIndex((prev) => (prev + 1) % titles.length);
        }
      }
      return;
    }
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, config.auto_reset_timer, config.change_bundle_on_timer_end]);
  const time = (() => {
    const s = Math.max(0, timeLeft);
    return {
      h: String(Math.floor(s / 3600)).padStart(2, '0'),
      m: String(Math.floor((s % 3600) / 60)).padStart(2, '0'),
      s: String(s % 60).padStart(2, '0'),
    };
  })();

  return (
    <div style={{ maxWidth: '480px', margin: '24px auto', padding: '0 16px' }}>
      <div style={{
        background: config.bg_color || '#eef2f7', fontFamily: 'inherit', color: textColor,
        borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
      }}>
        <div style={{ paddingBottom: '24px' }}>
          {config.show_hero !== false && (
            <div style={{ padding: '16px 20px' }}>
              <div style={{ background: '#fff', borderRadius: '20px', padding: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                <div style={{
                  background: primaryColor, color: '#000', fontSize: '10px', fontWeight: 800,
                  padding: '4px 10px', borderRadius: '20px', display: 'inline-block',
                  marginBottom: '12px', textTransform: 'uppercase',
                }}>
                  DEAL OF THE DAY
                </div>
                <div style={{
                  width: '100%', height: config.banner_fit_mode === 'adapt' ? 'auto' : '160px',
                  background: '#f9f9f9', borderRadius: '12px', marginBottom: '16px',
                  overflow: 'hidden', position: 'relative',
                }}>
                  {config.enable_banner_slider && banners.length > 1 ? (
                    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                      {banners.map((banner, idx) => (
                        <div key={idx} style={{
                          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                          opacity: currentSlide === idx ? 1 : 0, transition: 'opacity 0.8s ease-in-out',
                          zIndex: currentSlide === idx ? 1 : 0,
                        }}>
                          <img src={banner.image} alt={banner.title || ''} style={{ width: '100%', height: '100%', objectFit: bannerObjectFit, display: 'block' }} />
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                            padding: '10px 15px', color: 'white',
                          }}>
                            <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{banner.title}</div>
                            <div style={{ fontSize: '12px', opacity: 0.9 }}>{banner.subtitle}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : config.hero_image_url ? (
                    <img src={config.hero_image_url} alt="Hero" style={{ width: '100%', height: '100%', objectFit: bannerObjectFit, display: 'block' }} />
                  ) : null}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                  <div style={{ fontSize: '18px', fontWeight: 800, lineHeight: 1.2, flex: 1 }}>
                    {titles[bundleIndex] || config.hero_title || 'Combo Bundle'}
                  </div>
                  {config.hero_price && (
                    <div style={{ fontSize: '18px', fontWeight: 800, color: primaryColor, marginLeft: '12px' }}>
                      {config.hero_price}
                    </div>
                  )}
                </div>
                {config.hero_compare_price && (
                  <div style={{ fontSize: '12px', textDecoration: 'line-through', color: '#bbb', textAlign: 'right', marginTop: '-4px', marginBottom: '8px' }}>
                    {config.hero_compare_price}
                  </div>
                )}
                {(subtitles[bundleIndex] || config.hero_subtitle) && (
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>
                    {subtitles[bundleIndex] || config.hero_subtitle}
                  </div>
                )}
                {(config.timer_hours || config.timer_minutes || config.timer_seconds) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '11px', color: '#888', fontWeight: 600 }}>
                    ENDS IN:
                    {[time.h, time.m, time.s].map((t, i) => (
                      <span key={i} style={{ background: '#eafff2', color: primaryColor, padding: '4px 8px', borderRadius: '6px', fontWeight: 700, fontSize: '13px' }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {config.show_progress_bar && (
            <div style={{ padding: '0 20px' }}>
              <ProgressBar selectedCount={totalSelected} maxProducts={maxProducts} config={config} />
            </div>
          )}

          {tabs.length > 0 && (
            <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', padding: '8px 20px 20px', scrollbarWidth: 'none' }}>
              {tabs.map((tab, idx) => {
                const isActive = tab.value === activeTab;
                return (
                  <div key={idx} onClick={() => setActiveTab(tab.value)} style={{
                    whiteSpace: 'nowrap', padding: '8px 20px', borderRadius: '20px',
                    backgroundColor: isActive ? (config.selection_highlight_color || primaryColor) : '#fff',
                    border: `1px solid ${isActive ? (config.selection_highlight_color || primaryColor) : '#eee'}`,
                    fontSize: '12px', fontWeight: 600, color: isActive ? '#fff' : '#333',
                    cursor: 'pointer', transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 4px 10px rgba(0,0,0,0.1)' : 'none',
                  }}>
                    {tab.label}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 12px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700 }}>Curated For You</div>
          </div>

          {activeProducts.length === 0 ? (
            <div style={{ margin: '0 20px', padding: '32px 16px', textAlign: 'center', background: '#f9fafb', borderRadius: '8px', border: '2px dashed #e1e3e5', color: '#8c9196', fontSize: '13px' }}>
              No products in this category
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '0 20px' }}>
              {activeProducts.map((p) => (
                <ProductCard key={p.id} product={p} config={config} isMobile={isMobile}
                  selectedMap={selectedMap} onAdd={onAdd} onQtyChange={onQtyChange}
                  onRemove={onRemove} onImageClick={onImageClick}
                />
              ))}
            </div>
          )}
        </div>

      </div>
      <CdoPreviewBar
        config={config}
        selectedProducts={selectedProducts}
        totalPrice={totalPrice}
        finalPrice={finalPrice}
        isMobile={isMobile}
        currencySymbol={barCurrencySymbol}
        onCheckoutClick={onCheckout}
        onResetClick={onReset}
      />
    </div>
  );
}

function Layout4Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selectedMap, onAdd, onQtyChange, onRemove, onImageClick,
                          totalSelected, maxProducts, onCheckout,
                          totalPrice, finalPrice, discountApplicable, isMobile = false,
                          selectedProducts, onReset, barCurrencySymbol }) {
  // Editorial Split — same banner/progress/title/grid pieces as Layout2, just
  // reordered (banner first, no collection tabs) per ComboPreview's layout4
  // sectionOrder (app.bundles.customize.jsx ~5999-6008), which falls through
  // to the same generic renderBanner/renderTitleDescription/renderProductsGrid
  // path and outer container_padding-driven wrapper as Layout2.
  const textColor = config.text_color || '#1a1a1a';
  const headingColor = config.heading_color || '#333';
  const descriptionColor = config.description_color || '#666';
  const headingSize = isMobile ? (config.heading_size_mobile ?? config.heading_size ?? 22) : (config.heading_size ?? 32);
  const descriptionSize = isMobile ? (config.description_size_mobile ?? config.description_size ?? 13) : (config.description_size ?? 16);
  const headingAlign = isMobile ? (config.heading_align_mobile || config.heading_align || 'left') : (config.heading_align || 'left');
  const descriptionAlign = isMobile ? (config.description_align_mobile || config.description_align || 'left') : (config.description_align || 'left');
  const headingFontWeight = config.heading_font_weight || '700';
  const descriptionFontWeight = config.description_font_weight || '400';
  const titleBox = getBoxSpacing(config, 'title_container', isMobile);
  const descBox = getBoxSpacing(config, 'description_container', isMobile);
  const containerPad = getContainerPadding(config, isMobile);
  const { bannerWidth, finalBannerHeight, bannerObjectFit, bannerUrl } = getBannerSizing(config, isMobile);

  const seen = new Set();
  const allProducts = [];
  Object.values(productsByHandle).forEach((prods) => {
    prods.forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); allProducts.push(p); } });
  });

  return (
    <div style={{ background: '#eef1f5', padding: 16 }}>
      <div style={{
        fontFamily: 'inherit', color: textColor,
        paddingTop: containerPad.paddingTop, paddingRight: containerPad.paddingRight,
        paddingBottom: containerPad.paddingBottom, paddingLeft: containerPad.paddingLeft,
        background: config.bg_color || '#f9f9f9', maxWidth: '100%', margin: '0 auto',
        border: '1px solid #e5e5e5', borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
        position: 'relative', overflow: 'hidden',
      }}>
        {config.show_banner !== false && bannerUrl && (
          <div style={{
            width: config.banner_full_width ? `calc(100% + ${(containerPad.paddingLeft || 0) + (containerPad.paddingRight || 0)}px)` : `${bannerWidth}%`,
            height: finalBannerHeight,
            paddingTop: config.banner_padding_top, paddingBottom: config.banner_padding_bottom,
            margin: config.banner_full_width ? `0 -${containerPad.paddingLeft || 0}px` : '0 auto',
            overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src={bannerUrl} alt="Banner" style={{ width: '100%', height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%', objectFit: bannerObjectFit, display: 'block' }} />
          </div>
        )}

        <div style={{ padding: '20px' }}>
          <PriceSummary totalSelected={totalSelected} totalPrice={totalPrice} finalPrice={finalPrice} discountApplicable={discountApplicable} />
          <ProgressBar selectedCount={totalSelected} maxProducts={maxProducts} config={config} />
        </div>

        {config.show_title_description !== false && (
          <div style={{ ...getTitleWidthStyle(config), margin: '0 auto', padding: '0 20px 20px' }}>
            <div style={{
              textAlign: headingAlign,
              paddingTop: titleBox.paddingTop, paddingRight: titleBox.paddingRight,
              paddingBottom: titleBox.paddingBottom, paddingLeft: titleBox.paddingLeft,
              marginTop: titleBox.marginTop, marginRight: titleBox.marginRight,
              marginBottom: titleBox.marginBottom, marginLeft: titleBox.marginLeft,
            }}>
              <h1 style={{ margin: 0, fontSize: `${headingSize}px`, color: headingColor, fontWeight: headingFontWeight, textAlign: headingAlign, ...getHeadingStyle(config) }}>
                {config.collection_title || 'Create Your Combo'}
              </h1>
            </div>
            {config.collection_description && (
              <div style={{
                textAlign: descriptionAlign,
                paddingTop: descBox.paddingTop, paddingRight: descBox.paddingRight,
                paddingBottom: descBox.paddingBottom, paddingLeft: descBox.paddingLeft,
                marginTop: descBox.marginTop, marginRight: descBox.marginRight,
                marginBottom: descBox.marginBottom, marginLeft: descBox.marginLeft,
              }}>
                <p style={{ margin: 0, fontSize: `${descriptionSize}px`, color: descriptionColor, fontWeight: descriptionFontWeight, textAlign: descriptionAlign, lineHeight: 1.5 }}>
                  {config.collection_description}
                </p>
              </div>
            )}
          </div>
        )}

        <div style={{ padding: '0 20px 20px' }}>
          {allProducts.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', background: '#f9fafb', borderRadius: '8px', border: '2px dashed #e1e3e5', color: '#8c9196', fontSize: '13px' }}>
              No products in this combo yet.
            </div>
          ) : (
            <GenericProductGrid products={allProducts} config={config} isMobile={isMobile}
              selectedMap={selectedMap} onAdd={onAdd} onQtyChange={onQtyChange}
              onRemove={onRemove} onImageClick={onImageClick}
            />
          )}
        </div>

      </div>
      <CdoPreviewBar
        config={config}
        selectedProducts={selectedProducts}
        totalPrice={totalPrice}
        finalPrice={finalPrice}
        isMobile={isMobile}
        currencySymbol={barCurrencySymbol}
        onCheckoutClick={onCheckout}
        onResetClick={onReset}
      />
    </div>
  );
}

function Layout1Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selectedMap, onAdd, onQtyChange, onRemove, onImageClick,
                          totalSelected, maxProducts, onCheckout,
                          totalPrice, finalPrice, discountApplicable, isMobile = false,
                          selectedProducts, onReset, barCurrencySymbol }) {
  const allSteps = [1, 2, 3, 4, 5];
  const activeSteps = allSteps.filter((step) => {
    if (step === 1) return true;
    return config[`step_${step}_collection`] || config[`step_${step}_title`];
  });

  const headingColor = config.heading_color || '#333';
  const descriptionColor = config.description_color || '#666';
  const headingSize = config.heading_size || 28;
  const descriptionSize = config.description_size || 15;
  const headingAlign = config.heading_align || 'left';
  const descriptionAlign = config.description_align || 'left';
  const textColor = config.text_color || '#1a1a1a';
  const gridColumns = isMobile ? (config.mobile_columns || 2) : (config.desktop_columns || 3);
  const productsGap = config.products_gap || 16;
  const headingFontWeight = config.heading_font_weight || '700';
  const descriptionFontWeight = config.description_font_weight || '400';
  const titleBox = getBoxSpacing(config, 'title_container', isMobile);
  const descBox = getBoxSpacing(config, 'description_container', isMobile);
  const { bannerWidth, finalBannerHeight, bannerObjectFit, bannerUrl } = getBannerSizing(config, isMobile);

  const progressTextColor = config.progress_text_color || '#5c5f62';
  const discountThreshold = maxProducts;
  const percent = discountThreshold > 0 ? Math.min(100, Math.floor((totalSelected / discountThreshold) * 100)) : 0;
  const topProgressFillColor = totalSelected >= discountThreshold
    ? (config.progress_success_color || '#28a745')
    : (config.progress_bar_color || '#1a6644');

  const isSlider = config.grid_layout_type === 'slider';
  const showNavArrows = config.show_nav_arrows !== false;
  const showScrollbar = !!config.show_scrollbar;

  return (
    <div style={{ maxWidth: '900px', margin: '24px auto', padding: '0 16px' }}>
      <div style={{
        background: config.bg_color || '#fff', borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)', overflow: 'hidden',
        fontFamily: 'inherit', color: textColor, position: 'relative',
      }}>
        {config.show_progress_bar && (
          <div style={{
            background: '#fff', padding: '20px', position: 'sticky', top: 0, zIndex: 10,
            borderBottom: '1px solid #eee', boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '15px', fontWeight: 800, marginBottom: '12px' }}>
              <span style={{ color: progressTextColor, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                {config.progress_text || 'Bundle Progress'}
              </span>
              <span style={{ color: progressTextColor }}>{percent}%</span>
            </div>
            <div style={{ background: '#e0e0e0', height: '8px', borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
              <div style={{
                backgroundColor: topProgressFillColor, height: '100%', width: `${percent}%`,
                transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1)', borderRadius: '10px',
                position: 'relative', overflow: 'hidden', minWidth: percent > 0 ? '4px' : '0',
              }}>
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                  transform: 'translateX(-100%)', animation: 'combo-shimmer 2s infinite',
                }} />
              </div>
            </div>
            <div style={{ marginTop: '12px', fontSize: '13px', color: '#6d7175', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {totalSelected < discountThreshold ? (
                <span>
                  Add <strong>{Math.max(0, discountThreshold - totalSelected)}</strong> more for{' '}
                  <strong>{config.discount_text || config.progress_text || 'Bundle Discount'}</strong>
                </span>
              ) : (
                <span style={{ color: progressTextColor, fontWeight: 700 }}>
                  Discount Unlocked!
                </span>
              )}
            </div>
          </div>
        )}

        {config.show_banner !== false && bannerUrl && (
          <div style={{
            width: config.banner_full_width ? 'calc(100% + 40px)' : `${bannerWidth}%`,
            height: finalBannerHeight,
            margin: config.banner_full_width ? '0 -20px' : '0 auto',
            overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src={bannerUrl} alt="Banner"
              style={{ width: '100%', height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%', objectFit: bannerObjectFit, display: 'block' }}
            />
          </div>
        )}

        {config.show_title_description !== false && (
          <div style={{ padding: '24px 20px' }}>
            <div style={{
              ...(isMobile ? { width: '100%' } : getTitleWidthStyle(config)), textAlign: headingAlign,
              paddingTop: titleBox.paddingTop || 0, paddingRight: titleBox.paddingRight || 0,
              paddingBottom: titleBox.paddingBottom || 0, paddingLeft: titleBox.paddingLeft || 0,
              marginTop: titleBox.marginTop || 0, marginRight: titleBox.marginRight || 0,
              marginBottom: titleBox.marginBottom || 0, marginLeft: titleBox.marginLeft || 0,
            }}>
              <h1 style={{
                margin: 0, fontSize: `${headingSize}px`, color: headingColor,
                fontWeight: headingFontWeight, ...getHeadingStyle(config),
              }}>
                {config.collection_title || 'Create Your Combo'}
              </h1>
            </div>
            {config.collection_description && (
              <div style={{
                width: isMobile ? '100%' : `${config.title_width || 100}%`, textAlign: descriptionAlign,
                paddingTop: descBox.paddingTop || 0, paddingRight: descBox.paddingRight || 0,
                paddingBottom: descBox.paddingBottom || 0, paddingLeft: descBox.paddingLeft || 0,
                marginTop: descBox.marginTop || 0, marginRight: descBox.marginRight || 0,
                marginBottom: descBox.marginBottom || 0, marginLeft: descBox.marginLeft || 0,
              }}>
                <p style={{
                  margin: 0, fontSize: `${descriptionSize}px`, color: descriptionColor,
                  fontWeight: descriptionFontWeight, lineHeight: 1.5,
                }}>
                  {config.collection_description}
                </p>
              </div>
            )}
          </div>
        )}

        <div style={{ padding: '20px' }}>
          <PriceSummary totalSelected={totalSelected} totalPrice={totalPrice} finalPrice={finalPrice} discountApplicable={discountApplicable} />
          {activeSteps.map((step) => {
            const stepTitle = config[`step_${step}_title`] || `Category ${step}`;
            const stepSubtitle = config[`step_${step}_subtitle`] || 'Select your items';
            const stepColl = config[`step_${step}_collection`];
            const stepProducts = productsByHandle[stepColl] || [];
            const collName = stepColl ? (collectionNameMap[stepColl] || stepColl) : null;

            return (
              <div key={step} style={{ marginBottom: '40px' }}>
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>{stepTitle}</h3>
                  </div>
                  <p style={{ fontSize: '13px', color: '#888', margin: '4px 0 0' }}>
                    {stepSubtitle}
                    {collName && <span style={{ color: '#aaa' }}> — {collName}</span>}
                  </p>
                </div>

                {!stepColl ? (
                  <div style={{
                    padding: '32px 16px', textAlign: 'center',
                    background: '#f9fafb', borderRadius: '8px',
                    border: '2px dashed #e1e3e5', color: '#8c9196', fontSize: '13px',
                  }}>
                    <div style={{ fontWeight: '600', marginBottom: '4px' }}>No collection selected</div>
                    <div>Choose a collection for this step.</div>
                  </div>
                ) : stepProducts.length === 0 ? (
                  <div style={{
                    padding: '32px 16px', textAlign: 'center',
                    background: '#f9fafb', borderRadius: '8px',
                    border: '2px dashed #e1e3e5', color: '#8c9196', fontSize: '13px',
                  }}>
                    <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
                </svg>
              </div>
                    <div style={{ fontWeight: '600', marginBottom: '4px' }}>No products found</div>
                    <div>The selected collection has no products.</div>
                  </div>
                ) : isSlider ? (
                  <div style={{ position: 'relative' }}>
                    <div style={{
                      display: 'flex', gap: '12px', overflowX: 'auto',
                      paddingBottom: showScrollbar ? '10px' : '0',
                      scrollBehavior: 'smooth',
                    }} className={`combo-step-slider-${step}`}>
                      <style>{`
                        .combo-step-slider-${step} { scrollbar-width: ${showScrollbar ? 'auto' : 'none'}; -ms-overflow-style: ${showScrollbar ? 'auto' : 'none'}; }
                        .combo-step-slider-${step}::-webkit-scrollbar { display: ${showScrollbar ? 'block' : 'none'}; height: ${config.scrollbar_thickness || 4}px; }
                        .combo-step-slider-${step}::-webkit-scrollbar-thumb { background: ${config.scrollbar_color || '#dddddd'}; border-radius: 10px; }
                      `}</style>
                      {stepProducts.map((p) => (
                        <div key={p.id} style={{ minWidth: '160px', width: '160px' }}>
                          <ProductCard product={p} config={config} isMobile={isMobile}
                            selectedMap={selectedMap} onAdd={onAdd} onQtyChange={onQtyChange}
                            onRemove={onRemove} onImageClick={onImageClick}
                          />
                        </div>
                      ))}
                    </div>
                    {showNavArrows && ['left', 'right'].map((side) => (
                      <div key={side}
                        onClick={(e) => {
                          e.stopPropagation();
                          const track = e.currentTarget.parentElement.querySelector(`.combo-step-slider-${step}`);
                          track?.scrollBy({ left: side === 'left' ? -250 : 250, behavior: 'smooth' });
                        }}
                        style={{
                          position: 'absolute', [side]: config.arrow_position === 'outside' ? '-22px' : '8px',
                          top: '50%', transform: 'translateY(-50%)',
                          width: `${config.arrow_size || 36}px`, height: `${config.arrow_size || 36}px`,
                          background: config.arrow_bg_color || '#000', color: config.arrow_color || '#fff',
                          borderRadius: `${config.arrow_border_radius || 50}${config.arrow_border_radius === 50 ? '%' : 'px'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 4px 10px rgba(0,0,0,0.2)', zIndex: 10, cursor: 'pointer',
                          opacity: config.arrow_opacity ?? 0.9, transition: 'all 0.2s ease',
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d={side === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
                        </svg>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                    gap: `${productsGap}px`,
                  }}>
                    {stepProducts.map((p) => (
                      <ProductCard key={p.id}
                        product={p} config={config} isMobile={isMobile}
                        selectedMap={selectedMap}
                        onAdd={onAdd}
                        onQtyChange={onQtyChange}
                        onRemove={onRemove}
                        onImageClick={onImageClick}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
      <CdoPreviewBar
        config={config}
        selectedProducts={selectedProducts}
        totalPrice={totalPrice}
        finalPrice={finalPrice}
        isMobile={isMobile}
        currencySymbol={barCurrencySymbol}
        onCheckoutClick={onCheckout}
        onResetClick={onReset}
      />
    </div>
  );
}

export default function ComboPreviewPage() {
  const { templateName, config, productsByHandle, collectionNameMap, shop, activeDiscounts, embed } = useLoaderData();
  const { templateId } = useParams();
  const layout = config.layout || 'layout1';
  const rootRef = useRef(null);
  const isMobile = useIsMobile(embed);

  // Embedded inside the live storefront's iframe (see combo-page[.]js.jsx) —
  // report height so the parent can size the frame, since cross-origin means
  // the parent can't measure our DOM directly.
  useEffect(() => {
    if (!embed || typeof ResizeObserver === 'undefined') return;
    const el = rootRef.current;
    if (!el) return;
    const report = () => {
      window.parent.postMessage({ type: 'brix-combo-resize', height: el.scrollHeight }, '*');
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [embed]);

  const [selectedMap, setSelectedMap] = useState({}); // { [variantId]: { productId, qty } }
  const [lightboxProduct, setLightboxProduct] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const totalSelected = Object.values(selectedMap).reduce((sum, s) => sum + (s.qty || 0), 0);
  const maxProducts = parseInt(config.max_products) || 5;

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const productMap = {};
  const variantPriceMap = {};
  Object.values(productsByHandle).forEach((prods) => {
    prods.forEach((p) => {
      productMap[p.id] = p;
      (p.variants || []).forEach((v) => {
        variantPriceMap[v.id] = v.price != null ? parseFloat(v.price) : parseFloat(p.price || 0);
      });
    });
  });

  const trackEvent = (eventType, revenue) => {
    try {
      fetch('/api/bundle-analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          shop_domain: shop,
          template_id: templateId,
          event_type: eventType,
          revenue: revenue || 0,
        }),
      }).catch(() => {});
    } catch {}
  };

  useEffect(() => {
    trackEvent('view');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Price & discount computation
  const totalPrice = Object.entries(selectedMap).reduce((sum, [variantId, sel]) => {
    const price = variantPriceMap[variantId] || 0;
    return sum + price * (sel.qty || 0);
  }, 0);

  const selectedDiscount = config.has_discount_offer && config.selected_discount_id
    ? (activeDiscounts || []).find((d) => String(d.id) === String(config.selected_discount_id))
    : null;
  const discountType = selectedDiscount?.valueType || config.discount_selection || '';
  const discountVal = selectedDiscount?.value ? parseFloat(selectedDiscount.value) : (parseFloat(config.discount_amount) || 0);
  const hasDiscount = !!discountType && discountVal > 0;
  const isDiscountUnlocked = totalSelected >= (parseInt(config.discount_threshold) || maxProducts);
  const discountApplicable = hasDiscount && isDiscountUnlocked;
  const discountedPrice = discountApplicable
    ? (String(discountType).toLowerCase() === 'percentage'
        ? totalPrice * (1 - discountVal / 100)
        : Math.max(0, totalPrice - discountVal))
    : totalPrice;
  const finalPrice = discountApplicable ? discountedPrice : totalPrice;
  // End price computation

  const onAdd = (product, variantId, qty = 1) => {
    setSelectedMap((prev) => {
      if (prev[variantId]) return prev;
      const currentTotalQty = Object.values(prev).reduce((sum, s) => sum + (s.qty || 0), 0);
      if (currentTotalQty + qty > maxProducts) {
        showToast((config.limit_reached_message || 'Limit reached! You can only select {{limit}} items.').replace('{{limit}}', maxProducts));
        return prev;
      }
      return { ...prev, [variantId]: { productId: product.id, qty } };
    });
  };

  const onQtyChange = (variantId, qty) => {
    setSelectedMap((prev) => {
      if (!prev[variantId]) return prev;
      if (qty <= 0) {
        const next = { ...prev };
        delete next[variantId];
        return next;
      }
      const otherTotalQty = Object.entries(prev).reduce(
        (sum, [vid, s]) => (vid === String(variantId) ? sum : sum + (s.qty || 0)),
        0
      );
      if (otherTotalQty + qty > maxProducts) {
        showToast((config.limit_reached_message || 'Limit reached! You can only select {{limit}} items.').replace('{{limit}}', maxProducts));
        return { ...prev, [variantId]: { ...prev[variantId], qty: Math.max(1, maxProducts - otherTotalQty) } };
      }
      return { ...prev, [variantId]: { ...prev[variantId], qty } };
    });
  };

  const onRemove = (variantId) => {
    setSelectedMap((prev) => {
      if (!prev[variantId]) return prev;
      const next = { ...prev };
      delete next[variantId];
      return next;
    });
  };

  const onImageClick = (product) => {
    const allImgs = product.images && product.images.length > 0
      ? product.images
      : product.image ? [product.image] : [];
    if (allImgs.length === 0) return;
    setLightboxProduct(product);
  };

  const onCheckout = () => {
    if (totalSelected === 0) return;
    const cartLines = [];
    Object.entries(selectedMap).forEach(([variantId, sel]) => {
      const shortId = String(variantId).split('/').pop();
      cartLines.push(`${shortId}:${sel.qty || 1}`);
    });
    if (cartLines.length === 0) return;
    trackEvent('click', finalPrice);
    const shopDomain = shop.replace(/^https?:\/\//, '');
    const params = new URLSearchParams();
    params.set('attributes[combo_source]', 'ComboForge');
    params.set('attributes[combo_template_id]', String(templateId));
    params.set('attributes[combo_template_name]', templateName);
    const cartPath = `/cart/${cartLines.join(',')}?${params.toString()}`;
    const destination = discountApplicable && selectedDiscount?.code
      ? `https://${shopDomain}/discount/${encodeURIComponent(selectedDiscount.code)}?redirect=${encodeURIComponent(cartPath)}`
      : `https://${shopDomain}${cartPath}`;
    // Inside the storefront's iframe (embed=1), navigate the top window so
    // checkout leaves the frame instead of loading inside it.
    (embed ? window.top : window).location.href = destination;
  };

  const onReset = () => setSelectedMap({});

  // CdoPreviewBar (app/components/CdoPreviewBar.jsx) is the same component
  // the builder's own live preview uses for this bottom bar — reused here
  // directly rather than reimplemented, so the thumbnail row/price/button
  // styling can't drift from what the merchant designed. It expects a flat
  // list of selected line items, not the {variantId: {productId, qty}} map
  // this page tracks state with.
  const selectedProducts = Object.entries(selectedMap).map(([variantId, sel]) => {
    const product = productMap[sel.productId];
    const variant = (product?.variants || []).find((v) => String(v.id) === String(variantId));
    return {
      id: sel.productId,
      variantId,
      quantity: sel.qty || 0,
      price: variantPriceMap[variantId] || 0,
      image: (variant?.image || product?.image)?.url,
      title: product?.title,
    };
  });
  const barCurrencySymbol = getCurrencySymbol(
    productMap[Object.values(selectedMap)[0]?.productId]?.currency
    || Object.values(productMap)[0]?.currency
  );

  const lightboxImages = lightboxProduct
    ? (lightboxProduct.images && lightboxProduct.images.length > 0
        ? lightboxProduct.images
        : lightboxProduct.image ? [lightboxProduct.image] : [])
    : [];

  return (
    <div ref={rootRef} style={{ minHeight: embed ? 'auto' : '100vh', background: embed ? 'transparent' : '#f4f5f7' }}>
      <style>{`
        @keyframes combo-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes combo-toast-in {
          from { opacity: 0; transform: translate(-50%, -12px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
      {config.custom_css && <style>{config.custom_css}</style>}
      <GoogleFontLink family={config.heading_font_family} />

      {toast && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: '20px', left: '50%',
            transform: 'translate(-50%, 0)', zIndex: 10000,
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
            color: '#b91c1c', fontSize: '13px', fontWeight: 600,
            padding: '12px 18px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            display: 'flex', alignItems: 'center', gap: '8px',
            maxWidth: '90vw', animation: 'combo-toast-in 0.25s ease-out',
          }}
        >
          <span style={{ display: 'flex' }}><IconWarning /></span>
          <span>{toast}</span>
        </div>
      )}

      {!embed && (
        <div style={{
          background: '#ffffff',
          padding: '12px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #e5e7eb',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <a href={`/app/bundles/templates`} style={{
              background: '#f3f4f6', border: '1px solid #e5e7eb',
              borderRadius: '7px', color: '#374151', padding: '6px 12px', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center',
              gap: '5px', textDecoration: 'none',
            }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 12L6 8l4-4"/>
              </svg>
              Back
            </a>
            <span style={{ color: '#111827', fontWeight: '600', fontSize: '15px' }}>
              Preview: <span style={{ color: '#6b7280' }}>{templateName}</span>
            </span>
          </div>
          {totalSelected > 0 && (
            <div style={{
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '8px', padding: '5px 12px',
              color: '#15803d', fontSize: '13px', fontWeight: 600,
            }}>
              {totalSelected} selected
            </div>
          )}
        </div>
      )}

      {layout === 'layout3' ? (
        <Layout3Preview
          config={config}
          productsByHandle={productsByHandle}
          collectionNameMap={collectionNameMap}
          templateName={templateName}
          selectedMap={selectedMap}
          onAdd={onAdd}
          onQtyChange={onQtyChange}
          onRemove={onRemove}
          onImageClick={onImageClick}
          totalSelected={totalSelected}
          maxProducts={maxProducts}
          onCheckout={onCheckout}
          totalPrice={totalPrice}
          finalPrice={finalPrice}
          discountApplicable={discountApplicable}
          isMobile={isMobile}
          selectedProducts={selectedProducts}
          onReset={onReset}
          barCurrencySymbol={barCurrencySymbol}
        />
      ) : layout === 'layout4' ? (
        <Layout4Preview
          config={config}
          productsByHandle={productsByHandle}
          collectionNameMap={collectionNameMap}
          templateName={templateName}
          selectedMap={selectedMap}
          onAdd={onAdd}
          onQtyChange={onQtyChange}
          onRemove={onRemove}
          onImageClick={onImageClick}
          totalSelected={totalSelected}
          maxProducts={maxProducts}
          onCheckout={onCheckout}
          totalPrice={totalPrice}
          finalPrice={finalPrice}
          discountApplicable={discountApplicable}
          isMobile={isMobile}
          selectedProducts={selectedProducts}
          onReset={onReset}
          barCurrencySymbol={barCurrencySymbol}
        />
      ) : layout === 'layout2' ? (
        <Layout2Preview
          config={config}
          productsByHandle={productsByHandle}
          collectionNameMap={collectionNameMap}
          templateName={templateName}
          selectedMap={selectedMap}
          onAdd={onAdd}
          onQtyChange={onQtyChange}
          onRemove={onRemove}
          onImageClick={onImageClick}
          totalSelected={totalSelected}
          maxProducts={maxProducts}
          onCheckout={onCheckout}
          totalPrice={totalPrice}
          finalPrice={finalPrice}
          discountApplicable={discountApplicable}
          isMobile={isMobile}
          selectedProducts={selectedProducts}
          onReset={onReset}
          barCurrencySymbol={barCurrencySymbol}
        />
      ) : (
        <Layout1Preview
          config={config}
          productsByHandle={productsByHandle}
          collectionNameMap={collectionNameMap}
          templateName={templateName}
          selectedMap={selectedMap}
          onAdd={onAdd}
          onQtyChange={onQtyChange}
          onRemove={onRemove}
          onImageClick={onImageClick}
          totalSelected={totalSelected}
          maxProducts={maxProducts}
          onCheckout={onCheckout}
          totalPrice={totalPrice}
          finalPrice={finalPrice}
          discountApplicable={discountApplicable}
          isMobile={isMobile}
          selectedProducts={selectedProducts}
          onReset={onReset}
          barCurrencySymbol={barCurrencySymbol}
        />
      )}

      {!embed && (
        <div style={{ textAlign: 'center', marginTop: '16px', color: '#999', fontSize: '12px' }}>
          This is a preview of your saved combo template. The actual storefront may vary based on theme integration.
        </div>
      )}

      {lightboxProduct && lightboxImages.length > 0 && (
        <Lightbox images={lightboxImages} onClose={() => setLightboxProduct(null)} />
      )}
    </div>
  );
}
