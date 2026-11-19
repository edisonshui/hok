# Records — the persistent learning state

The learning state for a subject is four files in `learn/subjects/<subject>/`. This file defines what each contains, the status vocabulary, and the update rules. Skills read this file before writing any record. Templates for each file are in `learn/system/templates/`.

The test for everything here: **could a fresh session with no transcript continue the lesson from these files alone?** If not, the record is incomplete.

## Files

| File | Purpose | Written by | Rewritten or appended |
| --- | --- | --- | --- |
| `record.md` | The learner's knowledge of this subject: goal, strands, node statuses, misconceptions, evidence, what works | `/learn-start`, teach loop, `/learn-end` | Edited in place; evidence lines are appended |
| `plan.md` | The ordered lesson plan and its dependency graph | `/learn-start`, `/learn-end` | Edited in place |
| `resume.md` | Under-200-word summary for the next session | `/learn-end` | Rewritten from scratch every time |
| `sessions/YYYY-MM-DD-sNN.md` | The notebook for one session: what was taught, diagrams, checks, results. A practice session's note (`kind: practice`, template `practice-note.md`) holds problems under *Practice* instead of *Lesson* | Teach loop or `/learn-practice`, `/learn-end` | Appended during the session, finalized at the end |

Session numbers `sNN` are per subject and never reused. Two sessions on one day are `s03` and `s04`, not `s03a`.

## Status vocabulary

**Node status** (in `record.md` and `plan.md`; the two must agree):

| Status | Meaning | Set when |
| --- | --- | --- |
| `planned` | Not yet taught | Plan written |
| `skipped` | Diagnosis showed the learner already has it, by a free-response answer or two right probes worded differently. One right pick does not skip a node | Diagnosis |
| `introduced` | Taught, no check passed yet | After *establish* |
| `checked` | Passed a check in the session it was taught, unaided, on an item the teaching did not show. A pass after a hint keeps the node `introduced` until a fresh item passes without one | After *check* |
| `solid` | Passed a retrieval check in a later session | Decay check on resume |
| `decayed` | Failed a retrieval check in a later session | Decay check on resume; re-teach briefly, then back to `checked` |

**Strand levels** (in `record.md`): each strand has a *floor* (hardest level answered correctly), a *ceiling* (easiest level answered wrongly), and the *edge* between them where teaching happens. Levels are described in words, not numbers ("can call a method on an object" / "cannot explain what `this` refers to").

**Misconception status:** `open` or `resolved YYYY-MM-DD`, with the evidence for each.

**Plan table** (in `plan.md`): the plan's node table has a `Can do` column right after `Check type`: one can-do statement per node, a bare verb phrase that reads after "You can now", with no node id, testable by the node's check. `/learn-start` writes it; it changes only when the node's scope changes. A missing one falls back to the node name.

The *Prereqs* cell names this subject's nodes by id, and a node in another subject as `<slug>/nN`. `learn-status.py` keeps a cross-subject prerequisite out of the graph check and lists it on the Dashboard when that node slipped, is not yet passed, or needed help when it last passed. It is not drawn in the mermaid graph. The plan's *Chains* section lists, for each final check, the nodes it runs through in order. *Session groups* splits into *Core*, the nodes the chains need, and *If time*, the rest.

## Evidence rule

An evidence line is `YYYY-MM-DD sNN: <what was asked> → <what they answered> → <verdict>`, or `YYYY-MM-DD rNN: …` when the check came from a cross-subject review (see *Reviews* below). Only answers to diagnostic probes, check questions, practice tasks, practice problems, decay checks, and review checks produce evidence lines. Statements like "makes sense" or "I already know this" are recorded, if at all, as claims, never as evidence.

Every evidence line from a check that concerns a node ends with a transition marker per node, `→ nN <status>`, giving the node's status after that line even when it did not change: `2026-09-30 s05: … → correct → n9 solid`. A line that concerns several nodes ends with one marker each. Nothing follows the last marker. A line that concerns no node, such as a diagnostic probe before the plan exists, has none. Rewards are derived from these markers (`CONTEXT.md`, *Transition marker*), so a missing or wrong marker is a wrong reward.

