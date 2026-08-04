#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const HARNESS = path.join(ROOT, "agent-kickstart");
const STATE_DIR = path.join(HARNESS, "state");
const CREATIONS_DIR = path.join(HARNESS, "creations");
const STATUS_FILE = path.join(STATE_DIR, "status.json");
const LEARNING_FILE = path.join(STATE_DIR, "learning-state.json");
const PORTRAIT_FILE = path.join(STATE_DIR, "user-portrait.md");
const HISTORY_FILE = path.join(STATE_DIR, "possibility-history.md");
const NOTES_FILE = path.join(STATE_DIR, "onboarding-notes.md");
const PENDING_SELECTION_FILE = path.join(STATE_DIR, "pending-selection.md");
const PRO_CORPUS_FILE = path.join(STATE_DIR, "pro-corpus.json");
const PROJECTS_DIR = process.env.KICKSTART_PROJECTS_DIR
  ? path.resolve(process.env.KICKSTART_PROJECTS_DIR)
  : path.join(os.homedir(), ".claude", "projects");

const ONBOARDING_STATES = new Set([
  "not_started",
  "in_progress",
  "interrupted",
  "complete",
]);
const MODES = new Set(["active", "inactive"]);
const STAGES = new Set([
  "welcome",
  "awaiting_safety",
  "awaiting_history_choice",
  "awaiting_self_description",
  "awaiting_followup_1",
  "awaiting_followup_2",
  "awaiting_followup_3",
  "awaiting_portrait_confirmation",
  "awaiting_orientation",
  "awaiting_possibility",
  "first_action",
]);
const EVIDENCE_TYPES = new Set([
  "modified_suggestion",
  "corrected_assumption",
  "understood_file_change",
  "chose_scope",
  "requested_control",
  "recovered_from_error",
  "asked_underlying_mechanism",
]);
const GUIDANCE_PREFERENCES = new Set(["adaptive", "simpler", "advanced"]);
const HISTORY_CHOICES = new Set([null, "use-history", "interview"]);

function now() {
  return new Date().toISOString();
}

function stamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function defaultStatus() {
  return {
    schema_version: 1,
    installation: "initialized",
    mode: "inactive",
    onboarding_status: "not_started",
    stage: "welcome",
    reset_status: "none",
    safety_choice: null,
    history_choice: null,
    selected_direction: null,
    interruption_count: 0,
    last_event: "initialized",
    last_updated: null,
  };
}

function defaultLearning() {
  return {
    schema_version: 1,
    stage: 0,
    label: "guided_passenger",
    guidance_preference: "adaptive",
    evidence: [],
    last_updated: null,
  };
}

const STAGE_LABELS = [
  "guided_passenger",
  "active_chooser",
  "collaborative_steerer",
  "capable_builder",
  "independent_user",
];

const PORTRAIT_TEMPLATE = `# User Portrait

This file belongs to the user. It is local, readable, editable, and deletable.

## Explicitly shared

_Not collected yet._

## Interests and recurring themes

_Not collected yet._

## Desired outcomes and frictions

_Not collected yet._

## Learning and communication preferences

_Not collected yet._

## Explicit boundaries

_Not collected yet._

## Provisional interaction hypotheses

_None yet. Hypotheses must be labeled as tentative and corrected when the user disagrees._
`;

const HISTORY_TEMPLATE = `# Possibility History

Generated, selected, modified, combined, and rejected directions are recorded here.
This is a working memory, not a list of permitted actions.
`;

const NOTES_TEMPLATE = `# Onboarding Notes

Resumable notes from the user's own words and the pending question are kept here.
The user can inspect, correct, or delete this file at any time.
`;

const PENDING_SELECTION_TEMPLATE = `# Pending Selection

_No direction is pending._
`;

