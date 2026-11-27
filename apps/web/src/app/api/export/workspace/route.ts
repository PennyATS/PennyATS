import { exportWorkspace } from "@pennyats/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/privacy";

/** Everything in the PennyATS open data format (docs/schema), for backups and moving data. Admin only. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !can(user, "settings.manage")) return new Response("Not found", { status: 404 });

  const doc = await exportWorkspace(db());
  await logAudit("workspace_exported", user.id, { via: "download", candidates: doc.candidates.length, schema_version: doc.schema_version });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pennyats-export-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
