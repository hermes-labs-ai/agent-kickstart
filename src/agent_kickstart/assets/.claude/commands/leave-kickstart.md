---
description: Leave the guided beginner experience without deleting work
disable-model-invocation: true
---

Run `node agent-kickstart/bin/kickstart-state.mjs leave` from the project root, then plainly tell the user:

- guided mode is inactive;
- their portrait, possibility history, and creations were preserved;
- normal Claude Code behavior resumes for later prompts;
- to come back later, they type `/kickstart` — that exact command is the only reliable re-entry. Never tell them a plain-language phrase like "turn Kickstart back on" will work in a fresh session; once guided mode is inactive, a new session knows nothing about Kickstart until `/kickstart` is typed;
- starting a fresh Claude Code session is the strongest way to remove residual guided instructions from this already-open conversation.

If the user's message asked anything else alongside the exit (for example "what do you know about me? and turn this off"), answer that request fully BEFORE running `leave`. An exit request never swallows the other intents in the same message.

Do not delete, reset, or modify their creations. Do not keep applying the Agent Kickstart interaction style after acknowledging the exit.
