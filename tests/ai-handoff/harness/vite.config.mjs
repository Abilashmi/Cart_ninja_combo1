import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(here, 'server-stub.js');

export default defineConfig({
  root: here,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: '@shopify/app-bridge-react', replacement: path.join(here, 'app-bridge-stub.js') },
      // server-only modules pulled in by the builder route (its loader/action are mocked)
      { find: /^(\.\.?\/)+shopify\.server(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+db\.server(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+utils\/api-helpers(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+services\/[\w-]+\.server(\.js)?$/, replacement: stub },
    ],
  },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, minify: false },
});
