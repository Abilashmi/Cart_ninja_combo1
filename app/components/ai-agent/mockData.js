const MOCK_CONVERSATIONS = [
  {
    id: "conv-1",
    title: "Conversion rate analysis",
    messages: [
      { id: "m1", role: "user", text: "What's my conversion rate this month?" },
      {
        id: "m2", role: "agent", text: "Your **conversion rate is 3.8%** — up 12% from last month. The biggest driver was the Cart Drawer launch on Mobile.",
        type: "metric",
        insight: {
          metric: "Conversion Rate",
          value: "3.8%",
          delta: 12,
          trend: "positive",
          series: [
            { label: "Jan", value: 2.5 },
            { label: "Feb", value: 3.1 },
            { label: "Mar", value: 2.8 },
            { label: "Apr", value: 3.5 },
            { label: "May", value: 3.8 },
          ],
        },
      },
      { id: "m3", role: "user", text: "Break down by source" },
      {
        id: "m4", role: "agent", text: "Here's the breakdown:\n\n• **Direct**: 42% (1.6% conversion)\n• **Organic search**: 28% (2.1% conversion)\n• **Social**: 18% (3.2% conversion)\n• **Email**: 12% (4.5% conversion)\n\nEmail is your highest-converting channel!",
        type: "text",
      },
    ],
    timestamp: Date.now() - 3600000,
  },
  {
    id: "conv-2",
    title: "Revenue report",
    messages: [
      { id: "m5", role: "user", text: "Show me revenue trends" },
      {
        id: "m6", role: "agent", text: "**Total revenue this month: $24,680** — a 7% increase week-over-week.\n\nYour upsell features generated **$3,200** of that total. The Free Shipping Goal Bar contributed another **$1,800** in recovered carts.",
        type: "text",
      },
    ],
    timestamp: Date.now() - 86400000,
  },
  {
    id: "conv-3",
    title: "Enabled Cart Drawer",
    messages: [
      { id: "m7", role: "user", text: "Enable the cart drawer" },
      {
        id: "m8", role: "agent", text: "I'll enable the **Cart Drawer** for your store with these settings:\n\n• Slide-in from right\n• Show product thumbnails\n• Enable quantity editing\n• Show subtotal with tax estimate",
        type: "action",
        actions: [
          { label: "✓ Apply Changes", action: "apply", primary: true },
          { label: "Dismiss", action: "dismiss" },
        ],
      },
    ],
    timestamp: Date.now() - 172800000,
  },
  {
    id: "conv-4",
    title: "Cart abandonment insights",
    messages: [
      { id: "m9", role: "user", text: "Why are people abandoning cart?" },
      {
        id: "m10", role: "agent", text: "Your **cart abandonment rate is 68%**. Top reasons:\n\n1. **42%** — Unexpected costs (shipping, fees)\n2. **28%** — Didn't trust checkout\n3. **18%** — Wanted coupon codes\n4. **12%** — Comparison shopping\n\nI can enable **Trust Badges** and a **Free Shipping Goal Bar** to address #1 and #2.",
        type: "action",
        actions: [
          { label: "✓ Enable Both", action: "apply", primary: true },
          { label: "Just Trust Badges", action: "apply_trust" },
          { label: "Not now", action: "dismiss" },
        ],
      },
    ],
    timestamp: Date.now() - 604800000,
  },
];

const SUGGESTION_CHIPS = [
  { id: "chip-1", text: "Enable cart drawer" },
  { id: "chip-2", text: "Conversion rate" },
  { id: "chip-3", text: "Help me grow sales" },
];

function detectIntent(text) {
  const lower = text.toLowerCase();
  if (/enable.*cart|cart.*drawer|open.*cart/i.test(lower)) return "enable_cart";
  if (/enable.*upsell|add.*upsell|upsell/i.test(lower)) return "enable_upsell";
  if (/trust.?badge|security|secure.?checkout/i.test(lower)) return "enable_trust";
  if (/goal.?bar|free.?shipping|shipping.?progress/i.test(lower)) return "enable_goalbar";
  if (/conversion|rate|convert/i.test(lower)) return "metric_conversion";
  if (/revenue|sale|income|earn/i.test(lower)) return "metric_revenue";
  if (/traffic|visitor|visit|session/i.test(lower)) return "metric_traffic";
  if (/help|what can you|capabilit|feature|what do/i.test(lower)) return "help";
  if (/hello|hi |hey|good/i.test(lower)) return "greeting";
  if (/undo|revert|remove|disable/i.test(lower)) return "undo";
  if (/thank|thanks|great|awesome|perfect/i.test(lower)) return "thanks";
  if (/apply.*change|yes.*apply|do it|go ahead/i.test(lower)) return "apply_confirm";
  return "general";
}

