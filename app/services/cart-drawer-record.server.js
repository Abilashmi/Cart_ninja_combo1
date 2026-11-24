import { promises as fs } from "fs";
import path from "path";
import { internalAuthHeaders } from "../utils/internal-auth";

const LOCAL_CART_DATA_FILE = path.resolve("cartdrawer-config-data.json");
const PHP_BASE = process.env.PHP_BASE_URL || 'http://localhost/cartdrawerv2_ui/php_backend';

function normalizeShopDomain(shopDomain) {
    return (shopDomain || "").toString().trim().toLowerCase();
}

async function readLocalMap(file) {
    try {
        const raw = await fs.readFile(file, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

async function writeLocalMap(file, map) {
    try {
        await fs.writeFile(file, JSON.stringify(map, null, 2));
    } catch {}
}

export function truthyFlag(value) {
    return value === 1 || value === "1" || value === true;
}

export async function fetchCartDrawerRecord(shop) {
    const shopKey = normalizeShopDomain(shop);

    try {
        const res = await fetch(
            `${PHP_BASE}/save_cart_drawer.php?shopdomain=${encodeURIComponent(shop)}`,
            {
                method: 'GET',
                headers: { ...internalAuthHeaders() },
            }
        );
        const json = await res.json();
        if (json?.status === 'success' && json?.data) {
            return json.data;
        }
    } catch (e) {
        console.warn('[cart-drawer-record] PHP fetch failed, trying local fallback:', e?.message);
    }

    const localMap = await readLocalMap(LOCAL_CART_DATA_FILE);
    return (shopKey && localMap[shopKey]) ? localMap[shopKey] : null;
}

/**
 * Is the cart drawer switched on for shoppers? The legacy cart_drawer.cartStatus
 * is the one switch: the storefront reads it, and so do the Cart Editor's
 * Active / Inactive pill and Home. (cart_drawer_config.is_enabled is the admin
 * preview's copy and the pill doesn't update it, so it can say "on" for a
 * drawer that is off.) No saved record = the Cart Editor's own default (on).
 */
export async function fetchDrawerEnabled(shop) {
    const record = await fetchCartDrawerRecord(shop);
    return record ? truthyFlag(record.cartStatus ?? record.cart_status) : true;
}

export async function persistCartDrawerRecord(shop, record) {
    const shopKey = normalizeShopDomain(shop);
    const payload = { ...record, shop, shopDomain: shop };

    try {
        const res = await fetch(`${PHP_BASE}/save_cart_drawer.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...internalAuthHeaders(),
            },
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        const ok = json?.status === 'success';

        // Update local JSON only after PHP confirms — so JSON always matches DB
        if (ok && shopKey) {
            const map = await readLocalMap(LOCAL_CART_DATA_FILE);
            map[shopKey] = payload;
            await writeLocalMap(LOCAL_CART_DATA_FILE, map);
        }

        return { ok, response: json, httpStatus: res.status };
    } catch (e) {
        console.error('[cart-drawer-record] PHP save failed:', e?.message);
        return { ok: false, error: e?.message, httpStatus: 500 };
    }
}
