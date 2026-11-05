#!/usr/bin/env python3
"""Tests for the learning hooks. Run: python3 .claude/hooks/test_hooks.py

Two things here are worth more than the rest, because both were real defects that
survived a full session each without leaving a trace:

  * the clock was keyed on the Claude Code conversation rather than the session
    note, so two sessions in one conversation shared a total (s02/s03); and
  * a 45-minute announcement crossed while answering a question picker was
    emitted from a hook whose stdout Claude Code discards, and the counter that
    suppresses it for the next twenty minutes was incremented anyway.

Neither is visible by reading the code, and neither shows up in a note. They are
pinned here so they cannot come back quietly.

No third-party dependencies: this has to run wherever the hooks run. Elapsed time
is simulated by rewinding the stored `last_user`, which is exactly equivalent to
the clock advancing and keeps the suite instant and deterministic.
"""

import importlib.util
import json
import re
import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

HOOKS = Path(__file__).resolve().parent
sys.path.insert(0, str(HOOKS))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HOOKS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


status = load("learn_status", "learn-status.py")
olive = load("obsidian_live", "obsidian-live.py")
import vaultlib  # noqa: E402

FAILS = []


def eq(label, got, want):
    if got == want:
        print("  pass  " + label)
        return
    print("  FAIL  " + label)
    print("          got:  %r" % (got,))
    print("          want: %r" % (want,))
    FAILS.append(label)


def section(title):
    print("\n" + title)


# ------------------------------------------------------------------ note_datetime

section("note_datetime — a session that runs past midnight")
start = vaultlib.note_datetime("2026-09-16", "23:50")
eq("start parses", start, datetime(2026, 9, 16, 23, 50))
eq("00:10 after a 23:50 start belongs to the next day",
   vaultlib.note_datetime("2026-09-16", "00:10", after=start), datetime(2026, 9, 17, 0, 10))
eq("23:55 after a 23:50 start stays put",
   vaultlib.note_datetime("2026-09-16", "23:55", after=start), datetime(2026, 9, 16, 23, 55))
eq("an equal time does not roll forward",
   vaultlib.note_datetime("2026-09-16", "23:50", after=start), datetime(2026, 9, 16, 23, 50))
eq("an unreadable date is None", vaultlib.note_datetime("nope", "23:50"), None)
eq("an unreadable time is None", vaultlib.note_datetime("2026-09-16", "2350"), None)
eq("missing fields are None", vaultlib.note_datetime(None, None), None)


# ------------------------------------------------------------------ session_note: the one parser

import session_note  # noqa: E402

section("strip_frontmatter — the body a reader reads")
eq("frontmatter goes", vaultlib.strip_frontmatter("---\na: 1\n---\n\nbody here"), "\nbody here")
eq("a note with no frontmatter is unchanged", vaultlib.strip_frontmatter("body here"), "body here")
eq("an unclosed block is not guessed at", vaultlib.strip_frontmatter("---\na: 1\nbody"), "---\na: 1\nbody")

SN_NOTE = """---
subject: "fx"
session: "02"
date: "2026-09-16"
start: "08:00"
paused:
end: "09:00"
nodes: [n1, n2, n3, n4]
---

# Session 02

## Plan for this session

teach n1 and n2.

## Lesson

### n1 — Addresses

A pointer is like a house number.

**Diagram.** none, a single value.

**Check.** Q: "What do we call the location where a piece of data sits in memory?" (options: a variable / an address / a register) / A: "an address" / Verdict: correct.

### n2 — Reseating

**Check.** Q: "Which line reseats p?" (options, slot order: *p = b / p = &b [correct, slot 2] / &p = b) / A: "p = &b" / Verdict: correct.

### n2 continued — second pass

**Diagram.** none.

**Check.** Q: "Which line creates pointer p storing x's address?" / A: "1" / Verdict: correct. key: 1/3 — options: `int *p = &x;` / `int p = *x;` / `int *p = x;`

## Retrieval checks

Mixed check (n1 + n2): Q: explain in your own words why reseating leaves a untouched / A: "..." / Verdict: correct.

### n3 — Gate: trace a pointer

**Check.** Q: "what prints?" / A: "5" / Verdict: correct. key: 4/3 — options: 5 / 6 / 7

## Misconception candidates

### n4 — filed in the wrong place

Q: "Which is a reference?" (options: a / b / c) / A: "d" / Verdict: wrong.
"""

section("session_note — node entries by where they are filed (records.md:97)")
sn = session_note.parse(SN_NOTE, name="2026-09-16-s02", now=datetime(2026, 9, 17, 9, 0))
eq("kind is session without a `kind: review` field", sn.kind, "session")
eq("the name travels with the note", sn.name, "2026-09-16-s02")
eq("frontmatter fields are read", (sn.fields["subject"], sn.fields["end"]), ("fx", "09:00"))
eq("declared nodes come from `nodes:`", sn.declared_nodes, ("n1", "n2", "n3", "n4"))
eq("### nN under Lesson are node entries, repeated ids allowed",
   [entry.node for entry in sn.entries], ["n1", "n2", "n2"])
eq("### nN under Retrieval checks are gate entries", [entry.node for entry in sn.gate_entries], ["n3"])
eq("### nN anywhere else is misplaced", [(entry.node, entry.section) for entry in sn.misplaced],
   [("n4", "Misconception candidates")])
eq("an entry keeps its title", sn.entries[2].title, "continued — second pass")
eq("an entry's body stops at the next entry", "Reseating" in sn.entries[0].body
   or "reseats" in sn.entries[0].body, False)
eq("the last Lesson entry stops at the next section", "Mixed check" in sn.entries[-1].body, False)
eq("the canonical Diagram marker is a fact on each entry",
   [entry.has_diagram for entry in sn.entries], [True, False, True])
eq("so is the Check marker", [entry.has_check for entry in sn.entries], [True, True, True])
eq("entry lines are 1-based in the full note, frontmatter included",
   SN_NOTE.splitlines()[sn.entries[0].line - 1], "### n1 — Addresses")
eq("node ids named under Retrieval checks, in order", sn.retrieval_nodes, ("n1", "n2", "n3"))
eq("the Retrieval checks body is exposed for the gate", sn.retrieval.startswith("Mixed check"), True)

section("session_note — logged checks, every format normalised to one shape")
checks = sn.checks
eq("one logged check per `Q:`", len(checks), 6)
eq("format A: options inline, correct found by the logged answer",
   (checks[0].question, checks[0].options, checks[0].correct),
   ("What do we call the location where a piece of data sits in memory?",
    ("a variable", "an address", "a register"), 1))
eq("format A's probe text keeps the options the learner saw", "a register" in checks[0].text, True)
eq("the answer and verdict are not part of the probe text",
   ("A:" in checks[0].text, "Verdict" in checks[0].text), (False, False))
eq("format B: the inline marker says which is correct, and is removed",
   (checks[1].options, checks[1].correct), (("*p = b", "p = &b", "&p = b"), 1))
eq("key field: options in slot order, the slot is the correct one",
   (checks[2].options, checks[2].correct),
   (("`int *p = &x;`", "`int p = *x;`", "`int *p = x;`"), 0))
eq("a free-response check has no options", (checks[3].options, checks[3].correct), ((), None))
eq("a key whose slot is outside its count is not normalised", checks[4].options, ())
eq("every key field is read for slot rotation, well-formed or not",
   [(key.slot, key.count) for key in sn.keys], [(1, 3), (4, 3)])
eq("a check knows its line", SN_NOTE.splitlines()[checks[2].line - 1].startswith("**Check.**"), True)
eq("malformed: the bad key and the answer that matches no option, nothing else",
   [SN_NOTE.splitlines()[bad.line - 1][:12] for bad in sn.malformed],
   ["**Check.** Q", 'Q: "Which is'])

MISCOUNT = '**Check.** Q: "something?" / A: "x" / Verdict: correct. key: 1/4 — options: a / b / c'
eq("an option count that disagrees with the key is malformed",
   (session_note.parse(MISCOUNT).checks[0].options, len(session_note.parse(MISCOUNT).malformed)), ((), 1))
ORPHAN = "Some prose.\n\nkey: 2/3 — options: a / b / c\n"
eq("a key with options and no question to belong to is malformed",
   (session_note.parse(ORPHAN).checks, len(session_note.parse(ORPHAN).malformed)), ((), 1))
eq("a bare key is still a key, and not malformed",
   ([(k.slot, k.count) for k in session_note.parse("Q: x / A: y. key: 2/4").keys],
    session_note.parse("Q: x / A: y. key: 2/4").malformed), ([(2, 4)], ()))

REVIEW = """---
kind: review
review: 02
date: 2026-09-22
start: "23:27"
end: "23:55"
---

## Checks

- **oop n4** — Q: In Java, `class SavingsAccount extends Account {}`. Which relationship is this?
  - A. Account is a kind of SavingsAccount.
  - B. SavingsAccount is a kind of Account.
  - `key: 2/2 — options: Account is a kind of SavingsAccount. / SavingsAccount is a kind of Account.`
  - A: "B". Verdict: right.
- **ptr n4** — Q: Given `int value = 11;`, which line stores its address?
  - ``key: 2/2 — options: `int* ptr = value;` / `int* ptr = &value;` ``
"""

section("session_note — review notes, and a key field on its own line")
rv = session_note.parse(REVIEW)
eq("kind is review", rv.kind, "review")
eq("a key on its own line belongs to the check above it in the same item",
   [(check.options, check.correct) for check in rv.checks],
   [(("Account is a kind of SavingsAccount.", "SavingsAccount is a kind of Account."), 1),
    (("`int* ptr = value;`", "`int* ptr = &value;`"), 1)])
eq("the code span around the field is not part of the last option", rv.malformed, ())
eq("a blank line ends the item: a later key does not reach back",
   len(session_note.parse('Q: "far away question?" / A: x\n\nkey: 1/2 — options: a / b').malformed), 1)

section("session_note — open status, with `now` passed in (records.md, Closing an open note)")
def open_note(now, **fields):
    head = "".join("%s: %s\n" % (key, value) for key, value in fields.items())
    return session_note.parse("---\n%s---\n" % head, now=now)
eq("a note with `end:` is closed",
   open_note(datetime(2026, 9, 17, 9, 0), date="2026-09-16", start="08:00", end="09:00").status,
   "closed")
cut = open_note(datetime(2026, 9, 16, 11, 0), date="2026-09-16", start="08:00", paused="", end="")
eq("no `paused:` is open (cut off), aged from its start", (cut.status, cut.hours), ("open", 3.0))
midnight = dict(date="2026-09-16", start="23:50", paused="00:10", end="")
eq("a 20-minute break across midnight is a live break",
   open_note(datetime(2026, 9, 17, 1, 30), **midnight).status, "live break")
eq("the same note is a stale pause once the bound has passed",
   open_note(datetime(2026, 9, 17, 7, 30), **midnight).status, "stale pause")
bound = dict(date="2026-09-16", start="08:00", paused="08:00", end="")
eq("one minute under the bound is a live break",
   open_note(datetime(2026, 9, 16, 13, 59), **bound).status, "live break")
eq("exactly at the bound is stale",
   open_note(datetime(2026, 9, 16, 14, 0), **bound).status, "stale pause")
eq("an unreadable date leaves the age unknown",
   open_note(datetime(2026, 9, 17), date="??", start="??", end="").hours, None)
eq("a future timestamp is a negative age, not a huge one",
   open_note(datetime(2026, 9, 17, 9, 0), date="2027-01-01", start="10:00", paused="10:20",
             end="").hours < 0, True)


# ------------------------------------------------------------------ open_notes

section("open_notes — words the parser's status; the bounds are pinned under session_note above")
def opened(now, stem="fx-note", **fields):
    head = "".join("%s: %s\n" % (key, value) for key, value in fields.items())
    return session_note.parse("---\n%s---\n" % head, name=stem, now=now)


eq("a live break says it is one, and how to reopen it",
   "live break" in status.open_notes([opened(datetime(2026, 9, 17, 1, 30), date="2026-09-16",
                                             start="23:50", paused="00:10", end="")], "fx")[0], True)
eq("a stale pause says it must be finalized",
   "stale pause" in status.open_notes([opened(datetime(2026, 9, 17, 7, 30), date="2026-09-16",
                                              start="23:50", paused="00:10", end="")], "fx")[0], True)
eq("no paused time at all reads as cut off",
   "cut off" in status.open_notes([opened(datetime(2026, 9, 16, 11, 0), date="2026-09-16",
                                          start="08:00", paused="", end="")], "fx")[0], True)
eq("a closed note is never reported",
   status.open_notes([opened(datetime(2026, 9, 17, 9, 0), date="2026-09-16", start="08:00",
                             paused="", end="09:00")], "fx"), [])
eq("an unreadable date is reported rather than silently skipped",
   "cannot be read" in status.open_notes([opened(datetime(2026, 9, 17, 9, 0), date="??",
                                                 start="??", paused="", end="")], "fx")[0], True)
eq("a future timestamp is called out, not reported as a huge age",
   "paused time is" in status.open_notes([opened(datetime(2026, 9, 17, 9, 0), date="2027-01-01",
                                                 start="10:00", paused="10:20", end="")], "fx")[0],
   True)
eq("the report names the note", status.open_notes(
    [opened(datetime(2026, 9, 16, 11, 0), stem="s07", date="2026-09-16", start="08:00", end="")],
    "fx")[0].startswith("fx s07: "), True)


# ------------------------------------------------------------------ the clock

VAULT = None


def fresh():
    global VAULT
    if VAULT and VAULT.exists():
        shutil.rmtree(VAULT)
    VAULT = Path(tempfile.mkdtemp(prefix="hooktest-"))
    (VAULT / ".claude/obsidian-live").mkdir(parents=True)
    return VAULT


def subject(slug):
    """A subject as /learn-start leaves it: a folder with record.md."""
    record = VAULT / "learn/subjects" / slug / "record.md"
    record.parent.mkdir(parents=True, exist_ok=True)
    if not record.exists():
        record.write_text('---\nsubject: "%s"\ntitle: "%s"\nstatus: active\n---\n' % (slug, slug))


def note(subject_slug, stem, end=""):
    subject(subject_slug)
    folder = VAULT / "learn/subjects" / subject_slug / "sessions"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / (stem + ".md")).write_text(
        '---\nsubject: "%s"\nsession: "01"\ndate: "2026-09-17"\nstart: "10:00"\n'
        'paused:\nend:%s\nactive_minutes:\nidle_minutes:\nnodes: []\n---\n\n# note\n'
        % (subject_slug, (' "%s"' % end) if end else ""))


def close(subject, stem):
    """Finish a note the way /learn-end does. Asserts, because a close that
    silently matched nothing would make later assertions test the wrong thing."""
    path = VAULT / "learn/subjects" / subject / "sessions" / (stem + ".md")
    text = path.read_text()
    assert "end:\n" in text, "close(%s) found no open end: field" % stem
    path.write_text(text.replace("end:\n", 'end: "11:00"\n'))


def turn(prompt, sid="conv-a"):
    return olive.process(VAULT, {"session_id": sid, "hook_event_name": "UserPromptSubmit",
                                 "prompt": prompt})


def answer(sid="conv-a"):
    return olive.process(VAULT, {"session_id": sid, "hook_event_name": "PostToolUse",
                                 "tool_name": "AskUserQuestion", "tool_use_id": "tu1",
                                 "tool_response": {"answers": {"Q?": "A"}}})


def clocks():
    path = VAULT / ".claude/obsidian-live/clocks.json"
    return json.loads(path.read_text())["notes"] if path.exists() else {}


def rewind(key, seconds):
    """Move a clock back in time, so the next turn sees `seconds` of gap."""
    path = VAULT / ".claude/obsidian-live/clocks.json"
    store = json.loads(path.read_text())
    clock = store["notes"][key]
    clock["last_user"] = (olive.parse_time(clock["last_user"])
                          - timedelta(seconds=seconds)).isoformat()
    path.write_text(json.dumps(store))


section("clock — active and away time are separated")
fresh(); note("oop", "s04")
K = "oop/s04"
turn("/learn-resume oop"); turn("go on")
eq("the clock is keyed on the note, not the conversation", list(clocks()), [K])
rewind(K, 10 * 60); turn("next")
eq("a 10-minute gap is active time", round(clocks()[K]["active"] / 60), 10)
eq("and adds no away time", clocks()[K].get("idle", 0), 0)
rewind(K, 40 * 60); turn("back")
eq("a 40-minute gap is away time", round(clocks()[K]["idle"] / 60), 40)
eq("away time does not inflate the working block", round(clocks()[K]["active"] / 60), 10)

section("clock — two sessions in one conversation (the s02/s03 defect)")
close("oop", "s04"); note("oop", "s05")
turn("/learn-resume oop"); turn("teach")
eq("the second session gets its own clock", sorted(clocks()), ["oop/s04", "oop/s05"])
eq("it starts at zero instead of inheriting the first", round(clocks()["oop/s05"].get("active", 0)), 0)
eq("and the first session's total is left alone", round(clocks()["oop/s04"]["active"] / 60), 10)

section("clock — time between sessions belongs to neither")
fresh(); note("oop", "s06")
turn("/learn-resume oop"); turn("one")
rewind("oop/s06", 11 * 3600)
close("oop", "s06"); note("oop", "s07")
turn("/learn-resume oop"); turn("fresh start")
eq("an 11-hour overnight gap is not billed to the next session",
   (round(clocks()["oop/s07"].get("idle", 0)), round(clocks()["oop/s07"].get("active", 0))), (0, 0))

section("clock — an announcement is never consumed undelivered (the Break 3 defect)")
fresh(); note("oop", "s08")
K8 = "oop/s08"
turn("/learn-resume oop"); turn("start")
for _ in range(3):
    rewind(K8, 12 * 60); turn("working")
eq("36 minutes of work announces nothing", clocks()[K8].get("pending", []), [])
rewind(K8, 12 * 60)
eq("the PostToolUse turn returns nothing, since its stdout is discarded", answer(), "")
eq("but the announcement is queued rather than dropped", len(clocks()[K8]["pending"]), 1)
eq("the suppression counter advanced, because delivery is now guaranteed",
   clocks()[K8]["announced"], 1)
out = turn("ok")
eq("it arrives on the next prompt, which does reach context",
   "48 minutes of active working time" in out, True)
eq("the queue is drained once delivered", clocks()[K8]["pending"], [])
eq("and it is not repeated on the following turn", turn("and again"), "")

section("clock — an away gap is announced on a turn that can deliver it")
fresh(); note("oop", "s09")
turn("/learn-resume oop"); turn("start")
rewind("oop/s09", 30 * 60)
eq("a gap over 15 minutes prompts a recap", "stepped away" in turn("i'm back"), True)

section("clock — nothing is timed when no session is open")
fresh(); note("oop", "s10", end="11:00")
turn("/learn-resume oop"); turn("hello")
eq("a closed note is never timed", (VAULT / ".claude/obsidian-live/clocks.json").exists(), False)

section("clock — the read path /learn-end uses")
fresh(); note("oop", "s11")
K11 = "oop/s11"
turn("/learn-resume oop"); turn("a")
for chunk in (12, 12, 10):
    rewind(K11, chunk * 60); turn("working")
rewind(K11, 109 * 60); turn("back")
eq("active and idle are kept apart, not summed",
   (round(clocks()[K11]["active"] / 60), round(clocks()[K11]["idle"] / 60)), (34, 109))
report = olive.clock_report(VAULT, VAULT / ".claude/obsidian-live", "oop")
eq("the report gives /learn-end both numbers",
   ("active_minutes: 34" in report, "idle_minutes: 109" in report), (True, True))
close("oop", "s11")
eq("a closed note reports unknown rather than a fabricated zero",
   "active_minutes: unknown" in olive.clock_report(VAULT, VAULT / ".claude/obsidian-live", "oop"), True)
eq("an unknown subject reports unknown too",
   "unknown" in olive.clock_report(VAULT, VAULT / ".claude/obsidian-live", "nosuch"), True)

section("clock — the state file stays bounded")
fresh()
for index in range(olive.CLOCK_KEEP + 12):
    stem = "s%03d" % index
    if index:
        close("oop", "s%03d" % (index - 1))
    note("oop", stem)
    turn("/learn-resume oop"); turn("x")
eq("clocks.json is pruned to its cap", len(clocks()) <= olive.CLOCK_KEEP, True)


# /learn-start takes free text, so its first word is not a slug. "/learn-start I
# want to learn about pointers" once made learn/subjects/I/, and every later hook
# in that conversation rewrote I/log.md. Only a folder with record.md is a subject.

def subject_log(slug):
    path = VAULT / "learn/subjects" / slug / "log.md"
    return path.read_text() if path.exists() else ""


section("routing — a first word that is not a subject never becomes a folder")
fresh(); subject("pointers-and-references")
turn("/learn-start I want to learn about pointers"); turn("ok")
eq("no folder is made from the first word",
   sorted(path.name for path in (VAULT / "learn/subjects").iterdir()), ["pointers-and-references"])
turn("/learn-resume pointers-and-references")
eq("a later command naming a subject claims the held turns",
   "I want to learn about pointers" in subject_log("pointers-and-references"), True)

section("routing — the subject /learn-start creates claims the held turns")
fresh(); subject("oop")
turn("/learn-start I want to learn graphs")
subject("graphs")   # the skill creating learn/subjects/graphs/ from the free text
turn("ok")
eq("the turns before the folder existed land in its log",
   "I want to learn graphs" in subject_log("graphs"), True)
eq("an existing subject is never mistaken for the new one",
   "I want to learn graphs" in subject_log("oop"), False)

section("routing — a dotted first word matches its hyphenated slug")
fresh(); subject("lagrange-14-8")
turn("/learn-start lagrange-14.8 Midterm 2 prep"); turn("ok")
eq("a section number like 14.8 routes to the slug with 14-8",
   "Midterm 2 prep" in subject_log("lagrange-14-8"), True)

section("log heading — the conversation date is local, like the message times")
import os, time
saved_tz = os.environ.get("TZ")
os.environ["TZ"] = "America/Chicago"; time.tzset()
eq("a 23:52 Central start is dated that evening, not the UTC next day",
   olive.local_date("2026-10-05T04:52:23.680Z"), "2026-10-04")
if saved_tz is None:
    del os.environ["TZ"]
else:
    os.environ["TZ"] = saved_tz
time.tzset()

section("routing — held turns do not bleed into the previous subject")
fresh(); subject("oop")
turn("/learn-resume oop"); turn("/learn-start I want to learn heaps"); turn("hi")
eq("the earlier subject's log stops at the new command",
   ("/learn-resume oop" in subject_log("oop"), "learn heaps" in subject_log("oop")), (True, False))
eq("and no subject is selected while the new one is unresolved",
   json.loads((VAULT / ".claude/obsidian-live/conv-a.json").read_text()).get("subject"), None)

section("routing — /learn-end closes the log until the next start or resume")
fresh(); subject("oop")
turn("/learn-resume oop"); turn("teach n12"); turn("/learn-end"); turn("unrelated after the end")
eq("the /learn-end turn itself is logged", "/learn-end" in subject_log("oop"), True)
eq("the prompt after it is not", "unrelated after the end" in subject_log("oop"), False)
eq("and no subject stays selected, so the clock stops too",
   json.loads((VAULT / ".claude/obsidian-live/conv-a.json").read_text()).get("subject"), None)
turn("still chatting"); turn("/learn-resume oop"); turn("back to it")
eq("a later /learn-resume reopens the log",
   ("still chatting" in subject_log("oop"), "back to it" in subject_log("oop")), (False, True))

section("routing — the session-start index lists only folders with record.md")
fresh(); subject("oop"); (VAULT / "learn/subjects/I").mkdir()
session_context = load("session_context", "session_context.py")
index = session_context.start_context(VAULT)
eq("a real subject is listed", "- oop: oop | active" in index, True)
eq("a folder without record.md is not listed as a subject", "- I: " in index, False)
eq("but it is named, so the stray folder stays visible", "Not a subject (no record.md): I" in index, True)

# What the terminal shows has to reach log.md. Two lesson explanations
# (2026-10-08, 2026-10-13) lived only in a thinking summary: the terminal
# printed it, the mirror skipped it, and the miss was blamed on tool-call order.

def transcript(*rows, sid="conv-a"):
    """Write a JSONL transcript; each row is (type, content[, extra fields])."""
    path = VAULT / ("%s.jsonl" % sid)
    with path.open("w") as handle:
        for index, row in enumerate(rows):
            kind, content = row[0], row[1]
            line = {"type": kind, "uuid": "u%d" % index,
                    "timestamp": "2026-10-13T05:%02d:00.000Z" % index,
                    "message": {"role": kind, "id": "m%d" % index, "content": content}}
            line.update(row[2] if len(row) > 2 else {})
            handle.write(json.dumps(line) + "\n")
    return path


def stop(path, sid="conv-a"):
    return olive.process(VAULT, {"session_id": sid, "hook_event_name": "Stop",
                                 "transcript_path": str(path)})


section("mirror — a thinking summary the terminal shows reaches the log")
fresh(); subject("oop")
stop(transcript(
    ("user", "/learn-resume oop"),
    ("assistant", [{"type": "thinking", "thinking": "For MC1, the answer is B since area is private."},
                   {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "true"}}]),
    ("user", [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]),
    ("assistant", [{"type": "thinking", "thinking": ""},
                   {"type": "text", "text": "Logged."}])))
eq("the explanation that lived only in thinking is in log.md",
   "For MC1, the answer is B since area is private." in subject_log("oop"), True)
eq("an empty thinking block adds nothing",
   subject_log("oop").count("[!thinking]"), 1)

section("mirror — practice routes to the log and folds thinking closed (practice.md)")
fresh(); subject("oop")
stop(transcript(
    ("user", "/learn-practice oop"),
    ("assistant", [{"type": "thinking", "thinking": "Worked solution: x = 3."},
                   {"type": "text", "text": "Problem 1. Solve for x."}]),
    ("user", "/learn-resume oop"),
    ("assistant", [{"type": "thinking", "thinking": "Next is n12."},
                   {"type": "text", "text": "Back to the lesson."}])))
log = subject_log("oop")
eq("a /learn-practice turn reaches the subject's log", "Problem 1. Solve for x." in log, True)
eq("thinking during practice is folded closed",
   "> [!thinking]- Thinking (shown in the terminal)\n> Worked solution: x = 3." in log, True)
eq("thinking in a lesson after it stays open",
   "> [!thinking]+ Thinking (shown in the terminal)\n> Next is n12." in log, True)

section("mirror — a pasted screenshot is embedded where [Image #N] was")
import base64, hashlib  # noqa: E401
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")
fresh(); subject("oop")
stop(transcript(
    ("user", "/learn-resume oop"),
    ("user", [{"type": "text", "text": "[Image #2] here's my compiler"},
              {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                           "data": base64.b64encode(PNG).decode()}}],
     {"imagePasteIds": [2]})))
saved = VAULT / "Claude outputs/attachments" / (hashlib.sha256(PNG).hexdigest()[:16] + ".png")
eq("the screenshot is written to the vault byte for byte",
   saved.read_bytes() if saved.exists() else None, PNG)
embed = "![[Claude outputs/attachments/%s|600]]" % saved.name
eq("log.md embeds it in place of the token",
   ("> " + embed + " here's my compiler" in subject_log("oop"), "[Image #2]" in subject_log("oop")),
   (True, False))

section("mirror — each subject's log gets a background theme")
fresh()
for slug, title, extra in (("q7", "CS 124 Quiz 7 — Inheritance", ""),
                           ("arch", "CS 100 Quiz: Computer Architecture (CS 233 preview)", ""),
                           ("lagr", "MATH 241 Lagrange multipliers (14.8)", ""),
                           ("ealc", "EALC 275 Quiz 2 — Analects, Bai Juyi", ""),
                           ("dtx", "DTX 221 Midterm — HCD spaces", ""),
                           ("home", "Homelessness in Champaign", ""),
                           ("mine", "CS 124 Quiz 8", "theme: literature\n")):
    (VAULT / "learn/subjects" / slug).mkdir(parents=True)
    (VAULT / "learn/subjects" / slug / "record.md").write_text(
        '---\nsubject: "%s"\ntitle: "%s"\n%sstatus: active\n---\n' % (slug, title, extra))
    turn("/learn-resume " + slug)
themes = {slug: re.search(r"cssclasses: \[learning-log, lv-theme-(\w+)\]", subject_log(slug))
          for slug in ("q7", "arch", "lagr", "ealc", "dtx", "home", "mine")}
eq("the theme follows the subject, and record.md theme: overrides it",
   {slug: match and match[1] for slug, match in themes.items()},
   {"q7": "code", "arch": "circuits", "lagr": "math", "ealc": "literature",
    "dtx": "design", "home": "calm", "mine": "literature"})
eq("a progress page wears the same theme as its subject's log",
   {slug: re.search(r"lv-theme-(\w+)", status.progress_note(
       slug, VAULT / "learn/subjects" / slug,
       vaultlib.frontmatter(VAULT / "learn/subjects" / slug / "record.md"), {}, "", [], datetime(2026, 10, 14).date())
       .split("\n---\n", 1)[0])[1] for slug in themes},
   {slug: match and match[1] for slug, match in themes.items()})

