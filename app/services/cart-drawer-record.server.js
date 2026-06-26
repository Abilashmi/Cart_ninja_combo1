import { promises as fs } from "fs";
import path from "path";

const LOCAL_CART_DATA_FILE = path.resolve("cartdrawer-config-data.json");
const PHP_BASE = process.env.PHP_BASE_URL || 'https://int.thecartninja.com';

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
                headers: { 'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '' },
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

export async function persistCartDrawerRecord(shop, record) {
    const shopKey = normalizeShopDomain(shop);
    const payload = { ...record, shop, shopDomain: shop };

    try {
        const res = await fetch(`${PHP_BASE}/save_cart_drawer.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '',
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
