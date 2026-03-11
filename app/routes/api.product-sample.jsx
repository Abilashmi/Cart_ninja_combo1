import { promises as fs } from "fs";
import path from "path";
import { validateRequestBody, validateFBTConfig, validateManualUpsellRules } from "../validators/product-sample.validator.js";

const DATA_FILE = path.resolve("fbt-product-data.json");

/* ---------------- DEFAULT CONFIGS ---------------- */

const DEFAULT_COUPON_DATA = {
    activeTemplate: "template1",
    selectedActiveCoupons: [],
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

const DEFAULT_FBT_DATA = {
    activeTemplate: "fbt1",
    mode: "manual",
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

/* ---------------- FILE HELPERS ---------------- */

async function readStoredData() {
    try {
        const raw = await fs.readFile(DATA_FILE, "utf-8");
        return JSON.parse(raw);
    } catch {
        return {
            couponSlider: DEFAULT_COUPON_DATA,
            fbt: DEFAULT_FBT_DATA
        };
    }
}

async function writeStoredData(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/* ---------------- LOADER ---------------- */

export async function loader() {
    const storedData = await readStoredData();

    return Response.json({
        success: true,
        fbt: storedData.fbt || DEFAULT_FBT_DATA
    });
}

/* ---------------- ACTION ---------------- */

export async function action({ request }) {

    if (request.method !== "POST") {
        return Response.json(
            { error: "Method not allowed" },
            { status: 405 }
        );
    }

    try {
        const data = await request.json();
        const { actionType, shop } = data;

        // Validate top-level request body
        const bodyCheck = validateRequestBody(data);
        if (bodyCheck.status === "error") {
            return Response.json(
                { success: false, errors: bodyCheck.errors },
                { status: 400 }
            );
        }

        const storedData = await readStoredData();

        if (actionType === "saveFBTConfig") {

            // Validate FBT config data
            const configCheck = validateFBTConfig(data);
            if (configCheck.status === "error") {
                return Response.json(
                    { success: false, errors: configCheck.errors },
                    { status: 400 }
                );
            }

            const {
                activeTemplate,
                templateData: rawTemplateData,
                mode,
                configData: rawConfigData
            } = data;

            const templates = typeof rawTemplateData === "string"
                ? JSON.parse(rawTemplateData)
                : rawTemplateData;

            const manualRules = typeof rawConfigData === "string"
                ? JSON.parse(rawConfigData)
                : (rawConfigData || []);

            const activeTpl = templates[activeTemplate] || {};

            // Structured Data for Output
            const selectedTemplate = activeTemplate;
            const interactionStyle = activeTpl.interactionType;
            const layoutAlignment = activeTpl.layout;

            const color = {
                bgColor: activeTpl.bgColor,
                textColor: activeTpl.textColor,
                priceColor: activeTpl.priceColor,
                buttonColor: activeTpl.buttonColor,
                buttonText: activeTpl.buttonTextColor,
                borderColor: activeTpl.borderColor
            };

            const styling = {
                borderRadius: activeTpl.borderRadius,
                showPrices: activeTpl.showPrices,
                showAddAllButton: activeTpl.showAddAllButton
            };

            const configurationMode = mode === "manual" ? "Manual Configuration" : "AI Configuration";

            // Process manual rules to include product names instead of just IDs
            const manualConfiguration = manualRules.map(rule => {
                // Determine trigger product names
                const triggerNames = (rule.triggerProducts || []).map(p => p.title || p.id).join(", ");

                // Determine upsell/fbt product names
                const upsellNames = (rule.fbtProducts || []).map(p => p.title || p.id).join(", ");

                return {
                    ruleId: rule.id,
                    displayScope: rule.displayScope,
                    triggeredProduct: triggerNames || (rule.displayScope === "all" ? "All Products" : "None"),
                    upsellProduct: upsellNames || "None",
                    // Keep original data for functionality
                    triggerProducts: rule.triggerProducts,
                    fbtProducts: rule.fbtProducts
                };
            });

            storedData.fbt = {
                activeTemplate,
                templates,
                mode,
                manualRules,
                // New structured fields
                selectedTemplate,
                interactionStyle,
                layoutAlignment,
                color,
                styling,
                configurationMode,
                manualConfiguration
            };

            await writeStoredData(storedData);

            /* -------- SEND DATA TO PHP ENDPOINT -------- */

            try {
                await fetch(
                    "https://blueviolet-clam-512487.hostingersite.com/save_fbt_widget.php",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            shop,
                            fbt: {
                                ...storedData.fbt,
                                // PHP reads "condition" for rules — map from manualConfiguration
                                condition: storedData.fbt.manualConfiguration || [],
                            }
                        })
                    }
                );
                // console.log("[FBT PUSH RESPONSE]", await response.text()); // Optional logging

            } catch (pushError) {
                console.error("[FBT PUSH FAILED]", pushError);
            }

            console.log("==========================================");
            console.log("[SAVED] FBT CONFIGURATION");
            console.log("Shop:", shop);

            console.log("Selected Template:", selectedTemplate);
            console.log("Interaction Style:", interactionStyle);
            console.log("Layout:", layoutAlignment);
            console.log("Color:", color);
            console.log("Styling:", styling);
            console.log("Mode:", configurationMode);
            if (mode === "manual") {
                console.log("Manual Rules:", manualConfiguration);
            }
            console.log("==========================================");

            return Response.json({
                success: true,
                message: "FBT configuration saved successfully!",
                shop,
                config: storedData.fbt
            });

        } else {
            return Response.json(
                { success: false, error: "Unsupported actionType" },
                { status: 400 }
            );
        }

    } catch (error) {
        console.error("Product Sample API Error:", error);

        return Response.json(
            { success: false, error: "Invalid JSON or internal error" },
            { status: 400 }
        );
    }
}
