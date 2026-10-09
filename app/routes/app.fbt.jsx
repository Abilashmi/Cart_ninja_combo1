/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
/**
 * Frequently Bought Together (v2) settings page.
 *
 * Settings: fbt_widget.config_v2 via app/services/fbt-v2.server.js. The
 * widget itself: extensions/cart-drawer/assets/brix_fbt.js (built from
 * app/storefront/fbt-runtime.js + app/utils/fbt-core.shared.js), and the
 * preview here draws the same markup.
 */
import { useEffect, useMemo, useState } from 'react';
import { useFetcher, useLoaderData, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Badge, Banner, BlockStack, Box, Button, Card, Checkbox, InlineGrid, InlineStack, Layout, Page, Select, Text, TextField,
} from '@shopify/polaris';
import BrixBar from '../components/ai-agent/BrixBar';
import { SliderField } from '../components/shared/SliderField';
import FbtRules from '../components/fbt/FbtRules';
import FbtPreview from '../components/fbt/FbtPreview';
import { usePlan } from '../components/PlanContext';
import { authenticate } from '../shopify.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { canPublishFeature } from '../config/plans';
import { loadFbtV2, saveFbtV2 } from '../services/fbt-v2.server';
import { buildFbtPairs } from '../services/fbt-pairs.server';
import { normalizeConfig, DEFAULT_THEME } from '../utils/fbt-core.shared.js';
import { withTimeout } from '../utils/with-timeout';

const SHOPIFY_CALL_TIMEOUT_MS = 20_000;
const cents = (amount) => Math.round((Number(amount) || 0) * 100);

// Sample products for the preview, shaped like /products/<handle>.js.
async function loadSamples(admin) {
  const res = await withTimeout(admin.graphql(`#graphql
    query FbtSamples {
      shop { currencyFormats { moneyFormat } }
      products(first: 8, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id handle title featuredImage { url }
          variants(first: 6) { nodes { id title price compareAtPrice availableForSale } }
        }
      }
    }`), SHOPIFY_CALL_TIMEOUT_MS, null);
  if (!res) return { samples: [], moneyFormat: '{{amount}}' };
  const { data } = await res.json();
  return {
    moneyFormat: String(data?.shop?.currencyFormats?.moneyFormat || '{{amount}}').replace(/<[^>]*>/g, ''),
    samples: (data?.products?.nodes || []).map((p) => ({
      id: String(p.id).split('/').pop(),
      handle: p.handle,
      title: p.title,
      featured_image: p.featuredImage?.url || '',
      variants: (p.variants?.nodes || []).map((v) => ({
        id: String(v.id).split('/').pop(),
        title: v.title,
        public_title: v.title === 'Default Title' ? null : v.title,
        price: cents(v.price),
        compare_at_price: v.compareAtPrice ? cents(v.compareAtPrice) : null,
        available: v.availableForSale !== false,
      })),
    })),
  };
}

// Is the FBT app embed / block on in the live theme? Optimistic on any error.
async function embedEnabled(shop, accessToken) {
  try {
    const themes = await fetch(`https://${shop}/admin/api/2024-04/themes.json?role=main`, { headers: { 'X-Shopify-Access-Token': accessToken } });
    if (!themes.ok) return true;
    const main = (await themes.json()).themes?.[0];
    if (!main) return true;
    const asset = await fetch(`https://${shop}/admin/api/2024-04/themes/${main.id}/assets.json?asset[key]=config/settings_data.json`, { headers: { 'X-Shopify-Access-Token': accessToken } });
    if (!asset.ok) return true;
    const current = JSON.parse((await asset.json()).asset?.value || '{}').current || {};
    const blocks = [];
    Object.values(current.sections || {}).forEach((s) => Object.values(s?.blocks || {}).forEach((b) => blocks.push(b)));
    Object.values(current.blocks || {}).forEach((b) => blocks.push(b));
    return blocks.some((b) => !b.disabled && String(b.type || '').toLowerCase().includes('fbt'));
  } catch {
    return true;
  }
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const [stored, preview, embed] = await Promise.all([
    loadFbtV2(shop).catch((e) => { console.error('[FBT] load:', e.message); return { config: normalizeConfig({}), saved: false, enabled: false, loadError: true }; }),
    loadSamples(admin).catch(() => ({ samples: [], moneyFormat: '{{amount}}' })),
    embedEnabled(shop, session.accessToken),
  ]);
  return { shop, ...stored, ...preview, embedEnabled: embed };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  try {
    const publishable = canPublishFeature(await getShopPlan(shop), 'fbt');
    if (body.intent === 'build_pairs') {
      const built = await buildFbtPairs(admin, shop);
      const { config } = await saveFbtV2(shop, {}, { pairs: built.pairs });
      return { success: true, intent: 'build_pairs', config, summary: { productsWithPairs: built.productsWithPairs, productsChecked: built.productsChecked, truncated: built.truncated } };
    }
    const enabled = body.enabled === undefined ? undefined : Boolean(body.enabled) && publishable;
    const { config, enabled: on } = await saveFbtV2(shop, body.intent === 'toggle' ? {} : body.config, { enabled });
    return { success: true, intent: body.intent || 'save', config, enabled: on };
  } catch (e) {
    console.error('[FBT] save:', e.message);
    return { success: false, error: 'Could not save. Please try again.' };
  }
};

