import { useState } from 'react';
import { useChartWidth } from './useChartWidth';

export interface BarDatum {
  label: string;
  value: number;
  /** Optional second line under the label. */
  sublabel?: string;
  href?: string;
}

/**
 * Horizontal bars with a shared zero baseline.
 *
 * Diverging by sign - one cool hue for positive, one warm for negative, with a
 * neutral zero line - because the reader's question is polarity, not identity.
 * Values are direct-labelled, so the colour is never the only cue.
 */
export function DivergingBars({
  data,
  format,
  height = 26,
  onSelect,
}: {
  data: BarDatum[];
  format: (value: number) => string;
  height?: number;
  onSelect?: (label: string) => void;
}) {
  const [ref, width] = useChartWidth();
  const [hover, setHover] = useState<string | null>(null);

  const labelWidth = Math.min(96, Math.max(56, width * 0.18));
  const valueWidth = 84;
  const plotWidth = Math.max(40, width - labelWidth - valueWidth - 16);
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const mid = labelWidth + plotWidth / 2;

  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={data.length * height + 8} role="img" aria-label="Exposure by ticker">
        {data.map((d, i) => {
          const y = i * height + 4;
          const barWidth = (Math.abs(d.value) / max) * (plotWidth / 2);
          const x = d.value >= 0 ? mid : mid - barWidth;
          const color = d.value >= 0 ? 'var(--series-1)' : 'var(--series-2)';
          return (
            <g
              key={d.label}
              onMouseEnter={() => setHover(d.label)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(d.label)}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            >
              <rect
                x={0}
                y={y - 2}
                width={width}
                height={height - 2}
                fill={hover === d.label ? 'var(--surface-2)' : 'transparent'}
                rx={6}
              />
              <text
                x={4}
                y={y + height / 2 - 2}
                dominantBaseline="middle"
                fontSize={12}
                fontWeight={600}
                fill="var(--text-primary)"
              >
                {d.label}
              </text>
              <rect
                x={x}
                y={y + 4}
                width={Math.max(2, barWidth)}
                height={height - 14}
                fill={color}
                rx={3}
              />
              <text
                x={width - 4}
                y={y + height / 2 - 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={12}
                fill="var(--text-secondary)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {format(d.value)}
              </text>
            </g>
          );
        })}
        <line
          x1={mid}
          x2={mid}
          y1={0}
          y2={data.length * height + 8}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
