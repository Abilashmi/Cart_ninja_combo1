// A client report someone was sent (Internal → Reports → Create share link):
// the frozen page saved by services/report-shares.server.js, no password.
// Resource route, so root.jsx (and its third-party scripts) never runs here.
import { getShare } from '../services/report-shares.server';
import { INTERNAL_HEADERS } from '../utils/internal-auth.server';
import { internalPage } from '../utils/internal-page';

const HEADERS = { ...INTERNAL_HEADERS, 'Cache-Control': 'private, no-store' };

export async function loader({ params }) {
  let share = null;
  try {
    share = await getShare(params.id);
  } catch (error) {
    console.error('[report share] read failed:', error.message);
    return new Response(internalPage('Report', '<div><h1>Report unavailable</h1></div><p>This report could not be opened just now. Try again in a minute.</p>'), { status: 503, headers: HEADERS });
  }
  if (!share) {
    return new Response(internalPage('Report', '<div><h1>Link not available</h1></div><p>This report link has expired or was turned off. Ask for a new one.</p>'), { status: 404, headers: HEADERS });
  }
  return new Response(share.html, { headers: HEADERS });
}
