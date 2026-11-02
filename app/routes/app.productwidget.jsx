import { useState, useEffect, useRef } from "react";
import { useLoaderData, useRouteError, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";
import {
    BlockStack, InlineStack, Text, Button,
    TextField, Badge, Checkbox,
    Icon, Toast, Frame, Banner, Modal, ChoiceList,
} from "@shopify/polaris";
import BrixBar from "../components/ai-agent/BrixBar";
import { SliderField } from "../components/shared/SliderField";
import { DiscountIcon, ChevronDownIcon, ThemeIcon } from "@shopify/polaris-icons";
import { ProBadge } from "../components/plan/PlanGate";
import { usePlan } from "../components/PlanContext";
import { COUPON_BANNER_TEMPLATE_DEFAULTS, validateCustomCouponCode } from "../config/coupon-banner";
import { listCustomCoupons, addCustomCoupon } from "../services/coupon-banner.server";
import { saveCouponSliderSettings } from "../services/cart-config-writes.server";
import { getShopPlan } from "../services/plan-permissions.server";
import { ColorField } from "../components/shared/ColorField";
import { couponIconHtml, couponSubtitleStyle } from "../utils/coupon-style.shared.js";
import { offerLadder, isLadderId, newLadderId, NEW_LADDER_STYLE, LADDER_STYLE_KEYS } from "../utils/offer-ladder.shared.js";
import { OfferLadderPreview } from "../components/coupon-banner/OfferLadder";
import { CouponPicker } from "../components/coupon-banner/CouponPicker";
import { OfferEditModal } from "../components/coupon-banner/OfferEditModal";
import { Segmented, ChoiceTiles, TemplateArt, ArrangeArt, OfferArt } from "../components/coupon-banner/ui";
import { useScrollOpenSectionToTop } from "../utils/accordion-scroll";
import { COUPON_BANNER_CSS } from "../components/coupon-banner/styles";

/* ─── FAKE DEFAULTS ───────────────────────────────────────────────────────── */
const FAKE_COUPON_CONFIG = {
    activeTemplate: "template1",
    selectedActiveCoupons: [],
    displayCondition: "all",
    // Shared with the BRIX AI Coupon Banner tool so the two can't drift.
    templates: COUPON_BANNER_TEMPLATE_DEFAULTS,
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

    const [productsResponse, discountsResponse, couponRes, couponWidgetRes, fbtRes, embedStatus] = await Promise.all([
        admin.graphql(`query getProducts { products(first: 50, query: "status:active") { edges { node { id title handle featuredImage { url } variants(first: 1) { edges { node { id price } } } } } } }`),
        admin.graphql(`query DiscountList { discountNodes(first: 100, reverse: true) { edges { node { id discount { ... on DiscountCodeBasic { title codes(first: 1) { edges { node { code } } } status } ... on DiscountCodeBxgy { title codes(first: 1) { edges { node { code } } } status } ... on DiscountCodeFreeShipping { title codes(first: 1) { edges { node { code } } } status } } } } } }`),
        fetch(`${BASE_PHP_URL}/coupon_slider_settings.php?shop=${encodeURIComponent(shop)}`, { headers: { 'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '' } }).catch(() => null),
        fetch(`${BASE_PHP_URL}/save_coupon_slider_widget.php?shopdomain=${encodeURIComponent(shop)}`).catch(() => null),
        fetch(`${url.origin}/api/fbt-widget?shopdomain=${encodeURIComponent(shop)}`).catch(() => null),
        getEmbedStatus(shop, session.accessToken),
    ]);
    // Codes created outside BRIX that the merchant added via "+ Custom Coupon".
    const customCoupons = await listCustomCoupons(shop).catch((e) => { console.error("Failed to fetch custom coupons:", e); return []; });

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

    let couponSettings = null;
    try {
        if (couponRes) {
            const d = await couponRes.json();
            if (d.status === 'success' && d.data) couponSettings = d.data;
        }
    } catch (e) { console.error("Failed to fetch coupon settings:", e); }

    let couponWidget = null;
    try {
        if (couponWidgetRes) {
            const d = await couponWidgetRes.json();
            if (d.status === 'success' && d.data) couponWidget = d.data;
        }
    } catch (e) { console.error("Failed to fetch coupon widget:", e); }

    let couponConfig = null;
    if (couponSettings || couponWidget) {
        couponConfig = {
            ...FAKE_COUPON_CONFIG,
            ...(couponSettings || {}),
            activeTemplate: couponWidget?.selectedTemplate || couponSettings?.selected_template || "template1",
            templates: {
                template1: { ...FAKE_COUPON_CONFIG.templates.template1, ...(couponWidget?.temp1DefaultStyle || {}) },
                template2: { ...FAKE_COUPON_CONFIG.templates.template2, ...(couponWidget?.temp2DefaultStyle || {}) },
                template3: { ...FAKE_COUPON_CONFIG.templates.template3, ...(couponWidget?.temp3DefaultStyle || {}) },
            },
            selectedActiveCoupons: Array.isArray(couponWidget?.selectedCouponsGlobal) ? couponWidget.selectedCouponsGlobal : [],
            temp1CouponStyle: couponWidget?.temp1CouponStyle || {},
            temp2CouponStyle: couponWidget?.temp2CouponStyle || {},
            temp3CouponStyle: couponWidget?.temp3CouponStyle || {},
            temp1CouponCondition: couponWidget?.temp1CouponCondition || [],
            temp2CouponCondition: couponWidget?.temp2CouponCondition || [],
            temp3CouponCondition: couponWidget?.temp3CouponCondition || [],
            // Countdown Timer — was previously saved (see save_coupon_slider_
            // widget.php) but never read back here, so the page's timer* state
            // always started from its hardcoded defaults instead of what was
            // actually last configured, and the very next save would silently
            // re-persist those defaults over the merchant's real setting.
            // Number(...) === 1 rather than a bare truthy check: PDO can hand
            // back "0" for a disabled timer, which is a non-empty (truthy) string.
            timerEnabled: Number(couponWidget?.timerEnabled) === 1,
            timerHours: couponWidget?.timerHours != null ? Number(couponWidget.timerHours) : 0,
            timerMins: couponWidget?.timerMins != null ? Number(couponWidget.timerMins) : 15,
            timerLabel: couponWidget?.timerLabel || 'Offer expires in',
            timerExpired: couponWidget?.timerExpired || 'Offer expired!',
            timerBg: couponWidget?.timerBg || '#fef2f2',
            timerText: couponWidget?.timerText || '#991b1b',
            timerAccent: couponWidget?.timerAccent || '#dc2626',
            timerMode: couponWidget?.timerMode === 'loop' ? 'loop' : 'session',
        };
    }
    if (!couponConfig) couponConfig = { ...FAKE_COUPON_CONFIG, selectedActiveCoupons: [], templates: { ...FAKE_COUPON_CONFIG.templates } };

    let fbtConfig = null;
    try {
        if (fbtRes) {
            const d = await fbtRes.json();
            if (d.success && d.fbt) fbtConfig = d.fbt;
        }
    } catch (e) { console.error("Failed to fetch FBT settings:", e); }
    if (!fbtConfig) fbtConfig = { ...FAKE_FBT_CONFIG, templates: { ...FAKE_FBT_CONFIG.templates } };

    const { couponEmbedEnabled, fbtEmbedEnabled } = embedStatus;

    return { couponConfig, fbtConfig, products, shop, discounts, customCoupons, couponEmbedEnabled, fbtEmbedEnabled };
}

/* ─── ACTION ──────────────────────────────────────────────────────────────── */
export async function action({ request }) {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const body = await request.json();

    // "+ Custom Coupon" → "Just add this coupon code": store the code only.
    // No discount is created or changed anywhere.
    if (body?.intent === "add_custom_coupon") {
        return addCustomCoupon({ shop, admin }, body.code);
    }

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
    // The coupon_slider_settings row is shared with the Cart Editor's coupon
    // section. Save only what this page owns, merged onto the existing row
    // (the PHP endpoint used here rewrote every column, so each Coupon Banner
    // save reset the cart drawer coupon title, colours and coupon cards).
    const settingsPayload = {
        is_enabled: isEnabled ? 1 : 0,
        selected_template: tplKey,
        position: rest.widgetPlacement || 'above_cart',
        layout: rest.layout || 'list',
    };

    try {
        const [widgetRes, settingsSaved] = await Promise.all([
            fetch(`${BASE_PHP_URL}/save_coupon_slider_widget.php`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(widgetPayload),
            }),
            getShopPlan(shop)
                .then((planKey) => saveCouponSliderSettings(shop, planKey, settingsPayload))
                .then(() => true)
                .catch((e) => { console.error("[ProductWidget action] settings save failed:", e); return false; }),
        ]);
        const widgetData = await widgetRes.json().catch(() => ({}));
        if (widgetData.status === "success" && settingsSaved) return { success: true };
        console.error("[ProductWidget action] save errors:", { widgetData, settingsSaved });
    } catch (e) { console.error("[ProductWidget action] Save failed:", e); }
    return { success: false };
}

/* ─── CONSTANTS ───────────────────────────────────────────────────────────── */
// The loader keeps each template's per-coupon data under its PHP column name
// (temp1CouponStyle / temp1CouponCondition ...), not under "template1".
const COUPON_COLUMN_PREFIX = { template1: "temp1", template2: "temp2", template3: "temp3" };

// A text offer: a banner card with only a heading and subtext (e.g. "Free
// shipping over ₹999", or an automatic discount that has no code). No code,
// no Copy button. Stored like any coupon: its id ("text:<random>") in the
// selected list, its words in the per-coupon heading / subtext.
const isTextOfferId = (id) => typeof id === "string" && id.indexOf("text:") === 0;
const newTextOfferId = () => "text:" + Math.random().toString(36).slice(2, 10);

/** Per-coupon overrides (heading, subtext, button, colours, show-on) saved for one template. */
function savedCouponOverrides(couponConfig, tplKey) {
    const prefix = COUPON_COLUMN_PREFIX[tplKey] || "temp1";
    const styleMap = couponConfig?.[`${prefix}CouponStyle`] || {};
    const condArr = couponConfig?.[`${prefix}CouponCondition`] || [];
    const out = {};
    Object.keys(styleMap || {}).forEach((cid) => { out[cid] = { ...styleMap[cid] }; });
    (Array.isArray(condArr) ? condArr : []).forEach((c) => {
        if (!c || !c.couponId) return;
        out[c.couponId] = { ...(out[c.couponId] || {}), displayCondition: c.displayCondition || "all", productHandles: c.productHandles || [], collectionHandles: c.collectionHandles || [] };
    });
    return out;
}

const BANNER_WIDTHS = ["full", "atc", "custom"];

const TEMPLATES = [
    { id: "classic-banner", name: "Classic Banner", tplKey: "template1" },
    { id: "minimal-card",   name: "Minimal Card",   tplKey: "template2" },
    { id: "bold-vibrant",   name: "Bold & Vibrant", tplKey: "template3" },
];

/* ─── HELPERS ─────────────────────────────────────────────────────────────── */
function CountdownStrip({ hours, minutes, loop, label, expiredLabel, bgColor, textColor, accentColor }) {
    const total = hours * 3600 + minutes * 60;
    const [rem, setRem] = useState(total);
    useEffect(() => { setRem(total); }, [total, loop]);
    useEffect(() => {
        if (rem <= 0) return;
        // Loop mode: at zero, start again from the full time.
        const t = setInterval(() => setRem(r => (r <= 1 && loop ? total : Math.max(0, r - 1))), 1000);
        return () => clearInterval(t);
    }, [rem, loop, total]);
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

/* "+ Custom Coupon": add a code created outside BRIX, or hand it to the Discount Creator */
function CustomCouponModal({ open, onClose, existingCodes, fetcher, onCreateInBrix, hasUnsavedChanges }) {
    const [code, setCode] = useState("");
    const [mode, setMode] = useState("external");
    const [error, setError] = useState("");
    const saving = fetcher.state !== "idle";

    // Fresh form every time the dialog opens.
    useEffect(() => { if (open) { setCode(""); setMode("external"); setError(""); } }, [open]);
    // Server-side rejection (duplicate, save failure) shows on the field.
    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data && fetcher.data.success === false) setError(fetcher.data.message || "Couldn’t add the coupon. Please try again.");
    }, [fetcher.state, fetcher.data]);

    const submit = () => {
        const check = validateCustomCouponCode(code, existingCodes);
        if (check.error) { setError(check.message); return; }
        setError("");
        if (mode === "brix") { onCreateInBrix(check.code); return; }
        fetcher.submit({ intent: "add_custom_coupon", code: check.code }, { method: "POST", encType: "application/json" });
    };

    return (
        <Modal
            open={open}
            onClose={saving ? () => {} : onClose}
            title="Add Custom Coupon"
            primaryAction={{ content: saving ? "Adding coupon…" : mode === "brix" ? "Continue" : "Add Coupon", onAction: submit, loading: saving, disabled: saving }}
            secondaryActions={[{ content: "Cancel", onAction: onClose, disabled: saving }]}
        >
            <Modal.Section>
                <BlockStack gap="400">
                    <TextField
                        label="Coupon Code"
                        placeholder="e.g. SAVE200"
                        value={code}
                        onChange={(v) => { setCode(v); if (error) setError(""); }}
                        error={error || undefined}
                        autoComplete="off"
                        maxLength={255}
                        disabled={saving}
                    />
                    <ChoiceList
                        title="How do you want to use this coupon?"
                        selected={[mode]}
                        onChange={([v]) => setMode(v)}
                        disabled={saving}
                        choices={[
                            { label: "Just add this coupon code", value: "external", helpText: "I already created this coupon somewhere else. Just add the code to BRIX." },
                            { label: "Create this coupon in BRIX", value: "brix", helpText: "Create and manage this discount through the BRIX Discount Engine." },
                        ]}
                    />
                    {mode === "external" && (
                        <Text as="p" variant="bodySm" tone="subdued">BRIX only shows this code in your banner. It doesn’t create or check the discount, so make sure it’s active where you created it.</Text>
                    )}
                    {mode === "brix" && hasUnsavedChanges && (
                        <Banner tone="warning"><p>You have unsaved changes on this page. Save them first, or they’ll be lost when you continue.</p></Banner>
                    )}
                </BlockStack>
            </Modal.Section>
        </Modal>
    );
}

// The Coupon Banner's headings, as the storefront reads them from the
// template style ({ text, fontSize, textColor, alignment }): title = above the
// whole banner ("Apply Coupon"), ladderTitle / cardsTitle = optional own
// headings above the offer ladders / the coupon cards (not saved = none).
// Not saved yet = the storefront's own defaults.
function readSectionTitle(tpl, key = "title", fallback = "Apply Coupon") {
    const t = tpl && typeof tpl[key] === "object" && tpl[key] ? tpl[key] : {};
    const size = parseInt(t.fontSize, 10);
    return {
        text: t.text !== undefined && t.text !== null ? String(t.text) : fallback,
        fontSize: size >= 11 && size <= 28 ? size : 14,
        textColor: /^#[0-9a-f]{6}$/i.test(t.textColor || "") ? t.textColor : "#111827",
        alignment: ["left", "center", "right"].includes(t.alignment) ? t.alignment : "left",
    };
}

// One heading (More options → Headings): its words, then size, colour and alignment once it has words.
function HeadingFields({ label, name, where, placeholder, note, value, onChange }) {
    return (
        <div className="cbz-card">
            <div className="cbz-card-h"><b>{label}</b><span className="cbz-where">{where}</span></div>
            <BlockStack gap="300">
                <TextField label={label} labelHidden value={value.text} onChange={(v) => onChange("text", v)} autoComplete="off" maxLength={60} placeholder={placeholder} helpText={note || "Leave empty to hide it."} />
                {value.text.trim() !== "" && (
                    <>
                        <SliderField label={`${name} size`} value={value.fontSize} min={11} max={28} suffix="px" onChange={(v) => onChange("fontSize", v)} />
                        <div className="cbz-grid2">
                            <ColorField label={`${name} colour`} value={value.textColor} onChange={(v) => onChange("textColor", v)} />
                            <Segmented
                                label={`${name} alignment`}
                                options={[{ label: "Left", value: "left" }, { label: "Centre", value: "center" }, { label: "Right", value: "right" }]}
                                value={value.alignment}
                                onChange={(v) => onChange("alignment", v)}
                            />
                        </div>
                    </>
                )}
            </BlockStack>
        </div>
    );
}

// The storefront's heading look (coupon-slider-render.liquid headingHtml).
const headingStyle = (h) => ({ textAlign: h.alignment, color: h.textColor, fontSize: `${h.fontSize}px`, fontWeight: 700, marginBottom: "10px", lineHeight: 1.2 });

// One numbered card of the page. With onToggle it folds: closed = its title,
// description and a one-line summary of what's set; the body only when open.
function Step({ id, step, title, extra, description, summary, open, onToggle, children }) {
    if (onToggle) {
        return (
            <section className={`cbz-sec cbz-sec--fold${open ? " is-open" : ""}`} data-section={id}>
                <h2 className="cbz-sec-h">
                    <button type="button" className="cbz-sec-btn" aria-expanded={!!open} aria-controls={`cbz-b-${id}`} onClick={onToggle}>
                        {step && <span className="cbz-step">{step}</span>}
                        <span className="cbz-sec-tt">
                            <span className="cbz-sec-t">{title}</span>
                            {description && <span className="cbz-sec-bd">{description}</span>}
                        </span>
                        {!open && summary && <span className="cbz-sum" title={summary}>{summary}</span>}
                        <span className="cbz-chev"><Icon source={ChevronDownIcon} /></span>
                    </button>
                </h2>
                {open && <div className="cbz-sec-b" id={`cbz-b-${id}`}>{children}</div>}
            </section>
        );
    }
    return (
        <section className="cbz-sec" data-section={id} aria-labelledby={`cbz-h-${id}`}>
            <h2 className="cbz-sec-h" id={`cbz-h-${id}`}>{step && <span className="cbz-step">{step}</span>}{title}{extra}</h2>
            {description && <p className="cbz-sec-d">{description}</p>}
            {children}
        </section>
    );
}

/* ─── COMPONENT ───────────────────────────────────────────────────────────── */
// Discard remounts the editor, so every field goes back to the last saved
// settings (it used to only grey out Save and keep the edits on screen).
export default function ProductWidgetPage() {
    const [resetKey, setResetKey] = useState(0);
    return <CouponBannerEditor key={resetKey} onDiscard={() => setResetKey((k) => k + 1)} />;
}

// One simple page: 1 coupons to show, 2 design, 3 where it shows, 4 timer;
// everything else under "More options"; a coupon's own text, colours and
// pages in its Edit popup (OfferEditModal).
function CouponBannerEditor({ onDiscard }) {
    const { couponConfig, shop, discounts, customCoupons: loadedCustomCoupons, couponEmbedEnabled } = useLoaderData();
    const fetcher = useFetcher();
    const customCouponFetcher = useFetcher();
    const navigate = useNavigate();
    const shopifyBridge = useAppBridge();
    // Custom (external) coupons first, then the store's active Shopify codes.
    const [customCoupons, setCustomCoupons] = useState(() => (loadedCustomCoupons || []).map((c) => ({ ...c, title: "Custom coupon", isCustom: true })));
    // Text offers saved earlier come back from the selected list; new ones are added under More options.
    const [textOfferIds, setTextOfferIds] = useState(() => (
        Array.isArray(couponConfig?.selectedActiveCoupons) ? couponConfig.selectedActiveCoupons.filter(isTextOfferId) : []
    ));
    // Offer ladders: same idea, "ladder:<id>" ids from the selected list.
    const [ladderIds, setLadderIds] = useState(() => (
        Array.isArray(couponConfig?.selectedActiveCoupons) ? couponConfig.selectedActiveCoupons.filter(isLadderId) : []
    ));
    const [customCouponOpen, setCustomCouponOpen] = useState(false);
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
    // "More options" (text offers & ladders, headings, layout & size): folded until asked for,
    // and each of its cards closed too (one open at a time, like the Cart Editor's sections).
    const [moreOpen, setMoreOpen] = useState(false);
    // Every card of the page (1-4 and More options' three) starts closed; one open at a time.
    const [moreCard, setMoreCard] = useState("");
    const toggleMoreCard = (id) => setMoreCard((c) => (c === id ? "" : id));
    const [scrollTo, setScrollTo] = useState("");
    const sideRef = useRef(null);
    useScrollOpenSectionToTop(sideRef, moreCard);
    // The offer whose Edit popup is open ('' = none).
    const [editId, setEditId] = useState("");
    // The heading above the coupons ("Apply Coupon"): the storefront reads
    // tempNDefaultStyle.title (coupon-slider-render.liquid renderSlider).
    const [sectionTitle, setSectionTitle] = useState(() => readSectionTitle(activeTpl));
    // Own headings above the offer ladders and above the coupon cards (empty = none).
    const [ladderTitle, setLadderTitle] = useState(() => readSectionTitle(activeTpl, "ladderTitle", ""));
    const [cardsTitle, setCardsTitle] = useState(() => readSectionTitle(activeTpl, "cardsTitle", ""));
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
    // Card size on the storefront (coupon-slider-render.liquid buildCard): width
    // 200-480 px (template default 320, Bold & Vibrant 280), min height 0-300 (0 = as tall as the text).
    const [cardWidth,   setCardWidth]   = useState(activeTpl.cardWidth   ?? (tKey === "template3" ? 280 : 320));
    const [cardMinHeight, setCardMinHeight] = useState(activeTpl.cardMinHeight ?? 0);
    // The whole banner's width on the storefront (coupon-slider-render.liquid):
    // full (default) | atc = same as the theme's Add to cart button | custom = bannerWidthPx.
    const [bannerWidth, setBannerWidth] = useState(BANNER_WIDTHS.includes(activeTpl.bannerWidth) ? activeTpl.bannerWidth : "full");
    const [bannerWidthPx, setBannerWidthPx] = useState(activeTpl.bannerWidthPx ?? 400);
    // Seeded from couponConfig (the last-saved config) exactly like heading/
    // subtext/bgColor above — these previously always started from a
    // hardcoded default regardless of what was last configured, which is
    // why both the editor and the live preview looked reset to "off" on
    // every page load even after saving a real timer setting.
    const [timerEnabled,setTimerEnabled]= useState(!!couponConfig?.timerEnabled);
    const [timerHours,  setTimerHours]  = useState(couponConfig?.timerHours ?? 0);
    const [timerMins,   setTimerMins]   = useState(couponConfig?.timerMins ?? 15);
    const [timerLabel,  setTimerLabel]  = useState(couponConfig?.timerLabel || "Offer expires in");
    const [timerExpired,setTimerExpired]= useState(couponConfig?.timerExpired || "Offer expired!");
    const [timerBg,     setTimerBg]     = useState(couponConfig?.timerBg || "#fef2f2");
    const [timerText,   setTimerText]   = useState(couponConfig?.timerText || "#991b1b");
    const [timerAccent, setTimerAccent] = useState(couponConfig?.timerAccent || "#dc2626");
    const [timerMode,   setTimerMode]   = useState(couponConfig?.timerMode === "loop" ? "loop" : "session");
    const [selectedCouponIds, setSelectedCouponIds] = useState(
        Array.isArray(couponConfig?.selectedActiveCoupons) ? couponConfig.selectedActiveCoupons.filter(Boolean) : []
    );
    const toggleCoupon = (id) => {
        setSelectedCouponIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
        setHasChanges(true);
    };
    // Per-coupon overrides: { [couponId]: { headingText, subtextText, bgColor, textColor, accentColor, buttonColor, buttonTextColor, displayCondition, productHandles } }
    // Saved per-coupon heading / subtext / button text / colours for the
    // selected template. (Used to look for "template1CouponStyle", a key the
    // loader never sets, so every saved per-coupon text was lost on reload and
    // the next save erased it.)
    const [couponOverrides, setCouponOverrides] = useState(() => savedCouponOverrides(couponConfig, tKey));
    const textOffers = textOfferIds.map((id) => ({ id, code: "", title: couponOverrides[id]?.headingText || "", isText: true }));
    const ladders = ladderIds.map((id) => ({ id, code: "", isLadder: true }));
    const allCoupons = [...ladders, ...textOffers, ...customCoupons, ...(discounts || [])];
    // Codes an offer ladder can apply: the store's active codes and the custom ones.
    const ladderCodeOptions = [...customCoupons, ...(discounts || [])]
        .filter((c) => c.code)
        .map((c) => ({ label: c.title && c.title !== c.code && !c.isCustom ? `${c.code} · ${c.title}` : c.code, value: c.code }));
    // Display layout for the coupon banner: list (stacked) / carousel (slider) / grid
    const [couponLayout, setCouponLayout] = useState(couponConfig?.layout || "list");
    const [widgetPlacement, setWidgetPlacement] = useState(couponConfig?.position || "above_cart");
    const [hasChanges,    setHasChanges]    = useState(false);
    const [toastActive,   setToastActive]   = useState(false);

    const isSaving = fetcher.state !== "idle";

    // Unsaved changes a design switch would drop (applyTemplate reloads that
    // design's saved coupon words / colours, headings and sizes): only these
    // make the Design card warn.
    const [designDirty, setDesignDirty] = useState(false);

    useEffect(() => {
        if (fetcher.data?.success) { setToastActive(true); setHasChanges(false); setDesignDirty(false); }
    }, [fetcher.data]);

    const mark = () => setHasChanges(true);
    const markDesign = () => { setDesignDirty(true); setHasChanges(true); };

    // A card of More options asked for (e.g. a heading clicked in the
    // preview): open More options and that card, then bring it into view.
    useEffect(() => {
        if (!scrollTo) return;
        const el = sideRef.current?.querySelector(`[data-section="${scrollTo}"]`);
        if (el) el.scrollIntoView({ block: "start" });
        setScrollTo("");
    }, [scrollTo, moreOpen]);
    const showMore = (section) => { setMoreOpen(true); setMoreCard(section); setScrollTo(section); };

    const removeOffer = (id) => {
        setSelectedCouponIds((prev) => prev.filter((x) => x !== id));
        if (isTextOfferId(id)) setTextOfferIds((prev) => prev.filter((x) => x !== id));
        if (isLadderId(id)) setLadderIds((prev) => prev.filter((x) => x !== id));
        setEditId("");
        setHasChanges(true);
    };
    // A new text offer / ladder is shown at once and opens in its popup.
    const addLadder = () => {
        const id = newLadderId();
        setLadderIds((prev) => [id, ...prev]);
        setCouponOverrides((prev) => ({ ...prev, [id]: { ...NEW_LADDER_STYLE, tiers: NEW_LADDER_STYLE.tiers.map((t) => ({ ...t })) } }));
        setSelectedCouponIds((prev) => [id, ...prev]);
        setEditId(id);
        markDesign();
    };
    const addTextOffer = () => {
        const id = newTextOfferId();
        setTextOfferIds((prev) => [id, ...prev]);
        setCouponOverrides((prev) => ({ ...prev, [id]: { headingText: "Free shipping on all orders", subtextText: "No code needed" } }));
        setSelectedCouponIds((prev) => [id, ...prev]);
        setEditId(id);
        markDesign();
    };
    const updateOverride = (cid, patch) => {
        setCouponOverrides((prev) => ({ ...prev, [cid]: { ...(prev[cid] || {}), ...patch } }));
        markDesign();
    };

    // Custom coupon saved → add it to the list, select it, close the dialog.
    // The selection itself is saved with the page's Save, like any other coupon.
    useEffect(() => {
        const data = customCouponFetcher.data;
        if (customCouponFetcher.state !== "idle" || !data?.success || !data.coupon) return;
        const added = { ...data.coupon, title: "Custom coupon", isCustom: true };
        setCustomCoupons((prev) => (prev.some((c) => c.id === added.id) ? prev : [added, ...prev]));
        setSelectedCouponIds((prev) => (prev.includes(added.id) ? prev : [added.id, ...prev]));
        setHasChanges(true);
        setCustomCouponOpen(false);
        shopifyBridge.toast.show("Coupon added successfully");
    }, [customCouponFetcher.state, customCouponFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

    const applyTemplate = (id) => {
        const t = TEMPLATES.find(x => x.id === id);
        if (!t || id === selectedTemplate) return;
        setSelectedTemplate(id);
        // Was always FAKE_COUPON_CONFIG's hardcoded marketing-copy default,
        // never this template's actual saved config — so clicking a template
        // tab silently discarded whatever heading/subtext/colors the
        // merchant had previously customized for it, replacing the editor's
        // (and preview's) state with generic placeholder text. Reading
        // couponConfig first — the same merged real-config-over-defaults
        // object the loader already builds — means switching tabs shows
        // what was actually last configured, falling back to the stock
        // default only the first time a template has never been touched.
        const src = couponConfig?.templates?.[t.tplKey] || FAKE_COUPON_CONFIG.templates[t.tplKey];
        if (src) {
            setHeading(src.headingText); setSubtext(src.subtextText);
            setSectionTitle(readSectionTitle(src));
            setLadderTitle(readSectionTitle(src, "ladderTitle", ""));
            setCardsTitle(readSectionTitle(src, "cardsTitle", ""));
            setBgColor(src.bgColor); setTextColor(src.textColor);
            setAccentColor(src.accentColor); setButtonColor(src.buttonColor);
            setBtnTextColor(src.buttonTextColor);
            setBorderRadius(src.borderRadius); setFontSize(src.fontSize); setPadding(src.padding);
            setCardWidth(src.cardWidth ?? (t.tplKey === "template3" ? 280 : 320)); setCardMinHeight(src.cardMinHeight ?? 0);
            setBannerWidth(BANNER_WIDTHS.includes(src.bannerWidth) ? src.bannerWidth : "full"); setBannerWidthPx(src.bannerWidthPx ?? 400);
        }
        // Same fix as couponOverrides' own useState initializer above, applied
        // on tab switch: pull this template's real per-coupon overrides
        // directly by key instead of leaving couponOverrides frozen with
        // whichever template's map happened to load first.
        setCouponOverrides(savedCouponOverrides(couponConfig, t.tplKey));
        setDesignDirty(false);
        mark();
    };

    // Shared by the Save button and the instant enable/disable toggle below —
    // the toggle used to only flip local state and wait for a manual Save
    // click, so a merchant flipping it off and navigating away without
    // hitting Save would still see the widget rendering on the storefront.
    // It now submits through this same path immediately.
    const submitCouponConfig = (overrides = {}) => {
        const tplKeyMap = { "classic-banner": "template1", "minimal-card": "template2", "bold-vibrant": "template3" };
        // Build per-coupon style + condition overrides for the selected coupons
        const couponStyles = {};
        const couponConditions = [];
        selectedCouponIds.forEach((cid) => {
            const ov = couponOverrides[cid] || {};
            const couponObj = allCoupons.find((c) => c.id === cid);
            const style = {};
            // Save the real discount code so "Copy Code" copies the code, not the GID number
            if (couponObj?.code) style.couponCode = couponObj.code;
            if (isTextOfferId(cid)) style.textOnly = true;
            if (isLadderId(cid)) {
                style.ladder = true;
                LADDER_STYLE_KEYS.forEach((k) => { if (ov[k] !== undefined && ov[k] !== "") style[k] = ov[k]; });
                // Only offers with words and a number of items, lowest first.
                // (The line under an offer only when it has one.)
                style.tiers = offerLadder.normalize(ov).tiers.map(({ sub, ...t }) => (sub ? { ...t, sub } : t));
            }
            ["headingText", "subtextText", "buttonText", "bgColor", "textColor", "accentColor", "buttonColor", "buttonTextColor",
                // Subtitle font, "Copied" colours and icon (CouponStyleFields).
                "subFontSize", "subFontWeight", "subColor", "copiedBgColor", "copiedTextColor", "iconShow", "icon", "iconImage", "iconColor", "iconSize"].forEach((k) => {
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
                selectedActiveCoupons: selectedCouponIds,
                template: { headingText: heading, subtextText: subtext, bgColor, textColor, accentColor, buttonColor, buttonTextColor: btnTextColor, borderRadius, fontSize, padding, cardWidth, cardMinHeight, bannerWidth, bannerWidthPx, title: { ...sectionTitle, text: sectionTitle.text.trim() }, ladderTitle: { ...ladderTitle, text: ladderTitle.text.trim() }, cardsTitle: { ...cardsTitle, text: cardsTitle.text.trim() } },
                couponStyles,
                couponConditions,
                layout: couponLayout,
                timerEnabled, timerHours, timerMins, timerLabel, timerExpired, timerBg, timerText, timerAccent, timerMode,
                widgetPlacement,
                ...overrides,
            },
            { method: "POST", encType: "application/json" }
        );
    };

    const handleSave = () => submitCouponConfig();

    /* offers, as "Coupons to show" lists them and the preview draws them */
    // Offer ladders draw above the coupon cards (storefront too).
    const selectedLadderIds = selectedCouponIds.filter(isLadderId);
    const cardIds = selectedCouponIds.filter((cid) => !isLadderId(cid));
    const offerTitle = (id) => {
        const ov = couponOverrides[id] || {};
        if (isLadderId(id)) {
            const tiers = offerLadder.normalize(ov).tiers;
            return tiers.length ? tiers.map((t) => t.text).join(" | ") : "Offer ladder (no offers yet)";
        }
        if (isTextOfferId(id)) return ov.headingText || "Text offer (no heading yet)";
        const c = allCoupons.find((x) => x.id === id);
        // A selected code that is no longer an active Shopify discount: its saved code.
        return c?.code || ov.couponCode || "Unknown code";
    };
    const offerKind = (id) => {
        if (isLadderId(id)) return "ladder";
        if (isTextOfferId(id)) return "text";
        return allCoupons.find((x) => x.id === id)?.isCustom ? "custom" : "coupon";
    };
    // Every row of "Coupons to show": ladders and text offers (added under
    // More options), custom codes, the store's codes, then any ticked code
    // that is no longer an active Shopify discount (so it can be unticked).
    const pickRows = [
        ...ladderIds.map((id) => ({ id, title: offerTitle(id), sub: "Offer ladder" })),
        ...textOfferIds.map((id) => ({ id, title: offerTitle(id), sub: "Text offer: words only, no code" })),
        ...customCoupons.map((c) => ({ id: c.id, title: c.code, sub: "Code from another app" })),
        ...(discounts || []).map((d) => ({ id: d.id, title: d.code, sub: d.title && d.title !== d.code ? d.title : "" })),
        ...selectedCouponIds.filter((id) => !allCoupons.some((c) => c.id === id))
            .map((id) => ({ id, title: offerTitle(id), sub: "No longer an active code in Shopify" })),
    ];
    // Every ladder as wide as Add to cart (banner itself full width): headings over them take that width too.
    const laddersAtAtc = selectedLadderIds.length > 0 && bannerWidth !== "atc" && bannerWidth !== "custom"
        && selectedLadderIds.every((id) => offerLadder.normalize(couponOverrides[id] || {}).boxSize === "atc");

    // What a folded card has set, in one line.
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const timerSummary = [
        [timerHours > 0 && `${timerHours} h`, (timerMins > 0 || !timerHours) && `${timerMins} min`].filter(Boolean).join(" "),
        `“${timerLabel || "Offer expires in"}”`,
        timerMode === "loop" && "starts again",
    ].filter(Boolean).join(" · ");
    const extrasSummary = [
        ladderIds.length > 0 && plural(ladderIds.length, "offer ladder"),
        textOfferIds.length > 0 && plural(textOfferIds.length, "text offer"),
    ].filter(Boolean).join(", ") || "None added";
    // Only the headings the banner really shows (a group with nothing in it has none).
    const headingsSummary = [
        sectionTitle.text,
        selectedLadderIds.length > 0 && ladderTitle.text,
        cardIds.length > 0 && cardsTitle.text,
    ].map((t) => (t || "").trim()).filter(Boolean).map((t) => `“${t}”`).join(", ") || "None shown";
    const layoutSummary = `${{ list: "List", carousel: "Carousel", grid: "Grid" }[couponLayout] || "List"} · ${
        { full: "Full width", atc: "Add to cart width", custom: `${bannerWidthPx}px wide` }[bannerWidth] || "Full width"}`;

    /* live preview */
    // One card as the storefront draws it (coupon-slider-render.liquid buildCard):
    // its own texts / colours over the design's. cid '' = the design's sample card.
    const look = (cid) => {
        const ov = couponOverrides[cid] || {};
        const c = allCoupons.find((x) => x.id === cid);
        return {
            ov,
            heading: ov.headingText || heading,
            subtext: ov.subtextText || subtext,
            bg: ov.bgColor || bgColor,
            text: ov.textColor || textColor,
            accent: ov.accentColor || accentColor,
            button: ov.buttonColor || buttonColor,
            btnText: ov.buttonTextColor || btnTextColor,
            // Same per-template default as the storefront: "Copy" for Bold & Vibrant, else "Copy Code".
            buttonLabel: ov.buttonText || (selectedTemplate === "bold-vibrant" ? "Copy" : "Copy Code"),
            code: c?.code || ov.couponCode || "CODE",
            // A text offer has no code and no button, on the storefront and here.
            textOnly: isTextOfferId(cid),
        };
    };
    const timerStrip = timerEnabled ? (
        <CountdownStrip hours={timerHours} minutes={timerMins} loop={timerMode === "loop"} label={timerLabel} expiredLabel={timerExpired} bgColor={timerBg} textColor={timerText} accentColor={timerAccent} />
    ) : null;

    // Long text wraps instead of being cut off (same as the storefront).
    const PW_WRAP = { whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" };
    const renderCard = (cid) => {
        const L = look(cid);
        const btn = { background: L.button, color: L.btnText, border: "none", borderRadius: `${borderRadius}px`, cursor: "pointer", fontWeight: 600 };
        // Icon and subtitle font, like the storefront (coupon-slider-render.liquid csIcon / csSubCss).
        const icon = (size, show) => {
            const html = couponIconHtml(L.ov, { size, color: L.accent, defaultShow: show });
            // eslint-disable-next-line react/no-danger -- built-in SVG or a checked https image
            return html ? <span className="pw-coupon-icon" style={{ display: "flex", lineHeight: 0, flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: html }} /> : null;
        };
        const sub = (base) => couponSubtitleStyle(L.ov, base);
        if (selectedTemplate === "classic-banner") {
            return (
                <div style={{ background: L.bg, borderRadius: `${borderRadius}px`, padding: `${padding}px`, border: "1px solid #e5e7eb", borderLeft: `4px solid ${L.accent}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                        {icon(22, false)}
                        <div style={{ flex: 1, minWidth: "100px", overflow: "hidden" }}>
                            <div style={{ fontSize: `${fontSize}px`, fontWeight: 700, color: L.text, marginBottom: "3px", ...PW_WRAP }}>{L.heading}</div>
                            <div className="pw-sub" style={sub({ fontSize: "13px", color: L.text, opacity: 0.65, ...PW_WRAP })}>{L.subtext}</div>
                        </div>
                        {!L.textOnly && <button style={{ ...btn, padding: "8px 20px", fontSize: "14px", flexShrink: 0, maxWidth: "45%", ...PW_WRAP }}>{L.buttonLabel}</button>}
                    </div>
                    {timerStrip}
                </div>
            );
        }
        if (selectedTemplate === "minimal-card") {
            return (
                <div style={{ background: L.bg, borderRadius: `${borderRadius}px`, padding: `${padding}px`, border: "1px solid #e5e7eb" }}>
                    <div style={{ display: "flex", gap: "12px" }}>
                        {!L.textOnly && <div style={{ background: L.accent + "18", borderRadius: `${Math.max(borderRadius - 2, 4)}px`, padding: "14px 8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: "110px", maxWidth: "110px", border: `1px dashed ${L.accent}50`, boxSizing: "border-box" }}>
                            <div style={{ fontSize: "9px", letterSpacing: "2px", color: L.accent, marginBottom: "6px", textTransform: "uppercase", fontWeight: 600 }}>YOUR CODE</div>
                            <div style={{ fontSize: "12px", fontWeight: 800, color: L.accent, textAlign: "center", wordBreak: "break-all", maxWidth: "100%" }}>{L.code}</div>
                        </div>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                                {icon(20, false)}
                                <div style={{ fontSize: `${fontSize}px`, fontWeight: 700, color: L.text, marginBottom: "4px", ...PW_WRAP, minWidth: 0 }}>{L.heading}</div>
                            </div>
                            <div className="pw-sub" style={sub({ fontSize: "12px", color: L.text, opacity: 0.65, marginBottom: "12px", ...PW_WRAP })}>{L.subtext}</div>
                            {!L.textOnly && <button style={{ ...btn, padding: "6px 16px", fontSize: "13px", maxWidth: "100%", ...PW_WRAP }}>{L.buttonLabel}</button>}
                        </div>
                    </div>
                    {timerStrip}
                </div>
            );
        }
        const boldIcon = icon(22, true);
        return (
            <div style={{ background: L.bg, borderRadius: `${borderRadius}px`, padding: `${padding}px` }}>
                <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                    {boldIcon && (
                        <div style={{ minWidth: "44px", minHeight: "44px", padding: "4px", boxSizing: "border-box", background: L.accent + "28", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {boldIcon}
                        </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: `${fontSize}px`, fontWeight: 800, color: L.text, marginBottom: "4px", ...PW_WRAP }}>{L.heading}</div>
                        <div className="pw-sub" style={sub({ fontSize: "12px", color: L.text, opacity: 0.85, marginBottom: "10px", ...PW_WRAP })}>{L.subtext}</div>
                        {!L.textOnly && <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <div style={{ flex: 1, minWidth: 0, border: `2px dashed ${L.accent}`, borderRadius: "6px", padding: "5px 14px", color: L.accent, fontSize: "13px", fontWeight: 700, textAlign: "center", wordBreak: "break-all" }}>{L.code}</div>
                            <button style={{ ...btn, padding: "6px 18px", fontSize: "13px", flexShrink: 0, maxWidth: "45%", ...PW_WRAP }}>{L.buttonLabel}</button>
                        </div>}
                    </div>
                </div>
                {timerStrip}
            </div>
        );
    };

    // Click a coupon in the preview to open its popup ([data-pick] in styles.js).
    const pick = (onPick, label) => ({ "data-pick": "", title: label, onClick: onPick });
    const isSample = selectedCouponIds.length === 0;
    // Up to 4 cards.
    const shownCards = isSample ? [""] : cardIds.slice(0, 4);

    const standin = <div className="pw-atc-standin cbz-standin" aria-hidden="true">Your Add to cart button</div>;
    const banner = (
        <div className="pw-banner" data-width={bannerWidth} style={bannerWidth === "atc" ? { width: "78%" } : bannerWidth === "custom" ? { maxWidth: `${bannerWidthPx}px` } : undefined}>
            {sectionTitle.text.trim() !== "" && (
                // Only ladders as wide as Add to cart: the title takes their width
                // (the storefront fits it to the button the same way).
                <div className="pw-section-title" {...pick(() => showMore("headings"), "Edit the banner title")} style={{ ...headingStyle(sectionTitle), ...(cardIds.length === 0 && laddersAtAtc ? { width: "78%" } : {}) }}>
                    {sectionTitle.text}
                </div>
            )}
            {selectedLadderIds.length > 0 && ladderTitle.text.trim() !== "" && (
                <div className="pw-ladders-title" {...pick(() => showMore("headings"), "Edit the offer ladder heading")} style={{ ...headingStyle(ladderTitle), ...(laddersAtAtc ? { width: "78%" } : {}) }}>{ladderTitle.text}</div>
            )}
            {selectedLadderIds.length > 0 && (
                <div className="pw-ladders" style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: cardIds.length ? "12px" : 0 }}>
                    {selectedLadderIds.map((id) => (
                        <div key={id} {...pick(() => setEditId(id), `Edit ${offerTitle(id)}`)}>
                            <OfferLadderPreview style={{ ...(couponOverrides[id] || {}), borderRadius }} />
                        </div>
                    ))}
                </div>
            )}
            {(cardIds.length > 0 || selectedLadderIds.length === 0) && cardsTitle.text.trim() !== "" && (
                <div className="pw-cards-title" {...pick(() => showMore("headings"), "Edit the coupon cards heading")} style={headingStyle(cardsTitle)}>{cardsTitle.text}</div>
            )}
            {(cardIds.length > 0 || selectedLadderIds.length === 0) && (() => {
                // The banner layout (storefront: coupon-slider-render.liquid ps-slider--*).
                const many = shownCards.length > 1;
                const box = !many ? { display: "block" }
                    : couponLayout === "grid" ? { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }
                        : couponLayout === "list" ? { display: "flex", flexDirection: "column", gap: "12px" }
                            // Top room for the preview's Edit tag (the row scrolls, so it would be cut off).
                            : { display: "flex", gap: "12px", overflowX: "auto", padding: "12px 4px 4px" };
                return (
                    <div className="pw-layout" data-layout={many ? couponLayout : "single"} style={box}>
                        {shownCards.map((cid, i) => (
                            <div key={cid || i} {...(cid ? pick(() => setEditId(cid), `Edit ${offerTitle(cid)}`) : {})}
                                style={{ width: many && couponLayout === "carousel" ? `${cardWidth}px` : "100%", maxWidth: many && couponLayout === "carousel" ? "85%" : "100%", flex: many && couponLayout === "carousel" ? "0 0 auto" : undefined, display: "flex", flexDirection: "column", minHeight: cardMinHeight || undefined }}>
                                <div style={{ flex: 1, display: "grid" }}>{renderCard(cid)}</div>
                            </div>
                        ))}
                    </div>
                );
            })()}
        </div>
    );
    const previewNotes = [
        cardIds.length > 4 && `The preview shows 4 of your ${cardIds.length} coupons.`,
        widgetPlacement === "custom" && "You choose the spot: add the Coupon Banner block to your product page in the theme editor.",
        selectedCouponIds.some((id) => (couponOverrides[id]?.displayCondition || "all") !== "all") && "Coupons set to some products or collections show only on those pages.",
    ].filter(Boolean);

    const editOffer = editId && selectedCouponIds.includes(editId) ? { id: editId, kind: offerKind(editId), title: offerTitle(editId) } : null;

    return (
        <Frame>
            <style>{COUPON_BANNER_CSS}</style>
            {toastActive && <Toast content="Settings saved!" onDismiss={() => setToastActive(false)} />}
            <CustomCouponModal
                open={customCouponOpen}
                onClose={() => setCustomCouponOpen(false)}
                existingCodes={allCoupons.map((c) => c.code)}
                fetcher={customCouponFetcher}
                hasUnsavedChanges={hasChanges}
                onCreateInBrix={(code) => { setCustomCouponOpen(false); navigate(`/app/discounts/create?prefillCode=${encodeURIComponent(code)}`); }}
            />
            <OfferEditModal
                offer={editOffer}
                override={editOffer ? couponOverrides[editOffer.id] : undefined}
                onChange={(patch) => updateOverride(editId, patch)}
                onClose={() => setEditId("")}
                onRemove={() => removeOffer(editId)}
                preview={editOffer && (editOffer.kind === "ladder"
                    ? <OfferLadderPreview style={{ ...(couponOverrides[editOffer.id] || {}), borderRadius }} />
                    : <div style={{ maxWidth: 440 }}>{renderCard(editOffer.id)}</div>)}
                templateDefaults={{ headingText: heading, subtextText: subtext, bgColor, textColor, accentColor, buttonColor, buttonTextColor: btnTextColor, buttonText: selectedTemplate === "bold-vibrant" ? "Copy" : "Copy Code" }}
                iconDefaultShow={selectedTemplate === "bold-vibrant"}
                codeOptions={ladderCodeOptions}
            />
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
                            onClick={() => {
                                if (!couponPublishable) return;
                                const next = !isEnabled;
                                setIsEnabled(next);
                                submitCouponConfig({ isEnabled: next });
                            }}
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
                        <Button onClick={onDiscard} disabled={!hasChanges || isSaving} size="slim">Discard</Button>
                        <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!hasChanges} size="slim">Save</Button>
                    </div>
                </div>

                <div className="cbz-body">
                    {/* Left: one simple page. Bottom padding (styles.js,
                        --brix-bar-clearance) keeps the last field clear of the
                        floating BrixBar. */}
                    <div ref={sideRef} className="cbz-side">
                        {/* Theme embed status — only relevant once the plan can actually
                            publish this; on Free the toggle above is already locked off.
                            Once the embed is enabled, no banner is shown (matches the FBT
                            Widget settings page behavior). */}
                        {couponPublishable && !couponEmbedEnabled && (
                            <div className="cbz-alert">
                                <Banner
                                    title="Coupon Banner is not visible on your store yet"
                                    tone="warning"
                                    action={{ content: 'Enable in theme editor', url: `https://${shop}/admin/themes/current/editor?context=apps`, target: '_blank' }}
                                >
                                    <p>Go to <strong>App embeds</strong> and turn on <em>Coupon Banner</em>.</p>
                                </Banner>
                            </div>
                        )}
                        <div className="cbz-stack">
                            <Step id="coupons" step="1" title="Coupons to show" description="Tick the codes shoppers should see on your product pages. Click Edit to change a coupon's words."
                                summary={cardIds.length + selectedLadderIds.length ? `${cardIds.length + selectedLadderIds.length} shown` : "None yet"} open={moreCard === "coupons"} onToggle={() => toggleMoreCard("coupons")}>
                                <CouponPicker
                                    rows={pickRows}
                                    selectedIds={selectedCouponIds}
                                    onToggle={toggleCoupon}
                                    onEdit={setEditId}
                                    onAddCustom={() => setCustomCouponOpen(true)}
                                />
                            </Step>

                            <Step id="design" step="2" title="Design" description="How each coupon looks."
                                summary={(TEMPLATES.find((t) => t.id === selectedTemplate) || {}).name} open={moreCard === "design"} onToggle={() => toggleMoreCard("design")}>
                                <ChoiceTiles
                                    label="Design"
                                    labelHidden
                                    value={selectedTemplate}
                                    onChange={applyTemplate}
                                    options={TEMPLATES.map((t) => ({ value: t.id, label: t.name, art: <TemplateArt id={t.id} /> }))}
                                    helpText={designDirty ? "Save first: switching design drops your unsaved coupon words, headings and sizes." : undefined}
                                />
                            </Step>

                            <Step id="position" step="3" title="Where it shows"
                                summary={{ above_cart: "Above Add to cart", below_cart: "Below Add to cart", custom: "Theme editor" }[widgetPlacement]} open={moreCard === "position"} onToggle={() => toggleMoreCard("position")}>
                                <BlockStack gap="300">
                                    <ChoiceList
                                        title="Where it shows"
                                        titleHidden
                                        selected={[widgetPlacement]}
                                        onChange={([v]) => { setWidgetPlacement(v); mark(); }}
                                        choices={[
                                            { label: "Above the Add to cart button", value: "above_cart" },
                                            { label: "Below the Add to cart button", value: "below_cart" },
                                            { label: "I'll place it myself (theme editor)", value: "custom" },
                                        ]}
                                    />
                                    {widgetPlacement === "custom" && (
                                        <Banner tone="info" action={{ content: "Open theme editor", url: `https://${shop}/admin/themes/current/editor?template=product`, target: "_blank" }}>
                                            <p>In the theme editor, click <b>Add block</b> in the product section, pick <b>Coupon Banner</b> under Apps and drag it where you want it.</p>
                                        </Banner>
                                    )}
                                </BlockStack>
                            </Step>

                            <Step id="timer" step="4" title="Countdown timer (optional)"
                                summary={timerEnabled ? timerSummary : "Off"} open={moreCard === "timer"} onToggle={() => toggleMoreCard("timer")}>
                                <BlockStack gap="300">
                                    <Checkbox label="Show a countdown timer on each coupon" checked={timerEnabled} onChange={(v) => { setTimerEnabled(v); mark(); }} />
                                    {timerEnabled && (
                                        <>
                                            <BlockStack gap="300">
                                                <div className="cbz-grid2">
                                                    <TextField label="Hours" type="number" value={String(timerHours)} onChange={(v) => { setTimerHours(Math.min(23, Math.max(0, Number(v)))); mark(); }} autoComplete="off" />
                                                    <TextField label="Minutes" type="number" value={String(timerMins)} onChange={(v) => { setTimerMins(Math.min(59, Math.max(0, Number(v)))); mark(); }} autoComplete="off" />
                                                </div>
                                                <TextField label="Timer text" value={timerLabel} onChange={(v) => { setTimerLabel(v); mark(); }} placeholder="Offer expires in" autoComplete="off" />
                                                <ChoiceList
                                                    title="When it reaches zero"
                                                    selected={[timerMode]}
                                                    onChange={([v]) => { setTimerMode(v); mark(); }}
                                                    choices={[
                                                        { label: "Show the expired text (starts again on the next visit)", value: "session" },
                                                        { label: "Start again right away", value: "loop" },
                                                    ]}
                                                />
                                                {timerMode !== "loop" && (
                                                    <TextField label="Expired text" value={timerExpired} onChange={(v) => { setTimerExpired(v); mark(); }} placeholder="Offer expired!" autoComplete="off" />
                                                )}
                                                <div className="cbz-grid3">
                                                    <ColorField label="Background" value={timerBg} onChange={(v) => { setTimerBg(v); mark(); }} />
                                                    <ColorField label="Text colour" value={timerText} onChange={(v) => { setTimerText(v); mark(); }} />
                                                    <ColorField label="Time colour" value={timerAccent} onChange={(v) => { setTimerAccent(v); mark(); }} />
                                                </div>
                                            </BlockStack>
                                        </>
                                    )}
                                </BlockStack>
                            </Step>

                            <button type="button" className="cbz-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
                                More options <span className="cbz-more-d">· text offers, offer ladders, headings, size</span>
                                <span className="cbz-chev"><Icon source={ChevronDownIcon} /></span>
                            </button>

                            {moreOpen && (
                                <>
                                    <Step id="other-offers" title="Text offers and offer ladders" description="Other things the banner can show besides coupon codes. They appear in 1. Coupons to show, ticked."
                                        summary={extrasSummary} open={moreCard === "other-offers"} onToggle={() => toggleMoreCard("other-offers")}>
                                        <div className="cbz-tiles" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                                            <button type="button" className="cbz-tile cbz-tile--row" aria-label="Add a text offer with no code" onClick={addTextOffer}>
                                                <span className="cbz-tile-art" aria-hidden="true"><OfferArt kind="text" /></span>
                                                <span className="cbz-tile-txt">
                                                    <span className="cbz-tile-l">Add a text offer</span>
                                                    <span className="cbz-tile-d">Just words, like &ldquo;Free shipping over ₹999&rdquo;. No code, no button.</span>
                                                </span>
                                            </button>
                                            <button type="button" className="cbz-tile cbz-tile--row" aria-label="Add an offer ladder" onClick={addLadder}>
                                                <span className="cbz-tile-art" aria-hidden="true"><OfferArt kind="ladder" /></span>
                                                <span className="cbz-tile-txt">
                                                    <span className="cbz-tile-l">Add an offer ladder</span>
                                                    <span className="cbz-tile-d">A bar like &ldquo;Buy 2 Get 10% Off | Buy 3 Get 15% Off&rdquo;.</span>
                                                </span>
                                            </button>
                                        </div>
                                    </Step>

                                    <Step id="headings" title="Headings" description="Titles above the banner. Each one shows only when it has words."
                                        summary={headingsSummary} open={moreCard === "headings"} onToggle={() => toggleMoreCard("headings")}>
                                        <BlockStack gap="300">
                                            <HeadingFields
                                                label="Banner title"
                                                name="Title"
                                                where="Top of the banner"
                                                placeholder="Apply Coupon"
                                                value={sectionTitle}
                                                onChange={(key, v) => { setSectionTitle((prev) => ({ ...prev, [key]: v })); markDesign(); }}
                                            />
                                            <HeadingFields
                                                label="Offer ladder heading"
                                                name="Ladder heading"
                                                where="Above offer ladders"
                                                placeholder="e.g. Bundle offers"
                                                note={selectedLadderIds.length ? undefined : "Shows once you add an offer ladder. Leave empty to hide it."}
                                                value={ladderTitle}
                                                onChange={(key, v) => { setLadderTitle((prev) => ({ ...prev, [key]: v })); markDesign(); }}
                                            />
                                            <HeadingFields
                                                label="Coupon cards heading"
                                                name="Cards heading"
                                                where="Above coupon cards"
                                                placeholder="e.g. Apply a coupon"
                                                value={cardsTitle}
                                                onChange={(key, v) => { setCardsTitle((prev) => ({ ...prev, [key]: v })); markDesign(); }}
                                            />
                                        </BlockStack>
                                    </Step>

                                    <Step id="layout" title="Layout and size" description="How the coupons are arranged, the banner's width and the cards' size."
                                        summary={layoutSummary} open={moreCard === "layout"} onToggle={() => toggleMoreCard("layout")}>
                                        <BlockStack gap="400">
                                            <ChoiceTiles
                                                label="How coupon cards are arranged"
                                                value={couponLayout}
                                                onChange={(v) => { setCouponLayout(v); mark(); }}
                                                options={[
                                                    { value: "list", label: "List", description: "Stacked, full width", art: <ArrangeArt layout="list" /> },
                                                    { value: "carousel", label: "Carousel", description: "One row that slides", art: <ArrangeArt layout="carousel" /> },
                                                    { value: "grid", label: "Grid", description: "2 columns, 1 on phones", art: <ArrangeArt layout="grid" /> },
                                                ]}
                                                helpText={cardIds.length < 2 ? "This matters once 2 or more coupons are shown." : undefined}
                                            />
                                            <BlockStack gap="200">
                                                <Segmented
                                                    label="Banner width"
                                                    value={bannerWidth}
                                                    onChange={(v) => { setBannerWidth(v); markDesign(); }}
                                                    options={[
                                                        { label: "Full width", value: "full" },
                                                        { label: "Add to cart width", value: "atc" },
                                                        { label: "Custom", value: "custom" },
                                                    ]}
                                                    helpText={bannerWidth === "atc" ? "Lines up with your theme's Add to cart button: the title, offer ladders and coupons take its width. Pages without the button show it full width." : "The whole banner: title, offer ladders and coupons."}
                                                />
                                                {bannerWidth === "custom" && (
                                                    <SliderField label="Banner width (px)" value={bannerWidthPx} min={200} max={800} step={10} suffix="px" onChange={(v) => { setBannerWidthPx(v); markDesign(); }} />
                                                )}
                                            </BlockStack>
                                            <BlockStack gap="200">
                                                <span className="cbz-sub">Coupon cards</span>
                                                <SliderField label="Corner roundness" value={borderRadius} min={0} max={24} suffix="px" onChange={(v) => { setBorderRadius(v); markDesign(); }} />
                                                <SliderField label="Heading text size" value={fontSize} min={10} max={28} suffix="px" onChange={(v) => { setFontSize(v); markDesign(); }} />
                                                <SliderField label="Space inside" value={padding} min={8} max={32} suffix="px" onChange={(v) => { setPadding(v); markDesign(); }} />
                                                <SliderField label="Card width" value={cardWidth} min={200} max={480} step={10} suffix="px" onChange={(v) => { setCardWidth(v); markDesign(); }} />
                                                <SliderField label="Minimum card height" value={cardMinHeight} min={0} max={300} step={10} suffix="px" onChange={(v) => { setCardMinHeight(v); markDesign(); }} />
                                                <Text as="p" variant="bodySm" tone="subdued">Card width is for the Carousel; List and Grid cards fill the row. Cards grow taller for long text, so nothing is cut off; on phones a card is at most 85% of the screen width. Height 0 = as tall as the text. Corner roundness also applies to offer ladders.</Text>
                                            </BlockStack>
                                        </BlockStack>
                                    </Step>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Right: live preview of a product page. */}
                    <div className="cbz-main">
                        <div className="cbz-pv">
                            <div className="cbz-pv-bar"><b>Live preview</b><span>Click a coupon to edit it</span></div>
                            <div className="cbz-pv-chrome" aria-hidden="true"><i /><i /><i /><span /></div>
                            <div className="cbz-pv-page">
                                <div className="cbz-skel" aria-hidden="true"><i style={{ width: "58%", height: 12 }} /><i style={{ width: "26%" }} /></div>
                                {widgetPlacement === "below_cart" && standin}
                                {isSample ? (
                                    <div className="cbz-pv-sample">
                                        {banner}
                                        <div className="cbz-pv-cta">This is a sample. Tick a coupon in <b>1. Coupons to show</b> to see yours here.</div>
                                    </div>
                                ) : banner}
                                {widgetPlacement !== "below_cart" && (widgetPlacement !== "custom" || bannerWidth === "atc") && standin}
                            </div>
                            {previewNotes.length > 0 && (
                                <div className="cbz-pv-note">{previewNotes.map((n) => <div key={n}>{n}</div>)}</div>
                            )}
                        </div>
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
