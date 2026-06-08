/**
 * AI Agent — Theme Analysis
 *
 * Reads the merchant's published theme to extract the values `matchTheme`
 * needs: primary/secondary color, font and button radius. Tries the
 * lightweight `shop.brand` API first (no extra scopes), then falls back to
 * parsing the active theme's settings_data.json. If both are unavailable
 * (e.g. missing `read_themes` scope) it returns sensible defaults so the
 * AI agent always has something to work with.
 */

const DEFAULT_THEME_COLORS = {
    primaryColor: "#008060",
    secondaryColor: "#1a1a1a",
    font: "Inter",
    borderRadius: 8,
    source: "default",
};

function pickHexColor(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate.trim())) {
            return candidate.trim();
        }
    }
    return null;
}

async function readThemeFromBrand(admin) {
    const res = await admin.graphql(`
        query {
            shop {
                brand {
                    colors {
                        primary { background foreground }
                        secondary { background foreground }
                    }
                }
            }
        }
    `);
    const data = await res.json();
    const colors = data?.data?.shop?.brand?.colors;
    if (!colors) return null;

    const primaryColor = pickHexColor(colors.primary?.[0]?.background, colors.primary?.[0]?.foreground);
    const secondaryColor = pickHexColor(colors.secondary?.[0]?.background, colors.secondary?.[0]?.foreground);

    if (!primaryColor && !secondaryColor) return null;

    return {
        primaryColor: primaryColor || DEFAULT_THEME_COLORS.primaryColor,
        secondaryColor: secondaryColor || DEFAULT_THEME_COLORS.secondaryColor,
        font: DEFAULT_THEME_COLORS.font,
        borderRadius: DEFAULT_THEME_COLORS.borderRadius,
        source: "shop-brand",
    };
}

async function readThemeFromSettingsData(admin) {
    const themeRes = await admin.graphql(`
        query {
            themes(first: 1, roles: [MAIN]) {
                nodes {
                    id
                    files(filenames: ["config/settings_data.json"]) {
                        nodes {
                            filename
                            body {
                                ... on OnlineStoreThemeFileBodyText { content }
                            }
                        }
                    }
                }
            }
        }
    `);
    const themeData = await themeRes.json();
    const fileNode = themeData?.data?.themes?.nodes?.[0]?.files?.nodes?.find(
        (n) => n.filename === "config/settings_data.json"
    );
    const content = fileNode?.body?.content;
    if (!content) return null;

    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch {
        return null;
    }

    const presets = parsed?.presets || {};
    const currentKey = parsed?.current;
    const currentSettings = (typeof currentKey === "string" ? presets[currentKey] : null) || presets.Default || Object.values(presets)[0] || {};

    const primaryColor = pickHexColor(
        currentSettings.colors_accent_1,
        currentSettings.colors_solid_button_labels && currentSettings.colors_button,
        currentSettings.colors_button,
        currentSettings.color_button,
        currentSettings.color_accent,
        currentSettings.color_primary,
        currentSettings.colors_primary_button_background
    );
    const secondaryColor = pickHexColor(
        currentSettings.colors_accent_2,
        currentSettings.color_secondary,
        currentSettings.colors_text,
        currentSettings.color_body_text
    );
    const font = currentSettings.type_header_font?.split(/[,_]/)[0] || currentSettings.type_body_font?.split(/[,_]/)[0] || null;
    const borderRadius = Number.isFinite(currentSettings.buttons_radius)
        ? currentSettings.buttons_radius
        : (Number.isFinite(currentSettings.button_border_radius) ? currentSettings.button_border_radius : null);

    if (!primaryColor && !secondaryColor && !font && borderRadius == null) return null;

    return {
        primaryColor: primaryColor || DEFAULT_THEME_COLORS.primaryColor,
        secondaryColor: secondaryColor || DEFAULT_THEME_COLORS.secondaryColor,
        font: font || DEFAULT_THEME_COLORS.font,
        borderRadius: borderRadius != null ? borderRadius : DEFAULT_THEME_COLORS.borderRadius,
        source: "settings_data.json",
    };
}

export async function analyzeThemeColors(admin) {
    if (!admin) return { ...DEFAULT_THEME_COLORS };

    try {
        const fromBrand = await readThemeFromBrand(admin);
        if (fromBrand) return fromBrand;
    } catch (e) {
        console.warn("[AI Agent] shop.brand theme read failed:", e?.message);
    }

    try {
        const fromSettings = await readThemeFromSettingsData(admin);
        if (fromSettings) return fromSettings;
    } catch (e) {
        console.warn("[AI Agent] settings_data.json theme read failed (likely missing read_themes scope):", e?.message);
    }

    return { ...DEFAULT_THEME_COLORS };
}
