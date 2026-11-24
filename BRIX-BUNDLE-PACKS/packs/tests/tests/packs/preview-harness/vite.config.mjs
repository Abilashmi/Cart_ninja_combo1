import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Bundles the REAL admin PackPreview component for tests/packs/preview-browser-check.mjs.
export default defineConfig({
  root: here,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, minify: false },
});
