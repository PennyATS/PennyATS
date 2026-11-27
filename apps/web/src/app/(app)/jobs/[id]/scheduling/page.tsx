import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { emailTemplateFolders, emailTemplates, stageSchedulingSettings } from "@pennyats/db";
import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { smtpConfigured } from "@/lib/smtp";
import { saveStageSchedulingAction } from "./actions";

export default async function JobSchedulingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser("interviews.plan");
  const { job, stages } = await loadJob(user, id);
  const [settings, templates] = await Promise.all([
    stages.length ? db().select().from(stageSchedulingSettings)
      .where(inArray(stageSchedulingSettings.stageId, stages.map((stage) => stage.id))) : [],
    db().select({ id: emailTemplates.id, name: emailTemplates.name, folder: emailTemplateFolders.name })
      .from(emailTemplates).leftJoin(emailTemplateFolders, eq(emailTemplateFolders.id, emailTemplates.folderId))
      .orderBy(asc(emailTemplateFolders.name), asc(emailTemplates.name)),
  ]);
  const groups = Map.groupBy(templates, (t) => t.folder ?? "Unfiled");
  return <div>
    <h2 className="text-xl font-semibold tracking-tight">Stage automation</h2>
    <p className="muted mt-1 text-sm">Choose what happens when a candidate enters each stage: an email from your <Link href="/templates" className="link">templates</Link>, a scheduling link, and interview reminders. Everything is off until you opt in. Each email is sent once per candidate and stage, even if they move back and forth.</p>
    {!smtpConfigured() && <p className="inset mt-5 text-sm">SMTP is not configured. Automatic emails are recorded on the candidate timeline as not sent, and can be resent once SMTP is set up; recruiters can still copy scheduling links manually. <Link href="/settings/email" className="link">Email settings</Link></p>}
    <div className="mt-6 space-y-4">
      {stages.map((stage) => {
        const setting = settings.find((row) => row.stageId === stage.id);
        return <section key={stage.id} className="card">
          <h2 className="font-semibold">{stage.name}</h2>
          <ActionForm action={saveStageSchedulingAction.bind(null, job.id, stage.id)}
            resetKey={`${setting?.autoLinkMode}-${setting?.reminderMinutes}-${setting?.emailTemplateId}`} className="mt-4 space-y-4">
            <div><label htmlFor={`template-${stage.id}`} className="label">Email the candidate on stage entry</label>
              <select id={`template-${stage.id}`} name="emailTemplateId" className="input" defaultValue={setting?.emailTemplateId ?? ""}>
                <option value="">Do not send an email</option>
                {[...groups].map(([folder, items]) => <optgroup key={folder} label={folder}>
                  {items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>)}
              </select>
              {templates.length === 0 && <p className="muted mt-1 text-xs"><Link href="/templates/new" className="link">Write a template</Link> to send one automatically.</p>}
            </div>
            <div><label htmlFor={`mode-${stage.id}`} className="label">Scheduling link on stage entry</label>
              <select id={`mode-${stage.id}`} name="autoLinkMode" className="input" defaultValue={setting?.autoLinkMode ?? "none"}>
                <option value="none">Do not send a link</option>
                <option value="booking">Send a direct booking link for one interviewer</option>
                <option value="availability">Ask for candidate availability</option>
              </select>
            </div>
            <div><label htmlFor={`reminder-${stage.id}`} className="label">Reminder before interview (minutes; blank means off)</label>
              <input id={`reminder-${stage.id}`} name="reminderMinutes" type="number" min="5" max="10080" className="input"
                defaultValue={setting?.reminderMinutes ?? ""} placeholder="1440 for one day" />
            </div>
            <SubmitButton variant="secondary">Save stage settings</SubmitButton>
          </ActionForm>
        </section>;
      })}
    </div>
  </div>;
}
