import { useCallback, useEffect, useRef, useState } from 'react';
import { useLoaderData, useParams } from 'react-router';
import { getCurrencySymbol } from '../utils/currency.shared';
import { loadComboPageData } from '../services/combo-page.server';

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
          }}>‹</button>
          <button onClick={(e) => { e.stopPropagation(); next(); }} style={{
            position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
            width: '48px', height: '48px', borderRadius: '50%',
            fontSize: '24px', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>›</button>
        </>
      )}
      <button onClick={onClose} style={{
        position: 'absolute', top: '20px', right: '20px',
        background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
        width: '40px', height: '40px', borderRadius: '50%',
        fontSize: '20px', cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>✕</button>

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

function ProductCard({ product, config, selectedMap, onAdd, onQtyChange, onRemove, onImageClick }) {
  const btnBg = config.add_btn_bg || config.product_add_btn_color || '#000';
  const btnTextColor = config.add_btn_text_color || config.product_add_btn_text_color || '#fff';
  const btnRadius = config.add_btn_border_radius ?? 8;
  const btnFontSize = config.add_btn_font_size || config.product_add_btn_font_size || 14;
  const btnFontWeight = config.add_btn_font_weight || config.product_add_btn_font_weight || 600;
  const addBtnText = config.add_btn_text || config.product_add_btn_text || 'Add';
  const cardRadius = config.card_border_radius || 12;
  const textColor = config.text_color || '#1a1a1a';
  const primaryColor = config.primary_color || '#000000';

  const variants = product.variants || [];
  const hasVariants = variants.length > 1;

  const [pendingVariantId, setPendingVariantId] = useState(
    variants[0]?.id || product.variantId || ''
  );
  const [imgIndex, setImgIndex] = useState(0);

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

  return (
    <div style={{
      border: `2px solid ${isAdded ? '#22c55e' : '#eee'}`,
      borderRadius: `${cardRadius}px`,
      overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column',
      transition: 'border-color 0.2s',
    }}>
      <div
        style={{
          height: '180px', background: '#f5f5f5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', cursor: 'pointer', position: 'relative',
        }}>
        <div onClick={() => onImageClick(product)} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {displayImage ? (
            <img src={displayImage.url} alt={displayImage.altText || product.title}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          )}
        </div>

        {!activeVariant?.image && images.length > 1 && (
          <>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); setImgIndex((i) => (i <= 0 ? images.length - 1 : i - 1)); }}
              style={{
                position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)',
                width: '26px', height: '26px', borderRadius: '50%', border: 'none',
                background: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>‹</button>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); setImgIndex((i) => (i >= images.length - 1 ? 0 : i + 1)); }}
              style={{
                position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)',
                width: '26px', height: '26px', borderRadius: '50%', border: 'none',
                background: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>›</button>
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
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{
          fontSize: '13px', fontWeight: 500, lineHeight: 1.3, marginBottom: '4px',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden', color: textColor,
        }}>
          {product.title}
        </div>

        {hasVariants && (
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
          <div style={{ fontSize: '11px', color: '#22c55e', marginBottom: '6px' }}>
            Also in combo: {otherAdded.map((v) => `${v.title} ×${selectedMap[v.id].qty}`).join(', ')}
          </div>
        )}

        <div style={{ fontSize: '14px', fontWeight: 700, color: primaryColor, marginBottom: '8px' }}>
          {getCurrencySymbol(product.currency)}{displayPrice.toFixed(2)}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 0 0', borderTop: '1px solid #eee',
          justifyContent: 'space-between',
        }}>
          {isAdded ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
              <button type="button" onClick={handleDec}
                style={{
                  width: 30, height: 30, border: '1px solid #ddd', background: '#f9f9f9',
                  borderRadius: '6px 0 0 6px', cursor: 'pointer', fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                }}>−</button>
              <span style={{
                flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 14,
                border: '1px solid #ddd', borderLeft: 'none', borderRight: 'none', padding: '6px 0',
              }}>{qty}</span>
              <button type="button" onClick={handleInc}
                style={{
                  width: 30, height: 30, border: '1px solid #ddd', background: '#f9f9f9',
                  borderRadius: '0 6px 6px 0', cursor: 'pointer', fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                }}>+</button>
            </div>
          ) : (
            <button type="button" onClick={handleAddClick}
              style={{
                flex: 1, background: btnBg, color: btnTextColor,
                border: 'none', padding: '8px 12px',
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

function Layout2Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selectedMap, onAdd, onQtyChange, onRemove, onImageClick,
                          totalSelected, maxProducts, onCheckout,
                          totalPrice, finalPrice, discountApplicable }) {
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

  const gridColumns = config.desktop_columns || 3;
  const productsGap = config.products_gap || 16;
  const textColor = config.text_color || '#1a1a1a';
  const headingColor = config.heading_color || '#333';
  const descriptionColor = config.description_color || '#666';
  const headingSize = config.heading_size || 28;
  const descriptionSize = config.description_size || 15;
  const headingAlign = config.heading_align || 'left';
  const descriptionAlign = config.description_align || 'left';
  const headingFontWeight = config.heading_font_weight || '700';
  const descriptionFontWeight = config.description_font_weight || '400';
  const bannerUrl = config.banner_image_url || '';
  const bannerHeight = config.banner_height_desktop || 180;
  const bannerObjectFit = config.banner_fit_mode === 'contain' ? 'contain' : 'cover';

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
    <div style={{ maxWidth: '900px', margin: '24px auto', padding: '0 16px' }}>
      <div style={{
        background: config.bg_color || '#ffffff',
        borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        overflow: 'hidden', fontFamily: 'inherit', color: textColor,
      }}>
        {config.show_banner !== false && bannerUrl && (
          <div style={{ width: '100%', height: `${bannerHeight}px`, overflow: 'hidden' }}>
            <img src={bannerUrl} alt="Banner"
              style={{ width: '100%', height: '100%', objectFit: bannerObjectFit, display: 'block' }}
            />
          </div>
        )}

        {config.show_title_description !== false && (
          <div style={{ padding: '24px 20px 0' }}>
            <h1 style={{
              margin: 0, fontSize: `${headingSize}px`, color: headingColor,
              fontWeight: headingFontWeight, textAlign: headingAlign, lineHeight: 1.2,
            }}>
              {config.collection_title || 'Create Your Combo'}
            </h1>
            {config.collection_description && (
              <p style={{
                margin: '8px 0 0', fontSize: `${descriptionSize}px`, color: descriptionColor,
                fontWeight: descriptionFontWeight, textAlign: descriptionAlign, lineHeight: 1.5,
              }}>
                {config.collection_description}
              </p>
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
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gap: `${productsGap}px`,
            }}>
              {activeProducts.map((p) => (
                <ProductCard key={p.id}
                  product={p} config={config}
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

        {config.show_preview_bar !== false && (
          <div style={{
            borderTop: '1px solid #eee', padding: '16px 20px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: config.preview_bar_bg || '#fff',
          }}>
            <div style={{ fontSize: '13px', color: '#666' }}>
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                {config.preview_bar_title || templateName}
              </div>
              {totalSelected > 0 && (
                <div style={{ fontSize: '12px' }}>
                  {totalSelected}/{maxProducts} selected
                  {discountApplicable ? (
                    <span style={{ marginLeft: '6px' }}>
                      · <span style={{ textDecoration: 'line-through', color: '#999' }}>${totalPrice.toFixed(2)}</span>
                      {' '}<span style={{ color: '#22c55e', fontWeight: 700 }}>${finalPrice.toFixed(2)}</span>
                    </span>
                  ) : (
                    <span style={{ marginLeft: '6px' }}>
                      · ${totalPrice.toFixed(2)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={totalSelected > 0 ? onCheckout : undefined}
              style={{
                background: config.checkout_btn_bg || '#000',
                color: config.checkout_btn_text_color || '#fff',
                border: 'none', padding: '10px 24px', borderRadius: '6px',
                fontWeight: 700, fontSize: '13px',
                cursor: totalSelected > 0 ? 'pointer' : 'default',
                opacity: totalSelected > 0 ? 1 : 0.5,
                transition: 'opacity 0.2s',
              }}>
              {config.checkout_btn_text || 'Proceed to Checkout'} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Layout3Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selectedMap, onAdd, onQtyChange, onRemove, onImageClick,
                          totalSelected, maxProducts, onCheckout,
                          totalPrice, finalPrice, discountApplicable }) {
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
        background: '#eef2f7', fontFamily: 'inherit', color: textColor,
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
                <ProductCard key={p.id} product={p} config={config}
                  selectedMap={selectedMap} onAdd={onAdd} onQtyChange={onQtyChange}
                  onRemove={onRemove} onImageClick={onImageClick}
                />
              ))}
            </div>
          )}
        </div>

        {config.show_preview_bar !== false && (
          <div style={{
            borderTop: '1px solid #eee', padding: '16px 20px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: config.preview_bar_bg || '#fff',
          }}>
            <div style={{ fontSize: '13px', color: '#666' }}>
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                {config.preview_bar_title || templateName}
              </div>
              {totalSelected > 0 && (
                <div style={{ fontSize: '12px' }}>
                  {totalSelected}/{maxProducts} selected
                  {discountApplicable ? (
                    <span style={{ marginLeft: '6px' }}>
                      · <span style={{ textDecoration: 'line-through', color: '#999' }}>${totalPrice.toFixed(2)}</span>
                      {' '}<span style={{ color: '#22c55e', fontWeight: 700 }}>${finalPrice.toFixed(2)}</span>
                    </span>
                  ) : (
                    <span style={{ marginLeft: '6px' }}>· ${totalPrice.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={totalSelected > 0 ? onCheckout : undefined}
              style={{
                background: config.checkout_btn_bg || '#000',
                color: config.checkout_btn_text_color || '#fff',
                border: 'none', padding: '10px 24px', borderRadius: '6px',
                fontWeight: 700, fontSize: '13px',
                cursor: totalSelected > 0 ? 'pointer' : 'default',
                opacity: totalSelected > 0 ? 1 : 0.5,
                transition: 'opacity 0.2s',
              }}>
              {config.checkout_btn_text || 'Proceed to Checkout'} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Layout4Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selectedMap, onAdd, onQtyChange, onRemove, onImageClick,
                          totalSelected, maxProducts, onCheckout,
                          totalPrice, finalPrice, discountApplicable }) {
  // Editorial Split — same banner/progress/title/grid pieces as Layout2, just
  // reordered (banner first, no collection tabs) per ComboPreview's layout4
  // sectionOrder (app.bundles.customize.jsx ~5984-5993).
  const gridColumns = config.desktop_columns || 3;
  const productsGap = config.products_gap || 16;
  const textColor = config.text_color || '#1a1a1a';
  const headingColor = config.heading_color || '#333';
  const descriptionColor = config.description_color || '#666';
  const headingSize = config.heading_size || 28;
  const descriptionSize = config.description_size || 15;
  const headingAlign = config.heading_align || 'left';
  const descriptionAlign = config.description_align || 'left';
  const headingFontWeight = config.heading_font_weight || '700';
  const descriptionFontWeight = config.description_font_weight || '400';
  const bannerUrl = config.banner_image_url || '';
  const bannerHeight = config.banner_height_desktop || 180;
  const bannerObjectFit = config.banner_fit_mode === 'contain' ? 'contain' : 'cover';

  const seen = new Set();
  const allProducts = [];
  Object.values(productsByHandle).forEach((prods) => {
    prods.forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); allProducts.push(p); } });
  });

  return (
    <div style={{ maxWidth: '900px', margin: '24px auto', padding: '0 16px' }}>
      <div style={{
        background: config.bg_color || '#ffffff',
        borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        overflow: 'hidden', fontFamily: 'inherit', color: textColor,
      }}>
        {config.show_banner !== false && bannerUrl && (
          <div style={{ width: '100%', height: `${bannerHeight}px`, overflow: 'hidden' }}>
            <img src={bannerUrl} alt="Banner" style={{ width: '100%', height: '100%', objectFit: bannerObjectFit, display: 'block' }} />
          </div>
        )}

        <div style={{ padding: '20px' }}>
          <PriceSummary totalSelected={totalSelected} totalPrice={totalPrice} finalPrice={finalPrice} discountApplicable={discountApplicable} />
          <ProgressBar selectedCount={totalSelected} maxProducts={maxProducts} config={config} />
        </div>

        {config.show_title_description !== false && (
          <div style={{ padding: '0 20px 20px' }}>
            <h1 style={{ margin: 0, fontSize: `${headingSize}px`, color: headingColor, fontWeight: headingFontWeight, textAlign: headingAlign, lineHeight: 1.2 }}>
              {config.collection_title || 'Create Your Combo'}
            </h1>
            {config.collection_description && (
              <p style={{ margin: '8px 0 0', fontSize: `${descriptionSize}px`, color: descriptionColor, fontWeight: descriptionFontWeight, textAlign: descriptionAlign, lineHeight: 1.5 }}>
                {config.collection_description}
              </p>
            )}
          </div>
        )}

        <div style={{ padding: '0 20px 20px' }}>
          {allProducts.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', background: '#f9fafb', borderRadius: '8px', border: '2px dashed #e1e3e5', color: '#8c9196', fontSize: '13px' }}>
              No products in this combo yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`, gap: `${productsGap}px` }}>
              {allProducts.map((p) => (
                <ProductCard key={p.id} product={p} config={config}
                  selectedMap={selectedMap} onAdd={onAdd} onQtyChange={onQtyChange}
                  onRemove={onRemove} onImageClick={onImageClick}
                />
              ))}
            </div>
          )}
        </div>

        {config.show_preview_bar !== false && (
          <div style={{
            borderTop: '1px solid #eee', padding: '16px 20px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: config.preview_bar_bg || '#fff',
          }}>
            <div style={{ fontSize: '13px', color: '#666' }}>
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                {config.preview_bar_title || templateName}
              </div>
              {totalSelected > 0 && (
                <div style={{ fontSize: '12px' }}>
                  {totalSelected}/{maxProducts} selected
                  {discountApplicable ? (
                    <span style={{ marginLeft: '6px' }}>
                      · <span style={{ textDecoration: 'line-through', color: '#999' }}>${totalPrice.toFixed(2)}</span>
                      {' '}<span style={{ color: '#22c55e', fontWeight: 700 }}>${finalPrice.toFixed(2)}</span>
                    </span>
                  ) : (
                    <span style={{ marginLeft: '6px' }}>· ${totalPrice.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={totalSelected > 0 ? onCheckout : undefined}
              style={{
                background: config.checkout_btn_bg || '#000',
                color: config.checkout_btn_text_color || '#fff',
                border: 'none', padding: '10px 24px', borderRadius: '6px',
                fontWeight: 700, fontSize: '13px',
                cursor: totalSelected > 0 ? 'pointer' : 'default',
                opacity: totalSelected > 0 ? 1 : 0.5,
                transition: 'opacity 0.2s',
              }}>
              {config.checkout_btn_text || 'Proceed to Checkout'} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Layout1Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selectedMap, onAdd, onQtyChange, onRemove, onImageClick,
                          totalSelected, maxProducts, onCheckout,
                          totalPrice, finalPrice, discountApplicable }) {
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
  const bgColor = config.bg_color || '#ffffff';
  const textColor = config.text_color || '#1a1a1a';
  const gridColumns = config.desktop_columns || 3;
  const productsGap = config.products_gap || 16;
  const bannerUrl = config.banner_image_url || '';
  const bannerHeight = config.banner_height_desktop || 180;
  const bannerObjectFit = config.banner_fit_mode === 'contain' ? 'contain' : 'cover';
  const headingFontWeight = config.heading_font_weight || '700';
  const descriptionFontWeight = config.description_font_weight || '400';

  return (
    <div style={{ maxWidth: '900px', margin: '24px auto', padding: '0 16px' }}>
      <div style={{
        background: bgColor, borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)', overflow: 'hidden',
        fontFamily: 'inherit', color: textColor,
      }}>
        {config.show_banner !== false && bannerUrl && (
          <div style={{ width: '100%', height: `${bannerHeight}px`, overflow: 'hidden' }}>
            <img src={bannerUrl} alt="Banner"
              style={{ width: '100%', height: '100%', objectFit: bannerObjectFit, display: 'block' }}
            />
          </div>
        )}

        {config.show_title_description !== false && (
          <div style={{ padding: '24px 20px 0' }}>
            <h1 style={{
              margin: 0, fontSize: `${headingSize}px`, color: headingColor,
              fontWeight: headingFontWeight, textAlign: headingAlign, lineHeight: 1.2,
            }}>
              {config.collection_title || 'Create Your Combo'}
            </h1>
            {config.collection_description && (
              <p style={{
                margin: '8px 0 0', fontSize: `${descriptionSize}px`, color: descriptionColor,
                fontWeight: descriptionFontWeight, textAlign: descriptionAlign, lineHeight: 1.5,
              }}>
                {config.collection_description}
              </p>
            )}
          </div>
        )}

        <div style={{ padding: '20px' }}>
          <PriceSummary totalSelected={totalSelected} totalPrice={totalPrice} finalPrice={finalPrice} discountApplicable={discountApplicable} />
          <ProgressBar selectedCount={totalSelected} maxProducts={maxProducts} config={config} />
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
                    <div style={{ fontSize: '24px', marginBottom: '8px' }}>📦</div>
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
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                    gap: `${productsGap}px`,
                  }}>
                    {stepProducts.map((p) => (
                      <ProductCard key={p.id}
                        product={p} config={config}
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

        {config.show_preview_bar !== false && (
          <div style={{
            borderTop: '1px solid #eee', padding: '16px 20px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: config.preview_bar_bg || '#fff',
          }}>
            <div style={{ fontSize: '13px', color: '#666' }}>
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                {config.preview_bar_title || templateName}
              </div>
              {totalSelected > 0 && (
                <div style={{ fontSize: '12px' }}>
                  {totalSelected}/{maxProducts} selected
                  {discountApplicable ? (
                    <span style={{ marginLeft: '6px' }}>
                      · <span style={{ textDecoration: 'line-through', color: '#999' }}>${totalPrice.toFixed(2)}</span>
                      {' '}<span style={{ color: '#22c55e', fontWeight: 700 }}>${finalPrice.toFixed(2)}</span>
                    </span>
                  ) : (
                    <span style={{ marginLeft: '6px' }}>
                      · ${totalPrice.toFixed(2)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={totalSelected > 0 ? onCheckout : undefined}
              style={{
                background: config.checkout_btn_bg || '#000',
                color: config.checkout_btn_text_color || '#fff',
                border: 'none', padding: '10px 24px', borderRadius: '6px',
                fontWeight: 700, fontSize: '13px',
                cursor: totalSelected > 0 ? 'pointer' : 'default',
                opacity: totalSelected > 0 ? 1 : 0.5,
                transition: 'opacity 0.2s',
              }}>
              {config.checkout_btn_text || 'Proceed to Checkout'} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComboPreviewPage() {
  const { templateName, config, productsByHandle, collectionNameMap, shop, activeDiscounts, embed } = useLoaderData();
  const { templateId } = useParams();
  const layout = config.layout || 'layout1';
  const rootRef = useRef(null);

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
          <span>⚠</span>
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
