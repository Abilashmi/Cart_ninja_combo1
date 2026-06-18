// app/services/api.cart-settings.shared.js

// ==========================================
// COUPON DATA & STYLES
// ==========================================

export const COUPON_STYLES = {
    STYLE_1: 'style-1',
    STYLE_2: 'style-2',
    STYLE_3: 'style-3',
};

export const COUPON_STYLE_METADATA = {
    [COUPON_STYLES.STYLE_1]: {
        name: 'Classic Banner',
        description: 'Classic discount badge with shop branding',
        previewImage: 'https://via.placeholder.com/320x140/1a1a2e/ffffff?text=Classic+Banner',
    },
    [COUPON_STYLES.STYLE_2]: {
        name: 'Minimal Card',
        description: 'Simple, clean card with minimal details',
        previewImage: 'https://via.placeholder.com/320x140/ffffff/333333?text=Minimal+Card',
    },
    [COUPON_STYLES.STYLE_3]: {
        name: 'Bold & Vibrant',
        description: 'High-contrast design to grab attention',
        previewImage: 'https://via.placeholder.com/320x140/6366f1/ffffff?text=Bold+&+Vibrant',
    },
};

export let globalCouponStyle = COUPON_STYLES.STYLE_1;

export const sampleCoupons = [
    {
        id: 'coupon-1',
        enabled: true,
        code: 'SAVE10',
        label: "Summer Sale",
        description: 'Valid until 01-31-2025',
        textAlign: 'left',
        iconUrl: '☀️',
        backgroundColor: '#1a1a2e',
        textColor: '#ffffff',
        borderRadius: 8,
        discountType: 'percentage',
        discountValue: 10,
        button: {
            text: 'Shop Now',
            textColor: '#ffffff',
            backgroundColor: '#e94560',
            borderRadius: 4,
        },
    },
    {
        id: 'coupon-2',
        enabled: true,
        code: 'WELCOME',
        label: 'First Order',
        description: 'Enjoy 5% off sitewide—just for you!',
        textAlign: 'center',
        iconUrl: '👋',
        backgroundColor: '#ffffff',
        textColor: '#333333',
        borderRadius: 4,
        discountType: 'percentage',
        discountValue: 5,
        button: {
            text: 'Apply Code',
            textColor: '#ffffff',
            backgroundColor: '#0070f3',
            borderRadius: 4,
        },
    },
    {
        id: 'coupon-3',
        enabled: true,
        code: 'VIPACCESS',
        label: 'VIP Special',
        description: 'Exclusive deal for members',
        textAlign: 'center',
        iconUrl: '👑',
        backgroundColor: '#6366f1',
        textColor: '#ffffff',
        borderRadius: 12,
        discountType: 'fixed',
        discountValue: 50,
        button: {
            text: 'UNLOCK',
            textColor: '#1f2937',
            backgroundColor: '#fbbf24',
            borderRadius: 12,
        },
    },
];

// ==========================================
// SHOPIFY PRODUCTS & COLLECTIONS
// ==========================================

export const shopifyProducts = [
    {
        id: 'sp-1',
        title: 'Gift Card',
        price: '10.00',
        image: 'https://cdn.shopify.com/s/files/1/0668/0025/5043/files/gift_card.png?v=1765536575',
        variants: 4,
        status: 'outofstock',
    },
    {
        id: 'sp-2',
        title: 'The Inventory Not Tracked Snowboard',
        price: '949.95',
        image: '🏂',
        variants: 1,
        status: 'active',
    },
    {
        id: 'sp-3',
        title: 'The Archived Snowboard',
        price: '629.95',
        image: '🏂',
        variants: 1,
        status: 'archived',
    },
    {
        id: 'sp-4',
        title: 'The Draft Snowboard',
        price: '2629.95',
        image: '🏂',
        variants: 1,
        status: 'draft',
    },
    {
        id: 'sp-5',
        title: 'The Out of Stock Snowboard',
        price: '885.95',
        image: '🏂',
        variants: 1,
        status: 'outofstock',
    },
    {
        id: 'sp-6',
        title: 'Premium Hoodie',
        price: '129.99',
        image: '🧥',
        variants: 3,
        status: 'active',
    },
    {
        id: 'sp-7',
        title: 'Classic Jeans',
        price: '89.99',
        image: '👖',
        variants: 5,
        status: 'active',
    },
    {
        id: 'sp-8',
        title: 'Sports Cap',
        price: '39.99',
        image: '🧢',
        variants: 2,
        status: 'active',
    },
];

