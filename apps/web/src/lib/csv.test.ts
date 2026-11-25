import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv } from "./csv";

const body = (csv: string) => csv.replace(/^﻿/, "");

test("plain values, numbers, and blanks", () => {
  assert.equal(body(toCsv(["Source", "Count"], [["Referral", 3], ["Unknown", null]])), "Source,Count\r\nReferral,3\r\nUnknown,\r\n");
});

test("commas, quotes, and line breaks are quoted", () => {
  assert.equal(body(toCsv(["Reason"], [['Said "no", twice\nthen left']])), 'Reason\r\n"Said ""no"", twice\nthen left"\r\n');
});

test("cells that would run as spreadsheet formulas are neutralized", () => {
  const out = body(toCsv(["Source"], [["=HYPERLINK(\"http://evil\")"], ["+1"], ["-2"], ["@SUM(A1)"], ["Referral"]]));
  assert.deepEqual(out.trim().split("\r\n"), [
    "Source",
    '"\'=HYPERLINK(""http://evil"")"',
    "'+1",
    "'-2",
    "'@SUM(A1)",
    "Referral",
  ]);
});

test("starts with a UTF-8 byte order mark so Excel reads accents", () => {
  assert.ok(toCsv(["Name"], [["José"]]).startsWith("﻿Name"));
});
