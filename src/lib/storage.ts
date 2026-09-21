/**
 * Where the portfolio lives, decided at runtime.
 *
 * The same bundle runs in three places, so the backend is chosen by probing
 * rather than by a build flag:
 *
 *   - `artifact` — a published Artifact page, persisting to the artifact's own
 *     document store. Survives reloads and follows the account, not the device.
 *   - `server`   — the Express API from `npm run dev`. The JSON file or
 *     Postgres, depending on how the server is configured.
 *   - `browser`  — localStorage. The fallback for a static build with no API
 *     behind it. Per-device, and gone if site data is cleared.
 *
 * All three expose the same load/save pair; every mutation is applied by the
 * shared functions in `storeOps.ts`, so the rules are identical whichever one
 * is in use.
 */
import { demoStore } from './seed';
import { normalizeStore } from './storeOps';
import type { PortfolioStore } from './types';

export type BackendName = 'artifact' | 'server' | 'browser';

export interface Backend {
  name: BackendName;
  /** Human-readable description of where data is going, shown in Settings. */
  description: string;
  /** True when writes are expected to outlive this browser. */
  durable: boolean;
  load(): Promise<PortfolioStore>;
  save(store: PortfolioStore): Promise<void>;
}

const LOCAL_KEY = 'tarro.portfolio.v1';
const DB_PATH = 'portfolio/state';

// --- artifact document store ----------------------------------------------

interface ClaudeRuntime {
  use(name: string): Promise<any>;
}

function claudeRuntime(): ClaudeRuntime | null {
  const w = globalThis as unknown as { claude?: ClaudeRuntime };
  return typeof w.claude?.use === 'function' ? w.claude : null;
}

async function artifactBackend(): Promise<Backend | null> {
  const runtime = claudeRuntime();
  if (!runtime) return null;

  let db: any;
  try {
    // `use` resolves null after ~10s when no viewer answers. Race it so a
    // non-responding host delays the first paint by a couple of seconds at
    // most instead of holding the page on its loading state.
    db = await Promise.race([
      runtime.use('db'),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
  } catch {
    return null;
  }
  // `use` resolves null when this view cannot run the capability - not served,
  // not granted, or failed to load. Indistinguishable by design, so just fall
  // through to the next backend.
  if (!db) return null;

  return {
    name: 'artifact',
    description: 'Saved to this artifact, so it follows your account rather than this browser.',
    durable: true,
    async load() {
      const snapshot = await db.doc(DB_PATH).get();
      if (!snapshot.exists) {
        const seeded = demoStore();
        await db.doc(DB_PATH).set(seeded as unknown as Record<string, unknown>);
        return seeded;
      }
      return normalizeStore(snapshot.data() as Partial<PortfolioStore>);
    },
    async save(store) {
      await db.doc(DB_PATH).set(store as unknown as Record<string, unknown>);
    },
  };
}

// --- Express API ----------------------------------------------------------

async function serverBackend(): Promise<Backend | null> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const health = (await res.json()) as { ok?: boolean; driver?: string };
    if (!health.ok) return null;

    return {
      name: 'server',
      description:
        health.driver === 'supabase'
          ? 'Saved to the app_state table in Postgres.'
          : 'Saved to ./data/portfolio.json on the server.',
      durable: true,
      async load() {
        const r = await fetch('/api/store');
        if (!r.ok) throw new Error(`Could not load the portfolio (${r.status}).`);
        return normalizeStore(await r.json());
      },
      async save(store) {
        const r = await fetch('/api/store', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(store),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `Could not save (${r.status}).`);
        }
      },
    };
  } catch {
    return null;
  }
}

// --- localStorage ---------------------------------------------------------

function browserBackend(): Backend {
  return {
    name: 'browser',
    description: 'Saved in this browser only. Clearing site data erases it — export a backup from Settings.',
    durable: false,
    async load() {
      try {
        const text = localStorage.getItem(LOCAL_KEY);
        if (!text) {
          const seeded = demoStore();
          localStorage.setItem(LOCAL_KEY, JSON.stringify(seeded));
          return seeded;
        }
        return normalizeStore(JSON.parse(text));
      } catch {
        // Private mode, blocked site data, or corrupt JSON. Still usable for
        // the session; the save will report if it cannot persist.
        return demoStore();
      }
    },
    async save(store) {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
      } catch {
        throw new Error('This browser is not allowing local storage, so changes will be lost on reload.');
      }
    },
  };
}

let resolved: Promise<Backend> | null = null;

/** Pick a backend once per page load, best first. */
export function getBackend(): Promise<Backend> {
  if (!resolved) {
    resolved = (async () =>
      (await artifactBackend()) ?? (await serverBackend()) ?? browserBackend())();
  }
  return resolved;
}