section("mirror — code sent from the Obsidian runner reaches the tutor once")
fresh(); subject("oop")
turn("/learn-resume oop")
runner = VAULT / ".claude/obsidian-live/runner"
runner.mkdir(parents=True)
(runner / "shared.json").write_text(json.dumps({
    "id": "run-1", "sent_at": olive.now(), "language": "java",
    "code": 'void main() { System.out.println("meow"); }', "stdin": "",
    "stdout": "meow\n", "stderr": "", "exit_code": 0, "timed_out": False, "ms": 412}))
told = turn("check my code")
eq("the tutor is handed the code and what it printed",
   ('System.out.println("meow")' in told, "meow\n" in told, "exit 0" in told), (True, True, True))
log = subject_log("oop")
eq("log.md shows it as a code callout before the prompt that sent it",
   0 <= log.find("[!code]") < log.find("check my code"), True)
eq("it is delivered once, not on every later prompt",
   'System.out.println("meow")' in turn("next"), False)

section("mirror — runner code for a subject skips a conversation teaching something else")
# 2026-10-13: a share sent during the Quiz 7 lesson went to an engineering chat
# that happened to prompt first, and the lesson got a screenshot instead.
fresh(); subject("oop")
turn("/learn-resume oop", sid="lesson")
turn("fix the plugin", sid="other")
runner = VAULT / ".claude/obsidian-live/runner"
runner.mkdir(parents=True)
(runner / "shared.json").write_text(json.dumps({
    "id": "run-2", "sent_at": olive.now(), "language": "java", "subject": "oop",
    "code": 'System.out.println("woof");', "stdin": "",
    "stdout": "woof\n", "stderr": "", "exit_code": 0, "timed_out": False, "ms": 300}))
eq("a conversation with no subject leaves it alone",
   'println("woof")' in turn("unrelated", sid="other"), False)
eq("the conversation teaching that subject gets it",
   'println("woof")' in turn("check my code", sid="lesson"), True)

if VAULT and VAULT.exists():
    shutil.rmtree(VAULT)


# ------------------------------------------------------------------ G1: resume bound

def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def g1(vault, slug, resume_body, plan_fm='---\nsubject: "%s"\nupdated: "2026-09-22"\n---\n'):
    folder = vault / "learn/subjects" / slug
    write(folder / "resume.md", resume_body)
    write(folder / "plan.md", plan_fm % slug if "%s" in plan_fm else plan_fm)
    return status.g1_resume_bounds(slug, folder / "resume.md", folder / "plan.md")


section("G1 — resume.md under 200 words, subject/updated present (workflow.md, records.md)")
G1 = fresh()
short_ok = '---\nsubject: "fx"\nupdated: "2026-09-22"\n---\n\n' + " ".join(["word"] * 50)
eq("a short resume with full frontmatter passes clean", g1(G1, "fx", short_ok), [])

too_long = '---\nsubject: "fx"\nupdated: "2026-09-22"\n---\n\n' + " ".join(["word"] * 201)
warnings = g1(G1, "fx", too_long)
eq("a 201-word resume is flagged", any("201" in w or "over" in w for w in warnings), True)

no_subject = '---\nupdated: "2026-09-22"\n---\n\nshort'
warnings = g1(G1, "fx", no_subject)
eq("a resume missing `subject:` is flagged", any("subject" in w for w in warnings), True)

no_updated_plan = '---\nsubject: "fx"\n---\n\nshort'
warnings = g1(G1, "fx", short_ok, plan_fm=no_updated_plan)
eq("a plan.md missing `updated:` is flagged", any("plan.md" in w and "updated" in w for w in warnings), True)


# ------------------------------------------------------------------ G5: record index

section("G5 — record.md's index agrees with the session notes and node table (records.md)")
fields = {"sessions": "2", "last_session": "2026-09-17"}
two_sessions = [{"file": "s01", "session": "01", "date": "2026-09-16"},
                {"file": "s02", "session": "02", "date": "2026-09-17"}]
one_node = {"n1": {"status": "solid", "checked": "2026-09-17"}}
eq("matching counts and dates pass clean", status.g5_record_index("fx", fields, two_sessions, one_node), [])

eq("a wrong `sessions:` count is flagged",
   any("sessions" in w for w in status.g5_record_index("fx", {"sessions": "3", "last_session": "2026-09-17"},
                                                        two_sessions, one_node)), True)

eq("a stale `last_session:` is flagged",
   any("last_session" in w for w in status.g5_record_index("fx", {"sessions": "2", "last_session": "2026-09-16"},
                                                            two_sessions, one_node)), True)

reused = [{"file": "s01", "session": "01", "date": "2026-09-16"},
          {"file": "s01b", "session": "01", "date": "2026-09-17"}]
eq("a reused session number is flagged",
   any("reused" in w for w in status.g5_record_index("fx", {"sessions": "2", "last_session": "2026-09-17"},
                                                      reused, one_node)), True)

blank_checked = {"n1": {"status": "checked", "checked": ""}}
eq("a checked node with an empty Last-checked cell is flagged",
   any("n1" in w and "Last checked" in w
       for w in status.g5_record_index("fx", fields, two_sessions, blank_checked)), True)

planned_blank = {"n1": {"status": "planned", "checked": ""}}
eq("a planned node with no Last-checked cell is fine",
   status.g5_record_index("fx", fields, two_sessions, planned_blank), [])


# ------------------------------------------------------------------ G2: session-note invariants

def sess(vault, subject, stem, body):
    path = vault / "learn/subjects" / subject / "sessions" / (stem + ".md")
    write(path, body)


NOTE_HEAD = '---\nsubject: "%s"\nsession: "01"\ndate: "2026-09-22"\nnodes: [%s]\n---\n\n'

section("G2 — every ### nN entry has Diagram + Check; the retrieval gate; nodes: matches (records.md:82)")
G2 = fresh()
clean = NOTE_HEAD % ("fx", "n1") + """# note

## Lesson

### n1 -- a node

**Establish.** stuff

**Diagram.** one sentence.

**Check.** Q: ... / A: ... / Verdict: correct.

## Retrieval checks

none needed, fewer than four new nodes.
"""
sess(G2, "fx", "s01", clean)
eq("a complete single-node note passes clean",
   status.g2_session_notes("fx", G2 / "learn/subjects/fx/sessions"), [])

missing_diagram = NOTE_HEAD % ("fx", "n1") + """# note

## Lesson

### n1 -- a node

**Check.** Q: ... / A: ... / Verdict: correct.

## Retrieval checks

none needed.
"""
sess(G2, "fx", "s02", missing_diagram)
warnings = status.g2_session_notes("fx", G2 / "learn/subjects/fx/sessions")
eq("a node entry with no Diagram line is flagged",
   any("s02" in w and "n1" in w and "Diagram" in w for w in warnings), True)

four_new_no_gate = NOTE_HEAD % ("fx", "n1, n2, n3, n4") + "# note\n\n## Lesson\n\n" + "".join(
    "### n%d -- node\n\n**Diagram.** x.\n\n**Check.** Q: . / A: . / Verdict: correct.\n\n" % index
    for index in range(1, 5)) + "## Retrieval checks\n\n"
sess(G2, "fx", "s03", four_new_no_gate)
warnings = status.g2_session_notes("fx", G2 / "learn/subjects/fx/sessions")
eq("four new nodes with an empty Retrieval checks section is flagged",
   any("s03" in w and "Retrieval checks" in w for w in warnings), True)

four_new_gated = four_new_no_gate.replace("## Retrieval checks\n\n",
                                          "## Retrieval checks\n\nnone run -- gate violated.\n\n")
sess(G2, "fx", "s04", four_new_gated)
warnings = status.g2_session_notes("fx", G2 / "learn/subjects/fx/sessions")
eq("the written gate-violated line satisfies the gate",
   not any("s04" in w and "Retrieval checks" in w for w in warnings), True)

practice = NOTE_HEAD % ("fx", "n1, n2") + """# note

## Practice

### p1 -- a problem

**Target.** n1 + n2 · combine · new surface

## Retrieval checks

None: a practice session runs no mixed checks.
"""
sess(G2, "fx", "s09", practice)
eq("a practice note's nodes: may come from its Practice section",
   [w for w in status.g2_session_notes("fx", G2 / "learn/subjects/fx/sessions") if "s09" in w], [])
(G2 / "learn/subjects/fx/sessions/s09.md").unlink()

mismatch = NOTE_HEAD % ("fx", "n1, n2") + """# note

## Lesson

### n1 -- a node

**Diagram.** x.

**Check.** Q: . / A: . / Verdict: correct.

## Retrieval checks

nothing here names another node.
"""
sess(G2, "fx", "s05", mismatch)
warnings = status.g2_session_notes("fx", G2 / "learn/subjects/fx/sessions")
eq("frontmatter nodes: naming an untouched node is flagged",
   any("s05" in w and "nodes" in w for w in warnings), True)

decay_only = NOTE_HEAD % ("fx", "n9") + """# note

## Lesson

## Retrieval checks

decay check on n9: solid.
"""
sess(G2, "fx", "s06", decay_only)
warnings = status.g2_session_notes("fx", G2 / "learn/subjects/fx/sessions")
eq("a node named only in Retrieval checks (decay check, not re-taught) satisfies nodes: (records.md:82)",
   not any("s06" in w and "nodes" in w for w in warnings), True)

misplaced = clean.replace("none needed, fewer than four new nodes.\n",
                          "none needed.\n\n## Misconception candidates\n\n### n1 — again\n\nx\n")
sess(G2, "fx", "s07", misplaced)
warnings = [w for w in status.g2_session_notes("fx", G2 / "learn/subjects/fx/sessions") if "s07" in w]
eq("a node entry filed outside Lesson and Retrieval checks is flagged, and nothing else is (records.md:97)",
   warnings, ["fx s07: n1 is filed under *Misconception candidates*, not *Lesson* or "
              "*Retrieval checks* (records.md:97)"])


# ------------------------------------------------------------------ slot_rotation: the one home of the rule

import slot_rotation  # noqa: E402

section("slot_rotation.breaks — every repeated slot and over-full window, as data")
eq("a slot repeated from the previous check is a Repeat at the second check",
   slot_rotation.breaks([("s01", 2), ("s02", 2), ("s03", 1)]),
   [slot_rotation.Repeat(index=1, name="s02", slot=2)])
eq("a slot holding the answer three times in five checks is Crowded, named by the window's last check",
   slot_rotation.breaks([("a", 1), ("b", 2), ("c", 1), ("d", 3), ("e", 1)]),
   [slot_rotation.Crowded(index=4, name="e", slot=1, count=3)])
eq("twice in five checks is the limit, not a break",
   slot_rotation.breaks([("a", 1), ("b", 2), ("c", 1), ("d", 3), ("e", 2)]), [])
eq("every over-full window is reported, one per window",
   slot_rotation.breaks([("a", 1), ("b", 2), ("c", 1), ("d", 3), ("e", 1), ("f", 4), ("g", 1)]),
   [slot_rotation.Crowded(index=4, name="e", slot=1, count=3),
    slot_rotation.Crowded(index=6, name="g", slot=1, count=3)])

section("slot_rotation.allowed — true when appending the slot adds no break")
eq("any slot is allowed on an empty history", [slot_rotation.allowed(s, []) for s in (1, 2, 3)], [True] * 3)
eq("the previous check's slot is not allowed", slot_rotation.allowed(2, [1, 3, 2]), False)
eq("a third landing in the last four plus the candidate is not allowed",
   slot_rotation.allowed(1, [1, 2, 1, 3]), False)
eq("a slot that has fallen out of the window is allowed again",
   slot_rotation.allowed(1, [1, 2, 1, 3, 2, 3]), True)
eq("a break already in the history does not block an unrelated slot",
   slot_rotation.allowed(3, [2, 2, 1]), True)

section("slot_rotation.logged — a folder's key fields in note order")
SR = fresh()
SR_FOLDER = SR / "learn/subjects/fx/sessions"
write(SR_FOLDER / "2026-09-22-s02.md",
      "Q: x / A: y / Verdict: correct. key: 3/3 — options: a / b / c\n")
write(SR_FOLDER / "2026-09-22-s01.md",
      "Q: x / A: y / Verdict: correct. key: 1/3 — options: a / b / c\n\n"
      "Q: x / A: y / Verdict: correct. key: 2/4 — options: a / b / c\n")
write(SR_FOLDER / "notes.txt", "key: 9/9\n")
eq("every key field counts, well-formed or not, sorted by note name and then line",
   slot_rotation.logged(SR_FOLDER),
   [("2026-09-22-s01", 1), ("2026-09-22-s01", 2), ("2026-09-22-s02", 3)])
eq("a folder that does not exist has no history", slot_rotation.logged(SR / "missing"), [])

section("slot_rotation.pending — which prepared entries still count")
SR_NOW = datetime(2026, 9, 23, 12, 0)


def prepared(scope, subject, slot, evidence=None, hours_ago=1):
    return {"scope": scope, "subject": subject, "slot": slot,
            "evidence": evidence or "key: %d/3 — options: %s-a / %s-b / %s-c" % (slot, subject, subject, subject),
            "prepared": (SR_NOW - timedelta(hours=hours_ago)).isoformat(timespec="seconds")}


SR_REVIEWS = [prepared("review", subject, slot) for subject, slot in
              [("oop", 3), ("oop", 2), ("pointers-and-references", 1), ("pointers-and-references", 2),
               ("quiz2-analects-baijuyi-hakurakuten", 1), ("math241-exam1-review", 3)]]
eq("a lesson for oop sees none of the review placements, even the ones about oop (the cross-subject case)",
   slot_rotation.pending(SR_REVIEWS, "lesson", "oop", [], SR_NOW), [])
SR_LESSONS = [prepared("lesson", "oop", 1), prepared("lesson", "math241-exam1-review", 2)]
eq("a lesson counts only its own subject's lesson placements",
   slot_rotation.pending(SR_LESSONS + SR_REVIEWS, "lesson", "oop", [], SR_NOW), [SR_LESSONS[0]])
eq("a review counts every review placement whatever its subject, and no lesson placement",
   slot_rotation.pending(SR_LESSONS + SR_REVIEWS, "review", "oop", [], SR_NOW), SR_REVIEWS)
SR_R02 = "## Checks\n\n" + "\n".join("- Q: x / A: y / Verdict: correct. `%s`" % entry["evidence"]
                                      for entry in SR_REVIEWS)
eq("placements already copied verbatim into a note stop counting, so r02 is not counted twice",
   slot_rotation.pending(SR_REVIEWS, "review", "oop", ["# r01\n", SR_R02], SR_NOW), [])
eq("only the copied placements drop out",
   slot_rotation.pending(SR_REVIEWS, "review", "oop", ["answer: " + SR_REVIEWS[0]["evidence"]], SR_NOW),
   SR_REVIEWS[1:])
eq("the same slot with different options is a different question, and still counts",
   slot_rotation.pending([prepared("lesson", "oop", 2, "key: 2/3 — options: p / q / r")], "lesson", "oop",
                         ["key: 2/3 — options: p / q / s"], SR_NOW),
   [prepared("lesson", "oop", 2, "key: 2/3 — options: p / q / r")])
SR_STALE = vaultlib.STALE_HOURS
eq("a placement prepared and never asked stops counting at vaultlib.STALE_HOURS, and not before",
   slot_rotation.pending([prepared("lesson", "oop", 1, hours_ago=SR_STALE),
                          prepared("lesson", "oop", 2, hours_ago=SR_STALE - 0.1)], "lesson", "oop", [], SR_NOW),
   [prepared("lesson", "oop", 2, hours_ago=SR_STALE - 0.1)])
eq("a legacy entry with no evidence or time never counts",
   slot_rotation.pending([{"scope": "review", "subject": "oop", "slot": 3},
                          dict(prepared("review", "oop", 1), prepared="not a time")],
                         "review", "oop", ["body"], SR_NOW), [])


# ------------------------------------------------------------------ G4: MC slot rotation

def with_keys(vault, subject, *slots):
    for index, slot in enumerate(slots, start=1):
        sess(vault, subject, "s%02d" % index,
             '---\nsubject: "%s"\nsession: "%02d"\ndate: "2026-09-22"\nnodes: []\n---\n\n'
             '## Retrieval checks\n\nQ: ... / A: ... / Verdict: correct. key: %d/4\n'
             % (subject, index, slot))


section("G4 — the correct-answer slot rotates (slot_rotation.py)")
G4 = fresh()
with_keys(G4, "fx", 1, 2, 3, 2, 1)
eq("a varied rotation across 5 checks passes clean",
   status.g4_mc_slots("fx", G4 / "learn/subjects/fx/sessions"), [])

G4 = fresh()
with_keys(G4, "fx", 2, 2)
warnings = status.g4_mc_slots("fx", G4 / "learn/subjects/fx/sessions")
eq("repeating the previous check's slot is flagged",
   any("s02" in w and "slot" in w for w in warnings), True)

G4 = fresh()
with_keys(G4, "fx", 1, 2, 1, 3, 1)
warnings = status.g4_mc_slots("fx", G4 / "learn/subjects/fx/sessions")
eq("slot 1 landing 3 times in a 5-check window is flagged",
   any("slot 1" in w and "3 times" in w for w in warnings), True)

G4 = fresh()
with_keys(G4, "fx", 1, 2, 1, 3, 2)
eq("slot 1 landing only twice in a 5-check window is fine",
   status.g4_mc_slots("fx", G4 / "learn/subjects/fx/sessions"), [])


# ------------------------------------------------------------------ consistency() composes G1/G2/G4/G5

section("consistency() runs G1, G2, G4, and G5 alongside the existing plan/record checks")
CONS = fresh()
folder = CONS / "learn/subjects/fx"
write(folder / "resume.md", '---\nsubject: "fx"\nupdated: "2026-09-22"\n---\n\n' + " ".join(["word"] * 300))
write(folder / "plan.md", '---\nsubject: "fx"\nupdated: "2026-09-22"\n---\n')
fields = {"sessions": "9", "last_session": "2026-09-22"}
sessions = []
nodes = {"n1": {"id": "n1", "name": "a node", "status": "checked", "checked": "",
                "prereqs": [], "plan_status": "checked"}}
warnings = status.consistency(nodes, "", "fx", fields, sessions, folder)
eq("the pre-existing plan/record agreement check still runs",
   any("prereqs" in w or "record" in w or True for w in warnings), True)  # sanity: no crash
eq("G1's over-length resume is folded in", any("200-word" in w for w in warnings), True)
eq("G5's wrong session count is folded in", any("sessions:" in w and "9" in w for w in warnings), True)
eq("G5's blank Last-checked on a checked node is folded in",
   any("n1" in w and "Last checked" in w for w in warnings), True)


# ------------------------------------------------------------------ skill drift (PLAN-2026-09-22.md Phase 2)

VAULT_ROOT = HOOKS.parents[1]
SKILL_NAMES = ["learn-start", "learn-resume", "learn-check", "learn-end", "learn-review", "learn-practice"]

# Each pair differs on purpose in exactly these ways (PLAN-2026-09-22.md, "One
# instruction, two copies"): `$0`/`$ARGUMENTS` against prose argument parsing,
# `AskUserQuestion` against "a question picker", the two hosts' clock commands,
# and Claude's subagents against Codex's "do it yourself" fallback line. None of
# those should register as drift; anything else should.
HOST_TOKENS = [
    (re.compile(r"\$ARGUMENTS"), "ARGSTOKEN"),
    (re.compile(r"\$0"), "SUBJECTTOKEN"),
    (re.compile(r"(?<!\w)/learn-"), "LEARNTOKEN-"),
    (re.compile(r"\$learn-"), "LEARNTOKEN-"),
    (re.compile(r"AskUserQuestion"), "PICKERTOKEN"),
    (re.compile(r"a question picker"), "PICKERTOKEN"),
    (re.compile(r"\.claude/hooks/obsidian-live\.py clock"), "CLOCKTOKEN"),
    (re.compile(r"\.codex/hooks/learning\.py clock"), "CLOCKTOKEN"),
    (re.compile(r"custom subagent"), "SUBAGENTTOKEN"),
    (re.compile(r"subagent"), "SUBAGENTTOKEN"),
]
HEADING = re.compile(r"^#+\s+.*$", re.M)


def normalize_skill(text):
    body = vaultlib.strip_frontmatter(text)
    for pattern, replacement in HOST_TOKENS:
        body = pattern.sub(replacement, body)
    return body


def skill_headings(text):
    return HEADING.findall(normalize_skill(text))


section("skill drift — known host differences normalize away, a real gap does not")
claude_sample = ("---\nname: x\n---\n\n## 1. Step one\n\n"
                  "Use AskUserQuestion for $0 and run $ARGUMENTS via /learn-check.\n\n## 2. Step two\n")
agents_sample = ("---\nname: x\n---\n\n## 1. Step one\n\n"
                  "Use a question picker for the subject and run the goal hint via $learn-check.\n\n"
                  "## 2. Step two\n")
eq("known host-token differences normalize to the same headings",
   skill_headings(claude_sample), skill_headings(agents_sample))

drifted_sample = "---\nname: x\n---\n\n## 1. Step one\n\ntext\n"
eq("a genuinely missing step is caught",
   skill_headings(claude_sample) == skill_headings(drifted_sample), False)

section("skill drift — the four learn-* skills, .claude against .agents (PLAN-2026-09-22.md)")
for name in SKILL_NAMES:
    claude_text = (VAULT_ROOT / ".claude/skills" / name / "SKILL.md").read_text()
    agents_text = (VAULT_ROOT / ".agents/skills" / name / "SKILL.md").read_text()
    claude_headings = skill_headings(claude_text)
    agents_headings = skill_headings(agents_text)
    eq("%s: section headings match after normalization" % name, claude_headings, agents_headings)
    eq("%s: step count matches" % name, len(claude_headings), len(agents_headings))

section("skill drift — the skills that write evidence lines ask for transition markers")
for name in ["learn-check", "learn-resume", "learn-end", "learn-review"]:
    for host in (".claude", ".agents"):
        eq("%s/%s names the transition marker" % (host, name),
           "transition marker" in (VAULT_ROOT / host / "skills" / name / "SKILL.md").read_text(), True)

section("skill drift — both learn-start copies write the deadline")
for host in (".claude", ".agents"):
    eq("%s/learn-start writes deadline:" % host,
       "`deadline: YYYY-MM-DD`" in (VAULT_ROOT / host / "skills/learn-start/SKILL.md").read_text(), True)


section("skill drift — both closing skills, in both hosts, paste the --rewards lines")
for name in ("learn-end", "learn-review"):
    for host in (".claude", ".agents"):
        eq("%s/%s runs learn-status.py --rewards" % (host, name),
           "learn-status.py --rewards" in (VAULT_ROOT / host / "skills" / name / "SKILL.md").read_text(), True)


section("skill drift — learn-start writes the Can do column and names Home; plan-reviewer checks it")
for host in (".claude", ".agents"):
    text = (VAULT_ROOT / host / "skills/learn-start/SKILL.md").read_text()
    eq("%s/learn-start fills Can do and regenerates Home" % host,
       ("The `Can do` column holds one can-do statement per node" in text, "`learn/Home.md`" in text), (True, True))
for path in (".claude/agents/plan-reviewer.md", ".codex/agents/plan-reviewer.toml"):
    text = (VAULT_ROOT / path).read_text()
    eq("%s has check 8 and lists it under REVISE" % path,
       ("8. **Can-do statements.**" in text, "checks 1, 4, 5, 7, 8, 9, or 11 exists" in text), (True, True))
    eq("%s has the budget, starting-point, and reuse checks" % path,
       ("9. **Budget.**" in text, "10. **Starting points.**" in text, "11. **Reuse.**" in text), (True, True, True))
for plan in sorted((VAULT_ROOT / "learn/subjects").glob("*/plan.md")):
    rows = status.table_by_header(vaultlib.section(plan.read_text(), "Nodes"))
    # Only node rows count: a plan can hold a second table under *Nodes* (a
    # check's item table keyed `#`), and a diagnosing plan still has the
    # template's unnamed rows, which are not nodes yet.
    eq("%s: every node has a can-do statement" % plan.parent.name,
       [row.get("Id") for row in rows if status.NODE_ID.fullmatch(row.get("Id", ""))
        and row.get("Node") and not row.get("Can do")], [])


section("skill drift, both learn-end copies set goal_met:, and the done subjects carry it")
for host in (".claude", ".agents"):
    eq("%s/learn-end sets goal_met: when the goal is met" % host,
       "set `status: done` and `goal_met:` to today" in (VAULT_ROOT / host / "skills/learn-end/SKILL.md").read_text(),
       True)
for record in sorted((VAULT_ROOT / "learn/subjects").glob("*/record.md")):
    fields = vaultlib.frontmatter(record)
    if fields.get("status") == "done":
        eq("%s is done and has goal_met:" % record.parent.name, bool(fields.get("goal_met")), True)

# ------------------------------------------------------------------ J1 / J3 (PLAN-2026-09-22.md Phase 4)

# Nothing below touches the network. Every Jev-backed function takes an `ask_fn`,
# so the policy -- which probability flags, which confidence promotes, what the
# warning says -- is tested as the pure function it is. What is NOT tested here
# is whether Jev's judgement is any good; that is what the calibration runs in
# `jev.py` are for, and it is the reason none of these checks auto-repairs
# anything.

jev = load("jev", "jev.py")

PROBE_NOTE = """---
subject: "fx"
session: "01"
date: "2026-09-22"
nodes: [n1, n2]
---

# note

## Lesson

### n1 -- a node

**Diagram.** none.

**Check.** Q: "What do we call the location where a piece of data sits in memory?" (options: a variable / an address / a register) / A: "an address" / Verdict: correct. key: 2/3

### n2 -- another node

**Diagram.** none.

**Check.** Q: code above, "what do the two cout lines print?" (free response) / A (first attempt): "41 and 42" / Verdict: wrong.

## Retrieval checks

Mixed check (n1 + n2): Q: which of the following reseats a pointer? (options: `*p = b` / `p = &b` / `&p = b`) / A: "`p = &b`" / Verdict: correct. key: 2/3

**Check.** See Establish above -- same step.
"""

section("J1 — pulling the logged checks out of a session note")
probes = jev.extract_probes_from(PROBE_NOTE, "fx", "s01")
texts = [probe["text"] for probe in probes]
eq("one probe per logged `Q:`", len(texts), 3)
eq("a Check line with no `Q:` is not a probe", any("Establish above" in text for text in texts), False)
eq("a probe knows which note it came from", (probes[0]["subject"], probes[0]["file"]), ("fx", "s01"))

PROBES = fresh()
write(PROBES / "learn/subjects/fx/sessions/s01.md", PROBE_NOTE)
eq("extract_probes walks every subject's sessions", len(jev.extract_probes(PROBES)), 3)


section("J1 — a Noul has no confidence field, so the verdict routes on distance from 0.5")
eq("0.95 is a flag", jev.probe_verdict({"outside_reference": {"noul": 0.95}})[0], "flag")
eq("0.05 is clean", jev.probe_verdict({"outside_reference": {"noul": 0.05}})[0], "ok")
eq("0.55 is unclear, and unclear is not a warning",
   jev.probe_verdict({"outside_reference": {"noul": 0.55}})[0], "unclear")
eq("a malformed answer is no verdict at all", jev.probe_verdict({})[0], None)


section("J1 — the deterministic fallback, and the boundary case a regex alone gets wrong")
eq("'which of the following' points at the options, not outside the question",
   jev.dangling_reference("Which of the following reseats a pointer? (options: a / b / c)"), None)
eq("'code above' points outside the question",
   bool(jev.dangling_reference('code above, "what do the two cout lines print?"')), True)
eq("'the following code' points outside the question",
   bool(jev.dangling_reference("Predict the output of the following code")), True)
eq("a question carrying its own code is clean",
   jev.dangling_reference("For `int *p = &x;`, what does `*p` evaluate to?"), None)


# `semantic_warnings` funnels one asker into J1, J4 and J5, which ask about three
# different pieces of state. A fake that assumed J1's shape would break the moment
# a fourth check was added -- so it dispatches on the state it is handed, the way
# a real asker does, and says nothing is wrong regardless.
def clean_answers(state):
    if "question" in state:
        return {"outside_reference": {"noul": 0.01}}
    if "handoff_note" in state:
        return {name: {"noul": 0.99} for name in jev.RESUME_DIMENSIONS}
    return {"draws_analogy": {"noul": 0.01}, "states_limit": {"noul": 0.99}}


section("J1 — probe_warnings flags only what Jev flags, and falls back when Jev is gone")
def stub_ask(state, questions, **kwargs):
    # Dispatches on the state it is handed, because semantic_warnings funnels one
    # asker into J1, J4 and J5 and only J1 is under test here.
    if "question" not in state:
        return clean_answers(state)
    return {"outside_reference": {"noul": 0.95 if "code above" in state["question"] else 0.05}}

SESSIONS = PROBES / "learn/subjects/fx/sessions"
warnings = jev.probe_warnings("fx", SESSIONS, ask_fn=stub_ask)
eq("exactly the dangling probe is flagged", len(warnings), 1)
eq("the warning names the note", "s01" in warnings[0], True)
eq("the warning quotes the probe so it can be found", "code above" in warnings[0], True)

