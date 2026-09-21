import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DivergingBars } from '../components/charts/BarChart';
import { LineChart } from '../components/charts/LineChart';
import { Card, EmptyState, Money, Pnl, Stat } from '../components/ui';
import { compactMoney, money, number, percent, signedMoney, signedPercent } from '../lib/format';
import { accountKindLabel, taxTreatmentOf } from '../lib/types';
import { betaWeightedShares } from '../lib/portfolio/valuation';
import { runScenario } from '../lib/sim/engine';
import { makeScenario } from '../lib/sim/presets';
import { useStore } from '../state/StoreContext';

/** Quick stress readings shown on the dashboard without leaving the page. */
const QUICK_MOVES = [-20, -10, -5, 5, 10];

export default function Dashboard() {
  const { store, valuation } = useStore();
  const navigate = useNavigate();

  const quickStress = useMemo(() => {
    if (!store || store.positions.length === 0) return [];
    return QUICK_MOVES.map((movePct) => {
      const result = runScenario(
        store,
        makeScenario({ name: `${movePct}%`, marketMovePct: movePct, daysForward: 5, sweep: { from: 0, to: 0, steps: 2 } }),
      );
      return { movePct, pnl: result.total.pnl, pnlPct: result.total.pnlPct, hedge: result.total.hedgeContribution };
    });
  }, [store]);

  const curve = useMemo(() => {
    if (!store || store.positions.length === 0) return null;
    return runScenario(
      store,
      makeScenario({ name: 'overview', marketMovePct: 0, daysForward: 30, sweep: { from: -35, to: 20, steps: 56 } }),
    );
  }, [store]);

  if (!store || !valuation) return null;

  if (store.positions.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No positions yet"
          body="Add accounts and market data, then start entering holdings and option legs. Or load the demo portfolio from Settings to see what the simulator does."
          action={
            <div className="flex gap-2 justify-center">
              <Link to="/accounts" className="btn btn-primary">Add an account</Link>
              <Link to="/settings" className="btn">Load demo data</Link>
            </div>
          }
        />
      </Card>
    );
  }

  const total = valuation.total;
  const marketPrice = store.instruments.find((i) => i.symbol === store.settings.betaWeightSymbol)?.price ?? 0;
  const spyShares = betaWeightedShares(total, marketPrice);

  const symbolRows = Object.values(valuation.bySymbol).sort(
    (a, b) => Math.abs(b.deltaDollars) - Math.abs(a.deltaDollars),
  );
  const exposureData = symbolRows.map((r) => ({ label: r.symbol, value: r.deltaDollars }));

  const grossEquityNotional = symbolRows.reduce((sum, r) => sum + Math.abs(r.deltaDollars), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <Card bodyClassName="p-4">
          <Stat
            label="Net liquidation"
            value={compactMoney(total.netLiquidation)}
            hint={`${money(total.cash)} cash`}
          />
        </Card>
        <Card bodyClassName="p-4">
          <Stat
            label="Unrealised P&L"
            value={signedMoney(total.unrealizedPnl)}
            tone={total.unrealizedPnl >= 0 ? 'gain' : 'loss'}
            hint={total.costValue !== 0 ? signedPercent((total.unrealizedPnl / Math.abs(total.costValue)) * 100) : undefined}
          />
        </Card>
        <Card bodyClassName="p-4">
          <Stat
            label="Net delta"
            value={compactMoney(total.deltaDollars)}
            hint={`${number(total.deltaShares, 0)} share-equivalents`}
          />
        </Card>
        <Card bodyClassName="p-4">
          <Stat
            label={`Beta-weighted (${store.settings.betaWeightSymbol})`}
            value={compactMoney(total.betaWeightedDeltaDollars)}
            hint={marketPrice > 0 ? `≈ ${number(spyShares, 0)} ${store.settings.betaWeightSymbol} shares` : 'set a price'}
          />
        </Card>
        <Card bodyClassName="p-4">
          <Stat
            label="Vega"
            value={signedMoney(total.vegaDollars)}
            tone={total.vegaDollars >= 0 ? 'gain' : 'loss'}
            hint="per 1 vol point"
          />
        </Card>
        <Card bodyClassName="p-4">
          <Stat
            label="Theta"
            value={signedMoney(total.thetaDollars, 2)}
            tone={total.thetaDollars >= 0 ? 'gain' : 'loss'}
            hint="per calendar day"
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 items-start">
        <Card
          className="lg:col-span-2"
          title="Portfolio under a market shock"
          subtitle={`P&L 30 days out across a range of ${store.settings.marketSymbol} moves, with IV responding to each move`}
          actions={<Link to="/simulate" className="btn btn-sm">Open simulator</Link>}
        >
          {curve && (
            <LineChart
              x={curve.curve.map((p) => p.movePct)}
              series={[
                { id: 'hedged', label: 'Portfolio as held', values: curve.curve.map((p) => p.pnl), colorIndex: 0 },
                { id: 'unhedged', label: 'Shares only (no options)', values: curve.curve.map((p) => p.unhedgedPnl), colorIndex: 1, dashed: true },
              ]}
              height={300}
              formatY={compactMoney}
              formatX={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
              xLabel={`${store.settings.marketSymbol} move`}
              markers={[{ x: 0, label: 'today', emphasis: true }]}
            />
          )}
        </Card>

        <Card title="Quick stress" subtitle="5 days forward, IV shocked" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{store.settings.marketSymbol}</th>
                  <th className="num">P&amp;L</th>
                  <th className="num">% NLV</th>
                  <th className="num">Hedge effect</th>
                </tr>
              </thead>
              <tbody>
                {quickStress.map((row) => (
                  <tr key={row.movePct}>
                    <td className="mono font-semibold">{signedPercent(row.movePct, 0)}</td>
                    <td className="num"><Pnl value={row.pnl} /></td>
                    <td className="num">
                      <span className={row.pnlPct >= 0 ? 'gain mono' : 'loss mono'}>{signedPercent(row.pnlPct)}</span>
                    </td>
                    <td className="num"><Pnl value={row.hedge} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            “Hedge effect” is the difference between the portfolio as held and the same shares with every option leg removed.
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 items-start">
        <Card
          title="Net delta by ticker"
          subtitle="Dollar delta including every option leg"
          className="lg:col-span-1"
        >
          <DivergingBars
            data={exposureData}
            format={compactMoney}
            onSelect={(symbol) => navigate(`/ticker/${symbol}`)}
          />
        </Card>

        <Card title="By ticker" className="lg:col-span-2" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="num">Spot</th>
                  <th className="num">Market value</th>
                  <th className="num">Delta $</th>
                  <th className="num">Δ vs gross</th>
                  <th className="num">Vega</th>
                  <th className="num">Theta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {symbolRows.map((row) => (
                  <tr key={row.symbol}>
                    <td className="font-semibold">
                      <Link to={`/ticker/${row.symbol}`} style={{ color: 'var(--accent)' }}>{row.symbol}</Link>
                    </td>
                    <td className="num"><Money value={row.spot} decimals={2} /></td>
                    <td className="num"><Money value={row.marketValue} /></td>
                    <td className="num"><Money value={row.deltaDollars} /></td>
                    <td className="num">
                      {percent(grossEquityNotional > 0 ? (Math.abs(row.deltaDollars) / grossEquityNotional) * 100 : 0)}
                    </td>
                    <td className="num"><Pnl value={row.vegaDollars} /></td>
                    <td className="num"><Pnl value={row.thetaDollars} decimals={2} /></td>
                    <td className="num">
                      <Link to={`/ticker/${row.symbol}`} className="btn btn-sm btn-ghost">Hedges →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="By account" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Tax</th>
                <th className="num">Positions value</th>
                <th className="num">Cash</th>
                <th className="num">Total</th>
                <th className="num">Delta $</th>
                <th className="num">Unrealised</th>
              </tr>
            </thead>
            <tbody>
              {store.accounts.map((account) => {
                const roll = valuation.byAccount[account.id];
                if (!roll) return null;
                return (
                  <tr key={account.id}>
                    <td className="font-medium">{account.name}<div className="text-xs" style={{ color: 'var(--text-muted)' }}>{account.broker}</div></td>
                    <td>{accountKindLabel(account.kind)}</td>
                    <td><span className="pill">{taxTreatmentOf(account.kind).replace('_', ' ').toLowerCase()}</span></td>
                    <td className="num"><Money value={roll.marketValue} /></td>
                    <td className="num"><Money value={roll.cash} /></td>
                    <td className="num"><Money value={roll.marketValue + roll.cash} /></td>
                    <td className="num"><Money value={roll.deltaDollars} /></td>
                    <td className="num"><Pnl value={roll.unrealizedPnl} /></td>
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
