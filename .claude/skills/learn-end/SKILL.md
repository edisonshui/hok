---
name: learn-end
description: End or checkpoint the current learning session — finalize the session note, update the learner record and plan, rewrite the resume summary, and print a plain-English summary. Use at the end of a session, before a break, or whenever Edison says stop, pause, checkpoint, or break.
argument-hint: [break]
allowed-tools: Read, Write, Edit, Glob, Agent, Bash(date *), Bash(python3 .claude/hooks/learn-status.py*), Bash(python3 .claude/hooks/obsidian-live.py clock*), Bash(python3 .claude/hooks/jev.py*), Bash(python3 .claude/hooks/write-check.py*), Bash(python3 .claude/hooks/reply-check.py closing*)
---

End or checkpoint the current session. Argument: `$ARGUMENTS` (`break` means the learner is coming back today; otherwise treat this as the end of the session). Only the learner ends a session: run this when he typed it or asked to stop, never on your own clock. A hard stop coming up (an exam, the 45-minute mark) is a reason to suggest it in one line and wait (2026-10-08, dtx221: the tutor ran it unprompted and had to apologize). Follow Phase 4 of `learn/system/workflow.md` and the update rules in `learn/system/records.md`.

Work in this order so that nothing depends on a file not yet updated. Do every step even for a `break`; the only difference is step 8.

If the learner's last message answers a check, grade it first, as reply text before any tool call (`tutor.md`, *Feedback*), and log it in step 1. The learner may be walking away, and the grade is the part they read.

Then write "Saving your progress." and nothing else until the step 8 closing block. Text between tool calls reaches the learner as it streams (`tutor.md`, *Reply shape*), so track steps 1–7 in thinking.

## 1. Session note

