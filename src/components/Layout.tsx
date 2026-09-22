import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../state/StoreContext';
import { compactMoney } from '../lib/format';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/positions', label: 'Positions' },
  { to: '/simulate', label: 'Simulate' },
  { to: '/scenarios', label: 'Scenarios' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/instruments', label: 'Market data' },
  { to: '/connections', label: 'Connections' },
  { to: '/settings', label: 'Settings' },
];

type Theme = 'light' | 'dark' | 'system';

function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('tarro.theme') as Theme) ?? 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('tarro.theme', theme);
    } catch {
      /* private mode: the theme just does not persist */
    }
  }, [theme]);

  return [theme, setTheme];
}

export function Layout({ children }: { children: ReactNode }) {
  const { loading, error, valuation, clearError } = useStore();
  const [theme, setTheme] = useTheme();

  return (
    <div className="min-h-full flex flex-col">
      <header
        className="sticky top-0 z-20 border-b no-print"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-[1400px] mx-auto px-4 py-2.5 flex items-center gap-4 flex-wrap">
          <NavLink to="/" className="font-bold tracking-tight text-[15px] shrink-0" style={{ color: 'var(--text-primary)' }}>
            Tarro
            <span className="font-normal ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              portfolio &amp; hedge book
            </span>
          </NavLink>

          <nav className="flex items-center gap-0.5 flex-wrap order-3 w-full md:order-none md:w-auto md:flex-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {valuation && (
            <div className="text-right shrink-0 ml-auto md:ml-0">
              <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Net liquidation
              </div>
              <div className="mono font-semibold text-sm">{compactMoney(valuation.total.netLiquidation)}</div>
            </div>
          )}

          <select
            className="select w-auto text-xs shrink-0"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            aria-label="Colour theme"
          >
            <option value="system">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </header>

      {error && (
        <div
          className="px-4 py-2 text-sm flex items-center justify-between gap-4"
          style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', color: 'var(--loss-text)' }}
          role="alert"
        >
          <span>
            <strong>Error:</strong> {error}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 py-5">
        {loading ? <div style={{ color: 'var(--text-muted)' }}>Loading portfolio…</div> : children}
      </main>
    </div>
  );
}
