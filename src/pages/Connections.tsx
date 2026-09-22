import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, Field, Money, Pill, Stat } from '../components/ui';
import { formatDate, money, number, signedPercent, volPoints } from '../lib/format';
import { schwab, type BrokerAccount, type MarketDataResult, type SchwabStatus } from '../lib/schwabApi';
import type { SyncPlan } from '../lib/brokers/reconcile';
import { useStore } from '../state/StoreContext';

const CHANGE_LABEL: Record<string, string> = {
  create: 'Add',
  update: 'Update',
  adopt: 'Link',
  close: 'Remove',
};

export default function Connections() {
  const { store, backend, refresh } = useStore();
  const [status, setStatus] = useState<SchwabStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');

  const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccount[] | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [marketData, setMarketData] = useState<MarketDataResult | null>(null);
  const [acceptedSymbols, setAcceptedSymbols] = useState<Set<string>>(new Set());
  const [shapes, setShapes] = useState<Record<string, unknown> | null>(null);

  const serverBacked = backend?.name === 'server';

  const loadStatus = useCallback(async () => {
    if (!serverBacked) return;
    try {
      setStatus(await schwab.status());
    } catch (err) {
      setError((err as Error).message);
    }
  }, [serverBacked]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!store) return null;

  if (!serverBacked) {
    return (
      <Card title="Broker connections">
        <EmptyState
          title="Schwab sync needs the local server"
          body="Connecting to a broker means holding an OAuth client secret and refresh token, which cannot live in a browser. Run the app with npm run dev and open it on localhost; the published version stays manual-entry."
          action={<Link to="/instruments" className="btn">Enter market data by hand</Link>}
        />
      </Card>
    );
  }

  const reconnectDays = status?.reconnectBy
    ? Math.floor((Date.parse(status.reconnectBy) - Date.now()) / 86400000)
    : null;

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Pull positions, prices and implied vols from Schwab instead of typing them.
        </p>
      </div>

      {error && (
        <div className="card p-3 text-sm" style={{ color: 'var(--loss-text)' }} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="card p-3 text-sm" style={{ color: 'var(--gain-text)' }}>
          {notice}
        </div>
      )}

      {/* --- connection ---------------------------------------------------- */}
      <Card
        title="Charles Schwab"
        subtitle={
          status?.connected
            ? `Connected${status.connectedAt ? ` ${formatDate(status.connectedAt)}` : ''}`
            : status?.configured
              ? 'Not connected'
              : 'Not configured'
        }
        actions={
          status?.connected ? (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={busy !== null}
              onClick={() =>
                run('disconnect', async () => {
                  await schwab.disconnect();
                  setPlan(null);
                  setMarketData(null);
                  setBrokerAccounts(null);
                  await loadStatus();
                  setNotice('Disconnected. The stored tokens were deleted.');
                })
              }
            >
              Disconnect
            </button>
          ) : null
        }
      >
        {!status?.configured && (
          <div className="text-sm flex flex-col gap-2" style={{ color: 'var(--text-secondary)' }}>
            <p>Register an app at developer.schwab.com, request both the <strong>Accounts and Trading</strong> and <strong>Market Data</strong> products, then set these on the server and restart it:</p>
            <pre className="text-xs p-3 rounded overflow-x-auto" style={{ background: 'var(--surface-sunken)' }}>
{`SCHWAB_APP_KEY="your app key"
SCHWAB_APP_SECRET="your app secret"
SCHWAB_REDIRECT_URI="https://127.0.0.1:3000/api/schwab/callback"`}
            </pre>
            <p>The callback must match what you registered with Schwab exactly, and Schwab requires it to be HTTPS.</p>
          </div>
        )}

        {status?.configured && !status.connected && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              className="btn btn-primary self-start"
              disabled={busy !== null}
              onClick={() =>
                run('auth', async () => {
                  const { url } = await schwab.authorizeUrl();
                  setAuthUrl(url);
                  window.open(url, '_blank', 'noopener');
                })
              }
            >
              Connect to Schwab
            </button>

            {authUrl && (
              <div className="flex flex-col gap-2">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Log in and approve in the tab that opened. Schwab will send you to{' '}
                  <code className="mono">{status.redirectUri}</code>, which will not load — that is expected on a local
                  server. Copy the <strong>whole address</strong> from that tab and paste it here: it carries a one-time
                  value that proves the login started here, and a code on its own will be refused.
                </p>
                <p className="text-xs">
                  Tab did not open?{' '}
                  <a href={authUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                    Open the Schwab login
                  </a>
                </p>
                <Field label="Redirected address">
                  <input
                    className="input mono"
                    placeholder="https://127.0.0.1:3000/api/schwab/callback?code=…&state=…"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                  />
                </Field>
                <button
                  type="button"
                  className="btn btn-primary self-start"
                  disabled={busy !== null || !pasted.trim()}
                  onClick={() =>
                    run('connect', async () => {
                      await schwab.connect(pasted);
                      setPasted('');
                      setAuthUrl(null);
                      await loadStatus();
                      setNotice('Connected to Schwab.');
                    })
                  }
                >
                  Finish connecting
                </button>
              </div>
            )}
          </div>
        )}

        {status?.connected && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Reconnect by"
              value={status.reconnectBy ? formatDate(status.reconnectBy) : '—'}
              tone={reconnectDays !== null && reconnectDays <= 1 ? 'loss' : 'neutral'}
              hint={
                reconnectDays !== null
                  ? `${reconnectDays} day${reconnectDays === 1 ? '' : 's'} left — Schwab refresh tokens last 7 days and cannot be extended`
                  : undefined
              }
              size="sm"
            />
            <Stat label="Linked accounts" value={status.linkedAccounts.length} size="sm" />
            <Stat
              label="Token encryption key"
              value={status.keyOrigin === 'env' ? 'Environment' : 'Key file'}
              hint={
                status.keyOrigin === 'env'
                  ? 'From TARRO_SECRET_KEY'
                  : 'Generated and stored beside the tokens. Set TARRO_SECRET_KEY to keep the key off disk.'
              }
              size="sm"
            />
          </div>
        )}
      </Card>

      {/* --- account mapping ------------------------------------------------ */}
      {status?.connected && (
        <Card
          title="Account mapping"
          subtitle="Schwab does not report whether an account is an IRA, so the registration type stays yours to set"
          actions={
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() =>
                run('accounts', async () => {
                  const result = await schwab.brokerAccounts();
                  setBrokerAccounts(result.accounts);
                  if (result.warnings.length) setNotice(result.warnings.join(' '));
                })
              }
            >
              {busy === 'accounts' ? 'Loading…' : 'Load Schwab accounts'}
            </button>
          }
          bodyClassName="p-0"
        >
          {!brokerAccounts ? (
            <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              Load your Schwab accounts, then link each one to a Tarro account.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Schwab account</th>
                    <th>Type</th>
                    <th className="num">Positions</th>
                    <th className="num">Cash</th>
                    <th className="num">Liq. value</th>
                    <th>Linked to</th>
                  </tr>
                </thead>
                <tbody>
                  {brokerAccounts.map((broker) => {
                    const linked = store.accounts.find((a) => a.externalId === broker.externalId);
                    return (
                      <tr key={broker.externalId}>
                        <td className="mono">{broker.externalLabel}</td>
                        <td><Pill>{broker.marginType.toLowerCase()}</Pill></td>
                        <td className="num">{broker.positions}</td>
                        <td className="num"><Money value={broker.cash} /></td>
                        <td className="num">{broker.liquidationValue !== null ? <Money value={broker.liquidationValue} /> : '—'}</td>
                        <td>
                          <select
                            className="select"
                            value={linked?.id ?? ''}
                            aria-label={`Link ${broker.externalLabel}`}
                            onChange={(e) =>
                              run('link', async () => {
                                if (linked && linked.id !== e.target.value) await schwab.unlink(linked.id);
                                if (e.target.value) {
                                  await schwab.link(e.target.value, broker.externalId, broker.externalLabel);
                                }
                                await refresh();
                                await loadStatus();
                              })
                            }
                          >
                            <option value="">— not linked —</option>
                            {store.accounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* --- position sync -------------------------------------------------- */}
      {status?.connected && (
        <Card
          title="Positions"
          subtitle="Every change is reviewed before anything is written"
          actions={
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() =>
                run('preview', async () => {
                  const next = await schwab.preview();
                  setPlan(next);
                  // Everything except removals is pre-accepted: a removal is
                  // the only change here that can lose data.
                  setAccepted(new Set(next.changes.filter((c) => c.kind !== 'close').map((c) => c.key)));
                })
              }
            >
              {busy === 'preview' ? 'Checking…' : 'Check for changes'}
            </button>
          }
          bodyClassName="p-0"
        >
          {!plan ? (
            <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              Compare your linked accounts against Schwab.
            </div>
          ) : (
            <>
              {plan.warnings.length > 0 && (
                <ul className="px-4 pt-3 text-xs flex flex-col gap-1" style={{ color: 'var(--warning)' }}>
                  {plan.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                </ul>
              )}

              {plan.unlinkedAccounts.length > 0 && (
                <p className="px-4 pt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {plan.unlinkedAccounts.length} Schwab account(s) are not linked yet and were skipped.
                </p>
              )}

              {plan.changes.length === 0 ? (
                <div className="p-4 text-sm">
                  Everything matches — {plan.unchanged} position{plan.unchanged === 1 ? '' : 's'} already in step.
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 32 }}><span className="sr-only">Accept</span></th>
                          <th>Change</th>
                          <th>Position</th>
                          <th className="num">Before</th>
                          <th className="num">After</th>
                          <th>Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.changes.map((change) => (
                          <tr key={change.key}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Accept ${change.label}`}
                                checked={accepted.has(change.key)}
                                onChange={(e) =>
                                  setAccepted((current) => {
                                    const next = new Set(current);
                                    if (e.target.checked) next.add(change.key);
                                    else next.delete(change.key);
                                    return next;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <Pill tone={change.kind === 'close' ? 'critical' : change.kind === 'create' ? 'good' : undefined}>
                                {CHANGE_LABEL[change.kind]}
                              </Pill>
                            </td>
                            <td className="mono whitespace-nowrap">{change.label}</td>
                            <td className="num">{change.before ? number(change.before.quantity, 0) : '—'}</td>
                            <td className="num">{change.after ? number(change.after.quantity, 0) : '—'}</td>
                            <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{change.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-t" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {accepted.size} of {plan.changes.length} selected
                      {plan.newInstruments.length > 0 && ` · ${plan.newInstruments.length} new ticker(s): ${plan.newInstruments.join(', ')}`}
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== null || accepted.size === 0}
                      onClick={() =>
                        run('apply', async () => {
                          const result = await schwab.apply([...accepted]);
                          setPlan(null);
                          await refresh();
                          await loadStatus();
                          setNotice(
                            `Added ${result.created}, updated ${result.updated}, linked ${result.adopted}, removed ${result.closed}.`,
                          );
                        })
                      }
                    >
                      {busy === 'apply' ? 'Applying…' : `Apply ${accepted.size} change${accepted.size === 1 ? '' : 's'}`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </Card>
      )}

      {/* --- market data ---------------------------------------------------- */}
      {status?.connected && (
        <Card
          title="Prices and volatility"
          subtitle="Quotes, the implied vol on every contract you hold, and a surface fitted to the live chain"
          actions={
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() =>
                run('market', async () => {
                  const next = await schwab.marketDataPreview();
                  setMarketData(next);
                  setAcceptedSymbols(new Set(next.instruments.map((i) => i.symbol)));
                })
              }
            >
              {busy === 'market' ? 'Fetching…' : 'Refresh market data'}
            </button>
          }
          bodyClassName="p-0"
        >
          {!marketData ? (
            <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              Pull live quotes and recalibrate each ticker's vol surface from its option chain.
            </div>
          ) : (
            <>
              {marketData.warnings.length > 0 && (
                <ul className="px-4 pt-3 text-xs flex flex-col gap-1" style={{ color: 'var(--warning)' }}>
                  {marketData.warnings.slice(0, 8).map((w, i) => <li key={i}>⚠ {w}</li>)}
                </ul>
              )}
              {marketData.instruments.length === 0 ? (
                <div className="p-4 text-sm">Nothing changed.</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 32 }}><span className="sr-only">Accept</span></th>
                          <th>Ticker</th>
                          <th className="num">Price</th>
                          <th className="num">30d IV</th>
                          <th className="num">Skew</th>
                          <th className="num">Term</th>
                          <th className="num">Fit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {marketData.instruments.map((update) => (
                          <tr key={update.symbol}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Accept ${update.symbol}`}
                                checked={acceptedSymbols.has(update.symbol)}
                                onChange={(e) =>
                                  setAcceptedSymbols((current) => {
                                    const next = new Set(current);
                                    if (e.target.checked) next.add(update.symbol);
                                    else next.delete(update.symbol);
                                    return next;
                                  })
                                }
                              />
                            </td>
                            <td className="font-semibold">{update.symbol}</td>
                            <td className="num">
                              {update.price ? (
                                <>
                                  <span style={{ color: 'var(--text-muted)' }}>{money(update.price.before, 2)}</span>
                                  {' → '}
                                  <strong>{money(update.price.after, 2)}</strong>
                                </>
                              ) : '—'}
                            </td>
                            <td className="num">
                              {update.surface ? (
                                <>
                                  <span style={{ color: 'var(--text-muted)' }}>{volPoints(update.surface.before.ivAtm30)}</span>
                                  {' → '}
                                  <strong>{volPoints(update.surface.after.ivAtm30)}</strong>
                                </>
                              ) : '—'}
                            </td>
                            <td className="num">{update.surface ? number(update.surface.after.skewSlope, 3) : '—'}</td>
                            <td className="num">{update.surface ? number(update.surface.after.termSlope, 3) : '—'}</td>
                            <td className="num text-xs">
                              {update.surface
                                ? `±${update.surface.rmseVolPoints.toFixed(2)} vol · ${update.surface.samples} strikes · ${update.surface.expiries} exp`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-t" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {marketData.contracts.length} held contract{marketData.contracts.length === 1 ? '' : 's'} will be marked
                      to their live implied vol. “Fit” is the residual between the fitted surface and the chain — under
                      about 1 vol point is a good fit.
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== null || acceptedSymbols.size === 0}
                      onClick={() =>
                        run('market-apply', async () => {
                          const result = await schwab.marketDataApply([...acceptedSymbols]);
                          setMarketData(null);
                          await refresh();
                          setNotice(
                            `Updated ${result.pricesUpdated} price(s), fitted ${result.surfacesFitted} surface(s), marked ${result.contractsMarked} contract(s).`,
                          );
                        })
                      }
                    >
                      {busy === 'market-apply' ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </Card>
      )}

      {/* --- payload inspector ---------------------------------------------- */}
      {status?.connected && (
        <Card
          title="What Schwab sent back"
          subtitle="Field names from the last call, values stripped"
          actions={
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => run('shapes', async () => setShapes(await schwab.rawShapes()))}
            >
              Inspect
            </button>
          }
        >
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Schwab publishes its schemas but does not guarantee them. If a field were renamed, a number would go quietly
            missing rather than raising an error — so this shows the keys that actually arrived. If something here does not
            match what the mapper expects, that is the bug.
          </p>
          {shapes && (
            <pre className="text-xs p-3 rounded overflow-auto max-h-96" style={{ background: 'var(--surface-sunken)' }}>
              {JSON.stringify(shapes, null, 2)}
            </pre>
          )}
        </Card>
      )}
    </div>
  );
}
