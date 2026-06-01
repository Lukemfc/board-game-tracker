/**
 * Dedicated schema on the local dev Postgres so tests never touch dev data.
 * Override with TEST_DATABASE_URL (e.g. in CI, where Postgres is on 5432).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://meeple:meeple@localhost:5433/meeple?schema=meeple_test';

export const TEST_SERVICE_API_KEY = 'test-service-key';
