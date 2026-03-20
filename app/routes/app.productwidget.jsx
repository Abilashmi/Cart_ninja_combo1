/**
 * Product Widgets Configuration Page
 * Features: Coupons and Frequently Bought Together tabs with templates and color pickers
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    InlineStack,
    Text,
    Button,
    ButtonGroup,
    TextField,
    Badge,
    Checkbox,
    Banner,
    Divider,
    Tabs,
    Select,
    ChoiceList,
    Thumbnail,
    Box,
    Icon,
    Popover,
    ColorPicker,
    RangeSlider,
    Modal,
    Spinner,
    Tag,
    Collapsible,
} from "@shopify/polaris";
import {
    DiscountIcon,
    ProductIcon,
    MagicIcon,
    SettingsIcon,
    ColorIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    XSmallIcon,
    MobileIcon,
    DesktopIcon,
} from "@shopify/polaris-icons";

// --- UTILITY FUNCTIONS ---

// Convert HSB to Hex
function hsbToHex(hsb) {
    const { hue, saturation, brightness } = hsb;
    const h = hue / 360;
    const s = saturation;
    const v = brightness;

    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
        default: r = 0; g = 0; b = 0;
    }

    const toHex = (x) => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Convert Hex to HSB
function hexToHsb(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) {
        hex = hex.split("").map(c => c + c).join("");
    }

    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (max !== min) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
            default: break;
        }
        h /= 6;
    }

    return { hue: h * 360, saturation: s, brightness: v };
}

// Normalize product picker payloads to unique parent products.
function normalizeProductSelection(selected = []) {
    const seen = new Set();

    return (selected || [])
        .map((item) => {
            const product = item?.product || item;
            const id = product?.id || item?.productId;
            const handle = product?.handle || item?.handle;

            if (!id && !handle) {
                return null;
            }

            const dedupeKey = id || handle;
            if (seen.has(dedupeKey)) {
                return null;
            }
            seen.add(dedupeKey);

            return {
                id: id || handle,
                title: product?.title || item?.title || "",
                handle: handle || "",
                variantId:
                    product?.variants?.[0]?.id ||
                    item?.variants?.[0]?.id ||
                    product?.variantId ||
                    item?.variantId ||
                    "",
                image:
                    product?.images?.[0]?.originalSrc ||
                    product?.image?.originalSrc ||
                    item?.images?.[0]?.originalSrc ||
                    item?.image?.originalSrc ||
                    "",
                price:
                    product?.variants?.[0]?.price ||
                    item?.variants?.[0]?.price ||
                    item?.price ||
                    "0.00",
            };
        })
        .filter(Boolean);
}

// --- FAKE BACKEND DATA ---

const FAKE_COUPON_CONFIG = {
    activeTemplate: "template1",
    title: {
        text: "Apply Coupon",
        fontSize: 14,
        textColor: "#111827",
        alignment: "left",
    },
    selectedActiveCoupons: [],
    displayCondition: "all",
    productHandles: [],
    collectionHandles: [],
    displayTags: [],
    templates: {
        template1: {
            name: "Classic Banner",
            headingText: "GET 10% OFF!",
            subtextText: "Apply at checkout for savings",
            bgColor: "#ffffff",
            textColor: "#111827",
            accentColor: "#3b82f6",
            buttonColor: "#3b82f6",
            buttonTextColor: "#ffffff",
            borderRadius: 12,
            fontSize: 16,
            padding: 16,
        },
        template2: {
            name: "Minimal Card",
            headingText: "SPECIAL OFFER",
            subtextText: "Free shipping on orders over ₹500",
            bgColor: "#f9fafb",
            textColor: "#374151",
            accentColor: "#10b981",
            buttonColor: "#10b981",
            buttonTextColor: "#ffffff",
            borderRadius: 8,
            fontSize: 14,
            padding: 14,
        },
        template3: {
            name: "Bold & Vibrant",
            headingText: "FLASH SALE!",
            subtextText: "Use code: BOLD25 for extra 25% OFF",
            bgColor: "#4f46e5",
            textColor: "#ffffff",
            accentColor: "#f59e0b",
            buttonColor: "#f59e0b",
            buttonTextColor: "#111827",
            borderRadius: 16,
            fontSize: 18,
            padding: 20,
        },
    },
};

const FAKE_FBT_CONFIG = {
    activeTemplate: "fbt1",
    mode: "manual",
    openaiKey: "",
    templates: {
        fbt1: {
            name: "Classic Grid",
            layout: "horizontal",
            interactionType: "classic",
            bgColor: "#ffffff",
            textColor: "#111827",
            priceColor: "#059669",
            buttonColor: "#111827",
            buttonTextColor: "#ffffff",
            borderColor: "#e5e7eb",
            borderRadius: 8,
            showPrices: true,
            showAddAllButton: true,
        },
        fbt2: {
            name: "Modern Cards",
            layout: "horizontal",
            interactionType: "bundle",
            bgColor: "#f9fafb",
            textColor: "#374151",
            priceColor: "#dc2626",
            buttonColor: "#4f46e5",
            buttonTextColor: "#ffffff",
            borderColor: "#d1d5db",
            borderRadius: 12,
            showPrices: true,
            showAddAllButton: true,
        },
        fbt3: {
            name: "Vertical List",
            layout: "vertical",
            interactionType: "quickAdd",
            bgColor: "#ffffff",
            textColor: "#1f2937",
            priceColor: "#2563eb",
            buttonColor: "#10b981",
            buttonTextColor: "#ffffff",
            borderColor: "#f3f4f6",
            borderRadius: 4,
            showPrices: true,
            showAddAllButton: true,
        },
    },
    manualRules: [],
};

// --- LOADER ---

export async function loader({ request }) {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    let products = [];
    try {
        const response = await admin.graphql(`
      query getProducts {
                products(first: 50, query: "status:active") {
          edges {
            node {
              id
              title
                            handle
              featuredImage {
                url
              }
              variants(first: 1) {
                edges {
                  node {
                                        id
                    price
                  }
                }
              }
            }
          }
        }
      }
    `);
        const data = await response.json();
        products = data.data?.products?.edges?.map(({ node }) => {
            const firstVariant = node?.variants?.edges?.[0]?.node;
            if (!firstVariant?.id) {
                return null;
            }

            return {
                id: node.id,
                title: node.title,
                handle: node.handle,
                image: node.featuredImage?.url || "",
                variantId: firstVariant.id,
                price: firstVariant.price || "0.00",
            };
        }).filter(Boolean) || [];
    } catch (e) {
        console.error("Failed to fetch products:", e);
    }

    // Fetch configurations from separate APIs
    let couponConfig = FAKE_COUPON_CONFIG;
    let fbtConfig = FAKE_FBT_CONFIG;
    const url = new URL(request.url);

    try {
        // 1. Fetch Coupon Config
        const couponRes = await fetch(`${url.origin}/api/coupon-slider?shop=${encodeURIComponent(shop)}`);
        const couponData = await couponRes.json();
        if (couponData.success && couponData.config) {
            console.log("Fetched coupon data successfully");
            couponConfig = couponData.config;
        }
    } catch (e) {
        console.error("Failed to fetch coupon settings:", e);
    }

    try {
        // 2. Fetch FBT Config
        const fbtRes = await fetch(`${url.origin}/api/product-sample`);
        const fbtData = await fbtRes.json();

        // Handle both old nested structure and new structure if api.product-sample is updated
        if (fbtData.success) {
            if (fbtData.settings?.productWidgetConfig?.fbt) {
                fbtConfig = fbtData.settings.productWidgetConfig.fbt;
            } else if (fbtData.fbt) {
                fbtConfig = fbtData.fbt;
            }
            console.log("Fetched FBT data successfully");
        }
    } catch (e) {
        console.error("Failed to fetch FBT settings:", e);
    }

    return {
        couponConfig,
        fbtConfig,
        products,
        shop,
    };
}

// --- ACTION ---


// --- COLOR PICKER COMPONENT ---

function ColorPickerField({ label, value, onChange }) {
    const [popoverActive, setPopoverActive] = useState(false);
    const [color, setColor] = useState(hexToHsb(value || "#000000"));

    const handleColorChange = (newColor) => {
        setColor(newColor);
        onChange(hsbToHex(newColor));
    };

    const activator = (
        <Button onClick={() => setPopoverActive(!popoverActive)} disclosure>
            <InlineStack gap="200" blockAlign="center">
                <div
                    style={{
                        width: "20px",
                        height: "20px",
                        backgroundColor: value,
                        borderRadius: "4px",
                        border: "1px solid #ccc",
                    }}
                />
                <Text variant="bodySm">{value}</Text>
            </InlineStack>
        </Button>
    );

    return (
        <BlockStack gap="100">
            <Text as="label" variant="bodySm" fontWeight="semibold">
                {label}
            </Text>
            <Popover
                active={popoverActive}
                activator={activator}
                onClose={() => setPopoverActive(false)}
                preferredAlignment="left"
            >
                <Box padding="300">
                    <ColorPicker onChange={handleColorChange} color={color} />
                    <Box paddingBlockStart="200">
                        <TextField
                            label="Hex"
                            labelHidden
                            value={value}
                            onChange={(v) => {
                                if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                                    setColor(hexToHsb(v));
                                }
                                onChange(v);
                            }}
                            prefix="#"
                            maxLength={7}
                        />
                    </Box>
                </Box>
            </Popover>
        </BlockStack>
    );
}

// --- COUPON TEMPLATE PREVIEW ---

function CouponTemplatePreview({ templateKey, config, isActive, onSelect }) {
    const t = config;

    return (
        <div
            style={{
                padding: `${t.padding}px`,
                borderRadius: `${t.borderRadius}px`,
                background: t.bgColor,
                color: t.textColor,
                border: isActive ? "3px solid #0070f3" : "3px solid transparent",
                cursor: "pointer",
                transition: "all 0.2s ease",
                minHeight: "120px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                textAlign: "center",
            }}
            onClick={() => onSelect(templateKey)}
        >
            <div style={{ fontSize: `${t.fontSize}px`, fontWeight: "bold", color: t.textColor, marginBottom: "4px" }}>
                {t.headingText}
            </div>
            <div style={{ fontSize: `${t.fontSize - 3}px`, opacity: 0.7, color: t.textColor, marginBottom: "12px" }}>
                {t.subtextText}
            </div>
            <div
                style={{
                    padding: "6px 14px",
                    background: t.buttonColor,
                    borderRadius: "6px",
                    color: t.buttonTextColor,
                    fontWeight: "bold",
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px"
                }}
            >
                COPY CODE
            </div>
            {isActive && (
                <Box paddingBlockStart="200">
                    <Badge tone="success">Active</Badge>
                </Box>
            )}
        </div>
    );
}

// --- FBT TEMPLATE PREVIEW ---

function FBTTemplatePreview({ templateKey, config, isActive, onSelect }) {
    const t = config;

    return (
        <div
            style={{
                padding: "12px",
                borderRadius: `${t.borderRadius}px`,
                background: t.bgColor,
                border: isActive ? "3px solid #0070f3" : `2px solid ${t.borderColor}`,
                cursor: "pointer",
                transition: "all 0.2s ease",
                position: "relative"
            }}
            onClick={() => onSelect(templateKey)}
        >
            <BlockStack gap="200">
                <Text as="h4" variant="bodyMd" fontWeight="bold">
                    <span style={{ color: t.textColor, fontSize: "14px" }}>Frequently Bought Together</span>
                </Text>
                <InlineStack gap="150" blockAlign="center">
                    {[1, 2, 3].map((i) => (
                        <React.Fragment key={i}>
                            <div
                                style={{
                                    width: "56px",
                                    height: "56px",
                                    background: `${t.borderColor}44`,
                                    borderRadius: "8px",
                                    border: `1px solid ${t.borderColor}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "10px",
                                    color: t.textColor,
                                    opacity: 0.6
                                }}
                            >
                                P{i}
                            </div>
                            {i < 3 && <span style={{ color: t.textColor, opacity: 0.5, fontSize: "14px" }}>+</span>}
                        </React.Fragment>
                    ))}
                </InlineStack>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                    {t.showPrices && (
                        <Text variant="bodySm" fontWeight="bold">
                            <span style={{ color: t.priceColor }}>₹1,499.00</span>
                        </Text>
                    )}
                    {t.showAddAllButton && (
                        <div
                            style={{
                                padding: "4px 10px",
                                background: t.buttonColor,
                                borderRadius: "6px",
                                color: t.buttonTextColor,
                                fontSize: "10px",
                                fontWeight: "700",
                                textTransform: "uppercase"
                            }}
                        >
                            Add All
                        </div>
                    )}
                </div>
            </BlockStack>
            {isActive && (
                <div style={{ position: "absolute", top: "8px", right: "8px" }}>
                    <Badge tone="success" size="small">Active</Badge>
                </div>
            )}
        </div>
    );
}

// --- PRODUCT CARD (shared across interaction styles) ---

function ProductCard({ product, template, interactionType, isSelected, isRequired, quantity, onToggle, onQuantityChange }) {
    const cardBg = isSelected || quantity > 0 ? `${template.buttonColor}10` : `${template.borderColor}22`;
    const cardBorder = isSelected || quantity > 0 ? `${template.buttonColor}44` : `${template.borderColor}44`;

    return (
        <div
            style={{
                width: template.layout === "vertical" ? "100%" : "140px",
                display: "flex",
                flexDirection: template.layout === "vertical" ? "row" : "column",
                alignItems: "center",
                gap: "10px",
                padding: "10px",
                borderRadius: "12px",
                background: cardBg,
                border: `1.5px solid ${cardBorder}`,
                transition: "all 0.2s ease",
                position: "relative",
                overflow: "hidden",
                boxSizing: "border-box",
            }}
        >
            {/* Required badge for bundle */}
            {interactionType === "bundle" && isRequired && (
                <div style={{
                    position: "absolute", top: "-8px", right: "-4px",
                    padding: "2px 6px", borderRadius: "4px",
                    background: template.buttonColor, color: template.buttonTextColor,
                    fontSize: "9px", fontWeight: "700", letterSpacing: "0.5px",
                }}>
                    REQUIRED
                </div>
            )}

            {/* Product image */}
            <div style={{
                width: "60px", height: "60px",
                background: template.borderColor,
                backgroundImage: product.image ? `url(${product.image})` : "none",
                backgroundSize: "cover", backgroundPosition: "center",
                borderRadius: "8px", flexShrink: 0,
            }} />

            {/* Product info */}
            <div style={{
                textAlign: template.layout === "vertical" ? "left" : "center",
                flex: 1, minWidth: 0,
            }}>
                <div style={{
                    color: template.textColor, fontSize: "12px", fontWeight: "600",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    maxWidth: "100%",
                }}>
                    {product.title}
                </div>
                {template.showPrices && (
                    <div style={{ color: template.priceColor, fontSize: "12px", fontWeight: "bold", marginTop: "2px" }}>
                        ₹{parseFloat(product.price).toLocaleString("en-IN")}
                    </div>
                )}
            </div>

            {/* Interaction controls */}
            <div style={{ flexShrink: 0 }}>
                {interactionType === "classic" && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggle(); }}
                        style={{
                            padding: "5px 12px",
                            borderRadius: "6px",
                            border: isSelected ? "none" : `1px solid ${template.buttonColor}`,
                            background: isSelected ? template.buttonColor : "transparent",
                            color: isSelected ? template.buttonTextColor : template.buttonColor,
                            fontSize: "11px", fontWeight: "700",
                            cursor: "pointer", transition: "all 0.2s",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {isSelected ? "Added ✓" : "Add"}
                    </button>
                )}

                {interactionType === "bundle" && (
                    <div
                        onClick={(e) => { e.stopPropagation(); if (!isRequired) onToggle(); }}
                        style={{
                            width: "20px", height: "20px",
                            borderRadius: "4px",
                            border: `2px solid ${isRequired ? template.buttonColor + '66' : template.buttonColor}`,
                            background: isSelected ? template.buttonColor : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: isRequired ? "not-allowed" : "pointer",
                            transition: "all 0.2s", opacity: isRequired ? 0.7 : 1,
                        }}
                    >
                        {isSelected && (
                            <span style={{ color: template.buttonTextColor, fontSize: "12px", fontWeight: "bold" }}>✓</span>
                        )}
                    </div>
                )}

                {interactionType === "quickAdd" && (
                    <>
                        {quantity === 0 ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); onQuantityChange(1); }}
                                style={{
                                    padding: "5px 14px",
                                    borderRadius: "6px",
                                    border: `1px solid ${template.buttonColor}`,
                                    background: "transparent",
                                    color: template.buttonColor,
                                    fontSize: "11px", fontWeight: "700",
                                    cursor: "pointer", transition: "all 0.2s",
                                }}
                            >
                                Add
                            </button>
                        ) : (
                            <div style={{
                                display: "flex", alignItems: "center", gap: "0",
                                borderRadius: "6px", overflow: "hidden",
                                border: `1px solid ${template.buttonColor}`,
                            }}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onQuantityChange(quantity - 1); }}
                                    style={{
                                        width: "26px", height: "26px",
                                        border: "none",
                                        background: template.buttonColor,
                                        color: template.buttonTextColor,
                                        fontSize: "14px", fontWeight: "700",
                                        cursor: "pointer", display: "flex",
                                        alignItems: "center", justifyContent: "center",
                                    }}
                                >
                                    −
                                </button>
                                <span style={{
                                    width: "26px", textAlign: "center",
                                    fontSize: "12px", fontWeight: "700",
                                    color: template.textColor,
                                }}>
                                    {quantity}
                                </span>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onQuantityChange(quantity + 1); }}
                                    style={{
                                        width: "26px", height: "26px",
                                        border: "none",
                                        background: template.buttonColor,
                                        color: template.buttonTextColor,
                                        fontSize: "14px", fontWeight: "700",
                                        cursor: "pointer", display: "flex",
                                        alignItems: "center", justifyContent: "center",
                                    }}
                                >
                                    +
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// --- COUPONS SECTION ---

