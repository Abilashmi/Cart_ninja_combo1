export const BRAND = {
  primary: "#FF6B00",
  secondary: "#FF8A33",
  lightBg: "#FFF3EB",
  glow: "rgba(255, 107, 0, 0.2)",
  gradient: "linear-gradient(135deg, #FF6B00, #FF8A33)",
};

export const QUICK_ACTIONS = [
  { label: "Enable Cart Drawer", prompt: "Enable the cart drawer for my store." },
  { label: "Increase AOV", prompt: "Help me increase average order value with upsells and a free shipping goal bar." },
  { label: "Create Bundle Offer", prompt: "Create a bundle offer with discounted pricing for complementary products." },
  { label: "Optimize Mobile Design", prompt: "Optimize my cart layout and design for mobile shoppers." },
  { label: "Setup Free Shipping Goal", prompt: "Setup a free shipping progress bar with a 500 goal." },
  { label: "Analyze Conversion Funnel", prompt: "Analyze my conversion funnel and identify drop-off points." },
  { label: "Review Cart Performance", prompt: "Review my cart performance metrics and suggest improvements." },
  { label: "Customize Cart Theme", prompt: "Customize my cart theme to match my store branding." },
  { label: "Generate Upsell Campaign", prompt: "Generate an upsell campaign with product recommendations." },
  { label: "Create Discount Strategy", prompt: "Create a discount strategy to improve conversions and AOV." },
];

export const PAGE_AWARE_PROMPTS = {
  "/app": [
    "Show me the dashboard overview",
    "What's my current conversion rate?",
    "Review my store performance",
    "Show me quick wins for today",
  ],
  "/app/cartdrawer": [
    "Enable cart drawer",
    "Match my theme colors",
    "Make cart look premium",
    "Optimize for mobile",
    "Add trust badges",
    "Change border radius",
  ],
  "/app/analytics": [
    "Analyze my conversion funnel",
    "Show revenue trends",
    "What's my AOV trend?",
    "Identify drop-off points",
    "Cart abandonment analysis",
  ],
  "/app/upsell": [
    "Create upsell campaign",
    "Add product recommendations",
    "Optimize upsell placement",
    "Generate cross-sell suggestions",
  ],
  "/app/fbt": [
    "Enable FBT recommendations",
    "Configure FBT widget",
    "Add frequently bought together",
    "Optimize product suggestions",
  ],
  "/app/bundles": [
    "Create bundle offer",
    "Setup combo pricing",
    "Add product bundles",
    "Configure bundle templates",
  ],
  "/app/coupons": [
    "Create discount strategy",
    "Setup coupon campaign",
    "Enable coupon slider",
    "Configure coupon banner",
  ],
  "/app/setup": [
    "Guide me through setup",
    "What modules should I enable?",
    "Show me getting started steps",
    "Configure my first feature",
  ],
};

export const WELCOME_MESSAGE = `Cart Ninja AI Agent connected to store. Awaiting your instructions.`;

export const PREDICTIVE_SUGGESTIONS = [
  { prefix: "enable free", suggestions: ["Enable Free Shipping Bar", "Enable Free Gift Offer", "Enable Free Shipping Goal"] },
  { prefix: "create", suggestions: ["Create Upsell Campaign", "Create Bundle Offer", "Create Product Recommendations", "Create Discount Strategy"] },
  { prefix: "configure", suggestions: ["Configure Cart Drawer", "Configure Progress Bar", "Configure Trust Badges", "Configure Coupon Slider"] },
  { prefix: "analyze", suggestions: ["Analyze Conversion Funnel", "Analyze Revenue Trends", "Analyze Cart Abandonment", "Analyze Product Performance"] },
  { prefix: "optimize", suggestions: ["Optimize Mobile Layout", "Optimize Checkout Flow", "Optimize Product Recommendations", "Optimize Cart Design"] },
  { prefix: "setup", suggestions: ["Setup Free Shipping Goal", "Setup Bundle Offer", "Setup Discount Campaign", "Setup Product Widget"] },
  { prefix: "show", suggestions: ["Show Module Status", "Show Revenue Dashboard", "Show Active Campaigns", "Show Performance Metrics"] },
  { prefix: "enable", suggestions: ["Enable Cart Drawer", "Enable Progress Bar", "Enable Upsells", "Enable FBT Widget", "Enable Trust Badges"] },
];

export const ONBOARDING_GOALS = [
  { key: "design", label: "Improve Cart Design", prompt: "Make my cart look more modern and premium, matching my store's branding." },
  { key: "sales", label: "Increase Sales", prompt: "Help me increase sales add upsells a free shipping goal bar and frequently bought together recommendations." },
  { key: "mobile", label: "Improve Mobile Experience", prompt: "Optimize my cart for mobile shoppers with a cleaner easier-to-use layout." },
  { key: "recommendations", label: "Add Product Recommendations", prompt: "Add upsell and frequently bought together product recommendations to my cart." },
  { key: "branding", label: "Match Store Branding", prompt: "Enable the cart drawer and match its colors fonts and styling to my store theme." },
  { key: "abandonment", label: "Reduce Cart Abandonment", prompt: "Help reduce cart abandonment with trust badges secure checkout messaging and a free shipping progress bar." },
];

export const EXAMPLE_PROMPTS = [
  "Enable Cart Drawer",
  "Optimize Mobile Layout",
  "Setup Free Shipping Goal",
  "Revenue Analysis",
  "Cart Performance Report",
];

export const BEST_PRACTICES = [
  { title: "Use specific instructions", body: "\"Enable the cart drawer and use a 12px rounded corner style\" works better than \"make it nicer\"." },
  { title: "Mention your goals", body: "Tell the AI what you're optimizing for e.g. \"increase average order value\" or \"reduce cart abandonment\"." },
  { title: "Mention design preferences", body: "Reference a look and feel premium minimal playful or ask it to match your store's branding." },
  { title: "Mention mobile optimization", body: "If most of your traffic is mobile say so the AI will prioritize layout and tap-target changes." },
];

export const ONBOARDING_STORAGE_KEY = "cartNinja_aiAgent_onboarding_seen";

export const UNRELATED_RESPONSE = "Sorry, I can only assist with Cart Ninja features, cart optimization, store analytics, offers, upsells, revenue growth, and related ecommerce workflows.";
