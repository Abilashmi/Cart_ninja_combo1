import { defineConfig } from 'vite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(here, 'stubs.js');

// Bundles the REAL plan page (app.subscribe.jsx) for the browser with its
// server-only modules stubbed. Output in the temp folder (not committed).
// See tests/billing/plans-browser-check.mjs.
export default defineConfig({
  root: here,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  define: { 'process.env': '{}' },
  resolve: {
    alias: [
      { find: /^(\.\.?\/)+services\/[\w-]+\.server(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+shopify\.server(\.js)?$/, replacement: stub },
    ],
  },
  build: { outDir: path.join(os.tmpdir(), 'brix-billing-harness'), emptyOutDir: true, minify: false },
});
