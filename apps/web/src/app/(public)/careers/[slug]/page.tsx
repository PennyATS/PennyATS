import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { jobs } from "@pennyats/db";
import { db } from "@/lib/db";
import { applyAction } from "../actions";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

async function getOpenJob(slug: string) {
  const [job] = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.slug, slug), eq(jobs.status, "open")));
  return job;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const job = await getOpenJob((await params).slug);
  return { title: job ? job.title : "Role not found" };
}

export default async function CareerJobPage({ params }: { params: Promise<{ slug: string }> }) {
  const job = await getOpenJob((await params).slug);
  if (!job) notFound();

  return (
    <>
      <p className="text-sm">
        <Link href="/careers" className="link">
          All open roles
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{job.title}</h1>
      <p className="muted mt-1 text-sm">{[job.department, job.location].filter(Boolean).join(" · ")}</p>
      {job.description && <div className="mt-6 whitespace-pre-wrap text-sm leading-6">{job.description}</div>}

      <h2 className="mb-3 mt-10 text-lg font-semibold">Apply</h2>
      <ApplyForm action={applyAction.bind(null, job.id)} />
    </>
  );
}
