# Workflow — how every learning project runs

Every subject goes through the same phases. The phases are subject-agnostic; the content comes from `learn/subjects/<subject>/` and the learner from `learn/me/preferences.md`. Claude Code invokes the four learning skills as `/learn-*`; Codex invokes them as `$learn-*`. The slash form below names the workflow, and the matching skill defines the file mechanics for each host.

```mermaid
flowchart TD
    Boot["Boot: read system + preferences"] --> Choose{"Existing subject?"}
    Choose -- no --> Start["/learn-start: goal → diagnose → plan → review → approve"]
    Choose -- yes --> Resume["/learn-resume: recap → decay check → continue"]
    Start --> Teach["Teach loop: motivate → establish → connect → check → log"]
    Resume --> Teach
    Teach --> Check["/learn-check every 2–3 nodes"]
    Check --> Teach
    Teach --> End["/learn-end: session note → record → plan → resume summary"]
    End -.->|"next session"| Resume
```

## Phase 0 — Boot (every session)

Claude Code reads `CLAUDE.md`; Codex reads `AGENTS.md`. SessionStart prints a subject index, operational preferences, open-note warnings, and the full resume for this conversation's selected subject when known. Before teaching, read this file and `tutor.md`; after selection, load the selected subject's full state as Phase 5 specifies. Read `learn/me/preferences.md` in full for planning, preference updates, or conflicting guidance. If the hook summary is missing, read its `Operational summary`. Show the learner the hook's *Show the learner* block verbatim, then offer its recommended command first, then the host's `learn-resume` and `learn-start` skills and something else. Do not teach until one is chosen.

## Phase 1 — Start a project (`/learn-start`)

1. **Goal capture.** Ask at most three questions, together, not in rounds: what does *done* look like as something observable; why this, why now; any deadline or context (a course, an interview, curiosity), with how much time there is and any notes or homework to work from. Turn the answer into 3–6 **success criteria** the learner could be tested on. Write them to `record.md`. Record a deadline as `deadline:` and the time as `budget:` (minutes) in `record.md`, and list material paths under *Materials*.
2. **Diagnose.** Identify the 3–6 **strands** the goal depends on (prerequisite threads, e.g. for a math topic: notation, the previous concept, the computational skill; for a programming topic: the language feature, the mental model, the design judgment). Start with one attempt problem, then probe by binary search only the strands the attempt left unclear, as `tutor.md` describes under *Checks and quizzes*. A flat "I don't know" ends the probing on that strand (one the learner then reasons out anyway is an attempt, and probing continues), and two blank strands end the diagnosis. Budget: 5–10 minutes, one attempt plus at most 5 probes, so the first lesson starts in the same session. Every probe result goes into `record.md` as evidence. If the learner's stated prerequisites are already in another subject's record, reuse an evidence line there instead of re-probing, but only one that shows the same skill done unaided. A status alone is not evidence.
3. **Plan.** Write `plan.md`: an ordered list of concept **nodes** from each strand's floor to the goal. Each node: what unconditional truth it rests on, its discovery question, the check type, a can-do statement, estimated minutes, and its prerequisite nodes. Mark nodes the diagnosis already demonstrated as `skipped` (one right pick is not enough; `records.md`, *Status vocabulary*). Write *Chains* first, the nodes each final check runs through, and cut any node on no chain from the core. Draw the dependency graph as a mermaid DAG. Group nodes into sessions of 45–60 minutes, split into *Core* and *If time*, with the core inside `budget:`. If the diagnosis ended early on blank strands, the plan may be **provisional**: write the first one or two nodes in full in the Nodes table, sketch the rest as plain bullets under *Where the learner starts*, and say "provisional" in the five-line summary. The fact check and the approval cover the written nodes only. The plan is finished at that session's `/learn-end`, so the learner is taught in the same session instead of waiting on a full plan.
4. **Review.** Run the `fact-checker` subagent on every factual claim the plan rests on, and the `plan-reviewer` subagent against `record.md` and `preferences.md`, both in the background while the learner reads the plan. Fix what they flag; record unresolved uncertainty in the plan. Teaching waits for the fact check.
5. **Present and approve.** Show the learner the graph and a five-line summary: what they already have, what the first session covers, what the last node is, how many sessions, what they will be able to do at the end. Wait for approval or edits. The plan is a contract the learner can inspect, not a hidden agenda.
6. Open a session note and enter the teach loop.

