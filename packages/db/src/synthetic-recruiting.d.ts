// synthetic-recruiting ships no type declarations yet. These cover the parts the seed uses.
declare module "synthetic-recruiting" {
  export type Stage =
    | "applied"
    | "recruiter_screen"
    | "hiring_manager_screen"
    | "technical_interview"
    | "onsite"
    | "offer";

  export interface JobRow {
    job_id: string;
    title: string;
    role_family: string;
    location: string;
    level: string;
    required_skills: string;
    openings: number;
    opened_date: string;
    closed_date: string | null;
    status: "open" | "closed";
  }
  export interface CandidateRow {
    candidate_id: string;
    full_name: string;
    email: string;
    phone: string;
    source: string;
    role_family: string;
    seniority: string;
    years_experience: number;
    education: string;
    location: string;
    current_employer: string;
    prior_employer: string | null;
    skills: string;
  }
  export interface ApplicationRow {
    application_id: string;
    job_id: string;
    candidate_id: string;
    applied_date: string;
    current_stage: Stage;
    status: "open" | "hired" | "rejected" | "withdrawn" | "stalled";
    closed_date: string | null;
  }
  export interface StageEventRow {
    application_id: string;
    stage: Stage;
    entered_date: string;
    exited_date: string | null;
    outcome: "advanced" | "rejected" | "withdrawn" | "stalled" | "open";
  }
  export interface InterviewRow {
    interview_id: string;
    application_id: string;
    stage: Stage;
    interview_date: string;
    interviewer_id: string;
    result: "pass" | "fail" | "pending";
  }

  export interface Dataset {
    tables: {
      jobs: JobRow[];
      candidates: CandidateRow[];
      applications: ApplicationRow[];
      stage_events: StageEventRow[];
      interviews: InterviewRow[];
    };
    asOf: string;
  }

  export function generate(opts: {
    preset: string;
    seed: number;
    applications?: number;
    startDate?: string;
    months?: number;
    tailDays?: number;
  }): Dataset;
}
