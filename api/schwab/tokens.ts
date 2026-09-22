/**
 * Token storage.
 *
 * Schwab tokens are bearer credentials for a brokerage account, so they get
 * treated accordingly: encrypted at rest with AES-256-GCM, written to a
 * 0600 file outside the portfolio document, and never returned by any HTTP
 * endpoint. The rest of the app can ask whether a connection exists; it cannot
 * ask what the token is.
 */
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const DATA_DIR = process.env.TARRO_DATA_DIR ?? path.resolve(process.cwd(), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'schwab-tokens.enc');
const KEY_FILE = path.join(DATA_DIR, '.tarro-key');

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token stops working. */
  accessExpiresAt: number;
  /**
   * Epoch ms when the refresh token stops working. Schwab's refresh tokens
   * last seven days with no way to extend them, so this drives the
   * "reconnect by" warning in the UI.
   */
  refreshExpiresAt: number;
  createdAt: number;
  scope?: string;
}

let cachedKey: Buffer | null = null;

/**
 * The encryption key.
 *
 * From `TARRO_SECRET_KEY` when set — the right answer, because then the key is
 * not on disk beside the ciphertext. Otherwise a random key is generated once
 * and stored 0600 next to the token file, which protects against a stray file
 * read or a backup but not against someone who already has the data directory.
 * The distinction is reported through `keyOrigin` so the UI can say which one
 * is in force rather than implying more safety than exists.
 */
async function getKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.TARRO_SECRET_KEY;
  if (fromEnv && fromEnv.length >= 16) {
    cachedKey = crypto.scryptSync(fromEnv, 'tarro-schwab-tokens', 32);
    return cachedKey;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    cachedKey = Buffer.from(await fs.readFile(KEY_FILE, 'utf8'), 'hex');
    if (cachedKey.length === 32) return cachedKey;
  } catch {
    /* no key yet */
  }

  cachedKey = crypto.randomBytes(32);
  await fs.writeFile(KEY_FILE, cachedKey.toString('hex'), { mode: 0o600 });
  return cachedKey;
}

export function keyOrigin(): 'env' | 'file' {
  return process.env.TARRO_SECRET_KEY && process.env.TARRO_SECRET_KEY.length >= 16 ? 'env' : 'file';
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');

  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, payload, { mode: 0o600 });
  await fs.rename(tmp, TOKEN_FILE);
}

export async function loadTokens(): Promise<StoredTokens | null> {
  let payload: string;
  try {
    payload = await fs.readFile(TOKEN_FILE, 'utf8');
  } catch {
    return null;
  }

  try {
    const key = await getKey();
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(text) as StoredTokens;
  } catch {
    // Wrong key or tampered file. Treat as disconnected rather than crashing:
    // the user can reconnect, which overwrites it.
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await fs.rm(TOKEN_FILE, { force: true });
}
