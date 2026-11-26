import { and, desc, eq, inArray } from "drizzle-orm";
import { apiKeys, auditLog, users, webhookDeliveries, webhooks } from "@pennyats/db";
import { LocalTime } from "@/components/local-time";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { keyLabel, keyUsable } from "@/lib/api/keys";
import { READ_SCOPES, SCOPE_DESCRIPTIONS, SCOPES } from "@/lib/api/scopes";
import { canManageUsers } from "@/lib/permissions";
import { WEBHOOK_EVENT_DESCRIPTIONS, WEBHOOK_EVENT_NAMES } from "@/lib/webhook-events";
import { MAX_ATTEMPTS } from "@/lib/webhooks";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  redeliverAction,
  revokeApiKeyAction,
  setWebhookActiveAction,
} from "./actions";
import { SecretForm } from "./secret-form";

export default async function ApiSettingsPage() {
  const admin = await requireUser(canManageUsers);
  const [keys, people, hooks, deliveries, activity] = await Promise.all([
    db()
      .select({ key: apiKeys, user: users.name, role: users.role })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .orderBy(desc(apiKeys.createdAt)),
    db()
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(users.name),
    db().select().from(webhooks).orderBy(desc(webhooks.createdAt)),
    db()
      .select({
        id: webhookDeliveries.id,
        event: webhookDeliveries.event,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        code: webhookDeliveries.lastStatusCode,
        error: webhookDeliveries.lastError,
        createdAt: webhookDeliveries.createdAt,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        url: webhooks.url,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(25),
    db()
      .select({ data: auditLog.data, actorType: auditLog.actorType, createdAt: auditLog.createdAt, keyName: apiKeys.name })
      .from(auditLog)
      .leftJoin(apiKeys, eq(apiKeys.id, auditLog.apiKeyId))
      .where(and(eq(auditLog.action, "api_write"), inArray(auditLog.actorType, ["api_key", "agent"])))
      .orderBy(desc(auditLog.createdAt))
      .limit(15),
  ]);
  const now = new Date();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">API and webhooks</h1>
      <p className="muted mt-1 max-w-2xl text-sm">
        Let scripts, integrations, and AI agents work with your hiring data. A key acts as one teammate and can never do
        more than they can: interviewer keys only see their jobs, and scorecards stay hidden until that person submits
        their own. Scopes narrow it further. Every change made with a key is in the audit log. See{" "}
        <a className="link" href="/api/v1/openapi.json">
          the OpenAPI document
        </a>{" "}
        and <code>docs/api.md</code>.
      </p>

      <h2 className="mt-8 text-lg font-semibold">New API key</h2>
      <SecretForm action={createApiKeyAction} submitLabel="Create key">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="key-name">
              Name
            </label>
            <input id="key-name" name="name" className="input" required maxLength={100} placeholder="e.g. Claude agent, Zapier" />
          </div>
          <div>
            <label className="label" htmlFor="key-user">
              Acts as
            </label>
            <select id="key-user" name="userId" className="input" defaultValue={admin.id}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.role})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="key-expiry">
              Expires
            </label>
            <select id="key-expiry" name="expiresInDays" className="input" defaultValue="90">
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In a year</option>
              <option value="never">Never</option>
            </select>
          </div>
        </div>
        <fieldset>
          <legend className="label">Scopes</legend>
          <p className="muted mb-2 text-xs">
            Read scopes are ticked to start. Scopes the chosen person&apos;s role can&apos;t use are dropped when the key is
            created.
          </p>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {SCOPES.map((scope) => (
              <label key={scope} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="scopes" value={scope} defaultChecked={READ_SCOPES.includes(scope)} className="mt-1" />
                <span>
                  <code>{scope}</code> <span className="muted">{SCOPE_DESCRIPTIONS[scope]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </SecretForm>

      <h2 className="mt-10 text-lg font-semibold">Keys</h2>
      {keys.length === 0 ? (
        <p className="muted mt-3 text-sm">No keys yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Acts as</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Expires</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map(({ key, user, role }) => {
                const state = keyUsable(key, now);
                return (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td>
                      <code>{keyLabel(key.prefix)}</code>
                    </td>
                    <td>
                      {user} <span className="muted">({role})</span>
                    </td>
                    <td className="text-xs">{key.scopes.join(", ")}</td>
                    <td>{key.lastUsedAt ? <LocalTime iso={key.lastUsedAt.toISOString()} /> : <span className="muted">Never</span>}</td>
                    <td>{key.expiresAt ? <LocalTime iso={key.expiresAt.toISOString()} withTime={false} /> : "Never"}</td>
                    <td>{state === "ok" ? "Active" : state === "revoked" ? "Revoked" : "Expired"}</td>
                    <td>
                      {state === "ok" && (
                        <form action={revokeApiKeyAction.bind(null, key.id)}>
                          <button type="submit" className="btn btn-secondary">
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold">Recent API activity</h2>
      {activity.length === 0 ? (
        <p className="muted mt-3 text-sm">No changes made through the API yet.</p>
      ) : (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>When</th>
              <th>Key</th>
              <th>Who</th>
              <th>Request</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((entry, i) => (
              <tr key={i}>
                <td>
                  <LocalTime iso={entry.createdAt.toISOString()} />
                </td>
                <td>{entry.keyName ?? String(entry.data.key ?? "")}</td>
                <td>{entry.actorType === "agent" ? `Agent (${String(entry.data.agent ?? "unnamed")})` : "Script"}</td>
                <td>
                  <code className="text-xs">
                    {String(entry.data.method)} {String(entry.data.route)}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-10 text-lg font-semibold">New webhook</h2>
      <p className="muted mt-1 max-w-2xl text-sm">
        We POST a JSON event to your URL, signed with HMAC-SHA256 in the <code>PennyATS-Signature</code> header. Payloads
        hold ids and stage names only, no names or contact details. Failed deliveries are retried {MAX_ATTEMPTS} times
        with growing gaps. If your server restarts often, schedule <code>pnpm webhooks:deliver</code> every few minutes.
      </p>
      <SecretForm action={createWebhookAction} submitLabel="Add webhook">
        <div>
          <label className="label" htmlFor="hook-url">
            URL
          </label>
          <input id="hook-url" name="url" type="url" className="input" required placeholder="https://" />
        </div>
        <fieldset>
          <legend className="label">Events</legend>
          {WEBHOOK_EVENT_NAMES.map((event) => (
            <label key={event} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="events" value={event} defaultChecked className="mt-1" />
              <span>
                <code>{event}</code> <span className="muted">{WEBHOOK_EVENT_DESCRIPTIONS[event]}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </SecretForm>

      <h2 className="mt-10 text-lg font-semibold">Webhooks</h2>
      {hooks.length === 0 ? (
        <p className="muted mt-3 text-sm">No webhooks yet.</p>
      ) : (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>URL</th>
              <th>Events</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {hooks.map((hook) => (
              <tr key={hook.id}>
                <td className="break-all">{hook.url}</td>
                <td className="text-xs">{hook.events.join(", ")}</td>
                <td>{hook.active ? "On" : "Off"}</td>
                <td>
                  <div className="flex gap-2">
                    <form action={setWebhookActiveAction.bind(null, hook.id, !hook.active)}>
                      <button type="submit" className="btn btn-secondary">
                        {hook.active ? "Turn off" : "Turn on"}
                      </button>
                    </form>
                    <form action={deleteWebhookAction.bind(null, hook.id)}>
                      <button type="submit" className="btn btn-secondary">
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-10 text-lg font-semibold">Delivery log</h2>
      {deliveries.length === 0 ? (
        <p className="muted mt-3 text-sm">Nothing sent yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>To</th>
                <th>Result</th>
                <th>Attempts</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td>
                    <LocalTime iso={d.createdAt.toISOString()} />
                  </td>
                  <td>
                    <code className="text-xs">{d.event}</code>
                  </td>
                  <td className="break-all text-xs">{d.url}</td>
                  <td>
                    {d.status === "delivered"
                      ? `Delivered${d.code ? ` (${d.code})` : ""}`
                      : d.status === "failed"
                        ? `Gave up: ${d.error ?? "failed"}`
                        : d.attempts === 0
                          ? "Queued"
                          : `Retrying: ${d.error ?? ""}`}
                    {d.status === "pending" && d.attempts > 0 && (
                      <span className="muted">
                        {" "}
                        (next <LocalTime iso={d.nextAttemptAt.toISOString()} />)
                      </span>
                    )}
                  </td>
                  <td>{d.attempts}</td>
                  <td>
                    {d.status !== "pending" && (
                      <form action={redeliverAction.bind(null, d.id)}>
                        <button type="submit" className="btn btn-secondary">
                          Send again
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
