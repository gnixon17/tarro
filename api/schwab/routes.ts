/**
 * Schwab routes.
 *
 * No endpoint here ever returns a token, a client secret, or a full account
 * number. Status answers "is there a working connection and until when";
 * everything else moves portfolio data.
 */
import express from 'express';
import { mutateStore, readStore } from '../_store';
import { applySyncPlan, buildSyncPlan, type SyncPlan } from '../../src/lib/brokers/reconcile';
import {
  applyMarketData,
  fetchAccounts,
  fetchMarketData,
  rawShapes,
  type MarketDataResult,
} from './sync';
import { SchwabAuthError } from './client';
import { consumeState, createAuthorizeUrl, exchangeCode, parseCallbackInput, readConfig } from './oauth';
import { clearTokens, keyOrigin, loadTokens } from './tokens';

export const schwabRouter = express.Router();

function wrap(handler: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res).catch(next);
  };
}

/**
 * Plans are held in memory between preview and apply so the user approves
 * exactly what they were shown, not a re-fetch that may have moved underneath
 * them. A restart drops them, which just means previewing again.
 */
let lastPlan: SyncPlan | null = null;
let lastMarketData: MarketDataResult | null = null;

schwabRouter.get('/status', wrap(async (_req, res) => {
  const config = readConfig();
  const tokens = await loadTokens();
  const store = await readStore();

  res.json({
    configured: config !== null,
    redirectUri: config?.redirectUri ?? null,
    connected: tokens !== null && Date.now() < tokens.refreshExpiresAt,
    // Schwab refresh tokens last seven days and cannot be extended.
    reconnectBy: tokens ? new Date(tokens.refreshExpiresAt).toISOString() : null,
    connectedAt: tokens ? new Date(tokens.createdAt).toISOString() : null,
    keyOrigin: keyOrigin(),
    linkedAccounts: store.accounts
      .filter((a) => a.externalId)
      .map((a) => ({ id: a.id, name: a.name, label: a.externalLabel, lastSyncedAt: a.lastSyncedAt })),
  });
}));

schwabRouter.post('/authorize-url', wrap(async (_req, res) => {
  const config = readConfig();
  if (!config) {
    res.status(400).json({ error: 'Set SCHWAB_APP_KEY and SCHWAB_APP_SECRET on the server, then restart it.' });
    return;
  }
  const { url } = createAuthorizeUrl(config);
  res.json({ url, redirectUri: config.redirectUri });
}));

/**
 * Finish the login.
 *
 * Schwab requires an HTTPS callback, which a local HTTP server cannot serve, so
 * the normal path is for the user to paste back the address they were
 * redirected to. The GET callback below covers the case where the app is
 * actually fronted by HTTPS.
 */
schwabRouter.post('/connect', wrap(async (req, res) => {
  const config = readConfig();
  if (!config) {
    res.status(400).json({ error: 'Schwab credentials are not configured on the server.' });
    return;
  }

  const parsed = parseCallbackInput(String(req.body?.redirectedUrl ?? ''));
  if (!parsed) {
    res.status(400).json({ error: 'Could not find an authorization code in that. Paste the whole address you were redirected to.' });
    return;
  }

  // Unconditional: the caller is the one who decides whether to include a
  // state, so making the check conditional on its presence would let anyone
  // skip it by simply omitting it, and inject an authorization code of their
  // own — binding this portfolio to someone else's brokerage account.
  if (!consumeState(parsed.state)) {
    res.status(400).json({
      error: 'That login did not start here, or it expired. Paste the whole address you were redirected to, or start again from Connect.',
    });
    return;
  }

  await exchangeCode(config, parsed.code);
  res.json({ ok: true });
}));

schwabRouter.get('/callback', wrap(async (req, res) => {
  const config = readConfig();
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;

  if (!config || !code || !consumeState(state)) {
    res.status(400).send('<h1>Could not complete the Schwab connection.</h1><p>Start again from the Connections page.</p>');
    return;
  }

  await exchangeCode(config, code);
  res.send('<h1>Connected to Schwab.</h1><p>You can close this tab and return to Tarro.</p>');
}));

