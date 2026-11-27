import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness check for hosts (Render, Railway, load balancers). Public, and returns no data:
 * 200 when the app can reach the database, 503 when it can't.
 */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
