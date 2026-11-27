import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/form";
import { isAiFeatureOn } from "@/lib/ai";
import { roleLabel } from "@/lib/permissions";
import { CURRENCIES, EMPLOYMENT_TYPES, PAY_PERIODS, PRIORITIES, WORKPLACE_TYPES, type JobDetails } from "@/lib/job-fields";
import { draftDescriptionAction } from "./actions";
import { AiDraftButton } from "./ai-draft-button";

// Stored choices come back from the database as plain strings.
type Loose<T> = { [K in keyof T]?: T[K] extends string | null ? string | null : T[K] };
type JobValues = Loose<JobDetails> & {
  title: string;
  department: string | null;
  team: string | null;
  location: string | null;
  region: string | null;
  headcount: number | null;
  description: string | null;
  status: "draft" | "open" | "closed";
};

function Select({
  id,
  label,
  options,
  defaultValue,
  blank = "Not set",
}: {
  id: string;
  label: string;
  options: Record<string, string> | readonly string[];
  defaultValue?: string | null;
  blank?: string | null;
}) {
  const entries = Array.isArray(options) ? options.map((o) => [o, o] as const) : Object.entries(options);
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} name={id} className="input" defaultValue={defaultValue ?? ""}>
        {blank !== null && <option value="">{blank}</option>}
        {entries.map(([value, text]) => (
          <option key={value} value={value}>{text}</option>
        ))}
      </select>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t pt-5 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border)" }}>
      <legend className="sr-only">{title}</legend>
      <div aria-hidden="true">
        <h2 className="card-title">{title}</h2>
        {note && <p className="card-note">{note}</p>}
      </div>
      {children}
    </fieldset>
  );
}

export async function JobForm({
  action,
  job,
  people,
  submitLabel,
  version,
}: {
  action: FormAction;
  job?: JobValues;
  /** Active users, for the hiring manager and recruiter pickers. */
  people: { id: string; name: string; role: string }[];
  submitLabel: string;
  /** Changes when the job is saved, so the fields show the saved values. */
  version?: string;
}) {
  const aiDrafts = await isAiFeatureOn("jobDescriptions");
  const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  return (
    <ActionForm action={action} resetKey={version} className="card space-y-6">
      <Section title="Basics" note="Only the title is required. Everything else can be filled in later.">
        <Field label="Title" name="title" required defaultValue={job?.title} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Department" name="department" defaultValue={job?.department} />
          <Field label="Team" name="team" defaultValue={job?.team} />
          <Select id="employmentType" label="Employment type" options={EMPLOYMENT_TYPES} defaultValue={job?.employmentType} />
          <Select id="workplaceType" label="Workplace" options={WORKPLACE_TYPES} defaultValue={job?.workplaceType} />
          <Field label="Location" name="location" placeholder="e.g. Remote (US)" defaultValue={job?.location} />
          <Field label="Region" name="region" placeholder="e.g. North America" defaultValue={job?.region} />
          <div>
            <label className="label" htmlFor="headcount">Openings</label>
            <input id="headcount" name="headcount" type="number" min="0" max="10000" step="1" defaultValue={job?.headcount ?? ""} className="input" />
          </div>
          <Field label="Requisition ID" name="requisitionId" placeholder="e.g. ENG-142" defaultValue={job?.requisitionId} />
        </div>
      </Section>

      <Section title="Compensation" note="Min, mid, and max of the band. The midpoint fills in from the range if left blank.">
        <div className="grid gap-4 sm:grid-cols-[8rem_10rem]">
          <Select id="compCurrency" label="Currency" options={CURRENCIES} defaultValue={job?.compCurrency ?? "USD"} blank={null} />
          <Select id="compPeriod" label="Pay period" options={{ year: "Yearly", hour: "Hourly" } satisfies Record<keyof typeof PAY_PERIODS, string>} defaultValue={job?.compPeriod ?? "year"} blank={null} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ["compMin", "Minimum", job?.compMin, "e.g. 140000"],
              ["compMid", "Midpoint", job?.compMid, "e.g. 160000"],
              ["compMax", "Maximum", job?.compMax, "e.g. 180000"],
            ] as const
          ).map(([name, label, value, placeholder]) => (
            <div key={name}>
              <label className="label" htmlFor={name}>{label}</label>
              <input id={name} name={name} inputMode="decimal" placeholder={placeholder} defaultValue={money(value)} className="input tabular-nums" />
            </div>
          ))}
        </div>
        <Field label="Equity" name="equityNote" placeholder="e.g. 0.05% – 0.1% over 4 years" defaultValue={job?.equityNote} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="compPublic" defaultChecked={job?.compPublic ?? false} />
          Show the pay range on the careers page
        </label>
      </Section>

      <Section title="People" note="They join the hiring team so they can see this job.">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["hiringManagerId", "Hiring manager", job?.hiringManagerId],
              ["recruiterId", "Recruiter", job?.recruiterId],
            ] as const
          ).map(([name, label, value]) => (
            <div key={name}>
              <label className="label" htmlFor={name}>{label}</label>
              <select id={name} name={name} className="input" defaultValue={value ?? ""}>
                <option value="">Not set</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({roleLabel(p.role)})</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Planning">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="targetStartDate">Target start date</label>
            <input id="targetStartDate" name="targetStartDate" type="date" defaultValue={job?.targetStartDate ?? ""} className="input" />
          </div>
          <Select id="priority" label="Priority" options={PRIORITIES} defaultValue={job?.priority} />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confidential" defaultChecked={job?.confidential ?? false} className="mt-1" />
          <span>
            Confidential
            <span className="muted block text-xs">Kept off the public careers page, even while open. Only its hiring team and people allowed to see confidential jobs can open it, its candidates, or its reports.</span>
          </span>
        </label>
        <div>
          <label className="label" htmlFor="internalNotes">Internal notes</label>
          <textarea id="internalNotes" name="internalNotes" rows={3} className="input" defaultValue={job?.internalNotes ?? ""} />
          <p className="muted mt-1 text-xs">Only your team sees these.</p>
        </div>
      </Section>

      <Section title="Job description">
        <div>
          <label className="label" htmlFor="description">Description</label>
          <textarea id="description" name="description" rows={10} className="input" defaultValue={job?.description ?? ""} />
          <p className="muted mt-1 text-xs">Plain text. Shown on the careers page.</p>
          {aiDrafts && <AiDraftButton action={draftDescriptionAction} />}
        </div>
        <div className="max-w-xs">
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" className="input" defaultValue={job?.status ?? "draft"}>
            <option value="draft">Draft (hidden)</option>
            <option value="open">Open (on careers page)</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </Section>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
