"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { apiKeys, users, webhooks, roles } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_BLOCKED, isDemoMode } from "@/lib/demo";
import { generateApiKey, keyLabel } from "@/lib/api/keys";
import { normalizeScopes, scopesFor } from "@/lib/api/scopes";
import { isRole } from "@/lib/permissions";
import { logAudit } from "@/lib/privacy";
import { field, isHttpUrl, isUuid } from "@/lib/validation";
import { newWebhookSecret, redeliver, sealWebhookSecret } from "@/lib/webhooks";
import { WEBHOOK_EVENT_NAMES } from "@/lib/webhook-events";
import type { SecretState } from "./secret-form";

const EXPIRY_DAYS = new Set(["30", "90", "365"]);

/** Create a key. The full key is returned once, here, and never stored. */
export async function createApiKeyAction(_: SecretState, form: FormData): Promise<SecretState> {
  const admin = await requireUser("settings.manage");
  const name = field(form, "name", 100);
  if (!name) return { error: "Give the key a name, like the tool that will use it." };
  const userId = field(form, "userId", 64) ?? admin.id;
  if (!isUuid(userId)) return { error: "Pick a user." };
  const [owner] = await db()
    .select({ id: users.id, role: roles.key })
    .from(users).innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, userId), eq(users.active, true)));
  if (!owner || !isRole(owner.role)) return { error: "Pick an active user." };

  const requested = normalizeScopes(form.getAll("scopes"));
  const allowed = new Set(scopesFor({ role: owner.role }));
  const scopes = requested.filter((s) => allowed.has(s));
  if (scopes.length === 0) return { error: "Pick at least one scope this user's role allows." };

  const source = field(form, "source", 100);
  const expiry = String(form.get("expiresInDays") ?? "");
  const expiresAt = EXPIRY_DAYS.has(expiry) ? new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000) : null;

  // The 8-character prefix is random; retry on the rare collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const generated = generateApiKey();
    const [row] = await db()
      .insert(apiKeys)
      .values({ name, prefix: generated.prefix, keyHash: generated.hash, userId: owner.id, scopes, source, createdBy: admin.id, expiresAt })
      .onConflictDoNothing()
      .returning({ id: apiKeys.id });
    if (!row) continue;
    await logAudit("api_key_created", admin.id, { key: keyLabel(generated.prefix), name, scopes, acts_as: owner.id, source });
    revalidatePath("/settings/api");
    return {
      secret: generated.key,
      label: `API key "${name}" created. Copy it now; it won't be shown again.`,
    };
  }
  return { error: "Couldn't create a key. Try again." };
}

export async function revokeApiKeyAction(keyId: string): Promise<void> {
  const admin = await requireUser("settings.manage");
  if (!isUuid(keyId)) return;
  const [row] = await db()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
    .returning({ prefix: apiKeys.prefix, name: apiKeys.name });
  if (row) await logAudit("api_key_revoked", admin.id, { key: keyLabel(row.prefix), name: row.name });
  revalidatePath("/settings/api");
}

/** Add a webhook endpoint. Its signing secret is shown once. */
export async function createWebhookAction(_: SecretState, form: FormData): Promise<SecretState> {
  const admin = await requireUser("settings.manage");
  // The demo makes no outbound requests.
  if (isDemoMode()) return { error: DEMO_BLOCKED };
  const url = field(form, "url", 2000);
  if (!url || !isHttpUrl(url)) return { error: "Enter an http or https URL." };
  if (process.env.NODE_ENV === "production" && !url.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
    return { error: "Use an https URL, so payloads and signatures aren't sent in the clear." };
  }
  const events = form.getAll("events").filter((e): e is (typeof WEBHOOK_EVENT_NAMES)[number] =>
    (WEBHOOK_EVENT_NAMES as readonly unknown[]).includes(e),
  );
  if (events.length === 0) return { error: "Pick at least one event." };
  const secret = newWebhookSecret();
  const [row] = await db()
    .insert(webhooks)
    .values({ url, events, secretEncrypted: sealWebhookSecret(secret), createdBy: admin.id })
    .returning({ id: webhooks.id });
  await logAudit("webhook_created", admin.id, { webhook_id: row.id, url, events });
  revalidatePath("/settings/api");
  return { secret, label: "Webhook added. This is its signing secret. Copy it now; it won't be shown again." };
}

export async function setWebhookActiveAction(webhookId: string, active: boolean): Promise<void> {
  const admin = await requireUser("settings.manage");
  if (!isUuid(webhookId)) return;
  await db().update(webhooks).set({ active }).where(eq(webhooks.id, webhookId));
  await logAudit("webhook_changed", admin.id, { webhook_id: webhookId, active });
  revalidatePath("/settings/api");
}

export async function deleteWebhookAction(webhookId: string): Promise<void> {
  const admin = await requireUser("settings.manage");
  if (!isUuid(webhookId)) return;
  const [row] = await db().delete(webhooks).where(eq(webhooks.id, webhookId)).returning({ url: webhooks.url });
  if (row) await logAudit("webhook_deleted", admin.id, { webhook_id: webhookId, url: row.url });
  revalidatePath("/settings/api");
}

export async function redeliverAction(deliveryId: string): Promise<void> {
  await requireUser("settings.manage");
  if (!isUuid(deliveryId)) return;
  await redeliver(deliveryId);
  revalidatePath("/settings/api");
}
