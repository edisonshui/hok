#!/usr/bin/env python3
"""Generate Home, the learning dashboard, and per-subject progress notes from the records.

Everything here is derived, never authored. `record.md` and `plan.md` are the
source of truth; this script only re-presents them, so the dashboard cannot drift
out of step with the evidence the way a hand-maintained table does. That is also
why it takes no arguments and asks no questions: run it and the views are current.

It is deliberately a generator rather than a set of Dataview queries. Dataview can
only read frontmatter, and the node-level state lives in Markdown tables; querying
data you could simply render also adds a plugin dependency to a file that has to
open on a phone. Where Dataview does fit -- subject and session frontmatter -- see
`learn/Queries.md`.

Run: python3 .claude/hooks/learn-status.py [--vault PATH]
     python3 .claude/hooks/learn-status.py --next [--host claude|codex]  (read-only)
     python3 .claude/hooks/learn-status.py --rewards --subject SLUG --session NN  (read-only)
     python3 .claude/hooks/learn-status.py --rewards --review NN  (read-only)
     python3 .claude/hooks/learn-status.py --due [--gen]  (read-only)
     python3 .claude/hooks/learn-status.py --json [--host claude|codex]  (read-only; the app)
"""

import argparse
import html
import math
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import session_note  # noqa: E402
import slot_rotation  # noqa: E402
from vaultlib import STALE_HOURS, frontmatter, section, strip_frontmatter, theme_of  # noqa: E402

# Teaching order, worst to best.
STATUSES = ["decayed", "planned", "introduced", "checked", "solid", "skipped"]

# A node counts toward progress once it has passed a check, or was skipped because
# diagnosis showed the learner already had it. `introduced` is taught but unproven,
# so it is shown as partial: claiming it as progress would overstate the evidence.
COVERED = {"checked", "solid", "skipped"}
PARTIAL = {"introduced"}

NODE_ID = re.compile(r"\bn\d+[a-z]?\b")
MERMAID = re.compile(r"```mermaid\n(.*?)```", re.S)
CELL_BREAK = re.compile(r"(?<!\\)\|")
EDGE = re.compile(r"\b(n\d+[a-z]?)\b[^\n]*?-->[^\n]*?\b(n\d+[a-z]?)\b")


# --------------------------------------------------------------------- reading

def table_rows(text):
    """Pipe-table body rows as lists of stripped cells, skipping header and rule."""
    return pipe_rows(text)[1:]


def table_by_header(text):
    """Pipe-table body rows as dicts keyed by the header cells, so a column can
    be added or moved without shifting what every other lookup reads."""
    rows = pipe_rows(text)
    return [dict(zip(rows[0], cells)) for cells in rows[1:]] if rows else []


def pipe_rows(text):
    """Every pipe-table row, header included, as lists of stripped cells."""
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        # "\|" is a literal pipe inside a cell, as in |a|² in a math plan.
        cells = [cell.strip() for cell in CELL_BREAK.split(line.strip("|"))]
        if all(set(cell) <= set("-: ") for cell in cells):
            continue  # the |---|---| separator
        rows.append(cells)
    return rows


# A prerequisite in another subject, written `<slug>/nN` in the Prereqs cell
# (`records.md`, *Plan table*). Read before NODE_ID so its node id is not taken
# for one of this subject's own.
CROSS_PREREQ = re.compile(r"\b([a-z0-9][a-z0-9-]*[a-z0-9])/(n\d+[a-z]?)\b")


def read_nodes(record_text, plan_text):
    """Merge the node tables from record.md and plan.md, keyed by node id.

    record.md is authoritative for status (statuses move only on evidence, and the
    evidence lives there); plan.md supplies the name and declared prerequisites.
    """
    nodes = {}
    for cells in table_rows(section(record_text, "Nodes")):
        match = NODE_ID.search(cells[0])
        if not match:
            continue
        node = match.group(0)
        nodes[node] = {
            "id": node,
            # The live records separate a node id from its name three ways --
            # "n1 — Memory address", "n1 encapsulation", "n1. static vs. instance"
            # -- so the em and en dashes belong in the strip set with the ASCII one.
            "name": NODE_ID.sub("", cells[0], count=1).strip(" .,-\u2013\u2014"),
            "status": (cells[1] if len(cells) > 1 else "").strip().lower(),
            "checked": cells[2].strip() if len(cells) > 2 else "",
            "evidence": cells[3].strip() if len(cells) > 3 else "",
            "prereqs": [],
            "cross_prereqs": [],
            "plan_status": "",
        }
    for row in table_by_header(section(plan_text, "Nodes")):
        node = row.get("Id", "")
        if not NODE_ID.fullmatch(node):
            continue
        if not row.get("Node") and node not in nodes:
            continue  # the template's empty row: a plan still being diagnosed toward
        entry = nodes.setdefault(node, {"id": node, "name": row.get("Node", ""),
                                        "status": "", "checked": "", "evidence": "",
                                        "prereqs": [], "cross_prereqs": [], "plan_status": ""})
        if not entry["name"]:
            entry["name"] = row.get("Node", "")
        entry["can_do"] = row.get("Can do", "")
        # The header is "Rests on (unconditional truth)" in every live plan;
        # matching the prefix keeps a reworded parenthesis from losing the column.
        entry["truth"] = next((cell for key, cell in row.items() if key.startswith("Rests on")), None)
        cell = row.get("Prereqs", "")
        entry["cross_prereqs"] = CROSS_PREREQ.findall(cell)
        entry["prereqs"] = NODE_ID.findall(CROSS_PREREQ.sub(" ", cell))
        entry["plan_status"] = row.get("Status", "").lower()
        estimate = next((cell for key, cell in row.items() if key.startswith("Est")), "")
        found = re.search(r"\d+", estimate or "")
        entry["est"] = int(found.group()) if found else None
    # A prereq naming the node itself or an id not in the table is no edge.
    # It is dropped here and kept aside for consistency() to report.
    for node, entry in nodes.items():
        entry["can_do"] = entry.get("can_do") or entry["name"]
        entry["bad_prereqs"] = [p for p in entry["prereqs"] if p == node or p not in nodes]
        entry["prereqs"] = [p for p in entry["prereqs"] if p not in entry["bad_prereqs"]]
    return nodes


def read_notes(folder, now):
    """Every note in `folder` that has frontmatter, parsed, oldest first."""
    notes = [session_note.read(path, now=now)
             for path in (sorted(folder.glob("*.md")) if folder.is_dir() else [])]
    return [note for note in notes if note.fields]


def load_subjects(vault, now):
    """Every subject folder with a record.md, read once.

    Returns (subjects, missing): one dict per subject holding what the ranking,
    the rewards, and every view read, and the names of folders with no
    record.md, which are not subjects.
    """
    root = Path(vault) / "learn" / "subjects"
    subjects, missing = [], []
    for folder in sorted(path for path in root.glob("*") if path.is_dir()) if root.is_dir() else []:
        record, plan = folder / "record.md", folder / "plan.md"
        if not record.is_file():
            missing.append(folder.name)
            continue
        record_text = record.read_text()
        plan_text = plan.read_text() if plan.is_file() else ""
        subjects.append({
            "slug": folder.name, "folder": folder, "fields": frontmatter(record),
            "record_text": record_text, "plan_text": plan_text,
            "nodes": read_nodes(record_text, plan_text),
            "notes": read_notes(folder / "sessions", now),
            "events": evidence_events(record_text, note_starts(folder)),
        })
    return subjects, missing


def pace(subjects, course=None):
    """How long taught topics really took against the plan's estimates.

    Per subject: active minutes over every lesson session (diagnosis included,
    practice left out) against the summed *Est. min* of every node that has been
    taught. A subject with a lesson note whose minutes were never recorded is
    left out rather than undercounted. Returns (rows, median ratio or None).
    """
    rows = []
    for subject in subjects:
        slug = subject["slug"]
        if course and not slug.startswith(course + "-"):
            continue
        taught = [entry for entry in subject["nodes"].values()
                  if entry["status"] not in ("", "planned", "skipped")]
        estimated = sum(entry.get("est") or 0 for entry in taught)
        lessons = [note for note in subject["notes"] if note.fields.get("kind") != "practice"]
        minutes = [str(note.fields.get("active_minutes") or "").strip() for note in lessons]
        if not estimated or not minutes or not all(m.isdigit() for m in minutes):
            continue
        actual = sum(int(m) for m in minutes)
        if actual:
            rows.append((slug, actual, estimated, actual / estimated))
    ratios = sorted(row[3] for row in rows)
    middle = len(ratios) // 2
    median = None if not ratios else (
        ratios[middle] if len(ratios) % 2 else (ratios[middle - 1] + ratios[middle]) / 2)
    return rows, median


def pace_report(rows, median, course=None):
    scope = "%s subjects" % course if course else "subjects"
    if not rows:
        return "No %s with recorded minutes and taught topics yet.\n" % scope
    lines = ["%s: %d active min for %d estimated (%.1fx)" % (slug, actual, estimated, ratio)
             for slug, actual, estimated, ratio in rows]
    lines.append("Median over %d %s: %.1fx" % (len(rows), scope, median))
    return "\n".join(lines) + "\n"


def rank_inputs(subjects):
    """The (slug, nodes, fields, events) tuples `rank()` and `rewards()` take."""
    return [(s["slug"], s["nodes"], s["fields"], s["events"]) for s in subjects]


def note_inputs(subjects):
    """The (slug, session note) pairs `rank()` takes."""
    return [(s["slug"], note) for s in subjects for note in s["notes"]]


# ------------------------------------------------------ transition markers

# The node table keeps only a node's current status, so its history -- when it
# reached solid, how often it lapsed -- is read from the `→ nN <status>` endings
# on evidence lines (spec section 1, `CONTEXT.md`, *Transition marker*).

MARKER = re.compile(r"(n\d+[a-z]?) (%s)" % "|".join(STATUSES))
EVIDENCE_LINE = re.compile(r"^- (\d{4}-\d{2}-\d{2})\b\W*([sr]\d+\b)?")
NOTE_STEM = re.compile(r"^(\d{4}-\d{2}-\d{2})-([sr]\d+)$")

# On since the marker backfill (ticket 04) gave every existing evidence line its
# marker. Switching it off hides a proven node whose markers were never written.
MARKERS_REQUIRED = True


def markers(line):
    """The (node, status) pairs in the trailing run of markers, in line order.

    Nothing may follow the last marker, so a line whose final `→` segment is not
    a marker has none, even if a marker appears earlier in it.
    """
    found = []
    for segment in reversed(line.split("→")[1:]):
        match = MARKER.fullmatch(segment.strip())
        if not match:
            break
        found.append((match.group(1), match.group(2)))
    return found[::-1]


# A generation check makes the learner derive an answer from a node's
# unconditional truth rather than recall it (`tutor.md`, *Checks and quizzes*).
# Its evidence line carries the tag right after the colon that ends the date and
# source, so the markers and everything read from them parse exactly as before
# (`records.md`, *Evidence rule*). A tag anywhere else, such as inside the
# question text, is not one.
GEN_TAGGED = re.compile(r"^- \d{4}-\d{2}-\d{2}\b[^:→]*:\s*\[gen\]")

# An allow-list, not a deny-list: real verdicts on a miss that still left the
# node `checked` read "correct at rung 2.", "(a) wrong (...)", "incomplete.". Only
# a clean pass, with no help or doubt named, credits a node. A line with more
# than one marker credits none: one verdict over several nodes ("correct for n4,
# wrong for n5") cannot say which node passed, so each node gets its own line.
PASS_VERDICT = re.compile(r"^(correct|right)\b", re.I)
HELPED_VERDICT = re.compile(r"\b(hints?|rung|pointer|supplied|after|partial|partially|but|though|guess\w*)\b",
                            re.I)


def generation_pass(line):
    """True when an evidence line is a tagged generation check about one node
    with a clean pass verdict."""
    segments = line.split("→")
    if not GEN_TAGGED.match(line) or len(markers(line)) != 1 or len(segments) < 3:
        return False
    verdict = segments[-2].strip()
    return bool(PASS_VERDICT.match(verdict)) and not HELPED_VERDICT.search(verdict)


def note_starts(folder):
    """{(date, "sNN" or "rNN"): start time} for a subject's session notes and the
    vault's review notes, the notes an evidence line can name."""
    starts = {}
    for notes in (folder / "sessions", folder.parent.parent / "reviews"):
        for path in sorted(notes.glob("*.md")) if notes.is_dir() else []:
            stem = NOTE_STEM.match(path.stem)
            start = frontmatter(path).get("start", "")
            if stem and start:
                starts[(stem.group(1), stem.group(2))] = start
    return starts


def evidence_events(record_text, starts):
    """One event per marker in the *Evidence log*, in the order they happened.

    Order is (date, the `start:` of the note the line names, position in the
    log): the log is append-only, but a review can be logged above a session
    from earlier the same day. A line whose note is missing has no start time,
    so it sorts by date then position, ahead of that day's timed lines.
    """
    events = []
    bullets = [line for line in section(record_text, "Evidence log").splitlines()
               if line.startswith("- ")]
    for position, line in enumerate(bullets):
        head = EVIDENCE_LINE.match(line)
        date, source = (head.group(1), head.group(2) or "") if head else ("", "")
        generated = generation_pass(line)
        for node, status in markers(line):
            events.append({"date": date, "source": source, "position": position,
                           "start": starts.get((date, source), ""),
                           "node": node, "status": status,
                           "generation": generated and status in ("checked", "solid")})
    events.sort(key=lambda event: (event["date"], event["start"], event["position"]))
    return events


def lapses(events):
    """Each `decayed` event whose previous marker for that node is not `decayed`
    (`CONTEXT.md`, *Lapse*). A check that leaves a decayed node decayed is not
    a new lapse."""
    found, last = [], {}
    for event in events:
        if event["status"] == "decayed" and last.get(event["node"]) != "decayed":
            found.append(event)
        last[event["node"]] = event["status"]
    return found


def has_truth(node):
    """False when the plan's *Rests on* cell says the node has no unconditional
    truth: empty, a dash, or naming no (new) unconditional truth, as the
    integrative review nodes do. A node with no plan row is given the benefit of
    the doubt, since its cell was never written rather than written empty."""
    cell = node.get("truth")
    if cell is None:
        return True
    cell = cell.strip()
    return not (not cell or cell.startswith(("\u2014", "-"))
                or re.search(r"no (new )?unconditional truth", cell, re.I))


