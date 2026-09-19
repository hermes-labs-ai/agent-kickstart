import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github/workflows/publish.yml"), "utf8");
const CI_WORKFLOW = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const PYPROJECT = fs.readFileSync(path.join(ROOT, "pyproject.toml"), "utf8");

/** The Python minor versions the published package claims to support. */
function advertisedPythonVersions() {
  return [...PYPROJECT.matchAll(/"Programming Language :: Python :: (\d+\.\d+)"/g)]
    .map((match) => match[1]);
}

/** The Python minor versions CI actually runs the suite on. */
function testedPythonVersions() {
  const matrix = CI_WORKFLOW.match(/python-version: \[([^\]]+)\]/);
  assert.ok(matrix, "ci.yml must declare a python-version matrix");
  return [...matrix[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function byVersion(versions) {
  return [...versions].sort((left, right) => {
    const [leftMajor, leftMinor] = left.split(".").map(Number);
    const [rightMajor, rightMinor] = right.split(".").map(Number);
    return leftMajor - rightMajor || leftMinor - rightMinor;
  });
}

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

test("release publication tests the exact source before building it", () => {
  assert.match(WORKFLOW, /run: bash tests\/run-tests\.sh/);
  assert.match(WORKFLOW, /python -m build/);
});

test("CI tests and builds pull requests and main", () => {
  assert.match(CI_WORKFLOW, /pull_request:/);
  assert.match(CI_WORKFLOW, /push:\n    branches: \[main\]/);
  assert.match(CI_WORKFLOW, /node-version: "18"/);
  assert.match(CI_WORKFLOW, /run: bash tests\/run-tests\.sh/);
  assert.match(CI_WORKFLOW, /python -m build/);
  assert.match(CI_WORKFLOW, /permissions:\n  contents: read/);
  assert.match(CI_WORKFLOW, /persist-credentials: false/);

  const actionReferences = [...CI_WORKFLOW.matchAll(/uses: ([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(actionReferences.length >= 3);
  for (const reference of actionReferences) {
    assert.match(reference, /@[0-9a-f]{40}$/, `${reference} must use an immutable commit pin`);
  }
});

test("CI tests every Python version the package advertises", () => {
  // A trove classifier is a support claim. Anything advertised but untested is
  // an interpreter our beginners can install on and we never exercise, so the
  // matrix is checked against the claim rather than maintained beside it.
  // Testing more than we advertise is allowed on purpose: that is how a new
  // interpreter earns its classifier.
  const advertised = byVersion(advertisedPythonVersions());
  const tested = byVersion(testedPythonVersions());
  assert.ok(advertised.length > 0, "pyproject.toml must advertise Python minor-version classifiers");
  const untested = advertised.filter((version) => !tested.includes(version));
  assert.deepEqual(
    untested,
    [],
    `advertised but untested: [${untested.join(", ")}]; CI matrix is [${tested.join(", ")}]`,
  );

  const floor = PYPROJECT.match(/requires-python = ">=(\d+\.\d+)"/);
  assert.ok(floor, "pyproject.toml must declare requires-python");
  assert.equal(
    advertised[0],
    floor[1],
    `the lowest advertised classifier must equal the requires-python floor ${floor[1]}`,
  );
});
