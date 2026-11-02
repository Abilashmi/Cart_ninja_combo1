// One offer's settings in a popup: its words and which product pages first,
// the rest (colours and icon, or a ladder's look, size and button) folded
// below. Changes apply at once, like every field on the page (the page's
// Save / Discard keep or drop them); Done closes the popup.
import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, InlineStack, Text, TextField, Button, Banner, Tag, Modal, ChoiceList } from "@shopify/polaris";
import { CouponStyleFields } from "../shared/CouponStyleFields";
import { ColorField } from "../shared/ColorField";
import { OfferLadderFields } from "./OfferLadder";
import { Fold } from "./ui";

/**
 * offer = { id, kind: coupon | custom | text | ladder, title } or null (closed).
 * preview = the offer as the banner draws it, shown at the top of the popup.
 */
export function OfferEditModal({ offer, override, onChange, onClose, onRemove, preview, templateDefaults, iconDefaultShow, codeOptions }) {
    if (!offer) return null;
    const isLadder = offer.kind === "ladder";
    const isText = offer.kind === "text";
    const ov = override || {};
    const td = templateDefaults || {};
    // Empty = the card design's own colour.
    const colorField = (label, key, def) => (
        <ColorField label={label} value={ov[key] || ""} fallback={td[key] || def} allowEmpty onChange={(v) => onChange({ [key]: v })} />
    );
    return (
        <Modal
            open
            onClose={onClose}
            title={`Edit: ${offer.title}`}
            primaryAction={{ content: "Done", onAction: onClose }}
            secondaryActions={[{ content: "Remove from banner", destructive: true, onAction: onRemove }]}
        >
            <Modal.Section>
                <div className="cbz-modal-pv" aria-label="Preview">{preview}</div>
                <BlockStack gap="400">
                    {isLadder ? (
                        <OfferLadderFields value={ov} onChange={onChange} codeOptions={codeOptions} part="offers" />
                    ) : (
                        <BlockStack gap="300">
                            <TextField label="Heading" value={ov.headingText ?? ""} onChange={(v) => onChange({ headingText: v })} placeholder={td.headingText} autoComplete="off" maxLength={30} showCharacterCount helpText={isText ? undefined : "Empty = the design's own heading."} />
                            <TextField label="Subtext" value={ov.subtextText ?? ""} onChange={(v) => onChange({ subtextText: v })} placeholder={td.subtextText} autoComplete="off" maxLength={35} showCharacterCount />
                            {isText
                                ? <Text as="p" variant="bodySm" tone="subdued">A text offer shows only these words: no code and no Copy button.</Text>
                                : <TextField label="Button Text" value={ov.buttonText ?? ""} onChange={(v) => onChange({ buttonText: v })} placeholder={td.buttonText} autoComplete="off" maxLength={10} showCharacterCount />}
                        </BlockStack>
                    )}
                    <ShowOnFields value={ov} onChange={onChange} />
                    {isLadder ? (
                        <BlockStack gap="200">
                            <Fold title="Look" description="Shape, style and colours">
                                <OfferLadderFields value={ov} onChange={onChange} codeOptions={codeOptions} part="look" />
                            </Fold>
                            <Fold title="Size" description="Width, space and height">
                                <OfferLadderFields value={ov} onChange={onChange} codeOptions={codeOptions} part="size" />
                            </Fold>
                            <Fold title="Button" description="An optional Copy / Apply button">
                                <OfferLadderFields value={ov} onChange={onChange} codeOptions={codeOptions} part="button" />
                            </Fold>
                        </BlockStack>
                    ) : (
                        <BlockStack gap="200">
                            <Fold title="Colours" description="Empty = the design's own colours">
                                <BlockStack gap="300">
                                    <div className="cbz-grid2">
                                        {colorField("Background", "bgColor", "#ffffff")}
                                        {colorField("Text", "textColor", "#111827")}
                                        {colorField("Accent", "accentColor", "#3b82f6")}
                                        {!isText && colorField("Button", "buttonColor", "#3b82f6")}
                                        {!isText && colorField("Button text", "buttonTextColor", "#ffffff")}
                                    </div>
                                    <CouponStyleFields value={ov} onChange={onChange} part="colors" hideCopied={isText}
                                        defaults={{ subColor: ov.textColor || td.textColor }} />
                                </BlockStack>
                            </Fold>
                            <Fold title="Text size and icon" description="Subtext size, and an icon beside the heading">
                                <BlockStack gap="400">
                                    <CouponStyleFields value={ov} onChange={onChange} part="font" />
                                    <CouponStyleFields value={ov} onChange={onChange} part="icon"
                                        defaults={{ iconColor: ov.accentColor || td.accentColor, icon: "discount", iconShow: iconDefaultShow }} />
                                </BlockStack>
                            </Fold>
                        </BlockStack>
                    )}
                </BlockStack>
            </Modal.Section>
        </Modal>
    );
}

/** Which product pages one offer shows on. */
function ShowOnFields({ value, onChange }) {
    const shopify = useAppBridge();
    const ov = value || {};
    const mode = ov.displayCondition || "all";
    // shopify.resourcePicker can reject (e.g. before App Bridge has finished
    // starting in the embedded iframe); say so instead of doing nothing.
    const [pickerError, setPickerError] = useState("");
    const openPicker = async (type, onResult) => {
        setPickerError("");
        try {
            const result = await shopify.resourcePicker({ type, multiple: true });
            if (result) onResult(result);
        } catch (e) {
            console.error(`[ShowOnFields] resourcePicker(${type}) failed:`, e);
            setPickerError(`Couldn't open the ${type} picker (${e?.message || "unknown error"}). Try reloading the page.`);
        }
    };
    const picked = (key, label) => ((ov[key] || []).length > 0 ? (
        <InlineStack gap="100" wrap>
            {(ov[key] || []).map((h) => (
                <Tag key={h} onRemove={() => onChange({ [key]: (ov[key] || []).filter((x) => x !== h) })} accessibilityLabel={`Remove ${label} ${h}`}>{h}</Tag>
            ))}
        </InlineStack>
    ) : (
        <Text as="p" variant="bodySm" tone="critical">Nothing picked yet, so this offer shows nowhere.</Text>
    ));
    return (
        <BlockStack gap="200">
            <ChoiceList
                title="Show it on"
                selected={[mode]}
                onChange={([v]) => onChange({ displayCondition: v })}
                choices={[
                    { label: "All product pages", value: "all" },
                    { label: "Only some products", value: "product_handle" },
                    { label: "Only products in some collections", value: "collection_handle" },
                ]}
            />
            {pickerError && <Banner tone="critical" onDismiss={() => setPickerError("")}>{pickerError}</Banner>}
            {mode === "product_handle" && (
                <BlockStack gap="200">
                    <div><Button onClick={() => openPicker("product", (result) => onChange({ productHandles: result.map((p) => p.handle) }))}>Choose products</Button></div>
                    {picked("productHandles", "product")}
                </BlockStack>
            )}
            {mode === "collection_handle" && (
                <BlockStack gap="200">
                    <div><Button onClick={() => openPicker("collection", (result) => onChange({ collectionHandles: result.map((c) => c.handle) }))}>Choose collections</Button></div>
                    {picked("collectionHandles", "collection")}
                </BlockStack>
            )}
        </BlockStack>
    );
}
