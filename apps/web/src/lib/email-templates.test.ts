import assert from "node:assert/strict";
import { test } from "node:test";
import {
  htmlToText, mergeValues, renderEmailHtml, renderEmailTemplate, sanitizeEmailHtml, templateHtml, textToHtml,
} from "./email-templates";

const values = mergeValues({ candidateName: "  Sam  Rivera ", jobTitle: "Engineer", companyName: "Acme", stageName: "Recruiter screen" });

test("merge fields render in subjects and plain text", () => {
  assert.equal(renderEmailTemplate("Hi {{candidate_name}}, about {{ job_title }}", values), "Hi Sam  Rivera, about Engineer");
  assert.equal(renderEmailTemplate("Hi {{first_name}} from {{company_name}} ({{stage_name}})", values),
    "Hi Sam from Acme (Recruiter screen)");
  assert.equal(renderEmailTemplate("Keep {{unknown}} and {{ constructor }}", values), "Keep {{unknown}} and {{ constructor }}");
});

test("merge values are escaped in HTML", () => {
  const evil = mergeValues({ candidateName: "<img src=x onerror=alert(1)>", jobTitle: "A & B", companyName: "Acme" });
  assert.equal(renderEmailHtml("<p>Hi {{first_name}} for {{job_title}}</p>", evil),
    "<p>Hi &lt;img for A &amp; B</p>");
});

test("sanitizing keeps formatting and strips scripts, styles, and unsafe links", () => {
  const dirty = `<h1>Title</h1><p style="color:red" onclick="x()"><b>Bold</b> <i>it</i> <u>u</u></p>` +
    `<script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://example.com" target="_top">ok</a>` +
    `<ul><li>One</li></ul><img src="https://example.com/x.png"><iframe src="https://evil"></iframe>`;
  assert.equal(sanitizeEmailHtml(dirty),
    `<h2>Title</h2><p><strong>Bold</strong> <em>it</em> <u>u</u></p><a target="_blank" rel="noopener noreferrer">bad</a> ` +
    `<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a><ul><li>One</li></ul>`);
  assert.equal(sanitizeEmailHtml("<p></p>"), "");
});

test("HTML becomes readable plain text", () => {
  const html = `<p>Hi <strong>Sam</strong>,</p><p>Next steps:</p><ol><li><p>Pick a time</p></li><li><p>Join the call</p></li></ol>` +
    `<ul><li>Read <a href="https://example.com/about">about us</a></li><li><a href="mailto:jo@example.com">jo@example.com</a></li></ul>` +
    `<p>Thanks &amp; talk soon<br>Jo</p>`;
  assert.equal(htmlToText(html),
    "Hi Sam,\n\nNext steps:\n\n1. Pick a time\n2. Join the call\n\n- Read about us (https://example.com/about)\n- jo@example.com\n\nThanks & talk soon\nJo");
});

test("templates written before rich text fall back to their plain body", () => {
  assert.equal(textToHtml("Hi <Sam>,\nline two\n\nBye"), "<p>Hi &lt;Sam&gt;,<br>line two</p><p>Bye</p>");
  assert.equal(templateHtml({ bodyHtml: "", body: "Hello" }), "<p>Hello</p>");
  assert.equal(templateHtml({ bodyHtml: "<p>Rich</p>", body: "Rich" }), "<p>Rich</p>");
});
