# PennyATS roadmap

This is the in-repo copy of the roadmap, written so people and AI agents (Claude, ChatGPT Codex, Cursor) can read it without opening GitHub Projects. The GitHub issues and the project board are the live source of truth for status. This file explains direction and links to the issues. Umbrella issue: #113.

## Where this is headed

PennyATS aims to be a near one-to-one open source alternative to Ashby and Greenhouse that a founder can run on their own Postgres, so the monthly ATS bill is no longer a budget question for early-stage teams. The goal is to match the everyday experience, then differ where a hosted product is structurally different: PennyATS is open source, self-hosted on the company's own Postgres, has no per-seat pricing, and its code can be audited by anyone. An agent-ready API and MCP server are table stakes, not a moat: Ashby and Greenhouse both offer public APIs and official MCP servers, so PennyATS has to match them there rather than claim an advantage.

## Principles

- **Agent-ready first.** The API and agent interface are a core product surface, not an add-on. Anything a person can do in the UI should be doable through the API.
- **Proof over claims.** Publish test results, a threat model, screenshots, and demo videos instead of asking people to trust a badge.
- **Built for compliance, not certified.** Code cannot hold a certification. Document what the software helps with and what the deployer must do. No HIPAA claims; hiring data is not normally protected health information (#122).
- **Security from the start.** Retrofitting security is expensive, so these items come early.
- **Original design.** Match the flow and features of Ashby and Greenhouse, never their branding or code.
- **AI stays optional.** Every AI feature is off by default and uses the admin's own key.

## 1. Agent-ready platform (crucial)

- [#115](https://github.com/PennyATS/PennyATS/issues/115) Public REST API with OpenAPI spec, scoped API keys, and webhooks. **Shipped** in [#127](https://github.com/PennyATS/PennyATS/pull/127): see [docs/api.md](docs/api.md).
- [#116](https://github.com/PennyATS/PennyATS/issues/116) MCP server so Claude, ChatGPT, and Cursor can operate PennyATS (read-only mode, confirmation for destructive actions, audit logged). **Shipped**: see [docs/mcp.md](docs/mcp.md). Follow-up: OAuth on the HTTP endpoint for clients that can't send an API key header.
- [#114](https://github.com/PennyATS/PennyATS/issues/114) Open, versioned data schema the ecosystem can build on. **Shipped**: see [docs/schema](docs/schema/README.md) (JSON Schema, compatibility policy, workspace export and import).
- [#117](https://github.com/PennyATS/PennyATS/issues/117) Integration points for sourcing tools, schedulers, and AI assistants (relates to #26 and #43). **Shipped**: see [docs/integrations.md](docs/integrations.md) and the reference integrations in [`examples/`](examples).

## 2. Security and access

Already planned: permission model and role presets ([#94](https://github.com/PennyATS/PennyATS/issues/94), [#95](https://github.com/PennyATS/PennyATS/issues/95)), job-level access and confidential jobs ([#96](https://github.com/PennyATS/PennyATS/issues/96)), sensitive data rules ([#97](https://github.com/PennyATS/PennyATS/issues/97)), audit log for access changes ([#102](https://github.com/PennyATS/PennyATS/issues/102)), sessions, password policy, and two-factor ([#103](https://github.com/PennyATS/PennyATS/issues/103)), and single sign-on ([#104](https://github.com/PennyATS/PennyATS/issues/104)). The role-based access epic is [#93](https://github.com/PennyATS/PennyATS/issues/93).

- #94 permission model: **shipped**. Every check is `can(user, permission)` from `apps/web/src/lib/permissions.ts`, shared by the UI, the API, and the MCP server, with a role x permission snapshot test.
- #95 role presets: **shipped**. Admin, Head of Talent, Talent Acquisition Manager, Recruiter, Recruiting Coordinator, Hiring Manager, Interviewer, and Executive, stored in a `roles` table, described on the Users page, with one demo user each.
- #96 job-level access: **shipped**. Hiring team roles (hiring manager, recruiter, coordinator, interviewer, viewer) grant permissions on that job only; confidential jobs are visible only to their team and to Admin and Head of Talent; "My jobs" filters on the jobs list and jobs dashboard.

Added:

- [#119](https://github.com/PennyATS/PennyATS/issues/119) Postgres row-level security as defense in depth
- [#118](https://github.com/PennyATS/PennyATS/issues/118) Encryption at rest and field-level encryption for sensitive data
- [#120](https://github.com/PennyATS/PennyATS/issues/120) Signed releases, SBOM, provenance, and supply-chain scanning in CI
- [#121](https://github.com/PennyATS/PennyATS/issues/121) Published threat model and security test results

## 3. Compliance

- [#122](https://github.com/PennyATS/PennyATS/issues/122) Built-for-compliance features and honest documentation: EEO self-identification kept apart from reviewers, request tracking, GDPR and CCPA guidance for self-hosters, readiness notes for AI hiring rules such as New York City Local Law 144

Builds on the privacy tools that already ship: notice and consent, export, permanent deletion, retention purge, and the audit log.

## 4. Candidate experience and careers page

- [#123](https://github.com/PennyATS/PennyATS/issues/123) Near one-to-one parity with the Ashby and Greenhouse apply flow, served from the company's own domain or subpath (for example acme.com/careers), with job posting structured data for search
- Related: custom branding [#25](https://github.com/PennyATS/PennyATS/issues/25), resume parsing in deferred ideas [#21](https://github.com/PennyATS/PennyATS/issues/21)

## 5. Proof and credibility

- [#125](https://github.com/PennyATS/PennyATS/issues/125) End-to-end hiring-cycle test matrix with published screenshots and a demo video
- [#124](https://github.com/PennyATS/PennyATS/issues/124) Why switch: dated, cited cost comparison, tradeoffs, and a migration guide (uses CSV import [#20](https://github.com/PennyATS/PennyATS/issues/20))

## 6. Onboarding for non-technical founders

The target user is often a founder or founding recruiter adopting their first ATS, without a terminal or a database background.

- [#10](https://github.com/PennyATS/PennyATS/issues/10) Public demo with fictional data that resets automatically. Demo mode and the scheduled reset are built and tested in CI ([docs/demo.md](docs/demo.md)); the demo is not hosted yet because that needs a hosting account.
- [#131](https://github.com/PennyATS/PennyATS/issues/131) One-click deploy buttons for hosts that bundle a database, with generated secrets, persistent uploads, and a plain-language guide. Render blueprint, Railway config, and the one-click image are built and smoke tested in CI ([docs/deploy-one-click.md](docs/deploy-one-click.md)); still needs a clean-account run on each host, the Railway template, and screenshots.
- [#132](https://github.com/PennyATS/PennyATS/issues/132) First-run setup wizard for email, calendar, and AI, with Test buttons and skippable steps. The checklist (Admin, Setup checklist, and a card on Home) is built with a browser test; a timed run by a first-time user is still to do.

## Already on the roadmap

- Access and administration: [#93](https://github.com/PennyATS/PennyATS/issues/93) to [#105](https://github.com/PennyATS/PennyATS/issues/105)
- Scheduling suite: [#43](https://github.com/PennyATS/PennyATS/issues/43)
- Before launch: [#8](https://github.com/PennyATS/PennyATS/issues/8), [#6](https://github.com/PennyATS/PennyATS/issues/6) (the public demo, #10, is in section 6)
- Proposals still to scope: agency portal [#24](https://github.com/PennyATS/PennyATS/issues/24), sourcing extension [#26](https://github.com/PennyATS/PennyATS/issues/26), expanded analytics [#28](https://github.com/PennyATS/PennyATS/issues/28)

## For agents

- Before planning or proposing work, read this file and the linked issue.
- Create or update a GitHub issue for any new request, as `AGENTS.md` requires, and link it here when it changes the direction.
- Do not describe an item as shipped until its issue is closed and its verification passes.
