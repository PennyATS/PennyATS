import { desc, eq } from "drizzle-orm";
import { auditLog, users } from "@pennyats/db";
import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/permissions";
import { expiredCandidateIds, getPrivacySettings } from "@/lib/privacy";
import { MAX_RETENTION_MONTHS } from "@/lib/privacy-rules";
import { purgeNowAction, savePrivacyAction } from "./actions";

const ACTION_LABELS: Record<string, string> = {
  candidate_deleted: "Deleted a candidate",
  candidate_exported: "Exported a candidate's data",
  retention_purge: "Retention purge",
  privacy_settings_changed: "Changed privacy settings",
};

export default async function PrivacySettingsPage() {
  await requireUser(canManageUsers);
  const settings = await getPrivacySettings();
  const [expired, log] = await Promise.all([
    settings.retentionMonths ? expiredCandidateIds(settings.retentionMonths) : Promise.resolve([]),
    db()
      .select({ action: auditLog.action, data: auditLog.data, createdAt: auditLog.createdAt, actor: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
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

      <h2 className="mt-8 text-lg font-semibold">Careers page notice</h2>
      {/* Keyed on the saved values so the form shows them after React resets it post-submit. */}
      <ActionForm key={JSON.stringify(settings)} action={savePrivacyAction} className="card mt-3 max-w-2xl space-y-4">
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
                <td>{entry.actor ?? "Scheduled job"}</td>
                <td className="muted">
                  {typeof entry.data.count === "number" && `${entry.data.count} deleted. `}
                  {typeof entry.data.reason === "string" && entry.data.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
