import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: '@shopify/app-bridge-react', replacement: path.join(here, 'app-bridge-stub.js') },
      { find: /^(\.\.?\/)+services\/[\w-]+\.server(\.js)?$/, replacement: path.join(here, 'server-stub.js') },
    ],
  },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, minify: false },
});