export const mockCollections = [
    { id: 'col-1', title: 'Winter Gear', productCount: 15 },
    { id: 'col-2', title: 'Gifts & Bundles', productCount: 8 },
    { id: 'col-3', title: 'Premium Accessories', productCount: 12 },
    { id: 'col-4', title: 'Discountable Items', productCount: 20 },
    { id: 'col-5', title: 'New Arrivals', productCount: 10 },
];

// ==========================================
// UPSELL CONFIGURATION
// ==========================================

export const getUpsellConfig = async (shopId) => {
    try {
        const response = await fetch('/api/upsell', {
            headers: { 'X-Shop-ID': shopId || 'demo-shop.myshopify.com' }
        });
        const data = await response.json();
        return data.success ? data.data : { config: DEFAULT_UPSELL_CONFIG };
    } catch (error) {
        console.error('Failed to get upsell config:', error);
        return { config: DEFAULT_UPSELL_CONFIG };
    }
};

export const saveUpsellConfig = async (configData) => {
    try {
        const shopId = 'demo-shop.myshopify.com'; // In a real app, this would be from session
        const response = await fetch('/api/upsell', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shop-ID': shopId,
            },
            body: JSON.stringify(configData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server error response:', errorText);
            throw new Error(`Server returned ${response.status}: ${errorText.substring(0, 100)}`);
        }

        const result = await response.json();
        return {
            status: 'success',
            message: 'Upsell configuration saved successfully',
            data: result.data,
        };
    } catch (error) {
        console.error('Failed to save upsell config:', error);
        throw error;
    }
};

// ==========================================
// UPSELL RULE TYPES & CONFIGURATIONS
// ==========================================

export const UPSELL_STYLES = {
    GRID: 'grid',
    CAROUSEL: 'carousel',
    LIST: 'vertical',
};

export const UPSELL_STYLE_METADATA = {
    [UPSELL_STYLES.GRID]: {
        name: 'Grid Layout',
        description: 'Show products in a 2-column grid',
    },
    [UPSELL_STYLES.CAROUSEL]: {
        name: 'Carousel',
        description: 'Horizontal scrollable list',
    },
    [UPSELL_STYLES.LIST]: {
        name: 'Vertical List',
        description: 'Stack products vertically',
    },
};

export const RULE_TYPES = {
    GLOBAL: 'GLOBAL',
    TRIGGERED: 'TRIGGERED',
    GLOBAL_EXCEPT: 'GLOBAL_EXCEPT',
    CART_CONDITIONS: 'CART_CONDITIONS',
};

export const RULE_TYPE_OPTIONS = [
    {
        value: RULE_TYPES.GLOBAL,
        label: 'Show upsell for all products',
        description: 'Display upsell products for any item in the cart',
        helpText: 'Acts as a default fallback rule',
    },
    {
        value: RULE_TYPES.TRIGGERED,
        label: 'Show upsell for specific products or collections',
        description: 'Display upsells only when specific trigger products are in cart',
        helpText: 'This rule has the highest priority',
    },
    {
        value: RULE_TYPES.GLOBAL_EXCEPT,
        label: 'Show upsell for all products except selected ones',
        description: 'Display upsells for everything except excluded products',
        helpText: 'Show for all products except when excluded items are in cart',
    },
    {
        value: RULE_TYPES.CART_CONDITIONS,
        label: 'Show upsell based on cart value',
        description: 'Display upsells when cart total meets a threshold',
        helpText: 'This rule has higher priority than the global fallback',
    },
];

