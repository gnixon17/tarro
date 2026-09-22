/**
 * REST surface.
 *
 * Deliberately thin: it stores and returns the portfolio document, applying the
 * same mutations the browser applies when it is talking to a local store (see
 * `src/lib/storeOps.ts`). All of the pricing and scenario maths lives in
 * `src/lib` and runs in the browser, so moving a slider re-prices instantly.
 */
import express from 'express';
import { driverName, mutateStore, readStore, resetStore, writeStore } from './_store';
import { requestGuard } from './_guard';
import { schwabRouter } from './schwab/routes';
import {
  COLLECTIONS,
  StoreError,
  bulkPositions,
  createGroupWithLegs,
  createItem,
  deleteItem,
  restoreBuiltinScenarios,
  updateItem,
  updateSettings,
  type CollectionName,
} from '../src/lib/storeOps';
import type { PortfolioStore, Position, StrategyGroup } from '../src/lib/types';

export const apiRouter = express.Router();

// Before anything else: this API has no login, so a request has to prove it is
// same-origin and locally addressed before it can change anything.
apiRouter.use(requestGuard);

function wrap(handler: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res).catch(next);
  };
}

apiRouter.use('/schwab', schwabRouter);

apiRouter.get('/health', wrap(async (_req, res) => {
  res.json({ ok: true, driver: driverName() });
}));

apiRouter.get('/store', wrap(async (_req, res) => {
  res.json(await readStore());
}));

apiRouter.put('/store', wrap(async (req, res) => {
  const incoming = req.body as PortfolioStore;
  if (!incoming || !Array.isArray(incoming.accounts)) {
    res.status(400).json({ error: 'Body must be a full portfolio document.' });
    return;
  }
  await writeStore(incoming);
  res.json(await readStore());
}));

apiRouter.post('/store/reset', wrap(async (req, res) => {
  res.json(await resetStore(req.query.mode === 'empty' ? 'empty' : 'demo'));
}));

apiRouter.put('/settings', wrap(async (req, res) => {
  res.json(await mutateStore((s) => updateSettings(s, req.body)));
}));

for (const collection of COLLECTIONS) {
  const base = `/${collection}`;

  apiRouter.get(base, wrap(async (_req, res) => {
    res.json((await readStore())[collection]);
  }));

  apiRouter.post(base, wrap(async (req, res) => {
    res.status(201).json(await mutateStore((store) => createItem(store, collection, req.body)));
  }));

  apiRouter.put(`${base}/:key`, wrap(async (req, res) => {
    res.json(await mutateStore((store) => updateItem(store, collection, req.params.key, req.body)));
  }));

  apiRouter.delete(`${base}/:key`, wrap(async (req, res) => {
    await mutateStore((store) => deleteItem(store, collection as CollectionName, req.params.key));
    res.status(204).end();
  }));
}

/** Create a group and its legs in one call, so a template lands atomically. */
apiRouter.post('/groups/with-legs', wrap(async (req, res) => {
  const { group, positions } = req.body as { group: StrategyGroup; positions: Position[] };
  res.status(201).json(await mutateStore((store) => createGroupWithLegs(store, group, positions)));
}));

/** Bulk insert, used by the CSV importer. */
apiRouter.post('/positions/bulk', wrap(async (req, res) => {
  res.status(201).json(await mutateStore((store) => bulkPositions(store, req.body)));
}));

/** Restore the built-in scenario library without touching anything else. */
apiRouter.post('/scenarios/restore-builtins', wrap(async (_req, res) => {
  res.json(await mutateStore((store) => restoreBuiltinScenarios(store)));
}));

apiRouter.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof StoreError ? err.status : 500;
  if (status >= 500) console.error('API error:', err);
  res.status(status).json({ error: err.message ?? 'Internal Server Error' });
});
