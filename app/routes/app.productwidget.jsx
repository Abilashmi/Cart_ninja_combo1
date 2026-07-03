import { useState, useEffect, useCallback } from "react";
import { useLoaderData, useRouteError, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";
import {
    Page, Card, BlockStack, InlineStack, Text, Button,
    TextField, Badge, Checkbox, Divider, Select,
    Icon, RangeSlider, Collapsible, Toast, Frame, Banner,
} from "@shopify/polaris";
import BrixBar from "../components/ai-agent/BrixBar";
import {
    DiscountIcon, SettingsIcon, ColorIcon, MagicIcon, ClockIcon,
    ChevronDownIcon, ChevronUpIcon, XSmallIcon, ThemeIcon,
} from "@shopify/polaris-icons";
import { ProBadge } from "../components/plan/PlanGate";
import { usePlan } from "../components/PlanContext";

/* ─── FAKE DEFAULTS ───────────────────────────────────────────────────────── */
const FAKE_COUPON_CONFIG = {
    activeTemplate: "template1",
    selectedActiveCoupons: [],
    displayCondition: "all",
    templates: {
        template1: { name: "Classic Banner", headingText: "GET 10% OFF!", subtextText: "Apply at checkout for savings", bgColor: "#ffffff", textColor: "#111827", accentColor: "#3b82f6", buttonColor: "#3b82f6", buttonTextColor: "#ffffff", borderRadius: 12, fontSize: 16, padding: 16 },
        template2: { name: "Minimal Card",   headingText: "SPECIAL OFFER",   subtextText: "Free shipping on orders over ₹500", bgColor: "#f9fafb", textColor: "#374151", accentColor: "#10b981", buttonColor: "#10b981", buttonTextColor: "#ffffff", borderRadius: 8,  fontSize: 14, padding: 14 },
        template3: { name: "Bold & Vibrant", headingText: "FLASH SALE!",     subtextText: "Use code: BOLD25 for extra 25% OFF",  bgColor: "#000000", textColor: "#ffffff", accentColor: "#f59e0b", buttonColor: "#f59e0b", buttonTextColor: "#111827", borderRadius: 16, fontSize: 18, padding: 20 },
    },
};

const FAKE_FBT_CONFIG = {
    activeTemplate: "fbt1", mode: "manual",
    templates: { fbt1: { name: "Classic Grid", layout: "horizontal", interactionType: "classic", bgColor: "#ffffff", textColor: "#111827", priceColor: "#059669", buttonColor: "#111827", buttonTextColor: "#ffffff", borderColor: "#e5e7eb", borderRadius: 8, showPrices: true, showAddAllButton: true } },
    manualRules: [],
};

/* ─── EMBED STATUS ────────────────────────────────────────────────────────── */
async function getEmbedStatus(shop, accessToken) {
    try {
        const themesRes = await fetch(
            `https://${shop}/admin/api/2024-04/themes.json?role=main`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        const { themes } = await themesRes.json();
        const mainTheme = (themes || []).find(t => t.role === 'main') || themes?.[0];
        if (!mainTheme) return { couponEmbedEnabled: false, fbtEmbedEnabled: false };

        const assetRes = await fetch(
            `https://${shop}/admin/api/2024-04/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        const { asset } = await assetRes.json();
        const settingsData = JSON.parse(asset?.value || '{}');
        const current = settingsData?.current || {};

        // Collect all blocks across every section (theme structure varies)
        const allBlocks = [];
        Object.values(current.sections || {}).forEach(section => {
            Object.values(section?.blocks || {}).forEach(b => allBlocks.push(b));
        });
        Object.values(current.blocks || {}).forEach(b => allBlocks.push(b));

        console.log('[EmbedCheck] blocks found:', allBlocks.map(b => ({ type: b.type, disabled: b.disabled })));
        let couponEmbedEnabled = false, fbtEmbedEnabled = false;
        for (const block of allBlocks) {
            if (block.disabled) continue;
            const t = (block.type || '').toLowerCase();
            if (t.includes('coupon_slider')) couponEmbedEnabled = true;
            if (t.includes('fbt')) fbtEmbedEnabled = true;
        }
        console.log('[EmbedCheck] result:', { couponEmbedEnabled, fbtEmbedEnabled });
        return { couponEmbedEnabled, fbtEmbedEnabled };
    } catch {
        return { couponEmbedEnabled: false, fbtEmbedEnabled: false };
    }
}

/* ─── LOADER ──────────────────────────────────────────────────────────────── */
export async function loader({ request }) {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const url = new URL(request.url);

    const [productsResponse, discountsResponse, couponRes, fbtRes] = await Promise.all([
        admin.graphql(`query getProducts { products(first: 50, query: "status:active") { edges { node { id title handle featuredImage { url } variants(first: 1) { edges { node { id price } } } } } } }`),
        admin.graphql(`query DiscountList { discountNodes(first: 100, reverse: true) { edges { node { id discount { ... on DiscountCodeBasic { title codes(first: 1) { edges { node { code } } } status } ... on DiscountCodeBxgy { title codes(first: 1) { edges { node { code } } } status } ... on DiscountCodeFreeShipping { title codes(first: 1) { edges { node { code } } } status } } } } } }`),
        fetch(`${BASE_PHP_URL}/coupon_slider_settings.php?shop=${encodeURIComponent(shop)}`, { headers: { 'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '' } }).catch(() => null),
        fetch(`${url.origin}/api/fbt-widget?shopdomain=${encodeURIComponent(shop)}`).catch(() => null),
    ]);

    let products = [];
    try {
        const data = await productsResponse.json();
        products = data.data?.products?.edges?.map(({ node }) => {
            const fv = node?.variants?.edges?.[0]?.node;
            if (!fv?.id) return null;
            return { id: node.id, title: node.title, handle: node.handle, image: node.featuredImage?.url || "", variantId: fv.id, price: fv.price || "0.00" };
        }).filter(Boolean) || [];
    } catch (e) { console.error("Failed to fetch products:", e); }

    let discounts = [];
    try {
        const discountJson = await discountsResponse.json();
        discounts = (discountJson.data?.discountNodes?.edges || [])
            .map(({ node }) => {
                const d = node.discount;
                if (!d) return null;
                const code = d.codes?.edges?.[0]?.node?.code || '';
                if (!code || d.status !== 'ACTIVE') return null;
                return { id: node.id, code, title: d.title || code };
            })
            .filter(Boolean);
    } catch (e) { console.error("Failed to fetch discounts:", e); }

    let couponConfig = null;
    try {
        if (couponRes) {
            const d = await couponRes.json();
            if (d.status === 'success' && d.data) couponConfig = d.data;
        }
    } catch (e) { console.error("Failed to fetch coupon settings:", e); }
    if (!couponConfig) couponConfig = { ...FAKE_COUPON_CONFIG, selectedActiveCoupons: [], templates: { ...FAKE_COUPON_CONFIG.templates } };

    let fbtConfig = null;
    try {
        if (fbtRes) {
            const d = await fbtRes.json();
            if (d.success && d.fbt) fbtConfig = d.fbt;
        }
    } catch (e) { console.error("Failed to fetch FBT settings:", e); }
    if (!fbtConfig) fbtConfig = { ...FAKE_FBT_CONFIG, templates: { ...FAKE_FBT_CONFIG.templates } };

    const { couponEmbedEnabled, fbtEmbedEnabled } = await getEmbedStatus(shop, session.accessToken);

    return { couponConfig, fbtConfig, products, shop, discounts, couponEmbedEnabled, fbtEmbedEnabled };
}

/* ─── ACTION ──────────────────────────────────────────────────────────────── */
export async function action({ request }) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const body = await request.json();

    const { activeTemplate, template, couponStyles, couponConditions, selectedActiveCoupons, isEnabled, ...rest } = body;

    const tplKey = activeTemplate || "template1";
    const widgetPayload = {
        shop,
        selectedTemplate: tplKey,
        selectedTemplateCoupon: selectedActiveCoupons?.[0] || null,
        selectedCouponsGlobal: Array.isArray(selectedActiveCoupons) ? selectedActiveCoupons.filter(Boolean) : [],
        [tplKey]: { styles: template, couponStyles: couponStyles || {}, couponConditions: couponConditions || [] },
        ...rest,
    };
    const settingsPayload = {
        shop,
        is_enabled: isEnabled ? 1 : 0,
        selected_template: tplKey,
        position: rest.widgetPlacement || 'above_cart',
        layout: rest.layout || 'list',
        display_condition: rest.displayCondition || 'all',
        product_handles: JSON.stringify(Array.isArray(rest.productHandles) ? rest.productHandles : []),
        collection_handles: JSON.stringify(Array.isArray(rest.collectionHandles) ? rest.collectionHandles : []),
        tag_handles: JSON.stringify(Array.isArray(rest.tagHandles) ? rest.tagHandles : []),
    };

    try {
        const [widgetRes, settingsRes] = await Promise.all([
            fetch(`${BASE_PHP_URL}/save_coupon_slider_widget.php`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(widgetPayload),
            }),
            fetch(`${BASE_PHP_URL}/coupon_slider_settings.php`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Forge-Secret": process.env.SHOPIFY_API_KEY || "" },
                body: JSON.stringify(settingsPayload),
            }),
        ]);
        const widgetData = await widgetRes.json().catch(() => ({}));
        const settingsData = await settingsRes.json().catch(() => ({}));
        if (widgetData.status === "success" || settingsData.status === "success") return { success: true };
        console.error("[ProductWidget action] PHP errors:", { widgetData, settingsData });
    } catch (e) { console.error("[ProductWidget action] Save failed:", e); }
    return { success: false };
}

/* ─── CONSTANTS ───────────────────────────────────────────────────────────── */
const TEMPLATES = [
    { id: "classic-banner", name: "Classic Banner", tplKey: "template1" },
    { id: "minimal-card",   name: "Minimal Card",   tplKey: "template2" },
    { id: "bold-vibrant",   name: "Bold & Vibrant", tplKey: "template3" },
];

const SHOW_ON_OPTIONS = [
    { label: "All pages",                  value: "all"         },
    { label: "Specific product pages",     value: "products"    },
    { label: "Specific collection pages",  value: "collections" },
    { label: "Products with specific tags",value: "tags"        },
];

const SECTION_TIPS = {
    coupon:  "Displaying a coupon directly on the product page increases add-to-cart rates by up to 28% — shoppers act sooner when the deal is visible before checkout.",
    display: "Targeting coupon banners to high-intent products channels your discount budget where it converts most — driving 2–3× more revenue per coupon displayed.",
    text:    "Clear, benefit-led headings outperform vague ones — \"Save 10% today\" converts up to 2× better than just showing the coupon code.",
    design:  "High-contrast coupon widget designs see 15–25% more coupon code copies — make your offer impossible to miss.",
    timer:   "Countdown timers on product pages boost purchase intent by up to 65% — the visible deadline gives shoppers the nudge they need to act right now.",
};

/* ─── HELPERS ─────────────────────────────────────────────────────────────── */
function AccordionSection({ id, icon, title, isOpen, onToggle, tip, children }) {
    return (
        <div style={{
            border: `1px solid ${isOpen ? '#b5e3d8' : '#e5e7eb'}`,
            borderRadius: "10px", overflow: "hidden",
            transition: "border-color 0.15s, box-shadow 0.15s",
            boxShadow: isOpen ? "0 0 0 2px rgba(0,128,96,0.06)" : "none",
        }}>
            <button
                onClick={() => onToggle(id)}
                style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 18px", background: isOpen ? "#f6fffe" : "#fafafa",
                    border: "none", cursor: "pointer", borderBottom: isOpen ? "1px solid #e5e7eb" : "none",
                    transition: "background 0.15s",
                }}
                aria-expanded={isOpen}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: "34px", height: "34px", borderRadius: "8px", flexShrink: 0, background: isOpen ? "#e6f4f1" : "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}>
                        <Icon source={icon} />
                    </div>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: isOpen ? "#008060" : "#202223" }}>{title}</span>
                </div>
                <span style={{ flexShrink: 0, color: "#637381" }}>
                    <Icon source={isOpen ? ChevronUpIcon : ChevronDownIcon} />
                </span>
            </button>
            <Collapsible open={isOpen} id={`pw-section-${id}`}>
                <div style={{ padding: "20px 18px", background: "#fff" }}>
                    {children}
                    {tip && (
                        <div style={{ marginTop: "16px", background: "#eef2ff", border: "1px solid #c7d2fe", borderLeft: "3px solid #6366f1", borderRadius: "8px", padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            <span style={{ minWidth: "18px", width: "18px", height: "18px", borderRadius: "50%", background: "#6366f1", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>
                                <Icon source={MagicIcon} />
                            </span>
                            <p style={{ margin: 0, fontSize: "13.5px", color: "#312e81", lineHeight: 1.65 }}>{tip}</p>
                        </div>
                    )}
                </div>
            </Collapsible>
        </div>
    );
}

function ColorSwatch({ label, value, onChange }) {
    return (
        <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm">{label}</Text>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: value, border: "1px solid #e1e3e5", flexShrink: 0, overflow: "hidden", cursor: "pointer" }}>
                    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ opacity: 0, width: "200%", height: "200%", cursor: "pointer", marginLeft: "-50%", marginTop: "-50%" }} />
                </div>
                <Text as="span" variant="bodySm" tone="subdued">{value}</Text>
            </div>
        </InlineStack>
    );
}

function CountdownStrip({ hours, minutes, label, expiredLabel, bgColor, textColor, accentColor }) {
    const total = hours * 3600 + minutes * 60;
    const [rem, setRem] = useState(total);
    useEffect(() => { setRem(total); }, [total]);
    useEffect(() => {
        if (rem <= 0) return;
        const t = setInterval(() => setRem(r => Math.max(0, r - 1)), 1000);
        return () => clearInterval(t);
    }, [rem]);
    const pad = (n) => String(n).padStart(2, "0");
    const h = Math.floor(rem / 3600);
    const m = Math.floor((rem % 3600) / 60);
    const s = rem % 60;
    const expired = rem <= 0;
    return (
        <div style={{ marginTop: "10px", backgroundColor: bgColor, borderRadius: "6px", padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500, color: textColor }}>{expired ? expiredLabel : label}</span>
            {!expired && <span style={{ fontSize: "15px", fontWeight: 700, color: accentColor, fontVariantNumeric: "tabular-nums" }}>{h > 0 && `${pad(h)}:`}{pad(m)}:{pad(s)}</span>}
        </div>
    );
}

/* ─── COUPON SELECTOR ─────────────────────────────────────────────────────── */
function CouponSelector({ discounts, selectedCouponIds, search, onSearchChange, onToggle, onClear }) {
    const filtered = (discounts || []).filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return c.code.toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q);
    });

    const selectedIds = selectedCouponIds || [];
    const selectedCount = selectedIds.length;

    return (
        <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">Choose which coupons to display in this widget — select one or more.</Text>

            {selectedCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "8px", border: "1.5px solid #b5e3d8", background: "#f1f8f5" }}>
                    <InlineStack gap="200" blockAlign="center">
                        <div style={{ width: "32px", height: "32px", borderRadius: "6px", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Icon source={DiscountIcon} />
                        </div>
                        <Text as="span" variant="bodySm" fontWeight="semibold">{selectedCount} coupon{selectedCount > 1 ? "s" : ""} selected</Text>
                    </InlineStack>
                    <button
                        onClick={() => onClear && onClear()}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#637381", fontSize: "13px", padding: "2px" }}
                        title="Clear all"
                    >
                        Clear all
                    </button>
                </div>
            )}

            {!discounts || discounts.length === 0 ? (
                <div style={{ padding: "16px", textAlign: "center", border: "1px dashed #c9cccf", borderRadius: "8px", background: "#f9fafb" }}>
                    <Text as="p" variant="bodySm" tone="subdued">
                        No active discount codes found. Create coupons in the <strong>Coupon Creator</strong> section first.
                    </Text>
                </div>
            ) : (
                <BlockStack gap="200">
                    <TextField
                        label=""
                        labelHidden
                        placeholder="Search coupons…"
                        value={search}
                        onChange={onSearchChange}
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => onSearchChange("")}
                    />
                    <div style={{ maxHeight: "260px", overflowY: "auto", border: "1px solid #e1e3e5", borderRadius: "8px" }}>
                        {filtered.length === 0 ? (
                            <div style={{ padding: "16px", textAlign: "center" }}>
                                <Text as="p" variant="bodySm" tone="subdued">No coupons match your search.</Text>
                            </div>
                        ) : (
                            filtered.map((coupon, idx) => {
                                const isSelected = selectedIds.includes(coupon.id);
                                return (
                                    <button
                                        key={coupon.id}
                                        onClick={() => onToggle(coupon.id)}
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "10px 14px",
                                            background: isSelected ? "#f1f8f5" : "#ffffff",
                                            border: "none",
                                            borderBottom: idx < filtered.length - 1 ? "1px solid #f1f2f3" : "none",
                                            cursor: "pointer",
                                            textAlign: "left",
                                            gap: "10px",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                                            <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: isSelected ? "#dcfce7" : "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                                <Icon source={DiscountIcon} />
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: "13px", fontWeight: 600, color: isSelected ? "#008060" : "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {coupon.code}
                                                </div>
                                                {coupon.title !== coupon.code && (
                                                    <div style={{ fontSize: "11px", color: "#6d7175", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {coupon.title}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {isSelected && (
                                            <span style={{ width: "18px", height: "18px", borderRadius: "50%", background: "#008060", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                                <span style={{ color: "#fff", fontSize: "11px", lineHeight: 1 }}>✓</span>
                                            </span>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </BlockStack>
            )}
        </BlockStack>
    );
}

/* Per-coupon override editor — text, colors, and display pages for one coupon */
function CouponOverridePanel({ coupon, override, onChange, alwaysOpen }) {
    const shopify = useAppBridge();
    const [openState, setOpen] = useState(false);
    const open = alwaysOpen || openState;
    const ov = override || {};
    const colorRow = (label, key, def) => (
        <InlineStack gap="200" blockAlign="center">
            <div style={{ flex: 1 }}><Text as="span" variant="bodySm">{label}</Text></div>
            <input type="color" value={ov[key] || def} onChange={(e) => onChange({ [key]: e.target.value })}
                style={{ width: "36px", height: "28px", border: "1px solid #c9cccf", borderRadius: "6px", cursor: "pointer", padding: 0, background: "none" }} />
        </InlineStack>
    );
    return (
        <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
            {!alwaysOpen && (
                <button onClick={() => setOpen((o) => !o)}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: open ? "#f6f6f7" : "#fff", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{coupon.code}</Text>
                    <span style={{ color: "#637381", fontSize: "11px" }}>{open ? "▲" : "▼"}</span>
                </button>
            )}
            {open && (
                <div style={{ padding: "12px", borderTop: "1px solid #e1e3e5" }}>
                    <BlockStack gap="300">
                        <TextField label="Heading" value={ov.headingText ?? ""} onChange={(v) => onChange({ headingText: v })} placeholder="Uses template default if empty" autoComplete="off" />
                        <TextField label="Subtext" value={ov.subtextText ?? ""} onChange={(v) => onChange({ subtextText: v })} placeholder="Uses template default if empty" autoComplete="off" />
                        {colorRow("Background", "bgColor", "#ffffff")}
                        {colorRow("Text", "textColor", "#111827")}
                        {colorRow("Accent", "accentColor", "#3b82f6")}
                        {colorRow("Button", "buttonColor", "#3b82f6")}
                        {colorRow("Button text", "buttonTextColor", "#ffffff")}
                        <Select label="Show on" value={ov.displayCondition || "all"} onChange={(v) => onChange({ displayCondition: v })}
                            options={[{ label: "All product pages", value: "all" }, { label: "Specific products", value: "product_handle" }, { label: "Specific collections", value: "collection_handle" }]} />
                        {ov.displayCondition === "product_handle" && (
                            <BlockStack gap="200">
                                <Button size="slim" onClick={async () => {
                                    const result = await shopify.resourcePicker({ type: 'product', multiple: true });
                                    if (result) onChange({ productHandles: result.map(p => p.handle) });
                                }}>Browse Products</Button>
                                {(ov.productHandles || []).length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {(ov.productHandles || []).map(h => (
                                            <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#f1f8f5', border: '1px solid #b5e3d8', borderRadius: 4, fontSize: 12 }}>
                                                {h}
                                                <button onClick={() => onChange({ productHandles: (ov.productHandles || []).filter(x => x !== h) })}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#637381', padding: 0, lineHeight: 1 }}>×</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </BlockStack>
                        )}
                        {ov.displayCondition === "collection_handle" && (
                            <BlockStack gap="200">
                                <Button size="slim" onClick={async () => {
                                    const result = await shopify.resourcePicker({ type: 'collection', multiple: true });
                                    if (result) onChange({ collectionHandles: result.map(c => c.handle) });
                                }}>Browse Collections</Button>
                                {(ov.collectionHandles || []).length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {(ov.collectionHandles || []).map(h => (
                                            <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#f1f8f5', border: '1px solid #b5e3d8', borderRadius: 4, fontSize: 12 }}>
                                                {h}
                                                <button onClick={() => onChange({ collectionHandles: (ov.collectionHandles || []).filter(x => x !== h) })}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#637381', padding: 0, lineHeight: 1 }}>×</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </BlockStack>
                        )}
                    </BlockStack>
                </div>
            )}
        </div>
    );
}

/* ─── COMPONENT ───────────────────────────────────────────────────────────── */
export default function ProductWidgetPage() {
    const { couponConfig, shop, discounts, couponEmbedEnabled, fbtEmbedEnabled } = useLoaderData();
    const fetcher = useFetcher();
    const shopify = useAppBridge();
    const { canPublishFeature } = usePlan();
    const couponPublishable = canPublishFeature('coupon_lock_pro');

    const tKey = couponConfig?.activeTemplate || "template1";
    const activeTpl = couponConfig?.templates?.[tKey] || FAKE_COUPON_CONFIG.templates.template1;

    /* state */
    const [isEnabled,   setIsEnabled]   = useState(couponConfig?.is_enabled !== 0);
    // Free plan can't publish Coupon Lock Pro at all — the backend already
    // forces is_enabled off in the storefront-facing response regardless of
    // this toggle, so reflect that truthfully in the UI too instead of
    // letting the merchant "turn it on" and think it's live.
    const effectiveEnabled = isEnabled && couponPublishable;
    const [selectedTemplate, setSelectedTemplate] = useState(() => {
        if (tKey === "template1" || tKey === "classic-banner") return "classic-banner";
        if (tKey === "template2" || tKey === "minimal-card")   return "minimal-card";
        if (tKey === "template3" || tKey === "bold-vibrant")   return "bold-vibrant";
        return "classic-banner"; // safe default: first template
    });
    const [openSection, setOpenSection] = useState(null);
    const [heading,     setHeading]     = useState(activeTpl.headingText || "GET 10% OFF!");
    const [subtext,     setSubtext]     = useState(activeTpl.subtextText || "Apply at checkout for savings");
    const [bgColor,     setBgColor]     = useState(activeTpl.bgColor     || "#ffffff");
    const [textColor,   setTextColor]   = useState(activeTpl.textColor   || "#111827");
    const [accentColor, setAccentColor] = useState(activeTpl.accentColor || "#3b82f6");
    const [buttonColor, setButtonColor] = useState(activeTpl.buttonColor || "#3b82f6");
    const [btnTextColor,setBtnTextColor]= useState(activeTpl.buttonTextColor || "#ffffff");
    const [borderRadius,setBorderRadius]= useState(activeTpl.borderRadius ?? 12);
    const [fontSize,    setFontSize]    = useState(activeTpl.fontSize    ?? 16);
    const [padding,     setPadding]     = useState(activeTpl.padding     ?? 16);
    const [showOn,           setShowOn]           = useState(couponConfig?.display_condition || couponConfig?.displayCondition || "all");
    const [productHandles,   setProductHandles]   = useState(() => { try { return JSON.parse(couponConfig?.product_handles || '[]'); } catch { return []; } });
    const [collectionHandles,setCollectionHandles]= useState(() => { try { return JSON.parse(couponConfig?.collection_handles || '[]'); } catch { return []; } });
    const [tagInput,         setTagInput]         = useState("");
    const [tagHandles,       setTagHandles]        = useState(() => { try { return JSON.parse(couponConfig?.tag_handles || '[]'); } catch { return []; } });
    const [timerEnabled,setTimerEnabled]= useState(false);
    const [timerHours,  setTimerHours]  = useState(0);
    const [timerMins,   setTimerMins]   = useState(15);
    const [timerLabel,  setTimerLabel]  = useState("Offer expires in");
    const [timerExpired,setTimerExpired]= useState("Offer expired!");
    const [timerBg,     setTimerBg]     = useState("#fef2f2");
    const [timerText,   setTimerText]   = useState("#991b1b");
    const [timerAccent, setTimerAccent] = useState("#dc2626");
    const [selectedCouponIds, setSelectedCouponIds] = useState(
        Array.isArray(couponConfig?.selectedActiveCoupons) ? couponConfig.selectedActiveCoupons.filter(Boolean) : []
    );
    const toggleCoupon = (id) => {
        setSelectedCouponIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
        setHasChanges(true);
    };
    // Per-coupon overrides: { [couponId]: { headingText, subtextText, bgColor, textColor, accentColor, buttonColor, buttonTextColor, displayCondition, productHandles } }
    const [couponOverrides, setCouponOverrides] = useState(() => {
        const styleMap = couponConfig?.temp1CouponStyle || couponConfig?.temp2CouponStyle || couponConfig?.temp3CouponStyle || {};
        const condArr = couponConfig?.temp1CouponCondition || couponConfig?.temp2CouponCondition || couponConfig?.temp3CouponCondition || [];
        const out = {};
        Object.keys(styleMap || {}).forEach((cid) => { out[cid] = { ...styleMap[cid] }; });
        (Array.isArray(condArr) ? condArr : []).forEach((c) => {
            if (!c || !c.couponId) return;
            out[c.couponId] = { ...(out[c.couponId] || {}), displayCondition: c.displayCondition || "all", productHandles: c.productHandles || [], collectionHandles: c.collectionHandles || [] };
        });
        return out;
    });
    const updateOverride = (cid, patch) => {
        setCouponOverrides((prev) => ({ ...prev, [cid]: { ...(prev[cid] || {}), ...patch } }));
        setHasChanges(true);
    };
    // Which selected coupon is currently being customized (drives the editor fields + preview)
    const [editingCouponId, setEditingCouponId] = useState(
        (Array.isArray(couponConfig?.selectedActiveCoupons) && couponConfig.selectedActiveCoupons[0]) || ""
    );
    // Display layout for the coupon banner: list (stacked) / carousel (slider) / grid
    const [couponLayout, setCouponLayout] = useState(couponConfig?.layout || "list");
    useEffect(() => {
        if (selectedCouponIds.length && !selectedCouponIds.includes(editingCouponId)) {
            setEditingCouponId(selectedCouponIds[0]);
        }
    }, [selectedCouponIds, editingCouponId]);
    const [couponSearch,  setCouponSearch]  = useState("");
    const [widgetPlacement, setWidgetPlacement] = useState(couponConfig?.position || "above_cart");
    const [hasChanges,    setHasChanges]    = useState(false);
    const [toastActive,   setToastActive]   = useState(false);

    const isSaving = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data?.success) { setToastActive(true); setHasChanges(false); }
    }, [fetcher.data]);

    const mark = () => setHasChanges(true);

    const applyTemplate = (id) => {
        const t = TEMPLATES.find(x => x.id === id);
        if (!t) return;
        setSelectedTemplate(id);
        const src = FAKE_COUPON_CONFIG.templates[t.tplKey];
        if (src) {
            setHeading(src.headingText); setSubtext(src.subtextText);
            setBgColor(src.bgColor); setTextColor(src.textColor);
            setAccentColor(src.accentColor); setButtonColor(src.buttonColor);
            setBtnTextColor(src.buttonTextColor);
            setBorderRadius(src.borderRadius); setFontSize(src.fontSize); setPadding(src.padding);
        }
        mark();
    };

    const toggleSection = useCallback((id) => setOpenSection(p => p === id ? null : id), []);

    const handleSave = () => {
        const tplKeyMap = { "classic-banner": "template1", "minimal-card": "template2", "bold-vibrant": "template3" };
        // Build per-coupon style + condition overrides for the selected coupons
        const couponStyles = {};
        const couponConditions = [];
        selectedCouponIds.forEach((cid) => {
            const ov = couponOverrides[cid] || {};
            const couponObj = (discounts || []).find((c) => c.id === cid);
            const style = {};
            // Save the real discount code so "Copy Code" copies the code, not the GID number
            if (couponObj?.code) style.couponCode = couponObj.code;
            ["headingText", "subtextText", "bgColor", "textColor", "accentColor", "buttonColor", "buttonTextColor"].forEach((k) => {
                if (ov[k] !== undefined && ov[k] !== "") style[k] = ov[k];
            });
            if (Object.keys(style).length) couponStyles[cid] = style;
            if (ov.displayCondition && ov.displayCondition !== "all") {
                couponConditions.push({ couponId: cid, displayCondition: ov.displayCondition, productHandles: ov.productHandles || [], collectionHandles: ov.collectionHandles || [] });
            }
        });
        fetcher.submit(
            {
                activeTemplate: tplKeyMap[selectedTemplate] || "template1",
                isEnabled,
                displayCondition: showOn,
                productHandles,
                collectionHandles,
                tagHandles,
                selectedActiveCoupons: selectedCouponIds,
                template: { headingText: heading, subtextText: subtext, bgColor, textColor, accentColor, buttonColor, buttonTextColor: btnTextColor, borderRadius, fontSize, padding },
                couponStyles,
                couponConditions,
                layout: couponLayout,
                timerEnabled, timerHours, timerMins, timerLabel, timerExpired, timerBg, timerText, timerAccent,
                widgetPlacement,
            },
            { method: "POST", encType: "application/json" }
        );
    };

    /* live preview */
    // Effective values for the coupon currently being customized (override → global default)
    const editOv = couponOverrides[editingCouponId] || {};
    const editingCoupon = (discounts || []).find((c) => c.id === editingCouponId);
    const pvHeading = editOv.headingText || heading;
    const pvSubtext = editOv.subtextText || subtext;
    const pvBg = editOv.bgColor || bgColor;
    const pvText = editOv.textColor || textColor;
    const pvAccent = editOv.accentColor || accentColor;
    const pvButton = editOv.buttonColor || buttonColor;
    const pvBtnText = editOv.buttonTextColor || btnTextColor;
    const previewCode = editingCoupon?.code || (discounts || []).find((c) => c.id === selectedCouponIds[0])?.code || "CODE";
    const btn = { background: pvButton, color: pvBtnText, border: "none", borderRadius: `${borderRadius}px`, cursor: "pointer", fontWeight: 600 };

    const timerStrip = timerEnabled ? (
        <CountdownStrip hours={timerHours} minutes={timerMins} label={timerLabel} expiredLabel={timerExpired} bgColor={timerBg} textColor={timerText} accentColor={timerAccent} />
    ) : null;

    const renderPreview = () => {
        if (selectedTemplate === "classic-banner") {
            return (
                <div style={{ background: pvBg, borderRadius: `${borderRadius}px`, padding: `${padding}px`, border: "1px solid #e5e7eb", borderLeft: `4px solid ${pvAccent}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                        <div>
                            <div style={{ fontSize: `${fontSize}px`, fontWeight: 700, color: pvText, marginBottom: "3px" }}>{pvHeading}</div>
                            <div style={{ fontSize: "13px", color: pvText, opacity: 0.65 }}>{pvSubtext}</div>
                        </div>
                        <button style={{ ...btn, padding: "8px 20px", fontSize: "14px", flexShrink: 0 }}>{previewCode}</button>
                    </div>
                    {timerStrip}
                </div>
            );
        }
        if (selectedTemplate === "minimal-card") {
            return (
                <div style={{ background: pvBg, borderRadius: `${borderRadius}px`, padding: `${padding}px`, border: "1px solid #e5e7eb" }}>
                    <div style={{ display: "flex", gap: "12px" }}>
                        <div style={{ background: pvAccent + "18", borderRadius: `${Math.max(borderRadius - 2, 4)}px`, padding: "14px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: "110px", border: `1px dashed ${pvAccent}50` }}>
                            <div style={{ fontSize: "9px", letterSpacing: "2px", color: pvAccent, marginBottom: "6px", textTransform: "uppercase", fontWeight: 600 }}>YOUR CODE</div>
                            <div style={{ fontSize: "15px", fontWeight: 800, color: pvAccent, letterSpacing: "3px" }}>{previewCode}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: `${fontSize}px`, fontWeight: 700, color: pvText, marginBottom: "4px" }}>{pvHeading}</div>
                            <div style={{ fontSize: "12px", color: pvText, opacity: 0.65, marginBottom: "12px" }}>{pvSubtext}</div>
                            <button style={{ ...btn, padding: "6px 16px", fontSize: "13px" }}>Redeem Now</button>
                        </div>
                    </div>
                    {timerStrip}
                </div>
            );
        }
        return (
            <div style={{ background: pvBg, borderRadius: `${borderRadius}px`, padding: `${padding}px` }}>
                <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                    <div style={{ width: "44px", height: "44px", background: pvAccent + "28", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon source={DiscountIcon} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: `${fontSize}px`, fontWeight: 800, color: pvText, marginBottom: "4px" }}>{pvHeading}</div>
                        <div style={{ fontSize: "12px", color: pvText, opacity: 0.85, marginBottom: "10px" }}>{pvSubtext}</div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <div style={{ border: `2px dashed ${pvAccent}`, borderRadius: "6px", padding: "5px 14px", color: pvAccent, fontSize: "13px", fontWeight: 700, letterSpacing: "2px" }}>{previewCode}</div>
                            <button style={{ ...btn, padding: "6px 18px", fontSize: "13px" }}>Apply</button>
                        </div>
                    </div>
                </div>
                {timerStrip}
            </div>
        );
    };

    const templateName = TEMPLATES.find(t => t.id === selectedTemplate)?.name ?? "";

    return (
        <Frame>
            {toastActive && <Toast content="Settings saved!" onDismiss={() => setToastActive(false)} />}
            <BrixBar size="md" floating />
            <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#f6f6f7" }}>

                {/* ── Top bar ── */}
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", background: "#fff", borderBottom: "1px solid #e1e3e5", borderLeft: "4px solid #ea580c" }}>
                    <div style={{ width: 30, height: 30, borderRadius: 7, background: effectiveEnabled ? "#ea580c" : "#babec3", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <div style={{ filter: "brightness(0) invert(1)", display: "flex" }}><Icon source={DiscountIcon} /></div>
                    </div>
                    <div>
                        <InlineStack gap="200" blockAlign="center">
                            <Text as="h1" variant="headingMd">Coupon Banner</Text>
                            <ProBadge featureKey="coupon_lock_pro" />
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">Promo banner on <span style={{ color: "#008060", fontWeight: 500 }}>product pages</span></Text>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                        {fetcher.data?.success === false && <Text as="span" variant="bodySm" tone="critical">Save failed. Please try again.</Text>}
                        <Badge tone={effectiveEnabled ? "success" : undefined}>{effectiveEnabled ? "Active" : "Inactive"}</Badge>
                        <button
                            onClick={() => { if (!couponPublishable) return; setIsEnabled(p => !p); mark(); }}
                            aria-label="Toggle Coupon Banner"
                            disabled={!couponPublishable}
                            title={!couponPublishable ? "Upgrade to Starter to enable this on your storefront" : undefined}
                            style={{ width: "48px", height: "26px", borderRadius: "13px", border: "none", background: effectiveEnabled ? "#008060" : "#babec3", position: "relative", cursor: couponPublishable ? "pointer" : "not-allowed", opacity: couponPublishable ? 1 : 0.5, transition: "background 0.2s ease", flexShrink: 0, padding: 0 }}
                        >
                            <span style={{ position: "absolute", top: "3px", left: effectiveEnabled ? "25px" : "3px", width: "20px", height: "20px", borderRadius: "50%", background: "#ffffff", transition: "left 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", display: "block" }} />
                        </button>
                        <div style={{ width: 1, height: 24, background: "#e1e3e5" }} />
                        <Button icon={ThemeIcon} url={`https://${shop}/admin/themes/current/editor?context=apps`} target="_blank" size="slim">Customize in Store</Button>
                        <div style={{ width: 1, height: 24, background: "#e1e3e5" }} />
                        <Button onClick={() => setHasChanges(false)} disabled={!hasChanges} size="slim">Discard</Button>
                        <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!hasChanges} size="slim">Save</Button>
                    </div>
                </div>


                {/* ── Two-column body ── */}
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "58% 42%", minHeight: 0, overflow: "hidden" }}>
                    {/* Left column — settings (scrolls internally). Extra bottom padding
                        keeps the last field's helpText from hiding behind the floating
                        BrixBar (fixed at 20px from viewport bottom). */}
                    <div style={{ overflowY: "auto", padding: "12px 12px 100px", borderRight: "1px solid #e1e3e5", display: "flex", flexDirection: "column", gap: "12px" }}>
                            {/* Theme embed status — only relevant once the plan can actually
                                publish this; on Free the toggle above is already locked off,
                                so no embed-status messaging is shown here at all. */}
                            {couponPublishable && (
                                !couponEmbedEnabled ? (
                                    <Banner
                                        title="Coupon Banner is not visible on your store yet"
                                        tone="warning"
                                        action={{ content: 'Enable in theme editor', url: `https://${shop}/admin/themes/current/editor?context=apps`, target: '_blank' }}
                                    >
                                        <p>Go to <strong>App embeds</strong> and turn on <em>Coupon Banner</em>. You can also set the placement (Above / Below Add to Cart) there.</p>
                                    </Banner>
                                ) : (
                                    <Banner tone="success" title="Coupon Banner is live on your store" />
                                )
                            )}
                            <Card>
                                <BlockStack gap="300">
                                    <Text as="h2" variant="headingMd">Select Template</Text>
                                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        {TEMPLATES.map(t => (
                                            <button
                                                key={t.id}
                                                onClick={() => applyTemplate(t.id)}
                                                style={{ padding: "8px 20px", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: 500, border: `1.5px solid ${selectedTemplate === t.id ? "#008060" : "#c9cccf"}`, background: selectedTemplate === t.id ? "#f1f8f5" : "#ffffff", color: selectedTemplate === t.id ? "#008060" : "#202223", transition: "all 0.15s", outline: "none" }}
                                            >
                                                {t.name}
                                            </button>
                                        ))}
                                    </div>
                                </BlockStack>
                            </Card>

                            <Card>
                                <BlockStack gap="300">
                                    <Text as="h2" variant="headingMd">Customize: {templateName}</Text>

                                    <AccordionSection id="coupon" icon={DiscountIcon} title="Coupon Selection" isOpen={openSection === "coupon"} onToggle={toggleSection} tip={SECTION_TIPS.coupon}>
                                        <CouponSelector
                                            discounts={discounts}
                                            selectedCouponIds={selectedCouponIds}
                                            search={couponSearch}
                                            onSearchChange={setCouponSearch}
                                            onToggle={toggleCoupon}
                                            onClear={() => { setSelectedCouponIds([]); setHasChanges(true); }}
                                        />
                                    </AccordionSection>

                                    <AccordionSection id="display" icon={SettingsIcon} title="Display Condition" isOpen={openSection === "display"} onToggle={toggleSection} tip={SECTION_TIPS.display}>
                                        <BlockStack gap="300">
                                            <Select label="Show this coupon on" options={SHOW_ON_OPTIONS} value={showOn} onChange={(v) => { setShowOn(v); mark(); }} />
                                            {showOn === "products" && (
                                                <BlockStack gap="200">
                                                    <Text as="p" variant="bodySm" fontWeight="semibold">Select Products</Text>
                                                    <Button size="slim" onClick={async () => {
                                                        const result = await shopify.resourcePicker({ type: 'product', multiple: true });
                                                        if (result) { setProductHandles(result.map(p => p.handle)); mark(); }
                                                    }}>Browse Products</Button>
                                                    {productHandles.length > 0 && (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                            {productHandles.map(h => (
                                                                <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: '#f1f8f5', border: '1px solid #b5e3d8', borderRadius: 4, fontSize: 12 }}>
                                                                    {h}
                                                                    <button onClick={() => { setProductHandles(prev => prev.filter(x => x !== h)); mark(); }}
                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#637381', padding: 0, lineHeight: 1 }}>×</button>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </BlockStack>
                                            )}
                                            {showOn === "collections" && (
                                                <BlockStack gap="200">
                                                    <Text as="p" variant="bodySm" fontWeight="semibold">Select Collections</Text>
                                                    <Button size="slim" onClick={async () => {
                                                        const result = await shopify.resourcePicker({ type: 'collection', multiple: true });
                                                        if (result) { setCollectionHandles(result.map(c => c.handle)); mark(); }
                                                    }}>Browse Collections</Button>
                                                    {collectionHandles.length > 0 && (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                            {collectionHandles.map(h => (
                                                                <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: '#f1f8f5', border: '1px solid #b5e3d8', borderRadius: 4, fontSize: 12 }}>
                                                                    {h}
                                                                    <button onClick={() => { setCollectionHandles(prev => prev.filter(x => x !== h)); mark(); }}
                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#637381', padding: 0, lineHeight: 1 }}>×</button>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </BlockStack>
                                            )}
                                            {showOn === "tags" && (
                                                <BlockStack gap="200">
                                                    <Text as="p" variant="bodySm" fontWeight="semibold">Target Product Tags</Text>
                                                    <InlineStack gap="200" blockAlign="center">
                                                        <div style={{ flex: 1 }}><TextField label="" labelHidden placeholder="e.g. VIP, summer" value={tagInput} onChange={setTagInput} autoComplete="off" /></div>
                                                        <Button size="slim" disabled={!tagInput.trim()} onClick={() => {
                                                            if (!tagInput.trim()) return;
                                                            setTagHandles(prev => [...new Set([...prev, ...tagInput.split(',').map(t => t.trim()).filter(Boolean)])]);
                                                            setTagInput('');
                                                            mark();
                                                        }}>Add</Button>
                                                    </InlineStack>
                                                    {tagHandles.length > 0 && (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                            {tagHandles.map(t => (
                                                                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: '#f1f8f5', border: '1px solid #b5e3d8', borderRadius: 4, fontSize: 12 }}>
                                                                    {t}
                                                                    <button onClick={() => { setTagHandles(prev => prev.filter(x => x !== t)); mark(); }}
                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#637381', padding: 0, lineHeight: 1 }}>×</button>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </BlockStack>
                                            )}
                                        </BlockStack>
                                    </AccordionSection>

                                    <AccordionSection id="text" icon={MagicIcon} title="Customize Coupon" isOpen={openSection === "text"} onToggle={toggleSection} tip={SECTION_TIPS.text}>
                                        {selectedCouponIds.length === 0 ? (
                                            <Text as="p" variant="bodySm" tone="subdued">Select coupons in “Coupon Selection” first — then pick one here to edit its text, colors, and pages.</Text>
                                        ) : (
                                            <BlockStack gap="300">
                                                <Select
                                                    label="Editing coupon"
                                                    helpText="The preview on the right shows this coupon. Edit its text, colors, and pages below."
                                                    value={editingCouponId || selectedCouponIds[0]}
                                                    onChange={setEditingCouponId}
                                                    options={selectedCouponIds.map((cid) => {
                                                        const c = (discounts || []).find((x) => x.id === cid);
                                                        return { label: c?.code || cid, value: cid };
                                                    })}
                                                />
                                                <CouponOverridePanel
                                                    key={editingCouponId}
                                                    alwaysOpen
                                                    coupon={editingCoupon || { id: editingCouponId, code: editingCouponId }}
                                                    override={couponOverrides[editingCouponId]}
                                                    onChange={(patch) => updateOverride(editingCouponId, patch)}
                                                />
                                            </BlockStack>
                                        )}
                                    </AccordionSection>

                                    <AccordionSection id="design" icon={ColorIcon} title="Layout & Default Style" isOpen={openSection === "design"} onToggle={toggleSection} tip={SECTION_TIPS.design}>
                                        <BlockStack gap="400">
                                            <Select
                                                label="Banner layout"
                                                helpText="How multiple coupons are arranged on the product page."
                                                value={couponLayout}
                                                onChange={(v) => { setCouponLayout(v); mark(); }}
                                                options={[
                                                    { label: "List — stacked", value: "list" },
                                                    { label: "Carousel — horizontal slider", value: "carousel" },
                                                    { label: "Grid — 2 columns", value: "grid" },
                                                ]}
                                            />
                                            <Divider />
                                            <Text as="p" variant="bodySm" tone="subdued">Default style — used for coupons that don’t have their own colors set in “Customize Coupon”.</Text>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
                                                <ColorSwatch label="Background" value={bgColor} onChange={(v) => { setBgColor(v); mark(); }} />
                                                <ColorSwatch label="Text Color" value={textColor} onChange={(v) => { setTextColor(v); mark(); }} />
                                                <ColorSwatch label="Accent" value={accentColor} onChange={(v) => { setAccentColor(v); mark(); }} />
                                                <ColorSwatch label="Button Color" value={buttonColor} onChange={(v) => { setButtonColor(v); mark(); }} />
                                                <ColorSwatch label="Button Text" value={btnTextColor} onChange={(v) => { setBtnTextColor(v); mark(); }} />
                                            </div>
                                            <Divider />
                                            <RangeSlider label={`Border Radius: ${borderRadius}px`} value={borderRadius} min={0} max={24} onChange={(v) => { setBorderRadius(v); mark(); }} output />
                                            <RangeSlider label={`Font Size: ${fontSize}px`} value={fontSize} min={10} max={28} onChange={(v) => { setFontSize(v); mark(); }} output />
                                            <RangeSlider label={`Padding: ${padding}px`} value={padding} min={8} max={32} onChange={(v) => { setPadding(v); mark(); }} output />
                                        </BlockStack>
                                    </AccordionSection>

                                    <AccordionSection id="timer" icon={ClockIcon} title="Countdown Timer" isOpen={openSection === "timer"} onToggle={toggleSection} tip={SECTION_TIPS.timer}>
                                        <BlockStack gap="300">
                                            <Checkbox label="Enable countdown timer" checked={timerEnabled} onChange={(v) => { setTimerEnabled(v); mark(); }} />
                                            {timerEnabled && (
                                                <BlockStack gap="300">
                                                    <InlineStack gap="300">
                                                        <div style={{ flex: 1 }}><TextField label="Hours" type="number" value={String(timerHours)} onChange={(v) => { setTimerHours(Math.min(23, Math.max(0, Number(v)))); mark(); }} autoComplete="off" /></div>
                                                        <div style={{ flex: 1 }}><TextField label="Minutes" type="number" value={String(timerMins)} onChange={(v) => { setTimerMins(Math.min(59, Math.max(0, Number(v)))); mark(); }} autoComplete="off" /></div>
                                                    </InlineStack>
                                                    <TextField label="Timer label" value={timerLabel} onChange={(v) => { setTimerLabel(v); mark(); }} placeholder="Offer expires in" autoComplete="off" />
                                                    <TextField label="Expired label" value={timerExpired} onChange={(v) => { setTimerExpired(v); mark(); }} placeholder="Offer expired!" autoComplete="off" />
                                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                                                        <ColorSwatch label="Background" value={timerBg} onChange={(v) => { setTimerBg(v); mark(); }} />
                                                        <ColorSwatch label="Text" value={timerText} onChange={(v) => { setTimerText(v); mark(); }} />
                                                        <ColorSwatch label="Accent" value={timerAccent} onChange={(v) => { setTimerAccent(v); mark(); }} />
                                                    </div>
                                                </BlockStack>
                                            )}
                                        </BlockStack>
                                    </AccordionSection>

                                    {/* ── Placement — separate dropdown below all accordion sections ── */}
                                    <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px 16px", background: "#fafafa" }}>
                                        <Select
                                            label="Widget Placement"
                                            options={[
                                                { label: "Above the Add to Cart button",       value: "above_cart" },
                                                { label: "Below the Add to Cart button",       value: "below_cart" },
                                                { label: "Customize (let customers position)", value: "custom"     },
                                            ]}
                                            value={widgetPlacement}
                                            onChange={(v) => { setWidgetPlacement(v); mark(); }}
                                            helpText={
                                                widgetPlacement === "above_cart" ? "Position locked above the Add to Cart button on storefront." :
                                                widgetPlacement === "below_cart" ? "Position locked below the Add to Cart button on storefront." :
                                                "Customers can drag and reposition the widget on the product page."
                                            }
                                        />
                                    </div>
                                </BlockStack>
                            </Card>
                        </div>

                    {/* Right column — Live Preview. Extra bottom padding keeps the
                        preview footer from hiding behind the floating BrixBar. */}
                    <div style={{ overflowY: "auto", padding: "12px 12px 100px" }}>
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Preview</Text>
                                <div style={{ background: "#f9fafb", borderRadius: "12px", padding: "18px", border: "1px solid #e5e7eb", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                                    <div style={{ fontSize: "10px", fontWeight: 700, color: "#94a3b8", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "14px" }}>
                                        Product Page Widget
                                    </div>
                                    {renderPreview()}
                                </div>
                                <Text as="p" variant="bodySm" tone="subdued">
                                    The preview updates in real-time as you change settings. This is how the widget will appear on your product pages.
                                </Text>
                            </BlockStack>
                        </Card>
                    </div>
                </div>
            </div>
        </Frame>
    );
}

export function ErrorBoundary() {
    return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
    return boundary.headers(headersArgs);
};
