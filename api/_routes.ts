/**
 * REST surface.
 *
 * Deliberately thin: it stores and returns the portfolio document. All of the
 * pricing and scenario maths lives in `src/lib` and runs in the browser, so
 * moving a slider re-prices instantly instead of round-tripping.
 */
import express from 'express';
import { driverName, mutateStore, readStore, resetStore, writeStore } from './_store';
import { newId } from '../src/lib/id';
import { BUILTIN_SCENARIOS, makeScenario } from '../src/lib/sim/presets';
import type { Account, Instrument, PortfolioStore, Position, Scenario, StrategyGroup } from '../src/lib/types';

export const apiRouter = express.Router();

function wrap(handler: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res).catch(next);
  };
}

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
  const mode = req.query.mode === 'empty' ? 'empty' : 'demo';
  res.json(await resetStore(mode));
}));

apiRouter.put('/settings', wrap(async (req, res) => {
  const store = await mutateStore((s) => {
    s.settings = { ...s.settings, ...req.body };
    return s;
  });
  res.json(store.settings);
}));

// --- generic collection CRUD ----------------------------------------------

type CollectionName = 'accounts' | 'instruments' | 'positions' | 'groups' | 'scenarios';

const ID_PREFIX: Record<CollectionName, string> = {
  accounts: 'acc',
  instruments: 'ins',
  positions: 'pos',
  groups: 'grp',
  scenarios: 'scn',
};

/** Instruments are keyed by symbol; everything else by id. */
function keyOf(collection: CollectionName, item: any): string {
  return collection === 'instruments' ? String(item.symbol).toUpperCase() : item.id;
}

function registerCollection(collection: CollectionName) {
  const base = `/${collection}`;

  apiRouter.get(base, wrap(async (_req, res) => {
    const store = await readStore();
    res.json(store[collection]);
  }));

  apiRouter.post(base, wrap(async (req, res) => {
    const created = await mutateStore((store) => {
      const list = store[collection] as any[];
      const item = { ...req.body };
      if (collection === 'instruments') {
        item.symbol = String(item.symbol ?? '').toUpperCase().trim();
        if (!item.symbol) throw new HttpError(400, 'symbol is required');
        if (list.some((x) => keyOf(collection, x) === item.symbol)) {
          throw new HttpError(409, `${item.symbol} already exists`);
        }
        item.updatedAt = new Date().toISOString();
      } else {
        item.id = item.id || newId(ID_PREFIX[collection]);
      }
      if (collection === 'scenarios') {
        item.createdAt = item.createdAt ?? new Date().toISOString();
        item.updatedAt = new Date().toISOString();
        item.builtIn = false;
      }
      if (collection === 'positions') item.symbol = String(item.symbol ?? '').toUpperCase().trim();
      list.push(item);
      return item;
    });
    res.status(201).json(created);
  }));

  apiRouter.put(`${base}/:key`, wrap(async (req, res) => {
    const key = collection === 'instruments' ? req.params.key.toUpperCase() : req.params.key;
    const updated = await mutateStore((store) => {
      const list = store[collection] as any[];
      const index = list.findIndex((x) => keyOf(collection, x) === key);
      if (index === -1) throw new HttpError(404, `${collection} ${key} not found`);
      if (collection === 'scenarios' && list[index].builtIn) {
        throw new HttpError(409, 'Built-in scenarios cannot be edited. Duplicate it first.');
      }
      const merged = { ...list[index], ...req.body };
      if (collection === 'instruments') {
        merged.symbol = key;
        merged.updatedAt = new Date().toISOString();
      } else {
        merged.id = list[index].id;
      }
      if (collection === 'scenarios') merged.updatedAt = new Date().toISOString();
      list[index] = merged;
      return merged;
    });
    res.json(updated);
  }));

  apiRouter.delete(`${base}/:key`, wrap(async (req, res) => {
    const key = collection === 'instruments' ? req.params.key.toUpperCase() : req.params.key;
    await mutateStore((store) => {
      const list = store[collection] as any[];
      const index = list.findIndex((x) => keyOf(collection, x) === key);
      if (index === -1) throw new HttpError(404, `${collection} ${key} not found`);
      if (collection === 'scenarios' && list[index].builtIn) {
        throw new HttpError(409, 'Built-in scenarios cannot be deleted.');
      }
      list.splice(index, 1);

      // Keep referential integrity: a deleted account takes its positions with
      // it, a deleted group orphans its legs rather than deleting them.
      if (collection === 'accounts') {
        store.positions = store.positions.filter((p: Position) => p.accountId !== key);
        store.groups = store.groups.filter((g: StrategyGroup) => g.accountId !== key);
      }
      if (collection === 'groups') {
        for (const p of store.positions) if (p.groupId === key) p.groupId = null;
      }
      if (collection === 'instruments') {
        store.positions = store.positions.filter((p: Position) => p.symbol !== key);
        store.groups = store.groups.filter((g: StrategyGroup) => g.symbol !== key);
      }
    });
    res.status(204).end();
  }));
}

(['accounts', 'instruments', 'positions', 'groups', 'scenarios'] as CollectionName[]).forEach(registerCollection);

/** Create a group and its legs in one call, so a template lands atomically. */
apiRouter.post('/groups/with-legs', wrap(async (req, res) => {
  const { group, positions } = req.body as { group: StrategyGroup; positions: Position[] };
  if (!group || !Array.isArray(positions)) {
    res.status(400).json({ error: 'Body must be { group, positions }.' });
    return;
  }
  const result = await mutateStore((store) => {
    const groupId = group.id || newId('grp');
    const saved: StrategyGroup = { ...group, id: groupId };
    store.groups.push(saved);
    const legs = positions.map((p) => ({
      ...p,
      id: p.id || newId('pos'),
      groupId,
      accountId: p.accountId || saved.accountId,
      symbol: String(p.symbol ?? saved.symbol).toUpperCase(),
    })) as Position[];
    store.positions.push(...legs);
    return { group: saved, positions: legs };
  });
  res.status(201).json(result);
}));

/** Bulk insert, used by the CSV importer. */
apiRouter.post('/positions/bulk', wrap(async (req, res) => {
  const incoming = req.body as Position[];
  if (!Array.isArray(incoming)) {
    res.status(400).json({ error: 'Body must be an array of positions.' });
    return;
  }
  const saved = await mutateStore((store) => {
    const created = incoming.map((p) => ({
      ...p,
      id: p.id || newId('pos'),
      symbol: String(p.symbol ?? '').toUpperCase(),
    })) as Position[];
    store.positions.push(...created);
    return created;
  });
  res.status(201).json(saved);
}));

/** Restore the built-in scenario library without touching anything else. */
apiRouter.post('/scenarios/restore-builtins', wrap(async (_req, res) => {
  const scenarios = await mutateStore((store) => {
    const existing = new Set(store.scenarios.filter((s: Scenario) => s.builtIn).map((s: Scenario) => s.name));
    for (const init of BUILTIN_SCENARIOS) {
      if (!existing.has(init.name)) store.scenarios.push(makeScenario(init));
    }
    return store.scenarios;
  });
  res.json(scenarios);
}));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

apiRouter.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error('API error:', err);
  res.status(status).json({ error: err.message ?? 'Internal Server Error' });
});

export type { Account, Instrument, Position, Scenario, StrategyGroup };
