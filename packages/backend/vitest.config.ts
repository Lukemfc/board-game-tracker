import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL, TEST_SERVICE_API_KEY } from './test/constants';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      SERVICE_API_KEY: TEST_SERVICE_API_KEY,
      LOG_LEVEL: 'silent',
      PORT: '3001',
    },
    // One process, sequential files: tests share a single Postgres schema and
    // reset it between tests, so they must not run concurrently.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    hookTimeout: 60000,
  },
});
