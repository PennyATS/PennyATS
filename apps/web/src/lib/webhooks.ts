/**
 * Outgoing webhooks. Events are queued in `webhook_deliveries` inside the same transaction as
 * the change they describe, then sent by `deliverDueWebhooks()`, which retries failures with
 * exponential backoff. No Next.js imports, so `scripts/webhooks-deliver.mts` can use it.
 *
 * Payloads carry ids and stage names only, never names or contact details: a receiver that
 * needs more fetches it through the API with its own scoped key.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { webhookDeliveries, webhooks, type Db } from "@pennyats/db";
import { db } from "./db";
import { isDemoMode } from "./demo";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

import { WEBHOOK_EVENT_NAMES, type WebhookEvent } from "./webhook-events";

export const WEBHOOK_EVENTS = WEBHOOK_EVENT_NAMES;
export type { WebhookEvent };

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export const MAX_ATTEMPTS = 8;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
/** How long a claimed delivery stays hidden from other senders before it counts as abandoned. */
const LEASE_SECONDS = 120;

/** Delay before retry number `attempt` (1 = after the first failure): 30s, 1m, 2m, ... capped at 6h. */
export function retryDelayMs(attempt: number, baseMs = Number(process.env.WEBHOOK_RETRY_BASE_MS) || 30_000): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
}

/* ---------- Signing ---------- */

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, the value of the PennyATS-Signature header. */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

/**
 * Check a PennyATS-Signature header. Receivers can copy this function. Rejects signatures
 * older than `toleranceSeconds` so a captured request can't be replayed later.
 */
export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/* Signing secrets must be readable again to sign, so they are encrypted rather than hashed. */
function secretKey() {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required to store webhook secrets.");
  return createHash("sha256").update("pennyats-webhook-secret-v1\0").update(process.env.AUTH_SECRET).digest();
}

export function sealWebhookSecret(secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), nonce);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

export function openWebhookSecret(value: string): string {
  const [nonce, tag, data] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!nonce || !tag || !data || nonce.length !== 12 || tag.length !== 16) throw new Error("Invalid webhook secret.");
  const cipher = createDecipheriv("aes-256-gcm", secretKey(), nonce);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}

/* ---------- Queue ---------- */

/**
 * Queue one event for every active webhook subscribed to it. Call inside the transaction that
 * makes the change, then call `deliverDueWebhooks()` after it commits.
 */
export async function queueWebhookEvent(
  ex: Executor,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  candidateId: string | null,
): Promise<number> {
  const targets = await ex
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.active, true), sql`${event} = any(${webhooks.events})`));
  if (targets.length === 0) return 0;
  const eventId = randomUUID();
  await ex.insert(webhookDeliveries).values(
    targets.map((t) => ({ webhookId: t.id, eventId, event, payload, candidateId })),
  );
  return targets.length;
}

/** The JSON body sent to receivers. Stable across retries. */
export function webhookBody(row: { eventId: string; event: string; payload: unknown; createdAt: Date }): string {
  return JSON.stringify({ id: row.eventId, type: row.event, created_at: row.createdAt.toISOString(), data: row.payload });
}

type Claimed = {
  id: string;
  event_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string | Date;
  url: string;
  secret_encrypted: string;
  active: boolean;
};

let running: Promise<number> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Send every delivery that is due. Safe to call often and from several processes: rows are
 * claimed with SKIP LOCKED and a short lease. Returns how many were attempted. In a long-running
 * server it also sets a timer for the next retry; `pnpm webhooks:deliver` covers restarts.
 */
export function deliverDueWebhooks(): Promise<number> {
  // The public demo never makes outbound requests; deliveries stay queued until the reset.
  if (isDemoMode()) return Promise.resolve(0);
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    try {
      do {
        again = false;
        total += await deliverBatch();
      } while (again);
      await scheduleNext();
    } catch (err) {
      console.error("Webhook delivery failed:", err instanceof Error ? err.message : err);
    } finally {
      running = null;
    }
    return total;
  })();
  return running;
}

async function deliverBatch(): Promise<number> {
  let attempted = 0;
  for (;;) {
    const rows = Array.from(
      await db().execute<Claimed>(sql`
        with due as (
          select id from webhook_deliveries
          where status = 'pending' and next_attempt_at <= now()
          order by next_attempt_at
          limit 25
          for update skip locked
        )
        update webhook_deliveries d
        set attempts = d.attempts + 1, next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS})
        from due, webhooks w
        where d.id = due.id and w.id = d.webhook_id
        returning d.id, d.event_id, d.event, d.payload, d.attempts, d.created_at, w.url, w.secret_encrypted, w.active
      `),
    );
    if (rows.length === 0) return attempted;
    attempted += rows.length;
    await Promise.all(rows.map(sendOne));
  }
}

async function sendOne(row: Claimed): Promise<void> {
  if (!row.active) {
    await finish(row, { ok: false, status: null, error: "Webhook is turned off." }, true);
    return;
  }
  const body = webhookBody({ eventId: row.event_id, event: row.event, payload: row.payload, createdAt: new Date(row.created_at) });
  let result: { ok: boolean; status: number | null; error: string | null };
  try {
    const res = await fetch(row.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "PennyATS-Webhooks/1",
        "PennyATS-Event": row.event,
        "PennyATS-Event-Id": row.event_id,
        "PennyATS-Delivery": row.id,
        "PennyATS-Signature": signWebhook(openWebhookSecret(row.secret_encrypted), body),
      },
      body,
    });
    await res.body?.cancel().catch(() => {});
    result = res.ok ? { ok: true, status: res.status, error: null } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    result = { ok: false, status: null, error: timedOut ? "Timed out after 10 seconds." : "Could not connect." };
  }
  await finish(row, result, false);
}

async function finish(
  row: Claimed,
  result: { ok: boolean; status: number | null; error: string | null },
  giveUp: boolean,
): Promise<void> {
  const exhausted = giveUp || row.attempts >= MAX_ATTEMPTS;
  await db()
    .update(webhookDeliveries)
    .set(
      result.ok
        ? { status: "delivered", deliveredAt: new Date(), lastStatusCode: result.status, lastError: null }
        : {
            status: exhausted ? "failed" : "pending",
            lastStatusCode: result.status,
            lastError: result.error,
            nextAttemptAt: new Date(Date.now() + retryDelayMs(row.attempts)),
          },
    )
    .where(eq(webhookDeliveries.id, row.id));
}

async function scheduleNext(): Promise<void> {
  const [next] = Array.from(
    await db().execute<{ at: string | null }>(
      sql`select min(next_attempt_at) as at from webhook_deliveries where status = 'pending'`,
    ),
  );
  if (!next?.at) return;
  const wait = Math.max(250, new Date(next.at).getTime() - Date.now());
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void deliverDueWebhooks();
  }, wait);
  timer.unref?.();
}

/** Send a delivery again now, for example after fixing the receiving server. */
export async function redeliver(deliveryId: string): Promise<boolean> {
  const rows = await db()
    .update(webhookDeliveries)
    .set({ status: "pending", nextAttemptAt: new Date(), attempts: 0 })
    .where(eq(webhookDeliveries.id, deliveryId))
    .returning({ id: webhookDeliveries.id });
  if (rows.length) void deliverDueWebhooks();
  return rows.length > 0;
}