def generation_eligible(nodes):
    """Ids of `checked` or `solid` nodes that rest on an unconditional truth, in
    plan order: the only nodes a generation check can be asked of."""
    return [node for node in sorted(nodes, key=sort_key)
            if nodes[node].get("status") in ("checked", "solid") and has_truth(nodes[node])]


def recall_only(nodes, events):
    """Ids of eligible nodes with no passed generation check in their evidence,
    in plan order. Brain A, which memorized the answers, could have passed every
    check these nodes have. A node with no unconditional truth is left out: the
    skills forbid a generation check on it, so flagging it could never clear.
    Reported on the dashboard only: it changes no status, reward, or `--due`
    ranking."""
    generated = {event["node"] for event in events if event.get("generation")}
    return [node for node in generation_eligible(nodes) if node not in generated]


# ------------------------------------------------------ the review picker (Phase 5)

# A node reaches `solid` only by passing a retrieval check in a later session, and
# until `/learn-review` existed the only path to one ran through `/learn-resume` of
# that single subject. A `done` subject never gets resumed, so its `checked` nodes
# could never move -- eight of them across three subjects when this was written.
#
# `due()` is the seam the two callers share. Both ask the same question, "which
# node has gone longest without evidence", and differ only in scope: `/learn-check`
# asks it of the subject in front of it, `/learn-review` asks it of the whole
# vault. Nothing about it goes to Jev: PLAN-2026-09-22.md is explicit that a date
# comparison stays in code, and this one was previously being done by eye across
# five `record.md` files.

# Only these have ever produced a check, so "time since the last one" is a question
# about them and about nothing else. A `planned` or `introduced` node is not stale,
# it is unstarted, and putting one in a review would ask the learner to retrieve
# something they were never taught.
DECAYABLE = ("checked", "solid", "decayed")

ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def days_since(checked, today):
    """Days between a *Last checked* cell and `today`, or None if it holds no date.

    The cell is written three ways across the live records: a bare `2026-09-17`,
    a `2026-09-18 s01` carrying its session, and an em dash for a node with no
    check yet. Only the date is load-bearing, so everything around it is ignored
    rather than parsed. A cell with no usable date returns None so the caller can
    report it -- treating it as zero days would quietly rank an unchecked node as
    the freshest thing in the vault.
    """
    when = to_date(checked)
    return (today - when).days if when else None


def due(subjects, today, subject=None, per_subject=2, limit=None):
    """Nodes ranked by time since their last check, most stale first.

    `subjects` is a list of (slug, nodes) as `read_nodes` returns them, which is
    what makes this pure and testable without a vault on disk.

    `per_subject` caps how many nodes one subject contributes, applied *before*
    `limit` so a single long-neglected subject cannot fill an entire review set
    and crowd out the spacing across the others. `per_subject=None` lifts the cap.

    Returns `(rows, undated)`. `undated` holds every eligible node whose *Last
    checked* has no date in it: reported, never ranked, because a node whose
    status says it passed a check and whose date cell is empty is a record defect
    (G5 flags it too) and not something to silently order.
    """
    rows, undated = [], []
    for slug, nodes in subjects:
        if subject is not None and slug != subject:
            continue
        for node in sorted(nodes.values(), key=lambda entry: sort_key(entry["id"])):
            if node.get("status") not in DECAYABLE:
                continue
            row = {"subject": slug, "id": node["id"], "name": node.get("name", ""),
                   "status": node["status"], "checked": node.get("checked", ""),
                   "evidence": node.get("evidence", "")}
            days = days_since(node.get("checked", ""), today)
            if days is None:
                undated.append(row)
                continue
            rows.append(dict(row, days=days))

    if per_subject is not None:
        kept, seen = [], {}
        for row in sorted(rows, key=lambda row: (-row["days"], row["subject"], sort_key(row["id"]))):
            if seen.get(row["subject"], 0) >= per_subject:
                continue
            seen[row["subject"]] = seen.get(row["subject"], 0) + 1
            kept.append(row)
        rows = kept

    rows.sort(key=lambda row: (-row["days"], row["subject"], sort_key(row["id"])))
    return (rows[:limit] if limit else rows), undated


# --------------------------------------------- the due rule and the ranking

# `due()` above ranks staleness for picking questions; `is_due()` answers the
# yes-or-no question the ranking and the streak ask (spec section 3, `CONTEXT.md`,
# *Due*). A decayed node is never due: it needs repair, not review.
DUE_DAYS = {"checked": 3, "solid": 7}

# A deadline counts from 7 days ahead through the deadline day. The same span
# opens the due window and lists the subject under Deadline, so a subject is
# never in one and not the other.
DEADLINE_DAYS = 7


def to_date(text):
    """The first ISO date in `text` as a date, or None."""
    match = ISO_DATE.search(text or "")
    if not match:
        return None
    try:
        return datetime.strptime(match.group(0), "%Y-%m-%d").date()
    except ValueError:
        return None  # well-shaped but impossible, e.g. 2026-13-45


def days_to_deadline(deadline, today):
    """Days from `today` to a `deadline:` value, or None if it holds no date."""
    when = to_date(deadline)
    return (when - today).days if when else None


def in_deadline_window(deadline, today):
    """Whether `today` falls from 7 days before `deadline` through the deadline."""
    left = days_to_deadline(deadline, today)
    return left is not None and 0 <= left <= DEADLINE_DAYS


def is_due(node, today, deadline=None):
    """Whether a node should be checked again on `today`."""
    if node.get("status") not in DUE_DAYS:
        return False
    checked = to_date(node.get("checked"))
    if checked is None:
        return False
    if (today - checked).days >= DUE_DAYS[node["status"]]:
        return True
    if in_deadline_window(deadline, today):
        return checked < to_date(deadline) - timedelta(days=DEADLINE_DAYS)
    return False


def short_date(when):
    """`22 Sep`, the form every reason and welcome phrase uses."""
    return "%d %s" % (when.day, when.strftime("%b"))


def next_node(nodes):
    """The first `planned` node in plan order whose prereqs are all proven,
    else the first `planned` node, else None."""
    planned = [nodes[node] for node in sorted(nodes, key=sort_key) if nodes[node]["status"] == "planned"]
    ready = [entry for entry in planned
             if all(nodes.get(p, {}).get("status") in COVERED for p in entry.get("prereqs", []))]
    return (ready or planned or [None])[0]


def plural(count, word):
    return "%d %s%s" % (count, word, "" if count == 1 else "s")


def candidate(kind, slug, title, command, reason, welcome):
    return {"kind": kind, "subject": slug, "title": title, "command": command,
            "reason": reason, "welcome": welcome}


def repair(slug, title, nodes, events):
    """The Repair candidate for a subject, with its sort key, or None."""
    decayed = [entry for entry in nodes.values() if entry["status"] == "decayed"]
    if not decayed:
        return None
    lapsed = lapses(events)
    slipped = []
    for entry in decayed:
        own = [event for event in lapsed if event["node"] == entry["id"]]
        when = to_date(own[-1]["date"]) if own else to_date(entry["checked"])
        slipped.append((when or datetime.max.date(), sort_key(entry["id"]), entry, len(own)))
    slipped.sort(key=lambda item: item[:2])
    first, entry = slipped[0][0], slipped[0][2]
    name, date = "*%s*" % entry["name"], short_date(first)
    reason = ("%s slipped on %s" % (name, date) if len(slipped) == 1 else
              "%s and %d more slipped, the first on %s" % (name, len(slipped) - 1, date))
    welcome = ("bring back %s in %s. It slipped on %s, and one short session puts it back"
               % (name, title, date))
    key = (-len(slipped), first, -max(item[3] for item in slipped), slug)
    return candidate("Repair", slug, title, "learn-resume " + slug, reason, welcome), key


def review(due_nodes, titles, slug=None):
    """The Review candidate over `due_nodes`, a list of (slug, node), or None."""
    if not due_nodes:
        return None
    oldest_slug, oldest = min(due_nodes, key=lambda item: (to_date(item[1]["checked"]), item[0],
                                                           sort_key(item[1]["id"])))
    count = len(due_nodes)
    spread = sorted({item[0] for item in due_nodes})
    where = ("in %s" % titles[spread[0]] if len(spread) == 1
             else "across %d subjects" % len(spread))
    reason = ("%s %s due %s, oldest *%s* (last checked %s)"
              % (plural(count, "node"), "is" if count == 1 else "are", where, oldest["name"],
                 short_date(to_date(oldest["checked"]))))
    welcome = ("review the %s that %s due, oldest *%s* from %s"
               % (plural(count, "node"), "is" if count == 1 else "are", oldest["name"],
                  titles[oldest_slug]))
    command = "learn-review" + (" " + slug if slug else "")
    return candidate("Review", slug, titles[slug] if slug else None, command, reason, welcome)


# Statuses a learner can pick back up. `diagnosing` is here because
# `/learn-resume` continues a paused diagnosis (its skill, step 1); leaving it
# out hid a subject with an exam a week away from Home and from the Deadline slot.
RESUMABLE = ("active", "paused", "diagnosing")


def resume(slug, title, nodes, fields, open_stem, today):
    """The Resume candidate, naming a passed deadline or an open note if any."""
    upcoming = next_node(nodes)
    if fields.get("status") == "diagnosing":
        reason = "finish the diagnosis, then build the plan"
        welcome = "finish the diagnosis for %s, then build its plan" % title
    elif upcoming:
        reason = "*%s* is next" % upcoming["name"]
        welcome = "continue %s, where *%s* is next" % (title, upcoming["name"])
    elif nodes and all(entry["status"] in COVERED for entry in nodes.values()):
        # Nothing left to teach: "continue the plan" promised a lesson that
        # does not exist. Its due nodes are already under Review.
        reason = "every planned topic is passed, so this is a wrap-up"
        welcome = "wrap up %s, where every planned topic is passed" % title
    else:
        reason, welcome = "continue the plan", "continue %s" % title
    extra = []
    left = days_to_deadline(fields.get("deadline"), today)
    if left is not None and left < 0:
        extra.append("The deadline (%s) has passed." % short_date(to_date(fields["deadline"])))
    if open_stem:
        extra.append("Its open %s note is closed out first." % open_stem)
    if extra:
        reason = " ".join([reason + "."] + extra)
    return candidate("Resume", slug, title, "learn-resume " + slug, reason, welcome)


def rank(subjects, notes, today):
    """The recommended actions, best first (spec section 3, `CONTEXT.md`,
    *Recommended action*).

    `subjects` is a list of (slug, nodes, fields, events): `read_nodes`, the
    record's frontmatter, and `evidence_events`. `notes` is a list of (slug,
    session note) as `session_note.read` returns them. Reads nothing else, so
    rewards cannot move it and running it changes nothing.
    """
    titles = {slug: fields.get("title", slug) for slug, _, fields, _ in subjects}
    listed, ranked = set(), []

    breaks = sorted(((note.hours, slug, note) for slug, note in notes if note.status == "live break"),
                    key=lambda item: item[:2])
    for _, slug, note in breaks:
        paused = note.fields.get("paused", "")
        ranked.append(candidate("Continue a break", slug, titles.get(slug, slug), "learn-resume " + slug,
                                "your session paused at %s" % paused,
                                "pick your %s session back up; the break started at %s"
                                % (titles.get(slug, slug), paused)))
        listed.add(slug)

    open_stems = {}
    for slug, note in notes:
        if note.status in ("open", "stale pause"):
            open_stems[slug] = note.name.rsplit("-", 1)[-1]

    deadlines = []
    for slug, nodes, fields, events in subjects:
        if not in_deadline_window(fields.get("deadline"), today):
            continue
        left = days_to_deadline(fields.get("deadline"), today)
        title = titles[slug]
        repaired = repair(slug, title, nodes, events)
        found = repaired[0] if repaired else review(
            [(slug, entry) for entry in nodes.values() if is_due(entry, today, fields.get("deadline"))],
            titles, slug)
        if not found and fields.get("status") in RESUMABLE:
            found = resume(slug, title, nodes, fields, open_stems.get(slug), today)
        if not found:
            continue
        when = "today" if left == 0 else "in " + plural(left, "day")
        found = dict(found, kind="Deadline",
                     reason="deadline %s: %s" % (when, found["reason"]),
                     welcome="%s's deadline is %s, so %s" % (title, when, found["welcome"]))
        deadlines.append(((left, slug), found))
    for _, found in sorted(deadlines, key=lambda item: item[0]):
        ranked.append(found)
        listed.add(found["subject"])

    # Only a Deadline listing takes a subject out of Repair: a break and a
    # decayed node are two different things to do.
    on_deadline = {found["subject"] for _, found in deadlines}
    repairs = [repair(slug, titles[slug], nodes, events)
               for slug, nodes, fields, events in subjects if slug not in on_deadline]
    for found, _ in sorted((item for item in repairs if item), key=lambda item: item[1]):
        ranked.append(found)
        listed.add(found["subject"])

    across_subjects = review([(slug, entry) for slug, nodes, fields, _ in subjects
                         for entry in nodes.values() if is_due(entry, today, fields.get("deadline"))],
                        titles)
    if across_subjects:
        ranked.append(across_subjects)

    resumes = []
    for slug, nodes, fields, _ in subjects:
        if slug in listed or fields.get("status") not in RESUMABLE:
            continue
        left = days_to_deadline(fields.get("deadline"), today)
        last = to_date(fields.get("last_session"))
        # A deadline still ahead goes first, soonest first: an exam next week
        # outranks a subject with none, even before the Deadline window opens.
        ahead = left if left is not None and left >= 0 else None
        key = (left is not None and left < 0, ahead is None, ahead or 0,
               -(last.toordinal() if last else 0), slug)
        resumes.append((key, resume(slug, titles[slug], nodes, fields, open_stems.get(slug), today)))
    ranked += [found for _, found in sorted(resumes, key=lambda item: item[0])]

    ranked.append(candidate("Start", None, None, "learn-start", "start something new", ""))
    return ranked


def next_report(ranked, host="claude"):
    """`--next`: one candidate per line, commands in the host's form."""
    sigil = "$" if host == "codex" else "/"
    return "\n".join("%d. %s · %s · %s%s · %s"
                     % (number, found["kind"], found["title"] or "any subject", sigil,
                        found["command"], found["reason"])
                     for number, found in enumerate(ranked, 1))


# ------------------------------------------------------------ derived rewards

# Rewards are read from the records every time and never stored (spec section 2,
# `CONTEXT.md`, *Reward*). Only markers dated on or before `today` count, and a
# caller can drop marker lines to get the state without them.