Before any write, run `python3 .claude/hooks/write-check.py snapshot <slug>-s<NN>` (this session's number, e.g. `oop-s05`). Step 7 compares against it, so a snapshot taken after a write would hide that write.

Run `date`. Fill `nodes:` in the frontmatter. Fill `active_minutes:` and `idle_minutes:` by running `python3 .claude/hooks/obsidian-live.py clock --subject <slug>` and copying the two numbers it prints. Do not reconstruct them from anything the hook said earlier in the conversation and do not estimate them: if the command prints `unknown`, write `unknown`. It prints `unknown` only when no clock was recorded, and a fabricated number is worse than an honest gap. Set `end:` to the current time, except for a `break`: then leave `end:` empty and set `paused:` to the current time instead, so `/learn-resume` can tell a paused session from a finished one. Make sure every node taught this session has its full entry under *Lesson* — motivation, explanation, the required `**Diagram.**` line (the block as drawn, or why none was drawn), check, verdict. A node entry with no `**Diagram.**` line is incomplete. A multiple-choice check with no `key: <slot>/<count> — options: <opt1> / <opt2> / <opt3>` is incomplete too — G4 reads the slot off that field and `--semantic` reads the options off it, neither from a description in prose. Fill *Misconception candidates*, *Preference candidates*, *Corrections*, *What worked / what didn't*, and *Next step*. *Preference candidates* is about how the learner learns, not what they learned, and a first sighting belongs there — recording it is free and is what lets step 5 count it next session. *Retrieval checks* is never left empty: if no mixed check ran before a fourth new node opened, write "none run — gate violated" and the reason. If a node was only partly taught, say exactly where it stopped. A practice note (`kind: practice`) has no *Lesson* entries: check instead that every problem has its full entry under *Practice* and that *Retests* lists every miss, retested or not (`learn/system/practice.md`).

## 2. `record.md`

- Nodes table: statuses and *Last checked* dates as they stand now. A node with no logged check this session stays `introduced`. A practice session moves no status and no *Last checked* date, and its `[practice]` lines carry no transition marker, so leave the table as it was and skip step 3's status sync.
- Strands: move a floor or ceiling only on evidence from this session.
- Misconceptions: promote candidates that appeared twice or were confirmed; mark resolved only if a targeted check was passed. Keep the evidence.
- Evidence log: confirm every check from this session is there. Every line from a check ends with its transition marker.
- *What works for this learner in this subject*: add or refine lines only with evidence, and mark each as *enjoyed* or *demonstrated*.
- Sessions list: add this session's line and link.
- Frontmatter: `last_session`, `sessions`, `status`, and `next` (one line: the first thing the next session does). If this session met the goal, set `status: done` and `goal_met:` to today.

## 3. `plan.md`

Node statuses to match `record.md`. If pace differed from the estimate, regroup the remaining sessions. If a check exposed a missing prerequisite, insert the node and update the graph. If the plan is provisional (sketched nodes under *Where the learner starts*), write them into the Nodes table and the graph now, mirror them into `record.md`, run the `fact-checker` on their claims, and put one line in the closing block saying the plan is complete, with its node count and last node. Set `updated`.

## 4. `resume.md`

Rewrite from scratch from the template, under 200 words, from `record.md` and `plan.md` only. It must let a session that has never seen this conversation continue without asking the learner what happened.

## 5. `learn/me/preferences.md`

The bar is the one the file itself states: an observation joins *Observed* only once it has appeared in **at least two checks — in this session or across sessions** — or the learner has confirmed it directly. One clear sighting does not qualify, however clear it looked.

Counting is a two-store job, and both stores are already in front of you. Do not go reading old session notes to do it:

1. Read the *Preference candidates* section of the session note you just finalized in step 1, and the *Candidates* section of `preferences.md`.
2. For each candidate in the note, if `preferences.md` *Candidates* already holds a matching line, that is sighting two: **promote** it — append a line to *Observed* with the date, subject, session, *enjoyed* or *demonstrated*, and the evidence from both sightings — and delete it from *Candidates*.
3. If it is new, append it to *Candidates* with its one sighting. It is not an observation yet and does not go in *Observed*.
4. A preference the learner confirmed directly in conversation skips the tally and goes straight to *Observed*, marked as confirmed rather than evidenced.

A candidate matches an existing one when it is the same claim about the learner, not the same wording. Two loose sightings do not become one observation by being described in the same words — if you are not sure they are the same claim, they are not, and it stays two candidates.

That judgement decides whether a line joins *Observed*, and until now it happened in your head and left no trace. Make it with the record in front of you:

```
python3 .claude/hooks/jev.py match-candidate --kind preference --new "<the candidate, as written in the note>"
```

It reads *Candidates* itself and prints one of four verdicts. `promote` is sighting two — do step 2. `new` is a first sighting — do step 3. `ask` means the match is in the middle band: treat it as `new`, and end the line you write with `(possible match: "<the existing line, shortened>", Jev p=<p>)` so Edison can merge the two when he reads the file. Do not ask him in the closing block: he is leaving, and twice a question there went unanswered and nothing carried it forward (2026-10-25). `judge-yourself` means Jev could not be reached, so the rule above is yours to apply alone. For a misconception candidate, the same command with `--kind misconception --subject <slug> --skip-note <this session's note stem>`; `--skip-note` is what stops the candidate from matching the copy of itself you wrote in step 1. The command writes nothing — you do every write, and a verdict is never permission to skip the two-sighting bar.

If nothing meets the bar, **write nothing to *Observed* and say so** — one line in chat: "no preference observation met the two-sighting bar; N candidate(s) carried forward." Do not narrate an update you are not making. Editing this file triggers a permission prompt; if it is declined, report that in step 7 rather than treating the step as done.

If evidence contradicts a *Stated* preference, write it under *Proposed changes to Stated*; never edit *Stated*.

## 6. Regenerate the status views

Run `python3 .claude/hooks/learn-status.py --semantic`. It rewrites `learn/Home.md`, `learn/Dashboard.md`, and every subject's `progress.md` from `record.md` and `plan.md`, so Home, the dashboard, and the skill tree cannot drift from the records. Do not hand-edit any of them — the next run overwrites it. In the closing block, report only warnings about this subject that this session caused and did not fix, one plain line each. Warnings that were already there, or that you fixed, are not reported. Lines prefixed `semantic:` are never reported: they are for Edison to read on the dashboard, and the learner saw the full questions in chat.

`--semantic` adds the Jev-backed checks on top of the deterministic ones: J1 asks of every logged check whether it could be answered from its own text alone; J4 asks whether each `resume.md` names a next action and says where each node stands, which is the cold-start test `records.md` states and a word count cannot make; J5 flags a node entry that draws an analogy without saying where it breaks. Those lines are prefixed `semantic:` and appear only on a `--semantic` run, so a flag that vanishes from the dashboard later was a judgement not re-made, not a problem fixed. With no key or no network it prints one line saying so and falls back to the deterministic half. A flag is for a human to read: it never edits a note, and a probe logged tersely can be flagged even though the question the learner saw was complete.

## 6b. Reward lines

**Reward lines.** Run `python3 .claude/hooks/learn-status.py --rewards --subject <slug> --session <NN>`. Keep its output exactly. Write no reward text of your own. If it fails or prints nothing, there are no reward lines; say so in the checklist.

## 7. Verify what you actually wrote

Re-read every file steps 1–6b were supposed to touch and prepare a checklist for the closing block, one line each: file, **changed** or **unchanged**, and one phrase on what changed. Do not print it yet.

```
session note   changed    end time, 4 node entries, retrieval check logged
record.md      changed    n5-n6 -> checked, 6 evidence lines, strand 4 ceiling moved
plan.md        changed    statuses, session 3 group
resume.md      changed    rewritten
preferences.md changed    1 candidate carried forward, none promoted
Home.md        changed    regenerated by learn-status.py
Dashboard.md   changed    regenerated by learn-status.py
progress.md    changed    regenerated by learn-status.py
```

Then check that list against what the disk says, rather than against your memory of writing it:

```
python3 .claude/hooks/write-check.py compare <slug>-s<NN>
```

It re-hashes every file under `learn/` and prints each one that was added, changed, or removed since the snapshot at the start of step 1. Not `git status`: everything this skill writes is gitignored, so git lists none of it.

Read the two lists against each other and report both kinds of mismatch in the closing block:

- **Claimed but absent.** A file the checklist calls *changed* that `compare` does not list. The write did not land, whatever the transcript says. Say so plainly; do not let it pass as done.
- **Present but unclaimed.** A file `compare` lists that the checklist never mentions. Something was written this session did not account for. Name it.

Two limits, stated whenever a mismatch is reported, so the learner can judge it. The baseline is the start of this skill, so it proves only what steps 1–6b wrote; edits made earlier in the session are already in it. And `log.md` is skipped, because the hooks rewrite it while a reply streams. If `compare` says there is no snapshot, step 1's snapshot did not run: say the saves could not be checked, not that they happened.

A step that was skipped, blocked by a permission prompt, or not applicable is reported as such in plain words. Never report a write that did not happen: a record the learner believes exists and does not is worse than no record at all.

## 7b. Check the closing block before it is sent

Draft the step 8 closing block in full, then run the draft through the checker before any of it reaches the learner:

```
python3 .claude/hooks/reply-check.py closing - <<'EOF'
<the drafted closing block>
EOF
```

It prints `closing block: clean`, or one line per hit with the line it found: a question mark outside a quoted check (Edison is leaving, and twice a question here went unanswered), the strings `I followed`, `workflow`, `Jev`, `mc-preflight`, `learn-status`, `write-check`, and `semantic:`, and any node id. The reward lines from step 6b are exempt, because they are pasted verbatim. On a hit, rewrite the block in the learner's words and check it again; only a draft that comes back clean is sent. The checker reads what it is given and writes nothing, so running it twice changes nothing.

## 8. Hand-off

After every write, the verification pass, and the step 7b check are complete, send exactly one closing block. Edison reads it, so it is plain English, not the record's terms: say "topic", not "node", and leave out `n` numbers, strand numbers (S1, S4), and the words checked, solid, decayed, strand, candidate, and decay-check, unless the same sentence says what they mean. Name a status with the words the reward lines and the dashboard use: *passed* for `checked`, *remembered on a later day* for `solid`, and *slipped* for `decayed`. Never "secure", "shaky", or "proven". Past the one saved-files line, never name the machinery: no script, checker, Jev, or dashboard flag. It contains, in order:

1. **What was saved, in one line** when the step 7 checklist and `compare` agree: "Saved and checked: session note, record, plan, resume, preferences, Home, Dashboard, progress." Any file that is claimed but absent, present but unclaimed, skipped, or blocked by a permission prompt gets its own line saying what happened, followed by the two limits from step 7.
2. **The preference result** from step 5, in one line.
3. **The reward lines** from step 6b, verbatim, if any.
4. **Where you are**, at most five short lines: what this session covered, what was remembered on a later day, what passed today but has not been re-checked on a later day, what slipped or is still wrong, and what comes next. Leave out a line with nothing in it. Draw it from `resume.md`, but do not paste the file: `resume.md` stays in the record's terms because the next session reads it cold.
5. **One handoff line.** For `break`, it is "Back after break. Reopen this note with `/learn-resume <slug>`." For a `break` in a practice note (`kind: practice`), it is "Back after break. Pick the practice back up with `/learn-practice <slug>`.", because `/learn-resume` closes a paused practice note instead of reopening it. Otherwise, use the one-line next step.

```
Saved and checked: session note, record, plan, resume, preferences, Home, Dashboard, progress.
Preferences: nothing changed. One new pattern noted: tracing the calls by hand helped when a hint didn't.

Slipped: Writing `equals(Object)`. Get it right in a later session and it counts as remembered again.
Topics passed: 83 → 88
This week's review isn't done yet: 63 older topics are due for a re-check

**Where you are**
- Covered today: copy constructors, a class that tracks running state, and the CS People questions.
- Passed today, not yet re-checked on a later day: copy constructors and the running-state class. 13 of 14 Quiz 7 topics have passed.
- Slipped or still wrong: writing `equals` (you wrote it as `static`), and calling a static method from another class.
- Next: ask how Quiz 7 went, then rewrite a running-state class with no hints.

Next: take PQ7, then Quiz 7 at 14:00.
``` Progress updates before this block must not include a provisional checklist, session summary, or handoff. After the closing block, stop. Do not restate or paraphrase it.
