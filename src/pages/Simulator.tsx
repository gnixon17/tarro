import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LineChart } from '../components/charts/LineChart';
import { Card, Field, Money, Pnl, SliderField, Stat } from '../components/ui';
import { api } from '../lib/api';
import { compactMoney, money, number, optionLabel, signedMoney, signedPercent, volPoints } from '../lib/format';
import { runScenario } from '../lib/sim/engine';
import { makeScenario } from '../lib/sim/presets';
import { useStore } from '../state/StoreContext';
import { DEFAULT_VOL_MODEL, type Scenario, type TickerShock } from '../lib/types';

export default function Simulator() {
  const { scenarioId } = useParams();
  const navigate = useNavigate();
  const { store, run } = useStore();

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saveName, setSaveName] = useState('');

  // Load the named scenario, or start from a neutral one.
  useEffect(() => {
    if (!store) return;
    const found = scenarioId ? store.scenarios.find((s) => s.id === scenarioId) : null;
    setScenario(
      found
        ? { ...found, tickerShocks: { ...found.tickerShocks } }
        : makeScenario({ name: 'Untitled scenario', marketMovePct: -20, daysForward: 30 }),
    );
    setSaveName(found ? `${found.name} (copy)` : '');
  }, [store, scenarioId]);

  const result = useMemo(() => {
    if (!store || !scenario) return null;
    if (store.positions.length === 0) return null;
    return runScenario(store, scenario);
  }, [store, scenario]);

  if (!store || !scenario) return null;

  const patch = (changes: Partial<Scenario>) => setScenario((s) => (s ? { ...s, ...changes } : s));
  const volModel = { ...store.settings.volModel, ...(scenario.volModel ?? {}) };
  const patchVol = (changes: Partial<typeof volModel>) =>
    patch({ volModel: { ...(scenario.volModel ?? {}), ...changes } });

  const setShock = (symbol: string, shock: TickerShock | null) => {
    const next = { ...scenario.tickerShocks };
    if (shock === null || Object.keys(shock).length === 0) delete next[symbol];
    else next[symbol] = shock;
    patch({ tickerShocks: next });
  };

  async function saveAsNew() {
    const name = saveName.trim() || `${scenario!.name} (saved)`;
    const created = await run(() =>
      api.scenarios.create({ ...scenario!, id: undefined as never, name, builtIn: false }),
    );
    if (created) navigate(`/simulate/${created.id}`);
  }

  async function saveOverExisting() {
    if (!scenarioId) return;
    await run(() => api.scenarios.update(scenarioId, scenario!));
  }

  const existing = scenarioId ? store.scenarios.find((s) => s.id === scenarioId) : null;
  const total = result?.total;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[340px_1fr] items-start">
        {/* --- controls ---------------------------------------------------- */}
        <div className="flex flex-col gap-4 min-w-0">
          <Card title="Scenario" subtitle={existing ? existing.name : 'Not saved yet'}>
            <div className="flex flex-col gap-4">
              <SliderField
                label={`${store.settings.marketSymbol} move`}
                value={scenario.marketMovePct}
                onChange={(v) => patch({ marketMovePct: v })}
                min={-60}
                max={40}
                step={0.5}
                suffix="%"
                hint="Propagated to every ticker through beta unless overridden below."
              />
              <SliderField
                label="Days forward"
                value={scenario.daysForward}
                onChange={(v) => patch({ daysForward: v })}
                min={0}
                max={365}
                suffix="d"
                hint="Drives theta and the decay of extrinsic value."
              />
              <SliderField
                label="Rate shift"
                value={scenario.rateShiftBps}
                onChange={(v) => patch({ rateShiftBps: v })}
                min={-400}
                max={400}
                step={25}
                suffix=" bp"
              />

              <Field label="Accounts" hint="Empty means the whole portfolio.">
                <select
                  className="select"
                  multiple
                  size={Math.min(5, store.accounts.length + 1)}
                  value={scenario.accountIds ?? []}
                  onChange={(e) =>
                    patch({ accountIds: [...e.target.selectedOptions].map((o) => o.value) })
                  }
                >
                  {store.accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <Card
            title="Volatility response"
            subtitle="How the surface reacts to the move"
            actions={
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide' : 'Show'}
              </button>
            }
          >
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
              A {signedPercent(scenario.marketMovePct, 1)} move takes {store.settings.marketSymbol} IV from{' '}
              <strong className="mono">
                {volPoints(result?.tickers.find((t) => t.symbol === store.settings.marketSymbol)?.baseIv30 ?? 0)}
              </strong>{' '}
              to{' '}
              <strong className="mono">
                {volPoints(result?.tickers.find((t) => t.symbol === store.settings.marketSymbol)?.newIv30 ?? 0)}
              </strong>.
            </p>

            {showAdvanced && (
              <div className="flex flex-col gap-4">
                <SliderField
                  label="Vol points per 1% move"
                  value={volModel.betaVolToSpot}
                  onChange={(v) => patchVol({ betaVolToSpot: v })}
                  min={0}
                  max={3}
                  step={0.05}
                  hint="Index IV points gained per 1% index drop, before convexity."
                />
                <SliderField
                  label="Convexity"
                  value={volModel.convexity}
                  onChange={(v) => patchVol({ convexity: v })}
                  min={0}
                  max={12}
                  step={0.5}
                  hint="Extra kick on large moves."
                />
                <SliderField
                  label="Vol-level exponent"
                  value={volModel.volLevelExponent}
                  onChange={(v) => patchVol({ volLevelExponent: v })}
                  min={0}
                  max={1}
                  step={0.05}
                  hint="How hard high-vol names react relative to the index."
                />
                <SliderField
                  label="Upside damping"
                  value={volModel.upsideDamping}
                  onChange={(v) => patchVol({ upsideDamping: v })}
                  min={0}
                  max={1.5}
                  step={0.05}
                  hint="Rallies compress vol by this fraction of a selloff's lift."
                />
                <SliderField
                  label="Term decay"
                  value={volModel.termDecay}
                  onChange={(v) => patchVol({ termDecay: v })}
                  min={0}
                  max={1.2}
                  step={0.05}
                  hint="How much harder short-dated IV reacts than long-dated."
                />
                <Field label="Skew behaviour">
                  <select
                    className="select"
                    value={volModel.stickiness}
                    onChange={(e) => patchVol({ stickiness: e.target.value as typeof volModel.stickiness })}
                  >
                    <option value="STICKY_MONEYNESS">Sticky moneyness (smile follows spot)</option>
                    <option value="STICKY_STRIKE">Sticky strike (smile stays put)</option>
                  </select>
                </Field>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => patch({ volModel: undefined })}
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </Card>

          <Card title="Save">
            <div className="flex flex-col gap-2">
              <input
                className="input"
                placeholder="Scenario name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary flex-1" onClick={saveAsNew}>
                  Save as new
                </button>
                {existing && !existing.builtIn && (
                  <button type="button" className="btn flex-1" onClick={saveOverExisting}>
                    Update
                  </button>
                )}
              </div>
              {existing?.builtIn && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Built-in scenarios are read-only — “Save as new” keeps your edits.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* --- results ----------------------------------------------------- */}
        <div className="flex flex-col gap-4 min-w-0">
          {!result && (
            <Card>
              <p style={{ color: 'var(--text-secondary)' }}>Add some positions to run a simulation.</p>
            </Card>
          )}

          {result && total && (
            <>
              <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                <Card bodyClassName="p-4">
                  <Stat
                    label="Portfolio P&L"
                    value={signedMoney(total.pnl)}
                    tone={total.pnl >= 0 ? 'gain' : 'loss'}
                    hint={signedPercent(total.pnlPct)}
                  />
                </Card>
                <Card bodyClassName="p-4">
                  <Stat
                    label="Without any options"
                    value={signedMoney(total.unhedgedPnl)}
                    tone={total.unhedgedPnl >= 0 ? 'gain' : 'loss'}
                    hint={signedPercent(total.unhedgedPnlPct)}
                  />
                </Card>
                <Card bodyClassName="p-4">
                  <Stat
                    label="Hedges contributed"
                    value={signedMoney(total.hedgeContribution)}
                    tone={total.hedgeContribution >= 0 ? 'gain' : 'loss'}
                    hint="difference between the two"
                  />
                </Card>
                <Card bodyClassName="p-4">
                  <Stat
                    label="Net liquidation after"
                    value={compactMoney(total.shockedNetLiquidation)}
                    hint={`from ${compactMoney(total.baseNetLiquidation)}`}
                  />
                </Card>
              </div>

              <Card
                title="Stress curve"
                subtitle={`P&L across ${store.settings.marketSymbol} moves at the same ${scenario.daysForward}-day horizon, with IV responding at every point`}
              >
                <LineChart
                  x={result.curve.map((p) => p.movePct)}
                  series={[
                    { id: 'held', label: 'Portfolio as held', values: result.curve.map((p) => p.pnl), colorIndex: 0 },
                    { id: 'shares', label: 'Shares only', values: result.curve.map((p) => p.unhedgedPnl), colorIndex: 1, dashed: true },
                  ]}
                  height={320}
                  formatY={compactMoney}
                  formatX={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                  xLabel={`${store.settings.marketSymbol} move`}
                  markers={[
                    { x: 0, label: 'flat' },
                    { x: scenario.marketMovePct, label: 'this scenario', emphasis: true },
                  ]}
                />
                <div className="flex items-center gap-3 mt-3 text-xs flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                  <label className="flex items-center gap-1">
                    Range
                    <input
                      type="number"
                      className="input w-16"
                      value={scenario.sweep.from}
                      onChange={(e) => patch({ sweep: { ...scenario.sweep, from: Number(e.target.value) } })}
                    />
                    to
                    <input
                      type="number"
                      className="input w-16"
                      value={scenario.sweep.to}
                      onChange={(e) => patch({ sweep: { ...scenario.sweep, to: Number(e.target.value) } })}
                    />
                    %
                  </label>
                  <label className="flex items-center gap-1">
                    Steps
                    <input
                      type="number"
                      className="input w-16"
                      min={3}
                      max={201}
                      value={scenario.sweep.steps}
                      onChange={(e) => patch({ sweep: { ...scenario.sweep, steps: Number(e.target.value) } })}
                    />
                  </label>
                </div>
              </Card>

              <Card title="Per ticker" subtitle="Move, vol response and P&L, with per-ticker overrides" bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th className="num">Move</th>
                        <th className="num">Price</th>
                        <th className="num">30d IV</th>
                        <th className="num">ΔIV</th>
                        <th className="num">P&amp;L</th>
                        <th className="num">Beta override</th>
                        <th className="num">Move override</th>
                        <th className="num">IV shift</th>
                        <th>Pin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.tickers.map((t) => {
                        const line = result.bySymbol.find((s) => s.key === t.symbol);
                        const shock = scenario.tickerShocks[t.symbol] ?? {};
                        const held = store.positions.some((p) => p.symbol === t.symbol);
                        return (
                          <tr key={t.symbol} style={held ? undefined : { opacity: 0.5 }}>
                            <td className="font-semibold">{t.symbol}</td>
                            <td className="num">
                              <span className={t.returnPct >= 0 ? 'gain mono' : 'loss mono'}>
                                {signedPercent(t.returnPct)}
                              </span>
                              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                {t.source.toLowerCase().replace('_', ' ')}
                              </div>
                            </td>
                            <td className="num"><Money value={t.newPrice} decimals={2} /></td>
                            <td className="num">{volPoints(t.newIv30)}</td>
                            <td className="num">
                              <span className={t.ivPointsChange >= 0 ? 'gain mono' : 'loss mono'}>
                                {t.ivPointsChange >= 0 ? '+' : '−'}{Math.abs(t.ivPointsChange).toFixed(1)}
                              </span>
                            </td>
                            <td className="num">{line ? <Pnl value={line.pnl} /> : '—'}</td>
                            <td className="num">
                              <input
                                className="input w-20"
                                type="number"
                                step="0.1"
                                placeholder={String(t.betaUsed)}
                                value={shock.beta ?? ''}
                                onChange={(e) =>
                                  setShock(t.symbol, {
                                    ...shock,
                                    beta: e.target.value === '' ? undefined : Number(e.target.value),
                                  })
                                }
                              />
                            </td>
                            <td className="num">
                              <input
                                className="input w-20"
                                type="number"
                                step="1"
                                placeholder="%"
                                value={shock.movePct ?? ''}
                                onChange={(e) =>
                                  setShock(t.symbol, {
                                    ...shock,
                                    movePct: e.target.value === '' ? undefined : Number(e.target.value),
                                  })
                                }
                              />
                            </td>
                            <td className="num">
                              <input
                                className="input w-20"
                                type="number"
                                step="1"
                                placeholder="vol pts"
                                value={shock.ivPointsDelta ?? ''}
                                onChange={(e) =>
                                  setShock(t.symbol, {
                                    ...shock,
                                    ivPointsDelta: e.target.value === '' ? undefined : Number(e.target.value),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={shock.pinned ?? false}
                                aria-label={`Hold ${t.symbol} flat`}
                                onChange={(e) =>
                                  setShock(t.symbol, { ...shock, pinned: e.target.checked || undefined })
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Per account" bodyClassName="p-0">
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th className="num">Before</th>
                          <th className="num">After</th>
                          <th className="num">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.byAccount.map((row) => {
                          const account = store.accounts.find((a) => a.id === row.key);
                          return (
                            <tr key={row.key}>
                              <td>{account?.name ?? row.key}</td>
                              <td className="num"><Money value={row.baseMarketValue} /></td>
                              <td className="num"><Money value={row.shockedMarketValue} /></td>
                              <td className="num"><Pnl value={row.pnl} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card title="Greeks after the shock" bodyClassName="p-0">
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Measure</th>
                          <th className="num">Before</th>
                          <th className="num">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Delta $</td>
                          <td className="num"><Money value={result.base.total.deltaDollars} /></td>
                          <td className="num"><Money value={result.shocked.total.deltaDollars} /></td>
                        </tr>
                        <tr>
                          <td>Beta-weighted delta $</td>
                          <td className="num"><Money value={result.base.total.betaWeightedDeltaDollars} /></td>
                          <td className="num"><Money value={result.shocked.total.betaWeightedDeltaDollars} /></td>
                        </tr>
                        <tr>
                          <td>Gamma $ per 1%</td>
                          <td className="num"><Money value={result.base.total.gammaDollarsPer1Pct} /></td>
                          <td className="num"><Money value={result.shocked.total.gammaDollarsPer1Pct} /></td>
                        </tr>
                        <tr>
                          <td>Vega $ per vol point</td>
                          <td className="num"><Money value={result.base.total.vegaDollars} /></td>
                          <td className="num"><Money value={result.shocked.total.vegaDollars} /></td>
                        </tr>
                        <tr>
                          <td>Theta $ per day</td>
                          <td className="num"><Money value={result.base.total.thetaDollars} decimals={2} /></td>
                          <td className="num"><Money value={result.shocked.total.thetaDollars} decimals={2} /></td>
                        </tr>
                        <tr>
                          <td>Rho $ per bp</td>
                          <td className="num"><Money value={result.base.total.rhoDollars} decimals={2} /></td>
                          <td className="num"><Money value={result.shocked.total.rhoDollars} decimals={2} /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              <Card title="Per position" subtitle="Every leg, before and after" bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Position</th>
                        <th>Account</th>
                        <th className="num">Qty</th>
                        <th className="num">Mark before</th>
                        <th className="num">Mark after</th>
                        <th className="num">IV before</th>
                        <th className="num">IV after</th>
                        <th className="num">P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...result.positions]
                        .sort((a, b) => a.pnl - b.pnl)
                        .map((p) => {
                          const position = store.positions.find((x) => x.id === p.positionId);
                          const account = store.accounts.find((a) => a.id === p.accountId);
                          return (
                            <tr key={p.positionId}>
                              <td className="mono">
                                {position && position.kind === 'OPTION' ? optionLabel(position) : `${p.symbol} shares`}
                                {p.expiresInHorizon && <span className="pill ml-1">expires</span>}
                              </td>
                              <td className="text-xs">{account?.name ?? '—'}</td>
                              <td className="num">{number(p.quantity, 0)}</td>
                              <td className="num"><Money value={p.baseUnitPrice} decimals={2} /></td>
                              <td className="num"><Money value={p.shockedUnitPrice} decimals={2} /></td>
                              <td className="num">{p.baseIv !== undefined ? volPoints(p.baseIv) : '—'}</td>
                              <td className="num">{p.shockedIv !== undefined ? volPoints(p.shockedIv) : '—'}</td>
                              <td className="num"><Pnl value={p.pnl} /></td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
