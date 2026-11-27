import { loadInterview } from "@/lib/api/data";
import { ApiError, apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { scheduleInterview, setInterviewState } from "@/lib/interview-ops";

export const GET = apiHandler(routes.getInterview, async ({ user, params }) => loadInterview(user, params.id));

export const PATCH = apiHandler(routes.updateInterview, async ({ user, params, body }) => {
  await loadInterview(user, params.id);
  if (body.scheduled_at !== undefined) {
    const result = await scheduleInterview(user, params.id, {
      at: new Date(body.scheduled_at),
      timeZone: body.time_zone!,
      meetingLocation: body.meeting_location?.trim() || null,
    });
    if (!result.ok) {
      if (result.code === "not_found") throw notFound("Interview");
      throw new ApiError(result.code === "conflict" ? "conflict" : result.code === "closed" ? "unprocessable" : "invalid_request", result.error);
    }
  }
  if (body.state !== undefined && !(await setInterviewState(user, params.id, body.state))) throw notFound("Interview");
  return loadInterview(user, params.id);
});