function fail(message, details = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message, ...details }, null, 2)}\n`);
  process.exitCode = 1;
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertLocalPath(target) {
  const rootReal = fs.realpathSync(ROOT);
  const existing = fs.existsSync(target)
    ? fs.realpathSync(target)
    : fs.realpathSync(path.dirname(target));
  if (!isInside(existing, rootReal)) {
    throw new Error(`Refusing a state path outside this repository: ${target}`);
  }
}

function ensureDirectories() {
  assertLocalPath(HARNESS);
  if (fs.existsSync(STATE_DIR) && fs.lstatSync(STATE_DIR).isSymbolicLink()) {
    const target = fs.realpathSync(STATE_DIR);
    if (!isInside(target, fs.realpathSync(ROOT))) {
      throw new Error("Refusing a state directory symlink that leaves this repository");
    }
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(CREATIONS_DIR, { recursive: true });
  assertLocalPath(STATE_DIR);
  assertLocalPath(CREATIONS_DIR);
}

function atomicWrite(file, content) {
  assertLocalPath(file);
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureFile(file, content) {
  if (!fs.existsSync(file)) atomicWrite(file, content);
}

function validateStatus(value) {
  if (!value || value.schema_version !== 1) throw new Error("unsupported status schema");
  if (value.installation !== "initialized") throw new Error("installation is not initialized");
  if (!MODES.has(value.mode)) throw new Error(`invalid mode: ${value.mode}`);
  if (!ONBOARDING_STATES.has(value.onboarding_status)) {
    throw new Error(`invalid onboarding status: ${value.onboarding_status}`);
  }
  if (!STAGES.has(value.stage)) throw new Error(`invalid onboarding stage: ${value.stage}`);
  if (!Number.isInteger(value.interruption_count) || value.interruption_count < 0) {
    throw new Error("invalid interruption count");
  }
  // Status files created before the existing-history lane did not carry this
  // field. Treat them as having made no choice rather than corrupting/replacing
  // otherwise valid user state.
  if (value.history_choice === undefined) value.history_choice = null;
  if (!HISTORY_CHOICES.has(value.history_choice)) {
    throw new Error(`invalid history choice: ${value.history_choice}`);
  }
  return value;
}

function validateLearning(value) {
  if (!value || value.schema_version !== 1) throw new Error("unsupported learning schema");
  if (!Number.isInteger(value.stage) || value.stage < 0 || value.stage > 4) {
    throw new Error("learning stage must be an integer from 0 to 4");
  }
  if (value.label !== STAGE_LABELS[value.stage]) throw new Error("learning label does not match stage");
  if (!GUIDANCE_PREFERENCES.has(value.guidance_preference)) {
    throw new Error("invalid guidance preference");
  }
  if (!Array.isArray(value.evidence)) throw new Error("learning evidence must be an array");
  return value;
}

function recoverJson(file, factory, validator) {
  const backup = `${file}.corrupt-${stamp()}.bak`;
  fs.renameSync(file, backup);
  const replacement = factory();
  writeJson(file, replacement);
  process.stderr.write(
    `Agent Kickstart recovered malformed state. The original was preserved at ${path.relative(ROOT, backup)}.\n`,
  );
  return validator(replacement);
}

function loadJson(file, factory, validator) {
  ensureDirectories();
  if (!fs.existsSync(file)) {
    const value = factory();
    writeJson(file, value);
    return validator(value);
  }
  assertLocalPath(file);
  try {
    return validator(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return recoverJson(file, factory, validator);
  }
}

function loadStatus() {
  return loadJson(STATUS_FILE, defaultStatus, validateStatus);
}

function loadLearning() {
  return loadJson(LEARNING_FILE, defaultLearning, validateLearning);
}

function initialize() {
  ensureDirectories();
  const created = [];
  const candidates = [
    [STATUS_FILE, `${JSON.stringify(defaultStatus(), null, 2)}\n`],
    [LEARNING_FILE, `${JSON.stringify(defaultLearning(), null, 2)}\n`],
    [PORTRAIT_FILE, PORTRAIT_TEMPLATE],
    [HISTORY_FILE, HISTORY_TEMPLATE],
    [NOTES_FILE, NOTES_TEMPLATE],
    [PENDING_SELECTION_FILE, PENDING_SELECTION_TEMPLATE],
  ];
  for (const [file, content] of candidates) {
    if (!fs.existsSync(file)) {
      ensureFile(file, content);
      created.push(path.relative(ROOT, file));
    }
  }
  loadStatus();
  loadLearning();
  return { ok: true, action: "init", created, changed: created.length > 0 };
}

function saveStatus(status, event) {
  status.last_event = event;
  status.last_updated = now();
  validateStatus(status);
  writeJson(STATUS_FILE, status);
}

function saveLearning(learning) {
  learning.label = STAGE_LABELS[learning.stage];
  learning.last_updated = now();
  validateLearning(learning);
  writeJson(LEARNING_FILE, learning);
}

function enter() {
  initialize();
  const status = loadStatus();
  let route;
  if (status.onboarding_status === "not_started") {
    route = "first_run";
    status.onboarding_status = "in_progress";
    status.stage = "awaiting_safety";
  } else if (["in_progress", "interrupted"].includes(status.onboarding_status)) {
    route = "resume_onboarding";
    if (status.onboarding_status === "interrupted") status.interruption_count += 1;
    status.onboarding_status = "in_progress";
  } else {
    route = status.mode === "active" ? "already_active" : "returning_user";
  }
  status.mode = "active";
  status.reset_status = "none";
  saveStatus(status, route);
  return { ok: true, action: "enter", route, status };
}

function checkpoint(stage, extra = {}) {
  if (!STAGES.has(stage)) throw new Error(`Unknown checkpoint stage: ${stage}`);
  const status = loadStatus();
  if (status.mode !== "active") throw new Error("Enter Agent Kickstart before checkpointing onboarding");
  if (stage === "awaiting_history_choice" && status.history_choice === "interview") {
    throw new Error("History was declined; reset or delete the portrait before reopening the fast lane");
  }
  status.onboarding_status = "in_progress";
  if (
    status.stage === "awaiting_history_choice" &&
    stage !== "awaiting_history_choice" &&
    status.history_choice === null
  ) {
    throw new Error("Record the history choice before leaving awaiting_history_choice");
  }
  status.stage = stage;
  if (stage === "awaiting_history_choice") status.history_choice = null;
  if (extra.safety_choice) status.safety_choice = extra.safety_choice;
  saveStatus(status, `checkpoint:${stage}`);
  return { ok: true, action: "checkpoint", stage, status };
}

function recordHistoryChoice(choice) {
  if (!HISTORY_CHOICES.has(choice) || choice === null) {
    throw new Error("History choice must be use-history or interview");
  }
  const status = loadStatus();
  if (status.mode !== "active") {
    throw new Error("Enter Agent Kickstart before recording the history choice");
  }
  if (status.stage !== "awaiting_history_choice") {
    throw new Error("History choice is only valid at awaiting_history_choice");
  }
  if (choice === "use-history") {
    const scan = historyScan();
    if (!scan.eligible) {
      throw new Error("History fast lane is unavailable because the local history is not eligible");
    }
  }
  const corpusDeleted = choice === "interview" ? deleteProCorpus() : false;
  status.history_choice = choice;
  if (choice === "interview") status.stage = "awaiting_self_description";
  saveStatus(status, `history_choice:${choice}`);
  return {
    ok: true,
    action: "history_choice_recorded",
    choice,
    next_stage: status.stage,
    private_corpus_deleted: corpusDeleted,
    status,
  };
}

function complete() {
  const status = loadStatus();
  if (status.mode !== "active") throw new Error("Enter Agent Kickstart before completing onboarding");
  status.onboarding_status = "complete";
  status.stage = "first_action";
  saveStatus(status, "onboarding_complete");
  return { ok: true, action: "complete", status };
}

function leave() {
  const status = loadStatus();
  if (status.onboarding_status === "in_progress") status.onboarding_status = "interrupted";
  status.mode = "inactive";
  saveStatus(status, "left_guided_mode");
  return {
    ok: true,
    action: "leave",
    preserved: [
      "agent-kickstart/state/user-portrait.md",
      "agent-kickstart/state/possibility-history.md",
      "agent-kickstart/creations/",
    ],
    clean_exit_note: "A fresh Claude Code session removes any residual instructions from the current conversation.",
    re_entry: "The user returns by typing /kickstart. Plain-language phrases will not re-enter guided mode in a fresh session; relay the exact command.",
    status,
  };
}

function sessionEnd() {
  const status = loadStatus();
  if (status.mode === "active" && status.onboarding_status === "in_progress") {
    status.onboarding_status = "interrupted";
    status.mode = "inactive";
    saveStatus(status, "session_interrupted");
  }
}

function requestReset() {
  const status = loadStatus();
  status.reset_status = "requested";
  saveStatus(status, "reset_requested");
  return { ok: true, action: "reset_requested", confirmation_required: true, status };
}

function resetConfirmed() {
  const corpusDeleted = deleteProCorpus();
  const previous = loadStatus();
  const reset = defaultStatus();
  reset.reset_status = "completed";
  reset.last_event = "reset_completed";
  reset.last_updated = now();
  reset.interruption_count = previous.interruption_count;
  writeJson(STATUS_FILE, reset);
  writeJson(LEARNING_FILE, defaultLearning());
  atomicWrite(PORTRAIT_FILE, PORTRAIT_TEMPLATE);
  atomicWrite(HISTORY_FILE, HISTORY_TEMPLATE);
  atomicWrite(NOTES_FILE, NOTES_TEMPLATE);
  atomicWrite(PENDING_SELECTION_FILE, PENDING_SELECTION_TEMPLATE);
  return {
    ok: true,
    action: "reset",
    preserved: ["agent-kickstart/creations/"],
    private_corpus_deleted: corpusDeleted,
    status: reset,
  };
}

function clearPortrait() {
  const corpusDeleted = deleteProCorpus();
  const status = loadStatus();
  atomicWrite(PORTRAIT_FILE, PORTRAIT_TEMPLATE);
  atomicWrite(NOTES_FILE, NOTES_TEMPLATE);
  if (status.mode === "active") {
    status.onboarding_status = "in_progress";
    status.stage = "awaiting_self_description";
  } else {
    status.onboarding_status = "not_started";
    status.stage = "welcome";
  }
  status.history_choice = null;
  saveStatus(status, "portrait_deleted");
  return {
    ok: true,
    action: "portrait_deleted",
    creations_preserved: true,
    private_corpus_deleted: corpusDeleted,
    status,
  };
}

function selectDirection(text) {
  const direction = text.trim();
  if (!direction) throw new Error("A selected direction is required");
  const status = loadStatus();
  status.selected_direction = direction;
  saveStatus(status, "direction_selected");
  fs.appendFileSync(
    HISTORY_FILE,
    `\n## Selected — ${now()}\n\n${direction}\n`,
    "utf8",
  );
  return { ok: true, action: "direction_selected", direction, status };
}

