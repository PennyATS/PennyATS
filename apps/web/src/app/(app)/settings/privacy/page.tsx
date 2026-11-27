import { desc, eq } from "drizzle-orm";
import { apiKeys, auditLog, users } from "@pennyats/db";
import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { expiredCandidateIds, getPrivacySettings } from "@/lib/privacy";
import { MAX_RETENTION_MONTHS } from "@/lib/privacy-rules";
import { purgeNowAction, savePrivacyAction } from "./actions";

const ACTION_LABELS: Record<string, string> = {
  candidate_deleted: "Deleted a candidate",
  candidate_exported: "Exported a candidate's data",
  retention_purge: "Retention purge",
  privacy_settings_changed: "Changed privacy settings",
  api_key_created: "Created an API key",
  api_key_revoked: "Revoked an API key",
  webhook_created: "Added a webhook",
  webhook_changed: "Turned a webhook on or off",
  webhook_deleted: "Deleted a webhook",
  api_write: "Change through the API",
  workspace_exported: "Exported all hiring data",
  workspace_imported: "Imported hiring data",
  team_role_changed: "Changed a hiring team role",
};

/** Who did it: a person, a person's API key, or an AI agent using one. */
function actorText(entry: { action: string; actor: string | null; actorType: string; keyName: string | null; data: Record<string, unknown> }) {
  const key = entry.keyName ?? (typeof entry.data.key === "string" ? entry.data.key : "an API key");
  if (entry.actorType === "agent") return `Agent ${typeof entry.data.agent === "string" ? `"${entry.data.agent}" ` : ""}via ${key}, as ${entry.actor ?? "a removed user"}`;
  if (entry.actorType === "system") return entry.action === "retention_purge" ? "Scheduled job" : "Command line";
  if (entry.actorType === "api_key") return `${key}, as ${entry.actor ?? "a removed user"}`;
  return entry.actor ?? "Scheduled job";
}

export default async function PrivacySettingsPage() {
  // Head of Talent reads the audit log here; only people who manage settings change them.
  const user = await requireUser("audit.view");
  const manage = can(user, "settings.manage");
  const settings = await getPrivacySettings();
  const [expired, log] = await Promise.all([
    settings.retentionMonths ? expiredCandidateIds(settings.retentionMonths) : Promise.resolve([]),
    db()
      .select({
        action: auditLog.action,
        data: auditLog.data,
        createdAt: auditLog.createdAt,
        actor: users.name,
        actorType: auditLog.actorType,
        keyName: apiKeys.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .leftJoin(apiKeys, eq(apiKeys.id, auditLog.apiKeyId))
      .orderBy(desc(auditLog.createdAt))
      .limit(25),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
      <p className="muted mt-1 max-w-2xl text-sm">
        Settings for handling candidate data. This helps with obligations like GDPR and CCPA but isn&apos;t
        legal advice; check what applies to you.
      </p>

      {manage && <>
      <h2 className="mt-8 text-lg font-semibold">Careers page notice</h2>
      <ActionForm resetKey={JSON.stringify(settings)} action={savePrivacyAction} className="card mt-3 max-w-2xl space-y-4">
        <div>
          <label className="label" htmlFor="noticeText">
            Notice shown on the apply form
          </label>
          <textarea
            id="noticeText"
            name="noticeText"
            rows={4}
            className="input"
            defaultValue={settings.noticeText ?? ""}
            placeholder="e.g. We use your application to assess you for this role and keep it for 24 months. You can ask us to delete it at any time."
          />
        </div>
        <div>
          <label className="label" htmlFor="noticeUrl">
            Privacy policy link
          </label>
          <input
            id="noticeUrl"
            name="noticeUrl"
            type="url"
            className="input"
            defaultValue={settings.noticeUrl ?? ""}
            placeholder="https://"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="requireConsent" defaultChecked={settings.requireConsent} />
          Require applicants to tick a box agreeing to the notice
        </label>

        <div className="max-w-xs">
          <label className="label" htmlFor="retentionMonths">
            Delete rejected and withdrawn candidates after (months)
          </label>
          <input
            id="retentionMonths"
            name="retentionMonths"
            type="number"
            min={1}
            max={MAX_RETENTION_MONTHS}
            className="input"
            defaultValue={settings.retentionMonths ?? ""}
            placeholder="Never"
          />
          <p className="muted mt-1 text-xs">
            Counted from their last activity. Candidates with an active or hired application are never deleted.
          </p>
        </div>
        <SubmitButton>Save privacy settings</SubmitButton>
      </ActionForm>

      {settings.retentionMonths && (
        <>
          <h2 className="mt-10 text-lg font-semibold">Past the retention period</h2>
          <p className="muted mt-1 max-w-2xl text-sm">
            {expired.length === 0
              ? "Nobody right now."
              : `${expired.length} candidate${expired.length === 1 ? " has" : "s have"} had no activity for ${settings.retentionMonths} months.`}{" "}
            To run this automatically, schedule <code>pnpm privacy:purge</code> (for example daily with cron).
          </p>
          {expired.length > 0 && (
            <ActionForm action={purgeNowAction} className="card mt-3 max-w-2xl space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirm" required />
                I understand this permanently deletes these candidates, their resumes, scorecards, and notes.
              </label>
              <SubmitButton>Delete {expired.length} now</SubmitButton>
            </ActionForm>
          )}
        </>
      )}

      <h2 className="mt-10 text-lg font-semibold">Export all hiring data</h2>
      <p className="muted mt-1 max-w-2xl text-sm">
        Jobs, candidates, applications with their stage history, interviews, scorecards, and notes in the{" "}
        PennyATS open data format (<code>docs/schema</code>), for backups or moving to another instance. The file
        contains candidate data, so store it as carefully as the database. Downloads are recorded below.
      </p>
      <a className="btn btn-secondary mt-3 inline-block" href="/api/export/workspace" download>
        Download all hiring data
      </a>
      </>}

      <h2 className="mt-10 text-lg font-semibold">Audit log</h2>
      <p className="muted mt-1 text-sm">Proof that requests were handled. Deleted people&apos;s details are never kept here.</p>
      {log.length === 0 ? (
        <p className="muted mt-3 text-sm">Nothing yet.</p>
      ) : (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>Who</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {log.map((entry, i) => (
              <tr key={i}>
                <td>{entry.createdAt.toLocaleString()}</td>
                <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                <td>{actorText(entry)}</td>
                <td className="muted">
                  {typeof entry.data.count === "number" && `${entry.data.count} deleted. `}
                  {typeof entry.data.reason === "string" && entry.data.reason}
                  {entry.action === "api_write" && `${String(entry.data.method)} ${String(entry.data.route)}`}
                  {typeof entry.data.name === "string" && entry.action.startsWith("api_key") && `${entry.data.name} `}
                  {typeof entry.data.url === "string" && entry.data.url}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
