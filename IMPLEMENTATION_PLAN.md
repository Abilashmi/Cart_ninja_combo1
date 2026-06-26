# Cart Drawer Editor — Full Wiring Implementation Plan

## Current Status

The UI is complete (11 sections, preview, sidebar). The 4 API routes exist and are structurally sound. The **core problems** preventing full functionality are:

1. **Data doesn't reload on page load** — the loader only fetches `cart_drawer_config`, not the progress bar / coupon / upsell normalized tables
2. **Upsell manual rules are never saved** — `manualRules[]` in context has no API persistence path
3. **Selected coupons are never saved** — `selectedCoupons[]` in context has no API persistence path
4. **Tier field name mismatch** — default state uses `minimumSpend`/`title`/`icon` but save + API use `minValue`/`description`/`iconPreset`
5. **CartPreview uses mock product data** for the upsell preview instead of real products from context

---

## Existing API Routes (Reference)

| Route | Method | Table | Status |
|---|---|---|---|
| `/api/cart-drawer-config` | GET + POST | `cart_drawer_config` | ✅ Full |
| `/api/progress-bar` | GET + POST | `progress_bar_settings` + `progress_bar_tiers` | ✅ Full |
| `/api/coupon-slider-settings` | GET + POST | `coupon_slider_settings` | ✅ Partial — missing `selected_coupons` |
| `/api/upsell-settings` | GET + POST | `upsell_widget_settings` | ✅ Partial — missing `manual_rules` |
| `/api/upsell` | GET + POST | `upsell_rules` (legacy) | ⚠️ Legacy schema, not used by new UI |

---

## Phase 1 — Fix the Loader

**File:** `app/routes/app.cartdrawer.jsx`

Currently the loader only queries `cart_drawer_config`. Expand the `Promise.all` to also load the 3 other normalized tables:

```js
// Add to Promise.all in the loader:
db.execute('SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop])
  .then(async ([rows]) => {
    if (!rows[0]) return null;
    const [tiers] = await db.execute(
      'SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC',
      [rows[0].id]
    );
    return { ...rows[0], tiers };
  }),
db.execute('SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop])
  .then(([rows]) => rows[0] || null),
db.execute('SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop])
  .then(([rows]) => rows[0] || null),
```

Return the results as `pbRecord`, `csRecord`, `upsellRecord` alongside the existing `configRecord`.

---

## Phase 2 — Pass New Records to CartEditorProvider

**File:** `app/components/CartEditorPage.jsx`

Extract the 3 new records from `useLoaderData()` and forward them to the provider:

```jsx
const pbRecord     = data?.pbRecord     ?? null;
const csRecord     = data?.csRecord     ?? null;
const upsellRecord = data?.upsellRecord ?? null;

<CartEditorProvider
  ...
  initialPbRecord={pbRecord}
  initialCsRecord={csRecord}
  initialUpsellRecord={upsellRecord}
>
```

---

## Phase 3 — Add Hydration Functions to Context

**File:** `app/context/CartEditorContext.jsx`

Add 3 new hydration functions. Call them after `hydrateFromConfig()` in the `useState` init:

```
base
  → hydrateFromRecord(legacy blob)
  → hydrateFromConfig(cart_drawer_config)
  → hydrateFromProgressBar(progress_bar_settings + tiers)
  → hydrateFromCouponSlider(coupon_slider_settings)
  → hydrateFromUpsell(upsell_widget_settings)
```

Each layer overrides only the fields it knows about, so nothing is lost if a record is missing.

### `hydrateFromProgressBar(pbRecord, base)`

| DB column | Context field |
|---|---|
| `is_enabled` | `body.progressBar.enabled` |
| `mode` | `body.progressBar.mode` |
| `show_on_empty` | `body.progressBar.showWhenEmpty` |
| `bar_background_color` | `body.progressBar.colors.background` |
| `bar_foreground_color` | `body.progressBar.colors.fill` |
| `icon_color` | `body.progressBar.colors.icon` |
| `border_radius` | `body.progressBar.borderRadius` |
| `placement` | `body.progressBar.position` |
| `completion_text` | `body.progressBar.completionMessage` |
| `completion_text_color` | `body.progressBar.colors.message` |
| `enable_confetti` | `body.progressBar.confetti` |
| `tiers[]` | `body.progressBar.tiers` (map `min_value`→`minValue`, `icon_preset`→`iconPreset`, etc.) |

### `hydrateFromCouponSlider(csRecord, base)`

