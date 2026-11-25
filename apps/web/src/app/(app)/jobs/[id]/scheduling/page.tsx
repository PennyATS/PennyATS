import Link from "next/link";
import { inArray } from "drizzle-orm";
import { stageSchedulingSettings } from "@pennyats/db";
import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { canManageHiring } from "@/lib/permissions";
import { smtpConfigured } from "@/lib/smtp";
import { saveStageSchedulingAction } from "./actions";

export default async function JobSchedulingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(canManageHiring);
  const { job, stages } = await loadJob(user, id);
  const settings = stages.length ? await db().select().from(stageSchedulingSettings)
    .where(inArray(stageSchedulingSettings.stageId, stages.map((stage) => stage.id))) : [];
  return <div className="max-w-4xl">
    <Link href={`/jobs/${job.id}`} className="link text-sm">← Back to {job.title}</Link>
    <h1 className="mt-4 text-2xl font-semibold tracking-tight">Stage scheduling</h1>
    <p className="muted mt-1 text-sm">Choose whether entering a stage sends a scheduling link, and when scheduled interviews send a reminder. Automation is off until you opt in.</p>
    {!smtpConfigured() && <p className="inset mt-5 text-sm">SMTP is not configured. Automatic messages will wait; recruiters can still copy links manually. <Link href="/settings/email" className="link">Email settings</Link></p>}
    <div className="mt-6 space-y-4">
      {stages.map((stage) => {
        const setting = settings.find((row) => row.stageId === stage.id);
        return <section key={stage.id} className="card">
          <h2 className="font-semibold">{stage.name}</h2>
          <ActionForm action={saveStageSchedulingAction.bind(null, job.id, stage.id)}
            resetKey={`${setting?.autoLinkMode}-${setting?.reminderMinutes}`} className="mt-4 space-y-4">
            <div><label htmlFor={`mode-${stage.id}`} className="label">On stage entry</label>
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
