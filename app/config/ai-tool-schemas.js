// The BRIX agent's full tool registry — plain data, no server-only imports,
// shared between the OpenAI native `tools` param and the NVIDIA prompted-mode
// tool listing (see app/services/ai-llm.server.js's agentTurn). Each tool's
// `parameters` is a JSON-schema object; `name`/`description` double as the
// prompted-mode text listing.
//
// Naming note: this app overloads the word "position" four different ways
// (cart drawer side, progress-bar placement, coupon-slider position, upsell
// position). update_general uses `drawerSide` specifically to avoid the
// model cross-wiring "move it to the left" into the wrong tool.

export const TOOL_REGISTRY = [
  // ── Reads (no credit charge — see api.ai.chat.jsx) ──────────────────────
  {
    name: 'get_current_config',
    description: 'Read the full current cart drawer configuration (design, header, announcements, progress bar, coupon slider, upsell products, FBT, countdown timer, empty cart, checkout button, custom CSS). Use this before making changes if you need to know current values, or to answer a question about current settings.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_products',
    description: 'Search the store\'s product catalog by name. Use this to find a product\'s exact title/ID before referencing it in create_upsell_rule, create_fbt_rule, etc.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name or partial name to search for' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_collections',
    description: 'Search the store\'s collections by name. Use this to find a collection\'s exact title/ID before referencing it in create_combo_template.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Collection name or partial name to search for' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_store_insights',
    description: 'Read-only snapshot of which revenue modules are enabled/disabled, this month\'s AOV/order count (if unlocked and enough order history), and a catalog summary (product count, price range, out-of-stock items) as a fallback. Use this to answer questions like "how can I increase my AOV" or "what should I turn on".',
    parameters: { type: 'object', properties: {}, required: [] },
  },

  // ── Cart drawer config writes (all funnel through saveCartDrawerConfig) ──
  {
    name: 'set_cart_drawer_enabled',
    description: 'Turn the entire Cart Drawer on or off. Turning it OFF replaces the customized drawer with Shopify\'s default cart on the storefront — this is destructive and requires confirmation.',
    parameters: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
    },
  },
  {
    name: 'update_design',
    description: 'Update the cart drawer\'s overall design/layout: width, corner rounding, shadow, open animation. Does not touch colors (use update_header/update_checkout_button/update_announcements for those).',
    parameters: {
      type: 'object',
      properties: {
        design_width: { type: 'string', enum: ['normal', 'wide', 'narrow'], description: 'Drawer width' },
        design_border_radius: { type: 'number', description: 'Corner radius in px' },
        design_shadow: { type: 'boolean', description: 'Whether the drawer has a drop shadow' },
        design_animation: { type: 'string', enum: ['slide', 'fade', 'bounce', 'zoom', 'push', 'none'], description: 'Open animation style' },
      },
      required: [],
    },
  },
  {
    name: 'update_general',
    description: 'Update general cart drawer behavior: which side it opens from, and whether it auto-opens when a product is added / when the cart icon is clicked.',
    parameters: {
      type: 'object',
      properties: {
        drawerSide: { type: 'string', enum: ['left', 'right'], description: 'Which side of the screen the drawer slides in from' },
        open_on_add: { type: 'boolean', description: 'Auto-open the drawer when a product is added to cart' },
        open_on_icon_click: { type: 'boolean', description: 'Open the drawer when the cart icon is clicked' },
      },
      required: [],
    },
  },
  {
    name: 'update_header',
    description: 'Update the cart drawer\'s header: title text, close-button style, background/text colors, and whether there\'s a bottom border.',
    parameters: {
      type: 'object',
      properties: {
        header_title: { type: 'string' },
        header_close_style: { type: 'string', enum: ['icon', 'text'] },
        header_bg_color: { type: 'string', description: 'Hex color, e.g. #ffffff' },
        header_text_color: { type: 'string', description: 'Hex color' },
        header_border_bottom: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'update_announcements',
    description: 'Update the announcement bar shown below the header (e.g. "Free shipping over $50"): enable/disable, text, colors, font size, bold/italic, alignment.',
    parameters: {
      type: 'object',
      properties: {
        announcement_enabled: { type: 'boolean' },
        announcement_text: { type: 'string' },
        announcement_bg_color: { type: 'string' },
        announcement_text_color: { type: 'string' },
        announcement_font_size: { type: 'number' },
        announcement_bold: { type: 'boolean' },
        announcement_italic: { type: 'boolean' },
        announcement_text_align: { type: 'string', enum: ['left', 'center', 'right'] },
      },
      required: [],
    },
  },
  {
    name: 'update_empty_cart',
    description: 'Update what customers see when their cart is empty: the message, and whether to show a "Continue shopping" button / recommended products.',
    parameters: {
      type: 'object',
      properties: {
        empty_cart_message: { type: 'string' },
        empty_cart_show_continue_shopping: { type: 'boolean' },
        empty_cart_show_recommendations: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'update_checkout_button',
    description: 'Update the checkout button: its text, footer text below it, background/text colors, and corner radius.',
    parameters: {
      type: 'object',
      properties: {
        checkout_button_text: { type: 'string' },
        checkout_footer_text: { type: 'string' },
        checkout_button_bg_color: { type: 'string' },
        checkout_button_text_color: { type: 'string' },
        checkout_button_border_radius: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'update_custom_css',
    description: 'Set the cart drawer\'s custom CSS override. Passing an empty string clears existing custom CSS — that is destructive and requires confirmation.',
    parameters: {
      type: 'object',
      properties: { custom_css: { type: 'string' } },
      required: ['custom_css'],
    },
  },
  {
    name: 'update_countdown_timer',
    description: 'Update the cart drawer\'s urgency countdown timer: enable/disable, duration (hours/minutes), session vs fixed mode, label text, colors, and an optional linked coupon code.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        mode: { type: 'string', enum: ['session', 'fixed'], description: 'session = resets each visit, fixed = counts down once per device' },
        hours: { type: 'number' },
        minutes: { type: 'number' },
        label: { type: 'string' },
        expiredLabel: { type: 'string' },
        bgColor: { type: 'string' },
        textColor: { type: 'string' },
        accentColor: { type: 'string' },
        couponMode: { type: 'string', enum: ['manual', 'none'] },
        couponCode: { type: 'string' },
      },
      required: [],
    },
  },

  // ── Progress bar (3 tools — see cart-config-writes.server.js's comment on
  //    why style/goal/tiers are split rather than one do-everything tool) ──
  {
    name: 'update_progress_bar',
    description: 'Update the free-shipping/spending progress bar\'s style and toggle: enable/disable, placement, colors, corner radius, completion message, confetti. Does NOT change the goal amount or reward tiers — use set_progress_bar_goal or update_progress_bar_tiers for that.',
    parameters: {
      type: 'object',
      properties: {
        is_enabled: { type: 'boolean' },
        mode: { type: 'string', enum: ['amount', 'quantity'] },
        show_on_empty: { type: 'boolean' },
        bar_background_color: { type: 'string' },
        bar_foreground_color: { type: 'string' },
        icon_color: { type: 'string' },
        border_radius: { type: 'number' },
        placement: { type: 'string', enum: ['top', 'bottom'] },
        completion_text: { type: 'string' },
        completion_text_color: { type: 'string' },
        enable_confetti: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'set_progress_bar_goal',
    description: 'Turn on the progress bar with a simple single-goal setup — e.g. "free shipping at $75". Sets the goal amount and reward type on the primary tier and enables the progress bar. For multi-tier setups, use update_progress_bar_tiers instead.',
    parameters: {
      type: 'object',
      properties: {
        goalAmount: { type: 'number', description: 'Spend amount required to unlock the reward' },
        rewardType: { type: 'string', enum: ['free_shipping', 'product', 'discount', 'gift'], description: '"product" = a specific named free item (e.g. "free denim shirt"); "gift" = an unspecified/surprise reward' },
        placement: { type: 'string', enum: ['top', 'bottom'] },
      },
      required: ['goalAmount'],
    },
  },
  {
    name: 'update_progress_bar_tiers',
    description: 'Replace the entire progress bar reward-tier ladder with a new set of tiers (multi-tier setup). This fully replaces all existing tiers — only use when the merchant wants to define the whole ladder.',
    parameters: {
      type: 'object',
      properties: {
        tiers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              min_value: { type: 'number' },
              description: { type: 'string' },
              reward_type: { type: 'string', enum: ['free_shipping', 'product', 'discount', 'gift'], description: '"product" = a specific named free item (e.g. "free denim shirt"); "gift" = an unspecified/surprise reward' },
              icon_preset: { type: 'string' },
            },
          },
        },
      },
      required: ['tiers'],
    },
  },

  // ── Coupon slider ────────────────────────────────────────────────────────
  {
    name: 'update_coupon_slider',
    description: 'Update the coupon slider widget: enable/disable, template, title text/color/alignment, card colors/borders, auto-slide, layout, position, and which coupons are selected to display.',
    parameters: {
      type: 'object',
      properties: {
        is_enabled: { type: 'boolean' },
        selected_template: { type: 'string' },
        title_text: { type: 'string' },
        title_color: { type: 'string' },
        title_font_size: { type: 'number' },
        title_alignment: { type: 'string', enum: ['left', 'center', 'right'] },
        section_bg_color: { type: 'string' },
        card_bg_color: { type: 'string' },
        card_border_color: { type: 'string' },
        card_border_radius: { type: 'number' },
        card_shadow: { type: 'boolean' },
        auto_slide: { type: 'boolean' },
        slide_interval: { type: 'number' },
        position: { type: 'string', enum: ['top', 'bottom'] },
        layout: { type: 'string', enum: ['grid', 'list'] },
      },
      required: [],
    },
  },

  // ── Upsell products ──────────────────────────────────────────────────────
  {
    name: 'update_upsell_products',
    description: 'Update the upsell products widget\'s style: enable/disable, title, layout, button style, position, how many products to show. Does not create or remove upsell rules — use create_upsell_rule/remove_upsell_rule for that.',
    parameters: {
      type: 'object',
      properties: {
        is_enabled: { type: 'boolean' },
        title: { type: 'string' },
        title_color: { type: 'string' },
        show_on_empty_cart: { type: 'boolean' },
        layout: { type: 'string', enum: ['grid', 'carousel'] },
        button_text: { type: 'string' },
        button_bg_color: { type: 'string' },
        button_text_color: { type: 'string' },
        button_border_radius: { type: 'number' },
        show_price: { type: 'boolean' },
        position: { type: 'string', enum: ['top', 'bottom'] },
        display_limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'create_upsell_rule',
    description: 'Add an upsell rule: when a customer adds the trigger product to their cart, the offer product is recommended. Also enables the upsell widget if it isn\'t already on.',
    parameters: {
      type: 'object',
      properties: {
        triggerProductName: { type: 'string', description: 'Name of the product that triggers the recommendation' },
        offerProductName: { type: 'string', description: 'Name of the product to recommend' },
      },
      required: ['triggerProductName', 'offerProductName'],
    },
  },
  {
    name: 'remove_upsell_rule',
    description: 'Delete an existing upsell rule by its ID. Destructive — requires confirmation.',
    parameters: {
      type: 'object',
      properties: { ruleId: { type: 'string' } },
      required: ['ruleId'],
    },
  },

  // ── FBT (Frequently Bought Together) ────────────────────────────────────
  {
    name: 'update_fbt_widget',
    description: 'Update the Frequently Bought Together widget\'s style: enable/disable, template (fbt1/fbt2/fbt3), mode (manual/ai), colors, layout, interaction type.',
    parameters: {
      type: 'object',
      properties: {
        is_enabled: { type: 'boolean' },
        selected_template: { type: 'string', enum: ['fbt1', 'fbt2', 'fbt3'], description: 'fbt1=Classic Grid, fbt2=Modern Cards, fbt3=Vertical List' },
        mode: { type: 'string', enum: ['manual', 'ai'] },
        bg_color: { type: 'string' },
        text_color: { type: 'string' },
        price_color: { type: 'string' },
        button_color: { type: 'string' },
        button_text_color: { type: 'string' },
        button_text: { type: 'string' },
        border_color: { type: 'string' },
        border_radius: { type: 'number' },
        layout: { type: 'string', enum: ['carousel', 'grid', 'vertical'], description: 'Applies to any template: carousel scrolls horizontally, grid is a 2-column grid, vertical is a stacked list.' },
        interaction_type: { type: 'string', enum: ['classic', 'bundle', 'quickAdd', 'checkboxQty'] },
        show_prices: { type: 'boolean' },
        show_add_all_button: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'create_fbt_rule',
    description: 'Add a Frequently Bought Together rule: when a customer views/has one of the trigger products (or any product, if no trigger given) in their cart, the offer products are recommended together. Also enables the FBT widget if it isn\'t already on.',
    parameters: {
      type: 'object',
      properties: {
        triggerProductNames: { type: 'array', items: { type: 'string' }, description: 'Products that trigger this rule; omit/empty to apply to all products' },
        offerProductNames: { type: 'array', items: { type: 'string' }, description: 'Products to recommend together' },
        discountType: { type: 'string', enum: ['none', 'percentage', 'fixed'] },
        discountValue: { type: 'number' },
      },
      required: ['offerProductNames'],
    },
  },
  {
    name: 'remove_fbt_rule',
    description: 'Delete an existing Frequently Bought Together rule by its ID. Destructive — requires confirmation.',
    parameters: {
      type: 'object',
      properties: { ruleId: { type: 'string' } },
      required: ['ruleId'],
    },
  },

  // ── Discounts ────────────────────────────────────────────────────────────
  {
    name: 'create_discount',
    description: 'Create a real Shopify percentage-off discount code.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The discount code customers enter, e.g. SUMMER20' },
        title: { type: 'string', description: 'Internal display name; if omitted, a sensible default is generated' },
        percentage: { type: 'number', description: 'Percent off, 0-100' },
        minimumAmount: { type: 'number' },
        endDate: { type: 'string', description: 'ISO 8601 date' },
        usageLimit: { type: 'number' },
        onePerCustomer: { type: 'boolean' },
      },
      required: ['percentage'],
    },
  },
  {
    name: 'delete_discount',
    description: 'Delete an existing Shopify discount code by its ID. Destructive — requires confirmation.',
    parameters: {
      type: 'object',
      properties: { discountId: { type: 'string' } },
      required: ['discountId'],
    },
  },

  // ── Combo Forge ──────────────────────────────────────────────────────────
  {
    name: 'create_combo_template',
    description: 'Create a new bundle/combo page draft using Combo Forge.',
    parameters: {
      type: 'object',
      properties: {
        layout: { type: 'string', enum: ['layout1', 'layout2', 'layout4'], description: 'layout1=Guided Architect (step-by-step), layout2=Velocity Stream (tab switcher), layout4=Editorial Split (single grid)' },
        collectionName: { type: 'string', description: 'Name of the collection to pull products from' },
        discountPercentage: { type: 'number', description: '0 for no discount' },
        templateName: { type: 'string', description: 'Name for the bundle page' },
      },
      required: ['layout', 'collectionName', 'templateName'],
    },
  },

  // ── Theme ────────────────────────────────────────────────────────────────
  {
    name: 'match_store_theme',
    description: 'Detect the live storefront theme\'s colors and apply them immediately to the cart drawer\'s header and checkout button, so the drawer visually matches the store. Use this ONLY when the merchant explicitly asks to "match my theme" / "match my site" / references copying their live storefront\'s exact look. For any other color request — a creative suggestion, "suggest a palette", "make it look premium", "give me some color options" — use suggest_theme_colors instead so the merchant can review and edit before anything is saved.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'suggest_theme_colors',
    description: 'Propose 4 complete color combinations for the cart drawer\'s header and checkout button WITHOUT saving anything yet — renders an interactive card with 4 clickable swatches, one per combo. Use this for any color-suggestion request that isn\'t an explicit "match my exact theme" request (see match_store_theme): "suggest colors", "give me a premium palette", "show me some options", "make my cart look modern" (when colors are the ask), etc. Do not follow this with update_header/update_checkout_button yourself — applying happens only when the merchant clicks one of the combos in the card.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'apply_theme_colors',
    description: 'Apply specific header/checkout button colors. Internal — used when the merchant clicks Apply on a suggest_theme_colors card, not called directly from a chat message.',
    parameters: {
      type: 'object',
      properties: {
        headerBgColor: { type: 'string', description: 'Header background hex color' },
        headerTextColor: { type: 'string', description: 'Header text hex color' },
        checkoutBgColor: { type: 'string', description: 'Checkout button background hex color' },
        checkoutTextColor: { type: 'string', description: 'Checkout button text hex color' },
      },
      required: [],
    },
  },
];

// Destructive actions pause for a lightweight Confirm/Cancel instead of
// executing immediately (see api.ai.chat.jsx's agent loop) — everything else
// in the registry above executes right away. Predicate-based (not just a
// name list) since e.g. editing custom CSS isn't destructive but clearing it
// to empty is.
export function isDestructiveToolCall(name, args) {
  if (name === 'set_cart_drawer_enabled') return args?.enabled === false;
  if (name === 'update_custom_css') return !String(args?.custom_css || '').trim();
  if (name === 'remove_upsell_rule') return true;
  if (name === 'remove_fbt_rule') return true;
  if (name === 'delete_discount') return true;
  return false;
}
