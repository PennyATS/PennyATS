import { getCurrentUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { exportCandidate, logAudit } from "@/lib/privacy";
import { isUuid } from "@/lib/validation";

/** Download everything stored about one candidate as JSON, for a data access request. Admin only. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !canManageUsers(user.role) || !isUuid(id)) return new Response("Not found", { status: 404 });

  const data = await exportCandidate(id);
  if (!data) return new Response("Not found", { status: 404 });
  await logAudit("candidate_exported", user.id);

  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="candidate-export-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
