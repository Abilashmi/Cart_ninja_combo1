import { defineConfig } from 'vite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(here, 'stubs.js');

// Bundles the REAL Account and Home pages for the browser with their
// server-only modules stubbed, in the admin language the page asks for.
// Output in the temp folder (not committed). See ../admin-browser-check.mjs.
export default defineConfig({
  root: here,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  define: { 'process.env': '{}' },
  resolve: {
    alias: [
      { find: /^(\.\.?\/)+(services|utils|i18n)\/[\w-]+\.server(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+shopify\.server(\.js)?$/, replacement: stub },
    ],
  },
  build: { outDir: path.join(os.tmpdir(), 'brix-i18n-admin-harness'), emptyOutDir: true, minify: false },
});
