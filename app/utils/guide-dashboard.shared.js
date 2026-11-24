/**
 * The personalized Home (components/guide/GuideDashboard.jsx): which tips and
 * tutorials a store sees for how its customers pay and the features it picked,
 * and how a number compares with the previous period. Pure; texts are admin.*
 * keys (en.json). Tips say how to do something, never promise a result
 * (Built for Shopify 4.3.1: no outcome claims).
 */
import { TUTORIAL_VIDEOS } from './tutorial-videos.js';
import { GUIDE_MODULE_IDS } from './guide.shared.js';

const COD_PAY = ['postpaid', 'both'];
const ANY_PAY = ['prepaid', 'postpaid', 'both'];

// In the order they're offered: the first ones that fit are shown.
export const GUIDE_TIPS = [
  { id: 'cod_otp', modules: ['cod'], payments: COD_PAY, title: 'admin.gdash.tip_cod_otp_title', body: 'admin.gdash.tip_cod_otp_body' },
  { id: 'cod_prepaid', modules: ['cod'], payments: ANY_PAY, title: 'admin.gdash.tip_cod_prepaid_title', body: 'admin.gdash.tip_cod_prepaid_body' },
  { id: 'packs_bestsellers', modules: ['packs'], payments: ANY_PAY, title: 'admin.gdash.tip_packs_title', body: 'admin.gdash.tip_packs_body' },
  { id: 'cart_goal', modules: ['cart'], payments: ANY_PAY, title: 'admin.gdash.tip_cart_title', body: 'admin.gdash.tip_cart_body' },
  { id: 'fbt_orders', modules: ['fbt'], payments: ANY_PAY, title: 'admin.gdash.tip_fbt_title', body: 'admin.gdash.tip_fbt_body' },
  { id: 'combo_one', modules: ['combo'], payments: ANY_PAY, title: 'admin.gdash.tip_combo_title', body: 'admin.gdash.tip_combo_body' },
  { id: 'coupon_few', modules: ['coupon'], payments: ANY_PAY, title: 'admin.gdash.tip_coupon_title', body: 'admin.gdash.tip_coupon_body' },
  { id: 'discounts_auto', modules: ['discounts'], payments: ANY_PAY, title: 'admin.gdash.tip_discounts_title', body: 'admin.gdash.tip_discounts_body' },
  { id: 'ai_ask', modules: ['brix_ai'], payments: ANY_PAY, title: 'admin.gdash.tip_ai_title', body: 'admin.gdash.tip_ai_body' },
  { id: 'embed_on', modules: [], payments: ANY_PAY, title: 'admin.gdash.tip_embed_title', body: 'admin.gdash.tip_embed_body' },
];

/** Up to `max` tips for this store: ones about its picked features first, then the general one. */
export function pickTips(payment, modules, max = 2) {
  const picked = new Set(Array.isArray(modules) ? modules : []);
  const fits = (tip) => (!payment || tip.payments.includes(payment));
  const about = GUIDE_TIPS.filter((tip) => fits(tip) && tip.modules.some((m) => picked.has(m)));
  const general = GUIDE_TIPS.filter((tip) => fits(tip) && !tip.modules.length);
  return [...about, ...general].slice(0, max);
}

/** The tips card's heading for how customers pay. */
export function tipsHeading(payment) {
  if (payment === 'prepaid') return 'admin.gdash.tips_prepaid';
  if (payment === 'postpaid') return 'admin.gdash.tips_cod';
  return 'admin.gdash.tips_store';
}

// Per feature: its basics first, then what's more advanced. `video` = a key of
// TUTORIAL_VIDEOS, null while no video is published (the card says so).
export const GUIDE_TUTORIALS = {
  cod: [
    { id: 'cod_basics', level: 'beginner', video: null, title: 'admin.gdash.tut_cod_title', desc: 'admin.gdash.tut_cod_desc' },
    { id: 'cod_more', level: 'advanced', video: null, title: 'admin.gdash.tut_cod_more_title', desc: 'admin.gdash.tut_cod_more_desc' },
  ],
  cart: [{ id: 'cart_basics', level: 'beginner', video: 'cartDrawer', title: 'admin.home.step2_title', desc: 'admin.home.step2_desc' }],
  fbt: [{ id: 'fbt_basics', level: 'intermediate', video: 'fbt', title: 'admin.home.step3_title', desc: 'admin.home.step3_desc' }],
  combo: [{ id: 'combo_basics', level: 'beginner', video: 'comboBuilder', title: 'admin.home.step5_title', desc: 'admin.home.step5_desc' }],
  packs: [{ id: 'packs_basics', level: 'beginner', video: null, title: 'admin.gdash.tut_packs_title', desc: 'admin.gdash.tut_packs_desc' }],
  coupon: [{ id: 'coupon_basics', level: 'beginner', video: 'couponBanner', title: 'admin.home.step4_title', desc: 'admin.home.step4_desc' }],
  discounts: [{ id: 'discounts_basics', level: 'beginner', video: null, title: 'admin.gdash.tut_discounts_title', desc: 'admin.gdash.tut_discounts_desc' }],
  brix_ai: [{ id: 'ai_basics', level: 'beginner', video: 'brixAi', title: 'admin.home.step1_title', desc: 'admin.home.step1_desc' }],
};

/**
 * The tutorials for the picked features, basics first (in setup order), then
 * the advanced ones; up to `max`. Each comes with its video link and length,
 * or none yet.
 */
export function pickTutorials(modules, max = 6) {
  const order = GUIDE_MODULE_IDS.filter((id) => (modules || []).includes(id));
  const withVideo = (tut, module) => {
    const v = tut.video ? TUTORIAL_VIDEOS[tut.video] : null;
    return { ...tut, module, url: v?.url || '', dur: v?.dur || '' };
  };
  const basics = order.map((id) => GUIDE_TUTORIALS[id]?.[0] && withVideo(GUIDE_TUTORIALS[id][0], id)).filter(Boolean);
  const more = order.flatMap((id) => (GUIDE_TUTORIALS[id] || []).slice(1).map((tut) => withVideo(tut, id)));
  return [...basics, ...more].slice(0, max);
}

/**
 * How a number moved against the previous period: null when there's nothing
 * to compare (no previous value, or either side unknown), else
 * { pct, direction: 'up' | 'down' | 'same' } with pct a whole number.
 */
export function compareWithPrevious(now, prev) {
  if (typeof now !== 'number' || typeof prev !== 'number' || !Number.isFinite(now) || !Number.isFinite(prev) || prev <= 0) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  return { pct: Math.abs(pct), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'same' };
}
