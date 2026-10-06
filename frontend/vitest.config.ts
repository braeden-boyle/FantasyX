import { defineConfig } from 'vitest/config';

// Unit tests for plain TypeScript (utils, and the capture script's helpers); nothing here boots Angular.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    environment: 'node',
  },
});
