// Turns the Playwright JUnit report into the "Security test results" summary for CI (#121).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const file = "apps/web/test-results/junit.xml";
if (!existsSync(file)) {
  console.log("No test results found.");
  process.exit(0);
}
const xml = readFileSync(file, "utf8");
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const rows = [];
for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
  const attrs = m[1];
  const classname = /classname="([^"]*)"/.exec(attrs)?.[1] ?? "";
  if (!classname.includes("security.spec.ts")) continue;
  const name = unescape(/name="([^"]*)"/.exec(attrs)?.[1] ?? "");
  const body = m[3] ?? "";
  const result = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
  rows.push(`| ${name} | ${result} |`);
}
const out = [
  "## Security test results",
  "",
  `From \`apps/web/tests/integration/security.spec.ts\` (threats in docs/threat-model.md), ${new Date().toISOString().slice(0, 10)}.`,
  "",
  "| Test | Result |",
  "| --- | --- |",
  ...rows,
  "",
].join("\n");
writeFileSync("security-test-results.md", out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
console.log(out);
