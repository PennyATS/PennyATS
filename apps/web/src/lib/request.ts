import { headers } from "next/headers";

/** Best-effort client IP for rate limiting. Trusts X-Forwarded-For, so run behind a proxy you control. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
