import { requireUser } from "@/lib/auth";
import { canManageHiring } from "@/lib/permissions";
import { createJobAction } from "../actions";
import { JobForm } from "../job-form";

export default async function NewJobPage() {
  await requireUser(canManageHiring);
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New job</h1>
      <JobForm action={createJobAction} submitLabel="Create job" />
      <p className="muted mt-3 text-sm">
        New jobs start with the default stages. You can change them after creating the job.
      </p>
    </>
  );
}
