import { useState, useCallback } from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import {
  Card, BlockStack, Text, Button, Badge, Icon,
  InlineGrid,
} from '@shopify/polaris';
import { ProductIcon } from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';

// ─── The 3 mandatory templates ────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'fmcg',
    type: 'fmcg',
    name: 'FMCG Quick Commerce',
    tagline: 'Instamart-style grocery layout',
    badge: 'Recommended',
    badgeTone: 'success',
    accentColor: '#2d8c4e',
    description: 'Category sidebar + product grid with +/- quantity controls. Customers add items from multiple categories and checkout in one go.',
    features: ['Category sidebar navigation', 'Multi-collection support', 'Quantity +/- controls', 'Live cart total', 'Checkout button'],
    preview: 'fmcg',
  },
  {
    id: 'tabs',
    type: 'tabs',
    name: 'Tab Collections',
    tagline: 'Switch between collections via tabs',
    badge: 'Popular',
    badgeTone: 'info',
    accentColor: '#667eea',
    description: 'Scrollable tab bar at the top. Each tab shows a different collection. Customers browse and add from any tab.',
    features: ['Horizontal scrollable tabs', 'One tab per collection', 'Cart persists across tabs', 'Collection product count', 'Checkout button'],
    preview: 'tabs',
  },
  {
    id: 'single',
    type: 'single',
    name: 'Single Collection',
    tagline: 'All products from one collection',
    badge: 'Simple',
    badgeTone: 'warning',
    accentColor: '#f59e0b',
    description: 'Shows every product from a chosen collection in a clean grid. A sticky checkout bar slides up when items are added.',
    features: ['Clean product grid', 'Single collection focus', 'Sticky checkout bar', 'Image-first cards', 'Direct to checkout'],
    preview: 'single',
  },
];

// ─── CSS-drawn template preview cards ─────────────────────────────────────────

