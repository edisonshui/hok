---
name: learn-start
description: Start a new learning project — capture the goal, diagnose current understanding, build and verify a lesson plan, then begin teaching. Use when Edison wants to learn a new subject or topic.
---

Start a learning project for the subject slug in the user's request, for example `$learn-start cs100-pointers` or "start learning pointers." Treat any words after the slug as a goal hint. If the user gave a topic but no slug, make one from it following the slug rule in step 1.

Follow Phase 1 of `learn/system/workflow.md`. Read `learn/system/records.md` before writing any file. The teaching rules in `learn/system/tutor.md` apply throughout, including diagnosis.

Once the slug is known, run `python3 .codex/hooks/learning.py select --subject <slug>` to route this conversation to the subject's Codex log. If hooks are unavailable, continue with the learning records.

## 1. Set up the subject folder

- Slug: `<course>-<topic>`, lowercase with hyphens, so the sidebar groups subjects by course: `math241-lagrange`, `cs124-quiz9`. The course is the class code with no space, matching the prefix that course's folders in `learn/subjects/` already use; a subject that is not for a class uses `personal`. Build it from the user request. If it already has that form, use it. Otherwise propose one, confirm it with the learner in one line, then continue. If `learn/subjects/<slug>/record.md` already exists, stop and tell the learner in one line, with no file names, that this subject already exists and `$learn-resume <slug>` picks it up.
- Create `learn/subjects/<slug>/` and `learn/subjects/<slug>/sessions/`.
- Copy `learn/system/templates/record.md`, `plan.md`, `resume.md` into it in full, with placeholders filled (`{{slug}}`, `{{Title}}`, today's date from `date`) and the italic template hints left in place until real content replaces them. Set `status: diagnosing`.

## 2. Capture the goal

Ask at most three questions in one round (use a question picker if available). Cover: what *done* looks like as something observable; why this, why now; and the deadline, how much time there is before it (sessions and minutes), and any notes, slides, or homework to work from (file paths, or none). If the goal hint already answers some, skip those. Write the goal in the learner's words and 3–6 success criteria to `record.md`. Confirm the criteria in one message: write them as a numbered list in reply text, then ask whether they match. Criteria that exist only in thinking or in `record.md` are invisible to the learner, and twice a question asked about them anyway (2026-10-20, 2026-10-25). Do not proceed until confirmed or edited. If there is a deadline, write it as `deadline: YYYY-MM-DD` in `record.md` frontmatter. Write the total minutes as `budget: <minutes>` there too, and list any paths under *Materials* in `record.md`, then read them before step 3.

## 3. Diagnose

- Name 3–6 strands the goal depends on and write them to the Strands table with empty floor and ceiling.
- Before probing, check other subjects' records (`learn/subjects/*/record.md`) for strands already demonstrated elsewhere. Reuse only an evidence line that shows the same skill this plan needs, done unaided, and quote it under *Where the learner starts* in `plan.md`. A status alone is not evidence, and a pass that needed a pointer covers only the part done unaided. A node this plan builds on from another subject goes in its Prereqs cell as `<slug>/nN`.
- Open with one attempt problem that represents the goal: ask the learner to work it out loud and say where it gets fuzzy (see *Checks and quizzes* in `tutor.md`). If they cannot start it, ask what they already know about the topic in their own words.
- Then probe by binary search only the strands the attempt left unclear. Budget 5–10 minutes, one attempt plus at most 5 probes, so the first lesson starts inside this session. Batch multiple-choice probes in a question picker when available, up to four at a time; free-response in chat where a choice would give the answer away.
- "I don't know", or a blank attempt, ends the probing on that strand: record that level as its ceiling and move on. A learner who says "I don't know" and then reasons it out anyway has made an attempt; grade it and keep probing. If two strands come back blank, end the diagnosis and go to step 4 with a provisional plan. A floor left rough is refined by the first check of the node that needs it (`tutor.md`, *Pacing*). If the learner asks to shorten or skip diagnosis, do so and note it in *Review notes*.
- After every answer, append an evidence line to `record.md`. When a strand's floor and ceiling are both known, fill its row.
- Tell the learner when diagnosis is done and summarize the edge in three lines.

## 4. Plan

- Write `plan.md`: nodes from each strand's floor to the goal, one concept each, 10–20 minutes each. Fill every column of the Nodes table. The `Can do` column holds one can-do statement per node (`records.md`, *Plan table*). Mark demonstrated nodes `skipped`; one right pick does not demonstrate a node (`records.md`, *Status vocabulary*). Draw the dependency graph per `learn/system/diagrams.md`, leaving cross-subject prerequisites out of it. Group into 45–60 minute sessions.
- **Chains first.** Before the Nodes table is final, write *Chains* in `plan.md`: for each final check, the nodes it runs through in order and what each step does. A node on no chain and not a prerequisite of a chain node is not core.
- **Fit the budget.** Split *Session groups* into *Core*, the nodes the chains need, and *If time*, the rest. When `budget:` is set, the core's estimated minutes must fit it: cut nodes until they do, and list each cut under *Review notes* with the final check it weakens. Two cuts are never made silently: anything the learner named in his own goal words, and, when the goal is a proctored test, the produce-from-scratch check (`tutor.md`, *Practice in the test's format*). If the budget forces either, ask him which to drop, in one line, before presenting the plan. On 2026-11-02 the coding practice was cut, and the quiz lost points on exactly that part. Two corrections come first. Run `python3 .claude/hooks/learn-status.py --pace --course <course>` (the slug's prefix): if it reports a median over two or more subjects, multiply every *Est. min* by it and state the factor under *Review notes*. And take the minutes already spent on the goal round and diagnosis (`date` against the session start) off the budget. On 2026-10-25 a 90-minute budget held 87 estimated minutes, the topics took 162, and diagnosis had already used 37. A node built on a file in *Materials* names the page or section in its *Rests on* cell.
- Mirror the node list into the Nodes table of `record.md` with status `planned` or `skipped`.
- **Provisional plan.** If the diagnosis ended early on blank strands, write only the first one or two nodes in full, starting at the lowest blank strand, and sketch the rest as plain bullets under *Where the learner starts*. Steps 5 and 6 then cover the written nodes only, and the five-line summary says "provisional". `$learn-end` finishes the plan (`workflow.md`, Phase 4, step 3).

## 5. Review

Start both custom subagents together, without waiting on them, then go straight to step 6 so the learner reads the plan while they run:

- `fact-checker` with the list of factual claims the plan rests on (definitions, rules, API facts, numbers). Fix what it marks wrong; list what it marks uncertain under *Review notes*.
- `plan-reviewer` with the paths of `plan.md`, `record.md`, and `learn/me/preferences.md`. Apply its fixes or say in *Review notes* why not.

If subagents are unavailable, perform both reviews yourself and say so.

## 6. Present and approve

Show the graph and the five-line summary (what they have, first session, last node, session count, what they can do at the end, with any cuts the budget forced named in the last line), and say in one line that a fact check and a pacing check are still running and may adjust it. Wait for approval, and end the turn after asking. Approval is the learner's own reply. A checker's result arriving is not approval: on cs124-quiz9 2026-10-26 the plan-reviewer landed and the tutor wrote "The plan's approved" with no learner reply. On approval set `approved: true` in `plan.md` and `status: active` in `record.md`.

Teaching waits for the `fact-checker` result (`tutor.md`, *Reliability rules*). The `plan-reviewer` result may land after teaching starts: apply it to nodes not yet taught, and tell the learner in one line only when it changes something they approved.

## 7. Begin

Run `python3 .claude/hooks/learn-status.py` so `learn/Home.md`, `learn/Dashboard.md`, and this subject's `progress.md` pick up the new subject. Never hand-write a row into either; they are generated files and the next run overwrites anything added by hand.

Run `date`, create `sessions/<YYYY-MM-DD>-s01.md` by copying `learn/system/templates/session-note.md` in full (every section heading, in order) and filling the frontmatter with the start time, set `sessions: 1` and `last_session` in `record.md`, and enter the teach loop (Phase 2 of `workflow.md`). Remind the learner that `$learn-end` checkpoints at any time and that you will call the 45-minute mark.
