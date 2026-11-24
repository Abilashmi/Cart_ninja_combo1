import { redirect } from 'react-router';

// Build a Combo is now just one feature inside the unified Free/Starter/Pro
// plan (see app/config/plans.js, feature key "build_a_combo") instead of a
// separate Combo Forge subscription. This route no longer creates its own
// Shopify charge — it forwards merchants to the single pricing page.
export async function loader() {
  throw redirect('/app/subscribe?highlight=build_a_combo');
}
