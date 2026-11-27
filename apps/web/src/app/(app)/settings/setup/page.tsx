import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { checklistSummary, type StepStatus } from "@/lib/setup-checklist";
import { loadChecklist } from "@/lib/setup-checklist-data";
import {
  setChecklistDismissedAction,
  setStepSkippedAction,
  testAiStepAction,
  testCalendarStepAction,
  testEmailStepAction,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<StepStatus, string> = { done: "Done", skipped: "Skipped", todo: "To do" };
const TESTS = { email: testEmailStepAction, calendar: testCalendarStepAction, ai: testAiStepAction } as const;

export default async function SetupChecklistPage() {
  const user = await requireUser("settings.manage");
  const { steps, state } = await loadChecklist(user.id);
  const summary = checklistSummary(steps);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Setup checklist</h1>
      <p className="muted mt-1 text-sm">
        A few steps to get your workspace ready. Skip anything you don&apos;t need yet; you can come back here any time
        from Admin, Setup checklist. {summary.done} of {summary.total} done.
      </p>

      <ol className="mt-6 space-y-4">
        {steps.map((step, i) => {
          const test = step.testable ? TESTS[step.id as keyof typeof TESTS] : null;
          return (
            <li key={step.id} className="card space-y-3 text-sm" aria-labelledby={`step-${step.id}`}>
              <div className="flex items-start justify-between gap-3">
                <h2 id={`step-${step.id}`} className="font-semibold">
                  {i + 1}. {step.title}
                  {step.optional && <span className="muted font-normal"> (optional)</span>}
                </h2>
                <span className="muted shrink-0" data-testid={`status-${step.id}`}>
                  {STATUS_LABEL[step.status]}
                </span>
              </div>
              <p>{step.why}</p>
              <p className="muted">{step.how}</p>
              <div className="flex flex-wrap items-start gap-2">
                <Link className="btn btn-secondary" href={step.href}>
                  {step.linkLabel}
                </Link>
                {step.status === "todo" && (
                  <form action={setStepSkippedAction.bind(null, step.id, true)}>
                    <button type="submit" className="btn btn-secondary" aria-label={`Skip: ${step.title}`}>
                      Skip for now
                    </button>
                  </form>
                )}
                {step.status === "skipped" && (
                  <form action={setStepSkippedAction.bind(null, step.id, false)}>
                    <button type="submit" className="btn btn-secondary" aria-label={`Undo skip: ${step.title}`}>
                      Undo skip
                    </button>
                  </form>
                )}
              </div>
              {test && (
                <ActionForm action={test} className="space-y-2">
                  <SubmitButton variant="secondary">Test {step.id === "ai" ? "AI" : step.id}</SubmitButton>
                </ActionForm>
              )}
            </li>
          );
        })}
      </ol>

      <form action={setChecklistDismissedAction.bind(null, !state.dismissed)} className="mt-6">
        <button type="submit" className="btn btn-secondary">
          {state.dismissed ? "Show this checklist on Home again" : "Hide this checklist from Home"}
        </button>
      </form>
    </div>
  );
}
