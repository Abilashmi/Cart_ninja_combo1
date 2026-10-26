/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// COD → Customize → Shipping: the editor for dynamic shipping
// (app/utils/shipping.shared.js). The config is edited as a draft (numbers may
// be typed text, PIN codes a pasted list); shippingErrors() checks the draft,
// and the server saves sanitizeShipping() of it. Sections: Shipping charges
// (how shipping is charged, delivery options, products that ship free), Zones,
// Rules, Extra charges, Delivery dates, Don't deliver to, Test calculator.
import { useState } from 'react';
import {
  Badge, Banner, BlockStack, Button, Card, Checkbox, ChoiceList, FormLayout, InlineStack, Select, Tag, Text, TextField,
} from '@shopify/polaris';
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronUpIcon, DeleteIcon, PlusIcon, XIcon } from '@shopify/polaris-icons';
import ChipInput from './ChipInput';
import {
  INDIAN_STATES, METHOD_KINDS, SHIP_LIMITS, ZONE_PRESETS, CHARGE_KINDS, WEEKDAY_NAMES, newMethod, newZone, newRule, newCharge,
  emptyWhen, describeRate, parsePinList, randomId, slotLabel,
} from '../../utils/shipping.shared.js';

/* ───────────────────────── draft helpers ───────────────────────── */

/** Sidebar section → the shippingErrors() keys it owns. */
export const SHIP_ERROR_PREFIXES = {
  shipping: ['methods', 'freeItems'],
  shipzones: ['zones'],
  shiprules: ['rules'],
  shipcharges: ['charges'],
  shipdates: ['delivery'],
  shipblock: ['blocked'],
};

export function countShipErrors(errors, prefixes) {
  return Object.keys(errors || {}).filter((k) => prefixes.some((p) => k === p || k.startsWith(`${p}.`))).length;
}

/** An editable copy of a saved config (null stays null). */
export function toShipDraft(config) {
  return config ? JSON.parse(JSON.stringify(config)) : null;
}

function setIn(obj, [key, ...rest], value) {
  const base = Array.isArray(obj) ? [...obj] : { ...(obj || {}) };
  base[key] = rest.length ? setIn(base[key], rest, value) : value;
  return base;
}

// at(['methods', 0, 'name'])(value): sets one field of the draft.
function setterFor(setShip) {
  return (path) => (value) => setShip((c) => setIn(c, path, value));
}

