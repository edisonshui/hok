# Learning vault — boot instructions

This vault is a one-to-one learning system. At boot, use the SessionStart index and operational preferences. Before teaching, read `learn/system/tutor.md` and `learn/system/workflow.md`. Read `learn/me/preferences.md` in full for planning, preference updates, or conflicting guidance. If the summary is missing, read its `Operational summary` before teaching.

## At session start

The SessionStart hook prints the date, a *Show the learner* block (the recommended action, the live review streak, notes left open, and subjects grouped by pending action), then for the agent only each subject's title, status, last session and next step, operational preferences, and open-note warnings. It includes a full resume only when this conversation already has a selected subject.

1. Reproduce the hook's *Show the learner* block verbatim.
2. Ask which to do, offering the block's recommended command first and marked recommended, then `/learn-resume <subject>`, `/learn-start <subject>`, or something else.
3. Do not teach, quiz, or plan until one is chosen.
4. After selection, read its `resume.md` and the resume brief, `python3 .claude/hooks/learn-status.py --brief --subject <slug>`, which stands in for `record.md`, `plan.md`, and the latest session note (`/learn-resume` step 1). Read `learn/system/records.md` before writing learning state.

## Hard rules

- **Tutoring replies are for the learner.** During a `/learn-*` session, the global rule to name the skills and workflows followed in a final report does not apply, and no reply names a node id, status, file, script, or checker (`tutor.md`, *Reply shape*). A *Skills I followed* paragraph reached a tutoring reply on 2026-10-25.
- **Learning state lives only in `learn/subjects/<subject>/` files.** The transcript and Claude Code's auto memory are not state. If it is not written in the record, it did not happen.
- **Write as you go.** Each taught node goes into the session note before the next node starts.
- **`learn/system/` is read-only during a lesson.** Propose changes in chat; the learner edits.
- **`learn/me/preferences.md`:** append to *Observed* only, with evidence. Never edit *Stated*.
- **Reliability rules in `tutor.md` are non-negotiable.** Verify before the learner builds on a claim.
- **A retrieval check is a gate.** Never open a fourth consecutive new node without a logged mixed retrieval check. If one is skipped, the reason goes under *Retrieval checks* in the session note; that section is never left empty.
- **Every node logs a `**Diagram.**` line** — the mermaid block or SVG figure embed, or one sentence on why the idea has no shape worth drawing. A decision that leaves no trace gets skipped by default.
- **Never claim a write you did not make.** `/learn-end` re-reads every file it touched and reports what actually changed. If a write was skipped or a permission prompt was declined, say so.
- Skills describe the file mechanics: `/learn-start`, `/learn-resume`, `/learn-check`, `/learn-practice`, `/learn-end`, `/learn-review`, `/learn-close`. `/learn-close <subject>` closes out a subject the learner is finished with: it finalizes any session note left open, the way `/learn-resume` step 3 does, and sets `status: done` without `goal_met`. It opens no new session. Flash runs it from the *Close out* button on a subject's Session. A review is the only one that is not a session of a single subject: it writes evidence into several `record.md` files and its narrative into `learn/reviews/`, and it changes no subject's `sessions:` or `last_session`. Practice is a session of one subject that logs evidence and moves no node status (`learn/system/practice.md`). Record schema is in `learn/system/records.md`; read it before writing any record.

## Layout

```
learn/system/      core teaching system (subject- and learner-agnostic)
learn/me/          learner preferences
learn/subjects/    one folder per subject:
                     record.md    what the learner knows, with evidence  (authored)
                     plan.md      the lesson graph                       (authored)
                     resume.md    the 200-word hand-off                  (authored)
                     sessions/    one notebook per session               (authored)
                     log.md       the live conversation                  (generated: hook)
                     progress.md  skill tree, counts, can-do statements  (generated: script)
learn/reviews/     cross-subject spaced repetition, one note per pass  (authored)
learn/Home.md      what to do now: the recommended action              (generated: script)
learn/Dashboard.md index of all subjects, badges, warnings              (generated: script)
learn/Queries.md   Dataview views over frontmatter                       (authored)
.obsidian/plugins/learn-live/  follows live logs; the Code runner pane (Java, Python, C++)
.claude/skills/    the /learn-* commands
.claude/agents/    fact-checker, plan-reviewer, demo-builder
.claude/hooks/     session-start.sh    prints the subject index and selected resume, refreshes the views,
                                       reports any session note left open
                   obsidian-live.py    mirrors the conversation to log.md; times the session
                                       (`clock --subject <slug>` reads the totals back)
                   learn-status.py     writes Home.md, Dashboard.md and each progress.md
                   vaultlib.py         frontmatter + open-note reading, shared by the two above
                   test_hooks.py       run it after changing any of them
```