const RESPONSES = {
  enable_cart: {
    text: "I'll enable the **Cart Drawer** for your store with these settings:\n\n• Slide-in from right — smooth animation\n• Product thumbnails with quantity controls\n• Subtotal, tax estimate & checkout button\n• Mobile-optimized tap targets\n\nWant me to apply these changes?",
    type: "action",
    actions: [
      { label: "✓ Apply Changes", action: "apply_cart_drawer", primary: true },
      { label: "Match my theme too", action: "apply_theme" },
      { label: "Not now", action: "dismiss" },
    ],
  },
  enable_upsell: {
    text: "Great choice! I'll set up **Upsell Recommendations** in your cart:\n\n• Show 3 related products below cart items\n• \"Frequently bought together\" section\n• Dynamic pricing — discount when bundled\n• Limit 2 upsells per view to avoid clutter\n\nApply these upsell settings?",
    type: "action",
    actions: [
      { label: "✓ Apply Upsells", action: "apply_upsell", primary: true },
      { label: "Customize later", action: "dismiss" },
    ],
  },
  enable_trust: {
    text: "I'll add **Trust Badges** to your cart checkout flow:\n\n• SSL Secure badge at checkout button\n• Money-back guarantee banner (30 days)\n• Accepted payments: Visa, MC, Amex, PayPal\n• Norton Secured seal in footer\n\nEnable trust badges?",
    type: "action",
    actions: [
      { label: "✓ Enable All", action: "apply_trust", primary: true },
      { label: "Just SSL badge", action: "apply_ssl" },
      { label: "Not now", action: "dismiss" },
    ],
  },
  enable_goalbar: {
    text: "I'll add a **Free Shipping Goal Bar** to encourage bigger orders:\n\n• Progress bar at top of cart — \"You're $12 away from free shipping!\"\n• Auto-calculates based on cart total\n• Celebration animation when goal is met\n• Configurable threshold (default $50)\n\nAdd the goal bar?",
    type: "action",
    actions: [
      { label: "✓ Add Goal Bar", action: "apply_goalbar", primary: true },
      { label: "Set $75 threshold", action: "apply_goalbar_75" },
      { label: "Not now", action: "dismiss" },
    ],
  },
  metric_conversion: {
    text: "Your **conversion rate is 3.8%** — up 12% month-over-month. Here's the trend:\n\n• Jan: 2.5%\n• Feb: 3.1%  ▲\n• Mar: 2.8%  ▼ (seasonal dip)\n• Apr: 3.5%  ▲\n• May: 3.8%  ▲ **best month**\n\nThe Cart Drawer optimization has been the biggest contributor. Want to see the breakdown by traffic source?",
    type: "metric",
    insight: {
      metric: "Conversion Rate",
      value: "3.8%",
      delta: 12,
      trend: "positive",
      series: [
        { label: "Jan", value: 2.5 },
        { label: "Feb", value: 3.1 },
        { label: "Mar", value: 2.8 },
        { label: "Apr", value: 3.5 },
        { label: "May", value: 3.8 },
      ],
    },
  },
  metric_revenue: {
    text: "**Total revenue this month: $24,680** — up 7% week-over-week.\n\nBreakdown:\n• **Cart drawer**: $14,200 (57%)\n• **Upsells**: $3,200 (13%)\n• **FBT recommendations**: $2,100 (9%)\n• **Direct checkout**: $5,180 (21%)\n\nYour upsell revenue has grown 22% since last month. Want optimization suggestions?",
    type: "metric",
    insight: {
      metric: "Monthly Revenue",
      value: "$24,680",
      delta: 7,
      trend: "positive",
      series: [
        { label: "Jan", value: 18500 },
        { label: "Feb", value: 20100 },
        { label: "Mar", value: 19400 },
        { label: "Apr", value: 22800 },
        { label: "May", value: 24680 },
      ],
    },
  },
  metric_traffic: {
    text: "**Store traffic this month: 12,847 visitors** — up 15% from last month.\n\nTop sources:\n1. **Organic search**: 4,240 (33%)\n2. **Direct**: 3,340 (26%)\n3. **Social media**: 2,570 (20%)\n4. **Email**: 1,670 (13%)\n5. **Referral**: 1,027 (8%)\n\nSocial traffic grew 40% — your TikTok strategy is working!",
    type: "text",
  },
  help: {
    text: "Here's what I can help you with:\n\n**Actions**\n• Enable/configure Cart Drawer\n• Set up Upsell Recommendations\n• Add Trust Badges & Goal Bar\n• Match store theme\n\n**Analytics**\n• Conversion rates & trends\n• Revenue reports\n• Traffic sources\n• Cart abandonment insights\n\n**Tips**\n• Best practices for higher AOV\n• Mobile optimization suggestions\n• Trust & security improvements\n\nJust type what you'd like to do!",
    type: "text",
  },
  greeting: {
    text: "Hello! I'm your **Cart Ninja AI assistant**. I can help you optimize your store, check analytics, or make changes.\n\nTry asking me:\n• \"Enable the cart drawer\"\n• \"What's my conversion rate?\"\n• \"Add upsell recommendations\"\n• \"How do I reduce cart abandonment?\"",
    type: "text",
  },
  thanks: {
    text: "You're welcome! Let me know if you need anything else. I'm here 24/7 to help optimize your store.",
    type: "text",
  },
  general: {
    text: "Great question! Based on your store data, here's what I'd recommend:\n\nYour current setup is performing well, but there are a few opportunities:\n\n1. **Enable Trust Badges** — could improve conversion by 8-12%\n2. **Add a Free Shipping Goal Bar** — encourages 15% higher AOV\n3. **Optimize for Mobile** — 68% of your traffic is mobile\n\nWant me to start with any of these?",
    type: "action",
    actions: [
      { label: "✓ Enable Trust Badges", action: "enable_trust", primary: true },
      { label: "Add Goal Bar", action: "enable_goalbar" },
      { label: "Optimize Mobile", action: "enable_mobile" },
    ],
  },
};

