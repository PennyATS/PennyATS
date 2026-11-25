import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleAuthorizationUrl, googleCalendarConfigured } from "@/lib/google-calendar";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.APP_URL));
  if (!googleCalendarConfigured()) return NextResponse.redirect(new URL("/settings/calendar?status=unconfigured", process.env.APP_URL));
  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(googleAuthorizationUrl(state));
  response.cookies.set("pennyats_google_oauth_state", state, {
    httpOnly: true, sameSite: "lax", secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/api/google-calendar", maxAge: 600,
  });
  return response;
}
