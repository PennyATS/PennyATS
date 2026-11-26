import { apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { canSeeCandidate } from "@/lib/hiring";
import { removeTag } from "@/lib/pipeline";

export const DELETE = apiHandler(routes.removeTag, async ({ user, params }) => {
  if (!(await canSeeCandidate(user, params.id))) throw notFound("Candidate");
  const tags = await removeTag(params.id, params.tag);
  if (!tags) throw notFound("Candidate");
  return { data: tags };
});
