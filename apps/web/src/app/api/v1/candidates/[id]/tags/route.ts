import { loadCandidate } from "@/lib/api/data";
import { ApiError, apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { canSeeCandidate } from "@/lib/hiring";
import { addTags } from "@/lib/pipeline";
import { mergeTags } from "@/lib/candidate-review";

export const GET = apiHandler(routes.listTags, async ({ user, params }) => {
  const candidate = await loadCandidate(user, params.id);
  return { data: candidate.tags };
});

export const POST = apiHandler(routes.addTags, async ({ user, params, body }) => {
  if (!(await canSeeCandidate(user, params.id))) throw notFound("Candidate");
  if (mergeTags([], body.tags).length === 0) throw new ApiError("invalid_request", "None of the tags has any letters or digits.");
  const tags = await addTags(params.id, body.tags);
  if (!tags) throw notFound("Candidate");
  return { data: tags };
});
