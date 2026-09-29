import { defineConfig } from 'vitest/config';

// Unit tests for plain TypeScript (utils); nothing here boots Angular.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
