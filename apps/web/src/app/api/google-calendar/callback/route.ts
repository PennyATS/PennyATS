import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exchangeGoogleCode, saveGoogleConnection } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const destination = (status: string) => new URL(`/settings/calendar?status=${status}`, process.env.APP_URL);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.APP_URL));
  const expected = request.cookies.get("pennyats_google_oauth_state")?.value;
  const state = request.nextUrl.searchParams.get("state");
  const valid = Boolean(expected && state && expected.length === state.length &&
    timingSafeEqual(Buffer.from(expected!), Buffer.from(state!)));
  const code = request.nextUrl.searchParams.get("code");
  let status = "error";
  if (valid && code && !request.nextUrl.searchParams.get("error")) {
    try {
      const refreshToken = await exchangeGoogleCode(code);
      await saveGoogleConnection(user.id, refreshToken);
      status = "connected";
    } catch { status = "error"; }
  }
  const response = NextResponse.redirect(destination(status));
  response.cookies.delete("pennyats_google_oauth_state");
  return response;
}