export const SAMPLE_UPSELL_PRODUCTS = [
    {
        id: 'sp-1',
        gid: 'gid://shopify/Product/8365147292',
        title: 'Premium Wireless Earbuds',
        price: 299,
        image: 'https://cdn.shopify.com/s/files/1/0604/9635/8808/products/earbud_400x400.jpg?v=1',
        description: 'High-quality audio with noise cancellation',
        sku: 'EARBUDS-001',
        variants: 3,
        status: 'active',
    },
    {
        id: 'sp-2',
        gid: 'gid://shopify/Product/8365147293',
        title: 'Protective Phone Case',
        price: 49,
        image: 'https://cdn.shopify.com/s/files/1/0604/9635/8808/products/case_400x400.jpg?v=1',
        description: 'Durable protection for all smartphone models',
        sku: 'CASE-001',
        variants: 5,
        status: 'active',
    },
    {
        id: 'sp-3',
        gid: 'gid://shopify/Product/8365147294',
        title: 'USB-C Cable Pack (3-Piece)',
        price: 39,
        image: 'https://cdn.shopify.com/s/files/1/0604/9635/8808/products/cable_400x400.jpg?v=1',
        description: 'Fast charging cables for all devices',
        sku: 'CABLE-003',
        variants: 2,
        status: 'active',
    },
    {
        id: 'sp-4',
        gid: 'gid://shopify/Product/8365147295',
        title: 'Portable Power Bank 20000mAh',
        price: 89,
        image: 'https://cdn.shopify.com/s/files/1/0604/9635/8808/products/powerbank_400x400.jpg?v=1',
        description: 'Quick charge your devices on the go',
        sku: 'POWER-001',
        variants: 2,
        status: 'active',
    },
    {
        id: 'sp-5',
        gid: 'gid://shopify/Product/8365147296',
        title: 'Screen Protector Glass (2-Pack)',
        price: 19,
        image: 'https://cdn.shopify.com/s/files/1/0604/9635/8808/products/glass_400x400.jpg?v=1',
        description: 'Tempered glass with HD clarity',
        sku: 'GLASS-002',
        variants: 1,
        status: 'active',
    },
    {
        id: 'sp-6',
        gid: 'gid://shopify/Product/8365147297',
        title: 'Premium Device Stand',
        price: 29,
        image: 'https://cdn.shopify.com/s/files/1/0604/9635/8808/products/stand_400x400.jpg?v=1',
        description: 'Adjustable stand for any device',
        sku: 'STAND-001',
        variants: 2,
        status: 'active',
    },
];

export const DEFAULT_UPSELL_CONFIG = {
    enabled: false,
    showOnEmptyCart: false,
    activeTemplate: UPSELL_STYLES.GRID,
    upsellTitle: {
        text: 'Recommended for you',
        color: '#111827',
        formatting: { bold: false, italic: false, underline: false },
    },
    rule1: {
        enabled: false,
        upsellProducts: [],
        upsellCollections: [],
    },
    rule2: {
        enabled: false,
        triggerProducts: [],
        triggerCollections: [],
        upsellProducts: [],
        upsellCollections: [],
    },
    rule3: {
        enabled: false,
        cartValueThreshold: 1000,
        upsellProducts: [],
        upsellCollections: [],
    },
};

/**
 * Reconstructs a full upsell configuration object from database rules.
 * Maps priority-based rules back to rule1, rule2, rule3 for UI compatibility.
 */
