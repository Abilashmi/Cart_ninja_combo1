// What BRIX AI knows when it answers in the support chat
// (support-chat.server.js). Merchant-facing facts about BRIX; keep it in step
// with the app (CLAUDE.md). The AI must answer only from this and hand the
// chat to the team otherwise.
export const SUPPORT_GUIDE = `
BRIX is a Shopify app with these parts (left menu of the BRIX app):
- Home: stats for a period (date picker at the top), a card per feature with its on/off, Feedback, and the app embed status.
- Brix AI: an assistant that can change the cart drawer, offers and combos for the merchant.
- COD Checkout: Cash on Delivery placed by BRIX. Customize at COD Checkout > Customize: buttons for the cart drawer, product pages and combo pages, COD fee (fixed or a % of the order), shipping charges (one price or dynamic by area, weight, value), OTP by SMS (needs an MSG91 key and OTP template), PIN codes that can't use COD, products/tags left out, coupons in the COD popup, prepaid discount for online payment, Partial COD (an advance paid online in Shopify checkout: a fixed amount, a % of the order, or the shipping + COD fee; the rest on delivery, the order shows Partially paid), GA4 and Meta Pixel ids. COD orders appear in Shopify Orders tagged COD and BRIX-COD.
- Cart Editor: the BRIX cart drawer: design, header, announcement bar, progress bar with free gifts at milestones, coupons, upsell products, countdown timer, empty cart, checkout button, custom CSS. The drawer switch at the top turns it on or off.
- Build a Combo: combo / bundle pages (Quantity Box, Weight Box, Value Box) with tiered prices, shown on a Shopify page.
- Packs: Buy 1 / Buy 2 / Buy 3 offers on a product page, priced by a Shopify discount.
- Frequently Bought Together (FBT): products shown together on the product page, picked by hand or by AI, with an optional bundle offer.
- Coupon Banner: coupon cards and offer ladders on product pages.
- Discount Creator: make Shopify discount codes.
- Plans, Billing, Analytics, Account (language, price display, video tutorials).

Setup steps every store needs:
1. Turn on the app embed: Shopify admin > Online Store > Themes > Customize > App embeds > switch on "Custom Cart Drawer" > Save. Without it nothing from BRIX shows on the store. Home shows "Turn on app embed" when it is off.
2. Open each feature you want and switch it on (Cart Editor drawer switch, COD Checkout, FBT, Coupon Banner, a Pack, a combo template), then Save.
3. Check the store: add a product to the cart and see the drawer / buttons. Changes can take a minute; refresh the store page.
For Packs, FBT bundle offers, free gifts and combo box prices, BRIX creates a Shopify automatic discount; it must stay active in Shopify > Discounts.

Plans: every plan has every feature; plans differ by orders a month (Free up to 50, Lite 250, Starter 500, Growth 2000, Pro 5000, Scale 10000, Enterprise unlimited) and AI credits. There are no extra charges: past the monthly orders the store's BRIX features pause until next month or an upgrade. Yearly plans cost 10 months. Every plan has a 7-day free trial.

Common answers:
- "Drawer / buttons not showing": app embed off, the feature switched off, or the theme cache; turn on the embed and refresh.
- "COD button missing on a product": the product may be excluded by a tag, by "Which product pages", or out of the order value limits.
- "OTP not sent": the MSG91 key or OTP template is missing or wrong in COD Checkout > Customize > OTP SMS.
- "Discount not applied": the BRIX discount must be active in Shopify > Discounts; codes from other apps may not combine.
`;
