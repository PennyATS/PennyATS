import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { LocalTime, ScheduleInput } from "@/components/local-time";
import { STATUS_LABELS, type InterviewStatus } from "@/lib/interviews";
import {
  addInterviewAction,
  createPlannedInterviewsAction,
  scheduleInterviewAction,
  setInterviewStateAction,
  setInterviewersAction,
} from "../interview-actions";

export type InterviewRow = {
  id: string;
  name: string;
  stageName: string;
  durationMinutes: number;
  scheduledAt: Date | null;
  cancelledAt: Date | null;
  status: InterviewStatus;
  overdue: boolean;
  interviewers: { id: string; name: string; submitted: boolean }[];
};

const STATUS_COLORS: Record<InterviewStatus, string> = {
  to_schedule: "var(--muted)",
  scheduled: "var(--accent)",
  feedback_due: "#d97706",
  complete: "#16a34a",
  cancelled: "var(--muted)",
};

/** The interview loop for one application, shown on the candidate profile. */
export function Interviews({
  applicationId,
  rows,
  userId,
  manage,
  people,
  planAvailable,
  active,
}: {
  applicationId: string;
  rows: InterviewRow[];
  userId: string;
  manage: boolean;
  /** Active users who can be assigned. */
  people: { id: string; name: string }[];
  /** The job's plan has interviews for this application's stage that it doesn't have yet. */
  planAvailable: boolean;
  active: boolean;
}) {
  if (rows.length === 0 && !manage) return null;

  return (
    <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <h3 className="font-medium">Interviews ({rows.filter((r) => r.status !== "cancelled").length})</h3>
      {rows.length === 0 && <p className="muted mt-1">No interviews yet.</p>}

      {manage && active && planAvailable && (
        <form action={createPlannedInterviewsAction.bind(null, applicationId)} className="mt-2">
          <button type="submit" className="btn btn-secondary">
            Set up interviews from the plan
          </button>
        </form>
      )}

      <ul className="card-rows mt-2">
        {rows.map((r) => {
          const mine = r.interviewers.find((i) => i.id === userId);
          return (
            <li key={r.id} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={r.status === "cancelled" ? "muted line-through" : "font-medium"}>
                  {r.name} <span className="muted font-normal">· {r.stageName} · {r.durationMinutes} min</span>
                </p>
                <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: STATUS_COLORS[r.status] }}>
                  <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: STATUS_COLORS[r.status] }} />
                  {r.overdue ? "Feedback overdue" : STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="muted text-xs">
                {r.scheduledAt ? <LocalTime iso={r.scheduledAt.toISOString()} /> : "Not scheduled"}
                {" · "}
                {r.interviewers.length
                  ? r.interviewers.map((i, n) => (
                      <span key={i.id}>
                        {n > 0 && ", "}
                        {i.name}
                        {i.submitted ? " (submitted)" : ""}
                      </span>
                    ))
                  : "No interviewers assigned"}
              </p>

              {r.status !== "cancelled" && (mine || manage) && (
                <div className="flex flex-wrap items-center gap-2">
                  {(mine || manage) && (
                    <Link href={`/applications/${applicationId}/scorecard?interview=${r.id}`} className="btn btn-secondary">
                      {mine?.submitted ? "Edit your scorecard" : "Submit scorecard"}
                    </Link>
                  )}
                  {manage && r.status !== "complete" && (
                    <form action={setInterviewStateAction.bind(null, r.id, "complete")}>
                      <button type="submit" className="btn btn-secondary">
                        Mark as held
                      </button>
                    </form>
                  )}
                  {manage && (
                    <form action={setInterviewStateAction.bind(null, r.id, "cancel")}>
                      <button type="submit" className="btn btn-secondary">
                        Cancel interview
                      </button>
                    </form>
                  )}
                </div>
              )}
              {r.status === "cancelled" && manage && (
                <form action={setInterviewStateAction.bind(null, r.id, "restore")}>
                  <button type="submit" className="link text-xs">
                    Restore
                  </button>
                </form>
              )}

              {manage && r.status !== "cancelled" && (
                <details className="text-sm">
                  <summary className="link w-fit cursor-pointer text-xs">Schedule or change interviewers</summary>
                  <div className="inset mt-2 space-y-4">
                    <ActionForm
                      action={scheduleInterviewAction.bind(null, r.id)}
                      resetKey={r.scheduledAt?.toISOString() ?? "none"}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <div>
                        <label className="label" htmlFor={`when-${r.id}`}>
                          Date and time
                        </label>
                        <ScheduleInput id={`when-${r.id}`} value={r.scheduledAt?.toISOString() ?? null} />
                      </div>
                      <SubmitButton variant="secondary">Save time</SubmitButton>
                    </ActionForm>
                    <ActionForm
                      action={setInterviewersAction.bind(null, r.id)}
                      resetKey={r.interviewers.map((i) => i.id).join(",")}
                      className="space-y-2"
                    >
                      <fieldset>
                        <legend className="label">Interviewers</legend>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {people.map((p) => (
                            <label key={p.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                name="interviewerIds"
                                value={p.id}
                                defaultChecked={r.interviewers.some((i) => i.id === p.id)}
                              />
                              {p.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <SubmitButton variant="secondary">Save interviewers</SubmitButton>
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>

      {manage && active && (
        <details className="mt-3 text-sm">
          <summary className="link w-fit cursor-pointer text-xs">Add a one-off interview</summary>
          <ActionForm action={addInterviewAction.bind(null, applicationId)} className="inset mt-2 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Field label="Interview name" name="name" required placeholder="e.g. Founder chat" />
              <Field label="Minutes" name="durationMinutes" type="number" required defaultValue="45" />
            </div>
            <div>
              <label className="label" htmlFor={`new-when-${applicationId}`}>
                Date and time (optional)
              </label>
              <ScheduleInput id={`new-when-${applicationId}`} value={null} />
            </div>
            <fieldset>
              <legend className="label">Interviewers</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2">
                    <input type="checkbox" name="interviewerIds" value={p.id} />
                    {p.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <SubmitButton variant="secondary">Add interview</SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