export function reconstructUpsellConfig(rules = []) {
    if (!rules || rules.length === 0) {
        return DEFAULT_UPSELL_CONFIG;
    }

    // Map the rules to their expected slots based on priority or known IDs
    const rule1 = rules.find(r => r.id === 'rule-1' || r.priority === 0) || rules[0];
    const rule2 = rules.find(r => r.id === 'rule-2' || r.priority === 1);
    const rule3 = rules.find(r => r.id === 'rule-3' || r.priority === 2);

    return {
        ...DEFAULT_UPSELL_CONFIG,
        enabled: rule1?.enabled || false,
        upsellMode: 'manual',
        position: 'bottom',
        layout: rule1?.layout || UPSELL_STYLES.GRID,
        alignment: 'horizontal',
        activeTemplate: rule1?.layout || UPSELL_STYLES.GRID,
        upsellTitle: {
            text: rule1?.title || 'Recommended for you',
            color: '#111827',
            formatting: { bold: false, italic: false, underline: false },
        },
        rule1: rule1 ? {
            enabled: rule1.enabled,
            upsellProducts: rule1.upsellProducts ? JSON.parse(rule1.upsellProducts) : [],
            upsellCollections: rule1.upsellCollections ? JSON.parse(rule1.upsellCollections) : [],
        } : DEFAULT_UPSELL_CONFIG.rule1,
        rule2: rule2 ? {
            enabled: rule2.enabled,
            triggerProducts: rule2.triggerProducts ? JSON.parse(rule2.triggerProducts) : [],
            triggerCollections: rule2.triggerCollections ? JSON.parse(rule2.triggerCollections) : [],
            upsellProducts: rule2.upsellProducts ? JSON.parse(rule2.upsellProducts) : [],
            upsellCollections: rule2.upsellCollections ? JSON.parse(rule2.upsellCollections) : [],
        } : DEFAULT_UPSELL_CONFIG.rule2,
        rule3: rule3 ? {
            enabled: rule3.enabled,
            cartValueThreshold: rule3.cartValueThreshold || 1000,
            upsellProducts: rule3.upsellProducts ? JSON.parse(rule3.upsellProducts) : [],
            upsellCollections: rule3.upsellCollections ? JSON.parse(rule3.upsellCollections) : [],
        } : DEFAULT_UPSELL_CONFIG.rule3,
    };
}

export function validateUpsellRule(config, allRules = []) {
    const hasGlobalRule = allRules.some(
        (rule) => rule.enabled && rule.ruleType === RULE_TYPES.GLOBAL && rule.id !== config.id
    );
    const hasGlobalExceptRule = allRules.some(
        (rule) => rule.enabled && rule.ruleType === RULE_TYPES.GLOBAL_EXCEPT && rule.id !== config.id
    );

    const currentRuleType = config.ruleType;

    if (currentRuleType === RULE_TYPES.GLOBAL && hasGlobalExceptRule) {
        return {
            valid: false,
            error: 'You can either apply upsells to all products or all products except selected ones — not both.',
        };
    }

    if (currentRuleType === RULE_TYPES.GLOBAL_EXCEPT && hasGlobalRule) {
        return {
            valid: false,
            error: 'You can either apply upsells to all products or all products except selected ones — not both.',
        };
    }

    if (config.enabled && currentRuleType === RULE_TYPES.TRIGGERED) {
        if (
            (!config.triggerProducts || config.triggerProducts.length === 0) &&
            (!config.triggerCollections || config.triggerCollections.length === 0)
        ) {
            return {
                valid: false,
                error: 'Triggered rule requires at least one trigger product or collection',
            };
        }
    }

    if (config.enabled && currentRuleType === RULE_TYPES.GLOBAL_EXCEPT) {
        if (
            (!config.excludedProducts || config.excludedProducts.length === 0) &&
            (!config.excludedCollections || config.excludedCollections.length === 0)
        ) {
            return {
                valid: false,
                error: 'Global-except rule requires at least one excluded product or collection',
            };
        }
    }

    if (config.enabled &&
        (!config.upsellProducts || config.upsellProducts.length === 0) &&
        (!config.upsellCollections || config.upsellCollections.length === 0)
    ) {
        return {
            valid: false,
            error: 'At least one upsell product or collection must be selected',
        };
    }

    if (config.limit != null && (config.limit < 1 || config.limit > 4)) {
        return {
            valid: false,
            error: 'Upsell limit must be between 1 and 4',
        };
    }

    return { valid: true };
}

