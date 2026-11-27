import Link from "next/link";
import { asc, count, desc, eq, isNull } from "drizzle-orm";
import { emailTemplateFolders, emailTemplates, stageSchedulingSettings } from "@pennyats/db";
import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import { createFolderAction, deleteFolderAction, renameFolderAction } from "./actions";

export const metadata = { title: "Email templates" };

function FolderLink({ href, label, total, active }: { href: string; label: string; total: number; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${active ? "bg-[#d9eee2] font-medium text-[#14533b]" : "hover:bg-[#e7f4eb]"}`}>
      <span className="truncate">{label}</span>
      <span className="data-count">{total}</span>
    </Link>
  );
}

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  await requireUser("templates.manage");
  const { folder: selected = "all" } = await searchParams;
  const [folders, templates, unfiled, usage] = await Promise.all([
    db().select({ id: emailTemplateFolders.id, name: emailTemplateFolders.name, total: count(emailTemplates.id) })
      .from(emailTemplateFolders)
      .leftJoin(emailTemplates, eq(emailTemplates.folderId, emailTemplateFolders.id))
      .groupBy(emailTemplateFolders.id)
      .orderBy(asc(emailTemplateFolders.name)),
    db().select({
      id: emailTemplates.id, name: emailTemplates.name, subject: emailTemplates.subject,
      folderId: emailTemplates.folderId, updatedAt: emailTemplates.updatedAt,
    }).from(emailTemplates)
      .where(selected === "unfiled" ? isNull(emailTemplates.folderId)
        : isUuid(selected) ? eq(emailTemplates.folderId, selected) : undefined)
      .orderBy(desc(emailTemplates.updatedAt)),
    db().select({ total: count() }).from(emailTemplates).where(isNull(emailTemplates.folderId)),
    db().select({ templateId: stageSchedulingSettings.emailTemplateId, total: count() })
      .from(stageSchedulingSettings).groupBy(stageSchedulingSettings.emailTemplateId),
  ]);
  const folder = folders.find((f) => f.id === selected);
  const all = folders.reduce((sum, f) => sum + f.total, 0) + (unfiled[0]?.total ?? 0);
  const usedBy = new Map(usage.map((u) => [u.templateId, u.total]));
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const heading = folder?.name ?? (selected === "unfiled" ? "Unfiled" : "All templates");
  const newHref = folder ? `/templates/new?folder=${folder.id}` : "/templates/new";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email templates</h1>
          <p className="muted mt-1 text-sm">Write candidate emails once and reuse them. Send from a candidate&apos;s profile, or have a job stage send one automatically.</p>
        </div>
        <Link href={newHref} className="btn">New template</Link>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[15rem_1fr]">
        <aside className="space-y-4">
          <nav aria-label="Template folders" className="card space-y-0.5 p-2">
            <FolderLink href="/templates" label="All templates" total={all} active={selected === "all"} />
            <FolderLink href="/templates?folder=unfiled" label="Unfiled" total={unfiled[0]?.total ?? 0} active={selected === "unfiled"} />
            {folders.length > 0 && <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />}
            {folders.map((f) => (
              <FolderLink key={f.id} href={`/templates?folder=${f.id}`} label={f.name} total={f.total} active={f.id === selected} />
            ))}
          </nav>
          <ActionForm action={createFolderAction} className="card space-y-2 p-3 text-sm">
            <label htmlFor="new-folder" className="label">New folder</label>
            <input id="new-folder" name="name" className="input" maxLength={80} required placeholder="e.g. Recruiter screen" />
            <SubmitButton variant="secondary">Add folder</SubmitButton>
          </ActionForm>
        </aside>

        <section aria-labelledby="folder-title" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="folder-title" className="text-lg font-semibold">{heading}</h2>
            {folder && (
              <details className="relative">
                <summary className="btn btn-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden">Folder options</summary>
                <div className="data-menu right-0 w-72 space-y-4 text-sm">
                  <ActionForm action={renameFolderAction.bind(null, folder.id)} resetKey={folder.name} className="space-y-2">
                    <label htmlFor="rename-folder" className="label">Rename folder</label>
                    <input id="rename-folder" name="name" className="input" defaultValue={folder.name} maxLength={80} required />
                    <SubmitButton variant="secondary">Rename</SubmitButton>
                  </ActionForm>
                  <form action={deleteFolderAction.bind(null, folder.id)} className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
                    <p className="muted text-xs">Templates in this folder are kept and become unfiled.</p>
                    <button type="submit" className="btn btn-secondary mt-2 text-red-700">Delete folder</button>
                  </form>
                </div>
              </details>
            )}
          </div>

          {templates.length === 0 ? (
            <div className="card mt-4 text-sm">
              <p className="muted">{all === 0 ? "No templates yet." : "No templates in this folder."}</p>
              <Link href={newHref} className="link mt-2 inline-block">Write a template</Link>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Subject</th>
                    {!folder && <th>Folder</th>}
                    <th>Auto-send</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td><Link href={`/templates/${t.id}`} className="font-medium hover:underline">{t.name}</Link></td>
                      <td className="muted">{t.subject}</td>
                      {!folder && <td className="muted">{t.folderId ? folderName.get(t.folderId) : "Unfiled"}</td>}
                      <td className="muted">{usedBy.get(t.id) ? `${usedBy.get(t.id)} stage${usedBy.get(t.id) === 1 ? "" : "s"}` : "—"}</td>
                      <td className="muted whitespace-nowrap">{t.updatedAt.toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