function selectFromPending() {
  if (!fs.existsSync(PENDING_SELECTION_FILE)) {
    throw new Error("The pending selection file is missing");
  }
  const content = fs.readFileSync(PENDING_SELECTION_FILE, "utf8");
  const direction = content
    .replace(/^# Pending Selection\s*/i, "")
    .replace(/^_No direction is pending\._\s*/i, "")
    .trim();
  if (!direction) throw new Error("Write the chosen or combined direction to state/pending-selection.md first");
  const result = selectDirection(direction);
  atomicWrite(PENDING_SELECTION_FILE, PENDING_SELECTION_TEMPLATE);
  return { ...result, action: "direction_selected_from_pending" };
}

function evidence(type, note) {
  if (!EVIDENCE_TYPES.has(type)) throw new Error(`Unknown evidence type: ${type}`);
  const learning = loadLearning();
  learning.evidence.push({ type, note: note || "", observed_at: now() });
  learning.evidence = learning.evidence.slice(-50);
  const unique = new Set(learning.evidence.map((item) => item.type));
  let recommendation = 0;
  if (unique.size >= 1) recommendation = 1;
  if (unique.size >= 2) recommendation = 2;
  if (unique.size >= 4 && (unique.has("requested_control") || unique.has("recovered_from_error"))) {
    recommendation = 3;
  }
  if (unique.size >= 6 && unique.has("asked_underlying_mechanism")) recommendation = 4;
  if (learning.guidance_preference === "adaptive") {
    learning.stage = Math.max(learning.stage, recommendation);
  }
  saveLearning(learning);
  return { ok: true, action: "evidence_recorded", type, recommendation, learning };
}

function setGuidance(preference) {
  if (!GUIDANCE_PREFERENCES.has(preference)) throw new Error(`Unknown guidance preference: ${preference}`);
  const learning = loadLearning();
  learning.guidance_preference = preference;
  if (preference === "simpler") learning.stage = Math.max(0, learning.stage - 1);
  if (preference === "advanced") learning.stage = Math.min(4, learning.stage + 1);
  saveLearning(learning);
  return { ok: true, action: "guidance_updated", learning };
}

function setLevel(level) {
  const parsed = Number(level);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 4) {
    throw new Error("Level must be an integer from 0 to 4");
  }
  const learning = loadLearning();
  learning.stage = parsed;
  saveLearning(learning);
  return { ok: true, action: "level_updated", learning };
}