A generation check (`tutor.md`, *Checks and quizzes*), including a re-derivation decay check, carries the generation tag `[gen]` right after the colon that ends the date and source: `2026-10-02 s06: [gen] predict … from <truth> → … → correct → n4 checked`. The tag anywhere else does not count, and it never goes among the markers, so the markers parse as they would without it. A fallback retrieval question for a node with no unconditional truth is untagged, and so is the re-check after re-establishing a decayed node. A generation question that covers several nodes gets one evidence line per node, each with its own verdict and its one marker: a tagged line with more than one marker passes no node. A tagged line passes its node only when the marker is `checked` or `solid` and the verdict, the segment just before the marker, starts with `correct` or `right` and names no help or doubt (no hint, rung, pointer, supplied, after, partial, but, though, or guess). `learn-status.py` lists a `checked` or `solid` node as *recall-only* on the dashboard when no tagged line passed it. A node whose *Rests on* cell in `plan.md` is empty, starts with a dash, or says it has no (new) unconditional truth is left out, since no generation check can be asked of it. Recall-only is a report, not a status: it changes no status, reward, or `--due` ranking.

A final check tests one numbered item under *Success criteria* in `record.md` and carries the final tag `[final N]`, N being that item's number, in the same place as `[gen]` (after it when both are there): `2026-11-17 s02: [final 2] unsorted 9, 2, 7, 4, 8, target 9: mid is 7, 9 > 7 so the search drops the left half → said it loses the 9 because the halving step assumes order → correct, confidence 90% → n2 checked`. The check must test the criterion in its own words, on a case the lesson has not shown: a criterion about why an unsorted array breaks the search is checked on an unsorted array, never on another sorted one. The goal is met only when every criterion's latest `[final N]` line is a clean pass, by the same allow-list as a generation check. `python3 .claude/hooks/learn-status.py --goal --subject <slug>` prints each criterion as passed or open and exits 0 only when all have passed; `/learn-end` runs it before setting `goal_met:`, and the dashboard lists, under *Record inconsistencies*, a `goal_met:` from 18 Nov 2026 on that it does not back. On 17 Nov 2026 a test tutor set `goal_met:` while the learner still believed binary search works on an unsorted array, because a sorted-array question stood in for the sortedness check.

A practice problem (`/learn-practice`, `learn/system/practice.md`) carries the practice tag `[practice]` in the same place, names its nodes in the text, and ends with no transition marker: `2026-10-25 s06: [practice] p3 n4 n6 · combine · new setting: … → … → wrong, rung 2, mix-up, confidence 70%`. Practice records evidence and moves no node (the learner, 2026-10-25), and a marker is what moves one. With no marker, the line changes no status, reward, *Last checked* date, or `--due` ranking.

## The save note

Mid-lesson writes go in one hidden block at the end of the reply, and the Stop hook writes them when the reply ends (`.claude/hooks/save_note.py`, for both hosts). Each separate write used to cost a whole model call that re-read the conversation: over 61 lessons, 919 of 3,139 calls and 31% of the tutor's cost (18 Nov 2026). Hok and `log.md` hide the block. The raw terminal shows it, and Edison accepted that (18 Nov).

```
<!-- save
@evidence 2026-11-18 s03: which half is dropped for 9 in [1,3,5,7,9] → the left → right → n2 checked
@node n2 checked | s03 dropped the correct half unaided
@lesson
### n2 — Discard half
**Motivate.** …
**Check.** Q: … / A: … / Verdict: …
@misconception kept the right half once, then traced it and fixed it
-->
```

An `@key` starts an item, and every line after it up to the next `@` line is that item's body:

| Key | Where it is written |
| --- | --- |
| `@evidence` | One line, appended to `record.md` *Evidence log*. Same format as any evidence line, marker included. |
| `@node` | `nN <status>`, optionally `\| <latest evidence>`. Sets the status in `record.md` *Nodes* and `plan.md`. A status of checked, solid or decayed also sets *Last checked* to today. Adds the node to the session note's `nodes:`. |
| `@lesson` | The node entry, appended to the open session note's *Lesson* section. The template's placeholder entry goes away. |
| `@retrieval`, `@misconception`, `@preference`, `@correction` | Appended to that section of the open session note. |

- **Write with a tool only what the note can't carry**: opening a session note, `/learn-start`'s files, and every `/learn-end` write. A review's writes (`learn/reviews/`) and practice notes follow their own files.
- **One note per reply, at the very end.** Write each line once. A reply that is held and sent again can repeat its note, and the hook skips lines it already wrote.
- **A line that can't be written is never dropped silently.** The hook says so at the start of your next turn. Write it again in that reply's note, or edit the file directly.

## Update rules

- **Append, don't overwrite, evidence.** The history of how a node moved from `introduced` to `solid` is the point.
- **Statuses only move on evidence.** No node reaches `checked` without a logged check; no node reaches `solid` without a later-session retrieval.
- **Misconception candidates** live in the session note. They are promoted to `record.md` when they appear twice or the learner confirms them; they are marked `resolved` only after a check that specifically targets them is passed.
- **`resume.md` is disposable.** It is regenerated from `record.md` and `plan.md` every session end, so it can never drift into being the only copy of anything.
- **Frontmatter is the index.** `record.md` frontmatter (`status`, `sessions`, `last_session`, `next`, `deadline`, `goal_met`) is what `Home.md`, `Dashboard.md`, and the SessionStart hook read. Keep it accurate.
- **Never edit `learn/system/` or the *Stated* section of `learn/me/preferences.md` from inside a lesson.** Propose in chat; the learner edits.
- **Preference observations** go to the *Observed* section of `preferences.md` only when confirmed by evidence, and always distinguish *enjoyed* from *demonstrated understanding*. A learner can enjoy a format that does not produce evidence, and the record must say which is which.
- **Preference candidates** follow the same promotion pattern as misconceptions, one level up. A single sighting is written to *Preference candidates* in the session note, then carried into the *Candidates* tally in `preferences.md`; a second sighting, in that session or any later one, promotes it to *Observed*. Nothing reaches *Observed* on one sighting, and no sighting is discarded for being old.
- **Rewards are derived, never written.** No file stores a badge, count, or streak. `learn-status.py` reads them from transition markers and frontmatter, and `--rewards` prints the only reward lines the tutor may show, verbatim. Rewards never change how a check is chosen, asked, or graded.
- **`rewards:` in `learn/me/preferences.md` frontmatter belongs to the learner.** The tutor and scripts read it and never write it.

## Reviews

A node reaches `solid` only by passing a retrieval check in a later session, and before `/learn-review` the only path to one ran through `/learn-resume` of that single subject. A subject marked `done` is never resumed, so its `checked` nodes could never move again. A review is the spaced-repetition pass that unsticks them, across every subject at once.

Because it touches several subjects, its writing splits, and the split is what keeps the per-subject index honest:

| Goes to | What |
| --- | --- |
| `learn/reviews/YYYY-MM-DD-rNN.md` | The narrative: the picked set, every question, answer and verdict, each MC question's `key: <slot>/<count> — options: <opt1> / <opt2> / <opt3>`, misconception candidates, corrections. `rNN` is per-vault and never reused |
| each subject's `record.md` | Node status (`→ solid` on a pass, `→ decayed` on a fail), *Last checked*, and one `rNN`-prefixed evidence line per question. Every evidence line ends with its transition marker. The review's one generation question, if it has one, carries the generation tag (*Evidence rule*). |

A review changes **nothing else** in a subject: not `sessions:`, not `last_session`, not the *Sessions* list, not `plan.md`, not `resume.md`. It is not a session of any one subject, and recording it as one would put `sessions:` and `last_session` permanently at odds with the notes on disk — which is exactly what G5 exists to catch. A `done` subject stays `done`; a node dropping to `decayed` is what says otherwise, written where the next `/learn-resume` reads it.