## Phase 2 — Teach loop (one node at a time)

For the current node, in order:

1. **Motivate** with the discovery question, and let the learner answer it before you do. One message.
2. **Establish** the concept one reasoning step per message, check question after each non-trivial step. Use a diagram when structure is the point.
3. **Connect** it to earlier nodes and, if it clarifies, to the learner's interests.
4. **Check** with a retrieval or application question. Grade it. Log the question, the answer, and the verdict. Every evidence line ends with its transition marker (`records.md`, *Evidence rule*).
5. **Log** the node to the session note *now*: the explanation as taught, the diagram, the check and result, any misconception candidates. Update the node's status in `record.md` (`planned → introduced → checked`).

Steps 4 and 5 ride in the reply that grades the check, as its **save note** (`records.md`, *The save note*). The Stop hook writes them after the reply ends, so logging takes no tool call of its own. Don't also write those lines with a tool, or they are written twice.
6. Every 2–3 nodes, run a mixed retrieval check (`/learn-check`) covering the current node and one earlier one. **This is a gate:** a fourth consecutive new node does not open until a check is logged. If you skip one deliberately, write the reason under *Retrieval checks*. An empty *Retrieval checks* section at `/learn-end` means the rule was broken, and `/learn-end` records that in the note rather than leaving it blank.

Adaptation rules are in `tutor.md` under *Pacing*. If a check reveals a missing prerequisite the diagnosis missed, add a node to the plan, say so, and teach it before continuing.

## Phase 3 — Session mechanics

- Run `date` when a session note is opened and write the start time in it.
- **Active time, not wall-clock time, drives the break.** Each host's `UserPromptSubmit` hook measures the gap since the learner's previous message and splits the session into active and away time, keyed on the open session note. It stays silent on an ordinary turn and speaks on two events only: a gap over 15 minutes, and the 45-minute working-block mark. Claude Code also queues a mark crossed during a question picker until the next typed message. `/learn-end` in Claude Code reads totals with `python3 .claude/hooks/obsidian-live.py clock --subject <slug>`; `$learn-end` in Codex uses `python3 .codex/hooks/learning.py clock --subject <slug>`. A gap over 15 minutes means the learner stepped away: give a two-line recap before asking anything new, and do not count that time toward the 45-minute block. Trust recorded totals over an estimate. If the host's hook did not run, record `unknown`.
- At about 45 minutes, say so and suggest a 5–10 minute break. Before the break, run `/learn-end break` as a checkpoint so nothing is lost; after it, `/learn-resume <subject>` reopens the same session note and skips the decay check, provided the pause is under 6 hours old — past that the note is finalized as a cut-off and a new session starts (`records.md`, *Closing an open note*).
- Never let the transcript be the only place something lives. Every taught node is in the session note before the next node begins.
- Answers come in chat (typed or voice). The session note is the notebook, not the input box. If the learner writes work in the note and says so, read it from there.

## Phase 4 — End a session (`/learn-end`)

In this order:

1. Finalize the **session note**: what was covered, checks and results, misconception candidates, corrections, what worked and what did not, the next step.
2. Update **`record.md`**: node statuses, strand floors and ceilings if they moved, misconceptions (new, or resolved with the evidence), the *what works for this learner in this subject* section. When the goal is met, set `status: done` and `goal_met:` to today.
3. Update **`plan.md`**: node statuses, re-sequencing if the diagnosis changed, next session's node group. If the plan is provisional, write the sketched nodes into the Nodes table now, run the `fact-checker` on them, and add one line to the closing block saying the plan is complete, with its node count and last node, so the learner can ask for changes.
4. Rewrite **`resume.md`** from scratch. Under 200 words. It is the first thing the next session reads.
5. **`preferences.md` — only at the stated bar.** An observation joins *Observed* only once it has appeared in at least two checks or the learner has confirmed it directly. One sighting is not enough, however clear it looked, and the two sightings need not fall in the same session: a first sighting is written to *Preference candidates* in the session note and carried into the *Candidates* tally in `preferences.md`, where a later session can count it. If nothing met the bar this session, say so in one line in chat — "no preference observation met the two-sighting bar" — and write nothing to *Observed*. Never edit *Stated*; contradictions go under *Proposed changes to Stated*.
6. Regenerate the status views: `python3 .claude/hooks/learn-status.py`. Both hosts use this generator. It rewrites `learn/Home.md`, `learn/Dashboard.md`, and each subject's `progress.md` from the records, so they cannot drift from `record.md`. Then run `learn-status.py --rewards --subject <slug> --session <NN>`.
7. **Verify, do not assume.** Re-read every file steps 1–6 were supposed to touch and prepare a checklist: file, changed or unchanged, and one phrase on what changed. A step that was skipped, blocked by a permission prompt, or not applicable is reported as such. Never narrate a write that did not happen. A record the learner believes exists and does not is worse than no record.
8. **Close once.** After all writes and verification are finished, send one closing block containing the checklist, the preference-bar result, the reward lines exactly as the script printed them (none if it printed none), the resume summary exactly once, and one next-step line. For a break, that line says how to resume. Host-required progress updates may appear before this block, but they must not contain a provisional checklist, session summary, or handoff. After sending the closing block, stop; do not restate or paraphrase it.