// --- Existing-history fast lane (pro) -------------------------------------
// Detection and extraction over the user's own local Claude Code transcripts
// (~/.claude/projects). Everything stays on this machine: `history-scan`
// writes nothing and returns counts only; `history-extract` writes to the
// gitignored state directory. A session counts as interactive only when it
// holds >= 3 usable typed messages — headless or automated sessions carry a
// single synthetic prompt and must not masquerade as the user's voice.

const MIN_INTERACTIVE_MESSAGES = 3;
const ELIGIBLE_MIN_SESSIONS = 5;
const ELIGIBLE_MIN_MESSAGES = 100;
const EXTRACT_SESSION_CAP = 80;
const MEMORY_CHUNK_CAP = 120;

function deleteProCorpus() {
  if (!fs.existsSync(PRO_CORPUS_FILE)) return false;
  assertLocalPath(PRO_CORPUS_FILE);
  fs.unlinkSync(PRO_CORPUS_FILE);
  return true;
}

function usableUserMessages(file) {
  const messages = [];
  let lines;
  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch {
    return messages;
  }
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.type !== "user") continue;
    const content = entry.message?.content;
    if (typeof content !== "string") continue;
    const text = content.trim();
    if (text.length < 15 || text.length > 500) continue;
    if (text.startsWith("<") || text.startsWith("[") || text.startsWith("{")) continue;
    if (text.toLowerCase().includes("system-reminder")) continue;
    if (text.includes("<bash-") || text.includes("<tool_") || text.includes("<command-name>")) continue;
    messages.push(text);
  }
  return messages;
}

