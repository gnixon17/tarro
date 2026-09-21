/**
 * The app's data layer.
 *
 * Every mutation is read-modify-write against whichever backend this page
 * found (`storage.ts`), applying the shared rules in `storeOps.ts`. Calls are
 * serialised through one promise chain so two quick edits cannot both read the
 * same document and clobber each other.
 */
import { demoStore, emptyStore } from './seed';
import { getBackend, type BackendName } from './storage';
import {
  bulkPositions,
  createGroupWithLegs,
  createItem,
  deleteItem,
  restoreBuiltinScenarios,
  updateItem,
  updateSettings,
  type CollectionName,
} from './storeOps';
import type { Account, Instrument, PortfolioStore, Position, Scenario, Settings, StrategyGroup } from './types';

let queue: Promise<unknown> = Promise.resolve();

/** Read, mutate, write - one at a time. */
function mutate<T>(fn: (store: PortfolioStore) => T): Promise<T> {
  const run = queue.then(async () => {
    const backend = await getBackend();
    const store = await backend.load();
    const result = fn(store);
    await backend.save(store);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

function collection<T>(name: CollectionName) {
  return {
    create: (item: Partial<T>) => mutate((store) => createItem(store, name, item) as T),
    update: (key: string, item: Partial<T>) => mutate((store) => updateItem(store, name, key, item) as T),
    remove: (key: string) => mutate((store) => deleteItem(store, name, key)),
  };
}

export const api = {
  async backend(): Promise<{ name: BackendName; description: string; durable: boolean }> {
    const { name, description, durable } = await getBackend();
    return { name, description, durable };
  },

  async getStore(): Promise<PortfolioStore> {
    return (await getBackend()).load();
  },

  async putStore(store: PortfolioStore): Promise<PortfolioStore> {
    await (await getBackend()).save(store);
    return store;
  },

  async reset(mode: 'demo' | 'empty'): Promise<PortfolioStore> {
    const next = mode === 'demo' ? demoStore() : emptyStore();
    await (await getBackend()).save(next);
    return next;
  },

  updateSettings: (settings: Partial<Settings>) => mutate((store) => updateSettings(store, settings)),

  accounts: collection<Account>('accounts'),
  instruments: collection<Instrument>('instruments'),
  positions: collection<Position>('positions'),
  groups: collection<StrategyGroup>('groups'),
  scenarios: collection<Scenario>('scenarios'),

  createGroupWithLegs: (group: Partial<StrategyGroup>, positions: Partial<Position>[]) =>
    mutate((store) => createGroupWithLegs(store, group, positions)),

  bulkPositions: (positions: Partial<Position>[]) => mutate((store) => bulkPositions(store, positions)),

  restoreBuiltinScenarios: () => mutate((store) => restoreBuiltinScenarios(store)),
};
