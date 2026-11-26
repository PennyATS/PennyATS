import { loadCandidate } from "@/lib/api/data";
import { apiHandler, notFound } from "@/lib/api/handler";
import { keyLabel } from "@/lib/api/keys";
import { routes } from "@/lib/api/routes";
import { canSeeCandidate } from "@/lib/hiring";
import { deleteCandidates } from "@/lib/privacy";

export const GET = apiHandler(routes.getCandidate, async ({ user, params }) => loadCandidate(user, params.id));

export const DELETE = apiHandler(routes.deleteCandidate, async ({ user, key, actorType, params }) => {
  if (!(await canSeeCandidate(user, params.id))) throw notFound("Candidate");
  // Writes the candidate_deleted audit entry with a count only, never the person's details.
  const count = await deleteCandidates([params.id], {
    actorId: user.id,
    reason: "Deleted through the API",
    action: "candidate_deleted",
    via: { actorType, apiKeyId: key.id, keyLabel: keyLabel(key.prefix) },
  });
  if (count === 0) throw notFound("Candidate");
  return { deleted: true as const };
});
