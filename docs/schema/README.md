# PennyATS open data format

Version **1.0.0**. A plain, documented JSON format for everything a hiring team keeps in PennyATS: jobs and their pipelines, candidates, applications with their stage history, interviews, scorecards, and notes. Use it to back up or move a workspace, to feed a data warehouse, or to build a tool that reads or writes PennyATS data without reverse-engineering the database.

- **JSON Schema** (draft 2020-12): [`v1/`](v1/). [`export.schema.json`](v1/export.schema.json) describes a whole export and points at one file per entity.
- **Changes:** [`CHANGELOG.md`](CHANGELOG.md).
- **Live data:** the [REST API](../api.md) for reading and writing records one at a time.

The schema files are generated from the same code that exports and imports (`packages/schema`), so they can't drift from it. CI also checks every column of the database tables behind the format: a new column fails the build until it is either added to the format or listed as left out, with a reason.

## Export and import

Admins can download everything from **Admin > Privacy > Download all hiring data**. From a shell:

```bash
pnpm data:export --out pennyats-export.json     # or to stdout: pnpm -s data:export > pennyats-export.json
pnpm data:import pennyats-export.json           # into the database in DATABASE_URL
```

Both are recorded in the audit log. The file contains candidate data: store and share it as carefully as the database itself, and delete copies you no longer need.

Import runs in one transaction, so a bad file changes nothing. It:

- **is safe to run twice.** Records whose id already exists are skipped.
- **matches candidates by email,** the same way the apply form does. A candidate whose email is already known is merged into the existing record, and an application for a job they already applied to is skipped.
- **creates missing people as deactivated users** with no password, so authors, interviewers, and hiring teams survive. Reactivate them and send a password reset from Admin > Users if they need to sign in.
- **renames a job's slug** to `<slug>-imported` if another job already uses it, and reports it.
- **checks references** before writing anything: every application's job, candidate, and stage, and every person, must be in the file or already in the database.

The import prints a summary of what it created, merged, and skipped.

## The document

```json
{
  "format": "pennyats-export",
  "schema_version": "1.0.0",
  "exported_at": "2026-11-26T18:00:00.000Z",
  "people": [{ "email": "dana@example.com", "name": "Dana Lee", "role": "interviewer" }],
  "jobs": [{ "id": "…", "title": "Senior Backend Engineer", "stages": [{ "id": "…", "name": "Applied", "position": 0 }], "hiring_team_emails": ["dana@example.com"], "…": "…" }],
  "candidates": [{ "id": "…", "full_name": "Ada Lovelace", "email": "ada@example.com", "tags": ["backend"], "…": "…" }],
  "applications": [{ "id": "…", "candidate_id": "…", "job_id": "…", "stage_id": "…", "status": "active", "events": [{ "type": "stage_changed", "at": "…", "actor_email": "dana@example.com", "data": { "from": "…", "to": "…" } }], "notes": [], "…": "…" }],
  "interviews": [{ "id": "…", "application_id": "…", "interviewer_emails": ["dana@example.com"], "…": "…" }],
  "scorecards": [{ "id": "…", "application_id": "…", "author_email": "dana@example.com", "recommendation": "yes", "ratings": { "Communication": 4 }, "…": "…" }],
  "notes": [{ "id": "…", "candidate_id": "…", "author_email": "dana@example.com", "body": "…", "created_at": "…" }]
}
```

### Conventions

- Field names are `snake_case`. Times are ISO 8601 in UTC. Dates without a time are `YYYY-MM-DD`.
- Ids are UUIDs and are kept on import, so references inside a file, and between a file and the API, stay valid.
- People are referenced by email, never by internal user id, so a file can move between instances. Every email used anywhere is listed once in `people`.
- Stage history lives in `applications[].events`. Reports rebuild time in stage and funnels from `stage_changed` events, so keep them if you edit a file.
- Lists are sorted by id and events oldest first, so two exports of the same data are identical apart from `exported_at`.

### What's included

| Entity | Notes |
| --- | --- |
| Person | Email, name, role. No passwords, sessions, or account state. |
| Job | All job fields including compensation and internal notes, stages in order, hiring manager, recruiter, hiring team. |
| Candidate | Profile, tags, resume file name, resume text, privacy consent time. |
| Application | Stage, status, rejection reason, stage history events, phone screen notes. |
| Interview | Name, stage, length, schedule, location, panel, completed and cancelled times. |
| Scorecard | Author, stage, ratings, recommendation, summary. Interview feedback links to its interview. |
| Note | Notes on a candidate's profile. |

### Not in version 1

Resume files (the name and extracted text are included), email history, the interview plan (each interview keeps its own copied details), scheduling links and availability, notifications, Google Calendar sync state, webhook delivery logs, and workspace settings. Email history and the interview plan are planned as later minor versions.

## Compatibility policy

The format follows [semantic versioning](https://semver.org). `schema_version` in each document says which version wrote it.

**Minor versions (1.x.0) never break readers.** They may:

- add an optional field, or a new entity list,
- add a new value to a field documented as open (such as event `type`),
- relax a constraint (allow null, accept a longer string).

**So readers must:** ignore fields they don't know, accept unknown event types, and accept any `1.x` document. The PennyATS importer does all three.

**Major versions (2.0.0) are breaking.** A field removed or renamed, a type changed, a field made required, a meaning changed, or an enum value removed. A major version gets its own folder (`v2/`), the previous one stays published, and the importer keeps reading the previous major version for at least one release.

**Patch versions (1.0.x)** fix descriptions and documentation only.

Every change gets a `CHANGELOG.md` entry. The schema version is in `packages/schema/src/format.ts` (`SCHEMA_VERSION`), and CI checks the changelog has an entry for it.

## For tool builders

- Validate files against `v1/export.schema.json` with any JSON Schema 2020-12 validator.
- In TypeScript inside this repository, `@pennyats/schema` exports the zod schemas and types (`ExportDocument`, `Candidate`, `Application`, …), `parseExport()`, `exportWorkspace()`, and `importWorkspace()`.
- To bring in data from another applicant tracking system, convert it into this format and run `pnpm data:import`. CSV import from Greenhouse and others ([#20](https://github.com/PennyATS/PennyATS/issues/20)) is planned to work this way.
