import { execSync } from 'node:child_process';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://splitpay:splitpay@localhost:55433/splitpay_test';

/** Creates a clean schema in the test database before any test file runs. */
export default function setup(): void {
  execSync('npx prisma db push --force-reset --skip-generate', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
