# Ten-minute friend demo

## Before they arrive

1. Make sure Claude Code and Node.js 18 or newer are installed.
2. Create an empty folder and open Claude Code there.
3. Keep the public repository URL ready, but do not preinstall Kickstart. The installation handoff is part of the demo.

## Live script

Say: “I am going to show you a terminal that does not expect you to speak terminal.”

Have your friend paste:

> Install Agent Kickstart from https://github.com/hermes-labs-ai/agent-kickstart and walk me through it — I'm new to this.

The repository's `AGENTS.md` instructs the installing agent: it explains the download before doing anything, keeps everything inside the folder, and ends with **one copy-paste line** (`cd -- <folder> && claude "/kickstart"`) — on a Mac the installer also puts it on the clipboard. Have your friend type `/exit`, paste that one line, and approve the workspace trust screen after verifying the folder and permissions. This one reopen is required by Claude Code's native project-command and settings lifecycle; there are no steps to memorize, and the same line is how they come back tomorrow.

Let them choose the safest option. Then encourage dictation or typing:

> Do not organize this for the computer. Tell it what your days are like, what you care about, what keeps recurring, and what you wish were easier or possible.

Do not steer the content. The proof is that the follow-ups and possibilities reflect their language.

When the portrait appears, ask them to correct one thing—even if minor. Then have them choose, combine, or alter a possibility. The demo succeeds when something real starts to exist in `agent-kickstart/creations/`, not when onboarding ends.

Useful natural-language demonstrations:

- “Make the second one less practical and more playful.”
- “None of those. Use what I said, but surprise me differently.”
- “I am overwhelmed. Give me one tiny next step.”
- “Show me what you think you know about me.”
- “Let me do more of this myself.”

Exit with:

```text
/leave-kickstart
```

Show that the portrait and creation remain. Start a new session if you want to demonstrate a completely clean normal-Claude context.

## Recovery beat

For a deliberate resume demonstration, leave after the self-description, start Claude again, and run `/kickstart`. It should identify the saved pending stage and continue from the next generated follow-up rather than asking the opening questions again.
