import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, Field, Modal, Money } from '../components/ui';
import { api } from '../lib/api';
import { number, volPoints } from '../lib/format';
import { useStore } from '../state/StoreContext';
import type { Instrument } from '../lib/types';

const BLANK: Partial<Instrument> = {
  symbol: '',
  name: '',
  price: 100,
  dividendYield: 0,
  beta: 1,
  ivAtm30: 0.25,
  volBeta: 1,
  skewSlope: -0.06,
  skewCurvature: 0.04,
  termSlope: 0.01,
};

/**
 * Market assumptions per ticker.
 *
 * There is no live feed wired up: these are the marks the whole app prices off,
 * so they are worth keeping current. `QuoteProvider` in the README describes
 * where a real feed would plug in.
 */
export default function Instruments() {
  const { store, run } = useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Instrument>>(BLANK);
  const [isNew, setIsNew] = useState(true);

  if (!store) return null;

  function edit(instrument?: Instrument) {
    setDraft(instrument ? { ...instrument } : { ...BLANK });
    setIsNew(!instrument);
    setOpen(true);
  }

  async function save() {
    const payload: Partial<Instrument> = {
      ...draft,
      symbol: String(draft.symbol ?? '').toUpperCase().trim(),
      price: Number(draft.price),
      dividendYield: Number(draft.dividendYield),
      beta: Number(draft.beta),
      ivAtm30: Number(draft.ivAtm30),
      volBeta: Number(draft.volBeta),
      skewSlope: Number(draft.skewSlope),
      skewCurvature: Number(draft.skewCurvature),
      termSlope: Number(draft.termSlope),
    };
    const ok = isNew
      ? await run(() => api.instruments.create(payload))
      : await run(() => api.instruments.update(payload.symbol!, payload));
    if (ok) setOpen(false);
  }

  async function remove(instrument: Instrument) {
    const count = store!.positions.filter((p) => p.symbol === instrument.symbol).length;
    if (!confirm(`Delete ${instrument.symbol}? This removes its ${count} position${count === 1 ? '' : 's'} too.`)) return;
    await run(() => api.instruments.remove(instrument.symbol));
  }

  /** Quick inline price edit - the field that changes most often. */
  async function setPrice(instrument: Instrument, price: number) {
    if (!Number.isFinite(price) || price <= 0) return;
    await run(() => api.instruments.update(instrument.symbol, { price }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Market data</h1>
          <p className="text-sm max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
            Every price, greek and simulation in the app is computed off these numbers. They are entered by hand —
            update the marks before trusting a stress test.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => edit()}>Add ticker</button>
      </div>

      <Card bodyClassName="p-0">
        {store.instruments.length === 0 ? (
          <EmptyState
            title="No tickers"
            body="Add the symbols you hold, along with their price, beta and implied vol."
            action={<button type="button" className="btn btn-primary" onClick={() => edit()}>Add a ticker</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th className="num">Price</th>
                  <th className="num">Div yield</th>
                  <th className="num">Beta</th>
                  <th className="num">30d IV</th>
                  <th className="num">Vol beta</th>
                  <th className="num">Skew</th>
                  <th className="num">Smile</th>
                  <th className="num">Term</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {store.instruments.map((instrument) => (
                  <tr key={instrument.symbol}>
                    <td className="font-semibold">
                      <Link to={`/ticker/${instrument.symbol}`} style={{ color: 'var(--accent)' }}>{instrument.symbol}</Link>
                    </td>
                    <td className="text-xs">{instrument.name}</td>
                    <td className="num">
                      <input
                        className="input w-24 text-right"
                        type="number"
                        step="any"
                        defaultValue={instrument.price}
                        onBlur={(e) => {
                          const next = Number(e.target.value);
                          if (next !== instrument.price) setPrice(instrument, next);
                        }}
                        aria-label={`${instrument.symbol} price`}
                      />
                    </td>
                    <td className="num">{(instrument.dividendYield * 100).toFixed(2)}%</td>
                    <td className="num">{number(instrument.beta)}</td>
                    <td className="num">{volPoints(instrument.ivAtm30)}</td>
                    <td className="num">{number(instrument.volBeta)}</td>
                    <td className="num">{number(instrument.skewSlope, 3)}</td>
                    <td className="num">{number(instrument.skewCurvature, 3)}</td>
                    <td className="num">{number(instrument.termSlope, 3)}</td>
                    <td className="num whitespace-nowrap">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => edit(instrument)}>Edit</button>
                      <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(instrument)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="What these parameters do">
        <dl className="grid gap-3 sm:grid-cols-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <div><dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>Beta</dt><dd>How far this name moves for a 1% move in the market proxy. Drives scenario propagation.</dd></div>
          <div><dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>30d IV</dt><dd>At-the-money implied vol at 30 days. The anchor of the whole surface.</dd></div>
          <div><dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>Vol beta</dt><dd>How hard this name's IV reacts relative to the index. 1.3 means it moves 30% more.</dd></div>
          <div><dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>Skew</dt><dd>IV change per unit of standardised log-moneyness. Negative puts downside strikes at higher vol, as equities do.</dd></div>
          <div><dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>Smile</dt><dd>Curvature: lifts both wings relative to at-the-money.</dd></div>
          <div><dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>Term</dt><dd>IV change per natural log of tenor. Positive means longer-dated vol trades above 30-day.</dd></div>
        </dl>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isNew ? 'Add ticker' : `Edit ${draft.symbol}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!draft.symbol || !Number(draft.price)} onClick={save}>Save</button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Symbol">
            <input className="input" disabled={!isNew} value={draft.symbol ?? ''} onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name">
            <input className="input" value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Price">
            <input className="input" type="number" step="any" value={draft.price ?? 0} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
          </Field>
          <Field label="Dividend yield" hint="Decimal, e.g. 0.012 for 1.2%.">
            <input className="input" type="number" step="any" value={draft.dividendYield ?? 0} onChange={(e) => setDraft({ ...draft, dividendYield: Number(e.target.value) })} />
          </Field>
          <Field label="Beta">
            <input className="input" type="number" step="any" value={draft.beta ?? 1} onChange={(e) => setDraft({ ...draft, beta: Number(e.target.value) })} />
          </Field>
          <Field label="30-day ATM IV" hint="Decimal, e.g. 0.45 for 45 vol.">
            <input className="input" type="number" step="any" value={draft.ivAtm30 ?? 0.25} onChange={(e) => setDraft({ ...draft, ivAtm30: Number(e.target.value) })} />
          </Field>
          <Field label="Vol beta" hint="1.0 tracks the index's vol response.">
            <input className="input" type="number" step="any" value={draft.volBeta ?? 1} onChange={(e) => setDraft({ ...draft, volBeta: Number(e.target.value) })} />
          </Field>
          <Field label="Sector">
            <input className="input" value={draft.sector ?? ''} onChange={(e) => setDraft({ ...draft, sector: e.target.value })} />
          </Field>
          <Field label="Skew slope" hint="Negative. Index skew is steeper (≈ −0.085) than single names (≈ −0.05).">
            <input className="input" type="number" step="any" value={draft.skewSlope ?? -0.06} onChange={(e) => setDraft({ ...draft, skewSlope: Number(e.target.value) })} />
          </Field>
          <Field label="Smile curvature">
            <input className="input" type="number" step="any" value={draft.skewCurvature ?? 0.04} onChange={(e) => setDraft({ ...draft, skewCurvature: Number(e.target.value) })} />
          </Field>
          <Field label="Term slope">
            <input className="input" type="number" step="any" value={draft.termSlope ?? 0.01} onChange={(e) => setDraft({ ...draft, termSlope: Number(e.target.value) })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
