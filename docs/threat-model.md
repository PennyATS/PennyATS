# Threat model

What PennyATS protects, from whom, and how. Each threat links to the code that mitigates it and to the test that checks it, or is listed as an accepted risk. Tracked in [#121](https://github.com/PennyATS/PennyATS/issues/121). Report problems privately as described in [SECURITY.md](../SECURITY.md).

This describes the software. It is not a certification, and a deployment's own setup (HTTPS, database access, backups) is the deployer's responsibility.

## Assets

| Asset | Why it matters |
| --- | --- |
| Candidate records: contact details, resumes, notes, phone screen notes, scorecards, history | Personal data of people who never agreed to share it beyond hiring. The main asset. |
| Job data, including pay bands and confidential jobs | Confidential plans and compensation. |
| Accounts and sessions | Control of everything above. |
| API keys, webhook signing secrets, calendar tokens, the AI key | Let an attacker act as the instance elsewhere. |
| The audit log | Evidence that privacy requests were handled. |

## Actors

- **Anonymous visitor**: the careers page, apply form, candidate booking and availability links, login, invite and reset pages.
- **Candidate**: applies, books interviews through a link sent to them.
- **Signed-in user** with a role preset (Admin, Head of Talent, TA Manager, Recruiter, Coordinator, Hiring Manager, Interviewer, Executive) and hiring team roles per job.
- **API key or AI agent** acting as one user with a subset of scopes (including the MCP server).
- **AI provider** receiving prompts when an admin turns AI on.
- **Out of scope** (SECURITY.md): someone who already has admin access, the server, its environment, or the database.

## Trust boundaries

```mermaid
flowchart LR
  subgraph Internet
    V[Visitor / candidate]
    U[Signed-in user's browser]
    K[API client / MCP / agent]
  end
  subgraph Server["PennyATS server (Next.js)"]
    P[Public pages and apply action]
    A[Pages and server actions<br/>requireUser + can()]
    API["/api/v1 apiHandler<br/>key, scope, permission"]
    DBC[lib/db.ts<br/>acting user per statement]
  end
  subgraph DB["Postgres"]
    RLS[(Tables with row-level security<br/>role pennyats_app)]
  end
  AI[(AI provider)]
  WH[(Webhook receivers)]
  V -- HTTPS --> P
  U -- session cookie --> A
  K -- Bearer key --> API
  P & A & API --> DBC --> RLS
  A -- redacted prompt --> AI
  API -. signed events, ids only .-> WH
```

1. **Internet to server.** Everything from a browser or API client is untrusted. Authentication: session cookie (pages and actions) or API key (`/api/v1`).
2. **Server to database.** The app connects as a role that cannot bypass row-level security, and tells the database who is acting ([docs/rls.md](rls.md)).
3. **Server to third parties.** AI providers get redacted prompts with only what the feature needs; webhook receivers get ids and stage names, never names or contact details.

## Threats and mitigations

| ID | Threat | Mitigation (code) | Checked by |
| --- | --- | --- | --- |
| T1 | Clickjacking, MIME sniffing, leaking URLs in referrers | Security headers on every response, no `X-Powered-By` (`apps/web/next.config.ts`) | `security.spec.ts` T1 |
| T2 | Reaching a protected page, route, or API without signing in | `requireUser()` in every page, action, and route (`lib/auth.ts`); `apiHandler` key lookup (`lib/api/handler.ts`) | `security.spec.ts` T2; `api.spec.ts` authentication |
| T3 | Session theft or replay; password guessing | Random 256-bit tokens stored as SHA-256, `HttpOnly` + `SameSite=Lax` + `Secure` over HTTPS cookie, server-side revocation on sign-out and deactivation (`lib/auth.ts`); scrypt passwords (`packages/db/src/password.ts`); login rate limit (`lib/rate-limit.ts`) | `security.spec.ts` T3; `password.test.ts`; `rate-limit.test.ts` |
| T4 | A user reaching jobs, candidates, or admin pages their role doesn't allow (for example an interviewer on another job) | Named permissions with `can()` (`lib/permissions.ts`), job scoping (`visibleJobIds`, `requireJobAccess`), and row-level security as a second layer (`migrations/0026_row_level_security.sql`) | `security.spec.ts` T4; `permissions-matrix.test.ts`; `api.spec.ts`; `rls.spec.ts` |
| T5 | Reusing or guessing invite and reset links | Single-use tokens stored as SHA-256 with expiry (`app/(auth)/actions.ts`, `settings/users/actions.ts`) | `security.spec.ts` T5 |
| T6 | An uploaded resume running script in the app's origin; downloading someone else's resume | Resumes are always `attachment` with `nosniff`, unknown types as `application/octet-stream`, visibility checked (`app/api/resumes/[id]/route.ts`); upload type and size limits (`RESUME_EXTENSIONS`, `RESUME_MAX_BYTES` in `lib/validation.ts`) | `security.spec.ts` T6 |
| T7 | Bulk data exfiltration through exports | Candidate export needs `privacy.export`, workspace export `settings.manage`; both logged (`app/api/candidates/[id]/export`, `app/api/export/workspace`) | `security.spec.ts` T7 |
| T8 | Cross-site request forgery on server actions | Next.js rejects server action requests whose `Origin` doesn't match the host; cookies are `SameSite=Lax`; the API uses bearer keys, not cookies | `security.spec.ts` T8 |
| T9 | Spam and abuse through the public apply form | Honeypot field, rate limit, validation, file limits (`app/(public)/careers/actions.ts`) | `security.spec.ts` T9; `rate-limit.test.ts` |
| T10 | Sensitive fields shown to the wrong role (pay, phone screens, scorecards before submitting your own) | `jobs.view_compensation`, `notes.phone_screen.read`, blind review in `lib/scorecards.ts`, enforced again by RLS | `sensitive-data.spec.ts`; `rls.spec.ts` |
| T11 | An API key or agent doing more than its user | Scope and permission both required (`lib/api/scopes.ts`); MCP read-only by default and `confirm: true` for destructive tools (`packages/mcp`); agent activity in the audit log | `api.spec.ts`; `mcp.spec.ts` |
| T12 | Personal data sent to an AI provider | AI off by default; redaction of emails, phones, and links (`packages/redact`); prompts omit names they don't need (`lib/ai-rules.ts`) | `packages/redact` tests; `ai-rules.test.ts` |
| T13 | Secrets leaking from storage | API keys, sessions, and tokens hashed; webhook and calendar secrets encrypted with `AUTH_SECRET`, which must be set (`docker/app-start.sh`) | Compose CI job; `scheduling-secrets.test.ts` |
| T14 | A compromised dependency or tampered release | Dependency review, CodeQL, secret scanning, pinned actions, Dependabot, signed releases with SBOM and provenance ([SECURITY.md](../SECURITY.md#verifying-a-release)) | `security.yml`, `release.yml` |

## Planned mitigations

- **Encryption at rest and field-level encryption** for the most sensitive fields ([#118](https://github.com/PennyATS/PennyATS/issues/118)). **Planned, not built.** Today candidate data is protected at rest only by the database host's own disk encryption, if the deployer turns it on.
- **Content Security Policy.** Needs nonces for Next.js inline scripts ([#157](https://github.com/PennyATS/PennyATS/issues/157)).
- **Two-factor authentication and SSO** ([#103](https://github.com/PennyATS/PennyATS/issues/103), [#104](https://github.com/PennyATS/PennyATS/issues/104)).

## Accepted risks

- **Rate limits are per process** and in memory. Several instances behind a load balancer each count separately.
- **Name detection in AI redaction.** Redaction is pattern-based and does not catch names.
- **Owner connections bypass RLS.** Migrations, seeds, and CLI scripts run as the database owner.
- **Backups.** Deleting a candidate does not remove them from database or file backups; deployers handle backup expiry.
- **Public demo.** `DEMO_MODE` is for fictional data only and shares accounts between visitors.

## Findings from this review

Filed as issues so they are tracked:

- Missing security headers: fixed in this change (T1).
- No Content Security Policy yet: [#157](https://github.com/PennyATS/PennyATS/issues/157).

## Test results

The security suite (`apps/web/tests/integration/security.spec.ts`) runs with the rest of the integration tests in CI on every pull request and on `main`. The latest results are in the **Security test results** summary of the most recent [CI run on main](https://github.com/PennyATS/PennyATS/actions/workflows/ci.yml?query=branch%3Amain).
