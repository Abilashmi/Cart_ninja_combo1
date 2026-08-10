// Fetch discounts from Shopify Discount API
// This is the correct route location for Remix - at app/routes/ level with api. prefix

import { authenticate } from "../shopify.server";
import { listActiveDiscounts } from "../services/discounts.server";

export async function loader({ request }) {
  try {
    const { session, admin } = await authenticate.admin(request);

    if (!admin) {
      // Fallback: return sample coupons if not authenticated
      return new Response(JSON.stringify({
        coupons: [
          {
            id: 'sample-1',
            heading: '10% Off All Products',
            subtext: 'Save 10% on your entire order',
            code: 'SAVE10',
            type: 'DiscountCodeBasic',
            status: 'ACTIVE',
            starts_at: '2026-01-01T00:00:00Z',
            ends_at: '2026-12-31T23:59:59Z',
            sectionBg: '#f6f6f7',
            headingColor: '#000000',
            subtextColor: '#6d7175',
            couponBg: '#000000',
            codeColor: '#ffffff',
          },
          {
            id: 'sample-2',
            heading: 'Buy 1 Get 1 Free',
            subtext: 'BOGO on select items',
            code: 'BOGO',
            type: 'DiscountCodeBxgy',
            status: 'SCHEDULED',
            starts_at: '2026-03-01T00:00:00Z',
            ends_at: '2026-03-31T23:59:59Z',
            sectionBg: '#f6f6f7',
            headingColor: '#000000',
            subtextColor: '#6d7175',
            couponBg: '#000000',
            codeColor: '#ffffff',
          },
          {
            id: 'sample-3',
            heading: 'Free Shipping',
            subtext: 'On orders over $50',
            code: 'FREESHIP',
            type: 'DiscountCodeFreeShipping',
            status: 'EXPIRED',
            starts_at: '2025-01-01T00:00:00Z',
            ends_at: '2025-12-31T23:59:59Z',
            sectionBg: '#f6f6f7',
            headingColor: '#000000',
            subtextColor: '#6d7175',
            couponBg: '#000000',
            codeColor: '#ffffff',
          },
        ],
        success: true
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Try to fetch from Shopify API — shared with the BRIX AI agent's
    // duplicate-promotion check (ai-agent-tools.server.js) so this list and
    // that check can never drift apart on what "an active discount" means.
    const discounts = await listActiveDiscounts(admin);

    const coupons = discounts.map((d) => ({
      id: d.id,
      heading: d.title,
      subtext: d.summary,
      code: d.code || d.title,
      type: d.typename,
      status: d.status,
      starts_at: d.startsAt,
      ends_at: d.endsAt,
      used: d.used,
      limit: d.limit,
      discountType: d.discountType,
      discountValue: d.discountValue,
      sectionBg: "#f6f6f7",
      headingColor: "#000000",
      subtextColor: "#6d7175",
      couponBg: "#000000",
      codeColor: "#ffffff",
    }));

    return new Response(JSON.stringify({ coupons, success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // Fallback: return sample coupons if any error
    return new Response(JSON.stringify({
      coupons: [
        {
          id: 'sample-1',
          heading: '10% Off All Products',
          subtext: 'Save 10% on your entire order',
          code: 'SAVE10',
          type: 'DiscountCodeBasic',
          status: 'ACTIVE',
          starts_at: '2026-01-01T00:00:00Z',
          ends_at: '2026-12-31T23:59:59Z',
          sectionBg: '#f6f6f7',
          headingColor: '#000000',
          subtextColor: '#6d7175',
          couponBg: '#000000',
          codeColor: '#ffffff',
        },
        {
          id: 'sample-2',
          heading: 'Buy 1 Get 1 Free',
          subtext: 'BOGO on select items',
          code: 'BOGO',
          type: 'DiscountCodeBxgy',
          status: 'SCHEDULED',
          starts_at: '2026-03-01T00:00:00Z',
          ends_at: '2026-03-31T23:59:59Z',
          sectionBg: '#f6f6f7',
          headingColor: '#000000',
          subtextColor: '#6d7175',
          couponBg: '#000000',
          codeColor: '#ffffff',
        },
        {
          id: 'sample-3',
          heading: 'Free Shipping',
          subtext: 'On orders over $50',
          code: 'FREESHIP',
          type: 'DiscountCodeFreeShipping',
          status: 'EXPIRED',
          starts_at: '2025-01-01T00:00:00Z',
          ends_at: '2025-12-31T23:59:59Z',
          sectionBg: '#f6f6f7',
          headingColor: '#000000',
          subtextColor: '#6d7175',
          couponBg: '#000000',
          codeColor: '#ffffff',
        },
      ],
      error: error.message || "Failed to fetch discounts",
      success: false
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
