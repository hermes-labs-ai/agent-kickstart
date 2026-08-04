import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, "..");

function freshRepo(name = "repo") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-test-"));
  const target = path.join(base, name);
  fs.cpSync(SOURCE, target, { recursive: true });
  return target;
}

function run(repo, args, options = {}) {
  const result = spawnSync(
    process.execPath,
    ["agent-kickstart/bin/kickstart-state.mjs", ...args],
    {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, ...(options.env || {}) },
    },
  );
  if (options.expectFailure) {
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  } else {
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  return result;
}

function json(repo, relative) {
  return JSON.parse(fs.readFileSync(path.join(repo, relative), "utf8"));
}

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("clean initialization and repeated initialization are idempotent", () => {
  const repo = freshRepo("repo with spaces");
  const state = path.join(repo, "agent-kickstart/state");
  for (const name of [
    "status.json",
    "learning-state.json",
    "user-portrait.md",
    "possibility-history.md",
    "onboarding-notes.md",
  ]) fs.rmSync(path.join(state, name), { force: true });

  const first = run(repo, ["init"]);
  assert.equal(JSON.parse(first.stdout).changed, true);
  const tracked = path.join(state, "status.json");
  const before = hash(tracked);
  const second = run(repo, ["init"]);
  assert.equal(JSON.parse(second.stdout).changed, false);
  assert.equal(hash(tracked), before);
});

test("entry, interrupted onboarding, resume, complete, exit, and re-entry", () => {
  const repo = freshRepo();
  let result = JSON.parse(run(repo, ["enter"]).stdout);
  assert.equal(result.route, "first_run");
  assert.equal(result.status.stage, "awaiting_safety");

  run(repo, ["checkpoint", "awaiting_self_description", "safest-default"]);
  run(repo, ["checkpoint", "awaiting_followup_1"]);
  run(repo, ["leave"]);
  assert.equal(json(repo, "agent-kickstart/state/status.json").onboarding_status, "interrupted");

  result = JSON.parse(run(repo, ["enter"]).stdout);
  assert.equal(result.route, "resume_onboarding");
  assert.equal(result.status.stage, "awaiting_followup_1");

  run(repo, ["checkpoint", "awaiting_possibility"]);
  run(repo, ["select", "A fitted local prototype"]);
  run(repo, ["complete"]);
  run(repo, ["leave"]);
  result = JSON.parse(run(repo, ["enter"]).stdout);
  assert.equal(result.route, "returning_user");
  assert.equal(result.status.onboarding_status, "complete");
});

test("session end marks in-progress onboarding interrupted but keeps completed mode active", () => {
  const repo = freshRepo();
  run(repo, ["enter"]);
  run(repo, ["session-end"]);
  let status = json(repo, "agent-kickstart/state/status.json");
  assert.equal(status.mode, "inactive");
  assert.equal(status.onboarding_status, "interrupted");

  run(repo, ["enter"]);
  run(repo, ["complete"]);
  run(repo, ["session-end"]);
  status = json(repo, "agent-kickstart/state/status.json");
  assert.equal(status.mode, "active");
  assert.equal(status.onboarding_status, "complete");
});

test("reset requires confirmation and preserves creations", () => {
  const repo = freshRepo();
  const creation = path.join(repo, "agent-kickstart/creations/keep-me.txt");
  const corpus = path.join(repo, "agent-kickstart/state/pro-corpus.json");
  fs.writeFileSync(creation, "user work\n");
  fs.writeFileSync(corpus, '{"private":"corpus"}\n');
  run(repo, ["enter"]);
  run(repo, ["select", "A user direction"]);
  run(repo, ["request-reset"]);
  run(repo, ["reset"], { expectFailure: true });
  assert.equal(fs.readFileSync(creation, "utf8"), "user work\n");
  const result = JSON.parse(run(repo, ["reset", "--confirm"]).stdout);
  assert.equal(fs.readFileSync(creation, "utf8"), "user work\n");
  assert.equal(fs.existsSync(corpus), false);
  assert.equal(result.private_corpus_deleted, true);
  const status = json(repo, "agent-kickstart/state/status.json");
  assert.equal(status.reset_status, "completed");
  assert.equal(status.mode, "inactive");
});

