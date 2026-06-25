import { authenticate } from '../shopify.server';

const TOOLS = [
  { name: 'enableDrawer',      label: 'Enable Cart Drawer',    description: 'Enable the cart drawer widget' },
  { name: 'disableDrawer',     label: 'Disable Cart Drawer',   description: 'Disable the cart drawer widget' },
  { name: 'enableGoalBar',     label: 'Enable Progress Bar',   description: 'Enable the milestone progress bar' },
  { name: 'disableGoalBar',    label: 'Disable Progress Bar',  description: 'Disable the milestone progress bar' },
  { name: 'enableUpsell',      label: 'Enable Upsells',        description: 'Enable upsell product recommendations' },
  { name: 'disableUpsell',     label: 'Disable Upsells',       description: 'Disable upsell product recommendations' },
  { name: 'enableFBT',         label: 'Enable FBT',            description: 'Enable Frequently Bought Together widget' },
  { name: 'disableFBT',        label: 'Disable FBT',           description: 'Disable Frequently Bought Together widget' },
  { name: 'applyTemplate',     label: 'Apply Theme Template',  description: 'Apply a preset cart drawer theme' },
  { name: 'matchTheme',        label: 'Match Store Theme',     description: 'Match cart drawer colors to the Shopify store theme' },
  { name: 'optimizeMobile',    label: 'Optimize for Mobile',   description: 'Apply mobile-optimised cart drawer settings' },
];

export async function loader({ request }) {
  try {
    await authenticate.admin(request);
    return Response.json({ success: true, tools: TOOLS });
  } catch {
    return Response.json({ success: true, tools: TOOLS });
  }
}
