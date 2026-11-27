# Starting from scratch: hiring without an ATS

This guide is for founders and small teams who track hiring in a spreadsheet, an email inbox, Notion, or a shared doc and have never used an applicant tracking system. If you already use Ashby, Greenhouse, or another ATS, read [Moving from another ATS](why-pennyats.md#moving-from-another-ats) instead.

PennyATS is an early-preview, open-source ATS that you run yourself with your own Postgres database. There is no per-seat software fee, but your team operates the server. [Why PennyATS](why-pennyats.md) has the cost example and the tradeoffs.

## Do you need an ATS yet?

You can probably wait if you are hiring one person, getting a handful of applicants, and only one person looks at them. A spreadsheet is fine at that size.

An ATS starts to pay off when any of these are true:

- Applicants arrive from several places and some get lost or answered late.
- More than one person interviews, and feedback lives in chat threads or memory.
- You want to know where candidates drop out, how long hiring takes, or which sources produce hires.
- You are hiring for more than one role at once.
- Someone asks you to delete their data, and you are not sure where it all is.

## What it adds over a spreadsheet

- **One profile per person.** Candidates are matched by email, so someone applying to a second role keeps a single profile.
- **A pipeline per job.** Each job has its own stages, and a board shows who is where and how long they have been there.
- **A careers page.** Open jobs are listed at `/careers` with an apply form and resume upload, so applications land in the system instead of your inbox.
- **Structured interview feedback.** Scorecards are blind: interviewers cannot see anyone else's until they submit their own.
- **Reports.** Funnel, time in stage, time to hire, sources, and rejection reasons without building them by hand.
- **Privacy tools.** Per-candidate export, permanent deletion, and optional automatic deletion of rejected candidates.
- **Your data stays portable.** You can export everything in a [documented format](schema/README.md).

What you take on: hosting, backups, updates, email delivery, and security configuration. If you want a managed service with broader scheduling, sourcing, and support, a hosted ATS may be the better purchase. See [Why PennyATS](why-pennyats.md).

## Your first hour

1. **Try it first, if you want.** [Demo mode](demo.md) shows a populated instance with fictional candidates, so you can click around before deploying anything.
2. **Put it online.** The no-terminal path is the Render button in the [README](../README.md#put-it-online); the [one-click deploy guide](deploy-one-click.md) walks through it, including updates and backups. If you prefer your own server, use the Docker Compose steps in the [README](../README.md#quick-start) and read the [deployment guide](deploy.md) before exposing it to the internet.
3. **Create your admin account.** Open the app's link. The first visit asks you to create the admin.
4. **Create your first job.** Add the title and description, then check the pipeline stages. Rename, reorder, add, or remove stages to match how you actually hire. Open the job when you are ready for applications.
5. **Publish your careers page.** Open jobs appear at `/careers`. To serve it from your own domain or a path on your site, see the [careers page docs](careers.md).
6. **Invite your team.** Add interviewers and set their roles. Interviewers only see jobs they are on the hiring team for.
7. **Bring in the people you already have.** See the next section.
8. **Plan the interviews.** For each stage, set who runs the interview and what it covers, then use scorecards so feedback is collected the same way every time.

## Importing a spreadsheet

If your current candidates are in a spreadsheet, the CSV importer can bring them in. It is the same importer described in the [migration guide](why-pennyats.md#moving-from-another-ats), and it works with any CSV.

1. **Shape the sheet.** One row per candidate application. Each row needs a name and a valid email. Optional columns: phone, LinkedIn URL, location, source, job title, current stage, status, and applied date.
2. **Save as UTF-8 CSV.** Export from Google Sheets or Excel as CSV. Files are limited to 2 MB and 500 data rows, so split a larger sheet into batches.
3. **Create the jobs and stages first.** Job titles and stage names in the sheet must match what exists in PennyATS, or you can choose one destination job for rows without a job column.
4. **Import.** Open **Candidates, then Import CSV**, map your columns, and read the preview. Fix invalid and duplicate rows, then import.
5. **Check the result.** Compare counts with your sheet and spot-check a few people.

Candidates are matched by email, and an application that already exists for the same candidate and job is skipped, so re-running a corrected batch does not create duplicates. The importer does not bring over resume files, notes, emails, or interview history. If you have resumes in a folder or inbox, add them to the matching candidate profiles by hand. There is no automatic undo for an import, so take a [database backup](deploy.md#persistent-data-and-backups) first.

## Things to decide early

- **Who operates it.** Someone has to own updates, backups, and what happens if the server is down. Pick that person before you collect real applicant data.
- **What you tell applicants.** The apply form has a privacy notice and an optional consent checkbox. Decide what they should say for your location and your hiring practices. PennyATS provides tools; it does not provide legal advice or certification.
- **How long you keep rejected candidates.** You can set a retention period for automatic deletion.
- **Email.** Check the [deployment guide](deploy.md) for what is configured out of the box and what you need to set up yourself.

## When you outgrow the basics

- Connect other tools through the [REST API and webhooks](api.md).
- Let an AI assistant work with your pipeline through the [MCP server](mcp.md), read-only unless you allow more.
- See the [roadmap](../ROADMAP.md) for what is planned.
