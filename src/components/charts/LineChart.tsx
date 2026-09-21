import { useMemo, useState } from 'react';
import {
  linePath,
  linearScale,
  nearestIndex,
  niceTicks,
  paddedDomain,
  SERIES_VARS,
} from './chartUtils';
import { useChartWidth } from './useChartWidth';

export interface Series {
  id: string;
  label: string;
  values: number[];
  /** Index into the validated categorical palette. */
  colorIndex?: number;
  dashed?: boolean;
}

export interface Marker {
  x: number;
  label: string;
  /** Muted by default; `emphasis` draws it in ink. */
  emphasis?: boolean;
}

interface Props {
  x: number[];
  series: Series[];
  height?: number;
  /** Formats a y value for the axis and the tooltip. */
  formatY?: (value: number) => string;
  formatX?: (value: number) => string;
  xLabel?: string;
  yLabel?: string;
  /** Vertical reference lines: spot, strikes, breakevens. */
  markers?: Marker[];
  /** Shade the region below zero to make losses legible at a glance. */
  shadeNegative?: boolean;
}

const M = { top: 16, right: 16, bottom: 36, left: 64 };

/**
 * Multi-series line chart with a crosshair tooltip.
 *
 * One y-axis, always: two measures of different scale get two charts, never a
 * second axis. Series are direct-labelled at their right-hand end when there is
 * room, and the legend is always present for two or more series, so identity
 * never rests on colour alone.
 */
