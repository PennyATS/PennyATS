import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required for scheduling email storage.");
  return createHash("sha256").update("pennyats-scheduling-email-v1\0").update(process.env.AUTH_SECRET).digest();
}

export function sealSchedulingBody(body: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const data = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

export function openSchedulingBody(value: string): string {
  const [nonce, tag, data] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!nonce || !tag || !data || nonce.length !== 12 || tag.length !== 16) throw new Error("Invalid scheduling email body.");
  const cipher = createDecipheriv("aes-256-gcm", key(), nonce);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
