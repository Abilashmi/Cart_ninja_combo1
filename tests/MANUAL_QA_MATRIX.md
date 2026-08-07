# Manual QA Matrix — Cart Drawer double-drawer / duplicate-add / layout fixes

Covers the 3 bugs fixed in `extensions/cart-drawer/assets/cart_drawer_inline.js` and
`cart_drawer_inline.css`. This CANNOT be replaced by the automated Playwright suite
(`tests/specs/storefront/cart-drawer-regressions.spec.ts`) because that suite only has
one live test store (`cartstoreviewer.myshopify.com`) on one theme — these bugs are
specifically about behavior that *varies by theme*. Run this after `npm run deploy`.

## Setup per row

1. Install the theme on a Shopify dev store (Shopify's free theme library covers Dawn,
   Refresh, Craft, Sense, etc. directly; others may need a paid/demo install).
2. Install this app on that store and enable the Cart Drawer (theme editor → App
   embeds → Cart Drawer → on).
3. Open browser devtools console before each check — the app now logs under
   `[CartDrawer debug]` when `?cc_debug=1` is appended to the URL, or after running
   `window.__CC_DEBUG__ = true` in the console. Use this to see exactly which
   interception path fired (selector match vs. generic fallback vs. neutralize/restore)
   without guessing from visual behavior alone.

## The 3 checks, per cell

- **A — No double drawer:** Click the cart icon (or add a product). Exactly one cart
  panel becomes visible. If the theme's native drawer is visible at the same time as
  ours, or flashes briefly before ours takes over, that's a fail.
- **B — Add to Cart fires once:** Open Network tab, filter `cart/add`. Click "Add to
  Cart" once on a product page. Exactly one `POST .../cart/add(.js)` request. Confirm
  cart quantity shows 1, not 2.
- **C — Layout intact:** Cart Drawer and FBT widget render with correct spacing,
  button/icon sizing, and font — nothing visibly squashed, oversized, or missing
  (checkboxes still show a checkmark when checked, buttons aren't flattened to
  invisible outlines).

## Matrix

| Theme | Device | A — No double drawer | B — Add to Cart fires once | C — Layout intact |
|---|---|---|---|---|
| Dawn | Desktop | ☐ | ☐ | ☐ |
| Dawn | Mobile | ☐ | ☐ | ☐ |
| Prestige | Desktop | ☐ | ☐ | ☐ |
| Prestige | Mobile | ☐ | ☐ | ☐ |
| Impulse | Desktop | ☐ | ☐ | ☐ |
| Impulse | Mobile | ☐ | ☐ | ☐ |
| Warehouse | Desktop | ☐ | ☐ | ☐ |
| Warehouse | Mobile | ☐ | ☐ | ☐ |
| Ella | Desktop | ☐ | ☐ | ☐ |
| Ella | Mobile | ☐ | ☐ | ☐ |
| At least 1 custom/non-listed theme | Desktop | ☐ | ☐ | ☐ |
| At least 1 custom/non-listed theme | Mobile | ☐ | ☐ | ☐ |

## Additional scenarios (run once, on whichever theme is fastest to set up — Dawn recommended)

| Scenario | Check | Result |
|---|---|---|
| Collection page Quick Add | A + B | ☐ |
| Buy Now button (Shop Pay) | Does NOT get intercepted — should behave natively, not open our drawer | ☐ |
| Variant switch then Add to Cart | B still holds for the newly-selected variant | ☐ |
| Rapid double-click on Add to Cart | Still exactly 1 (or intentionally-debounced) add — no 2 line items | ☐ |
| Cart page (`/cart`) native quantity update | Unaffected by our interception (we only touch `/cart/add`, not `/cart/change` or `/cart/update`) | ☐ |
| Theme editor: toggle Cart Drawer app embed off → on | Drawer still initializes correctly after the section reload this triggers (boot-guard rebind path) | ☐ |
| Theme editor: edit any unrelated setting, save | No duplicate `/cart/add` requests afterward (§B) — this is the scenario the boot guard specifically targets | ☐ |
| Store with a subscription app (e.g. Recharge/Bold) installed | Selling-plan add-to-cart still works; our interception doesn't swallow subscription-specific form fields | ☐ |
| Store with an analytics/pixel app (GA4, Meta Pixel) installed | Pixel's Add-to-Cart event still fires — confirm in the pixel's own debug/network tab, not just ours | ☐ |
| Store with a wishlist app installed | Wishlist's own button/heart icon still works — confirm it wasn't caught by the generic `aria-controls` cart-trigger fallback | ☐ |
| Store with a bundle/upsell app installed | Bundle app's own add-to-cart flow unaffected | ☐ |

## What "pass" looks like in the console

With `?cc_debug=1`:
- On first page load: `boot guard: first boot, initializing`
- On Add to Cart: `submit intercept: matched /cart/add form, taking ownership` then
  `submit intercept: /cart/add.js succeeded, opening drawer` — and nothing else
  mentioning `/cart/add` for that single click.
- On cart icon click (theme not in the hardcoded selector list): either
  `cart trigger intercept: matched known selector` or
  `cart trigger intercept: generic aria-controls fallback matched` — if neither logs
  and the native drawer still opens, that theme needs a selector added to the list in
  `cart_drawer_inline.js` (`CC_DRAWER_TAGS` / `CC_DRAWER_IDS` / the selector string in
  the click-delegation block).
- If you see `... falling back to native ...` or `... restoring native element ...`,
  that means our drawer failed to render — file that as its own bug (config load
  failure, render exception), separate from the 3 covered here, since the fallback
  successfully protected the customer but something upstream still needs fixing.
