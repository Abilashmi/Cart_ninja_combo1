// Coupon Banner offer ladder: the editor fields (Customize Coupon) and the
// live preview. Rules, HTML and CSS come from utils/offer-ladder.shared.js,
// the same code the storefront runs.
import { useEffect, useState } from "react";
import { BlockStack, InlineStack, Text, TextField, Select, Checkbox, Button, Banner, Divider } from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import { SliderField } from "../shared/SliderField";
import { ColorField } from "../shared/ColorField";
import { offerLadder } from "../../utils/offer-ladder.shared.js";

const LOOK_OPTIONS = [
    { label: "One line: every offer, divided", value: "strip" },
    { label: "Scrolling ticker", value: "ticker" },
    { label: "Rotating: one offer at a time", value: "rotate" },
];
const DIRECTION_OPTIONS = [
    { label: "Horizontal: side by side", value: "row" },
    { label: "Vertical: one under another", value: "column" },
];
const PLACE_OPTIONS = [
    { label: "Right side", value: "right" },
    { label: "Centre, next to the text", value: "center" },
    { label: "Below the text, centred", value: "below" },
];
const SIZE_OPTIONS = [
    { label: "Full width", value: "full" },
    { label: "Same as the Add to cart button", value: "atc" },
    { label: "Custom width", value: "custom" },
];
const ACTION_OPTIONS = [
    { label: "Copy the code", value: "copy" },
    { label: "Apply the code to the cart", value: "apply" },
];

/**
 * value = this ladder's per-coupon style; onChange(patch) merges into it.
 * codeOptions = [{ label, value }] of the store's coupon codes.
 */
