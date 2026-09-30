// DEV-ONLY: the mock Shopify product page that mounts the REAL /packs.js widget.
import { previewEnabled, renderStorefrontFrame } from '../services/packs-preview.server.js';

export async function loader({ request }) {
  if (!previewEnabled()) return new Response('Not found', { status: 404 });
  const params = new URL(request.url).searchParams;
  return new Response(renderStorefrontFrame({ design: params.get('design') || 'classic', type: params.get('type') === 'mix' ? 'mix' : 'standard' }), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
