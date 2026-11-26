import { ApiError, apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { prepareTemplateEmail } from "@/lib/candidate-email";
import { getApplicationFor } from "@/lib/hiring";
import { smtpConfigured } from "@/lib/smtp";

export const POST = apiHandler(routes.sendEmail, async ({ user, params, body }) => {
  const app = await getApplicationFor(user, params.id);
  if (!app) throw notFound("Application");
  if (!smtpConfigured()) throw new ApiError("unprocessable", "SMTP is not configured on this instance, so email can't be sent.");
  const attempt = await prepareTemplateEmail({ applicationId: app.id, templateId: body.template_id, actorId: user.id });
  if (attempt.status === "skipped") return { id: attempt.id, status: "skipped" as const, error: attempt.error };
  if (attempt.status !== "sending") throw notFound("Template");
  const outcome = await attempt.deliver();
  return { id: attempt.id, status: outcome, error: outcome === "failed" ? "SMTP did not confirm delivery." : null };
});
