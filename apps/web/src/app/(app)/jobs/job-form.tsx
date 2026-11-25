import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/form";

type JobValues = {
  title: string;
  department: string | null;
  location: string | null;
  description: string | null;
  status: "draft" | "open" | "closed";
};

export function JobForm({
  action,
  job,
  submitLabel,
}: {
  action: FormAction;
  job?: JobValues;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="card max-w-2xl space-y-4">
      <Field label="Title" name="title" required defaultValue={job?.title} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Department" name="department" defaultValue={job?.department} />
        <Field label="Location" name="location" placeholder="e.g. Remote (US)" defaultValue={job?.location} />
      </div>
      <div>
        <label className="label" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={10}
          className="input"
          defaultValue={job?.description ?? ""}
        />
        <p className="muted mt-1 text-xs">Plain text. Shown on the careers page.</p>
      </div>
      <div className="max-w-xs">
        <label className="label" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" className="input" defaultValue={job?.status ?? "draft"}>
          <option value="draft">Draft (hidden)</option>
          <option value="open">Open (on careers page)</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
