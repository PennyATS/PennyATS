import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { jobs } from "@pennyats/db";
import { getCompanyName } from "@/lib/candidate-email";
import { recordCareersFunnelEvent } from "@/lib/careers-funnel";
import { db } from "@/lib/db";
import { getPrivacySettings } from "@/lib/privacy";
import { EMPLOYMENT_TYPES, WORKPLACE_TYPES, formatCompensation } from "@/lib/job-fields";
import { jobPostingJsonLd } from "@/lib/job-posting";
import { applyAction } from "../actions";
import { ApplyForm } from "./apply-form";
import { resumeSizeLabel } from "@/lib/validation";

export const dynamic = "force-dynamic";

async function getOpenJob(slug: string) {
  const [job] = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.slug, slug), eq(jobs.status, "open"), eq(jobs.confidential, false)));
  return job;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const job = await getOpenJob((await params).slug);
  return { title: job ? job.title : "Role not found" };
}

export default async function CareerJobPage({ params }: { params: Promise<{ slug: string }> }) {
  const job = await getOpenJob((await params).slug);
  if (!job) notFound();
  const privacy = await getPrivacySettings();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "") || "http://localhost:3000";
  const jsonLd = jobPostingJsonLd(job, { companyName: await getCompanyName(), appUrl });

  // Count the page view after the response is sent so tracking never delays the apply form.
  after(() => {
    void recordCareersFunnelEvent(job.id, "view");
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <p className="text-sm">
        <Link href="/careers" className="link">
          All open roles
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{job.title}</h1>
      <p className="muted mt-1 text-sm">
        {[
          job.department,
          job.location,
          job.workplaceType ? WORKPLACE_TYPES[job.workplaceType as keyof typeof WORKPLACE_TYPES] : null,
          job.employmentType ? EMPLOYMENT_TYPES[job.employmentType as keyof typeof EMPLOYMENT_TYPES] : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {job.compPublic && formatCompensation({ ...job, compPeriod: job.compPeriod as "year" | "hour" | null }) && (
        <p className="mt-2 text-sm font-medium">{formatCompensation({ ...job, compPeriod: job.compPeriod as "year" | "hour" | null })}</p>
      )}
      {job.description && <div className="mt-6 whitespace-pre-wrap text-sm leading-6">{job.description}</div>}

      <section className="mt-10" aria-labelledby="apply-heading">
        <h2 id="apply-heading" className="mb-3 text-lg font-semibold">
          Apply
        </h2>
        <ApplyForm
          action={applyAction.bind(null, job.id)}
          notice={{ text: privacy.noticeText, url: privacy.noticeUrl, requireConsent: privacy.requireConsent }}
          maxResume={resumeSizeLabel()}
          jobId={job.id}
        />
      </section>
    </>
  );
}