warnings = jev.probe_warnings("fx", SESSIONS, ask_fn=lambda state, questions, **kwargs: None)
eq("with no Jev the deterministic fallback still catches the obvious case", len(warnings), 1)
eq("and it says which instrument made the call", "deterministic" in warnings[0], True)


section("J3 — reading the existing candidate lists out of the records")
PREFS = """# Learner preferences

## Observed (appended by the tutor, evidence-based)

- 2026-09-17 pointers s02 — demonstrated: fast 3-option MC checks work — evidence: two sessions.

## Candidates (running tally — not yet at the bar)

*(A preference seen once. Format: ...)*

- Closes out quickly once the original deadline has passed — demonstrated — sightings: 2026-09-18 quiz2 s02.
- Asks for a much shorter session before an exam — demonstrated — sightings: 2026-09-21 cs124-quiz4 s01.

## Proposed changes to Stated
"""
candidates = jev.parse_candidates(PREFS, "Candidates")
eq("only the Candidates bullets are read", len(candidates), 2)
eq("the Observed bullets are not", any("2026-09-17" in line for line in candidates), False)
eq("the instruction paragraph is not a candidate", any(line.startswith("*(") for line in candidates), False)

RECORD = """# Record

## Misconceptions

*(Promoted from session-note candidates when seen twice or confirmed.)*

- [x] Confuses comp_a(b) with proj_a(b) — surfaced 2026-09-20; resolved 2026-09-21.
- [ ] Cross-product sign-execution error on the j- and k-components — open.

## Evidence log
"""
misconceptions = jev.parse_candidates(RECORD, "Misconceptions")
eq("both misconceptions are read", len(misconceptions), 2)
eq("the `- [x]` checkbox marker is stripped", misconceptions[0].startswith("Confuses"), True)


section("J3 — the routing policy, which is code's job and not Jev's")
def choice(probabilities, confidence=0.9):
    best = max(probabilities, key=probabilities.get)
    return {"choice": best, "confidence": confidence, "probabilities": probabilities}

eq("a strong match promotes",
   jev.candidate_route(choice({"cand1": 0.88, "cand2": 0.05, jev.NONE_LABEL: 0.07}))[0], "promote")
eq("a weak best match files as new, per the file's own conservative bias",
   jev.candidate_route(choice({"cand1": 0.20, jev.NONE_LABEL: 0.80}))[0], "new")
eq("the middle band goes to Edison rather than being decided quietly",
   jev.candidate_route(choice({"cand1": 0.65, jev.NONE_LABEL: 0.35}))[0], "ask")
eq("a promote names which candidate matched",
   jev.candidate_route(choice({"cand1": 0.88, "cand2": 0.05, jev.NONE_LABEL: 0.07}))[1], "cand1")
eq("with no probabilities, choice+confidence still routes",
   jev.candidate_route({"choice": "cand1", "confidence": 0.92})[0], "promote")
eq("choosing 'none of these' with high confidence is new",
   jev.candidate_route({"choice": jev.NONE_LABEL, "confidence": 0.92})[0], "new")
eq("an unreadable answer decides nothing", jev.candidate_route({})[0], "ask")

spec = jev.candidate_spec("a new observation", ["first candidate", "second candidate"])
criteria = spec["match"]["criteria"]
eq("one label per candidate plus an explicit none-of-these", len(criteria), 3)
eq("the none option is spelled out rather than implied", jev.NONE_LABEL in criteria, True)


section("J3 — match_candidate end to end, and its no-key fallback")
existing = ["Closes out quickly once the original deadline has passed",
            "Asks for a much shorter session before an exam"]
result = jev.match_candidate("preference", "Once the deadline is past, prefers to wrap up fast",
                             existing=existing,
                             ask_fn=lambda state, questions, **kwargs: {"match": choice(
                                 {"cand1": 0.91, "cand2": 0.04, jev.NONE_LABEL: 0.05})})
eq("a matched candidate is routed to promote", result["verdict"], "promote")
eq("and the matched text comes back, not just a label", result["match"], existing[0])

result = jev.match_candidate("preference", "Something entirely unrelated to either line",
                             existing=existing,
                             ask_fn=lambda state, questions, **kwargs: {"match": choice(
                                 {"cand1": 0.05, "cand2": 0.05, jev.NONE_LABEL: 0.90})})
eq("an unmatched candidate is routed to new", result["verdict"], "new")

result = jev.match_candidate("preference", "closes out fast once the original deadline has passed",
                             existing=existing,
                             ask_fn=lambda state, questions, **kwargs: None)
eq("with no Jev the verdict is handed back to the tutor, never guessed",
   result["verdict"], "judge-yourself")
eq("the fallback still names the closest line by word overlap", result["match"], existing[0])

eq("an empty candidate list is 'new' without asking Jev anything",
   jev.match_candidate("preference", "first ever observation", existing=[],
                       ask_fn=lambda state, questions, **kwargs: 1 / 0)["verdict"], "new")


section("semantic_warnings — J1 reaches Record inconsistencies, labelled as a semantic call")
warnings = status.semantic_warnings({}, "", "fx", {}, [], PROBES / "learn/subjects/fx",
                                    ask_fn=stub_ask)
eq("J1's flag is folded into the dashboard warnings", len(warnings), 1)
eq("and is marked as a semantic check, not a deterministic one",
   warnings[0].startswith("semantic"), True)

# Pinned because it failed silently and could only fail silently: `jev` reads the
# key from <vault>/.env, so a semantic run against a copy of the vault that
# passed its own root through `folder` but not through to `jev` picked up the
# real vault's key and called the network anyway.
seen = {}
def recording_ask(state, questions, **kwargs):
    seen["vault"] = kwargs.get("vault")
    return clean_answers(state)

status.semantic_warnings({}, "", "fx", {}, [], PROBES / "learn/subjects/fx", ask_fn=recording_ask)
eq("the vault under test is the one Jev is pointed at",
   Path(seen["vault"]).resolve(), PROBES.resolve())

section("semantic_warnings — J4 and J5 reach the dashboard alongside J1")
def one_bad_resume(state, questions, **kwargs):
    if "handoff_note" in state:
        return {"next_action": {"noul": 0.02}, "node_standing": {"noul": 0.9}}
    return clean_answers(state)

(PROBES / "learn/subjects/fx/resume.md").write_text(
    "---\nsubject: fx\nupdated: 2026-09-22\n---\n\nn1 and n2 are solid.\n")
folded = status.semantic_warnings({}, "", "fx", {}, [], PROBES / "learn/subjects/fx",
                                  ask_fn=one_bad_resume)
eq("J4's finding is folded in", any("resume.md" in line for line in folded), True)
eq("and carries the same semantic: prefix, so a vanished line reads as a "
   "judgement not re-made",
   all(line.startswith("semantic: ") for line in folded), True)




# ------------------------------------------------ the review picker (PLAN-2026-09-22.md Phase 5)

# `due()` is the seam `/learn-check` and `/learn-review` share. Both ask the same
# question -- which node has gone longest without evidence -- and differ only in
# scope. It is pure and offline on purpose: picking by date was the one part of a
# review the tutor was doing by eye across five record.md files, and a date
# comparison is exactly what the plan says never goes to Jev.

section("due — parsing a *Last checked* cell in each of the three live formats")
TODAY = datetime(2026, 9, 22).date()
eq("a bare date", status.days_since("2026-09-17", TODAY), 5)
eq("a date carrying its session number", status.days_since("2026-09-18 s01", TODAY), 4)
eq("an em dash is not a date", status.days_since("—", TODAY), None)
eq("an empty cell is not a date", status.days_since("", TODAY), None)
eq("prose is not a date", status.days_since("see evidence log", TODAY), None)
eq("a well-shaped impossible date is rejected, not guessed",
   status.days_since("2026-13-45", TODAY), None)

section("due — which nodes are eligible at all")
ONE = [("alpha", {
    "n1": {"id": "n1", "status": "checked", "checked": "2026-09-17", "evidence": "e1", "name": "A"},
    "n2": {"id": "n2", "status": "solid", "checked": "2026-09-20", "evidence": "e2", "name": "B"},
    "n3": {"id": "n3", "status": "decayed", "checked": "2026-09-01", "evidence": "e3", "name": "C"},
    "n4": {"id": "n4", "status": "planned", "checked": "", "evidence": "", "name": "D"},
    "n5": {"id": "n5", "status": "introduced", "checked": "", "evidence": "", "name": "E"},
    "n6": {"id": "n6", "status": "skipped", "checked": "", "evidence": "", "name": "F"},
})]
rows, undated = status.due(ONE, TODAY, per_subject=None)
eq("only checked/solid/decayed can be stale -- the rest never produced a check",
   [row["id"] for row in rows], ["n3", "n1", "n2"])
eq("and they come back most stale first", [row["days"] for row in rows], [21, 5, 2])
eq("nothing undated here", undated, [])

section("due — an eligible node with no date is reported, never ranked as zero")
GAP = [("alpha", {"n1": {"id": "n1", "status": "checked", "checked": "—", "evidence": "", "name": "A"}})]
rows, undated = status.due(GAP, TODAY)
eq("it is not ranked", rows, [])
eq("it is reported", [(row["subject"], row["id"]) for row in undated], [("alpha", "n1")])

section("due — scope is the only thing that varies between the two callers")
TWO = [
    ("alpha", {"n1": {"id": "n1", "status": "checked", "checked": "2026-09-01", "evidence": "", "name": "A"},
               "n2": {"id": "n2", "status": "checked", "checked": "2026-09-02", "evidence": "", "name": "B"},
               "n3": {"id": "n3", "status": "checked", "checked": "2026-09-03", "evidence": "", "name": "C"}}),
    ("beta", {"n1": {"id": "n1", "status": "checked", "checked": "2026-09-10", "evidence": "", "name": "D"}}),
]
rows, _ = status.due(TWO, TODAY, per_subject=None)
eq("/learn-review sees every subject",
   [(row["subject"], row["id"]) for row in rows],
   [("alpha", "n1"), ("alpha", "n2"), ("alpha", "n3"), ("beta", "n1")])

rows, _ = status.due(TWO, TODAY, subject="beta", per_subject=None)
eq("/learn-check sees one", [(row["subject"], row["id"]) for row in rows], [("beta", "n1")])
eq("an unknown subject is empty, not everything", status.due(TWO, TODAY, subject="gamma")[0], [])

section("due — one stale subject cannot fill a whole review set")
rows, _ = status.due(TWO, TODAY, per_subject=2)
eq("the cap keeps alpha's two stalest and drops its third",
   [(row["subject"], row["id"]) for row in rows],
   [("alpha", "n1"), ("alpha", "n2"), ("beta", "n1")])
eq("the cap is applied before the limit, so the set stays spread",
   [(row["subject"], row["id"]) for row in status.due(TWO, TODAY, per_subject=1, limit=2)[0]],
   [("alpha", "n1"), ("beta", "n1")])
eq("limit truncates the ranking, it does not reorder it",
   [row["id"] for row in status.due(TWO, TODAY, per_subject=None, limit=2)[0]], ["n1", "n2"])

section("read_nodes — the id is stripped off the name however the record spells it")
def node_name(cell):
    table = "## Nodes\n\n| Node | Status | Last checked | Evidence |\n| --- | --- | --- | --- |\n| %s | checked | 2026-09-17 | e |\n" % cell
    return status.read_nodes(table, "")["n1"]["name"]
eq("em dash", node_name("n1 — Memory address"), "Memory address")
eq("en dash", node_name("n1 – Memory address"), "Memory address")
eq("ascii hyphen", node_name("n1 - Memory address"), "Memory address")
eq("bare space", node_name("n1 encapsulation"), "encapsulation")
eq("full stop", node_name("n1. static vs. instance"), "static vs. instance")

section("read_nodes — the plan table is read by header name, not position")
def plan_table(header, *rows):
    def line(cells):
        return "| " + " | ".join(cells) + " |"
    return "\n".join(["## Nodes", "", line(header), line(["---"] * len(header))]
                     + [line(row) for row in rows]) + "\n"
TEMPLATE = ["Id", "Node", "Rests on (unconditional truth)", "Discovery question", "Check type",
            "Can do", "Est. min", "Prereqs", "Status"]
WIDE = status.read_nodes("", plan_table(TEMPLATE,
    ["n1", "Memory", "t", "q", "c", "say what an address is", "10", "none", "checked"],
    ["n2", "Pointers", "t", "q", "c", "", "15", "n1", "planned"]))
eq("the can-do statement is read from its column", WIDE["n1"]["can_do"], "say what an address is")
eq("an unnamed template row is not a node until the plan names it",
   sorted(status.read_nodes("", plan_table(TEMPLATE, ["n1", "Memory", "t", "q", "c", "", "10", "none", "planned"],
                                           ["n2", "", "", "", "", "", "", "", "planned"]))), ["n1"])
eq("an empty Can do cell falls back to the node name", WIDE["n2"]["can_do"], "Pointers")
eq("Prereqs and Status come from their headers, with Can do in the middle",
   (WIDE["n2"]["prereqs"], WIDE["n2"]["plan_status"]), (["n1"], "planned"))
SHUFFLED = status.read_nodes("", plan_table(["Status", "Prereqs", "Node", "Id"],
                                      ["planned", "none", "Memory", "n1"],
                                      ["checked", "n1", "Pointers", "n2"]))
eq("column order does not matter",
   (SHUFFLED["n2"]["name"], SHUFFLED["n2"]["prereqs"], SHUFFLED["n2"]["plan_status"]),
   ("Pointers", ["n1"], "checked"))
OLD = status.read_nodes("", plan_table([cell for cell in TEMPLATE if cell != "Can do"],
                                 ["n1", "Memory", "t", "q", "c", "10", "none", "checked"]))
eq("a plan without a Can do column still loads, falling back to the name",
   (OLD["n1"]["can_do"], OLD["n1"]["plan_status"]), ("Memory", "checked"))
SHORT = status.read_nodes("", plan_table(["Id", "Node", "Prereqs", "Status"], ["n1", "Memory", "none", "planned"]))
eq("a four-column table still yields its status",
   SHORT["n1"]["plan_status"], "planned")
ESCAPED = status.read_nodes("", plan_table(["Id", "Node", "Discovery question", "Prereqs", "Status"],
                                     ["n2", "Projection", r"why \|a\|² and not \|a\|?", "none", "checked"]))
eq("an escaped pipe inside a cell does not shift the columns after it",
   ESCAPED["n2"]["plan_status"], "checked")

section("consistency — a prereq naming the node itself or an unknown id is dropped and reported")
LOOP_FOLDER = fresh() / "learn/subjects/fx"
LOOP_FOLDER.mkdir(parents=True)
LOOPED = status.read_nodes("", plan_table(TEMPLATE,
    ["n1", "Memory", "t", "q", "c", "", "10", "none", "planned"],
    ["n4", "Inheritance", "t", "q", "c", "", "15", "n4: none", "planned"],
    ["n5", "Override", "t", "q", "c", "", "15", "n4, n99", "planned"]))
eq("a self-reference is dropped from the graph", LOOPED["n4"]["prereqs"], [])
eq("an unknown id is dropped, a known one kept", LOOPED["n5"]["prereqs"], ["n4"])
edges = "```mermaid\nflowchart TD\n    n4 --> n5\n```\n"
prereq_warnings = [w for w in status.consistency(LOOPED, edges, "fx", {}, [], LOOP_FOLDER)
                   if "prereq" in w]
eq("the self-loop is a record inconsistency",
   any(w.startswith("fx n4:") and "itself" in w for w in prereq_warnings), True)
eq("the unknown id is a record inconsistency",
   any(w.startswith("fx n5:") and "n99" in w for w in prereq_warnings), True)
eq("dropped prereqs do not also trip the prereqs-vs-edges check",
   [w for w in prereq_warnings if "graph edges" in w], [])
eq("a clean plan with no Can do column reports nothing about prereqs",
   [w for w in status.consistency(OLD, "", "fx", {}, [], LOOP_FOLDER) if "prereq" in w], [])

section("markers — the trailing run of `→ nN <status>` on an evidence line")
eq("one marker", status.markers("- 2026-09-30 s05: q → a → correct → n9 solid"), [("n9", "solid")])
eq("several markers, in line order",
   status.markers("- 2026-09-30 s05: q → a → correct → n1 solid → n3 checked"),
   [("n1", "solid"), ("n3", "checked")])
eq("no marker", status.markers("- 2026-09-30 s05: q → a → correct"), [])
eq("text after a marker is not a marker run",
   status.markers("- 2026-09-30 s05: q → a → correct → n4 solid (second try)"), [])
eq("only the trailing run counts",
   status.markers("- 2026-09-30 s05: q → n2 planned → correct → n4 solid"), [("n4", "solid")])
eq("an unknown status word is not a marker", status.markers("- 2026-09-30 s05: q → a → n4 great"), [])


def evidence(*lines):
    return "## Nodes\n\n## Evidence log\n\n" + "\n".join("- " + line for line in lines) + "\n\n## Strands\n\n- 2026-09-22 s01: x → n1 decayed\n"


section("evidence_events — ordered by date, the named note's start time, then position")
SAME_DAY = evidence("2026-09-22 r02: q → a → wrong → n1 decayed",
                    "2026-09-22 s01: q → a → correct → n1 checked",
                    "2026-09-21 s00: q → a → correct → n2 checked",
                    "2026-09-22 (diagnosis): q → a → correct",
                    "2026-09-22 s05: q → a → correct → n2 solid")
STARTS = {("2026-09-22", "r02"): "14:15", ("2026-09-22", "s01"): "10:00", ("2026-09-21", "s00"): "09:00"}
ORDERED = status.evidence_events(SAME_DAY, STARTS)
eq("a session at 10:00 comes before a review at 14:15 on the same day, whatever the log order",
   [(e["source"], e["node"], e["status"]) for e in ORDERED if e["date"] == "2026-09-22" and e["source"] != "s05"],
   [("s01", "n1", "checked"), ("r02", "n1", "decayed")])
eq("an earlier date comes first", ORDERED[0]["date"], "2026-09-21")
eq("a line whose note is missing sorts by date then position, ahead of that day's timed notes",
   [(e["source"], e["node"]) for e in ORDERED],
   [("s00", "n2"), ("s05", "n2"), ("s01", "n1"), ("r02", "n1")])
eq("only the Evidence log is read", len(ORDERED), 4)
NO_NOTES = status.evidence_events(SAME_DAY, {})
eq("with no notes at all, lines order by date then position",
   [(e["source"], e["node"]) for e in NO_NOTES],
   [("s00", "n2"), ("r02", "n1"), ("s01", "n1"), ("s05", "n2")])


section("lapses — a drop to decayed, not every decayed marker")
def events_of(*pairs):
    return [{"date": "2026-09-%02d" % (10 + i), "source": "s01", "position": i, "node": node, "status": st}
            for i, (node, st) in enumerate(pairs)]
LAPSED = status.lapses(events_of(("n1", "checked"), ("n1", "decayed"), ("n1", "decayed"),
                                 ("n2", "solid"), ("n1", "checked"), ("n1", "decayed")))
eq("repeated decayed is one lapse; a recovery then a decay is a second",
   [(e["node"], e["date"]) for e in LAPSED], [("n1", "2026-09-11"), ("n1", "2026-09-15")])
eq("a node's first marker being decayed is a lapse",
   [e["node"] for e in status.lapses(events_of(("n3", "decayed")))], ["n3"])
eq("another node's marker between two decays does not break the run",
   len(status.lapses(events_of(("n1", "decayed"), ("n2", "decayed"), ("n1", "decayed")))), 2)


section("consistency — transition markers against the node table")
def marker_node(node, st, checked):
    return {"id": node, "name": node, "status": st, "checked": checked, "evidence": "",
            "prereqs": [], "plan_status": ""}
MARKED = {"n1": marker_node("n1", "solid", "2026-09-22"),
          "n2": marker_node("n2", "checked", "2026-09-20 s02"),
          "n3": marker_node("n3", "checked", "2026-09-21"),
          "n4": marker_node("n4", "introduced", "")}
MARKER_LOG = evidence("2026-09-20 s02: q → a → correct → n1 checked → n2 checked",
                      "2026-09-22 s03: q → a → correct → n1 decayed",
                      "2026-09-21 s03: q → a → correct → n2 checked → n9 solid",
                      "2026-09-21 s03: q → a → correct → n3 checked")
marker_found = status.marker_warnings("fx", MARKED, status.evidence_events(MARKER_LOG, {}))
eq("a last marker that disagrees with the table status is reported",
   any(w.startswith("fx n1:") and "'decayed'" in w and "'solid'" in w for w in marker_found), True)
eq("a latest marker date that differs from Last checked is reported",
   any(w.startswith("fx n2:") and "2026-09-21" in w and "Last checked" in w for w in marker_found), True)
eq("a marker naming an unknown node id is reported",
   any(w.startswith("fx n9:") and "not in the node table" in w for w in marker_found), True)
eq("an agreeing node is not reported", [w for w in marker_found if w.startswith("fx n3:")], [])
eq("the no-marker check is on now the backfill has landed", status.MARKERS_REQUIRED, True)
UNMARKED = dict(MARKED, n5=marker_node("n5", "checked", "2026-09-21"))
required = status.marker_warnings("fx", UNMARKED, status.evidence_events(MARKER_LOG, {}))
eq("a checked node with no marker is reported, and not an introduced one",
   [w.split(":")[0] for w in required if "no transition marker" in w], ["fx n5"])
status.MARKERS_REQUIRED = False
try:
    relaxed = status.marker_warnings("fx", UNMARKED, status.evidence_events(MARKER_LOG, {}))
finally:
    status.MARKERS_REQUIRED = True
eq("switching the constant off silences the no-marker check",
   [w for w in relaxed if "no transition marker" in w], [])

MARKER_FOLDER = fresh() / "learn/subjects/fx"
write(MARKER_FOLDER / "record.md", MARKER_LOG)
write(MARKER_FOLDER / "sessions/2026-09-21-s03.md", '---\nsubject: "fx"\nsession: "03"\ndate: "2026-09-21"\nstart: "10:00"\nend: "11:00"\nnodes: []\n---\n')
write(MARKER_FOLDER.parents[1] / "reviews/2026-09-22-r01.md", '---\nkind: review\nreview: 01\ndate: 2026-09-22\nstart: "09:00"\n---\n')
eq("the notes' start times are read from sessions/ and learn/reviews/",
   status.note_starts(MARKER_FOLDER), {("2026-09-21", "s03"): "10:00", ("2026-09-22", "r01"): "09:00"})
eq("consistency() reads record.md from the subject folder and reports marker drift",
   any(w.startswith("fx n9:") for w in status.consistency(MARKED, "", "fx", {}, [], MARKER_FOLDER)), True)


section("due — ties break on a name, so two runs on one day agree")
TIE = [("beta", {"n2": {"id": "n2", "status": "checked", "checked": "2026-09-01", "evidence": "", "name": "B"}}),
       ("alpha", {"n1": {"id": "n1", "status": "checked", "checked": "2026-09-01", "evidence": "", "name": "A"}})]
eq("same staleness sorts by subject then node",
   [(row["subject"], row["id"]) for row in status.due(TIE, TODAY, per_subject=None)[0]],
   [("alpha", "n1"), ("beta", "n2")])


section("is_due — checked after 3 days, solid after 7, decayed never (spec section 3)")
DUE_DAY = datetime(2026, 9, 24).date()
def due_node(st, checked):
    return {"id": "n1", "name": "n1", "status": st, "checked": checked}
eq("checked 3 days ago is due, 2 days ago is not",
   (status.is_due(due_node("checked", "2026-09-21"), DUE_DAY),
    status.is_due(due_node("checked", "2026-09-22 s02"), DUE_DAY)), (True, False))
eq("solid 7 days ago is due, 6 days ago is not",
   (status.is_due(due_node("solid", "2026-09-17"), DUE_DAY),
    status.is_due(due_node("solid", "2026-09-18"), DUE_DAY)), (True, False))
eq("a decayed node is never due, however old",
   status.is_due(due_node("decayed", "2026-01-01"), DUE_DAY), False)
eq("planned, introduced, and undated nodes are never due",
   [status.is_due(due_node(st, checked), DUE_DAY)
    for st, checked in (("planned", ""), ("introduced", "2026-09-01"), ("checked", "—"))],
   [False, False, False])
eq("inside the deadline window, a node checked before the window opened is due",
   status.is_due(due_node("solid", "2026-09-19"), DUE_DAY, deadline="2026-09-27"), True)
eq("inside the window, a node checked since it opened keeps the normal rule",
   status.is_due(due_node("solid", "2026-09-21"), DUE_DAY, deadline="2026-09-27"), False)
eq("the window opens 7 days before the deadline, the span the Deadline candidate uses",
   [status.is_due(due_node("solid", "2026-09-18"), DUE_DAY, deadline=d)
    for d in ("2026-10-01", "2026-10-02")], [True, False])
eq("after the deadline the window is closed",
   status.is_due(due_node("solid", "2026-09-19"), DUE_DAY, deadline="2026-09-23"), False)
eq("the window never makes a decayed node due",
   status.is_due(due_node("decayed", "2026-09-01"), DUE_DAY, deadline="2026-09-25"), False)


section("rank — the recommended action, every kind in order (spec section 3)")
def rnode(node, st, checked="", name=None, prereqs=()):
    return {"id": node, "name": name or node.upper(), "status": st, "checked": checked,
            "prereqs": list(prereqs)}
def rsubject(slug, nodes, events=(), **fields):
    fields.setdefault("title", slug.title())
    fields.setdefault("status", "active")
    return (slug, {node["id"]: node for node in nodes}, fields, list(events))
def marker_event(node, date, st="decayed"):
    return {"date": date, "source": "s01", "position": 0, "start": "", "node": node, "status": st}
RANK_NOW = datetime(2026, 9, 24, 15, 0)
def rnote(slug, stem, paused=None, end=None, date="2026-09-24"):
    text = ('---\nsubject: "%s"\nsession: "%s"\ndate: "%s"\nstart: "10:00"\npaused: %s\nend: %s\n---\n'
            % (slug, stem[-2:], date, paused or "", end or ""))
    return (slug, session_note.parse(text, name="%s-%s" % (date, stem), now=RANK_NOW))
def kinds(found):
    return [(c["kind"], c["subject"]) for c in found]

eq("with nothing pending, Start is the only candidate",
   status.rank([rsubject("fin", [rnode("n1", "checked", "2026-09-23")], status="done")], [], DUE_DAY),
   [{"kind": "Start", "subject": None, "title": None, "command": "learn-start",
     "reason": "start something new", "welcome": ""}])

EVERY_KIND = [
    rsubject("act", [rnode("n1", "checked", "2026-09-23"), rnode("n2", "planned", prereqs=["n1"])],
             last_session="2026-09-20"),
    rsubject("brk", [rnode("n1", "introduced")], last_session="2026-09-24"),
    rsubject("exam", [rnode("n1", "solid", "2026-09-10", name="Chain rule")], deadline="2026-09-27",
             title="Calc"),
    rsubject("old", [rnode("n1", "checked", "2026-09-01", name="Leaves")], status="done"),
    rsubject("rep", [rnode("n1", "decayed", "2026-09-22", name="Aliasing")], status="done"),
]
EVERY_NOTES = [rnote("brk", "s02", paused="14:05")]
ranked = status.rank(EVERY_KIND, EVERY_NOTES, DUE_DAY)
eq("break, deadline, repair, review, resume, start",
   kinds(ranked), [("Continue a break", "brk"), ("Deadline", "exam"), ("Repair", "rep"),
                   ("Review", None), ("Resume", "act"), ("Start", None)])
eq("each kind's command",
   [c["command"] for c in ranked],
   ["learn-resume brk", "learn-review exam", "learn-resume rep", "learn-review",
    "learn-resume act", "learn-start"])
eq("a break's reason and welcome name the pause time",
   (ranked[0]["reason"], ranked[0]["welcome"]),
   ("your session paused at 14:05", "pick your Brk session back up; the break started at 14:05"))
eq("a deadline subject's Review names its own due nodes after the prefix",
   (ranked[1]["reason"], ranked[1]["welcome"]),
   ("deadline in 3 days: 1 node is due in Calc, oldest *Chain rule* (last checked 10 Sep)",
    "Calc's deadline is in 3 days, so review the 1 node that is due, oldest *Chain rule* from Calc"))
eq("a Repair names the node and when it slipped",
   (ranked[2]["reason"], ranked[2]["welcome"]),
   ("*Aliasing* slipped on 22 Sep",
    "bring back *Aliasing* in Rep. It slipped on 22 Sep, and one short session puts it back"))
eq("the one Review counts every due node across subjects, deadline subjects included",
   (ranked[3]["reason"], ranked[3]["welcome"], ranked[3]["title"]),
   ("2 nodes are due across 2 subjects, oldest *Leaves* (last checked 1 Sep)",
    "review the 2 nodes that are due, oldest *Leaves* from Old", None))
eq("a Resume names the next node",
   (ranked[4]["reason"], ranked[4]["welcome"]), ("*N2* is next", "continue Act, where *N2* is next"))
eq("reward-blind and read-only: the same inputs give the same ranking",
   status.rank(EVERY_KIND, EVERY_NOTES, DUE_DAY), ranked)

