import { apiHandler } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { WEBHOOK_EVENT_NAMES } from "@/lib/webhook-events";

export const GET = apiHandler(routes.me, async ({ key, user }) => ({
  key: {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    source: key.source,
    expires_at: key.expiresAt?.toISOString() ?? null,
  },
  user: { id: user.id, name: user.name, email: user.email, role: user.role },
  webhook_events: [...WEBHOOK_EVENT_NAMES],
}));
