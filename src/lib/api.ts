/** Thin client for the persistence API. All maths happens locally. */
import type { Account, Instrument, PortfolioStore, Position, Scenario, StrategyGroup } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* response had no JSON body */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const collection = <T>(name: string) => ({
  list: () => request<T[]>(`/${name}`),
  create: (item: Partial<T>) => request<T>(`/${name}`, { method: 'POST', body: JSON.stringify(item) }),
  update: (key: string, item: Partial<T>) =>
    request<T>(`/${name}/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(item) }),
  remove: (key: string) => request<void>(`/${name}/${encodeURIComponent(key)}`, { method: 'DELETE' }),
});

export const api = {
  health: () => request<{ ok: boolean; driver: string }>('/health'),
  getStore: () => request<PortfolioStore>('/store'),
  putStore: (store: PortfolioStore) => request<PortfolioStore>('/store', { method: 'PUT', body: JSON.stringify(store) }),
  reset: (mode: 'demo' | 'empty') => request<PortfolioStore>(`/store/reset?mode=${mode}`, { method: 'POST' }),
  updateSettings: (settings: Partial<PortfolioStore['settings']>) =>
    request<PortfolioStore['settings']>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  accounts: collection<Account>('accounts'),
  instruments: collection<Instrument>('instruments'),
  positions: collection<Position>('positions'),
  groups: collection<StrategyGroup>('groups'),
  scenarios: collection<Scenario>('scenarios'),

  createGroupWithLegs: (group: Partial<StrategyGroup>, positions: Partial<Position>[]) =>
    request<{ group: StrategyGroup; positions: Position[] }>('/groups/with-legs', {
      method: 'POST',
      body: JSON.stringify({ group, positions }),
    }),
  bulkPositions: (positions: Partial<Position>[]) =>
    request<Position[]>('/positions/bulk', { method: 'POST', body: JSON.stringify(positions) }),
  restoreBuiltinScenarios: () => request<Scenario[]>('/scenarios/restore-builtins', { method: 'POST' }),
};