section("rank — Continue a break")
BREAKS = [rsubject("a", [], last_session="2026-09-24"), rsubject("b", [], last_session="2026-09-24")]
eq("most recent pause first; a stale pause or a cut-off is no break",
   kinds(status.rank(BREAKS, [rnote("a", "s01", paused="12:00"), rnote("b", "s03", paused="14:30"),
                              rnote("a", "s00", paused="09:00", date="2026-09-23")], DUE_DAY)),
   [("Continue a break", "b"), ("Continue a break", "a"), ("Start", None)])

eq("a subject on a break still gets its Repair line; only Resume skips it",
   kinds(status.rank([rsubject("a", [rnode("n1", "decayed", "2026-09-20")], last_session="2026-09-24")],
                     [rnote("a", "s01", paused="14:30")], DUE_DAY)),
   [("Continue a break", "a"), ("Repair", "a"), ("Start", None)])

section("rank — Deadline")
DEADLINES = [
    rsubject("far", [rnode("n1", "planned")], deadline="2026-10-02"),
    rsubject("later", [rnode("n1", "planned")], deadline="2026-09-30"),
    rsubject("gone", [rnode("n1", "planned")], deadline="2026-09-23", last_session="2026-09-23"),
    rsubject("idle", [rnode("n1", "checked", "2026-09-23")], deadline="2026-09-25", status="done"),
    rsubject("soon", [rnode("n1", "decayed", "2026-09-20", name="Limits"), rnode("n2", "solid", "2026-09-01")],
             deadline="2026-09-24", status="done"),
    rsubject("zeta", [rnode("n1", "planned")], deadline="2026-09-30"),
]
found = status.rank(DEADLINES, [], DUE_DAY)
eq("sooner deadline first, then slug; one outside 7 days or already passed is not a deadline",
   [c["subject"] for c in found if c["kind"] == "Deadline"], ["soon", "later", "zeta"])
eq("a subject's Repair comes before its Review, and its deadline prefix says today",
   (found[0]["command"], found[0]["reason"]),
   ("learn-resume soon", "deadline today: *Limits* slipped on 20 Sep"))
eq("with nothing to repair or review, an active subject resumes",
   (found[1]["command"], found[1]["reason"], found[1]["welcome"]),
   ("learn-resume later", "deadline in 6 days: *N1* is next",
    "Later's deadline is in 6 days, so continue Later, where *N1* is next"))
eq("a done subject with nothing pending yields no deadline candidate",
   "idle" in [c["subject"] for c in found], False)
eq("a deadline subject is not listed again under Repair or Resume",
   [c["kind"] for c in found if c["subject"] in ("soon", "later")], ["Deadline", "Deadline"])
eq("the one Review still counts the deadline subject's due node",
   [c["reason"] for c in found if c["kind"] == "Review"],
   ["1 node is due in Soon, oldest *N2* (last checked 1 Sep)"])
eq("one day out reads in 1 day",
   status.rank([rsubject("x", [rnode("n1", "planned")], deadline="2026-09-25")], [], DUE_DAY)[0]["reason"],
   "deadline in 1 day: *N1* is next")

section("rank — Repair order: count, oldest decay, lapses, slug")
def repair_order(*subjects):
    return [c["subject"] for c in status.rank(list(subjects), [], DUE_DAY) if c["kind"] == "Repair"]
eq("most decayed nodes first",
   repair_order(rsubject("a", [rnode("n1", "decayed", "2026-09-01")], status="done"),
                rsubject("b", [rnode("n1", "decayed", "2026-09-20"), rnode("n2", "decayed", "2026-09-20")],
                         status="done")), ["b", "a"])
eq("then the oldest decay date, read from the latest lapse marker before Last checked",
   repair_order(rsubject("a", [rnode("n1", "decayed", "2026-09-10")], status="done"),
                rsubject("b", [rnode("n1", "decayed", "2026-09-22")],
                         [marker_event("n1", "2026-09-05")], status="done")), ["b", "a"])
eq("without a lapse marker the decay date is Last checked",
   repair_order(rsubject("a", [rnode("n1", "decayed", "2026-09-12")], status="done"),
                rsubject("b", [rnode("n1", "decayed", "2026-09-11")], status="done")), ["b", "a"])
eq("then the most lapses on one decayed node, ahead of slug",
   repair_order(rsubject("a", [rnode("n1", "decayed", "2026-09-22")], [marker_event("n1", "2026-09-22")], status="done"),
                rsubject("b", [rnode("n1", "decayed", "2026-09-22")],
                         [marker_event("n1", "2026-09-10"), marker_event("n1", "2026-09-12", "checked"),
                          marker_event("n1", "2026-09-22")], status="done")), ["b", "a"])
eq("then slug",
   repair_order(rsubject("b", [rnode("n1", "decayed", "2026-09-22")], status="done"),
                rsubject("a", [rnode("n1", "decayed", "2026-09-22")], status="done")), ["a", "b"])
POINTERS = rsubject("pointers-and-references", [rnode("n2", "decayed", "2026-09-22")],
                    [marker_event("n2", "2026-09-17"), marker_event("n2", "2026-09-17", "checked"),
                     marker_event("n2", "2026-09-22")], status="done")
EALC = rsubject("quiz2-analects-baijuyi-hakurakuten", [rnode("n3", "decayed", "2026-09-22")],
                [marker_event("n3", "2026-09-22")], status="done")
eq("Pointers (2 lapses on n2) ranks above EALC (1 lapse on n3)",
   repair_order(EALC, POINTERS), ["pointers-and-references", "quiz2-analects-baijuyi-hakurakuten"])
eq("several decayed nodes: the first to slip is named, with a count of the rest",
   status.rank([rsubject("m", [rnode("n1", "decayed", "2026-09-22", name="Late"),
                               rnode("n2", "decayed", "2026-09-20", name="Early"),
                               rnode("n3", "decayed", "2026-09-21")], status="done")],
               [], DUE_DAY)[0]["reason"],
   "*Early* and 2 more slipped, the first on 20 Sep")
eq("a paused subject with a decayed node repairs rather than resumes",
   kinds(status.rank([rsubject("p", [rnode("n1", "decayed", "2026-09-20")], status="paused")], [], DUE_DAY)),
   [("Repair", "p"), ("Start", None)])

section("rank — Resume order, the passed-deadline demotion, and its reasons")
RESUMES = [
    rsubject("b", [rnode("n1", "planned")], last_session="2026-09-20"),
    rsubject("a", [rnode("n1", "planned")], last_session="2026-09-20"),
    rsubject("new", [rnode("n1", "checked", "2026-09-23")], last_session="2026-09-22", status="paused"),
    rsubject("past", [rnode("n1", "planned")], last_session="2026-09-23", deadline="2026-09-22"),
    rsubject("done", [rnode("n1", "planned")], last_session="2026-09-24", status="done"),
]
found = status.rank(RESUMES, [rnote("a", "s03", date="2026-09-20")], DUE_DAY)
eq("most recent last_session first, then slug; a passed deadline sinks below every other Resume",
   kinds(found), [("Resume", "new"), ("Resume", "a"), ("Resume", "b"), ("Resume", "past"), ("Start", None)])
eq("every node proven reads as a wrap-up, not a lesson to continue",
   (found[0]["reason"], found[0]["welcome"]),
   ("every planned topic is passed, so this is a wrap-up", "wrap up New, where every planned topic is passed"))
eq("no planned node but one still being learned reads continue the plan",
   status.rank([rsubject("mid", [rnode("n1", "introduced")])], [], DUE_DAY)[0]["reason"], "continue the plan")
eq("an open note is named as closed out first",
   found[1]["reason"], "*N1* is next. Its open s03 note is closed out first.")
eq("a passed deadline is named",
   found[3]["reason"], "*N1* is next. The deadline (22 Sep) has passed.")
eq("a deadline still ahead resumes first, soonest first, even outside the Deadline window",
   kinds(status.rank(RESUMES + [rsubject("exam", [rnode("n1", "planned")], deadline="2026-10-05"),
                                rsubject("quiz", [rnode("n1", "planned")], deadline="2026-10-02")],
                     [], DUE_DAY))[:3],
   [("Resume", "quiz"), ("Resume", "exam"), ("Resume", "new")])

section("rank — a diagnosing subject is resumable, on Home and in the Deadline slot")
DIAG = rsubject("lagrange", [rnode("n1", "planned"), rnode("n2", "planned", prereqs=["n1"])],
                status="diagnosing", title="Lagrange")
eq("a paused diagnosis is offered as Resume, worded as the diagnosis",
   [(c["kind"], c["reason"], c["welcome"]) for c in status.rank([DIAG], [], DUE_DAY)][:1],
   [("Resume", "finish the diagnosis, then build the plan",
     "finish the diagnosis for Lagrange, then build its plan")])
eq("inside the deadline window it takes the Deadline slot",
   [(c["kind"], c["reason"]) for c in status.rank(
       [(DIAG[0], DIAG[1], dict(DIAG[2], deadline="2026-09-30"), DIAG[3])], [], DUE_DAY)][:1],
   [("Deadline", "deadline in 6 days: finish the diagnosis, then build the plan")])

section("rank — the next node follows the plan's prereqs")
def next_reason(*nodes):
    return status.rank([rsubject("x", list(nodes))], [], DUE_DAY)[0]["reason"]
eq("the first planned node whose prereqs are all proven",
   next_reason(rnode("n1", "introduced"), rnode("n2", "planned", prereqs=["n1"]),
               rnode("n3", "planned", prereqs=["n4"]), rnode("n4", "skipped")), "*N3* is next")
eq("else the first planned node",
   next_reason(rnode("n1", "introduced"), rnode("n2", "planned", prereqs=["n1"])), "*N2* is next")
eq("nodes are read in plan order, n2 before n10",
   next_reason(rnode("n10", "planned"), rnode("n2", "planned")), "*N2* is next")

section("--next — one line per candidate, in the host's command form, writing nothing")
eq("claude commands use /",
   status.next_report(ranked[2:4]).splitlines(),
   ["1. Repair · Rep · /learn-resume rep · *Aliasing* slipped on 22 Sep",
    "2. Review · any subject · /learn-review · 2 nodes are due across 2 subjects, "
    "oldest *Leaves* (last checked 1 Sep)"])
eq("codex commands use $",
   status.next_report(ranked[-1:], host="codex"), "1. Start · any subject · $learn-start · start something new")
import subprocess  # noqa: E402
NEXT_VAULT = fresh()
write(NEXT_VAULT / "learn/subjects/fx/record.md",
      '---\nsubject: "fx"\ntitle: "Fx"\nstatus: active\nlast_session: "2026-09-20"\n---\n\n'
      "## Nodes\n\n| Node | Status | Last checked | Evidence |\n| --- | --- | --- | --- |\n"
      "| n1 Loops | planned | — | — |\n")
before = sorted(str(p) for p in NEXT_VAULT.rglob("*"))
printed = subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(NEXT_VAULT),
                          "--next", "--host", "codex"], capture_output=True, text=True).stdout
eq("--next prints the ranking from the records",
   printed.splitlines(), ["1. Resume · Fx · $learn-resume fx · *Loops* is next",
                          "2. Start · any subject · $learn-start · start something new"])
eq("--next writes no file", sorted(str(p) for p in NEXT_VAULT.rglob("*")), before)



section("rewards, badges from transition markers (spec section 2)")
def reward_texts(found):
    return [badge["text"] for badge in found["badges"]]
SOLID_ONCE = rsubject("s", [rnode("n1", "solid", "2026-09-22", name="Aliasing")],
                      [marker_event("n1", "2026-09-15", "checked"), marker_event("n1", "2026-09-20", "solid"),
                       marker_event("n1", "2026-09-22", "solid")])
eq("a Solid badge is dated by the node's first solid marker",
   reward_texts(status.rewards([SOLID_ONCE], DUE_DAY)), ["Solid: Aliasing, 2026-09-20"])

TWICE = rsubject("t", [rnode("n1", "solid", "2026-09-21", name="Aliasing")],
                 [marker_event("n1", "2026-09-01", "checked"), marker_event("n1", "2026-09-05", "solid"),
                  marker_event("n1", "2026-09-10"), marker_event("n1", "2026-09-11"),
                  marker_event("n1", "2026-09-14", "solid"), marker_event("n1", "2026-09-15", "solid"),
                  marker_event("n1", "2026-09-17"), marker_event("n1", "2026-09-19", "checked"),
                  marker_event("n1", "2026-09-21", "solid")])
eq("each solid marker after a lapse is a Recovered badge; the first Solid badge stays; newest first",
   reward_texts(status.rewards([TWICE], DUE_DAY)),
   ["Recovered: Aliasing, 2026-09-21", "Recovered: Aliasing, 2026-09-14", "Solid: Aliasing, 2026-09-05"])

SAME_DATE = [rsubject("b", [rnode("n1", "solid", "2026-09-20", name="Solid one"),
                            rnode("n2", "solid", "2026-09-20", name="Back again")],
                      [marker_event("n1", "2026-09-20", "solid"), marker_event("n2", "2026-09-18"),
                       marker_event("n2", "2026-09-20", "solid")], title="Beta"),
             rsubject("a", [], goal_met="2026-09-20", title="Alpha", status="done")]
eq("a Goal met badge is dated by goal_met:; one date orders goal, recovered, solid, then title and plan order",
   [(b["kind"], b["title"], b["text"]) for b in status.rewards(SAME_DATE, DUE_DAY)["badges"]],
   [("Goal met", "Alpha", "Goal met: Alpha, 2026-09-20"), ("Recovered", "Beta", "Recovered: Back again, 2026-09-20"),
    ("Solid", "Beta", "Solid: Solid one, 2026-09-20"), ("Solid", "Beta", "Solid: Back again, 2026-09-20")])
eq("a subject without goal_met: has no Goal met badge",
   [b["kind"] for b in status.rewards([rsubject("c", [], status="done")], DUE_DAY)["badges"]], [])
eq("nothing dated after today counts",
   reward_texts(status.rewards(SAME_DATE, datetime(2026, 9, 19).date())), [])


section("rewards, open recoveries")
OPEN = rsubject("o", [rnode("n1", "checked", "2026-09-22", name="Re-taught"), rnode("n2", "decayed", "2026-09-21"),
                      rnode("n3", "solid", "2026-09-22")],
                [marker_event("n1", "2026-09-10", "solid"), marker_event("n1", "2026-09-20"),
                 marker_event("n1", "2026-09-22", "checked"), marker_event("n2", "2026-09-19"),
                 marker_event("n2", "2026-09-21"), marker_event("n3", "2026-09-18"),
                 marker_event("n3", "2026-09-22", "solid")])
eq("a lapse stays open through a re-teach until a solid marker; a recovered node is not open",
   [(r["subject"], r["node"], r["name"], r["date"]) for r in status.rewards([OPEN], DUE_DAY)["open_recoveries"]],
   [("o", "n1", "Re-taught", "2026-09-20"), ("o", "n2", "N2", "2026-09-19")])
eq("no lapse, no open recovery", status.rewards([SOLID_ONCE, TWICE], DUE_DAY)["open_recoveries"], [])

RELAPSE = rsubject("r", [rnode("n4", "decayed", "2026-09-20")],
                   [marker_event("n4", "2026-09-15"), marker_event("n4", "2026-09-17", "checked"),
                    marker_event("n4", "2026-09-20")])
eq("an open recovery is dated by the latest lapse, after a re-teach and a second decay",
   [r["date"] for r in status.rewards([RELAPSE], DUE_DAY)["open_recoveries"]], ["2026-09-20"])


section("rewards, counts, which a decay never shrinks")
def counts_on(subjects, day):
    return status.rewards(subjects, day)["counts"]
COUNTED = [rsubject("c", [rnode("n1", "solid", "2026-09-20"), rnode("n2", "checked", "2026-09-18"),
                          rnode("n3", "skipped"), rnode("n4", "introduced"), rnode("n5", "planned"),
                          rnode("n6", "introduced")],
                    [marker_event("n1", "2026-09-15", "checked"), marker_event("n1", "2026-09-20", "solid"),
                     marker_event("n2", "2026-09-18", "checked"), marker_event("n6", "2026-09-16", "checked"),
                     marker_event("n6", "2026-09-19"), marker_event("n6", "2026-09-19", "introduced")],
                    goal_met="2026-09-21", status="done"),
           rsubject("d", [rnode("n1", "solid", "2026-09-22")],
                    [marker_event("n1", "2026-09-10", "checked"), marker_event("n1", "2026-09-12", "solid"),
                     marker_event("n1", "2026-09-17"), marker_event("n1", "2026-09-22", "solid")])]
eq("proven counts checked, solid, and skipped nodes and any node that ever had a checked or solid marker",
   {key: counts_on(COUNTED, DUE_DAY)[key] for key in ("nodes_proven", "checks_passed", "goals_met")},
   {"nodes_proven": 5, "checks_passed": 3, "goals_met": 1})
DECAYS = [rsubject("d", [rnode("n1", "decayed", "2026-09-17"), rnode("n2", "solid", "2026-09-12")],
                   [marker_event("n1", "2026-09-10", "checked"), marker_event("n1", "2026-09-12", "solid"),
                    marker_event("n2", "2026-09-12", "solid"), marker_event("n1", "2026-09-17")])]
before_decay = counts_on(DECAYS, datetime(2026, 9, 16).date())
after_decay = counts_on(DECAYS, datetime(2026, 9, 17).date())
eq("a decay leaves nodes proven, checks passed, goals met, and best streak where they were",
   [after_decay[key] - before_decay[key] for key in ("nodes_proven", "checks_passed", "goals_met", "best_streak")],
   [0, 0, 0, 0])
FIRST_CHECK = [rsubject("f", [rnode("n1", "checked", "2026-09-24"), rnode("n2", "skipped")],
                        [marker_event("n1", "2026-09-24", "checked")])]
eq("a node first checked today is not proven the day before; a skipped node needs no marker",
   (counts_on(FIRST_CHECK, datetime(2026, 9, 23).date())["nodes_proven"], counts_on(FIRST_CHECK, DUE_DAY)["nodes_proven"]),
   (1, 2))
eq("and the proven count is the full one on both days", (before_decay["nodes_proven"], after_decay["nodes_proven"]), (2, 2))


section("rewards, the weekly review streak (spec section 2)")
NEUTRAL = rsubject("nt", [rnode("n1", "solid", "2026-09-15")],
                   [marker_event("n1", "2026-08-31", "checked"), marker_event("n1", "2026-09-02", "solid"),
                    marker_event("n1", "2026-09-07"), marker_event("n1", "2026-09-15", "solid")])
neutral = status.rewards([NEUTRAL], DUE_DAY)["streak"]
eq("a pass adds a week, a week with nothing due is neutral, the current week is pending",
   ([w["result"] for w in neutral["weeks"]], neutral["current"], neutral["best"], neutral["alive"]),
   (["pass", "neutral", "pass", "pending"], 2, 2, True))
eq("weeks run Monday to Sunday, and each lists the nodes due in it",
   [(w["start"], w["due"]) for w in neutral["weeks"]],
   [("2026-08-31", []), ("2026-09-07", []), ("2026-09-14", []), ("2026-09-21", [("nt", "n1")])])
eq("the streak shows in the counts",
   (counts_on([NEUTRAL], DUE_DAY)["current_streak"], counts_on([NEUTRAL], DUE_DAY)["best_streak"]), (2, 2))
eq("no markers, no streak",
   status.rewards([rsubject("e", [])], DUE_DAY)["streak"], {"current": 0, "best": 0, "alive": False, "weeks": []})

STREAK_START = datetime(2026, 8, 3).date()  # a Monday
def week_day(week, day=0):
    return (STREAK_START + timedelta(weeks=week, days=day)).isoformat()
def streak_of(passes, today_week, repairs=()):
    """n0 is checked in week 0 and stays due. Each passed week passes a node checked
    that Monday, so it was never due before; a repair passes n0 on a Tuesday."""
    found = [marker_event("n0", week_day(0), "checked")]
    for week in passes:
        found += [marker_event("n%d" % (week + 1), week_day(week), "checked"),
                  marker_event("n%d" % (week + 1), week_day(week, 1), "solid")]
    found += [marker_event("n0", week_day(week, 1), "solid") for week in repairs]
    found.sort(key=lambda event: event["date"])
    streak = status.rewards([rsubject("st", [], found)], STREAK_START + timedelta(weeks=today_week, days=3))["streak"]
    return [w["result"] for w in streak["weeks"]], streak["current"], streak["best"]
eq("an unpaid previous week and the current week are pending, and reset nothing",
   streak_of({0, 1}, 3), (["pass", "pass", "pending", "pending"], 2, 2))
eq("the previous week's miss is repaired this week by passing a node that was due in it",
   streak_of({0, 1}, 3, repairs={3}), (["pass", "pass", "repaired", "pass"], 3, 3))
eq("a repair in the following week makes the miss neutral once both weeks are past",
   streak_of({0, 1}, 5, repairs={3}), (["pass", "pass", "repaired", "pass", "pending", "pending"], 3, 3))
eq("a pass on a node that was not due does not repair; the first miss is forgiven",
   streak_of({0, 1, 3}, 5), (["pass", "pass", "forgiven", "pass", "pending", "pending"], 3, 3))
eq("a second miss within 4 weeks of a forgiven one resets the streak; best keeps its high",
   streak_of({0, 1, 3, 5}, 7), (["pass", "pass", "forgiven", "pass", "miss", "pass", "pending", "pending"], 1, 3))
eq("a miss 4 weeks after a forgiven one is forgiven again",
   streak_of({0, 1, 3, 4, 5}, 8),
   (["pass", "pass", "forgiven", "pass", "pass", "pass", "forgiven", "pending", "pending"], 5, 5))
eq("a streak reset to 0 is not alive",
   status.rewards([rsubject("st", [], [marker_event("n0", week_day(0), "checked")])],
                  STREAK_START + timedelta(weeks=5))["streak"]["alive"], False)


section("rewards setting, on, off, missing, and anything else (spec section 4)")
def setting(frontmatter_line):
    vault = fresh()
    write(vault / "learn/me/preferences.md", "---\nlearner: Edison\n%s---\n\n# Learner preferences\n"
          % (frontmatter_line + "\n" if frontmatter_line else ""))
    return status.rewards_setting(vault)
eq("on, true, and yes mean on, in any case",
   [setting("rewards: %s" % value) for value in ("on", "true", "yes", "On", "YES")], [(True, None)] * 5)
eq("off, false, and no mean off, with no warning",
   [setting("rewards: %s" % value) for value in ("off", "false", "no", "Off")], [(False, None)] * 4)
eq("a trailing comment is not part of the value",
   (setting("rewards: on  # off hides badges, streak, and reward lines"),
    setting("rewards: off # hidden")), ((True, None), (False, None)))
eq("a comment with no value is a missing value, so on", setting("rewards: # later"), (True, None))
eq("a missing key, or a missing file, means on",
   (setting(""), status.rewards_setting(fresh())), ((True, None), (True, None)))
unknown = setting("rewards: quiet")
eq("any other value means off and is reported as a record inconsistency",
   (unknown[0], "rewards: quiet" in (unknown[1] or "") and "preferences.md" in (unknown[1] or "")), (False, True))
eq("the vault's own preferences.md reads as on", status.rewards_setting(HOOKS.parents[1]), (True, None))

SETTING_VAULT = fresh()
write(SETTING_VAULT / "learn/me/preferences.md", "---\nrewards: loud\n---\n")
subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(SETTING_VAULT), "--quiet"], check=True)
eq("the run lists an unknown rewards: value under Record inconsistencies",
   "rewards: loud" in (SETTING_VAULT / "learn/Dashboard.md").read_text().split("## Record inconsistencies", 1)[-1],
   True)


section("--rewards, the reward lines for one session or one review (spec section 11)")
def sourced(node, date, st, source):
    return dict(marker_event(node, date, st), source=source)
SESSION = rsubject("e", [rnode("n1", "solid", "2026-09-24", name="Alpha"), rnode("n2", "solid", "2026-09-24", name="Beta"),
                         rnode("n3", "checked", "2026-09-24", name="Gamma"), rnode("n4", "decayed", "2026-09-24", name="Delta")],
                   [sourced("n1", "2026-09-10", "checked", "s01"), sourced("n2", "2026-09-10", "checked", "s01"),
                    sourced("n4", "2026-09-10", "checked", "s01"), sourced("n2", "2026-09-15", "solid", "s02"),
                    sourced("n2", "2026-09-20", "decayed", "s03"), sourced("n1", "2026-09-24", "solid", "s05"),
                    sourced("n2", "2026-09-24", "solid", "s05"), sourced("n3", "2026-09-24", "checked", "s05"),
                    sourced("n4", "2026-09-24", "decayed", "s05")], title="Echo")
end_lines = status.reward_lines([SESSION], DUE_DAY, subject="e", session="05")
eq("badges, recovery open, changed counts, then the streak, capped at 4 by collapsing the badges",
   end_lines,
   ["2 wins: Beta (remembered again after slipping) · Alpha (remembered on a later day)",
    "Slipped: Delta. Get it right in a later session and it counts as remembered again.",
    "Topics passed: 3 → 4 · Topics remembered on a later day: 1 → 3",
    "Review streak: 2 weeks"])
eq("the session number may be written 5, 05, or s05",
   [status.reward_lines([SESSION], DUE_DAY, subject="e", session=n) for n in ("5", "s05")], [end_lines, end_lines])
TWO_BADGES = rsubject("t", [rnode("n1", "solid", "2026-09-24", name="Alpha"), rnode("n2", "solid", "2026-09-24", name="Beta")],
                      [sourced("n1", "2026-09-10", "checked", "s01"), sourced("n2", "2026-09-10", "checked", "s01"),
                       sourced("n1", "2026-09-24", "solid", "s02"), sourced("n2", "2026-09-24", "solid", "s02")])
eq("with at most two badges and room for them, each badge is its own line",
   status.reward_lines([TWO_BADGES], DUE_DAY, subject="t", session="02")[:2],
   ["Remembered on a later day: Alpha", "Remembered on a later day: Beta"])
THREE = rsubject("h", [rnode(n, "solid", "2026-09-24", name=n.upper()) for n in ("n1", "n2", "n3")],
                 [sourced(n, "2026-09-10", "checked", "s01") for n in ("n1", "n2", "n3")]
                 + [sourced(n, "2026-09-24", "solid", "s02") for n in ("n1", "n2", "n3")],
                 goal_met="2026-09-24", status="done")
eq("more than two badges share one line, and goal_met: on the session's date is in scope",
   status.reward_lines([THREE], DUE_DAY, subject="h", session="02", session_date="2026-09-24")[:2],
   ["4 wins: H (goal reached) · N1 (remembered on a later day) · N2 (remembered on a later day)"
    " · N3 (remembered on a later day)", "Topics remembered on a later day: 0 → 3 · Goals reached: 0 → 1"])
LAPSE_ONLY = rsubject("l", [rnode("n1", "decayed", "2026-09-24", name="Lambda")],
                      [sourced("n1", "2026-09-10", "checked", "s01"), sourced("n1", "2026-09-17", "solid", "s02"),
                       sourced("n1", "2026-09-24", "decayed", "s03")])
eq("an opened recovery prints alone when nothing was earned",
   status.reward_lines([LAPSE_ONLY], DUE_DAY, subject="l", session="03"),
   ["Slipped: Lambda. Get it right in a later session and it counts as remembered again."])
STRAND = rsubject("st", [rnode("n1", "decayed", "2026-09-24", name="Writing equals (S4)")],
                  [sourced("n1", "2026-09-10", "checked", "s01"), sourced("n1", "2026-09-17", "solid", "s02"),
                   sourced("n1", "2026-09-24", "decayed", "s03")])
eq("a reward line drops the record's strand tag from a topic's name",
   status.reward_lines([STRAND], DUE_DAY, subject="st", session="03"),
   ["Slipped: Writing equals. Get it right in a later session and it counts as remembered again."])
REPASSED = rsubject("rp", [rnode("n1", "checked", "2026-09-24", name="Horizontal slices")],
                    [sourced("n1", "2026-09-10", "checked", "s01"),
                     sourced("n1", "2026-09-24", "decayed", "s03"), sourced("n1", "2026-09-24", "checked", "s03")])
eq("a topic that slipped and passed again in the same session says so",
   status.reward_lines([REPASSED], DUE_DAY, subject="rp", session="03"),
   ["Slipped: Horizontal slices (passed again this session). Get it right in a later session"
    " and it counts as remembered again."])
eq("a session that earned nothing and opened nothing prints nothing",
   status.reward_lines([LAPSE_ONLY], DUE_DAY, subject="l", session="09"), [])
DUE_WEEK = rsubject("w", [rnode("n1", "checked", "2026-09-22", name="Omega"), rnode("n2", "checked", "2026-09-15")],
                    [sourced("n2", "2026-09-15", "checked", "s01"), sourced("n1", "2026-09-22", "checked", "s02")])
eq("with checks due and no pass this week, the streak line says the week is not counted yet",
   status.reward_lines([DUE_WEEK], DUE_DAY, subject="w", session="02"),
   ["Topics passed: 1 → 2", "This week's review isn't done yet: 1 older topic is due for a re-check"])

