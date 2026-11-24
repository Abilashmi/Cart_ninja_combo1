const VALID_ACTION_TYPES = ["saveFBTConfig"];
const VALID_MODES = ["manual", "ai"];
const VALID_DISPLAY_SCOPES = ["all", "single", "per_product"];
const VALID_LAYOUTS = ["horizontal", "vertical"];
const VALID_INTERACTION_TYPES = ["classic", "bundle", "quickAdd"];
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/* ──────────────────────────────────────────────
   REQUEST BODY
   ────────────────────────────────────────────── */

export function validateRequestBody(data) {
    const errors = [];

    if (!data || typeof data !== "object") {
        return { status: "error", errors: ["Request body must be a JSON object"] };
    }
    if (!data.actionType) {
        errors.push("actionType is required");
    } else if (!VALID_ACTION_TYPES.includes(data.actionType)) {
        errors.push(`actionType must be one of: ${VALID_ACTION_TYPES.join(", ")}`);
    }

    return errors.length ? { status: "error", errors } : { status: "success" };
}

/* ──────────────────────────────────────────────
   FBT CONFIG
   ────────────────────────────────────────────── */

export function validateFBTConfig(data) {
    const errors = [];

    // --- Required fields ---
    if (!data.activeTemplate) errors.push("activeTemplate is required");
    if (data.mode === undefined) errors.push("mode is required");
    else if (!VALID_MODES.includes(data.mode)) errors.push(`mode must be one of: ${VALID_MODES.join(", ")}`);
    // openaiKey is stored server-side in .env — no client validation needed

    // --- templateData ---
    let templates = data.templateData;
    if (templates !== undefined) {
        if (typeof templates === "string") {
            try { templates = JSON.parse(templates); } catch { errors.push("templateData is invalid JSON"); }
        }
        if (templates && typeof templates === "object") {
            if (data.activeTemplate && !templates[data.activeTemplate]) {
                errors.push(`activeTemplate '${data.activeTemplate}' not found in templateData`);
            }
            for (const [key, tpl] of Object.entries(templates)) {
                validateTemplateFields(key, tpl, errors);
            }
        }
    }

    // --- configData (manual rules) — skip for AI mode ---
    if (data.mode === "manual" && data.configData !== undefined) {
        const result = validateManualUpsellRules(data.configData);
        if (result.status === "error") errors.push(...result.errors);
    }

    return errors.length ? { status: "error", errors } : { status: "success" };
}

/* ──────────────────────────────────────────────
   TEMPLATE FIELDS
   ────────────────────────────────────────────── */

function validateTemplateFields(key, tpl, errors) {
    const p = `templates.${key}`;
    if (!tpl || typeof tpl !== "object") { errors.push(`${p} must be an object`); return; }
    if (!tpl.name?.trim()) errors.push(`${p}.name is required`);
    if (tpl.layout !== undefined && !VALID_LAYOUTS.includes(tpl.layout)) errors.push(`${p}.layout must be one of: ${VALID_LAYOUTS.join(", ")}`);
    if (tpl.interactionType !== undefined && !VALID_INTERACTION_TYPES.includes(tpl.interactionType)) errors.push(`${p}.interactionType must be one of: ${VALID_INTERACTION_TYPES.join(", ")}`);
    for (const f of ["bgColor", "textColor", "priceColor", "buttonColor", "buttonTextColor", "borderColor"]) {
        if (tpl[f] !== undefined && !HEX_COLOR_RE.test(tpl[f])) errors.push(`${p}.${f} must be a valid hex color`);
    }
    if (tpl.borderRadius !== undefined && (typeof tpl.borderRadius !== "number" || tpl.borderRadius < 0 || tpl.borderRadius > 100)) errors.push(`${p}.borderRadius must be 0–100`);
    if (tpl.showPrices !== undefined && typeof tpl.showPrices !== "boolean") errors.push(`${p}.showPrices must be boolean`);
    if (tpl.showAddAllButton !== undefined && typeof tpl.showAddAllButton !== "boolean") errors.push(`${p}.showAddAllButton must be boolean`);
}

/* ──────────────────────────────────────────────
   MANUAL UPSELL RULES (array)
   ────────────────────────────────────────────── */

