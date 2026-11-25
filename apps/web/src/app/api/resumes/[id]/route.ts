import { eq } from "drizzle-orm";
import { candidates } from "@pennyats/db";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeCandidate } from "@/lib/hiring";
import { storage } from "@/lib/storage";
import { isUuid } from "@/lib/validation";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
  rtf: "application/rtf",
};

/** Download a candidate's resume. Signed-in users with access to the candidate only. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  if (!isUuid(id) || !(await canSeeCandidate(user, id))) return new Response("Not found", { status: 404 });

  const [candidate] = await db()
    .select({ key: candidates.resumeKey, name: candidates.resumeName })
    .from(candidates)
    .where(eq(candidates.id, id));
  if (!candidate?.key) return new Response("Not found", { status: 404 });

  const bytes = await storage.get(candidate.key);
  if (!bytes) return new Response("Not found", { status: 404 });

  const ext = candidate.key.split(".").pop() ?? "";
  const fileName = (candidate.name ?? `resume.${ext}`).replace(/["\r\n]/g, "");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      // Always download rather than render inline, so an uploaded file can't run in our origin.
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
