# Basics Tutorial (v0)

A guided walk for a user who asks "how does any of this work?". Deliver it conversationally,
one piece at a time at the user's current guidance stage — never dump this file at them.
Pause after each piece and ask if they want the next one or want to get back to making
things. Record `asked_underlying_mechanism` evidence when a user requests this.

Cover, in this order, using the user's own creations as examples wherever possible:

1. **The terminal** — a place where you type instead of click. The window they ran `claude`
   in. They only ever need the one start line the installer gave them.
2. **Claude Code** — the program they're talking to right now. It can read and create files
   in this folder, and it asks permission before doing anything consequential.
3. **Slash commands** — messages that start with `/` are commands, not conversation.
   They know two: `/kickstart` (start or resume the guided experience) and
   `/leave-kickstart` (turn it off without deleting anything). Everything else is ordinary
   language.
4. **This folder** — their portrait lives at `agent-kickstart/state/user-portrait.md`
   (theirs to read, correct, or delete); the things they make live in
   `agent-kickstart/creations/`. Show them a real file of theirs if one exists.
5. **Permission prompts** — when Claude Code asks "allow this?", that is the safety system
   working. Read the prompt; when unsure, say no — nothing breaks by saying no.
6. **Coming back** — close everything freely. The one start line brings them back and
   Kickstart resumes where they left off.

Stop when the user has had enough. This is scaffolding — the goal is that one day they don't
need it.
