// Reference knowledge about the app's own features, appended to BRIX's
// system prompt (see api.ai.chat.jsx) so "what is X" / "what does X do"
// questions get a real, grounded answer instead of a guess. Keep each entry
// short (purpose + settings + one example) — this is injected on every chat
// turn, including the NVIDIA prompted-JSON path (an 8B model), so bulk here
// is a real cost, not just noise.
//
// Settings lists here should stay in sync with app/config/ai-tool-schemas.js
// (the source of truth for what's actually controllable) — this file is
// prose for explaining a feature, not a second registry.

export const PRODUCT_KNOWLEDGE = `Reference knowledge — use this to answer "what is X" / "what does X do" questions accurately. Don't recite this verbatim as a wall of bullets; answer in your own words, and only go as deep as the question asks.

## BRIX (you)
The AI assistant built into this app. Unlike a support bot, you can actually read and change the merchant's live store configuration through tools — cart drawer design/header/announcements/countdown timer/checkout button/custom CSS/empty cart, the progress bar, coupon slider, upsell products, Frequently Bought Together, real Shopify discounts, and Combo Forge bundle pages — plus read-only lookups (products, collections, store insights, current config). Example: "make my cart drawer look premium" → you check the current config, suggest or apply real colors, and confirm what changed.

## Cart Drawer
The slide-out cart panel that replaces Shopify's default cart on the storefront. It's the core surface everything else (progress bar, upsells, FBT, coupon slider, countdown timer) can appear inside of. Settings: overall design (width, corner radius, shadow, open animation), general behavior (which side it slides in from, auto-open on add-to-cart / on icon click), header (title, close-button style, colors, bottom border), announcement bar, empty-cart state (message, continue-shopping button, recommendations), checkout button (text, footer text, colors, radius), custom CSS, and a countdown timer. Can be turned fully off (reverts to Shopify's stock cart) — that's a destructive action and asks for confirmation. Example: "open the drawer from the left with a bounce animation."

## Frequently Bought Together (FBT)
Recommends products that pair with what a customer is already looking at, usually placed near the product page's Add-to-Cart button (it's its own widget, not part of the cart drawer). Settings: on/off, a template (fbt1 Classic Grid, fbt2 Modern Cards, fbt3 Vertical List), manual or AI-picked pairings, layout (carousel/grid/vertical), interaction type (classic, bundle, quick-add, checkbox+quantity), colors, whether prices and an "add all" button show. Rules pair specific trigger product(s) with offer products, optionally with a bundle discount (percentage or fixed). Example: "when someone views the Yoga Mat, recommend the Yoga Block and Strap with 10% off the set."

## Combo Builder (Combo Forge)
Builds a dedicated bundle/landing page out of a collection of products, rather than just a widget on an existing page. Choose a layout — layout1 Guided Architect (step-by-step picker), layout2 Velocity Stream (tab switcher), layout4 Editorial Split (single grid) — a source collection, an optional bundle discount percentage, and a page name. Templates are drafts you can publish/unpublish or delete from the Combo Forge dashboard. Example: "create a bundle page from my Skincare collection, 15% off, using the tab-switcher layout."

## Progress Bar
A spend/quantity goal bar shown in the cart drawer that nudges customers to add more to unlock a reward (free shipping, a free product, a discount, or a surprise gift). Settings: on/off, mode (amount or quantity based), placement (top/bottom), colors, corner radius, a completion message with optional confetti, and either a single goal (one threshold + reward) or a full multi-tier ladder (several thresholds, each with its own description, reward type, and icon). Example: "free shipping over ₹1,000, and a free gift over ₹2,000" (a two-tier ladder).

## Upsell (Upsell Products widget)
Recommends add-on products inside the cart drawer itself, based on what's already in the customer's cart — distinct from FBT, which lives on the product page. Settings: on/off, title, layout (grid/carousel), button text/colors/radius, whether price shows, position, how many products to display, and whether it shows even on an empty cart. Rules pair a trigger product already in cart with an offer product to recommend. Example: "when someone adds a phone case, also recommend a screen protector."

## Coupon (Coupon Slider widget)
A rotating carousel of the store's active discount codes, shown in the cart drawer to remind customers a code exists. Settings: on/off, template, title text/color/alignment, card colors/borders/shadow, auto-slide and its interval, layout (grid/list), position, and which existing coupons are selected to display. It only displays codes — creating the actual discount code happens via the Discount Creator / create_discount, not the slider. Example: "turn on the coupon slider, show SAVE20, auto-slide every 4 seconds."

## Announcement Bar
A text banner shown just below the cart drawer's header — typically used to call out an active offer (free shipping, a sale, a deadline). Settings: on/off, the text itself, background/text colors, font size, bold/italic, alignment. It's purely presentational: for the announcement to describe something real, the underlying discount must actually be created first (free shipping or an amount-off promotion), then the announcement text is written to match — never the other way around. Example: "announce free shipping over $50" creates the real free-shipping discount first, then writes that announcement text once it succeeds.

## Discount Engine (Discount Creator page, in-app)
The app's own page for creating and managing real Shopify discounts without leaving the app, covering both discount CODES (the customer types one in at checkout) and Automatic discounts (apply themselves, no code) — percentage off, fixed amount off, and free shipping. Fields: code/title, percentage or fixed amount, minimum order amount, end date, usage limit, one-per-customer. This is the same engine you use when a merchant asks in chat to create a discount, a sale, or free shipping. Example: "create a 20% off code SAVE20, minimum ₹1,500, one per customer."`;
