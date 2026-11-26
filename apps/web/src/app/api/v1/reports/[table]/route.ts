import { apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { loadReportInput } from "@/lib/report-data";
import { readPeriod, reportTables } from "@/lib/reports";

/** The same tables as the Reports page and its CSV downloads, built by reportTables(). */
export const GET = apiHandler(routes.getReport, async ({ params, query }) => {
  const data = reportTables(await loadReportInput(query.job_id ?? null, readPeriod(query.period)))[params.table];
  if (!data) throw notFound("Report for this selection");
  return { table: params.table, head: data.head, rows: data.rows };
});
