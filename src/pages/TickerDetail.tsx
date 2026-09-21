import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LineChart } from '../components/charts/LineChart';
import { PositionDialog, StrategyDialog } from '../components/PositionDialogs';
import { Card, EmptyState, Money, Percent, Pill, Pnl, Stat } from '../components/ui';
import { api } from '../lib/api';
import { compactMoney, dteLabel, money, number, optionLabel, percent, signedPercent, volPoints } from '../lib/format';
import { TEMPLATES_BY_ID, classifyStrategy, templateLabel } from '../lib/options/strategies';
import { daysUntilLastExpiry, hedgeSummary, underlyingLadder } from '../lib/portfolio/analysis';
import { daysToExpiry } from '../lib/portfolio/valuation';
import { useStore } from '../state/StoreContext';
import type { OptionPosition, Position } from '../lib/types';

const DOWNSIDE_STEPS = [-40, -30, -20, -10, -5, 5, 10, 20];

export default function TickerDetail() {
  const { symbol = '' } = useParams();
  const { store, valuation, run } = useStore();
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [positionOpen, setPositionOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [horizonDays, setHorizonDays] = useState(30);

  const asOf = useMemo(() => new Date(), [store]);

  const positions = useMemo(
    () => (store ? store.positions.filter((p) => p.symbol === symbol) : []),
    [store, symbol],
  );

  const expiryDays = useMemo(() => daysUntilLastExpiry(positions, asOf), [positions, asOf]);

  const expiryLadder = useMemo(() => {
    if (!store) return [];
    return underlyingLadder(store, symbol, {
      fromPct: -60, upToPct: 60, steps: 121,
      daysForward: expiryDays,
      applyVolShock: false,
    });
  }, [store, symbol, expiryDays]);

  const horizonLadder = useMemo(() => {
    if (!store) return [];
    return underlyingLadder(store, symbol, {
      fromPct: -60, upToPct: 60, steps: 121,
      daysForward: horizonDays,
      applyVolShock: true,
    });
  }, [store, symbol, horizonDays]);

  const summary = useMemo(
    () => (store && valuation ? hedgeSummary(store, symbol, valuation, expiryLadder) : null),
    [store, valuation, symbol, expiryLadder],
  );

  if (!store || !valuation) return null;

  const instrument = store.instruments.find((i) => i.symbol === symbol);
  if (!instrument) {
    return (
      <Card>
        <EmptyState
          title={`${symbol} is not in your market data`}
          body="Add the ticker under Market data before tracking positions in it."
          action={<Link to="/instruments" className="btn btn-primary">Go to market data</Link>}
        />
      </Card>
    );
  }

  const options = positions.filter((p): p is OptionPosition => p.kind === 'OPTION');
  const groupIds = [...new Set(positions.map((p) => p.groupId).filter(Boolean))] as string[];
  const ungrouped = positions.filter((p) => !p.groupId);

  const downside = DOWNSIDE_STEPS.map((movePct) => {
    const nearest = horizonLadder.reduce((best, point) =>
      Math.abs(point.movePct - movePct) < Math.abs(best.movePct - movePct) ? point : best,
    horizonLadder[0]);
    const atExpiry = expiryLadder.reduce((best, point) =>
      Math.abs(point.movePct - movePct) < Math.abs(best.movePct - movePct) ? point : best,
    expiryLadder[0]);
    return { movePct, nearest, atExpiry };
  }).filter((row) => row.nearest && row.atExpiry);

  async function removePosition(position: Position) {
    if (!confirm(`Delete ${position.kind === 'EQUITY' ? 'shares' : 'this leg'} in ${position.symbol}?`)) return;
    await run(() => api.positions.remove(position.id));
  }

  async function removeGroup(groupId: string) {
    if (!confirm('Delete this strategy group? Its legs stay, ungrouped.')) return;
    await run(() => api.groups.remove(groupId));
  }

  const markers = [
    { x: instrument.price, label: 'spot', emphasis: true },
    ...options.map((o) => ({ x: o.strike, label: `${o.quantity > 0 ? '+' : '−'}${o.right === 'CALL' ? 'C' : 'P'}${o.strike}` })),
    ...(summary?.breakevens ?? []).map((b) => ({ x: b, label: `BE ${b.toFixed(0)}` })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {instrument.symbol}
            <span className="ml-2 text-base font-normal" style={{ color: 'var(--text-secondary)' }}>{instrument.name}</span>
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Pill>spot {money(instrument.price, 2)}</Pill>
            <Pill>30d IV {volPoints(instrument.ivAtm30)}</Pill>
            <Pill>beta {number(instrument.beta)}</Pill>
            <Pill>vol beta {number(instrument.volBeta)}</Pill>
            {instrument.sector && <Pill>{instrument.sector}</Pill>}
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/instruments" className="btn">Edit assumptions</Link>
          <button type="button" className="btn" onClick={() => { setEditing(null); setPositionOpen(true); }}>Add leg</button>
          <button type="button" className="btn btn-primary" onClick={() => setStrategyOpen(true)}>Add hedge</button>
        </div>
      </div>

      {summary && (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Card bodyClassName="p-4">
            <Stat label="Shares" value={number(summary.shares, 0)} hint={money(summary.shareNotional)} size="sm" />
          </Card>
          <Card bodyClassName="p-4">
            <Stat
              label="Net delta"
              value={number(summary.netDeltaShares, 0)}
              hint="share-equivalents after options"
              size="sm"
            />
          </Card>
          <Card bodyClassName="p-4">
            <Stat
              label="Exposure removed"
              value={summary.shares !== 0 ? signedPercent(summary.hedgeRatio * 100) : '—'}
              tone={summary.hedgeRatio < 0 ? 'gain' : 'neutral'}
              hint="vs holding the shares alone"
              size="sm"
            />
          </Card>
          <Card bodyClassName="p-4">
            <Stat
              label="Put coverage"
              value={percent(summary.coverageRatio * 100, 0)}
              hint="long put notional / share notional"
              size="sm"
            />
          </Card>
          <Card bodyClassName="p-4">
            <Stat
              label="Option book value"
              value={compactMoney(summary.netOptionValue)}
              tone={summary.netOptionValue >= 0 ? 'gain' : 'loss'}
              hint={`${summary.optionCount} legs`}
              size="sm"
            />
          </Card>
          <Card bodyClassName="p-4">
            <Stat
              label="Vega / Theta"
              value={`${compactMoney(summary.vegaDollars)} / ${compactMoney(summary.thetaDollars)}`}
              hint="per vol point / per day"
              size="sm"
            />
          </Card>
        </div>
      )}

      <Card
        title="Payoff"
        subtitle={
          expiryDays > 0
            ? `Solid line is ${horizonDays} days out with IV responding to the move; dashed is at the last expiry (${summary?.payoffExpiry}), all intrinsic.`
            : 'No option legs on this ticker yet, so the payoff is just the shares.'
        }
        actions={
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Horizon
            <input
              type="number"
              className="input w-20"
              min={0}
              max={Math.max(1, expiryDays)}
              value={horizonDays}
              onChange={(e) => setHorizonDays(Math.max(0, Number(e.target.value)))}
            />
            days
          </label>
        }
      >
        <LineChart
          x={expiryLadder.map((p) => p.price)}
          series={[
            { id: 'horizon', label: `As held, +${horizonDays}d`, values: horizonLadder.map((p) => p.pnl), colorIndex: 0 },
            { id: 'expiry', label: 'At final expiry', values: expiryLadder.map((p) => p.pnl), colorIndex: 2, dashed: true },
            { id: 'shares', label: 'Shares only', values: expiryLadder.map((p) => p.sharesOnlyPnl), colorIndex: 1, dashed: true },
          ]}
          height={320}
          formatY={compactMoney}
          formatX={(v) => `$${v.toFixed(0)}`}
          xLabel={`${symbol} price`}
          markers={markers}
        />
      </Card>

      <Card
        title="Hedge structures"
        subtitle="Every leg on this ticker, grouped into the structure it belongs to"
        bodyClassName="p-0"
      >
        {groupIds.length === 0 && ungrouped.length === 0 && (
          <EmptyState title="No positions" body={`Nothing held in ${symbol} yet.`} />
        )}

        {groupIds.map((groupId) => {
          const group = store.groups.find((g) => g.id === groupId);
          const legs = positions.filter((p) => p.groupId === groupId);
          const detected = classifyStrategy(legs);
          const template = TEMPLATES_BY_ID[detected];
          const roll = valuation.byGroup[groupId];
          return (
            <div key={groupId} className="border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
              <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{group?.name ?? 'Structure'}</div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    reads as <strong>{templateLabel(detected)}</strong>
                    {group && group.template !== detected && (
                      <> · entered as {templateLabel(group.template)}</>
                    )}
                  </div>
                  {template && (
                    <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{template.hedgeNote}</div>
                  )}
                  {group?.thesis && (
                    <div className="text-xs mt-1 italic" style={{ color: 'var(--text-secondary)' }}>“{group.thesis}”</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {roll && <div className="mono text-sm">{money(roll.marketValue)}</div>}
                  {roll && <Pnl value={roll.unrealizedPnl} />}
                  <div>
                    <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => removeGroup(groupId)}>
                      Ungroup
                    </button>
                  </div>
                </div>
              </div>
              <LegTable legs={legs} onEdit={(p) => { setEditing(p); setPositionOpen(true); }} onRemove={removePosition} asOf={asOf} />
            </div>
          );
        })}

        {ungrouped.length > 0 && (
          <div>
            <div className="px-4 py-3 font-semibold text-sm">Ungrouped</div>
            <LegTable legs={ungrouped} onEdit={(p) => { setEditing(p); setPositionOpen(true); }} onRemove={removePosition} asOf={asOf} />
          </div>
        )}
      </Card>

      <Card
        title="What a move does"
        subtitle={`${horizonDays} days forward, IV shocked with the move`}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{symbol} move</th>
                <th className="num">Price</th>
                <th className="num">IV</th>
                <th className="num">P&amp;L as held</th>
                <th className="num">Shares only</th>
                <th className="num">At expiry</th>
              </tr>
            </thead>
            <tbody>
              {downside.map((row) => (
                <tr key={row.movePct}>
                  <td className="mono font-semibold">{signedPercent(row.movePct, 0)}</td>
                  <td className="num"><Money value={row.nearest.price} decimals={2} /></td>
                  <td className="num">{row.nearest.iv30 !== undefined ? volPoints(row.nearest.iv30) : '—'}</td>
                  <td className="num"><Pnl value={row.nearest.pnl} /></td>
                  <td className="num"><Pnl value={row.nearest.sharesOnlyPnl} /></td>
                  <td className="num"><Pnl value={row.atExpiry.pnl} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary?.breakevens.length ? (
          <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            Breakeven at expiry: {summary.breakevens.map((b) => `$${b.toFixed(2)}`).join(', ')}
          </div>
        ) : null}
      </Card>

      <StrategyDialog open={strategyOpen} onClose={() => setStrategyOpen(false)} presetSymbol={symbol} />
      <PositionDialog
        open={positionOpen}
        onClose={() => { setPositionOpen(false); setEditing(null); }}
        editing={editing}
        presetSymbol={symbol}
      />
    </div>
  );
}

function LegTable({
  legs,
  onEdit,
  onRemove,
  asOf,
}: {
  legs: Position[];
  onEdit: (p: Position) => void;
  onRemove: (p: Position) => void;
  asOf: Date;
}) {
  const { valuation, store } = useStore();
  if (!valuation || !store) return null;

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Leg</th>
            <th>Account</th>
            <th className="num">Qty</th>
            <th className="num">Mark</th>
            <th className="num">IV</th>
            <th>DTE</th>
            <th className="num">Delta $</th>
            <th className="num">Value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {legs.map((p) => {
            const v = valuation.byPosition[p.id];
            const account = store.accounts.find((a) => a.id === p.accountId);
            const dte = p.kind === 'OPTION' ? daysToExpiry(p.expiry, asOf) : null;
            return (
              <tr key={p.id}>
                <td className="mono whitespace-nowrap">{p.kind === 'EQUITY' ? `${p.symbol} shares` : optionLabel(p)}</td>
                <td className="text-xs">{account?.name ?? '—'}</td>
                <td className={`num ${p.quantity < 0 ? 'loss' : ''}`}>{number(p.quantity, 0)}</td>
                <td className="num">{v ? <Money value={v.unitPrice} decimals={2} /> : '—'}</td>
                <td className="num">{v?.iv !== undefined ? volPoints(v.iv) : '—'}</td>
                <td className="text-xs">{dte !== null ? dteLabel(dte) : '—'}</td>
                <td className="num">{v ? <Money value={v.deltaDollars} /> : '—'}</td>
                <td className="num">{v ? <Money value={v.marketValue} /> : '—'}</td>
                <td className="num whitespace-nowrap">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => onEdit(p)}>Edit</button>
                  <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => onRemove(p)}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
