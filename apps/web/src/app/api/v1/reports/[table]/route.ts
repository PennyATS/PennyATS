import { apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { loadReportInput } from "@/lib/report-data";
import { reportJobIds } from "@/lib/hiring";
import { readPeriod, reportTables } from "@/lib/reports";

/** The same tables as the Reports page and its CSV downloads, built by reportTables(). */
export const GET = apiHandler(routes.getReport, async ({ params, query, user }) => {
  const data = reportTables(await loadReportInput(query.job_id ?? null, readPeriod(query.period), await reportJobIds(user)))[params.table];
  if (!data) throw notFound("Report for this selection");
  return { table: params.table, head: data.head, rows: data.rows };
});
