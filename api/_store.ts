/**
 * Persistence.
 *
 * Two drivers behind one interface:
 *   - `file`     (default) a JSON document under ./data. Zero config, which is
 *                what you want for a single-user tool on your own machine.
 *   - `supabase` a single `app_state` row holding the same JSON document. Use
 *                this when deploying somewhere with an ephemeral filesystem.
 *
 * The whole portfolio is one document on purpose: it is small (kilobytes), it
 * is read in full by every page, and keeping it atomic means a write can never
 * leave positions pointing at an account that no longer exists.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { demoStore, emptyStore } from '../src/lib/seed';
import { normalizeStore as normalize } from '../src/lib/storeOps';
import type { PortfolioStore } from '../src/lib/types';

const DATA_DIR = process.env.TARRO_DATA_DIR ?? path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'portfolio.json');
const STATE_KEY = 'portfolio';

export type DriverName = 'file' | 'supabase';

export function driverName(): DriverName {
  return process.env.SUPABASE_URL && process.env.SUPABASE_KEY ? 'supabase' : 'file';
}

// --- file driver -----------------------------------------------------------

async function readFileStore(): Promise<PortfolioStore> {
  try {
    const text = await fs.readFile(DATA_FILE, 'utf8');
    return normalize(JSON.parse(text));
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      const seeded = demoStore();
      await writeFileStore(seeded);
      return seeded;
    }
    throw err;
  }
}

async function writeFileStore(store: PortfolioStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Write-then-rename so a crash mid-write cannot truncate the portfolio.
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmp, DATA_FILE);
}

// --- supabase driver -------------------------------------------------------

let supabaseClient: any = null;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const { createClient } = await import('@supabase/supabase-js');
  supabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  return supabaseClient;
}

async function readSupabaseStore(): Promise<PortfolioStore> {
  const client = await getSupabase();
  const { data, error } = await client.from('app_state').select('data').eq('id', STATE_KEY).maybeSingle();
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  if (!data) {
    const seeded = demoStore();
    await writeSupabaseStore(seeded);
    return seeded;
  }
  return normalize(data.data);
}

async function writeSupabaseStore(store: PortfolioStore): Promise<void> {
  const client = await getSupabase();
  const { error } = await client
    .from('app_state')
    .upsert({ id: STATE_KEY, data: store, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
}

// --- public API ------------------------------------------------------------

export async function readStore(): Promise<PortfolioStore> {
  return driverName() === 'supabase' ? readSupabaseStore() : readFileStore();
}

export async function writeStore(store: PortfolioStore): Promise<void> {
  if (driverName() === 'supabase') return writeSupabaseStore(store);
  return writeFileStore(store);
}

/**
 * Read, mutate, write.
 *
 * Serialised through a promise chain so two concurrent requests cannot both
 * read the same document and then clobber each other's write.
 */
let queue: Promise<unknown> = Promise.resolve();

export function mutateStore<T>(fn: (store: PortfolioStore) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const store = await readStore();
    const result = await fn(store);
    await writeStore(store);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function resetStore(mode: 'demo' | 'empty'): Promise<PortfolioStore> {
  const next = mode === 'demo' ? demoStore() : emptyStore();
  await writeStore(next);
  return next;
}
