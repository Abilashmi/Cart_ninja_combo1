// DEV-ONLY: customer-facing Packs storefront preview (toolbar + device frame).
// Resource route (no component). 404s in production unless BRIX_PACKS_PREVIEW=1.
import { previewEnabled, renderPreviewShell } from '../services/packs-preview.server.js';

export async function loader({ request }) {
  if (!previewEnabled()) return new Response('Not found', { status: 404 });
  const params = new URL(request.url).searchParams;
  const device = ['desktop', 'tablet', 'mobile'].includes(params.get('device')) ? params.get('device') : 'desktop';
  return new Response(renderPreviewShell({ design: params.get('design') || 'classic', type: params.get('type') === 'mix' ? 'mix' : 'standard', device }), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