function interactiveSessions() {
  const sessions = [];
  if (!fs.existsSync(PROJECTS_DIR)) return sessions;
  for (const project of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!project.isDirectory() || project.name === "-") continue;
    const projectDir = path.join(PROJECTS_DIR, project.name);
    let files;
    try {
      files = fs.readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(projectDir, name);
      let mtime;
      try {
        mtime = fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      const messages = usableUserMessages(file);
      if (messages.length >= MIN_INTERACTIVE_MESSAGES) {
        sessions.push({ project: project.name, session: name, mtime, messages });
      }
    }
  }
  sessions.sort((a, b) => a.mtime - b.mtime);
  return sessions;
}

function historyStats(sessions) {
  return {
    projects_dir: PROJECTS_DIR,
    interactive_sessions: sessions.length,
    usable_messages: sessions.reduce((sum, s) => sum + s.messages.length, 0),
  };
}

function historyScan() {
  const stats = historyStats(interactiveSessions());
  const eligible =
    stats.interactive_sessions >= ELIGIBLE_MIN_SESSIONS &&
    stats.usable_messages >= ELIGIBLE_MIN_MESSAGES;
  return { ok: true, action: "history_scan", ...stats, eligible, wrote: "nothing" };
}

function dedupeChunks(chunks) {
  const seen = new Set();
  const unique = [];
  for (const chunk of chunks) {
    const key = chunk.text.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(chunk);
  }
  return unique;
}

