#!/usr/bin/env bash
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
CHANGED="no"

fail() {
  printf '%s\n' "Agent Kickstart could not be initialized."
  printf '%s\n' "What happened: $1"
  printf '%s\n' "What changed: ${2:-nothing}"
  printf '%s\n' "Safest next action: ${3:-fix the item above, then run 'bash install.sh' again from this folder.}"
  exit 1
}

command -v claude >/dev/null 2>&1 || fail \
  "Claude Code is not available in your command path." \
  "nothing" \
  "install or repair Claude Code, confirm 'claude --version' works, then run this installer again."

command -v node >/dev/null 2>&1 || fail \
  "Node.js is required by this version-zero state engine but was not found." \
  "nothing" \
  "install Node.js 18 or newer, then run this installer again."

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
[ "$NODE_MAJOR" -ge 18 ] || fail \
  "Node.js 18 or newer is required; this computer has $(node --version)." \
  "nothing" \
  "update Node.js, then run this installer again."

for required in \
  ".claude/commands/kickstart.md" \
  ".claude/commands/leave-kickstart.md" \
  ".claude/settings.json" \
  "agent-kickstart/RUNTIME.md" \
  "agent-kickstart/SAFETY.md" \
  "agent-kickstart/bin/kickstart-state.mjs"
do
  [ -f "$ROOT/$required" ] || fail \
    "A required repository file is missing: $required" \
    "$CHANGED" \
    "download a fresh copy of the repository; do not create a guessed replacement file."
done

node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  "$ROOT/.claude/settings.json" >/dev/null 2>&1 || fail \
  ".claude/settings.json is not valid JSON." \
  "$CHANGED" \
  "restore the repository copy of .claude/settings.json, then retry."

chmod u+x "$ROOT/agent-kickstart/bin/kickstart-state.mjs" 2>/dev/null || true

if ! INIT_OUTPUT=$(cd "$ROOT" && node agent-kickstart/bin/kickstart-state.mjs init 2>&1); then
  fail "$INIT_OUTPUT" "$CHANGED"
fi

if printf '%s' "$INIT_OUTPUT" | grep -q '"changed": true'; then
  CHANGED="only missing project-local state files were created"
fi

if ! DOCTOR_OUTPUT=$(cd "$ROOT" && node agent-kickstart/bin/kickstart-state.mjs doctor 2>&1); then
  fail "$DOCTOR_OUTPUT" "$CHANGED"
fi

START_LINE=$(printf 'cd -- %q && claude "/kickstart"' "$ROOT")

printf '%s\n' "Agent Kickstart installation succeeded."
printf '%s\n' "What changed: $CHANGED."
printf '%s\n' "Nothing was written to global Claude Code settings or outside this repository."
printf '%s\n' "Open this exact folder: $ROOT"
printf '%s\n' "Claude Code must be closed and reopened once so the new project command and safety settings load — part of installation, not an error."
printf '%s\n' ""
printf '%s\n' "──────────────── COPY THIS ONE LINE ────────────────"
printf '%s\n' "$START_LINE"
printf '%s\n' "────────────────────────────────────────────────────"
printf '%s\n' ""
printf '%s\n' "If you are inside Claude Code right now, type: /exit — then paste the line into your terminal and Kickstart begins."
printf '%s\n' "The same line works any time you want to come back — you never need to remember a command."
printf '%s\n' "If a workspace trust screen appears, confirm it shows this exact folder, review the project permissions, and choose: Yes, I trust this folder."
printf '%s\n' "If /kickstart is not recognized, paste the same line again; if it still fails, ask Claude to verify .claude/commands/kickstart.md in this folder and repair only this project-local installation."

if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$START_LINE" | pbcopy 2>/dev/null \
    && printf '%s\n' "(Already copied to your clipboard — just paste.)"
fi
