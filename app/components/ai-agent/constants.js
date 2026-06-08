// Shared copy for The Cart Ninja AI workspace — quick actions, onboarding goals,
// example prompts and best-practice tips. Kept separate from the components so
// the same library of suggestions can be reused by the prompt box, onboarding
// modal and Help & Learn panel.

export const QUICK_ACTIONS = [
    { label: "Match My Theme", prompt: "Enable the cart drawer and design it to match my store's theme colors and font." },
    { label: "Enable Cart Drawer", prompt: "Enable the cart drawer for my store." },
    { label: "Increase AOV", prompt: "Help me increase average order value with upsells and a free shipping goal bar." },
    { label: "Add Upsells", prompt: "Add upsell product recommendations inside the cart." },
    { label: "Add FBT Recommendations", prompt: "Add frequently bought together recommendations to my product pages." },
    { label: "Add Free Shipping Goal Bar", prompt: "Add a free shipping progress bar that encourages bigger orders." },
    { label: "Optimize For Mobile", prompt: "Optimize my cart layout and design for mobile shoppers." },
    { label: "Premium Cart Design", prompt: "Make my cart look premium and high-end, matching a luxury template." },
    { label: "Improve Conversions", prompt: "Improve my cart to reduce abandonment and increase conversions." },
    { label: "Add Trust Badges", prompt: "Add trust badges and secure checkout messaging to the cart." },
];

export const ONBOARDING_GOALS = [
    { key: "design", label: "Improve Cart Design", prompt: "Make my cart look more modern and premium, matching my store's branding." },
    { key: "sales", label: "Increase Sales", prompt: "Help me increase sales — add upsells, a free shipping goal bar and frequently bought together recommendations." },
    { key: "mobile", label: "Improve Mobile Experience", prompt: "Optimize my cart for mobile shoppers with a cleaner, easier-to-use layout." },
    { key: "recommendations", label: "Add Product Recommendations", prompt: "Add upsell and frequently bought together product recommendations to my cart." },
    { key: "branding", label: "Match Store Branding", prompt: "Enable the cart drawer and match its colors, fonts and styling to my store theme." },
    { key: "abandonment", label: "Reduce Cart Abandonment", prompt: "Help reduce cart abandonment with trust badges, secure checkout messaging and a free shipping progress bar." },
];

export const EXAMPLE_PROMPTS = [
    "Enable cart drawer and match my theme.",
    "Make my cart look premium.",
    "Increase average order value.",
    "Add frequently bought together products.",
    "Add a free shipping goal bar.",
    "Optimize my cart for mobile users.",
    "Add trust badges and secure checkout messaging.",
    "Add upsells before checkout.",
    "Match my cart with my store branding.",
];

export const BEST_PRACTICES = [
    { title: "Use specific instructions", body: "“Enable the cart drawer and use a 12px rounded corner style” works better than “make it nicer”." },
    { title: "Mention your goals", body: "Tell the AI what you're optimizing for — e.g. “increase average order value” or “reduce cart abandonment”." },
    { title: "Mention design preferences", body: "Reference a look and feel — premium, minimal, playful — or ask it to match your store's branding." },
    { title: "Mention mobile optimization", body: "If most of your traffic is mobile, say so — the AI will prioritize layout and tap-target changes." },
];

export const VIDEO_STEPS = [
    "Open the AI Agent",
    "Select a quick action",
    "Enter your prompt",
    "Preview the changes",
    "Apply the changes",
    "Review the results",
];

export const ONBOARDING_STORAGE_KEY = "cartNinja_aiAgent_onboarding_seen";