BADGE_ORDER = ["Goal met", "Recovered", "Solid"]

REWARDS_ON, REWARDS_OFF = {"on", "true", "yes"}, {"off", "false", "no"}


def rewards_setting(vault):
    """(on, warning) from `rewards:` in `learn/me/preferences.md` (spec section 4).

    Missing means on. An unknown value means off, since showing rewards the
    learner may have tried to turn off is the worse mistake, and the warning
    puts it under *Record inconsistencies*. `frontmatter()` keeps a trailing
    `# comment`, and the file ships with one, so it is cut here.
    """
    raw = frontmatter(Path(vault) / "learn" / "me" / "preferences.md").get("rewards", "")
    value = re.sub(r"(^|\s+)#.*$", "", raw).strip().strip("\"'").lower()
    if not value or value in REWARDS_ON:
        return True, None
    if value in REWARDS_OFF:
        return False, None
    return False, ("learn/me/preferences.md: `rewards: %s` is not on or off, so rewards are off "
                   "(use on, true, yes, off, false, or no)" % value)


def badge(kind, slug, title, node, name, date):
    return {"kind": kind, "subject": slug, "title": title, "node": node, "name": name,
            "date": date, "text": "%s: %s, %s" % (kind, name, date)}


def rewards(subjects, today):
    """The learner's reward state on `today`.

    `subjects` is a list of (slug, nodes, fields, events), the same shape
    `rank()` takes. Returns a dict of badges and the rest; writes nothing.
    """
    stamp = today.isoformat()
    badges, recoveries = [], []
    counts = {"nodes_proven": 0, "checks_passed": 0, "goals_met": 0}
    for slug, nodes, fields, events in subjects:
        title = fields.get("title", slug)
        goal = to_date(fields.get("goal_met"))
        if goal and goal <= today:
            counts["goals_met"] += 1
            badges.append(badge("Goal met", slug, title, None, title, goal.isoformat()))
        dated = [event for event in events if event["date"] and event["date"] <= stamp]
        lapse_events = [id(event) for event in lapses(dated)]
        solid, lapsed, proven = set(), {}, set()  # lapsed: node -> date of its open lapse
        for event in dated:
            node, name = event["node"], nodes.get(event["node"], {}).get("name") or event["node"]
            if event["status"] in ("checked", "solid"):
                proven.add(node)
            if id(event) in lapse_events:
                lapsed[node] = event["date"]
            elif event["status"] == "solid":
                counts["checks_passed"] += 1
                if node not in solid:
                    solid.add(node)
                    badges.append(badge("Solid", slug, title, node, name, event["date"]))
                if lapsed.pop(node, None):
                    badges.append(badge("Recovered", slug, title, node, name, event["date"]))
        # A node is proven from its first checked or solid marker, and a decay
        # after that takes nothing away (spec section 2, *Counts*). A skipped
        # node has no check to mark, and a status with no marker at all is
        # counted from the table, which marker_warnings() already reports.
        marked = {event["node"] for event in events}
        counts["nodes_proven"] += sum(
            1 for node, entry in nodes.items()
            if node in proven or entry.get("status") == "skipped"
            or (entry.get("status") in DECAYABLE and node not in marked))
        recoveries += [{"subject": slug, "title": title, "node": node,
                        "name": nodes.get(node, {}).get("name") or node, "date": date}
                       for node, date in sorted(lapsed.items(), key=lambda item: sort_key(item[0]))]
    # Newest first; on one date a goal, then a recovery, then a solid (spec section 8).
    badges.sort(key=lambda found: (BADGE_ORDER.index(found["kind"]), found["title"],
                                   sort_key(found["node"]) if found["node"] else (0, "")))
    badges.sort(key=lambda found: found["date"], reverse=True)
    streak = review_streak(subjects, today)
    counts.update(current_streak=streak["current"], best_streak=streak["best"])
    return {"badges": badges, "open_recoveries": recoveries, "counts": counts, "streak": streak}


# A missed week is forgiven unless another forgiven miss fell this many weeks
# before it, so one miss in any four weeks costs nothing.
FORGIVE_WEEKS = 3


def review_streak(subjects, today):
    """The weekly review streak on `today` (spec section 2, `CONTEXT.md`,
    *Review streak*).

    A node is due on a day by `is_due()` applied to its last marker on or
    before that day, so the streak and the ranking share one due rule. Each
    week is `pass`, `neutral`, `repaired`, `forgiven`, `miss`, or `pending`;
    only a miss resets the current streak, and only a pass adds to it.
    """
    history, deadlines, solids = {}, {}, {}
    for slug, _, fields, events in subjects:
        deadlines[slug] = fields.get("deadline")
        for event in events:
            when = to_date(event["date"])
            if not when or when > today:
                continue
            key = (slug, event["node"])
            history.setdefault(key, []).append((when, event["status"]))
            if event["status"] == "solid":
                solids.setdefault(monday(when), set()).add(key)
    if not history:
        return {"current": 0, "best": 0, "alive": False, "weeks": []}

    first = min(when for markers in history.values() for when, _ in markers)
    this_week = monday(today)
    starts, weeks, start = [], [], monday(first)
    while start <= this_week:
        days = [start + timedelta(days=offset) for offset in range(7)]
        starts.append(start)
        weeks.append({"start": start.isoformat(), "due": sorted(
            key for key, markers in history.items()
            if any(is_due_on(markers, day, deadlines[key[0]]) for day in days if first <= day <= today))})
        start += timedelta(days=7)

    current = best = 0
    forgiven = []
    for index, (start, week) in enumerate(zip(starts, weeks)):
        if start in solids:
            result = "pass"
            current += 1
        elif start == this_week:
            result = "pending"  # it can still pass
        elif not week["due"]:
            result = "neutral"
        elif set(week["due"]) & solids.get(start + timedelta(days=7), set()):
            result = "repaired"
        elif start == this_week - timedelta(days=7):
            result = "pending"  # it can still be repaired this week
        elif any(index - FORGIVE_WEEKS <= earlier < index for earlier in forgiven):
            result = "miss"
            current = 0
        else:
            result = "forgiven"
            forgiven.append(index)
        best = max(best, current)
        week["result"] = result
    return {"current": current, "best": best, "alive": current > 0, "weeks": weeks}


def monday(day):
    """The Monday that starts `day`'s week."""
    return day - timedelta(days=day.weekday())


def is_due_on(markers, day, deadline):
    """Whether a node with these (date, status) markers, in event order, was
    due on `day`. Its state is its last marker on or before that day."""
    state = None
    for when, status in markers:
        if when > day:
            break
        state = {"status": status, "checked": when.isoformat()}
    return bool(state) and is_due(state, day, deadline)


# ------------------------------------------------------------ reward lines

# `--rewards` prints the only reward text the tutor may show, pasted verbatim
# into the `/learn-end` or `/learn-review` closing block (spec section 11,
# `CONTEXT.md`, *Reward line*). It compares the reward state with and without
# the scope's marker lines, so it can only name what that session or review
# added. Record voice: facts, no praise, no exclamation marks, no emoji.
# Edison reads these lines at the end of a session, so they are plain English,
# not the record's terms (2026-10-13): a node is a topic, a solid check is a
# topic remembered on a later day. Home and the dashboard keep the short badge
# names.

MAX_REWARD_LINES = 4
COUNT_LABELS = [("nodes_proven", "Topics passed"), ("checks_passed", "Topics remembered on a later day"),
                ("goals_met", "Goals reached")]
STRAND_TAG = re.compile(r"\s*\(S\d+\)\s*$")  # "Writing equals (S4)": the strand number is record shorthand
PLAIN_BADGE = {"Goal met": "Goal reached", "Recovered": "Remembered again after slipping",
               "Solid": "Remembered on a later day"}


def same_source(source, letter, number):
    """Whether an evidence line's `sNN` or `rNN` names this session or review.
    `number` may be written `3`, `03`, or `s03`."""
    digits = re.sub(r"\D", "", str(number))
    return bool(digits) and bool(re.fullmatch(r"%s0*%d" % (letter, int(digits)), source or ""))


def weeks_word(count):
    return plural(count, "week")


def reward_lines(subjects, today, subject=None, session=None, review=None, session_date=None):
    """The closing block's reward lines, at most four, or [] (spec section 11).

    `subjects` is the (slug, nodes, fields, events) list `rewards()` takes. With
    `review`, the scope is that review's lines in every subject; otherwise it
    is session `session` of `subject`, and a Goal met badge is in scope when
    `goal_met:` equals `session_date`. The rewards setting is the caller's to
    check: this always answers as if rewards were on.
    """
    if review is not None:
        in_scope = lambda slug, event: same_source(event["source"], "r", review)  # noqa: E731
    else:
        in_scope = lambda slug, event: slug == subject and same_source(event["source"], "s", session)  # noqa: E731
    before_inputs = []
    for slug, nodes, fields, events in subjects:
        kept = dict(fields)
        if (review is None and slug == subject and session_date
                and to_date(fields.get("goal_met")) == to_date(session_date)):
            kept.pop("goal_met", None)
        outside = [e for e in events if not in_scope(slug, e)]
        # A node the scope moved stands, before it, where its last marker
        # outside the scope left it. Its table status is the after state.
        moved = {e["node"] for e in events if in_scope(slug, e)}
        last = {e["node"]: e["status"] for e in outside}
        before_nodes = {node: (dict(entry, status=last.get(node, "planned")) if node in moved else entry)
                        for node, entry in nodes.items()}
        before_inputs.append((slug, before_nodes, kept, outside))
    before, after = rewards(before_inputs, today), rewards(subjects, today)

    def key(found):
        return (found["kind"], found["subject"], found["node"], found["date"])
    had = {key(found) for found in before["badges"]}
    earned = sorted((found for found in after["badges"] if key(found) not in had),
                    key=lambda found: (found["date"], BADGE_ORDER.index(found["kind"])))
    was_open = {(r["subject"], r["node"], r["date"]) for r in before["open_recoveries"]}
    opened = [r for r in after["open_recoveries"] if (r["subject"], r["node"], r["date"]) not in was_open]

    def name(found):
        return STRAND_TAG.sub("", found["name"])
    badge_lines = ["%s: %s" % (PLAIN_BADGE[found["kind"]], name(found)) for found in earned]
    # A topic can slip and pass again in the same session. It still counts as
    # slipped until a later session, but the line says so, or it contradicts
    # the "passed today" line the closing block prints under it.
    status_of = {(slug, node): entry.get("status")
                 for slug, nodes, _, _ in subjects for node, entry in nodes.items()}

    def slipped(r):
        again = status_of.get((r["subject"], r["node"])) in ("checked", "solid")
        return name(r) + (" (passed again this session)" if again else "")
    recovery = (["Slipped: %s. Get it right in a later session and it counts as remembered again."
                 % ", ".join(slipped(r) for r in opened)] if opened else [])
    changed = ["%s: %d → %d" % (label, before["counts"][name], after["counts"][name])
               for name, label in COUNT_LABELS if before["counts"][name] != after["counts"][name]]
    counts = [" · ".join(changed)] if changed and review is None else []

    weeks_before, weeks_after = before["streak"]["weeks"], after["streak"]["weeks"]
    streak_now = after["streak"]["current"]
    if review is not None:
        turned = bool(weeks_after) and weeks_after[-1]["result"] == "pass" and (
            not weeks_before or weeks_before[-1]["result"] != "pass")
        repaired = (len(weeks_after) > 1 and weeks_after[-2]["result"] == "repaired"
                    and (len(weeks_before) < 2 or weeks_before[-2]["result"] != "repaired"))
        streak = ["Review streak: %s" % weeks_word(streak_now)] if (turned or repaired) and streak_now else []
    else:
        due_now = sum(1 for _, nodes, fields, _ in subjects for entry in nodes.values()
                      if is_due(entry, today, fields.get("deadline")))
        this_week_passed = bool(weeks_after) and weeks_after[-1]["result"] == "pass"
        if due_now and not this_week_passed:
            streak = ["This week's review isn't done yet: %s %s due for a re-check"
                      % (plural(due_now, "older topic"), "is" if due_now == 1 else "are")]
        elif after["streak"]["alive"]:
            streak = ["Review streak: %s" % weeks_word(streak_now)]
        else:
            streak = []
        if not badge_lines and not counts:
            return recovery  # nothing earned: only an opened recovery is ever named

    if len(earned) > 2 or len(badge_lines + recovery + counts + streak) > MAX_REWARD_LINES:
        if len(earned) > 1:
            badge_lines = ["%d wins: %s" % (len(earned), " · ".join(
                "%s (%s)" % (name(found), PLAIN_BADGE[found["kind"]].lower()) for found in earned))]
    return (badge_lines + recovery + counts + streak)[:MAX_REWARD_LINES]


# The suffix `--due --gen` puts on a generation candidate's line. Only that flag
# adds it, so plain `--due`, which `/learn-check` also reads, prints as before.
GEN_CANDIDATE = "  · gen candidate"


def due_report(rows, undated, candidates=frozenset()):
    """`--due` as the tutor and Edison read it. One node per line, stalest first.

    `candidates` holds the (subject, node) pairs `--gen` marks: recall-only and
    resting on an unconditional truth. A review asks its one generation question
    of the first marked line in its picked set, so the choice is the picker's,
    not the tutor's.
    """
    out = []
    for row in rows:
        out.append("%4dd  %-34s %-4s [%s] last %s — %s"
                   % (row["days"], row["subject"], row["id"], row["status"],
                      row["checked"] or "?", row["name"] or "?")
                   + (GEN_CANDIDATE if (row["subject"], row["id"]) in candidates else ""))
        if row["evidence"]:
            out.append("        last evidence: %s" % row["evidence"])
    for row in undated:
        out.append("   ??  %-34s %-4s [%s] Last checked holds no date — fix the record "
                   "before reviewing it" % (row["subject"], row["id"], row["status"]))
    if not out:
        out.append("nothing is due: no node has a logged check to be stale.")
    return "\n".join(out)


# --------------------------------------------------------------------- checking

def command_form(command, host):
    """A skill command as a host types it: `/learn-...` for Claude, `$learn-...`
    for Codex, and bare for `host=None`, the form Home and the Dashboard print
    because both hosts read them."""
    return {"claude": "/", "codex": "$"}.get(host, "") + command


