# Existing-History Fast Lane

For people who already have real Claude Code history on this machine. Instead of the
interview, the portrait is derived from what they have actually typed — then confirmed
with them exactly as an interviewed portrait would be. `ONBOARDING.md` remains the
authoritative flow for every stage not described here.

## When to offer it

After the safety choice is saved and before the self-description interview begins, run:

```text
node agent-kickstart/bin/kickstart-state.mjs history-scan
```

It reads nothing into the conversation and writes nothing; it returns counts and an
`eligible` verdict (at least 5 interactive sessions and 100 usable typed messages —
sessions with fewer than 3 typed messages are automated noise and never count). If not
eligible, say nothing about the fast lane and continue at `awaiting_self_description`;
a thin corpus makes a thin portrait, and the interview is strictly better.

## `awaiting_history_choice`

If eligible, checkpoint this stage, then offer the choice with one `AskUserQuestion`
call, header `Fast lane`, single-select:

1. **Use my history** — Build my portrait from what I've already typed here (it stays on this machine; I review and correct it before anything happens).
2. **Interview me instead** — Ask me the normal questions; ignore my history.

Before the question, say plainly in one or two sentences: this reads their own past
Claude Code messages and local memory notes, entirely on this machine, and nothing is
kept without their review. Record the answer through the engine; prose alone is not
consent. If they choose the interview, run
`node agent-kickstart/bin/kickstart-state.mjs history-choice interview`. That transition
durably records the decline, moves to `awaiting_self_description`, and mechanically
blocks extraction. If they choose their history, run these two commands separately:

```text
node agent-kickstart/bin/kickstart-state.mjs history-choice use-history
node agent-kickstart/bin/kickstart-state.mjs history-extract
```

The engine accepts `use-history` only at `awaiting_history_choice` while the local corpus
is eligible. Extraction rechecks both that recorded consent and current eligibility.

## Synthesizing the derived portrait

Read `agent-kickstart/state/pro-corpus.json` and write `state/user-portrait.md` with
the same six sections as the interviewed portrait. Non-negotiable rules:

- **Two tiers, always.** A fact is something the user literally typed, and it carries a
  terse provenance tag (project or session). Everything else is a tentative inference,
  labeled as such. Memory chunks are secondhand (assistant-authored) — they may support
  an inference but can never make something a fact.
- **Provenance firewall.** Only content inside `pro-corpus.json` may become a fact. If
  you recognize something about the user from anywhere else — project instructions,
  memory outside the corpus, this conversation — it does not enter the portrait as fact.
- **Quote verbatim.** When quoting the user, quote exactly, typos included. If you must
  normalize a quote for readability, mark it as lightly edited. Never silently clean up.
- **Exclude simulated voices.** Transcripts can contain synthetic personas, pasted text,
  role-play, and test sessions. When first-person statements are inconsistent with the
  rest of the corpus or come from obvious test contexts, leave them out rather than
  attribute them.
- **No scoring.** No personality typing, no numeric trait dimensions, no vulnerability
  or persuasion analysis. Same rule as everywhere in this harness.
- **Honest thinness.** If a section has no real support in the corpus, say so in the
  portrait instead of padding it.

After writing the portrait, run the mechanical check — the rules above are enforced,
not trusted:

```text
node agent-kickstart/bin/kickstart-state.mjs portrait-verify
```

It checks every quoted span in the portrait against the extracted corpus and fails if
any quote is not verbatim corpus text. Fix each reported quote — restore the exact
original, remove it, or mark its line `(lightly edited)` — and re-run until it passes.
Never show the user an unverified portrait.

Then checkpoint `awaiting_portrait_confirmation` and follow `ONBOARDING.md` from there,
with one adaptation: a derived portrait is bigger than an interviewed one, so walk the
confirmation section by section — facts first, then inferences — and invite corrections
per section rather than in one pass. Record corrections as `corrected_assumption`
evidence. The user's corrections outrank the corpus.

## After confirmation

Someone with real history usually needs less hand-holding. After the portrait is
confirmed, ask one native single-select (header `Pace`): keep the guided pace, or start
further along. If they choose the latter, run `level 3 --confirm` (their explicit choice
is the confirmation) and skip the orientation question — go directly to possibilities,
which should lean on the frictions and active projects the corpus actually shows.
The safety stage is never skipped in either lane: it is consent, not skill.
