import { useEffect, useMemo, useState } from 'react';
import { Field, Modal } from './ui';
import { api } from '../lib/api';
import { STRATEGY_TEMPLATES, buildLegsFromTemplate, classifyStrategy, roundStrike } from '../lib/options/strategies';
import { useStore } from '../state/StoreContext';
import type { OptionRight, PortfolioStore, Position, StrategyGroup } from '../lib/types';

function defaultExpiry(daysOut = 45): string {
  const d = new Date(Date.now() + daysOut * 86400000);
  const daysUntilFriday = (5 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilFriday);
  return d.toISOString().slice(0, 10);
}

interface DraftPosition {
  kind: 'EQUITY' | 'OPTION';
  accountId: string;
  symbol: string;
  quantity: string;
  costBasis: string;
  groupId: string;
  notes: string;
  right: OptionRight;
  strike: string;
  expiry: string;
  multiplier: string;
  markIv: string;
  openedAt: string;
}

function emptyDraft(store: PortfolioStore): DraftPosition {
  return {
    kind: 'EQUITY',
    accountId: store.accounts[0]?.id ?? '',
    symbol: store.instruments[0]?.symbol ?? '',
    quantity: '',
    costBasis: '',
    groupId: '',
    notes: '',
    right: 'PUT',
    strike: '',
    expiry: defaultExpiry(),
    multiplier: '100',
    markIv: '',
    openedAt: '',
  };
}

function draftFromPosition(p: Position): DraftPosition {
  const common = {
    accountId: p.accountId,
    symbol: p.symbol,
    quantity: String(p.quantity),
    costBasis: String(p.costBasis),
    groupId: p.groupId ?? '',
    notes: p.notes ?? '',
    openedAt: p.openedAt ?? '',
  };
  if (p.kind === 'EQUITY') {
    return { ...common, kind: 'EQUITY', right: 'PUT', strike: '', expiry: defaultExpiry(), multiplier: '100', markIv: '' };
  }
  return {
    ...common,
    kind: 'OPTION',
    right: p.right,
    strike: String(p.strike),
    expiry: p.expiry,
    multiplier: String(p.multiplier),
    markIv: p.markIv !== undefined ? String((p.markIv * 100).toFixed(2)) : '',
  };
}

function toPosition(draft: DraftPosition): Partial<Position> {
  const base = {
    accountId: draft.accountId,
    symbol: draft.symbol.toUpperCase().trim(),
    quantity: Number(draft.quantity),
    costBasis: Number(draft.costBasis),
    groupId: draft.groupId || null,
    notes: draft.notes || undefined,
    openedAt: draft.openedAt || undefined,
  };
  if (draft.kind === 'EQUITY') return { ...base, kind: 'EQUITY' } as Partial<Position>;
  return {
    ...base,
    kind: 'OPTION',
    right: draft.right,
    strike: Number(draft.strike),
    expiry: draft.expiry,
    multiplier: Number(draft.multiplier) || 100,
    markIv: draft.markIv ? Number(draft.markIv) / 100 : undefined,
  } as Partial<Position>;
}

