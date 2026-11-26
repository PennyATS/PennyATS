import { loadApplication } from "@/lib/api/data";
import { ApiError, apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { REJECTION_REASONS, rejectionReasonText } from "@/lib/candidate-review";
import { getApplicationFor } from "@/lib/hiring";
import { setApplicationStatus } from "@/lib/pipeline";

export const POST = apiHandler(routes.setApplicationStatus, async ({ user, params, body }) => {
  const app = await getApplicationFor(user, params.id);
  if (!app) throw notFound("Application");
  if (app.status === body.status) throw new ApiError("conflict", `The application is already ${body.status}.`);
  // Same rules as the app: rejections use the standard list, other closes keep free text.
  const reason =
    body.status === "rejected"
      ? rejectionReasonText(body.reason?.trim() ?? null, body.note ?? null)
      : body.status === "active"
        ? null
        : body.reason?.trim() || null;
  if (body.status === "rejected" && !reason) {
    throw new ApiError("invalid_request", "Rejecting needs a standard reason.", { allowed_reasons: REJECTION_REASONS });
  }
  if (!(await setApplicationStatus(user, app.id, body.status, reason))) {
    throw new ApiError("conflict", "The application changed. Try again.");
  }
  return loadApplication(user, app.id);
});