export function validateManualUpsellRules(rules) {
    const errors = [];
    let parsed = rules;

    if (typeof parsed === "string") {
        try { parsed = JSON.parse(parsed); } catch { return { status: "error", errors: ["configData is invalid JSON"] }; }
    }
    if (!Array.isArray(parsed)) return { status: "error", errors: ["configData must be an array"] };

    // Duplicate rule IDs
    const ids = parsed.map(r => r?.id).filter(Boolean);
    const dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (dupIds.length) errors.push(`Duplicate rule IDs: ${dupIds.join(", ")}`);

    // Only one "single" scope allowed
    if (parsed.filter(r => r?.displayScope === "single").length > 1) {
        errors.push("Only one rule with displayScope 'single' is allowed");
    }

    parsed.forEach((rule, i) => validateManualUpsellRule_internal(rule, i, errors));

    return errors.length ? { status: "error", errors } : { status: "success" };
}

/* ──────────────────────────────────────────────
   SINGLE MANUAL UPSELL RULE
   ────────────────────────────────────────────── */

export function validateManualUpsellRule(rule) {
    const errors = [];
    validateManualUpsellRule_internal(rule, 0, errors);
    return errors.length ? { status: "error", errors } : { status: "success" };
}

function validateManualUpsellRule_internal(rule, index, errors) {
    const p = `rule[${index}]`;

    if (!rule || typeof rule !== "object") { errors.push(`${p}: must be an object`); return; }

    // ── 1. Required fields ──
    if (!rule.id) errors.push(`${p}.id is required`);
    if (!rule.displayScope) {
        errors.push(`${p}.displayScope is required`);
    } else if (!VALID_DISPLAY_SCOPES.includes(rule.displayScope)) {
        // ── 5. Invalid condition type ──
        errors.push(`${p}.displayScope is invalid — must be one of: ${VALID_DISPLAY_SCOPES.join(", ")}`);
    }

    // ── 4. Missing upsell products ──
    if (!rule.fbtProducts || !Array.isArray(rule.fbtProducts) || rule.fbtProducts.length === 0) {
        errors.push(`${p}: at least 1 upsell product (fbtProducts) is required`);
    } else {
        // Validate each upsell product has id + title
        rule.fbtProducts.forEach((prod, i) => {
            if (!prod?.id) errors.push(`${p}.fbtProducts[${i}].id is required`);
            if (!prod?.title?.trim()) errors.push(`${p}.fbtProducts[${i}].title is required`);
            if (prod?.price !== undefined) {
                const n = Number(prod.price);
                if (isNaN(n) || n < 0) errors.push(`${p}.fbtProducts[${i}].price must be a non-negative number`);
            }
        });

        // ── 2. Duplicate products in upsell list ──
        const upsellIds = rule.fbtProducts.map(prod => prod?.id).filter(Boolean);
        const dupUpsell = [...new Set(upsellIds.filter((id, i) => upsellIds.indexOf(id) !== i))];
        if (dupUpsell.length) {
            errors.push(`${p}: duplicate upsell products found — ${dupUpsell.join(", ")}`);
        }
    }

    // ── triggerProducts ──
    const needsTrigger = rule.displayScope && rule.displayScope !== "all";

    if (needsTrigger) {
        if (!rule.triggerProducts || !Array.isArray(rule.triggerProducts) || rule.triggerProducts.length === 0) {
            errors.push(`${p}: triggerProducts required when displayScope is '${rule.displayScope}'`);
        } else {
            if (rule.displayScope === "single" && rule.triggerProducts.length !== 1) {
                errors.push(`${p}: exactly 1 triggerProduct required when displayScope is 'single'`);
            }
            rule.triggerProducts.forEach((prod, i) => {
                if (!prod?.id) errors.push(`${p}.triggerProducts[${i}].id is required`);
                if (!prod?.title?.trim()) errors.push(`${p}.triggerProducts[${i}].title is required`);
            });

            // Duplicate trigger products
            const triggerIds = rule.triggerProducts.map(prod => prod?.id).filter(Boolean);
            const dupTrigger = [...new Set(triggerIds.filter((id, i) => triggerIds.indexOf(id) !== i))];
            if (dupTrigger.length) {
                errors.push(`${p}: duplicate trigger products found — ${dupTrigger.join(", ")}`);
            }
        }
    }

    // ── 3. Trigger product inside upsell list ──
    if (
        rule.triggerProducts?.length > 0 &&
        rule.fbtProducts?.length > 0
    ) {
        const upsellIdSet = new Set(rule.fbtProducts.map(prod => prod?.id).filter(Boolean));
        const overlap = rule.triggerProducts.filter(prod => upsellIdSet.has(prod?.id));
        if (overlap.length) {
            errors.push(`${p}: trigger product(s) cannot also be in the upsell list — ${overlap.map(o => o.title || o.id).join(", ")}`);
        }
    }
}
