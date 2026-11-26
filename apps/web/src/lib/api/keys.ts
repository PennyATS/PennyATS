/**
 * API key format and lookup.
 *
 *   pats_<prefix>_<secret>
 *
 * The prefix (8 characters) is stored in plain text so admins can tell keys apart. The whole
 * key is stored only as a SHA-256 hash, the same way sessions and invite tokens are. Keys are
 * 256 bits of randomness, so a fast hash is enough; there is nothing to brute force.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { apiKeys, users } from "@pennyats/db";
import type { SessionUser } from "../auth";
import { db } from "../db";
import { isRole } from "../permissions";

const KEY_PATTERN = /^pats_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  // base64url can include - and _, which would blur the prefix boundary, so the prefix is hex.
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const key = `pats_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The prefix of a well-formed key, or null. */
export function parseApiKey(key: string): { prefix: string } | null {
  const match = KEY_PATTERN.exec(key);
  return match ? { prefix: match[1] } : null;
}

/** Shown in the UI and in audit entries: enough to recognize a key, useless to an attacker. */
export function keyLabel(prefix: string): string {
  return `pats_${prefix}_…`;
}

/** Bearer token from an Authorization header, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

export type KeyLookup =
  | { ok: true; key: ApiKeyRecord; user: SessionUser }
  | { ok: false; reason: "malformed" | "unknown" | "revoked" | "expired" | "inactive_user" };

/** Decide whether a stored key may be used now. Pure, for tests. */
export function keyUsable(key: Pick<ApiKeyRecord, "revokedAt" | "expiresAt">, now: Date = new Date()): "ok" | "revoked" | "expired" {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && key.expiresAt <= now) return "expired";
  return "ok";
}

const LAST_USED_GRANULARITY_MS = 60_000;

/** Find the key and the user it acts as. Updates last-used time at most once a minute. */
export async function lookupApiKey(token: string, now: Date = new Date()): Promise<KeyLookup> {
  const parsed = parseApiKey(token);
  if (!parsed) return { ok: false, reason: "malformed" };
  const hash = hashApiKey(token);
  const [row] = await db()
    .select({
      key: apiKeys,
      user: { id: users.id, email: users.email, name: users.name, role: users.role, active: users.active },
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.prefix, parsed.prefix));
  // Compare hashes in constant time even though the prefix already narrowed it to one row.
  if (!row || !timingSafeEqual(Buffer.from(row.key.keyHash), Buffer.from(hash))) return { ok: false, reason: "unknown" };
  const usable = keyUsable(row.key, now);
  if (usable !== "ok") return { ok: false, reason: usable };
  if (!row.user.active || !isRole(row.user.role)) return { ok: false, reason: "inactive_user" };

  if (!row.key.lastUsedAt || now.getTime() - row.key.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
    await db().update(apiKeys).set({ lastUsedAt: now }).where(and(eq(apiKeys.id, row.key.id)));
  }
  const { keyHash: _hash, userId: _userId, createdBy: _createdBy, createdAt: _createdAt, ...key } = row.key;
  return {
    ok: true,
    key,
    user: { id: row.user.id, email: row.user.email, name: row.user.name, role: row.user.role },
  };
}
