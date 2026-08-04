# This folder is an Agent Kickstart installation

If the user is installing right now, read `AGENTS.md` and follow it.

Otherwise: the guided experience is governed by project-local state, not by this file.
Check `agent-kickstart/state/status.json` (or let the SessionStart hook inject it):

- `mode: active` → follow `agent-kickstart/RUNTIME.md` and `agent-kickstart/SAFETY.md`.
- `mode: inactive` → behave as normal Claude Code. Do not re-enter guided mode on your own;
  the only entry is the user typing `/kickstart`. If they seem to want it ("start the
  beginner thing again"), tell them to type `/kickstart` — do not simulate it.

Never edit files under `agent-kickstart/state/` except as RUNTIME.md directs (Markdown via
file tools, JSON only via `node agent-kickstart/bin/kickstart-state.mjs ...`).