| DB column | Context field |
|---|---|
| `is_enabled` | `body.couponSlider.enabled` |
| `selected_template` | `body.couponSlider.template` |
| `title_text` | `body.couponSlider.sectionTitle` |
| `title_color` | `body.couponSlider.titleColor` |
| `title_font_size` | `body.couponSlider.titleFontSize` |
| `title_alignment` | `body.couponSlider.titleTextAlign` |
| `position` | `body.couponSlider.position` |
| `layout` | `body.couponSlider.layout` |
| `selected_coupons` (JSON) | `body.couponSlider.selectedCoupons` *(after Phase 5)* |

### `hydrateFromUpsell(upsellRecord, base)`

| DB column | Context field |
|---|---|
| `is_enabled` | `body.upsellProducts.enabled` |
| `title` | `body.upsellProducts.title` |
| `title_color` | `body.upsellProducts.titleColor` |
| `show_on_empty_cart` | `body.upsellProducts.showWhenEmpty` |
| `layout` | `body.upsellProducts.layout` |
| `button_text` | `body.upsellProducts.buttonText` |
| `button_bg_color` | `body.upsellProducts.buttonColor` |
| `button_text_color` | `body.upsellProducts.buttonTextColor` |
| `button_border_radius` | `body.upsellProducts.buttonBorderRadius` |
| `show_price` | `body.upsellProducts.showPrice` |
| `position` | `body.upsellProducts.position` |
| `display_limit` | `body.upsellProducts.limit` |
| `manual_rules` (JSON) | `body.upsellProducts.manualRules` *(after Phase 6)* |

---

## Phase 4 — Fix Tier Field Name Mismatch

**Root cause:** `defaultTier` in `cartEditorTypes.js` uses `minimumSpend`, `title`, `icon`, `rewardProducts`. The save payload in `CartEditorPage.jsx` (lines 103–113) sends `minValue`, `description`, `iconPreset`. The DB stores `min_value`, `description`, `icon_preset`. After a reload, tiers come back from the DB with DB column names and `CartPreview.jsx` fails to read them.

### Fix `app/types/cartEditorTypes.js`

```js
// BEFORE
export const defaultTier = {
  id: 'tier-1',
  minimumSpend: 500,
  title: 'First Reward',
  description: 'Unlock your first milestone reward',
  icon: 'gift',
  rewardProducts: [],
  rewardProductCount: 0,
};

// AFTER
export const defaultTier = {
  id: 'tier-1',
  minValue: 500,
  minQuantity: 0,
  description: 'Unlock free shipping',
  rewardType: 'free_shipping',
  iconType: 'preset',
  iconPreset: 'gift',
  products: [],
};
```

### Fix `app/components/CartPreview.jsx` — `ProgressBarPreview`

| Before | After |
|---|---|
| `tier.minimumSpend` | `tier.minValue` |
| `tier.icon` | `tier.iconPreset` |
| `tier.title \|\| tier.description` | `tier.description` |

### Audit `app/components/sections/ProgressBarSection.jsx`

Check every field reference in the tier editor UI and align to the same canonical names (`minValue`, `description`, `iconPreset`, `products`).

---

## Phase 5 — Persist Selected Coupons

### SQL (run once on your MySQL DB)

```sql
ALTER TABLE coupon_slider_settings
  ADD COLUMN selected_coupons LONGTEXT NULL AFTER layout;
```

### `app/routes/api.coupon-slider-settings.jsx`

**POST action** — serialize and save:
```js
const selectedCoupons = Array.isArray(body.selectedCoupons)
  ? JSON.stringify(body.selectedCoupons)
  : null;
// Add selected_coupons to INSERT column list, VALUES, and ON DUPLICATE KEY UPDATE
```

**GET loader** — parse on read:
```js
if (rows[0]?.selected_coupons) {
  try { rows[0].selected_coupons = JSON.parse(rows[0].selected_coupons); } catch { rows[0].selected_coupons = []; }
}
```

### `app/components/CartEditorPage.jsx`

Add to the coupon slider save payload:
```js
selectedCoupons: cs.selectedCoupons || [],
```

---

## Phase 6 — Persist Upsell Manual Rules

The existing `upsell_rules` table uses a legacy schema (rule1/rule2/rule3 priority model). Rather than restructuring that table, store the new `manualRules[]` array as a JSON blob in `upsell_widget_settings` — no conflict with the legacy API.

### SQL (run once on your MySQL DB)

```sql
ALTER TABLE upsell_widget_settings
  ADD COLUMN manual_rules LONGTEXT NULL AFTER active_template;
```

### `app/routes/api.upsell-settings.jsx`