const PLACEMENTS = [
  { label: 'Below Add to cart', value: 'below_cart' },
  { label: 'Above Add to cart', value: 'above_cart' },
  { label: 'Where I put the FBT block in the theme editor', value: 'custom' },
];
const THEME_FIELDS = [
  ['bg', 'Background'], ['text', 'Text'], ['price', 'Price'], ['button', 'Button'], ['buttonText', 'Button text'], ['border', 'Border'],
];

function StyleCard({ id, title, text, picture, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      style={{
        textAlign: 'left', cursor: 'pointer', padding: 12, borderRadius: 12, background: selected ? '#f1f8f5' : '#fff',
        border: `2px solid ${selected ? '#008060' : '#e1e3e5'}`, display: 'flex', flexDirection: 'column', gap: 8, font: 'inherit',
      }}
    >
      <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.35, color: '#4a4a4a', background: '#f6f6f7', padding: 8, borderRadius: 8, whiteSpace: 'pre' }}>{picture}</pre>
      <Text as="span" variant="headingSm">{title}</Text>
      <Text as="span" variant="bodySm" tone="subdued">{text}</Text>
    </button>
  );
}

function ColorRow({ label, value, onChange }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} style={{ width: 32, height: 32, border: '1px solid #c9cccf', borderRadius: 6, padding: 0, background: 'none' }} />
      <div style={{ flex: 1 }}>
        <TextField label={label} labelHidden value={value} onChange={onChange} autoComplete="off" monospaced prefix={label} />
      </div>
    </InlineStack>
  );
}

