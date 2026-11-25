import { getCurrentUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { canManageHiring } from "@/lib/permissions";
import { loadReportInput } from "@/lib/report-data";
import { REPORT_TABLES, readPeriod, reportTables, type ReportTableId } from "@/lib/reports";
import { isUuid } from "@/lib/validation";

/** One report table as CSV, with the same job and period filters as the page. Admins and recruiters. */
export async function GET(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const user = await getCurrentUser();
  if (!user || !canManageHiring(user.role) || !REPORT_TABLES.includes(table as ReportTableId)) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const job = url.searchParams.get("job");
  const jobId = job && isUuid(job) ? job : null;
  const period = readPeriod(url.searchParams.get("period") ?? undefined);

  const data = reportTables(await loadReportInput(jobId, period))[table as ReportTableId];
  if (!data) return new Response("Not available for this selection", { status: 404 });

  return new Response(toCsv(data.head, data.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pennyats-${table}-${period === "all" ? "all-time" : `last-${period}-days`}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
