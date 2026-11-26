import { errorResponse } from "@/lib/api/handler";

/** Unknown API paths get the API's JSON error instead of the app's HTML 404 page. */
function notFound() {
  return errorResponse("not_found", "No such API endpoint. See /api/v1/openapi.json.");
}

export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
export const PUT = notFound;
export const DELETE = notFound;
