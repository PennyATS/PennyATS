"use client";

import { useEffect, useId, useState } from "react";
import { OTHER_COLOR, SERIES_COLORS, arcPath, donutArcs, niceTicks } from "@/lib/charts";

/* Small SVG charts with hover tooltips. No chart library. Text uses text colors, never series colors. */

const SINGLE = "var(--accent)";
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));

function Tooltip({ x, y, children }: { x: number | string; y: number; children: React.ReactNode }) {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: x, top: y - 8, background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}
    >
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: item.color }} />
          <span>{item.label}</span>
          {item.value && <span className="muted tabular-nums">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal bars, one series, ranked or in stage order. */
export function BarChart({ rows, unit = "" }: { rows: { label: string; value: number }[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <p className="muted text-sm">No data for this period.</p>;
  const max = Math.max(...niceTicks(Math.max(...rows.map((r) => r.value))));
  return (
    <ul className="space-y-1.5 text-sm" role="list">
      {rows.map((row, i) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(6rem,11rem)_1fr_3.5rem] items-center gap-3 rounded px-1 py-0.5"
          style={{ background: hover === i ? "var(--bg)" : undefined }}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          title={`${row.label}: ${fmt(row.value)}${unit}`}
        >
          <span className="truncate">{row.label}</span>
          <span className="h-3.5 overflow-hidden rounded-r" aria-hidden="true">
            <span
              className="block h-full rounded-r"
              style={{ width: `${max ? (row.value / max) * 100 : 0}%`, minWidth: row.value > 0 ? 3 : 0, background: SINGLE, opacity: hover === null || hover === i ? 1 : 0.55 }}
            />
          </span>
          <span className="text-right tabular-nums">
            {fmt(row.value)}
            {unit && <span className="muted">{unit}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal stacked bars: several series per row, with a legend. */
export function StackedBarChart({ rows, series }: { rows: { label: string; values: number[] }[]; series: string[] }) {
  const [hover, setHover] = useState<{ row: number; x: number; y: number } | null>(null);
  if (rows.length === 0) return <p className="muted text-sm">No data for this period.</p>;
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
  const colors = series.map((_, i) => SERIES_COLORS[i]);
  return (
    <div className="relative space-y-3">
      <Legend items={series.map((label, i) => ({ label, color: colors[i] }))} />
      <ul className="space-y-1.5 text-sm">
        {rows.map((row, r) => {
          const total = row.values.reduce((a, b) => a + b, 0);
          return (
            <li
              key={row.label}
              className="grid grid-cols-[minmax(6rem,11rem)_1fr_3rem] items-center gap-3"
              onMouseMove={(e) => {
                const box = (e.currentTarget.offsetParent as HTMLElement | null)?.getBoundingClientRect();
                if (box) setHover({ row: r, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <span className="truncate">{row.label}</span>
              <span className="flex h-3.5" style={{ width: `${(total / max) * 100}%` }} aria-hidden="true">
                {row.values.map((v, i) =>
                  v > 0 ? (
                    <span
                      key={i}
                      className="h-full first:rounded-l-none last:rounded-r"
                      style={{ flex: v, background: colors[i], borderRight: "2px solid var(--surface)" }}
                    />
                  ) : null,
                )}
              </span>
              <span className="text-right tabular-nums">{total}</span>
            </li>
          );
        })}
      </ul>
      {hover && (
        <Tooltip x={hover.x} y={hover.y}>
          <div className="font-medium">{rows[hover.row].label}</div>
          {series.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-sm" style={{ background: colors[i] }} />
              {s}: <span className="tabular-nums">{rows[hover.row].values[i]}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/** Donut (pie) for parts of a whole. Pass rows already folded to at most 8 slices. */
export function DonutChart({ rows, centerLabel }: { rows: { label: string; value: number }[]; centerLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <p className="muted text-sm">No data for this period.</p>;
  const total = rows.reduce((a, r) => a + r.value, 0);
  const arcs = donutArcs(rows.map((r) => r.value));
  const color = (i: number) => (rows[i].label === "Other" ? OTHER_COLOR : SERIES_COLORS[i]);
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  const shown = hover ?? null;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 160 160" className="size-44 shrink-0" role="img" aria-label={rows.map((r) => `${r.label} ${r.value}`).join(", ")}>
        {arcs.map((a, i) =>
          a.share > 0 ? (
            <path
              key={rows[i].label}
              d={arcPath(80, 80, hover === i ? 76 : 72, 46, a.start, a.end)}
              fill={color(i)}
              stroke="var(--surface)"
              strokeWidth={2}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${rows[i].label}: ${rows[i].value} (${pct(rows[i].value)})`}</title>
            </path>
          ) : null,
        )}
        <text x="80" y="78" textAnchor="middle" className="fill-current text-[20px] font-semibold tabular-nums">
          {shown === null ? total : rows[shown].value}
        </text>
        <text x="80" y="96" textAnchor="middle" className="text-[9px]" fill="var(--muted)">
          {shown === null ? centerLabel : pct(rows[shown].value)}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-sm" aria-label="Legend">
        {rows.map((r, i) => (
          <li
            key={r.label}
            className="flex items-center gap-2 rounded px-1"
            style={{ background: hover === i ? "var(--bg)" : undefined }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: color(i) }} />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="tabular-nums">{r.value}</span>
            <span className="muted w-10 text-right tabular-nums">{pct(r.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Line chart over ordered labels (e.g. months). One y-axis; several series share it. */
export function LineChart({
  labels,
  series,
  height = 220,
  width = 640,
  color,
}: {
  labels: string[];
  series: { name: string; values: number[] }[];
  height?: number;
  /** Drawing width; smaller keeps axis text legible in narrow layouts. */
  width?: number;
  /** One series only: its color (defaults to the first categorical slot). */
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  if (labels.length === 0) return <p className="muted text-sm">No data for this period.</p>;
  const W = width;
  const H = height;
  const stroke = (i: number) => (series.length === 1 && color ? color : SERIES_COLORS[i]);
  const pad = { l: 36, r: 16, t: 12, b: 26 };
  const ticks = niceTicks(Math.max(1, ...series.flatMap((s) => s.values)));
  const top = ticks[ticks.length - 1];
  const x = (i: number) => pad.l + (labels.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (labels.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const every = Math.ceil(labels.length / 8);
  return (
    <div className="relative space-y-3">
      {series.length > 1 && <Legend items={series.map((s, i) => ({ label: s.name, color: SERIES_COLORS[i] }))} />}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={`${id}-desc`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          const step = labels.length > 1 ? (W - pad.l - pad.r) / (labels.length - 1) : 1;
          setHover(Math.max(0, Math.min(labels.length - 1, Math.round((px - pad.l) / step))));
        }}
      >
        <desc id={`${id}-desc`}>
          {series.map((s) => `${s.name}: ${s.values.join(", ")}`).join(". ")}
        </desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="text-[10px]" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === labels.length - 1 ? (
            <text key={l} x={x(i)} y={H - 8} textAnchor="middle" className="text-[10px]" fill="var(--muted)">{l}</text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeDasharray="3 3" />}
        {series.map((s, si) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={stroke(si)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            />
            {hover !== null && <circle cx={x(hover)} cy={y(s.values[hover])} r={4} fill={stroke(si)} stroke="var(--surface)" strokeWidth={2} />}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={`${(x(hover) / W) * 100}%`} y={40}>
          <div className="font-medium">{labels[hover]}</div>
          {series.map((s, i) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-sm" style={{ background: stroke(i) }} />
              {s.name}: <span className="tabular-nums">{s.values[hover]}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/** Graph / table switch for a report section. Remembers the choice per section in this browser. */
export function ChartToggle({ id, graph, table }: { id: string; graph: React.ReactNode; table: React.ReactNode }) {
  const [mode, setMode] = useState<"graph" | "table">("graph");
  const key = `pennyats:report-view:${id}`;
  useEffect(() => {
    try {
      if (localStorage.getItem(key) === "table") setMode("table");
    } catch { /* Storage is optional. */ }
  }, [key]);
  const pick = (next: "graph" | "table") => {
    setMode(next);
    try {
      localStorage.setItem(key, next);
    } catch { /* Storage is optional. */ }
  };
  const icon = (which: "graph" | "table") => (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {which === "graph" ? <path d="M4 20V4M4 20h16M8 16v-4m4 4V8m4 8v-6" /> : <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></>}
    </svg>
  );
  return (
    <div>
      <div role="group" aria-label="View as" className="absolute right-6 top-5 flex overflow-hidden rounded-md border" style={{ borderColor: "var(--border)" }}>
        {(["graph", "table"] as const).map((which) => (
          <button
            key={which}
            type="button"
            aria-pressed={mode === which}
            aria-label={which === "graph" ? "Show graph" : "Show table"}
            title={which === "graph" ? "Graph" : "Table"}
            onClick={() => pick(which)}
            className="flex size-8 items-center justify-center"
            style={{ background: mode === which ? "#e0f1e6" : "var(--surface)", color: mode === which ? "#14533b" : "var(--muted)" }}
          >
            {icon(which)}
          </button>
        ))}
      </div>
      {mode === "graph" ? graph : table}
    </div>
  );
}
