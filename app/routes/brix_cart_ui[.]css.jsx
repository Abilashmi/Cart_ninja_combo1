// Serves the storefront drawer's shared stylesheet (item rows, pricing
// summary, image banner) as /brix_cart_ui.css for the Cart Editor preview
// (CartPreview.jsx links it). Real stores load the same file from the theme
// extension's CDN (blocks/cart_drawer.liquid -> asset_url).
//
// Why a route and not `import '.../brix_cart_ui.css'` in the component: in
// `shopify app dev` the CLI proxy answers every /extensions/... URL itself
// (404), so a bundler import of an extension file fails in the browser, which
// takes the whole Cart Editor route module down with it (the page renders
// from the server but nothing can be clicked). Same reason as packs[.]js.jsx.
import stylesheet from '../../extensions/cart-drawer/assets/brix_cart_ui.css?raw';

export async function loader() {
  return new Response(stylesheet, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
