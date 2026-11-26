import { eq } from "drizzle-orm";
import { scorecards, users } from "@pennyats/db";
import { db } from "@/lib/db";
import { listScorecards, serializeScorecard } from "@/lib/api/data";
import { ApiError, apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { getApplicationFor } from "@/lib/hiring";
import { submitScorecard } from "@/lib/pipeline";
import { loadScorecardContext } from "@/lib/scorecard-context";
import { parseScorecard } from "@/lib/scorecards";

export const GET = apiHandler(routes.listScorecards, async ({ user, params }) => listScorecards(user, params.id));

export const POST = apiHandler(routes.submitScorecard, async ({ user, params, body }) => {
  const ctx = await loadScorecardContext(user, params.id, body.interview_id ?? null);
  if (!ctx) {
    if (!(await getApplicationFor(user, params.id))) throw notFound("Application");
    throw new ApiError(
      "unprocessable",
      "The key's user can't submit a scorecard for this interview. They must be one of its interviewers, and it can't be cancelled.",
    );
  }
  const unknown = Object.keys(body.ratings).filter((name) => !ctx.attributes.includes(name));
  if (unknown.length) {
    throw new ApiError("invalid_request", "Ratings must use this scorecard's attributes.", { unknown, attributes: ctx.attributes });
  }
  // Built the way the form sends it, so the app's own parser applies the same rules.
  const form = new FormData();
  ctx.attributes.forEach((name, i) => {
    if (body.ratings[name] !== undefined) form.set(`rating-${i}`, String(body.ratings[name]));
  });
  form.set("recommendation", body.recommendation);
  if (body.summary) form.set("summary", body.summary);
  const parsed = parseScorecard(form, ctx.attributes);
  if (!parsed.ok) throw new ApiError("invalid_request", parsed.error);

  const id = await submitScorecard(user, ctx, parsed.value);
  const [row] = await db()
    .select({ card: scorecards, author: users.name })
    .from(scorecards)
    .innerJoin(users, eq(users.id, scorecards.authorId))
    .where(eq(scorecards.id, id));
  return serializeScorecard(row.card, row.author);
});
