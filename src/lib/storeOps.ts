/**
 * Portfolio mutations, as pure functions over the store document.
 *
 * Shared by the Express API and by the browser-side storage backends, so a
 * delete cascades the same way and a built-in scenario is protected the same
 * way no matter which one is doing the writing.
 */
import { newId } from './id';
import { emptyStore } from './seed';
import { BUILTIN_SCENARIOS, makeScenario } from './sim/presets';
import {
  DEFAULT_SETTINGS,
  DEFAULT_VOL_MODEL,
  type PortfolioStore,
  type Position,
  type Scenario,
  type Settings,
  type StrategyGroup,
} from './types';

/** Fill in anything an older or hand-edited document is missing. */
export function normalizeStore(raw: Partial<PortfolioStore> | null | undefined): PortfolioStore {
  const base = emptyStore();
  if (!raw) return base;
  return {
    accounts: raw.accounts ?? [],
    instruments: raw.instruments ?? [],
    positions: raw.positions ?? [],
    groups: raw.groups ?? [],
    scenarios: raw.scenarios ?? base.scenarios,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(raw.settings ?? {}),
      volModel: { ...DEFAULT_VOL_MODEL, ...(raw.settings?.volModel ?? {}) },
    },
  };
}

export type CollectionName = 'accounts' | 'instruments' | 'positions' | 'groups' | 'scenarios';

export const COLLECTIONS: CollectionName[] = ['accounts', 'instruments', 'positions', 'groups', 'scenarios'];

const ID_PREFIX: Record<CollectionName, string> = {
  accounts: 'acc',
  instruments: 'ins',
  positions: 'pos',
  groups: 'grp',
  scenarios: 'scn',
};

/** An error with an HTTP status, so the API can map it straight onto a response. */
export class StoreError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/** Instruments are keyed by symbol; everything else by id. */
export function keyOf(collection: CollectionName, item: any): string {
  return collection === 'instruments' ? String(item.symbol).toUpperCase() : item.id;
}

export function normalizeKey(collection: CollectionName, key: string): string {
  return collection === 'instruments' ? key.toUpperCase() : key;
}

export function createItem(store: PortfolioStore, collection: CollectionName, body: any): any {
  const list = store[collection] as any[];
  const item = { ...body };

  if (collection === 'instruments') {
    item.symbol = String(item.symbol ?? '').toUpperCase().trim();
    if (!item.symbol) throw new StoreError(400, 'symbol is required');
    if (list.some((x) => keyOf(collection, x) === item.symbol)) {
      throw new StoreError(409, `${item.symbol} already exists`);
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
}

export function updateItem(store: PortfolioStore, collection: CollectionName, rawKey: string, body: any): any {
  const key = normalizeKey(collection, rawKey);
  const list = store[collection] as any[];
  const index = list.findIndex((x) => keyOf(collection, x) === key);
  if (index === -1) throw new StoreError(404, `${collection} ${key} not found`);
  if (collection === 'scenarios' && list[index].builtIn) {
    throw new StoreError(409, 'Built-in scenarios cannot be edited. Duplicate it first.');
  }

  const merged = { ...list[index], ...body };
  if (collection === 'instruments') {
    merged.symbol = key;
    merged.updatedAt = new Date().toISOString();
  } else {
    merged.id = list[index].id;
  }
  if (collection === 'scenarios') merged.updatedAt = new Date().toISOString();

  list[index] = merged;
  return merged;
}

export function deleteItem(store: PortfolioStore, collection: CollectionName, rawKey: string): void {
  const key = normalizeKey(collection, rawKey);
  const list = store[collection] as any[];
  const index = list.findIndex((x) => keyOf(collection, x) === key);
  if (index === -1) throw new StoreError(404, `${collection} ${key} not found`);
  if (collection === 'scenarios' && list[index].builtIn) {
    throw new StoreError(409, 'Built-in scenarios cannot be deleted.');
  }
  list.splice(index, 1);

  // Referential integrity: a deleted account or ticker takes its positions with
  // it; a deleted group only orphans its legs, since the legs are still held.
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
}

export function createGroupWithLegs(
  store: PortfolioStore,
  group: Partial<StrategyGroup>,
  positions: Partial<Position>[],
): { group: StrategyGroup; positions: Position[] } {
  if (!group || !Array.isArray(positions)) {
    throw new StoreError(400, 'Body must be { group, positions }.');
  }
  const groupId = group.id || newId('grp');
  const saved = { ...group, id: groupId } as StrategyGroup;
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
}

export function bulkPositions(store: PortfolioStore, incoming: Partial<Position>[]): Position[] {
  if (!Array.isArray(incoming)) throw new StoreError(400, 'Body must be an array of positions.');
  const created = incoming.map((p) => ({
    ...p,
    id: p.id || newId('pos'),
    symbol: String(p.symbol ?? '').toUpperCase(),
  })) as Position[];
  store.positions.push(...created);
  return created;
}

export function restoreBuiltinScenarios(store: PortfolioStore): Scenario[] {
  const existing = new Set(store.scenarios.filter((s) => s.builtIn).map((s) => s.name));
  for (const init of BUILTIN_SCENARIOS) {
    if (!existing.has(init.name)) store.scenarios.push(makeScenario(init));
  }
  return store.scenarios;
}

export function updateSettings(store: PortfolioStore, patch: Partial<Settings>): Settings {
  store.settings = { ...store.settings, ...patch };
  return store.settings;
}
