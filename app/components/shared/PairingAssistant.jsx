import { useEffect, useMemo, useState } from 'react';
import { useFetcher } from 'react-router';
import { BlockStack, InlineStack, Text, TextField, Button, ButtonGroup, Banner, Badge, Checkbox, Select, Spinner, Thumbnail } from '@shopify/polaris';
import { ImageIcon } from '@shopify/polaris-icons';
import { ruleKey, partnersOf, numericId } from '../../utils/pairing.shared';

// "Describe in words" + "From past orders" — shared by the FBT page's rule
// builder and the Cart Editor's Upsell rules. Only suggests: the chosen rules
// go to onAddRules([{ name, allProducts, triggerProducts, offerProducts }])
// and the page turns them into its own manual rules (its Save publishes).
// existingKeys: Set of ruleKey(triggerIds, offerIds) for rules already there,
// so the same rule is never added twice.

export const PAIRING_EXAMPLES = [
  'Show socks with every jogger',
  'Coffee Mug with Coffee Beans and Milk Frother',
  'For the Summer collection, recommend what customers usually buy with each product',
];

const WINDOWS = [
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 60 days', value: '60' },
  { label: 'Last 90 days', value: '90' },
  { label: 'Last 12 months', value: '365' },
];

const genericKey = (r) => ruleKey(r.allProducts ? [] : r.triggerProducts.map((p) => p.id), r.offerProducts.map((p) => p.id));

function names(list, max = 3) {
  const t = (list || []).map((p) => p.title).filter(Boolean);
  if (t.length <= max) return t.join(', ');
  return `${t.slice(0, max).join(', ')} +${t.length - max} more`;
}

