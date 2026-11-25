import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { emailTemplateFolders, emailTemplates, jobs, stageSchedulingSettings, stages } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { getCompanyName } from "@/lib/candidate-email";
import { db } from "@/lib/db";
import { EXAMPLE_VALUES, renderEmailHtml, renderEmailTemplate, templateHtml } from "@/lib/email-templates";
import { canManageHiring } from "@/lib/permissions";
import { isUuid } from "@/lib/validation";
import { deleteTemplateAction, duplicateTemplateAction } from "../actions";
import { TemplateForm } from "../template-form";

export const metadata = { title: "Email template" };

export default async function TemplatePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requireUser(canManageHiring);
  const { id } = await params;
  const { created } = await searchParams;
  if (!isUuid(id)) notFound();
  const [[template], folders, usedBy, companyName] = await Promise.all([
    db().select().from(emailTemplates).where(eq(emailTemplates.id, id)),
    db().select({ id: emailTemplateFolders.id, name: emailTemplateFolders.name })
      .from(emailTemplateFolders).orderBy(asc(emailTemplateFolders.name)),
    db().select({ jobId: jobs.id, job: jobs.title, stage: stages.name })
      .from(stageSchedulingSettings)
      .innerJoin(stages, eq(stages.id, stageSchedulingSettings.stageId))
      .innerJoin(jobs, eq(jobs.id, stages.jobId))
      .where(eq(stageSchedulingSettings.emailTemplateId, id))
      .orderBy(asc(jobs.title)),
    getCompanyName(),
  ]);
  if (!template) notFound();
  const html = templateHtml(template);
  const sample = { ...EXAMPLE_VALUES, company_name: companyName };
  const folder = folders.find((f) => f.id === template.folderId);

  return (
    <div className="max-w-3xl">
      <Link href={folder ? `/templates?folder=${folder.id}` : "/templates"} className="link text-sm">
        ← {folder ? folder.name : "Email templates"}
      </Link>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{template.name}</h1>
        <div className="flex gap-2">
          <form action={duplicateTemplateAction.bind(null, template.id)}>
            <button type="submit" className="btn btn-secondary">Duplicate</button>
          </form>
          <details className="relative">
            <summary className="btn btn-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden">Delete</summary>
            <form action={deleteTemplateAction.bind(null, template.id)} className="data-menu right-0 w-72 text-sm">
              <p>
                Delete this template?{usedBy.length > 0 && " Stages that send it automatically will stop sending."}{" "}
                Emails already sent stay on candidate timelines.
              </p>
              <button type="submit" className="btn mt-3 bg-red-700">Delete template</button>
            </form>
          </details>
        </div>
      </div>
      {created && <p role="status" className="mt-2 text-sm">Template created.</p>}
      <p className="muted mt-1 text-sm">
        {usedBy.length === 0 ? (
          <>Not sent automatically. Pick it under a job&apos;s <strong>Stage automation</strong> to send it when candidates enter a stage.</>
        ) : (
          <>Sent automatically when candidates enter:{" "}
            {usedBy.map((u, i) => (
              <span key={`${u.jobId}-${u.stage}`}>{i > 0 && ", "}<Link href={`/jobs/${u.jobId}/scheduling`} className="link">{u.job} → {u.stage}</Link></span>
            ))}.
          </>
        )}
      </p>

      <div className="mt-6">
        <TemplateForm folders={folders} template={{
          id: template.id, name: template.name, subject: template.subject, html,
          folderId: template.folderId, updatedAt: template.updatedAt,
        }} />
      </div>

      <section className="card mt-6" aria-labelledby="preview-title">
        <h2 id="preview-title" className="card-title">Preview</h2>
        <p className="card-note">With sample data, as last saved.</p>
        <div className="inset mt-4 text-sm">
          <p><span className="muted">Subject:</span> <strong>{renderEmailTemplate(template.subject, sample)}</strong></p>
          {/* Stored HTML was sanitized on save, and merge values are escaped. */}
          <div className="rich-text mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}
            dangerouslySetInnerHTML={{ __html: renderEmailHtml(html, sample) }} />
        </div>
      </section>
    </div>
  );
}
