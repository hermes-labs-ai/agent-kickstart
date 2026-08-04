#!/usr/bin/env bash
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

bash -n "$ROOT/install.sh"
node --check "$ROOT/agent-kickstart/bin/kickstart-state.mjs"
node --test "$ROOT/tests"/*.test.mjs

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$ROOT/install.sh" "$ROOT/tests/run-tests.sh"
else
  printf '%s\n' "shellcheck not installed; shell syntax passed, lint skipped."
fi
