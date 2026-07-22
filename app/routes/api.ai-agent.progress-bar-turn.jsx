import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { callLlm, parseJsonReply } from '../services/ai-llm.server';
import { sendToPhp } from '../utils/api-helpers';
import { getShopCurrencySymbol } from '../utils/currency.server';

// Reward-type choices map onto progress_bar_tiers.reward_type + icon_preset —
// see ProgressBarSection.jsx's TIER_ICON_MAP for the valid icon_preset values.
const REWARD_TYPE_CHOICES = [
  { label: 'Free Shipping', value: 'free_shipping' },
  { label: 'Free Gift', value: 'free_gift' },
  { label: 'Discount', value: 'discount' },
  { label: 'Custom', value: 'custom' },
];
const REWARD_TYPE_LABELS = Object.fromEntries(REWARD_TYPE_CHOICES.map(c => [c.value, c.label]));
const REWARD_ICON_PRESET = {
  free_shipping: 'shipping', free_gift: 'gift', discount: 'diamond', custom: 'trophy',
};

const goalAmountChoices = (currencySymbol) => [
  { label: `${currencySymbol}500`, value: '500' },
  { label: `${currencySymbol}1000`, value: '1000' },
  { label: `${currencySymbol}1500`, value: '1500' },
];

// placement column only supports 'top'/'bottom' — see ProgressBarSection.jsx's Select.
const PLACEMENT_CHOICES = [
  { label: 'Top of cart', value: 'top' },
  { label: 'Bottom of cart items', value: 'bottom' },
];

const CONFIRM_CHOICES = [
  { label: '✅ Confirm', value: '__confirm__' },
  { label: '✖ Cancel', value: '__cancel__' },
];

const EXTRACTION_PROMPT = `You are extracting progress-bar setup details from a Shopify merchant's chat
reply. Extract any of the following the merchant clearly stated:
- rewardType: one of "free_shipping", "free_gift", "discount", "custom"
- goalAmount: a plain number (the cart spend threshold that unlocks the reward)
- placement: one of "top", "bottom"
Reply with ONLY JSON containing whichever fields you found, e.g. {"rewardType":"free_shipping","goalAmount":500}.
If you found nothing usable, reply {"unclear":true}.`;

async function extractSettings(message) {
  const text = await callLlm([
    { role: 'system', content: EXTRACTION_PROMPT },
    { role: 'user', content: message },
  ], { maxTokens: 100, temperature: 0 });
  return parseJsonReply(text);
}

function normalizeRewardType(v) {
  const s = String(v || '').toLowerCase().replace(/\s+/g, '_');
  return REWARD_TYPE_CHOICES.some(c => c.value === s) ? s : null;
}
function normalizeGoalAmount(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function normalizePlacement(v) {
  const s = String(v || '').toLowerCase();
  return s === 'top' || s === 'bottom' ? s : null;
}

function confirmSummary({ rewardType, goalAmount, placement }, currencySymbol) {
  const placementLabel = placement === 'top' ? 'the top of the cart' : 'the bottom of the cart items';
  return `I'll set up ${REWARD_TYPE_LABELS[rewardType]} at ${currencySymbol}${goalAmount}, shown at ${placementLabel}. Shall I turn this on?`;
}

function nextQuestion(slots, currencySymbol) {
  if (!slots.rewardType) {
    return { message: 'What kind of reward should customers unlock — Free Shipping, Free Gift, Discount, or Custom?', choices: REWARD_TYPE_CHOICES };
  }
  if (!slots.goalAmount) {
    return { message: `What cart total should unlock it? (e.g. ${currencySymbol}500, ${currencySymbol}1000, ${currencySymbol}1500, or type a custom amount)`, choices: goalAmountChoices(currencySymbol) };
  }
  if (!slots.placement) {
    return { message: 'Where should the progress bar appear — Top of the cart, or Bottom of the cart items?', choices: PLACEMENT_CHOICES };
  }
  return null;
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const currencySymbol = await getShopCurrencySymbol(admin, shop);
    const { message, slots: incomingSlots, finalize } = await request.json();
    const slots = { ...(incomingSlots || {}) };

    if (finalize) {
      const credit = await checkAndConsumeCredit(shop, admin);
      const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };
      const result = await sendToPhp({
        shop,
        plan: {
          actions: ['enableGoalBar'],
          settings: {
            goalAmount: slots.goalAmount,
            rewardType: slots.rewardType,
            iconPreset: REWARD_ICON_PRESET[slots.rewardType],
            placement: slots.placement,
          },
        },
      }, 'ai_agent_apply.php');
      if (!result || result.status === 'error') {
        return Response.json({ status: 'clarify', message: 'Something went wrong turning on the progress bar. Try again?', slots, credits });
      }
      return Response.json({ status: 'saved', slots, after: result.after, credits });
    }

    if (!message) return Response.json({ status: 'error', message: 'No message provided' }, { status: 400 });

    const credit = await checkAndConsumeCredit(shop, admin);
    const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };

    // A choice-chip click sends its `value` verbatim as the message — try
    // matching it directly against whichever slot is still open before
    // falling back to LLM extraction on free text.
    if (!slots.rewardType) {
      const direct = normalizeRewardType(message);
      if (direct) slots.rewardType = direct;
    } else if (!slots.goalAmount) {
      const direct = normalizeGoalAmount(message);
      if (direct) slots.goalAmount = direct;
    } else if (!slots.placement) {
      const direct = normalizePlacement(message);
      if (direct) slots.placement = direct;
    }

    if (!slots.rewardType || !slots.goalAmount || !slots.placement) {
      const extracted = await extractSettings(message);
      if (!slots.rewardType && extracted.rewardType) slots.rewardType = normalizeRewardType(extracted.rewardType) || slots.rewardType;
      if (!slots.goalAmount && extracted.goalAmount != null) slots.goalAmount = normalizeGoalAmount(extracted.goalAmount) || slots.goalAmount;
      if (!slots.placement && extracted.placement) slots.placement = normalizePlacement(extracted.placement) || slots.placement;
    }

    const next = nextQuestion(slots, currencySymbol);
    if (next) {
      return Response.json({ status: 'ask', message: next.message, choices: next.choices, slots, credits });
    }

    return Response.json({
      status: 'confirm',
      message: confirmSummary(slots, currencySymbol),
      choices: CONFIRM_CHOICES,
      slots,
      credits,
    });
  } catch (e) {
    console.error('[api.ai-agent.progress-bar-turn]', e);
    return Response.json({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
}
