---
name: learn-resume
description: Resume an existing learning project from its saved records — recap, decay-check the last nodes, then continue teaching from the plan. Use when the learner wants to continue a subject, or after a break.
---

Resume the learning project named in the user request, such as `$learn-resume oop` or "continue OOP." Follow Phase 5 of `learn/system/workflow.md`.

Once the slug is known, run `python3 .codex/hooks/learning.py select --subject <slug>` to route this conversation to the subject's Codex log. If hooks are unavailable, continue with the learning records.

## 1. Load state

1. `learn/subjects/<slug>/resume.md`, in full.
2. The resume brief: `python3 .claude/hooks/learn-status.py --brief --subject <slug>`. It carries the state, the nodes this session works on with their plan rows and recent evidence, open misconceptions, cross-subject prerequisites, and the latest note's hand-off.

The brief replaces reading `record.md`, `plan.md`, and the latest session note in full (decided 2026-10-25). Open a full file only when a step needs it: finalizing an open note (step 3), re-teaching a node (read its *Lesson* entry in the note that taught it), or a brief line that does not make sense on its own. To update `record.md` frontmatter, read only its first 15 lines before editing them.

If `record.md` does not exist, stop and use `$learn-start <slug>`. If `record.md` says `status: not-started` or `diagnosing`, say so and continue with the corresponding step of `$learn-start` instead.

Do not ask the learner what was covered last time. The records answer that; asking means the records failed and should be fixed at the next `$learn-end`.

## 2. Recap

At most eight lines: where we are in the plan, what is `solid`, what is `checked` but not yet `solid`, open misconceptions, what today covers, and anything listed under *Adjustments to make* in `resume.md`.

## 3. Open the session note

Run `date`. Then take the most recent session note's `date`, `start`, `end`, and `paused` from the brief's *Latest session note* section and take exactly one of these branches. The rule is in `learn/system/records.md`, under *Closing an open note*; it is repeated here because this is the only place that acts on it.

**If `end:` is already filled** — the last session ended cleanly. Go to *Open a new note* below.

**If `end:` is empty**, work out how long the note has been open. Combine the note's `date:` with its `paused:` time (or, with no `paused:`, its `start:`) into a single timestamp, and subtract it from the time `date` just printed. Do this as elapsed hours across dates — not "is this the same calendar day", which gets a 23:50→00:10 break wrong in one direction and an 08:00→23:00 abandonment wrong in the other.

- **`paused:` set, under 6 hours ago** → a live break. Keep using that note, clear `paused:`, and **skip the decay check** in step 4. Do not increment `sessions` in `record.md`; this is the same session. A paused practice note (`kind: practice`) is not a lesson to continue: finalize it instead and open a new note.
- **`paused:` set, 6 hours or more ago** → a stale pause. The learner did not come back. Finalize the note (below), say in one line that s`<NN>` was paused at `<time>` and never reopened, then go to *Open a new note*.
- **No `paused:`** → the session was cut off without `$learn-end`. Finalize the note (below), say so, then go to *Open a new note*.

**Finalizing an open note.** Set `end:` to its `paused:` time if it has one, then clear `paused:` — a note with both filled is a state no rule defines. With no `paused:`, use the last time the note itself records. Append one line under *What worked / what didn't* naming when it was paused or cut off and that it was never reopened. Leave every node status exactly as the note left it — a node with no logged check stays `introduced`. Finalizing closes a note; it never invents evidence. If `record.md`'s `next:` still points at resuming that note, rewrite it to point at the new session instead.

**Open a new note.** Create `sessions/<YYYY-MM-DD>-s<NN>.md` by copying `learn/system/templates/session-note.md` in full (every section heading, in order, so the note has the same shape every time), filling the frontmatter with the next session number and the start time, and set `sessions` and `last_session` in `record.md`.

## 4. Decay check

One retrieval question on each of the last one or two nodes with status `checked` (or `solid`, if none are `checked`). Make it a re-derivation: ask the learner to rebuild the node from its *Rests on* cell in `plan.md` ("work out … starting from <Rests on truth>"), not to recall it. Decide before asking which derivation steps earn a pass, then grade whether the derivation is right, not whether the wording matches the lesson. It is a generation check, so its evidence line carries the generation tag `[gen]`, right after the colon that ends the date and source (`records.md`, *Evidence rule*). If the node's *Rests on* cell is empty, a dash, or says it has no unconditional truth, ask an ordinary retrieval question instead, leave the line untagged, and say so in the session note. Pass: set the node to `solid`. Fail: set it to `decayed`, re-establish it in a few messages, check again, set it back to `checked`. That re-check is ordinary retrieval, since the derivation was just shown, so its evidence line stays untagged. Log every question and answer in the session note under *Retrieval checks* and append evidence lines to `record.md`, each ending with its transition marker. Skip this step only when step 3 took the live-break branch (a `paused:` under 6 hours old).

## 5. Continue

Enter the teach loop (Phase 2 of `workflow.md`) at the next `planned` node in `plan.md`. Write each node to the session note as it is taught, through the reply's save note (`learn/system/records.md`, *The save note*). Call the 45-minute mark.
