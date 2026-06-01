import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './constants';

/**
 * Apply migrations to the dedicated test schema before the suite runs.
 * Non-destructive (forward-only); per-test TRUNCATE keeps tests isolated.
 */
export default function setup() {
  execSync('node_modules/.bin/prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
