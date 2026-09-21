import { useRef, useState } from 'react';
import { Card, Field, SliderField } from '../components/ui';
import { api } from '../lib/api';
import { parsePositionsCsv, POSITION_CSV_TEMPLATE } from '../lib/csv';
import { useStore } from '../state/StoreContext';
import { DEFAULT_VOL_MODEL } from '../lib/types';

const BACKEND_LABELS: Record<string, string> = {
  artifact: 'Storage: this artifact',
  server: 'Storage: the local server',
  browser: 'Storage: this browser',
};

function backendLabel(name: string): string {
  return BACKEND_LABELS[name] ?? `Storage: ${name}`;
}

export default function SettingsPage() {
  const { store, backend, run, refresh } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState('');
  const [csvReport, setCsvReport] = useState<string | null>(null);

  if (!store) return null;

  const { settings } = store;
  const vol = settings.volModel;

  const saveSettings = (patch: Partial<typeof settings>) => run(() => api.updateSettings(patch));
  const saveVol = (patch: Partial<typeof vol>) => saveSettings({ volModel: { ...vol, ...patch } });

  function exportJson() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tarro-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.accounts)) throw new Error('That file is not a Tarro export.');
      if (!confirm('Replace the entire portfolio with this file?')) return;
      await run(() => api.putStore(parsed));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read that file.');
    }
  }

  async function importCsv() {
    const { positions, errors } = parsePositionsCsv(csvText, store!);
    if (positions.length === 0) {
      setCsvReport(errors.length ? errors.join('\n') : 'Nothing to import.');
      return;
    }
    const saved = await run(() => api.bulkPositions(positions));
    setCsvReport(
      [
        saved ? `Imported ${saved.length} position${saved.length === 1 ? '' : 's'}.` : 'Import failed.',
        ...errors.map((e) => `Skipped: ${e}`),
      ].join('\n'),
    );
    if (saved) setCsvText('');
  }

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Card title="Pricing" subtitle="Applies to every valuation and simulation">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Risk-free rate" hint="Decimal, continuously compounded. 0.042 = 4.2%.">
            <input
              className="input"
              type="number"
              step="0.001"
              defaultValue={settings.riskFreeRate}
              onBlur={(e) => saveSettings({ riskFreeRate: Number(e.target.value) })}
            />
          </Field>
          <Field label="Market proxy" hint="The ticker whose move drives every other name through beta.">
            <select
              className="select"
              value={settings.marketSymbol}
              onChange={(e) => saveSettings({ marketSymbol: e.target.value })}
            >
              {store.instruments.map((i) => (
                <option key={i.symbol} value={i.symbol}>{i.symbol}</option>
              ))}
            </select>
          </Field>
          <Field label="Beta-weight against" hint="Used for the beta-weighted delta reported on the dashboard.">
            <select
              className="select"
              value={settings.betaWeightSymbol}
              onChange={(e) => saveSettings({ betaWeightSymbol: e.target.value })}
            >
              {store.instruments.map((i) => (
                <option key={i.symbol} value={i.symbol}>{i.symbol}</option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card
        title="Default volatility response"
        subtitle="Scenarios start from these, and each scenario can override them"
        actions={
          <button type="button" className="btn btn-sm" onClick={() => saveSettings({ volModel: { ...DEFAULT_VOL_MODEL } })}>
            Reset
          </button>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <SliderField
            label="Vol points per 1% index move"
            value={vol.betaVolToSpot}
            onChange={(v) => saveVol({ betaVolToSpot: v })}
            min={0}
            max={3}
            step={0.05}
            hint="Historically ≈0.8–1.5 for the S&P, higher in stressed regimes."
          />
          <SliderField
            label="Convexity"
            value={vol.convexity}
            onChange={(v) => saveVol({ convexity: v })}
            min={0}
            max={12}
            step={0.5}
            hint="Large moves lift vol more than proportionally."
          />
          <SliderField
            label="Upside damping"
            value={vol.upsideDamping}
            onChange={(v) => saveVol({ upsideDamping: v })}
            min={0}
            max={1.5}
            step={0.05}
            hint="Rallies compress vol by this fraction of a selloff's lift."
          />
          <SliderField
            label="Vol-level exponent"
            value={vol.volLevelExponent}
            onChange={(v) => saveVol({ volLevelExponent: v })}
            min={0}
            max={1}
            step={0.05}
            hint="How a name's vol response scales with its own vol level. Fitted to COVID it lands near 0.45; 1.0 would send high-vol names to implausible levels."
          />
          <SliderField
            label="Term decay"
            value={vol.termDecay}
            onChange={(v) => saveVol({ termDecay: v })}
            min={0}
            max={1.2}
            step={0.05}
            hint="0 means every tenor moves alike; higher makes weeklies react much harder than LEAPS."
          />
          <Field label="Skew behaviour">
            <select
              className="select"
              value={vol.stickiness}
              onChange={(e) => saveVol({ stickiness: e.target.value as typeof vol.stickiness })}
            >
              <option value="STICKY_MONEYNESS">Sticky moneyness — the smile follows spot</option>
              <option value="STICKY_STRIKE">Sticky strike — the smile stays on absolute strikes</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min vol">
              <input className="input" type="number" step="0.01" defaultValue={vol.minVol} onBlur={(e) => saveVol({ minVol: Number(e.target.value) })} />
            </Field>
            <Field label="Max vol">
              <input className="input" type="number" step="0.1" defaultValue={vol.maxVol} onBlur={(e) => saveVol({ maxVol: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Import positions from CSV">
        <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
          One row per position. Accounts are matched by name, tickers must already exist under Market data.
        </p>
        <pre
          className="text-xs p-3 rounded overflow-x-auto mb-3"
          style={{ background: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}
        >
{POSITION_CSV_TEMPLATE}
        </pre>
        <textarea
          className="textarea font-mono text-xs"
          rows={6}
          placeholder="Paste CSV here"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
        />
        <div className="flex gap-2 mt-2">
          <button type="button" className="btn btn-primary" disabled={!csvText.trim()} onClick={importCsv}>Import</button>
          <button type="button" className="btn" onClick={() => { setCsvText(POSITION_CSV_TEMPLATE); setCsvReport(null); }}>
            Load template
          </button>
        </div>
        {csvReport && (
          <pre className="text-xs mt-3 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{csvReport}</pre>
        )}
      </Card>

      <Card title="Data" subtitle={backend ? backendLabel(backend.name) : 'Checking storage…'}>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={exportJson}>Export JSON</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              if (!confirm('Replace everything with the demo portfolio?')) return;
              await run(() => api.reset('demo'));
            }}
          >
            Load demo portfolio
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              if (!confirm('Delete every account, position and saved scenario? This cannot be undone.')) return;
              await run(() => api.reset('empty'));
            }}
          >
            Clear everything
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => refresh()}>Reload</button>
        </div>
        {backend && (
          <p
            className="text-xs mt-3"
            style={{ color: backend.durable ? 'var(--text-muted)' : 'var(--warning)' }}
          >
            {backend.description}
          </p>
        )}
      </Card>
    </div>
  );
}
