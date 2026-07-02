import { useState } from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import {
  Page, Card, BlockStack, InlineStack, InlineGrid, Text, Icon,
} from '@shopify/polaris';
import {
  PageIcon, StoreIcon, ChartVerticalIcon, CashDollarIcon,
  WandIcon, CheckCircleIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { BundleStackMock } from '../components/feature/BundleStackMock';
import BrixBar from '../components/ai-agent/BrixBar';
import TemplateManager from '../components/bundles/TemplateManager';

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let templateCount = 0;
  let publishedCount = 0;
  let publishedPages = [];
  let templates = [];
  let discounts = [];
  let totalConversions = 0;
  let totalRevenue = 0;

  try {
    const db = getDb();
    const [allRows] = await db.execute(
      `SELECT id, name, is_active, page_handle, customization_data, created_at, updated_at
       FROM combo_templates WHERE shop_domain = ? ORDER BY updated_at DESC`,
      [shop]
    );

    templates = (Array.isArray(allRows) ? allRows : []).map(row => {
      let config = {};
      try { config = JSON.parse(row.customization_data || '{}'); } catch { /* keep {} */ }
      return {
        id: row.id,
        title: row.name || 'Untitled',
        active: Boolean(row.is_active),
        page_url: row.page_handle || null,
        page_handle: row.page_handle || null,
        config,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
      };
    });

    templateCount = templates.filter(t => t.active).length;
    publishedPages = templates.filter(t => t.page_url);
    publishedCount = publishedPages.length;

    const [convRows] = await db.execute(
      `SELECT COUNT(*) AS n, COALESCE(SUM(revenue), 0) AS total
       FROM combo_analytics WHERE shop_domain = ? AND event_type = 'order'`,
      [shop]
    );
    totalConversions = Number(convRows[0]?.n || 0);
    totalRevenue = parseFloat(convRows[0]?.total || 0);
  } catch (e) {
    console.error('[bundles index loader]', e.message);
  }

  try {
    const res = await admin.graphql(`
      query DiscountList {
        discountNodes(first: 100, reverse: true) {
          edges {
            node {
              id
              discount {
                ... on DiscountCodeBasic {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                }
                ... on DiscountCodeBxgy {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
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
    const json = await res.json();
    discounts = (json.data?.discountNodes?.edges || [])
      .map(({ node }) => {
        const d = node.discount;
        if (!d) return null;
        const code = d.codes?.edges?.[0]?.node?.code || '';
        if (!code || d.status !== 'ACTIVE') return null;
        return { id: node.id, code, title: d.title || code };
      })
      .filter(Boolean);
  } catch { /* silent */ }

  return { templateCount, publishedCount, publishedPages, templates, shop, discounts, totalConversions, totalRevenue };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get('intent');
  const id = formData.get('id');

  try {
    const db = getDb();
    if (intent === 'delete' && id) {
      await db.execute(
        'DELETE FROM combo_templates WHERE id = ? AND shop_domain = ?',
        [Number(id), shop]
      );
      return { success: true, message: 'Template deleted.' };
    }
    if (intent === 'toggle_active' && id) {
      const active = formData.get('active') === 'true' ? 1 : 0;
      await db.execute(
        'UPDATE combo_templates SET is_active = ? WHERE id = ? AND shop_domain = ?',
        [active, Number(id), shop]
      );
      return { success: true, message: active ? 'Template activated.' : 'Template deactivated.' };
    }
  } catch (e) {
    console.error('[bundles index action]', e.message);
    return { success: false, error: e.message };
  }
  return { success: true, message: 'Done.' };
};

export default function AppBundlesIndex() {
  const { templateCount, publishedCount, templates, shop, totalConversions, totalRevenue } = useLoaderData();
  const navigate = useNavigate();

  const stats = [
    { label: 'Active Templates', value: String(templateCount),  icon: PageIcon,          accent: '#1a9de0', soft: '#eef0ff' },
    { label: 'Published Pages',  value: String(publishedCount), icon: StoreIcon,         accent: '#059669', soft: '#e7f8f0' },
    { label: 'Conversions',      value: String(totalConversions), icon: ChartVerticalIcon, accent: '#1a9de0', soft: '#d4f1fe' },
    { label: 'Bundle Revenue',   value: `$${totalRevenue.toFixed(2)}`, icon: CashDollarIcon, accent: '#d97706', soft: '#fdf2e3' },
  ];

  const steps = [
    { label: 'Pick a template',      sub: 'Choose a guided, tabbed, or grid layout',    href: '/app/bundles',          done: templateCount > 0 },
    { label: 'Customize your combo', sub: 'Set collections, content, and styling',       href: '/app/bundles/customize', done: false },
    { label: 'Publish a page',       sub: 'Save & publish to go live on your store',     href: '/app/bundles/customize', done: publishedCount > 0 },
  ];
  const doneCount = steps.filter(s => s.done).length;

  return (
    <Page fullWidth title="Dashboard">
      <style>{`
.bac-hero{position:relative;overflow:hidden;border-radius:16px;padding:28px 32px;background:linear-gradient(120deg,#1a9de0 0%,#17c4a0 55%,#2ecc71 100%);color:#fff;box-shadow:0 12px 30px rgba(26,157,224,.28)}
.bac-hero::after{content:'';position:absolute;right:-60px;top:-60px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.18) 0%,rgba(255,255,255,0) 70%)}
.bac-hero::before{content:'';position:absolute;right:120px;bottom:-80px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.12) 0%,rgba(255,255,255,0) 70%)}
.bac-hero-inner{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.bac-hero-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;background:rgba(255,255,255,.18);padding:5px 12px;border-radius:999px;backdrop-filter:blur(4px)}
.bac-hero-title{font-size:26px;font-weight:800;line-height:1.15;margin:14px 0 6px;letter-spacing:-.4px}
.bac-hero-sub{font-size:14px;line-height:1.5;color:rgba(255,255,255,.9);max-width:520px}
.bac-hero-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
.bac-hero-btn{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;padding:10px 18px;border-radius:10px;cursor:pointer;border:none;transition:transform .12s ease,box-shadow .12s ease}
.bac-hero-btn:hover{transform:translateY(-1px)}
.bac-hero-btn--primary{background:#fff;color:#1a9de0;box-shadow:0 6px 16px rgba(0,0,0,.18)}
.bac-stat{display:flex;align-items:center;gap:14px}
.bac-stat-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.bac-stat-icon svg{width:22px;height:22px}
.bac-row{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:10px;background:#fafbfb;border:1px solid #e1e3e5;cursor:pointer;transition:background .12s ease,border-color .12s ease}
.bac-row:hover{background:#f1f3f9;border-color:#d6d9ef}
.bac-row-icon{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#eef0ff}
.bac-row-icon svg{width:18px;height:18px}
.bac-step{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid #e1e3e5;cursor:pointer;transition:background .12s ease}
.bac-step:hover{background:#fafbfb}
.bac-step-dot{width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-top:1px}
.bac-step-dot svg{width:22px;height:22px}
.bac-step-num{width:22px;height:22px;border-radius:50%;border:2px solid #c9cdd6;color:#8c9196;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.bac-progress-track{height:8px;border-radius:999px;background:#eceef2;overflow:hidden}
.bac-progress-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#1a9de0,#2ecc71);transition:width .3s ease}
      `}</style>

      <BlockStack gap="500">

        {/* Hero */}
        <div className="bac-hero">
          <div className="bac-hero-inner">
            <div>
              <span className="bac-hero-pill">Bundle Builder</span>
              <div className="bac-hero-title">Build bundle pages that lift order value</div>
              <div className="bac-hero-sub">
                Create guided, tabbed, or grid bundle pages — no theme code required.
              </div>
              <div className="bac-hero-actions">
                <button className="bac-hero-btn bac-hero-btn--primary" onClick={() => navigate('/app/bundles/customize')}>
                  Create a bundle
                </button>
              </div>
            </div>
            <div aria-hidden="true"><BundleStackMock /></div>
          </div>
        </div>

        <BrixBar size="md" floating />

        {/* Stats row */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          {stats.map(s => (
            <Card key={s.label}>
              <div className="bac-stat">
                <div className="bac-stat-icon" style={{ background: s.soft, color: s.accent }}>
                  <Icon source={s.icon} />
                </div>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                  <Text as="p" variant="headingLg">{s.value}</Text>
                </BlockStack>
              </div>
            </Card>
          ))}
        </InlineGrid>

        {/* Template Manager */}
        <TemplateManager />

        {/* Getting Started + Quick Actions */}
        <InlineGrid columns={{ xs: 1, md: '1fr 1fr' }} gap="400">

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Getting Started</Text>
                <Text as="span" variant="bodySm" tone="subdued">{doneCount} of {steps.length}</Text>
              </InlineStack>
              <div className="bac-progress-track">
                <div className="bac-progress-fill" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
              <BlockStack gap="150">
                {steps.map((step, i) => (
                  <div key={step.label} className="bac-step" onClick={() => navigate(step.href)}>
                    {step.done ? (
                      <div className="bac-step-dot" style={{ color: '#059669' }}><Icon source={CheckCircleIcon} /></div>
                    ) : (
                      <div className="bac-step-num">{i + 1}</div>
                    )}
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm" fontWeight="semibold">{step.label}</Text>
                      <Text as="p" variant="bodyXs" tone="subdued">{step.sub}</Text>
                    </BlockStack>
                  </div>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Quick Actions</Text>
              <BlockStack gap="150">
                {[
                  { label: 'Template Library',  sub: 'Browse preset layouts',      href: '/app/bundles',           icon: PageIcon,          tint: '#eef0ff', accent: '#1a9de0' },
                  { label: 'Customize Builder', sub: 'Design your bundle page',    href: '/app/bundles/customize', icon: WandIcon,          tint: '#edfaf4', accent: '#2ecc71' },
                  { label: 'Analytics',         sub: 'View impressions & revenue', href: '/app/analytics',         icon: ChartVerticalIcon, tint: '#d4f1fe', accent: '#1a9de0' },
                ].map(item => (
                  <div key={item.label} className="bac-row" onClick={() => navigate(item.href)}>
                    <InlineStack gap="300" blockAlign="center">
                      <div className="bac-row-icon" style={{ background: item.tint, color: item.accent }}>
                        <Icon source={item.icon} />
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">{item.label}</Text>
                        <Text as="p" variant="bodyXs" tone="subdued">{item.sub}</Text>
                      </div>
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="subdued">›</Text>
                  </div>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>

        </InlineGrid>

      </BlockStack>
    </Page>
  );
}
