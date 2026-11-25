import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEmailTemplate } from "./email-templates";

test("candidate email tokens render in subject and body", () => {
  assert.equal(renderEmailTemplate("Hi {{candidate_name}}, about {{ job_title }}", "Sam", "Engineer"),
    "Hi Sam, about Engineer");
});
