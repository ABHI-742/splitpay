import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/globalSetup.ts'],
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
