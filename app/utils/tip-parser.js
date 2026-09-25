// Turns a chat reply shaped like
//     intro sentence
//     1. **Title**: explanation
//     2. **Title**: explanation
//     closing sentence
// into { intro, tips, outro } so it can be drawn as a set of visual cards
// instead of a plain numbered list. Returns null for anything else (plain
// answers, confirmations, bullet lists without bold titles), which then keep
// rendering as normal markdown.
const NUMBERED_RE = /^\s{0,3}(\d+)[.)]\s+(.*)$/;
const BULLET_RE = /^\s{0,3}[-*•]\s+(.*)$/;
const TITLE_RE = /^\*\*(.+?)\*\*\s*[:\-–—]?\s*([\s\S]*)$/;

function splitTitle(text) {
  const m = text.match(TITLE_RE);
  if (!m) return { title: '', body: text.trim() };
  return { title: m[1].replace(/[:\s]+$/, '').trim(), body: m[2].trim() };
}

export function parseTips(text) {
  if (!text) return null;
  const lines = String(text).split('\n');
  const intro = [];
  const outro = [];
  const items = [];
  let current = null;
  let sawBlank = false;
  let inOutro = false;
  let kind = null;

  for (const line of lines) {
    if (inOutro) { outro.push(line); continue; }
    const num = line.match(NUMBERED_RE);
    const bul = line.match(BULLET_RE);
    const startsItem = (kind !== 'bullet' && num) || (kind !== 'number' && bul);
    if (startsItem) {
      const k = num ? 'number' : 'bullet';
      if (kind && kind !== k) { inOutro = true; outro.push(line); continue; }
      kind = k;
      current = { lines: [(num ? num[2] : bul[1]).trim()] };
      items.push(current);
      sawBlank = false;
      continue;
    }
    if (!line.trim()) { if (current) sawBlank = true; else intro.push(line); continue; }
    if (!current) { intro.push(line); continue; }
    // Text after an item: an indented line, or a line directly under it, is
    // still that item; a non-indented line after a blank starts the closing.
    if (sawBlank && !/^\s{2,}/.test(line)) { inOutro = true; outro.push(line); continue; }
    current.lines.push(line.trim());
    sawBlank = false;
  }

  if (items.length < 2) return null;
  const tips = items.map((it) => splitTitle(it.lines.join(' ')));
  // Only items that each carry a bold title become cards. Plain numbered
  // steps ("1. Go to Discounts", "2. Click Create") are instructions, not
  // ideas to pick from, so they stay an ordinary numbered list.
  if (tips.some((t) => !t.title)) return null;
  return {
    intro: intro.join('\n').trim(),
    tips,
    outro: outro.join('\n').trim(),
  };
}
