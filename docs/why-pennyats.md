# Why switch to PennyATS?

PennyATS is an early-preview, open-source applicant tracking system you run with your own Postgres database. It has no per-seat software fee. You control the database and can [export a versioned copy of your workspace](schema/README.md). In return, your team operates the server and decides how to handle backups, updates, access, and support. If you want a managed service with a broad, mature recruiting suite, a hosted ATS may be the better purchase.

## What does it cost?

**Prices checked November 27, 2026 (USD).** Vendor prices and packaging can change; check the linked pages before making a decision. This is a comparison of published prices, not a quote for identical products.

| Option | Public price information | What to check |
| --- | --- | --- |
| PennyATS | No per-seat software fee under its [MIT license](../LICENSE); you pay for hosting and operations. | The example below covers infrastructure only. |
| Ashby | Its [pricing page](https://www.ashbyhq.com/pricing) displays **$400/month** for the All-In-One Foundations selection shown when checked. The page has company-size and payment-term selectors, offers an annual-commitment discount, and asks you to contact sales for Plus and Enterprise. | Get a quote for your headcount, term, add-ons, and region; the displayed selection is not a universal starting price. |
| Greenhouse | Its [pricing page](https://www.greenhouse.com/pricing) lists Core, Plus, and Pro but no fixed dollar price. Greenhouse says pricing is customized to plan, hiring needs, volume, and complexity. | Request a written quote for the plan and services you need. |

### A small-team self-hosting example

One illustrative setup is a single DigitalOcean Basic virtual machine running PennyATS, Postgres, and persistent uploads, with a weekly machine backup and separate object storage for copies of database and upload backups. At the prices checked November 27, 2026:

| Item | Monthly example | Source |
| --- | ---: | --- |
| Basic VM, 2 vCPU, 4 GiB RAM, 80 GiB disk | $24.00 | [DigitalOcean Droplets](https://www.digitalocean.com/pricing/droplets) |
| Weekly machine backup, 20% of VM price | $4.80 | [DigitalOcean backup pricing](https://docs.digitalocean.com/products/backups/details/pricing/) |
| Spaces subscription for off-host backup copies, within the included storage | $5.00 | [DigitalOcean Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/) |
| **Illustrative infrastructure total** | **$33.80/month** | Sum of the three lines above |

This is a budgeting example, **not a tested sizing or availability guarantee**. It runs app and database on one host, so a host failure stops both. Machine snapshots alone are not a complete database recovery plan. Arrange encrypted database and upload backups to separate storage, test a restore, and set a retention schedule; the [deployment guide](deploy.md#persistent-data-and-backups) shows what must be backed up. The Spaces line budgets backup storage, not live resume storage: PennyATS currently saves uploads to a persistent local volume.

The total excludes a domain, transactional email, monitoring, any paid AI usage or integrations, extra storage or traffic, taxes, and your team's time to patch the server, handle incidents, and answer user questions. Managed Postgres, redundancy, or a larger VM will cost more. Compare **total operating cost and needed features**, not just the monthly infrastructure line.

## What you gain and what you take on

- **Control and portability:** The app and Postgres run in your environment, and the [open data format](schema/README.md) supports export and import. Your team is responsible for access to the host and exported files.
- **Recruiting workflow:** PennyATS has jobs, applications, stages, candidate review, interview plans, scorecards, reports, a careers page, API, and optional AI. Check the [README](../README.md#what-works-today) and [roadmap](../ROADMAP.md) for the current state; this is an early preview, not feature parity with a mature hosted suite.
- **Hosted-suite advantages:** Ashby and Greenhouse package managed hosting, support, and broader scheduling, sourcing, automation, and integration options. Their current [Ashby plan comparison](https://www.ashbyhq.com/pricing) and [Greenhouse plan comparison](https://www.greenhouse.com/pricing) show capabilities that may justify their price for your team. Compare the exact plan and add-ons in a trial.
- **Operator work:** With PennyATS, your team owns upgrades, uptime, backups and restore drills, email delivery, security configuration, and applicable privacy or hiring compliance processes. Self-hosting does not confer a certification; see the [security policy](../SECURITY.md) and [deployment guide](deploy.md).

## Moving from another ATS

The candidate CSV import in [#20](https://github.com/PennyATS/PennyATS/issues/20) is for **current candidate and application data**. It maps name, email, phone, LinkedIn URL, location, source, job title, current stage, status, and applied date. It matches candidates by email and skips an application already present for the same candidate and job, so a clean rerun does not duplicate it. It does **not** bring over resume files, notes, emails, interviews, scorecards, or the sequence of historical stage changes. Keep your source export for records you must retain.

1. **Inventory and back up.** List active and closed jobs, pipeline stages, candidate counts, required history, attachments, integrations, and retention obligations. Export a complete source-system backup where your plan permits it. Keep it encrypted and access-limited.
2. **Get a tabular candidate export.** Greenhouse's [Essential candidate report](https://support.greenhouse.io/hc/en-us/articles/360042740232-Essential-candidate-report) can email an XLS file, with one row per candidate application; choose filters that include closed jobs and rejected applications if needed, then save a working copy as UTF-8 CSV. Ashby's [candidate export guide](https://docs.ashbyhq.com/how-do-i-export-candidate-data) describes a custom-list CSV export for eligible plans; it says that route is unavailable on Foundations and bulk resume export is not available in-app. Ask the vendor about other export options for your plan. For another ATS, obtain a CSV with one row per application where possible.
3. **Prepare PennyATS.** Create the destination jobs and stages first. Their titles must match mapped job and stage values, or choose one destination job for rows without a job column. Take a [PennyATS database and uploads backup](deploy.md#persistent-data-and-backups) before importing.
4. **Map and preview.** Open **Candidates → Import CSV**. The importer suggests Greenhouse-style headers; you can map any CSV columns manually. Name and valid email are required for safe matching. Review invalid and duplicate rows before importing. Files are limited to 2 MB and 500 data rows, so split a larger export into batches. Verify dates, job titles, statuses, and stage names in the preview.
5. **Import and reconcile.** Import ready rows, then compare per-job counts with the source and spot-check contact details, current stages, statuses, and applied dates. Correct the source CSV and rerun a batch if needed; existing applications are skipped rather than overwritten. Enter any essential history or attachments separately.
6. **Cut over deliberately.** Set a time for a final export and delta import, switch careers links and recruiting workflows, and watch new applications. Keep the old system accessible under your retention and contract rules until the team signs off. If cutover fails, point new applications back to the old system and reconcile anything created in PennyATS before trying again; CSV import has no automatic undo.

For a move **between PennyATS instances**, use the [versioned workspace export and import](schema/README.md#export-and-import) instead of CSV. That route carries the supported application history, interviews, scorecards, and notes, subject to the format's documented exclusions.
