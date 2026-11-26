/** Chart math, kept pure so it can be tested. Rendering is in components/charts.tsx. */

/**
 * Categorical colors in fixed order (validated for color-vision deficiency on a light
 * surface). Series take slots in order and are never cycled: past 8, fold into "Other".
 */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] as const;
export const OTHER_COLOR = "#a3a29c";

/** Round axis maximum and tick values: 0, step, 2·step… covering `max`. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(10)));
  return ticks;
}

/** Keep the biggest `keep` slices and sum the rest into "Other" (only when there's more than one left over). */
export function foldOther<T extends { label: string; value: number }>(rows: T[], keep = 7): { label: string; value: number }[] {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= keep + 1) return sorted.map(({ label, value }) => ({ label, value }));
  const head = sorted.slice(0, keep).map(({ label, value }) => ({ label, value }));
  return [...head, { label: "Other", value: sorted.slice(keep).reduce((sum, r) => sum + r.value, 0) }];
}

export type Arc = { start: number; end: number; share: number };

/** Angles (radians, clockwise from 12 o'clock) for each value's slice. */
export function donutArcs(values: number[]): Arc[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total === 0) return values.map(() => ({ start: 0, end: 0, share: 0 }));
  let at = 0;
  return values.map((v) => {
    const share = Math.max(0, v) / total;
    const arc = { start: at, end: at + share * 2 * Math.PI, share };
    at = arc.end;
    return arc;
  });
}

/** SVG path for a donut slice centered at (cx, cy). */
export function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  // A full circle can't be one arc; nudge it just short.
  const sweep = Math.min(end - start, 2 * Math.PI - 1e-4);
  const e = start + sweep;
  const pt = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${pt(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${pt(outer, e)} L ${pt(inner, e)} A ${inner} ${inner} 0 ${large} 0 ${pt(inner, start)} Z`;
}

/** "2026-03" style month keys from the first to the last date, inclusive, with no gaps. */
export function monthRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  const endKey = to.getUTCFullYear() * 12 + to.getUTCMonth();
  while (y * 12 + m <= endKey && out.length < 240) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-03" → "Mar 26". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${String(y).slice(2)}`;
}