export function OfferLadderFields({ value, onChange, codeOptions }) {
    const ov = value || {};
    const tiers = Array.isArray(ov.tiers) ? ov.tiers : [];
    const look = offerLadder.LOOKS.includes(ov.look) ? ov.look : "strip";
    const auto = ov.autoApply === true;
    const action = ov.buttonAction === "apply" ? "apply" : "copy";
    const size = offerLadder.BOX_SIZES.includes(ov.boxSize) ? ov.boxSize : "full";
    const setTier = (i, patch) => onChange({ tiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
    const removeTier = (i) => onChange({ tiers: tiers.filter((_, j) => j !== i) });
    const addTier = () => {
        const last = tiers[tiers.length - 1];
        const qty = Math.min(99, (parseInt(last?.qty, 10) || 1) + 1);
        onChange({ tiers: [...tiers, { text: `Buy any ${qty} Get 20% Off`, qty, code: "" }] });
    };
    const usable = offerLadder.normalize(ov).tiers.length;
    const qtyCount = {};
    tiers.forEach((t) => { const q = parseInt(t.qty, 10); if (q) qtyCount[q] = (qtyCount[q] || 0) + 1; });
    const knownCodes = new Set(codeOptions.map((o) => o.value.toUpperCase()));
    const optionsFor = (cur, emptyLabel) => [
        { label: emptyLabel, value: "" },
        ...codeOptions,
        ...(cur && !knownCodes.has(String(cur).toUpperCase()) ? [{ label: `${cur} (not an active code)`, value: cur }] : []),
    ];

    return (
        <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Offers</Text>
            {tiers.map((t, i) => {
                const q = parseInt(t.qty, 10);
                const qtyError = !q || q < 1 || q > 99 ? "1 to 99 items" : qtyCount[q] > 1 ? "Another offer needs the same number" : undefined;
                return (
                    <div key={i} className="pw-ladder-tier" style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "10px 12px", background: "#fafbfb" }}>
                        <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                                <Text as="span" variant="bodySm" fontWeight="semibold">Offer {i + 1}</Text>
                                <Button size="slim" variant="plain" tone="critical" icon={DeleteIcon} accessibilityLabel={`Remove offer ${i + 1}`} onClick={() => removeTier(i)} />
                            </InlineStack>
                            <TextField label="Offer text" value={t.text ?? ""} onChange={(v) => setTier(i, { text: v })} placeholder="Buy any 2 Get 10% Off" autoComplete="off" maxLength={80} showCharacterCount error={!String(t.text || "").trim() ? "Add the words shoppers see" : undefined} />
                            {auto && (
                                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "10px" }}>
                                    <TextField label="Items in cart" type="number" min={1} max={99} value={t.qty === "" || t.qty == null ? "" : String(t.qty)} onChange={(v) => setTier(i, { qty: v === "" ? "" : Math.max(0, Math.min(99, parseInt(v, 10) || 0)) })} autoComplete="off" error={qtyError} />
                                    <Select label="Coupon to apply" value={t.code || ""} options={optionsFor(t.code, "No code (automatic discount)")} onChange={(v) => setTier(i, { code: v })} />
                                </div>
                            )}
                        </BlockStack>
                    </div>
                );
            })}
            {tiers.length < offerLadder.MAX_TIERS && (
                <div><Button icon={PlusIcon} onClick={addTier}>Add an offer</Button></div>
            )}
            {usable === 0 && <Banner tone="warning"><p>Add at least one offer. Until then the ladder doesn&rsquo;t show on your store.</p></Banner>}

            <TextField label="Subtext (optional)" value={ov.subtextText ?? ""} onChange={(v) => onChange({ subtextText: v })} placeholder="e.g. Discount applied at checkout" autoComplete="off" maxLength={120} showCharacterCount />

            <Divider />
            <Text as="h3" variant="headingSm">Look</Text>
            <Select label="Style" value={look} options={LOOK_OPTIONS} onChange={(v) => onChange({ look: v })} />
            {(look === "ticker" || (look === "strip" && ov.direction !== "column")) && (
                <Select label="Divider between offers" value={offerLadder.SEPARATORS.includes(ov.separator) ? ov.separator : "|"} onChange={(v) => onChange({ separator: v })}
                    options={offerLadder.SEPARATORS.map((s) => ({ label: s, value: s }))} />
            )}
            {look === "strip" && (
                <Select label="Offer direction" value={ov.direction === "column" ? "column" : "row"} options={DIRECTION_OPTIONS} onChange={(v) => onChange({ direction: v })} />
            )}
            {look === "rotate" && (
                <SliderField label="Change offer every" value={parseInt(ov.interval, 10) || 4} min={2} max={15} suffix="s" onChange={(v) => onChange({ interval: v })} />
            )}
            <SliderField label="Text size" value={parseInt(ov.textSize, 10) || 14} min={11} max={24} suffix="px" onChange={(v) => onChange({ textSize: v })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <ColorField label="Background" value={ov.bgColor || ""} fallback="#111827" allowEmpty onChange={(v) => onChange({ bgColor: v })} />
                <ColorField label="Text" value={ov.textColor || ""} fallback="#ffffff" allowEmpty onChange={(v) => onChange({ textColor: v })} />
                <ColorField label="Button" value={ov.accentColor || ""} fallback="#facc15" allowEmpty onChange={(v) => onChange({ accentColor: v })} />
            </div>

            <Divider />
            <Text as="h3" variant="headingSm">Box size</Text>
            <Select label="Width" value={size} options={SIZE_OPTIONS} onChange={(v) => onChange({ boxSize: v })}
                helpText={size === "atc" ? "Lines up with your theme's Add to cart button: same width, and at least as tall. Pages without the button show it full width." : undefined} />
            {size === "custom" && (
                <SliderField label="Box width" value={parseInt(ov.boxWidth, 10) || 400} min={200} max={800} step={10} suffix="px" onChange={(v) => onChange({ boxWidth: v })} />
            )}
            <SliderField label="Space top and bottom" value={ov.padY == null || ov.padY === "" ? 10 : parseInt(ov.padY, 10)} min={4} max={32} suffix="px" onChange={(v) => onChange({ padY: v })} />
            <SliderField label="Space at the sides" value={ov.padX == null || ov.padX === "" ? 14 : parseInt(ov.padX, 10)} min={6} max={40} suffix="px" onChange={(v) => onChange({ padX: v })} />
            <SliderField label="Minimum height" value={parseInt(ov.minHeight, 10) || 0} min={0} max={200} step={2} suffix="px" onChange={(v) => onChange({ minHeight: v })} />
            <Text as="p" variant="bodySm" tone="subdued">Height 0 = as tall as the text. Phones never get a box wider than the screen.</Text>

            <Divider />
            <Checkbox label="Show a button" helpText="One button next to the offers: copies a coupon code, or applies it to the shopper's cart." checked={ov.buttonShow === true} onChange={(v) => onChange({ buttonShow: v })} />
            {ov.buttonShow === true && (
                <BlockStack gap="200">
                    <Select label="When tapped" value={action} options={ACTION_OPTIONS} onChange={(v) => onChange({ buttonAction: v })} />
                    <Select label="Button position" value={offerLadder.BUTTON_PLACES.includes(ov.buttonPlace) ? ov.buttonPlace : "right"} options={PLACE_OPTIONS} onChange={(v) => onChange({ buttonPlace: v })} />
                    <Select label="Coupon code" value={ov.buttonCode || ""} options={optionsFor(ov.buttonCode, "Pick a code")} onChange={(v) => onChange({ buttonCode: v })}
                        error={!ov.buttonCode ? "Pick the code the button uses. Without one the button doesn't show." : undefined} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <TextField label="Button text" value={ov.buttonText ?? ""} onChange={(v) => onChange({ buttonText: v })} placeholder={offerLadder.DEFAULTS.buttonText[action]} autoComplete="off" maxLength={30} />
                        <TextField label="After tapping" value={ov.buttonDoneText ?? ""} onChange={(v) => onChange({ buttonDoneText: v })} placeholder={offerLadder.DEFAULTS.buttonDoneText[action]} autoComplete="off" maxLength={30} />
                    </div>
                </BlockStack>
            )}

            <Divider />
            <Checkbox label="Apply codes automatically as the cart grows" helpText="Give each offer a number of items and a code. When the cart has that many items, BRIX puts the code on the shopper's cart, so it applies at checkout." checked={auto} onChange={(v) => onChange({ autoApply: v })} />
            {auto && tiers.some((t) => t.code) && (
                <Banner tone="info"><p>Give each discount the same minimum quantity in Shopify (e.g. &ldquo;Minimum quantity of items: 2&rdquo;). BRIX applies the code; Shopify decides if the order qualifies.</p></Banner>
            )}
        </BlockStack>
    );
}

