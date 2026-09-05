import assert from "node:assert/strict";
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

function userLine(text) {
  return JSON.stringify({ type: "user", message: { content: text } });
}

function writeSession(projectsDir, project, session, lines) {
  const dir = path.join(projectsDir, project);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, session), lines.join("\n"));
}

function fixtureProjects(base) {
  const projects = path.join(base, "projects");

  // Interactive session: five usable messages plus every noise class.
  writeSession(projects, "-Users-alice", "aaaa.jsonl", [
    userLine("please fix the login bug we talked about yesterday"),
    userLine("actually rename that helper to sessionGuard instead"),
    userLine("can you explain what the retry loop is doing here"),
    userLine("run the tests again and show me only the failures"),
    userLine("that output looks wrong, the count should be nine"),
    userLine("short"), // under 15 chars
    userLine(`long ${"x".repeat(600)}`), // over 500 chars
    userLine("<command-name>/kickstart</command-name> please continue"), // starts with <
    userLine("this line mentions a system-reminder block so it is dropped"),
    JSON.stringify({ type: "user", message: { content: [{ type: "text" }] } }), // non-string
    JSON.stringify({ type: "assistant", message: { content: "assistant text ignored" } }),
    "not json at all",
  ]);

  // Headless-style session: a single synthetic prompt must not count.
  writeSession(projects, "-Users-alice", "bbbb.jsonl", [
    userLine("You are an autonomous lane. Execute the mission end to end."),
  ]);

  // Second interactive session in another project, with one duplicate message.
  writeSession(projects, "-Users-alice-dev-app", "cccc.jsonl", [
    userLine("please fix the login bug we talked about yesterday"),
    userLine("let's ship the settings page before the demo tomorrow"),
    userLine("why does the build take four minutes on my machine"),
  ]);

  // The "-" project dir is reserved and must be skipped.
  writeSession(projects, "-", "dddd.jsonl", [
    userLine("this message lives in the reserved dash directory"),
    userLine("it should never appear in any scan or extract run"),
    userLine("three messages make it look interactive on purpose"),
  ]);

  // Memory: frontmatter to strip, one prose paragraph in range, one list-heavy block.
  const memoryDir = path.join(projects, "-Users-alice", "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(
    path.join(memoryDir, "user_profile.md"),
    [
      "---",
      "name: user-profile",
      "---",
      "",
      "The user prefers short direct answers and gets frustrated when responses restate the question instead of answering it plainly.",
      "",
      "- bullet one",
      "- bullet two",
      "- bullet three",
    ].join("\n"),
  );

  // Reserved-project memory is private noise too, not just its transcripts.
  const reservedMemory = path.join(projects, "-", "memory");
  fs.mkdirSync(reservedMemory, { recursive: true });
  fs.writeFileSync(
    path.join(reservedMemory, "never-ingest.md"),
    "This reserved directory contains sk-test-reserved-memory and enough ordinary words to pass the memory paragraph filter if the exclusion regresses.\n",
  );
  return projects;
}

function addEligibleHistory(projects) {
  for (let s = 0; s < 5; s += 1) {
    writeSession(
      projects,
      "-Users-eligible-history",
      `eligible-${s}.jsonl`,
      Array.from(
        { length: 20 },
        (_, i) => userLine(`eligible history message ${i} in session ${s} about a distinct project decision`),
      ),
    );
  }
}

function chooseHistory(repo, env) {
  run(repo, ["enter"], { env });
  run(repo, ["checkpoint", "awaiting_history_choice"], { env });
  return JSON.parse(run(repo, ["history-choice", "use-history"], { env }).stdout);
}

test("history-scan counts interactive sessions only and writes nothing", () => {
  const repo = freshRepo();
  const projects = fixtureProjects(path.dirname(repo));
  const env = { KICKSTART_PROJECTS_DIR: projects };

  const scan = JSON.parse(run(repo, ["history-scan"], { env }).stdout);
  assert.equal(scan.interactive_sessions, 2); // headless and "-" excluded
  assert.equal(scan.usable_messages, 8); // 5 + 3 usable
  assert.equal(scan.eligible, false); // below both thresholds
  assert.equal(scan.wrote, "nothing");
  assert.equal(fs.existsSync(path.join(repo, "agent-kickstart/state/pro-corpus.json")), false);
});

