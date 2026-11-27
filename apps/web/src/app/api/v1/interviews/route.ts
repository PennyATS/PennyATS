import { queryInterviews } from "@/lib/api/data";
import { apiHandler } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";

export const GET = apiHandler(routes.listAllInterviews, async ({ user, query }) => queryInterviews(user, query));
