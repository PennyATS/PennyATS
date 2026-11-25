export function renderEmailTemplate(value: string, candidateName: string, jobTitle: string): string {
  return value.replace(/{{\s*(candidate_name|job_title)\s*}}/g, (_, token: string) =>
    token === "candidate_name" ? candidateName : jobTitle);
}
