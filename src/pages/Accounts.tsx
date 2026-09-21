import { useState } from 'react';
import { Card, EmptyState, Field, Modal, Money, Pnl } from '../components/ui';
import { api } from '../lib/api';
import { ACCOUNT_KINDS, accountKindLabel, taxTreatmentOf, type Account, type AccountKind } from '../lib/types';
import { useStore } from '../state/StoreContext';

const OPTIONS_LEVELS = [
  { value: 0, label: '0 — none' },
  { value: 1, label: '1 — covered calls, cash-secured puts' },
  { value: 2, label: '2 — long calls and puts' },
  { value: 3, label: '3 — spreads' },
  { value: 4, label: '4 — naked short options' },
];

export default function Accounts() {
  const { store, valuation, run } = useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Account>>({});

  if (!store || !valuation) return null;

  function edit(account?: Account) {
    setDraft(account ? { ...account } : { name: '', broker: '', kind: 'TAXABLE', cash: 0, optionsLevel: 2 });
    setOpen(true);
  }

  async function save() {
    const payload = {
      ...draft,
      cash: Number(draft.cash) || 0,
      optionsLevel: draft.optionsLevel === undefined ? undefined : (Number(draft.optionsLevel) as Account['optionsLevel']),
    };
    const ok = draft.id
      ? await run(() => api.accounts.update(draft.id!, payload))
      : await run(() => api.accounts.create(payload));
    if (ok) setOpen(false);
  }

  async function remove(account: Account) {
    const count = store!.positions.filter((p) => p.accountId === account.id).length;
    if (!confirm(`Delete “${account.name}”? This also removes its ${count} position${count === 1 ? '' : 's'}.`)) return;
    await run(() => api.accounts.remove(account.id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            One row per brokerage account. Tax treatment is derived from the account type.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => edit()}>Add account</button>
      </div>

      <Card bodyClassName="p-0">
        {store.accounts.length === 0 ? (
          <EmptyState
            title="No accounts"
            body="Add your brokerage, IRA and 401(k) accounts so positions can be attributed to the right place."
            action={<button type="button" className="btn btn-primary" onClick={() => edit()}>Add your first account</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Broker</th>
                  <th>Type</th>
                  <th>Tax</th>
                  <th>Options level</th>
                  <th className="num">Positions</th>
                  <th className="num">Market value</th>
                  <th className="num">Cash</th>
                  <th className="num">Unrealised</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {store.accounts.map((account) => {
                  const roll = valuation.byAccount[account.id];
                  const count = store.positions.filter((p) => p.accountId === account.id).length;
                  return (
                    <tr key={account.id}>
                      <td className="font-medium">{account.name}</td>
                      <td>{account.broker}</td>
                      <td>{accountKindLabel(account.kind)}</td>
                      <td><span className="pill">{taxTreatmentOf(account.kind).replace('_', ' ').toLowerCase()}</span></td>
                      <td className="text-xs">{OPTIONS_LEVELS.find((l) => l.value === account.optionsLevel)?.label ?? '—'}</td>
                      <td className="num">{count}</td>
                      <td className="num"><Money value={roll?.marketValue ?? 0} /></td>
                      <td className="num"><Money value={account.cash} /></td>
                      <td className="num"><Pnl value={roll?.unrealizedPnl ?? 0} /></td>
                      <td className="num whitespace-nowrap">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => edit(account)}>Edit</button>
                        <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(account)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={draft.id ? 'Edit account' : 'Add account'}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!draft.name} onClick={save}>Save</button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input className="input" value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Broker">
            <input className="input" value={draft.broker ?? ''} onChange={(e) => setDraft({ ...draft, broker: e.target.value })} />
          </Field>
          <Field label="Account type" hint={`Tax treatment: ${taxTreatmentOf((draft.kind ?? 'TAXABLE') as AccountKind).replace('_', ' ').toLowerCase()}`}>
            <select className="select" value={draft.kind ?? 'TAXABLE'} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AccountKind })}>
              {ACCOUNT_KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Cash">
            <input className="input" type="number" step="any" value={draft.cash ?? 0} onChange={(e) => setDraft({ ...draft, cash: Number(e.target.value) })} />
          </Field>
          <Field label="Options approval level" hint="Informational — a reminder of what this account can actually trade.">
            <select
              className="select"
              value={draft.optionsLevel ?? 0}
              onChange={(e) => setDraft({ ...draft, optionsLevel: Number(e.target.value) as Account['optionsLevel'] })}
            >
              {OPTIONS_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <input className="input" value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
