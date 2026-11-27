/**
 * Careers-page completion funnel: job views, apply starts, and submits.
 * Pure summarizers live here so reports and unit tests share one definition.
 * Recording goes through recordCareersFunnelEvent (no PII).
 */

import { careersFunnelEvents } from "@pennyats/db";
import { db } from "./db";

export const CAREERS_FUNNEL_KINDS = ["view", "start", "submit"] as const;
export type CareersFunnelKind = (typeof CAREERS_FUNNEL_KINDS)[number];

export type CareersFunnelCounts = { views: number; starts: number; submits: number };

export type CareersFunnelRow = { label: string; count: number; percent: number };

export function isCareersFunnelKind(value: string): value is CareersFunnelKind {
  return (CAREERS_FUNNEL_KINDS as readonly string[]).includes(value);
}

/** Views → starts → submits, with percent of views (0 when there were none). */
export function careersApplyFunnel(counts: CareersFunnelCounts): CareersFunnelRow[] {
  const base = counts.views;
  const pct = (n: number) => (base === 0 ? 0 : Math.round((n / base) * 100));
  return [
    { label: "Views", count: counts.views, percent: base === 0 ? 0 : 100 },
    { label: "Starts", count: counts.starts, percent: pct(counts.starts) },
    { label: "Submits", count: counts.submits, percent: pct(counts.submits) },
  ];
}

export function emptyCareersFunnelCounts(): CareersFunnelCounts {
  return { views: 0, starts: 0, submits: 0 };
}

/** Count rows of each kind into a CareersFunnelCounts object. */
export function tallyCareersFunnel(rows: { kind: string; count: number }[]): CareersFunnelCounts {
  const out = emptyCareersFunnelCounts();
  for (const row of rows) {
    if (row.kind === "view") out.views += row.count;
    else if (row.kind === "start") out.starts += row.count;
    else if (row.kind === "submit") out.submits += row.count;
  }
  return out;
}

/** Insert one anonymous funnel event. Caller must only use this for open public jobs. */
export async function recordCareersFunnelEvent(jobId: string, kind: CareersFunnelKind): Promise<void> {
  await db().insert(careersFunnelEvents).values({ jobId, kind });
}
