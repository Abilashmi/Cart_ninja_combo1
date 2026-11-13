// The team's support chat panel page (/internal/chat, routes/internal.chat.jsx):
// one self-contained HTML page whose only script carries `nonce` (the page's
// Content-Security-Policy allows nothing else). Data from
// routes/internal.chat_.api.jsx; merchant text is only ever set with
// textContent. Checked by tests/support-chat/panel-browser-check.mjs.
export function supportChatPanel(nonce) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>BRIX chat</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--fg:#1b1f27;--muted:#5d6573;--line:#d9dde3;--accent:#1f6feb;--bad:#b42318;--warn:#b54708;--warnbg:#fffaeb;--me:#111;--team:#eef4ff;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--panel:#191d23;--fg:#e8eaee;--muted:#9aa3b0;--line:#2f3640;--accent:#4c8dff;--bad:#f97066;--warn:#fdb022;--warnbg:#2a2111;--me:#e8eaee;--team:#1b2a44;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;height:100vh;display:flex;flex-direction:column}
header.top{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
header.top h1{margin:0;font-size:17px}
.tabs{display:flex;gap:4px}
.tabs button,.filters button{background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;cursor:pointer}
.tabs button[aria-pressed=true],.filters button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.who{margin-left:auto;display:flex;gap:8px;align-items:center;color:var(--muted)}
.who input{width:140px}
input,select,textarea{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:7px 9px}
button.main{font:inherit;font-weight:600;border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid var(--accent);background:var(--accent);color:#fff}
button.plain{font:inherit;border-radius:8px;padding:7px 12px;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--fg)}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.wrap{flex:1;display:grid;grid-template-columns:320px 1fr 280px;min-height:0}
.list{border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;background:var(--panel)}
.filters{display:flex;gap:4px;padding:10px;flex-wrap:wrap}
.search{padding:0 10px 10px}.search input{width:100%}
.items{overflow-y:auto;flex:1}
.item{display:block;width:100%;text-align:left;border:0;border-top:1px solid var(--line);background:transparent;color:var(--fg);padding:10px 12px;cursor:pointer;font:inherit}
.item[aria-current=true]{background:var(--bg)}
.item b{display:block}.item small{color:var(--muted);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tag{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px;margin-right:4px}
.tag.need{background:var(--warnbg);color:var(--warn)}.tag.unread{background:var(--accent);color:#fff}.tag.ai{background:var(--team);color:var(--fg)}.tag.closed{background:var(--line);color:var(--muted)}
.chat{display:flex;flex-direction:column;min-height:0}
.chat-head{padding:10px 16px;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--panel)}
.chat-head b{font-size:15px;margin-right:auto}
.msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.m{max-width:75%;display:flex;flex-direction:column;gap:2px}
.m span{font-size:11px;color:var(--muted)}
.m p{margin:0;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word;border:1px solid var(--line);background:var(--panel)}
.m.merchant p{background:var(--bg)}
.m.team{align-self:flex-end;align-items:flex-end}.m.team p{background:var(--team)}
.m.ai{align-self:flex-end;align-items:flex-end}.m.ai p{border-style:dashed}
.note{align-self:center;font-size:12px;color:var(--warn);background:var(--warnbg);border-radius:8px;padding:5px 10px;white-space:pre-wrap;max-width:80%}
.reply{border-top:1px solid var(--line);padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--panel)}
.reply textarea{width:100%;min-height:70px;resize:vertical}
.reply .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.reply select{max-width:60%}
.info{border-left:1px solid var(--line);padding:14px;overflow-y:auto;background:var(--panel)}
.info h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 8px}
.info dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px}
.info dt{color:var(--muted)}.info dd{margin:0;word-break:break-word}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.chip{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 8px}.chip.on{border-color:#12b76a;color:#12b76a}
.empty{margin:auto;color:var(--muted);text-align:center;padding:40px}
.settings{padding:20px;overflow-y:auto;max-width:720px;display:flex;flex-direction:column;gap:14px}
.settings label{display:flex;flex-direction:column;gap:5px;font-weight:600}
.settings label.check{flex-direction:row;align-items:center;gap:8px}
.settings small{color:var(--muted);font-weight:400}
.settings textarea{min-height:70px}
.days{display:flex;gap:8px;flex-wrap:wrap}.days label{flex-direction:row;font-weight:400;gap:4px}
.err{color:var(--bad);font-weight:600}.ok{color:#12b76a;font-weight:600}
[hidden]{display:none!important}
@media (max-width:1000px){.wrap{grid-template-columns:260px 1fr}.info{display:none}}
@media (max-width:640px){.wrap{grid-template-columns:1fr}.list{max-height:40vh;border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
<header class="top">
  <h1>BRIX chat</h1>
  <div class="tabs"><button type="button" data-tab="inbox" aria-pressed="true">Inbox <span id="waiting"></span></button><button type="button" data-tab="settings" aria-pressed="false">Settings</button></div>
  <div class="who"><label for="agent">Replying as</label><input id="agent" maxlength="40" placeholder="Your name">
    <form method="post"><input type="hidden" name="intent" value="logout"><button class="plain" type="submit">Sign out</button></form></div>
</header>
<div class="wrap" id="inbox">
  <aside class="list">
    <div class="filters" role="group" aria-label="Show">
      <button type="button" data-filter="waiting" aria-pressed="true">Waiting</button>
      <button type="button" data-filter="open" aria-pressed="false">Open</button>
      <button type="button" data-filter="closed" aria-pressed="false">Closed</button>
      <button type="button" data-filter="all" aria-pressed="false">All</button>
    </div>
    <div class="search"><input id="q" type="search" placeholder="Search store" aria-label="Search store"></div>
    <div class="items" id="items"></div>
  </aside>
  <section class="chat" id="chat"><div class="empty" id="pick">Pick a chat on the left.</div></section>
  <aside class="info" id="info"></aside>
</div>
<div class="settings" id="settings" hidden></div>
<script nonce="${nonce}">
(function () {
  var API = '/internal/chat/api';
  var state = { filter: 'waiting', q: '', list: [], waiting: 0, id: null, conv: null, messages: [], lastId: 0, settings: null, tab: 'inbox' };
  var lastWaiting = null;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (e) { n.addEventListener(e, attrs.on[e]); });
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function api(method, query, body) {
    return fetch(API + (query || ''), method === 'GET' ? { credentials: 'same-origin' } : {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) { return r.json().catch(function () { return { success: false, error: 'Bad answer from the server.' }; }); });
  }
  function ago(at) {
    if (!at) return '';
    var t = Date.parse(String(at).replace(' ', 'T') + 'Z');
    if (!isFinite(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString();
  }
  function storeName(c) { return (c.context && c.context.name) || c.shop; }
  function beep() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(); var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.08;
      o.start(); o.stop(ctx.currentTime + 0.18);
    } catch (e) { /* sound blocked until the page is clicked */ }
  }

  // ---------- inbox ----------
  function loadList() {
    var query = '?list=1&filter=' + encodeURIComponent(state.filter) + '&q=' + encodeURIComponent(state.q);
    return api('GET', query).then(function (res) {
      if (!res.success) { if (res.error) showListError(res.error); return; }
      state.list = res.conversations; state.waiting = res.waiting;
      if (lastWaiting !== null && res.waiting > lastWaiting) beep();
      lastWaiting = res.waiting;
      document.getElementById('waiting').textContent = res.waiting ? '(' + res.waiting + ')' : '';
      document.title = (res.waiting ? '(' + res.waiting + ') ' : '') + 'BRIX chat';
      drawList();
    });
  }
  function showListError(msg) { var box = document.getElementById('items'); box.textContent = ''; box.appendChild(el('p', { class: 'err', style: 'padding:12px', text: msg })); }
  function drawList() {
    var box = document.getElementById('items');
    box.textContent = '';
    if (!state.list.length) { box.appendChild(el('p', { class: 'empty', text: state.filter === 'waiting' ? 'Nobody is waiting.' : 'No chats.' })); return; }
    state.list.forEach(function (c) {
      var tags = [];
      if (c.status === 'closed') tags.push(el('span', { class: 'tag closed', text: 'Closed' }));
      else if (c.needsTeam) tags.push(el('span', { class: 'tag need', text: 'Needs team' }));
      if (c.unreadTeam) tags.push(el('span', { class: 'tag unread', text: c.unreadTeam + ' new' }));
      if (!c.aiPaused && c.status !== 'closed') tags.push(el('span', { class: 'tag ai', text: 'AI' }));
      box.appendChild(el('button', { type: 'button', class: 'item', 'aria-current': String(c.id === state.id), on: { click: function () { openChat(c.id); } } }, [
        el('b', { text: storeName(c) }),
        el('small', { text: c.shop + ' · ' + ago(c.lastMessageAt) }),
        el('small', { text: c.lastPreview || '' }),
        el('div', {}, tags),
      ]));
    });
  }

  // ---------- one chat ----------
  function openChat(id) {
    state.id = id; state.conv = null; state.messages = []; state.lastId = 0;
    drawList();
    loadChat(true).then(function () { api('POST', '', { intent: 'update', id: id, read: true }).then(loadList); });
  }
  function loadChat(full) {
    if (!state.id) return Promise.resolve();
    var id = state.id;
    return api('GET', '?id=' + id + '&after=' + (full ? 0 : state.lastId)).then(function (res) {
      if (id !== state.id || !res.success) return;
      var grew = res.messages.length > 0;
      state.conv = res.conversation;
      res.messages.forEach(function (m) { if (!state.messages.some(function (x) { return x.id === m.id; })) state.messages.push(m); });
      if (state.messages.length) state.lastId = state.messages[state.messages.length - 1].id;
      drawChat(full || grew);
      drawInfo();
      if (grew && !full && state.conv.unreadTeam) api('POST', '', { intent: 'update', id: id, read: true });
    });
  }
  function drawChat(scroll) {
    var box = document.getElementById('chat');
    var c = state.conv;
    var draft = box.querySelector('textarea') ? box.querySelector('textarea').value : '';
    box.textContent = '';
    if (!c) { box.appendChild(el('div', { class: 'empty', text: 'Pick a chat on the left.' })); return; }
    var head = el('div', { class: 'chat-head' }, [
      el('b', { text: storeName(c) }),
      c.aiPaused
        ? el('button', { type: 'button', class: 'plain', title: 'BRIX AI answers this store again', on: { click: function () { update({ aiPaused: false }); } }, text: 'Hand back to AI' })
        : el('button', { type: 'button', class: 'plain', title: 'Stop BRIX AI here; you answer', on: { click: function () { update({ aiPaused: true }); } }, text: 'Take over' }),
      c.status === 'closed'
        ? el('button', { type: 'button', class: 'plain', on: { click: function () { update({ status: 'open' }); } }, text: 'Reopen' })
        : el('button', { type: 'button', class: 'plain', on: { click: function () { update({ status: 'closed' }); } }, text: 'Close' }),
    ]);
    var msgs = el('div', { class: 'msgs', id: 'msgs' });
    state.messages.forEach(function (m) {
      if (m.sender === 'system') { msgs.appendChild(el('div', { class: 'note', text: m.body })); return; }
      var who = m.sender === 'merchant' ? 'Merchant' : m.sender === 'ai' ? 'BRIX AI' : (m.author || 'Team');
      msgs.appendChild(el('div', { class: 'm ' + m.sender }, [el('span', { text: who + ' · ' + ago(m.at) }), el('p', { text: m.body })]));
    });
    var area = el('textarea', { id: 'reply', placeholder: 'Reply to ' + storeName(c) + ' (Ctrl+Enter sends). Replying stops BRIX AI in this chat.', 'aria-label': 'Reply' });
    area.value = draft;
    area.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendReply(); } });
    var quick = el('select', { 'aria-label': 'Quick replies', on: { change: function (e) { if (e.target.value) { area.value = (area.value ? area.value + '\\n' : '') + e.target.value; e.target.value = ''; area.focus(); } } } },
      [el('option', { value: '', text: 'Quick replies…' })].concat(((state.settings && state.settings.quickReplies) || []).map(function (q) { return el('option', { value: q, text: q.length > 70 ? q.slice(0, 70) + '…' : q }); })));
    var err = el('span', { class: 'err', id: 'reply-err' });
    var reply = el('div', { class: 'reply' }, [area, el('div', { class: 'row' }, [quick, el('button', { type: 'button', class: 'main', on: { click: sendReply }, text: 'Send' }), err])]);
    box.appendChild(head); box.appendChild(msgs); box.appendChild(reply);
    if (scroll) msgs.scrollTop = msgs.scrollHeight;
  }
  function drawInfo() {
    var box = document.getElementById('info');
    box.textContent = '';
    var c = state.conv; if (!c) return;
    var x = c.context || {};
    var rows = [['Store', x.name || c.shop], ['Shop', c.shop], ['Website', x.domain], ['Owner', x.owner], ['Email', x.email], ['BRIX plan', x.plan], ['Shopify plan', x.shopifyPlan],
      ['App embed', x.embed], ['Page', x.page], ['Language', x.locale], ['Time zone', x.timeZone], ['Updated', ago(c.contextAt)]];
    var dl = el('dl');
    rows.forEach(function (r) { if (!r[1]) return; dl.appendChild(el('dt', { text: r[0] })); dl.appendChild(el('dd', { text: r[1] })); });
    box.appendChild(el('h2', { text: 'Where this is from' }));
    box.appendChild(dl);
    if (x.features) {
      box.appendChild(el('h2', { style: 'margin-top:14px', text: 'Features' }));
      box.appendChild(el('div', { class: 'chips' }, Object.keys(x.features).map(function (k) { return el('span', { class: 'chip' + (x.features[k] === true ? ' on' : ''), text: k + (x.features[k] === true ? ' on' : x.features[k] === false ? ' off' : ' ?') }); })));
    }
    var links = el('div', { class: 'chips', style: 'margin-top:14px' }, [
      el('a', { href: 'https://' + c.shop + '/admin', target: '_blank', rel: 'noopener', text: 'Shopify admin' }),
      x.domain ? el('a', { href: x.domain, target: '_blank', rel: 'noopener', text: 'Store' }) : null,
      el('a', { href: '/internal/reports?shop=' + encodeURIComponent(c.shop), target: '_blank', rel: 'noopener', text: 'Report' }),
    ]);
    box.appendChild(links);
  }
  function sendReply() {
    var area = document.getElementById('reply');
    var text = area.value.trim();
    var err = document.getElementById('reply-err');
    var author = document.getElementById('agent').value.trim();
    if (!text) return;
    if (!author) { err.textContent = 'Write your name at the top first.'; document.getElementById('agent').focus(); return; }
    err.textContent = '';
    api('POST', '', { intent: 'reply', id: state.id, body: text, author: author }).then(function (res) {
      if (!res.success) { err.textContent = res.error || 'Not sent.'; return; }
      area.value = '';
      loadChat(false); loadList();
    });
  }
  function update(patch) {
    api('POST', '', Object.assign({ intent: 'update', id: state.id }, patch)).then(function (res) {
      if (res.success) { state.conv = res.conversation; drawChat(false); drawInfo(); loadList(); }
    });
  }

  // ---------- settings ----------
  function drawSettings() {
    var box = document.getElementById('settings');
    var s = state.settings; if (!s) return;
    box.textContent = '';
    function field(label, key, type, help) {
      var input = type === 'textarea' ? el('textarea', { id: 's-' + key }) : el('input', { id: 's-' + key, type: type || 'text' });
      input.value = s[key] == null ? '' : s[key];
      return el('label', { for: 's-' + key }, [label, help ? el('small', { text: help }) : null, input]);
    }
    function check(label, key, help) {
      var input = el('input', { id: 's-' + key, type: 'checkbox' }); input.checked = Boolean(s[key]);
      return el('label', { class: 'check', for: 's-' + key }, [input, el('span', {}, [label, help ? el('small', { text: ' ' + help }) : null])]);
    }
    var oh = s.officeHours || {};
    var ohOn = el('input', { id: 's-oh', type: 'checkbox' }); ohOn.checked = Boolean(oh.enabled);
    var tz = el('input', { id: 's-tz' }); tz.value = oh.timeZone || 'Asia/Kolkata';
    var from = el('input', { id: 's-from', type: 'time' }); from.value = oh.from || '10:00';
    var to = el('input', { id: 's-to', type: 'time' }); to.value = oh.to || '19:00';
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var days = el('div', { class: 'days' }, dayNames.map(function (d, i) {
      var c = el('input', { type: 'checkbox', 'data-day': String(i) }); c.checked = (oh.days || []).indexOf(i) !== -1;
      return el('label', {}, [c, d]);
    }));
    var quick = el('textarea', { id: 's-quick' }); quick.value = (s.quickReplies || []).join('\\n');
    var msg = el('span', { id: 's-msg' });
    box.appendChild(el('h2', { style: 'margin:0', text: 'Chat settings' }));
    [
      check('Show the chat in the BRIX admin', 'enabled', 'Off = no launcher for any store.'),
      check('BRIX AI answers first', 'aiEnabled', 'Off = only the team answers.'),
      field('Launcher text', 'launcherText', 'text', 'Shown on the corner button until the merchant first chats (max 40).'),
      field('Greeting', 'greeting', 'textarea', 'The first message in an empty chat.'),
      field('Team name', 'teamName', 'text', 'At the top of the chat.'),
      field('Hand-over message', 'handoffMessage', 'textarea', 'When the chat goes to the team during office hours.'),
      field('Away message', 'awayMessage', 'textarea', 'When the chat goes to the team outside office hours.'),
      field('AI answers per store per day', 'aiDailyLimit', 'number', 'Past it, the chat goes to the team (0 to 500).'),
    ].forEach(function (n) { box.appendChild(n); });
    box.appendChild(el('label', { class: 'check', for: 's-oh' }, [ohOn, 'Office hours']));
    box.appendChild(el('div', { class: 'days' }, [el('label', { for: 's-tz' }, ['Time zone', tz]), el('label', { for: 's-from' }, ['From', from]), el('label', { for: 's-to' }, ['To', to])]));
    box.appendChild(days);
    box.appendChild(el('label', { for: 's-quick' }, ['Quick replies', el('small', { text: 'One per line (max 12).' }), quick]));
    box.appendChild(el('div', {}, [el('button', { type: 'button', class: 'main', on: { click: saveSettings }, text: 'Save settings' }), ' ', msg]));
  }
  function saveSettings() {
    var get = function (id) { return document.getElementById('s-' + id); };
    var days = [].slice.call(document.querySelectorAll('[data-day]')).filter(function (c) { return c.checked; }).map(function (c) { return Number(c.getAttribute('data-day')); });
    var settings = {
      enabled: get('enabled').checked, aiEnabled: get('aiEnabled').checked,
      launcherText: get('launcherText').value, greeting: get('greeting').value, teamName: get('teamName').value,
      handoffMessage: get('handoffMessage').value, awayMessage: get('awayMessage').value, aiDailyLimit: Number(get('aiDailyLimit').value),
      officeHours: { enabled: get('oh').checked, timeZone: get('tz').value, from: get('from').value, to: get('to').value, days: days },
      quickReplies: get('quick').value.split('\\n'),
    };
    var msg = document.getElementById('s-msg');
    msg.className = ''; msg.textContent = 'Saving…';
    api('POST', '', { intent: 'settings', settings: settings }).then(function (res) {
      if (!res.success) { msg.className = 'err'; msg.textContent = res.error || 'Not saved.'; return; }
      state.settings = res.settings; drawSettings();
      var m = document.getElementById('s-msg'); m.className = 'ok'; m.textContent = 'Saved. Merchants see it within a minute.';
    });
  }
  function loadSettings() { return api('GET', '?settings=1').then(function (res) { if (res.success) { state.settings = res.settings; if (state.tab === 'settings') drawSettings(); } }); }

  // ---------- wiring ----------
  [].forEach.call(document.querySelectorAll('[data-filter]'), function (b) {
    b.addEventListener('click', function () {
      state.filter = b.getAttribute('data-filter');
      [].forEach.call(document.querySelectorAll('[data-filter]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      loadList();
    });
  });
  [].forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
    b.addEventListener('click', function () {
      state.tab = b.getAttribute('data-tab');
      [].forEach.call(document.querySelectorAll('[data-tab]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      document.getElementById('inbox').hidden = state.tab !== 'inbox';
      document.getElementById('settings').hidden = state.tab !== 'settings';
      if (state.tab === 'settings') loadSettings().then(drawSettings);
    });
  });
  var qTimer;
  document.getElementById('q').addEventListener('input', function (e) { clearTimeout(qTimer); qTimer = setTimeout(function () { state.q = e.target.value; loadList(); }, 300); });
  var agent = document.getElementById('agent');
  try { agent.value = localStorage.getItem('brixChatAgent') || ''; } catch (e) { /* no storage */ }
  agent.addEventListener('change', function () { try { localStorage.setItem('brixChatAgent', agent.value.trim()); } catch (e) { /* no storage */ } });

  loadSettings();
  loadList();
  setInterval(function () { if (document.visibilityState === 'visible') loadList(); }, 5000);
  setInterval(function () { if (document.visibilityState === 'visible' && state.tab === 'inbox') loadChat(false); }, 3000);
})();
</script>
</body>
</html>`;
}