export function LineChart({
  x,
  series,
  height = 260,
  formatY = (v) => v.toFixed(0),
  formatX = (v) => v.toFixed(0),
  xLabel,
  yLabel,
  markers = [],
  shadeNegative = true,
}: Props) {
  const [ref, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const innerWidth = Math.max(80, width - M.left - M.right);
  const innerHeight = Math.max(60, height - M.top - M.bottom);

  const { xScale, yScale, yTicks, xTicks } = useMemo(() => {
    const xDomain: [number, number] = x.length ? [Math.min(...x), Math.max(...x)] : [0, 1];
    const allValues = series.flatMap((s) => s.values);
    const yDomain = paddedDomain(allValues, true);
    const xs = linearScale(xDomain, [0, innerWidth]);
    const ys = linearScale(yDomain, [innerHeight, 0]);
    return {
      xScale: xs,
      yScale: ys,
      yTicks: niceTicks(yDomain[0], yDomain[1], 5),
      xTicks: niceTicks(xDomain[0], xDomain[1], Math.max(3, Math.floor(innerWidth / 90))),
    };
  }, [x, series, innerWidth, innerHeight]);

  const pixelXs = useMemo(() => x.map((v) => xScale(v)), [x, xScale]);

  /**
   * Stagger marker labels that would otherwise overlap. Strike, spot and
   * breakeven lines cluster tightly on a payoff diagram, and two labels printed
   * on top of each other are worse than none.
   */
  const placedMarkers = useMemo(() => {
    const rows: number[] = [];
    return markers
      .map((m) => ({ ...m, px: xScale(m.x) }))
      .filter((m) => m.px >= -1 && m.px <= innerWidth + 1)
      .sort((a, b) => a.px - b.px)
      .map((m) => {
        const estimatedWidth = m.label.length * 5.5 + 8;
        let row = 0;
        while (rows[row] !== undefined && rows[row] > m.px) row++;
        rows[row] = m.px + estimatedWidth;
        return { ...m, labelY: 10 + row * 11 };
      });
  }, [markers, xScale, innerWidth]);
  const zeroY = yScale(0);
  const showDirectLabels = series.length <= 4 && innerWidth > 260;

  function handleMove(event: React.MouseEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(pixelXs, event.clientX - box.left));
  }

  const hoveredX = hover !== null ? x[hover] : null;

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={yLabel ?? 'chart'} style={{ display: 'block' }}>
        <g transform={`translate(${M.left},${M.top})`}>
          {/* Gridlines stay recessive: hairlines, never competing with the marks. */}
          {yTicks.map((t) => (
            <line
              key={`y${t}`}
              x1={0}
              x2={innerWidth}
              y1={yScale(t)}
              y2={yScale(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
          ))}

          {shadeNegative && zeroY < innerHeight && (
            <rect
              x={0}
              y={zeroY}
              width={innerWidth}
              height={Math.max(0, innerHeight - zeroY)}
              fill="var(--loss-text)"
              opacity={0.045}
            />
          )}

          {/* Zero line is the reference the eye needs on a P&L chart. */}
          <line x1={0} x2={innerWidth} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeWidth={1.5} />

          {placedMarkers.map((m, i) => (
            <g key={`${m.label}-${i}`}>
              <line
                x1={m.px}
                x2={m.px}
                y1={0}
                y2={innerHeight}
                stroke={m.emphasis ? 'var(--text-secondary)' : 'var(--axis)'}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text
                x={m.px + 4}
                y={m.labelY}
                fontSize={10}
                fill={m.emphasis ? 'var(--text-secondary)' : 'var(--text-muted)'}
              >
                {m.label}
              </text>
            </g>
          ))}

          {series.map((s, i) => {
            const color = SERIES_VARS[(s.colorIndex ?? i) % SERIES_VARS.length];
            const points = s.values.map((v, n) => ({ x: pixelXs[n], y: yScale(v) }));
            return (
              <path
                key={s.id}
                d={linePath(points)}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {showDirectLabels &&
            series.map((s, i) => {
              const last = s.values[s.values.length - 1];
              if (!Number.isFinite(last)) return null;
              const color = SERIES_VARS[(s.colorIndex ?? i) % SERIES_VARS.length];
              return (
                <g key={`lbl-${s.id}`}>
                  <circle
                    cx={innerWidth}
                    cy={yScale(last)}
                    r={3.5}
                    fill={color}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                </g>
              );
            })}

          {hover !== null && (
            <g>
              <line
                x1={pixelXs[hover]}
                x2={pixelXs[hover]}
                y1={0}
                y2={innerHeight}
                stroke="var(--text-muted)"
                strokeWidth={1}
              />
              {series.map((s, i) => {
                const color = SERIES_VARS[(s.colorIndex ?? i) % SERIES_VARS.length];
                return (
                  <circle
                    key={`h-${s.id}`}
                    cx={pixelXs[hover]}
                    cy={yScale(s.values[hover])}
                    r={4.5}
                    fill={color}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          )}

          {/* Axes drawn after the marks so the baseline reads as a frame. */}
          <line x1={0} x2={0} y1={0} y2={innerHeight} stroke="var(--axis)" strokeWidth={1} />

          {yTicks.map((t) => (
            <text
              key={`yt${t}`}
              x={-8}
              y={yScale(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatY(t)}
            </text>
          ))}

          {xTicks.map((t) => (
            <text
              key={`xt${t}`}
              x={xScale(t)}
              y={innerHeight + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatX(t)}
            </text>
          ))}

          {xLabel && (
            <text
              x={innerWidth / 2}
              y={innerHeight + 32}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-secondary)"
            >
              {xLabel}
            </text>
          )}

          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={handleMove}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'crosshair' }}
          />
        </g>
      </svg>

      {hover !== null && hoveredX !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(Math.max(0, pixelXs[hover] + M.left - 75), Math.max(0, width - 165)),
            top: M.top,
          }}
        >
          <div className="font-semibold mb-1 mono">{formatX(hoveredX)}</div>
          {series.map((s, i) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: SERIES_VARS[(s.colorIndex ?? i) % SERIES_VARS.length],
                    display: 'inline-block',
                  }}
                />
                {s.label}
              </span>
              <span className="mono font-medium">{formatY(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}

      {series.length >= 2 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 px-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {series.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1.5">
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 2.5,
                  borderRadius: 2,
                  background: SERIES_VARS[(s.colorIndex ?? i) % SERIES_VARS.length],
                  display: 'inline-block',
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
