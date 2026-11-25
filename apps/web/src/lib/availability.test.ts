import assert from "node:assert/strict";
import test from "node:test";
import { parseAvailabilityWindows } from "./availability";

const now = new Date("2026-11-25T00:00:00.000Z");

test("accepts several windows on one day in an explicit time zone", () => {
  const parsed = parseAvailabilityWindows(JSON.stringify([
    { start: "2026-12-01T09:00", end: "2026-12-01T10:00" },
    { start: "2026-12-01T13:00", end: "2026-12-01T15:00" },
  ]), "America/Los_Angeles", now);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.length, 2);
    assert.equal(parsed.value[0].startsAt.toISOString(), "2026-12-01T17:00:00.000Z");
  }
});

test("rejects overlap, stale dates, and invalid daylight-saving times", () => {
  const overlap = parseAvailabilityWindows(JSON.stringify([
    { start: "2026-12-01T09:00", end: "2026-12-01T11:00" },
    { start: "2026-12-01T10:30", end: "2026-12-01T12:00" },
  ]), "America/Los_Angeles", now);
  assert.equal(overlap.ok, false);
  const stale = parseAvailabilityWindows(JSON.stringify([
    { start: "2026-11-24T09:00", end: "2026-11-24T10:00" },
  ]), "America/Los_Angeles", now);
  assert.equal(stale.ok, false);
  const skipped = parseAvailabilityWindows(JSON.stringify([
    { start: "2027-03-14T02:30", end: "2027-03-14T03:30" },
  ]), "America/Los_Angeles", new Date("2027-03-01T00:00:00.000Z"));
  assert.equal(skipped.ok, false);
});