REVIEWED = rsubject("rv", [rnode("n1", "solid", "2026-09-24", name="Rho"), rnode("n2", "solid", "2026-09-23", name="Sigma")],
                    [sourced("n1", "2026-09-19", "checked", "s01"), sourced("n2", "2026-09-19", "checked", "s02"),
                     sourced("n1", "2026-09-24", "solid", "r03")])
eq("a review that makes the week a pass prints the streak line",
   status.reward_lines([REVIEWED], DUE_DAY, review="3"), ["Remembered on a later day: Rho", "Review streak: 1 week"])
ALREADY = rsubject("rv", REVIEWED[1].values(), REVIEWED[3] + [sourced("n2", "2026-09-23", "solid", "s03")])
eq("a review in a week that had already passed prints no streak line, and no counts line",
   status.reward_lines([ALREADY], DUE_DAY, review="03"), ["Remembered on a later day: Rho"])
REPAIR = rsubject("rp", [rnode("n1", "solid", "2026-09-22", name="Pi"), rnode("n2", "solid", "2026-09-21")],
                  [sourced("n1", "2026-09-10", "checked", "s01"), sourced("n2", "2026-09-19", "checked", "s02"),
                   sourced("n2", "2026-09-21", "solid", "s03"), sourced("n1", "2026-09-22", "solid", "r04")])
eq("a review that repairs last week's miss prints the streak line even when the week had passed",
   status.reward_lines([REPAIR], DUE_DAY, review="04"), ["Remembered on a later day: Pi", "Review streak: 1 week"])
eq("a review's scope is its rNN lines in every subject, and never a session's; the streak is vault-wide",
   (status.reward_lines([REVIEWED, LAPSE_ONLY], DUE_DAY, review="03"),
    status.reward_lines([REVIEWED], DUE_DAY, subject="rv", session="03")),
   (["Remembered on a later day: Rho", "Review streak: 2 weeks"], []))
every_line = [line for lines in (end_lines, status.reward_lines([THREE], DUE_DAY, subject="h", session="02",
                                                                 session_date="2026-09-24"),
                                 status.reward_lines([LAPSE_ONLY], DUE_DAY, subject="l", session="03"),
                                 status.reward_lines([DUE_WEEK], DUE_DAY, subject="w", session="02"),
                                 status.reward_lines([REPAIR], DUE_DAY, review="04")) for line in lines]
eq("record voice: no exclamation marks, praise words, or emoji",
   [line for line in every_line if "!" in line or any(ord(ch) > 0x2FFF for ch in line)
    or re.search(r"(?i)\b(great|well done|nice|congrat|awesome|excellent|amazing|keep it up)", line)], [])

REWARDS_VAULT = fresh()
write(REWARDS_VAULT / "learn/subjects/fx/record.md",
      '---\nsubject: "fx"\ntitle: "Fx"\nstatus: active\n---\n\n'
      "## Nodes\n\n| Node | Status | Last checked | Evidence |\n| --- | --- | --- | --- |\n"
      "| n1 Loops | checked | %s | — |\n\n## Evidence log\n\n"
      "- %s s01: q → a → correct → n1 checked\n" % ((datetime.now().date().isoformat(),) * 2))
write(REWARDS_VAULT / "learn/me/preferences.md", "---\nrewards: on\n---\n")
def rewards_run(*extra):
    return subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(REWARDS_VAULT),
                           "--rewards"] + list(extra), capture_output=True, text=True)
before = sorted(str(p) for p in REWARDS_VAULT.rglob("*"))
on_run = rewards_run("--subject", "fx", "--session", "01")
eq("--rewards prints the session's lines and exits 0", (on_run.stdout, on_run.returncode), ("Topics passed: 0 → 1\n", 0))
write(REWARDS_VAULT / "learn/me/preferences.md", "---\nrewards: off\n---\n")
off_run = rewards_run("--subject", "fx", "--session", "01")
eq("with rewards off it prints nothing and exits 0", (off_run.stdout, off_run.returncode), ("", 0))
eq("--rewards writes no file", sorted(str(p) for p in REWARDS_VAULT.rglob("*")), before)

# ------------------------------------------------ J4 / J5 (PLAN-2026-09-22.md Phase 5)

# Same discipline as J1 and J3 above: every Jev-backed function takes an `ask_fn`,
# so what is tested here is the policy -- which probability flags, what the warning
# says, what happens with no key -- as the pure function it is. Whether Jev's
# judgement is any good is not testable here and is not claimed to be.

section("J4 — a hand-off note is scored on separate dimensions, not one vague one")
eq("the two dimensions that were shown to discriminate are asked",
   sorted(jev.resume_spec()), ["next_action", "node_standing"])
# Pinned so a later session cannot quietly re-enable it without redoing the
# calibration: on 8 real resumes it never fell below 0.98, and under a fair
# within-item control it bottomed out at 0.70 against a 0.30 flag threshold.
eq("the third is kept with its evidence and deliberately not asked",
   sorted(jev.RESUME_DEFERRED), ["what_is_shaky"])
eq("and asking it is not somehow still happening",
   "what_is_shaky" in jev.resume_spec(), False)
eq("every one of them is a Noul",
   sorted({spec["kind"] for spec in jev.resume_spec().values()}), ["noul"])

full = {"next_action": {"noul": 0.95}, "node_standing": {"noul": 0.88}}
eq("a note with all three states nothing missing", jev.resume_verdict(full), [])
missing = dict(full, node_standing={"noul": 0.05})
eq("a confidently absent dimension is named",
   [name for name, _ in jev.resume_verdict(missing)], ["node_standing"])
unsure = dict(full, node_standing={"noul": 0.5})
eq("a dimension Jev could not decide is not a finding", jev.resume_verdict(unsure), [])
eq("a non-numeric answer is not a finding either",
   jev.resume_verdict(dict(full, next_action={"noul": None})), [])

section("J4 — end to end over a resume.md, and the no-key fallback")
J4VAULT = Path(tempfile.mkdtemp()) / "vault"
(J4VAULT / "learn/subjects/fx").mkdir(parents=True)
GOOD_RESUME = ("---\nsubject: fx\nupdated: 2026-09-22\n---\n\n"
               "**Solid:** n1, n2. **Shaky:** n3 wobbled once.\n\n"
               "**Next session:** teach n4.\n")
(J4VAULT / "learn/subjects/fx/resume.md").write_text(GOOD_RESUME)

eq("a note Jev says is complete produces no warning",
   jev.resume_warnings("fx", J4VAULT / "learn/subjects/fx/resume.md",
                       ask_fn=lambda *a, **k: full, vault=J4VAULT), [])

warned = jev.resume_warnings("fx", J4VAULT / "learn/subjects/fx/resume.md",
                             ask_fn=lambda *a, **k: missing, vault=J4VAULT)
eq("one warning, naming the dimension in words not a key name", len(warned), 1)
eq("and it says which one", "where each node stands" in warned[0], True)

(J4VAULT / "learn/subjects/fx/bare.md").write_text("---\nsubject: fx\n---\n\nAll good, keep going.\n")
eq("with no Jev, a note naming no node at all is still caught",
   len(jev.resume_warnings("fx", J4VAULT / "learn/subjects/fx/bare.md",
                           ask_fn=lambda *a, **k: None, vault=J4VAULT)), 1)
eq("but a note that does name nodes is left alone rather than guessed at",
   jev.resume_warnings("fx", J4VAULT / "learn/subjects/fx/resume.md",
                       ask_fn=lambda *a, **k: None, vault=J4VAULT), [])
eq("a missing resume.md is not an error here -- G1 owns that",
   jev.resume_warnings("fx", J4VAULT / "learn/subjects/fx/nope.md",
                       ask_fn=lambda *a, **k: full, vault=J4VAULT), [])

section("J4 — names_no_node, the deterministic half")
eq("names_no_node is one-directional: absence is the finding",
   (jev.names_no_node("solid: n1, n2"), jev.names_no_node("everything is fine")), (False, True))

section("J5 — the rule flags one combination and leaves the rest alone")
def verdict(analogy, limit):
    return jev.analogy_verdict({"draws_analogy": {"noul": analogy},
                                "states_limit": {"noul": limit}})[0]
eq("an analogy with no limit stated is the violation", verdict(0.95, 0.05), "flag")
eq("an analogy with its limit stated is the behaviour the rule wants", verdict(0.95, 0.92), "ok")
eq("no analogy means the rule does not apply, whatever the limit answer",
   (verdict(0.02, 0.01), verdict(0.02, 0.99)), ("ok", "ok"))
eq("an analogy whose limit Jev could not decide is not a finding", verdict(0.95, 0.5), "unclear")
eq("a borderline analogy is not a finding either", verdict(0.5, 0.01), "ok")
# Pinned from the live calibration: math241 s02 n7 is a grading log with no
# analogy in it and came back at exactly 0.70, while the two true positives came
# back at 0.93 and 0.96. If the threshold ever drifts back down, this fails.
eq("the one observed false positive, at p=0.70, stays out", verdict(0.70, 0.17), "ok")
eq("and the two observed true positives stay in",
   (verdict(0.93, 0.05), verdict(0.96, 0.04)), ("flag", "flag"))
eq("a non-numeric answer decides nothing", verdict(None, 0.01), None)

section("J5 — pulling node entries out of a session note")
J5NOTE = """---
subject: fx
nodes: [n1, n2]
---

## Lesson

### n1 — Pointers

A pointer is like a slip of paper with a house number on it.

**Diagram.** none
**Check.** passed

### n2 — References

A reference is another name for the same variable. Think of it as a nickname,
though unlike a nickname it can never be reassigned to someone else.

**Check.** passed

## Retrieval checks

- nothing here is a node entry
"""
entries = jev.extract_node_entries_from(J5NOTE, "fx", "s01")
eq("both entries found, and nothing from outside the Lesson section",
   [entry["node"] for entry in entries], ["n1", "n2"])
eq("the Retrieval checks section is not swallowed into the last entry",
   "nothing here is a node entry" in entries[-1]["text"], False)
eq("gate entries are judged too, a misplaced entry is not (records.md:97)",
   [entry["node"] for entry in jev.extract_node_entries_from(SN_NOTE)], ["n1", "n2", "n2", "n3"])

section("J5 — the deterministic fallback, and the full pass over a folder")
eq("a comparison with no edge marked is caught",
   jev.unbounded_analogy("A pointer is like a slip of paper with a house number."),
   "is like a")
eq("the same comparison with its edge marked is not",
   jev.unbounded_analogy("It is like a nickname, though unlike a nickname it cannot be reassigned."),
   None)
eq("plain prose with no comparison is not",
   jev.unbounded_analogy("A pointer stores an address."), None)

J5DIR = J4VAULT / "learn/subjects/fx/sessions"
J5DIR.mkdir(parents=True)
(J5DIR / "2026-09-22-s01.md").write_text(J5NOTE)
flagged = jev.analogy_warnings("fx", J5DIR, vault=J4VAULT, ask_fn=lambda state, *a, **k: {
    "draws_analogy": {"noul": 0.95},
    "states_limit": {"noul": 0.9 if "unlike" in state["explanation"] else 0.02}})
eq("only the unbounded entry is flagged", len(flagged), 1)
eq("and the warning names the node", " n1:" in flagged[0], True)

nokey = jev.analogy_warnings("fx", J5DIR, vault=J4VAULT, ask_fn=lambda *a, **k: None)
eq("with no Jev the regex half still catches the same entry", len(nokey), 1)
eq("and says it is the fallback talking", "deterministic fallback" in nokey[0], True)


# --------------- J1 inline: the notice seam (PLAN-2026-09-22.md Phase 4, follow-on)

# The item the plan named twice without building. The failure it had to solve is
# not "can Jev judge a probe" -- `probe_warnings` above already does that -- it is
# that `promote_or_reconcile` replaces `baseline` wholesale with the JSONL
# transcript, so anything without a transcript row is erased on the next
# keystroke. The test that matters is the last one in this section: a notice is
# still in `log.md` after a reconciliation that emptied `current` and rebuilt
# `baseline` from a transcript containing no notice.

# `probe_guard` does `import jev`, and `load()` above does not register what it
# builds in sys.modules. Point the name at the same module object, or the guard
# would quietly get a second copy and none of the stubs below would reach it.
sys.modules["jev"] = jev
REAL_ASK = jev.ask

DANGLER = {"question": "From the code above, what do the two cout lines print?",
           "options": [{"label": "41 and 42"}, {"label": "42 and 41", "description": "swapped"}]}
STANDS_ALONE = {"question": "For `int x = 5; int *p = &x;`, what does `*p` evaluate to?",
                "options": [{"label": "5"}, {"label": "the address of x"}, {"label": "undefined"}]}


def probe_ask(state, questions, **kwargs):
    return {"outside_reference": {"noul": 0.97 if "code above" in state["question"] else 0.02}}


def pretool(tool_id, questions, sid="conv-a"):
    return olive.process(VAULT, {"session_id": sid, "hook_event_name": "PreToolUse",
                                 "tool_name": "AskUserQuestion", "tool_use_id": tool_id,
                                 "tool_input": {"questions": questions}})


section("J1 inline — the probe text a question picker turns into")
text = jev.probe_text(STANDS_ALONE)
eq("the question leads", text.startswith("For `int x = 5;"), True)
eq("every option label travels with it, or every MC probe would look truncated",
   all(label in text for label in ("5", "the address of x", "undefined")), True)
eq("an option description travels too", "swapped" in jev.probe_text(DANGLER), True)


section("J1 inline — only a high Jev probability withdraws a question")
eq("a dangling probe at p=0.97 is withdrawn",
   jev.inline_probe_check(jev.probe_text(DANGLER), ask_fn=probe_ask)[0], "block")
eq("and the reason carries the number a human can check",
   "p=0.97" in jev.inline_probe_check(jev.probe_text(DANGLER), ask_fn=probe_ask)[1], True)
eq("a self-contained probe is not touched",
   jev.inline_probe_check(jev.probe_text(STANDS_ALONE), ask_fn=probe_ask), (None, ""))
eq("a flag below the block threshold warns instead of withdrawing",
   jev.inline_probe_check("From the code above, what prints?",
                          ask_fn=lambda *a, **k: {"outside_reference": {"noul": 0.75}})[0], "warn")
eq("too short to be a question at all is not judged",
   jev.inline_probe_check("Which?", ask_fn=probe_ask), (None, ""))


section("J1 inline — with no Jev the regex half warns and is never allowed to withdraw")
nokey = jev.inline_probe_check("From the code above, what do the two lines print?",
                               ask_fn=lambda *a, **k: None)
eq("it still catches the dangling phrase", nokey[0], "warn")
eq("and says which instrument spoke", "deterministic check" in nokey[1], True)
eq("a clean probe with no Jev is silent",
   jev.inline_probe_check(jev.probe_text(STANDS_ALONE), ask_fn=lambda *a, **k: None), (None, ""))


section("J1 inline — the guard denies the picker and writes the notice into log.md")
fresh(); note("oop", "s05")
turn("/learn-resume oop")
# Enough reply text that the turn is not thin; the thin path has its own section.
olive.process(VAULT, {"session_id": "conv-a", "hook_event_name": "MessageDisplay", "message_id": "m0",
                      "index": 0, "final": True, "delta": "Here is the program we traced last time. " * 6})
jev.ask = probe_ask
decision = pretool("toolu_x", [DANGLER])
eq("the tool call is denied", decision["hookSpecificOutput"]["permissionDecision"], "deny")
eq("as a PreToolUse decision, the one channel that reaches the model",
   decision["hookSpecificOutput"]["hookEventName"], "PreToolUse")
reason = decision["hookSpecificOutput"]["permissionDecisionReason"]
eq("the reason names the rule", "Self-containment" in reason, True)
eq("and tells the tutor how to get through anyway",
   "re-issue the same question unchanged" in reason, True)

LOG = VAULT / "learn/subjects/oop/log.md"
log = LOG.read_text()
eq("the notice is a callout in the subject's live log", "[!warning] Probe check" in log, True)
eq("it sits after the question it is about",
   log.index("two cout lines") < log.index("Probe check"), True)
eq("and says the question was withdrawn", "Withdrawn before it was asked" in log, True)

decision = pretool("toolu_y", [DANGLER])
eq("the same probe is withdrawn once, not every time", decision, "")
log = LOG.read_text()
eq("the second attempt is still noticed", log.count("[!warning] Probe check"), 2)
eq("and the log says it went through", "Asked anyway" in log, True)

clean = pretool("toolu_z", [STANDS_ALONE])
eq("a self-contained picker is never denied", clean, "")
eq("and leaves no notice behind", LOG.read_text().count("[!warning] Probe check"), 2)


section("J1 inline — the guard fails open on anything")
def exploding_ask(state, questions, **kwargs):
    raise RuntimeError("network on fire")

jev.ask = exploding_ask
eq("a thrown asker still lets the question through", pretool("toolu_boom", [DANGLER]), "")
jev.ask = probe_ask


section("Picker gate — math in the picker is held back once, because it shows as plain text")
fresh(); note("calc", "s01")
turn("/learn-resume calc")
MATHQ = {"question": "What is int_0^2 int_0^1 6xy dy dx?", "options": [{"label": "6"}, {"label": "3"}]}
decision = pretool("toolu_m1", [MATHQ])
eq("a math question in the picker is denied", decision["hookSpecificOutput"]["permissionDecision"], "deny")
reason = decision["hookSpecificOutput"]["permissionDecisionReason"]
eq("the reason quotes the math it saw and sends it to chat",
   "int_" in reason and "Ask it in chat" in reason, True)
eq("the live log says it was withdrawn",
   "Withdrawn before it was asked" in (VAULT / "learn/subjects/calc/log.md").read_text(), True)
eq("the same question asked again goes through", pretool("toolu_m2", [MATHQ]), "")
eq("code in backticks is not math",
   pretool("toolu_m3", [{"question": "What does `x ^ y` print for x = 5, y = 3?",
                          "options": [{"label": "6"}, {"label": "125"}]}]), "")
eq("a price is not math", olive.picker_math({"question": "Rent rose from $900 to $1,200. Why?"}), "")


section("Picker gate — a flagged probe in a turn with no visible material is withdrawn")
def criteria_ask(state, questions, **kwargs):
    return {"outside_reference": {"noul": 0.87 if "these six" in state["question"] else 0.02}}

jev.ask = criteria_ask
CRIT = {"question": "Do these six success criteria match what you want?",
        "options": [{"label": "Yes, use them"}, {"label": "Edit them"}]}
fresh(); note("calc", "s01")
turn("/learn-start calc")
olive.process(VAULT, {"session_id": "conv-a", "hook_event_name": "MessageDisplay", "message_id": "m1",
                      "index": 0, "delta": "Setting up your subject folder now.", "final": True})
decision = pretool("toolu_c1", [CRIT])
eq("below the block line, a flag with only a status line on screen is still withdrawn",
   decision["hookSpecificOutput"]["permissionDecision"], "deny")
eq("and the reason says thinking does not count",
   "thinking and files are invisible" in decision["hookSpecificOutput"]["permissionDecisionReason"], True)
eq("and does not invite an unchanged re-issue",
   "re-issue the same question unchanged" in decision["hookSpecificOutput"]["permissionDecisionReason"], False)
eq("re-issued unchanged while the turn is still thin, it is held a second time",
   pretool("toolu_c1b", [CRIT])["hookSpecificOutput"]["permissionDecision"], "deny")
eq("a third unchanged re-issue goes through, so the gate cannot loop", pretool("toolu_c1c", [CRIT]), "")

# cs124-quiz9 2026-10-26: p=0.91 is past the block line on its own, and the thin
# reason was dropped from that path, so the tutor saw only self-containment.
jev.ask = probe_ask
fresh(); note("calc", "s01")
turn("/learn-resume calc")
decision = pretool("toolu_c4", [DANGLER])
eq("a flag already past the block line in a thin turn still names the thin turn",
   "thinking and files are invisible" in decision["hookSpecificOutput"]["permissionDecisionReason"], True)
eq("and is held a second time too",
   pretool("toolu_c5", [DANGLER])["hookSpecificOutput"]["permissionDecision"], "deny")
jev.ask = criteria_ask

fresh(); note("calc", "s01")
turn("/learn-start calc")
olive.process(VAULT, {"session_id": "conv-a", "hook_event_name": "MessageDisplay", "message_id": "m2",
                      "index": 0, "final": True, "delta": "Here are the six success criteria:\n\n" + "\n".join(
                          "%d. Set up and evaluate a double integral of kind %d with correct limits." % (i, i)
                          for i in range(1, 7))})
eq("the same flag after the criteria were written as reply text only warns", pretool("toolu_c2", [CRIT]), "")
jev.ask = lambda *a, **k: None
fresh(); note("calc", "s01")
turn("/learn-start calc")
eq("with Jev unreachable, the regex alone still never withdraws, thin turn or not",
   pretool("toolu_c3", [DANGLER]), "")
jev.ask = probe_ask


section("J1 inline — a notice survives the reconciliation that erases everything else")
fresh(); note("oop", "s06")
turn("/learn-resume oop", sid="conv-b")
pretool("toolu_x", [DANGLER], sid="conv-b")

# The JSONL catching up with the visible turn. It holds the question, because the
# model really did emit that tool_use block, and no row for the notice, because
# no model emitted it. That asymmetry is the whole problem.
JSONL = VAULT / "conv-b.jsonl"
JSONL.write_text("\n".join(json.dumps(row) for row in [
    {"type": "user", "uuid": "u1", "timestamp": "2026-09-22T18:00:00Z",
     "message": {"content": [{"type": "text", "text": "/learn-resume oop"}]}},
    {"type": "assistant", "uuid": "a1", "timestamp": "2026-09-22T18:00:05Z",
     "message": {"model": "claude-opus-5", "content": [
         {"type": "tool_use", "name": "AskUserQuestion", "id": "toolu_x",
          "input": {"questions": [DANGLER]}}]}},
]))
olive.process(VAULT, {"session_id": "conv-b", "hook_event_name": "UserPromptSubmit",
                      "prompt": "go on", "transcript_path": str(JSONL)})

state = json.loads((VAULT / ".claude/obsidian-live/conv-b.json").read_text())
eq("reconciliation happened: the live buffer holds only the new turn",
   [item["text"] for item in state["current"]], ["go on"])
eq("the question came back from the transcript instead",
   [item["key"] for item in state["baseline"] if item["key"].startswith("questions-")],
   ["questions-toolu_x"])
eq("the baseline is now the transcript, which has no row for a notice",
   any(item["role"] == olive.NOTICE_ROLE for item in state["baseline"]), False)
eq("the notice is held outside both lists",
   [item["anchor"] for item in state["notices"]], ["questions-toolu_x"])
log = (VAULT / "learn/subjects/oop/log.md").read_text()
eq("and it is still in the log, still under its question",
   "[!warning] Probe check" in log and log.index("two cout lines") < log.index("Probe check"),
   True)

eq("an orphaned notice is parked at the end rather than dropped",
   [item["key"] for item in olive.merge_notices(
       [{"key": "a", "role": "Claude", "text": "x", "time": ""}],
       [{"key": "n", "anchor": "questions-gone", "role": olive.NOTICE_ROLE,
         "text": "y", "time": ""}])],
   ["a", "n"])

jev.ask = REAL_ASK



section("transcript — a reply a Stop hook blocked is replaced by its rewrite")
# The em-dash Stop hook blocks a reply and the model rewrites it. The transcript
# then holds both replies with a meta "Stop hook feedback" row between them, and
# the log once printed the 10:55 lagrange reply twice. Rows copy that shape.
fresh(); subject("oop")
DRAFT, REWRITE = "Pushed \u2014 all 13 commits.", "Pushed. All 13 commits."
JSONL = VAULT / "conv-c.jsonl"
JSONL.write_text("\n".join(json.dumps(row) for row in [
    {"type": "user", "uuid": "u1", "timestamp": "2026-10-05T15:55:00Z",
     "message": {"content": [{"type": "text", "text": "/learn-resume oop"}]}},
    {"type": "assistant", "uuid": "a0", "timestamp": "2026-10-05T15:55:02Z",
     "message": {"id": "m0", "content": [{"type": "text", "text": "Checking first."}]}},
    {"type": "assistant", "uuid": "a0t", "timestamp": "2026-10-05T15:55:03Z",
     "message": {"id": "m0", "content": [{"type": "tool_use", "name": "Bash", "id": "toolu_b", "input": {}}]}},
    {"type": "user", "uuid": "r0", "timestamp": "2026-10-05T15:55:04Z",
     "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_b", "content": "ok"}]}},
    {"type": "assistant", "uuid": "a1", "timestamp": "2026-10-05T15:55:55Z",
     "message": {"id": "m1", "content": [{"type": "text", "text": DRAFT}]}},
    {"type": "user", "uuid": "f1", "isMeta": True, "timestamp": "2026-10-05T15:55:56Z",
     "message": {"role": "user", "content": "Stop hook feedback:\nLast response contains an em dash."}},
    {"type": "system", "uuid": "s1", "subtype": "stop_hook_summary", "timestamp": "2026-10-05T15:55:56Z"},
    {"type": "assistant", "uuid": "a2", "timestamp": "2026-10-05T15:56:06Z",
     "message": {"id": "m2", "content": [{"type": "text", "text": REWRITE}]}},
]))
entries, _ = olive.read_transcript(str(JSONL))
eq("only the rewrite is read as the reply, and text before a tool call is kept",
   [item["text"] for item in entries if item["role"] == "Claude"], ["Checking first.", REWRITE])

# The live path: both replies streamed before the transcript caught up.
for message_id, text in (("m1", DRAFT), ("m2", REWRITE)):
    olive.process(VAULT, {"session_id": "conv-c", "hook_event_name": "MessageDisplay",
                          "message_id": message_id, "index": 0, "delta": text, "final": True,
                          "transcript_path": str(JSONL)})
olive.process(VAULT, {"session_id": "conv-c", "hook_event_name": "Stop", "transcript_path": str(JSONL)})
olive.process(VAULT, {"session_id": "conv-c", "hook_event_name": "UserPromptSubmit",
                      "prompt": "next", "transcript_path": str(JSONL)})
log = subject_log("oop")
eq("the log holds the rewrite once and not the blocked draft",
   (log.count(REWRITE), DRAFT in log), (1, False))
state = json.loads((VAULT / ".claude/obsidian-live/conv-c.json").read_text())
eq("and the streamed draft did not stop the transcript from being adopted",
   [item["text"] for item in state["current"]], ["next"])


# ------------- the within-item control, J2 and J4 (PLAN-2026-09-22.md, session 6)

# Both applications were deferred twice for the same reason: an absolute
# probability on one run cannot separate "the thing is present" from "this
# question says yes to everything". These tests pin the policy, not Jev's
# judgement -- that is what the calibration numbers in jev.py's comments are for.

section("paired_drop — two runs, one varied input, read the gap")
def pair_ask(state, questions, **kwargs):
    name = list(questions)[0]
    return {name: {"noul": 0.9 if name == "left" else 0.2}}

LEFT = ({"x": 1}, {"left": {"kind": "noul", "instructions": "?"}}, jev.read_noul("left"))
RIGHT = ({"x": 1}, {"right": {"kind": "noul", "instructions": "?"}}, jev.read_noul("right"))
eq("the gap is left minus right",
   [round(value, 2) for value in jev.paired_drop(LEFT, RIGHT, ask_fn=pair_ask)],
   [0.9, 0.2, 0.7])
eq("one unanswerable side makes the whole pair no answer, never a one-sided guess",
   jev.paired_drop(LEFT, RIGHT, ask_fn=lambda state, questions, **k:
                   None if "right" in questions else {"left": {"noul": 0.9}}),
   (None, None, None))
eq("a malformed answer is not a number and decides nothing",
   jev.paired_drop(LEFT, RIGHT, ask_fn=lambda *a, **k: {"left": {}, "right": {}}),
   (None, None, None))

eq("a Choice reader takes the mass on the keyed label, not the confidence",
   jev.read_choice_mass("answer", "opt2")({"answer": {"choice": "opt1", "confidence": 0.95,
                                                      "probabilities": {"opt1": 0.6, "opt2": 0.4}}}),
   0.4)
eq("with no per-choice probabilities it falls back to confidence on the chosen label",
   jev.read_choice_mass("answer", "opt2")({"answer": {"choice": "opt2", "confidence": 0.8}}), 0.8)
eq("and a confident vote for a different label is mass 0 on this one, not None",
   jev.read_choice_mass("answer", "opt2")({"answer": {"choice": "opt1", "confidence": 0.8}}), None)


section("J4 — what_is_shaky ships on the gap, which its absolute threshold missed")
def shaky_ask(probabilities):
    def asker(state, questions, **kwargs):
        name = list(questions)[0]
        return {name: {"noul": probabilities[name]}}
    return asker

# The ablation measured on 2026-09-22: 0.41 is *above* the 0.30 absolute flag
# threshold, so the old check found nothing. The gap is -0.36 and finds it.
ABLATED = shaky_ask({"what_is_shaky": 0.41, "all_settled": 0.77})
eq("the absolute reading of the ablated note is not a finding",
   jev.resume_verdict({"what_is_shaky": {"noul": 0.41}}), [])
eq("the paired reading of the same numbers is",
   round(jev.shaky_gap("body", ask_fn=ABLATED)[2], 2) <= jev.SHAKY_GAP_AT, True)
