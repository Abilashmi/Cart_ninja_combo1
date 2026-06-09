import { useState } from 'react';
import { useLoaderData } from 'react-router';
import { unauthenticated } from '../shopify.server';
import prisma from '../db.server';

const PRODUCT_FRAGMENT = `
  fragment ProductInfo on Product {
    id
    title
    handle
    featuredImage { url altText width height }
    images(first: 10) { nodes { url altText width height } }
    variants(first: 1) { nodes { id } }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
  }
`;

export const loader = async ({ params, request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const templateId = params.templateId;

  if (!templateId) throw new Response('Template ID required', { status: 400 });
  if (!shop) throw new Response('Shop parameter required', { status: 400 });

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS combo_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_domain TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', slug TEXT,
      template_type TEXT NOT NULL DEFAULT 'grid', status TEXT NOT NULL DEFAULT 'draft',
      is_active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
      description TEXT, features TEXT, customization_data TEXT,
      page_handle TEXT, page_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM combo_templates WHERE id = ? AND shop_domain = ?`,
    Number(templateId), shop
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) throw new Response('Template not found', { status: 404 });

  const config = (() => { try { return JSON.parse(row.customization_data || '{}'); } catch { return {}; } })();
  const templateName = row.name || 'Untitled';

  const { admin } = await unauthenticated.admin(shop);

  let collections = [];
  try {
    const colRes = await admin.graphql(`#graphql
      query { collections(first: 250) {
        nodes { id title handle productsCount { count } }
      } }
    `);
    const colJson = await colRes.json();
    collections = (colJson.data?.collections?.nodes || []).map((n) => ({
      id: n.id, title: n.title, handle: n.handle,
    }));
  } catch (e) {
    console.error('[Preview] Collection fetch error:', e);
  }

  const allHandles = new Set();
  if (config.layout === 'layout1' || !config.layout) {
    const allSteps = [1, 2, 3, 4, 5];
    const activeSteps = allSteps.filter((step) => {
      if (step === 1) return true;
      return config[`step_${step}_collection`] || config[`step_${step}_title`];
    });
    activeSteps.forEach((step) => {
      const h = config[`step_${step}_collection`];
      if (h) allHandles.add(h);
    });
  }
  if (config.layout === 'layout2') {
    for (let i = 1; i <= (config.tab_count || 8); i++) {
      const h = config[`col_${i}`];
      if (h) allHandles.add(h);
    }
  }
  if (!config.layout || config.layout === 'layout3' || config.layout === 'layout4') {
    const h = config.collection_handle || config.step_1_collection;
    if (h) allHandles.add(h);
  }

  const productsByHandle = {};
  for (const handle of allHandles) {
    try {
      const res = await admin.graphql(`
        query GetCollectionByHandle($handle: String!) {
          collectionByHandle(handle: $handle) {
            products(first: 50) {
              edges { node { ...ProductInfo } }
            }
          }
        }
        ${PRODUCT_FRAGMENT}
      `, { variables: { handle } });
      const json = await res.json();
      const edges = json.data?.collectionByHandle?.products?.edges || [];
      productsByHandle[handle] = edges.map((e) => ({
        id: e.node.id, title: e.node.title, handle: e.node.handle,
        image: e.node.featuredImage ? { url: e.node.featuredImage.url, altText: e.node.featuredImage.altText } : null,
        images: (e.node.images?.nodes || []).map((img) => ({
          url: img.url, altText: img.altText,
        })),
        variantId: e.node.variants?.nodes?.[0]?.id || null,
        price: e.node.priceRangeV2?.minVariantPrice?.amount || '0.00',
        currency: e.node.priceRangeV2?.minVariantPrice?.currencyCode || 'USD',
      }));
    } catch (e) {
      console.error(`[Preview] Products fetch error for "${handle}":`, e);
      productsByHandle[handle] = [];
    }
  }

  const collectionNameMap = {};
  collections.forEach((c) => { collectionNameMap[c.handle] = c.title; });

  let activeDiscounts = [];
  try {
    const discRes = await admin.graphql(`#graphql
      query PreviewDiscounts {
        discountNodes(first: 50, reverse: true) {
          edges {
            node {
              id
              discount {
                ... on DiscountCodeBasic {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                  customerGets { value { ... on DiscountPercentage { percentage } ... on DiscountAmount { amount } } }
                }
                ... on DiscountCodeBxgy {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                  customerGets { value { ... on DiscountPercentage { percentage } ... on DiscountAmount { amount } } }
                }
                ... on DiscountCodeFreeShipping {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                }
              }
            }
          }
        }
      }
    `);
    const discJson = await discRes.json();
    if (!discJson.errors) {
      activeDiscounts = (discJson.data?.discountNodes?.edges || [])
        .map(({ node }) => {
          const d = node.discount;
          if (!d) return null;
          const code = d.codes?.edges?.[0]?.node?.code || '';
          const gets = d.customerGets?.value;
          let valueType = '';
          let value = 0;
          if (gets) {
            if ('percentage' in gets) { valueType = 'percentage'; value = parseFloat(gets.percentage || 0); }
            else if ('amount' in gets) { valueType = 'fixed_amount'; value = parseFloat(gets.amount || 0); }
          }
          return { id: node.id, title: d.title || code, code, type: d.__typename || '', status: d.status || 'ACTIVE', valueType, value };
        })
        .filter(Boolean)
        .filter((d) => d.status === 'ACTIVE');
    }
  } catch (e) {
    console.error('[Preview] Discount fetch error:', e);
  }

  return { templateName, config, collections, productsByHandle, collectionNameMap, shop, activeDiscounts };
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

function LimitReachedBanner({ isReached, maxProducts, config }) {
  if (!isReached) return null;
  const msg = (config.limit_reached_message || 'Limit reached! You can only select {{limit}} items.')
    .replace('{{limit}}', maxProducts);
  return (
    <div style={{
      padding: '12px 16px', margin: '0 0 16px',
      background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
      color: '#b91c1c', fontSize: '13px', fontWeight: 600, textAlign: 'center',
    }}>
      ⚠ {msg}
    </div>
  );
}

function ProductCard({ product, config, isAdded, onToggleAdd, onImageClick }) {
  const btnBg = config.add_btn_bg || config.product_add_btn_color || '#000';
  const btnTextColor = config.add_btn_text_color || config.product_add_btn_text_color || '#fff';
  const btnRadius = config.add_btn_border_radius ?? 8;
  const btnFontSize = config.add_btn_font_size || config.product_add_btn_font_size || 14;
  const btnFontWeight = config.add_btn_font_weight || config.product_add_btn_font_weight || 600;
  const addBtnText = config.add_btn_text || config.product_add_btn_text || 'Add';
  const cardRadius = config.card_border_radius || 12;
  const textColor = config.text_color || '#1a1a1a';
  const primaryColor = config.primary_color || '#000000';

  return (
    <div style={{
      border: `2px solid ${isAdded ? '#22c55e' : '#eee'}`,
      borderRadius: `${cardRadius}px`,
      overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column',
      transition: 'border-color 0.2s',
    }}>
      <div onClick={() => onImageClick(product)}
        style={{
          height: '160px', background: '#f5f5f5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', cursor: 'pointer',
        }}>
        {product.image ? (
          <img src={product.image.url} alt={product.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
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
        <div style={{ fontSize: '14px', fontWeight: 700, color: primaryColor, marginBottom: '8px' }}>
          {product.currency === 'INR' ? '₹' : '$'}{parseFloat(product.price).toFixed(2)}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 0 0', borderTop: '1px solid #eee',
          justifyContent: 'space-between',
        }}>
          <button type="button" onClick={() => onToggleAdd(product)}
            style={{
              flex: 1, background: isAdded ? '#22c55e' : btnBg,
              color: isAdded ? '#fff' : btnTextColor,
              border: 'none', padding: '8px 12px',
              borderRadius: `${btnRadius}px`, cursor: 'pointer',
              fontWeight: btnFontWeight, fontSize: `${btnFontSize}px`,
              transition: 'all 0.2s',
            }}>
            {isAdded ? '✓ Added' : addBtnText}
          </button>
        </div>
      </div>
    </div>
  );
}

function Layout2Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selected, onToggleAdd, onImageClick, totalSelected, maxProducts, onCheckout,
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
          <ProgressBar selectedCount={totalSelected} maxProducts={maxProducts} config={config} />
          <LimitReachedBanner isReached={totalSelected >= maxProducts} maxProducts={maxProducts} config={config} />
          {activeProducts.length === 0 ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              background: '#f9fafb', borderRadius: '8px',
              border: '2px dashed #e1e3e5', color: '#8c9196', fontSize: '13px',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
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
                  isAdded={selected.has(p.id)}
                  onToggleAdd={onToggleAdd}
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

function Layout1Preview({ config, productsByHandle, collectionNameMap, templateName,
                          selected, onToggleAdd, onImageClick, totalSelected, maxProducts, onCheckout,
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
          <ProgressBar selectedCount={totalSelected} maxProducts={maxProducts} config={config} />
          <LimitReachedBanner isReached={totalSelected >= maxProducts} maxProducts={maxProducts} config={config} />
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
                    <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
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
                        isAdded={selected.has(p.id)}
                        onToggleAdd={onToggleAdd}
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
  const { templateName, config, productsByHandle, collectionNameMap, shop, activeDiscounts } = useLoaderData();
  const layout = config.layout || 'layout1';

  const [selected, setSelected] = useState(new Set());
  const [lightboxProduct, setLightboxProduct] = useState(null);

  const totalSelected = selected.size;
  const maxProducts = parseInt(config.max_products) || 5;

  // Price & discount computation
  const productPriceMap = {};
  Object.values(productsByHandle).forEach((prods) => {
    prods.forEach((p) => { productPriceMap[p.id] = parseFloat(p.price) || 0; });
  });
  const totalPrice = [...selected].reduce((sum, pid) => sum + (productPriceMap[pid] || 0), 0);

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

  const onToggleAdd = (product) => {
    setSelected((prev) => {
      if (prev.has(product.id)) {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      }
      if (prev.size >= maxProducts) {
        alert((config.limit_reached_message || 'Limit reached! You can only select {{limit}} items.').replace('{{limit}}', maxProducts));
        return prev;
      }
      const next = new Set(prev);
      next.add(product.id);
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
    const variantMap = {};
    Object.values(productsByHandle).forEach((prods) => {
      prods.forEach((p) => {
        if (p.variantId) variantMap[p.id] = p.variantId;
      });
    });
    const cartLines = [];
    selected.forEach((pid) => {
      const vid = variantMap[pid];
      if (vid) {
        const shortId = vid.split('/').pop();
        cartLines.push(`${shortId}:1`);
      }
    });
    if (cartLines.length === 0) return;
    const shopDomain = shop.replace(/^https?:\/\//, '');
    const cartUrl = `https://${shopDomain}/cart/${cartLines.join(',')}`;
    window.location.href = cartUrl;
  };

  const lightboxImages = lightboxProduct
    ? (lightboxProduct.images && lightboxProduct.images.length > 0
        ? lightboxProduct.images
        : lightboxProduct.image ? [lightboxProduct.image] : [])
    : [];

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7' }}>
      <style>{`
        @keyframes combo-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '14px 28px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', boxShadow: '0 2px 12px rgba(102,126,234,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <a href={`/app/bundles/templates`} style={{
            background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '8px', color: '#fff', padding: '6px 12px', cursor: 'pointer',
            fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center',
            gap: '6px', textDecoration: 'none',
          }}>
            ← Back
          </a>
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '19px', letterSpacing: '-0.4px' }}>
            Preview: {templateName}
          </span>
        </div>
        {selected.size > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.2)', borderRadius: '8px',
            padding: '6px 14px', color: '#fff', fontSize: '14px', fontWeight: 600,
          }}>
            {selected.size} selected
          </div>
        )}
      </div>

      {layout === 'layout2' ? (
        <Layout2Preview
          config={config}
          productsByHandle={productsByHandle}
          collectionNameMap={collectionNameMap}
          templateName={templateName}
          selected={selected}
          onToggleAdd={onToggleAdd}
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
          selected={selected}
          onToggleAdd={onToggleAdd}
          onImageClick={onImageClick}
          totalSelected={totalSelected}
          maxProducts={maxProducts}
          onCheckout={onCheckout}
          totalPrice={totalPrice}
          finalPrice={finalPrice}
          discountApplicable={discountApplicable}
        />
      )}

      <div style={{ textAlign: 'center', marginTop: '16px', color: '#999', fontSize: '12px' }}>
        This is a preview of your saved combo template. The actual storefront may vary based on theme integration.
      </div>

      {lightboxProduct && lightboxImages.length > 0 && (
        <Lightbox images={lightboxImages} onClose={() => setLightboxProduct(null)} />
      )}
    </div>
  );
}
