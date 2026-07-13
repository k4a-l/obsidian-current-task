import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolve } from 'path';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Inline this dep so its internal `import ... from "obsidian"` goes through
    // the alias below instead of resolving the real (test-incompatible) package.
    server: {
      deps: {
        inline: ['obsidian-daily-notes-interface'],
      },
    },
  },
  resolve: {
    alias: {
      'obsidian': resolve(__dirname, './test/__mock__/obsidian.ts'),
    },
  },
});