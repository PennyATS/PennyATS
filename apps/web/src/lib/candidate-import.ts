import { isEmail, isHttpUrl, normalizeEmail } from "./validation";

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 500;

export const importFields = [
  "fullName", "firstName", "lastName", "email", "phone", "linkedinUrl", "location",
  "source", "job", "stage", "status", "appliedAt",
] as const;
export type ImportField = (typeof importFields)[number];
export type ImportMapping = Record<ImportField, string>;
export type ImportJob = { id: string; title: string };
export type ImportStage = { id: string; jobId: string; name: string };
export type ImportRow = {
  number: number;
  fullName: string;
  email: string;
  phone: string | null;
  linkedinUrl: string | null;
  location: string | null;
  source: string;
  jobId: string;
  jobTitle: string;
  stageId: string | null;
  stageName: string | null;
  status: "active" | "hired" | "rejected" | "withdrawn";
  appliedAt: Date | null;
};
export type RowError = { number: number; message: string };

const aliases: Record<ImportField, string[]> = {
  fullName: ["full name", "candidate name", "candidate", "name"],
  firstName: ["first name", "first_name", "firstname"],
  lastName: ["last name", "last_name", "lastname"],
  email: ["email", "email address", "email addresses", "candidate email"],
  phone: ["phone", "phone number", "mobile phone"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedin profile"],
  location: ["location", "candidate location"],
  source: ["source", "candidate source", "application source"],
  job: ["job", "job title", "opening", "requisition"],
  stage: ["stage", "current stage", "application stage"],
  status: ["status", "application status"],
  appliedAt: ["applied at", "application date", "applied on", "applied date"],
};

const key = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, " ");

/** RFC 4180-style quoted fields, escaped quotes, BOM, and embedded line breaks. */
export function parseImportCsv(text: string): { headers: string[]; rows: string[][] } {
  if (text.length > CSV_MAX_BYTES) throw new Error("CSV must be 2 MB or smaller.");
  const source = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;

  function finishRow() {
    row.push(cell);
    if (row.some((value) => value.trim())) records.push(row);
    if (records.length > CSV_MAX_ROWS + 1) throw new Error(`CSV has more than ${CSV_MAX_ROWS} data rows.`);
    row = [];
    cell = "";
    closedQuote = false;
  }

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
      closedQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      finishRow();
    } else if (char === '"' && cell === "" && !closedQuote) {
      quoted = true;
    } else if (char === '"' || closedQuote) {
      throw new Error(`Malformed CSV near record ${records.length + 1}.`);
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell || row.length || closedQuote) finishRow();
  const [headers, ...rows] = records;
  if (!headers?.length || !rows.length) throw new Error("CSV needs a header and at least one data row.");
  if (headers.some((header) => !header.trim())) throw new Error("Every CSV column needs a header.");
  if (new Set(headers.map(key)).size !== headers.length) throw new Error("CSV headers must be unique.");
  if (rows.some((entry) => entry.length !== headers.length)) throw new Error("CSV rows do not all have the same number of columns.");
  return { headers: headers.map((header) => header.trim()), rows };
}

export function guessImportMapping(headers: string[]): ImportMapping {
  return Object.fromEntries(importFields.map((field) => [
    field, headers.find((header) => aliases[field].some((alias) => key(header) === key(alias))) ?? "",
  ])) as ImportMapping;
}

function appliedDate(value: string): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const year = Number(iso?.[1] ?? us?.[3]);
  const month = Number(iso?.[2] ?? us?.[1]);
  const day = Number(iso?.[3] ?? us?.[2]);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date : null;
}

export function planCandidateImport(input: {
  csv: { headers: string[]; rows: string[][] };
  mapping: ImportMapping;
  fallbackJobId: string;
  jobs: ImportJob[];
  stages: ImportStage[];
}): { rows: ImportRow[]; errors: RowError[]; duplicateRows: number[] } {
  const { csv, mapping, fallbackJobId, jobs, stages } = input;
  if (importFields.some((field) => mapping[field] && !csv.headers.includes(mapping[field]))) {
    throw new Error("A mapped column is missing from the CSV.");
  }
  if (!mapping.email || (!mapping.fullName && !mapping.firstName && !mapping.lastName)) {
    throw new Error("Map Email and either Full name or First/Last name.");
  }
  if (!mapping.job && !fallbackJobId) throw new Error("Choose a destination job or map a Job column.");
  const indexes = Object.fromEntries(importFields.map((field) => [field, csv.headers.indexOf(mapping[field])])) as Record<ImportField, number>;
  const planned: ImportRow[] = [];
  const errors: RowError[] = [];
  const duplicateRows: number[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of csv.rows.entries()) {
    const number = index + 2;
    const get = (field: ImportField) => indexes[field] < 0 ? "" : raw[indexes[field]].trim();
    const fullName = (get("fullName") || `${get("firstName")} ${get("lastName")}`.trim()).replace(/\s+/g, " ");
    const email = normalizeEmail(get("email"));
    const linkedinUrl = get("linkedinUrl");
    const mappedJob = get("job");
    const jobMatches = mappedJob ? jobs.filter((job) => key(job.title) === key(mappedJob)) : jobs.filter((job) => job.id === fallbackJobId);
    const job = jobMatches.length === 1 ? jobMatches[0] : null;
    const stageValue = get("stage");
    const stageMatches = stageValue && job ? stages.filter((stage) => stage.jobId === job.id && key(stage.name) === key(stageValue)) : [];
    const statusValue = key(get("status"));
    const status = statusValue || "active";
    const dateValue = get("appliedAt");
    let problem: string | null = null;
    if (!fullName || fullName.length > 200) problem = "Name is required and must be 200 characters or fewer.";
    else if (!isEmail(email)) problem = "A valid email is required for safe duplicate matching.";
    else if (get("phone").length > 50 || get("location").length > 200 || get("source").length > 100) problem = "Phone, location, or source is too long.";
    else if (linkedinUrl && (linkedinUrl.length > 500 || !isHttpUrl(linkedinUrl))) problem = "LinkedIn URL must be a valid HTTP(S) URL.";
    else if (!job) problem = mappedJob ? `Job “${mappedJob}” was not found uniquely.` : "Choose a valid destination job.";
    else if (stageValue && stageMatches.length !== 1) problem = `Stage “${stageValue}” was not found uniquely for this job.`;
    else if (!["active", "hired", "rejected", "withdrawn"].includes(status)) problem = `Status “${get("status") }” is not supported.`;
    else if (dateValue && !appliedDate(dateValue)) problem = "Applied date must be YYYY-MM-DD, MM/DD/YYYY, or an ISO timestamp with time zone.";
    if (problem) { errors.push({ number, message: problem }); continue; }
    const duplicateKey = `${email}\0${job!.id}`;
    if (seen.has(duplicateKey)) { duplicateRows.push(number); continue; }
    seen.add(duplicateKey);
    planned.push({
      number, fullName, email, phone: get("phone") || null, linkedinUrl: linkedinUrl || null,
      location: get("location") || null, source: get("source") || "Imported CSV",
      jobId: job!.id, jobTitle: job!.title, stageId: stageMatches[0]?.id ?? null,
      stageName: stageMatches[0]?.name ?? null,
      status: status as ImportRow["status"], appliedAt: appliedDate(dateValue),
    });
  }
  return { rows: planned, errors, duplicateRows };
}