/** Add or edit a single position - shares or one option leg. */
export function PositionDialog({
  open,
  onClose,
  editing,
  presetGroupId,
  presetSymbol,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Position | null;
  presetGroupId?: string;
  presetSymbol?: string;
}) {
  const { store, run } = useStore();
  const [draft, setDraft] = useState<DraftPosition | null>(null);

  useEffect(() => {
    if (!store || !open) return;
    if (editing) setDraft(draftFromPosition(editing));
    else {
      const base = emptyDraft(store);
      setDraft({
        ...base,
        groupId: presetGroupId ?? '',
        symbol: presetSymbol ?? base.symbol,
      });
    }
  }, [store, open, editing, presetGroupId, presetSymbol]);

  if (!store || !draft) return null;

  const set = <K extends keyof DraftPosition>(key: K, value: DraftPosition[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const groupsForSymbol = store.groups.filter((g) => g.symbol === draft.symbol);
  const valid =
    draft.accountId &&
    draft.symbol &&
    Number.isFinite(Number(draft.quantity)) &&
    Number(draft.quantity) !== 0 &&
    Number.isFinite(Number(draft.costBasis)) &&
    (draft.kind === 'EQUITY' || (Number(draft.strike) > 0 && draft.expiry));

  async function save() {
    if (!draft) return;
    const payload = toPosition(draft);
    const ok = editing
      ? await run(() => api.positions.update(editing.id, payload))
      : await run(() => api.positions.create(payload));
    if (ok) onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit position' : 'Add position'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={save}>
            {editing ? 'Save' : 'Add position'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <select className="select" value={draft.kind} onChange={(e) => set('kind', e.target.value as 'EQUITY' | 'OPTION')}>
            <option value="EQUITY">Shares</option>
            <option value="OPTION">Option leg</option>
          </select>
        </Field>

        <Field label="Account">
          <select className="select" value={draft.accountId} onChange={(e) => set('accountId', e.target.value)}>
            {store.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Ticker" hint="Add new tickers under Market data.">
          <select className="select" value={draft.symbol} onChange={(e) => set('symbol', e.target.value)}>
            {store.instruments.map((i) => (
              <option key={i.symbol} value={i.symbol}>{i.symbol} — {i.name}</option>
            ))}
          </select>
        </Field>

        <Field
          label={draft.kind === 'EQUITY' ? 'Shares' : 'Contracts'}
          hint="Negative for a short position."
        >
          <input className="input" type="number" step="any" value={draft.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </Field>

        <Field
          label={draft.kind === 'EQUITY' ? 'Cost per share' : 'Premium per share'}
          hint={draft.kind === 'OPTION' ? 'What one share of the contract cost, not the $100-multiplied total.' : undefined}
        >
          <input className="input" type="number" step="any" value={draft.costBasis} onChange={(e) => set('costBasis', e.target.value)} />
        </Field>

        {draft.kind === 'OPTION' && (
          <>
            <Field label="Right">
              <select className="select" value={draft.right} onChange={(e) => set('right', e.target.value as OptionRight)}>
                <option value="CALL">Call</option>
                <option value="PUT">Put</option>
              </select>
            </Field>
            <Field label="Strike">
              <input className="input" type="number" step="any" value={draft.strike} onChange={(e) => set('strike', e.target.value)} />
            </Field>
            <Field label="Expiry">
              <input className="input" type="date" value={draft.expiry} onChange={(e) => set('expiry', e.target.value)} />
            </Field>
            <Field label="Multiplier" hint="100 unless the contract was adjusted.">
              <input className="input" type="number" step="1" value={draft.multiplier} onChange={(e) => set('multiplier', e.target.value)} />
            </Field>
            <Field
              label="Marked IV (vol points)"
              hint="Optional. Leave blank to price off the ticker's surface. A mark here is carried through every simulation."
            >
              <input className="input" type="number" step="any" placeholder="e.g. 42.5" value={draft.markIv} onChange={(e) => set('markIv', e.target.value)} />
            </Field>
          </>
        )}

        <Field label="Strategy group" hint="Optional. Groups legs into a named structure.">
          <select className="select" value={draft.groupId} onChange={(e) => set('groupId', e.target.value)}>
            <option value="">— none —</option>
            {groupsForSymbol.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Opened">
          <input className="input" type="date" value={draft.openedAt} onChange={(e) => set('openedAt', e.target.value)} />
        </Field>

        <Field label="Notes" className="sm:col-span-2">
          <input className="input" value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

interface DraftLeg {
  kind: 'EQUITY' | 'OPTION';
  label: string;
  right?: OptionRight;
  strike: string;
  expiry: string;
  quantity: string;
  costBasis: string;
}

/**
 * Build a multi-leg structure from a template.
 *
 * The template seeds strikes and expiries off the current spot; everything
 * stays editable, because a real fill never lands exactly on the model's
 * suggested strike.
 */
export function StrategyDialog({ open, onClose, presetSymbol }: { open: boolean; onClose: () => void; presetSymbol?: string }) {
  const { store, run } = useStore();
  const [templateId, setTemplateId] = useState('COLLAR');
  const [accountId, setAccountId] = useState('');
  const [symbol, setSymbol] = useState(presetSymbol ?? '');
  const [contracts, setContracts] = useState('1');
  const [name, setName] = useState('');
  const [thesis, setThesis] = useState('');
  const [legs, setLegs] = useState<DraftLeg[]>([]);

  const template = STRATEGY_TEMPLATES.find((t) => t.id === templateId)!;
  const instrument = store?.instruments.find((i) => i.symbol === symbol);

  useEffect(() => {
    if (!store || !open) return;
    setAccountId((prev) => prev || store.accounts[0]?.id || '');
    setSymbol((prev) => presetSymbol ?? (prev || store.instruments[0]?.symbol || ''));
  }, [store, open, presetSymbol]);

  // Re-seed the legs whenever the template, ticker or size changes.
  useEffect(() => {
    if (!instrument) return;
    const n = Math.max(1, Number(contracts) || 1);
    const built = buildLegsFromTemplate(template, instrument.price, n);
    setLegs(
      built.map((leg) => ({
        kind: leg.kind,
        label: leg.label,
        right: leg.right,
        strike: leg.strike !== undefined ? String(leg.strike) : '',
        expiry: leg.expiry ?? defaultExpiry(),
        quantity: String(leg.quantity),
        costBasis: '',
      })),
    );
    setName((prev) => (prev && prev !== '' ? prev : ''));
  }, [templateId, symbol, contracts, instrument?.price]);

  if (!store) return null;

  const setLeg = (index: number, patch: Partial<DraftLeg>) =>
    setLegs((current) => current.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));

  const addLeg = () =>
    setLegs((current) => [
      ...current,
      { kind: 'OPTION', label: 'Leg', right: 'CALL', strike: instrument ? String(roundStrike(instrument.price)) : '', expiry: defaultExpiry(), quantity: '1', costBasis: '' },
    ]);

  const removeLeg = (index: number) => setLegs((current) => current.filter((_, i) => i !== index));

  const previewName = useMemo(() => {
    if (!symbol || legs.length === 0) return '';
    const positions: Position[] = legs.map((leg, i) =>
      leg.kind === 'EQUITY'
        ? { id: `d${i}`, kind: 'EQUITY', accountId, symbol, quantity: Number(leg.quantity), costBasis: 0 }
        : {
            id: `d${i}`, kind: 'OPTION', accountId, symbol, right: leg.right ?? 'CALL',
            strike: Number(leg.strike), expiry: leg.expiry, quantity: Number(leg.quantity), multiplier: 100, costBasis: 0,
          },
    );
    const detected = classifyStrategy(positions);
    return STRATEGY_TEMPLATES.find((t) => t.id === detected)?.label ?? 'Custom structure';
  }, [legs, symbol, accountId]);

  const valid =
    accountId && symbol && legs.length > 0 &&
    legs.every((leg) => Number(leg.quantity) !== 0 && (leg.kind === 'EQUITY' || Number(leg.strike) > 0));

  async function save() {
    const group: Partial<StrategyGroup> = {
      accountId,
      symbol,
      name: name.trim() || `${symbol} ${template.label.toLowerCase()}`,
      template: templateId,
      thesis: thesis.trim() || undefined,
      openedAt: new Date().toISOString().slice(0, 10),
    };
    const positions: Partial<Position>[] = legs.map((leg) =>
      leg.kind === 'EQUITY'
        ? ({ kind: 'EQUITY', accountId, symbol, quantity: Number(leg.quantity), costBasis: Number(leg.costBasis) || instrument?.price || 0 } as Partial<Position>)
        : ({
            kind: 'OPTION', accountId, symbol, right: leg.right ?? 'CALL',
            strike: Number(leg.strike), expiry: leg.expiry, quantity: Number(leg.quantity),
            multiplier: 100, costBasis: Number(leg.costBasis) || 0,
          } as Partial<Position>),
    );
    const ok = await run(() => api.createGroupWithLegs(group, positions));
    if (ok) onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Build a strategy"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={save}>Create structure</button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Structure">
          <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {['PROTECTION', 'INCOME', 'DIRECTIONAL', 'VOLATILITY', 'NEUTRAL', 'ADVANCED', 'STOCK'].map((category) => (
              <optgroup key={category} label={category.toLowerCase()}>
                {STRATEGY_TEMPLATES.filter((t) => t.category === category).map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Ticker">
          <select className="select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {store.instruments.map((i) => (
              <option key={i.symbol} value={i.symbol}>{i.symbol}</option>
            ))}
          </select>
        </Field>
        <Field label="Account">
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {store.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Size (contracts)" hint="Equity legs scale at 100 shares per contract.">
          <input className="input" type="number" min="1" step="1" value={contracts} onChange={(e) => setContracts(e.target.value)} />
        </Field>
      </div>

      <p className="text-sm mt-3 mb-1" style={{ color: 'var(--text-secondary)' }}>
        {template.description} <strong style={{ color: 'var(--text-primary)' }}>{template.hedgeNote}</strong>
      </p>

      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <Field label="Name">
          <input
            className="input"
            placeholder={symbol ? `${symbol} ${template.label.toLowerCase()}` : ''}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Thesis" hint="Why this structure exists. Shown on the ticker page.">
          <input className="input" value={thesis} onChange={(e) => setThesis(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="label mb-0">Legs</span>
          <div className="flex items-center gap-2">
            {previewName && <span className="pill">reads as: {previewName}</span>}
            <button type="button" className="btn btn-sm" onClick={addLeg}>+ Leg</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Leg</th>
                <th>Right</th>
                <th className="num">Strike</th>
                <th>Expiry</th>
                <th className="num">Qty</th>
                <th className="num">Fill price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {legs.map((leg, i) => (
                <tr key={i}>
                  <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{leg.label}</td>
                  <td>
                    {leg.kind === 'EQUITY' ? (
                      <span className="pill">shares</span>
                    ) : (
                      <select className="select" value={leg.right} onChange={(e) => setLeg(i, { right: e.target.value as OptionRight })}>
                        <option value="CALL">Call</option>
                        <option value="PUT">Put</option>
                      </select>
                    )}
                  </td>
                  <td className="num">
                    {leg.kind === 'OPTION' && (
                      <input className="input" type="number" step="any" value={leg.strike} onChange={(e) => setLeg(i, { strike: e.target.value })} />
                    )}
                  </td>
                  <td>
                    {leg.kind === 'OPTION' && (
                      <input className="input" type="date" value={leg.expiry} onChange={(e) => setLeg(i, { expiry: e.target.value })} />
                    )}
                  </td>
                  <td className="num">
                    <input className="input" type="number" step="any" value={leg.quantity} onChange={(e) => setLeg(i, { quantity: e.target.value })} />
                  </td>
                  <td className="num">
                    <input
                      className="input"
                      type="number"
                      step="any"
                      placeholder={leg.kind === 'EQUITY' ? String(instrument?.price ?? '') : '0.00'}
                      value={leg.costBasis}
                      onChange={(e) => setLeg(i, { costBasis: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => removeLeg(i)} aria-label="Remove leg">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