def open_notes(notes, subject, host="claude"):
    """Report every session note whose `end:` is still empty.

    `/learn-resume` is required to finalize a stale or cut-off note before opening
    the next one (records.md, *Closing an open note*). Nothing used to force it:
    skipping the finalize left no mark in any file, so an abandoned note simply
    stayed open and the next resume orphaned it silently -- which is how s03 sat
    open for twenty-five hours. Surfacing every open note is what turns that rule
    from prose into something whose violation is visible.

    `session_note` computes the status against the `now` it was parsed with; this
    only words it. It reports and never repairs, for the same reason
    `consistency` does: the fix is a judgement about what the session actually
    covered, and a generator that closed notes on its own would manufacture
    exactly the false record the system is built to prevent.
    """
    reports = []
    for note in notes:
        if note.status == "closed":
            continue
        label = "%s %s" % (subject, note.name or "?")
        if note.hours is None:
            reports.append("%s: `end:` is empty and its `date:`/`start:` cannot be read, "
                           "so its age is unknown -- finalize it by hand" % label)
        elif note.hours < 0:
            reports.append("%s: `end:` is empty and its %s time is %.1f h in the future -- "
                           "check the note's `date:` field" % (label, note.anchor, -note.hours))
        elif note.status == "open":
            reports.append("%s: `end:` is empty with no `paused:` -- cut off %.1f h ago without "
                           "`%s`. `%s` must finalize it before opening the next note."
                           % (label, note.hours, command_form("learn-end", host),
                              command_form("learn-resume", host)))
        elif note.status == "stale pause":
            reports.append("%s: paused %.1f h ago, past the %d h bound -- a stale pause, not a break. "
                           "`%s` must finalize it before opening the next note."
                           % (label, note.hours, STALE_HOURS, command_form("learn-resume", host)))
        else:
            reports.append("%s: paused %.1f h ago, inside the %d h bound -- a live break. "
                           "`%s` reopens this note and skips the decay check."
                           % (label, note.hours, STALE_HOURS, command_form("learn-resume " + subject, host)))
    return reports


def g1_resume_bounds(slug, resume_path, plan_path):
    """G1: resume.md stays under 200 words, and it and plan.md carry subject/updated.

    `workflow.md` step 4 and `records.md:13` say `resume.md` is rewritten from
    scratch every time under a 200-word bound; `records.md:96` requires `subject`
    and `updated` in both files. A missing `subject` broke `session-start.sh`'s
    frontmatter counter silently for math241 (PLAN-2026-09-22.md) -- this is
    what would have caught it.
    """
    warnings = []
    if resume_path.is_file():
        count = len(strip_frontmatter(resume_path.read_text()).split())
        if count > 200:
            warnings.append("%s: resume.md is %d words, over the 200-word bound "
                            "(workflow.md step 4, records.md:13)" % (slug, count))
        fields = frontmatter(resume_path)
        for key in ("subject", "updated"):
            if not fields.get(key):
                warnings.append("%s: resume.md frontmatter is missing `%s:` (records.md:96)" % (slug, key))
    if plan_path.is_file():
        fields = frontmatter(plan_path)
        for key in ("subject", "updated"):
            if not fields.get(key):
                warnings.append("%s: plan.md frontmatter is missing `%s:` (records.md:96)" % (slug, key))
    return warnings


def g5_record_index(slug, fields, sessions, nodes):
    """G5: record.md's frontmatter index agrees with the session notes and node table.

    `records.md:16` bans a reused `sNN`, and its frontmatter reference says
    `sessions`/`last_session` are what the dashboard and SessionStart hook read
    -- so they must agree with what is actually on disk, not just what was true
    when someone last edited them by hand.
    """
    warnings = []
    declared_count = fields.get("sessions", "")
    if declared_count.isdigit() and int(declared_count) != len(sessions):
        warnings.append("%s: record.md says sessions: %s, but %d session note(s) exist"
                        % (slug, declared_count, len(sessions)))
    if sessions:
        newest = max((entry.get("date", "") for entry in sessions), default="")
        last_session = fields.get("last_session", "")
        if last_session and newest and last_session != newest:
            warnings.append("%s: record.md last_session is %s, but the newest session note is dated %s"
                            % (slug, last_session, newest))
    seen = {}
    for entry in sessions:
        num = entry.get("session")
        if num:
            seen.setdefault(num, []).append(entry.get("file", "?"))
    for num, files in seen.items():
        if len(files) > 1:
            warnings.append("%s: session number %s is reused across %s (records.md:16)"
                            % (slug, num, ", ".join(files)))
    for node in sorted(nodes, key=sort_key):
        entry = nodes[node]
        if entry["status"] in ("checked", "solid", "decayed") and not entry["checked"]:
            warnings.append("%s %s: status is '%s' but Last checked is empty" % (slug, node, entry["status"]))
    return warnings


def g2_session_notes(slug, folder):
    """G2: per session note, every taught node has its Diagram/Check lines, a
    fourth consecutive new node never opens without a logged retrieval check,
    frontmatter `nodes:` matches the union of Lesson entries and node ids
    named in *Retrieval checks* or, in a practice note, *Practice*
    (`records.md:82`, decided 2026-09-22 after
    cs124-quiz4 s01 and math241-exam1-review s02 both had nodes with evidence
    that lived only in *Retrieval checks*, not a `### nN` header), and no node
    entry is filed outside *Lesson* or *Retrieval checks* (records.md:97).
    """
    warnings = []
    if not folder.is_dir():
        return warnings
    for path in sorted(folder.glob("*.md")):
        note = session_note.read(path)
        label = "%s %s" % (slug, note.name)
        for entry in note.entries:
            if not entry.has_diagram:
                warnings.append("%s: %s has no Diagram line (tutor.md, CLAUDE.md)" % (label, entry.node))
            if not entry.has_check:
                warnings.append("%s: %s has no Check line" % (label, entry.node))
        for entry in note.misplaced:
            warnings.append("%s: %s is filed under *%s*, not *Lesson* or *Retrieval checks* "
                            "(records.md:97)" % (label, entry.node, entry.section or "no heading"))
        if len(note.entries) >= 4 and not note.retrieval:
            warnings.append("%s: %d new nodes opened with *Retrieval checks* left empty "
                            "(workflow.md, the gate)" % (label, len(note.entries)))
        touched = {entry.node for entry in note.entries} | set(note.retrieval_nodes) | set(note.practice_nodes)
        declared = set(note.declared_nodes)
        if declared != touched:
            warnings.append("%s: frontmatter nodes: %s does not match Lesson + Retrieval-checks + Practice nodes %s "
                            "(records.md:82)" % (label, sorted(declared, key=sort_key) or "none",
                                                 sorted(touched, key=sort_key) or "none"))
    return warnings


def g4_mc_slots(slug, folder):
    """G4: the correct-answer slot on logged MC checks rotates, per the rule
    stated in `slot_rotation.py`. Reads the folder's key fields in session
    order and words each break the module finds.
    """
    keys = slot_rotation.logged(folder)
    warnings = []
    for found in slot_rotation.breaks(keys):
        if isinstance(found, slot_rotation.Repeat):
            warnings.append("%s: %s repeats the previous check's correct-answer slot %d "
                            "(slot_rotation.py)" % (slug, found.name, found.slot))
        else:
            warnings.append("%s: slot %d holds the correct answer %d times in the %d checks ending at %s "
                            "(slot_rotation.py)" % (slug, found.slot, found.count,
                                                    slot_rotation.WINDOW, found.name))
    return warnings


def marker_warnings(slug, nodes, events):
    """Where the transition markers disagree with the node table (spec section 15).

    Rewards are read from markers, so a marker that drifts from the table is a
    wrong reward. `events` must already be in order, as `evidence_events` returns.
    """
    warnings, latest = [], {}
    for event in events:
        latest[event["node"]] = event
    for node in sorted(latest, key=sort_key):
        event = latest[node]
        if node not in nodes:
            warnings.append("%s %s: a transition marker names %s, which is not in the node table"
                            % (slug, node, node))
            continue
        entry = nodes[node]
        if entry["status"] and event["status"] != entry["status"]:
            warnings.append("%s %s: last transition marker says '%s' (%s), node table says '%s'"
                            % (slug, node, event["status"], event["date"], entry["status"]))
        checked = ISO_DATE.search(entry["checked"] or "")
        if (entry["status"] in DECAYABLE and checked and event["date"]
                and checked.group(0) != event["date"]):
            warnings.append("%s %s: latest transition marker is dated %s, Last checked says %s"
                            % (slug, node, event["date"], checked.group(0)))
    if MARKERS_REQUIRED:
        for node in sorted(nodes, key=sort_key):
            if nodes[node]["status"] in DECAYABLE and node not in latest:
                warnings.append("%s %s: status is '%s' but it has no transition marker "
                                "on any evidence line" % (slug, node, nodes[node]["status"]))
    return warnings


def consistency(nodes, plan_text, subject, fields, sessions, folder):
    """Warn where the records contradict each other. Report; never auto-fix.

    A generator that silently repaired the source would hide exactly the drift it
    exists to surface, and these files are reviewed by a human and a subagent.

    Composes the plan/record node checks below with the four deterministic gates
    from PLAN-2026-09-22.md Phase 1: G1 (resume bound), G5 (record index), G2
    (session-note invariants), G4 (MC slot rotation).
    """
    warnings = []
    warnings += g1_resume_bounds(subject, folder / "resume.md", folder / "plan.md")
    warnings += g5_record_index(subject, fields, sessions, nodes)
    warnings += g2_session_notes(subject, folder / "sessions")
    warnings += g4_mc_slots(subject, folder / "sessions")
    record = folder / "record.md"
    if record.is_file():
        warnings += marker_warnings(subject, nodes,
                                    evidence_events(record.read_text(), note_starts(folder)))
    for node in sorted(nodes, key=sort_key):
        entry = nodes[node]
        if entry["plan_status"] and entry["status"] and entry["plan_status"] != entry["status"]:
            warnings.append("%s %s: record says '%s', plan says '%s' (records.md: the two must agree)"
                            % (subject, node, entry["status"], entry["plan_status"]))
        if not entry["status"]:
            warnings.append("%s %s: in plan.md but missing from the record.md node table" % (subject, node))
    for node in sorted(nodes, key=sort_key):
        for prereq in nodes[node].get("bad_prereqs", []):
            reason = "names the node itself" if prereq == node else "is not in the node table"
            warnings.append("%s %s: prereq %s %s, so it is left out of the graph"
                            % (subject, node, prereq, reason))
    edges = set()
    for block in MERMAID.findall(plan_text):
        for line in block.splitlines():
            found = EDGE.search(line)
            if found:
                edges.add((found.group(1), found.group(2)))
    for node in sorted(nodes, key=sort_key):
        declared = set(nodes[node]["prereqs"])
        drawn = {parent for parent, child in edges if child == node}
        if not declared and not drawn:
            continue
        if declared != drawn and (declared or drawn):
            warnings.append("%s %s: prereqs column says %s, graph edges say %s"
                            % (subject, node, sorted(declared) or "none", sorted(drawn) or "none"))
    return warnings


# --------------------------------------------------------------------- rendering

def sort_key(node):
    """n8 < n8a < n8b < n9: number first, then the letter of a split node."""
    match = re.match(r"n(\d+)([a-z]?)$", node)
    return (int(match.group(1)), match.group(2))


def meter(done, partial, total, width=112):
    """A thin progress meter, one line of inline SVG: proven nodes solid green,
    taught but unproven ones faint green, the rest an empty track. Then the
    percent proven, so the number survives with the snippet off."""
    proven = int(round(width * done / float(total))) if total else 0
    taught = int(round(width * (done + partial) / float(total))) if total else 0
    rects = ['<rect width="%d" height="6" rx="3" style="fill: var(--background-modifier-border)"/>' % width]
    if taught > proven:
        rects.append('<rect width="%d" height="6" rx="3" style="fill: var(--color-green); fill-opacity: 0.35"/>' % taught)
    if proven:
        rects.append('<rect width="%d" height="6" rx="3" style="fill: var(--color-green)"/>' % proven)
    percent = int(round(100.0 * done / total)) if total else 0
    return ('<svg class="lv-meter" width="%d" height="6" viewBox="0 0 %d 6" role="img" aria-label="%d of %d passed">'
            '%s</svg> <span class="lv-num">%d%%</span>' % (width, width, done, total, "".join(rects), percent))


def tag(text):
    """A Dashboard row's status word as a chip, its tone from what it asks for.
    The ` · ` before it is kept for the snippet-off view and hidden by the snippet."""
    tone = "repair" if "repair" in text else "due" if "due" in text else "deadline"
    return '<span class="lv-sep"> · </span><span class="lv-tag" data-tone="%s">%s</span>' % (tone, text)


def log_links(slug, folder):
    # log.md and codex-log.md are gitignored, hook-written mirrors of the live
    # conversation, not records -- link only the ones that actually exist so the
    # generated view never ships a dead wikilink.
    names = [("log", "Claude log"), ("codex-log", "Codex log")]
    return " · ".join("[[learn/subjects/%s/%s|%s]]" % (slug, name, label)
                       for name, label in names if (folder / (name + ".md")).is_file())


GENERATED = "*Generated from the records; edits are overwritten.*"


def proven_count(nodes):
    return sum(1 for entry in nodes.values() if entry["status"] in COVERED)


def up_next(nodes):
    """`planned` nodes whose every prereq is proven, in plan order."""
    return [node for node in sorted(nodes, key=sort_key) if nodes[node]["status"] == "planned"
            and all(nodes.get(p, {}).get("status") in COVERED for p in nodes[node].get("prereqs", []))]


def pending_tag(nodes, fields, today):
    """`N to repair` when a node is decayed, else `N due for review` when a node
    is due, else "". The Dashboard and the startup index both read it."""
    decayed = sum(1 for entry in nodes.values() if entry["status"] == "decayed")
    if decayed:
        return "%d to repair" % decayed
    waiting = sum(1 for entry in nodes.values() if is_due(entry, today, fields.get("deadline")))
    return "%d due for review" % waiting if waiting else ""


def deadline_words(deadline, today, passed=False):
    """`deadline in 4 days` or `deadline today` while the deadline is ahead,
    `deadline passed` after it when `passed` asks for that, else ""."""
    left = days_to_deadline(deadline, today)
    if left is None or (left < 0 and not passed):
        return ""
    if left < 0:
        return "deadline passed"
    return "deadline today" if left == 0 else "deadline in " + plural(left, "day")


