import { authenticate } from '../shopify.server';
import { getEmbedStatus } from '../services/theme-embed.server';
import { APP_EMBEDS, CART_DRAWER_EMBED_HANDLE, appEmbedEditorUrl } from '../config/theme-extension';

// Is one of this app's embeds switched on in the live theme? `?handle=` picks
// it (only this extension's embeds, APP_EMBEDS); none = "BRIX Cart & Combo".
// Called by the Build a Combo builder right after a template is saved, since
// combo pages are only rendered by that embed, and by the guided setup panel
// for the embed its feature needs. `checked: false` means the theme couldn't
// be read, i.e. "unknown" — not "enabled".
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const asked = new URL(request.url).searchParams.get('handle');
  const handle = asked && Object.prototype.hasOwnProperty.call(APP_EMBEDS, asked) ? asked : CART_DRAWER_EMBED_HANDLE;
  const status = await getEmbedStatus(session.shop, session.accessToken, handle);
  return Response.json({ ...status, handle, name: APP_EMBEDS[handle], editorUrl: appEmbedEditorUrl(session.shop, handle) });
};