test("portrait deletion requires confirmation and never deletes creations", () => {
  const repo = freshRepo();
  const portrait = path.join(repo, "agent-kickstart/state/user-portrait.md");
  const creation = path.join(repo, "agent-kickstart/creations/artifact.md");
  const corpus = path.join(repo, "agent-kickstart/state/pro-corpus.json");
  fs.writeFileSync(portrait, "private portrait\n");
  fs.writeFileSync(creation, "artifact\n");
  fs.writeFileSync(corpus, '{"private":"corpus"}\n');
  run(repo, ["portrait-clear"], { expectFailure: true });
  assert.equal(fs.readFileSync(portrait, "utf8"), "private portrait\n");
  const result = JSON.parse(run(repo, ["portrait-clear", "--confirm"]).stdout);
  assert.match(fs.readFileSync(portrait, "utf8"), /Not collected yet/);
  assert.equal(fs.readFileSync(creation, "utf8"), "artifact\n");
  assert.equal(fs.existsSync(corpus), false);
  assert.equal(result.private_corpus_deleted, true);
  assert.equal(result.status.history_choice, null);
});

test("malformed and missing state recover with an evidence backup", () => {
  const repo = freshRepo();
  const statusFile = path.join(repo, "agent-kickstart/state/status.json");
  fs.writeFileSync(statusFile, "{not json\n");
  const recovered = run(repo, ["status"]);
  assert.match(recovered.stderr, /preserved at/);
  assert.equal(json(repo, "agent-kickstart/state/status.json").onboarding_status, "not_started");
  const backups = fs.readdirSync(path.dirname(statusFile)).filter((name) => name.includes("status.json.corrupt-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(statusFile), backups[0]), "utf8"), "{not json\n");

  fs.rmSync(statusFile);
  run(repo, ["status"]);
  assert.equal(json(repo, "agent-kickstart/state/status.json").mode, "inactive");
});

test("status files from before history consent migrate without losing user state", () => {
  const repo = freshRepo();
  const statusFile = path.join(repo, "agent-kickstart/state/status.json");
  run(repo, ["init"]);
  const oldStatus = json(repo, "agent-kickstart/state/status.json");
  delete oldStatus.history_choice;
  oldStatus.selected_direction = "Preserve this direction";
  fs.writeFileSync(statusFile, `${JSON.stringify(oldStatus, null, 2)}\n`);

  const result = JSON.parse(run(repo, ["status"]).stdout);
  assert.equal(result.status.history_choice, null);
  assert.equal(result.status.selected_direction, "Preserve this direction");
  assert.equal(
    fs.readdirSync(path.dirname(statusFile)).some((name) => name.includes("status.json.corrupt-")),
    false,
  );
});

test("progression uses evidence and supports reversible user guidance", () => {
  const repo = freshRepo();
  run(repo, ["evidence", "modified_suggestion", "changed the second option"]);
  run(repo, ["evidence", "corrected_assumption", "fixed a portrait claim"]);
  let learning = json(repo, "agent-kickstart/state/learning-state.json");
  assert.equal(learning.stage, 2);
  run(repo, ["guidance", "simpler"]);
  learning = json(repo, "agent-kickstart/state/learning-state.json");
  assert.equal(learning.guidance_preference, "simpler");
  assert.equal(learning.stage, 1);
  run(repo, ["guidance", "advanced"]);
  learning = json(repo, "agent-kickstart/state/learning-state.json");
  assert.equal(learning.guidance_preference, "advanced");
  assert.equal(learning.stage, 2);
});

test("hook context is silent when inactive and injects readable context when active", () => {
  const repo = freshRepo();
  assert.equal(run(repo, ["hook-context"]).stdout, "");
  run(repo, ["enter"]);
  run(repo, ["complete"]);
  fs.writeFileSync(path.join(repo, "agent-kickstart/creations/proof.md"), "created\n");
  const output = run(repo, ["hook-context"]).stdout;
  const hook = JSON.parse(output);
  assert.equal(hook.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(hook.hookSpecificOutput.additionalContext, /guided mode is ACTIVE/);
  assert.match(hook.hookSpecificOutput.additionalContext, /ordinary language/);
  assert.match(hook.hookSpecificOutput.additionalContext, /proof\.md/);
});

test("state directory symlink escaping the repository is refused", { skip: process.platform === "win32" }, () => {
  const repo = freshRepo();
  const state = path.join(repo, "agent-kickstart/state");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-outside-"));
  fs.rmSync(state, { recursive: true, force: true });
  fs.symlinkSync(outside, state, "dir");
  const result = run(repo, ["init"], { expectFailure: true });
  assert.match(result.stderr, /symlink that leaves this repository/);
});
