/** Client for the Schwab endpoints. Server-only: these 404 on a static build. */
import type { SyncPlan } from './brokers/reconcile';

export interface SchwabStatus {
  configured: boolean;
  redirectUri: string | null;
  connected: boolean;
  reconnectBy: string | null;
  connectedAt: string | null;
  keyOrigin: 'env' | 'file';
  linkedAccounts: { id: string; name: string; label?: string; lastSyncedAt?: string }[];
}

export interface BrokerAccount {
  externalId: string;
  externalLabel: string;
  marginType: string;
  positions: number;
  cash: number;
  liquidationValue: number | null;
}

export interface InstrumentUpdate {
  symbol: string;
  price?: { before: number; after: number };
  dividendYield?: { before: number; after: number };
  surface?: {
    before: { ivAtm30: number; skewSlope: number; skewCurvature: number; termSlope: number };
    after: { ivAtm30: number; skewSlope: number; skewCurvature: number; termSlope: number };
    rmseVolPoints: number;
    samples: number;
    expiries: number;
  };
}

export interface MarketDataResult {
  instruments: InstrumentUpdate[];
  contracts: { positionId: string; externalSymbol: string; iv: number | null; mark: number | null; before?: number }[];
  warnings: string[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/schwab${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* no JSON body */
    }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const schwab = {
  status: () => call<SchwabStatus>('/status'),
  authorizeUrl: () => post<{ url: string; redirectUri: string }>('/authorize-url'),
  connect: (redirectedUrl: string) => post<{ ok: true }>('/connect', { redirectedUrl }),
  disconnect: () => post<{ ok: true }>('/disconnect'),
  brokerAccounts: () => call<{ accounts: BrokerAccount[]; warnings: string[] }>('/accounts'),
  link: (accountId: string, externalId: string, externalLabel: string) =>
    post('/link', { accountId, externalId, externalLabel }),
  unlink: (accountId: string) => post('/unlink', { accountId }),
  preview: () => post<SyncPlan>('/preview'),
  apply: (acceptedKeys: string[]) =>
    post<{ created: number; updated: number; adopted: number; closed: number; instrumentsCreated: number }>(
      '/apply',
      { acceptedKeys },
    ),
  marketDataPreview: () => post<MarketDataResult>('/market-data/preview'),
  marketDataApply: (acceptedSymbols: string[]) =>
    post<{ pricesUpdated: number; surfacesFitted: number; contractsMarked: number }>('/market-data/apply', {
      acceptedSymbols,
    }),
  rawShapes: () => call<Record<string, unknown>>('/raw-shapes'),
};
