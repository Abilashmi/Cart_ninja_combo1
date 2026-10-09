// How the storefront draws the COD button (extensions/cart-drawer/assets/brix_cod.js
// buttonPaint / drawerSize / feeHint), for the admin's previews. Keep in step.
import { COD_FEE_LABEL_DEFAULT, codFeeOf } from '../../utils/cod.shared';

/** Colours for settings.buttons.style. Outline and Minimal use the button colour for the text. */
export function codButtonColors(buttons) {
  const style = buttons?.style || 'filled';
  if (style === 'outline') return { background: 'transparent', color: buttons.bg, boxShadow: `inset 0 0 0 1.5px ${buttons.bg}` };
  if (style === 'minimal') return { background: 'transparent', color: buttons.bg, boxShadow: 'none' };
  return { background: buttons.bg, color: buttons.color, boxShadow: 'none' };
}

/** Font size, weight and capitals of a look (brix_cod.js buttonType), at `scale`. */
export function codButtonType(look, scale = 1) {
  const size = Math.max(12, Math.min(22, Math.round(Number(look?.fontSize)) || 15));
  return {
    fontSize: `${Math.round(size * scale * 10) / 10}px`,
    fontWeight: look?.bold === false ? 500 : 700,
    textTransform: look?.uppercase ? 'uppercase' : 'none',
    letterSpacing: look?.uppercase ? '.04em' : 'normal',
  };
}

/** Cart drawer button sizes in px; the gap is on the side that faces Checkout. */
export function codDrawerSize(settings, where) {
  const r = Math.round(Number(settings.buttons?.radius));
  return {
    marginTop: where === 'below' ? 10 : 0,
    marginBottom: where === 'above' ? 10 : 0,
    paddingY: 14,
    paddingX: 16,
    radius: Number.isFinite(r) ? Math.max(0, Math.min(40, r)) : 12,
  };
}

export function codFeeLabel(settings) {
  return settings.codFeeLabel || COD_FEE_LABEL_DEFAULT;
}

/** "+₹40 Cash on Delivery Fee" under the button, or '' when there's no fee or it's hidden. */
export function codFeeHint(settings, money) {
  const fee = codFeeOf(settings);
  return fee > 0 && settings.showCodFee !== false ? `+${money(fee)} ${codFeeLabel(settings)}` : '';
}

/**
 * Where the drawer COD button sits and whether Checkout shows, as on the
 * storefront: Checkout is only hidden ("Replace") while COD can be used.
 * state: null (no COD button) | { reason } (unavailable) | { sub } (usable).
 */
export function codDrawerLayout(placement, state) {
  const replace = placement === 'replace' && Boolean(state && !state.reason);
  const where = replace ? 'replace' : placement === 'replace' ? 'above' : placement;
  return { where, showCheckout: !replace, codFirst: where !== 'below' };
}
