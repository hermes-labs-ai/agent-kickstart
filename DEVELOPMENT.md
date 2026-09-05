# Development

Agent Kickstart has no third-party runtime dependencies. Claude Code provides the conversation and native question UI; Node.js provides a small project-local state engine.

## Structure

- `.claude/commands/` contains the one entry and one exit command.
- `.claude/settings.json` keeps state bookkeeping narrow and permission-aware.
- `agent-kickstart/RUNTIME.md` is the active interaction contract.
- `agent-kickstart/ONBOARDING.md` defines resumable stages.
- `agent-kickstart/SAFETY.md` and `PROGRESSION.md` define safety and evidence-based adaptation.
- `agent-kickstart/bin/kickstart-state.mjs` owns validated, atomic local state transitions.
- `examples/` contains synthetic personalization fixtures, never real user data.

## Test

```sh
bash tests/run-tests.sh
node agent-kickstart/bin/kickstart-state.mjs doctor
```

The suite covers clean and repeated installation, entry/resume/exit, malformed state recovery, confirmed portrait deletion, reset preserving creations, reversible guidance, safety settings, and distinct personalization fixtures.

## Design constraint

Keep ordinary language as the primary interface. New slash commands, visible scoring, global configuration, autonomous external actions, or opaque personality labels work against the product.
