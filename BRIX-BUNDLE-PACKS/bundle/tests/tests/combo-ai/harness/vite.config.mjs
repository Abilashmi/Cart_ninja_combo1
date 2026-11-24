import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same stubs as tests/ai-handoff/harness: the builder route's loader/action
// are mocked in main.jsx, so its server-only imports never run.
const here = path.dirname(fileURLToPath(import.meta.url));
const stubs = path.join(here, '..', '..', 'ai-handoff', 'harness');
const stub = path.join(stubs, 'server-stub.js');

export default defineConfig({
  root: here,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: '@shopify/app-bridge-react', replacement: path.join(stubs, 'app-bridge-stub.js') },
      { find: /^(\.\.?\/)+shopify\.server(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+db\.server(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+utils\/api-helpers(\.js)?$/, replacement: stub },
      { find: /^(\.\.?\/)+services\/[\w-]+\.server(\.js)?$/, replacement: stub },
    ],
  },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, minify: false },
});
