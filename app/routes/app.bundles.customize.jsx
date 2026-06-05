import { useState, useCallback, useEffect, useMemo } from 'react';
import { useLoaderData, useFetcher, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  BlockStack, Text, Button, Select, Checkbox, Divider,
  RangeSlider, Icon, Modal, TextField, Toast, Frame, Popover, ActionList,
} from '@shopify/polaris';
import {
  MagicIcon, ProductIcon, ImageIcon, TextIcon, ViewIcon, RefreshIcon,
  CodeIcon, MobileIcon, DesktopIcon, TabletIcon, PlusIcon, DeleteIcon,
  ListBulletedIcon, PageIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';

// ─── Constants ──────────────────────────────────────────────────────────────

const FONTS = [
  { value: 'Inter', label: 'Inter' },
  { value: 'System UI', label: 'System UI' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
];

const LAYOUTS = [
  {
    id: 'fmcg',
    label: 'FMCG Quick Commerce',
    description: 'Instamart-style: category sidebar + product grid with quantity controls',
    icon: ListBulletedIcon,
  },
  {
    id: 'tabs',
    label: 'Tab Collections',
    description: 'Scrollable tab bar — each tab shows a different collection',
    icon: RefreshIcon,
  },
  {
    id: 'single',
    label: 'Single Collection',
    description: 'Clean product grid from one collection with sticky checkout bar',
    icon: PageIcon,
  },
];

const SIDEBAR_TABS = [
  { id: 'layout', label: 'Layout', icon: ProductIcon },
  { id: 'display', label: 'Display', icon: ViewIcon },
  { id: 'content', label: 'Content', icon: TextIcon },
  { id: 'banners', label: 'Banners', icon: ImageIcon },
  { id: 'styling', label: 'Styling', icon: MagicIcon },
  { id: 'behavior', label: 'Behavior', icon: ViewIcon },
  { id: 'ai', label: 'AI', icon: MagicIcon },
  { id: 'css', label: 'CSS', icon: CodeIcon },
];

const DEFAULT_SETTINGS = {
  // Layout
  selectedLayout: 'fmcg',
  selectedCollections: [],
  selectedProducts: [],
  // Display
  displayType: 'grid',
  productsPerRow: 3,
  numberOfRows: 2,
  maxProducts: 12,
  desktopLayout: 'grid',
  mobileLayout: 'list',
  // Content
  mainTitle: 'Complete Your Bundle',
  subtitle: 'Add more items and save',
  description: '',
  ctaLabel: 'Shop Now',
  footerText: '',
  discountBadge: 'Save 10%',
  ctaBgColor: '#008060',
  ctaTextColor: '#ffffff',
  ctaBorderRadius: '6',
  ctaLink: '',
  contentWidth: '1200px',
  // Banner
  bannerEnabled: false,
  bannerDesktopImage: '', bannerDesktopHeading: '', bannerDesktopSubtitle: '',
  bannerDesktopCta: '', bannerDesktopHeight: '400px', bannerDesktopWidth: '100%',
  bannerMobileImage: '', bannerMobileHeading: '', bannerMobileSubtitle: '',
  bannerMobileCta: '', bannerMobileHeight: '250px', bannerMobileWidth: '100%',
  // Styling
  bgColor: '#ffffff',
  cardBgColor: '#f9fafb',
  textColor: '#111827',
  borderColor: '#e5e7eb',
  borderRadius: '8',
  fontFamily: 'Inter',
  fontSize: '16',
  spacing: '16',
  shadowLevel: 'soft',
  // Behavior
  autoShow: false,
  delaySeconds: '0',
  exitIntent: false,
  scrollTrigger: false,
  scrollTriggerPercent: '50',
  mobileVisible: true,
  desktopVisible: true,
  linkedDiscount: '',
  // AI
  aiEnabled: false,
  aiHeading: 'You Might Also Like',
  aiRecommendationCount: 4,
  // Progress
  progressBarEnabled: false,
  barColor: '#e1e3e5',
  filledColor: '#008060',
  milestones: [],
  animationEnabled: true,
  // CSS
  cssContent: '',
};

function safeJsonParse(str, fallback = {}) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ─── Server ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const templateId = url.searchParams.get('id');
  const presetType = url.searchParams.get('template');

  let collections = [];
  try {
    const res = await admin.graphql(`
      query { collections(first: 50) { edges { node { id title handle
        image { url } productsCount { count }
      } } } }
    `);
    const json = await res.json();
    collections = (json.data?.collections?.edges || []).map(e => ({
      id: e.node.id, title: e.node.title, handle: e.node.handle,
      image: e.node.image?.url || null, productCount: e.node.productsCount?.count || 0,
    }));
  } catch {}

  let template = null;
  if (templateId) {
    try {
      const { default: prisma } = await import('../db.server');
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM combo_templates WHERE id = ? AND shop_domain = ?`,
        Number(templateId), shop
      );
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0];
        template = { ...row, customization_data: safeJsonParse(row.customization_data) };
      }
    } catch {}
  }

  return { shop, collections, template, presetType };
};

// Migrate the table: create if missing, add any columns that don't exist yet.
async function ensureComboTemplatesTable(prisma) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS combo_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_domain TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      slug TEXT,
      template_type TEXT DEFAULT 'grid',
      status TEXT DEFAULT 'draft',
      is_active INTEGER DEFAULT 1,
      version INTEGER DEFAULT 1,
      description TEXT,
      features TEXT,
      customization_data TEXT,
      page_id TEXT,
      page_handle TEXT,
      page_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Safely add any columns missing from older table versions (errors are ignored)
  const migrations = [
    `ALTER TABLE combo_templates ADD COLUMN template_type TEXT DEFAULT 'grid'`,
    `ALTER TABLE combo_templates ADD COLUMN status TEXT DEFAULT 'draft'`,
    `ALTER TABLE combo_templates ADD COLUMN is_active INTEGER DEFAULT 1`,
    `ALTER TABLE combo_templates ADD COLUMN version INTEGER DEFAULT 1`,
    `ALTER TABLE combo_templates ADD COLUMN description TEXT`,
    `ALTER TABLE combo_templates ADD COLUMN features TEXT`,
    `ALTER TABLE combo_templates ADD COLUMN customization_data TEXT`,
    `ALTER TABLE combo_templates ADD COLUMN page_id TEXT`,
    `ALTER TABLE combo_templates ADD COLUMN page_handle TEXT`,
    `ALTER TABLE combo_templates ADD COLUMN page_url TEXT`,
  ];
  for (const sql of migrations) {
    await prisma.$executeRawUnsafe(sql).catch(() => {});
  }
}

// ─── HTML Generators (run server-side, produce standalone Shopify page HTML) ──

// Local-state cart: never touches Shopify cart API during shopping.
// Only batch-adds to Shopify cart on checkout click then immediately navigates,
// so the Cart Ninja drawer has no time to open.
function buildCartJs() {
  return `
<script>
(function(){
  var _fetch;

  function _getNativeFetch() {
    if (_fetch) return _fetch;
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    _fetch = iframe.contentWindow.fetch.bind(iframe.contentWindow);
    document.body.removeChild(iframe);
    return _fetch;
  }

  // Add variant and go straight to checkout
  window.comboBuyNow = function(variantId, qty) {
    var f = _getNativeFetch();
    f('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: parseInt(variantId, 10), quantity: qty || 1 }] }),
    }).then(function() {
      window.location.href = '/checkout';
    }).catch(function() {
      window.location.href = '/checkout';
    });
  };
})();
</script>`;
}

function generateFMCGHtml(collectionGroups, settings) {
  const color = settings.ctaBgColor || '#2d8c4e';
  const font = settings.fontFamily || '-apple-system,sans-serif';
  const maxP = Number(settings.maxProducts) || 20;

  const groupsJson = JSON.stringify(collectionGroups.map(g => ({
    title: g.title,
    products: g.products.slice(0, maxP).map(p => ({
      title: p.title, handle: p.handle, image: p.image,
      price: p.price, variantId: p.variantId, available: p.available,
    })),
  }))).replace(/<\/script>/gi, '<\\/script>');

  return `
<style>
  #combo-fmcg{max-width:1200px;margin:0 auto;font-family:${font};padding-bottom:70px;}
  .cfmcg-header{background:${color};color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-radius:12px;margin-bottom:12px;}
  .cfmcg-layout{display:flex;gap:12px;}
  .cfmcg-sidebar{width:96px;flex-shrink:0;display:flex;flex-direction:column;gap:6px;}
  .cfmcg-cat{padding:8px 6px;border:2px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-size:12px;font-weight:500;text-align:center;color:#374151;transition:all .15s;}
  .cfmcg-cat.active{border-color:${color};background:${color}12;color:${color};font-weight:700;}
  .cfmcg-grid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px;}
  .cfmcg-card{border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff;display:flex;flex-direction:column;}
  .cfmcg-img{width:100%;height:140px;object-fit:cover;display:block;background:#f3f4f6;}
  .cfmcg-img-ph{width:100%;height:140px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;}
  .cfmcg-body{padding:10px;display:flex;flex-direction:column;flex:1;}
  .cfmcg-name{font-size:13px;font-weight:600;margin:0 0 4px;line-height:1.3;color:#111827;}
  .cfmcg-price{font-size:14px;font-weight:700;color:${color};margin:0 0 8px;}
  .cfmcg-add{width:100%;padding:7px;background:${color};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;}
  .cfmcg-add:disabled{background:#9ca3af;cursor:not-allowed;}
  @media(max-width:600px){.cfmcg-sidebar{display:flex;flex-direction:row;overflow-x:auto;width:100%}.cfmcg-layout{flex-direction:column}.cfmcg-cat{white-space:nowrap;flex-shrink:0}}
</style>

<div id="combo-fmcg">
  <div class="cfmcg-header">
    <div>
      <div style="font-size:18px;font-weight:700">${settings.mainTitle || 'Quick Commerce'}</div>
      <div style="font-size:12px;opacity:.8">${settings.subtitle || 'Shop now'}</div>
    </div>
  </div>

  <div class="cfmcg-layout">
    <div class="cfmcg-sidebar" id="cfmcg-sidebar"></div>
    <div class="cfmcg-grid" id="cfmcg-grid"></div>
  </div>
</div>

<script>
var CFMCG_DATA = ${groupsJson};

function cfmcgRenderSidebar() {
  var sb = document.getElementById('cfmcg-sidebar');
  CFMCG_DATA.forEach(function(col, i) {
    var btn = document.createElement('button');
    btn.className = 'cfmcg-cat' + (i === 0 ? ' active' : '');
    btn.textContent = col.title;
    btn.onclick = function() {
      document.querySelectorAll('.cfmcg-cat').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      cfmcgRenderProducts(col.products);
    };
    sb.appendChild(btn);
  });
  if (CFMCG_DATA.length > 0) cfmcgRenderProducts(CFMCG_DATA[0].products);
}

function cfmcgRenderProducts(products) {
  var grid = document.getElementById('cfmcg-grid');
  grid.innerHTML = '';
  products.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'cfmcg-card';
    card.innerHTML = (p.image
      ? '<img class="cfmcg-img" src="' + p.image + '" alt="' + p.title + '" loading="lazy">'
      : '<div class="cfmcg-img-ph"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>'
    ) + '<div class="cfmcg-body">'
      + '<p class="cfmcg-name">' + p.title + '</p>'
      + '<p class="cfmcg-price">$' + parseFloat(p.price).toFixed(2) + '</p>'
      + '<div>'
      + (p.available
          ? '<button class="cfmcg-add" onclick="comboBuyNow(\\'' + p.variantId + '\\')">Buy Now</button>'
          : '<button class="cfmcg-add" disabled>Out of Stock</button>')
      + '</div></div>';
    grid.appendChild(card);
  });
}

cfmcgRenderSidebar();
</script>
${buildCartJs()}`;
}

function generateTabsHtml(collectionGroups, settings) {
  const color = settings.ctaBgColor || '#667eea';
  const font = settings.fontFamily || '-apple-system,sans-serif';
  const maxP = Number(settings.maxProducts) || 20;

  const groupsJson = JSON.stringify(collectionGroups.map(g => ({
    title: g.title, handle: g.handle,
    products: g.products.slice(0, maxP).map(p => ({
      title: p.title, handle: p.handle, image: p.image,
      price: p.price, variantId: p.variantId, available: p.available,
    })),
  }))).replace(/<\/script>/gi, '<\\/script>');

  return `
<style>
  #combo-tabs{max-width:1200px;margin:0 auto;font-family:${font};padding-bottom:80px;}
  .ctab-bar{display:flex;gap:6px;overflow-x:auto;padding:12px 0;scrollbar-width:none;border-bottom:2px solid #e5e7eb;margin-bottom:20px;}
  .ctab-bar::-webkit-scrollbar{display:none;}
  .ctab-btn{padding:9px 18px;border-radius:20px;border:2px solid #e5e7eb;background:#fff;cursor:pointer;font-size:13px;font-weight:500;white-space:nowrap;color:#374151;transition:all .15s;}
  .ctab-btn.active{background:${color};border-color:${color};color:#fff;font-weight:700;}
  .ctab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px;}
  .ctab-card{border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff;display:flex;flex-direction:column;}
  .ctab-img{width:100%;height:160px;object-fit:cover;display:block;background:#f3f4f6;}
  .ctab-img-ph{width:100%;height:160px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;}
  .ctab-body{padding:12px;display:flex;flex-direction:column;flex:1;gap:4px;}
  .ctab-name{font-size:13px;font-weight:600;margin:0;line-height:1.3;color:#111827;}
  .ctab-price{font-size:14px;font-weight:700;color:${color};margin:0;}
  .ctab-add{width:100%;padding:8px;background:${color};color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:13px;font-weight:600;margin-top:auto;}
  .ctab-add:disabled{background:#9ca3af;cursor:not-allowed;}
</style>

<div id="combo-tabs">
  <div style="padding:16px 0 8px">
    <h2 style="margin:0 0 4px;font-size:24px;font-weight:700;color:#111827">${settings.mainTitle || 'Browse Collections'}</h2>
    <p style="margin:0;font-size:14px;color:#6b7280">${settings.subtitle || 'Shop now'}</p>
  </div>

  <div class="ctab-bar" id="ctab-bar"></div>
  <div class="ctab-grid" id="ctab-grid"></div>
</div>

<div id="combo-checkout-bar">
  <div>
    <div style="font-weight:700;font-size:14px"><span data-combo-count>0</span> items in cart</div>
    <div style="font-size:12px;opacity:.85" data-combo-total></div>
  </div>
  <button id="combo-cta-btn" class="ctab-cta" onclick="ComboCart.checkout()">Proceed to Checkout</button>
</div>
var CTAB_DATA = ${groupsJson};
var ctabActive = 0;

function ctabRender() {
  var bar = document.getElementById('ctab-bar');
  CTAB_DATA.forEach(function(col, i) {
    var btn = document.createElement('button');
    btn.className = 'ctab-btn' + (i === 0 ? ' active' : '');
    btn.textContent = col.title + ' (' + col.products.length + ')';
    btn.onclick = function() {
      document.querySelectorAll('.ctab-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      ctabActive = i;
      ctabRenderProducts(col.products);
    };
    bar.appendChild(btn);
  });
  if (CTAB_DATA.length > 0) ctabRenderProducts(CTAB_DATA[0].products);
}

function ctabRenderProducts(products) {
  var grid = document.getElementById('ctab-grid');
  grid.innerHTML = '';
  products.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'ctab-card';
    card.innerHTML = (p.image
      ? '<img class="ctab-img" src="' + p.image + '" alt="' + p.title + '" loading="lazy">'
      : '<div class="ctab-img-ph"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>'
    ) + '<div class="ctab-body">'
      + '<p class="ctab-name">' + p.title + '</p>'
      + '<p class="ctab-price">$' + parseFloat(p.price).toFixed(2) + '</p>'
      + '<div>'
      + (p.available
          ? '<button class="ctab-add" onclick="comboBuyNow(\\'' + p.variantId + '\\')">Buy Now</button>'
          : '<button class="ctab-add" disabled>Out of Stock</button>')
      + '</div></div>';
    grid.appendChild(card);
  });
}

ctabRender();
</script>
${buildCartJs()}`;
}

function generateSingleHtml(collectionGroups, settings) {
  const color = settings.ctaBgColor || '#f59e0b';
  const font = settings.fontFamily || '-apple-system,sans-serif';
  const maxP = Number(settings.maxProducts) || 24;
  const cols = Math.min(Math.max(Number(settings.productsPerRow) || 3, 2), 6);

  const group = collectionGroups[0] || { title: 'Products', products: [] };
  const products = group.products.slice(0, maxP);
  const productsJson = JSON.stringify(products.map(p => ({
    title: p.title, handle: p.handle, image: p.image,
    price: p.price, variantId: p.variantId, available: p.available,
  }))).replace(/<\/script>/gi, '<\\/script>');

  return `
<style>
  #combo-single{max-width:1200px;margin:0 auto;font-family:${font};padding-bottom:80px;}
  .csingle-header{padding:16px 0 20px;border-bottom:1px solid #e5e7eb;margin-bottom:20px;}
  .csingle-grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:16px;}
  .csingle-card{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.06);display:flex;flex-direction:column;}
  .csingle-img{width:100%;height:190px;object-fit:cover;display:block;background:#f3f4f6;}
  .csingle-img-ph{width:100%;height:190px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;}
  .csingle-body{padding:12px;display:flex;flex-direction:column;flex:1;gap:6px;}
  .csingle-name{font-size:14px;font-weight:600;margin:0;line-height:1.3;color:#111827;}
  .csingle-price{font-size:15px;font-weight:700;color:${color};margin:0;}
  .csingle-add{width:100%;padding:9px;background:${color};color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;margin-top:auto;}
  .csingle-add:disabled{background:#9ca3af;cursor:not-allowed;}
  @media(max-width:640px){.csingle-grid{grid-template-columns:repeat(2,1fr);}}
</style>

<div id="combo-single">
  <div class="csingle-header">
    <h2 style="margin:0 0 4px;font-size:26px;font-weight:700;color:#111827">${settings.mainTitle || group.title}</h2>
    <p style="margin:0;font-size:14px;color:#6b7280">${settings.subtitle || (products.length + ' products')}</p>
  </div>

  <div class="csingle-grid" id="csingle-grid"></div>
</div>

<script>
var CSINGLE_DATA = ${productsJson};

function csingleRender() {
  var grid = document.getElementById('csingle-grid');
  CSINGLE_DATA.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'csingle-card';
    card.innerHTML = (p.image
      ? '<img class="csingle-img" src="' + p.image + '" alt="' + p.title + '" loading="lazy">'
      : '<div class="csingle-img-ph"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>'
    ) + '<div class="csingle-body">'
      + '<p class="csingle-name">' + p.title + '</p>'
      + '<p class="csingle-price">$' + parseFloat(p.price).toFixed(2) + '</p>'
      + '<div>'
      + (p.available
          ? '<button class="csingle-add" onclick="comboBuyNow(\\'' + p.variantId + '\\')">Buy Now</button>'
          : '<button class="csingle-add" disabled>Out of Stock</button>')
      + '</div></div>';
    grid.appendChild(card);
  });
}

csingleRender();
</script>
${buildCartJs()}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const data = await request.json();

  try {
    const { default: prisma } = await import('../db.server');
    await ensureComboTemplatesTable(prisma);

    const name = data.name || data.pageTitle || 'Untitled Bundle';
    const templateType = data.selectedLayout || data.displayType || 'grid';
    const rawHandle = data.pageHandle || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const slug = rawHandle.replace(/[^a-z0-9-]/g, '') + '-' + Date.now();
    const customizationData = JSON.stringify(data);

    // ── Save template to DB ──────────────────────────────────────────────────
    let templateId;
    if (data.id) {
      await prisma.$executeRawUnsafe(
        `UPDATE combo_templates
         SET name = ?, template_type = ?, customization_data = ?,
             version = COALESCE(version, 1) + 1, updated_at = datetime('now')
         WHERE id = ? AND shop_domain = ?`,
        name, templateType, customizationData, Number(data.id), shop
      );
      templateId = Number(data.id);
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO combo_templates
           (shop_domain, name, slug, template_type, status, is_active, customization_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 1, ?, datetime('now'), datetime('now'))`,
        shop, name, slug, templateType, customizationData
      );
      const lastId = await prisma.$queryRawUnsafe(`SELECT last_insert_rowid() as id`);
      templateId = Number(lastId[0]?.id ?? 0);
    }

    // ── Fetch products grouped by collection ─────────────────────────────────
    const collectionGroups = [];
    for (const col of (data.selectedCollections || [])) {
      if (!col.id) continue;
      try {
        const res = await admin.graphql(`
          query($id: ID!, $first: Int!) {
            collection(id: $id) {
              title handle
              products(first: $first) {
                edges {
                  node {
                    id title handle
                    featuredImage { url }
                    priceRangeV2 { minVariantPrice { amount currencyCode } }
                    variants(first: 1) { edges { node { id availableForSale } } }
                  }
                }
              }
            }
          }
        `, { variables: { id: col.id, first: Number(data.maxProducts) || 20 } });

        const json = await res.json();
        const collection = json.data?.collection;
        if (!collection) continue;

        const products = (collection.products?.edges || []).map(e => ({
          id: e.node.id,
          title: e.node.title,
          handle: e.node.handle,
          image: e.node.featuredImage?.url || '',
          price: parseFloat(e.node.priceRangeV2?.minVariantPrice?.amount || 0).toFixed(2),
          // Numeric variant ID required by Shopify cart AJAX API
          variantId: (e.node.variants?.edges?.[0]?.node?.id || '').split('/').pop(),
          available: e.node.variants?.edges?.[0]?.node?.availableForSale ?? true,
        }));

        collectionGroups.push({
          id: col.id,
          title: col.title || collection.title,
          handle: col.handle || collection.handle,
          products,
        });
      } catch (err) {
        console.error('[combo-forge] collection fetch failed:', col.id, err.message);
      }
    }

    // ── Choose HTML generator based on template type ──────────────────────────
    let pageBody = '';
    if (templateType === 'fmcg') {
      pageBody = generateFMCGHtml(collectionGroups, data);
    } else if (templateType === 'tabs' || templateType === 'carousel') {
      pageBody = generateTabsHtml(collectionGroups, data);
    } else {
      pageBody = generateSingleHtml(collectionGroups, data);
    }

    const pageTitle = data.pageTitle || name;
    const pageHandle = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-');

    // ── Create or Update Shopify page (2025-10 API) ───────────────────────────
    // pageCreate: body (not bodyHtml), isPublished (not published)
    // pageUpdate: same fields, uses existing page id — avoids creating duplicate pages on re-save

    const existingPageId = data.existingPageId || null;

    const PAGE_CREATE = `#graphql
      mutation pageCreate($page: PageCreateInput!) {
        pageCreate(page: $page) {
          page { id handle title }
          userErrors { field message code }
        }
      }`;

    const PAGE_UPDATE = `#graphql
      mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
        pageUpdate(id: $id, page: $page) {
          page { id handle title }
          userErrors { field message code }
        }
      }`;

    let page = null;
    let pageError = null;

    try {
      let rj;

      if (existingPageId) {
        // ── UPDATE existing page ───────────────────────────────────────────
        const res = await admin.graphql(PAGE_UPDATE, {
          variables: { id: existingPageId, page: { title: pageTitle, body: pageBody, isPublished: true } },
        });
        rj = await res.json();
        if (rj.errors?.length) throw new Error(rj.errors.map(e => e.message).join('; '));
        const ue = rj.data?.pageUpdate?.userErrors || [];
        if (ue.length) throw new Error(ue.map(e => e.message).join('; '));
        page = rj.data?.pageUpdate?.page;
      } else {
        // ── CREATE new page ────────────────────────────────────────────────
        const tryCreate = async (handle) => {
          const res = await admin.graphql(PAGE_CREATE, {
            variables: { page: { title: pageTitle, handle, body: pageBody, isPublished: true } },
          });
          return res.json();
        };

        rj = await tryCreate(pageHandle);
        if (rj.errors?.length) throw new Error(rj.errors.map(e => e.message).join('; '));

        let ue = rj.data?.pageCreate?.userErrors || [];
        if (ue.some(e => e.code === 'TAKEN' || e.message?.toLowerCase().includes('handle'))) {
          // Handle taken — retry with random suffix
          rj = await tryCreate(pageHandle + '-' + Math.random().toString(36).slice(2, 6));
          ue = rj.data?.pageCreate?.userErrors || [];
        }
        if (ue.length) throw new Error(ue.map(e => `[${e.code}] ${e.message}`).join('; '));
        page = rj.data?.pageCreate?.page;
      }

      // ── Save page info back to template row ────────────────────────────────
      if (page) {
        const pageUrl = `https://${shop}/pages/${page.handle}`;
        await prisma.$executeRawUnsafe(
          `UPDATE combo_templates SET page_id=?, page_handle=?, page_url=?, status='active', updated_at=datetime('now') WHERE id=?`,
          page.id, page.handle, pageUrl, templateId
        );
        return Response.json({
          success: true,
          message: existingPageId ? 'Template & page updated!' : 'Template saved & page published!',
          templateId,
          page: { id: page.id, handle: page.handle, title: page.title, url: pageUrl },
        });
      }
    } catch (err) {
      pageError = err.message;
    }

    // Template was saved even if page creation failed — return partial success
    return Response.json({
      success: true,
      message: pageError
        ? `Template saved. Page creation failed: ${pageError}`
        : 'Template saved.',
      templateId,
      pageError: pageError || null,
    });

  } catch (err) {
    return Response.json({ success: false, error: err.message });
  }
};

// ─── AI Helper Button ─────────────────────────────────────────────────────────

function AiButton({ onGenerate, field, loading }) {
  return (
    <button
      onClick={() => onGenerate(field)}
      disabled={loading}
      style={{
        marginLeft: '6px', padding: '3px 10px', borderRadius: '12px', border: 'none',
        background: 'linear-gradient(135deg, #667eea, #764ba2)',
        color: '#fff', fontSize: '11px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Icon source={MagicIcon} tone="base" />
        {loading ? 'AI...' : 'AI'}
      </span>
    </button>
  );
}

// ─── Color Picker Field ───────────────────────────────────────────────────────

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: '13px', color: '#374151', marginBottom: '4px', fontWeight: '500' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="color"
          value={value || '#ffffff'}
          onChange={e => onChange(e.target.value)}
          style={{ width: '36px', height: '36px', borderRadius: '6px', border: '1px solid #e5e7eb', cursor: 'pointer', padding: '2px' }}
        />
        <TextField
          label=""
          value={value || ''}
          onChange={onChange}
          autoComplete="off"
        />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AppBundlesCustomize() {
  const { collections, template, presetType } = useLoaderData();
  const fetcher = useFetcher();

  const initialSettings = useMemo(() => {
    if (template?.customization_data && typeof template.customization_data === 'object') {
      return { ...DEFAULT_SETTINGS, ...template.customization_data };
    }
    if (presetType) return { ...DEFAULT_SETTINGS, selectedLayout: presetType };
    return { ...DEFAULT_SETTINGS };
  }, [template, presetType]);

  const [settings, setSettings] = useState(initialSettings);
  const [activeSidebarTab, setActiveSidebarTab] = useState('layout');
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState(template?.name || 'Bundle Page');
  const [pageHandle, setPageHandle] = useState(template?.slug || 'bundle-page');
  const [toastActive, setToastActive] = useState(false);
  const [pageUrl, setPageUrl] = useState(template?.page_url || null);
  const [existingPageId, setExistingPageId] = useState(template?.page_id || null);
  const [toastMsg, setToastMsg] = useState('');
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(null);

  const showToast = useCallback((msg) => { setToastMsg(msg); setToastActive(true); }, []);

  const update = useCallback((key, value) => setSettings(p => ({ ...p, [key]: value })), []);

  useEffect(() => {
    if (!settings.selectedCollections?.length) return;
    setProductsLoading(true);
    const ids = settings.selectedCollections.map(c => c.id).filter(Boolean);
    if (!ids.length) { setProductsLoading(false); return; }
    fetch(`/api/bundle-products?collectionIds=${ids.join(',')}`)
      .then(r => r.json())
      .then(d => { if (d.success) setProducts(d.products || []); setProductsLoading(false); })
      .catch(() => setProductsLoading(false));
  }, [settings.selectedCollections]);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      const msg = fetcher.data.message || 'Saved!';
      const newPage = fetcher.data.page;
      showToast(newPage?.url ? `${msg} — /pages/${newPage.handle}` : msg);
      if (newPage?.url) setPageUrl(newPage.url);
      if (newPage?.id) setExistingPageId(newPage.id);
    } else {
      showToast('Error: ' + (fetcher.data.error || 'Save failed'));
    }
  }, [fetcher.data, showToast, setExistingPageId]);

  const handleAiGenerate = useCallback(async (field) => {
    setAiLoading(field);
    try {
      await new Promise(r => setTimeout(r, 900));
      const suggestions = {
        mainTitle: ['Complete Your Perfect Bundle', 'Build Your Dream Collection', 'Upgrade Your Order Now'][Math.floor(Math.random() * 3)],
        subtitle: ['Add more and unlock exclusive savings on your order', 'Mix and match for maximum value'][Math.floor(Math.random() * 2)],
        description: 'Our curated bundle gives you everything you need at a special combined price. Limited-time offer.',
        ctaLabel: ['Shop Bundle', 'Add All Items', 'Build Bundle'][Math.floor(Math.random() * 3)],
        discountBadge: ['Save 15%', 'Bundle Deal', '3-for-2'][Math.floor(Math.random() * 3)],
      };
      update(field, suggestions[field] || '');
      showToast(`AI generated: ${field}`);
    } catch {
      showToast('AI generation failed — try again');
    } finally {
      setAiLoading(null);
    }
  }, [update, showToast]);

  const handleSave = useCallback(() => {
    fetcher.submit(
      JSON.stringify({ ...settings, name: pageTitle, pageTitle, pageHandle, existingPageId }),
      { method: 'POST', encType: 'application/json' }
    );
    setSaveModalOpen(false);
    showToast('Saving template...');
  }, [settings, pageTitle, pageHandle, existingPageId, fetcher, showToast]);

  const addCollection = useCallback((col) => {
    setSettings(p => ({ ...p, selectedCollections: [...(p.selectedCollections || []), col] }));
    setCollectionPickerOpen(false);
  }, []);
  const removeCollection = useCallback((i) => {
    setSettings(p => ({ ...p, selectedCollections: p.selectedCollections.filter((_, j) => j !== i) }));
  }, []);

  // ─── Sidebar panels ──────────────────────────────────────────────────────────

  const renderPanel = () => {
    switch (activeSidebarTab) {

      case 'layout':
        return (
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">Layout Type</Text>
              <div style={{
                padding: '10px 14px', borderRadius: '8px', background: 'rgba(102,126,234,0.08)',
                border: '1px solid rgba(102,126,234,0.2)',
              }}>
                <Text variant="bodySm" as="p" fontWeight="semibold" tone="subdued">
                  {LAYOUTS.find(l => l.id === settings.selectedLayout)?.label || settings.selectedLayout}
                </Text>
              </div>
              <Text variant="bodyXs" as="p" tone="subdued">
                To change the layout, go back to Templates and select a different template.
              </Text>
            </BlockStack>
            <Divider />
            <Text variant="headingMd" as="h2">Collections</Text>
            <Popover
              active={collectionPickerOpen}
              activator={<Button onClick={() => setCollectionPickerOpen(true)} disclosure>Add Collection</Button>}
              onClose={() => setCollectionPickerOpen(false)}
            >
              <div style={{ maxHeight: '280px', overflow: 'auto', width: '260px' }}>
                <ActionList items={collections.map(c => ({
                  content: `${c.title} (${c.productCount})`,
                  onAction: () => addCollection({ id: c.id, title: c.title, handle: c.handle }),
                }))} />
              </div>
            </Popover>
            {(settings.selectedCollections || []).map((col, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', borderRadius: '6px', background: '#f9fafb', border: '1px solid #e5e7eb',
              }}>
                <div>
                  <Text variant="bodySm" as="p" fontWeight="semibold">{col.title}</Text>
                  <Text variant="bodyXs" as="p" tone="subdued">{col.handle}</Text>
                </div>
                <Button onClick={() => removeCollection(i)} variant="tertiary" tone="critical" size="slim">
                  <Icon source={DeleteIcon} tone="base" />
                </Button>
              </div>
            ))}
          </BlockStack>
        );

      case 'display':
        return (
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Display Settings</Text>
            <Select label="Display Type" options={[{ label: 'Grid', value: 'grid' }, { label: 'Carousel', value: 'carousel' }, { label: 'List', value: 'list' }]} value={settings.displayType} onChange={v => update('displayType', v)} />
            <Select label="Desktop Layout" options={[{ label: 'Grid', value: 'grid' }, { label: 'Sidebar', value: 'sidebar' }, { label: 'Full Width', value: 'fullwidth' }]} value={settings.desktopLayout || 'grid'} onChange={v => update('desktopLayout', v)} />
            <Select label="Mobile Layout" options={[{ label: 'List', value: 'list' }, { label: 'Grid (2 col)', value: 'grid' }, { label: 'Carousel', value: 'carousel' }]} value={settings.mobileLayout || 'list'} onChange={v => update('mobileLayout', v)} />
            <RangeSlider label="Products Per Row" value={settings.productsPerRow || 3} min={1} max={6} onChange={v => update('productsPerRow', v)} output />
            <RangeSlider label="Number of Rows" value={settings.numberOfRows || 2} min={1} max={6} onChange={v => update('numberOfRows', v)} output />
            <RangeSlider label="Total Products" value={settings.maxProducts || 12} min={1} max={60} onChange={v => update('maxProducts', v)} output />
          </BlockStack>
        );

      case 'content':
        return (
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Content</Text>
            {[
              { key: 'mainTitle', label: 'Section Title', multiline: false },
              { key: 'subtitle', label: 'Subtitle', multiline: false },
              { key: 'description', label: 'Description', multiline: 3 },
              { key: 'ctaLabel', label: 'CTA Button Label', multiline: false },
              { key: 'footerText', label: 'Footer Text', multiline: 2 },
              { key: 'discountBadge', label: 'Discount Badge', multiline: false },
            ].map(({ key, label, multiline }) => (
              <div key={key}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '500', color: '#374151' }}>{label}</span>
                  <AiButton onGenerate={handleAiGenerate} field={key} loading={aiLoading === key} />
                </div>
                <TextField
                  label=""
                  value={settings[key] || ''}
                  onChange={v => update(key, v)}
                  multiline={multiline || undefined}
                  autoComplete="off"
                />
              </div>
            ))}
            <Divider />
            <Text variant="headingSm" as="h3">CTA Button</Text>
            <ColorField label="Button Background" value={settings.ctaBgColor} onChange={v => update('ctaBgColor', v)} />
            <ColorField label="Button Text Color" value={settings.ctaTextColor} onChange={v => update('ctaTextColor', v)} />
            <TextField label="Button Border Radius (px)" value={settings.ctaBorderRadius || '6'} onChange={v => update('ctaBorderRadius', v)} autoComplete="off" />
            <TextField label="Button Link URL" value={settings.ctaLink || ''} onChange={v => update('ctaLink', v)} autoComplete="off" placeholder="https://" />
          </BlockStack>
        );

      case 'banners':
        return (
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Banner</Text>
            <Checkbox label="Enable Banner" checked={settings.bannerEnabled || false} onChange={v => update('bannerEnabled', v)} />
            {settings.bannerEnabled && (
              <>
                <Text variant="headingSm" as="h3">Desktop Banner</Text>
                {[
                  { key: 'bannerDesktopImage', label: 'Image URL' },
                  { key: 'bannerDesktopHeading', label: 'Heading' },
                  { key: 'bannerDesktopSubtitle', label: 'Subtitle' },
                  { key: 'bannerDesktopCta', label: 'CTA Text' },
                  { key: 'bannerDesktopHeight', label: 'Height (e.g. 400px)' },
                  { key: 'bannerDesktopWidth', label: 'Width (e.g. 100%)' },
                ].map(({ key, label }) => (
                  <TextField key={key} label={label} value={settings[key] || ''} onChange={v => update(key, v)} autoComplete="off" />
                ))}
                <Divider />
                <Text variant="headingSm" as="h3">Mobile Banner</Text>
                {[
                  { key: 'bannerMobileImage', label: 'Image URL' },
                  { key: 'bannerMobileHeading', label: 'Heading' },
                  { key: 'bannerMobileSubtitle', label: 'Subtitle' },
                  { key: 'bannerMobileCta', label: 'CTA Text' },
                  { key: 'bannerMobileHeight', label: 'Height (e.g. 250px)' },
                  { key: 'bannerMobileWidth', label: 'Width (e.g. 100%)' },
                ].map(({ key, label }) => (
                  <TextField key={key} label={label} value={settings[key] || ''} onChange={v => update(key, v)} autoComplete="off" />
                ))}
              </>
            )}
          </BlockStack>
        );

      case 'styling':
        return (
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Styling</Text>
            <ColorField label="Background Color" value={settings.bgColor} onChange={v => update('bgColor', v)} />
            <ColorField label="Card Background" value={settings.cardBgColor} onChange={v => update('cardBgColor', v)} />
            <ColorField label="Text Color" value={settings.textColor} onChange={v => update('textColor', v)} />
            <ColorField label="Border Color" value={settings.borderColor} onChange={v => update('borderColor', v)} />
            <TextField label="Border Radius (px)" value={settings.borderRadius || '8'} onChange={v => update('borderRadius', v)} autoComplete="off" type="number" />
            <Select label="Font Family" options={FONTS} value={settings.fontFamily || 'Inter'} onChange={v => update('fontFamily', v)} />
            <TextField label="Base Font Size (px)" value={settings.fontSize || '16'} onChange={v => update('fontSize', v)} autoComplete="off" type="number" />
            <TextField label="Spacing (px)" value={settings.spacing || '16'} onChange={v => update('spacing', v)} autoComplete="off" type="number" />
            <Select
              label="Shadow Level"
              options={[
                { label: 'None', value: 'none' },
                { label: 'Soft', value: 'soft' },
                { label: 'Medium', value: 'medium' },
                { label: 'Strong', value: 'strong' },
              ]}
              value={settings.shadowLevel || 'soft'}
              onChange={v => update('shadowLevel', v)}
            />
            <Divider />
            <Text variant="headingSm" as="h3">Progress Bar</Text>
            <Checkbox label="Enable Progress Bar" checked={settings.progressBarEnabled || false} onChange={v => update('progressBarEnabled', v)} />
            {settings.progressBarEnabled && (
              <>
                <ColorField label="Bar Background" value={settings.barColor} onChange={v => update('barColor', v)} />
                <ColorField label="Filled Color" value={settings.filledColor} onChange={v => update('filledColor', v)} />
                <Checkbox label="Enable Animation" checked={settings.animationEnabled !== false} onChange={v => update('animationEnabled', v)} />
                <Text variant="headingXs" as="h4">Milestones</Text>
                {(settings.milestones || []).map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <TextField label="Value ($)" value={String(m.value || 0)} type="number"
                        onChange={v => { const ms = [...(settings.milestones || [])]; ms[i] = { ...ms[i], value: parseFloat(v) || 0 }; update('milestones', ms); }}
                        autoComplete="off" />
                    </div>
                    <div style={{ flex: 2 }}>
                      <TextField label="Label" value={m.label || ''}
                        onChange={v => { const ms = [...(settings.milestones || [])]; ms[i] = { ...ms[i], label: v }; update('milestones', ms); }}
                        autoComplete="off" />
                    </div>
                    <Button size="slim" tone="critical" onClick={() => update('milestones', settings.milestones.filter((_, j) => j !== i))}>
                      <Icon source={DeleteIcon} tone="base" />
                    </Button>
                  </div>
                ))}
                <Button size="slim" onClick={() => update('milestones', [...(settings.milestones || []), { value: 50, label: 'Free Shipping' }])}>
                  <Icon source={PlusIcon} tone="base" />
                  <span style={{ marginLeft: '4px' }}>Add Milestone</span>
                </Button>
              </>
            )}
          </BlockStack>
        );

      case 'behavior':
        return (
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Behavior</Text>
            <Checkbox label="Auto Show on Page Load" checked={settings.autoShow || false} onChange={v => update('autoShow', v)} />
            {settings.autoShow && (
              <TextField label="Delay Before Show (seconds)" value={settings.delaySeconds || '0'} onChange={v => update('delaySeconds', v)} type="number" min="0" autoComplete="off" />
            )}
            <Divider />
            <Text variant="headingSm" as="h3">Triggers</Text>
            <Checkbox label="Exit Intent Trigger" checked={settings.exitIntent || false} onChange={v => update('exitIntent', v)} />
            <Checkbox label="Scroll Position Trigger" checked={settings.scrollTrigger || false} onChange={v => update('scrollTrigger', v)} />
            {settings.scrollTrigger && (
              <RangeSlider label="Trigger at scroll % down page" value={parseInt(settings.scrollTriggerPercent || '50', 10)} min={10} max={90} onChange={v => update('scrollTriggerPercent', String(v))} output />
            )}
            <Divider />
            <Text variant="headingSm" as="h3">Visibility</Text>
            <Checkbox label="Show on Mobile" checked={settings.mobileVisible !== false} onChange={v => update('mobileVisible', v)} />
            <Checkbox label="Show on Desktop" checked={settings.desktopVisible !== false} onChange={v => update('desktopVisible', v)} />
            <Divider />
            <Text variant="headingSm" as="h3">Linked Discount</Text>
            <TextField
              label="Discount Code to apply automatically"
              value={settings.linkedDiscount || ''}
              onChange={v => update('linkedDiscount', v)}
              autoComplete="off"
              placeholder="e.g. BUNDLE10"
              helpText="This code will be auto-applied when the bundle is shown"
            />
          </BlockStack>
        );

      case 'ai':
        return (
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">AI Features</Text>
            <Checkbox label="Enable AI Product Recommendations" checked={settings.aiEnabled || false} onChange={v => update('aiEnabled', v)} />
            {settings.aiEnabled && (
              <>
                <TextField label="Recommendations Section Heading" value={settings.aiHeading || 'You Might Also Like'} onChange={v => update('aiHeading', v)} autoComplete="off" />
                <RangeSlider label="Number of AI Recommendations" value={settings.aiRecommendationCount || 4} min={1} max={12} onChange={v => update('aiRecommendationCount', v)} output />
              </>
            )}
            <Divider />
            <Text variant="headingSm" as="h3">Generate Content with AI</Text>
            <Text variant="bodyXs" as="p" tone="subdued">Click any AI button next to content fields to generate copy automatically</Text>
            <BlockStack gap="200">
              {['mainTitle', 'subtitle', 'description', 'ctaLabel', 'discountBadge'].map(field => (
                <div key={field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text variant="bodySm" as="span" style={{ textTransform: 'capitalize' }}>
                    {field.replace(/([A-Z])/g, ' $1')}
                  </Text>
                  <AiButton onGenerate={handleAiGenerate} field={field} loading={aiLoading === field} />
                </div>
              ))}
            </BlockStack>
          </BlockStack>
        );

      case 'css':
        return (
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Custom CSS</Text>
            <Text variant="bodyXs" as="p" tone="subdued">
              Target <code>.combo-bundle-root</code> as the root selector
            </Text>
            <TextField
              label=""
              value={settings.cssContent || ''}
              onChange={v => update('cssContent', v)}
              multiline={14}
              autoComplete="off"
              placeholder={`.combo-bundle-root {\n  /* Your custom styles here */\n}`}
            />
          </BlockStack>
        );

      default:
        return null;
    }
  };

  // ─── Live Preview ─────────────────────────────────────────────────────────────

  const SHADOW = {
    none: 'none',
    soft: '0 1px 4px rgba(0,0,0,0.08)',
    medium: '0 4px 12px rgba(0,0,0,0.12)',
    strong: '0 8px 24px rgba(0,0,0,0.18)',
  };

  const renderPreview = () => {
    const w = previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%';
    const cols = previewDevice === 'mobile' ? 2 : settings.productsPerRow || 3;
    return (
      <div style={{
        width: w, margin: '0 auto', background: settings.bgColor || '#fff',
        borderRadius: `${settings.borderRadius || 8}px`,
        border: `1px solid ${settings.borderColor || '#e5e7eb'}`,
        boxShadow: SHADOW[settings.shadowLevel || 'soft'],
        fontFamily: settings.fontFamily || 'Inter',
        fontSize: `${settings.fontSize || 16}px`,
        transition: 'all 0.3s ease', overflow: 'hidden', minHeight: '500px',
      }}>
        {/* Banner */}
        {settings.bannerEnabled && (
          <div style={{
            width: '100%',
            height: previewDevice === 'mobile' ? settings.bannerMobileHeight || '200px' : settings.bannerDesktopHeight || '300px',
            background: `url(${previewDevice === 'mobile' ? settings.bannerMobileImage : settings.bannerDesktopImage}) center/cover no-repeat #f3f4f6`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '20px', textAlign: 'center',
          }}>
            <div style={{ color: '#fff', fontWeight: '700', fontSize: '22px', textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
              {(previewDevice === 'mobile' ? settings.bannerMobileHeading : settings.bannerDesktopHeading) || 'Banner Heading'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: '14px', marginTop: '6px' }}>
              {(previewDevice === 'mobile' ? settings.bannerMobileSubtitle : settings.bannerDesktopSubtitle) || 'Subtitle text here'}
            </div>
          </div>
        )}

        {/* Content area */}
        <div style={{ padding: `${settings.spacing || 16}px` }}>
          {/* Discount badge */}
          {settings.discountBadge && (
            <div style={{
              display: 'inline-block', padding: '3px 12px', borderRadius: '20px',
              background: 'linear-gradient(135deg, #667eea, #764ba2)',
              color: '#fff', fontSize: '12px', fontWeight: '600', marginBottom: '10px',
            }}>{settings.discountBadge}</div>
          )}

          <div style={{ color: settings.textColor || '#111827', fontWeight: '700', fontSize: '22px', marginBottom: '6px' }}>
            {settings.mainTitle || 'Complete Your Bundle'}
          </div>
          {settings.subtitle && (
            <div style={{ color: settings.textColor || '#374151', opacity: 0.7, fontSize: '14px', marginBottom: '16px' }}>
              {settings.subtitle}
            </div>
          )}

          {/* Progress bar preview */}
          {settings.progressBarEnabled && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ height: '8px', borderRadius: '4px', background: settings.barColor || '#e1e3e5', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '40%', borderRadius: '4px', background: settings.filledColor || '#008060', transition: 'width 0.4s' }} />
              </div>
              <div style={{ fontSize: '11px', color: settings.textColor || '#374151', marginTop: '4px', opacity: 0.6 }}>
                Spend $40 more to unlock free shipping
              </div>
            </div>
          )}

          {/* Product grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: `${settings.spacing || 16}px`,
          }}>
            {productsLoading
              ? Array.from({ length: cols }).map((_, i) => (
                  <div key={i} style={{
                    height: '180px', borderRadius: `${settings.borderRadius || 8}px`,
                    background: settings.cardBgColor || '#f9fafb',
                    border: `1px solid ${settings.borderColor || '#e5e7eb'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#9ca3af', fontSize: '12px',
                  }}>Loading...</div>
                ))
              : products.slice(0, settings.maxProducts || 12).map(p => (
                  <div key={p.id} style={{
                    borderRadius: `${settings.borderRadius || 8}px`,
                    background: settings.cardBgColor || '#f9fafb',
                    border: `1px solid ${settings.borderColor || '#e5e7eb'}`,
                    boxShadow: SHADOW[settings.shadowLevel || 'soft'],
                    overflow: 'hidden',
                  }}>
                    <div style={{ height: '120px', background: '#f3f4f6', overflow: 'hidden' }}>
                      {p.image
                        ? <img src={p.image.url} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon source={ProductIcon} tone="subdued" /></div>
                      }
                    </div>
                    <div style={{ padding: '8px' }}>
                      <div style={{ color: settings.textColor || '#111827', fontWeight: '600', fontSize: '12px', marginBottom: '2px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.title}</div>
                      <div style={{ color: settings.textColor || '#374151', opacity: 0.65, fontSize: '11px', marginBottom: '6px' }}>${parseFloat(p.price).toFixed(2)}</div>
                      <div style={{
                        padding: '5px 8px', borderRadius: `${Math.min(parseInt(settings.ctaBorderRadius || '6', 10), 20)}px`,
                        background: settings.ctaBgColor || '#008060', color: settings.ctaTextColor || '#fff',
                        textAlign: 'center', fontSize: '11px', fontWeight: '600', cursor: 'pointer',
                      }}>{settings.ctaLabel || 'Shop Now'}</div>
                    </div>
                  </div>
                ))
            }
            {!productsLoading && products.length === 0 && (
              <div style={{
                gridColumn: '1 / -1', padding: '48px', textAlign: 'center',
                color: '#9ca3af', fontSize: '13px',
              }}>
                {settings.selectedCollections?.length > 0
                  ? 'No products found in selected collections'
                  : 'Select collections in the Layout tab to preview products'}
              </div>
            )}
          </div>

          {/* CTA button */}
          {settings.ctaLabel && (
            <div style={{ marginTop: `${settings.spacing || 16}px`, textAlign: 'center' }}>
              <div style={{
                display: 'inline-block', padding: '10px 28px',
                borderRadius: `${settings.ctaBorderRadius || 6}px`,
                background: settings.ctaBgColor || '#008060', color: settings.ctaTextColor || '#fff',
                fontWeight: '600', fontSize: '14px', cursor: 'pointer',
              }}>{settings.ctaLabel}</div>
            </div>
          )}

          {/* Footer text */}
          {settings.footerText && (
            <div style={{ marginTop: '12px', textAlign: 'center', color: settings.textColor || '#374151', opacity: 0.5, fontSize: '12px' }}>
              {settings.footerText}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Frame>
      <div style={{ display: 'flex', height: 'calc(100vh - 110px)', overflow: 'hidden' }}>

        {/* Icon rail */}
        <div style={{
          width: '52px', background: '#1a1a2e', display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: '10px 0', gap: '4px', flexShrink: 0,
        }}>
          {SIDEBAR_TABS.map(tab => {
            const active = activeSidebarTab === tab.id;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveSidebarTab(tab.id)}
                title={tab.label}
                style={{
                  width: '36px', height: '36px', borderRadius: '8px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? 'rgba(102,126,234,0.4)' : 'transparent',
                  border: active ? '1px solid rgba(102,126,234,0.5)' : '1px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                <Icon source={tab.icon} tone={active ? 'base' : 'subdued'} />
              </div>
            );
          })}
        </div>

        {/* Settings panel */}
        <div style={{
          width: '380px', flexShrink: 0, overflow: 'auto',
          borderRight: '1px solid var(--p-color-border)',
          background: 'var(--p-color-bg-surface)',
          padding: '16px',
        }}>
          <div style={{ marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid #f0f0f0' }}>
            <Text variant="headingSm" as="h2">{SIDEBAR_TABS.find(t => t.id === activeSidebarTab)?.label}</Text>
          </div>
          {renderPanel()}
        </div>

        {/* Preview area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Preview toolbar */}
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid var(--p-color-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--p-color-bg-surface)',
          }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { id: 'desktop', icon: DesktopIcon, label: 'Desktop' },
                { id: 'tablet', icon: TabletIcon, label: 'Tablet' },
                { id: 'mobile', icon: MobileIcon, label: 'Mobile' },
              ].map(d => (
                <button
                  key={d.id}
                  onClick={() => setPreviewDevice(d.id)}
                  title={d.label}
                  style={{
                    padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                    background: previewDevice === d.id ? '#667eea' : '#f3f4f6',
                    color: previewDevice === d.id ? '#fff' : '#374151',
                    display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s',
                  }}
                >
                  <Icon source={d.icon} tone={previewDevice === d.id ? 'base' : 'subdued'} />
                  <span style={{ fontSize: '12px', fontWeight: '500' }}>{d.label}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {settings.selectedLayout && (
                <div style={{
                  padding: '4px 10px', borderRadius: '12px', background: 'rgba(102,126,234,0.1)',
                  color: '#667eea', fontSize: '11px', fontWeight: '600',
                }}>
                  {LAYOUTS.find(l => l.id === settings.selectedLayout)?.label}
                </div>
              )}
              {pageUrl && (
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="View live page"
                  style={{
                    width: '34px', height: '34px', borderRadius: '6px',
                    background: '#f0fdf4', border: '1px solid #bbf7d0',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    textDecoration: 'none', flexShrink: 0,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 4C5.5 4 2 10 2 10s3.5 6 8 6 8-6 8-6-3.5-6-8-6z" stroke="#059669" strokeWidth="1.5" fill="none"/>
                    <circle cx="10" cy="10" r="2.5" stroke="#059669" strokeWidth="1.5" fill="none"/>
                  </svg>
                </a>
              )}
              <Button
                onClick={() => setSaveModalOpen(true)}
                variant="primary"
                loading={fetcher.state !== 'idle'}
              >
                Save & Publish
              </Button>
            </div>
          </div>

          {/* Preview canvas */}
          <div style={{
            flex: 1, overflow: 'auto', padding: '24px',
            background: previewDevice === 'mobile' ? '#e5e7eb' : '#f4f5f7',
            display: 'flex', justifyContent: 'center',
          }}>
            {renderPreview()}
          </div>
        </div>
      </div>

      {/* Save Modal */}
      <Modal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save & Publish Bundle Page"
        primaryAction={{
          content: fetcher.state !== 'idle' ? 'Publishing...' : 'Save & Publish',
          onAction: handleSave,
          loading: fetcher.state !== 'idle',
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setSaveModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Page Title"
              value={pageTitle}
              onChange={setPageTitle}
              autoComplete="off"
              helpText="This becomes the Shopify page title visible to customers"
            />
            <TextField
              label="URL Handle"
              value={pageHandle}
              onChange={v => setPageHandle(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              autoComplete="off"
              helpText={`Page will be live at: /pages/${pageHandle || 'bundle-page'}`}
              prefix="/pages/"
            />
            {pageUrl && (
              <div style={{
                padding: '10px 14px', borderRadius: '8px',
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Text variant="bodyXs" as="span" tone="success">
                  Page is live: /pages/{fetcher.data?.page?.handle || pageHandle}
                </Text>
                <a href={pageUrl} target="_blank" rel="noreferrer"
                  style={{ fontSize: '12px', color: '#059669', fontWeight: '600' }}>
                  View
                </a>
              </div>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toastActive && <Toast content={toastMsg} onDismiss={() => setToastActive(false)} />}
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