**POST action** — serialize and save:
```js
const manualRules = Array.isArray(body.manualRules)
  ? JSON.stringify(body.manualRules)
  : null;
// Add manual_rules to INSERT column list, VALUES, and ON DUPLICATE KEY UPDATE
```

**GET loader** — parse on read:
```js
if (rows[0]?.manual_rules) {
  try { rows[0].manual_rules = JSON.parse(rows[0].manual_rules); } catch { rows[0].manual_rules = []; }
}
```

### `app/components/CartEditorPage.jsx`

Add to the upsell save payload:
```js
manualRules:          up.manualRules      || [],
button_border_radius: up.buttonBorderRadius ?? 6,  // was missing entirely
```

---

## Phase 7 — Fix CartPreview Mock Products

**File:** `app/components/CartPreview.jsx`

Remove the mock data import and use real products from context:

```jsx
// REMOVE:
import { upsellProducts } from '../data/mockData';

// In UpsellPreview component:
function UpsellPreview({ upsell, checkoutBg, checkoutText }) {
  const { allProducts } = useCartEditor();
  const source = allProducts.length > 0 ? allProducts : MOCK_FALLBACK_PRODUCTS;
  const products = source.slice(0, upsell.limit);
  // ...
}
```

Keep a small `MOCK_FALLBACK_PRODUCTS` array inline (2–3 items) so the preview still renders on first load before products are fetched.

---

## Phase 8 — Minor Cleanup

### `app/components/sections/AnnouncementsSection.jsx`

Remove the early API call on toggle (the premature save to `/api/cart-drawer-config` that fires before the main Save button). This causes partial saves that can race with the full save flow. Let the main Save button handle persistence for all sections uniformly.

### `app/components/CartEditorPage.jsx`

Fix the coupon template field alias: the save payload uses `cs.selectedStyle || cs.template` but the context only stores `template` (no `selectedStyle` key exists). Remove the dead alias:

```js
// BEFORE
selected_template: cs.selectedStyle || cs.template || 'template1',

// AFTER
selected_template: cs.template || 'template1',
```

---

## Implementation Order

| # | Phase | Files Changed | Needs DB? | Risk |
|---|---|---|---|---|
| 1 | Phase 4 — tier field names | `cartEditorTypes.js`, `CartPreview.jsx`, `ProgressBarSection.jsx` | No | Low |
| 2 | Phase 1 — loader | `app.cartdrawer.jsx` | No | Low |
| 3 | Phase 2 — provider props | `CartEditorPage.jsx` | No | Low |
| 4 | Phase 3 — hydration functions | `CartEditorContext.jsx` | No | Medium |
| 5 | Phase 5 — selected coupons | SQL + `api.coupon-slider-settings.jsx` + `CartEditorPage.jsx` | **Yes** | Medium |
| 6 | Phase 6 — manual rules | SQL + `api.upsell-settings.jsx` + `CartEditorPage.jsx` | **Yes** | Medium |
| 7 | Phase 7 — preview products | `CartPreview.jsx` | No | Low |
| 8 | Phase 8 — cleanup | `AnnouncementsSection.jsx`, `CartEditorPage.jsx` | No | Low |

---

## Files Summary

| File | Changes |
|---|---|
| `app/routes/app.cartdrawer.jsx` | Add 3 normalized table queries to loader |
| `app/components/CartEditorPage.jsx` | Pass new records to provider; fix coupon template alias; add missing upsell fields; add coupon/rule save payloads |
| `app/context/CartEditorContext.jsx` | Add 3 hydration functions + 3 new props |
| `app/types/cartEditorTypes.js` | Fix `defaultTier` field names |
| `app/components/CartPreview.jsx` | Fix tier field reads; use real products for upsell preview |
| `app/components/sections/ProgressBarSection.jsx` | Audit and align tier field names |
| `app/components/sections/AnnouncementsSection.jsx` | Remove premature early-save API call |
| `app/routes/api.coupon-slider-settings.jsx` | Add `selected_coupons` read/write |
| `app/routes/api.upsell-settings.jsx` | Add `manual_rules` read/write |
| **MySQL DB** | Two `ALTER TABLE` statements |

---

## SQL Statements (Run Before Phases 5 & 6)

```sql
-- Phase 5: persist selected coupons
ALTER TABLE coupon_slider_settings
  ADD COLUMN selected_coupons LONGTEXT NULL AFTER layout;

-- Phase 6: persist upsell manual rules
ALTER TABLE upsell_widget_settings
  ADD COLUMN manual_rules LONGTEXT NULL AFTER active_template;
```
