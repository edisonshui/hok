---
name: learn-close
description: Close out a subject the learner is finished with (settle any session left open, then mark it done), or with no argument settle every session left open. Use when Edison is done with a subject or wants old sessions settled, or when the app's Close out button runs it.
---

Close out without teaching. The user may name a subject slug after `$learn-close`.

- **A subject slug:** the learner is finished with that subject. Settle any session note it left open, then mark the subject done.
- **Empty:** settle every session note left open, in every subject. Mark a subject done only when its `deadline:` has passed.

The rule for open notes is in `learn/system/records.md`, under *Closing an open note*. This skill applies the *Finalizing an open note* paragraph of `$learn-resume` step 3 and nothing else: no recap, no decay check, no new note, no questions.

Edison added this on 2026-10-27: a quiz that has already happened should not need a resume to settle it, and any subject they have stopped working on should be closable.

## 1. Find the notes

Run `date`. Run `python3 .claude/hooks/learn-status.py --json` and read its `open_notes` list. Each line starts with `<slug> <note name>:` and says whether the note was cut off, is a stale pause, or is a live break. Keep the lines for the argument's subject, or every line when there is no argument. A subject may have none; then skip to step 3.

A live break is closed too. The learner chose to settle it instead of coming back.

## 2. Finalize each note

Open `learn/subjects/<slug>/sessions/<note name>.md`.

- Set `end:` to its `paused:` time if it has one, then clear `paused:`. With no `paused:`, use the last time the note itself records, or its `start:` if it records none.
- Append one line under *What worked / what didn't*: `Closed out on <today> without resuming: <cut off | paused> at <time> and never reopened.`
- Leave every node status, every *Lesson* entry, and every check exactly as the note left it. Finalizing closes a note; it never invents evidence.

## 3. The record

Read the first 15 lines of the subject's `record.md`.

- If `next:` still points at resuming or finishing a note you closed, rewrite it as the first thing the next session does, taken from that note's *Next step*.
- Set `status: done` when the argument named this subject, or, with no argument, when its `deadline:` is before today. Leave `goal_met:` as it is: no session met the goal, and `goal_met:` is what earns the Goal reached badge. A done subject's nodes still come up for review.

Change nothing else in `record.md`: not `sessions`, not `last_session`, not a node status.

## 4. Check and report

Run `python3 .claude/hooks/learn-status.py` to rewrite the views, then `python3 .claude/hooks/learn-status.py --json` and confirm the closed notes are gone from `open_notes` and the named subject reads `done`. Re-read each line you changed.

Reply with one line per subject: its title, each session closed with its date and the end time you set, and whether it moved to done. Use plain words, no file names, slugs, or field names. If something was skipped or a write failed, say so. Never claim a write you did not make.