function memoryChunks() {
  const chunks = [];
  if (!fs.existsSync(PROJECTS_DIR)) return chunks;
  for (const project of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (chunks.length >= MEMORY_CHUNK_CAP) break;
    if (!project.isDirectory() || project.name === "-") continue;
    const memoryDir = path.join(PROJECTS_DIR, project.name, "memory");
    if (!fs.existsSync(memoryDir)) continue;
    for (const name of fs.readdirSync(memoryDir).sort()) {
      if (chunks.length >= MEMORY_CHUNK_CAP) break;
      if (!name.endsWith(".md")) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(memoryDir, name), "utf8");
      } catch {
        continue;
      }
      if (text.startsWith("---")) {
        const end = text.indexOf("---", 4);
        if (end > 0) text = text.slice(end + 3).trim();
      }
      for (const paragraph of text.split("\n\n")) {
        if (chunks.length >= MEMORY_CHUNK_CAP) break;
        const trimmed = paragraph.trim();
        if (!trimmed) continue;
        const lines = trimmed.split("\n");
        const listLines = lines.filter((l) => /^\s*([-*#]|\d+\.)/.test(l)).length;
        if (lines.length > 2 && listLines / lines.length > 0.5) continue;
        const words = trimmed.split(/\s+/).length;
        if (words >= 15 && words <= 120) {
          chunks.push({ text: trimmed, source: `${project.name}/memory/${name}` });
        }
      }
    }
  }
  return chunks;
}

function historyExtract() {
  const status = loadStatus();
  if (status.mode !== "active") throw new Error("Enter Agent Kickstart before extracting history");
  if (status.stage !== "awaiting_history_choice" || status.history_choice !== "use-history") {
    throw new Error("History extraction requires the recorded use-history choice");
  }
  const scan = historyScan();
  if (!scan.eligible) {
    throw new Error("History fast lane is unavailable because the local history is not eligible");
  }
  const sessions = interactiveSessions().slice(-EXTRACT_SESSION_CAP);
  const transcripts = dedupeChunks(
    sessions.flatMap((s) =>
      s.messages.map((text) => ({ text, project: s.project, session: s.session })),
    ),
  );
  const memory = dedupeChunks(memoryChunks());
  const stats = {
    ...historyStats(sessions),
    transcript_chunks: transcripts.length,
    memory_chunks: memory.length,
  };
  writeJson(PRO_CORPUS_FILE, {
    schema_version: 1,
    generated_at: now(),
    note:
      "Local extraction of the user's own Claude Code history for portrait synthesis. " +
      "Transcript chunks are firsthand (typed by the user). Memory chunks are secondhand " +
      "(assistant-authored notes) and may support inferences but never facts.",
    stats,
    transcripts,
    memory,
  });
  return {
    ok: true,
    action: "history_extracted",
    ...stats,
    corpus_file: path.relative(ROOT, PRO_CORPUS_FILE),
  };
}

// Mechanical check for the derived-portrait synthesis contract: every quoted
// span in the portrait must exist verbatim in the extracted corpus. Prose rules
// alone are skippable; this gate is not. Catches fabricated quotes, silently
// cleaned-up quotes, and facts that leaked in from outside the corpus.
function portraitVerify() {
  if (!fs.existsSync(PRO_CORPUS_FILE)) {
    throw new Error("No derived corpus found: run history-extract before portrait-verify");
  }
  if (!fs.existsSync(PORTRAIT_FILE)) {
    throw new Error("No portrait found: write state/user-portrait.md before portrait-verify");
  }
  const corpus = JSON.parse(fs.readFileSync(PRO_CORPUS_FILE, "utf8"));
  const haystack = [...(corpus.transcripts || []), ...(corpus.memory || [])].map((c) =>
    c.text.toLowerCase(),
  );
  const lines = fs.readFileSync(PORTRAIT_FILE, "utf8").split("\n");
  let checked = 0;
  let markedEdited = 0;
  const unverified = [];
  lines.forEach((line, index) => {
    // Directional curly pairs are unambiguous; straight quotes pair by
    // alternation (odd split segments are the quoted spans). Matching the raw
    // regex /"..."/ instead would capture the text BETWEEN two quotations on
    // lines that quote more than once.
    const spans = [];
    for (const match of line.matchAll(/“([^“”]+)”/g)) spans.push(match[1]);
    const straight = line.replace(/“[^“”]+”/g, "").split('"');
    for (let i = 1; i < straight.length; i += 2) spans.push(straight[i]);
    for (const span of spans) {
      if (span.length < 15) continue;
      checked += 1;
      if (/lightly edited/i.test(line)) {
        markedEdited += 1;
        continue;
      }
      // Quotation convention allows one terminal punctuation mark; everything
      // else must be verbatim corpus text.
      const needle = span.toLowerCase().replace(/[.?!,…]$/, "");
      if (!haystack.some((text) => text.includes(needle))) {
        unverified.push({ line: index + 1, quote: span.slice(0, 120) });
      }
    }
  });
  return {
    ok: unverified.length === 0,
    action: "portrait_verified",
    quotes_checked: checked,
    verified: checked - markedEdited - unverified.length,
    marked_edited: markedEdited,
    unverified,
    rule:
      "Every unverified quote must be corrected to the verbatim corpus text, removed, " +
      "or explicitly marked (lightly edited) on its line before the portrait is confirmed.",
  };
}

function doctor() {
  const required = [
    path.join(ROOT, ".claude", "commands", "kickstart.md"),
    path.join(ROOT, ".claude", "commands", "leave-kickstart.md"),
    path.join(ROOT, ".claude", "settings.json"),
    path.join(HARNESS, "RUNTIME.md"),
    path.join(HARNESS, "SAFETY.md"),
  ];
  const missing = required.filter((file) => !fs.existsSync(file)).map((file) => path.relative(ROOT, file));
  const status = loadStatus();
  const learning = loadLearning();
  let settingsValid = true;
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "settings.json"), "utf8"));
  } catch {
    settingsValid = false;
  }
  return {
    ok: missing.length === 0 && settingsValid,
    action: "doctor",
    repository: ROOT,
    node: process.version,
    missing,
    settings_valid: settingsValid,
    status_valid: Boolean(status),
    learning_valid: Boolean(learning),
  };
}