def next_review(subjects):
    """(node name, date) of the earliest day a proven node becomes due, or None."""
    upcoming = []
    for slug, nodes, _, _ in subjects:
        for entry in nodes.values():
            checked = to_date(entry.get("checked"))
            if entry.get("status") in DUE_DAYS and checked:
                upcoming.append((checked + timedelta(days=DUE_DAYS[entry["status"]]), slug,
                                 sort_key(entry["id"]), entry["name"]))
    if not upcoming:
        return None
    when, _, _, name = min(upcoming)
    return name, when


def joined(names):
    """`*a*`, `*a* and *b*`, or `*a*, *b*, and *c*`."""
    names = ["*%s*" % name for name in names]
    if len(names) < 3:
        return " and ".join(names)
    return ", ".join(names[:-1]) + ", and " + names[-1]


def milestone(subjects):
    """The next-milestone line: up to 3 `checked` nodes with the soonest due
    date, then subject, then id. None when no node is `checked`."""
    waiting = sorted((to_date(entry["checked"]) + timedelta(days=DUE_DAYS["checked"]), slug,
                      sort_key(entry["id"]), entry["name"])
                     for slug, nodes, _, _ in subjects for entry in nodes.values()
                     if entry["status"] == "checked" and to_date(entry.get("checked")))
    names = [item[3] for item in waiting[:3]]
    if not names:
        return None
    if len(names) == 1:
        return "Next up: %s is one passed check from solid." % joined(names)
    return "Next up: %s are each one passed check from solid." % joined(names)


def option_line(found):
    """One ranked candidate as a line of Home's *Other options*."""
    reason = found["reason"]
    if not found["title"] and reason.startswith(found["kind"].lower() + " "):
        reason = reason[len(found["kind"]) + 1:]  # "**Start** something new", not "Start start"
    head = "**%s** %s: " % (found["kind"], found["title"]) if found["title"] else "**%s** " % found["kind"]
    return "- %s%s%s `%s`" % (head, reason, "" if reason.endswith(".") else ".", found["command"])


CARD_CALLOUT = {"Solid": "success", "Recovered": "tip", "Goal met": "abstract"}


def earned_cards(badges, limit=3):
    """The latest `limit` cards, one per (subject, date, kind), as callouts."""
    cards = {}
    for found in badges:
        cards.setdefault((found["subject"], found["date"], found["kind"]), []).append(found)
    order = sorted(cards, key=lambda key: (BADGE_ORDER.index(key[2]), cards[key][0]["title"]))
    order.sort(key=lambda key: key[1], reverse=True)
    out = []
    for subject, date, kind in order[:limit]:
        group = cards[(subject, date, kind)]
        names = "" if kind == "Goal met" else " <span>%s</span>" % html.escape(
            " · ".join(found["name"] for found in group))
        out.append('<div class="lv-card" data-kind="%s"><span class="lv-label">%s · %s</span> '
                   "<strong>%s</strong>%s</div>" % (CARD_CALLOUT[kind], kind, short_date(to_date(date)),
                                                   html.escape(group[0]["title"]), names))
    # One HTML block, so the cards sit side by side; with the snippet off each
    # is still a line of plain text.
    return ['<div class="lv-cards">' + "".join(out) + "</div>", ""] if out else []


# Home and the Dashboard span every subject, so they take the neutral theme.
# lv-wash: Home and the Dashboard take the full-bleed Holo wash; every other
# learning note takes the corner glow (vault-brand.css, guideline v0.2).
SHARED_CLASSES = "learning-note, learning-themed, lv-theme-calm, lv-wash"


def long_date(when):
    """`Thursday, 24 September`, the Home card's title."""
    return "%s, %d %s" % (when.strftime("%A"), when.day, when.strftime("%B"))


def home(ranked, subjects, state, rewards_on, today):
    """`learn/Home.md`: what to do now (spec section 8).

    `ranked` is `rank()`'s output, `subjects` the (slug, nodes, fields, events)
    list, `state` the vault's `rewards()`. Commands print bare, since both
    hosts read this note.
    """
    out = ["---", "type: learning-home", 'updated: "%s"' % today.isoformat(), "generated: true",
           "cssclasses: [%s]" % SHARED_CLASSES, "---", "",
           # `|welcome` lets the snippet draw this one card as the page's hero.
           "> [!question|welcome] %s" % long_date(today)]
    top, others = ranked[0], ranked[1:]
    if top["kind"] == "Start":
        out.append("> Nothing you've passed is due for review.")
        upcoming = next_review(subjects)
        if upcoming:
            out.append("> *%s* comes due on %s." % (upcoming[0], short_date(upcoming[1])))
        out += [">", "> Curious about something new? `learn-start`"]
    else:
        # A Deadline welcome is a whole clause ("Calc's deadline is ..."); the
        # rest start with a verb and finish "A good next step is to".
        lead = "" if top["kind"] == "Deadline" else "A good next step is to "
        out += ["> Ready when you are. %s%s." % (lead, top["welcome"]), ">",
                "> `%s`" % top["command"]]
    out.append("")
    if others:
        out += ["> [!note|options]- Other options (%d)" % len(others)] + ["> " + option_line(found) for found in others]
        out.append("")
    if rewards_on:
        cards = earned_cards(state["badges"])
        if cards:
            out += ["## Recently earned", ""] + cards
        line = milestone(subjects)
        if line:
            out += [line, ""]
    counts = state["counts"]
    if rewards_on:
        tiles = [(counts["nodes_proven"], "topic passed" if counts["nodes_proven"] == 1 else "topics passed"),
                 (counts["goals_met"], "goal reached" if counts["goals_met"] == 1 else "goals reached")]
        if state["streak"]["alive"]:
            tiles.append((counts["current_streak"], "week review streak"))  # "4 week review streak"
        out += [stat_tiles(tiles), ""]
    out += ["[[learn/Dashboard|All subjects and badges →]]", "", "---", ""]
    out.append("*Rewards are %s. Turn them %s with `rewards: %s` in [[learn/me/preferences|preferences]].*"
               % (("on", "off", "off") if rewards_on else ("off", "on", "on")))
    out += ["", GENERATED, ""]
    return "\n".join(out)


# ------------------------------------------------------------ the skill tree

# An inline SVG, because the CSS snippet cannot colour mermaid and a real tree
# needs its own layout (spec section 7). Ported from the skill-tree-layout
# prototype, method A: rank by longest path with roots at the bottom, a dummy
# point per rank on long edges, barycenter sweeps to cut crossings, and
# Brandes-Köpf coordinates so long edges run straight. No layout dependency.

TREE_GAP = 22      # between two labels in a row
TREE_DUMMY_W = 14  # width an edge passing through a row reserves
TREE_CHAR_W = 6.6  # average glyph width at 12px
TREE_WRAP = 22     # label characters per line
TREE_MIN_W = 800   # viewBox floor, so a thin tree is not blown up to the note width
TREE_SWEEPS = 24


def wrap(name):
    """A node name in lines of at most 22 characters, split on words. Full
    names, never cut: a single longer word keeps its own line."""
    words, lines, current = name.replace("`", "").split(), [], ""
    for word in words:
        if current and len(current) + 1 + len(word) > TREE_WRAP:
            lines.append(current)
            current = word
        else:
            current = (current + " " + word).strip()
    lines.append(current)
    return lines


def layered(nodes):
    """Ranks, dummy points, and a crossing-reduced order per rank."""
    rank, visiting = {}, set()

    def depth(node):
        if node not in rank:
            visiting.add(node)  # a cycle is a plan error; its closing edge is ignored
            rank[node] = 1 + max((depth(p) for p in nodes[node]["prereqs"] if p not in visiting), default=-1)
            visiting.discard(node)
        return rank[node]
    for node in sorted(nodes, key=sort_key):
        depth(node)
    up, down, chains, width = {}, {}, [], {}
    for node in nodes:
        up.setdefault(node, [])
        down.setdefault(node, [])
        width[node] = max(44, TREE_CHAR_W * max(len(line) for line in wrap(nodes[node]["name"])))
    for node in sorted(nodes, key=sort_key):
        for prereq in nodes[node]["prereqs"]:
            if rank[prereq] >= rank[node]:
                continue  # the ignored edge of a cycle
            chain = [prereq]
            for level in range(rank[prereq] + 1, rank[node]):
                dummy = "%s>%s@%d" % (prereq, node, level)
                rank[dummy], width[dummy], up[dummy], down[dummy] = level, TREE_DUMMY_W, [], []
                chain.append(dummy)
            chain.append(node)
            for lower, upper in zip(chain, chain[1:]):
                up[lower].append(upper)
                down[upper].append(lower)
            chains.append((prereq, node, chain))
    layers = [[] for _ in range(max(rank.values()) + 1)]
    for vertex in sorted(rank, key=lambda v: (v not in nodes, sort_key(v) if v in nodes else 0, v)):
        layers[rank[vertex]].append(vertex)
    # Start from a depth-first order from the roots, so connected nodes start together.
    seen, first_order = set(), []

    def visit(vertex):
        if vertex in seen:
            return
        seen.add(vertex)
        first_order.append(vertex)
        for above in up[vertex]:
            visit(above)
    for vertex in layers[0] + sorted(rank):
        visit(vertex)
    index = {vertex: position for position, vertex in enumerate(first_order)}
    layers = reduce_crossings([sorted(layer, key=index.get) for layer in layers], up, down)
    return rank, layers, up, down, chains, width


def crossings(layers, down):
    total = 0
    for level in range(1, len(layers)):
        below = {vertex: position for position, vertex in enumerate(layers[level - 1])}
        segments = [(position, below[lower]) for position, vertex in enumerate(layers[level])
                    for lower in down[vertex]]
        for a in range(len(segments)):
            for b in range(a + 1, len(segments)):
                if (segments[a][0] - segments[b][0]) * (segments[a][1] - segments[b][1]) < 0:
                    total += 1
    return total


def reduce_crossings(layers, up, down):
    """Alternating barycenter sweeps, each followed by adjacent swaps while they
    help. Keeps the best order seen."""
    best, best_count = [layer[:] for layer in layers], crossings(layers, down)
    current = [layer[:] for layer in layers]
    for sweep in range(TREE_SWEEPS):
        upward = sweep % 2 == 0
        levels = range(1, len(current)) if upward else range(len(current) - 2, -1, -1)
        neighbours = down if upward else up
        for level in levels:
            reference = current[level - 1] if upward else current[level + 1]
            where = {vertex: position for position, vertex in enumerate(reference)}
            keyed = []
            for position, vertex in enumerate(current[level]):
                near = [where[other] for other in neighbours[vertex]]
                keyed.append((sum(near) / len(near) if near else position, position, vertex))
            current[level] = [vertex for _, _, vertex in sorted(keyed)]
        improved = True
        while improved:
            improved = False
            for layer in current:
                for position in range(len(layer) - 1):
                    count = crossings(current, down)
                    layer[position], layer[position + 1] = layer[position + 1], layer[position]
                    if crossings(current, down) < count:
                        improved = True
                    else:
                        layer[position], layer[position + 1] = layer[position + 1], layer[position]
        count = crossings(current, down)
        if count < best_count:
            best, best_count = [layer[:] for layer in current], count
    return best


def sep(width, a, b):
    """Half of each label's width plus 22px, or 8px next to a dummy point."""
    return width[a] / 2 + width[b] / 2 + (TREE_GAP if ">" not in a and ">" not in b else 8)


def bk(layers, up, down, width):
    """Brandes-Köpf x coordinates: four vertical alignments, compacted, aligned
    to the narrowest, then the median of the four per node. Follows dagre's
    position/bk.js."""
    dummy = lambda vertex: ">" in vertex  # noqa: E731
    conflicts = set()
    for level in range(1, len(layers)):
        below, layer = layers[level - 1], layers[level]
        where = {vertex: position for position, vertex in enumerate(below)}
        start, scan = 0, 0
        for position, vertex in enumerate(layer):
            inner = next((lower for lower in down[vertex] if dummy(lower) and dummy(vertex)), None)
            end = where[inner] if inner else len(below)
            if inner or position == len(layer) - 1:
                for other in layer[scan:position + 1]:
                    for lower in down[other]:
                        if (where[lower] < start or end < where[lower]) and not (dummy(lower) and dummy(other)):
                            conflicts.add(frozenset((lower, other)))
                scan, start = position + 1, end
    placements = {}
    for vertical in "ud":
        ordered = layers if vertical == "u" else layers[::-1]
        neighbours = down if vertical == "u" else up
        for horizontal in "lr":
            rows = [layer[:] if horizontal == "l" else layer[::-1] for layer in ordered]
            where = {vertex: position for row in rows for position, vertex in enumerate(row)}
            root = {vertex: vertex for row in rows for vertex in row}
            align = dict(root)
            for row in rows:
                previous = -1
                for vertex in row:
                    near = sorted(neighbours[vertex], key=where.get)
                    if not near:
                        continue
                    middle = (len(near) - 1) / 2
                    for index in range(int(math.floor(middle)), int(math.ceil(middle)) + 1):
                        other = near[index]
                        if (align[vertex] == vertex and previous < where[other]
                                and frozenset((vertex, other)) not in conflicts):
                            align[other] = vertex
                            align[vertex] = root[vertex] = root[other]
                            previous = where[other]
            edges = {}
            for row in rows:
                for a, b in zip(row, row[1:]):
                    pair = (root[a], root[b])
                    edges[pair] = max(edges.get(pair, 0), sep(width, a, b))
            blocks = set(root.values())
            into, out_of = {block: [] for block in blocks}, {block: [] for block in blocks}
            for (a, b), weight in edges.items():
                out_of[a].append((b, weight))
                into[b].append((a, weight))
            order, indegree = [], {block: len(into[block]) for block in blocks}
            queue = sorted(block for block in blocks if indegree[block] == 0)
            while queue:
                block = queue.pop(0)
                order.append(block)
                for after, _ in out_of[block]:
                    indegree[after] -= 1
                    if indegree[after] == 0:
                        queue.append(after)
            xs = {}
            for block in order:
                xs[block] = max((xs[a] + weight for a, weight in into[block]), default=0)
            for block in reversed(order):
                least = min((xs[after] - weight for after, weight in out_of[block]), default=math.inf)
                if least != math.inf:
                    xs[block] = max(xs[block], least)
            x = {vertex: xs[root[vertex]] for vertex in root}
            if horizontal == "r":
                x = {vertex: -value for vertex, value in x.items()}
            placements[vertical + horizontal] = x
    spans = {key: max(x.values()) - min(x.values()) for key, x in placements.items()}
    narrowest = placements[min(spans, key=spans.get)]
    low, high = min(narrowest.values()), max(narrowest.values())
    for key, x in placements.items():
        shift = low - min(x.values()) if key[1] == "l" else high - max(x.values())
        placements[key] = {vertex: value + shift for vertex, value in x.items()}
    return {vertex: sum(sorted(placements[key][vertex] for key in placements)[1:3]) / 2
            for vertex in narrowest}


