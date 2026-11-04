// The frame of the internal pages (/internal/...): plain server-rendered HTML,
// outside root.jsx so none of the admin's third-party scripts (Clarity,
// Zingbot) see client data.

export const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function internalPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escHtml(title)}</title>
<style>
  :root { --bg: #f6f7f9; --panel: #fff; --fg: #1b1f27; --muted: #5d6573; --line: #d9dde3; --accent: #1f6feb; --bad: #b42318; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111418; --panel: #191d23; --fg: #e8eaee; --muted: #9aa3b0; --line: #2f3640; --accent: #4c8dff; --bad: #f97066; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 48px max(16px, env(safe-area-inset-right, 0px)) 48px max(16px, env(safe-area-inset-left, 0px)); display: flex; flex-direction: column; gap: 20px; }
  .eyebrow { font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 2px 0 0; font: 400 30px/1.2 Georgia, "Times New Roman", serif; }
  p { margin: 0; color: var(--muted); }
  form.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; font-size: 14px; }
  label small { font-weight: 400; color: var(--muted); }
  input, select { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; width: 100%; }
  input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; }
  button { font: inherit; font-weight: 600; border-radius: 8px; padding: 10px 16px; cursor: pointer; border: 1px solid var(--accent); background: var(--accent); color: #fff; }
  button.plain { background: transparent; color: var(--accent); border-color: var(--line); }
  .error { color: var(--bad); font-weight: 600; }
  .foot { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 14px; }
  a { color: var(--accent); }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
