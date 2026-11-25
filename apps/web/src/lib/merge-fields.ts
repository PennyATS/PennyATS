/** Merge fields for email templates. No dependencies, so the browser editor can import it. */
export const MERGE_FIELDS = [
  { token: "first_name", label: "Candidate first name", example: "Sam" },
  { token: "candidate_name", label: "Candidate full name", example: "Sam Rivera" },
  { token: "job_title", label: "Job title", example: "Senior Engineer" },
  { token: "company_name", label: "Company name", example: "Acme" },
  { token: "stage_name", label: "Stage", example: "Recruiter screen" },
] as const;

export type MergeToken = (typeof MERGE_FIELDS)[number]["token"];
export type MergeValues = Record<MergeToken, string>;

export function mergeValues(input: {
  candidateName: string;
  jobTitle: string;
  companyName: string;
  stageName?: string | null;
}): MergeValues {
  const name = input.candidateName.trim();
  return {
    first_name: name.split(/\s+/)[0] ?? "",
    candidate_name: name,
    job_title: input.jobTitle,
    company_name: input.companyName,
    stage_name: input.stageName ?? "",
  };
}

export const EXAMPLE_VALUES = Object.fromEntries(MERGE_FIELDS.map((f) => [f.token, f.example])) as MergeValues;