function creationFiles(directory = CREATIONS_DIR, relativeBase = CREATIONS_DIR, found = []) {
  if (!fs.existsSync(directory) || found.length >= 40) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (found.length >= 40) break;
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) creationFiles(absolute, relativeBase, found);
    if (entry.isFile() && entry.name !== ".gitkeep") found.push(path.relative(relativeBase, absolute));
  }
  return found;
}

function hookContext() {
  try {
    initialize();
    const status = loadStatus();
    if (status.mode !== "active") return;
    const learning = loadLearning();
    const creations = creationFiles();
    let portrait = "Portrait not completed.";
    if (fs.existsSync(PORTRAIT_FILE)) {
      portrait = fs.readFileSync(PORTRAIT_FILE, "utf8").slice(0, 1800);
    }
    const context = [
      "Agent Kickstart guided mode is ACTIVE for this project.",
      "Use ordinary language as the primary interface; do not require additional slash commands.",
      "Follow agent-kickstart/RUNTIME.md and agent-kickstart/SAFETY.md. Keep work project-local by default and use normal permission prompts.",
      "If the user asks to exit, inspect/correct/delete their portrait, simplify guidance, show more control, or generate possibilities, route that intent exactly as RUNTIME.md specifies.",
      `Durable status: ${JSON.stringify(status)}.`,
      `Guidance state: ${JSON.stringify({ stage: learning.stage, label: learning.label, preference: learning.guidance_preference })}.`,
      `Verified creation files: ${creations.length > 0 ? creations.join(", ") : "none yet"}. Do not claim this list is empty or nonempty without using this evidence or checking the directory.`,
      `Current local portrait excerpt:\n${portrait}`,
    ].join("\n");
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: context,
        },
      }),
    );
  } catch {
    // Hooks must never break Claude Code startup. Doctor surfaces details explicitly.
  }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return {
    ok: false,
    usage: [
      "init | doctor | status | enter | leave | session-end",
      "checkpoint <stage> [safety-choice] | history-choice <use-history|interview>",
      "complete | select <direction> | select-from-pending",
      "request-reset | reset --confirm | portrait-clear --confirm",
      "evidence <type> [note] | guidance <adaptive|simpler|advanced>",
      "level <0..4> --confirm | hook-context",
      "history-scan | history-extract | portrait-verify",
    ],
  };
}

