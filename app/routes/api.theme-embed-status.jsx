import { authenticate } from '../shopify.server';
import { getEmbedStatus } from '../services/theme-embed.server';
import { CART_DRAWER_EMBED_HANDLE, cartDrawerEmbedEditorUrl } from '../config/theme-extension';

// Is the "Custom Cart Drawer" app embed switched on in the live theme?
// Called by the Build a Combo builder right after a template is saved, since
// combo pages are only rendered by that embed. `checked: false` means the theme
// couldn't be read, i.e. "unknown" — not "enabled".
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const status = await getEmbedStatus(session.shop, session.accessToken, CART_DRAWER_EMBED_HANDLE);
  return Response.json({ ...status, editorUrl: cartDrawerEmbedEditorUrl(session.shop) });
};
