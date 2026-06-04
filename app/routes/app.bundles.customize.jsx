import { useState, useCallback, useEffect, useMemo } from 'react';
import { useLoaderData, useFetcher, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  BlockStack, Text, Button, Select, Checkbox, Divider,
  RangeSlider, Icon, Modal, TextField, Toast, Frame, Popover, ActionList,
} from '@shopify/polaris';
import {
  MagicIcon, ProductIcon, ImageIcon, TextIcon, ViewIcon,
  CodeIcon, MobileIcon, DesktopIcon, TabletIcon, PlusIcon, DeleteIcon,
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
    id: 'guided',
    label: 'Guided Architect',
    description: 'Step-by-step multi-stage bundle flow with progress indicators',
    icon: '◎',
  },
  {
    id: 'velocity',
    label: 'Velocity Stream',
    description: 'High-speed carousel optimised for fast-moving product lines',
    icon: '⚡',
  },
  {
    id: 'editorial',
    label: 'Editorial Split',
    description: 'Magazine-style hero + supporting products layout',
    icon: '◫',
  },
  {
    id: 'custom',
    label: 'Custom Bundle',
    description: 'Blank canvas with full CSS and HTML control',
    icon: '✦',
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
  selectedLayout: 'guided',
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

    // ── Build Shopify page HTML with embedded config ─────────────────────────
    const pageTitle = data.pageTitle || name;
    const pageHandle = slug;
    const shopDomain = shop;

    // Inline config so the storefront script can pick it up without an API call
    const configJson = JSON.stringify({
      templateId,
      shop: shopDomain,
      layout: templateType,
      settings: {
        title: data.mainTitle || '',
        subtitle: data.subtitle || '',
        ctaLabel: data.ctaLabel || 'Shop Now',
        ctaBgColor: data.ctaBgColor || '#008060',
        ctaTextColor: data.ctaTextColor || '#ffffff',
        bgColor: data.bgColor || '#ffffff',
        textColor: data.textColor || '#111827',
        borderRadius: data.borderRadius || '8',
        fontFamily: data.fontFamily || 'Inter',
        productsPerRow: data.productsPerRow || 3,
        maxProducts: data.maxProducts || 12,
        collections: (data.selectedCollections || []).map(c => c.handle),
        discountCode: data.linkedDiscount || '',
        bannerEnabled: data.bannerEnabled || false,
        bannerImage: data.bannerDesktopImage || '',
        bannerHeading: data.bannerDesktopHeading || '',
        progressBarEnabled: data.progressBarEnabled || false,
        cssContent: data.cssContent || '',
      },
    }).replace(/<\/script>/gi, '<\\/script>');

    const pageBodyHtml = `
<div id="combo-forge-bundle" data-template-id="${templateId}" data-shop="${shopDomain}"></div>
<script>
  window.ComboForgeConfig = ${configJson};
</script>
<style>
  #combo-forge-bundle { min-height: 200px; }
  .combo-forge-loading { display: flex; align-items: center; justify-content: center; padding: 48px; color: #6b7280; }
</style>
<noscript>
  <p style="text-align:center;padding:40px;color:#6b7280;">
    Please enable JavaScript to view this bundle.
  </p>
</noscript>`.trim();

    // ── Create / update Shopify page ─────────────────────────────────────────
    const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');

    let page = null;
    let pageError = null;
    try {
      const gqlRes = await admin.graphql(`#graphql
        mutation pageCreate($page: PageCreateInput!) {
          pageCreate(page: $page) {
            page { id handle title }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          page: {
            title: pageTitle,
            handle: pageHandle,
            bodyHtml: pageBodyHtml,
            published: true,
          },
        },
      });

      const rj = await gqlRes.json();
      const userErrors = rj.data?.pageCreate?.userErrors || [];
      if (userErrors.length > 0) throw new Error(userErrors.map(e => e.message).join('; '));
      page = rj.data?.pageCreate?.page;

      // Store page info back to template
      if (page) {
        const pageUrl = `https://${shop.replace('.myshopify.com', '')}.myshopify.com/pages/${page.handle}`;
        await prisma.$executeRawUnsafe(
          `UPDATE combo_templates SET page_id = ?, page_handle = ?, page_url = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`,
          page.id, page.handle, pageUrl, templateId
        );
        return Response.json({
          success: true,
          message: `Template saved & page published!`,
          templateId,
          page: { ...page, url: pageUrl },
        });
      }
    } catch (pageErr) {
      pageError = pageErr.message;
    }

    return Response.json({
      success: true,
      message: pageError
        ? `Template saved! Page creation failed: ${pageError}`
        : 'Template saved!',
      templateId,
      pageError,
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
      {loading ? '…' : '✦ AI'}
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
    if (presetType) return { ...DEFAULT_SETTINGS, selectedLayout: presetType, displayType: presetType === 'velocity' ? 'carousel' : 'grid' };
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
      const pageUrl = fetcher.data.page?.url;
      showToast(pageUrl ? `${msg} → /pages/${fetcher.data.page?.handle}` : msg);
      if (pageUrl) setPageUrl(pageUrl);
    } else {
      showToast('Error: ' + (fetcher.data.error || 'Save failed'));
    }
  }, [fetcher.data, showToast]);

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
      showToast(`✦ AI generated ${field}`);
    } catch {
      showToast('AI generation failed — try again');
    } finally {
      setAiLoading(null);
    }
  }, [update, showToast]);

  const handleSave = useCallback(() => {
    fetcher.submit(
      JSON.stringify({ ...settings, name: pageTitle, pageTitle, pageHandle }),
      { method: 'POST', encType: 'application/json' }
    );
    setSaveModalOpen(false);
    showToast('Saving template…');
  }, [settings, pageTitle, pageHandle, fetcher, showToast]);

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
            <Text variant="headingMd" as="h2">Layout Type</Text>
            <BlockStack gap="200">
              {LAYOUTS.map(l => (
                <div
                  key={l.id}
                  onClick={() => update('selectedLayout', l.id)}
                  style={{
                    padding: '12px', borderRadius: '10px', cursor: 'pointer',
                    border: `2px solid ${settings.selectedLayout === l.id ? '#667eea' : '#e5e7eb'}`,
                    background: settings.selectedLayout === l.id ? 'rgba(102,126,234,0.06)' : '#fff',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '20px', lineHeight: 1 }}>{l.icon}</span>
                    <div>
                      <Text variant="bodySm" as="p" fontWeight="semibold">{l.label}</Text>
                      <Text variant="bodyXs" as="p" tone="subdued">{l.description}</Text>
                    </div>
                  </div>
                </div>
              ))}
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
            <Text variant="bodyXs" as="p" tone="subdued">Click any ✦ AI button next to content fields to generate copy with AI</Text>
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
                  }}>Loading…</div>
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
                        : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '24px' }}>◫</div>
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
                  : '← Select collections to preview products'}
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
                  style={{
                    padding: '7px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: '500',
                    background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0',
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  ↗ View Live Page
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
          content: fetcher.state !== 'idle' ? 'Publishing…' : 'Save & Publish',
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
                  ✓ Page is live: /pages/{fetcher.data?.page?.handle || pageHandle}
                </Text>
                <a href={pageUrl} target="_blank" rel="noreferrer"
                  style={{ fontSize: '12px', color: '#059669', fontWeight: '600' }}>
                  View →
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
