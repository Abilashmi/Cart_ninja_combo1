import { getDb } from "./db.server";

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

export { genId, normalizeShop };