export default function FbtPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const { canPublishFeature: canPublish } = usePlan();
  const publishable = canPublish('fbt');
  const [saved, setSaved] = useState(() => normalizeConfig(data.config));
  const [config, setConfig] = useState(saved);
  const [enabled, setEnabled] = useState(data.enabled && publishable);
  const [notice, setNotice] = useState(null);

  const dirty = useMemo(() => JSON.stringify({ ...config, pairs: null }) !== JSON.stringify({ ...saved, pairs: null }), [config, saved]);
  const set = (patch) => setConfig((c) => normalizeConfig({ ...c, ...patch }));
  const setTheme = (patch) => set({ theme: { ...config.theme, ...patch } });
  const busy = fetcher.state !== 'idle';
  const busyIntent = busy ? fetcher.json?.intent : null;

  useEffect(() => {
    const d = fetcher.data;
    if (!d) return;
    if (!d.success) { setNotice({ tone: 'critical', text: d.error }); return; }
    const next = normalizeConfig(d.config);
    if (d.intent === 'build_pairs') {
      setSaved((s) => ({ ...s, pairs: next.pairs, pairsUpdatedAt: next.pairsUpdatedAt }));
      setConfig((c) => ({ ...c, pairs: next.pairs, pairsUpdatedAt: next.pairsUpdatedAt }));
      const s = d.summary;
      setNotice({ tone: s.productsWithPairs ? 'success' : 'info', text: s.productsWithPairs
        ? `Pairs built from real orders for ${s.productsWithPairs} of ${s.productsChecked} products${s.truncated ? ' (the first 300 products)' : ''}.`
        : 'No products have been bought together in your orders yet. Rules and Shopify recommendations will be used until they are.' });
      return;
    }
    setSaved(next);
    if (d.intent === 'toggle') setConfig((c) => ({ ...c }));
    else setConfig(next);
    if (typeof d.enabled === 'boolean') setEnabled(d.enabled);
    setNotice({ tone: 'success', text: d.intent === 'toggle' ? (d.enabled ? 'FBT is on.' : 'FBT is off.') : 'Saved.' });
  }, [fetcher.data]);

  const submit = (payload) => fetcher.submit(JSON.stringify(payload), { method: 'post', encType: 'application/json' });
  const save = () => submit({ intent: 'save', config: { ...config, pairs: undefined } });
  const toggle = () => submit({ intent: 'toggle', enabled: !enabled });
  const pairCount = Object.keys(config.pairs || {}).length;

  return (
    <Page
      title="Frequently Bought Together"
      subtitle="Offer products that go together on each product page."
      primaryAction={{ content: 'Save', onAction: save, disabled: !dirty || busy, loading: busyIntent === 'save' }}
      secondaryActions={dirty ? [{ content: 'Discard', onAction: () => setConfig(saved) }] : []}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {notice && <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Banner>}
            {data.loadError && <Banner tone="critical">FBT settings could not be loaded. Reload the page to try again.</Banner>}

            <Card>
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">FBT on product pages</Text>
                    <Badge tone={enabled ? 'success' : undefined}>{enabled ? 'On' : 'Off'}</Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {publishable ? 'Shoppers see your offer next to Add to cart.' : 'Frequently Bought Together goes live on the Starter plan and above.'}
                  </Text>
                </BlockStack>
                <Button onClick={toggle} disabled={!publishable || busy} loading={busyIntent === 'toggle'}>{enabled ? 'Turn off' : 'Turn on'}</Button>
              </InlineStack>
              {publishable && !data.embedEnabled && (
                <Box paddingBlockStart="300">
                  <Banner tone="warning" action={{ content: 'Open theme editor', url: `https://${data.shop}/admin/themes/current/editor?context=apps`, target: '_blank' }}>
                    Turn on the <b>FBT Widget</b> app embed in your theme so it shows on product pages.
                  </Banner>
                </Box>
              )}
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">What to show</Text>
                <Text as="p" tone="subdued">Decide exactly what shows where: for picked products, or for every product in a collection.</Text>
                <FbtRules rules={config.rules} onChange={(rules) => set({ rules })} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Automatic pairs</Text>
                <Text as="p" tone="subdued">Fill in products that have no rule, from what your shoppers really do.</Text>
                <Checkbox
                  label="Bought together in your orders"
                  helpText={pairCount
                    ? `${pairCount} products have pairs${config.pairsUpdatedAt ? `, updated ${new Date(config.pairsUpdatedAt).toLocaleDateString()}` : ''}.`
                    : 'Build them from your orders below.'}
                  checked={config.sources.orders}
                  onChange={(v) => set({ sources: { ...config.sources, orders: v } })}
                />
                <Checkbox
                  label="Shopify's recommendations"
                  helpText="Shopify's own complementary products (set in the Search & Discovery app), then related products. Used last."
                  checked={config.sources.shopify}
                  onChange={(v) => set({ sources: { ...config.sources, shopify: v } })}
                />
                <InlineStack gap="200" blockAlign="center">
                  <Button onClick={() => submit({ intent: 'build_pairs' })} loading={busyIntent === 'build_pairs'} disabled={busy}>Build pairs now</Button>
                  <Text as="span" variant="bodySm" tone="subdued">Reads your orders; takes a few seconds.</Text>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Design</Text>
                <InlineGrid columns={2} gap="300">
                  <StyleCard
                    id="bundle" title="Bundle (Amazon style)" selected={config.style === 'bundle'} onSelect={(style) => set({ style })}
                    text="Pictures joined by +, tick what to buy, one button adds them all."
                    picture={'[img] + [img] + [img]\n☑ This item  ☑ Shorts\nTotal ₹1,197\n[ Add all 3 to cart ]'}
                  />
                  <StyleCard
                    id="cards" title="Cards" selected={config.style === 'cards'} onSelect={(style) => set({ style })}
                    text="Each product has its own Add to cart button."
                    picture={'[card] [card] [card]\n [Add]  [Add]  [Add]\n\n[ Add all 3 to cart ]'}
                  />
                </InlineGrid>
                <TextField label="Heading" value={config.title} onChange={(title) => set({ title })} autoComplete="off" maxLength={80} placeholder="Frequently bought together" />
                <SliderField label="Products to show" value={config.maxItems} min={1} max={6} onChange={(maxItems) => set({ maxItems })} />
                {config.style === 'bundle' ? (
                  <>
                    <Checkbox label='Show the product being viewed first ("This item")' checked={config.showCurrent} onChange={(showCurrent) => set({ showCurrent })} />
                    <Checkbox label="Tick the offered products to start with" checked={config.preselect} onChange={(preselect) => set({ preselect })} />
                  </>
                ) : (
                  <Checkbox label='"Add all to cart" button under the cards' checked={config.cardsAddAll} onChange={(cardsAddAll) => set({ cardsAddAll })} />
                )}
                <Select label="Where it goes" options={PLACEMENTS} value={config.placement} onChange={(placement) => set({ placement })} />
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingSm">Colours</Text>
                    <Button variant="plain" onClick={() => set({ theme: { ...DEFAULT_THEME } })}>Reset</Button>
                  </InlineStack>
                  <InlineGrid columns={2} gap="200">
                    {THEME_FIELDS.map(([key, label]) => <ColorRow key={key} label={label} value={config.theme[key]} onChange={(v) => setTheme({ [key]: v })} />)}
                  </InlineGrid>
                  <SliderField label="Corner rounding" value={config.theme.radius} min={0} max={32} suffix="px" onChange={(radius) => setTheme({ radius })} />
                </BlockStack>
              </BlockStack>
            </Card>
            <Box minHeight="80px" />
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <div style={{ position: 'sticky', top: 16 }}>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Live preview</Text>
                  <Text as="span" variant="bodySm" tone="subdued">Sample products</Text>
                </InlineStack>
                <FbtPreview config={config} samples={data.samples} moneyFormat={data.moneyFormat} />
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
      <BrixBar size="md" floating />
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
