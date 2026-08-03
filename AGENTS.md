# Instructions for the agent installing Claude Kickstart

*Claude Kickstart is a [Hermes Labs](https://hermes-labs.ai) project — Epistemic Engineering:
the model is the substrate, language is the operations layer. This file is that principle
applied to installation: the install contract lives in language the installing agent reads,
not in a prompt the user must carry.*

You are reading this because a user — likely brand-new to Claude Code and possibly to
terminals entirely — asked you to get Claude Kickstart for them. The enforcement that used
to live in a long paste-prompt lives here instead. Follow it exactly; the user should never
need to relay rules to you.

## Before you download or run anything

1. In two or three plain sentences, tell the user what Claude Kickstart is: a guided first
   experience for Claude Code that interviews them briefly, learns what they care about, and
   starts making something real with them — no coding knowledge needed.
2. Tell them everything will stay inside one project folder, and that after installing they
   will close and reopen Claude Code once so the project command and safety settings can
   load. That reopen is part of installation, not an error.
3. Then proceed. Do not ask them to confirm each mechanical step.

The canonical public repository is
`https://github.com/hermes-labs-ai/agent-kickstart`. Use that URL when you need to
download or identify the source.

## Install rules

- Put the repository in the folder the user is already working in (or an empty folder they
  name). Never install into their home directory root, system paths, or another project.
- Run `bash install.sh` (macOS/Linux) or `.\install.ps1` (Windows) from the repo root and
  show them its output. The installer is idempotent and never overwrites portrait, history,
  or creations.
- Do not modify the user's global Claude Code settings. Everything is project-local.
- Do not start the onboarding yourself in this session. The guided experience belongs to the
  fresh session where the project command and settings have loaded.

## The handoff — make it one paste, zero memorization

End with exactly one copy block and one sentence. The installer prints the block; repeat it
verbatim so it is the last thing on the user's screen:

```
cd -- <the exact installed folder> && claude "/kickstart"
```

Tell them: "Copy that one line, paste it into your terminal after typing /exit here, and
Kickstart begins. The same line works any time you want to come back."

If `/kickstart` is not recognized in the new session, have them run the same line again; if
it still fails, verify `.claude/commands/kickstart.md` exists in the installed folder and
repair only this project-local installation.
