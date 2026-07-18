import { promises as fs } from "fs";
import path from "path";
import { authenticate } from "../shopify.server";

const DATA_FILE = path.resolve("coupons-data.json");

async function readCoupons(shopDomain) {
    try {
        const raw = await fs.readFile(DATA_FILE, "utf-8");
        const all = JSON.parse(raw);
        if (shopDomain && all[shopDomain]) return all[shopDomain];
        if (!shopDomain) return Object.values(all).flat();
        return [];
    } catch {
        return [];
    }
}

export async function loader({ request }) {
    const url = new URL(request.url);
    const shopDomain = (url.searchParams.get("shopdomain") || url.searchParams.get("shop") || "").toLowerCase();

    const coupons = await readCoupons(shopDomain);

    if (!coupons.length) {
        return new Response(
            JSON.stringify({ status: "error", message: "No coupons found for this shop" }),
            { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
    }

    return new Response(JSON.stringify({ status: "success", data: coupons }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
}

export async function action({ request }) {
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ status: "error", message: "Method not allowed" }), { status: 405 });
    }

    // Not currently called from anywhere in the app, but this writes
    // arbitrary coupon data keyed only by a client-supplied shop_domain —
    // require a real Shopify admin session so it can't be hit anonymously
    // for any shop if something ever wires a caller up to it.
    const { session } = await authenticate.admin(request);

    try {
        const coupon = await request.json();
        const shopDomain = session.shop;

        let all = {};
        try {
            const raw = await fs.readFile(DATA_FILE, "utf-8");
            all = JSON.parse(raw);
        } catch { /* file may not exist yet */ }

        if (!all[shopDomain]) all[shopDomain] = [];

        const existingIdx = all[shopDomain].findIndex(
            c => c.shopify_id === coupon.shopify_id || c.internal_id === coupon.internal_id
        );
        if (existingIdx >= 0) {
            all[shopDomain][existingIdx] = coupon;
        } else {
            all[shopDomain].push(coupon);
        }

        await fs.writeFile(DATA_FILE, JSON.stringify(all, null, 2));

        return new Response(JSON.stringify({ status: "success" }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(JSON.stringify({ status: "error", message: error.message }), { status: 500 });
    }
}
