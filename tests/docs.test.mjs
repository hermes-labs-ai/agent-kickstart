import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_SURFACES = ["AGENTS.md", "README.md", "DEMO.md", "SECURITY.md", "pyproject.toml"];
const CANONICAL_REPOSITORY = "https://github.com/hermes-labs-ai/agent-kickstart";

test("public documentation uses the canonical repository URL", () => {
  for (const relative of PUBLIC_SURFACES) {
    const content = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.ok(content.includes(CANONICAL_REPOSITORY), `${relative} should name the canonical repository`);
    assert.ok(!content.includes("https://github.com/hermes-labs-ai/claude-kickstart"), `${relative} uses the retired repository URL`);
    assert.ok(!content.includes("Claude Kickstart"), `${relative} uses the retired product name`);
  }
});

test("README does not present merged installer work as a draft", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(!readme.includes("This draft branch"));
  assert.ok(!readme.includes("Once this pull request is reviewed and merged"));
});

test("Python packaging uses Agent Kickstart as the primary identity", () => {
  const pyproject = fs.readFileSync(path.join(ROOT, "pyproject.toml"), "utf8");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.match(pyproject, /name = "agent-kickstart"/);
  assert.match(pyproject, /agent-kickstart = "agent_kickstart\.cli:main"/);
  assert.match(pyproject, /claude-kickstart = "agent_kickstart\.cli:main"/);
  assert.match(readme, /python -m agent_kickstart install/);
});