The pick is a date comparison, so it lives in code: `python3 .claude/hooks/learn-status.py --due` ranks every node by time since its last check. `/learn-check` calls the same thing with `--subject <slug>` for its older spacing node. Only `checked`, `solid`, and `decayed` are eligible — a `planned` or `introduced` node is not stale, it is unstarted. `--due --gen` ranks the same nodes and marks each one that is recall-only and rests on an unconditional truth; a review asks its one generation question of the first marked node in its picked set, and of none if no picked node is marked.

## Frontmatter reference

`record.md`:

```yaml
---
subject: <slug>
title: <display name>
status: not-started | diagnosing | active | paused | done
started: YYYY-MM-DD
last_session: YYYY-MM-DD
sessions: <count>
next: <one line: the first thing the next session does>
deadline: YYYY-MM-DD   # optional: the exam or quiz this subject prepares for
budget: <minutes>      # optional: the time the learner has for this subject; the plan's core fits it
goal_met: YYYY-MM-DD   # set by /learn-end when status becomes done; never cleared
---
```

`sessions/YYYY-MM-DD-sNN.md`:

```yaml
---
subject: <slug>
session: <NN>
date: YYYY-MM-DD
start: HH:MM
end: HH:MM        # empty while the session is open
paused: HH:MM     # set by `/learn-end break`; cleared on resume
active_minutes: <int>   # from the UserPromptSubmit clock; `unknown` if the hook reported nothing
idle_minutes: <int>     # time the learner was away; not counted toward the 45-minute block
nodes: [<node ids touched>]
kind: practice    # only in a practice note
---
```

`nodes:` lists every node this session has evidence for, whether that evidence is a `### nN` Lesson entry (taught), a mention in the *Practice* section of a practice note, or a mention in the *Retrieval checks* section (decay-checked, or a gate/mixed-check node whose own content lives there, e.g. a "mixed retrieval check" node). A consistency check over `nodes:` must match against the union of both locations, not `### nN` headers alone — decided 2026-09-22 after `cs124-quiz4 s01`'s n4 (gate node, documented only under *Retrieval checks*) and `math241-exam1-review s02`'s n5/n6 (decay-checked, not re-taught) both turned out to be correctly-touched nodes that a Lesson-entries-only match would have wrongly flagged.

**Closing an open note.** A note with `end` empty is either a live break or a cut-off. The difference is *elapsed hours*, never calendar date:

| Frontmatter | Meaning | What `/learn-resume` does |
| --- | --- | --- |
| `end` empty, no `paused` | Cut off mid-session — `/learn-end` never ran | Finalize it, then open a new note |
| `end` empty, `paused` under **6 h** ago | A live break | Reopen this note, clear `paused`, skip the decay check |
| `end` empty, `paused` **6 h or more** ago | A stale pause — the learner did not come back | Finalize it, then open a new note |

Finalizing an open note means: set `end` to the `paused` time if there is one and then clear `paused` (a note with both filled is a state no rule defines); append one line under *What worked / what didn't* saying the session was paused or cut off at that time and never reopened; and leave every node status as the note left it. A node that was never checked stays `introduced` — finalizing closes the note, it does not manufacture evidence.

The bound is elapsed hours and not "same day" because `paused` is an `HH:MM` that inherits the note's `date`: a 23:50 pause resumed at 00:10 is a twenty-minute break that a calendar-day test would wrongly call stale, while a 08:00 pause resumed at 23:00 is a dead session that the same test would wrongly reopen.

`plan.md` and `resume.md` carry `subject` and `updated`.

`learn/reviews/YYYY-MM-DD-rNN.md` carries `kind: review`, `review: <NN>`, `date`, `start`, `end`, the two clock fields, and `nodes:` as `<subject>/<nN>` pairs, since a review's nodes come from more than one subject. Template: `learn/system/templates/review-note.md`.
