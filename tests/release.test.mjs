import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github/workflows/publish.yml"), "utf8");

test("release publication matches the pending PyPI trusted publisher", () => {
  assert.match(WORKFLOW, /release:\n    types: \[published\]/);
  assert.match(WORKFLOW, /environment:\n      name: pypi/);
  assert.match(WORKFLOW, /id-token: write/);
  assert.match(WORKFLOW, /https:\/\/pypi\.org\/p\/agent-kickstart/);
  assert.match(WORKFLOW, /pypa\/gh-action-pypi-publish@[0-9a-f]{40}/);
});

test("publish workflow pins actions and carries no repository credential", () => {
  const actionReferences = [...WORKFLOW.matchAll(/uses: ([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(actionReferences.length >= 5);
  for (const reference of actionReferences) {
    assert.match(reference, /@[0-9a-f]{40}$/, `${reference} must use an immutable commit pin`);
  }
  assert.match(WORKFLOW, /persist-credentials: false/);
  assert.doesNotMatch(WORKFLOW, /secrets\.|password:|api-token:/i);
});