## Phase 5 — Resume (`/learn-resume`)

1. Read `resume.md` and the resume brief (`learn-status.py --brief --subject <slug>`), which stands in for `record.md`, `plan.md`, and the latest session note. Open a full file when a step needs it.
2. Give a recap of at most eight lines: where we are in the plan, what was remembered on a later day, what passed but has not been re-checked on a later day, what the open misconceptions are, and what today covers.
3. Run a **decay check**: one retrieval question on each of the last 1–2 checked nodes before teaching anything new, asking the learner to re-derive the node from its unconditional truth rather than recall it (a generation check, `tutor.md`, *Checks and quizzes*), logged with the generation tag `[gen]`, right after the colon that ends the date and source, or untagged as ordinary retrieval when the node has no unconditional truth. Pass moves the node to `solid`; fail marks it `decayed`, and you re-establish it briefly before continuing.
4. Open a new session note and continue the teach loop from the plan.

## Reviewing across subjects (`/learn-review`)

The five phases above all run inside one subject, and that is the gap `/learn-review` fills. `checked → solid` requires a retrieval check in a *later* session, which only Phase 5 performs, and only for the subject being resumed. A subject marked `done` is never resumed, so its `checked` nodes are stranded there permanently.

A review is not one of the phases. It opens no session note, teaches nothing, and belongs to no subject:

1. **Pick in code.** `python3 .claude/hooks/learn-status.py --due` ranks every node in the vault by time since its last check, capped per subject. Read-only, offline, and the same picker `/learn-check` uses for its older spacing node.
2. **Ask and grade** by `tutor.md`, *Checks and quizzes*. Every question is retrieval, exactly one of them a re-derivation of the first `--due --gen` candidate in the picked set when there is one, and every question names its subject first — the learner has had no recap.
3. **Log the split**, per `records.md`, *Reviews*: the narrative to `learn/reviews/YYYY-MM-DD-rNN.md`, the evidence and status moves to each subject's `record.md`, and nothing else in any subject. Close with `learn-status.py --rewards --review <NN>` and paste its lines verbatim.

A node that fails a review is `decayed`, which is the signal to run `/learn-resume` on that subject. A review never re-teaches it.

## Practicing a subject (`/learn-practice`)

Lesson checks ask about an idea that is still in mind. Practice asks for taught ideas from problems that do not name them, so the learner has to bring the idea to mind from what the problem shows. The method is `learn/system/practice.md`.

1. **A session of one subject.** It opens a practice note from `templates/practice-note.md` with the next `sNN`, so the clock, `log.md`, and `/learn-end` work as for a lesson.
2. **Problems, one at a time.** Free response, solved by the tutor before posing, hints one rung at a time, and the next problem only when the learner says next.
3. **Evidence without status.** Each problem gets a `[practice]` evidence line with no transition marker (`records.md`, *Evidence rule*). No node status, *Last checked* date, or `plan.md` row changes. Every miss is retested in a new setting before the session ends.

## Changing subject

Run `/learn-start <new-subject>`. Nothing in `learn/system/` or `learn/me/` changes. If the new subject shares prerequisites with an existing one, read that subject's record during diagnosis instead of re-probing.
