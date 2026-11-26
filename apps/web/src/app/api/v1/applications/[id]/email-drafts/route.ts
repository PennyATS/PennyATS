import { apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { renderTemplateEmail } from "@/lib/candidate-email";
import { getApplicationFor } from "@/lib/hiring";

export const POST = apiHandler(routes.draftEmail, async ({ user, params, body }) => {
  const app = await getApplicationFor(user, params.id);
  if (!app) throw notFound("Application");
  const draft = await renderTemplateEmail(app.id, body.template_id);
  if (!draft) throw notFound("Template");
  return {
    application_id: app.id,
    template_id: draft.template.id,
    to: draft.row.email,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
  };
});
