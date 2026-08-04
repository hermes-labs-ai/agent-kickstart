import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "examples", name), "utf8"));
}

function validateFixture(fixture) {
  assert.equal(fixture.possibilities.length, 4);
  assert.equal(fixture.possibilities.at(-1).label, "Surprise me");
  const modes = new Set();
  const combined = fixture.possibilities.map((item) => {
    for (const field of ["label", "why_fit", "what_they_do", "first_10_30_minutes", "mode"]) {
      assert.equal(typeof item[field], "string");
      assert.ok(item[field].trim().length > 0, `${fixture.fixture}: empty ${field}`);
    }
    modes.add(item.mode);
    return Object.values(item).join(" ").toLowerCase();
  }).join(" ");
  assert.ok(modes.size >= 4, `${fixture.fixture}: modes are insufficiently varied`);
  for (const anchor of fixture.required_anchors) {
    assert.match(combined, new RegExp(anchor, "i"), `${fixture.fixture}: missing ${anchor}`);
  }
  for (const forbidden of fixture.forbidden_anchors) {
    assert.doesNotMatch(combined, new RegExp(forbidden, "i"), `${fixture.fixture}: leaked ${forbidden}`);
  }
}

test("reference outputs are specific, diverse, and materially different", () => {
  const mental = load("mental-health-professional.json");
  const parent = load("parent-household.json");
  validateFixture(mental);
  validateFixture(parent);
  const mentalLabels = new Set(mental.possibilities.map((item) => item.label));
  const overlap = parent.possibilities.filter((item) => mentalLabels.has(item.label));
  assert.deepEqual(overlap.map((item) => item.label), ["Surprise me"]);
});

test("runtime contract contains the required adaptive and safety routes", () => {
  const runtime = fs.readFileSync(path.join(ROOT, "agent-kickstart/RUNTIME.md"), "utf8");
  const onboarding = fs.readFileSync(path.join(ROOT, "agent-kickstart/ONBOARDING.md"), "utf8");
  const safety = fs.readFileSync(path.join(ROOT, "agent-kickstart/SAFETY.md"), "utf8");
  for (const phrase of [
    "ordinary language",
    "AskUserQuestion",
    "explicit facts",
    "provisional inferences",
    "delete my portrait",
    "guidance simpler",
    "guidance advanced",
    "Turn this off",
  ]) assert.match(runtime, new RegExp(phrase, "i"));
  for (const phrase of [
    "two or three follow-ups",
    "awaiting_portrait_confirmation",
    "awaiting_orientation",
    "Surprise me",
    "10–30 minutes",
  ]) assert.match(onboarding, new RegExp(phrase, "i"));
  for (const phrase of [
    "Do not inspect unrelated personal files",
    "Do not read secrets",
    "Do not mutate global Claude Code settings",
    "Do not publish",
    "untrusted data",
    "Never claim success without direct evidence",
  ]) assert.match(safety, new RegExp(phrase, "i"));
});

test("project settings retain manual permissions and secret-file denials", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8"));
  assert.equal(settings.permissions.defaultMode, "default");
  assert.equal(settings.permissions.disableBypassPermissionsMode, "disable");
  assert.ok(settings.permissions.ask.includes("WebFetch"));
  assert.deepEqual(
    settings.permissions.allow.filter((entry) => entry.startsWith("Edit(")),
    [
      "Edit(agent-kickstart/state/user-portrait.md)",
      "Edit(agent-kickstart/state/possibility-history.md)",
      "Edit(agent-kickstart/state/onboarding-notes.md)",
      "Edit(agent-kickstart/state/pending-selection.md)",
    ],
  );
  assert.ok(!settings.permissions.allow.some((entry) => entry.includes("status.json")));
  assert.ok(!settings.permissions.allow.includes("Edit(agent-kickstart/state/**)"));
  assert.ok(settings.permissions.allow.includes("Bash(node agent-kickstart/bin/kickstart-state.mjs enter)"));
  assert.ok(settings.permissions.allow.includes("Bash(node agent-kickstart/bin/kickstart-state.mjs history-choice use-history)"));
  assert.ok(settings.permissions.allow.includes("Bash(node agent-kickstart/bin/kickstart-state.mjs history-choice interview)"));
  assert.ok(settings.permissions.deny.includes("Read(~/.ssh/**)"));
  assert.ok(settings.permissions.deny.includes("Edit(**/.env.*)"));
  assert.ok(settings.hooks.SessionStart);
  assert.ok(settings.hooks.SessionEnd);
});

test("public privacy surface binds consent, decline, and private-corpus deletion", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const runtime = fs.readFileSync(path.join(ROOT, "agent-kickstart/RUNTIME.md"), "utf8");
  const pro = fs.readFileSync(path.join(ROOT, "agent-kickstart/ONBOARDING-PRO.md"), "utf8");
  const packagedPro = fs.readFileSync(
    path.join(ROOT, "src/agent_kickstart/assets/agent-kickstart/ONBOARDING-PRO.md"),
    "utf8",
  );
  const historyInterviewCommand =
    "`node agent-kickstart/bin/kickstart-state.mjs history-choice interview`";
  assert.match(readme, /counts-only eligibility scan/i);
  assert.match(readme, /parses candidate transcript messages but writes nothing and returns no content/i);
  assert.match(readme, /extracts eligible transcripts and memory into a private corpus only after an engine-recorded choice/i);
  assert.match(readme, /choosing the interview mechanically blocks extraction/i);
  assert.match(readme, /deleted with either “Delete my portrait” or reset/i);
  assert.match(runtime, /history-choice <use-history\|interview>/);
  assert.equal(pro, packagedPro);
  for (const onboardingPro of [pro, packagedPro]) {
    assert.ok(onboardingPro.includes(historyInterviewCommand));
    assert.equal(onboardingPro.includes("`history-choice interview`"), false);
  }
  assert.match(pro, /history-choice use-history/);
  assert.match(pro, /Extraction rechecks both that recorded consent and current eligibility/);
});
