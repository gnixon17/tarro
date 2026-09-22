/**
 * Run a stand-in for Schwab on a fixed port, and seed a token for it.
 *
 * Lets the Connections page be exercised without a Schwab developer account.
 * Never point this at anything real:
 *
 *   export TARRO_SECRET_KEY=dev-only-key-not-a-secret
 *   npx tsx scripts/mock-schwab.ts &
 *   SCHWAB_API_BASE=http://127.0.0.1:4599 SCHWAB_APP_KEY=mock SCHWAB_APP_SECRET=mock npm run dev
 *
 * Both processes need the SAME TARRO_SECRET_KEY: the seeded token is encrypted
 * with it, and the server will treat a token it cannot decrypt as no token at
 * all — which is the right behaviour, just confusing if the keys differ.
 */
import { startMockSchwab } from '../test/fixtures/schwabServer';
import { saveTokens } from '../api/schwab/tokens';

const PORT = Number(process.env.MOCK_SCHWAB_PORT) || 4599;

const server = await startMockSchwab({ port: PORT });
console.log(`Mock Schwab listening on ${server.origin}`);

if (process.env.SEED_TOKENS !== 'false') {
  await saveTokens({
    accessToken: 'mock-access',
    refreshToken: 'mock-refresh',
    accessExpiresAt: Date.now() + 25 * 60 * 1000,
    refreshExpiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
  });
  console.log('Seeded a mock token so the Connections page shows as connected.');
}
