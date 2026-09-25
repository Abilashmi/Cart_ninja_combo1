// Serves the BRIX Packs storefront widget as a real /packs.js asset (loaded
// by extensions/cart-drawer/blocks/cart_drawer.liquid on product pages).
//
// NOTE the route file name: `packs[.]js.jsx` -> URL `/packs.js`. A bare
// `packs.js.jsx` would be parsed by flat-routes as the nested URL `/packs/js`.
// The widget source lives in app/storefront/packs-widget.js as plain browser
// JS (imported as a raw string) so it can be linted and tested as real code.
import widgetSource from '../storefront/packs-widget.js?raw';

export async function loader() {
  return new Response(widgetSource, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
