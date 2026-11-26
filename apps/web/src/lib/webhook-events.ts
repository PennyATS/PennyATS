/** Webhook event names. Kept apart from webhooks.ts so pure code (the API schemas) can import them. */
export const WEBHOOK_EVENT_NAMES = ["application.created", "application.stage_changed", "scorecard.submitted"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENT_NAMES)[number];

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  "application.created": "Someone applied, or a candidate was added to a job.",
  "application.stage_changed": "An application moved to another stage.",
  "scorecard.submitted": "A scorecard was submitted or edited.",
};
