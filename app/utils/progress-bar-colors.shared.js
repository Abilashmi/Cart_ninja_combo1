// Flat colour keys older editors saved in progress_data next to `colors`.
// The storefront used to read them first, so once present they silently beat
// the Colour pickers. withoutLegacyBarColors folds them into `colors` (only
// where `colors` has no value) and drops them, so they are never saved again.
// cart_drawer_inline.js parseProgressData reads `colors.*` first for blobs
// that still have them.
export const LEGACY_BAR_COLOR_KEYS = ['barBackgroundColor', 'barForegroundColor', 'fill_color', 'iconColor', 'icon_color', 'completionTextColor'];

export function withoutLegacyBarColors(pb) {
  if (!pb || typeof pb !== 'object') return pb;
  const c = pb.colors || {};
  const colors = {
    ...c,
    background: c.background || pb.barBackgroundColor || undefined,
    fill: c.fill || pb.barForegroundColor || pb.fill_color || undefined,
    icon: c.icon || pb.iconColor || pb.icon_color || undefined,
    message: c.message || pb.completionTextColor || undefined,
  };
  for (const k of Object.keys(colors)) if (colors[k] === undefined) delete colors[k];
  const next = { ...pb, colors };
  for (const k of LEGACY_BAR_COLOR_KEYS) delete next[k];
  return next;
}