const str = (v) => (v === null || v === undefined ? '' : String(v));
// Optional numbers where 0 means "off": shown empty.
const opt = (v) => (v === 0 || v === '0' ? '' : str(v));
const splitList = (s) => String(s || '').split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
const move = (list, i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
const grams = (g) => {
  const n = Number(g) || 0;
  return n >= 1000 ? `${Math.round(n / 10) / 100} kg` : `${n} g`;
};
const CITY_RE = /^[\p{L}\p{M} .'()-]{2,60}$/u;
const TAG_RE = /^[\w\- .:/&]{1,40}$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SLOT_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export const KIND_LABEL = { standard: 'Standard', express: 'Express', same_day: 'Same day', next_day: 'Next day', scheduled: 'Scheduled' };
const KIND_OPTIONS = METHOD_KINDS.map((k) => ({
  value: k,
  label: { standard: 'Standard delivery', express: 'Express delivery', same_day: 'Same-day delivery', next_day: 'Next-day delivery', scheduled: 'Scheduled delivery (shopper picks a day and time)' }[k],
}));

/* ───────────────────────── small building blocks ───────────────────────── */

// One delivery option / zone / rule / charge: a row that opens into its settings.
function ItemCard({ title, kind, summary, open, onToggle, enabled, onEnabled, onUp, onDown, onDelete, errorCount, children }) {
  return (
    <div className={`shp-card${open ? ' is-open' : ''}${enabled === false ? ' is-off' : ''}`}>
      <div className="shp-card-h">
        {onEnabled && (
          <span className="shp-card-on">
            <Checkbox label={`Turn ${title} on`} labelHidden checked={enabled !== false} onChange={onEnabled} />
          </span>
        )}
        <button type="button" className="shp-card-t" onClick={onToggle} aria-expanded={open}>
          <span className="shp-card-n">{title}{kind ? <span className="shp-kind">{kind}</span> : null}{enabled === false ? <span className="shp-kind">Off</span> : null}</span>
          {summary ? <span className="shp-card-s">{summary}</span> : null}
        </button>
        {errorCount ? <Badge tone="critical">{errorCount === 1 ? '1 error' : `${errorCount} errors`}</Badge> : null}
        <span className="shp-card-a">
          {onUp && <Button icon={ArrowUpIcon} variant="plain" accessibilityLabel={`Move ${title} up`} onClick={onUp} />}
          {onDown && <Button icon={ArrowDownIcon} variant="plain" accessibilityLabel={`Move ${title} down`} onClick={onDown} />}
          {onDelete && <Button icon={DeleteIcon} variant="plain" tone="critical" accessibilityLabel={`Remove ${title}`} onClick={onDelete} />}
          <Button icon={open ? ChevronUpIcon : ChevronDownIcon} variant="plain" accessibilityLabel={open ? 'Close' : 'Open'} onClick={onToggle} />
        </span>
      </div>
      {open && <div className="shp-card-b">{children}</div>}
    </div>
  );
}

function StatePicker({ value, onChange, label = 'States' }) {
  const list = Array.isArray(value) ? value : [];
  const left = INDIAN_STATES.filter((s) => !list.includes(s));
  return (
    <BlockStack gap="150">
      <Select
        label={label}
        options={[{ label: list.length ? 'Add another state…' : 'Choose a state…', value: '' }, ...left.map((s) => ({ label: s, value: s }))]}
        value=""
        onChange={(s) => s && onChange([...list, s])}
      />
      {list.length > 0 && (
        <InlineStack gap="150">
          {list.map((s) => <Tag key={s} onRemove={() => onChange(list.filter((x) => x !== s))}>{s}</Tag>)}
        </InlineStack>
      )}
    </BlockStack>
  );
}

function PinField({ value, onChange, error, label = 'PIN codes' }) {
  const textValue = Array.isArray(value) ? value.join(', ') : str(value);
  const count = parsePinList(textValue).pins.length;
  return (
    <TextField
      label={label}
      multiline={3}
      maxHeight={160}
      value={textValue}
      onChange={onChange}
      error={error}
      autoComplete="off"
      monospaced
      placeholder="e.g. 560001, 560001-560099, 110*"
      helpText={`${count ? `${count.toLocaleString('en-IN')} ${count === 1 ? 'entry' : 'entries'}. ` : ''}A PIN code (560001), a range (560001-560099) or every PIN code starting with some digits (560*). Paste a whole list, separated by commas or new lines.`}
    />
  );
}

function ZonePicks({ zones, value, onChange, title }) {
  if (!zones.length) return <Text as="p" variant="bodySm" tone="subdued">{title}: add zones in the Zones section to pick them here.</Text>;
  return (
    <ChoiceList
      allowMultiple
      title={title}
      choices={zones.map((z) => ({ label: z.name || 'Unnamed zone', value: z.id }))}
      selected={(value || []).filter((id) => zones.some((z) => z.id === id))}
      onChange={onChange}
    />
  );
}

// Places: zones (optional), states, cities, PIN codes.
function PlaceFields({ place, onChange, path, err, zones, zonesTitle }) {
  const p = place || {};
  const set = (k) => (v) => onChange({ ...p, [k]: v });
  return (
    <BlockStack gap="300">
      {zones && <ZonePicks zones={zones} value={p.zones} onChange={set('zones')} title={zonesTitle || 'Zones'} />}
      <StatePicker value={p.states} onChange={set('states')} />
      <ChipInput
        label="Cities"
        value={(Array.isArray(p.cities) ? p.cities : splitList(p.cities)).join(', ')}
        onChange={(s) => set('cities')(splitList(s))}
        placeholder="e.g. Mumbai, Pune"
        helpText="Old names match too (Bangalore = Bengaluru, Gurgaon = Gurugram)."
        error={err(`${path}.cities`)}
        isValid={(c) => CITY_RE.test(c)}
      />
      <PinField value={p.pins} onChange={set('pins')} error={err(`${path}.pins`)} />
    </BlockStack>
  );
}

// Products or collections, picked with Shopify's resource picker: [{ id, title }].
export function RefPicker({ type, value, onChange, max }) {
  const list = Array.isArray(value) ? value : [];
  const noun = type === 'product' ? 'products' : 'collections';
  const pick = async () => {
    // App Bridge's global, read on click (rendering never depends on it).
    const shopify = typeof window !== 'undefined' ? window.shopify : null;
    if (!shopify?.resourcePicker) return;
    try {
      const selected = await shopify.resourcePicker({ type, multiple: true, selectionIds: list.map((r) => ({ id: r.id })) });
      if (!selected) return;
      onChange(selected.slice(0, max).map((r) => ({ id: r.id, title: r.title || '' })));
    } catch {
      shopify.toast?.show('Could not open the picker. Please try again.', { isError: true });
    }
  };
  return (
    <BlockStack gap="150">
      <InlineStack gap="200" blockAlign="center">
        <Text as="span">{type === 'product' ? 'Products' : 'Collections'}</Text>
        <Button size="slim" onClick={pick}>{list.length ? 'Change' : `Choose ${noun}`}</Button>
      </InlineStack>
      {list.length > 0 && (
        <InlineStack gap="150">
          {list.map((r) => (
            <Tag key={r.id} onRemove={() => onChange(list.filter((x) => x.id !== r.id))}>{r.title || `${type === 'product' ? 'Product' : 'Collection'} ${r.id.split('/').pop()}`}</Tag>
          ))}
        </InlineStack>
      )}
    </BlockStack>
  );
}

function TagsField({ value, onChange, label = 'Product tags', helpText }) {
  return (
    <ChipInput
      label={label}
      value={(Array.isArray(value) ? value : splitList(value)).join(', ')}
      onChange={(s) => onChange(splitList(s))}
      placeholder="e.g. fragile"
      helpText={helpText || 'Upper or lower case doesn\'t matter.'}
      isValid={(t) => TAG_RE.test(t)}
    />
  );
}

/* ───────────────────────── price editor ───────────────────────── */

const RATE_OPTIONS = [
  { label: 'Flat price', value: 'flat' },
  { label: 'Free', value: 'free' },
  { label: 'Price per item', value: 'per_item' },
  { label: 'By weight: a base price, then per extra weight', value: 'weight' },
  { label: 'Price slabs by order value', value: 'tiers:value' },
  { label: 'Price slabs by number of items', value: 'tiers:quantity' },
  { label: 'Price slabs by weight', value: 'tiers:weight' },
  { label: '% of the order value', value: 'percent' },
];

const rateKey = (rate) => (rate?.type === 'tiers' ? `tiers:${rate.by || 'value'}` : rate?.type || 'flat');

function freshRate(key, prev) {
  const amount = prev?.amount ?? '';
  if (key === 'free') return { type: 'free' };
  if (key === 'flat') return { type: 'flat', amount };
  if (key === 'per_item') return { type: 'per_item', amount, first: '' };
  if (key === 'weight') return { type: 'weight', base: amount, baseGrams: 500, step: '', stepGrams: 500 };
  if (key === 'percent') return { type: 'percent', percent: '', min: '', max: '' };
  return { type: 'tiers', by: key.split(':')[1], tiers: [{ from: 0, amount }] };
}

function TierRows({ rate, onChange, err, path, cur }) {
  const tiers = Array.isArray(rate.tiers) && rate.tiers.length ? rate.tiers : [{ from: 0, amount: '' }];
  const fromUnit = rate.by === 'quantity' ? { suffix: 'items' } : rate.by === 'weight' ? { suffix: 'g' } : { prefix: cur };
  const setTier = (i, k) => (v) => onChange({ ...rate, tiers: tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });
  return (
    <BlockStack gap="200">
      {tiers.map((t, i) => (
        // eslint-disable-next-line react/no-array-index-key -- slabs have no ids; order is their identity
        <div key={i} className="shp-tier">
          <TextField
            label={i === 0 ? 'From' : `From (slab ${i + 1})`}
            labelHidden={i > 0}
            type="number"
            min={0}
            value={i === 0 ? '0' : str(t.from)}
            disabled={i === 0}
            onChange={setTier(i, 'from')}
            error={err(`${path}.tiers.${i}.from`)}
            autoComplete="off"
            {...fromUnit}
          />
          <TextField
            label={i === 0 ? 'Shipping' : `Shipping (slab ${i + 1})`}
            labelHidden={i > 0}
            type="number"
            min={0}
            prefix={cur}
            value={str(t.amount)}
            onChange={setTier(i, 'amount')}
            placeholder="0 = free"
            error={err(`${path}.tiers.${i}.amount`)}
            autoComplete="off"
          />
          <div className={i === 0 ? 'shp-tier-x first' : 'shp-tier-x'}>
            {i > 0 && <Button icon={XIcon} variant="plain" accessibilityLabel={`Remove slab ${i + 1}`} onClick={() => onChange({ ...rate, tiers: tiers.filter((_, j) => j !== i) })} />}
          </div>
        </div>
      ))}
      {err(`${path}.tiers`) && <Text as="p" tone="critical" variant="bodySm">{err(`${path}.tiers`)}</Text>}
      <InlineStack align="space-between" blockAlign="center">
        <Text as="span" variant="bodySm" tone="subdued">Each price applies from its amount up to the next slab.</Text>
        {tiers.length < SHIP_LIMITS.tiers && <Button size="slim" icon={PlusIcon} onClick={() => onChange({ ...rate, tiers: [...tiers, { from: '', amount: '' }] })}>Add a slab</Button>}
      </InlineStack>
    </BlockStack>
  );
}

export function RateEditor({ rate, onChange, err, path, cur, label = 'Price' }) {
  const r = rate || { type: 'flat', amount: '' };
  const e = (k) => err(`${path}.${k}`);
  const set = (k) => (v) => onChange({ ...r, [k]: v });
  const select = <Select label={label} options={RATE_OPTIONS} value={rateKey(r)} onChange={(k) => onChange(freshRate(k, r))} error={e('type')} />;
  const money = (k, fieldLabel, extra = {}) => (
    <TextField label={fieldLabel} type="number" min={0} prefix={cur} value={extra.optional ? opt(r[k]) : str(r[k])} onChange={set(k)} error={e(k)} autoComplete="off" {...extra.props} />
  );
  if (r.type === 'free') return select;
  if (r.type === 'flat') return <FormLayout.Group>{select}{money('amount', 'Amount', { props: { placeholder: '0 = free' } })}</FormLayout.Group>;
  if (r.type === 'per_item') {
    return (
      <BlockStack gap="300">
        {select}
        <FormLayout.Group>
          {money('amount', 'Each item')}
          {money('first', 'First item (optional)', { optional: true, props: { placeholder: 'Same', helpText: 'A different price for the first item.' } })}
        </FormLayout.Group>
      </BlockStack>
    );
  }
  if (r.type === 'weight') {
    return (
      <BlockStack gap="300">
        {select}
        <FormLayout.Group>
          {money('base', 'Base price')}
          <TextField label="Covers up to" type="number" min={0} suffix="g" value={str(r.baseGrams)} onChange={set('baseGrams')} error={e('baseGrams')} helpText={grams(r.baseGrams)} autoComplete="off" />
        </FormLayout.Group>
        <FormLayout.Group>
          {money('step', 'Then add', { optional: true, props: { placeholder: '0' } })}
          <TextField label="For every extra" type="number" min={1} suffix="g" value={str(r.stepGrams)} onChange={set('stepGrams')} error={e('stepGrams')} helpText={`${grams(r.stepGrams)} or part of it`} autoComplete="off" />
        </FormLayout.Group>
      </BlockStack>
    );
  }
  if (r.type === 'percent') {
    return (
      <BlockStack gap="300">
        <FormLayout.Group>
          {select}
          <TextField label="Percent" type="number" min={0} max={100} suffix="%" value={str(r.percent)} onChange={set('percent')} error={e('percent')} autoComplete="off" />
        </FormLayout.Group>
        <FormLayout.Group>
          {money('min', 'At least (optional)', { optional: true, props: { placeholder: 'No minimum' } })}
          {money('max', 'At most (optional)', { optional: true, props: { placeholder: 'No maximum' } })}
        </FormLayout.Group>
      </BlockStack>
    );
  }
  return (
    <BlockStack gap="300">
      {select}
      <TierRows rate={r} onChange={onChange} err={err} path={path} cur={cur} />
    </BlockStack>
  );
}

/* ───────────────────────── conditions ───────────────────────── */

const WHEN_GROUPS = [
  { id: 'place', label: 'Place', keys: ['zones', 'states', 'cities', 'pins'] },
  { id: 'value', label: 'Order value', keys: ['minValue', 'maxValue'] },
  { id: 'qty', label: 'Number of items', keys: ['minQty', 'maxQty'] },
  { id: 'weight', label: 'Weight', keys: ['minGrams', 'maxGrams'] },
  { id: 'items', label: 'Products', keys: ['products', 'collections', 'tags'] },
  { id: 'methods', label: 'Delivery option', keys: ['methods'] },
];

const hasValue = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' && Number(v) !== 0 : Number(v) > 0);
const groupsInUse = (w) => WHEN_GROUPS.filter((g) => g.keys.some((k) => hasValue(w?.[k]))).map((g) => g.id);

/** Short words for a condition ("Karnataka, Kerala · order ₹500–₹999 · tag fragile"). */
export function describeWhen(w, { zones = [], methods = [], fmt = String } = {}) {
  if (!w) return 'Every order';
  const parts = [];
  const place = [
    ...(w.zones || []).map((id) => zones.find((z) => z.id === id)?.name).filter(Boolean),
    ...(w.states || []),
    ...(Array.isArray(w.cities) ? w.cities : splitList(w.cities)),
  ];
  const pins = parsePinList(w.pins).pins.length;
  if (place.length || pins) {
    parts.push([...place.slice(0, 3), place.length > 3 ? `+${place.length - 3} more` : '', pins ? `${pins} PIN ${pins === 1 ? 'entry' : 'entries'}` : ''].filter(Boolean).join(', '));
  }
  const range = (min, max, f, noun) => {
    const lo = Number(min) || 0;
    const hi = Number(max) || 0;
    if (lo && hi) return `${noun} ${f(lo)}–${f(hi)}`;
    if (lo) return `${noun} from ${f(lo)}`;
    if (hi) return `${noun} up to ${f(hi)}`;
    return '';
  };
  parts.push(range(w.minValue, w.maxValue, fmt, 'order'));
  parts.push(range(w.minQty, w.maxQty, (n) => `${n}`, 'items'));
  parts.push(range(w.minGrams, w.maxGrams, grams, 'weight'));
  const items = [
    (w.products || []).length ? `${w.products.length} product${w.products.length === 1 ? '' : 's'}` : '',
    (w.collections || []).length ? `${w.collections.length} collection${w.collections.length === 1 ? '' : 's'}` : '',
    ...(w.tags || []).map((t) => `tag ${t}`),
  ].filter(Boolean);
  if (items.length) parts.push(`${w.itemMatch === 'all' ? 'every item: ' : ''}${items.join(', ')}`);
  const ms = (w.methods || []).map((id) => methods.find((m) => m.id === id)?.name).filter(Boolean);
  if (ms.length) parts.push(ms.join(', '));
  const out = parts.filter(Boolean);
  return out.length ? out.join(' · ') : 'Every order';
}

function CondBox({ label, onRemove, children }) {
  return (
    <div className="shp-cond">
      <div className="shp-cond-h">
        <span>{label}</span>
        <Button icon={XIcon} variant="plain" accessibilityLabel={`Remove the ${label.toLowerCase()} condition`} onClick={onRemove} />
      </div>
      {children}
    </div>
  );
}

function RangeFields({ w, set, minKey, maxKey, path, err, unit }) {
  return (
    <FormLayout.Group condensed>
      <TextField label="At least" type="number" min={0} value={opt(w[minKey])} onChange={set(minKey)} placeholder="Any" error={err(`${path}.${minKey}`)} autoComplete="off" {...unit} />
      <TextField label="At most" type="number" min={0} value={opt(w[maxKey])} onChange={set(maxKey)} placeholder="Any" error={err(`${path}.${maxKey}`)} autoComplete="off" {...unit} />
    </FormLayout.Group>
  );
}

/** Conditions of a rule or extra charge; all must match. Empty = every order. */
function WhenEditor({ when, onChange, path, err, zones, methods, cur, withMethods = true }) {
  const w = { ...emptyWhen(), ...(when || {}) };
  const [opened, setOpened] = useState(() => groupsInUse(w));
  const inUse = groupsInUse(w);
  const allowed = WHEN_GROUPS.filter((g) => g.id !== 'methods' || withMethods);
  const shown = allowed.filter((g) => opened.includes(g.id) || inUse.includes(g.id));
  const addable = allowed.filter((g) => !shown.includes(g));
  const set = (k) => (v) => onChange({ ...w, [k]: v });
  const remove = (g) => {
    setOpened((o) => o.filter((x) => x !== g.id));
    const blank = emptyWhen();
    const next = { ...w };
    g.keys.forEach((k) => { next[k] = blank[k]; });
    if (g.id === 'items') next.itemMatch = 'any';
    onChange(next);
  };
  const body = (g) => {
    if (g.id === 'place') return <PlaceFields place={w} onChange={(p) => onChange({ ...w, ...p })} path={path} err={err} zones={zones} zonesTitle="Zones" />;
    if (g.id === 'value') return <RangeFields w={w} set={set} minKey="minValue" maxKey="maxValue" path={path} err={err} unit={{ prefix: cur }} />;
    if (g.id === 'qty') return <RangeFields w={w} set={set} minKey="minQty" maxKey="maxQty" path={path} err={err} unit={{ suffix: 'items' }} />;
    if (g.id === 'weight') return <RangeFields w={w} set={set} minKey="minGrams" maxKey="maxGrams" path={path} err={err} unit={{ suffix: 'g' }} />;
    if (g.id === 'items') {
      return (
        <BlockStack gap="300">
          <RefPicker type="product" value={w.products} onChange={set('products')} max={SHIP_LIMITS.products} />
          <RefPicker type="collection" value={w.collections} onChange={set('collections')} max={SHIP_LIMITS.collections} />
          <TagsField value={w.tags} onChange={set('tags')} />
          <ChoiceList
            title="The order matches when"
            choices={[{ label: 'Any item is one of these', value: 'any' }, { label: 'Every item is one of these', value: 'all' }]}
            selected={[w.itemMatch === 'all' ? 'all' : 'any']}
            onChange={([v]) => set('itemMatch')(v)}
          />
        </BlockStack>
      );
    }
    return (
      <ChoiceList
        allowMultiple
        title="Only for these delivery options"
        choices={methods.map((m) => ({ label: m.name || KIND_LABEL[m.kind], value: m.id }))}
        selected={(w.methods || []).filter((id) => methods.some((m) => m.id === id))}
        onChange={set('methods')}
      />
    );
  };
  return (
    <BlockStack gap="200">
      <Text as="h4" variant="headingSm">Conditions</Text>
      {shown.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No conditions: applies to every order. Add one below; when there are several, all must match.</Text>}
      {shown.map((g) => <CondBox key={g.id} label={g.label} onRemove={() => remove(g)}>{body(g)}</CondBox>)}
      {addable.length > 0 && (
        <div className="shp-add">
          {addable.map((g) => <Button key={g.id} size="slim" icon={PlusIcon} onClick={() => setOpened((o) => [...o, g.id])}>{g.label}</Button>)}
        </div>
      )}
    </BlockStack>
  );
}

/* ───────────────────────── Shipping charges (mode + delivery options) ───────────────────────── */

function methodSummary(m, zones, fmt) {
  const price = describeRate(m.rate, fmt) + (Number(m.freeAbove) > 0 ? `, free from ${fmt(Number(m.freeAbove))}` : '');
  let when;
  if (m.kind === 'same_day' || m.kind === 'next_day') when = `order by ${m.cutoff || '—'}`;
  else if (m.kind === 'scheduled') when = `${m.schedule?.firstDay ?? 1}–${m.schedule?.lastDay ?? 7} days ahead, ${(m.schedule?.slots || []).length} time slots`;
  else when = `${m.days?.min ?? 0}–${m.days?.max ?? 0} working days`;
  const only = (m.zones || []).map((id) => zones.find((z) => z.id === id)?.name).filter(Boolean);
  return [price, when, only.length ? `only in ${only.join(', ')}` : ''].filter(Boolean).join(' · ');
}

// Zone price / zone delivery time rows of a delivery option.
function ZoneRows({ zones, rows, onChange, renderRow, newRow, addLabel }) {
  const list = Array.isArray(rows) ? rows : [];
  const used = new Set(list.map((r) => r.zone));
  const free = zones.filter((z) => !used.has(z.id));
  return (
    <BlockStack gap="200">
      {list.map((r, i) => (
        <div key={r.zone || i} className="shp-row">
          <BlockStack gap="200">
            <Select
              label="Zone"
              options={zones.filter((z) => z.id === r.zone || !used.has(z.id)).map((z) => ({ label: z.name || 'Unnamed zone', value: z.id }))}
              value={r.zone}
              onChange={(zone) => onChange(list.map((x, j) => (j === i ? { ...x, zone } : x)))}
            />
            {renderRow(r, i, (patch) => onChange(list.map((x, j) => (j === i ? { ...x, ...patch } : x))))}
          </BlockStack>
          <Button icon={XIcon} variant="plain" accessibilityLabel="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      {free.length > 0 && list.length < SHIP_LIMITS.zoneRates && (
        <InlineStack><Button size="slim" icon={PlusIcon} onClick={() => onChange([...list, newRow(free[0].id)])}>{addLabel}</Button></InlineStack>
      )}
    </BlockStack>
  );
}

function MethodBody({ m, i, ship, at, err, cur }) {
  const p = ['methods', i];
  const setM = (k) => at([...p, k]);
  const [more, setMore] = useState(() => Boolean((m.zoneRates || []).length || (m.zoneDays || []).length || Number(m.minOrder) || Number(m.maxOrder) || Number(m.maxGrams)));
  const zones = ship.zones || [];
  const timed = m.kind === 'same_day' || m.kind === 'next_day';
  const sched = m.schedule || { firstDay: 1, lastDay: 7, slots: [] };
  return (
    <FormLayout>
      <FormLayout.Group>
        <TextField label="Name shoppers see" value={str(m.name)} onChange={setM('name')} maxLength={60} error={err(`methods.${i}.name`)} autoComplete="off" />
        <TextField label="Short note (optional)" value={str(m.description)} onChange={setM('description')} maxLength={120} placeholder="e.g. Delivered by our own riders" autoComplete="off" />
      </FormLayout.Group>
      <RateEditor rate={m.rate} onChange={setM('rate')} err={err} path={`methods.${i}.rate`} cur={cur} />
      {m.rate?.type !== 'free' && (
        <TextField
          label="Free from order value"
          type="number"
          min={0}
          prefix={cur}
          value={opt(m.freeAbove)}
          onChange={setM('freeAbove')}
          placeholder="Never"
          error={err(`methods.${i}.freeAbove`)}
          helpText="Order value after discounts. Shoppers below it see how much more they need. Extra charges marked “also on free shipping” still apply."
          autoComplete="off"
        />
      )}
      {timed && (
        <TextField
          label="Order by"
          type="time"
          value={str(m.cutoff)}
          onChange={setM('cutoff')}
          error={err(`methods.${i}.cutoff`)}
          helpText={m.kind === 'same_day'
            ? 'Offered only before this time, on working days (Delivery dates). Arrives today.'
            : 'Offered only before this time. Arrives the next working day.'}
          autoComplete="off"
        />
      )}
      {m.kind === 'scheduled' && (
        <>
          <FormLayout.Group condensed>
            <TextField label="Earliest day" type="number" min={1} max={30} suffix="days ahead" value={str(sched.firstDay)} onChange={(v) => setM('schedule')({ ...sched, firstDay: v })} error={err(`methods.${i}.schedule.firstDay`)} autoComplete="off" />
            <TextField label="Latest day" type="number" min={1} max={30} suffix="days ahead" value={str(sched.lastDay)} onChange={(v) => setM('schedule')({ ...sched, lastDay: v })} error={err(`methods.${i}.schedule.lastDay`)} autoComplete="off" />
          </FormLayout.Group>
          <Text as="p" variant="bodySm" tone="subdued">Shoppers pick a working day in this window, never before the order is packed (Delivery dates).</Text>
          <ChipInput
            label="Time slots (optional)"
            value={(sched.slots || []).join(', ')}
            onChange={(s) => setM('schedule')({ ...sched, slots: splitList(s).map((x) => x.replace(/\s+/g, '')) })}
            placeholder="10:00-13:00"
            helpText={(sched.slots || []).length ? (sched.slots || []).filter((x) => SLOT_RE.test(x)).map(slotLabel).join(' · ') : 'Start-end in 24-hour time, e.g. 10:00-13:00. None = the shopper picks a day only.'}
            error={err(`methods.${i}.schedule.slots`)}
            isValid={(x) => SLOT_RE.test(x) && x.slice(0, 5) < x.slice(6)}
          />
        </>
      )}
      {!timed && m.kind !== 'scheduled' && (
        <FormLayout.Group condensed>
          <TextField label="Arrives in at least" type="number" min={0} max={60} suffix="days" value={str(m.days?.min)} onChange={(v) => setM('days')({ ...(m.days || {}), min: v })} error={err(`methods.${i}.days.min`)} autoComplete="off" />
          <TextField label="At most" type="number" min={0} max={60} suffix="days" value={str(m.days?.max)} onChange={(v) => setM('days')({ ...(m.days || {}), max: v })} error={err(`methods.${i}.days.max`)} helpText="Working days after it's dispatched." autoComplete="off" />
        </FormLayout.Group>
      )}
      <ZonePicks zones={zones} value={m.zones} onChange={setM('zones')} title="Offer only in these zones (none ticked = everywhere)" />
      <InlineStack><Button variant="plain" disclosure={more ? 'up' : 'down'} onClick={() => setMore(!more)}>Limits, zone prices and zone delivery times</Button></InlineStack>
      {more && (
        <BlockStack gap="400">
          <FormLayout.Group condensed>
            <TextField label="Order value from" type="number" min={0} prefix={cur} value={opt(m.minOrder)} onChange={setM('minOrder')} placeholder="Any" error={err(`methods.${i}.minOrder`)} autoComplete="off" />
            <TextField label="Order value up to" type="number" min={0} prefix={cur} value={opt(m.maxOrder)} onChange={setM('maxOrder')} placeholder="Any" error={err(`methods.${i}.maxOrder`)} autoComplete="off" />
            <TextField label="Heaviest order" type="number" min={0} suffix="g" value={opt(m.maxGrams)} onChange={setM('maxGrams')} placeholder="Any" error={err(`methods.${i}.maxGrams`)} autoComplete="off" />
          </FormLayout.Group>
          <BlockStack gap="200">
            <Text as="h4" variant="headingSm">Price by zone</Text>
            <Text as="p" variant="bodySm" tone="subdued">{zones.length ? 'A different price for addresses in a zone. Other addresses pay the price above.' : 'Add zones in the Zones section first.'}</Text>
            {zones.length > 0 && (
              <ZoneRows
                zones={zones}
                rows={m.zoneRates}
                onChange={setM('zoneRates')}
                newRow={(zone) => ({ zone, rate: { ...(m.rate || { type: 'flat', amount: '' }) } })}
                addLabel="Add a zone price"
                renderRow={(r, j, patch) => <RateEditor rate={r.rate} onChange={(rate) => patch({ rate })} err={err} path={`methods.${i}.zoneRates.${j}.rate`} cur={cur} label="Price in this zone" />}
              />
            )}
          </BlockStack>
          {!timed && m.kind !== 'scheduled' && zones.length > 0 && (
            <BlockStack gap="200">
              <Text as="h4" variant="headingSm">Delivery time by zone</Text>
              <ZoneRows
                zones={zones}
                rows={m.zoneDays}
                onChange={setM('zoneDays')}
                newRow={(zone) => ({ zone, min: m.days?.min ?? 3, max: m.days?.max ?? 5 })}
                addLabel="Add a zone delivery time"
                renderRow={(r, _j, patch) => (
                  <FormLayout.Group condensed>
                    <TextField label="At least" type="number" min={0} max={60} suffix="days" value={str(r.min)} onChange={(v) => patch({ min: v })} autoComplete="off" />
                    <TextField label="At most" type="number" min={0} max={60} suffix="days" value={str(r.max)} onChange={(v) => patch({ max: v })} autoComplete="off" />
                  </FormLayout.Group>
                )}
              />
            </BlockStack>
          )}
        </BlockStack>
      )}
    </FormLayout>
  );
}

function MethodsEditor({ ship, setShip, err, errors, cur, fmt }) {
  const methods = ship.methods || [];
  const at = setterFor(setShip);
  const [open, setOpen] = useState(() => (methods.length === 1 ? methods[0].id : null));
  const [addKind, setAddKind] = useState('express');
  const add = () => {
    const taken = new Set(methods.map((m) => m.id));
    const m = newMethod(addKind, addKind === 'standard' && taken.has('standard') ? `standard-${randomId()}` : null);
    setShip((c) => ({ ...c, methods: [...(c.methods || []), m] }));
    setOpen(m.id);
  };
  const cardErrors = (i) => countShipErrors(errors, [`methods.${i}`]);
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h3" variant="headingMd">Delivery options</Text>
        <Text as="span" variant="bodySm" tone="subdued">{methods.length} of {SHIP_LIMITS.methods}</Text>
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">Shoppers pick one in the COD popup, with its price and delivery date. The first one that&apos;s available is picked for them.</Text>
      {err('methods') && <Banner tone="critical">{err('methods')}</Banner>}
      {methods.map((m, i) => (
        <ItemCard
          key={m.id}
          title={str(m.name) || KIND_LABEL[m.kind]}
          kind={KIND_LABEL[m.kind]}
          summary={methodSummary(m, ship.zones || [], fmt)}
          open={open === m.id}
          onToggle={() => setOpen(open === m.id ? null : m.id)}
          enabled={m.enabled !== false}
          onEnabled={at(['methods', i, 'enabled'])}
          onUp={i > 0 ? () => setShip((c) => ({ ...c, methods: move(c.methods, i, -1) })) : null}
          onDown={i < methods.length - 1 ? () => setShip((c) => ({ ...c, methods: move(c.methods, i, 1) })) : null}
          onDelete={methods.length > 1 ? () => setShip((c) => ({ ...c, methods: c.methods.filter((_, j) => j !== i) })) : null}
          errorCount={cardErrors(i)}
        >
          <MethodBody m={m} i={i} ship={ship} at={at} err={err} cur={cur} />
        </ItemCard>
      ))}
      {methods.length < SHIP_LIMITS.methods && (
        <div className="shp-adder">
          <div style={{ flex: 1 }}><Select label="Add a delivery option" options={KIND_OPTIONS} value={addKind} onChange={setAddKind} /></div>
          <Button icon={PlusIcon} onClick={add}>Add</Button>
        </div>
      )}
    </BlockStack>
  );
}

export function ShippingChargesSection({ form, set, errors, ship, setShip, shipErrors, cur, fmt, onModeChange }) {
  const advanced = form.shippingMode === 'advanced';
  const err = (k) => shipErrors[k];
  const at = setterFor(setShip);
  const fi = ship.freeItems || { products: [], collections: [], tags: [] };
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">Shipping charged on COD orders, shown to shoppers before they order. Online (prepaid) orders keep your Shopify shipping rates.</Text>
      <Card>
        <ChoiceList
          title="How shipping is charged"
          choices={[
            { label: 'One price', value: 'simple', helpText: 'The same shipping on every order, free from an order value.' },
            { label: 'Dynamic shipping', value: 'advanced', helpText: 'Delivery options (standard, express, same day, next day, scheduled) priced by zone, state, city, PIN code, weight, order value or number of items, with rules, extra charges and delivery dates.' },
          ]}
          selected={[advanced ? 'advanced' : 'simple']}
          onChange={([v]) => onModeChange(v)}
        />
      </Card>
      {!advanced && (
        <Card>
          <FormLayout>
            <TextField label="Shipping" type="number" min={0} value={form.shippingFee} onChange={set('shippingFee')} placeholder="Free" prefix={cur} error={errors.shippingFee} helpText="Leave empty for free shipping" autoComplete="off" />
            <TextField label="Free shipping from" type="number" min={0} value={form.freeShippingAbove} onChange={set('freeShippingAbove')} placeholder="Never" prefix={cur} error={errors.freeShippingAbove} helpText="Order value after discounts" autoComplete="off" />
          </FormLayout>
        </Card>
      )}
      {advanced && (
        <>
          <MethodsEditor ship={ship} setShip={setShip} err={err} errors={shipErrors} cur={cur} fmt={fmt} />
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Products that ship free</Text>
              <Text as="p" variant="bodySm" tone="subdued">Their price, items and weight never add to shipping. An order of only these ships free.</Text>
              <RefPicker type="product" value={fi.products} onChange={at(['freeItems', 'products'])} max={SHIP_LIMITS.products} />
              <RefPicker type="collection" value={fi.collections} onChange={at(['freeItems', 'collections'])} max={SHIP_LIMITS.collections} />
              <TagsField value={fi.tags} onChange={at(['freeItems', 'tags'])} helpText="Products with any of these tags ship free." />
            </BlockStack>
          </Card>
          <Text as="p" variant="bodySm" tone="subdued">Products that don&apos;t need shipping in Shopify (digital, gift cards) are left out too. Weights come from each variant&apos;s weight in Shopify; a variant without one counts as 0 g.</Text>
        </>
      )}
    </BlockStack>
  );
}

/* ───────────────────────── Zones ───────────────────────── */

// Deleting a zone also takes it out of everything that pointed at it.
function dropZone(config, id) {
  const noZone = (ids) => (ids || []).filter((z) => z !== id);
  const when = (w) => (w ? { ...w, zones: noZone(w.zones) } : w);
  return {
    ...config,
    zones: (config.zones || []).filter((z) => z.id !== id),
    methods: (config.methods || []).map((m) => ({
      ...m,
      zones: noZone(m.zones),
      zoneRates: (m.zoneRates || []).filter((r) => r.zone !== id),
      zoneDays: (m.zoneDays || []).filter((r) => r.zone !== id),
    })),
    rules: (config.rules || []).map((r) => ({ ...r, when: when(r.when) })),
    charges: (config.charges || []).map((c) => ({ ...c, when: when(c.when) })),
    blocked: { ...(config.blocked || {}), zones: noZone(config.blocked?.zones) },
  };
}

function zoneSummary(z) {
  const cities = Array.isArray(z.cities) ? z.cities.length : splitList(z.cities).length;
  const pins = parsePinList(z.pins).pins.length;
  const parts = [
    (z.states || []).length ? `${z.states.length} state${z.states.length === 1 ? '' : 's'}` : '',
    cities ? `${cities} cit${cities === 1 ? 'y' : 'ies'}` : '',
    pins ? `${pins.toLocaleString('en-IN')} PIN ${pins === 1 ? 'entry' : 'entries'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Empty: add states, cities or PIN codes';
}

export function ShippingZonesSection({ ship, setShip, shipErrors }) {
  const err = (k) => shipErrors[k];
  const zones = ship.zones || [];
  const [open, setOpen] = useState(null);
  const [preset, setPreset] = useState('metro');
  const add = () => {
    const z = newZone(preset);
    setShip((c) => ({ ...c, zones: [...(c.zones || []), z] }));
    setOpen(z.id);
  };
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">Groups of places (Local, Metro, Remote…) you can price, time or block together. Use them in delivery options, rules, extra charges and Don&apos;t deliver to.</Text>
      {err('zones') && <Banner tone="critical">{err('zones')}</Banner>}
      {zones.length > 1 && <Text as="p" variant="bodySm" tone="subdued">An address in more than one zone gets the first zone&apos;s price and delivery time. Order them with the arrows.</Text>}
      {zones.map((z, i) => (
        <ItemCard
          key={z.id}
          title={str(z.name) || `Zone ${i + 1}`}
          summary={zoneSummary(z)}
          open={open === z.id}
          onToggle={() => setOpen(open === z.id ? null : z.id)}
          onUp={i > 0 ? () => setShip((c) => ({ ...c, zones: move(c.zones, i, -1) })) : null}
          onDown={i < zones.length - 1 ? () => setShip((c) => ({ ...c, zones: move(c.zones, i, 1) })) : null}
          onDelete={() => setShip((c) => dropZone(c, z.id))}
          errorCount={countShipErrors(shipErrors, [`zones.${i}`])}
        >
          <FormLayout>
            <TextField label="Zone name" value={str(z.name)} onChange={(v) => setShip((c) => setIn(c, ['zones', i, 'name'], v))} maxLength={40} error={err(`zones.${i}.name`)} helpText="Only you see it, in BRIX and on the order." autoComplete="off" />
            {err(`zones.${i}.where`) && <Text as="p" tone="critical" variant="bodySm">{err(`zones.${i}.where`)}</Text>}
            <PlaceFields place={z} onChange={(p) => setShip((c) => setIn(c, ['zones', i], { ...z, ...p }))} path={`zones.${i}`} err={err} />
            <Text as="p" variant="bodySm" tone="subdued">An address is in this zone when its state, city or PIN code is listed.</Text>
          </FormLayout>
        </ItemCard>
      ))}
      {zones.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No zones yet. Without zones every address pays each delivery option&apos;s own price.</Text>}
      {zones.length < SHIP_LIMITS.zones && (
        <div className="shp-adder">
          <div style={{ flex: 1 }}>
            <Select
              label="Add a zone"
              options={[
                { label: `${ZONE_PRESETS.metro.name} (8 big cities, ready to edit)`, value: 'metro' },
                { label: `${ZONE_PRESETS.remote.name} (North-East, J&K, Ladakh, islands)`, value: 'remote' },
                { label: 'Empty zone', value: 'local' },
              ]}
              value={preset}
              onChange={setPreset}
            />
          </div>
          <Button icon={PlusIcon} onClick={add}>Add</Button>
        </div>
      )}
    </BlockStack>
  );
}

/* ───────────────────────── Rules ───────────────────────── */

const THEN_OPTIONS = [
  { label: 'Charge this price', value: 'rate' },
  { label: 'Free shipping', value: 'free' },
  { label: 'Take a % off shipping', value: 'discount' },
  { label: 'Hide delivery options', value: 'hide' },
  { label: 'Don\'t deliver (no COD order)', value: 'block' },
];

function freshThen(type) {
  if (type === 'rate') return { type, rate: { type: 'flat', amount: '' } };
  if (type === 'discount') return { type, percent: '' };
  if (type === 'block') return { type, message: '' };
  return { type };
}

function describeThen(t, when, fmt) {
  if (!t) return '';
  if (t.type === 'rate') return `price ${describeRate(t.rate, fmt)}`;
  if (t.type === 'free') return 'free shipping';
  if (t.type === 'discount') return `${Number(t.percent) || 0}% off shipping`;
  if (t.type === 'hide') return (when?.methods || []).length ? 'hide those options' : 'hide every option';
  return 'don\'t deliver';
}

export function ShippingRulesSection({ ship, setShip, shipErrors, cur, fmt }) {
  const err = (k) => shipErrors[k];
  const rules = ship.rules || [];
  const at = setterFor(setShip);
  const [open, setOpen] = useState(null);
  const [addType, setAddType] = useState('rate');
  const ctx = { zones: ship.zones || [], methods: ship.methods || [], fmt };
  const add = () => {
    const r = newRule(addType === 'rate' ? 'rate' : addType);
    r.then = freshThen(addType);
    setShip((c) => ({ ...c, rules: [...(c.rules || []), r] }));
    setOpen(r.id);
  };
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">Change shipping for orders that match: by place, order value, items, weight, products or delivery option. Rules apply to every delivery option unless you pick some.</Text>
      {err('rules') && <Banner tone="critical">{err('rules')}</Banner>}
      <Card>
        <ChoiceList
          title="When more than one price rule matches"
          choices={[
            { label: 'Use the first one in the list', value: 'first' },
            { label: 'Use the cheapest', value: 'lowest' },
            { label: 'Use the dearest', value: 'highest' },
          ]}
          selected={[ship.priority || 'first']}
          onChange={([v]) => at(['priority'])(v)}
        />
        <Text as="p" variant="bodySm" tone="subdued">No price rule matches = the delivery option&apos;s own price (its zone price first). Discounts add up (at most 100%). Don&apos;t deliver and Hide always win.</Text>
      </Card>
      {rules.map((r, i) => {
        const p = ['rules', i];
        const t = r.then || { type: 'rate' };
        return (
          <ItemCard
            key={r.id}
            title={str(r.name) || `Rule ${i + 1}`}
            summary={`If ${describeWhen(r.when, ctx).replace(/^Every order$/, 'any order')} → ${describeThen(t, r.when, fmt)}`}
            open={open === r.id}
            onToggle={() => setOpen(open === r.id ? null : r.id)}
            enabled={r.enabled !== false}
            onEnabled={at([...p, 'enabled'])}
            onUp={i > 0 ? () => setShip((c) => ({ ...c, rules: move(c.rules, i, -1) })) : null}
            onDown={i < rules.length - 1 ? () => setShip((c) => ({ ...c, rules: move(c.rules, i, 1) })) : null}
            onDelete={() => setShip((c) => ({ ...c, rules: c.rules.filter((_, j) => j !== i) }))}
            errorCount={countShipErrors(shipErrors, [`rules.${i}`])}
          >
            <FormLayout>
              <TextField label="Rule name" value={str(r.name)} onChange={at([...p, 'name'])} maxLength={60} placeholder={`Rule ${i + 1}`} helpText="Only you see it (Test calculator)." autoComplete="off" />
              <WhenEditor when={r.when} onChange={at([...p, 'when'])} path={`rules.${i}.when`} err={err} zones={ctx.zones} methods={ctx.methods} cur={cur} />
              <Text as="h4" variant="headingSm">Then</Text>
              <Select label="What happens" labelHidden options={THEN_OPTIONS} value={t.type} onChange={(v) => at([...p, 'then'])(freshThen(v))} />
              {t.type === 'rate' && <RateEditor rate={t.rate} onChange={(rate) => at([...p, 'then'])({ ...t, rate })} err={err} path={`rules.${i}.then.rate`} cur={cur} />}
              {t.type === 'discount' && (
                <TextField label="Off shipping" type="number" min={1} max={100} suffix="%" value={str(t.percent)} onChange={(v) => at([...p, 'then'])({ ...t, percent: v })} error={err(`rules.${i}.then.percent`)} helpText="Extra charges are never discounted." autoComplete="off" />
              )}
              {t.type === 'hide' && (
                <Text as="p" variant="bodySm" tone="subdued">{(r.when?.methods || []).length ? 'The delivery options picked under Conditions are hidden for matching orders.' : 'No delivery option is picked under Conditions, so every option is hidden and matching orders can\'t use COD. Add a Delivery option condition to hide only some.'}</Text>
              )}
              {t.type === 'block' && (
                <TextField
                  label="Message shoppers see"
                  value={str(t.message)}
                  onChange={(v) => at([...p, 'then'])({ ...t, message: v })}
                  maxLength={160}
                  placeholder="We don't deliver this order by Cash on Delivery. Please pay online."
                  helpText={(r.when?.methods || []).length ? 'With delivery options picked, only those are hidden; the order can still use the others.' : 'Matching orders can\'t use COD; they can still pay online.'}
                  autoComplete="off"
                />
              )}
            </FormLayout>
          </ItemCard>
        );
      })}
      {rules.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No rules yet. Examples: free shipping in Metro cities above ₹999, ₹120 for orders over 5 kg, no express to remote areas.</Text>}
      {rules.length < SHIP_LIMITS.rules && (
        <div className="shp-adder">
          <div style={{ flex: 1 }}><Select label="Add a rule" options={THEN_OPTIONS} value={addType} onChange={setAddType} /></div>
          <Button icon={PlusIcon} onClick={add}>Add</Button>
        </div>
      )}
    </BlockStack>
  );
}

/* ───────────────────────── Extra charges ───────────────────────── */

const CHARGE_LABEL = { handling: 'Handling fee', remote: 'Remote area', fragile: 'Fragile items', oversized: 'Oversized items', packages: 'Extra packages', custom: 'Other' };
const CHARGE_HELP = {
  handling: 'A packing or handling fee on every order.',
  remote: 'Extra for hard-to-reach places: pick the zones, states or PIN codes under Conditions.',
  fragile: 'For items that need careful packing: products with the tags under Conditions.',
  oversized: 'For bulky items: products with the tags under Conditions.',
  packages: 'Orders heavier than one package pay for each extra package.',
  custom: 'Any other charge, with your own conditions.',
};
const PER_OPTIONS = [
  { label: 'per order', value: 'order' },
  { label: 'per product in the order', value: 'item' },
  { label: 'per item (every unit)', value: 'unit' },
  { label: 'per extra package', value: 'package' },
];

function chargeSummary(ch, ctx, fmt) {
  const per = { order: '', item: ' per product', unit: ' per item', package: ' per extra package' }[ch.per] || '';
  const pct = ch.per === 'order' && Number(ch.percent) > 0 ? ` + ${Number(ch.percent)}%` : '';
  return `${fmt(Number(ch.amount) || 0)}${per}${pct} · ${describeWhen(ch.when, ctx)}${ch.alsoWhenFree ? '' : ' · not on free shipping'}`;
}

export function ShippingExtraChargesSection({ ship, setShip, shipErrors, cur, fmt }) {
  const err = (k) => shipErrors[k];
  const charges = ship.charges || [];
  const at = setterFor(setShip);
  const [open, setOpen] = useState(null);
  const [addKind, setAddKind] = useState('handling');
  const ctx = { zones: ship.zones || [], methods: ship.methods || [], fmt };
  const add = () => {
    const ch = newCharge(addKind);
    // A remote area charge starts on the Remote zone when there is one.
    const remote = (ship.zones || []).find((z) => /remote/i.test(z.name || ''));
    if (addKind === 'remote' && remote) ch.when = { ...ch.when, zones: [remote.id] };
    setShip((c) => ({ ...c, charges: [...(c.charges || []), ch] }));
    setOpen(ch.id);
  };
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">Added on top of the delivery option&apos;s price, shown to shoppers as part of shipping. Shipping discounts never take them off.</Text>
      {charges.map((ch, i) => {
        const p = ['charges', i];
        return (
          <ItemCard
            key={ch.id}
            title={str(ch.name) || CHARGE_LABEL[ch.kind]}
            kind={CHARGE_LABEL[ch.kind]}
            summary={chargeSummary(ch, ctx, fmt)}
            open={open === ch.id}
            onToggle={() => setOpen(open === ch.id ? null : ch.id)}
            enabled={ch.enabled !== false}
            onEnabled={at([...p, 'enabled'])}
            onUp={i > 0 ? () => setShip((c) => ({ ...c, charges: move(c.charges, i, -1) })) : null}
            onDown={i < charges.length - 1 ? () => setShip((c) => ({ ...c, charges: move(c.charges, i, 1) })) : null}
            onDelete={() => setShip((c) => ({ ...c, charges: c.charges.filter((_, j) => j !== i) }))}
            errorCount={countShipErrors(shipErrors, [`charges.${i}`])}
          >
            <FormLayout>
              <Text as="p" variant="bodySm" tone="subdued">{CHARGE_HELP[ch.kind]}</Text>
              <TextField label="Name" value={str(ch.name)} onChange={at([...p, 'name'])} maxLength={60} error={err(`charges.${i}.name`)} helpText="Only you see it; shoppers see one Shipping line." autoComplete="off" />
              <FormLayout.Group condensed>
                <TextField label="Amount" type="number" min={0} prefix={cur} value={str(ch.amount)} onChange={at([...p, 'amount'])} error={err(`charges.${i}.amount`)} autoComplete="off" />
                <Select label="Charged" options={PER_OPTIONS} value={ch.per} onChange={at([...p, 'per'])} />
              </FormLayout.Group>
              {ch.per === 'order' && (
                <TextField label="Plus % of the order value (optional)" type="number" min={0} max={100} suffix="%" value={opt(ch.percent)} onChange={at([...p, 'percent'])} placeholder="0" error={err(`charges.${i}.percent`)} autoComplete="off" />
              )}
              {ch.per === 'package' && (
                <TextField
                  label="One package holds up to"
                  type="number"
                  min={1}
                  suffix="g"
                  value={str(ch.packageGrams)}
                  onChange={at([...p, 'packageGrams'])}
                  error={err(`charges.${i}.packageGrams`)}
                  helpText={`${grams(ch.packageGrams)}. The first package is in the shipping price; each one after it costs the amount.`}
                  autoComplete="off"
                />
              )}
              {(ch.per === 'item' || ch.per === 'unit') && (
                <Text as="p" variant="bodySm" tone="subdued">With products, collections or tags under Conditions, only those items are counted; otherwise every item that pays shipping.</Text>
              )}
              <Checkbox label="Also on free shipping" checked={Boolean(ch.alsoWhenFree)} onChange={at([...p, 'alsoWhenFree'])} helpText="Off: waived whenever the order ships free." />
              <WhenEditor when={ch.when} onChange={at([...p, 'when'])} path={`charges.${i}.when`} err={err} zones={ctx.zones} methods={ctx.methods} cur={cur} />
            </FormLayout>
          </ItemCard>
        );
      })}
      {charges.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No extra charges.</Text>}
      {charges.length < SHIP_LIMITS.charges && (
        <div className="shp-adder">
          <div style={{ flex: 1 }}><Select label="Add a charge" options={CHARGE_KINDS.map((k) => ({ label: CHARGE_LABEL[k], value: k }))} value={addKind} onChange={setAddKind} /></div>
          <Button icon={PlusIcon} onClick={add}>Add</Button>
        </div>
      )}
    </BlockStack>
  );
}

/* ───────────────────────── Delivery dates ───────────────────────── */

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Colombo', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function DeliveryDatesSection({ ship, setShip, shipErrors }) {
  const err = (k) => shipErrors[k];
  const d = ship.delivery || {};
  const at = setterFor(setShip);
  const set = (k) => at(['delivery', k]);
  const work = new Set((d.workDays || []).map(Number));
  const tz = d.timezone || 'Asia/Kolkata';
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">How BRIX works out the delivery dates shoppers see: when you dispatch, and which days you and your courier work.</Text>
      <Card>
        <FormLayout>
          <FormLayout.Group condensed>
            <TextField label="Days to pack an order" type="number" min={0} max={30} suffix="working days" value={str(d.processingDays)} onChange={set('processingDays')} error={err('delivery.processingDays')} helpText="Before it's dispatched. 0 = the same day." autoComplete="off" />
            <TextField label="Daily cut-off" type="time" value={str(d.cutoff)} onChange={set('cutoff')} error={err('delivery.cutoff')} helpText="Orders after it start the next working day." autoComplete="off" />
          </FormLayout.Group>
          <BlockStack gap="150">
            <Text as="p">Working days</Text>
            <div className="shp-days">
              {WEEK.map((n) => (
                <Checkbox
                  key={n}
                  label={WEEKDAY_NAMES[n]}
                  checked={work.has(n)}
                  onChange={(on) => set('workDays')(WEEK.filter((x) => (x === n ? on : work.has(x))))}
                />
              ))}
            </div>
            {err('delivery.workDays') && <Text as="p" tone="critical" variant="bodySm">{err('delivery.workDays')}</Text>}
            <Text as="p" variant="bodySm" tone="subdued">Orders are dispatched and delivered only on these days.</Text>
          </BlockStack>
          <ChipInput
            label="Holidays"
            value={(Array.isArray(d.holidays) ? d.holidays : splitList(d.holidays)).join(', ')}
            onChange={(s) => set('holidays')(splitList(s))}
            placeholder="2026-11-08"
            helpText="No dispatch or delivery on these dates (YYYY-MM-DD)."
            error={err('delivery.holidays')}
            isValid={(x) => DATE_RE.test(x)}
          />
          <Select label="Time zone" options={(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]).map((z) => ({ label: z.replace(/_/g, ' '), value: z }))} value={tz} onChange={set('timezone')} />
          <Checkbox label="Show expected delivery dates to shoppers" checked={d.showEta !== false} onChange={set('showEta')} helpText="Off: shoppers see the delivery options and prices without dates. Scheduled delivery always shows its days." />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}

/* ───────────────────────── Don't deliver to ───────────────────────── */

export function DontDeliverSection({ ship, setShip, shipErrors }) {
  const err = (k) => shipErrors[k];
  const b = ship.blocked || {};
  const at = setterFor(setShip);
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">Places you don&apos;t deliver COD orders to. Shoppers there see your message at review and can still pay online.</Text>
      <Card>
        <FormLayout>
          <PlaceFields place={b} onChange={(p) => at(['blocked'])({ ...b, ...p })} path="blocked" err={err} zones={ship.zones || []} zonesTitle="Zones" />
          <TextField
            label="Message shoppers see"
            value={str(b.message)}
            onChange={at(['blocked', 'message'])}
            maxLength={160}
            placeholder="We don’t deliver to this address yet. Please try another address."
            autoComplete="off"
          />
        </FormLayout>
      </Card>
      <Text as="p" variant="bodySm" tone="subdued">Fraud protection → Blocked PIN codes still applies too. For conditions beyond the address (e.g. orders over 20 kg), add a Don&apos;t deliver rule.</Text>
    </BlockStack>
  );
}

/* ───────────────────────── Test calculator ───────────────────────── */

export const DEFAULT_SHIP_TEST = Object.freeze({ pincode: '560001', city: 'Bengaluru', state: 'Karnataka', items: '2', grams: '800', tags: '', at: '', choice: {} });

/** The sample cart's lines for quoteShipping (one line holding every item). */
export function shipTestLines(test, cart) {
  const items = Math.max(1, Math.trunc(Number(test.items) || 1));
  const total = Math.max(0, Number(test.grams) || 0);
  return [{
    productId: 'gid://shopify/Product/0',
    quantity: items,
    value: Math.max(0, Number(cart) || 0),
    unitGrams: total / items,
    tags: splitList(test.tags),
    collections: [],
  }];
}

/** The sample address (null without a PIN code, city or state: "before the address"). */
export function shipTestDestination(test) {
  const d = { pincode: str(test.pincode).trim(), city: str(test.city).trim(), state: str(test.state).trim() };
  return d.pincode || d.city || d.state ? d : null;
}

export function shipTestNow(test) {
  const t = test.at ? new Date(test.at) : null;
  return t && !Number.isNaN(t.getTime()) ? t : new Date();
}

function etaText(o) {
  if (o.dates) return `Shopper picks a day: ${o.dates.slice(0, 3).map((x) => x.label).join(', ')}${o.dates.length > 3 ? '…' : ''}`;
  if (!o.eta) return 'No dates shown (Delivery dates)';
  return `Arrives ${/^(Today|Tomorrow)$/.test(o.eta.label) ? o.eta.label.toLowerCase() : o.eta.label}`;
}

export function ShippingTestSection({ test, setTest, cart, setCart, result, money, cur }) {
  const set = (k) => (v) => setTest((t) => ({ ...t, [k]: v }));
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">Try an address and cart with the settings on screen (saved or not). The COD checkout preview shows what this shopper sees.</Text>
      <Card>
        <FormLayout>
          <FormLayout.Group condensed>
            <TextField label="PIN code" value={str(test.pincode)} onChange={(v) => set('pincode')(v.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} autoComplete="off" />
            <TextField label="City" value={str(test.city)} onChange={set('city')} autoComplete="off" />
            <Select label="State" options={[{ label: 'Not given', value: '' }, ...INDIAN_STATES.map((s) => ({ label: s, value: s }))]} value={str(test.state)} onChange={set('state')} />
          </FormLayout.Group>
          <FormLayout.Group condensed>
            <TextField label="Order value" type="number" min={0} prefix={cur} value={String(cart)} onChange={(v) => setCart(Math.max(0, Number(v) || 0))} helpText="After discounts" autoComplete="off" />
            <TextField label="Items" type="number" min={1} value={str(test.items)} onChange={set('items')} autoComplete="off" />
            <TextField label="Total weight" type="number" min={0} suffix="g" value={str(test.grams)} onChange={set('grams')} helpText={grams(test.grams)} autoComplete="off" />
          </FormLayout.Group>
          <FormLayout.Group condensed>
            <TextField label="Product tags (optional)" value={str(test.tags)} onChange={set('tags')} placeholder="fragile, oversized" helpText="For rules and charges by tag." autoComplete="off" />
            <TextField label="Ordered at (optional)" type="datetime-local" value={str(test.at)} onChange={set('at')} helpText="Empty = now (same-day and next-day cut-offs)." autoComplete="off" />
          </FormLayout.Group>
        </FormLayout>
      </Card>
      <Card>
        <ShipTestResult result={result} money={money} onPick={(id) => setTest((t) => ({ ...t, choice: { option: id } }))} />
      </Card>
    </BlockStack>
  );
}

function ShipTestResult({ result, money, onPick }) {
  if (!result) return null;
  if (result.blocked) {
    return (
      <Banner tone="critical" title="No COD delivery here">
        {result.blocked.message} {result.blocked.by === 'area' ? '(Don’t deliver to)' : `(rule “${result.blocked.by}”)`}
      </Banner>
    );
  }
  return (
    <BlockStack gap="300">
      <InlineStack gap="200" blockAlign="center">
        <Text as="h3" variant="headingMd">What the shopper gets</Text>
        {result.zone ? <Badge tone="info">{`Zone: ${result.zone.name}`}</Badge> : <Badge>No zone</Badge>}
      </InlineStack>
      {result.noShipping && <Text as="p">Nothing in this order needs shipping, so shipping is free.</Text>}
      {!result.noShipping && !result.options.length && (
        <Banner tone="warning">No delivery option is offered, so this shopper can&apos;t use COD for this address and cart.</Banner>
      )}
      {result.options.map((o) => {
        const on = o.id === result.selected?.id;
        return (
          <button key={o.id} type="button" className={`shp-res${on ? ' on' : ''}`} onClick={() => onPick(o.id)} aria-pressed={on}>
            <span className="shp-res-h"><b>{o.name}</b><b>{o.price > 0 ? money(o.price) : 'Free'}</b></span>
            <span className="shp-res-s">{etaText(o)}{o.slots ? ` · ${o.slots.length} time slots` : ''}</span>
            <span className="shp-steps">
              {o.steps.map((s, i) => (
                // eslint-disable-next-line react/no-array-index-key -- steps are an ordered breakdown
                <span key={i} className="shp-step"><span>{s.charge ? '+ ' : ''}{s.label}</span><span>{s.amount < 0 ? `−${money(-s.amount)}` : money(s.amount)}</span></span>
              ))}
            </span>
            {o.freeIn > 0 && <span className="shp-res-s">{money(o.freeIn)} more for free shipping</span>}
          </button>
        );
      })}
      {result.unavailable.length > 0 && (
        <BlockStack gap="100">
          <Text as="h4" variant="headingSm">Not offered</Text>
          {result.unavailable.map((u) => <Text key={u.id} as="p" variant="bodySm" tone="subdued">{u.name}: {u.reason}</Text>)}
        </BlockStack>
      )}
      <Text as="p" variant="bodySm" tone="subdued">Real orders use Shopify&apos;s prices and each variant&apos;s weight. Click an option to preview it picked.</Text>
    </BlockStack>
  );
}

export const SHIP_CSS = `
.shp-card{border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px #e3e3e3}
.shp-card.is-open{box-shadow:inset 0 0 0 1px #c9cccf,0 1px 3px rgba(0,0,0,.06)}
.shp-card.is-off .shp-card-t{opacity:.6}
.shp-card-h{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px}
.shp-card-on{flex:none;display:flex}
.shp-card-t{all:unset;cursor:pointer;flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.shp-card-t:focus-visible{outline:2px solid #005bd3;outline-offset:2px;border-radius:6px}
.shp-card-n{font-weight:650;font-size:13.5px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.shp-card-s{font-size:12.5px;color:#616161;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shp-card-a{flex:none;display:flex;align-items:center;gap:2px}
.shp-card-b{padding:12px 14px 16px;border-top:1px solid #f0f0f0}
.shp-kind{font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;background:#f1f1f1;color:#4a4a4a}
.shp-tier{display:grid;grid-template-columns:1fr 1fr 28px;gap:8px;align-items:start}
.shp-tier-x{padding-top:4px}.shp-tier-x.first{padding-top:0}
.shp-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;padding:10px;border-radius:10px;background:#f7f7f7}
.shp-cond{border-radius:10px;background:#f7f7f7;padding:8px 10px 12px}
.shp-cond-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:650;font-size:13px}
.shp-add{display:flex;flex-wrap:wrap;gap:6px}
.shp-adder{display:flex;gap:8px;align-items:flex-end}
.shp-days{display:flex;flex-wrap:wrap;gap:4px 16px}
.shp-res{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:4px;width:100%;padding:10px 12px;border-radius:10px;box-shadow:inset 0 0 0 1px #e3e3e3;background:#fff}
.shp-res.on{box-shadow:inset 0 0 0 2px #303030}
.shp-res:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.shp-res-h{display:flex;justify-content:space-between;gap:8px;font-size:14px}
.shp-res-s{font-size:12.5px;color:#616161}
.shp-steps{display:flex;flex-direction:column;gap:2px;margin-top:2px;padding-top:6px;border-top:1px dashed #e3e3e3}
.shp-step{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:#4a4a4a;font-variant-numeric:tabular-nums}
`;