function Thumb({ product }) {
  return <Thumbnail size="small" alt={product?.title || ''} source={product?.image || ImageIcon} />;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function DescribeTab({ existingKeys, onAddRules, maxOffers }) {
  const fetcher = useFetcher();
  const [prompt, setPrompt] = useState('');
  const [picked, setPicked] = useState({});
  const [addedMsg, setAddedMsg] = useState('');
  const loading = fetcher.state !== 'idle';
  const data = fetcher.data?.intent === 'prompt' || fetcher.data?.success === false ? fetcher.data : null;
  const rules = data?.rules || [];

  useEffect(() => {
    const next = {};
    rules.forEach((r, i) => { next[i] = !existingKeys.has(genericKey(r)); });
    setPicked(next);
    setAddedMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const submit = () => {
    if (!prompt.trim()) return;
    fetcher.submit({ intent: 'prompt', prompt, maxOffers }, { method: 'POST', action: '/api/pairing-assistant', encType: 'application/json' });
  };

  const chosen = rules.filter((r, i) => picked[i] && !existingKeys.has(genericKey(r)));

  return (
    <BlockStack gap="300">
      <TextField
        label="Describe what should be recommended with what"
        value={prompt}
        onChange={setPrompt}
        multiline={3}
        autoComplete="off"
        placeholder={'e.g. Show socks with every jogger\nCoffee Mug with Coffee Beans and Milk Frother'}
        helpText="One pairing per line works best. Name products, collections or product types, or ask for what customers usually buy with something."
      />
      <InlineStack gap="150" wrap>
        {PAIRING_EXAMPLES.map((ex) => (
          <Button key={ex} size="micro" variant="tertiary" onClick={() => setPrompt((p) => (p.trim() ? `${p.trim()}\n${ex}` : ex))}>{ex}</Button>
        ))}
      </InlineStack>
      <InlineStack gap="200" blockAlign="center">
        <Button variant="primary" onClick={submit} loading={loading} disabled={!prompt.trim()}>Suggest rules</Button>
        <Text as="span" variant="bodyXs" tone="subdued">Uses 1 AI credit. Nothing is saved until you add rules and Save.</Text>
      </InlineStack>

      {data?.success === false && <Banner tone="critical">{data.error || 'Something went wrong.'}</Banner>}
      {data?.question && !rules.length && <Banner tone="info">{data.question}</Banner>}
      {(data?.warnings || []).length > 0 && (
        <Banner tone="warning">
          <BlockStack gap="100">{data.warnings.map((w, i) => <Text as="p" variant="bodySm" key={i}>{w}</Text>)}</BlockStack>
        </Banner>
      )}

      {rules.length > 0 && (
        <BlockStack gap="200">
          <Text as="h4" variant="headingSm">Suggested rules ({rules.length})</Text>
          {rules.map((r, i) => {
            const dup = existingKeys.has(genericKey(r));
            return (
              <div key={i} style={{ border: '1px solid #e3e5e7', borderRadius: 10, padding: '10px 12px', background: dup ? '#f6f6f7' : '#fff' }}>
                <InlineStack gap="300" blockAlign="start" wrap={false}>
                  <Checkbox label="" labelHidden checked={Boolean(picked[i]) && !dup} disabled={dup} onChange={(v) => setPicked((p) => ({ ...p, [i]: v }))} />
                  <BlockStack gap="100">
                    <InlineStack gap="150" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="semibold">{r.allProducts ? 'Every product' : names(r.triggerProducts)}</Text>
                      {r.basis === 'orders' && <Badge tone="info">From past orders</Badge>}
                      {dup && <Badge>Already added</Badge>}
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="subdued">Recommends: {names(r.offerProducts, 4)}</Text>
                  </BlockStack>
                </InlineStack>
              </div>
            );
          })}
          <InlineStack gap="200" blockAlign="center">
            <Button
              variant="primary"
              disabled={!chosen.length}
              onClick={() => { onAddRules(chosen); setAddedMsg(`${plural(chosen.length, 'rule')} added. Save to publish.`); setPicked({}); }}
            >{chosen.length ? `Add ${plural(chosen.length, 'rule')}` : 'Add rules'}</Button>
            {addedMsg && <Text as="span" variant="bodySm" tone="success">{addedMsg}</Text>}
          </InlineStack>
        </BlockStack>
      )}
    </BlockStack>
  );
}

function OrdersTab({ existingKeys, onAddRules, maxOffers }) {
  const fetcher = useFetcher();
  const [days, setDays] = useState('90');
  const [addedKeys, setAddedKeys] = useState(() => new Set());
  const loading = fetcher.state !== 'idle';
  const data = fetcher.data?.intent === 'orders' || fetcher.data?.success === false ? fetcher.data : null;

  const load = (d = days, fresh = false) => {
    fetcher.submit({ intent: 'orders', days: Number(d), fresh }, { method: 'POST', action: '/api/pairing-assistant', encType: 'application/json' });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const pairs = data?.pairs || [];
  const isKnown = (k) => existingKeys.has(k) || addedKeys.has(k);

  const add = (rules) => {
    const fresh = rules.filter((r) => !isKnown(genericKey(r)));
    if (!fresh.length) return;
    onAddRules(fresh);
    setAddedKeys((prev) => { const s = new Set(prev); fresh.forEach((r) => s.add(genericKey(r))); return s; });
  };
  const oneWay = (from, to) => ({ name: from.title, allProducts: false, triggerProducts: [from], offerProducts: [to], basis: 'orders' });

  // One rule per product with its best partners from the pairs shown.
  const bulkRules = useMemo(() => {
    const byId = new Map();
    pairs.forEach((p) => { if (p.a.active) byId.set(numericId(p.a.id), p.a); if (p.b.active) byId.set(numericId(p.b.id), p.b); });
    const slim = pairs.map((p) => ({ ...p, a: { id: numericId(p.a.id) }, b: { id: numericId(p.b.id) } }));
    const out = [];
    for (const [id, product] of byId) {
      const offers = partnersOf(slim, id, maxOffers + 3).map((x) => byId.get(x.id)).filter(Boolean).slice(0, maxOffers);
      if (offers.length) out.push({ name: product.title, allProducts: false, triggerProducts: [product], offerProducts: offers, basis: 'orders' });
    }
    return out.filter((r) => !isKnown(genericKey(r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, maxOffers, existingKeys, addedKeys]);

  return (
    <BlockStack gap="300">
      <InlineStack gap="200" blockAlign="end" wrap>
        <div style={{ minWidth: 170 }}>
          <Select label="Orders from" options={WINDOWS} value={days} onChange={(v) => { setDays(v); load(v); }} />
        </div>
        <Button onClick={() => load(days, true)} loading={loading}>Refresh</Button>
      </InlineStack>

      {loading && !data && (
        <InlineStack gap="200" blockAlign="center"><Spinner size="small" /><Text as="span" variant="bodySm" tone="subdued">Reading your orders…</Text></InlineStack>
      )}
      {data?.success === false && <Banner tone="critical">{data.error || 'Could not read your orders.'}</Banner>}

      {data?.success && (
        <Text as="p" variant="bodySm" tone="subdued">
          {plural(data.totalOrders, 'order')} checked ({data.multiItemOrders} with 2 or more products).
          {' '}Shopify gives the app the last 60 days of orders; older ones come from what BRIX recorded since it was installed.
          {data.stoppedEarly ? ' Only the most recent orders Shopify returned in time were read.' : ''}
        </Text>
      )}

      {data?.success && !pairs.length && (
        <Banner tone="info">No order in this period had two or more products yet, so there is nothing to pair from. Try a longer period, or describe the pairings in words.</Banner>
      )}

      {pairs.length > 0 && (
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <Text as="h4" variant="headingSm">Bought together most often</Text>
            <Button size="slim" disabled={!bulkRules.length} onClick={() => add(bulkRules)}>
              {bulkRules.length ? `Add ${plural(bulkRules.length, 'rule')} (top ${maxOffers} per product)` : 'All added'}
            </Button>
          </InlineStack>
          {pairs.map((p) => {
            const ab = oneWay(p.a, p.b);
            const ba = oneWay(p.b, p.a);
            const usable = p.a.active && p.b.active;
            const abDone = isKnown(genericKey(ab));
            const baDone = isKnown(genericKey(ba));
            return (
              <div key={`${p.a.id}|${p.b.id}`} style={{ border: '1px solid #e3e5e7', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Thumb product={p.a} />
                    <Text as="span" variant="bodySm" tone="subdued">+</Text>
                    <Thumb product={p.b} />
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" fontWeight="semibold">{p.a.title} + {p.b.title}</Text>
                      <Text as="span" variant="bodyXs" tone="subdued">
                        Together in {plural(p.together, 'order')} · {p.aToB}% of {p.a.title} orders · {p.bToA}% of {p.b.title} orders
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  {usable ? (
                    <InlineStack gap="150" wrap>
                      <Button size="micro" disabled={abDone} onClick={() => add([ab])}>{abDone ? 'Added' : `On ${p.a.title}, show ${p.b.title}`}</Button>
                      <Button size="micro" disabled={baDone} onClick={() => add([ba])}>{baDone ? 'Added' : `On ${p.b.title}, show ${p.a.title}`}</Button>
                      {!abDone && !baDone && <Button size="micro" variant="tertiary" onClick={() => add([ab, ba])}>Both ways</Button>}
                    </InlineStack>
                  ) : (
                    <InlineStack gap="150"><Badge tone="warning">Not active</Badge><Text as="span" variant="bodyXs" tone="subdued">One of these products is archived, a draft or deleted, so it can&rsquo;t be recommended.</Text></InlineStack>
                  )}
                </BlockStack>
              </div>
            );
          })}
        </BlockStack>
      )}
    </BlockStack>
  );
}

// tab: when the page shows its own switcher ('describe' | 'orders'), this
// one's own toggle is hidden.
export default function PairingAssistant({ existingKeys, onAddRules, maxOffers = 3, defaultTab = 'describe', tab: controlledTab }) {
  const [ownTab, setTab] = useState(defaultTab);
  const tab = controlledTab || ownTab;
  const keys = existingKeys || new Set();
  return (
    <BlockStack gap="400">
      {!controlledTab && (
        <ButtonGroup variant="segmented">
          <Button pressed={tab === 'describe'} onClick={() => setTab('describe')}>Describe in words</Button>
          <Button pressed={tab === 'orders'} onClick={() => setTab('orders')}>From past orders</Button>
        </ButtonGroup>
      )}
      {tab === 'describe'
        ? <DescribeTab existingKeys={keys} onAddRules={onAddRules} maxOffers={maxOffers} />
        : <OrdersTab existingKeys={keys} onAddRules={onAddRules} maxOffers={maxOffers} />}
    </BlockStack>
  );
}
