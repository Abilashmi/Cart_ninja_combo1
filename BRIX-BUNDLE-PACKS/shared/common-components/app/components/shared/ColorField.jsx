import { useEffect, useState } from 'react';
import { TextField } from '@shopify/polaris';
import { HEX_ERROR, normalizeHex } from '../../utils/color.shared.js';

/**
 * The admin's one colour input: a hex text box with a swatch that opens the
 * browser's colour picker. Both stay in sync. A typed code is saved only once
 * it is a valid #rgb / #rrggbb (stored as #rrggbb); until then the box shows
 * an error and the last valid colour is kept.
 *
 * allowEmpty: clearing the box saves '' (the caller's "use the default");
 * fallback is the colour shown in the swatch and as the placeholder then.
 */
export function ColorField({ label, value, onChange, error, allowEmpty = false, fallback, helpText, labelHidden }) {
  const current = typeof value === 'string' ? value : '';
  const [draft, setDraft] = useState(current);

  // Follow outside changes (picker, reset, AI, reload) unless the box already
  // holds the same colour in another spelling (#abc vs #aabbcc).
  useEffect(() => {
    setDraft((d) => (normalizeHex(d) && normalizeHex(d) === normalizeHex(current) ? d : current));
  }, [current]);

  const empty = draft.trim() === '';
  const parsed = normalizeHex(draft);
  const invalid = empty ? !allowEmpty && current !== '' : !parsed;
  const swatch = parsed || normalizeHex(current) || normalizeHex(fallback) || '#ffffff';

  const handleText = (text) => {
    setDraft(text);
    if (text.trim() === '') {
      if (allowEmpty) onChange('');
      return;
    }
    const hex = normalizeHex(text);
    if (hex) onChange(hex);
  };

  const handlePicker = (hex) => {
    setDraft(hex);
    onChange(hex);
  };

  return (
    <div style={{ flex: 1 }}>
      <TextField
        label={label}
        labelHidden={labelHidden}
        value={draft}
        onChange={handleText}
        autoComplete="off"
        placeholder={allowEmpty && fallback ? fallback : '#000000'}
        helpText={helpText}
        error={error || (invalid ? HEX_ERROR : undefined)}
        prefix={
          <div style={{ position: 'relative' }}>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                backgroundColor: swatch,
                border: '1px solid #c9cccf',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              <input
                type="color"
                aria-label={`Pick ${label}`}
                value={swatch}
                onChange={(e) => handlePicker(e.target.value)}
                style={{
                  opacity: 0,
                  width: '100%',
                  height: '100%',
                  cursor: 'pointer',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                }}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}

export default ColorField;