let cssInjected = false;
function useLadderCss() {
    useEffect(() => {
        if (cssInjected || typeof document === "undefined") return;
        cssInjected = true;
        const el = document.createElement("style");
        el.setAttribute("data-offer-ladder", "");
        el.textContent = offerLadder.css;
        document.head.appendChild(el);
    }, []);
}

/** One ladder as the storefront draws it. */
export function OfferLadderPreview({ style }) {
    useLadderCss();
    const L = offerLadder.normalize(style);
    const [show, setShow] = useState(0);
    useEffect(() => {
        if (L.look !== "rotate" || L.tiers.length < 2) return undefined;
        const t = setInterval(() => setShow((s) => s + 1), L.interval * 1000);
        return () => clearInterval(t);
    }, [L.look, L.interval, L.tiers.length]);
    const html = offerLadder.html(L, { show });
    if (!html) return <div className="pw-ladder-empty" style={{ padding: "12px", border: "1px dashed #c9cccf", borderRadius: "8px", fontSize: "12px", color: "#6d7175", textAlign: "center" }}>Add an offer to see the ladder.</div>;
    // eslint-disable-next-line react/no-danger -- built by offer-ladder.shared.js, merchant text escaped
    const ladder = <div className="pw-ladder" dangerouslySetInnerHTML={{ __html: html }} />;
    if (L.boxSize !== "atc") return ladder;
    // Same as Add to cart: a stand-in button (theme-like size) under it, same width.
    return (
        <div className="pw-ladder-atc" style={{ width: "78%", display: "flex", flexDirection: "column", gap: "8px", "--psl-atc-h": "46px" }}>
            {ladder}
            <div aria-hidden="true" style={{ height: "46px", borderRadius: "6px", border: "1.5px dashed #9ca3af", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 600, color: "#6b7280", background: "#fff" }}>Your Add to cart button</div>
        </div>
    );
}
