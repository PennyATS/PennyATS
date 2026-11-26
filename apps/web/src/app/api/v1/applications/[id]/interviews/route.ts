import { listInterviews } from "@/lib/api/data";
import { apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { getApplicationFor } from "@/lib/hiring";
import { addInterview } from "@/lib/pipeline";

export const GET = apiHandler(routes.listInterviews, async ({ user, params }) => {
  const app = await getApplicationFor(user, params.id);
  if (!app) throw notFound("Application");
  return { data: await listInterviews(app.id) };
});

export const POST = apiHandler(routes.createInterview, async ({ user, params, body }) => {
  const app = await getApplicationFor(user, params.id);
  if (!app) throw notFound("Application");
  const id = await addInterview(user, app, {
    name: body.name,
    durationMinutes: body.duration_minutes,
    interviewerIds: body.interviewer_ids,
  });
  const [interview] = await listInterviews(app.id, id);
  return interview;
});
