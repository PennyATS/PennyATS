import { loadApplication } from "@/lib/api/data";
import { ApiError, apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { getApplicationFor, stageBelongsToJob } from "@/lib/hiring";
import { moveStage } from "@/lib/pipeline";

export const POST = apiHandler(routes.moveApplication, async ({ user, params, body }) => {
  const app = await getApplicationFor(user, params.id);
  if (!app) throw notFound("Application");
  if (app.status !== "active") throw new ApiError("unprocessable", `The application is ${app.status}. Reopen it before moving it.`);
  if (app.stageId === body.stage_id) throw new ApiError("conflict", "The application is already in that stage.");
  if (!(await stageBelongsToJob(body.stage_id, app.jobId))) {
    throw new ApiError("unprocessable", "That stage isn't part of this application's job.");
  }
  if (!(await moveStage(user, app.id, body.stage_id))) throw new ApiError("conflict", "The application changed while moving it. Try again.");
  return loadApplication(user, app.id);
});