test("history-scan reports eligible once session and message thresholds are met", () => {
  const repo = freshRepo();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kickstart-hist-"));
  const projects = path.join(base, "projects");
  for (let s = 0; s < 5; s += 1) {
    writeSession(
      projects,
      "-Users-alice",
      `session-${s}.jsonl`,
      Array.from({ length: 20 }, (_, i) => userLine(`message number ${i} in session ${s} about the project`)),
    );
  }
  const scan = JSON.parse(
    run(repo, ["history-scan"], { env: { KICKSTART_PROJECTS_DIR: projects } }).stdout,
  );
  assert.equal(scan.interactive_sessions, 5);
  assert.equal(scan.usable_messages, 100);
  assert.equal(scan.eligible, true);
});

test("history-extract requires guided mode to be active", () => {
  const repo = freshRepo();
  const projects = fixtureProjects(path.dirname(repo));
  run(repo, ["history-extract"], { env: { KICKSTART_PROJECTS_DIR: projects }, expectFailure: true });
});

test("history-extract writes a provenance-tagged, deduplicated corpus", () => {
  const repo = freshRepo();
  const projects = fixtureProjects(path.dirname(repo));
  addEligibleHistory(projects);
  const env = { KICKSTART_PROJECTS_DIR: projects };

  const choice = chooseHistory(repo, env);
  assert.equal(choice.choice, "use-history");
  assert.equal(choice.status.history_choice, "use-history");
  const result = JSON.parse(run(repo, ["history-extract"], { env }).stdout);
  assert.equal(result.action, "history_extracted");
  assert.equal(result.transcript_chunks, 107); // 108 usable minus 1 duplicate
  assert.equal(result.memory_chunks, 1);

  const corpus = JSON.parse(
    fs.readFileSync(path.join(repo, "agent-kickstart/state/pro-corpus.json"), "utf8"),
  );
  assert.equal(corpus.schema_version, 1);
  assert.equal(corpus.transcripts.length, 107);
  for (const chunk of corpus.transcripts) {
    assert.equal(typeof chunk.text, "string");
    assert.ok(chunk.project.startsWith("-Users-"));
    assert.ok(chunk.session.endsWith(".jsonl"));
    assert.ok(!chunk.text.includes("system-reminder"));
    assert.ok(!chunk.project.includes("/"));
  }
  const texts = corpus.transcripts.map((c) => c.text);
  assert.equal(new Set(texts).size, texts.length);
  assert.ok(!texts.some((t) => t.includes("reserved dash directory")));

  assert.equal(corpus.memory.length, 1);
  assert.ok(corpus.memory[0].text.startsWith("The user prefers short direct answers"));
  assert.equal(corpus.memory[0].source, "-Users-alice/memory/user_profile.md");
  assert.ok(!corpus.memory[0].text.includes("name: user-profile"));
  assert.ok(!JSON.stringify(corpus).includes("sk-test-reserved-memory"));
});

test("awaiting_history_choice is a valid checkpoint stage", () => {
  const repo = freshRepo();
  run(repo, ["enter"]);
  const result = JSON.parse(run(repo, ["checkpoint", "awaiting_history_choice"]).stdout);
  assert.equal(result.status.stage, "awaiting_history_choice");
  assert.equal(result.status.history_choice, null);
  run(repo, ["checkpoint", "awaiting_self_description"], { expectFailure: true });
  run(repo, ["checkpoint", "not_a_stage"], { expectFailure: true });
});

test("history extraction requires eligible, engine-recorded use-history consent", () => {
  const repo = freshRepo();
  const projects = fixtureProjects(path.dirname(repo));
  const env = { KICKSTART_PROJECTS_DIR: projects };

  run(repo, ["enter"], { env });
  run(repo, ["history-extract"], { env, expectFailure: true });
  run(repo, ["checkpoint", "awaiting_history_choice"], { env });
  run(repo, ["history-extract"], { env, expectFailure: true });
  run(repo, ["history-choice", "use-history"], { env, expectFailure: true });

  addEligibleHistory(projects);
  const choice = JSON.parse(run(repo, ["history-choice", "use-history"], { env }).stdout);
  assert.equal(choice.status.history_choice, "use-history");
  assert.equal(choice.status.stage, "awaiting_history_choice");
  assert.equal(run(repo, ["history-extract"], { env }).status, 0);
});