function mockAgentApi(userMessage, previousMessages = []) {
  const lower = userMessage.toLowerCase();

  if (/break.?down|source|channel|traffic.?source/i.test(lower)) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          id: `msg-${Date.now()}`,
          role: "agent",
          text: "Here's the breakdown by source:\n\n• **Direct**: 42% (1.6% conversion)\n• **Organic search**: 28% (2.1% conversion)\n• **Social**: 18% (3.2% conversion)\n• **Email**: 12% (4.5% conversion)\n\nEmail is your highest-converting channel at 4.5%!",
          type: "text",
        });
      }, 600);
    });
  }

  if (/mobile|phone|responsive/i.test(lower)) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          id: `msg-${Date.now()}`,
          role: "agent",
          text: "I'll optimize your cart for **mobile shoppers**:\n\n• Larger tap targets (min 44px)\n• Optimized layout — single column\n• Faster load times (lazy-load images)\n• Swipeable product carousel\n• Sticky checkout button\n\nApply mobile optimization?",
          type: "action",
          actions: [
            { label: "✓ Optimize Mobile", action: "apply_mobile", primary: true },
            { label: "Not now", action: "dismiss" },
          ],
        });
      }, 600);
    });
  }

  const intent = detectIntent(userMessage);

  if (intent === "apply_confirm") {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          id: `msg-${Date.now()}`,
          role: "agent",
          text: "**Changes applied successfully!** Your store settings have been updated. You can check the results in your analytics dashboard within 24 hours.\n\nNeed anything else?",
          type: "text",
        });
      }, 800);
    });
  }

  if (intent === "undo") {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          id: `msg-${Date.now()}`,
          role: "agent",
          text: "**Previous changes reverted.** Your store settings have been restored to their previous state.\n\nIs there anything else I can help you with?",
          type: "text",
        });
      }, 600);
    });
  }

  const response = RESPONSES[intent] || RESPONSES.general;

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        id: `msg-${Date.now()}`,
        role: "agent",
        ...response,
      });
    }, 600 + Math.random() * 400);
  });
}

export { MOCK_CONVERSATIONS, SUGGESTION_CHIPS, mockAgentApi };
