import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { loadJob } from "@/lib/loaders";
import { canManageHiring } from "@/lib/permissions";
import { addCandidateAction } from "../../../candidates/actions";

export default async function AddCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(canManageHiring);
  const { job } = await loadJob(user, id);

  return (
    <>
      <h2 className="mb-1 text-xl font-semibold tracking-tight">Add candidate</h2>
      <p className="muted mb-6 text-sm">
        If someone with this email already exists, they&apos;re added to this job instead of duplicated.
      </p>
      <ActionForm action={addCandidateAction.bind(null, job.id)} className="card max-w-2xl space-y-4">
        <Field label="Full name" name="fullName" required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" name="email" type="email" />
          <Field label="Phone" name="phone" type="tel" />
          <Field label="LinkedIn URL" name="linkedinUrl" type="url" />
          <Field label="Location" name="location" />
        </div>
        <Field label="Source" name="source" placeholder="e.g. Referral, LinkedIn, Event" />
        <div>
          <label className="label" htmlFor="resume">
            Resume
          </label>
          <input id="resume" name="resume" type="file" accept=".pdf,.doc,.docx,.txt,.rtf" className="text-sm" />
        </div>
        <SubmitButton>Add to {job.title}</SubmitButton>
      </ActionForm>
    </>
  );
}
