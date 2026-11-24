// Hex colour helpers shared by every colour input in the admin (ColorField,
// the Combo Forge ColorPickerField) so a typed code is checked the same way
// everywhere. Codes are #rgb or #rrggbb; "008060" without the # is accepted.

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for #rgb / #rrggbb (the # may be left out). */
export function isHexColor(value) {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

/** '#abc' / 'ABC' / '#AABBCC' → '#aabbcc'; anything else → null. */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(HEX_RE);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h);
}

export const HEX_ERROR = 'Enter a hex colour code like #008060';