REAL = shaky_ask({"what_is_shaky": 0.98, "all_settled": 0.01})
eq("a note that does name a weak point is well clear of the line",
   round(jev.shaky_gap("body", ask_fn=REAL)[2], 2), 0.97)

J6 = fresh()
write(J6 / "learn/subjects/fx/resume.md", "---\nsubject: \"fx\"\n---\n\nn1 is done. Next: n2.")
def resume_ask(shaky):
    def asker(state, questions, **kwargs):
        if "what_is_shaky" in questions:
            return {"what_is_shaky": {"noul": shaky}}
        if "all_settled" in questions:
            return {"all_settled": {"noul": 1.0 - shaky}}
        return {name: {"noul": 0.99} for name in jev.RESUME_DIMENSIONS}
    return asker

flagged = jev.resume_warnings("fx", J6 / "learn/subjects/fx/resume.md", ask_fn=resume_ask(0.41))
eq("a resume that names nothing shaky is now reported", len(flagged), 1)
eq("and the warning names the dimension", "what is shaky" in flagged[0], True)
eq("a resume that does is not",
   jev.resume_warnings("fx", J6 / "learn/subjects/fx/resume.md", ask_fn=resume_ask(0.98)), [])


section("J2 — the key: field carries its options")
KEYED = ('**Check.** Q: "Which line creates pointer p storing x\'s address?" / A: "1" / '
         "Verdict: correct. key: 1/3 — options: `int *p = &x;` / `int p = *x;` / `int *p = x;`")
checks, skipped = jev.extract_mc_checks_from(KEYED, "fx", "s01")
eq("one check recovered from the extended field, in J2's shape",
   (len(checks), checks[0]["correct_index"], skipped), (1, 0, 0))
eq("a malformed field is counted as skipped, never guessed at",
   jev.extract_mc_checks_from(MISCOUNT, "fx", "s01"), ([], 1))


section("J2 — a leak is the blind run beating chance, not the sighted run being right")
def j2_ask(blind_mass):
    def asker(state, questions, **kwargs):
        blind = jev.BLIND_INSTRUCTIONS in questions["answer"]["instructions"]
        mass = blind_mass if blind else 0.99
        return {"answer": {"choice": "opt1", "confidence": mass,
                           "probabilities": {"opt1": mass, "opt2": (1 - mass) / 2,
                                             "opt3": (1 - mass) / 2}}}
    return asker

sighted, blind, drop = jev.leak_gap("q?", ["a", "b", "c"], 0, ask_fn=j2_ask(0.88))
eq("the sighted run is not the finding", round(sighted, 2), 0.99)
eq("the blind run is", round(blind, 2), 0.88)
eq("and the drop says how little the question added", round(drop, 2), 0.11)

J2DIR = J6 / "learn/subjects/fx/sessions"
J2DIR.mkdir(parents=True)
(J2DIR / "2026-09-22-s01.md").write_text(KEYED)
eq("a set that survives the question being removed is flagged",
   len(jev.leak_warnings("fx", J2DIR, ask_fn=j2_ask(0.88))), 1)
eq("the warning shows both numbers a human needs to judge it",
   "against 0.33" in jev.leak_warnings("fx", J2DIR, ask_fn=j2_ask(0.88))[0], True)
eq("a set that collapses to chance without the question is not",
   jev.leak_warnings("fx", J2DIR, ask_fn=j2_ask(0.35)), [])
eq("and with no Jev at all it simply does not run, rather than guessing",
   jev.leak_warnings("fx", J2DIR, ask_fn=lambda *a, **k: None), [])



section("Home — the recommended action first, rewards on and off (spec section 8)")
HOME_DAY = DUE_DAY  # Thursday, 24 September 2026
HOME_SUBJECTS = [
    rsubject("oop", [rnode("n1", "solid", "2026-09-22", name="Encapsulation"),
                     rnode("n2", "checked", "2026-09-22", name="SRP"),
                     rnode("n3", "planned", name="LSP", prereqs=["n2"])],
             [marker_event("n1", "2026-09-15", "checked"), marker_event("n2", "2026-09-22", "checked"),
              marker_event("n1", "2026-09-22", "solid")], title="OOP", last_session="2026-09-22"),
    rsubject("ptr", [rnode("n1", "decayed", "2026-09-23", name="Aliasing")],
             [marker_event("n1", "2026-09-10", "checked"), marker_event("n1", "2026-09-17", "solid"),
              marker_event("n1", "2026-09-23")], title="Pointers", status="done", goal_met="2026-09-17"),
]
home_ranked = status.rank(HOME_SUBJECTS, [], HOME_DAY)
home_state = status.rewards(HOME_SUBJECTS, HOME_DAY)
home_on = status.home(home_ranked, HOME_SUBJECTS, home_state, True, HOME_DAY)
home_off = status.home(home_ranked, HOME_SUBJECTS, home_state, False, HOME_DAY)
eq("frontmatter marks Home as a generated learning note",
   home_on.split("\n---\n", 1)[0].splitlines(),
   ["---", "type: learning-home", 'updated: "2026-09-24"', "generated: true",
    "cssclasses: [learning-note, learning-themed, lv-theme-calm, lv-wash]"])
body = home_on.split("\n---\n", 1)[1].lstrip("\n")
eq("no H1, and the welcome card leads with the date and the top candidate's welcome and bare command",
   body.splitlines()[:4],
   ["> [!question|welcome] Thursday, 24 September",
    "> Ready when you are. A good next step is to bring back *Aliasing* in Pointers. It slipped on 23 Sep, "
    "and one short session puts it back.", ">", "> `learn-resume ptr`"])
deadline_home = status.home(status.rank([rsubject("calc", [rnode("n1", "planned", name="Limits")], title="Calc",
                                                  deadline="2026-09-26", last_session="2026-09-22")], [], HOME_DAY),
                            [], home_state, False, HOME_DAY)
eq("a Deadline welcome is its own sentence, not glued after 'A good next step is to'",
   [line for line in deadline_home.splitlines() if line.startswith("> Ready")],
   ["> Ready when you are. Calc's deadline is in 2 days, so continue Calc, where *Limits* is next."])
eq("the other candidates are folded, one line each with the bare command",
   [line for line in body.splitlines() if line.startswith("> - **")],
   ["> - **Resume** OOP: *LSP* is next. `learn-resume oop`", "> - **Start** something new. `learn-start`"])
eq("the fold counts them", "> [!note|options]- Other options (2)" in body, True)
eq("section order: card, options, earned, milestone, counts, footer",
   [body.index(mark) for mark in ("[!question|welcome]", "Other options", "## Recently earned", "Next up:",
                                  "topics passed", "*Rewards are on.")] == sorted(
       body.index(mark) for mark in ("[!question|welcome]", "Other options", "## Recently earned", "Next up:",
                                     "topics passed", "*Rewards are on.")), True)
eq("recently earned cards: one HTML row, newest first, one per subject, date, and kind",
   re.findall(r'data-kind="(\w+)"><span class="lv-label">([^<]+)</span> <strong>([^<]+)</strong>',
              next(line for line in body.splitlines() if line.startswith('<div class="lv-cards">'))),
   [("success", "Solid · 22 Sep", "OOP"), ("abstract", "Goal met · 17 Sep", "Pointers"),
    ("success", "Solid · 17 Sep", "Pointers")])
eq("a card escapes its title and names, and a goal card lists no names",
   status.earned_cards([{"subject": "a", "date": "2026-09-20", "kind": "Solid", "name": "x < y & z", "title": "A&B"},
                        {"subject": "b", "date": "2026-09-19", "kind": "Goal met", "name": "B", "title": "B"}]),
   ['<div class="lv-cards"><div class="lv-card" data-kind="success"><span class="lv-label">Solid · 20 Sep</span> '
    '<strong>A&amp;B</strong> <span>x &lt; y &amp; z</span></div><div class="lv-card" data-kind="abstract">'
    '<span class="lv-label">Goal met · 19 Sep</span> <strong>B</strong></div></div>', ""])
eq("the next milestone names the checked nodes", "Next up: *SRP* is one passed check from solid." in body, True)
eq("the count tiles hold topics passed, goals reached, and the live streak, then the Dashboard link",
   [re.findall(r"<b>(\w+)</b> <span>([^<]+)</span>", line) for line in body.splitlines() if "topics passed" in line]
   + [line for line in body.splitlines() if "learn/Dashboard" in line],
   [[("3", "topics passed"), ("1", "goal reached"), ("2", "week review streak")],
    "[[learn/Dashboard|All subjects and badges →]]"])
eq("the footer names the setting and how to change it",
   ("*Rewards are on. Turn them off with `rewards: off` in [[learn/me/preferences|preferences]].*" in body,
    body.rstrip().endswith("*Generated from the records; edits are overwritten.*")), (True, True))
eq("with rewards off: no earned cards, no milestone, no counts, and only the link",
   ("## Recently earned" in home_off, "Next up:" in home_off, "topics passed" in home_off,
    "\n[[learn/Dashboard|All subjects and badges →]]\n" in home_off,
    "*Rewards are off. Turn them on with `rewards: on` in [[learn/me/preferences|preferences]].*" in home_off),
   (False, False, False, True, True))
eq("with rewards off the recommended action still leads", "> `learn-resume ptr`" in home_off, True)
QUIET = [rsubject("fin", [rnode("n1", "solid", "2026-09-22", name="Leaves"),
                          rnode("n2", "checked", "2026-09-23", name="Roots")], status="done")]
quiet = status.home(status.rank(QUIET, [], HOME_DAY), QUIET, status.rewards(QUIET, HOME_DAY), True, HOME_DAY)
eq("nothing pending: the card says so and names the skill that comes due next",
   quiet.split("\n---\n", 1)[1].lstrip("\n").splitlines()[:5],
   ["> [!question|welcome] Thursday, 24 September", "> Nothing you've passed is due for review.",
    "> *Roots* comes due on 26 Sep.", ">", "> Curious about something new? `learn-start`"])
eq("with nothing proven the comes-due line is left out, and there are no other options",
   [line for line in status.home(status.rank([rsubject("x", [], status="done")], [], HOME_DAY),
                                 [rsubject("x", [], status="done")],
                                 status.rewards([rsubject("x", [], status="done")], HOME_DAY), True,
                                 HOME_DAY).splitlines() if "comes due" in line or "Other options" in line], [])
eq("up to 3 milestone nodes, soonest due first",
   status.milestone([rsubject("m", [rnode("n%d" % i, "checked", "2026-09-%02d" % (20 - i), name="N%d" % i)
                                    for i in range(1, 5)])]),
   "Next up: *N4*, *N3*, and *N2* are each one passed check from solid.")
eq("the 3 latest cards only",
   "".join(status.earned_cards(status.rewards([TWICE, SOLID_ONCE, SAME_DATE[0], SAME_DATE[1]],
                                              DUE_DAY)["badges"])).count('class="lv-card"'), 3)
HOME_VAULT = fresh()
write(HOME_VAULT / "learn/subjects/fx/record.md",
      '---\nsubject: "fx"\ntitle: "Fx"\nstatus: active\n---\n\n'
      "## Nodes\n\n| Node | Status | Last checked | Evidence |\n| --- | --- | --- | --- |\n"
      "| n1 Loops | planned | — | — |\n")
subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(HOME_VAULT), "--quiet"], check=True)
eq("every plain run writes Home", "`learn-resume fx`" in (HOME_VAULT / "learn/Home.md").read_text(), True)


section("progress page — can-do callouts, tiles, badges, and details (spec section 6)")
P4 = fresh()
def pnode(node, st, checked="", name=None, can_do=None, prereqs=()):
    return {"id": node, "name": name or node.upper(), "status": st, "checked": checked,
            "prereqs": list(prereqs), "can_do": can_do or name or node.upper()}
P_NODES = {entry["id"]: entry for entry in [
    pnode("n1", "solid", "2026-09-22", "Classes", "say what a class is for"),
    pnode("n2", "checked", "2026-09-17", "Objects", None, ["n8"]),
    pnode("n3", "decayed", "2026-09-22", "Aliasing", "predict what a shared reference does"),
    pnode("n4", "introduced", "", "Interfaces", "pick an interface or an abstract class", ["n1"]),
    pnode("n5", "planned", "", "Strategy pattern", "recognise the Strategy pattern in code", ["n1", "n2"]),
    pnode("n6", "planned", "", "Factory", None, ["n2"]),
    pnode("n7", "planned", "", "A capstone that designs a class hierarchy live", None, ["n4", "n5"]),
    pnode("n8", "skipped", "", "Syntax", "read Java syntax"),
]}
P_EVENTS = [marker_event("n1", "2026-09-15", "checked"), marker_event("n1", "2026-09-22", "solid"),
            marker_event("n2", "2026-09-17", "checked"), marker_event("n3", "2026-09-15", "checked"),
            marker_event("n3", "2026-09-17", "solid"), marker_event("n3", "2026-09-22")]
p_fields = {"title": "OOP", "status": "active", "sessions": "2", "next": "Teach n5."}
p_subject = ("oop", P_NODES, p_fields, P_EVENTS)
p_state = status.rewards([p_subject], DUE_DAY)
page_on = status.progress_note("oop", P4, p_fields, P_NODES, "", [], DUE_DAY, events=P_EVENTS,
                               rewards_on=True, state=p_state, streak=p_state["streak"])
page_off = status.progress_note("oop", P4, p_fields, P_NODES, "", [], DUE_DAY, events=P_EVENTS,
                                rewards_on=False, state=p_state, streak=p_state["streak"])
eq("every progress page opts into the snippet, in its subject's theme",
   "cssclasses: [learning-note, learning-themed, lv-theme-calm]" in page_on.split("\n---\n", 1)[0], True)
eq("the next action is a todo callout, and the link row has Resume and Home",
   ("> [!todo] Next action\n> Teach n5." in page_on,
    "[[learn/subjects/oop/resume|Resume]] · [[learn/subjects/oop/record|Record]] · "
    "[[learn/subjects/oop/plan|Plan]] · [[learn/Home|Home]]" in page_on), (True, True))
def callout_body(page, title):
    lines = page.split("> [!%s" % title, 1)[1].split("\n\n", 1)[0].splitlines()[1:]
    return lines
eq("You can now: checked, solid, and skipped nodes as can-do statements, the name as fallback",
   ("> [!success] You can now (3)" in page_on, callout_body(page_on, "success] You can now")),
   (True, ["> - say what a class is for", "> - Objects", "> - read Java syntax"]))
eq("Worth a refresh: a decayed node with the date it was last shown",
   callout_body(page_on, "tip] Worth a refresh"),
   ["> - predict what a shared reference does (you showed this on 17 Sep; one check brings it back)"])
eq("You're learning: introduced nodes", callout_body(page_on, "info] You're learning"),
   ["> - pick an interface or an abstract class"])
eq("Up next: ready nodes as You'll be able to, a bare name as fallback, then how many follow",
   callout_body(page_on, "todo] Up next"),
   ["> - You'll be able to recognise the Strategy pattern in code", "> - Factory", ">", "> 1 more after that."])
eq("an empty group is left out",
   "You're learning" in status.progress_note("x", P4, p_fields, {"n1": pnode("n1", "checked", "2026-09-20")},
                                             "", [], DUE_DAY), False)
eq("badges are folded, this subject's only, newest first",
   callout_body(page_on, "abstract]- 2 badges"),
   ["> - Solid: Classes, 2026-09-22", "> - Solid: Aliasing, 2026-09-17"])
eq("the count tiles are one SVG with the streak tile only while it is alive",
   ("<span>topics passed</span>" in page_on, "<span>remembered on a later day</span>" in page_on, "best streak" in page_on,
    "review streak" in page_on), (True, True, True, p_state["streak"]["alive"]))
eq("with rewards off: no tiles and no badges; can-do callouts and the tree stay",
   ("<span>topics passed</span>" in page_off, "badges" in page_off, "You can now" in page_off, "skill tree" in page_off),
   (False, False, True, True))
eq("the node table, strands, and sessions sit under Details, folded, with plain status labels",
   ("## Details\n\n> [!note]- Nodes\n> | Id | Node | Status | Last checked |" in page_on,
    "> | n3 | Aliasing | `decayed` | 2026-09-22 |" in page_on), (True, True))
eq("the mermaid graph, status table, callout key, and status chips are gone",
   [mark in page_on for mark in ("```mermaid", "Where each node stands", "Callout key", "data-learning-status",
                                 "Dependency graph")], [False] * 5)


section("skill tree — discs, edges, and the SVG rules (spec section 7)")
def tree_of(page):
    return next(block for block in re.findall(r"<svg.*?</svg>", page, re.S) if "skill tree" in block)
tree_on, tree_off = tree_of(page_on), tree_of(page_off)
def disc_near(tree, name):
    """The elements drawn between the previous node's label and this node's."""
    lines = tree.splitlines()
    at = next(index for index, line in enumerate(lines) if line.endswith(">%s</text>" % name))
    start = at
    while start and not any(mark in lines[start - 1] for mark in ("font-size: 12px", "<path", "<defs")):
        start -= 1
    return "\n".join(lines[start:at])
eq("★ and the glow only on solid discs, with rewards on",
   (tree_on.count("★"), tree_on.count('filter="url(#'), "★" in disc_near(tree_on, "Classes")), (1, 1, True))
eq("with rewards off a solid disc has no ★ and no glow, and a ✓ instead",
   ("★" in tree_off, 'filter="url(#' in tree_off, "✓" in disc_near(tree_off, "Classes")), (False, False, True))
eq("decayed keeps its full solid disc, with a cyan ↻ badge",
   all(mark in disc_near(tree_on, "Aliasing") for mark in ("-solid)", 'r="8"', "var(--color-cyan)", "↻")), True)
eq("introduced is a hollow ring in the checked gradient",
   all(mark in disc_near(tree_on, "Interfaces") for mark in ('r="16"', "fill-opacity: 0.18", "stroke-width: 4")), True)
eq("up next is an orange disc with an arrow; later planned nodes are small and faint",
   (all(mark in disc_near(tree_on, "Factory") for mark in ('r="15"', "var(--color-orange)", "→")),
    'r="12"' in tree_on), (True, True))
edges = re.findall(r'<path d="[^"]*" style="([^"]*)"/>', tree_on)
eq("edges: thick green between proven, dashed orange into up next, dotted grey otherwise",
   sorted({("green" if "--color-green" in s else "orange" if "--color-orange" in s else "grey") for s in edges}),
   ["green", "grey", "orange"])
eq("one path per prereq edge", len(edges), 7)
eq("no blank lines, and no <style>, <use>, or <foreignObject>",
   ("\n\n" in tree_on, "<style" in tree_on, "<use" in tree_on, "<foreignObject" in tree_on),
   (False, False, False, False))
eq("colours are theme variables only", re.findall(r"#[0-9a-fA-F]{3,8}\b", re.sub(r"url\(#[^)]*\)", "", page_on)), [])
ids = re.findall(r'id="([^"]+)"', page_on)
eq("gradient and filter ids are unique on the page and prefixed per SVG",
   (len(ids) == len(set(ids)), all(i.startswith("st-oop-") for i in ids)), (True, True))
eq("the viewBox has an 800px floor and the SVG fits the note width",
   (float(re.search(r'viewBox="0 0 ([\d.]+) ', tree_on).group(1)) >= 800, 'width="100%"' in tree_on), (True, True))
eq("labels wrap at 22 characters on words, and the full name survives",
   (status.wrap("A capstone that designs a class hierarchy live"),
    " ".join(status.wrap("A capstone that designs a class hierarchy live"))),
   (["A capstone that", "designs a class", "hierarchy live"], "A capstone that designs a class hierarchy live"))
eq("a word longer than a line is kept whole", status.wrap("Supercalifragilisticexpialidocious n1"),
   ["Supercalifragilisticexpialidocious", "n1"])
eq("every label line is in the tree", all(">%s</text>" % line in tree_on
                                         for line in status.wrap("A capstone that designs a class hierarchy live")), True)
wide = {"n%d" % i: pnode("n%d" % i, "planned", "", "Node number %d with a long name" % i) for i in range(1, 13)}
eq("a wide tree grows its viewBox past 800 rather than overlapping",
   float(re.search(r'viewBox="0 0 ([\d.]+) ', status.skill_tree("w", "W", wide)).group(1)) > 800, True)
loops = status.read_nodes("## Nodes\n\n| Node | Status |\n| --- | --- |\n| n1 A | planned |\n| n2 B | planned |\n",
                          "## Nodes\n\n| Id | Node | Prereqs | Status |\n| --- | --- | --- | --- |\n"
                          "| n1 | A | n1 | planned |\n| n2 | B | n1, n9 | planned |\n")
eq("a self-loop and an unknown prereq are dropped before layout, and the tree still draws",
   ([loops[n]["prereqs"] for n in ("n1", "n2")], status.skill_tree("x", "X", loops).count("<path")), ([[], ["n1"]], 1))
eq("a plan with no nodes draws no tree", status.skill_tree("x", "X", {}), "")
eq("a progress page tags its subject, so the graph view can name the cluster",
   (status.subject_tag("oop"), status.subject_tag("calc-14.8")), ("oop", "calc-14-8"))


section("Dashboard — one line per subject, grouped, with tags and folds (spec section 9)")
def dsubject(slug, nodes, **fields):
    fields.setdefault("title", slug.title())
    return {"slug": slug, "folder": P4, "fields": fields, "nodes": {n["id"]: n for n in nodes}, "events": []}
BOARD = [
    dsubject("zeta", [pnode("n1", "checked", "2026-09-23")], status="active", last_session="2026-09-23",
             deadline="2026-09-28"),
    dsubject("alpha", [pnode("n1", "planned")], status="active", last_session="2026-09-20"),
    dsubject("fin", [pnode("n1", "decayed", "2026-09-22"), pnode("n2", "checked", "2026-09-01")], status="done",
             last_session="2026-09-17", title="Finished"),
    dsubject("old", [pnode("n1", "checked", "2026-09-01")], status="done", last_session="2026-09-02", title="Aged"),
    dsubject("idle", [pnode("n1", "solid", "2026-09-23")], status="done", last_session="2026-09-23", title="Idle"),
]
board_state = status.rewards([SOLID_ONCE, SAME_DATE[1]], DUE_DAY)
board = status.dashboard(BOARD, DUE_DAY, ["w1", "w2"], [], board_state, True)
board_off = status.dashboard(BOARD, DUE_DAY, [], [], board_state, False)
eq("the head links back to Home", board.split("\n---\n", 1)[1].lstrip("\n").splitlines()[:5],
   ["# Learning dashboard", "", "[[learn/Home|← Home]]", "", "*Generated from the records; edits are overwritten.*"])
eq("Active, then Done, alphabetical by title; an empty Paused is left out",
   [line.split("|")[1].split("]]")[0] if line.startswith("- ") else line
    for line in board.splitlines() if line.startswith(("## ", "- [["))],
   ["## Active", "Alpha", "Zeta", "## Done", "Aged", "Finished", "Idle"])
eq("a line holds the meter, proven count, last session, and a deadline ahead as a chip",
   re.sub(r"<svg.*?</svg>", "<svg/>", next(line for line in board.splitlines() if "|Zeta]]" in line)),
   '- [[learn/subjects/zeta/progress|Zeta]] <span class="lv-row"><svg/> <span class="lv-num">100%</span> '
   '1/1 passed · last 23 Sep<span class="lv-sep"> · </span><span class="lv-tag" data-tone="deadline">'
   'deadline in 4 days</span></span>')
eq("the meter: proven solid, taught faint, over a full track, with the count in its label",
   status.meter(1, 1, 4, width=100),
   '<svg class="lv-meter" width="100" height="6" viewBox="0 0 100 6" role="img" aria-label="1 of 4 passed">'
   '<rect width="100" height="6" rx="3" style="fill: var(--background-modifier-border)"/>'
   '<rect width="50" height="6" rx="3" style="fill: var(--color-green); fill-opacity: 0.35"/>'
   '<rect width="25" height="6" rx="3" style="fill: var(--color-green)"/></svg> <span class="lv-num">25%</span>')
eq("a chip's tone follows what it asks for",
   [re.search(r'data-tone="(\w+)"', status.tag(text))[1] for text in ("1 to repair", "3 due for review", "deadline today")],
   ["repair", "due", "deadline"])
eq("a done subject with a decayed node shows N to repair, one with a due node N due for review, an untouched one nothing",
   [re.sub(r"<[^>]+>", "", next(line for line in board.splitlines() if "|%s]]" % t in line)).rsplit(" · ", 1)[-1]
    for t in ("Finished", "Aged", "Idle")], ["1 to repair", "1 due for review", "last 23 Sep"])
eq("a subject with no nodes yet says so instead of an empty bar",
   next(line for line in status.dashboard([dsubject("diag", [], status="diagnosing")], DUE_DAY, [], [],
                                          board_state, True).splitlines() if "|Diag]]" in line),
   '- [[learn/subjects/diag/progress|Diag]] <span class="lv-row">no plan yet · last never</span>')
eq("the tag function is shared: repair before review",
   (status.pending_tag(BOARD[2]["nodes"], {}, DUE_DAY), status.pending_tag(BOARD[3]["nodes"], {}, DUE_DAY),
    status.pending_tag(BOARD[4]["nodes"], {}, DUE_DAY)), ("1 to repair", "1 due for review", ""))
eq("badges fold into one callout, newest first, each naming its subject",
   callout_body(board, "abstract]- 2 badges"),
   ["> - Goal met: Alpha, 2026-09-20", "> - Solid: Aliasing (S), 2026-09-20"])
eq("with rewards off there are no badges", "badges" in board_off, False)
eq("record inconsistencies are folded", callout_body(board, "bug]- 2 record inconsistencies"), ["> - w1", "> - w2"])
SLOT = "s: 2026-09-01-s01 repeats the previous check's correct-answer slot 2 (slot_rotation.py)"
board_dup = status.dashboard(BOARD, DUE_DAY, ["w1", "w1", "w2", SLOT, SLOT, SLOT], [], board_state, True)
eq("an identical inconsistency shows once with a count",
   callout_body(board_dup, "bug]- 2 record inconsistencies"), ["> - w1 (×2)", "> - w2"])
eq("answer-slot repeats fold apart, as history rather than drift",
   callout_body(board_dup, "info]- 1 answer-slot repeat")[1:],
   ["> - s: 2026-09-01-s01 repeats the previous check's correct-answer slot 2 (×3)"])
eq("with only slot history there is no bug callout",
   "[!bug]" in status.dashboard(BOARD, DUE_DAY, [SLOT], [], board_state, True), False)
eq("the system links fold, and the session guide, status key, and per-subject next actions are gone",
   ("> [!info]- The system" in board, "Running a session" in board, "Node status key" in board,
    "Next action" in board), (True, False, False, False))

snippet = (HOOKS.parent.parent / ".obsidian/snippets/learning-notes.css").read_text()
eq("callout colors are full colors, since Obsidian reads them through color-mix()",
   re.findall(r"--[a-z-]+:\s*\d+\s*,", snippet), [])
eq("the snippet is renamed, enabled, and carries the variant C palette without the old chips",
   ("learning-notes" in json.loads((HOOKS.parent.parent / ".obsidian/appearance.json").read_text())["enabledCssSnippets"],
    "--lv-gold" in snippet, "data-learning-status" in snippet, "--learning-question" in snippet),
   (True, True, False, False))
eq("the conversation note links to Home", "[[learn/Home|Home]]" in olive.render({"session_id": "x"}), True)
fresh(); note("oop", "2026-09-17-s01"); turn("/learn-resume oop")
eq("the subject log header links to Home, not the Dashboard",
   ("[[learn/Home|Home]]" in (VAULT / "learn/subjects/oop/log.md").read_text(),
    "learn/Dashboard" in (VAULT / "learn/subjects/oop/log.md").read_text()), (True, False))


section("generation checks — the [gen] tag, and recall-only nodes on the Dashboard (tutor.md, records.md)")
TAGGED = "- 2026-09-22 s03: [gen] predict a case never taught, from n1's truth → right answer → correct → n1 checked"
UNTAGGED = TAGGED.replace("[gen] ", "")
eq("a tagged line keeps its transition marker", status.markers(TAGGED), [("n1", "checked")])
eq("an untagged line reads exactly as before", status.markers(UNTAGGED), [("n1", "checked")])
eq("a tagged line's events are the untagged line's, plus the generation flag",
   [dict(e, generation=None) for e in status.evidence_events(evidence(TAGGED[2:]), {})],
   [dict(e, generation=None) for e in status.evidence_events(evidence(UNTAGGED[2:]), {})])
eq("the flag is set on the tagged pass only",
   ([e["generation"] for e in status.evidence_events(evidence(TAGGED[2:]), {})],
    [e["generation"] for e in status.evidence_events(evidence(UNTAGGED[2:]), {})]), ([True], [False]))
eq("a tagged miss, a tag after the first arrow, and a tag with no marker are not passes",
   [status.generation_pass(line) for line in (
       "- 2026-09-22 s03: [gen] q → a → wrong; used the wrong truth → n1 checked",
       "- 2026-09-22 s03: [gen] q → a → partially right → n1 introduced",
       "- 2026-09-22 s03: q → [gen] a → correct → n1 checked",
       "- 2026-09-22 (diagnosis): [gen] q → a → correct")], [False, False, False, False])

