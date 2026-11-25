import Link from "next/link";
import { FeedbackSummary } from "./feedback-summary";
import {
  RATING_LABELS,
  RECOMMENDATION_LABELS,
  canSeeOthersScorecards,
  type Recommendation,
} from "@/lib/scorecards";

export type ScorecardRow = {
  id: string;
  authorId: string;
  author: string;
  stageName: string;
  recommendation: Recommendation;
  ratings: Record<string, number>;
  summary: string | null;
  updatedAt: Date;
};

/** Scorecards on one application, with other people's hidden from interviewers until they submit. */
export function Scorecards({
  applicationId,
  rows,
  userId,
  managesHiring,
  attributes,
  summarizeAction,
}: {
  /** Present only when AI summaries are on and the viewer may see every scorecard. */
  summarizeAction?: () => Promise<{ text: string } | { error: string }>;
  applicationId: string;
  rows: ScorecardRow[];
  /** The job's current attributes, used to list ratings in the same order as the form. */
  attributes: string[];
  userId: string;
  managesHiring: boolean;
}) {
  const mine = rows.filter((r) => r.authorId === userId);
  const showAll = canSeeOthersScorecards({ managesHiring, hasSubmitted: mine.length > 0 });
  const visible = showAll ? rows : mine;
  const hidden = rows.length - visible.length;

  return (
    <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Scorecards ({rows.length})</h3>
        <Link href={`/applications/${applicationId}/scorecard`} className="link">
          {mine.length > 0 ? "Add or edit your scorecard" : "Submit scorecard"}
        </Link>
      </div>
      {hidden > 0 && (
        <p className="muted mt-1">
          {hidden} other scorecard{hidden === 1 ? " is" : "s are"} hidden until you submit yours, so earlier
          feedback doesn&apos;t sway you.
        </p>
      )}
      {summarizeAction && rows.length >= 2 && <FeedbackSummary action={summarizeAction} />}
      <ul className="mt-2 space-y-3">
        {visible.map((s) => (
          <li key={s.id}>
            <div>
              <span className="font-medium">{RECOMMENDATION_LABELS[s.recommendation]}</span>
              <span className="muted">
                {" "}
                · {s.author} · {s.stageName} · {s.updatedAt.toLocaleDateString()}
              </span>
            </div>
            {Object.keys(s.ratings).length > 0 && (
              <div className="muted text-xs">
                {orderRatings(s.ratings, attributes)
                  .map(([name, n]) => `${name}: ${n} ${RATING_LABELS[n] ?? ""}`.trim())
                  .join(" · ")}
              </div>
            )}
            {s.summary && <p className="mt-1 whitespace-pre-wrap">{s.summary}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Postgres jsonb doesn't keep key order, so sort ratings by the job's attribute order.
 * Ratings for attributes that were since renamed or removed go last.
 */
function orderRatings(ratings: Record<string, number>, attributes: string[]): [string, number][] {
  const rank = (name: string) => {
    const i = attributes.indexOf(name);
    return i === -1 ? attributes.length : i;
  };
  return Object.entries(ratings).sort(([a], [b]) => rank(a) - rank(b));
}
