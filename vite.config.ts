import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// `base` is configurable so the same build works at a domain root, or under a
// GitHub Pages subpath (https://user.github.io/<repo>/). './' makes every asset
// URL relative, which works in both cases; override with ORBITAL_BASE=/repo/.
export default defineConfig({
  base: process.env.ORBITAL_BASE ?? './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      // three.js is most of the download and changes rarely: its own file stays cached across game updates.
      output: { advancedChunks: { groups: [{ name: 'three', test: /node_modules[\/]three[\/]/ }] } },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
