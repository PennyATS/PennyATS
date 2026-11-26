import { openApiText } from "@/lib/api/openapi";

/** The OpenAPI document, public so tools and agents can discover the API. Same text as docs/api/openapi.json. */
export function GET() {
  return new Response(openApiText(), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
