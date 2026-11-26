/**
 * Webhook delivery against a real HTTP receiver: signed payloads, no personal details in them,
 * a retry with backoff after a failure, and the delivery log.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { asc, eq } from "drizzle-orm";
import { stages, webhookDeliveries, webhooks } from "@pennyats/db";
import { expect, test } from "@playwright/test";
import { newWebhookSecret, sealWebhookSecret, verifyWebhook } from "../../src/lib/webhooks";
import { ALL_SCOPES, apiClient, db, deleteKeys, makeKey, seededUsers } from "./api-helpers";

type Received = { headers: IncomingMessage["headers"]; body: string };

let server: Server;
let url = "";
const received: Received[] = [];
/** Status to answer with for each request, in order; 200 once the list runs out. */
const answers: number[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = answers.shift() ?? 200;
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("webhooks are signed, retried with backoff, and logged", async ({ request }) => {
  const people = await seededUsers();
  const apiKey = await makeKey(people.admin.id, ALL_SCOPES);
  const call = apiClient(request);
  const secret = newWebhookSecret();
  const [hook] = await db
    .insert(webhooks)
    .values({ url, events: ["application.created", "application.stage_changed", "scorecard.submitted"], secretEncrypted: sealWebhookSecret(secret) })
    .returning();

  try {
    const suffix = randomUUID().slice(0, 8);
    const job = await call(apiKey.key, "createJob", { body: { title: `Webhook job ${suffix}`, status: "open" } });
    const pipeline = await db.select().from(stages).where(eq(stages.jobId, job.body.id)).orderBy(asc(stages.position));
    const name = `Webhook Person ${suffix}`;
    const email = `webhook-${suffix}@example.com`;

    // application.created goes out right after the API call.
    const created = await call(apiKey.key, "createCandidate", { body: { job_id: job.body.id, full_name: name, email } });
    await expect.poll(() => received.length, { timeout: 15_000 }).toBe(1);
    const first = received[0];
    expect(first.headers["pennyats-event"]).toBe("application.created");
    expect(verifyWebhook(secret, first.body, String(first.headers["pennyats-signature"]))).toBe(true);
    expect(verifyWebhook("whsec_wrong", first.body, String(first.headers["pennyats-signature"]))).toBe(false);
    const event = JSON.parse(first.body);
    expect(event).toMatchObject({
      type: "application.created",
      data: {
        application_id: created.body.application_id,
        candidate_id: created.body.candidate.id,
        job_id: job.body.id,
        stage_id: pipeline[0].id,
        stage_name: pipeline[0].name,
      },
    });
    expect(event.id).toBe(first.headers["pennyats-event-id"]);
    // Thin payloads: no names or contact details leave the instance.
    expect(first.body).not.toContain(name);
    expect(first.body).not.toContain(email);

    // The receiver fails once; the delivery is retried after the backoff and then succeeds.
    answers.push(500);
    await call(apiKey.key, "moveApplication", { params: { id: created.body.application_id }, body: { stage_id: pipeline[1].id } });
    await expect.poll(() => received.length, { timeout: 15_000 }).toBe(3);
    const [failed, retried] = received.slice(1);
    expect(failed.headers["pennyats-event"]).toBe("application.stage_changed");
    expect(retried.headers["pennyats-event-id"]).toBe(failed.headers["pennyats-event-id"]);
    expect(retried.body).toBe(failed.body);
    expect(verifyWebhook(secret, retried.body, String(retried.headers["pennyats-signature"]))).toBe(true);
    expect(JSON.parse(retried.body).data).toMatchObject({ from_stage_id: pipeline[0].id, to_stage_id: pipeline[1].id });

    await expect
      .poll(async () => {
        const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id)).orderBy(asc(webhookDeliveries.createdAt));
        return rows.map((r) => `${r.event}:${r.status}:${r.attempts}:${r.lastStatusCode}`);
      })
      .toEqual(["application.created:delivered:1:200", "application.stage_changed:delivered:2:200"]);

    // scorecard.submitted from the API.
    await call(apiKey.key, "submitScorecard", { params: { id: created.body.application_id }, body: { recommendation: "yes" } });
    await expect.poll(() => received.length, { timeout: 15_000 }).toBe(4);
    expect(received[3].headers["pennyats-event"]).toBe("scorecard.submitted");
    expect(JSON.parse(received[3].body).data.author_id).toBe(people.admin.id);

    // Delivery rows go with the candidate.
    await call(apiKey.key, "deleteCandidate", { params: { id: created.body.candidate.id } });
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id))).toHaveLength(0);
  } finally {
    await db.delete(webhooks).where(eq(webhooks.id, hook.id));
    await deleteKeys([apiKey.id]);
  }
});
