/**
 * Title / description alignment of a combo page, for desktop or phone.
 *
 * The builder used to save 'left' as the phone alignment on every template
 * (DEFAULT_COMBO_CONFIG), so a merchant who picked Center on desktop still
 * got Left on phones. A saved phone value now counts only when the merchant
 * picked it in the phone view (`<prefix>_align_mobile_set`, written by
 * ContentSection) or it isn't that old default; otherwise phones follow
 * desktop. ES5 copies of the same rule: combo-quickshop.shared.js alignOf and
 * combo-page[.]js.jsx alignFor.
 */
export function comboAlign(config, prefix, isMobile) {
  const c = config || {};
  const valid = (v) => v === 'left' || v === 'center' || v === 'right';
  const desktop = valid(c[`${prefix}_align`]) ? c[`${prefix}_align`] : 'left';
  if (!isMobile) return desktop;
  const phone = c[`${prefix}_align_mobile`];
  if (valid(phone) && (c[`${prefix}_align_mobile_set`] === true || phone !== 'left')) return phone;
  return desktop;
}
