import { listTemplates } from "@/lib/api/data";
import { apiHandler } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";

export const GET = apiHandler(routes.listEmailTemplates, async () => ({ data: await listTemplates() }));
