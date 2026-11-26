import { loadJob, serializeStage } from "@/lib/api/data";
import { apiHandler } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { appendStage } from "@/lib/jobs";

export const GET = apiHandler(routes.listStages, async ({ user, params }) => {
  const job = await loadJob(user, params.id);
  return { data: job.stages };
});

export const POST = apiHandler(routes.createStage, async ({ user, params, body }) => {
  await loadJob(user, params.id);
  return serializeStage(await appendStage(params.id, body.name));
});
