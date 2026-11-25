import { ActionForm, Field, SubmitButton } from "@/components/form";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { getCompanyName } from "@/lib/candidate-email";
import { canManageUsers } from "@/lib/permissions";
import { smtpConfigured } from "@/lib/smtp";
import { saveCompanyNameAction, testSmtpAction } from "./actions";

export default async function EmailSettingsPage() {
  await requireUser(canManageUsers);
  const configured = smtpConfigured();
  const companyName = await getCompanyName();
  return <div className="max-w-2xl">
    <h1 className="text-2xl font-semibold tracking-tight">Email delivery</h1>
    <p className="muted mt-1 text-sm">PennyATS uses your SMTP server for scheduling links, reminders, team invites, password resets, and candidate messages. Manual link copying works without email.</p>
    <section className="card mt-6 space-y-4 text-sm">
      <h2 className="font-semibold">SMTP status</h2>
      <p>{configured ? "Configured" : "Not configured"}</p>
      <p className="muted">Set SMTP_HOST, SMTP_PORT, SMTP_FROM, and optionally SMTP_USER and SMTP_PASSWORD in the server environment. Port 465 uses TLS; other ports require STARTTLS.</p>
      {configured && <ActionForm action={testSmtpAction}><SubmitButton variant="secondary">Test SMTP connection</SubmitButton></ActionForm>}
    </section>
    <section className="card mt-6 space-y-3 text-sm" aria-labelledby="company-title">
      <h2 id="company-title" className="font-semibold">Company name</h2>
      <p className="muted">Used for {"{{company_name}}"} in email templates. Leave blank to use {BRAND.name}.</p>
      <ActionForm action={saveCompanyNameAction} resetKey={companyName} className="space-y-3">
        <Field label="Company name" name="companyName" defaultValue={companyName === BRAND.name ? "" : companyName} />
        <SubmitButton variant="secondary">Save</SubmitButton>
      </ActionForm>
    </section>
    <section className="card mt-6 text-sm">
      <h2 className="font-semibold">Candidate email templates</h2>
      <p className="muted mt-1">Templates, folders, and merge fields live in the <Link href="/templates" className="link">Templates</Link> section. Choose which template a stage sends automatically under each job&apos;s Stage automation.</p>
    </section>
  </div>;
}
