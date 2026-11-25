import assert from "node:assert/strict";
import test from "node:test";
import { bookingToken, bookingTokenHash, workingHourSlots } from "./booking";

test("booking tokens are opaque and hash consistently", () => {
  const first = bookingToken();
  const second = bookingToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(bookingTokenHash(first), bookingTokenHash(first));
  assert.notEqual(bookingTokenHash(first), bookingTokenHash(second));
});

test("candidate slots stay inside interviewer hours and exclude Google and PennyATS busy times", () => {
  const slots = workingHourSlots({
    from: new Date("2026-11-30T00:00:00.000Z"), until: new Date("2026-12-01T00:00:00.000Z"),
    timeZone: "America/Los_Angeles", workingDays: [1, 2, 3, 4, 5],
    startMinute: 9 * 60, endMinute: 11 * 60, durationMinutes: 30,
    busy: [{ start: new Date("2026-11-30T17:30:00.000Z"), end: new Date("2026-11-30T18:30:00.000Z") }],
  }).map((slot) => slot.start);
  assert.deepEqual(slots, ["2026-11-30T17:00:00.000Z", "2026-11-30T18:30:00.000Z"]);
});

test("working day and daylight-saving gaps never produce invalid slots", () => {
  const slots = workingHourSlots({
    from: new Date("2027-03-14T00:00:00.000Z"), until: new Date("2027-03-15T00:00:00.000Z"),
    timeZone: "America/Los_Angeles", workingDays: [0],
    startMinute: 90, endMinute: 180, durationMinutes: 30, busy: [],
  }).map((slot) => slot.start);
  assert.equal(slots.length, 1);
  assert.equal(slots[0], "2027-03-14T09:30:00.000Z");
});
