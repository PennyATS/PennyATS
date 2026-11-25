import assert from "node:assert/strict";
import { test } from "node:test";
import { arcPath, donutArcs, foldOther, monthLabel, monthRange, niceTicks } from "./charts";

test("niceTicks covers the max with round steps", () => {
  assert.deepEqual(niceTicks(47), [0, 20, 40, 60]);
  assert.deepEqual(niceTicks(4), [0, 1, 2, 3, 4]);
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(100), [0, 25, 50, 75, 100]);
});

test("foldOther keeps the top slices and sums the rest", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ label: `r${i}`, value: 10 - i }));
  const folded = foldOther(rows, 3);
  assert.deepEqual(folded.map((r) => r.label), ["r0", "r1", "r2", "Other"]);
  assert.equal(folded[3].value, 7 + 6 + 5 + 4 + 3 + 2 + 1);
  // A single leftover isn't worth an "Other".
  assert.equal(foldOther(rows.slice(0, 4), 3).length, 4);
  assert.equal(foldOther([{ label: "zero", value: 0 }]).length, 0);
});

test("donutArcs split the circle by share", () => {
  const arcs = donutArcs([1, 1, 2]);
  assert.equal(arcs[0].share, 0.25);
  assert.ok(Math.abs(arcs[2].end - 2 * Math.PI) < 1e-9);
  assert.deepEqual(donutArcs([0, 0]).map((a) => a.share), [0, 0]);
  assert.match(arcPath(50, 50, 40, 25, 0, 2 * Math.PI), /^M /);
});

test("monthRange fills gaps and monthLabel formats", () => {
  assert.deepEqual(monthRange(new Date("2025-11-20Z"), new Date("2026-02-01Z")), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(monthLabel("2026-03"), "Mar 26");
});
