import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LineChart } from '../components/charts/LineChart';
import { Card, EmptyState, Pill, Pnl } from '../components/ui';
import { api } from '../lib/api';
import { compactMoney, signedPercent } from '../lib/format';
import { runScenario } from '../lib/sim/engine';
import { makeScenario } from '../lib/sim/presets';
import { useStore } from '../state/StoreContext';
import type { Scenario } from '../lib/types';

export default function Scenarios() {
  const { store, run } = useStore();
  const navigate = useNavigate();
  const [compare, setCompare] = useState<string[]>([]);

  /**
   * Every saved scenario, run against the portfolio as it stands. This is the
   * whole point of saving them: the library is a standing stress report, not a
   * list of settings.
   */
  const rows = useMemo(() => {
    if (!store || store.positions.length === 0) return [];
    return store.scenarios.map((scenario) => ({
      scenario,
      result: runScenario(store, scenario),
    }));
  }, [store]);

  if (!store) return null;

  async function duplicate(scenario: Scenario) {
    const created = await run(() =>
      api.scenarios.create({ ...scenario, id: undefined as never, name: `${scenario.name} (copy)`, builtIn: false }),
    );
    if (created) navigate(`/simulate/${created.id}`);
  }

  async function remove(scenario: Scenario) {
    if (!confirm(`Delete “${scenario.name}”?`)) return;
    await run(() => api.scenarios.remove(scenario.id));
  }

  async function createBlank() {
    const created = await run(() =>
      api.scenarios.create(makeScenario({ name: 'New scenario', marketMovePct: -15, daysForward: 30 })),
    );
    if (created) navigate(`/simulate/${created.id}`);
  }

  const compared = rows.filter((r) => compare.includes(r.scenario.id));
  const sweepX = compared[0]?.result.curve.map((p) => p.movePct) ?? [];
  const comparable = compared.filter((r) => r.result.curve.length === sweepX.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Scenario library</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Saved scenarios re-run against your live portfolio every time you open this page.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={() => run(() => api.restoreBuiltinScenarios())}>
            Restore built-ins
          </button>
          <button type="button" className="btn btn-primary" onClick={createBlank}>New scenario</button>
        </div>
      </div>

      {store.positions.length === 0 && (
        <Card>
          <EmptyState
            title="No positions to stress"
            body="Add holdings first, then every scenario here will report what it does to them."
            action={<Link to="/positions" className="btn btn-primary">Add positions</Link>}
          />
        </Card>
      )}

      {comparable.length >= 2 && (
        <Card title="Comparison" subtitle="Stress curves for the selected scenarios">
          <LineChart
            x={sweepX}
            series={comparable.slice(0, 4).map((r, i) => ({
              id: r.scenario.id,
              label: r.scenario.name,
              values: r.result.curve.map((p) => p.pnl),
              colorIndex: i,
            }))}
            height={300}
            formatY={compactMoney}
            formatX={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
            xLabel={`${store.settings.marketSymbol} move`}
          />
          {compared.length > 4 && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Showing the first four selected. Beyond four series a stress chart stops being readable.
            </p>
          )}
        </Card>
      )}

      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}><span className="sr-only">Compare</span></th>
                <th>Scenario</th>
                <th className="num">{store.settings.marketSymbol}</th>
                <th className="num">Horizon</th>
                <th className="num">Rate</th>
                <th className="num">P&amp;L</th>
                <th className="num">% NLV</th>
                <th className="num">Unhedged</th>
                <th className="num">Hedge effect</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {store.scenarios.map((scenario) => {
                const row = rows.find((r) => r.scenario.id === scenario.id);
                return (
                  <tr key={scenario.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Compare ${scenario.name}`}
                        checked={compare.includes(scenario.id)}
                        onChange={(e) =>
                          setCompare((current) =>
                            e.target.checked ? [...current, scenario.id] : current.filter((id) => id !== scenario.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="font-medium flex items-center gap-2">
                        <Link to={`/simulate/${scenario.id}`} style={{ color: 'var(--accent)' }}>{scenario.name}</Link>
                        {scenario.builtIn && <Pill>built-in</Pill>}
                      </div>
                      {scenario.description && (
                        <div className="text-xs max-w-xl" style={{ color: 'var(--text-muted)' }}>{scenario.description}</div>
                      )}
                    </td>
                    <td className="num mono">{signedPercent(scenario.marketMovePct, 0)}</td>
                    <td className="num mono">{scenario.daysForward}d</td>
                    <td className="num mono">{scenario.rateShiftBps === 0 ? '—' : `${scenario.rateShiftBps > 0 ? '+' : ''}${scenario.rateShiftBps}bp`}</td>
                    <td className="num">{row ? <Pnl value={row.result.total.pnl} /> : '—'}</td>
                    <td className="num">
                      {row ? (
                        <span className={row.result.total.pnlPct >= 0 ? 'gain mono' : 'loss mono'}>
                          {signedPercent(row.result.total.pnlPct)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="num">{row ? <Pnl value={row.result.total.unhedgedPnl} /> : '—'}</td>
                    <td className="num">{row ? <Pnl value={row.result.total.hedgeContribution} /> : '—'}</td>
                    <td className="num whitespace-nowrap">
                      <Link to={`/simulate/${scenario.id}`} className="btn btn-sm btn-ghost">Open</Link>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => duplicate(scenario)}>Duplicate</button>
                      {!scenario.builtIn && (
                        <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(scenario)}>Delete</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