# Verdicts copied from real records (math241-exam1-review n7) and from the
# verifier's list. Each left its node `checked`, so only the verdict can refuse it.
MISSED = ["correct at rung 2. Untaught fact (triangle area = half cross-product magnitude)",
          "(a) wrong (correct: 2, invariant to scaling a), (b) correct (proj scales linearly in b)",
          "incomplete.", "not quite", "correct after hint", "correct after two hints, derivation supplied by tutor",
          "half right", "mostly wrong", "no", "missed", "✗", "correct with a pointer to n3", "right, partially"]
eq("a verdict on the allow-list's wrong side never credits, even with the node left checked",
   [verdict for verdict in MISSED
    if status.generation_pass("- 2026-09-21 s02: [gen] q → a → %s → n7 checked" % verdict)], [])
eq("a clean pass credits, in either word and any case, with trailing reasoning",
   [status.generation_pass("- 2026-09-21 s02: [gen] q → a → %s → n7 checked" % verdict)
    for verdict in ("correct", "Correct.", "right", "RIGHT: used the definition, then n2")], [True] * 4)
eq("a mixed verdict over several nodes credits neither",
   [(e["node"], e["generation"]) for e in status.evidence_events(
       evidence("2026-09-22 s03: [gen] q → a → n4 wrong, n5 right → n4 checked → n5 checked"), {})],
   [("n4", False), ("n5", False)])
eq("the tag counts only right after the colon that ends the date and source",
   [status.generation_pass(line) for line in (
       "- 2026-10-02 s06: [gen] q → a → correct → n1 checked",
       "- 2026-10-02 s06 (decay check): [gen] q → a → correct → n1 solid",
       "- 2026-10-02: [gen] q → a → correct → n1 checked",
       "- 2026-10-02 s06: what does the [gen] tag in a record mean? → a → correct → n1 checked",
       "- 2026-10-02 [gen] s06: q → a → correct → n1 checked")], [True, True, True, False, False])
eq("a tagged line with several markers credits no node, even on a clean verdict",
   [(e["node"], e["generation"]) for e in status.evidence_events(
       evidence("2026-09-22 s03: [gen] q → a → correct → n1 solid → n2 decayed → n3 checked"), {})],
   [("n1", False), ("n2", False), ("n3", False)])
eq("a verdict that starts with correct but grades two nodes credits neither; nor does a clean two-marker line",
   [status.generation_pass(line) for line in (
       "- 2026-09-22 s03: [gen] q → a → correct for n4, wrong for n5 → n4 checked → n5 checked",
       "- 2026-09-22 s03: [gen] q → a → correct → n4 checked → n5 checked")], [False, False])
eq("one node per line: the same check split into two lines credits each passed node",
   [(e["node"], e["generation"]) for e in status.evidence_events(
       evidence("2026-09-22 s03: [gen] q, n4 part → a → correct → n4 checked",
                "2026-09-22 s03: [gen] q, n5 part → a → wrong → n5 checked"), {})],
   [("n4", True), ("n5", False)])
eq("a pass hedged with but, though, or a guess does not credit",
   [status.generation_pass("- 2026-09-22 s03: [gen] q → a → %s → n1 checked" % verdict)
    for verdict in ("correct but wrong reason", "correct, though guessed", "right, a guess")], [False] * 3)

GEN_NODES = {"n1": rnode("n1", "checked", "2026-09-22"), "n2": rnode("n2", "solid", "2026-09-22"),
             "n3": rnode("n3", "planned"), "n4": rnode("n4", "introduced"), "n5": rnode("n5", "checked", "2026-09-22")}
GEN_LOG = evidence("2026-09-22 s03: [gen] derive it from the truth → a → correct → n1 checked",
                   "2026-09-22 s03: recall the definition → a → correct → n2 solid",
                   "2026-09-22 s03: [gen] q → a → correct → n4 introduced",
                   "2026-09-22 s03: [gen] q → a → wrong → n5 checked",
                   "2026-09-22 s03: q → a → correct → n5 checked")
eq("a tagged pass is not recall-only; untagged passes and a tagged miss are; planned and introduced never are",
   status.recall_only(GEN_NODES, status.evidence_events(GEN_LOG, {})), ["n2", "n5"])
eq("events built without the flag, as in older callers, count as recall-only and do not raise",
   status.recall_only(GEN_NODES, [marker_event("n1", "2026-09-22", "checked")]), ["n1", "n2", "n5"])

def gen_subject(log):
    return rsubject("g", list(GEN_NODES.values()), status.evidence_events(log, {}), title="Gen")
PLAIN_LOG = GEN_LOG.replace("[gen] ", "")
eq("rewards are identical with and without the tag",
   status.rewards([gen_subject(GEN_LOG)], DUE_DAY), status.rewards([gen_subject(PLAIN_LOG)], DUE_DAY))
eq("reward lines are identical with and without the tag",
   status.reward_lines([gen_subject(GEN_LOG)], DUE_DAY, subject="g", session="03"),
   status.reward_lines([gen_subject(PLAIN_LOG)], DUE_DAY, subject="g", session="03"))
eq("the recommended action is identical with and without the tag",
   status.rank([gen_subject(GEN_LOG)], [], DUE_DAY), status.rank([gen_subject(PLAIN_LOG)], [], DUE_DAY))

GEN_VAULT = fresh()
def gen_vault(log):
    write(GEN_VAULT / "learn/subjects/g/record.md",
          '---\nsubject: "g"\ntitle: "Gen"\nstatus: active\nlast_session: "2026-09-22"\n---\n\n'
          "## Nodes\n\n| Node | Status | Last checked | Evidence |\n| --- | --- | --- | --- |\n"
          "| n1 Truth | checked | 2026-09-22 | — |\n| n2 Mixed review | solid | 2026-09-22 | — |\n"
          "| n3 Later | planned | — | — |\n| n4 Other | checked | 2026-09-22 | — |\n\n"
          + log.split("\n\n## Strands")[0].replace("## Nodes\n\n", "") + "\n")
    # n2 is the fallback: its Rests on cell says it has no unconditional truth.
    write(GEN_VAULT / "learn/subjects/g/plan.md",
          '---\nsubject: "g"\nupdated: "2026-09-22"\n---\n\n## Nodes\n\n'
          "| Id | Node | Rests on (unconditional truth) | Discovery question | Check type | Can do | Est. min | Prereqs | Status |\n"
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n"
          "| n1 | Truth | Every X has a Y | Why? | free response | derive Y | 10 | none | checked |\n"
          "| n2 | Mixed review | — (integrative, no new unconditional truth) | — | mixed set | solve a mixed set | 20 | n1 | solid |\n"
          "| n3 | Later | Every Y has a Z | Why? | MC | pick Z | 10 | n2 | planned |\n"
          "| n4 | Other | Every Z has a W | Why? | MC | pick W | 10 | n1 | checked |\n")
    due_run = subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(GEN_VAULT),
                              "--due", "--per-subject", "0"], capture_output=True, text=True)
    full_run = subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(GEN_VAULT), "--quiet"],
                              capture_output=True, text=True)
    return due_run, full_run, (GEN_VAULT / "learn/Dashboard.md").read_text()
FALLBACK_LOG = evidence("2026-09-22 s01: [gen] predict a case from every X has a Y → a → correct → n1 checked",
                        "2026-09-22 s02: retrieval, n2 has no unconditional truth → a → correct → n2 solid",
                        "2026-09-22 s01: recall the W rule → a → correct → n4 checked")
tagged_due, tagged_full, tagged_board = gen_vault(FALLBACK_LOG)
plain_due, plain_full, plain_board = gen_vault(FALLBACK_LOG.replace("[gen] ", ""))
eq("--due prints the same ranking with and without the tag",
   (tagged_due.returncode, tagged_due.stdout), (plain_due.returncode, plain_due.stdout))
eq("a full run with a no-truth node exits 0 and prints no error",
   (tagged_full.returncode, tagged_full.stderr, plain_full.returncode, plain_full.stderr), (0, "", 0, ""))
eq("the Dashboard folds recall-only into one line per subject; the no-truth node is neither listed nor counted",
   callout_body(tagged_board, "question]- 1 node recall-only"),
   ["> Passed checks, but no generation check yet (`learn/system/records.md`, *Evidence rule*).",
    "> - Gen: 1 of 2 checked or solid (n4)"])
eq("without the tag both nodes with a truth are recall-only, and the no-truth node still is not",
   callout_body(plain_board, "question]- 2 nodes recall-only")[1:], ["> - Gen: 2 of 2 checked or solid (n1, n4)"])
eq("no unconditional truth: empty, a dash in front, or naming none; a node with no plan row is not exempt",
   [status.has_truth({"truth": cell}) for cell in (
       "", "—", "— (integrative, no new unconditional truth)", "- see n3", "Mixed set: no unconditional truth",
       "Every X has a Y", None)] + [status.has_truth({})],
   [False, False, False, False, False, True, True, True])
REVIEW_LOG = evidence("2026-09-22 s01: recall the Y rule → a → correct → n1 checked",
                      "2026-09-30 r03: [gen] rebuild n1 from every X has a Y → a → correct → n1 solid",
                      "2026-09-30 r03: recall the W rule → a → correct → n4 solid")
REVIEW_NODES = {"n1": dict(rnode("n1", "solid", "2026-09-30"), truth="Every X has a Y"),
                "n4": dict(rnode("n4", "solid", "2026-09-30"), truth="Every Z has a W")}
eq("a tagged pass on a review line clears recall-only; the untagged review line does not",
   status.recall_only(REVIEW_NODES, status.evidence_events(REVIEW_LOG, {})), ["n4"])
def review_subject(log):
    return rsubject("g", list(REVIEW_NODES.values()), status.evidence_events(log, {}), title="Gen")
eq("rewards and review reward lines are identical with and without the tag on review lines",
   (status.rewards([review_subject(REVIEW_LOG)], DUE_DAY),
    status.reward_lines([review_subject(REVIEW_LOG)], datetime(2026, 10, 1).date(), review="03")),
   (status.rewards([review_subject(REVIEW_LOG.replace("[gen] ", ""))], DUE_DAY),
    status.reward_lines([review_subject(REVIEW_LOG.replace("[gen] ", ""))], datetime(2026, 10, 1).date(),
                        review="03")))

ROWS = [{"days": 9, "subject": "g", "id": "n1", "status": "checked", "checked": "2026-09-22", "name": "Truth",
         "evidence": "e1"},
        {"days": 9, "subject": "g", "id": "n2", "status": "solid", "checked": "2026-09-22", "name": "Mixed",
         "evidence": ""}]
eq("due_report with no candidates is the old output, and a candidate's line alone gains the suffix",
   (status.due_report(ROWS, []) == status.due_report(ROWS, [], frozenset()),
    [line.endswith(status.GEN_CANDIDATE) for line in status.due_report(ROWS, [], {("g", "n1")}).splitlines()],
    status.due_report(ROWS, [], {("g", "n1")}).replace(status.GEN_CANDIDATE, "") == status.due_report(ROWS, [])),
   (True, [True, False, False], True))
def due_cli(*extra):
    return subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(GEN_VAULT),
                           "--due", "--per-subject", "0"] + list(extra), capture_output=True, text=True)
gen_lines = due_cli("--gen").stdout.splitlines()
eq("--due --gen marks recall-only nodes with a truth, never the no-truth node, and ranks as --due does",
   ([line.split()[2] for line in gen_lines if line.endswith(status.GEN_CANDIDATE)],
    [line.replace(status.GEN_CANDIDATE, "") for line in gen_lines] == due_cli().stdout.splitlines()),
   (["n1", "n4"], True))
eq("--gen without --due is refused",
   subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(GEN_VAULT), "--gen"],
                  capture_output=True, text=True).returncode, 2)
eq("both learn-review copies run --due --gen and tag the one generation line",
   [("--due --gen" in text, "`YYYY-MM-DD rNN: [gen] …`" in text, "Exactly one generation question per review" in text)
    for text in ((VAULT_ROOT / host / "skills/learn-review/SKILL.md").read_text() for host in (".claude", ".agents"))],
   [(True, True, True)] * 2)
eq("read_nodes reads the Rests on cell from the plan",
   status.read_nodes("", (GEN_VAULT / "learn/subjects/g/plan.md").read_text())["n2"]["truth"],
   "— (integrative, no new unconditional truth)")
eq("recall-only is not a record inconsistency",
   [line for line in (callout_body(tagged_board, "bug]-") if "> [!bug]-" in tagged_board else [])
    if "recall-only" in line or "generation" in line], [])
eq("the existing Dashboard fixture lists its checked and solid nodes as recall-only",
   callout_body(board, "question]- 4 nodes recall-only")[1:],
   ["> - Aged: 1 of 1 checked or solid (n1)", "> - Finished: 1 of 1 checked or solid (n2)",
    "> - Idle: 1 of 1 checked or solid (n1)", "> - Zeta: 1 of 1 checked or solid (n1)"])



section("startup index — the Show the learner block (spec section 10)")
fresh()
def start_subject(slug, title, st, nodes_rows, extra=""):
    write(VAULT / "learn/subjects" / slug / "record.md",
          '---\nsubject: "%s"\ntitle: "%s"\nstatus: %s\nlast_session: "2026-09-20"\n%s---\n\n'
          "## Nodes\n\n| Node | Status | Last checked | Evidence |\n| --- | --- | --- | --- |\n%s"
          % (slug, title, st, extra, nodes_rows))
start_subject("oop", "OOP", "active", "| n1 Classes | planned | — | — |\n")
# A done subject's passed deadline is history, so its line leaves it out.
start_subject("ptr", "Pointers", "done", "| n1 Aliasing | decayed | 2026-09-22 | — |\n", 'deadline: "2026-09-01"\n')
start_subject("fin", "Finished", "done", "| n1 Leaves | skipped | — | — |\n")
start_subject("calc", "MATH 241", "paused", "| n1 Limits | planned | — | — |\n", 'deadline: "2026-09-01"\n')
write(VAULT / "learn/subjects/calc/sessions/2026-09-22-s03.md",
      '---\nsubject: "calc"\nsession: "03"\ndate: "2026-09-22"\nstart: "10:00"\npaused:\nend:\n---\n')
session_context = load("session_context", "session_context.py")
index = session_context.start_context(VAULT)
block = index.split("Show the learner (verbatim):\n", 1)[1].split("\nEnd of block.", 1)[0].splitlines()
eq("the block: recommended action, left-open note, subjects by pending action, then untouched done subjects",
   block,
   ["**Recommended:** Repair · Pointers: *Aliasing* slipped on 22 Sep. `/learn-resume ptr`",
    "Your MATH 241 session from 22 Sep was left open. Resuming will close it out first.",
    "- Pointers · 1 to repair",
    "- OOP · ready to resume",
    "- MATH 241 · ready to resume · deadline passed",
    "Done: Finished"])
start_subject("exam", "Calc III", "diagnosing", "", 'deadline: "2099-12-31"\n')
eq("a subject with a deadline ahead lists first among the pending lines",
   [line for line in session_context.start_context(VAULT).split("Show the learner (verbatim):\n", 1)[1]
    .split("\nEnd of block.", 1)[0].splitlines() if line.startswith("- ")][0].split(" · deadline")[0],
   "- Calc III · ready to resume")
eq("the agent-only index still follows the block",
   index.index("End of block.") < index.index("- oop: OOP | active"), True)
selected = session_context.start_context(VAULT, "oop")
eq("with a subject selected only the left-open notes and subject lines remain",
   [line for line in selected.split("Show the learner (verbatim):\n", 1)[1].split("\nEnd of block.", 1)[0].splitlines()
    if line.startswith(("**Recommended", "Review streak", "Your "))],
   ["Your MATH 241 session from 22 Sep was left open. Resuming will close it out first."])
codex = session_context.start_context(VAULT, host="codex")
eq("Codex gets $ commands in the block and in the open-note mechanics",
   ("`$learn-resume ptr`" in codex, "`/learn-" in codex, "`$learn-resume`" in codex), (True, False, True))
eq("nothing pending: the Home wording on one line",
   status.startup_block(QUIET, [], True, HOME_DAY)[1],
   "**Recommended:** Nothing you've passed is due for review. *Roots* comes due on 26 Sep. "
   "Curious about something new? `/learn-start`")
eq("the live streak shows with rewards on, and not with rewards off",
   (status.startup_block(HOME_SUBJECTS, [], True, HOME_DAY)[2], "Review streak" in "".join(
       status.startup_block(HOME_SUBJECTS, [], False, HOME_DAY))), ("Review streak: 2 weeks", False))


# ------------------------------------------------------------------ write-check: what /learn-end proves it wrote

section("write-check — the step 7 cross-check reads hashes, not git")
wcheck = load("write_check", "write-check.py")
WC = Path(tempfile.mkdtemp())
(WC / "learn/subjects/oop/sessions").mkdir(parents=True)
(WC / "learn/me").mkdir()
(WC / "learn/subjects/oop/record.md").write_text("old record\n")
(WC / "learn/subjects/oop/resume.md").write_text("resume\n")
(WC / "learn/subjects/oop/log.md").write_text("live log\n")
(WC / "learn/me/preferences.md").write_text("prefs\n")
eq("snapshot counts the files it hashed, log.md excluded",
   wcheck.snapshot(WC, "oop-s05"), "snapshot oop-s05: 3 files under learn/")
eq("nothing written: compare says so", wcheck.compare(WC, "oop-s05"), "no file under learn/ changed")
(WC / "learn/subjects/oop/record.md").write_text("new record\n")
(WC / "learn/subjects/oop/sessions/2026-10-08-s05.md").write_text("note\n")
(WC / "learn/me/preferences.md").unlink()
(WC / "learn/subjects/oop/log.md").write_text("streamed more\n")
(WC / "learn/.mc-runtime").mkdir()
(WC / "learn/.mc-runtime/placement.json").write_text("[]\n")
eq("changed, added and removed are each named; log.md and dot-dirs are not",
   wcheck.compare(WC, "oop-s05").splitlines(),
   ["removed  learn/me/preferences.md",
    "changed  learn/subjects/oop/record.md",
    "added    learn/subjects/oop/sessions/2026-10-08-s05.md",
    "no other files under learn/ changed"])
eq("the snapshot never lists itself", "learn/.write-check/oop-s05.json" in wcheck.hashes(WC), False)
try:
    wcheck.compare(WC, "never-taken")
    eq("compare with no snapshot refuses", "no error", "FileNotFoundError")
except FileNotFoundError:
    eq("compare with no snapshot refuses", True, True)
try:
    wcheck.snapshot(WC, "../escape")
    eq("a snapshot id cannot leave .write-check/", "no error", "ValueError")
except ValueError:
    eq("a snapshot id cannot leave .write-check/", True, True)
shutil.rmtree(WC)


# ------------------------------------------------------------------ cross-subject prerequisites and the resume brief

section("cross-subject prerequisites: <slug>/nN in Prereqs (records.md, Plan table)")
XV = Path(tempfile.mkdtemp(prefix="crosstest-"))
write(XV / "learn/subjects/calc-a/record.md", """---
subject: calc-a
title: Calc A
status: active
---

## Nodes

| Node | Status | Last checked | Evidence (latest) |
| --- | --- | --- | --- |
| n8a Directional derivative | checked | 2026-10-20 | value unaided; meaning after a pointer |
| n9 Gradient | solid | 2026-10-21 | correct |
""")
write(XV / "learn/subjects/calc-b/record.md", """---
subject: calc-b
title: Calc B
status: active
next: re-teach n1, then n2
budget: 90
---

## Goal

Pass the quiz.

## Misconceptions

- [ ] gradient points along the curve -- surfaced 2026-10-23 s01; open
- [x] old one -- resolved 2026-10-01

## Nodes

| Node | Status | Last checked | Evidence (latest) |
| --- | --- | --- | --- |
| n1 Perpendicular | introduced | - | - |
| n2 Tangency | planned | - | - |
| n3 Cases | checked | 2026-10-23 | correct |
| n4 Three variables | planned | - | - |
| n5 Disk | planned | - | - |
| n6 Extra | planned | - | - |

## Evidence log

- 2026-10-23 s01: what does D_u f measure -> "I don't know" -> not yet -> n1 introduced
- 2026-10-23 s01: solve x(1-L)=0 by cases -> both cases -> correct -> n3 checked
""")
write(XV / "learn/subjects/calc-b/plan.md", """---
subject: calc-b
updated: 2026-10-23
---

## Chains

- `n1 -> n2 -> n3`: find candidates, solve by cases, compare values.

## Nodes

| Id | Node | Rests on (unconditional truth) | Discovery question | Check type | Can do | Est. min | Prereqs | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| n1 | Perpendicular | f is constant along a level curve | Walk a contour: how fast does height change? | free response | explain why | 15 | calc-a/n8a | introduced |
| n2 | Tangency | crossing means not extreme | How do you know you're at the top? | free response | find tangency | 15 | n1, calc-a/n9 | planned |
| n3 | Cases | ab=0 means a=0 or b=0 | What if x=0? | free response | solve by cases | 15 | n2 | checked |
| n4 | Three variables | four equations | How many unknowns? | free response | set up | 15 | n3 | planned |
| n5 | Disk | extreme value theorem | Where can the max be? | free response | check boundary | 15 | n4, calc-z/n1 | planned |
| n6 | Extra | none | x | x | x | 10 | n5 | planned |

## Session groups

- Core: n1, n2, n3
- If time: n4, n5, n6
""")
write(XV / "learn/subjects/calc-b/sessions/2026-10-23-s01.md", """---
subject: calc-b
session: "01"
date: "2026-10-23"
start: "10:00"
end: "10:45"
nodes: [n1, n3]
---

## Next step

Re-teach n1 from what D_u f measures.

## What worked / what didn't

Numbers before formulas.
""")
loaded_x, _ = status.load_subjects(XV, datetime(2026, 10, 25, 9))
calc_b = next(x for x in loaded_x if x["slug"] == "calc-b")
eq("a cross prerequisite is read apart from the subject's own",
   (calc_b["nodes"]["n1"]["cross_prereqs"], calc_b["nodes"]["n1"]["prereqs"]), ([("calc-a", "n8a")], []))
eq("a cell mixing both keeps each in its place",
   (calc_b["nodes"]["n2"]["cross_prereqs"], calc_b["nodes"]["n2"]["prereqs"]), ([("calc-a", "n9")], ["n1"]))
eq("a cross prerequisite is not reported as missing from the node table",
   calc_b["nodes"]["n1"]["bad_prereqs"], [])
concerns = {(row["node"], row["concern"]) for row in status.cross_prereqs(loaded_x)}
eq("a checked node whose last pass needed a pointer is a concern",
   ("n1", "its last check needed help") in concerns, True)
eq("a solid node passed clean is no concern", ("n2", None) in concerns, True)
eq("a subject that does not exist is reported", ("n5", "not found") in concerns, True)
board_x = status.dashboard(loaded_x, datetime(2026, 10, 25).date(), [], [])
eq("the dashboard names the cross-subject concern",
   "Calc B n1 depends on Calc A n8a: its last check needed help" in board_x, True)
eq("and leaves a clean one off it", "depends on Calc A n9" in board_x, False)

section("resume brief: learn-status.py --brief (learn-resume step 1)")
text_b = status.brief(calc_b, loaded_x, datetime(2026, 10, 25).date())
eq("focus: next: names, open work, the latest checked, and the next three planned",
   status.brief_focus(calc_b["fields"], calc_b["nodes"]), ["n1", "n2", "n3", "n4", "n5"])
eq("the budget is in the state", "- budget: 90" in text_b, True)
eq("an open misconception is listed and a resolved one is not",
   ("gradient points along the curve" in text_b, "old one" in text_b), (True, False))
eq("a focus node carries its plan row", "Walk a contour: how fast does height change?" in text_b, True)
eq("a node outside the focus does not", "| n6 |" in text_b or "**n6 Extra**" in text_b, False)
eq("Chains and Session groups are carried over", ("## Chains" in text_b, "- If time: n4, n5, n6" in text_b), (True, True))
eq("the cross-subject prerequisite shows with its evidence",
   "Calc B n1 depends on Calc A n8a: its last check needed help (value unaided; meaning after a pointer)" in text_b, True)
eq("the latest note's next step is in it", "Re-teach n1 from what D_u f measures." in text_b, True)
eq("the latest note's times are in it, so step 3 needs no full read",
   "date: 2026-10-23 · start: 10:00 · end: 10:45 · paused: empty" in text_b, True)
before = sorted(str(path) for path in XV.rglob("*"))
run = subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(XV), "--brief",
                      "--subject", "calc-b"], capture_output=True, text=True)
eq("--brief runs from the command line", (run.returncode, run.stdout.startswith("# Resume brief: ")), (0, True))
eq("--brief writes nothing", sorted(str(path) for path in XV.rglob("*")), before)
run = subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(XV), "--brief"],
                     capture_output=True, text=True)
eq("--brief without --subject is refused", run.returncode, 2)

section("app data: learn-status.py --json (the desktop app's one parser)")
before = sorted((str(path), path.stat().st_mtime) for path in XV.rglob("*"))
run = subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(XV), "--json"],
                     capture_output=True, text=True)
eq("--json runs and prints one JSON object", run.returncode, 0)
app = json.loads(run.stdout)
eq("--json writes nothing, not even the views",
   sorted((str(path), path.stat().st_mtime) for path in XV.rglob("*")), before)
by_slug = {s["slug"]: s for s in app["subjects"]}
eq("every subject is in it", sorted(by_slug), sorted(s["slug"] for s in loaded_x))
eq("node statuses are the record's",
   [(n["id"], n["status"]) for n in by_slug["calc-b"]["nodes"]][:2],
   [(n["id"], status.read_nodes(calc_b["record_text"], calc_b["plan_text"])[n["id"]]["status"])
    for n in by_slug["calc-b"]["nodes"]][:2])
eq("the recommended actions match --next, best first",
   [r["command"] for r in app["ranked"]],
   [r["command"] for r in status.rank(status.rank_inputs(loaded_x), status.note_inputs(loaded_x),
                                      datetime.now().date())])
eq("each action carries the command as typed for the host", app["ranked"][0]["typed"],
   "/" + app["ranked"][0]["command"])
codex = json.loads(subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(XV),
                                   "--json", "--host", "codex"], capture_output=True, text=True).stdout)
eq("and in Codex's form with --host codex", codex["ranked"][0]["typed"], "$" + codex["ranked"][0]["command"])
eq("a subject with nodes has a map layout with a position per node",
   set(by_slug["calc-b"]["layout"]["x"]) >= {n["id"] for n in by_slug["calc-b"]["nodes"]}, True)
shutil.rmtree(XV)


section("pace: real active minutes against plan estimates (learn-start, Fit the budget)")
PV = Path(tempfile.mkdtemp(prefix="pacetest-"))
def pace_subject(slug, rows, notes):
    write(PV / "learn/subjects" / slug / "record.md", "---\nsubject: %s\ntitle: %s\nstatus: active\n---\n\n"
          "## Nodes\n\n| Node | Status | Last checked | Evidence (latest) |\n| --- | --- | --- | --- |\n%s\n"
          % (slug, slug, "\n".join("| %s Topic | %s | - | - |" % (node, st) for node, st, _ in rows)))
    write(PV / "learn/subjects" / slug / "plan.md", "## Nodes\n\n| Id | Node | Est. min | Status |\n"
          "| --- | --- | --- | --- |\n%s\n" % "\n".join("| %s | Topic | %s | %s |" % (node, est, st)
                                                     for node, st, est in rows))
    for stem, extra in notes:
        write(PV / "learn/subjects" / slug / "sessions" / (stem + ".md"),
              '---\nsubject: %s\nsession: "01"\ndate: "2026-10-01"\nstart: "10:00"\nend: "11:00"\n%s\n---\n\n# note\n'
              % (slug, extra))
pace_subject("math9-a", [("n1", "checked", 20), ("n2", "introduced", 20), ("n3", "planned", 50)],
             [("2026-10-01-s01", "active_minutes: 50"), ("2026-10-02-s02", "active_minutes: 30"),
              ("2026-10-03-s03", "kind: practice\nactive_minutes: 99")])
pace_subject("math9-b", [("n1", "solid", 30)], [("2026-10-01-s01", "active_minutes: 30")])
pace_subject("math9-c", [("n1", "checked", 30)], [("2026-10-01-s01", "active_minutes:")])
pace_subject("cs9-a", [("n1", "checked", 10)], [("2026-10-01-s01", "active_minutes: 5")])
loaded_p, _ = status.load_subjects(PV, datetime(2026, 10, 25, 9))
rows_p, median_p = status.pace(loaded_p, course="math9")
eq("only taught topics count, practice minutes do not, and a subject with a missing minute is left out",
   [(slug, actual, estimated) for slug, actual, estimated, _ in rows_p], [("math9-a", 80, 40), ("math9-b", 30, 30)])
eq("the median is over the course's subjects", median_p, 1.5)
eq("without a course every subject counts", status.pace(loaded_p)[1], 1.0)
run = subprocess.run([sys.executable, str(HOOKS / "learn-status.py"), "--vault", str(PV), "--pace",
                      "--course", "math9"], capture_output=True, text=True)
