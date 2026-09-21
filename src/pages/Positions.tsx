import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PositionDialog, StrategyDialog } from '../components/PositionDialogs';
import { Card, EmptyState, Money, Pnl } from '../components/ui';
import { api } from '../lib/api';
import { dteLabel, money, number, optionLabel, volPoints } from '../lib/format';
import { classifyStrategy, templateLabel } from '../lib/options/strategies';
import { daysToExpiry } from '../lib/portfolio/valuation';
import { useStore } from '../state/StoreContext';
import type { Position } from '../lib/types';

type GroupBy = 'symbol' | 'account' | 'strategy';

export default function Positions() {
  const { store, valuation, run } = useStore();
  const [groupBy, setGroupBy] = useState<GroupBy>('symbol');
  const [showClosed, setShowClosed] = useState(false);
  const [positionOpen, setPositionOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);

  const asOf = useMemo(() => new Date(), [store]);

  const visible = useMemo(() => {
    if (!store) return [];
    return store.positions.filter(
      (p) => showClosed || p.kind === 'EQUITY' || daysToExpiry(p.expiry, asOf) > 0,
    );
  }, [store, showClosed, asOf]);

  const buckets = useMemo(() => {
    if (!store) return [];
    const map = new Map<string, { key: string; title: string; subtitle?: string; to?: string; positions: Position[] }>();

    for (const p of visible) {
      let key: string;
      let title: string;
      let subtitle: string | undefined;
      let to: string | undefined;

      if (groupBy === 'symbol') {
        key = p.symbol;
        title = p.symbol;
        subtitle = store.instruments.find((i) => i.symbol === p.symbol)?.name;
        to = `/ticker/${p.symbol}`;
      } else if (groupBy === 'account') {
        const account = store.accounts.find((a) => a.id === p.accountId);
        key = p.accountId;
        title = account?.name ?? 'Unassigned';
        subtitle = account?.broker;
      } else {
        key = p.groupId ?? `loose:${p.symbol}`;
        const group = store.groups.find((g) => g.id === p.groupId);
        title = group?.name ?? `${p.symbol} — ungrouped legs`;
        subtitle = group?.thesis;
      }

      if (!map.has(key)) map.set(key, { key, title, subtitle, to, positions: [] });
      map.get(key)!.positions.push(p);
    }

    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [visible, groupBy, store]);

  if (!store || !valuation) return null;

  async function remove(position: Position) {
    if (!confirm(`Delete this ${position.kind === 'EQUITY' ? 'share' : 'option'} position in ${position.symbol}?`)) return;
    await run(() => api.positions.remove(position.id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="label mb-0" htmlFor="group-by">Group by</label>
          <select id="group-by" className="select w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="symbol">Ticker</option>
            <option value="account">Account</option>
            <option value="strategy">Strategy</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm ml-2" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show expired legs
          </label>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={() => setStrategyOpen(true)}>Build strategy</button>
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setPositionOpen(true); }}>
            Add position
          </button>
        </div>
      </div>

      {buckets.length === 0 && (
        <Card>
          <EmptyState
            title="Nothing here yet"
            body="Add shares or option legs, or build a whole structure from a template."
            action={<button type="button" className="btn btn-primary" onClick={() => setStrategyOpen(true)}>Build a strategy</button>}
          />
        </Card>
      )}

      {buckets.map((bucket) => {
        const detected = classifyStrategy(bucket.positions);
        const totals = bucket.positions.reduce(
          (acc, p) => {
            const v = valuation.byPosition[p.id];
            if (!v) return acc;
            acc.value += v.marketValue;
            acc.pnl += v.unrealizedPnl;
            acc.delta += v.deltaDollars;
            return acc;
          },
          { value: 0, pnl: 0, delta: 0 },
        );

        return (
          <Card
            key={bucket.key}
            title={
              bucket.to ? (
                <Link to={bucket.to} style={{ color: 'var(--accent)' }}>{bucket.title}</Link>
              ) : (
                bucket.title
              )
            }
            subtitle={
              <span>
                {bucket.subtitle}
                {groupBy !== 'account' && (
                  <>
                    {bucket.subtitle ? ' · ' : ''}
                    reads as <strong>{templateLabel(detected)}</strong>
                  </>
                )}
              </span>
            }
            actions={
              <div className="flex items-center gap-4 text-sm">
                <span className="mono" style={{ color: 'var(--text-secondary)' }}>{money(totals.value)}</span>
                <Pnl value={totals.pnl} />
              </div>
            }
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Position</th>
                    {groupBy !== 'account' && <th>Account</th>}
                    <th className="num">Qty</th>
                    <th className="num">Cost</th>
                    <th className="num">Mark</th>
                    <th className="num">IV</th>
                    <th>DTE</th>
                    <th className="num">Value</th>
                    <th className="num">P&amp;L</th>
                    <th className="num">Delta $</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bucket.positions.map((p) => {
                    const v = valuation.byPosition[p.id];
                    const account = store.accounts.find((a) => a.id === p.accountId);
                    const dte = p.kind === 'OPTION' ? daysToExpiry(p.expiry, asOf) : null;
                    return (
                      <tr key={p.id}>
                        <td className="font-medium">
                          {p.kind === 'EQUITY' ? (
                            <>
                              {p.symbol} <span className="pill">shares</span>
                            </>
                          ) : (
                            <span className="mono">{optionLabel(p)}</span>
                          )}
                          {p.notes && (
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.notes}</div>
                          )}
                        </td>
                        {groupBy !== 'account' && <td className="text-xs">{account?.name ?? '—'}</td>}
                        <td className={`num ${p.quantity < 0 ? 'loss' : ''}`}>{number(p.quantity, 0)}</td>
                        <td className="num"><Money value={p.costBasis} decimals={2} /></td>
                        <td className="num">{v ? <Money value={v.unitPrice} decimals={2} /> : '—'}</td>
                        <td className="num">{v?.iv !== undefined ? volPoints(v.iv) : '—'}</td>
                        <td className="text-xs" style={{ color: dte !== null && dte <= 0 ? 'var(--loss-text)' : undefined }}>
                          {dte !== null ? dteLabel(dte) : '—'}
                        </td>
                        <td className="num">{v ? <Money value={v.marketValue} /> : '—'}</td>
                        <td className="num">{v ? <Pnl value={v.unrealizedPnl} /> : '—'}</td>
                        <td className="num">{v ? <Money value={v.deltaDollars} /> : '—'}</td>
                        <td className="num whitespace-nowrap">
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(p); setPositionOpen(true); }}>Edit</button>
                          <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(p)}>Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      <PositionDialog open={positionOpen} onClose={() => { setPositionOpen(false); setEditing(null); }} editing={editing} />
      <StrategyDialog open={strategyOpen} onClose={() => setStrategyOpen(false)} />
    </div>
  );
}
