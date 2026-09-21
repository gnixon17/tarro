import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { money, percent, signedMoney, signedPercent } from '../lib/format';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div className="min-w-0">
            {title && <div className="card-title truncate">{title}</div>}
            {subtitle && <div className="card-sub">{subtitle}</div>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * A single headline number. Used where a chart would be overkill - a total, a
 * net delta, a vega. The label carries the meaning; colour is only ever a
 * secondary cue on top of an explicit sign.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'gain' | 'loss' | 'auto';
  size?: 'sm' | 'md' | 'lg';
}) {
  const toneClass = tone === 'gain' ? 'gain' : tone === 'loss' ? 'loss' : '';
  const sizeClass = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-2xl';
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={`${sizeClass} font-semibold tracking-tight mono ${toneClass}`}>{value}</div>
      {hint && <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  );
}

/** A money figure that colours itself by sign and always shows the sign. */
export function Pnl({ value, decimals = 0, className = '' }: { value: number; decimals?: 0 | 2; className?: string }) {
  const tone = value > 0 ? 'gain' : value < 0 ? 'loss' : '';
  return <span className={`mono ${tone} ${className}`}>{signedMoney(value, decimals)}</span>;
}

export function PctChange({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const tone = value > 0 ? 'gain' : value < 0 ? 'loss' : '';
  return <span className={`mono ${tone}`}>{signedPercent(value, decimals)}</span>;
}

export function Money({ value, decimals = 0 }: { value: number; decimals?: 0 | 2 }) {
  return <span className="mono">{money(value, decimals)}</span>;
}

export function Percent({ value, decimals = 1 }: { value: number; decimals?: number }) {
  return <span className="mono">{percent(value, decimals)}</span>;
}

/**
 * A labelled form control.
 *
 * The label is associated by `htmlFor` rather than by wrapping the control:
 * wrapping folds the hint text - and a select's option text - into the
 * control's accessible name, so a screen reader announces the whole paragraph
 * and two different fields end up sharing a name. The hint is attached
 * separately through `aria-describedby`, which is what it is for.
 */
export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const control =
    isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          id: (children.props as { id?: string }).id ?? id,
          'aria-describedby': hintId,
        })
      : children;

  return (
    <div className={`block ${className}`}>
      <label className="label" htmlFor={id}>{label}</label>
      {control}
      {hint && (
        <span id={hintId} className="block text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      <header className="card-header">
        <div className="card-title">{title}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="p-4 max-h-[70vh] overflow-y-auto">{children}</div>
      {footer && (
        <footer className="px-4 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border)' }}>
          {footer}
        </footer>
      )}
    </dialog>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-sm mb-4 max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </div>
      {action}
    </div>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'good' | 'warning' | 'critical' }) {
  const color =
    tone === 'good' ? 'var(--gain-text)' : tone === 'critical' ? 'var(--loss-text)' : tone === 'warning' ? 'var(--warning)' : undefined;
  return (
    <span className="pill" style={color ? { color, borderColor: color } : undefined}>
      {children}
    </span>
  );
}

/** Labelled slider with a numeric input beside it, kept in sync. */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label mb-0">{label}</span>
        <span className="mono text-sm font-semibold">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      {hint && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  );
}
