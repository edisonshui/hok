# Learning vault for Codex

This vault is a one-to-one learning system. When tutoring here, read these files before teaching or changing a learning record:

1. `learn/system/tutor.md`
2. `learn/system/workflow.md`
3. The operational preferences printed by SessionStart. If missing, read the `Operational summary` in `learn/me/preferences.md`. Read that file in full for planning, preference updates, or conflicting guidance.

Codex does not expand Claude Code's `@file` imports, so read the files themselves. `CLAUDE.md` and `.claude/` remain the Claude Code setup. Both tutors share the records under `learn/`.

## At session start

The Codex `SessionStart` hook prints the date, a *Show the learner* block (the recommended action, the live review streak, notes left open, and subjects grouped by pending action), then for the agent only each subject's title, status, last session and next step, operational preferences, and open-note warnings. It includes a full resume only when this conversation already has a selected subject. If the hook did not run, use `date`, `python3 .claude/hooks/learn-status.py --next --host codex`, `python3 .claude/hooks/learn-status.py --open-notes --host codex`, the subjects' record frontmatter, and the operational preference summary, and show the learner the first `--next` line the same way as the block's recommended action.

After selection, read that subject's `resume.md` and the resume brief, `python3 .claude/hooks/learn-status.py --brief --subject <slug>`, which stands in for `record.md`, `plan.md`, and the latest session note (`$learn-resume` step 1). Read `learn/system/records.md` before writing learning state.

1. Reproduce the hook's *Show the learner* block verbatim.
2. Ask which to do, offering the block's recommended command first and marked recommended, then `$learn-resume <slug>`, `$learn-start <slug>`, or something else.

Do not teach, quiz, or plan until a subject is chosen.

## Hard rules

- Tutoring replies are for the learner. During a `$learn-*` session, the global rule to name the skills and workflows followed in a final report does not apply, and no reply names a node id, status, file, script, or checker (`tutor.md`, *Reply shape*).
- Write the learner's reply once per turn, after the turn's file writes. The learner gets every message you post, so a verdict posted before logging the evidence and restated after reads as a repeat. A Green's Theorem test on 17 Nov caught this in 74 of 84 tutor turns.
- Learning state lives in `learn/subjects/<slug>/` files. Neither the chat transcript nor Codex memory is a learning record.
- Write each taught node into the session note before starting the next node.
- During a lesson, treat `learn/system/` as read-only. Propose changes in chat for the learner to edit.
- In `learn/me/preferences.md`, append to *Observed* only when the stated evidence bar is met. Never edit *Stated*.
- Follow the reliability rules in `tutor.md`. Verify uncertain claims before the learner builds on them.
- Log a mixed retrieval check before opening a fourth consecutive new node. If skipped, record the reason under *Retrieval checks*; never leave that section empty.
- Each node entry needs a `**Diagram.**` line with its diagram or a sentence explaining why none helps.
- Never claim a write that did not happen. `$learn-end` re-reads the files it was meant to update and reports their actual state.
- The five learning skills under `.agents/skills/` describe file mechanics. Read `learn/system/records.md` before writing any learning record.

## Files and generated views

`learn/system/` holds the teaching rules, `learn/me/` holds learner preferences, and `learn/subjects/<slug>/` holds each subject's `record.md`, `plan.md`, `resume.md`, and `sessions/`. `learn/reviews/` holds cross-subject spaced-repetition notes, which belong to no single subject. `python3 .claude/hooks/learn-status.py` generates the views for both tutors: `learn/Home.md` is the "what to do now" view, led by the recommended action, `learn/Dashboard.md` is the detail view indexing every subject, its badges, and record warnings, and each `progress.md` holds a subject's skill tree and can-do statements. Do not hand-edit those views.

Claude Code writes each subject's `log.md`. Codex writes `codex-log.md` through `.codex/hooks/learning.py`. The separate logs prevent one tool's hook from overwriting the other's conversation. They are generated views, not learning state. Codex updates its log after submitted prompts and completed turns; it does not stream partial answers into Obsidian.

The Codex hook keeps its runtime state under `learn/.codex-runtime/`. `$learn-end` reads the clock with `python3 .codex/hooks/learning.py clock --subject <slug>`. If hooks are unavailable or not trusted, report `unknown` for the minute fields and continue maintaining the learning records.

Obsidian renders mermaid, LaTeX, and embedded SVG figures. Follow `learn/system/diagrams.md` and use full-root wikilinks such as `[[learn/subjects/personal-oop/record|OOP record]]`.

For probes, put any code, data, or diagram inside the question itself. If a picker cannot display a long snippet, show it in chat, confirm the learner can see it, then ask. If they cannot see something, resend it before grading.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
