// Serves the storefront combo-page mounter as a real .js asset. Published
// combo pages (app/routes/api.bundle-templates.jsx's PAGE_BODY) load this
// via a plain <script src="..."> tag — Shopify Pages don't process Liquid in
// their body content, so this can't be a theme-extension asset; it has to be
// served directly from this app instead (see conversation: verified live on
// fpzz1i-ds.myshopify.com that {{ 'x' | asset_url }} renders as literal text
// inside a Page body).
//
// Mounts an iframe onto app/routes/preview.$templateId.jsx (?embed=1) instead
// of hand-rendering the combo UI in vanilla JS. That route already has the
// real per-variant selection/checkout logic and supports every layout
// (layout1-4) — embedding it guarantees the storefront always matches the
// builder's design, with no second rendering implementation to keep in sync.
const SCRIPT_BODY = String.raw`
(function () {
  var CURRENT_SCRIPT = document.currentScript;
  var API_ORIGIN = CURRENT_SCRIPT ? new URL(CURRENT_SCRIPT.src).origin : '';

  // Mounts the iframe and wires up the postMessage-based auto-resize
  // (preview.$templateId.jsx reports its content height since cross-origin
  // means we can't measure the iframe's DOM directly).
  function mountIframe(root, shop, templateId) {
    root.innerHTML = '';
    var iframe = document.createElement('iframe');
    iframe.src = API_ORIGIN + '/preview/' + encodeURIComponent(templateId) +
      '?shop=' + encodeURIComponent(shop) + '&embed=1';
    iframe.style.cssText = 'width:100%;border:0;display:block;min-height:200px;';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', 'Combo');
    root.appendChild(iframe);

    window.addEventListener('message', function (e) {
      if (!e.data || e.data.type !== 'brix-combo-resize') return;
      if (e.source !== iframe.contentWindow) return;
      if (typeof e.data.height === 'number' && e.data.height > 0) {
        iframe.style.height = e.data.height + 'px';
      }
    });
  }

  // Explicit mount point — used when a page's own body/template already
  // knows which combo template it is (the guaranteed-template path, pending
  // Shopify's themeFilesUpsert exemption; see api.bundle-templates.jsx).
  function init(root) {
    var shop = root.dataset.shop;
    var templateId = root.dataset.templateId;
    if (!shop || !templateId) return;
    mountIframe(root, shop, templateId);
  }

  // Auto-detect mode — runs on every page via the cart-drawer app embed
  // (already loaded globally on every page for merchants who've enabled it),
  // since that embed has no way to know in advance which pages are combo
  // pages. Cheap early-outs: only even attempts a lookup on /pages/* URLs,
  // and skips entirely if an explicit [data-brix-combo-root] already exists
  // (the guaranteed-template path, once Shopify's exemption lands, takes
  // priority and this would otherwise double-render).
  function autoDetectAndInject() {
    if (document.querySelector('[data-brix-combo-root]')) return;

    var match = window.location.pathname.match(/\/pages\/([^/?#]+)/);
    if (!match) return;
    var handle = match[1];

    var shop = (window.Shopify && window.Shopify.shop) || window.location.hostname;

    var main = document.querySelector('main#MainContent') || document.querySelector('main[role="main"]') || document.querySelector('main');
    var container = main || document.body;

    var root = document.createElement('div');
    root.setAttribute('data-brix-combo-root', '');
    root.style.display = 'none'; // hidden until we confirm this handle is actually a combo page
    container.appendChild(root);

    // Only used here to resolve handle -> templateId (the mount target itself
    // is the shared preview route, not this JSON — see mountIframe above).
    fetch(API_ORIGIN + '/api/combo-page-data?shop=' + encodeURIComponent(shop) + '&handle=' + encodeURIComponent(handle))
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (json.success && json.data && json.data.templateId) {
          mountIframe(root, shop, json.data.templateId);
          root.style.display = '';
        } else {
          root.remove(); // not a combo page — leave the theme's own content untouched
        }
      })
      .catch(function () { root.remove(); });
  }

  function boot() {
    var roots = document.querySelectorAll('[data-brix-combo-root]');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
    autoDetectAndInject();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;

export async function loader() {
  return new Response(SCRIPT_BODY, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
