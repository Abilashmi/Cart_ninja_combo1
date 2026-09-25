// The shared "ask the merchant ONE important question" reply for BRIX tools.
//
// Features with many settings (FBT, Coupon Banner, Combo, Countdown Timer,
// Progress Bar) must not be set up on guesses, but the merchant also shouldn't
// be quizzed on every colour and label. A tool that is missing one of the few
// decisions that actually change what the merchant gets returns needsInfo(...)
// instead of writing anything: the model asks exactly that question, the
// `choices` show as quick-reply buttons (api.ai.chat.jsx forwards them), and
// the button's value comes back as the merchant's plain-text answer.

export const NEEDS_INFO_NOTE = 'Option buttons are shown to the merchant automatically, so just ask the question briefly.';

export function needsInfo(need, message, choices) {
  return {
    success: false,
    reason: 'needs_info',
    need,
    message: choices?.length ? `${message} ${NEEDS_INFO_NOTE}` : message,
    ...(choices?.length ? { choices } : {}),
  };
}

const choice = (label, value = label) => ({ label, value });

// Quick-reply sets, keyed by the decision they answer.
export const CHOICES = {
  fbtTemplate: [choice('Classic Grid'), choice('Modern Cards'), choice('Vertical List')],
  fbtShowOn: [choice('All product pages'), choice('Specific products')],
  countdownDuration: [choice('15 minutes'), choice('30 minutes'), choice('1 hour'), choice('24 hours')],
  comboLayout: [
    choice('Guided Architect', 'Guided Architect (step by step)'),
    choice('Velocity Stream', 'Velocity Stream (tab switcher)'),
    choice('Editorial Split', 'Editorial Split (single grid)'),
  ],
  comboDiscount: [choice('No discount'), choice('10% off'), choice('15% off'), choice('20% off')],
  progressReward: [choice('Free shipping'), choice('A free product')],
  rewardPricing: [
    choice('Make it free (auto discount)', 'Make it free with an automatic discount'),
    choice('Keep the regular price', 'Keep the regular price'),
  ],
};
