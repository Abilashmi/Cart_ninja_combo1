# The Cart Ninja — Merchant User Guide

Everything a store owner needs to know after installing from the Shopify App Store.

---

## Table of Contents

1. [After Installation — Activate the App](#1-after-installation--activate-the-app)
2. [Customize the Cart Drawer](#2-customize-the-cart-drawer)
3. [Progress Bar (Free Shipping Goal)](#3-progress-bar-free-shipping-goal)
4. [Coupon Slider (In-Cart Discount Banner)](#4-coupon-slider-in-cart-discount-banner)
5. [FBT — Frequently Bought Together](#5-fbt--frequently-bought-together)
6. [Upsell Products Widget](#6-upsell-products-widget)
7. [Coupon & Discount Manager](#7-coupon--discount-manager)
8. [Combo Forge — Bundle Builder](#8-combo-forge--bundle-builder)
9. [Analytics Dashboard](#9-analytics-dashboard)
10. [AI Assistant (CartNinja)](#10-ai-assistant-cartninja)
11. [Plans & Billing](#11-plans--billing)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. After Installation — Activate the App

The Cart Ninja uses Shopify's Theme App Extensions — it does **not** edit your theme code and works with any Online Store 2.0 theme (Dawn, Sense, Refresh, Craft, etc.).

### Step 1 — Enable the App Embed

1. In your Shopify admin go to **Online Store → Themes → Customize** (on your active theme).
2. In the left sidebar click the **puzzle piece icon** (App embeds).
3. Find **Cart Ninja** and toggle it **ON**.
4. Click **Save**.

### Step 2 — Add the Cart Drawer Block

1. Still in the Theme Editor, open any page template (e.g. Index).
2. Click **Add block** inside a section.
3. Select **Cart Ninja → Cart Drawer**.
4. Click **Save**.

> Only add **one** Cart Drawer block. Adding multiple will cause conflicts.

### Step 3 — Add Optional Blocks (recommended)

In the same Theme Editor → Add block → Cart Ninja:

| Block | What it does |
|---|---|
| **Coupon Slider** | Shows scrollable discount codes inside the cart |
| **Product Recommendations (FBT)** | Frequently Bought Together upsell products in cart |
| **Star Rating** | Displays product star ratings on cart line items |

Each block can be added or removed independently at any time.

### Step 4 — Preview

Click **Save** in the Theme Editor, then open your storefront, add any product to the cart — the Cart Ninja drawer will slide in automatically.

> **Switching themes?** Re-enable the App Embed in your new theme by repeating Step 1.

---

## 2. Customize the Cart Drawer

Go to **Cart Drawer** in the left navigation.

The editor has a **live preview** on the right that updates in real time as you change settings.

### Design Tab
- **Primary colour** — main accent colour (buttons, progress bar fill).
- **Background colour** — cart drawer background.
- **Text colour** — item title and price text.
- **Border radius** — corner rounding on buttons and cards.
- **Font** — choose a font that matches your brand.

### General Tab
- **Cart title** — text shown at the top of the drawer (e.g. "Your Cart").
- **Enable/disable** — turn the entire cart drawer on or off without removing the block.

### Header Tab
- **Announcement text** — a short banner shown at the very top of the cart (e.g. "Free shipping on orders over $50").
- **Header logo** — optional small logo or icon.

### Announcements Tab
Scrolling ticker-style banners shown inside the cart header. Add multiple messages to rotate through.

### Empty Cart Tab
- Customize the message and image shown when the cart has no items.
- Add a **Continue Shopping** button link.

### Checkout Button Tab
- Change the checkout button label text.
- Add footer text below the button (e.g. "Secure checkout — 30-day returns").
- Choose a button style (filled, outline).

### Custom CSS Tab
Advanced users can paste custom CSS that is injected directly into the cart drawer.

### Saving
Click **Save** at the top right. Changes go live on your storefront immediately.

---

## 3. Progress Bar (Free Shipping Goal)

The progress bar shows customers how close they are to a free shipping threshold, encouraging them to add more items.

Go to **Cart Drawer → Progress Bar** section in the sidebar.

| Setting | Description |
|---|---|
| **Enable** | Turn the progress bar on/off |
| **Goal amount** | Cart subtotal target (e.g. $50 for free shipping) |
| **Progress bar colour** | Fill colour of the bar |
| **Goal message** | Text when the goal is reached (e.g. "You've unlocked free shipping! 🎉") |
| **Incomplete message** | Text while approaching the goal (supports `{amount}` placeholder for the remaining amount) |

---

## 4. Coupon Slider (In-Cart Discount Banner)

A horizontal scrollable strip of discount code cards shown inside the cart drawer. Customers tap a card to copy the code.

Go to **Cart Drawer → Coupon Slider** in the sidebar, or the standalone **Coupon Slider** page.

### Templates
Three visual templates are available — select the one that matches your brand style.

### Adding Coupons
1. Select a template.
2. Click **Add Coupon**.
3. Enter the discount code exactly as it exists in Shopify (it must already be created in **Discounts** or via the Coupon Manager).
4. Set display conditions (minimum cart value, specific products/collections).
5. Save.

> The Coupon Slider block must be added in the Theme Editor (see [Step 3](#step-3--add-optional-blocks-recommended)) for it to appear in the cart.

---

## 5. FBT — Frequently Bought Together

Displays a row of product recommendations inside the cart drawer ("Customers also bought…"). When a shopper clicks **Add**, the product is added to their cart without closing the drawer.

Go to **FBT** in the left navigation.

### Templates
Three layout templates:
- **Template 1** — Compact horizontal row.
- **Template 2** — Card grid.
- **Template 3** — Featured single product.

### Modes
- **Manual** — You pick exactly which products to recommend.
- **Automatic** — App recommends related products based on the items in the cart.
- **AI-powered** — Uses AI to generate personalized recommendations (available on higher plans).

### Settings
| Setting | Description |
|---|---|
| **Title** | Section heading shown to the customer (e.g. "You might also like") |
| **Button text** | CTA on each product card (e.g. "Add to Cart") |
| **Show price** | Toggle product price on/off |
| **Max products** | How many recommendations to show (1–10) |
| **Display limit** | Visible at a time in slider mode |

Save when done. The FBT block must be enabled in the Theme Editor to appear on the storefront.

---

## 6. Upsell Products Widget

A standalone upsell panel — separate from FBT — that shows targeted product offers based on cart contents or rules.

Go to **Upsell** in the left navigation.

### Creating a Rule
1. Click **Add Rule**.
2. Set the **Rule Type**:
   - **Always show** — shown to everyone.
   - **Trigger product** — shown when a specific product is in the cart.
   - **Trigger collection** — shown when any product from a collection is in the cart.
   - **Cart value** — shown when the cart subtotal reaches a threshold.
3. Choose **Upsell products or collection** to recommend.
4. Set **Priority** (lower number = shown first when multiple rules match).
5. Save.

Rules are evaluated in priority order; the first match wins.

---

## 7. Coupon & Discount Manager

A dedicated page to create and manage Shopify discount codes without leaving the app.

Go to **Coupons** in the left navigation.

### Tabs
- **Active** — live discount codes.
- **Expired / Inactive** — disabled codes.

### Creating a Discount
Click **Create Discount** → select type:

| Type | Description |
|---|---|
| **Percentage off** | e.g. 20% off entire order |
| **Fixed amount** | e.g. $10 off |
| **Free shipping** | Removes shipping cost at checkout |
| **Buy X get Y** | BOGO-style offers |

Discounts created here are synced directly to your Shopify store's native discount system and will appear in the Coupon Slider automatically.

---

## 8. Combo Forge — Bundle Builder

Create dedicated **bundle pages** (e.g. "Build Your Own Kit") where customers can pick products, view a combined preview, and add the whole bundle to their cart in one click.

Go to **Combo Forge** in the left navigation.

### Creating a Bundle Page

1. Click **New Bundle**.
2. Choose a **layout template**:
   - **Guided Architect** — step-by-step product selector (great for configurable kits).
   - **Velocity Stream** — tab switcher layout (fast browsing of categories).
   - **Editorial Split** — image-forward split layout (premium/lifestyle feel).
3. In the builder:
   - **Add Steps / Categories** — group your products into sections.
   - **Add Products** — pick from your Shopify catalog.
   - **Set a Discount** — attach a discount code that applies when the bundle is added to cart.
   - **Customize design** — colours, fonts, button styles, header text.
   - Use **Brix AI** (sparkle icon) to auto-generate titles and descriptions.
4. Click **Publish** — the app creates a Shopify page at `/pages/<your-bundle-slug>` automatically.

### Managing Bundles
The **Combo Forge dashboard** lists all your bundle pages with:
- Status (Draft / Published).
- View count and revenue attribution.
- Quick **Edit / Duplicate / Delete** actions.

### Analytics
Go to **Combo Forge → Analytics** to see per-bundle visitor counts, click-through rates, and revenue from bundle orders.

---

## 9. Analytics Dashboard

Go to **Analytics** in the left navigation.

Tracks performance across all Cart Ninja features.

### Key Metrics

| Metric | What it measures |
|---|---|
| **Checkout Clicks** | Times customers clicked the checkout button in the cart drawer |
| **Coupon Clicks** | Times a coupon card was tapped in the Coupon Slider |
| **Upsell Clicks** | Times an FBT or Upsell product was added from the drawer |
| **Upsell Revenue** | Revenue attributed to upsell add-ons |
| **Total Revenue** | Revenue flowing through the cart drawer |
| **AOV** | Average Order Value across all cart drawer sessions |
| **Conversion Rate** | Bundle page visitors → confirmed orders |

### Date Range
Use the date picker to filter by Today, Last 7 days, Last 30 days, or a custom range.

### By Template (Combo Forge)
The table at the bottom breaks down visitors, clicks, and revenue per bundle page, so you can see which layouts perform best.

---

## 10. AI Assistant (CartNinja)

A floating AI chat panel available on every page of the app. Click the **CartNinja** button (bottom right corner) to open it.

### What it can do
- Answer questions about your settings and how to use features.
- Suggest upsell products based on your catalog.
- Write coupon banner copy, bundle descriptions, and FBT section headings.
- Walk you through making changes step by step.

### Brix AI (in Combo Forge)
Inside the Bundle Builder, there is a dedicated **Brix AI** bar at the top of each section. Click the sparkle icon next to any text field to generate AI-written content for that field (title, description, step name, etc.).

---

## 11. Plans & Billing

Go to **Billing** or **Subscribe** in the left navigation to view or change your plan.

| Plan | Typical inclusions |
|---|---|
| **Starter** | Cart drawer, FBT, coupon slider, basic analytics |
| **Plus** | All Starter features + Combo Forge, advanced upsell rules |
| **Pro** | All Plus features + AI recommendations, priority support |

Plan changes take effect immediately. Downgrading at the end of the billing cycle retains your data.

---

## 12. Troubleshooting

| Issue | Fix |
|---|---|
| Cart drawer doesn't appear on my store | Go to Theme Editor → App Embeds → ensure Cart Ninja is toggled ON and saved |
| Cart Drawer block is missing | In Theme Editor → Add block → Cart Ninja → Cart Drawer (add only one) |
| Switched themes, drawer disappeared | Re-enable App Embed in the new theme (the embed is per-theme) |
| Coupon Slider not visible in cart | Add the Coupon Slider block in the Theme Editor; also ensure at least one active coupon is configured |
| FBT products not showing | FBT block must be added in Theme Editor; check that products are set to Manual or a mode is selected |
| Bundle page not visible on storefront | Click **Publish** in the bundle builder; the Shopify page is only created after publishing |
| Analytics shows zero for everything | Data populates after real customer interactions — give it 24 hours from going live |
| Discount code shows as invalid at checkout | Verify the code exists and is active in **Shopify Admin → Discounts** |
| Cart drawer works but looks broken | Check Custom CSS tab for conflicting styles; also check if your theme has a conflicting native cart drawer |

---

> For additional help, use the **CartNinja AI assistant** (bottom right of the app) or contact support at support@digifyce.com.