async function main() {
  const [command = "", ...args] = process.argv.slice(2);
  try {
    switch (command) {
      case "init":
        print(initialize());
        break;
      case "doctor": {
        const result = doctor();
        print(result);
        if (!result.ok) process.exitCode = 1;
        break;
      }
      case "status":
        initialize();
        print({ ok: true, status: loadStatus(), learning: loadLearning() });
        break;
      case "enter":
        print(enter());
        break;
      case "checkpoint":
        print(checkpoint(args[0], { safety_choice: args.slice(1).join(" ") || null }));
        break;
      case "history-choice":
        print(recordHistoryChoice(args[0]));
        break;
      case "complete":
        print(complete());
        break;
      case "leave":
        print(leave());
        break;
      case "session-end":
        sessionEnd();
        break;
      case "request-reset":
        print(requestReset());
        break;
      case "reset":
        if (!args.includes("--confirm")) throw new Error("Reset requires --confirm after explicit user confirmation");
        print(resetConfirmed());
        break;
      case "portrait-clear":
        if (!args.includes("--confirm")) {
          throw new Error("Portrait deletion requires --confirm after explicit user confirmation");
        }
        print(clearPortrait());
        break;
      case "select":
        print(selectDirection(args.join(" ")));
        break;
      case "select-from-pending":
        print(selectFromPending());
        break;
      case "evidence":
        print(evidence(args[0], args.slice(1).join(" ")));
        break;
      case "guidance":
        print(setGuidance(args[0]));
        break;
      case "level":
        if (!args.includes("--confirm")) throw new Error("Changing level requires --confirm");
        print(setLevel(args[0]));
        break;
      case "hook-context":
        hookContext();
        break;
      case "history-scan":
        print(historyScan());
        break;
      case "history-extract":
        print(historyExtract());
        break;
      case "portrait-verify": {
        const result = portraitVerify();
        print(result);
        if (!result.ok) process.exitCode = 1;
        break;
      }
      default:
        print(usage());
        process.exitCode = 1;
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), {
      changed: false,
      next_action: "Run `node agent-kickstart/bin/kickstart-state.mjs doctor` from the repository root.",
    });
  }
}

await main();
