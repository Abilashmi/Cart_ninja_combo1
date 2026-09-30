import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(here, 'stubs.js');

// Bundles the REAL Coupon Banner page (app.productwidget.jsx) and Discount
// Creator (app.discounts.create.jsx) for the browser with server-only modules,
// BrixBar and App Bridge replaced by stubs. See tests/coupon-banner/admin-browser-check.mjs.
export default defineConfig({
  root: here,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  define: { 'process.env': '{}' },
  resolve: {
    alias: [
      { find: '@shopify/app-bridge-react', replacement: stub },
      { find: '@shopify/shopify-app-react-router/server', replacement: stub },
      { find: /^(\.\.?\/)+services\/[\w-]+\.server(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+shopify\.server(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+components\/ai-agent\/BrixBar(\.jsx)?$/, replacement: stub },
    ],
  },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, minify: false },
});