export function evaluateUpsellRules(rules, cartProductIds = [], cartTotal = 0) {
    if (!rules || rules.length === 0) {
        return null;
    }

    const activeRules = rules.filter((rule) => rule.enabled);

    for (const rule of activeRules) {
        if (rule.ruleType === RULE_TYPES.TRIGGERED) {
            const triggers = [...(rule.triggerProducts || []), ...(rule.triggerCollections || [])];
            const hasMatch = triggers.some((triggerId) => cartProductIds.includes(triggerId));
            if (hasMatch) {
                return rule;
            }
        }
    }

    for (const rule of activeRules) {
        if (rule.ruleType === RULE_TYPES.CART_CONDITIONS) {
            const threshold = Number(rule.cartValueThreshold || 0);
            if (threshold > 0 && cartTotal >= threshold) {
                return rule;
            }
        }
    }

    for (const rule of activeRules) {
        if (rule.ruleType === RULE_TYPES.GLOBAL_EXCEPT) {
            const exclusions = [...(rule.excludedProducts || []), ...(rule.excludedCollections || [])];
            const hasExcluded = exclusions.some((excludedId) => cartProductIds.includes(excludedId));
            if (!hasExcluded) {
                return rule;
            }
        }
    }

    const globalRule = activeRules.find((rule) => rule.ruleType === RULE_TYPES.GLOBAL);
    return globalRule || null;
}

export function canEnableRuleType(ruleType, existingRules = []) {
    const activeRules = existingRules.filter((rule) => rule.enabled);

    if (ruleType === RULE_TYPES.GLOBAL) {
        const hasGlobalExcept = activeRules.some((rule) => rule.ruleType === RULE_TYPES.GLOBAL_EXCEPT);
        if (hasGlobalExcept) {
            return {
                canEnable: false,
                reason: 'Global upsell and global-except upsell cannot be used together.',
            };
        }
    }

    if (ruleType === RULE_TYPES.GLOBAL_EXCEPT) {
        const hasGlobal = activeRules.some((rule) => rule.ruleType === RULE_TYPES.GLOBAL);
        if (hasGlobal) {
            return {
                canEnable: false,
                reason: 'Global upsell and global-except upsell cannot be used together.',
            };
        }
    }

    return { canEnable: true };
}

export function getProductById(productId) {
    return SAMPLE_UPSELL_PRODUCTS.find((p) => p.id === productId);
}

export function getProductsByIds(productIds) {
    return productIds
        .map((id) => getProductById(id))
        .filter((p) => p !== undefined);
}

export function trackUpsellEvent(event, data = {}) {
    console.log(`[Analytics] ${event}:`, {
        timestamp: new Date().toISOString(),
        ...data,
    });

    if (typeof sessionStorage !== 'undefined') {
        const events = JSON.parse(sessionStorage.getItem('upsell_events') || '[]');
        events.push({
            event,
            data,
            timestamp: new Date().toISOString(),
        });
        sessionStorage.setItem('upsell_events', JSON.stringify(events));
    }
}

export function getTrackedEvents() {
    return JSON.parse(sessionStorage.getItem('upsell_events') || '[]');
}

export function clearTrackedEvents() {
    sessionStorage.removeItem('upsell_events');
}

export async function addToCartViaShopifyAPI(productGid, quantity = 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
        success: true,
        message: 'Product added to cart',
        cartData: {
            itemCount: 5,
            totalPrice: '499.99',
            lastAddedItem: {
                gid: productGid,
                quantity,
            },
        },
    };
}

// ==========================================
// PRODUCT PAGE COUPON SLIDER CONFIGURATION
// ==========================================

export const PRODUCT_COUPON_SLIDER_STYLES = {
    MINIMAL: 'minimal',
    CARD: 'card',
    BANNER: 'banner',
};

export const PRODUCT_COUPON_SLIDER_STYLE_OPTIONS = [
    { value: PRODUCT_COUPON_SLIDER_STYLES.MINIMAL, label: 'Minimal', description: 'Clean, simple design' },
    { value: PRODUCT_COUPON_SLIDER_STYLES.CARD, label: 'Card', description: 'Rounded card layout' },
    { value: PRODUCT_COUPON_SLIDER_STYLES.BANNER, label: 'Banner', description: 'Full-width banner' },
];

export const PRODUCT_COUPON_SLIDER_ALIGNMENTS = {
    LEFT: 'left',
    CENTER: 'center',
    RIGHT: 'right',
};

