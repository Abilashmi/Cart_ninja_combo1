import { getDb } from "../services/db.server";

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId() {
    return `coupon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeShop(s) {
    return (s || "").toString().trim().toLowerCase();
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getStoredCoupons(shopDomain = "") {
    if (!shopDomain) return [];
    const db = getDb();
    try {
        const [rows] = await db.execute(
            'SELECT * FROM coupons WHERE shop_domain = ? AND is_active = 1 ORDER BY created_at DESC',
            [normalizeShop(shopDomain)]
        );
        return rows.map(row => {
            let config = {};
            try { config = row.discount_config ? JSON.parse(row.discount_config) : {}; } catch {}
            return {
                id: row.internal_id || String(row.id),
                internal_id: row.internal_id,
                shopify_id: row.shopify_id,
                shop_domain: row.shop_domain,
                code: row.code,
                ...config,
            };
        });
    } catch (e) {
        console.error("[getStoredCoupons] DB error:", e.message);
        return [];
    }
}

// ── Prepare coupon object ─────────────────────────────────────────────────────

export async function storeCoupon(couponData) {
    return {
        ...couponData,
        id: couponData.id || genId(),
        createdAt: new Date().toISOString(),
    };
}

// ── Loader (GET) ──────────────────────────────────────────────────────────────

export async function loader({ request }) {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shopdomain") || url.searchParams.get("shop") || "";
    try {
        const coupons = await getStoredCoupons(shopDomain);
        return Response.json({ coupons }, { status: 200 });
    } catch (error) {
        return Response.json({ error: "Failed to load coupons", details: error.message }, { status: 500 });
    }
}

// ── Action (POST) ─────────────────────────────────────────────────────────────

export async function action({ request }) {
    if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
        const couponData = await request.json();
        if (!couponData || Object.keys(couponData).length === 0) {
            return Response.json({ error: "Empty payload" }, { status: 400 });
        }

        const shopDomain = normalizeShop(couponData.shop_domain || couponData.shopDomain || "");
        const code = (couponData.code || "").trim().toUpperCase();
        const internalId = couponData.internal_id || couponData.id || genId();
        const shopifyId = couponData.shopify_id || null;

        // Everything except identity fields goes into discount_config
        const { shop_domain, shopDomain: _sd, code: _c, internal_id: _ii, shopify_id: _si, id: _id, ...rest } = couponData;
        const discountConfig = JSON.stringify(rest);

        const db = getDb();
        await db.execute(
            `INSERT INTO coupons (internal_id, shopify_id, shop_domain, code, discount_config, is_active)
             VALUES (?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
               shopify_id = VALUES(shopify_id),
               code = VALUES(code),
               discount_config = VALUES(discount_config),
               is_active = 1,
               updated_at = CURRENT_TIMESTAMP`,
            [internalId, shopifyId, shopDomain, code, discountConfig]
        );

        return Response.json({ ...couponData, id: internalId }, { status: 201 });
    } catch (error) {
        console.error("[coupon action] Error:", error.message);
        return Response.json({ error: "Failed to process request", details: error.message }, { status: 500 });
    }
}