test("interview choice is durable and mechanically blocks history extraction", () => {
  const repo = freshRepo();
  const projects = fixtureProjects(path.dirname(repo));
  addEligibleHistory(projects);
  const env = { KICKSTART_PROJECTS_DIR: projects };

  chooseHistory(repo, env);
  run(repo, ["history-extract"], { env });
  const corpus = path.join(repo, "agent-kickstart/state/pro-corpus.json");
  assert.equal(fs.existsSync(corpus), true);
  const choice = JSON.parse(run(repo, ["history-choice", "interview"], { env }).stdout);
  assert.equal(choice.status.history_choice, "interview");
  assert.equal(choice.status.stage, "awaiting_self_description");
  assert.equal(choice.private_corpus_deleted, true);
  assert.equal(fs.existsSync(corpus), false);
  run(repo, ["portrait-verify"], { env, expectFailure: true });
  run(repo, ["history-extract"], { env, expectFailure: true });
  run(repo, ["checkpoint", "awaiting_history_choice"], { env, expectFailure: true });
  run(repo, ["leave"], { env });
  run(repo, ["enter"], { env });
  run(repo, ["checkpoint", "awaiting_history_choice"], { env, expectFailure: true });
  run(repo, ["history-extract"], { env, expectFailure: true });
  assert.equal(
    JSON.parse(run(repo, ["status"], { env }).stdout).status.history_choice,
    "interview",
  );

  // A confirmed reset is the explicit engine-owned way to clear the durable
  // decline and start a genuinely new onboarding choice.
  run(repo, ["reset", "--confirm"], { env });
  run(repo, ["enter"], { env });
  run(repo, ["checkpoint", "awaiting_history_choice"], { env });
  run(repo, ["history-choice", "use-history"], { env });
  assert.equal(run(repo, ["history-extract"], { env }).status, 0);
});

test("portrait-verify enforces verbatim quotes against the extracted corpus", () => {
  const repo = freshRepo();
  const projects = fixtureProjects(path.dirname(repo));
  addEligibleHistory(projects);
  const env = { KICKSTART_PROJECTS_DIR: projects };

  // Requires a corpus first.
  run(repo, ["portrait-verify"], { env, expectFailure: true });

  chooseHistory(repo, env);
  run(repo, ["history-extract"], { env });

  const portrait = path.join(repo, "agent-kickstart/state/user-portrait.md");
  fs.writeFileSync(
    portrait,
    [
      "# User Portrait",
      '- You said "actually rename that helper to sessionGuard instead" (aaaa.jsonl)', // verbatim
      '- You said "please rename that helper to sessionGuard" (lightly edited)', // marked, exempt
      '- You said "I have been shipping compilers since 1987" (aaaa.jsonl)', // fabricated
      '- Short quote "tiny" is ignored.', // under 15 chars, not counted
    ].join("\n"),
  );
  const failing = run(repo, ["portrait-verify"], { env, expectFailure: true });
  const report = JSON.parse(failing.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.quotes_checked, 3);
  assert.equal(report.verified, 1);
  assert.equal(report.marked_edited, 1);
  assert.equal(report.unverified.length, 1);
  assert.ok(report.unverified[0].quote.includes("compilers since 1987"));

  // Removing the fabricated line makes it pass.
  fs.writeFileSync(
    portrait,
    [
      "# User Portrait",
      '- You said "actually rename that helper to sessionGuard instead" (aaaa.jsonl)',
    ].join("\n"),
  );
  const passing = JSON.parse(run(repo, ["portrait-verify"], { env }).stdout);
  assert.equal(passing.ok, true);
  assert.equal(passing.verified, 1);
});

test("history-scan handles a missing projects directory gracefully", () => {
  const repo = freshRepo();
  const scan = JSON.parse(
    run(repo, ["history-scan"], {
      env: { KICKSTART_PROJECTS_DIR: path.join(os.tmpdir(), "kickstart-nonexistent-dir") },
    }).stdout,
  );
  assert.equal(scan.interactive_sessions, 0);
  assert.equal(scan.eligible, false);
});
