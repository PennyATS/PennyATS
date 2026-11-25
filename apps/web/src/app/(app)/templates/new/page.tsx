import Link from "next/link";
import { asc } from "drizzle-orm";
import { emailTemplateFolders } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageHiring } from "@/lib/permissions";
import { TemplateForm } from "../template-form";

export const metadata = { title: "New email template" };

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  await requireUser(canManageHiring);
  const { folder } = await searchParams;
  const folders = await db().select({ id: emailTemplateFolders.id, name: emailTemplateFolders.name })
    .from(emailTemplateFolders).orderBy(asc(emailTemplateFolders.name));
  const current = folders.find((f) => f.id === folder);
  return (
    <div className="max-w-3xl">
      <Link href={current ? `/templates?folder=${current.id}` : "/templates"} className="link text-sm">
        ← {current ? current.name : "Email templates"}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New template</h1>
      <div className="mt-6">
        <TemplateForm folders={folders} folderId={current?.id ?? null} />
      </div>
    </div>
  );
}
