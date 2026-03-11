// app/routes/api.coupons-active.jsx
// GET /api/coupons/active — returns only ACTIVE coupons from Shopify Discount API

import { authenticate } from "../shopify.server";

const SAMPLE_ACTIVE_COUPONS = [
    {
        id: "sample_active_1",
        code: "SAVE10",
        label: "10% OFF",
        description: "Applicable on orders above ₹500",
        discountType: "percentage",
        discountValue: 10,
        expiryDate: "2026-12-31",
        status: "active",
    },
    {
        id: "sample_active_2",
        code: "FLAT200",
        label: "₹200 OFF",
        description: "Flat ₹200 off on orders above ₹1500",
        discountType: "fixed",
        discountValue: 200,
        expiryDate: "2026-12-31",
        status: "active",
    },
    {
        id: "sample_active_3",
        code: "FREESHIP",
        label: "Free Shipping",
        description: "Free shipping on all orders",
        discountType: "free_shipping",
        discountValue: 0,
        expiryDate: "2026-06-30",
        status: "active",
    },
];

export async function loader({ request }) {
    try {
        const { session, admin } = await authenticate.admin(request);

        const storeId = session?.shop || "unknown-shop";

        if (!admin) {
            // Fallback: return sample active coupons if not authenticated
            return new Response(
                JSON.stringify({
                    storeId,
                    coupons: SAMPLE_ACTIVE_COUPONS,
                    success: true,
                    isSample: true,
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        // Fetch discounts from Shopify GraphQL API
        const query = `
      query ActiveDiscountsList {
        discountNodes(first: 50, reverse: true) {
          edges {
            node {
              id
              discount {
                __typename
                ... on DiscountCodeBasic {
                  title
                  status
                  startsAt
                  endsAt
                  codes(first: 1) { edges { node { id code } } }
                  summary
                  customerGets {
                    value {
                      ... on DiscountPercentage { percentage }
                      ... on DiscountAmount { amount { amount currencyCode } }
                    }
                  }
                }
                ... on DiscountAutomaticBasic {
                  title
                  status
                  startsAt
                  endsAt
                  summary
                  customerGets {
                    value {
                      ... on DiscountPercentage { percentage }
                      ... on DiscountAmount { amount { amount currencyCode } }
                    }
                  }
                }
                ... on DiscountCodeBxgy {
                  title
                  status
                  startsAt
                  endsAt
                  codes(first: 1) { edges { node { id code } } }
                  summary
                }
                ... on DiscountCodeFreeShipping {
                  title
                  status
                  startsAt
                  endsAt
                  codes(first: 1) { edges { node { id code } } }
                  summary
                }
                ... on DiscountAutomaticFreeShipping {
                  title
                  status
                  startsAt
                  endsAt
                  summary
                }
              }
            }
          }
        }
      }
    `;

        const gqlRes = await admin.graphql(query);
        const data = await gqlRes.json();

        if (data.errors) {
            return new Response(
                JSON.stringify({
                    storeId,
                    coupons: SAMPLE_ACTIVE_COUPONS,
                    error: data.errors[0]?.message || "Shopify API error",
                    success: false,
                    isSample: true,
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        // Filter ONLY active coupons and normalize the response
        const coupons = (data.data?.discountNodes?.edges || [])
            .map(({ node }) => {
                const d = node.discount;
                let code = "";
                let codeNodeId = node.id; // fallback to DiscountNode ID
                if (d.codes && d.codes.edges.length > 0) {
                    code = d.codes.edges[0].node.code;
                    // Use DiscountCodeNode ID so it matches the resource picker
                    if (d.codes.edges[0].node.id) {
                        codeNodeId = d.codes.edges[0].node.id;
                    }
                }

                // Parse discount type and value
                let discountType = "percentage";
                let discountValue = 0;
                if (d.customerGets?.value) {
                    const val = d.customerGets.value;
                    if (val.percentage !== undefined) {
                        discountType = "percentage";
                        discountValue = Math.round(val.percentage * 100);
                    } else if (val.amount) {
                        discountType = "fixed";
                        discountValue = parseFloat(val.amount.amount);
                    }
                }
                if (
                    d.__typename === "DiscountCodeFreeShipping" ||
                    d.__typename === "DiscountAutomaticFreeShipping"
                ) {
                    discountType = "free_shipping";
                    discountValue = 0;
                }

                return {
                    id: codeNodeId,
                    code: code || d.title,
                    label: d.title,
                    description: d.summary || "",
                    discountType,
                    discountValue,
                    expiryDate: d.endsAt ? d.endsAt.split("T")[0] : "",
                    status: (d.status || "").toLowerCase(),
                };
            });
        // Return all discounts so merchant can pick any (active, expired, scheduled)

        return new Response(
            JSON.stringify({
                storeId,
                coupons,
                success: true,
                isSample: false,
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
    } catch (error) {
        console.error("[api.coupons-active] Error:", error);
        return new Response(
            JSON.stringify({
                storeId: "unknown",
                coupons: SAMPLE_ACTIVE_COUPONS,
                error: error.message || "Failed to fetch active coupons",
                success: false,
                isSample: true,
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}
