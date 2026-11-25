import { ActionForm, Field, SubmitButton } from "@/components/form";
import { emailTemplates } from "@pennyats/db";
import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/permissions";
import { smtpConfigured } from "@/lib/smtp";
import { deleteEmailTemplateAction, saveEmailTemplateAction, testSmtpAction } from "./actions";

export default async function EmailSettingsPage() {
  await requireUser(canManageUsers);
  const configured = smtpConfigured();
  const templates = await db().select().from(emailTemplates).orderBy(asc(emailTemplates.name));
  return <div className="max-w-2xl">
    <h1 className="text-2xl font-semibold tracking-tight">Email delivery</h1>
    <p className="muted mt-1 text-sm">PennyATS uses your SMTP server for scheduling links, reminders, team invites, password resets, and candidate messages. Manual link copying works without email.</p>
    <section className="card mt-6 space-y-4 text-sm">
      <h2 className="font-semibold">SMTP status</h2>
      <p>{configured ? "Configured" : "Not configured"}</p>
      <p className="muted">Set SMTP_HOST, SMTP_PORT, SMTP_FROM, and optionally SMTP_USER and SMTP_PASSWORD in the server environment. Port 465 uses TLS; other ports require STARTTLS.</p>
      {configured && <ActionForm action={testSmtpAction}><SubmitButton variant="secondary">Test SMTP connection</SubmitButton></ActionForm>}
    </section>
    <h2 className="mt-8 text-lg font-semibold">Candidate email templates</h2>
    <p className="muted mt-1 text-sm">Use {"{{candidate_name}}"} and {"{{job_title}}"} in subjects or bodies. Recruiters choose a template from the candidate profile.</p>
    {templates.map((template) => <section key={template.id} className="card mt-4">
      <ActionForm action={saveEmailTemplateAction.bind(null, template.id)} className="space-y-3">
        <Field id={`name-${template.id}`} label="Name" name="name" defaultValue={template.name} required />
        <Field id={`subject-${template.id}`} label="Subject" name="subject" defaultValue={template.subject} required />
        <div><label className="label" htmlFor={`body-${template.id}`}>Body</label>
          <textarea className="input" id={`body-${template.id}`} name="body" rows={6} defaultValue={template.body} required /></div>
        <SubmitButton variant="secondary">Save template</SubmitButton>
      </ActionForm>
      <form action={deleteEmailTemplateAction.bind(null, template.id)} className="mt-2">
        <button type="submit" className="link text-sm">Delete template</button>
      </form>
    </section>)}
    <ActionForm action={saveEmailTemplateAction.bind(null, null)} className="card mt-4 space-y-3">
      <h3 className="font-semibold">New template</h3>
      <Field label="Name" name="name" required />
      <Field label="Subject" name="subject" required />
      <div><label className="label" htmlFor="new-template-body">Body</label>
        <textarea className="input" id="new-template-body" name="body" rows={6} required /></div>
      <SubmitButton>Add template</SubmitButton>
    </ActionForm>
  </div>;
}