schwabRouter.post('/disconnect', wrap(async (_req, res) => {
  await clearTokens();
  lastPlan = null;
  lastMarketData = null;
  res.json({ ok: true });
}));

/** Link a Schwab account to a Tarro account. Registration type stays the user's call. */
schwabRouter.post('/link', wrap(async (req, res) => {
  const { accountId, externalId, externalLabel } = req.body ?? {};
  if (!accountId || !externalId) {
    res.status(400).json({ error: 'accountId and externalId are required.' });
    return;
  }
  const account = await mutateStore((store) => {
    const target = store.accounts.find((a) => a.id === accountId);
    if (!target) throw new Error(`No account ${accountId}.`);
    const clash = store.accounts.find((a) => a.externalId === externalId && a.id !== accountId);
    if (clash) throw new Error(`${clash.name} is already linked to that Schwab account.`);
    target.externalId = externalId;
    target.externalLabel = externalLabel;
    return target;
  });
  res.json(account);
}));

schwabRouter.post('/unlink', wrap(async (req, res) => {
  const { accountId } = req.body ?? {};
  await mutateStore((store) => {
    const target = store.accounts.find((a) => a.id === accountId);
    if (!target) throw new Error(`No account ${accountId}.`);
    delete target.externalId;
    delete target.externalLabel;
    delete target.lastSyncedAt;
  });
  res.json({ ok: true });
}));

/** What Schwab reports, so unlinked accounts can be matched up. */
schwabRouter.get('/accounts', wrap(async (_req, res) => {
  const { accounts, warnings } = await fetchAccounts();
  res.json({
    accounts: accounts.map((a) => ({
      externalId: a.externalId,
      externalLabel: a.externalLabel,
      marginType: a.marginType,
      positions: a.positions.length,
      cash: a.cash,
      liquidationValue: a.liquidationValue,
    })),
    warnings,
  });
}));

schwabRouter.post('/preview', wrap(async (_req, res) => {
  const store = await readStore();
  const { accounts, warnings } = await fetchAccounts();
  lastPlan = buildSyncPlan({ store, accounts, warnings });
  res.json(lastPlan);
}));

schwabRouter.post('/apply', wrap(async (req, res) => {
  if (!lastPlan) {
    res.status(409).json({ error: 'Nothing to apply. Preview the sync first.' });
    return;
  }
  const keys: string[] | undefined = Array.isArray(req.body?.acceptedKeys) ? req.body.acceptedKeys : undefined;
  const plan = lastPlan;
  const result = await mutateStore((store) => applySyncPlan(store, plan, keys ? new Set(keys) : undefined));
  lastPlan = null;
  res.json(result);
}));

schwabRouter.post('/market-data/preview', wrap(async (_req, res) => {
  const store = await readStore();
  lastMarketData = await fetchMarketData(store);
  res.json(lastMarketData);
}));

schwabRouter.post('/market-data/apply', wrap(async (req, res) => {
  if (!lastMarketData) {
    res.status(409).json({ error: 'Nothing to apply. Refresh market data first.' });
    return;
  }
  const symbols: string[] | undefined = Array.isArray(req.body?.acceptedSymbols) ? req.body.acceptedSymbols : undefined;
  const data = lastMarketData;
  const result = await mutateStore((store) => applyMarketData(store, data, symbols ? new Set(symbols) : undefined));
  lastMarketData = null;
  res.json(result);
}));

/**
 * The keys Schwab actually returned on the last call, values stripped.
 *
 * Schwab's schemas are published but not contractual. If a field is renamed,
 * a number here goes quietly missing rather than erroring, so this exists to
 * make that visible on the first real connection.
 */
schwabRouter.get('/raw-shapes', wrap(async (_req, res) => {
  res.json(rawShapes());
}));

schwabRouter.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof SchwabAuthError ? 401 : 500;
  if (status >= 500) console.error('Schwab error:', err);
  res.status(status).json({ error: err?.message ?? 'Schwab request failed.' });
});
