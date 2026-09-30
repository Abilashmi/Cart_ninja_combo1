// Serves the BRIX Packs storefront widget as /packs.js for the admin's
// storefront preview (packs-preview.server.js) and the Playwright checks.
// Real stores load the same file from the theme extension's CDN
// (extensions/cart-drawer/blocks/Packs.liquid -> asset_url).
//
// NOTE the route file name: `packs[.]js.jsx` -> URL `/packs.js`. A bare
// `packs.js.jsx` would be parsed by flat-routes as the nested URL `/packs/js`.
// The widget source lives in extensions/cart-drawer/assets/packs_widget.js as
// plain browser JS (imported as a raw string) so it can be linted and tested.
import widgetSource from '../../extensions/cart-drawer/assets/packs_widget.js?raw';

export async function loader() {
  return new Response(widgetSource, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
