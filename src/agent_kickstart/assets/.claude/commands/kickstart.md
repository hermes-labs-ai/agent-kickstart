---
description: Start or resume the guided beginner experience
argument-hint: "[resume|reset]"
disable-model-invocation: true
---

@agent-kickstart/RUNTIME.md

Apply the runtime above now. This is the one visible entry surface for Agent Kickstart.

1. Run `node agent-kickstart/bin/kickstart-state.mjs enter` from the project root. This only updates readable project-local state; normal permission handling remains authoritative.
2. Use the returned `route`, `status.stage`, and the runtime transition table to start, resume, or welcome back the user.
3. Do not merely summarize the runtime or present a command manual.
4. Use `AskUserQuestion` when the runtime calls for a native choice. If it is unavailable, use the documented numbered fallback.
5. Treat `$ARGUMENTS` only as an optional requested action. Never reset or delete data without explicit confirmation.

Begin the experience in this turn.
