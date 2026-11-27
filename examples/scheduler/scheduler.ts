/**
 * Reference integration: a scheduling tool that books interviews in PennyATS.
 *
 * Webhook mode (default) listens for `application.stage_changed`. When a candidate enters a
 * stage with planned interviews, PennyATS creates them; this books each one into the first open
 * slot and gives it a meeting link.
 *
 *   PENNYATS_URL=http://localhost:3000 PENNYATS_API_KEY=pats_... WEBHOOK_SECRET=whsec_... \
 *     pnpm --filter @pennyats/examples scheduler --port 4010
 *
 * Then add a webhook in Settings > API and webhooks pointing at http://<host>:4010/webhooks with
 * the application.stage_changed event, and put its signing secret in WEBHOOK_SECRET.
 *
 * Sweep mode books every interview still waiting, for cron or a first run:
 *
 *   PENNYATS_URL=... PENNYATS_API_KEY=... pnpm --filter @pennyats/examples scheduler --sweep [--job <id>]
 *
 * Key scopes: `interviews:read` and `interviews:write`. A real scheduler would check calendars
 * for free time; this one offers weekday slots from 10:00 to 16:00 in SCHEDULER_TIME_ZONE and lets
 * PennyATS refuse slots that clash with the interviewers' other PennyATS interviews (HTTP 409).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const base = `${(process.env.PENNYATS_URL ?? "").replace(/\/+$/, "")}/api/v1`;
const key = process.env.PENNYATS_API_KEY;
const secret = process.env.WEBHOOK_SECRET;
const timeZone = process.env.SCHEDULER_TIME_ZONE ?? "UTC";
const meetingBase = (process.env.SCHEDULER_MEETING_URL ?? "https://meet.example.com").replace(/\/+$/, "");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (!process.env.PENNYATS_URL || !key) {
  console.error("Set PENNYATS_URL and PENNYATS_API_KEY.");
  process.exit(1);
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "X-PennyATS-Agent": "example-scheduler",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/** Check the PennyATS-Signature header: HMAC-SHA256 of "<t>.<body>", at most 5 minutes old. */
export function verify(signingSecret: string, body: string, header: string): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", signingSecret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1 ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The UTC instant of a wall-clock time in a time zone. */
function zoned(year: number, month: number, day: number, hour: number, zone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(guess).map((x) => [x.type, x.value]));
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess - (shown - guess));
}

/** Weekday slots, 10:00 to 16:00 local, from tomorrow for two weeks. */
export function* slots(zone: string, from = new Date()): Generator<Date> {
  for (let d = 1; d <= 14; d++) {
    const day = new Date(from.getTime() + d * 86_400_000);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(day);
    if (weekday === "Sat" || weekday === "Sun") continue;
    const [y, m, dd] = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(day)
      .split("-")
      .map(Number);
    for (let hour = 10; hour <= 16; hour++) yield zoned(y, m, dd, hour, zone);
  }
}

/** Book one interview into the first slot PennyATS accepts. */
async function book(interview: { id: string; name: string; status: string }): Promise<boolean> {
  if (interview.status !== "to_schedule") return false;
  for (const at of slots(timeZone)) {
    const res = await api("PATCH", `/interviews/${interview.id}`, {
      scheduled_at: at.toISOString(),
      time_zone: timeZone,
      meeting_location: `${meetingBase}/${interview.id.slice(0, 8)}`,
    });
    if (res.status === 200) {
      console.error(`booked  ${interview.name} at ${at.toISOString()}`);
      return true;
    }
    if (res.status !== 409) {
      console.error(`skipped ${interview.name}: ${res.json?.error?.message ?? res.status}`);
      return false;
    }
    // 409: an interviewer is busy then. Try the next slot.
  }
  console.error(`no slot for ${interview.name} in the next two weeks`);
  return false;
}

async function bookApplication(applicationId: string): Promise<number> {
  const res = await api("GET", `/applications/${applicationId}/interviews`);
  let booked = 0;
  for (const interview of res.json?.data ?? []) if (await book(interview)) booked++;
  return booked;
}

async function sweep(job: string | undefined): Promise<number> {
  let booked = 0;
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ status: "to_schedule", limit: "100", ...(job ? { job_id: job } : {}), ...(cursor ? { cursor } : {}) });
    const page = await api("GET", `/interviews?${q}`);
    if (page.status !== 200) throw new Error(page.json?.error?.message ?? `HTTP ${page.status}`);
    for (const interview of page.json.data) if (await book(interview)) booked++;
    cursor = page.json.next_cursor;
  } while (cursor);
  return booked;
}

if (process.argv.includes("--sweep")) {
  console.log(JSON.stringify({ booked: await sweep(arg("job")) }));
} else {
  if (!secret) {
    console.error("Set WEBHOOK_SECRET to the webhook's signing secret.");
    process.exit(1);
  }
  const signingSecret = secret;
  const port = Number(arg("port") ?? process.env.PORT ?? 4010);
  createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method !== "POST" || !verify(signingSecret, body, String(req.headers["pennyats-signature"] ?? ""))) {
        res.writeHead(401).end();
        return;
      }
      // Acknowledge at once; PennyATS retries anything that isn't a 2xx within 10 seconds.
      res.writeHead(200).end("ok");
      const event = JSON.parse(body);
      if (event.type === "application.stage_changed") {
        void bookApplication(event.data.application_id).catch((err) => console.error("booking failed:", err));
      }
    });
  }).listen(port, "127.0.0.1", () => console.error(`example scheduler listening on http://127.0.0.1:${port}/webhooks`));
}
