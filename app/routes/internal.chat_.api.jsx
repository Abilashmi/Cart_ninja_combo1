// The team panel's data (/internal/chat, routes/internal.chat.jsx), behind the
// internal password (utils/internal-auth.server.js; its cookie is SameSite
// strict, so other sites can't post here).
// GET  ?list=1&filter=waiting|open|closed|all&q=  = the inbox
// GET  ?id=<chat>&after=<message id>             = one chat + its new messages
// GET  ?settings=1                               = the chat settings
// POST { intent: 'reply', id, body, author } | { intent: 'update', id, status?, aiPaused?, read? }
//      | { intent: 'settings', settings }
import { internalEnabled, isSignedIn } from '../utils/internal-auth.server';
import {
  getChatSettings, getConversation, listConversations, listMessages, saveChatSettings, teamReply, teamUpdate,
} from '../services/support-chat.server';
import { teamOnline } from '../utils/support-chat.shared.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

async function guard(request) {
  if (!internalEnabled()) return json({ success: false, error: 'Internal pages are switched off.' }, 503);
  if (!(await isSignedIn(request))) return json({ success: false, error: 'Signed out. Reload the page and sign in.' }, 401);
  return null;
}

export async function loader({ request }) {
  const denied = await guard(request);
  if (denied) return denied;
  const url = new URL(request.url);
  try {
    if (url.searchParams.get('settings')) {
      const settings = await getChatSettings();
      return json({ success: true, settings, online: teamOnline(settings) });
    }
    const id = Number(url.searchParams.get('id'));
    if (id) {
      const conversation = await getConversation(id);
      if (!conversation) return json({ success: false, error: 'Chat not found.' }, 404);
      const messages = await listMessages(id, { after: Number(url.searchParams.get('after')) || 0 });
      return json({ success: true, conversation, messages });
    }
    return json({ success: true, ...(await listConversations({ filter: url.searchParams.get('filter') || 'waiting', q: url.searchParams.get('q') || '' })) });
  } catch (e) {
    console.error('[internal chat] load failed:', e.message);
    return json({ success: false, error: 'Could not load. Try again.' }, 500);
  }
}

export async function action({ request }) {
  const denied = await guard(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.intent === 'reply') return json({ success: true, message: await teamReply(body.id, { body: body.body, author: body.author }) });
    if (body.intent === 'update') return json({ success: true, conversation: await teamUpdate(body.id, body) });
    if (body.intent === 'settings') return json({ success: true, settings: await saveChatSettings(body.settings) });
    return json({ success: false, error: 'Unknown request.' }, 400);
  } catch (e) {
    if (e.code === 'empty' || e.code === 'not_found') return json({ success: false, error: e.message }, 400);
    console.error('[internal chat] action failed:', e.message);
    return json({ success: false, error: 'Could not save. Try again.' }, 500);
  }
}