**Generated files are never hand-edited.** `Home.md`, `Dashboard.md`, every `progress.md`, and every `log.md` are rewritten from the records; a correction belongs in `record.md` or `plan.md`. `learn-status.py` also reports where `record.md` and `plan.md` contradict each other, on the dashboard under *Record inconsistencies* — it reports and never repairs, because a generator that silently fixed its source would hide the drift it exists to surface.

Obsidian renders mermaid, LaTeX, and embedded SVG figures; write diagrams, figures, and math per `learn/system/diagrams.md`. Use `[[wikilinks]]` with full paths from the vault root, e.g. `[[learn/subjects/personal-oop/record|OOP record]]`.

## Reading the live conversation in Obsidian

- Each subject has its own live Markdown chat file: `learn/subjects/<subject>/log.md`. Tell the learner to open `[[learn/subjects/<subject>/log]]` in Obsidian and keep it open while chatting. `/learn-start <subject>`, `/learn-resume <subject>`, and `/learn-practice <subject>` select which log receives the conversation. Replies stay in the terminal, typed or spoken.
- The subject's `log.md` updates as responses stream, before Claude finishes the message. It includes submitted replies and question-picker prompts and answers, and retains previous conversations about that subject.
- The live note updates while responses stream and includes question-picker prompts and answers. The hooks write it automatically; do not manually edit or re-copy the transcript. Continue maintaining the learning records and session notes separately.
- **A probe must stand alone.** Any code, data, or diagram a question depends on goes *inside the question text itself*, fenced with its language. Never leave it only in a preceding chat message, and never write "this", "the following", or "the code below" pointing at something outside the question. If a snippet is too long for the picker, post it in chat, ask the learner to confirm they can see it, and only then ask. Use normal chat for open-ended reasoning questions and wait for the reply.
- **An explanation exists only if it is reply text.** Twice (2026-10-08, 2026-10-13) a grading explanation lived only in a thinking summary and was never written as a reply, and the miss was blamed on tool-call order. A third time (2026-10-25), `/learn-start` asked "do these six success criteria match?" with the criteria only in thinking. The picker hook now holds back a flagged question once when the turn's reply text is too short to hold the material. Thinking is now mirrored into `log.md` as a folded *Thinking* callout, but it is not a channel: write every explanation, answer, and hint as reply text.
- If the learner says they cannot see something, do not rephrase the question. Resend the material, confirm it is visible, then ask again.
- `log.md` follows itself: with the `learn-live` plugin on, a log scrolled to the bottom glides along as Claude writes, and one scrolled up shows a *New messages* pill instead. Pasted screenshots are saved under `Claude outputs/attachments/` and embedded where `[Image #N]` was. Each log's background comes from `theme:` in `record.md` (`code`, `math`, `circuits`, `literature`, `design`, `calm`), or else from the subject's title. The subject's other notes wear the same theme: `progress.md` through its generated `cssclasses`, and `record.md`, `plan.md`, `resume.md` and session notes through the `learn-live` plugin, so those files need no `cssclasses` of their own. Home and the Dashboard use `calm`. The `vault-brand` CSS snippet (on since 2026-10-18) applies Vault guideline v0.2, Holo light: Home and the Dashboard (`lv-wash`) keep the full theme sweep, and every other learning note sits in the theme's ambient light at 40%, pinned to the pane (option A, 18 Oct 2026). Its fonts come from the untracked `vault-fonts` snippet; turning `vault-brand` off brings back the 13 Oct full-page backgrounds. Generated notes (Home, Dashboard, progress, logs) open in Reading view with their properties hidden.
- **Code exercises go in fenced blocks** (`java`, `python`, `cpp`). In Reading view each gets a *Run* button that opens it in the *Code runner* pane, where the learner edits, runs, and presses *Send to tutor*. The code and its output then arrive with the learner's next terminal message, marked as sent from the Code runner, and appear in `log.md` as a *Your code* callout. Grade that, not a retyped copy; ask the learner to send it rather than paste code into the terminal.
- The terminal status bar and live note show the actual model and reported effort. `/model` opens model selection; `/effort` opens effort selection. Do not guess the active model or effort.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

