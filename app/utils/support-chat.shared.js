/**
 * BRIX support chat: the "Need help setting up?" chat in the BRIX admin
 * (components/support/SupportChat.jsx) and its team panel (/internal/chat).
 * Settings, office hours and the text limits, shared by the server, the
 * widget and the panel. Pure, no imports.
 */

export const CHAT_MESSAGE_MAX = 2000;
export const CHAT_QUICK_REPLIES_MAX = 12;
export const CHAT_SENDERS = ['merchant', 'ai', 'team', 'system'];

export const DEFAULT_CHAT_SETTINGS = Object.freeze({
  // The launcher on every BRIX admin page (never opens by itself: Built for Shopify 4.3.3).
  enabled: true,
  // BRIX AI answers first; the team takes over a chat by replying in it.
  aiEnabled: true,
  // The launcher's text until the merchant first opens the chat; after that, a round chat button.
  launcherText: 'Need help setting up?',
  // The first message in an empty chat (shown, not stored).
  greeting: 'Hi! Do you need any help to set up BRIX? Ask me anything about the cart drawer, COD, combos, Packs or offers.',
  // Shown when a merchant asks for a person outside office hours.
  awayMessage: 'Thanks! Our team is offline right now. We will reply here as soon as we are back, usually within a few hours.',
  // Shown when a merchant asks for a person during office hours.
  handoffMessage: 'Got it. Someone from the BRIX team will reply here shortly.',
  teamName: 'BRIX Support',
  officeHours: { enabled: true, timeZone: 'Asia/Kolkata', days: [1, 2, 3, 4, 5, 6], from: '10:00', to: '19:00' },
  // Most AI answers per store per day (cost guard); past it, the chat waits for the team.
  aiDailyLimit: 40,
  quickReplies: [
    'Go to Online Store > Themes > Customize > App embeds and switch on "Custom Cart Drawer", then save.',
    'Could you share a screenshot of what you see? It helps us fix it faster.',
    'Done! Please refresh your store and check again.',
  ],
});

const text = (v, fallback, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return (s || fallback).slice(0, max);
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function sanitizeChatSettings(patch, base = DEFAULT_CHAT_SETTINGS) {
  const b = { ...DEFAULT_CHAT_SETTINGS, ...(base && typeof base === 'object' ? base : {}) };
  const p = patch && typeof patch === 'object' ? patch : {};
  const pick = (key) => (Object.prototype.hasOwnProperty.call(p, key) ? p[key] : b[key]);
  const oh = { ...DEFAULT_CHAT_SETTINGS.officeHours, ...(b.officeHours || {}), ...(p.officeHours && typeof p.officeHours === 'object' ? p.officeHours : {}) };
  let tz = String(oh.timeZone || 'Asia/Kolkata');
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'Asia/Kolkata'; }
  const days = [...new Set((Array.isArray(oh.days) ? oh.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const limit = Number(pick('aiDailyLimit'));
  return {
    enabled: Boolean(pick('enabled')),
    aiEnabled: Boolean(pick('aiEnabled')),
    launcherText: text(pick('launcherText'), DEFAULT_CHAT_SETTINGS.launcherText, 40),
    greeting: text(pick('greeting'), DEFAULT_CHAT_SETTINGS.greeting, 400),
    awayMessage: text(pick('awayMessage'), DEFAULT_CHAT_SETTINGS.awayMessage, 400),
    handoffMessage: text(pick('handoffMessage'), DEFAULT_CHAT_SETTINGS.handoffMessage, 400),
    teamName: text(pick('teamName'), DEFAULT_CHAT_SETTINGS.teamName, 40),
    officeHours: {
      enabled: Boolean(oh.enabled),
      timeZone: tz,
      days,
      from: HHMM.test(oh.from) ? oh.from : '10:00',
      to: HHMM.test(oh.to) ? oh.to : '19:00',
    },
    aiDailyLimit: Number.isFinite(limit) ? Math.min(500, Math.max(0, Math.round(limit))) : DEFAULT_CHAT_SETTINGS.aiDailyLimit,
    quickReplies: (Array.isArray(pick('quickReplies')) ? pick('quickReplies') : [])
      .map((q) => (typeof q === 'string' ? q.trim().slice(0, 500) : ''))
      .filter(Boolean)
      .slice(0, CHAT_QUICK_REPLIES_MAX),
  };
}

/** Is the team in office hours at `now` (office hours off = always)? */
export function teamOnline(settings, now = new Date()) {
  const oh = settings?.officeHours;
  if (!oh || !oh.enabled) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: oh.timeZone || 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  if (!(oh.days || []).includes(day)) return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const [fh, fm] = String(oh.from).split(':').map(Number);
  const [th, tm] = String(oh.to).split(':').map(Number);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** What the widget may see of the settings. */
export function publicChatSettings(settings, now = new Date()) {
  return {
    enabled: settings.enabled,
    launcherText: settings.launcherText,
    greeting: settings.greeting,
    teamName: settings.teamName,
    aiEnabled: settings.aiEnabled,
    online: teamOnline(settings, now),
  };
}

/** A message body as stored: trimmed, at most CHAT_MESSAGE_MAX, '' when empty. */
export function cleanMessage(body) {
  return String(body ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, CHAT_MESSAGE_MAX);
}