export const DEFAULT_PRODUCT_COUPON_SLIDER_CONFIG = {
    enabled: false,
    uiEditor: {
        selectedCoupons: [],
        sliderStyle: PRODUCT_COUPON_SLIDER_STYLES.CARD,
        textAlignment: PRODUCT_COUPON_SLIDER_ALIGNMENTS.CENTER,
        autoSlide: false,
        slideInterval: 5,
        copyButtonText: 'Copy Code',
        colors: {
            backgroundColor: '#ffffff',
            textColor: '#111827',
            buttonColor: '#2c6ecb',
        },
    },
    conditions: {
        productScope: 'all', // 'all', 'specific-products', 'specific-collections'
        selectedProducts: [],
        selectedCollections: [],
        excludeProducts: false,
        excludedProducts: [],
        deviceVisibility: {
            desktop: true,
            mobile: true,
        },
    },
    draftState: null,
};

// ==========================================
// SAMPLE APP DATA
// ==========================================

export const SAMPLE_APP_DATA = {
    cartStatus: true,
    previewCartState: 'items',
    selectedTab: 'progress-bar',
    featureStates: {
        progressBarEnabled: true,
        couponSliderEnabled: true,
        upsellEnabled: true,
    },
    productCouponSlider: {
        ...DEFAULT_PRODUCT_COUPON_SLIDER_CONFIG,
    },
    progressBarSettings: {
        showOnEmpty: true,
        barBackgroundColor: '#e5e7eb',
        barForegroundColor: '#93D3FF',
        completionText: 'Free shipping unlocked!',
        rewardsCalculation: ['cartTotal'],
        tiers: [
            {
                id: 1,
                rewardType: 'product',
                minValue: 500,
                description: 'Free Shipping',
                titleBeforeAchieving: "You're {COUNT} away from Free Shipping",
                products: ['sp-1', 'sp-2'],
            },
        ],
    },
    couponSliderSettings: {
        enabled: true,
        sectionSettings: {
            section_title: 'Available offers',
            section_title_color: '#111827',
            section_title_font_size: 14,
            section_title_font_weight: 700,
            section_background_color: '#fef3c7',
            section_padding: 12,
            section_border_radius: 10,
        },
        cardStyleSettings: {
            card_background_color: '#ffffff',
            card_border_color: '#fcd34d',
            card_border_width: 1,
            card_border_radius: 8,
            card_shadow: true,
            card_padding: 10,
            card_gap_between_cards: 8,
        },
        offers: [
            {
                id: 'co-1',
                coupon_code_text: 'SAVE10',
                coupon_code_color: '#111827',
                coupon_code_font_size: 14,
                coupon_code_font_weight: 700,
                coupon_code_letter_spacing: 1,
                description_text: 'Save 10% on qualifying orders',
                description_color: '#4b5563',
                description_font_size: 12,
                description_font_weight: 500,
                description_line_height: 1.4,
                button_text: 'Copy code',
                button_text_color: '#ffffff',
                button_background_color: '#111827',
                button_font_size: 12,
                button_font_weight: 600,
                button_padding_top_bottom: 6,
                button_padding_left_right: 12,
                button_border_radius: 6,
                button_border_color: '#111827',
                button_border_width: 1,
                show_button: true,
                icon_image_url: 'https://via.placeholder.com/40',
                icon_width: 32,
                icon_height: 32,
                icon_border_radius: 8,
                icon_background_color: '#fef3c7',
                icon_alignment: 'left',
                show_icon: true,
                discount_type: 'percentage',
                discount_value: 10,
                minimum_order_value: 500,
                is_enabled: true,
            },
            {
                id: 'co-2',
                coupon_code_text: 'FLAT75',
                coupon_code_color: '#111827',
                coupon_code_font_size: 14,
                coupon_code_font_weight: 700,
                coupon_code_letter_spacing: 1,
                description_text: 'Special discount on your first order',
                description_color: '#4b5563',
                description_font_size: 12,
                description_font_weight: 500,
                description_line_height: 1.4,
                button_text: 'Apply now',
                button_text_color: '#ffffff',
                button_background_color: '#0f172a',
                button_font_size: 12,
                button_font_weight: 600,
                button_padding_top_bottom: 6,
                button_padding_left_right: 12,
                button_border_radius: 6,
                button_border_color: '#0f172a',
                button_border_width: 1,
                show_button: true,
                icon_image_url: 'https://via.placeholder.com/40',
                icon_width: 32,
                icon_height: 32,
                icon_border_radius: 8,
                icon_background_color: '#e0f2fe',
                icon_alignment: 'left',
                show_icon: true,
                discount_type: 'flat',
                discount_value: 75,
                minimum_order_value: 0,
                is_enabled: true,
            },
            {
                id: 'co-3',
                coupon_code_text: 'SHIPFREE',
                coupon_code_color: '#111827',
                coupon_code_font_size: 14,
                coupon_code_font_weight: 700,
                coupon_code_letter_spacing: 1,
                description_text: 'Free shipping on qualifying orders',
                description_color: '#4b5563',
                description_font_size: 12,
                description_font_weight: 500,
                description_line_height: 1.4,
                button_text: 'Reveal code',
                button_text_color: '#0f172a',
                button_background_color: '#ffffff',
                button_font_size: 12,
                button_font_weight: 600,
                button_padding_top_bottom: 6,
                button_padding_left_right: 12,
                button_border_radius: 6,
                button_border_color: '#0f172a',
                button_border_width: 1,
                show_button: false,
                icon_image_url: 'https://via.placeholder.com/40',
                icon_width: 32,
                icon_height: 32,
                icon_border_radius: 8,
                icon_background_color: '#dcfce7',
                icon_alignment: 'top',
                show_icon: true,
                discount_type: 'flat',
                discount_value: 0,
                minimum_order_value: 900,
                is_enabled: false,
            },
        ],
    },
    upsellSettings: {
        enabled: true,
        showOnEmptyCart: false,
        useAIRecommendation: false,
        aiRecommendationType: 'related',
        useManualUpsell: true,
        manualTriggerMode: 'all',
        triggeredProducts: [],
        triggeredCollections: [],
        upsellProducts: ['sp-2', 'sp-6', 'sp-8'],
        title: 'Recommended for you',
        titleFormatting: { bold: false, italic: false, underline: false },
        buttonStyle: 'box',
        position: 'bottom',
        layout: 'grid',
        alignment: 'horizontal',
        showNavigationArrows: true,
        showProductReviews: false,
        ruleType: 'MANUAL',
        trigger: 'ANY_CART',
        products: ['sp-2', 'sp-4', 'sp-6'],
        limit: 3,
        manualRules: [],
        ui: {
            layout: 'slider',
            buttonText: 'Add to Cart',
            buttonColor: '#000000',
            showPrice: true,
            title: 'Recommended for you',
            position: 'bottom',
        },
        analytics: {
            trackViews: true,
            trackClicks: true,
            trackAddToCart: true,
        },
    },
    cartData: {
        cartValue: 640,
        totalQuantity: 3,
        items: [
            {
                id: 1,
                title: 'Premium T-Shirt',
                price: 320,
                qty: 2,
                image: '👕',
            },
            {
                id: 2,
                title: 'Classic Cap',
                price: 0,
                qty: 1,
                image: '🧢',
            },
        ],
    },
    milestones: {
        amount: [
            {
                id: 'm1',
                type: 'amount',
                target: 500,
                label: 'First Milestone',
                rewardText: 'Free Shipping',
                associatedProducts: ['sp-1'],
            },
            {
                id: 'm2',
                type: 'amount',
                target: 1000,
                label: 'Second Milestone',
                rewardText: 'Free Gift',
                associatedProducts: ['sp-2'],
            },
        ],
        quantity: [
            {
                id: 'qm1',
                type: 'quantity',
                target: 5,
                label: '5 items',
                rewardText: '10% OFF',
                associatedProducts: ['sp-3'],
            },
            {
                id: 'qm2',
                type: 'quantity',
                target: 10,
                label: '10 items',
                rewardText: 'Free Surprise Gift',
                associatedProducts: ['sp-4'],
            },
        ],
    },
};
