import { authenticate } from '../shopify.server';

const PAGE_SUGGESTIONS = {
  '/app/cartdrawer': [
    'Enable cart drawer', 'Match my theme colors', 'Make cart look premium',
    'Enable progress bar', 'Add upsell products', 'Enable coupon slider',
  ],
  '/app/analytics': [
    'Analyse my conversion funnel', 'Show revenue trends',
    'Which coupons perform best?', 'How are my upsells doing?',
  ],
  '/app/fbt': [
    'Enable FBT recommendations', 'Set up manual FBT rules',
    'Which products pair well?', 'Optimise FBT for mobile',
  ],
  '/app/productwidget': [
    'Enable coupon banner', 'Create a flash sale banner',
    'Add countdown timer', 'Increase coupon visibility',
  ],
  '/app/upsell': [
    'Enable upsell widget', 'Set up product recommendations',
    'Create upsell rules', 'Show upsells on empty cart',
  ],
  '/app/bundles': [
    'Create a bundle', 'Set up combo discounts',
    'Optimise bundle layout', 'Add bundle analytics',
  ],
  '/app/coupons': [
    'Create a discount code', 'Set up free shipping coupon',
    'Create a BOGO offer', 'List active discounts',
  ],
  '/app': [
    'Enable Cart Drawer', 'Increase AOV', 'Setup Free Shipping Goal',
    'Generate Upsell Campaign', 'Create Discount Strategy', 'Review Cart Performance',
  ],
};

export async function loader({ request }) {
  try {
    await authenticate.admin(request);
    const url = new URL(request.url);
    const page = url.searchParams.get('page') || '/app';
    const suggestions = PAGE_SUGGESTIONS[page] || PAGE_SUGGESTIONS['/app'];
    return Response.json({ success: true, suggestions });
  } catch {
    return Response.json({ success: true, suggestions: PAGE_SUGGESTIONS['/app'] });
  }
}
