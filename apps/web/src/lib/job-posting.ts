/**
 * schema.org JobPosting JSON-LD for public careers job pages.
 * Pure builders so unit tests can check Google's required fields without a database.
 * See https://developers.google.com/search/docs/appearance/structured-data/job-posting
 */

import type { EMPLOYMENT_TYPES, WORKPLACE_TYPES } from "./job-fields";

const SCHEMA_EMPLOYMENT: Record<keyof typeof EMPLOYMENT_TYPES, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  internship: "INTERN",
  temporary: "TEMPORARY",
};

export type JobPostingInput = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  location: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  createdAt: Date | string;
  compPublic: boolean;
  compCurrency: string | null;
  compPeriod: string | null;
  compMin: number | null;
  compMax: number | null;
};

export type JobPostingContext = {
  companyName: string;
  /** Public origin with no trailing slash, e.g. https://careers.acme.com */
  appUrl: string;
};

/** Build a JobPosting object suitable for JSON-LD. Omits optional fields that aren't set. */
export function buildJobPosting(job: JobPostingInput, ctx: JobPostingContext): Record<string, unknown> {
  const url = `${ctx.appUrl.replace(/\/$/, "")}/careers/${job.slug}`;
  const datePosted =
    job.createdAt instanceof Date ? job.createdAt.toISOString().slice(0, 10) : String(job.createdAt).slice(0, 10);

  const posting: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: job.description?.trim() || job.title,
    datePosted,
    hiringOrganization: {
      "@type": "Organization",
      name: ctx.companyName,
    },
    identifier: {
      "@type": "PropertyValue",
      name: ctx.companyName,
      value: job.id,
    },
    url,
    directApply: true,
  };

  const employment = job.employmentType && Object.hasOwn(SCHEMA_EMPLOYMENT, job.employmentType)
    ? SCHEMA_EMPLOYMENT[job.employmentType as keyof typeof EMPLOYMENT_TYPES]
    : null;
  if (employment) posting.employmentType = employment;

  const workplace = job.workplaceType as keyof typeof WORKPLACE_TYPES | null;
  const remote = workplace === "remote";
  const hybrid = workplace === "hybrid";
  if (remote || hybrid) posting.jobLocationType = "TELECOMMUTE";

  if (!remote && job.location?.trim()) {
    posting.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location.trim(),
      },
    };
  } else if (remote && job.location?.trim()) {
    // Remote with a region preference (e.g. "United States").
    posting.applicantLocationRequirements = {
      "@type": "Country",
      name: job.location.trim(),
    };
  } else if (remote) {
    // Fully remote with no region: Google still wants a location signal; use the company name's country unknown as Place.
    posting.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Remote",
      },
    };
  } else if (job.location?.trim()) {
    posting.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location.trim(),
      },
    };
  }

  if (job.compPublic) {
    const salary = baseSalary(job);
    if (salary) posting.baseSalary = salary;
  }

  return posting;
}

function baseSalary(job: JobPostingInput): Record<string, unknown> | null {
  const { compMin: min, compMax: max } = job;
  if (min === null && max === null) return null;
  const currency = job.compCurrency ?? "USD";
  const unitText = job.compPeriod === "hour" ? "HOUR" : "YEAR";
  const value: Record<string, unknown> = {
    "@type": "QuantitativeValue",
    unitText,
  };
  if (min !== null && max !== null && min !== max) {
    value.minValue = min;
    value.maxValue = max;
  } else if (min !== null) {
    value.value = min;
  } else {
    value.value = max;
  }
  return {
    "@type": "MonetaryAmount",
    currency,
    value,
  };
}

/** Safe script-tag payload: JSON with `<` escaped so job text can't break out of the script. */
export function jobPostingJsonLd(job: JobPostingInput, ctx: JobPostingContext): string {
  return JSON.stringify(buildJobPosting(job, ctx)).replace(/</g, "\\u003c");
}