function FMCGPreview({ color }) {
  return (
    <div style={{ width: '100%', height: '130px', background: '#f9fafb', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: color, height: '24px', display: 'flex', alignItems: 'center', padding: '0 8px', gap: '4px' }}>
        <div style={{ width: '40px', height: '6px', background: 'rgba(255,255,255,.7)', borderRadius: '3px' }} />
        <div style={{ marginLeft: 'auto', width: '30px', height: '6px', background: 'rgba(255,255,255,.5)', borderRadius: '3px' }} />
      </div>
      <div style={{ display: 'flex', flex: 1, gap: '4px', padding: '4px' }}>
        <div style={{ width: '36px', background: '#e5e7eb', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '3px', padding: '3px' }}>
          {[color, '#e5e7eb', '#e5e7eb', '#e5e7eb'].map((bg, i) => (
            <div key={i} style={{ height: '14px', background: bg, borderRadius: '2px', opacity: i === 0 ? 1 : 0.5 }} />
          ))}
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: '4px', border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ height: '24px', background: '#f3f4f6' }} />
              <div style={{ padding: '2px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <div style={{ height: '3px', background: '#d1d5db', borderRadius: '1px' }} />
                <div style={{ height: '4px', background: color, borderRadius: '1px', width: '60%' }} />
                <div style={{ height: '5px', background: color, borderRadius: '2px', marginTop: '1px' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabsPreview({ color }) {
  return (
    <div style={{ width: '100%', height: '130px', background: '#f9fafb', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#fff', borderBottom: '2px solid #e5e7eb', display: 'flex', gap: '2px', padding: '6px 6px 0' }}>
        {['Tab 1', 'Tab 2', 'Tab 3'].map((t, i) => (
          <div key={t} style={{
            padding: '4px 8px', borderRadius: '4px 4px 0 0', fontSize: '9px', fontWeight: '600',
            background: i === 0 ? color : 'transparent',
            color: i === 0 ? '#fff' : '#9ca3af',
            borderBottom: i === 0 ? `2px solid ${color}` : 'none',
            marginBottom: '-2px',
          }}>{t}</div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', padding: '6px' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: '4px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ height: '30px', background: '#f3f4f6' }} />
            <div style={{ padding: '3px' }}>
              <div style={{ height: '3px', background: '#d1d5db', borderRadius: '1px', marginBottom: '2px' }} />
              <div style={{ height: '5px', background: color, borderRadius: '2px' }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: color, height: '16px', display: 'flex', alignItems: 'center', padding: '0 6px', justifyContent: 'space-between' }}>
        <div style={{ width: '40px', height: '5px', background: 'rgba(255,255,255,.7)', borderRadius: '2px' }} />
        <div style={{ width: '50px', height: '8px', background: 'rgba(255,255,255,.9)', borderRadius: '3px' }} />
      </div>
    </div>
  );
}

function SinglePreview({ color }) {
  return (
    <div style={{ width: '100%', height: '130px', background: '#f9fafb', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 8px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ width: '60px', height: '7px', background: '#374151', borderRadius: '3px' }} />
        <div style={{ width: '35px', height: '5px', background: '#9ca3af', borderRadius: '2px' }} />
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', padding: '0 6px' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ height: '34px', background: `${color}20` }} />
            <div style={{ padding: '3px' }}>
              <div style={{ height: '3px', background: '#d1d5db', borderRadius: '1px', marginBottom: '2px' }} />
              <div style={{ height: '3px', background: color, borderRadius: '1px', width: '50%', marginBottom: '2px' }} />
              <div style={{ height: '6px', background: color, borderRadius: '2px' }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: color, height: '14px', margin: '4px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 6px' }}>
        <div style={{ width: '55px', height: '7px', background: 'rgba(255,255,255,.9)', borderRadius: '3px' }} />
      </div>
    </div>
  );
}

const PREVIEW_COMPONENTS = { fmcg: FMCGPreview, tabs: TabsPreview, single: SinglePreview };

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let savedTemplates = [];
  try {
    const { default: prisma } = await import('../db.server');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS combo_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT, shop_domain TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '', slug TEXT, template_type TEXT DEFAULT 'grid',
        status TEXT DEFAULT 'draft', is_active INTEGER DEFAULT 1, version INTEGER DEFAULT 1,
        description TEXT, features TEXT, customization_data TEXT,
        page_id TEXT, page_handle TEXT, page_url TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, name, template_type, status, page_handle, page_url, updated_at
       FROM combo_templates WHERE shop_domain = ? ORDER BY updated_at DESC`,
      shop
    );
    savedTemplates = Array.isArray(rows) ? rows : [];
  } catch {}

  return { savedTemplates };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get('action');
  const templateId = formData.get('templateId');
  const { default: prisma } = await import('../db.server');

  if (actionType === 'delete' && templateId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM combo_templates WHERE id = ? AND shop_domain = ?`,
      Number(templateId), shop
    );
    return { success: true };
  }
  return { success: false };
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppBundlesTemplates() {
  const { savedTemplates } = useLoaderData();
  const navigate = useNavigate();

  return (
    <BlockStack gap="500">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <BlockStack gap="100">
          <Text variant="heading2xl" as="h1">Template Library</Text>
          <Text variant="bodyMd" as="p" tone="subdued">
            Choose one of the 3 ready-made templates below — each is fully functional with add-to-cart and checkout.
          </Text>
        </BlockStack>
      </div>

      {/* 3 Mandatory Templates */}
      <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
        {TEMPLATES.map(tpl => {
          const Preview = PREVIEW_COMPONENTS[tpl.preview];
          return (
            <div
              key={tpl.id}
              style={{
                borderRadius: '14px', overflow: 'hidden',
                border: '1px solid #e5e7eb',
                background: '#fff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                display: 'flex', flexDirection: 'column',
              }}
            >
              {/* Preview area */}
              <div style={{ padding: '12px', background: `${tpl.accentColor}08` }}>
                <Preview color={tpl.accentColor} />
              </div>

              {/* Info */}
              <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <BlockStack gap="50">
                    <Text variant="headingSm" as="h3" fontWeight="bold">{tpl.name}</Text>
                    <Text variant="bodyXs" as="p" tone="subdued">{tpl.tagline}</Text>
                  </BlockStack>
                  <Badge tone={tpl.badgeTone}>{tpl.badge}</Badge>
                </div>

                <Text variant="bodyXs" as="p" tone="subdued">{tpl.description}</Text>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {tpl.features.map(f => (
                    <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: `${tpl.accentColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="8" height="7" viewBox="0 0 8 7" fill="none">
                          <path d="M1 3l2 2 4-4" stroke={tpl.accentColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <Text variant="bodyXs" as="span" tone="subdued">{f}</Text>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 'auto' }}>
                  <Button
                    onClick={() => navigate(`/app/bundles/customize?template=${tpl.type}`)}
                    variant="primary"
                    fullWidth
                  >
                    Use This Template
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </InlineGrid>

      {/* Saved templates */}
      {savedTemplates.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Your Published Pages</Text>
            <div style={{ borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '12px', padding: '8px 14px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Template Name', 'Type', 'Status', 'Actions'].map(h => (
                  <Text key={h} variant="bodyXs" as="span" tone="subdued" fontWeight="semibold">{h.toUpperCase()}</Text>
                ))}
              </div>
              {savedTemplates.map((tpl, i) => (
                <div key={tpl.id} style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '12px',
                  padding: '12px 14px', alignItems: 'center',
                  borderBottom: i < savedTemplates.length - 1 ? '1px solid #f3f4f6' : 'none',
                  background: '#fff',
                }}>
                  <BlockStack gap="50">
                    <Text variant="bodySm" as="p" fontWeight="semibold">{tpl.name}</Text>
                    {tpl.page_handle && <Text variant="bodyXs" as="p" tone="subdued">/pages/{tpl.page_handle}</Text>}
                  </BlockStack>
                  <Badge>{tpl.template_type}</Badge>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: tpl.status === 'active' ? '#10b981' : '#f59e0b',
                    }} />
                    <Text variant="bodyXs" as="span" style={{ textTransform: 'capitalize' }}>{tpl.status}</Text>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <Button size="slim" onClick={() => navigate(`/app/bundles/customize?id=${tpl.id}`)}>
                      Edit
                    </Button>
                    {tpl.page_url && (
                      <a href={tpl.page_url} target="_blank" rel="noreferrer" title="View live page"
                        style={{
                          width: '28px', height: '28px', borderRadius: '5px',
                          background: '#f0fdf4', border: '1px solid #bbf7d0',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                          <path d="M10 4C5.5 4 2 10 2 10s3.5 6 8 6 8-6 8-6-3.5-6-8-6z" stroke="#059669" strokeWidth="1.5" />
                          <circle cx="10" cy="10" r="2.5" stroke="#059669" strokeWidth="1.5" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>
      )}

    </BlockStack>
  );
}
