/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useState } from 'react';
import { BlockStack, Button, InlineStack, Text, TextField } from '@shopify/polaris';

const SHOW = 24;

// Comma-separated value edited as removable chips. Typing a separator (or
// pasting a list) turns the text into chips; invalid entries stay visible in red
// so the merchant can see exactly what to fix.
export default function ChipInput({ label, value, onChange, placeholder, helpText, error, isValid = () => true, splitOnSpace = false, emptyText }) {
  const [draft, setDraft] = useState('');
  const [showAll, setShowAll] = useState(false);
  const splitter = splitOnSpace ? /[\s,]+/ : /[,\n]+/;
  const items = value.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);

  const add = (raw) => {
    const parts = String(raw).split(splitter).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...items, ...parts])].join(', '));
    setDraft('');
  };
  const remove = (item) => onChange(items.filter((x) => x !== item).join(', '));
  const onDraft = (next) => {
    if (splitter.test(next.replace(/^\s+/, ''))) add(next);
    else setDraft(next);
  };
  const visible = showAll ? items : items.slice(0, SHOW);

  return (
    <BlockStack gap="200">
      <form onSubmit={(e) => { e.preventDefault(); add(draft); }}>
        <TextField
          label={label}
          value={draft}
          onChange={onDraft}
          placeholder={placeholder}
          helpText={helpText}
          error={error}
          autoComplete="off"
          connectedRight={<Button onClick={() => add(draft)} disabled={!draft.trim()}>Add</Button>}
        />
      </form>
      {items.length ? (
        <div className="cod-chips">
          {visible.map((item) => {
            const ok = isValid(item);
            return (
              <span key={item} className={`cod-chip${ok ? '' : ' bad'}`} title={ok ? undefined : 'Not valid, will be skipped'}>
                {item}
                <button type="button" aria-label={`Remove ${item}`} onClick={() => remove(item)}>×</button>
              </span>
            );
          })}
          {items.length > SHOW && (
            <Button variant="plain" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `+${items.length - SHOW} more`}</Button>
          )}
        </div>
      ) : (
        emptyText ? <Text as="p" variant="bodySm" tone="subdued">{emptyText}</Text> : null
      )}
      {items.length > 1 && (
        <InlineStack align="space-between">
          <Text as="span" variant="bodySm" tone="subdued">{items.length} added</Text>
          <Button variant="plain" tone="critical" onClick={() => onChange('')}>Clear all</Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}
