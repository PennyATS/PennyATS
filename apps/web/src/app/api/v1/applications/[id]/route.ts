import { loadApplication } from "@/lib/api/data";
import { apiHandler } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";

export const GET = apiHandler(routes.getApplication, async ({ user, params }) => loadApplication(user, params.id));
