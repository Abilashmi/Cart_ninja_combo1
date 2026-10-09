/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// "What to show": the merchant's rules. Each says which product pages it is
// for (every product, picked products, or products in picked collections)
// and what to show there (picked products, or products from a collection).
import { useState } from 'react';
import { useAppBridge } from '@shopify/app-bridge-react';
import { BlockStack, Box, Button, ButtonGroup, Card, InlineStack, Select, Tag, Text, TextField, Badge } from '@shopify/polaris';
import { normalizeRule, ruleProblem, numericId } from '../../utils/fbt-core.shared.js';

const WHEN = [
  { label: 'Every product page', value: 'all' },
  { label: 'These products', value: 'products' },
  { label: 'Products in these collections', value: 'collections' },
];
const SHOW = [
  { label: 'These products', value: 'products' },
  { label: 'Products from a collection', value: 'collection' },
];

const refOf = (r) => ({
  id: numericId(r.id),
  handle: r.handle || '',
  title: r.title || '',
  ...(r.images?.[0]?.originalSrc || r.image?.originalSrc ? { image: r.images?.[0]?.originalSrc || r.image?.originalSrc } : {}),
});
const names = (list) => list.map((r) => r.title || r.handle).join(', ');

export function ruleSummary(rule) {
  const on = rule.when.type === 'all' ? 'Every product page'
    : rule.when.type === 'products' ? names(rule.when.products) || 'No products picked'
      : `Products in ${names(rule.when.collections) || '…'}`;
  const show = rule.show.type === 'collection' ? `Products from ${rule.show.collection?.title || rule.show.collection?.handle || '…'}` : names(rule.show.products) || 'No products picked';
  return { on, show };
}

function Picked({ list, onRemove, empty }) {
  if (!list.length) return <Text as="span" tone="subdued" variant="bodySm">{empty}</Text>;
  return (
    <InlineStack gap="150" wrap>
      {list.map((r) => <Tag key={r.id || r.handle} onRemove={() => onRemove(r)}>{r.title || r.handle}</Tag>)}
    </InlineStack>
  );
}