def svg_text(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def svg_prefix(kind, slug):
    """Gradient and filter ids are global to the page, so each SVG names its own."""
    return "%s-%s" % (kind, re.sub(r"[^a-z0-9]", "", slug.lower())[:24] or "x")


def gradients(prefix):
    stops = [("solid", "--color-green", "--color-cyan"), ("checked", "--color-blue", "--color-purple")]
    return ("<defs>" + "".join(
        '<linearGradient id="%s-%s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color: var(%s)"/>'
        '<stop offset="1" style="stop-color: var(%s)"/></linearGradient>' % (prefix, name, start, end)
        for name, start, end in stops)
        + '<filter id="%s-glow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="5"/></filter>'
          "</defs>" % prefix)


def circle(cx, cy, r, style, extra=""):
    return '<circle cx="%.0f" cy="%.0f" r="%d"%s style="%s"/>' % (cx, cy, r, extra, style)


def glyph(cx, cy, text, style):
    return '<text x="%.0f" y="%.0f" text-anchor="middle" style="%s">%s</text>' % (cx, cy, style, text)


ON_DISC = "fill: var(--text-on-accent); font-size: 15px; font-weight: 700"


def disc(status, cx, cy, prefix, next_up, rewards_on):
    """The SVG elements for one node's disc (spec section 7, *Discs*)."""
    if status == "solid":
        ring = circle(cx, cy, 21, "fill: var(--background-primary); stroke: var(--color-green); stroke-width: 2")
        body = circle(cx, cy, 17, "fill: url(#%s-solid)" % prefix)
        if not rewards_on:
            return [ring, body, glyph(cx, cy + 5, "✓", ON_DISC)]
        return [circle(cx, cy, 22, "fill: var(--color-green); fill-opacity: 0.55",
                       ' filter="url(#%s-glow)"' % prefix), ring, body,
                glyph(cx, cy + 6, "★", "fill: var(--color-yellow); stroke: var(--color-orange); "
                                       "stroke-width: 0.8px; font-size: 17px; font-weight: 700")]
    if status in ("checked", "skipped"):
        return [circle(cx, cy, 17, "fill: url(#%s-checked)" % prefix), glyph(cx, cy + 5, "✓", ON_DISC)]
    if status == "introduced":  # I2: a hollow ring in the checked gradient
        return [circle(cx, cy, 16, "fill: url(#%s-checked); fill-opacity: 0.18; stroke: url(#%s-checked); "
                                   "stroke-width: 4" % (prefix, prefix))]
    if status == "decayed":  # D2: the full disc kept, with a small refresh badge
        return [circle(cx, cy, 17, "fill: url(#%s-solid)" % prefix), glyph(cx, cy + 5, "✓", ON_DISC),
                circle(cx + 14, cy - 13, 8, "fill: var(--color-cyan); stroke: var(--background-primary); "
                                            "stroke-width: 2"),
                glyph(cx + 14, cy - 9, "↻", "fill: var(--text-on-accent); font-size: 11px; font-weight: 800")]
    if next_up:
        return [circle(cx, cy, 21, "fill: var(--background-primary); stroke: var(--color-orange); "
                                   "stroke-width: 2; stroke-dasharray: 4 3"),
                circle(cx, cy, 15, "fill: var(--color-orange)"),
                glyph(cx, cy + 5, "→", "fill: var(--text-on-accent); font-size: 15px; font-weight: 800")]
    return [circle(cx, cy, 12, "fill: var(--background-secondary); stroke: var(--text-faint); stroke-width: 1")]


def skill_tree(slug, title, nodes, rewards_on=True):
    """The progress page's skill tree as one inline SVG, or "" with no nodes."""
    if not nodes:
        return ""
    rank, layers, up, down, chains, width = layered(nodes)
    X = bk(layers, up, down, width)
    low = min(X[v] - width[v] / 2 for v in X)
    high = max(X[v] + width[v] / 2 for v in X)
    W = max(TREE_MIN_W, high - low + 40)
    shift = W / 2 - (low + high) / 2
    # Each row is as tall as its longest label: the disc, 14px a line, and a gap for edges.
    lines = [max((len(wrap(nodes[v]["name"])) for v in layer if v in nodes), default=0) for layer in layers]
    ys, y = [], 0.0
    for level, count in enumerate(lines):
        if level:
            y -= 22 + 30 + 14 * count + 44
        ys.append(y)
    H = 30 + (-ys[-1]) + 22 + 30 + 14 * lines[0]
    Y = {v: 30 + 22 - ys[-1] + ys[rank[v]] for v in rank}
    X = {v: x + shift for v, x in X.items()}
    prefix = svg_prefix("st", slug)
    ready = set(up_next(nodes))
    label = svg_text("%s skill tree" % title)
    out = ['<svg viewBox="0 0 %.0f %.0f" width="100%%" role="img" aria-label="%s">' % (W, H, label),
           "<title>%s</title>" % label, gradients(prefix)]
    edges = []
    for a, b, chain in chains:
        lower, upper = nodes[a]["status"], nodes[b]["status"]
        if lower in COVERED and upper in COVERED:
            style, layer = "stroke: var(--color-green); stroke-width: 3.5; stroke-linecap: round", 2
        elif lower in COVERED and b in ready:
            style, layer = "stroke: var(--color-orange); stroke-width: 2; stroke-dasharray: 6 4", 1
        else:
            style, layer = "stroke: var(--text-faint); stroke-width: 1.2; stroke-dasharray: 2 4", 0
        # Leave from the top of the lower disc and arrive under the upper
        # node's label, so no edge crosses text.
        points = [(X[v], Y[v]) for v in chain]
        points[0] = (points[0][0], points[0][1] - 23)
        points[-1] = (points[-1][0], points[-1][1] + 30 + 14 * len(wrap(nodes[b]["name"])))
        path = "M %.0f %.0f" % points[0]
        for (x1, y1), (x2, y2) in zip(points, points[1:]):
            middle = (y1 + y2) / 2
            path += " C %.0f %.0f %.0f %.0f %.0f %.0f" % (x1, middle, x2, middle, x2, y2)
        edges.append((layer, '<path d="%s" style="fill: none; %s"/>' % (path, style)))
    out += [edge for _, edge in sorted(edges, key=lambda item: item[0])]
    halo = "paint-order: stroke; stroke: var(--background-primary); stroke-width: 4px; stroke-linejoin: round"
    for node in sorted(nodes, key=sort_key):
        entry, cx, cy = nodes[node], X[node], Y[node]
        out += disc(entry["status"], cx, cy, prefix, node in ready, rewards_on)
        faint = entry["status"] not in COVERED | PARTIAL | {"decayed"} and node not in ready
        for index, text in enumerate(wrap(entry["name"])):
            out.append('<text x="%.0f" y="%.0f" text-anchor="middle" style="fill: var(%s); font-size: 12px; %s">%s</text>'
                       % (cx, cy + 36 + 14 * index, "--text-faint" if faint else "--text-normal", halo,
                          svg_text(text)))
    out.append("</svg>")
    return "\n".join(out)


def stat_tiles(tiles):
    """(number, label) pairs as one row of glass tiles, the same on Home and a
    progress page. One HTML block; with the snippet off, a line per count."""
    return ('<div class="lv-stats">' + "".join('<div class="lv-stat"><b>%s</b> <span>%s</span></div>' % tile
                                               for tile in tiles) + "</div>")


def count_tiles(slug, counts, streak):
    """Four tiles: topics passed, topics remembered on a later day, the review streak while
    it is alive, and the best streak."""
    tiles = [(counts["nodes_proven"], "topics passed"), (counts["checks_passed"], "remembered on a later day")]
    if streak["alive"]:
        tiles.append((streak["current"], "week review streak"))
    tiles.append((streak["best"], "week best streak"))
    return stat_tiles(tiles)


# ------------------------------------------------------------ the progress page

def shown_before_lapse(node, events):
    """The date of a node's latest `checked` or `solid` marker before its
    current lapse, or None."""
    own = [event for event in events if event["node"] == node]
    lapsed = lapses(own)
    if not lapsed:
        return None
    cut = next(index for index, event in enumerate(own) if event is lapsed[-1])
    earlier = [event for event in own[:cut] if event["status"] in ("checked", "solid")]
    return to_date(earlier[-1]["date"]) if earlier else None


def subject_tag(slug):
    """The slug as an Obsidian tag. The graph view draws each tag as a node
    labelled with its name, so the tag on a progress page is what names the
    subject's cluster there; every other node is labelled by its file name,
    which is the same `progress`/`record`/`plan` in every subject. A tag holds
    only letters, digits, `_`, `-`, and `/`, so a dotted slug loses its dots."""
    return re.sub(r"[^A-Za-z0-9_/-]", "-", slug)


def callout(kind, title, bullets, fold=""):
    return ["> [!%s]%s %s" % (kind, fold, title)] + ["> - " + bullet for bullet in bullets] + [""]


def progress_note(slug, folder, fields, nodes, record_text, sessions, today, events=(),
                  rewards_on=True, state=None, streak=None):
    """A subject's progress page (spec section 6). `state` is `rewards()` over
    this subject alone and `streak` the vault's review streak."""
    total, done = len(nodes), proven_count(nodes)
    partial = sum(1 for node in nodes.values() if node["status"] in PARTIAL)
    title = fields.get("title", slug)
    ordered = [nodes[node] for node in sorted(nodes, key=sort_key)]
    out = ["---", "type: learning-progress", 'subject: "%s"' % slug, "tags: [%s]" % subject_tag(slug),
           'updated: "%s"' % today.isoformat(), "generated: true",
           "cssclasses: [learning-note, learning-themed, lv-theme-%s]" % theme_of(fields, slug), "---", "",
           "# %s — progress" % title, "", GENERATED, "",
           ("**%d of %d topics passed** %s" % (done, total, meter(done, partial, total)) if total
            else "**No plan yet**") + " · %s session%s · status **%s**"
           % (fields.get("sessions", "0"), "" if fields.get("sessions") == "1" else "s",
              fields.get("status", "unknown")), "",
           "> [!todo] Next action", "> " + fields.get("next", "—"), "",
           " · ".join(part for part in [
               "[[learn/subjects/%s/resume|Resume]]" % slug,
               "[[learn/subjects/%s/record|Record]]" % slug,
               "[[learn/subjects/%s/plan|Plan]]" % slug,
               log_links(slug, folder),
               "[[learn/Home|Home]]",
           ] if part), ""]
    tree = skill_tree(slug, title, nodes, rewards_on)
    if tree:
        out += [tree, ""]
    if rewards_on and state and streak:
        out += [count_tiles(slug, state["counts"], streak), ""]

    can_do = [entry["can_do"] for entry in ordered if entry["status"] in COVERED]
    if can_do:
        out += callout("success", "You can now (%d)" % len(can_do), can_do)
    refresh = []
    for entry in ordered:
        if entry["status"] == "decayed":
            shown = shown_before_lapse(entry["id"], list(events))
            refresh.append(entry["can_do"] + (" (you showed this on %s; one check brings it back)"
                                              % short_date(shown) if shown else ""))
    if refresh:
        out += callout("tip", "Worth a refresh (%d)" % len(refresh), refresh)
    learning = [entry["can_do"] for entry in ordered if entry["status"] == "introduced"]
    if learning:
        out += callout("info", "You're learning (%d)" % len(learning), learning)
    ready = up_next(nodes)
    planned = [entry for entry in ordered if entry["status"] == "planned"]
    if planned:
        out += ["> [!todo] Up next"]
        out += ["> - " + (nodes[node]["name"] if nodes[node]["can_do"] == nodes[node]["name"]
                          else "You'll be able to " + nodes[node]["can_do"]) for node in ready]
        rest = len(planned) - len(ready)
        if rest and ready:
            out += [">", "> %d more after that." % rest]
        elif rest:
            out += ["> %d more planned." % rest]
        out.append("")
    if rewards_on and state and state["badges"]:
        out += callout("abstract", plural(len(state["badges"]), "badge"),
                       [found["text"] for found in state["badges"]], fold="-")

    out += ["## Details", "", "> [!note]- Nodes", "> | Id | Node | Status | Last checked |",
            "> | --- | --- | --- | --- |"]
    for entry in ordered:
        out.append("> | %s | %s | `%s` | %s |" % (entry["id"], entry["name"], entry["status"] or "unknown",
                                                entry["checked"] or "—"))
    out.append("")
    strands = section(record_text, "Strands")
    if strands:
        out += ["### Strands — floor and ceiling", "", strands, ""]
    if sessions:
        out += ["### Sessions", "", "| # | Date | Active | Ended | Nodes | Note |",
                "| --- | --- | --- | --- | --- | --- |"]
        for entry in sessions:
            # An open note is called open here rather than shown as a blank cell: a
            # missing end time is a state someone has to act on, not a gap in the data.
            ended = entry.get("end") or ("**open** (paused %s)" % entry["paused"]
                                         if entry.get("paused") else "**open**")
            out.append("| %s | %s | %s | %s | %s | [[learn/subjects/%s/sessions/%s\\|note]] |"
                       % (entry.get("session", "?"), entry.get("date", "?"),
                          active_cell(entry.get("active_minutes")),
                          ended, entry.get("nodes", "—"), slug, entry["file"]))
        out.append("")
    return "\n".join(out)


def active_cell(minutes):
    """`27 min`, or `—` when the clock was not read or read `unknown`."""
    return minutes + " min" if minutes and minutes.isdigit() else "—"


# ------------------------------------------------------------ the startup index

def startup_block(subjects, notes, rewards_on, today, selected=None, host="claude"):
    """The lines the session-start hook asks the agent to show verbatim (spec
    section 10). `subjects` is the (slug, nodes, fields, events) list and
    `notes` the (slug, session note) pairs. With a subject `selected`, only the
    left-open notes and the subject lines remain."""
    ranked = rank(subjects, notes, today)
    titles = {slug: fields.get("title", slug) for slug, _, fields, _ in subjects}
    out = []
    if not selected:
        top = ranked[0]
        if top["kind"] == "Start":
            upcoming = next_review(subjects)
            out.append("**Recommended:** Nothing you've passed is due for review.%s Curious about "
                       "something new? `%s`" % (" *%s* comes due on %s." % (
                           upcoming[0], short_date(upcoming[1])) if upcoming else "",
                           command_form("learn-start", host)))
        else:
            reason = top["reason"] + ("" if top["reason"].endswith(".") else ".")
            out.append("**Recommended:** %s%s %s `%s`" % (
                top["kind"], " · %s:" % top["title"] if top["title"] else ":", reason,
                command_form(top["command"], host)))
        streak = review_streak(subjects, today)
        if rewards_on and streak["alive"]:
            out.append("Review streak: " + weeks_word(streak["current"]))
    for slug, note in notes:
        if note.status in ("open", "stale pause"):
            when = to_date(note.fields.get("date"))
            out.append("Your %s session from %s was left open. Resuming will close it out first."
                       % (titles.get(slug, slug), short_date(when) if when else "an earlier day"))
    review_at = next((index for index, found in enumerate(ranked) if found["kind"] == "Review"), None)
    pending, untouched = [], []
    for slug, nodes, fields, _ in subjects:
        tag = pending_tag(nodes, fields, today)
        if fields.get("status") in RESUMABLE or tag:
            places = [index for index, found in enumerate(ranked) if found["subject"] == slug]
            if review_at is not None and any(is_due(entry, today, fields.get("deadline"))
                                             for entry in nodes.values()):
                places.append(review_at)
            line = "- %s · %s" % (titles[slug], tag or "ready to resume")
            # A finished subject's passed deadline is history; on a paused one
            # it still says the exam this was for is over.
            words = deadline_words(fields.get("deadline"), today,
                                   passed=fields.get("status") != "done" and not fields.get("goal_met"))
            # A deadline still ahead lists first, soonest first; then rank order.
            left = days_to_deadline(fields.get("deadline"), today)
            order = (left if left is not None and left >= 0 else float("inf"),
                     min(places, default=len(ranked)))
            pending.append((order, line + (" · " + words if words else "")))
        elif fields.get("status") == "done":
            untouched.append(titles[slug])
    out += [line for _, line in sorted(pending, key=lambda item: item[0])]
    if untouched:
        out.append("Done: " + ", ".join(untouched))
    return ["Show the learner (verbatim):"] + out + ["End of block."]


# ------------------------------------------------------------ the dashboard

def cross_prereqs(subjects, slug=None):
    """Every `<slug>/nN` prerequisite, with the other node's state and a concern.

    The concern is None when the other node is `checked` or `solid` and its
    latest evidence names no help; otherwise it says what is wrong. Lagrange's
    plan once assumed the directional derivative because Exam 2 had it
    `checked`, though its meaning there needed a pointer (2026-10-23). A status
    alone hid that, so the evidence cell is read too.
    """
    by_slug = {s["slug"]: s for s in subjects}
    found = []
    for s in subjects:
        if slug is not None and s["slug"] != slug:
            continue
        for node in sorted(s["nodes"], key=sort_key):
            for other, other_node in s["nodes"][node].get("cross_prereqs", []):
                target = by_slug.get(other, {}).get("nodes", {}).get(other_node)
                row = {"subject": s["slug"], "title": s["fields"].get("title", s["slug"]),
                       "node": node, "other": other, "other_node": other_node,
                       "other_title": by_slug.get(other, {}).get("fields", {}).get("title", other),
                       "status": target["status"] if target else "",
                       "evidence": target["evidence"] if target else ""}
                if not target:
                    row["concern"] = "not found"
                elif target["status"] not in ("checked", "solid"):
                    row["concern"] = "it is %s" % (target["status"] or "missing a status")
                elif HELPED_VERDICT.search(target["evidence"]):
                    row["concern"] = "its last check needed help"
                else:
                    row["concern"] = None
                found.append(row)
    return found


def cross_line(row):
    return "%s %s depends on %s %s: %s%s" % (
        row["title"], row["node"], row["other_title"], row["other_node"],
        row["concern"] or row["status"],
        " (%s)" % row["evidence"] if row["evidence"] else "")


BRIEF_PLAN_COLUMNS = ("Rests on", "Discovery question", "Check type", "Can do", "Prereqs")
BRIEF_PER_NODE, BRIEF_TAIL = 4, 10  # evidence lines kept per focus node, and from the end of the log


def brief_focus(fields, nodes):
    """The nodes a resume works on: those `next:` names, every `introduced` or
    `decayed` node, the two most recently checked (the decay check, `/learn-resume`
    step 4; the two most recent `solid` if none are `checked`), and the next three
    `planned` nodes in plan order."""
    focus = set(NODE_ID.findall(fields.get("next", "")))
    focus |= {node for node, entry in nodes.items() if entry["status"] in ("introduced", "decayed")}
    for status in ("checked", "solid"):
        dated = sorted((to_date(entry["checked"]) or datetime.min.date(), sort_key(node), node)
                       for node, entry in nodes.items() if entry["status"] == status)
        if dated:
            focus |= {node for _, _, node in dated[-2:]}
            break
    focus |= set([node for node in sorted(nodes, key=sort_key) if nodes[node]["status"] == "planned"][:3])
    return sorted((node for node in focus if node in nodes), key=sort_key)


def brief(subject, subjects, today):
    """What `/learn-resume` loads in place of the four full files (Edison,
    2026-10-25): the state, the nodes this session works on, their evidence,
    and the latest note's hand-off. Read-only. A full file is read only when a
    step needs it, so this leaves out what no resume step reads."""
    fields, nodes = subject["fields"], subject["nodes"]
    record, plan = subject["record_text"], subject["plan_text"]
    focus = brief_focus(fields, nodes)
    out = ["# Resume brief: %s (%s)" % (fields.get("title", subject["slug"]), subject["slug"]), "",
           "Generated by `learn-status.py --brief` on %s from `record.md`, `plan.md`, and the latest "
           "session note. Open a full file when a step needs it." % today.isoformat(), "",
           "## State", ""]
    out += ["- %s: %s" % (key, fields[key]) for key in
            ("status", "sessions", "last_session", "next", "deadline", "budget") if fields.get(key)]
    for title, text in (("Goal", section(record, "Goal")),
                        ("Success criteria", section(record, "Success criteria")),
                        ("Materials", section(record, "Materials"))):
        if text:
            out += ["", "## " + title, "", text]
    misconceptions = [line for line in section(record, "Misconceptions").splitlines()
                      if line.startswith("- ") and "resolved" not in line.lower()]
    out += ["", "## Open misconceptions", ""] + (misconceptions or ["None open."])
    works = section(record, "What works")
    if works:
        out += ["", "## What works for this learner here", "", works]
    out += ["", "## Nodes", ""]
    out += ["- %s %s · %s%s" % (node, nodes[node]["name"], nodes[node]["status"] or "no status",
                                " · checked %s" % nodes[node]["checked"] if nodes[node]["checked"]
                                and nodes[node]["checked"] not in ("-", "\u2014") else "")
            for node in sorted(nodes, key=sort_key)]
    rows = {row.get("Id", ""): row for row in table_by_header(section(plan, "Nodes"))}
    out += ["", "## Focus nodes", "",
            "The decay check, open work, and what comes next. Their plan rows:", ""]
    for node in focus:
        row = rows.get(node, {})
        out.append("- **%s %s** (%s)" % (node, nodes[node]["name"], nodes[node]["status"]))
        for column in BRIEF_PLAN_COLUMNS:
            cell = next((value for key, value in row.items() if key.startswith(column)), "")
            if cell:
                out.append("  - %s: %s" % (column, cell))
    for title in ("Chains", "Session groups"):
        text = section(plan, title)
        if text:
            out += ["", "## " + title, "", text]
    crossing = cross_prereqs(subjects, slug=subject["slug"])
    if crossing:
        out += ["", "## Cross-subject prerequisites", ""] + ["- " + cross_line(row) for row in crossing]
    bullets = [line for line in section(record, "Evidence log").splitlines() if line.startswith("- ")]
    kept = set(range(max(0, len(bullets) - BRIEF_TAIL), len(bullets)))
    for node in focus:
        naming = [index for index, line in enumerate(bullets) if node in NODE_ID.findall(line)]
        kept |= set(naming[-BRIEF_PER_NODE:])
    out += ["", "## Evidence", "",
            "The latest %d lines naming each focus node and the last %d lines, in log order "
            "(%d of %d; the rest are in `record.md`)." % (BRIEF_PER_NODE, BRIEF_TAIL, len(kept), len(bullets)),
            ""] + [bullets[index] for index in sorted(kept)]
    notes = subject["notes"]
    if notes:
        note = notes[-1]
        out += ["", "## Latest session note: %s (%s)" % (note.name, note.status), "",
                " · ".join("%s: %s" % (key, note.fields.get(key) or "empty")
                           for key in ("date", "start", "end", "paused")), ""]
        for title in ("Next step", "Misconception candidates", "What worked"):
            text = section(note.body, title)
            out += ["### " + title, "", text or "Empty.", ""]
    return "\n".join(out).rstrip() + "\n"


def dashboard(subjects, today, warnings, openings, state=None, rewards_on=True):
    """`learn/Dashboard.md`: a one-screen index of every subject (spec section 9).
    `subjects` is `load_subjects()`'s list and `state` the vault's `rewards()`."""
    out = ["---", "type: learning-dashboard", 'updated: "%s"' % today.isoformat(), "generated: true",
           "cssclasses: [%s]" % SHARED_CLASSES, "---", "",
           "# Learning dashboard", "", "[[learn/Home|← Home]]", "", GENERATED, ""]
    if not subjects:
        out += ["No subjects yet. Use `/learn-start <subject>` in Claude Code or `$learn-start <subject>` in Codex.", ""]
    groups = [("Active", ("active", "diagnosing")), ("Paused", ("paused",)), ("Done", ("done",))]
    placed = set()
    for heading, statuses in groups + [("Other", None)]:
        members = [s for s in subjects if s["slug"] not in placed
                   and (statuses is None or s["fields"].get("status", "") in statuses)]
        if not members:
            continue
        out += ["## " + heading, ""]
        for s in sorted(members, key=lambda s: (s["fields"].get("title", s["slug"]).lower(), s["slug"])):
            placed.add(s["slug"])
            fields, nodes = s["fields"], s["nodes"]
            partial = sum(1 for node in nodes.values() if node["status"] in PARTIAL)
            last = to_date(fields.get("last_session"))
            # The title, then one quiet line: meter, counts, and status chips.
            line = '- [[learn/subjects/%s/progress|%s]] <span class="lv-row">%s · last %s' % (
                s["slug"], fields.get("title", s["slug"]),
                "%s %d/%d passed" % (meter(proven_count(nodes), partial, len(nodes)), proven_count(nodes),
                                     len(nodes)) if nodes else "no plan yet",
                short_date(last) if last else "never")
            line += "".join(tag(part) for part in (deadline_words(fields.get("deadline"), today),
                                                   pending_tag(nodes, fields, today)) if part)
            out.append(line + "</span>")
        out.append("")
    if rewards_on and state and state["badges"]:
        out += callout("abstract", plural(len(state["badges"]), "badge"),
                       ["%s: %s%s, %s" % (found["kind"], found["name"],
                                          "" if found["name"] == found["title"] else " (%s)" % found["title"],
                                          found["date"]) for found in state["badges"]], fold="-")
    # One line per subject, never one per node: records that predate the tag
    # leave nearly every proven node here, and that is the true state, not noise.
    shallow, total = [], 0
    for s in sorted(subjects, key=lambda s: (s["fields"].get("title", s["slug"]).lower(), s["slug"])):
        ids = recall_only(s["nodes"], s.get("events", []))
        passed = len(generation_eligible(s["nodes"]))
        if ids:
            total += len(ids)
            shallow.append("%s: %d of %d checked or solid (%s)"
                           % (s["fields"].get("title", s["slug"]), len(ids), passed, ", ".join(ids)))
    if shallow:
        out += ["> [!question]- %s recall-only" % plural(total, "node"),
                "> Passed checks, but no generation check yet (`learn/system/records.md`, *Evidence rule*)."]
        out += ["> - " + line for line in shallow] + [""]
    concerns = [row for row in cross_prereqs(subjects) if row["concern"]]
    if concerns:
        out += ["> [!warning]- %s to look at" % plural(len(concerns), "cross-subject prerequisite"),
                "> A plan rests on a topic from another subject that slipped, is not yet passed, "
                "or needed help when it last passed (`learn/system/records.md`, *Plan table*)."]
        out += ["> - " + cross_line(row) for row in concerns] + [""]
    if openings:
        out += ["## Open session notes", "",
                "> [!warning] A session note has no `end:`",
                "> A note stays open until `learn-resume` finalizes it "
                "(`learn/system/records.md`, *Closing an open note*). While it is open its "
                "topics don't count as passed and the next session can orphan it."]
        out += ["> - " + report for report in openings]
        out += [""]
    # Past MC checks whose answer slot did not rotate cannot be fixed by editing
    # a record, so they fold apart from the drift a record edit does fix, and
    # an identical line reported once per question shows once with a count.
    history = [line for line in warnings if line.endswith("(slot_rotation.py)")]
    fixable = [line for line in warnings if not line.endswith("(slot_rotation.py)")]
    if fixable:
        lines = counted(fixable)
        out += callout("bug", "%d record inconsistenc%s" % (len(lines), "y" if len(lines) == 1 else "ies"),
                       lines, fold="-")
    if history:
        lines = counted(line[:-len(" (slot_rotation.py)")] for line in history)
        out += ["> [!info]- %s" % plural(len(lines), "answer-slot repeat"),
                "> Logged multiple-choice checks where the correct answer did not rotate (`slot_rotation.py`). "
                "History to learn from, not a record to fix."]
        out += ["> - " + line for line in lines] + [""]
    out += callout("info", "The system", [
        "[[learn/Queries|Queries]] — live Dataview views across subjects and sessions",
        "[[learn/system/tutor|tutor.md]] — teaching philosophy and behaviour rules",
        "[[learn/system/workflow|workflow.md]] — the phases every subject goes through",
        "[[learn/system/records|records.md]] — what the records contain and how they update",
        "[[learn/system/diagrams|diagrams.md]] — mermaid and math rules for notes",
        "[[learn/me/preferences|preferences.md]] — how Edison learns, and what the evidence shows",
        "[[learn/README|README]] — how the whole thing fits together"], fold="-")
    return "\n".join(out)


def counted(lines):
    """Each distinct line once, in first-seen order, with ` (×N)` when repeated."""
    seen = {}
    for line in lines:
        seen[line] = seen.get(line, 0) + 1
    return [line if count == 1 else "%s (×%d)" % (line, count) for line, count in seen.items()]


# --------------------------------------------------------------------- driver

def semantic_warnings(nodes, plan_text, subject, fields, sessions, folder, ask_fn=None,
                      vault=None):
    """Jev-backed checks (PLAN-2026-09-22.md Phases 4 and 5).

    J1: does every logged check stand on its own without the lesson around it.
    J2: could a logged check's options be picked without reading the question.
    J4: does `resume.md` actually let a cold session continue -- the test
    `records.md` states and G1's word count cannot make.
    J5: does any node entry draw an analogy without saying where it breaks,
    the rule audit X7 rejected as ungateable before a semantic judgement was
    cheap.

    Kept as its own function, alongside the deterministic `consistency()`, so a
    semantic check is never the only copy of a rule and never runs unless
    `--semantic` asked for it. J3 (candidate matching) is deliberately not here:
    it is a once-per-session judgement `/learn-end` makes about a candidate that
    exists only in that session's note, so it lives behind
    `python3 .claude/hooks/jev.py match-candidate`, which both hosts call the
    same way.

    Every line comes back prefixed `semantic:` because these warnings appear and
    disappear with the flag: a `--semantic` run writes them into the dashboard's
    *Record inconsistencies* and the next plain session-start run drops them
    again. The prefix is what tells a reader that a vanished line was a judgement
    that was not re-made, not a problem that was fixed.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import jev  # noqa: E402 -- only reached under --semantic

    folder = Path(folder)
    # The vault under test, not the one this file happens to live in: `jev` reads
    # `.env` relative to it, so a `--vault` run against a copy must not pick up
    # the real vault's key. `folder` is <vault>/learn/subjects/<slug>.
    vault = vault or folder.resolve().parents[2]
    warnings = jev.probe_warnings(subject, folder / "sessions", ask_fn=ask_fn, vault=vault)
    warnings += jev.resume_warnings(subject, folder / "resume.md", ask_fn=ask_fn, vault=vault)
    warnings += jev.analogy_warnings(subject, folder / "sessions", ask_fn=ask_fn, vault=vault)
    warnings += jev.leak_warnings(subject, folder / "sessions", ask_fn=ask_fn, vault=vault)
    return ["semantic: " + warning for warning in warnings]


# ------------------------------------------------------------ the app's data

# The desktop app reads everything it shows from this one call, so its screens
# and the Obsidian views come from the same parser and cannot disagree
# (.scratch/vault-app/spec.md, *One parser*). Read-only, like --next.

MAP_CARD_W, MAP_DUMMY_W = 236, 18  # a skill-map card plus its gap; the lane a long edge reserves


def map_layout(nodes):
    """Skill-map positions from the same layout as the progress page's tree:
    ranks and bend points from layered(), x from bk(), with card-sized widths."""
    if not nodes:
        return None
    rank_of, layers, up, down, chains, width = layered(nodes)
    width = {v: (MAP_DUMMY_W if ">" in v else MAP_CARD_W) for v in width}
    x = bk(layers, up, down, width)
    low = min(x.values())
    return {"x": {v: x[v] - low for v in x}, "rank": rank_of,
            "chains": [[a, b, chain] for a, b, chain in chains]}


def app_state(loaded, vault, stamp, host="claude"):
    """Everything the app's screens show, as plain data."""
    import skill_overlap
    from vaultlib import theme_of
    today = stamp.date()
    inputs = rank_inputs(loaded)
    rewards_on, setting_warning = rewards_setting(vault)
    reward = rewards(inputs, today)
    sigil = "$" if host == "codex" else "/"
    heat_all, subjects, warnings, openings = {}, [], [], []
    for s in loaded:
        fields, nodes, events = s["fields"], s["nodes"], s["events"]
        sessions = [dict(note.fields, file=note.name) for note in s["notes"]]
        warnings += consistency(nodes, s["plan_text"], s["slug"], fields, sessions, s["folder"])
        openings += open_notes(s["notes"], s["slug"], host=None)
        heat = {}
        for event in events:
            if event["status"] in ("checked", "solid") and event["date"]:
                heat[event["date"]] = heat.get(event["date"], 0) + 1
                heat_all[event["date"]] = heat_all.get(event["date"], 0) + 1
        upcoming = up_next(nodes)
        subjects.append({
            "slug": s["slug"],
            "title": fields.get("title", s["slug"]),
            "status": fields.get("status", ""),
            "theme": theme_of(fields, s["slug"]),
            "deadline": fields.get("deadline", ""),
            "days_to_deadline": days_to_deadline(fields.get("deadline"), today),
            "last_session": fields.get("last_session", ""),
            "sessions": fields.get("sessions", ""),
            "next": fields.get("next", ""),
            "goal_met": fields.get("goal_met", ""),
            "proven": proven_count(nodes),
            "total": len(nodes),
            "pending": pending_tag(nodes, fields, today),
            "up_next": upcoming[0] if upcoming else None,
            "recall_only": len(recall_only(nodes, events)),
            "notes": [{"name": n.name, "status": n.status, "fields": n.fields} for n in s["notes"]],
            "nodes": [dict(id=e["id"], name=e["name"], status=e["status"], checked=e["checked"],
                           can_do=e.get("can_do", ""), prereqs=e.get("prereqs", []),
                           due=is_due(e, today, fields.get("deadline")))
                      for e in (nodes[k] for k in sorted(nodes, key=sort_key))],
            "heat": heat,
            "layout": map_layout(nodes),
        })
    ranked = rank(inputs, note_inputs(loaded), today)
    for found in ranked:
        found["typed"] = sigil + found["command"]
    return {
        "now": stamp.isoformat(timespec="minutes"),
        "today": today.isoformat(),
        "host": host,
        "ranked": ranked,
        "rewards_on": rewards_on,
        "badges": reward["badges"],
        "counts": reward["counts"],
        "streak": dict(reward["streak"], weeks=[{"start": w["start"], "result": w["result"],
                                                 "due": len(w["due"])}
                                                for w in reward["streak"]["weeks"]]),
        "heat": heat_all,
        "subjects": subjects,
        "open_notes": openings,
        "warnings": warnings + ([setting_warning] if setting_warning else []),
        "overlaps": skill_overlap.overlaps(subjects, {s["slug"]: s["record_text"] for s in loaded}),
    }


def json_default(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    return str(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--open-notes", action="store_true", dest="open_notes",
                        help="print open session notes and write nothing "
                             "(read-only; used by the SessionStart hook)")
    parser.add_argument("--due", action="store_true",
                        help="print nodes ranked by time since their last check and "
                             "write nothing (read-only). The pick for /learn-review, "
                             "and for /learn-check's older spacing node with --subject")
    parser.add_argument("--next", action="store_true", dest="next_action",
                        help="print the recommended actions, best first, and write "
                             "nothing (read-only)")
    parser.add_argument("--host", choices=("claude", "codex"), default="claude",
                        help="with --next or --open-notes, print /learn-... (claude) or "
                             "$learn-... (codex)")
    parser.add_argument("--rewards", action="store_true",
                        help="print the reward lines for one session (--subject and "
                             "--session) or one review (--review), and write nothing "
                             "(read-only). Prints nothing when rewards are off")
    parser.add_argument("--session", help="with --rewards and --subject, the session number")
    parser.add_argument("--review", help="with --rewards, the review number")
    parser.add_argument("--subject", help="with --due, restrict to one subject slug; "
                                          "with --rewards, the session's subject")
    parser.add_argument("--limit", type=int, default=None,
                        help="with --due, keep only the N stalest nodes")
    parser.add_argument("--per-subject", type=int, default=2, dest="per_subject",
                        help="with --due, how many nodes one subject may contribute "
                             "before --limit (0 lifts the cap). Default 2, so one "
                             "long-neglected subject cannot fill a whole review set")
    parser.add_argument("--gen", action="store_true",
                        help="with --due, mark each node that is recall-only and rests on an "
                             "unconditional truth: the candidates for a review's one "
                             "generation question, stalest first")
    parser.add_argument("--brief", action="store_true",
                        help="with --subject, print the resume brief /learn-resume loads in "
                             "place of the full files, and write nothing (read-only)")
    parser.add_argument("--pace", action="store_true",
                        help="print real active minutes against plan estimates per subject, "
                             "and the median ratio (read-only); --course narrows it")
    parser.add_argument("--course", help="with --pace, only subjects whose slug starts <course>-")
    parser.add_argument("--json", action="store_true", dest="as_json",
                        help="print everything the desktop app shows as JSON, and write "
                             "nothing (read-only); --host picks the command form")
    parser.add_argument("--semantic", action="store_true",
                        help="also run Jev-backed semantic checks (Phase 4). Off by "
                             "default: session start must stay offline, fast, and "
                             "deterministic (PLAN-2026-09-22.md, Engineering constraints)")
    args = parser.parse_args()
    if args.rewards and not (args.review or (args.subject and args.session)):
        parser.error("--rewards needs --subject and --session, or --review")
    if args.gen and not args.due:
        parser.error("--gen only applies to --due")
    if args.brief and not args.subject:
        parser.error("--brief needs --subject")

    vault = args.vault.resolve()
    stamp = datetime.now()
    today = stamp.strftime("%Y-%m-%d")
    loaded, missing = load_subjects(vault, stamp)
    warnings = ["%s: no record.md" % slug for slug in missing]
    openings, written = [], []
    for subject in loaded:
        openings += open_notes(subject["notes"], subject["slug"], host=args.host)

    if args.open_notes:
        # Printed into the tutor's context by session-start.sh. Silence means every
        # note is closed, which is the state the system expects at session start.
        for report in openings:
            print(report)  # the caller supplies the heading; a prefix here reads twice
        return 0

    if args.due:
        # Read-only like --open-notes: a review picks from the records without
        # touching them, so running this to decide what to ask never itself
        # changes what the dashboard says.
        rows, undated = due([(s["slug"], s["nodes"]) for s in loaded], stamp.date(),
                            subject=args.subject, per_subject=args.per_subject or None,
                            limit=args.limit)
        candidates = frozenset((s["slug"], node) for s in loaded
                               for node in recall_only(s["nodes"], s["events"])) if args.gen else frozenset()
        print(due_report(rows, undated, candidates))
        return 0

    if args.brief:
        chosen = next((s for s in loaded if s["slug"] == args.subject), None)
        if chosen is None:
            print("learn-status: no subject %s" % args.subject, file=sys.stderr)
            return 1
        print(brief(chosen, loaded, stamp.date()), end="")
        return 0

    if args.pace:
        rows, median = pace(loaded, course=args.course)
        print(pace_report(rows, median, course=args.course), end="")
        return 0

    if args.as_json:
        import json
        print(json.dumps(app_state(loaded, vault, stamp, host=args.host), default=json_default))
        return 0

    if args.next_action:
        print(next_report(rank(rank_inputs(loaded), note_inputs(loaded), stamp.date()), host=args.host))
        return 0

    if args.rewards:
        # Read-only, and silent when rewards are off or nothing qualifies: the
        # closing skills paste whatever this prints, so no output is no lines.
        if rewards_setting(vault)[0]:
            session_date = None
            if not args.review:
                chosen = next((s for s in loaded if s["slug"] == args.subject), None)
                for note in chosen["notes"] if chosen else []:
                    if same_source(note.name.rsplit("-", 1)[-1], "s", args.session):
                        session_date = note.fields.get("date")
            for line in reward_lines(rank_inputs(loaded), stamp.date(), subject=args.subject,
                                     session=args.session, review=args.review,
                                     session_date=session_date):
                print(line)
        return 0

    if args.semantic:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import jev  # noqa: E402 -- only imported when explicitly asked for
        if not jev.available(vault) and not args.quiet:
            print("learn-status: --semantic requested but jev is not available "
                  "(no TYPESAFE_API_KEY or typesafe-sdk not installed) -- running the "
                  "deterministic fallback half of each semantic check instead")

    rewards_on, setting_warning = rewards_setting(vault)
    day = stamp.date()
    inputs = rank_inputs(loaded)
    state = rewards(inputs, day)
    for subject in loaded:
        slug, folder, fields, nodes = subject["slug"], subject["folder"], subject["fields"], subject["nodes"]
        plan_text, record_text = subject["plan_text"], subject["record_text"]
        sessions = [dict(note.fields, file=note.name) for note in subject["notes"]]
        warnings += consistency(nodes, plan_text, slug, fields, sessions, folder)
        if args.semantic:
            # Not gated on `jev.available()`: with no key each semantic check
            # falls back to its deterministic half rather than vanishing, which
            # is the rule for every Jev check in PLAN-2026-09-22.md Phase 4.
            warnings += semantic_warnings(nodes, plan_text, slug, fields, sessions, folder,
                                          vault=vault)
        note = folder / "progress.md"
        own = rewards([(slug, nodes, fields, subject["events"])], day)
        note.write_text(progress_note(slug, folder, fields, nodes, record_text, sessions, day,
                                      events=subject["events"], rewards_on=rewards_on,
                                      state=own, streak=state["streak"]))
        written.append(str(note.relative_to(vault)))

    # A review note is not a session note and deliberately lives outside
    # learn/subjects/, so the per-subject loop above never sees it -- but its
    # multiple-choice checks carry the same `key:` field and must obey the same
    # slot-rotation rule. Without this line a review would be the one place in
    # the vault where MC slots were ungated, which is precisely the kind of
    # silent gap PLAN-2026-09-22.md exists to close.
    warnings += g4_mc_slots("review", vault / "learn" / "reviews")
    warnings += [setting_warning] if setting_warning else []

    page = vault / "learn" / "Home.md"
    page.write_text(home(rank(inputs, note_inputs(loaded), day), inputs, state, rewards_on, day))
    written.append(str(page.relative_to(vault)))
    board = vault / "learn" / "Dashboard.md"
    board.write_text(dashboard(loaded, day, warnings,
                               [report for subject in loaded
                                for report in open_notes(subject["notes"], subject["slug"], host=None)],
                               state, rewards_on))
    written.append(str(board.relative_to(vault)))

    if not args.quiet:
        print("learn-status: wrote " + ", ".join(written))
        for report in openings:
            print("learn-status: open session note: " + report)
        for warning in warnings:
            print("learn-status: inconsistency: " + warning)
    return 0


if __name__ == "__main__":
    sys.exit(main())
