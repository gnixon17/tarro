import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { buildMarketState, captureAnchors, valuePortfolio, type PortfolioValuation } from '../lib/portfolio/valuation';
import type { Instrument, PortfolioStore } from '../lib/types';

interface StoreContextValue {
  store: PortfolioStore | null;
  loading: boolean;
  error: string | null;
  backend: { name: string; description: string; durable: boolean } | null;
  /** Today's marks, greeks and rollups. Recomputed whenever the store changes. */
  valuation: PortfolioValuation | null;
  /** t0 IV anchors, so a user's own marks survive every re-valuation. */
  anchors: Record<string, number>;
  refresh: () => Promise<void>;
  /** Run a mutation, then reconcile with the server. Surfaces errors in the shell. */
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
  clearError: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<PortfolioStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<StoreContextValue['backend']>(null);

  const refresh = useCallback(async () => {
    try {
      const [next, info] = await Promise.all([api.getStore(), api.backend()]);
      setStore(next);
      setBackend(info);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        const result = await fn();
        await refresh();
        setError(null);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [refresh],
  );

  const { valuation, anchors } = useMemo(() => {
    if (!store) return { valuation: null, anchors: {} as Record<string, number> };
    const asOf = new Date();
    const instrumentMap: Record<string, Instrument> = Object.fromEntries(
      store.instruments.map((i) => [i.symbol, i]),
    );
    const capturedAnchors = captureAnchors(store.positions, instrumentMap, store.settings, asOf);
    const state = buildMarketState(store, { asOf });
    return {
      anchors: capturedAnchors,
      valuation: valuePortfolio(store.positions, store.accounts, state, {
        anchors: capturedAnchors,
        betaWeightSymbol: store.settings.betaWeightSymbol,
      }),
    };
  }, [store]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({ store, loading, error, backend, valuation, anchors, refresh, run, clearError }),
    [store, loading, error, backend, valuation, anchors, refresh, run, clearError],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside a StoreProvider');
  return ctx;
}