function RuleEditor({ initial, onSave, onCancel }) {
  const shopify = useAppBridge();
  const [rule, setRule] = useState(() => normalizeRule(initial, 0));
  const [error, setError] = useState('');
  const set = (patch) => setRule((r) => normalizeRule({ ...r, ...patch, id: r.id }, 0));

  async function pick(type, current, multiple) {
    try {
      const selected = await shopify.resourcePicker({
        type, multiple, selectionIds: current.filter((r) => r.id).map((r) => ({ id: `gid://shopify/${type === 'product' ? 'Product' : 'Collection'}/${r.id}` })),
      });
      return selected ? selected.map(refOf) : null;
    } catch {
      shopify.toast.show('Could not open the picker. Please try again.', { isError: true });
      return null;
    }
  }

  const problem = ruleProblem(rule);
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingSm">{initial?.id ? 'Edit rule' : 'New rule'}</Text>
        <TextField label="Name (optional)" value={rule.name} onChange={(v) => set({ name: v })} autoComplete="off" placeholder="e.g. T-shirts with shorts" maxLength={60} />
        <BlockStack gap="200">
          <Select label="Show on" options={WHEN} value={rule.when.type} onChange={(v) => set({ when: { ...rule.when, type: v } })} />
          {rule.when.type === 'products' && (
            <BlockStack gap="150">
              <Picked list={rule.when.products} empty="No products yet." onRemove={(r) => set({ when: { ...rule.when, products: rule.when.products.filter((x) => x !== r) } })} />
              <div><Button onClick={async () => { const s = await pick('product', rule.when.products, true); if (s) set({ when: { ...rule.when, products: s } }); }}>Pick products</Button></div>
            </BlockStack>
          )}
          {rule.when.type === 'collections' && (
            <BlockStack gap="150">
              <Picked list={rule.when.collections} empty="No collections yet." onRemove={(r) => set({ when: { ...rule.when, collections: rule.when.collections.filter((x) => x !== r) } })} />
              <div><Button onClick={async () => { const s = await pick('collection', rule.when.collections, true); if (s) set({ when: { ...rule.when, collections: s } }); }}>Pick collections</Button></div>
            </BlockStack>
          )}
        </BlockStack>
        <BlockStack gap="200">
          <Select label="Show these together" options={SHOW} value={rule.show.type} onChange={(v) => set({ show: { ...rule.show, type: v } })} />
          {rule.show.type === 'products' && (
            <BlockStack gap="150">
              <Picked list={rule.show.products} empty="No products yet." onRemove={(r) => set({ show: { ...rule.show, products: rule.show.products.filter((x) => x !== r) } })} />
              <div><Button onClick={async () => { const s = await pick('product', rule.show.products, true); if (s) set({ show: { ...rule.show, products: s } }); }}>Pick products</Button></div>
            </BlockStack>
          )}
          {rule.show.type === 'collection' && (
            <BlockStack gap="150">
              <Picked list={rule.show.collection ? [rule.show.collection] : []} empty="No collection yet." onRemove={() => set({ show: { ...rule.show, collection: null } })} />
              <div><Button onClick={async () => { const s = await pick('collection', rule.show.collection ? [rule.show.collection] : [], false); if (s?.[0]) set({ show: { ...rule.show, collection: s[0] } }); }}>Pick a collection</Button></div>
              <Text as="p" variant="bodySm" tone="subdued">Its first products that are in stock are shown, never the product being viewed.</Text>
            </BlockStack>
          )}
        </BlockStack>
        {error && <Text as="p" tone="critical">{error}</Text>}
        <InlineStack gap="200" align="end">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => { if (problem) { setError(problem); return; } onSave(rule); }}>{initial?.id ? 'Done' : 'Add rule'}</Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function FbtRules({ rules, onChange }) {
  const [editing, setEditing] = useState(null); // null | 'new' | rule id
  const move = (i, d) => {
    const next = [...rules];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r);
    onChange(next);
  };
  return (
    <BlockStack gap="300">
      {rules.length === 0 && editing !== 'new' && (
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <Text as="p" tone="subdued">No rules yet. Without rules, the automatic pairs below decide what shows.</Text>
        </Box>
      )}
      {rules.map((rule, i) => (editing === rule.id ? (
        <RuleEditor key={rule.id} initial={rule} onCancel={() => setEditing(null)} onSave={(r) => { onChange(rules.map((x) => (x.id === rule.id ? r : x))); setEditing(null); }} />
      ) : (
        <Box key={rule.id} padding="300" borderWidth="025" borderColor="border" borderRadius="200">
          <InlineStack align="space-between" blockAlign="start" gap="300" wrap={false}>
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="headingSm">{rule.name || `Rule ${i + 1}`}</Text>
                {!rule.enabled && <Badge>Off</Badge>}
                {ruleProblem(rule) && <Badge tone="critical">Incomplete</Badge>}
              </InlineStack>
              <Text as="p" variant="bodySm"><b>On:</b> {ruleSummary(rule).on}</Text>
              <Text as="p" variant="bodySm"><b>Shows:</b> {ruleSummary(rule).show}</Text>
            </BlockStack>
            <ButtonGroup>
              <Button size="slim" disabled={i === 0} onClick={() => move(i, -1)} accessibilityLabel="Move up">↑</Button>
              <Button size="slim" disabled={i === rules.length - 1} onClick={() => move(i, 1)} accessibilityLabel="Move down">↓</Button>
              <Button size="slim" onClick={() => onChange(rules.map((x) => (x.id === rule.id ? { ...x, enabled: !x.enabled } : x)))}>{rule.enabled ? 'Turn off' : 'Turn on'}</Button>
              <Button size="slim" onClick={() => setEditing(rule.id)}>Edit</Button>
              <Button size="slim" tone="critical" onClick={() => onChange(rules.filter((x) => x.id !== rule.id))}>Delete</Button>
            </ButtonGroup>
          </InlineStack>
        </Box>
      )))}
      {editing === 'new' ? (
        <RuleEditor
          initial={{ when: { type: 'collections' }, show: { type: 'products' } }}
          onCancel={() => setEditing(null)}
          onSave={(r) => { onChange([...rules, { ...r, id: `r${Date.now().toString(36)}` }]); setEditing(null); }}
        />
      ) : (
        <div><Button onClick={() => setEditing('new')}>Add rule</Button></div>
      )}
      <Text as="p" variant="bodySm" tone="subdued">
        On each product page: rules for that product come first, then rules for its collections, then rules for every product page. Up to the number of products set in Design is shown.
      </Text>
    </BlockStack>
  );
}
