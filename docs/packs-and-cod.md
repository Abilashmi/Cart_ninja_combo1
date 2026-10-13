# BRIX Packs and BRIX COD Checkout

This document covers two features of the BRIX Shopify app: 

1. **[BRIX Packs](#part-1--brix-packs)**: quantity-tier offers on product pages ("Buy 2, save 5%", "Buy 3, save 10%").
2. **[BRIX COD Checkout](#part-2--brix-cod-checkout)**: Cash on Delivery orders placed by BRIX, while prepaid orders keep using Shopify checkout.

Each part has a plain overview (what merchants and shoppers see), setup steps, and a technical section for developers.

> **Status (October 2026).** Both features are built and pass their automated tests, which use mocks and a local test database. **Neither has been fully proven on a real store yet.** The Packs checkout discount is deployed and active on the dev store `cartstoreviewer`, but a full cart-to-checkout run is still to be done. No COD order has been placed on a real store yet. See [Known limits](#known-limits-and-open-items) before telling a merchant something works.

---

## Contents

- [Plans](#plans)
- [Part 1: BRIX Packs](#part-1--brix-packs)
  - [What it does](#what-it-does)
  - [Merchant setup](#merchant-setup)
  - [Pack types and layouts](#pack-types-and-layouts)
  - [How the discount is applied](#how-the-discount-is-applied)
  - [Packs architecture](#packs-architecture)
  - [Packs data](#packs-data)
  - [Packs troubleshooting](#packs-troubleshooting)
- [Part 2: BRIX COD Checkout](#part-2--brix-cod-checkout)
  - [What it does](#what-it-does-1)
  - [Merchant setup](#merchant-setup-1)
  - [Shopper flow](#shopper-flow)
  - [Settings reference](#settings-reference)
  - [Product page payment options and prepaid discount](#product-page-payment-options-and-prepaid-discount)
  - [COD architecture](#cod-architecture)
  - [COD data](#cod-data)
  - [Security and abuse limits](#security-and-abuse-limits)
  - [Ads and analytics](#ads-and-analytics)
  - [Order lifecycle](#order-lifecycle)
  - [What COD does not allow](#what-cod-does-not-allow)
- [Deployment checklist](#deployment-checklist)
- [Tests](#tests)
- [Known limits and open items](#known-limits-and-open-items)

---

## Plans

Both features are gated in `app/config/plans.js` and mirrored in `php_backend/plan_config.php`. Keep the two files in sync.

| Feature key | Free | Starter | Pro |
|---|---|---|---|
| `packs` | Preview only (drafts) | Live | Live |
| `cod_checkout` | Preview only | Live | Live |

The plan is always checked on the server (Node for admin writes, PHP for storefront reads). A plan coming from the browser is never trusted.

---

# Part 1: BRIX Packs

## What it does

A Pack is a set of quantity tiers on a product, for example:

| Tier | Discount | Badge |
|---|---|---|
| Buy 1 | none | |
| Buy 2 | 5% off | Popular |
| Buy 3 | 10% off | Best value |

On the product page, shoppers see the tiers as cards, pick one, choose a variant for each item (size, colour, and so on), and add the Pack to the cart or buy it straight away. The discount is applied at Shopify checkout by a Shopify Discount Function. It is never a discount code.

- **Prices are never stored.** Every tier price is worked out from the live Shopify variant price whenever a Pack is shown, saved or previewed.
- **Shoppers see a Pack only when the checkout discount is confirmed active.** If BRIX can't confirm that Shopify will apply the discount, the widget stays hidden, so no shopper is promised a saving they won't get.

## Merchant setup

1. In the theme editor, turn on the **BRIX Packs** app embed (`extensions/cart-drawer/blocks/Packs.liquid`). It runs on product and cart pages.
2. In the app, go to **Packs → New** (`/app/packs/new`), choose a product, a Pack type and the variants it covers.
3. Add up to **6 tiers** (quantity 1-100 each). Each tier can have no discount, a percentage, or a fixed amount, plus a badge of up to 24 characters.
4. Choose a layout and style it: texts, colours, borders, typography, spacing, buttons, images. The preview runs the real storefront widget.
5. Choose the placement:
   - **Below price** (default), or
   - **Custom**: add the **BRIX Packs position** app block (`blocks/packs_position.liquid`) anywhere in the product section and the Pack moves there.
6. Save as **Draft**, or **Activate** (Starter/Pro only). Activating installs or updates the "BRIX Packs" automatic discount in Shopify.

To check a Pack on the storefront before it's live, add `?brix_packs_preview=1` to the product URL. The widget then appears with a yellow warning explaining why shoppers can't see it yet.

## Pack types and layouts

**Pack types** (`pack_type`):

| Type | Meaning | Stored `template` |
|---|---|---|
| Same Variant | Several units of one product | `same_variant` or `visual_offer` |
| Mix & Match | Different variants combined in one Pack | `choose_each_item` |

**Variant coverage** (`variant_scope`):

- `all`: every variant of the product, read from Shopify each time, so newly added variants are covered automatically.
- `selected`: only the variants in `allowed_variant_ids_json`. The list is checked against the product's real variants on save.

**Layouts** (`customization.design.preset`), all drawn by `packs_widget.js`:

| Id | Name | How items are picked |
|---|---|---|
| `slots` | Horizontal Select | Pack cards in a row; one slot per item with a dropdown per product option |
| `quick_add` | Quick Add Picker | Pack cards over a grid of variant photos; tap + to add each item |
| `image_slots` | Image Variant Select | Packs as rows; each item shows its photo and one dropdown per option side by side (photo dropdowns for options that have variant images) |

Behaviour worth knowing:

- In Horizontal Select and Image Variant Select, "Buy 3" shows three separate pickers (Item 1, Item 2, Item 3), even for Same Variant Packs. Nothing is pre-selected; the shopper must choose. Items not picked yet are priced from the variant selected on the page.
- Quick Add Picker uses one variant for all items in a Same Variant Pack.
- While a Pack that covers every variant is showing, the theme's own variant picker and quantity box are hidden. A Pack covering only some variants keeps the theme picker, so the shopper can switch.
- Layouts that were removed (`classic`, `highlight`, `premium`, `tabs`, `stacked`, `visual`) map to current ones through `LEGACY_DESIGN_MAP`.

**Buttons.** The widget has **Add Pack to Cart** and an optional **Buy Now** (`content.showBuyNow`). Buy Now checks out **only the Pack**: it creates a separate cart through the Storefront API (`cartCreate`, with Pack line attributes) and sends the shopper to that cart's checkout, leaving their existing cart untouched. While Buy Now is shown, the theme's Buy it now button is hidden.

**Cart page.** On lines that came from a Pack, the theme's quantity stepper is replaced with a "Pack of N" label, because the Pack sets the quantity.

## How the discount is applied

The storefront marks each Pack cart line with line-item properties:

| Property | Meaning |
|---|---|
| `_brix_pack_id` | Pack id |
| `_brix_pack_quantity` | Tier quantity chosen |
| `_brix_pack_version` | Pack version when added |
| `_brix_pack_group` | Token shared by all lines from one add-to-cart |

The Discount Function (`extensions/brix-packs-discount`, target `cart.lines.discounts.generate.run`) does **not** trust those properties to decide the discount. It reads the tiers only from the app-owned shop metafield `$app:packs_config`, which only the BRIX server writes. For each group of lines it checks that:

1. the line's product really is the Pack's product,
2. the variant is allowed (any variant for `all`, else one in `allowedVariantIds`),
3. the group's total quantity is a whole multiple of the tier quantity (6 units on a "Buy 3" tier means two Packs, both discounted).

If the shopper changes the cart quantity so it no longer matches a tier, **no** discount is given, rather than a wrong one. Fixed-amount tiers apply only when the cart currency matches the shop currency. A forged property can at most claim a discount the merchant really offers for that exact quantity.

## Packs architecture

```
Admin (Node)                          Shopify                         Storefront
──────────────                        ───────                         ──────────
/app/packs pages ──► api.packs.jsx ─► metafield $app:packs_config ──► Discount Function
                         │            automatic discount "BRIX Packs"     (checkout)
                         │
                         ├─► MySQL brix_packs (Pack rows)
                         └─► MySQL brix_packs_shop_state (verified?) ◄── packs_storefront.php
                                                                              ▲
                                                Packs.liquid + packs_widget.js ┘
                                                (prices from Liquid variant data)
```

| Area | Files |
|---|---|
| Shared logic (tier maths, validation, option/variant picking, customization schema) | `app/utils/packs.shared.js` |
| Admin pages | `app/routes/app.packs.jsx` (layout), `app.packs._index.jsx`, `app.packs.new.jsx`, `app.packs.$id.jsx`, `app.packs.$id._index.jsx`, `app.packs.$id.edit.jsx` |
| Admin components | `app/components/packs/PackBuilder.jsx`, `PackPreview.jsx`, `usePackDraft.js` |
| Admin JSON API | `app/routes/api.packs.jsx` (actions: `save`, `status`, `delete`, `preview`) |
| Database layer | `app/services/packs.server.js` |
| Shopify sync and verification | `app/services/packs-shopify.server.js` (`syncCheckoutDiscount`, `getCheckoutDiscountStatus`, `hydratePacks`) |
| Checkout Function | `extensions/brix-packs-discount/src/cart_lines_discounts_generate_run.js` |
| Storefront widget | `extensions/cart-drawer/assets/packs_widget.js` (also used by the admin preview through `window.BrixPacksWidget.mount`) |
| Storefront data | `php_backend/packs_storefront.php` |
| Theme blocks | `extensions/cart-drawer/blocks/Packs.liquid`, `packs_position.liquid` |
| Preview and tests only | `app/routes/packs[.]js.jsx` (`/packs.js`), `api.packs-storefront.jsx`, `packs.storefront-preview.jsx`, `packs.storefront-frame.jsx` |

**Why the storefront reads from PHP.** The widget script ships inside the theme extension (`asset_url`) and fetches Pack data directly from `https://int.thebrix.io/packs_storefront.php`, not through the app proxy. Through the proxy, every shopper's request reaches the PHP host from Shopify's few proxy IPs, and the host's per-IP limit answers with 429 errors. PHP has no Shopify access, so:

- tier prices are worked out in the browser from the product page's Liquid variant JSON (`pricing: 'client'`);
- whether the discount is active comes from `brix_packs_shop_state`, which Node writes every time it verifies the discount with Shopify.

**Verification states** (`getCheckoutDiscountStatus`):

| State | Meaning |
|---|---|
| `active` | Discount installed, ACTIVE, and the metafield has every active Pack at its current version |
| `discount_missing` | The "BRIX Packs" automatic discount isn't installed |
| `discount_inactive` | The discount exists but isn't ACTIVE |
| `config_out_of_date` | A Pack was saved after the last sync; re-save to retry |
| `unknown` | Shopify unreachable; the last recorded state is kept |

A Pack saved after the last verification stays hidden until Node verifies again (on Pack save, status change or Packs admin page load).

**Admin API rules.** The response is always `{ success: true, ... }` or `{ success: false, error, code }`. `resolveSaveStatus` turns a requested `active` into an error on Free, and keeps an existing Pack `inactive` if the plan no longer allows it. A Pack can only be activated when its tiers and live variant coverage are valid (`assertActivatable`).

## Packs data

MySQL database `cart_drawer_ninja`. Migrations are **not** run automatically; run them once:

```bash
mysql -u <user> -p <database> < migrations/create_brix_packs.sql
mysql -u <user> -p <database> < migrations/alter_brix_packs_variant_scope.sql   # existing tables only, safe to re-run
mysql -u <user> -p <database> < migrations/create_brix_packs_shop_state.sql
```

**`brix_packs`**: one row per Pack. Main columns: `shop_domain`, `product_id`, `variant_id` (anchor/display variant), `status` (`draft | active | inactive | configuration_error`), `template`, `pack_type`, `variant_scope`, `allowed_variant_ids_json`, `version`, `tiers_json`, `customization_json`. Unique on `(shop_domain, product_id, variant_id)`.

**`brix_packs_shop_state`**: one row per shop: `discount_verified`, `discount_state`, `discount_message`, `verified_packs_json` (`{"<pack id>": <version>}`), `checked_at`.

**Shopify:** shop metafield `$app:packs_config` (JSON) and one automatic app discount titled **BRIX Packs** using function handle `brix-packs-discount`.

## Packs troubleshooting

| Symptom | Check |
|---|---|
| No Pack on the product page | Open the page with `?brix_packs_preview=1`; the warning gives the reason. Or call `packs_storefront.php?shop=<shop>&productId=<id>` and read `reason` and `checkoutDiscount.state`. |
| State is `discount_missing` although the discount exists | Discount lookup must use `discountNodes(query: "type:app")`; the old `automaticDiscountNodes` never returns Function discounts. |
| State is `config_out_of_date` | Re-save the Pack, or open the Packs admin page to trigger a fresh verification. |
| Widget script returns HTML in local dev | A free ngrok tunnel shows its warning page to `<script src>` requests. Use a Cloudflare tunnel. |
| Discount missing at checkout | Confirm the cart quantity is still a whole multiple of the tier, and the line's variant is covered by the Pack. |

---

# Part 2: BRIX COD Checkout

## What it does

BRIX COD Checkout lets shoppers place **Cash on Delivery** orders in a BRIX popup, without going through Shopify checkout. **Prepaid orders are never touched**: "Pay online" always hands back to that page's normal checkout (Shopify, or Shiprocket where the store uses it).

COD can appear in three places, each switched on separately:

| Place | Where the button goes |
|---|---|
| Cart drawer | The BRIX cart drawer, or the **theme's own drawer** when the BRIX drawer is off |
| Product page | Replaces Shopify's Buy it now by default, or sits above or below it |
| Combo page | Combo Forge pages, all four layouts |

Turning one place off never affects the others.

The popup flow is: **phone + OTP → address → review → order placed.** Prices are always calculated by Shopify. COD is set up for India: +91 phone numbers, 6-digit PIN codes, country `IN`.

## Merchant setup

1. Make sure the store is on Starter or Pro (Free shows the preview only).
2. Turn on the **Custom Cart Drawer** app embed. It loads `brix_cod.js` on every page, even if the BRIX drawer itself is off.
3. Go to **COD Checkout** (`/app/cod`) for the dashboard and orders list, and **Customize** (`/app/cod/customize`) for settings. Customize is laid out like the Cart Editor: sections on the left, live preview on the right (drawer, product page, combo page or popup).
4. Switch on the places where COD should show, then design each button.
5. Set fees, shipping, eligibility and fraud limits.
6. Optional: add the store's own MSG91 keys for OTP SMS, and GA4 / Meta IDs for tracking.

**Customize sections:**

| Group | Section | What it sets |
|---|---|---|
| Get started | How COD works | Overview |
| COD button | Cart drawer | Drawer on/off, button text and look, placement (replace / above / below Checkout), custom drawer selector |
| | Product page | On/off, button text and look, position relative to Buy it now, margin/padding |
| | Combo page | On/off, button text and look (or "same as drawer") |
| Product page payments | Payment options | Pay Online / COD selector on product pages |
| | Prepaid discount | % off for paying online, minimum subtotal, discount title |
| | Payment options design | Look of the selector cards |
| Charges & rules | COD fee | Fee on/off, amount, label, shown or folded into "Delivery charges" |
| | Shipping | Shipping fee and free-shipping threshold |
| | Eligibility | Minimum / maximum order value, excluded product tags |
| | Fraud protection | Orders per phone per day, blocked PIN codes |
| Checkout popup | Popup design | Store logo, logo size, accent colour, corners, order summary, trust badges, thank-you text |
| | Cart discounts | Whether the cart's own Shopify discounts carry into COD |
| | Coupons | Coupon field in the popup and up to 5 suggested codes |
| Advanced | OTP SMS (MSG91) | Store's own MSG91 auth key and OTP template id |
| | Ads & analytics | GA4 and Meta Pixel IDs, API secrets |
| | Order settings | Order-related options |

## Shopper flow

1. Shopper taps the COD button (drawer, product page or combo page).
2. The popup opens with the BRIX loader and asks for their phone number. If an SMS provider is set up, an OTP is sent and must be entered.
3. Shopper enters their address and PIN code.
4. The review step shows the price from Shopify: items, discounts, shipping, COD fee and total. They can apply a coupon (if allowed) and must keep the data policy checkbox ticked (on by default, links to https://thebrix.io/cod-data-policy).
5. **Place COD order** creates the order in Shopify. A thank-you screen shows the order number.

The popup always ends with "Secured & powered by BRIX".

**Button rules:**

- **Drawer placement** (`drawerPlacement`): `replace` hides Checkout only while COD can be used for the current cart; `above` and `below` keep both.
- **Theme drawer**: BRIX finds the Checkout button inside known theme drawer containers (or the merchant's `drawerSelector`) and re-adds the COD button when the theme redraws the drawer.
- **Excluded tags** are an exclusion list. If a product carries one, `excludedBehavior` decides: `unavailable` (greyed out, "Not available for some items in your cart") or `hide`.
- **Product page**: buys only that item. Inline `!important` styles stop theme CSS from changing the button, so it matches the admin preview (which shows it at 80% size). It is re-added when the theme redraws the form on variant change. The optional `blocks/cod_button.liquid` app block sets a custom position.

## Settings reference

Settings are one JSON blob per shop, defined and cleaned in `app/utils/cod.shared.js` and re-checked in `php_backend/cod_storefront.php`.

| Key | Default | Notes |
|---|---|---|
| `enabled` | `false` | Master switch |
| `surfaces.drawer / product / combo` | | Independent on/off per place |
| `buttons` | | Drawer button look: `style, bg, color, radius, fontSize, bold, uppercase, icon`, plus texts `drawerText / productText / comboText` |
| `buttons.product`, `buttons.combo` | product: `same: true` | Own look, or `same: true` to follow the drawer button. Resolve with `codButtonLook(settings, surface)` |
| `drawerPlacement` | `above` | `replace | above | below` |
| `drawerSelector` | | Custom CSS selector for unusual theme drawers |
| `productButton` | `replaceBuyNow: true` | Position and margin/padding/radius of the product page button |
| `codFeeEnabled`, `codFee`, `codFeeLabel`, `showCodFee` | off, 0 | Hidden fee is still charged, folded into one "Delivery charges" line |
| `shippingFee`, `freeShippingAbove` | 0, 0 | 0 threshold = shipping fee always applies |
| `minOrder`, `maxOrder` | 0, 0 | 0 = no limit |
| `excludedProductTags`, `excludedBehavior` | `[]`, `unavailable` | Exclusion list: products with these tags can't use COD |
| `dailyLimitPerPhone` | 3 | 1-50 |
| `blockedPincodes` | `[]` | |
| `cartDiscounts` | on | See below |
| `allowCoupons`, `sheet.showCoupon / couponLabel / couponOpen / offers` | | Coupon field and suggested codes |
| `sheet` | | Popup look |
| `tracking` | | `ga4Id`, `metaPixelId`, `metaContentId`, `dataLayer` (public IDs only) |
| `productPayment` | off | Pay Online / COD selector and prepaid discount |
| `_runtime` | | Written by the server: `otpAvailable`, `prepaid` sync result. Not merchant-editable |

**Cart discounts** (`cartDiscounts`, on by default). When on, the draft order is priced with Shopify's automatic discounts (including discount-Function ones), plus the codes already applied to the cart and the BRIX drawer's applied code. The cart's attributes are copied to the draft, because some Functions depend on them. When off, no automatic discounts or cart codes are used. Only codes Shopify actually applied are kept on the order, and the popup names each discount.

**Coupons.** When `allowCoupons` is on, the review step has a coupon field (type and press Enter, or Paste to paste and apply), plus suggested codes as tap-to-apply cards (picked from the store's active Shopify codes or typed in). Applying a code re-runs the price quote; Shopify decides whether it applies. A code from the drawer that Shopify rejects is shown as a coupon error, not silently dropped.

## Product page payment options and prepaid discount

Off by default (`productPayment.enabled`). When on, the product page shows two cards: **Pay Online** and **Cash on Delivery**.

- **Pay Online** uses Shopify's own Buy it now, relabelled "· Save X%" when a prepaid discount is live. If the theme has no Buy it now, BRIX shows its own Pay Online button that goes to `/cart/<variant>:<qty>`.
- **Cash on Delivery** hides Buy it now and shows the COD button and popup.
- Placement: the merchant's chosen spot, or the `blocks/payment_options.liquid` app block.

**Prepaid discount** is a separate Shopify Discount Function, `extensions/brix-prepaid-discount` (order discount). It reads only the metafield `$app:prepaid_discount_config`, which is synced on every COD settings save by `app/services/prepaid-discount-shopify.server.js`. The storefront shows "Save X%" only when the sync is **verified**, using the percentage Shopify holds.

**COD orders can never get the prepaid discount.** `cod.server.js` puts `_brixCod=true` on the draft order and on every line, and drops any `_brix*` keys sent by the shopper. The Function returns nothing for a cart or line carrying that marker.

> The prepaid discount applies to **every** Shopify checkout, including Shopify's own manual "Cash on Delivery" payment method, which the Function can't detect.

## COD architecture

```
Shopper's browser                 PHP host (int.thebrix.io)            Node app (Fly)              Shopify
─────────────────                 ─────────────────────────            ──────────────              ───────
brix_cod.js ── GET settings ────► cod_storefront.php (plan-gated)
            ── POST otp/quote/ ─► cod_checkout.php ── relay with ─────► api.cod.otp
               order                                  X-Forge-Secret    api.cod.quote  ──────────► draftOrderCalculate
                                                      + shopper IP/UA   api.cod.order  ──────────► draftOrderCreate
                                                                              │                    draftOrderComplete
                                  cod_settings.php ◄───────────────────────────┤
                                  cod_otp.php      ◄───────────────────────────┤ (X-Forge-Secret,
                                  cod_orders.php   ◄───────────────────────────┘  hashed phones only)
```

**The browser never calls the Node app.** Storefront reads (settings, PIN code lookups) come from `cod_storefront.php`. OTP, pricing and order placement are POSTed to `cod_checkout.php`, which relays them server-to-server to `<BRIX_APP_URL>/api/cod/{otp,quote,order}` (default `https://cartdrawer.fly.dev`). PHP can't place the order itself because it has no Shopify access token.

**How an order is placed:**

1. `api.cod.order.jsx` → `services/cod-storefront.server.js` loads the shop, plan and settings.
2. `services/cod.server.js` prices the cart with Shopify's `draftOrderCalculate`. **Prices never come from the browser.**
3. `draftOrderCreate`, then `draftOrderComplete(paymentPending: true)`. This argument is deprecated but still works on API 2025-10; recheck it on every API upgrade.
4. Shipping and COD fee become one "Cash on Delivery" shipping line.
5. Tags: `COD`, `BRIX-COD`, `brix-src-<surface>` (plus `brix-combo-weight` for weight boxes).

| Area | Files |
|---|---|
| Admin pages | `app/routes/app.cod.jsx` (dashboard + orders), `app/routes/app.cod_.customize.jsx` |
| Admin components | `app/components/cod/*` (`CodPreview.jsx`, `ButtonDesignEditor.jsx`, `PaymentOptionsSections.jsx`, `PaymentOptionsPreview.jsx`, `LogoUploader.jsx`, `CodOrdersChart.jsx`, …) |
| Shared settings and pricing | `app/utils/cod.shared.js`, `app/utils/product-payment.shared.js` |
| Storefront API (via relay) | `app/routes/api.cod.otp.jsx`, `api.cod.quote.jsx`, `api.cod.order.jsx` |
| Server logic | `app/services/cod.server.js`, `cod-storefront.server.js`, `cod-sms.server.js`, `cod-tracking.server.js`, `prepaid-discount-shopify.server.js` |
| Storefront popup | `extensions/cart-drawer/assets/brix_cod.js` (`window.BrixCod`, loaded before `cart_drawer_inline.js`) |
| Theme blocks | `extensions/cart-drawer/blocks/cod_button.liquid`, `payment_options.liquid` |
| PHP storage and relay | `php_backend/cod_storefront.php`, `cod_checkout.php`, `cod_settings.php`, `cod_otp.php`, `cod_orders.php`, `cod_helpers.php` |
| Prepaid discount Function | `extensions/brix-prepaid-discount` |

**Combo pages.** `combo-page[.]js.jsx` draws the COD button in all four layouts. For a layout it doesn't know, it falls back to the `preview.$templateId.jsx` iframe, which posts `brix-combo-cod-open` to the parent page to open the popup. Weight-priced combo boxes get the same box price in COD (`comboWeightAdjustments` in `cod.server.js`).

## COD data

All COD tables are created and owned by the PHP backend (`cod_helpers.php` `cod_ensure_tables`). Node never runs raw SQL on them; it calls the PHP files with `X-Forge-Secret`.

| Table | Contents |
|---|---|
| `cod_settings` | `shop`, `settings_json` (the settings blob) |
| `cod_otp` | `phone_hash`, `code_hash`, `attempts`, `verified`, `expires_at` |
| `cod_orders` | `idem_key` (unique per shop), `status`, `source`, `phone_hash`, `phone_masked`, `customer_name`, `pincode`, `total`, `currency`, `draft_order_id`, `order_id`, `order_name`, plus `lifecycle`, `ga4_status`, `meta_status` |
| `cod_secrets` | `ga4_api_secret`, `meta_capi_token`, `meta_test_code`, `msg91_auth_key`, `msg91_template_id` |

Phone numbers and OTP codes are stored only as HMAC hashes (keyed with `SHOPIFY_API_SECRET`). Secrets are never in the settings blob or the storefront config; the admin only sees "set / last 4".

## Security and abuse limits

- **OTP** (only when an SMS provider is configured: the store's own MSG91 keys from `cod_secrets`, else the server's `MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`). Enforced in `cod_otp.php`: 30 seconds between codes, 5 codes per hour, 10-minute expiry, 5 tries. Outside production, `COD_OTP_DEV_LOG=1` logs codes instead of sending them.
- **Per-phone daily order limit** (`dailyLimitPerPhone`), per-IP and per-phone rate limits.
- **Idempotency key** per popup, so a double tap can't create two orders.
- **Shopper IP and User-Agent** are passed by the relay as `X-Brix-Client-Ip` / `X-Brix-Client-Ua`, and trusted only alongside the secret, so per-IP limits stay per shopper.
- **Blocked PIN codes** and min/max order values are checked on the server.
- The data policy checkbox is checked in the browser only.

## Ads and analytics

COD orders skip Shopify checkout, so the store's Google and Meta apps never see them. BRIX sends the events itself.

**In the browser** (`Track` in `brix_cod.js`), only to the merchant's own IDs and only with Shopify Customer Privacy consent (GA4 = analytics, Meta = marketing):

| Step | GA4 | Meta |
|---|---|---|
| Popup opened | `begin_checkout` | `InitiateCheckout` |
| OTP verified | `cod_otp_verified` | `CodOtpVerified` |
| Address added | `add_shipping_info` | `CodAddressAdded` |
| Review | `add_payment_info` | `AddPaymentInfo` |
| Order placed | `purchase` | `Purchase` |

**On the server** (`cod-tracking.server.js`), after the order exists: GA4 Measurement Protocol and Meta Conversions API Purchase events. They share ids with the browser events so each order counts once: GA4 `transaction_id` = order name, Meta `event_id` = `brixcod_<order id>`. Results go to `cod_orders.ga4_status` / `meta_status`.

Merchants don't need developer accounts: they paste a GA4 Measurement ID + Measurement Protocol API secret from GA4, and a Meta Pixel ID + CAPI token from Events Manager.

## Order lifecycle

The existing `orders/updated`, `orders/paid` and `orders/cancelled` webhooks call `syncCodOrderFromWebhook` for orders tagged `BRIX-COD`. It stores `cod_orders.lifecycle`:

`placed → shipped → delivered → paid`, or `rto`, `cancelled`, `refunded`

The state comes from fulfillment `shipment_status`, `financial_status`, `cancelled_at` and summed refunds. The PHP update is row-locked, so duplicate webhooks act once. Moving to cancelled or refunded sends one GA4 `refund` event.

## What COD does not allow

- Carts containing **Pack lines** (`_brix_pack_id`) or **free reward gifts** (`_brixReward`). Their prices come from Shopify Functions that only run in Shopify checkout.
- Non-Indian addresses and phone numbers.

---

## Deployment checklist

The team member who deploys should do these in order:

1. **Database (Packs):** run the three `migrations/*brix_packs*.sql` files on `cart_drawer_ninja`. COD tables create themselves.
2. **PHP backend:** upload `php_backend/packs_storefront.php`, all `php_backend/cod_*.php` files and `plan_config.php` to `int.thebrix.io`.
3. **Shopify extensions and config:** `npm run deploy`. This pushes the theme extension (`packs_widget.js`, `brix_cod.js`, blocks) and the Functions `brix-packs-discount` and `brix-prepaid-discount`, and adds the `write_draft_orders` scope.
4. **Node app:** update the `SCOPES` env / Fly secret to include `write_draft_orders`, then deploy to Fly.
5. **Environment** (Node): `SHOPIFY_API_SECRET` (phone hashing), optional `MSG91_AUTH_KEY` / `MSG91_OTP_TEMPLATE_ID`. PHP: `BRIX_APP_URL` (default `https://cartdrawer.fly.dev`).
6. **On each store:** approve the new scope, turn on the **BRIX Packs** and **Custom Cart Drawer** app embeds, then open the Packs admin page once so the discount is verified.

## Tests

```bash
# Packs: unit tests (tier maths, server, Function logic)
node --import ./tests/packs/register.mjs --test tests/packs

# Packs: browser checks (Playwright)
node tests/packs/admin-browser-check.mjs
node tests/packs/preview-browser-check.mjs
node tests/packs/php-endpoint-browser-check.mjs
# tests/packs/widget-browser-check.mjs is out of date; a failure there is not a regression

# COD: unit + PHP integration (runs the real cod_*.php on a throwaway MariaDB from XAMPP)
node --import ./tests/packs/register.mjs --test tests/cod

# COD: browser checks (Playwright, all network mocked)
node tests/cod/sheet-browser-check.mjs
node tests/cod/theme-drawer-browser-check.mjs
node tests/cod/payment-options-browser-check.mjs
node tests/cod/cart-discounts-browser-check.mjs
node tests/cod/customize-page-browser-check.mjs
node tests/cod/admin-page-browser-check.mjs
```

> Local dev uses the shared hosted MySQL database. Don't run write tests against it casually.

## Known limits and open items

**Packs**
- The checkout Function is deployed and its discount is ACTIVE on `cartstoreviewer`, but a full cart → checkout with a real discount still needs to be observed.
- Buy Now (separate Storefront API cart) has been tested only against a mocked endpoint.
- The Image Variant Select and per-item picker changes have been mock-tested only.

**COD**
- No real COD order has been placed on a dev store yet. Don't say COD orders work until one has.
- Theme drawer detection has been tested on mocks (Dawn-like, Prestige-like, custom selector), not on real themes.
- The cart's own discounts in COD (automatic, app/Function discounts, cart codes) have not been seen on a real order.
- GA4 / Meta events have not been checked in GA4 DebugView or Meta Test Events.
- The prepaid discount hasn't been seen at a real checkout. Open question: whether Shopify runs discount Functions on draft orders and passes draft attributes through. The `_brixCod` marker on both the order and its lines covers both cases, but only a real COD order proves it.
- `draftOrderComplete(paymentPending: true)` is deprecated; recheck it when upgrading the Admin API version.
