import { and, eq } from "drizzle-orm";
import { jobs } from "@pennyats/db";
import { isCareersFunnelKind, recordCareersFunnelEvent } from "@/lib/careers-funnel";
import { db } from "@/lib/db";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { isUuid } from "@/lib/validation";

/** Public: record an apply-form "start" (first focus). Views and submits are recorded server-side. */
const limiter = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });

export async function POST(request: Request) {
  if (!limiter(await clientIp())) {
    return Response.json({ ok: false }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const jobId = typeof body === "object" && body && "jobId" in body ? String((body as { jobId: unknown }).jobId) : "";
  const kind = typeof body === "object" && body && "kind" in body ? String((body as { kind: unknown }).kind) : "";
  // Only "start" is accepted from the browser; views/submits come from the server.
  if (!isUuid(jobId) || kind !== "start" || !isCareersFunnelKind(kind)) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const [job] = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "open"), eq(jobs.confidential, false)));
  if (!job) return Response.json({ ok: false }, { status: 404 });

  await recordCareersFunnelEvent(job.id, "start");
  return Response.json({ ok: true });
}
