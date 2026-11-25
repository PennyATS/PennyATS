import assert from "node:assert/strict";
import test from "node:test";
import { googleAuthorizationUrl, googleEventId } from "./google-calendar";

test("Google connect requests offline calendar access with a matching callback and state", () => {
  const before = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL,
  };
  try {
    process.env.GOOGLE_CLIENT_ID = "example-client";
    process.env.GOOGLE_CLIENT_SECRET = "example-secret";
    process.env.AUTH_SECRET = "example-app-secret";
    process.env.APP_URL = "https://ats.example.com";
    const url = new URL(googleAuthorizationUrl("random-state"));
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("redirect_uri"), "https://ats.example.com/api/google-calendar/callback");
    assert.equal(url.searchParams.get("state"), "random-state");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.match(url.searchParams.get("scope") ?? "", /calendar\.freebusy/);
    assert.match(url.searchParams.get("scope") ?? "", /calendar\.events/);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("one interview always maps to one Google-compatible event ID", () => {
  const id = googleEventId("a090377a-0169-4876-a8ac-b914ceafebdf");
  assert.equal(id, "a090377a01694876a8acb914ceafebdf");
  assert.match(id, /^[0-9a-v]{5,1024}$/);
});