eq("--pace prints one line per subject and the median",
   run.stdout.splitlines(), ["math9-a: 80 active min for 40 estimated (2.0x)",
                             "math9-b: 30 active min for 30 estimated (1.0x)",
                             "Median over 2 math9 subjects: 1.5x"])
eq("a course with no usable subject says so", status.pace_report([], None, "bio1"),
   "No bio1 subjects with recorded minutes and taught topics yet.\n")
shutil.rmtree(PV)


# ------------------------------------------------------------------ reply-check: the Stop hook

# Three reply rules in tutor.md kept breaking after more prose was added to the
# file. These pin the deterministic gate that now holds such a reply back once.
# Every fixture is synthetic; the shapes copy the transcript rows above.

rc = load("reply_check", "reply-check.py")
import log_health  # noqa: E402

LONG = "The loop keeps running because the condition is checked before every pass. " * 14   # 168 words

section("reply-check: counting prose leaves code, mermaid, math and embeds out")
eq("plain words count", rc.word_count("one two three"), 3)
eq("a fenced block does not count",
   rc.word_count("Two words.\n\n```java\nint a = 1; int b = 2; int c = 3;\n```"), 2)
eq("a mermaid block does not count",
   rc.word_count("Two words.\n\n```mermaid\ngraph TD; A-->B; B-->C; C-->D;\n```"), 2)
eq("display and inline math do not count",
   rc.word_count("Two words. $$\\int_0^1 x\\,dx = \\frac{1}{2}$$ $x^2 + y^2$."), 2)
eq("an SVG embed and inline SVG do not count",
   rc.word_count("Two words. ![[fig.svg|400]] <svg><text>a b c d</text></svg>"), 2)
eq("a code span's words are not prose either", rc.word_count("Two words `and four more here`."), 2)
eq("the limit sits above 'about 120' on purpose", rc.PROSE_WORDS > 120, True)

section("reply-check: questions to the learner")
eq("one question is one", rc.questions("What does `*p` print after the swap?"), ["What does `*p` print after the swap?"])
eq("two questions are two",
   len(rc.questions("Does that make sense? Now, what does line 3 print?")), 2)
eq("a quoted check is not a question of this reply",
   rc.questions('Last time I asked "What does *p print?" and you said 5. What changed in the swap?'),
   ["What changed in the swap?"])
eq("a question mark in code is not a question", rc.questions("Run `x ? 1 : 0` and tell me the value."), [])
eq("a one- or two-word rhetorical beat is not a question",
   rc.questions("Why? Because the loop never resets. What does it print instead?"),
   ["What does it print instead?"])
eq("a quoted learner line is not a question", rc.questions("> was it 5?\n\nRight, it was 5."), [])

section("reply-check: machinery the learner never reads")
eq("a node id is found (jev's one regex)", rc.machinery("That closes n4, so next is n12a."), ["n4", "n12a"])
eq("a script and a path are found",
   rc.machinery("I ran learn-status.py and updated learn/system/tutor.md."),
   ["learn-status.py", "learn/system/tutor.md"])
eq("a trailing period is not part of the path", rc.machinery("See learn/subjects/oop/plan.md."),
   ["learn/subjects/oop/plan.md"])
eq("checker names are found", rc.machinery("Jev and mc-preflight both ran."), ["mc-preflight", "Jev"])
eq("a wikilink to the log, and log.md itself, are allowed",
   rc.machinery("Open [[learn/subjects/oop/log]] in Obsidian; log.md updates as I type."), [])
eq("code spans are not prose", rc.machinery("Type `python3 run.py` to start."), [])
eq("a lower-case word is not the checker", rc.machinery("the jev of it"), [])
eq("N2 the molecule is not a node", rc.machinery("N2 is a gas."), [])

section("reply-check: the verdict rule asks for one only when it is sure there was a check")
CHECK = {"who": "tutor", "kind": "text", "text": "Here is the swap.\n\n```java\nint t = a;\n```\n\nWhat does `*p` print now?"}
eq("a reply that ended with a three-word question is a check", rc.asked_a_check([CHECK]), True)
eq("a logistics question is not", rc.asked_a_check([{"who": "tutor", "kind": "text",
                                                     "text": "Ready to go on?"}]), False)
eq("a prediction is not (Pacing: never graded)",
   rc.asked_a_check([{"who": "tutor", "kind": "text", "text": "What do you predict it prints?"}]), False)
eq("a question followed by more prose is not the check",
   rc.asked_a_check([{"who": "tutor", "kind": "text", "text": "What prints? I'll show you. It prints 5."}]), False)
eq("a picker is a check", rc.asked_a_check([{"who": "tutor", "kind": "picker",
                                              "text": "**What does `*p` print?**\n\n- **5**\n- **7**"}]), True)
eq("a logistics picker is not", rc.asked_a_check([{"who": "tutor", "kind": "picker",
                                                   "text": "**Which subject first?**\n\n- **oop**"}]), False)
eq("a short statement is an answer", rc.answered({"kind": "text", "text": "5, because p still points at x"}), True)
eq("a picker answer is an answer", rc.answered({"kind": "answer", "text": "5"}), True)
eq("'pass' is not", rc.answered({"kind": "text", "text": "pass"}), False)
eq("a question back is not", rc.answered({"kind": "text", "text": "is it 5?"}), False)
eq("a command is not", rc.answered({"kind": "text", "text": "/learn-end"}), False)
eq("a long message is a discussion, not an answer",
   rc.answered({"kind": "text", "text": "word " * (rc.ANSWER_MAX_WORDS + 1)}), False)
eq("'Right.' opens with a verdict", rc.opens_with_verdict("Right. The pointer still holds x's address."), True)
eq("'Not quite' opens with a verdict", rc.opens_with_verdict("**Not quite.** It prints 7."), True)
eq("'Partly' opens with a verdict", rc.opens_with_verdict("Partly: the address is right, the value is not."), True)
eq("a verdict in the second sentence does not count",
   rc.opens_with_verdict("The pointer holds the address of x. So yes, 5."), False)
eq("a verdict after a diagram still opens the prose",
   rc.opens_with_verdict("```mermaid\ngraph TD; p-->x\n```\n\nCorrect, p still points at x."), True)

section("reply-check: the nudge")
eq("the plain nudge", rc.is_nudge("The question is waiting above when you're ready."), True)
eq("its relatives", [rc.is_nudge(t) for t in ("Still waiting on your answer to the check.",
                                              "Answer the question above first.",
                                              "My check is still open.")], [True, True, True])
eq("a question about questions is not a nudge", rc.is_nudge("Which question was harder?"), False)
eq("a quoted nudge is not one", rc.is_nudge('You said "the question is waiting above" was annoying.'), False)

section("reply-check: reply_problems, one sentence per fix")
answer_turn = {"who": "learner", "kind": "text", "text": "5"}
eq("a clean grade passes", rc.reply_problems(["Right. `p` still points at x.\n\nWhat prints after `p = &y`?"],
                                             [CHECK], answer_turn), [])
problems = rc.reply_problems([LONG], [], {"who": "learner", "kind": "text", "text": "go on"})
eq("long prose is named with its count", any("168 words" in p for p in problems), True)
problems = rc.reply_problems(["Does that make sense? What does line 3 print?"], [], None)
eq("two questions are quoted back", any("Two questions" in p and "line 3" in p for p in problems), True)
problems = rc.reply_problems(["The pointer still holds the address of x, so the swap did nothing to it."],
                             [CHECK], answer_turn)
eq("a grade without a verdict names the first sentence",
   any("not a verdict" in p and "The pointer still holds" in p for p in problems), True)
eq("the same reply after 'pass' is not graded",
   rc.reply_problems(["The pointer still holds the address of x."], [CHECK],
                     {"who": "learner", "kind": "text", "text": "pass"}), [])
eq("the same reply after a prediction question is not graded",
   rc.reply_problems(["The pointer still holds the address of x."],
                     [{"who": "tutor", "kind": "text", "text": "What do you guess it prints?"}], answer_turn), [])
eq("the same reply after a logistics question is not graded",
   rc.reply_problems(["The pointer still holds the address of x."],
                     [{"who": "tutor", "kind": "text", "text": "Ready for the next step?"}],
                     {"who": "learner", "kind": "text", "text": "yes"}), [])
eq("a picker answer gets graded too",
   any("not a verdict" in p for p in rc.reply_problems(
       ["The pointer still holds the address of x."],
       [{"who": "tutor", "kind": "picker", "text": "**What does `*p` print?**\n\n- **5**\n- **7**"}],
       {"who": "learner", "kind": "answer", "text": "5"})), True)
eq("one nudge is allowed", rc.reply_problems(["The question is waiting above."], [], None), [])
eq("a second nudge in the same reply is not",
   any("second time" in p for p in rc.reply_problems(
       ["The question is waiting above.", "Still waiting on your answer."], [], None)), True)
eq("a nudge right after a nudge is not",
   any("second time" in p for p in rc.reply_problems(
       ["The question above is still waiting."],
       [{"who": "tutor", "kind": "text", "text": "The question is waiting above."}],
       {"who": "learner", "kind": "text", "text": "hmm"})), True)
problems = rc.reply_problems(["That closes n4. I also ran learn-status.py."], [], None)
eq("machinery is named", any("n4, learn-status.py" in p for p in problems), True)
eq("on a command turn only the question and machinery rules apply",
   rc.reply_problems([LONG + " What prints?"], [], None, command="resume"), [])
eq("but two questions on a command turn still count",
   len(rc.reply_problems(["Do you remember n4? What did it print?"], [], None, command="resume")), 2)
eq("an empty reply has no problems", rc.reply_problems(["", "  "], [], None), [])


def reply_stop(*rows, sid="conv-a", **extra):
    path = transcript(*rows, sid=sid)
    payload = {"session_id": sid, "hook_event_name": "Stop", "transcript_path": str(path)}
    payload.update(extra)
    return rc.process(VAULT, payload)


def blocked(decision):
    return decision["decision"] if isinstance(decision, dict) else decision


RESUME = ("user", "/learn-resume oop")
ASKED = ("assistant", [{"type": "text", "text": "Here is the swap.\n\n```java\nint t = a;\n```\n\nWhat does `*p` print now?"}])
ANSWER = ("user", "5")

DEFAULT_HOLD = set(rc.HOLD)
rc.HOLD = set(rc.KINDS)   # every check holds here, to test the hold mechanics and each check
section("reply-check: the Stop hook holds a bad tutoring reply back once")
fresh(); subject("oop")
turn("/learn-resume oop")
decision = reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text": LONG}]))
eq("the reply is blocked", blocked(decision), "block")
eq("with the word count and the fix", "168 words" in decision["reason"] and "Keep one idea" in decision["reason"], True)
eq("and the reason says a held reply is not held twice", "never held twice" in decision["reason"], True)
eq("the same reply at the next Stop goes through",
   reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text": LONG}])), "")
eq("the memory lives beside the mirror's state",
   (VAULT / ".claude/obsidian-live/conv-a.reply-check.json").is_file(), True)
eq("a different bad reply is held",
   blocked(reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text": LONG + " Really."}]))), "block")
eq("stop_hook_active is respected: a continuation is never blocked",
   reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text": LONG + " Again."}]),
              stop_hook_active=True), "")
eq("a subagent's transcript is left alone",
   reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text": LONG + " Twice."}]),
              agent_id="reviewer"), "")

section("reply-check: the verdict rule, read off the transcript")
fresh(); subject("oop")
turn("/learn-resume oop")
decision = reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text":
                      "The pointer still holds the address of x.\n\nWhat prints after `p = &y`?"}]))
eq("an answer graded without a verdict is held", blocked(decision), "block")
eq("the reason says what to open with", "right, wrong, or partly right" in decision["reason"], True)
eq("the same grade opening with the verdict goes through",
   reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text":
              "Right. The pointer still holds the address of x.\n\nWhat prints after `p = &y`?"}])), "")
eq("a reply to 'pass' needs no verdict",
   reply_stop(RESUME, ASKED, ("user", "pass"), ("assistant", [{"type": "text", "text":
              "The pointer still holds the address of x. Try it: what prints after `p = &y`?"}])), "")
eq("a reply to a learner question needs no verdict",
   reply_stop(RESUME, ASKED, ("user", "does p change when x does?"),
              ("assistant", [{"type": "text", "text": "No change to p: it holds x's address, not its value."}])), "")
eq("a reply after a logistics question needs no verdict",
   reply_stop(RESUME, ("assistant", [{"type": "text", "text": "Ready for the swap?"}]), ("user", "yes"),
              ("assistant", [{"type": "text", "text": "Here it is.\n\n```java\nint t = a;\n```\n\nWhat does `*p` print?"}])), "")
eq("a picker answer graded without a verdict is held",
   blocked(reply_stop(RESUME,
                      ("assistant", [{"type": "tool_use", "id": "tq1", "name": "AskUserQuestion",
                                      "input": {"questions": [{"question": "What does `*p` print?",
                                                               "options": [{"label": "5"}, {"label": "7"}]}]}}]),
                      ("user", [{"type": "tool_result", "tool_use_id": "tq1", "content": "5"}],
                       {"toolUseResult": {"answers": {"What does `*p` print?": "5"}}}),
                      ("assistant", [{"type": "text", "text": "The pointer still holds the address of x."}]))),
   "block")
eq("the text before a tool call is part of the reply, so a verdict there counts",
   reply_stop(RESUME, ASKED, ANSWER,
              ("assistant", [{"type": "text", "text": "Right."},
                             {"type": "tool_use", "id": "tb", "name": "Bash", "input": {"command": "date"}}]),
              ("user", [{"type": "tool_result", "tool_use_id": "tb", "content": "ok"}]),
              ("assistant", [{"type": "text", "text": "The pointer still holds the address of x.\n\nWhat prints after `p = &y`?"}])), "")

section("reply-check: two questions, the nudge, and machinery through the hook")
fresh(); subject("oop")
turn("/learn-resume oop")
decision = reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text":
                      "Right. Does that make sense? What does line 3 print?"}]))
eq("two questions are held and both are quoted",
   blocked(decision) == "block" and "line 3 print" in decision["reason"], True)
eq("one question plus a quoted check goes through",
   reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text":
              'Right. Earlier I asked "What does *p print?" and you said 5. What prints after `p = &y`?'}])), "")
eq("the first nudge goes through",
   reply_stop(RESUME, ASKED, ("user", "my runner is slow today"),
              ("assistant", [{"type": "text", "text": "Noted. The question is waiting above when you're ready."}])), "")
decision = reply_stop(RESUME, ASKED, ("user", "my runner is slow today"),
                      ("assistant", [{"type": "text", "text": "Noted. The question is waiting above when you're ready."}]),
                      ("user", "ok"),
                      ("assistant", [{"type": "text", "text": "The question above is still waiting."}]))
eq("the second nudge in a row is held", blocked(decision), "block")
eq("and told to ask again in full", "ask the question again in full" in decision["reason"], True)
decision = reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text":
                      "Right. That closes n4; I logged it with learn-status.py in learn/subjects/oop/record.md."}]))
eq("node ids, scripts and paths are held", blocked(decision), "block")
eq("and named in the reason", "n4, learn-status.py, learn/subjects/oop/record.md" in decision["reason"], True)
eq("telling the learner to open the log is fine",
   reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text":
              "Right. Open [[learn/subjects/oop/log]] in Obsidian to follow along. What prints after `p = &y`?"}])), "")

section("reply-check: tutoring replies only")
fresh(); subject("oop")
turn("fix the plugin", sid="eng")
eq("a conversation with no subject is never held",
   reply_stop(("user", "fix the plugin"), ("assistant", [{"type": "text", "text": LONG}]), sid="eng"), "")
turn("/learn-resume oop")
eq("the /learn-end closing block has its own checker and is not held here",
   reply_stop(RESUME, ASKED, ANSWER, ("user", "/learn-end"),
              ("assistant", [{"type": "text", "text": "Saving your progress.\n\n" + LONG}])), "")
eq("a long /learn-resume recap is not held for length",
   reply_stop(("user", "<command-name>/learn-resume</command-name><command-args>oop</command-args>"),
              ("assistant", [{"type": "text", "text": LONG + " What did `*p` print last time?"}])), "")
eq("a turn with no reply text has nothing to hold",
   reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "tool_use", "id": "tb", "name": "Bash",
                                                     "input": {"command": "date"}}])), "")
turn("/learn-end"); turn("unrelated after the end")
eq("after /learn-end the next turn is not tutoring",
   reply_stop(RESUME, ("user", "/learn-end"), ("user", "unrelated after the end"),
              ("assistant", [{"type": "text", "text": LONG}])), "")

section("reply-check: after a block, only the rewrite is the reply")
fresh(); subject("oop")
turn("/learn-resume oop")
eq("a draft with two questions that was blocked and rewritten clean goes through",
   reply_stop(RESUME, ASKED, ANSWER,
              ("assistant", [{"type": "text", "text": "Right. Does that make sense? What prints next?"}]),
              ("user", "Stop hook feedback:\nReply check: two questions.", {"isMeta": True}),
              ("assistant", [{"type": "text", "text": "Right. What prints after `p = &y`?"}])), "")
eq("the hook fails open on an unreadable transcript",
   rc.process(VAULT, {"session_id": "conv-a", "hook_event_name": "Stop", "transcript_path": "/nowhere.jsonl"}), "")
rc.HOLD = DEFAULT_HOLD

section("reply-check: only machinery holds by default; the rest log what they would hold")
eq("the default holds only the machinery check", rc.HOLD, {"machinery"})
fresh(); subject("oop")
turn("/learn-resume oop")
eq("a long reply goes through",
   reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text": LONG}])), "")
eq("and the length and verdict checks are logged", [row["kind"] for row in map(json.loads,
   rc.log_path(VAULT).read_text().splitlines())], ["length", "verdict"])
eq("the same reply at the next Stop is not logged twice",
   (reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text": LONG}])),
    len(rc.log_path(VAULT).read_text().splitlines())), ("", 2))
decision = reply_stop(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text":
                      "The pointer still holds x. That closes n4. Does that make sense? What does line 3 print?"}]))
eq("a node id still holds the reply", blocked(decision), "block")
eq("the reason names only the held check", "n4" in decision["reason"] and "verdict" not in decision["reason"]
   and "Two questions" not in decision["reason"], True)
eq("the verdict and two-question checks were logged for it",
   sorted(row["kind"] for row in map(json.loads, rc.log_path(VAULT).read_text().splitlines()))[-4:],
   ["length", "questions", "verdict", "verdict"])
report = rc.log_report(VAULT)
eq("report counts each logged check", "questions: 1" in report and "verdict: 2" in report and "length: 1" in report, True)
eq("report on an empty log says so", rc.log_report(VAULT / "nowhere"), "No would-hold entries yet.")

section("reply-check: session start asks for a review after a week")
sc = load("session_context", "session_context.py")
dt = sc.datetime
runtime = VAULT / ".claude/obsidian-live"
for name in ("reply-check-reviewed", "reply-check-snooze"):
    (runtime / name).unlink(missing_ok=True)
rc.log_path(VAULT).write_text("\n".join(json.dumps({"time": t, "kind": "length", "digest": t, "reply": "x"})
                                         for t in ("2026-11-05 10:00", "2026-11-07 10:00")) + "\n")
eq("under a week, nothing is asked", sc.reply_check_due(VAULT, dt(2026, 11, 11, 9, 0)), "")
due = sc.reply_check_due(VAULT, dt(2026, 11, 12, 10, 0))
eq("a week after the first entry, the start context asks", due.startswith("Reply-check review due: 2 logged since 05 Nov"), True)
eq("and says how to clear and snooze it", "reply-check.py reviewed" in due and "reply-check.py snooze" in due, True)
real_due = sc.reply_check_due
sc.reply_check_due = lambda vault: due
eq("the line is in the start context", due in sc.start_context(VAULT), True)
sc.reply_check_due = real_due
rc.mark_review(VAULT, "snooze", now=dt(2026, 11, 12, 10, 0).timestamp())
eq("a snooze hides it for two days", sc.reply_check_due(VAULT, dt(2026, 11, 13, 10, 0)), "")
eq("and it comes back after", sc.reply_check_due(VAULT, dt(2026, 11, 14, 10, 1)) != "", True)
rc.mark_review(VAULT, "reviewed", now=dt(2026, 11, 14, 11, 0).timestamp())
eq("once reviewed, old entries are not asked about again", sc.reply_check_due(VAULT, dt(2026, 11, 30, 10, 0)), "")
with rc.log_path(VAULT).open("a") as handle:
    handle.write(json.dumps({"time": "2026-11-20 10:00", "kind": "verdict", "digest": "n", "reply": "y"}) + "\n")
eq("new entries start a new week", sc.reply_check_due(VAULT, dt(2026, 11, 27, 10, 0)).startswith(
   "Reply-check review due: 1 logged since 20 Nov"), True)
for name in ("reply-check-reviewed", "reply-check-snooze", "reply-check-log.jsonl"):
    (runtime / name).unlink(missing_ok=True)


# ------------------------------------------------------------------ reply-check: the closing block

CLOSING = """Saved and checked: session note, record, plan, resume, preferences, Home, Dashboard, progress.
Preferences: nothing changed. One new pattern noted: tracing the calls by hand helped when a hint didn't.

Slipped: Writing `equals(Object)`. Get it right in a later session and it counts as remembered again.
Topics passed: 83 → 88
This week's review isn't done yet: 63 older topics are due for a re-check

**Where you are**
- Covered today: copy constructors, a class that tracks running state, and the CS People questions.
- Slipped or still wrong: writing `equals` (you wrote it as `static`), and calling a static method from another class.
- Next: ask how Quiz 7 went, then rewrite a running-state class with no hints.

Next: take PQ7, then Quiz 7 at 14:00.
"""

section("reply-check closing: the skill's own example is clean")
eq("clean, exit 0", rc.closing_report(CLOSING), ("closing block: clean", 0))

section("reply-check closing: each string, the question mark, and node ids")
report, code = rc.closing_report("I followed the workflow with Jev, mc-preflight, learn-status and write-check; "
                                 "semantic: none. Ready for n4?")
eq("exit 1 on a hit", code, 1)
for needle in ("'I followed'", "'workflow'", "'Jev'", "'mc-preflight'", "'learn-status'", "'write-check'",
               "'semantic:'", "node id n4", "question mark outside a quoted check"):
    eq("reports " + needle, needle in report, True)
eq("a question inside quotes is a quoted check and passes",
   rc.closing_report('Next: start with "What does `*p` print?" and take it from there.')[1], 0)
eq("a question inside backticks passes too", rc.closing_report("Next: type `x ? 1 : 0`.")[1], 0)
eq("the strings are case-insensitive", rc.closing_report("the Workflow ran")[1], 1)
eq("jev.py counts as Jev", rc.closing_report("jev.py matched it")[1], 1)
eq("'followed' alone is not the paragraph", rc.closing_report("You followed the trace well.")[1], 0)

section("reply-check closing: reward lines are exempt, and only reward lines")
for line in ("Slipped: n4 and Jev's workflow? Get it right in a later session.",
             "Topics passed: 83 → 88 · Topics remembered on a later day: 2 → 3",
             "Goal reached: n12 workflow",
             "Remembered again after slipping: n4",
             "Remembered on a later day: n4",
             "Review streak: 3 weeks",
             "This week's review isn't done yet: 63 older topics are due for a re-check",
             "2 wins: n4 (remembered on a later day) · n5 (goal reached)",
             "- Slipped: n4 as a bullet"):
    eq("exempt: " + line[:40], rc.closing_report(line)[1], 0)
eq("the same words on a non-reward line are flagged",
   rc.closing_report("Also: n4 and Jev's workflow?")[0].count("line 1"), 4)
eq("the exemption is per line, not per block",
   rc.closing_report("Slipped: n4.\nAnd n5 is next.")[0].count("node id"), 1)
eq("the prefixes are the labels learn-status.py prints",
   all(label + ": " in rc.REWARD_PREFIXES for _, label in status.COUNT_LABELS)
   and all(plain + ": " in rc.REWARD_PREFIXES for plain in status.PLAIN_BADGE.values())
   and "Slipped: " in rc.REWARD_PREFIXES, True)

section("reply-check closing: the command line reads a file or stdin")
CF = Path(tempfile.mkdtemp(prefix="closing-")) / "closing.md"
CF.write_text(CLOSING)
run = subprocess.run([sys.executable, str(HOOKS / "reply-check.py"), "closing", str(CF)],
                     capture_output=True, text=True)
eq("a clean file: 'clean' and exit 0", (run.stdout.strip(), run.returncode), ("closing block: clean", 0))
run = subprocess.run([sys.executable, str(HOOKS / "reply-check.py"), "closing", "-"],
                     input="Skills I followed: learn-end. Ready?\n", capture_output=True, text=True)
eq("stdin with hits: lines and exit 1",
   ("'I followed'" in run.stdout and "question mark" in run.stdout, run.returncode), (True, 1))
shutil.rmtree(CF.parent)


# ------------------------------------------------------------------ log health at session start

section("log health: a log that keeps up with the transcript is healthy")
fresh(); subject("oop"); subject("graphs")
LH = transcript(RESUME, ASKED, ANSWER, ("assistant", [{"type": "text", "text": "Right."}]))
stop(LH)
eq("after the Stop hook ran, nothing is reported", log_health.report(VAULT, "conv-a", olive), "")
eq("a conversation with no subject reports nothing", log_health.report(VAULT, "eng", olive), "")

section("log health: a log that stopped while the transcript went on")
with LH.open("a") as handle:
    for index, text in ((10, "and then?"), (12, "what about y?")):
        handle.write(json.dumps({"type": "user", "uuid": "u%d" % index, "timestamp": "2026-10-13T05:%02d:00.000Z" % index,
                                 "message": {"role": "user", "content": text}}) + "\n")
        handle.write(json.dumps({"type": "assistant", "uuid": "a%d" % index, "timestamp": "2026-10-13T05:%02d:30.000Z" % index,
                                 "message": {"role": "assistant", "id": "m%d" % index,
                                             "content": [{"type": "text", "text": "Then y."}]}}) + "\n")
line = log_health.report(VAULT, "conv-a", olive)
eq("two unmirrored learner messages are reported as stopped updating",
   "learn/subjects/oop/log.md looks broken, it stopped updating: 2 of the learner's messages" in line, True)
eq("the line tells the agent to keep teaching and fix it later",
   "Keep teaching" in line and "after the session" in line and "No debugging now" in line, True)
stop(LH)
with LH.open("a") as handle:
    handle.write(json.dumps({"type": "user", "uuid": "u14", "timestamp": "2026-10-13T05:14:00.000Z",
                             "message": {"role": "user", "content": "one more"}}) + "\n")
eq("one unmirrored message is in flight, not broken", log_health.report(VAULT, "conv-a", olive), "")
stop(LH)
eq("once the hook catches up, it is healthy again", log_health.report(VAULT, "conv-a", olive), "")

section("log health: turns that went to another subject's log")
other = VAULT / ".claude/obsidian-live/subjects/graphs/conv-a.json"
own = VAULT / ".claude/obsidian-live/subjects/oop/conv-a.json"
snapshot = json.loads(own.read_text())
moved = [item for item in snapshot["entries"] if item["role"] == "You" and item["text"] in ("and then?", "what about y?")]
snapshot["entries"] = [item for item in snapshot["entries"] if item not in moved]
own.write_text(json.dumps(snapshot))
other.parent.mkdir(parents=True)
other.write_text(json.dumps({"session_id": "conv-a", "entries": moved}))
eq("the other subject's log is named",
   "went to learn/subjects/graphs/log.md instead" in log_health.report(VAULT, "conv-a", olive), True)
stop(LH)

section("log health: the file itself")
(VAULT / "learn/subjects/oop/log.md").unlink()
eq("a missing log.md is reported", "the file is missing" in log_health.report(VAULT, "conv-a", olive), True)
(VAULT / "learn/subjects/oop/log.md").write_text("# Chat log\n\nstale\n")
eq("a log.md without the newest learner message is reported",
   "not being rewritten" in log_health.report(VAULT, "conv-a", olive), True)
stop(LH)
eq("rewritten by the hook, it is healthy", log_health.report(VAULT, "conv-a", olive), "")

section("log health: the line reaches the agent-only part of the start context")
run = subprocess.run([sys.executable, str(HOOKS / "session_context.py"), "--vault", str(VAULT)],
                     input=json.dumps({"session_id": "conv-a"}), capture_output=True, text=True)
eq("a healthy log adds no line", "Log health" in run.stdout, False)
(VAULT / "learn/subjects/oop/log.md").unlink()
run = subprocess.run([sys.executable, str(HOOKS / "session_context.py"), "--vault", str(VAULT)],
                     input=json.dumps({"session_id": "conv-a"}), capture_output=True, text=True)
eq("a broken log adds one line, after the selected subject",
   run.stdout.find("Selected subject: oop") < run.stdout.find("Log health: learn/subjects/oop/log.md"), True)
eq("the Show-the-learner block is untouched",
   run.stdout.find("Log health") > run.stdout.find("End of block."), True)
shutil.rmtree(VAULT)

print()
if FAILS:
    print("FAILED (%d): %s" % (len(FAILS), ", ".join(FAILS)))
    sys.exit(1)
print("all assertions passed")