function CouponsSection({ config, onSave, saving }) {
    // Save coupon history to file
    const saveCouponHistory = (couponId, code, headingText, subtextText) => {
        const fs = window.require ? window.require('fs') : null;
        if (!fs) return;
        const historyPath = 'c:/app_dev/cart-app/coupon-history.json';
        let history = [];
        try {
            history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        } catch (e) { }
        history.push({ couponId, code, headingText, subtextText, timestamp: Date.now() });
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    };
    const shopify = useAppBridge();
    const [activeTemplate, setActiveTemplate] = useState(config?.activeTemplate || "template1");
    const initialTitle = {
        ...(FAKE_COUPON_CONFIG.title || {}),
        ...((config && typeof config === "object" && config.title && typeof config.title === "object") ? config.title : {}),
    };
    const normalizedInitialTitleAlignment = ["left", "center", "right"].includes(initialTitle.alignment)
        ? initialTitle.alignment
        : "left";
    const [sectionTitleText, setSectionTitleText] = useState(initialTitle.text || "Apply Coupon");
    const [sectionTitleFontSize, setSectionTitleFontSize] = useState(
        Number.isFinite(Number(initialTitle.fontSize)) ? Number(initialTitle.fontSize) : 14
    );
    const [sectionTitleTextColor, setSectionTitleTextColor] = useState(initialTitle.textColor || "#111827");
    const [sectionTitleAlignment, setSectionTitleAlignment] = useState(normalizedInitialTitleAlignment);
    const [templates, setTemplates] = useState(config?.templates || FAKE_COUPON_CONFIG.templates);
    const [selectedActiveCoupons, setSelectedActiveCoupons] = useState(() => {
        const raw = (config?.selectedActiveCoupons || []).map(item => typeof item === 'string' ? item : item.id);
        return [...new Set(raw)]; // deduplicate in case of stale duplicate IDs in stored data
    });

    // --- State and Logic ---
    // Option A: per-template coupon overrides — each template owns its coupon styling independently
    const [allTemplateOverrides, setAllTemplateOverrides] = useState(
        config?.allTemplateOverrides || { template1: {}, template2: {}, template3: {} }
    );
    // Derived: active template's overrides (read-only — use setAllTemplateOverrides to update)
    const couponOverrides = allTemplateOverrides[activeTemplate] || {};
    const [previousCouponTexts, setPreviousCouponTexts] = useState({});
    const [activePreviewCouponId, setActivePreviewCouponId] = useState(null);
    const [activeCouponsFromAPI, setActiveCouponsFromAPI] = useState([]);
    const [isLoadingActiveCoupons, setIsLoadingActiveCoupons] = useState(false);
    const [showCouponPickerModal, setShowCouponPickerModal] = useState(false);
    const [tempSelectedCouponIds, setTempSelectedCouponIds] = useState([]);
    const [showLimitWarning, setShowLimitWarning] = useState(false);
    const [displayCondition, setDisplayCondition] = useState(config?.displayCondition || "all");
    const [productHandles, setProductHandles] = useState(config?.productHandles || []);
    const [collectionHandles, setCollectionHandles] = useState(config?.collectionHandles || []);
    const [displayTags, setDisplayTags] = useState(config?.displayTags || []);
    const [handleInput, setHandleInput] = useState("");
    const [collectionInput, setCollectionInput] = useState("");
    const [tagInput, setTagInput] = useState("");
    const [currentlyEditingCouponId, setCurrentlyEditingCouponId] = useState(null);
    const [openSections, setOpenSections] = useState([]);

    // Derived logic for preview
    const previewCouponId = activePreviewCouponId || (selectedActiveCoupons.length > 0 ? selectedActiveCoupons[0] : null);
    const previewCoupon = previewCouponId
        ? activeCouponsFromAPI.find(c => String(c.id) === String(previewCouponId))
        : null;
    const baseTemplate = templates[activeTemplate];
    const activeOverride = activePreviewCouponId ? (couponOverrides[activePreviewCouponId] || {}) : {};

    const effectiveHeading = activeOverride.headingText !== undefined
        ? activeOverride.headingText
        : (previewCoupon ? (previewCoupon.code || previewCoupon.label) : baseTemplate?.headingText);

    const effectiveSubtext = activeOverride.subtextText !== undefined
        ? activeOverride.subtextText
        : (previewCoupon ? (previewCoupon.description || previewCoupon.label) : baseTemplate?.subtextText);

    const currentTemplate = {
        ...(baseTemplate || {}),
        ...activeOverride,
        headingText: effectiveHeading,
        subtextText: effectiveSubtext
    };

    // Helper: update a specific coupon's override field for the currently active template
    const updateCouponOverride = (couponId, field, value) => {
        setPreviousCouponTexts((prevTexts) => {
            const prevOverride = couponOverrides[couponId] || {};
            const prevHeading = prevOverride.headingText !== undefined ? prevOverride.headingText : (previewCoupon ? (previewCoupon.code || previewCoupon.label) : (templates[activeTemplate]?.headingText || ""));
            const prevSubtext = prevOverride.subtextText !== undefined ? prevOverride.subtextText : (previewCoupon ? (previewCoupon.description || previewCoupon.label) : (templates[activeTemplate]?.subtextText || ""));
            const code = previewCoupon ? previewCoupon.code : couponId;
            saveCouponHistory(couponId, code, prevHeading, prevSubtext);
            return {
                ...prevTexts,
                [couponId]: { headingText: prevHeading, subtextText: prevSubtext },
            };
        });
        // Write into the active template's slot only — other templates are untouched
        setAllTemplateOverrides((prev) => ({
            ...prev,
            [activeTemplate]: {
                ...prev[activeTemplate],
                [couponId]: { ...(prev[activeTemplate]?.[couponId] || {}), [field]: value },
            },
        }));
    };

    // Helper: get the effective template for a specific coupon
    const getCouponTemplate = (couponId) => {
        const override = couponOverrides[couponId] || {};
        const tail = couponId.split('/').pop();
        const coupon = activeCouponsFromAPI.find(c =>
            String(c.id) === String(couponId) || c.id.split('/').pop() === tail
        );
        const heading = override.headingText !== undefined
            ? override.headingText
            : (coupon ? (coupon.code || coupon.label) : baseTemplate?.headingText);
        const subtext = override.subtextText !== undefined
            ? override.subtextText
            : (coupon ? (coupon.description || coupon.label) : baseTemplate?.subtextText);
        return {
            ...(baseTemplate || {}),
            ...override,
            headingText: heading,
            subtextText: subtext,
            displayCondition: override.displayCondition || "all",
            productHandles: override.productHandles || [],
            collectionHandles: override.collectionHandles || [],
            displayTags: override.displayTags || [],
        };
    };

    const toggleSection = (sectionId) => {
        setOpenSections(prev =>
            prev.includes(sectionId) ? prev.filter(s => s !== sectionId) : [...prev, sectionId]
        );
    };


    // Fetch active coupons from Shopify Admin API
    useEffect(() => {
        const shouldFetch = (showCouponPickerModal || selectedActiveCoupons.length > 0) && activeCouponsFromAPI.length === 0 && !isLoadingActiveCoupons;

        if (shouldFetch) {
            const fetchActiveCoupons = async () => {
                setIsLoadingActiveCoupons(true);
                try {
                    const response = await fetch('/api/coupons-active');
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const data = await response.json();
                    if (data.coupons && data.coupons.length > 0) {
                        const normalized = data.coupons.map(c => ({
                            id: c.id,
                            code: c.code || c.heading,
                            label: c.heading || c.code,
                            discountType: c.discountType || 'percentage',
                            discountValue: c.discountValue || 0,
                            status: c.status?.toLowerCase() || 'active',
                            source: c.source || 'native'
                        }));
                        setActiveCouponsFromAPI(normalized);
                    } else {
                        setActiveCouponsFromAPI([]);
                    }
                } catch (error) {
                    console.error('[Coupon] Error fetching active coupons:', error);
                    setActiveCouponsFromAPI([]);
                } finally {
                    setIsLoadingActiveCoupons(false);
                }
            };
            fetchActiveCoupons();
        }
    }, [showCouponPickerModal, selectedActiveCoupons.length, activeCouponsFromAPI.length, isLoadingActiveCoupons]);

    // Set default preview and editor coupon if not set
    useEffect(() => {
        if (selectedActiveCoupons.length > 0) {
            if (!activePreviewCouponId) {
                setActivePreviewCouponId(selectedActiveCoupons[0]);
            }
            if (!currentlyEditingCouponId) {
                setCurrentlyEditingCouponId(selectedActiveCoupons[0]);
            }
        } else {
            setActivePreviewCouponId(null);
            setCurrentlyEditingCouponId(null);
        }
    }, [selectedActiveCoupons, activePreviewCouponId, currentlyEditingCouponId]);

    // Handlers for coupon picker modal
    const handleOpenCouponPicker = () => {
        setTempSelectedCouponIds([...selectedActiveCoupons]);
        setShowLimitWarning(false);
        setShowCouponPickerModal(true);
    };

    const handleCouponPickerToggle = (couponId) => {
        setTempSelectedCouponIds(prev => {
            if (prev.includes(couponId)) {
                setShowLimitWarning(false);
                return prev.filter(id => id !== couponId);
            } else {
                if (prev.length >= 6) {
                    setShowLimitWarning(true);
                    return prev;
                }
                return [...prev, couponId];
            }
        });
    };

    const handleCouponPickerAdd = () => {
        setSelectedActiveCoupons([...tempSelectedCouponIds]);
        if (tempSelectedCouponIds.length > 0 && !currentlyEditingCouponId) {
            setCurrentlyEditingCouponId(tempSelectedCouponIds[0]);
            setActivePreviewCouponId(tempSelectedCouponIds[0]);
        }
        setShowCouponPickerModal(false);
    };

    const handleCouponPickerCancel = () => {
        setTempSelectedCouponIds([]);
        setShowCouponPickerModal(false);
    };

    const handleRemoveCoupon = (couponId) => {
        const updated = selectedActiveCoupons.filter(id => id !== couponId);
        setSelectedActiveCoupons(updated);

        // If we were editing the removed coupon, switch to another one
        if (currentlyEditingCouponId === couponId) {
            const nextIdx = selectedActiveCoupons.indexOf(couponId);
            const nextCouponId = updated.length > 0
                ? (updated[nextIdx] || updated[updated.length - 1])
                : null;
            setCurrentlyEditingCouponId(nextCouponId);
            setActivePreviewCouponId(nextCouponId);
        }
    };

    const handleTemplateSelect = (templateKey) => {
        setActiveTemplate(templateKey);
    };

    const updateTemplate = (field, value) => {
        if (activePreviewCouponId) {
            // Apply customization to the specific coupon's override for the active template
            setAllTemplateOverrides(prev => ({
                ...prev,
                [activeTemplate]: {
                    ...prev[activeTemplate],
                    [activePreviewCouponId]: {
                        ...(prev[activeTemplate]?.[activePreviewCouponId] || {}),
                        [field]: value,
                    },
                },
            }));
        } else {
            setTemplates({
                ...templates,
                [activeTemplate]: { ...templates[activeTemplate], [field]: value },
            });
        }
    };

    const handleSave = () => {
        // Block save if coupon API data is still loading
        if (isLoadingActiveCoupons) {
            shopify.toast.show("Loading coupon data, please wait a moment and try again.", { isError: true });
            return;
        }
        // If coupons are selected but API hasn't returned results yet, warn and block
        if (selectedActiveCoupons.length > 0 && activeCouponsFromAPI.length === 0) {
            shopify.toast.show("Coupon data not loaded yet. Please wait for the page to fully load, then save.", { isError: true });
            return;
        }
        // Validate per-coupon display conditions
        for (const couponId of selectedActiveCoupons) {
            const id = typeof couponId === 'string' ? couponId : couponId.id;
            const tpl = getCouponTemplate(id);
            const coupon = activeCouponsFromAPI.find(c => c.id === id);
            const couponName = coupon?.code || coupon?.label || id;

            if (tpl.displayCondition === "product_handle" && (!tpl.productHandles || tpl.productHandles.length === 0)) {
                shopify.toast.show(`"${couponName}": Please add at least one product handle`, { isError: true });
                return;
            }
            if (tpl.displayCondition === "collection_handle" && (!tpl.collectionHandles || tpl.collectionHandles.length === 0)) {
                shopify.toast.show(`"${couponName}": Please add at least one collection handle`, { isError: true });
                return;
            }
            if (tpl.displayCondition === "tag" && (!tpl.displayTags || tpl.displayTags.length === 0)) {
                shopify.toast.show(`"${couponName}": Please add at least one product tag`, { isError: true });
                return;
            }
        }

        // Save only coupon IDs (not full objects) for selectedActiveCoupons
        const couponIds = selectedActiveCoupons.map(item =>
            typeof item === 'string' ? item : item.id
        );

        // Fill in couponCode/headingText/subtextText for the active template's overrides
        // Other templates' overrides are passed through untouched
        const filledActiveOverrides = {};
        couponIds.forEach(couponId => {
            const override = couponOverrides[couponId] || {};
            const couponNumericId = couponId.split('/').pop();
            const coupon = activeCouponsFromAPI.find(c =>
                c.id === couponId || c.id.split('/').pop() === couponNumericId
            );
            const base = templates[activeTemplate] || {};
            filledActiveOverrides[couponId] = {
                ...override,
                couponCode: coupon ? (coupon.code || coupon.label) : (override.couponCode || couponId.split('/').pop()),
                headingText: override.headingText !== undefined ? override.headingText : base.headingText,
                subtextText: override.subtextText !== undefined ? override.subtextText : base.subtextText,
            };
        });

        // Merge filled active overrides into full allTemplateOverrides
        const finalAllTemplateOverrides = {
            ...allTemplateOverrides,
            [activeTemplate]: filledActiveOverrides,
        };

        onSave({
            activeTemplate,
            templateData: templates,
            selectedActiveCoupons: couponIds,
            allTemplateOverrides: finalAllTemplateOverrides,
            title: {
                text: sectionTitleText,
                fontSize: sectionTitleFontSize,
                textColor: sectionTitleTextColor,
                alignment: sectionTitleAlignment,
            },
        });
    };

    const handleDiscard = () => {
        setActiveTemplate(config?.activeTemplate || "template1");
        const discardTitle = {
            ...(FAKE_COUPON_CONFIG.title || {}),
            ...((config && typeof config === "object" && config.title && typeof config.title === "object") ? config.title : {}),
        };
        setSectionTitleText(discardTitle.text || "Apply Coupon");
        setSectionTitleFontSize(Number.isFinite(Number(discardTitle.fontSize)) ? Number(discardTitle.fontSize) : 14);
        setSectionTitleTextColor(discardTitle.textColor || "#111827");
        setSectionTitleAlignment(["left", "center", "right"].includes(discardTitle.alignment) ? discardTitle.alignment : "left");
        setTemplates(config?.templates || FAKE_COUPON_CONFIG.templates);
        setSelectedActiveCoupons(config?.selectedActiveCoupons || []);
        setAllTemplateOverrides(
            config?.allTemplateOverrides || { template1: {}, template2: {}, template3: {} }
        );
        setDisplayCondition(config?.displayCondition || "all");
        setProductHandles(config?.productHandles || []);
        setCollectionHandles(config?.collectionHandles || []);
        setDisplayTags(config?.displayTags || []);
        setHandleInput("");
        setCollectionInput("");
        setTagInput("");
    };

    // --- Display Condition Handlers ---
    const handleAddProductHandle = () => {
        const val = handleInput.trim();
        if (val && !productHandles.includes(val)) {
            setProductHandles([...productHandles, val]);
        }
        setHandleInput("");
    };

    const handleRemoveProductHandle = (handle) => {
        setProductHandles(productHandles.filter(h => h !== handle));
    };

    const handlePickProducts = async () => {
        try {
            const selected = await shopify.resourcePicker({
                type: "product",
                multiple: true,
                filter: { variants: false },
                selectionIds: productHandles.map(h => ({ handle: h })),
            });
            if (selected) {
                const handles = normalizeProductSelection(selected)
                    .map(item => item.handle)
                    .filter(Boolean);
                setProductHandles(handles);
            }
        } catch (e) {
            console.error("Resource picker error:", e);
        }
    };

    const handleAddCollectionHandle = () => {
        const val = collectionInput.trim();
        if (val && !collectionHandles.includes(val)) {
            setCollectionHandles([...collectionHandles, val]);
        }
        setCollectionInput("");
    };

    const handleRemoveCollectionHandle = (handle) => {
        setCollectionHandles(collectionHandles.filter(h => h !== handle));
    };

    const handlePickCollections = async () => {
        try {
            const selected = await shopify.resourcePicker({
                type: "collection",
                multiple: true,
                selectionIds: collectionHandles.map(h => ({ handle: h })),
            });
            if (selected) {
                const handles = selected.map(item => item.handle).filter(Boolean);
                setCollectionHandles(handles);
            }
        } catch (e) {
            console.error("Resource picker error:", e);
        }
    };

    const handleAddTag = () => {
        const val = tagInput.trim();
        if (val && !displayTags.includes(val)) {
            setDisplayTags([...displayTags, val]);
        }
        setTagInput("");
    };

    const handleRemoveTag = (tag) => {
        setDisplayTags(displayTags.filter(t => t !== tag));
    };


    const displayHeading = currentTemplate.headingText;
    const displaySubtext = currentTemplate.subtextText;

    return (
        <BlockStack gap="400">
            {/* Header */}
            <InlineStack gap="200" align="start" blockAlign="center">
                <Icon source={DiscountIcon} tone="primary" />
                <Text as="h2" variant="headingLg">Coupon Templates</Text>
            </InlineStack>

            <Text as="p" tone="subdued">
                Choose and customize a template for displaying coupons on your store.
            </Text>

            {/* Template Selector */}
            <Card>
                <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">Select Template</Text>
                    <InlineStack gap="300">
                        {Object.keys(templates).map((templateKey) => (
                            <Button
                                key={templateKey}
                                pressed={activeTemplate === templateKey}
                                onClick={() => handleTemplateSelect(templateKey)}
                            >
                                {templates[templateKey].name}
                            </Button>
                        ))}
                    </InlineStack>
                </BlockStack>
            </Card>

            {/* Two Column Layout: Fixed Preview (420px), Adaptable Customization (Stable 550px height) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>
                {/* LEFT: Preview */}
                <Card>
                    <div style={{ width: "100%", minHeight: "500px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                        <BlockStack gap="400">
                            {/* Device Switcher Header */}
                            <InlineStack align="space-between" blockAlign="center">
                                <Text as="h3" variant="headingMd">Preview</Text>
                            </InlineStack>

                            {/* Device Container Background */}
                            <div style={{
                                width: "100%",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                padding: "40px 20px",
                                background: "#f6f6f7",
                                borderRadius: "12px",
                                minHeight: "350px",
                                position: "relative"
                            }}>
                                {/* Single Card Preview (Old UI) */}
                                <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                                    <div style={{ width: "100%", maxWidth: "450px" }}>
                                        <div style={{ textAlign: sectionTitleAlignment, marginBottom: "12px" }}>
                                            <div
                                                style={{
                                                    fontSize: `${sectionTitleFontSize}px`,
                                                    fontWeight: 700,
                                                    color: sectionTitleTextColor,
                                                }}
                                            >
                                                {sectionTitleText}
                                            </div>
                                        </div>
                                        {activeTemplate === "template1" && (
                                            <div style={{
                                                backgroundColor: currentTemplate.bgColor,
                                                borderRadius: `${currentTemplate.borderRadius || 6}px`,
                                                padding: `${(currentTemplate.padding || 12) + 10}px ${(currentTemplate.padding || 16) + 14}px`,
                                                borderLeft: `5px solid ${currentTemplate.accentColor}`,
                                                boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                                                display: "flex",
                                                flexDirection: "row",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                gap: "12px"
                                            }}>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div style={{ fontWeight: 800, fontSize: `${(currentTemplate.fontSize || 13) + 4}px`, color: currentTemplate.textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentTemplate.headingText}</div>
                                                    <div style={{ fontSize: `${(currentTemplate.fontSize || 13) - 1}px`, opacity: 0.55, color: currentTemplate.textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentTemplate.subtextText}</div>
                                                </div>
                                                <button style={{
                                                    backgroundColor: currentTemplate.buttonColor,
                                                    color: currentTemplate.buttonTextColor,
                                                    border: "none",
                                                    padding: "10px 24px",
                                                    borderRadius: `${currentTemplate.borderRadius || 6}px`,
                                                    fontSize: "13px",
                                                    fontWeight: 700,
                                                    flexShrink: 0
                                                }}>Copy Code</button>
                                            </div>
                                        )}

                                        {activeTemplate === "template2" && (
                                            <div style={{
                                                position: "relative",
                                                display: "flex",
                                                flexDirection: "row",
                                                width: "100%",
                                                backgroundColor: currentTemplate.bgColor,
                                                borderRadius: `${currentTemplate.borderRadius || 6}px`,
                                                overflow: "hidden",
                                                boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
                                                minHeight: "160px"
                                            }}>
                                                <div style={{ position: "absolute", width: "20px", height: "20px", backgroundColor: "#fff", borderRadius: "50%", left: "-10px", top: "50%", transform: "translateY(-50%)", zIndex: 2 }} />
                                                <div style={{ position: "absolute", width: "20px", height: "20px", backgroundColor: "#fff", borderRadius: "50%", right: "-10px", top: "50%", transform: "translateY(-50%)", zIndex: 2 }} />
                                                <div style={{ width: "35%", backgroundColor: `${currentTemplate.accentColor}08`, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "20px" }}>
                                                    <div style={{ fontSize: "10px", fontWeight: 700, opacity: 0.6, textTransform: "uppercase", letterSpacing: "2px", color: currentTemplate.accentColor, marginBottom: "8px" }}>Your Code</div>
                                                    <div style={{ fontSize: "18px", fontWeight: 900, fontFamily: "monospace", letterSpacing: "2px", color: currentTemplate.accentColor }}>{previewCoupon?.code || "CODE"}</div>
                                                </div>
                                                <div style={{ width: "0px", borderLeft: `2px dashed ${currentTemplate.accentColor}25`, margin: "16px 0" }} />
                                                <div style={{ flex: 1, padding: `${(currentTemplate.padding || 12) + 8}px ${(currentTemplate.padding || 16) + 14}px`, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
                                                    <div style={{ fontSize: `${(currentTemplate.fontSize || 13) + 3}px`, fontWeight: 800, color: currentTemplate.textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentTemplate.headingText}</div>
                                                    <div style={{ fontSize: `${(currentTemplate.fontSize || 13) - 1}px`, opacity: 0.5, marginBottom: "14px", color: currentTemplate.textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentTemplate.subtextText}</div>
                                                    <button style={{
                                                        backgroundColor: currentTemplate.buttonColor,
                                                        color: currentTemplate.buttonTextColor,
                                                        border: "none",
                                                        padding: "9px 24px",
                                                        borderRadius: `${currentTemplate.borderRadius || 6}px`,
                                                        fontSize: "12px",
                                                        fontWeight: 700,
                                                        alignSelf: "start"
                                                    }}>Redeem Now</button>
                                                </div>
                                            </div>
                                        )}

                                        {activeTemplate === "template3" && (
                                            <div style={{
                                                width: "100%",
                                                backgroundColor: currentTemplate.bgColor,
                                                borderRadius: `${currentTemplate.borderRadius || 6}px`,
                                                padding: `${(currentTemplate.padding || 12) + 6}px ${(currentTemplate.padding || 16) + 12}px`,
                                                display: "flex",
                                                flexDirection: "column",
                                                boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                                                border: `1px solid ${currentTemplate.accentColor}15`
                                            }}>
                                                <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "12px" }}>
                                                    <div style={{ width: "42px", height: "42px", borderRadius: "10px", backgroundColor: `${currentTemplate.accentColor}12`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ fontSize: "20px" }}>🏷️</span></div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontSize: `${(currentTemplate.fontSize || 13) + 1}px`, fontWeight: 700, color: currentTemplate.textColor, lineHeight: 1.3, marginBottom: "4px" }}>{currentTemplate.headingText}</div>
                                                        <div style={{ fontSize: `${(currentTemplate.fontSize || 13) - 2}px`, opacity: 0.5, color: currentTemplate.textColor }}>{currentTemplate.subtextText}</div>
                                                    </div>
                                                </div>
                                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                    <div style={{ padding: "6px 14px", borderRadius: "6px", border: `1.5px dashed ${currentTemplate.accentColor}55`, color: currentTemplate.accentColor, fontSize: "12px", fontWeight: 700, fontFamily: "monospace", letterSpacing: "1.5px", flex: 1, textAlign: "center" }}>{previewCoupon?.code || "CODE"}</div>
                                                    <button style={{
                                                        backgroundColor: currentTemplate.buttonColor,
                                                        color: currentTemplate.buttonTextColor,
                                                        border: "none",
                                                        padding: "8px 20px",
                                                        borderRadius: `${currentTemplate.borderRadius || 6}px`,
                                                        fontSize: "12px",
                                                        fontWeight: 700,
                                                        flexShrink: 0
                                                    }}>Apply</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Template Badge */}
                            <div style={{ marginTop: "16px" }}>
                                <Badge tone="success">{currentTemplate.name}</Badge>
                            </div>
                        </BlockStack>
                    </div>
                </Card>

                {/* RIGHT: Customization */}
                < Card >
                    <div style={{ height: "550px", overflowY: "auto", position: "relative" }}>
                        <BlockStack gap="300">
                            <Text as="h3" variant="headingMd">Customize: {currentTemplate.name}</Text>

                            <Divider />

                            {/* Section Title (Collapsible) */}
                            <BlockStack gap="200">
                                <div
                                    onClick={() => toggleSection("sectionTitle")}
                                    style={{
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        width: "100%",
                                        padding: "8px 0",
                                    }}
                                >
                                    <Text variant="headingSm" as="h4" fontWeight="semibold">
                                        <InlineStack gap="100" blockAlign="center">
                                            <Icon source={MagicIcon} tone="base" />
                                            Section Title
                                        </InlineStack>
                                    </Text>
                                    <div style={{ marginLeft: "auto" }}>
                                        <Icon
                                            source={openSections.includes("sectionTitle") ? ChevronUpIcon : ChevronDownIcon}
                                            tone="base"
                                        />
                                    </div>
                                </div>
                                {openSections.includes("sectionTitle") && (
                                    <div style={{ paddingBottom: "16px" }}>
                                        <BlockStack gap="200">
                                            <TextField
                                                label="Title"
                                                value={sectionTitleText}
                                                onChange={setSectionTitleText}
                                                placeholder="Apply Coupon"
                                            />
                                            <RangeSlider
                                                label={`Font Size: ${sectionTitleFontSize}px`}
                                                value={sectionTitleFontSize}
                                                onChange={setSectionTitleFontSize}
                                                min={10}
                                                max={40}
                                                output
                                            />
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                                <Select
                                                    label="Alignment"
                                                    options={[
                                                        { label: "Left", value: "left" },
                                                        { label: "Center", value: "center" },
                                                        { label: "Right", value: "right" },
                                                    ]}
                                                    value={sectionTitleAlignment}
                                                    onChange={setSectionTitleAlignment}
                                                />
                                                <ColorPickerField
                                                    label="Text Color"
                                                    value={sectionTitleTextColor}
                                                    onChange={setSectionTitleTextColor}
                                                />
                                            </div>
                                        </BlockStack>
                                    </div>
                                )}
                            </BlockStack>

                            <Divider />

                            {/* Header: Select & Switching (Restructured based on format) */}
                            <BlockStack gap="400">
                                {selectedActiveCoupons.length > 0 && (
                                    <BlockStack gap="100">
                                        <Text variant="bodySm" fontWeight="medium" tone="subdued">Customize Coupon</Text>
                                        <InlineStack gap="200" blockAlign="center">
                                            <div style={{ flex: 1 }}>
                                                <Select
                                                    label="Customize Coupon"
                                                    labelHidden
                                                    options={selectedActiveCoupons.map(id => ({
                                                        // Priority: live API code → stored couponCode override → last numeric segment of GID
                                                        label: activeCouponsFromAPI.find(c => String(c.id) === String(id))?.code
                                                            || couponOverrides[id]?.couponCode
                                                            || id.split('/').pop(),
                                                        value: id
                                                    }))}
                                                    value={currentlyEditingCouponId}
                                                    onChange={(v) => {
                                                        setCurrentlyEditingCouponId(v);
                                                        setActivePreviewCouponId(v);
                                                    }}
                                                />
                                            </div>
                                            <Button
                                                variant="secondary"
                                                tone="critical"
                                                onClick={() => handleRemoveCoupon(currentlyEditingCouponId)}
                                                icon={XSmallIcon}
                                            >
                                                Remove
                                            </Button>
                                        </InlineStack>
                                    </BlockStack>
                                )}

                                <InlineStack gap="300" blockAlign="center">
                                    <Button onClick={handleOpenCouponPicker} variant="secondary">
                                        Select Coupons
                                    </Button>
                                    {selectedActiveCoupons.length > 0 && (
                                        <Badge tone="success">
                                            {selectedActiveCoupons.length} selected
                                        </Badge>
                                    )}
                                </InlineStack>
                            </BlockStack>


                            {/* No coupons selected message */}
                            {selectedActiveCoupons.length === 0 && (
                                <Banner tone="info">
                                    <p>Select coupons above to customize their appearance individually.</p>
                                </Banner>
                            )}

                            {/* --- Coupon Editor --- */}
                            {selectedActiveCoupons.length > 0 && (
                                <div style={{ border: "1px solid #e3e3e3", borderRadius: "12px", overflow: "hidden" }}>

                                    {/* Editor Content */}
                                    {currentlyEditingCouponId && (() => {
                                        const couponId = currentlyEditingCouponId;
                                        const couponNumericTail = couponId.split('/').pop();
                                        // Match by full ID or numeric tail to handle GID slash variants
                                        const coupon = activeCouponsFromAPI.find(c =>
                                            String(c.id) === String(couponId) ||
                                            c.id.split('/').pop() === couponNumericTail
                                        );
                                        // Show editor even if API hasn't loaded yet — use stored override data
                                        const couponTpl = getCouponTemplate(couponId);

                                        return (
                                            <div style={{ padding: "20px", background: "#fff" }}>
                                                <BlockStack gap="400">
                                                    {/* Display Condition Section */}
                                                    <BlockStack gap="200">
                                                        <div
                                                            onClick={() => toggleSection("conditions")}
                                                            style={{
                                                                cursor: "pointer",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "space-between",
                                                                width: "100%",
                                                                padding: "8px 0"
                                                            }}
                                                        >
                                                            <Text variant="headingSm" as="h4" fontWeight="semibold">
                                                                <InlineStack gap="100" blockAlign="center">
                                                                    <Icon source={SettingsIcon} tone="base" />
                                                                    Display Condition
                                                                </InlineStack>
                                                            </Text>
                                                            <div style={{ marginLeft: "auto" }}>
                                                                <Icon source={openSections.includes("conditions") ? ChevronUpIcon : ChevronDownIcon} tone="base" />
                                                            </div>
                                                        </div>
                                                        {openSections.includes("conditions") && (
                                                            <div style={{ paddingBottom: "16px" }}>
                                                                <BlockStack gap="200">
                                                                    <Select
                                                                        label="Show this coupon on"
                                                                        options={[
                                                                            { label: "All pages", value: "all" },
                                                                            { label: "Specific product pages", value: "product_handle" },
                                                                            { label: "Specific collection pages", value: "collection_handle" },
                                                                            { label: "Products with specific tags", value: "tag" },
                                                                        ]}
                                                                        value={couponTpl.displayCondition}
                                                                        onChange={(v) => updateCouponOverride(couponId, "displayCondition", v)}
                                                                    />
                                                                    {couponTpl.displayCondition === "product_handle" && (
                                                                        <BlockStack gap="200">
                                                                            <InlineStack gap="200" blockAlign="end">
                                                                                <div style={{ flex: 1 }}>
                                                                                    <TextField
                                                                                        label="Product Handle"
                                                                                        value={handleInput}
                                                                                        onChange={setHandleInput}
                                                                                        placeholder="e.g. classic-leather-bag"
                                                                                        onKeyPress={(e) => {
                                                                                            if (e.key === "Enter" && handleInput.trim()) {
                                                                                                const current = couponTpl.productHandles || [];
                                                                                                if (!current.includes(handleInput.trim())) {
                                                                                                    updateCouponOverride(couponId, "productHandles", [...current, handleInput.trim()]);
                                                                                                }
                                                                                                setHandleInput("");
                                                                                            }
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                                <Button
                                                                                    onClick={() => {
                                                                                        if (handleInput.trim()) {
                                                                                            const current = couponTpl.productHandles || [];
                                                                                            if (!current.includes(handleInput.trim())) {
                                                                                                updateCouponOverride(couponId, "productHandles", [...current, handleInput.trim()]);
                                                                                            }
                                                                                            setHandleInput("");
                                                                                        }
                                                                                    }}
                                                                                    disabled={!handleInput.trim()}
                                                                                >Add</Button>
                                                                                <Button
                                                                                    variant="secondary"
                                                                                    onClick={async () => {
                                                                                        try {
                                                                                            const selected = await window.shopify.resourcePicker({
                                                                                                type: "product",
                                                                                                multiple: true,
                                                                                                action: "select",
                                                                                                filter: { variants: false },
                                                                                            });
                                                                                            if (selected && selected.length > 0) {
                                                                                                const current = couponTpl.productHandles || [];
                                                                                                const newHandles = normalizeProductSelection(selected)
                                                                                                    .map(p => p.handle)
                                                                                                    .filter(Boolean)
                                                                                                    .filter(h => !current.includes(h));
                                                                                                if (newHandles.length > 0) {
                                                                                                    updateCouponOverride(couponId, "productHandles", [...current, ...newHandles]);
                                                                                                }
                                                                                            }
                                                                                        } catch (e) { console.error("Product picker error:", e); }
                                                                                    }}
                                                                                >Browse Products</Button>
                                                                            </InlineStack>
                                                                            {(couponTpl.productHandles || []).length > 0 && (
                                                                                <InlineStack gap="200" wrap>
                                                                                    {(couponTpl.productHandles || []).map(handle => (
                                                                                        <Tag key={handle} onRemove={() => {
                                                                                            updateCouponOverride(couponId, "productHandles",
                                                                                                (couponTpl.productHandles || []).filter(h => h !== handle));
                                                                                        }}>
                                                                                            {handle}
                                                                                        </Tag>
                                                                                    ))}
                                                                                </InlineStack>
                                                                            )}
                                                                        </BlockStack>
                                                                    )}
                                                                    {couponTpl.displayCondition === "tag" && (
                                                                        <BlockStack gap="200">
                                                                            <InlineStack gap="200" blockAlign="end">
                                                                                <div style={{ flex: 1 }}>
                                                                                    <TextField
                                                                                        label="Target Product Tags"
                                                                                        value={tagInput}
                                                                                        onChange={setTagInput}
                                                                                        placeholder="e.g. VIP, summer"
                                                                                        onKeyPress={(e) => {
                                                                                            if (e.key === "Enter" && tagInput.trim()) {
                                                                                                const current = couponTpl.tags || [];
                                                                                                if (!current.includes(tagInput.trim())) {
                                                                                                    updateCouponOverride(couponId, "tags", [...current, tagInput.trim()]);
                                                                                                }
                                                                                                setTagInput("");
                                                                                            }
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                                <Button
                                                                                    onClick={() => {
                                                                                        if (tagInput.trim()) {
                                                                                            const current = couponTpl.tags || [];
                                                                                            if (!current.includes(tagInput.trim())) {
                                                                                                updateCouponOverride(couponId, "tags", [...current, tagInput.trim()]);
                                                                                            }
                                                                                            setTagInput("");
                                                                                        }
                                                                                    }}
                                                                                    disabled={!tagInput.trim()}
                                                                                >Add</Button>
                                                                            </InlineStack>
                                                                            {(couponTpl.tags || []).length > 0 && (
                                                                                <InlineStack gap="200" wrap>
                                                                                    {(couponTpl.tags || []).map(tag => (
                                                                                        <Tag key={tag} onRemove={() => {
                                                                                            updateCouponOverride(couponId, "tags",
                                                                                                (couponTpl.tags || []).filter(t => t !== tag));
                                                                                        }}>
                                                                                            {tag}
                                                                                        </Tag>
                                                                                    ))}
                                                                                </InlineStack>
                                                                            )}
                                                                        </BlockStack>
                                                                    )}
                                                                    {couponTpl.displayCondition === "collection_handle" && (
                                                                        <BlockStack gap="200">
                                                                            <InlineStack gap="200" blockAlign="end">
                                                                                <div style={{ flex: 1 }}>
                                                                                    <TextField
                                                                                        label="Collection Handle"
                                                                                        value={collectionInput}
                                                                                        onChange={setCollectionInput}
                                                                                        placeholder="e.g. summer-sale"
                                                                                        onKeyPress={(e) => {
                                                                                            if (e.key === "Enter" && collectionInput.trim()) {
                                                                                                const current = couponTpl.collectionHandles || [];
                                                                                                if (!current.includes(collectionInput.trim())) {
                                                                                                    updateCouponOverride(couponId, "collectionHandles", [...current, collectionInput.trim()]);
                                                                                                }
                                                                                                setCollectionInput("");
                                                                                            }
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                                <Button
                                                                                    onClick={() => {
                                                                                        if (collectionInput.trim()) {
                                                                                            const current = couponTpl.collectionHandles || [];
                                                                                            if (!current.includes(collectionInput.trim())) {
                                                                                                updateCouponOverride(couponId, "collectionHandles", [...current, collectionInput.trim()]);
                                                                                            }
                                                                                            setCollectionInput("");
                                                                                        }
                                                                                    }}
                                                                                    disabled={!collectionInput.trim()}
                                                                                >Add</Button>
                                                                                <Button
                                                                                    variant="secondary"
                                                                                    onClick={async () => {
                                                                                        try {
                                                                                            const selected = await window.shopify.resourcePicker({
                                                                                                type: "collection",
                                                                                                multiple: true,
                                                                                                action: "select"
                                                                                            });
                                                                                            if (selected && selected.length > 0) {
                                                                                                const current = couponTpl.collectionHandles || [];
                                                                                                const newHandles = selected.map(c => c.handle).filter(h => !current.includes(h));
                                                                                                if (newHandles.length > 0) {
                                                                                                    updateCouponOverride(couponId, "collectionHandles", [...current, ...newHandles]);
                                                                                                }
                                                                                            }
                                                                                        } catch (e) { console.error("Collection picker error:", e); }
                                                                                    }}
                                                                                >Browse Collections</Button>
                                                                            </InlineStack>
                                                                            {(couponTpl.collectionHandles || []).length > 0 && (
                                                                                <InlineStack gap="200" wrap>
                                                                                    {(couponTpl.collectionHandles || []).map(handle => (
                                                                                        <Tag key={handle} onRemove={() => {
                                                                                            updateCouponOverride(couponId, "collectionHandles",
                                                                                                (couponTpl.collectionHandles || []).filter(h => h !== handle));
                                                                                        }}>
                                                                                            {handle}
                                                                                        </Tag>
                                                                                    ))}
                                                                                </InlineStack>
                                                                            )}
                                                                        </BlockStack>
                                                                    )}
                                                                </BlockStack>
                                                            </div>
                                                        )}
                                                    </BlockStack>

                                                    <Divider />

                                                    {/* Text Content Section */}
                                                    <BlockStack gap="200">
                                                        <div
                                                            onClick={() => toggleSection("text")}
                                                            style={{
                                                                cursor: "pointer",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "space-between",
                                                                width: "100%",
                                                                padding: "8px 0"
                                                            }}
                                                        >
                                                            <Text variant="headingSm" as="h4" fontWeight="semibold">
                                                                <InlineStack gap="100" blockAlign="center">
                                                                    <Icon source={MagicIcon} tone="base" />
                                                                    Text Content
                                                                </InlineStack>
                                                            </Text>
                                                            <div style={{ marginLeft: "auto" }}>
                                                                <Icon source={openSections.includes("text") ? ChevronUpIcon : ChevronDownIcon} tone="base" />
                                                            </div>
                                                        </div>
                                                        {openSections.includes("text") && (
                                                            <div style={{ paddingBottom: "16px" }}>
                                                                <BlockStack gap="200">
                                                                    <TextField
                                                                        label="Heading Text"
                                                                        value={couponTpl.headingText}
                                                                        onChange={(v) => updateCouponOverride(couponId, "headingText", v)}
                                                                    />
                                                                    <TextField
                                                                        label="Subtext"
                                                                        value={couponTpl.subtextText}
                                                                        onChange={(v) => updateCouponOverride(couponId, "subtextText", v)}
                                                                    />
                                                                </BlockStack>
                                                            </div>
                                                        )}
                                                    </BlockStack>

                                                    <Divider />

                                                    {/* Design & Colors Section */}
                                                    <BlockStack gap="200">
                                                        <div
                                                            onClick={() => toggleSection("design")}
                                                            style={{
                                                                cursor: "pointer",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "space-between",
                                                                width: "100%",
                                                                padding: "8px 0"
                                                            }}
                                                        >
                                                            <Text variant="headingSm" as="h4" fontWeight="semibold">
                                                                <InlineStack gap="100" blockAlign="center">
                                                                    <Icon source={ColorIcon} tone="base" />
                                                                    Design & Colors
                                                                </InlineStack>
                                                            </Text>
                                                            <div style={{ marginLeft: "auto" }}>
                                                                <Icon source={openSections.includes("design") ? ChevronUpIcon : ChevronDownIcon} tone="base" />
                                                            </div>
                                                        </div>
                                                        {openSections.includes("design") && (
                                                            <div style={{ paddingBottom: "16px" }}>
                                                                <BlockStack gap="400">
                                                                    {/* Colors Grid */}
                                                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                                                        <ColorPickerField
                                                                            label="Background"
                                                                            value={couponTpl.bgColor}
                                                                            onChange={(v) => updateCouponOverride(couponId, "bgColor", v)}
                                                                        />
                                                                        <ColorPickerField
                                                                            label="Text Color"
                                                                            value={couponTpl.textColor}
                                                                            onChange={(v) => updateCouponOverride(couponId, "textColor", v)}
                                                                        />
                                                                        <ColorPickerField
                                                                            label="Accent"
                                                                            value={couponTpl.accentColor}
                                                                            onChange={(v) => updateCouponOverride(couponId, "accentColor", v)}
                                                                        />
                                                                        <ColorPickerField
                                                                            label="Button Color"
                                                                            value={couponTpl.buttonColor}
                                                                            onChange={(v) => updateCouponOverride(couponId, "buttonColor", v)}
                                                                        />
                                                                        <ColorPickerField
                                                                            label="Button Text"
                                                                            value={couponTpl.buttonTextColor}
                                                                            onChange={(v) => updateCouponOverride(couponId, "buttonTextColor", v)}
                                                                        />
                                                                    </div>

                                                                    <Divider />

                                                                    {/* Styling Sliders */}
                                                                    <BlockStack gap="200">
                                                                        <RangeSlider
                                                                            label={`Border Radius: ${couponTpl.borderRadius}px`}
                                                                            value={couponTpl.borderRadius}
                                                                            onChange={(v) => updateCouponOverride(couponId, "borderRadius", v)}
                                                                            min={0}
                                                                            max={24}
                                                                            output
                                                                        />
                                                                        <RangeSlider
                                                                            label={`Font Size: ${couponTpl.fontSize}px`}
                                                                            value={couponTpl.fontSize}
                                                                            onChange={(v) => updateCouponOverride(couponId, "fontSize", v)}
                                                                            min={12}
                                                                            max={24}
                                                                            output
                                                                        />
                                                                        <RangeSlider
                                                                            label={`Padding: ${couponTpl.padding}px`}
                                                                            value={couponTpl.padding}
                                                                            onChange={(v) => updateCouponOverride(couponId, "padding", v)}
                                                                            min={8}
                                                                            max={32}
                                                                            output
                                                                        />
                                                                    </BlockStack>
                                                                </BlockStack>
                                                            </div>
                                                        )}
                                                    </BlockStack>
                                                </BlockStack>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </BlockStack>
                    </div>
                </Card >
            </div >

            <InlineStack align="end" gap="200">
                <Button onClick={handleDiscard}>
                    Discard
                </Button>
                <Button variant="primary" onClick={handleSave} loading={saving}>
                    Save
                </Button>
            </InlineStack>

            {/* Coupon Picker Modal */}
            <Modal
                open={showCouponPickerModal}
                onClose={handleCouponPickerCancel}
                title="Select App Coupons"
                primaryAction={{
                    content: `Add${tempSelectedCouponIds.length > 0 ? ` (${tempSelectedCouponIds.length})` : ''}`,
                    onAction: handleCouponPickerAdd,
                }}
                secondaryActions={[
                    {
                        content: 'Cancel',
                        onAction: handleCouponPickerCancel,
                    },
                ]}
            >
                <Modal.Section>
                    {/* Loading State */}
                    {isLoadingActiveCoupons && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
                            <BlockStack gap="200" inlineAlign="center">
                                <Spinner size="small" />
                                <Text tone="subdued" variant="bodySm">Fetching coupons...</Text>
                            </BlockStack>
                        </div>
                    )}

                    {/* No App Coupons found */}
                    {!isLoadingActiveCoupons && activeCouponsFromAPI.length === 0 && (
                        <Banner tone="info">
                            <p>No discount codes were found in your store. Please create one in Shopify Admin → Discounts first.</p>
                        </Banner>
                    )}

                    {/* Limit Warning */}
                    {showLimitWarning && (
                        <Box paddingBlockEnd="300">
                            <Banner tone="warning" onDismiss={() => setShowLimitWarning(false)}>
                                <p>You can only select a maximum of 6 coupons.</p>
                            </Banner>
                        </Box>
                    )}

                    {/* Active Coupons List with Checkboxes */}
                    {!isLoadingActiveCoupons && activeCouponsFromAPI.length > 0 && (
                        <BlockStack gap="200">
                            <Text variant="bodySm" tone="subdued">
                                Select active coupons to display in the product widget
                            </Text>
                            {activeCouponsFromAPI.map(coupon => {
                                const isChecked = tempSelectedCouponIds.includes(coupon.id);
                                const isDisabled = !isChecked && tempSelectedCouponIds.length >= 6;
                                return (
                                    <div
                                        key={coupon.id}
                                        onClick={() => !isDisabled && handleCouponPickerToggle(coupon.id)}
                                        style={{
                                            padding: '12px 16px',
                                            backgroundColor: isChecked ? '#f0f7ff' : isDisabled ? '#f4f4f4' : '#f9fafb',
                                            border: `1px solid ${isChecked ? '#2c6ecb' : '#e5e7eb'}`,
                                            borderRadius: '8px',
                                            transition: 'all 0.2s',
                                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                                            opacity: isDisabled ? 0.6 : 1,
                                        }}
                                    >
                                        <InlineStack align="space-between" blockAlign="center" gap="200">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    width: '36px', height: '36px', borderRadius: '8px',
                                                    backgroundColor: '#dcfce7', display: 'flex',
                                                    alignItems: 'center', justifyContent: 'center', fontSize: '16px',
                                                }}>
                                                    {coupon.discountType === 'percentage' ? '🏷️' :
                                                        coupon.discountType === 'free_shipping' ? '🚚' : '💰'}
                                                </div>
                                                <BlockStack gap="100">
                                                    <InlineStack gap="200" blockAlign="center">
                                                        <Text variant="bodyMd" fontWeight="semibold" truncate>{coupon.code}</Text>
                                                        <Badge tone="info" size="small">{coupon.discountType.replace('_', ' ')}</Badge>
                                                        <Badge tone={coupon.status === 'active' ? 'success' : 'warning'} size="small">{coupon.status}</Badge>
                                                    </InlineStack>
                                                    <Text variant="bodySm" tone="subdued" truncate>
                                                        {coupon.label} — {coupon.discountType === 'percentage'
                                                            ? `${coupon.discountValue}% off`
                                                            : coupon.discountType === 'free_shipping'
                                                                ? 'Free Shipping'
                                                                : `₹${coupon.discountValue} off`}
                                                    </Text>
                                                </BlockStack>
                                            </div>
                                            <Checkbox
                                                checked={isChecked}
                                                disabled={isDisabled}
                                                onChange={() => handleCouponPickerToggle(coupon.id)}
                                            />
                                        </InlineStack>
                                    </div>
                                );
                            })}
                        </BlockStack>
                    )}
                </Modal.Section>
            </Modal>
        </BlockStack >
    );
}

// --- FBT SECTION ---

function FBTSection({ config, products, onSave, saving }) {
    const shopify = useAppBridge();
    const [activeTemplate, setActiveTemplate] = useState(config?.activeTemplate || "fbt1");
    const [templates, setTemplates] = useState(config?.templates || FAKE_FBT_CONFIG.templates);
    const [mode, setMode] = useState(config?.mode || "manual");
    const [manualRules, setManualRules] = useState(config?.manualRules || []);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState(null);
    const [aiProductCount, setAiProductCount] = useState(() => {
        const raw = Number.parseInt(config?.aiSettings?.aiProductCount ?? config?.aiSettings?.maxSuggestions, 10);
        return String(Number.isFinite(raw) ? Math.min(10, Math.max(1, raw)) : 3);
    });
    const [simulatedTriggerId, setSimulatedTriggerId] = useState("");

    // --- New display scope state ---
    const [displayScope, setDisplayScope] = useState("all");
    const [scopeTriggerProducts, setScopeTriggerProducts] = useState([]);
    const [ruleFbtProducts, setRuleFbtProducts] = useState([]);

    // --- Interaction state for preview ---
    const [selectedProductIds, setSelectedProductIds] = useState(new Set());
    const [productQuantities, setProductQuantities] = useState({});

    const handleModeChange = useCallback((value) => {
        setMode(value[0]);
    }, []);

    const updateTemplate = (field, value) => {
        setTemplates({
            ...templates,
            [activeTemplate]: { ...templates[activeTemplate], [field]: value },
        });
    };

    // --- Shopify Resource Picker handlers ---
    const handlePickTriggerProducts = async () => {
        try {
            const selected = await shopify.resourcePicker({
                type: "product",
                multiple: displayScope === "per_product",
                filter: { variants: false },
                selectionIds: scopeTriggerProducts.map(p => ({ id: p.id })),
            });
            if (selected) {
                const mapped = normalizeProductSelection(selected).map(item => ({
                    id: item.id,
                    title: item.title,
                    image: item.image,
                    handle: item.handle,
                }));
                setScopeTriggerProducts(mapped);
            }
        } catch (e) {
            console.error("Resource picker error:", e);
        }
    };

    const handlePickFbtProducts = async () => {
        try {
            const selected = await shopify.resourcePicker({
                type: "product",
                multiple: true,
                filter: { variants: false },
                selectionIds: ruleFbtProducts.map(p => ({ id: p.id })),
            });
            if (selected) {
                const mapped = normalizeProductSelection(selected).map(item => ({
                    id: item.id,
                    title: item.title,
                    image: item.image,
                    price: item.price || "0.00",
                    handle: item.handle || "",
                    variantId: item.variantId || "",
                }));
                setRuleFbtProducts(mapped);
            }
        } catch (e) {
            console.error("Resource picker error:", e);
        }
    };

    const handleRemoveTriggerProduct = (productId) => {
        setScopeTriggerProducts(prev => prev.filter(p => p.id !== productId));
    };

    const handleRemoveFbtProduct = (productId) => {
        setRuleFbtProducts(prev => prev.filter(p => p.id !== productId));
    };

    const handleAddRule = () => {
        if (ruleFbtProducts.length === 0) return;
        if (displayScope !== "all" && scopeTriggerProducts.length === 0) return;

        // For "single" scope, replace any existing rule
        if (displayScope === "single") {
            const existingSingle = manualRules.findIndex(r => r.displayScope === "single");
            if (existingSingle >= 0) {
                const updated = [...manualRules];
                updated[existingSingle] = {
                    ...updated[existingSingle],
                    triggerProducts: scopeTriggerProducts,
                    fbtProducts: ruleFbtProducts,
                };
                setManualRules(updated);
                setScopeTriggerProducts([]);
                setRuleFbtProducts([]);
                return;
            }
        }

        const newRule = {
            id: `rule-${Date.now()}`,
            displayScope,
            triggerProducts: displayScope === "all" ? [] : scopeTriggerProducts,
            fbtProducts: ruleFbtProducts,
        };

        setManualRules([...manualRules, newRule]);
        setScopeTriggerProducts([]);
        setRuleFbtProducts([]);
    };

    const handleRemoveRule = (ruleId) => {
        setManualRules(manualRules.filter((r) => r.id !== ruleId));
    };

    const getRulesToSave = () => {
        // Always include manualRules — AI-accepted suggestions are stored there too
        let rulesToSave = [...manualRules];

        // Auto-save pending selection if valid
        const hasPendingFbt = ruleFbtProducts.length > 0;
        const hasPendingTrigger = scopeTriggerProducts.length > 0;
        const isAllScope = displayScope === "all";

        let pendingRule = null;

        if (hasPendingFbt) {
            if (isAllScope) {
                pendingRule = {
                    id: `rule-auto-${Date.now()}`,
                    displayScope: "all",
                    triggerProducts: [],
                    fbtProducts: ruleFbtProducts,
                };
            } else if (hasPendingTrigger) {
                pendingRule = {
                    id: `rule-auto-${Date.now()}`,
                    displayScope,
                    triggerProducts: scopeTriggerProducts,
                    fbtProducts: ruleFbtProducts,
                };
            }
        }

        if (pendingRule) {
            if (displayScope === "single") {
                // Remove existing single rule and add new one
                rulesToSave = rulesToSave.filter(r => r.displayScope !== "single");
                rulesToSave.push(pendingRule);
            } else {
                // Deduplicate simple append: Only append if not already exact same ID (unlikely) 
                // or maybe checks if similar rule exists? For now, just append.
                rulesToSave.push(pendingRule);
            }
        }
        return rulesToSave;
    };

    const normalizeAiProductCount = useCallback((value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return 3;
        return Math.min(10, Math.max(1, parsed));
    }, []);

    const getAiSettingsPayload = useCallback((forcedMode = mode) => {
        const count = normalizeAiProductCount(aiProductCount);
        return {
            maxSuggestions: count,
            aiProductCount: count,
            aiEnabled: forcedMode === "ai",
            customPrompt: "",
        };
    }, [aiProductCount, mode, normalizeAiProductCount]);

    const handleSave = () => {
        // Only validate rules when mode is "manual" — AI auto-recommends
        if (mode === "manual") {
            const hasPendingTrigger = scopeTriggerProducts.length > 0;
            const hasPendingFbt = ruleFbtProducts.length > 0;
            const isAllScope = displayScope === "all";
            const hasExistingRules = manualRules.length > 0;

            if (!isAllScope) {
                if (!hasExistingRules && !hasPendingTrigger && !hasPendingFbt) {
                    shopify.toast.show("Please select trigger and upsell products before saving.", { isError: true });
                    return;
                }
                if (hasPendingTrigger && !hasPendingFbt) {
                    shopify.toast.show("Please select upsell products for your rule before saving.", { isError: true });
                    return;
                }
                if (hasPendingFbt && !hasPendingTrigger) {
                    shopify.toast.show("Please select trigger products for your rule before saving.", { isError: true });
                    return;
                }
                if (!hasExistingRules && (!hasPendingTrigger || !hasPendingFbt)) {
                    shopify.toast.show("Please add at least one complete rule with trigger and upsell products.", { isError: true });
                    return;
                }
            }

            if (isAllScope && !hasExistingRules && !hasPendingFbt) {
                shopify.toast.show("Please select upsell products before saving.", { isError: true });
                return;
            }
        }

        setAiError(null);
        onSave({
            activeTemplate,
            templateData: templates,
            mode,
            configData: getRulesToSave(),
            aiSettings: getAiSettingsPayload(mode),
        });
    };

    const handleSaveTemplate = () => {
        setAiError(null);
        onSave({
            activeTemplate,
            templateData: templates,
            mode,
            configData: getRulesToSave(),
            aiSettings: getAiSettingsPayload(mode),
            _toastMessage: "Template is saved!",
        });
    };

    const handleDiscardTemplate = () => {
        setActiveTemplate(config?.activeTemplate || "fbt1");
        setTemplates(config?.templates || FAKE_FBT_CONFIG.templates);
    };

    const handleDiscardAll = () => {
        const raw = Number.parseInt(config?.aiSettings?.aiProductCount ?? config?.aiSettings?.maxSuggestions, 10);
        const resetCount = String(Number.isFinite(raw) ? Math.min(10, Math.max(1, raw)) : 3);
        setActiveTemplate(config?.activeTemplate || "fbt1");
        setTemplates(config?.templates || FAKE_FBT_CONFIG.templates);
        setMode(config?.mode || "manual");
        setManualRules(config?.manualRules || []);
        setAiError(null);
        setAiProductCount(resetCount);
        setDisplayScope("all");
        setScopeTriggerProducts([]);
        setRuleFbtProducts([]);
    };

    // AI run flow: generate coverage for all products and save immediately
    const handleRunAIForAllProducts = async () => {
        if (!products || products.length < 2) {
            const message = "At least 2 products are required to generate FBT combinations.";
            setAiError(message);
            shopify.toast.show(message, { isError: true });
            return;
        }

        const aiSettings = getAiSettingsPayload("ai");

        setAiLoading(true);
        setAiError(null);

        try {
            const res = await fetch("/api/fbt-ai", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    products,
                    productsPerTrigger: aiSettings.aiProductCount,
                    coverAllProducts: true,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                const message = data.error || "AI generation failed.";
                setAiError(message);
                shopify.toast.show(message, { isError: true });
                return;
            }

            const generatedRules = Array.isArray(data.rules)
                ? data.rules.map((rule) => ({ ...rule, aiGenerated: true }))
                : [];

            if (generatedRules.length === 0) {
                const message = "No AI combinations were generated.";
                setAiError(message);
                shopify.toast.show(message, { isError: true });
                return;
            }

            setManualRules(generatedRules);
            setMode("ai");

            onSave({
                activeTemplate,
                templateData: templates,
                mode: "ai",
                configData: generatedRules,
                aiSettings,
                _toastMessage: `AI combinations saved for ${generatedRules.length} product${generatedRules.length === 1 ? "" : "s"}.`,
            });
        } catch (err) {
            const message = err?.message || "Network error while generating AI combinations.";
            setAiError(message);
            shopify.toast.show(message, { isError: true });
        } finally {
            setAiLoading(false);
        }
    };

    const canAddRule = useMemo(() => {
        if (ruleFbtProducts.length === 0) return false;
        if (displayScope === "all") return true;
        if (scopeTriggerProducts.length === 0) return false;
        return true;
    }, [displayScope, scopeTriggerProducts, ruleFbtProducts]);

    const getProductById = (id) => products.find((p) => p.id === id);
    const currentTemplate = templates[activeTemplate];
    const interactionType = currentTemplate?.interactionType || "classic";

    // Derive display products for preview
    const activeRule = manualRules.find(r => {
        if (r.displayScope === "all") return true;
        // New format: triggerProducts array
        if (r.triggerProducts) return r.triggerProducts.some(tp => tp.id === simulatedTriggerId);
        // Old format: triggerProductId string
        return r.triggerProductId === simulatedTriggerId;
    });
    const displayProducts = activeRule
        ? (activeRule.fbtProducts || activeRule.upsellProductIds?.map(id => products.find(p => p.id === id)).filter(Boolean) || products.slice(0, 3))
        : products.slice(0, 3);

    // Reset selection when interaction type or display products change
    useEffect(() => {
        if (interactionType === "classic") {
            setSelectedProductIds(new Set(displayProducts.map(p => p.id)));
            setProductQuantities({});
        } else if (interactionType === "bundle") {
            setSelectedProductIds(new Set(displayProducts.map(p => p.id)));
            setProductQuantities({});
        } else {
            setSelectedProductIds(new Set());
            const qtys = {};
            displayProducts.forEach(p => { qtys[p.id] = 0; });
            setProductQuantities(qtys);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interactionType, activeTemplate, simulatedTriggerId]);

    // Toggle selection (classic / bundle)
    const handleToggleProduct = (productId) => {
        setSelectedProductIds(prev => {
            const next = new Set(prev);
            if (next.has(productId)) {
                if (interactionType === "bundle" && next.size <= 1) return prev;
                next.delete(productId);
            } else {
                next.add(productId);
            }
            return next;
        });
    };

    // Update quantity (quickAdd)
    const handleQuantityChange = (productId, qty) => {
        setProductQuantities(prev => ({ ...prev, [productId]: Math.max(0, qty) }));
    };

    // Total price calculation
    const totalPrice = (() => {
        if (interactionType === "quickAdd") {
            return displayProducts.reduce((sum, p) => sum + (productQuantities[p.id] || 0) * parseFloat(p.price), 0);
        }
        return displayProducts.filter(p => selectedProductIds.has(p.id)).reduce((sum, p) => sum + parseFloat(p.price), 0);
    })();

    const selectedCount = interactionType === "quickAdd"
        ? Object.values(productQuantities).filter(q => q > 0).length
        : selectedProductIds.size;

    return (
        <BlockStack gap="400">
            {/* Header */}
            <InlineStack gap="200" align="start" blockAlign="center">
                <Icon source={ProductIcon} tone="primary" />
                <Text as="h2" variant="headingLg">Frequently Bought Together</Text>
            </InlineStack>

            <Text as="p" tone="subdued">
                Choose a template and configure product recommendations.
            </Text>

            {/* Two Column Layout: Preview Left, Customization Right */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                {/* LEFT: Preview */}
                <Card>
                    <BlockStack gap="300">
                        {/* Template Selector inside Preview */}
                        <Text as="h3" variant="headingMd">Select Template</Text>
                        <InlineStack gap="300">
                            {Object.keys(templates).map((templateKey) => (
                                <Button
                                    key={templateKey}
                                    pressed={activeTemplate === templateKey}
                                    onClick={() => setActiveTemplate(templateKey)}
                                >
                                    {templates[templateKey].name}
                                </Button>
                            ))}
                        </InlineStack>
                        <Divider />
                        <Text as="h3" variant="headingMd">Preview</Text>
                        {(() => {
                            return (
                                <div
                                    style={{
                                        padding: "20px",
                                        borderRadius: `${currentTemplate.borderRadius}px`,
                                        background: currentTemplate.bgColor,
                                        border: `1px solid ${currentTemplate.borderColor}`,
                                        minHeight: "220px",
                                        boxShadow: "0 4px 20px -2px rgba(0,0,0,0.05), 0 2px 10px -2px rgba(0,0,0,0.05)",
                                        transition: "transform 0.3s ease",
                                    }}
                                >
                                    <BlockStack gap="400">
                                        <div style={{ color: currentTemplate.textColor, fontWeight: "800", fontSize: "18px", letterSpacing: "-0.5px" }}>
                                            Frequently Bought Together
                                        </div>

                                        {/* Style badge */}
                                        <div>
                                            <Badge tone="info" size="small">
                                                {interactionType === "classic" ? "Classic" : interactionType === "bundle" ? "Bundle" : "Quick Add"}
                                            </Badge>
                                        </div>

                                        {simulatedTriggerId && !activeRule && (
                                            <Banner tone="info">No rules found for this product. Showing defaults.</Banner>
                                        )}

                                        {/* Product cards */}
                                        <div style={{
                                            display: "flex",
                                            flexDirection: currentTemplate.layout === "vertical" ? "column" : "row",
                                            gap: "12px",
                                            alignItems: currentTemplate.layout === "vertical" ? "stretch" : "flex-start",
                                            justifyContent: "center",
                                            flexWrap: "wrap",
                                        }}>
                                            {displayProducts.map((p) => (
                                                <ProductCard
                                                    key={p.id}
                                                    product={p}
                                                    template={currentTemplate}
                                                    interactionType={interactionType}
                                                    isSelected={selectedProductIds.has(p.id)}
                                                    isRequired={interactionType === "bundle" && selectedProductIds.has(p.id) && selectedProductIds.size <= 1}
                                                    quantity={productQuantities[p.id] || 0}
                                                    onToggle={() => handleToggleProduct(p.id)}
                                                    onQuantityChange={(qty) => handleQuantityChange(p.id, qty)}
                                                />
                                            ))}
                                        </div>

                                        {/* Footer: Total + Add All */}
                                        <div style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            paddingTop: "12px",
                                            borderTop: `1px solid ${currentTemplate.borderColor}33`
                                        }}>
                                            {currentTemplate.showPrices && (
                                                <BlockStack gap="050">
                                                    <Text variant="bodySm" tone="subdued">
                                                        {selectedCount > 0 ? `Total (${selectedCount} item${selectedCount > 1 ? 's' : ''})` : 'Select items'}
                                                    </Text>
                                                    <div style={{ color: currentTemplate.priceColor, fontWeight: "900", fontSize: "22px" }}>
                                                        ₹{totalPrice.toLocaleString("en-IN")}
                                                    </div>
                                                </BlockStack>
                                            )}
                                            {currentTemplate.showAddAllButton && selectedCount > 0 && (
                                                <div
                                                    style={{
                                                        padding: "12px 24px",
                                                        background: currentTemplate.buttonColor,
                                                        borderRadius: "100px",
                                                        color: currentTemplate.buttonTextColor,
                                                        fontWeight: "800",
                                                        fontSize: "15px",
                                                        textAlign: "center",
                                                        cursor: "pointer",
                                                        boxShadow: `0 8px 20px ${currentTemplate.buttonColor}44`,
                                                        transition: "all 0.2s ease"
                                                    }}
                                                >
                                                    Add {selectedCount} to Cart
                                                </div>
                                            )}
                                        </div>
                                    </BlockStack>
                                </div>
                            );
                        })()}
                        <Box>
                            <InlineStack align="center">
                                <Badge tone="success">{currentTemplate.name}</Badge>
                            </InlineStack>
                        </Box>
                    </BlockStack>
                </Card>

                {/* RIGHT: Customization */}
                <Card>
                    <div style={{ maxHeight: "480px", overflowY: "auto" }}>
                        <BlockStack gap="400">
                            <Text as="h3" variant="headingMd">Customize: {currentTemplate.name}</Text>

                            <Divider />

                            <Text as="h4" variant="headingSm">Interaction Style</Text>
                            <Select
                                label="How customers interact with products"
                                labelHidden
                                options={[
                                    { label: "Classic — Individual Add / Remove", value: "classic" },
                                    { label: "Bundle — Minimum 1 Required", value: "bundle" },
                                    { label: "Quick Add — Quantity Stepper", value: "quickAdd" },
                                ]}
                                value={interactionType}
                                onChange={(v) => updateTemplate("interactionType", v)}
                            />

                            <Divider />

                            <Text as="h4" variant="headingSm">Layout Alignment</Text>
                            <Select
                                label="Product card alignment"
                                labelHidden
                                options={[
                                    { label: "Horizontal — Side by side", value: "horizontal" },
                                    { label: "Vertical — Stacked list", value: "vertical" },
                                ]}
                                value={currentTemplate.layout || "horizontal"}
                                onChange={(v) => updateTemplate("layout", v)}
                            />

                            <Divider />

                            <Text as="h4" variant="headingSm">Colors</Text>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                <ColorPickerField
                                    label="Background"
                                    value={currentTemplate.bgColor}
                                    onChange={(v) => updateTemplate("bgColor", v)}
                                />
                                <ColorPickerField
                                    label="Text Color"
                                    value={currentTemplate.textColor}
                                    onChange={(v) => updateTemplate("textColor", v)}
                                />
                                <ColorPickerField
                                    label="Price Color"
                                    value={currentTemplate.priceColor}
                                    onChange={(v) => updateTemplate("priceColor", v)}
                                />
                                <ColorPickerField
                                    label="Button Color"
                                    value={currentTemplate.buttonColor}
                                    onChange={(v) => updateTemplate("buttonColor", v)}
                                />
                                <ColorPickerField
                                    label="Button Text"
                                    value={currentTemplate.buttonTextColor}
                                    onChange={(v) => updateTemplate("buttonTextColor", v)}
                                />
                                <ColorPickerField
                                    label="Border Color"
                                    value={currentTemplate.borderColor}
                                    onChange={(v) => updateTemplate("borderColor", v)}
                                />
                            </div>

                            <Divider />

                            <Text as="h4" variant="headingSm">Styling</Text>
                            <RangeSlider
                                label={`Border Radius: ${currentTemplate.borderRadius}px`}
                                value={currentTemplate.borderRadius}
                                onChange={(v) => updateTemplate("borderRadius", v)}
                                min={0}
                                max={24}
                                output
                            />

                            <Divider />

                            <Text as="h4" variant="headingSm">Display Options</Text>
                            <InlineStack gap="400">
                                <Checkbox
                                    label="Show Prices"
                                    checked={currentTemplate.showPrices}
                                    onChange={(v) => updateTemplate("showPrices", v)}
                                />
                                <Checkbox
                                    label="Show 'Add All' Button"
                                    checked={currentTemplate.showAddAllButton}
                                    onChange={(v) => updateTemplate("showAddAllButton", v)}
                                />
                            </InlineStack>
                        </BlockStack>
                    </div>
                    {/* Save/Discard for template customization — outside scroll */}
                    <Box paddingBlockStart="300">
                        <InlineStack align="end" gap="200">
                            <Button variant="primary" tone="critical" onClick={handleDiscardTemplate}>
                                Discard
                            </Button>
                            <Button variant="primary" onClick={handleSaveTemplate} loading={saving}>
                                Save Template
                            </Button>
                        </InlineStack>
                    </Box>
                </Card>
            </div>

            {/* Mode Selection */}
            <Card>
                <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">Configuration Mode</Text>
                    <ChoiceList
                        title=""
                        choices={[
                            {
                                label: (
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={SettingsIcon} />
                                        <span>Manual Configuration</span>
                                    </InlineStack>
                                ),
                                value: "manual",
                                helpText: "Manually set which products to upsell",
                            },
                            {
                                label: (
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={MagicIcon} />
                                        <span>AI Configuration (OpenAI)</span>
                                    </InlineStack>
                                ),
                                value: "ai",
                                helpText: "Let AI suggest products automatically",
                            },
                        ]}
                        selected={[mode]}
                        onChange={handleModeChange}
                    />
                </BlockStack>
            </Card>

            {/* Manual Mode */}
            {mode === "manual" && (
                <Card>
                    <BlockStack gap="400">
                        <Text as="h3" variant="headingMd">Manual Upsell Rules</Text>
                        <Text as="p" tone="subdued">Configure where to show FBT recommendations and which products to suggest.</Text>

                        <Divider />

                        {/* Step 1: Display Scope */}
                        <Text as="h4" variant="headingSm">Step 1: Where to show FBT</Text>
                        <ChoiceList
                            title=""
                            choices={[
                                {
                                    label: "Show on all product pages",
                                    value: "all",
                                    helpText: "The same FBT products will appear on every product page",
                                },
                                {
                                    label: "Show on a specific product page",
                                    value: "single",
                                    helpText: "Select one product page where FBT will appear",
                                },
                                {
                                    label: "Show different FBT for different product pages",
                                    value: "per_product",
                                    helpText: "Create multiple rules with different FBT products per page",
                                },
                            ]}
                            selected={[displayScope]}
                            onChange={(v) => {
                                setDisplayScope(v[0]);
                                setScopeTriggerProducts([]);
                                setRuleFbtProducts([]);
                            }}
                        />

                        {/* Step 2: Trigger Product Picker (only for single / per_product) */}
                        {(displayScope === "single" || displayScope === "per_product") && (
                            <>
                                <Divider />
                                <Text as="h4" variant="headingSm">
                                    Step 2: Select {displayScope === "single" ? "the product page" : "the product page(s)"}
                                </Text>
                                <Text as="p" tone="subdued">
                                    {displayScope === "single"
                                        ? "Choose the product page where FBT will be displayed."
                                        : "Choose product page(s) that will show these FBT recommendations."}
                                </Text>
                                <InlineStack align="center">
                                    <Button onClick={handlePickTriggerProducts} variant="secondary">
                                        {scopeTriggerProducts.length > 0 ? "Change Product(s)" : "Browse Products"}
                                    </Button>
                                </InlineStack>
                                {scopeTriggerProducts.length > 0 && (
                                    <div style={{ maxHeight: "280px", overflowY: "auto", padding: "4px" }}>
                                        <div style={{
                                            display: "grid",
                                            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                            gap: "10px",
                                            marginTop: "4px",
                                        }}>
                                            {scopeTriggerProducts.map(p => (
                                                <div key={p.id} style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "8px",
                                                    padding: "8px 10px",
                                                    background: "#f0f7ff",
                                                    borderRadius: "8px",
                                                    border: "1px solid #bfdbfe",
                                                }}>
                                                    <Thumbnail source={p.image || ""} alt={p.title} size="small" />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <Text variant="bodySm" fontWeight="semibold" truncate>{p.title}</Text>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRemoveTriggerProduct(p.id)}
                                                        style={{
                                                            background: "none", border: "none", cursor: "pointer",
                                                            color: "#ef4444", fontSize: "16px", fontWeight: "bold",
                                                            padding: "0 4px", lineHeight: 1,
                                                        }}
                                                        title="Remove"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Step 3: FBT Product Picker */}
                        <Divider />
                        <Text as="h4" variant="headingSm">
                            {displayScope === "all" ? "Step 2" : "Step 3"}: Select FBT products to recommend
                        </Text>
                        <Text as="p" tone="subdued">
                            Choose products to show as "Frequently Bought Together" recommendations.
                        </Text>
                        <InlineStack align="center">
                            <Button onClick={handlePickFbtProducts} variant="secondary">
                                {ruleFbtProducts.length > 0 ? "Change FBT Products" : "Browse Products"}
                            </Button>
                        </InlineStack>
                        {ruleFbtProducts.length > 0 && (
                            <div style={{ maxHeight: "280px", overflowY: "auto", padding: "4px" }}>
                                <div style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                    gap: "10px",
                                    marginTop: "4px",
                                }}>
                                    {ruleFbtProducts.map(p => (
                                        <div key={p.id} style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            padding: "8px 10px",
                                            background: "#f0fdf4",
                                            borderRadius: "8px",
                                            border: "1px solid #bbf7d0",
                                        }}>
                                            <Thumbnail source={p.image || ""} alt={p.title} size="small" />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <Text variant="bodySm" fontWeight="semibold" truncate>{p.title}</Text>
                                                <Text variant="bodySm" tone="subdued">₹{parseFloat(p.price || 0).toLocaleString("en-IN")}</Text>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveFbtProduct(p.id)}
                                                style={{
                                                    background: "none", border: "none", cursor: "pointer",
                                                    color: "#ef4444", fontSize: "16px", fontWeight: "bold",
                                                    padding: "0 4px", lineHeight: 1,
                                                }}
                                                title="Remove"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Add Rule Button */}
                        <InlineStack align="center">
                            <Button onClick={handleAddRule} disabled={!canAddRule} variant="primary">
                                {displayScope === "single" && manualRules.some(r => r.displayScope === "single")
                                    ? "Update Rule" : "Add Rule"}
                            </Button>
                        </InlineStack>

                        <Divider />

                        {/* Saved Rules */}
                        <Text as="h4" variant="headingMd">Saved Rules ({manualRules.length})</Text>

                        {manualRules.length === 0 ? (
                            <Banner>No rules configured yet. Choose a display scope above and add FBT products.</Banner>
                        ) : (
                            <BlockStack gap="300">
                                {manualRules.map((rule) => {
                                    // Support both old and new rule formats
                                    const isNewFormat = !!rule.displayScope;
                                    const scopeLabel = rule.displayScope === "all"
                                        ? "All product pages"
                                        : rule.displayScope === "single"
                                            ? "Specific product page"
                                            : rule.displayScope === "per_product"
                                                ? "Per-product rule"
                                                : "Legacy rule";

                                    const triggerItems = isNewFormat
                                        ? (rule.triggerProducts || [])
                                        : [getProductById(rule.triggerProductId)].filter(Boolean);

                                    const fbtItems = isNewFormat
                                        ? (rule.fbtProducts || [])
                                        : (rule.upsellProductIds || []).map(getProductById).filter(Boolean);

                                    return (
                                        <Card key={rule.id}>
                                            <BlockStack gap="300">
                                                <InlineStack align="space-between" blockAlign="center">
                                                    <InlineStack gap="200" blockAlign="center">
                                                        <Badge tone={rule.displayScope === "all" ? "success" : "info"}>
                                                            {scopeLabel}
                                                        </Badge>
                                                    </InlineStack>
                                                    <Button tone="critical" size="slim" onClick={() => handleRemoveRule(rule.id)}>
                                                        Remove
                                                    </Button>
                                                </InlineStack>

                                                {triggerItems.length > 0 && (
                                                    <BlockStack gap="100">
                                                        <Text variant="bodySm" fontWeight="semibold" tone="subdued">Trigger page(s):</Text>
                                                        <InlineStack gap="200" wrap>
                                                            {triggerItems.map(p => (
                                                                <InlineStack key={p.id} gap="100" blockAlign="center">
                                                                    <Thumbnail source={p.image || ""} alt={p.title} size="extraSmall" />
                                                                    <Text variant="bodySm">{p.title}</Text>
                                                                </InlineStack>
                                                            ))}
                                                        </InlineStack>
                                                    </BlockStack>
                                                )}

                                                <BlockStack gap="100">
                                                    <Text variant="bodySm" fontWeight="semibold" tone="subdued">FBT products:</Text>
                                                    <InlineStack gap="200" wrap>
                                                        {fbtItems.map(p => (
                                                            <Badge key={p.id}>{p.title}</Badge>
                                                        ))}
                                                    </InlineStack>
                                                </BlockStack>
                                            </BlockStack>
                                        </Card>
                                    );
                                })}
                            </BlockStack>
                        )}
                    </BlockStack>
                </Card>
            )}

            {/* AI Mode */}
            {mode === "ai" && (
                <Card>
                    <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">AI Coverage Run</Text>
                        <Text tone="subdued" variant="bodySm">
                            AI will generate recommendations for every store product and save them directly to backend.
                        </Text>

                        <InlineStack gap="300" wrap blockAlign="end">
                            <div style={{ flex: "1 1 240px", minWidth: "220px" }}>
                                <TextField
                                    label="FBT products per product"
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={aiProductCount}
                                    onChange={(value) => {
                                        const onlyDigits = (value || "").replace(/\D/g, "");
                                        if (!onlyDigits) {
                                            setAiProductCount("");
                                            return;
                                        }
                                        const parsedValue = Number.parseInt(onlyDigits, 10);
                                        if (Number.isNaN(parsedValue)) {
                                            setAiProductCount("");
                                            return;
                                        }
                                        setAiProductCount(String(Math.min(10, Math.max(1, parsedValue))));
                                    }}
                                    placeholder="3"
                                    helpText="Example: 3 means each product gets 3 FBT suggestions."
                                    autoComplete="off"
                                />
                            </div>

                            <Button
                                variant="primary"
                                onClick={handleRunAIForAllProducts}
                                loading={aiLoading}
                                disabled={aiLoading || products.length < 2}
                            >
                                Configure AI
                            </Button>

                            <Button
                                onClick={handleRunAIForAllProducts}
                                disabled={aiLoading || products.length < 2}
                            >
                                Regenerate Suggestions
                            </Button>
                        </InlineStack>

                        {aiError && (
                            <Banner tone="critical">{aiError}</Banner>
                        )}
                    </BlockStack>
                </Card>
            )}

            {/* Save/Discard for entire FBT configuration */}
            <InlineStack align="end" gap="200">
                <Button variant="primary" tone="critical" onClick={handleDiscardAll}>
                    Discard
                </Button>
                <Button variant="primary" onClick={handleSave} loading={saving}>
                    Save
                </Button>
            </InlineStack>
        </BlockStack>
    );
}

// --- MAIN COMPONENT ---

export default function ProductWidgetPage() {
    const { couponConfig, fbtConfig, products, shop } = useLoaderData();
    const fetcher = useFetcher();
    const shopify = useAppBridge();

    const [selectedTab, setSelectedTab] = useState(0);

    const tabs = [
        {
            id: "coupons",
            content: "Coupons",
            accessibilityLabel: "Coupon Templates",
            panelID: "coupons-panel",
        },
        {
            id: "fbt",
            content: "Frequently Bought Together",
            accessibilityLabel: "Frequently Bought Together Configuration",
            panelID: "fbt-panel",
        },
    ];

    const handleTabChange = useCallback((selectedTabIndex) => {
        setSelectedTab(selectedTabIndex);
    }, []);

    const [customToastMessage, setCustomToastMessage] = useState(null);

    useEffect(() => {
        if (fetcher.data) {
            if (fetcher.data.success) {
                shopify.toast.show(customToastMessage || fetcher.data.message || "Saved successfully!");
                setCustomToastMessage(null);
            } else {
                shopify.toast.show(
                    fetcher.data.error || (fetcher.data.errors && fetcher.data.errors[0]) || "Failed to save.",
                    { isError: true }
                );
                setCustomToastMessage(null);
            }
        }
    }, [fetcher.data, shopify]);

    const handleCouponSave = (data) => {
        fetcher.submit(
            {
                actionType: "saveCouponConfig",
                activeTemplate: data.activeTemplate,
                templateData: data.templateData,
                selectedActiveCoupons: data.selectedActiveCoupons,
                allTemplateOverrides: data.allTemplateOverrides,
                title: data.title,
                shop,
            },
            { method: "POST", encType: "application/json", action: "/api/coupon-slider" }
        );
    };

    const handleFBTSave = (data) => {
        if (data._toastMessage) {
            setCustomToastMessage(data._toastMessage);
        }

        // Enrich/Normalize rules before saving to ensure API has product names
        const enrichedRules = (data.configData || []).map(rule => {
            let triggers = rule.triggerProducts || [];
            let fbts = rule.fbtProducts || [];
            let scope = rule.displayScope;

            // Handle legacy trigger (single product ID)
            if (triggers.length === 0 && rule.triggerProductId) {
                const p = products.find(prod => prod.id === rule.triggerProductId);
                if (p) {
                    triggers = [{
                        id: p.id,
                        title: p.title,
                        image: p.image,
                        handle: p.handle,
                    }];
                }
                else triggers = [{ id: rule.triggerProductId, title: "Unknown Product" }];

                if (!scope) scope = "legacy";
            }
            // Handle legacy FBTs (array of IDs)
            if (fbts.length === 0 && rule.upsellProductIds && rule.upsellProductIds.length > 0) {
                fbts = rule.upsellProductIds.map(id => {
                    const p = products.find(prod => prod.id === id);
                    if (p) {
                        return {
                            id: p.id,
                            title: p.title,
                            image: p.image,
                            price: p.price,
                            handle: p.handle,
                            variantId: p.variantId,
                        };
                    }
                    return { id, title: "Unknown Product" };
                });
            }

            return {
                ...rule,
                displayScope: scope,
                triggerProducts: triggers,
                fbtProducts: fbts
            };
        });

        fetcher.submit(
            {
                actionType: "saveFBTConfig",
                activeTemplate: data.activeTemplate,
                templateData: data.templateData,
                mode: data.mode,
                configData: enrichedRules, // Send enriched rules with product details
                aiSettings: data.aiSettings,
                shop,
            },
            { method: "POST", encType: "application/json", action: "/api/product-sample" }
        );
    };

    const isSaving = fetcher.state === "submitting";

    return (
        <>
            <style>{`
                .Polaris-Icon.Polaris-Icon--tonePrimary {
                    margin: 0 !important;
                }
            `}</style>
            <Page
                title="Product Widgets"
                backAction={{ content: "Back", onAction: () => window.history.back() }}
            >
                <Layout>
                    <Layout.Section>
                        <Card>
                            <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
                                <Box padding="400">
                                    {selectedTab === 0 && (
                                        <CouponsSection
                                            config={couponConfig}
                                            onSave={handleCouponSave}
                                            saving={isSaving}
                                        />
                                    )}
                                    {selectedTab === 1 && (
                                        <FBTSection
                                            config={fbtConfig}
                                            products={products}
                                            onSave={handleFBTSave}
                                            saving={isSaving}
                                        />
                                    )}
                                </Box>
                            </Tabs>
                        </Card>
                    </Layout.Section>
                </Layout>
            </Page>
        </>
    );
}