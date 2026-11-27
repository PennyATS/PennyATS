"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  CSV_MAX_BYTES, guessImportMapping, importFields, parseImportCsv, planCandidateImport,
  type ImportField, type ImportJob, type ImportMapping, type ImportStage,
} from "@/lib/candidate-import";
import { importCandidatesAction, type ImportResult } from "./actions";

const labels: Record<ImportField, string> = {
  fullName: "Full name", firstName: "First name", lastName: "Last name", email: "Email",
  phone: "Phone", linkedinUrl: "LinkedIn URL", location: "Location", source: "Source",
  job: "Job title", stage: "Current stage", status: "Application status", appliedAt: "Applied date",
};

export function ImportCsvForm({ jobs, stages }: { jobs: ImportJob[]; stages: ImportStage[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [fallbackJobId, setFallbackJobId] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedFile = useRef<File | null>(null);

  let preview: ReturnType<typeof planCandidateImport> | null = null;
  let mappingError = "";
  if (csv && mapping) {
    try { preview = planCandidateImport({ csv, mapping, fallbackJobId, jobs, stages }); }
    catch (err) { mappingError = err instanceof Error ? err.message : "Mapping could not be read."; }
  }

  async function selectFile(next: File | null) {
    selectedFile.current = next;
    setFile(next);
    setCsv(null);
    setMapping(null);
    setResult(null);
    setError("");
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".csv") || !next.size || next.size > CSV_MAX_BYTES) {
      setError("Choose a non-empty CSV file no larger than 2 MB.");
      return;
    }
    try {
      const parsed = parseImportCsv(await next.text());
      if (selectedFile.current !== next) return;
      setCsv(parsed);
      setMapping(guessImportMapping(parsed.headers));
    } catch (err) {
      if (selectedFile.current !== next) return;
      setError(err instanceof Error ? err.message : "CSV could not be read.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !mapping || !preview?.rows.length || busy) return;
    const form = new FormData();
    form.set("file", file);
    form.set("fallbackJobId", fallbackJobId);
    for (const field of importFields) form.set(`map:${field}`, mapping[field]);
    setBusy(true);
    setResult(null);
    try { setResult(await importCandidatesAction(form)); }
    catch { setResult({ error: "Import could not finish. Check the server and try again." }); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="card space-y-3">
        <h2 className="card-title">1. Choose CSV</h2>
        <input type="file" accept=".csv,text/csv" aria-label="Candidate CSV file" onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)} className="block text-sm" />
        <p className="muted text-xs">Up to 2 MB and 500 data rows. Import uses email to match candidates and job to match applications. Existing candidate details and applications are left as they are.</p>
        {error && <p role="alert" className="error text-sm">{error}</p>}
        {csv && <p className="text-sm">{csv.rows.length} data rows and {csv.headers.length} columns found.</p>}
      </section>

      {csv && mapping && <>
        <section className="card space-y-4">
          <div>
            <h2 className="card-title">2. Map columns</h2>
            <p className="card-note">Greenhouse-style column names are suggested automatically. Email and a name are required.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {importFields.map((field) => (
              <div key={field}>
                <label htmlFor={`map-${field}`} className="label">{labels[field]}</label>
                <select id={`map-${field}`} value={mapping[field]} onChange={(event) => { setMapping({ ...mapping, [field]: event.target.value }); setResult(null); }} className="input">
                  <option value="">Not in file</option>
                  {csv.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div>
            <label htmlFor="fallback-job" className="label">Job for all rows without a mapped job title</label>
            <select id="fallback-job" value={fallbackJobId} onChange={(event) => { setFallbackJobId(event.target.value); setResult(null); }} className="input max-w-md">
              <option value="">Choose a job or map Job title above</option>
              {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
            </select>
          </div>
        </section>

        <section className="card space-y-3">
          <h2 className="card-title">3. Review and import</h2>
          {mappingError && <p role="alert" className="error text-sm">{mappingError}</p>}
          {preview && <>
            <p className="text-sm">{preview.rows.length} ready · {preview.duplicateRows.length} repeated within file · {preview.errors.length} invalid</p>
            {preview.errors.length > 0 && <div role="alert" className="rounded-md border border-[var(--border)] p-3 text-sm">
              <p className="font-medium">Rows that will be skipped</p>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {preview.errors.slice(0, 20).map((item) => <li key={item.number}>Row {item.number}: {item.message}</li>)}
              </ul>
              {preview.errors.length > 20 && <p className="mt-1">And {preview.errors.length - 20} more.</p>}
            </div>}
            {preview.rows.length > 0 && <div className="data-table-scroll rounded-lg">
              <table className="data-table w-full min-w-[700px]">
                <thead><tr><th className="p-2">Row</th><th className="p-2">Candidate</th><th className="p-2">Email</th><th className="p-2">Job</th><th className="p-2">Stage</th><th className="p-2">Status</th></tr></thead>
                <tbody>{preview.rows.slice(0, 10).map((row) => <tr key={row.number}>
                  <td className="p-2">{row.number}</td><td className="p-2">{row.fullName}</td><td className="p-2">{row.email}</td>
                  <td className="p-2">{row.jobTitle}</td><td className="p-2">{row.stageName ?? "First stage"}</td><td className="p-2">{row.status}</td>
                </tr>)}</tbody>
              </table>
            </div>}
            {preview.rows.length > 10 && <p className="muted text-xs">Showing the first 10 ready rows.</p>}
          </>}
          <button type="submit" className="btn" disabled={busy || !preview?.rows.length}>{busy ? "Importing..." : "Import ready rows"}</button>
          {result && ("error" in result ? <p role="alert" className="error text-sm">{result.error}</p> : <div role="status" className="text-sm">
            <p>Imported {result.created} applications. Skipped {result.skipped} duplicates. {result.errors.length} rows failed.</p>
            {result.errors.length > 0 && <ul className="mt-1 list-inside list-disc">{result.errors.slice(0, 20).map((item) => <li key={item.number}>Row {item.number}: {item.message}</li>)}</ul>}
          </div>)}
        </section>
      </>}
    </form>
  );
}
