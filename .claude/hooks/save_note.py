#!/usr/bin/env python3
"""The save note: what the tutor wants written this turn, carried in its reply and written here.

Writing a record used to take its own model call: the tutor ran a script to append the evidence line, then wrote the
reply in a second call, and each call re-reads the whole conversation. Over 61 lessons (19 Oct to 17 Nov 2026) those
write calls were 919 of 3,139 calls and 31% of the tutor's cost. So mid-lesson writes now ride in the reply itself, in
one hidden block at its end, and the Stop hooks of both hosts write them after the reply ends:

    <!-- save
    @evidence 2026-11-18 s03: which half is dropped for 9 in [1,3,5,7,9] → the left → right → n2 checked
    @node n2 checked | s03 dropped the correct half unaided
    @lesson
    ### n2 — Discard half
    **Motivate.** ...
    -->

Keys, each `@key` starting an item and any lines after it (up to the next `@` line) being its body:

  evidence       record.md, *Evidence log*: one line, appended as a bullet.
  node           record.md *Nodes* and plan.md: `nN <status>` and optionally `| <latest evidence>`. Sets the status in
                 both tables, *Last checked* to today, and adds the node to the session note's `nodes:`.
  lesson         the open session note, *Lesson*: the body, appended (the template's placeholder entry is dropped).
  retrieval      the open session note, *Retrieval checks*.
  misconception  the open session note, *Misconception candidates*.
  preference     the open session note, *Preference candidates*.
  correction     the open session note, *Corrections*.

Everything else (opening a note, /learn-start's files, /learn-end's rewrites) is still written by the tutor directly.
An item that cannot be written is reported to the tutor at the start of its next turn, never silently dropped. Each
item is written once: a reply that is held and sent again repeats its note, and the digest keeps the second copy out.
Dependency-free, like vaultlib, so both hosts' hooks can import it.
"""

import hashlib
import json
import re
from datetime import date
from pathlib import Path

from vaultlib import open_session_note

# A complete block. An unfinished one (a reply still streaming, or cut off) is hidden by `strip` but never written.
BLOCK = re.compile(r"<!--\s*save\b(.*?)-->", re.S)
OPEN_TAIL = re.compile(r"<!--\s*save\b(?:(?!-->).)*\Z", re.S)
ITEM = re.compile(r"^@([a-z]+)\b[ \t]*(.*)$")
NODE = re.compile(r"^(n\d+[a-z]?)\s+(planned|skipped|introduced|checked|solid|decayed)\s*(?:\|\s*(.+))?$")
STATUSES_CHECKED = {"checked", "solid", "decayed"}
SECTIONS = {"lesson": "Lesson", "retrieval": "Retrieval checks", "misconception": "Misconception candidates",
            "preference": "Preference candidates", "correction": "Corrections"}
KEYS = {"evidence", "node", *SECTIONS}
DIGESTS_KEEP = 400


def strip(text):
    """The reply as the learner should read it: every save block gone, finished or still streaming."""
    if not text or "<!--" not in text:
        return text
    out = OPEN_TAIL.sub("", BLOCK.sub("", text))
    return re.sub(r"\n{3,}", "\n\n", out).rstrip()


def parse(text):
    """(items, problems). An item is (key, body). Lines before the first `@` key, or an unknown key, are problems."""
    items, problems = [], []
    for block in BLOCK.findall(text or ""):
        current = None
        for line in block.strip("\n").splitlines():
            m = ITEM.match(line)
            if m:
                key, rest = m.group(1), m.group(2)
                if key not in KEYS:
                    problems.append(f"@{key} is not a save key (use {', '.join('@' + k for k in sorted(KEYS))})")
                    current = None
                    continue
                current = [key, [rest] if rest else []]
                items.append(current)
            elif current is not None:
                current[1].append(line)
            elif line.strip():
                problems.append(f"text before the first @key: {line.strip()[:60]!r}")
    return [(key, "\n".join(lines).strip()) for key, lines in items], problems


def _section_bounds(lines, heading):
    """(start, end) line indexes of a '## heading' section's body, or None."""
    start = next((i for i, l in enumerate(lines) if l.startswith("## ") and l[3:].strip().lower().startswith(heading.lower())), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    return start + 1, end


def append_to_section(text, heading, body):
    """The text with body added at the end of the section (before trailing blank lines), or None if no such section."""
    lines = text.split("\n")
    bounds = _section_bounds(lines, heading)
    if bounds is None:
        return None
    start, end = bounds
    while end > start and not lines[end - 1].strip():
        end -= 1
    return "\n".join(lines[:end] + ["", *body.split("\n"), ""] + lines[end:]).replace("\n\n\n", "\n\n")


def drop_placeholder(text):
    """A new note's Lesson section holds the template's `### {{node id}}` entry; the first real entry replaces it."""
    lines = text.split("\n")
    i = next((k for k, l in enumerate(lines) if l.startswith("### {{node id}}")), None)
    if i is None:
        return text
    j = next((k for k in range(i + 1, len(lines)) if lines[k].startswith(("## ", "### "))), len(lines))
    return "\n".join(lines[:i] + lines[j:])


def set_table_cells(text, row_match, changes, header_names):
    """Set cells by column header in the first markdown-table row whose first cells satisfy row_match.

    changes maps a header name to a value. Returns the new text, or None when no row matched. Columns are found by
    header name, so a plan or record with extra columns still works.
    """
    lines = text.split("\n")
    header = None
    for i, line in enumerate(lines):
        if not line.startswith("|"):
            header = None
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = cells if any(h in cells for h in header_names) else None
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        if row_match(cells):
            for name, value in changes.items():
                if name in header and header.index(name) < len(cells):
                    cells[header.index(name)] = value
            lines[i] = "| " + " | ".join(cells) + " |"
            return "\n".join(lines)
    return None


def add_note_node(text, node):
    """Add a node id to the session note's `nodes: [...]` frontmatter list, once."""
    m = re.search(r"^nodes:\s*\[(.*?)\]\s*$", text, re.M)
    if not m:
        return text
    have = [x.strip().strip("\"'") for x in m.group(1).split(",") if x.strip()]
    if node in have:
        return text
    return text[:m.start()] + "nodes: [" + ", ".join(have + [node]) + "]" + text[m.end():]


def _digest(note, key, body):
    return hashlib.sha256(f"{note}\0{key}\0{body}".encode()).hexdigest()[:16]


def apply(vault, subject, reply, runtime, today=None):
    """Write every item of the reply's save note. Returns (saved, problems): lists of short strings."""
    items, problems = parse(reply)
    if not items and not problems:
        return [], []
    vault, today = Path(vault), today or date.today().isoformat()
    if not subject:
        return [], problems + [f"{len(items)} item(s): no subject is selected, so nothing was saved"]
    folder = vault / "learn" / "subjects" / subject
    note = open_session_note(vault, subject)
    note_path = note[0] if note else None
    seen_path = Path(runtime) / "save-note.digests"   # not *.json: the Codex hook reads every .json there as a session
    try:
        seen = json.loads(seen_path.read_text())
    except (OSError, ValueError):
        seen = []
    saved = []
    files = {}

    def read(path):
        if path not in files:
            files[path] = path.read_text() if path.is_file() else None
        return files[path]

    for key, body in items:
        where = str(note_path or folder)
        d = _digest(where, key, body)
        if d in seen:
            continue
        if not body:
            problems.append(f"@{key} is empty")
            continue
        if key == "evidence":
            path = folder / "record.md"
            text = read(path)
            line = " ".join(body.split("\n")).strip()
            new = append_to_section(text, "Evidence log", "- " + line.lstrip("- ")) if text is not None else None
            if new is None:
                problems.append("@evidence: record.md has no Evidence log section")
                continue
            files[path] = new
            saved.append("evidence line in record.md")
        elif key == "node":
            m = NODE.match(" ".join(body.split()))
            if not m:
                problems.append(f"@node {body[:40]!r}: write it as `nN <status>` or `nN <status> | <latest evidence>`")
                continue
            node, status, latest = m.groups()
            record, plan = folder / "record.md", folder / "plan.md"
            changes = {"Status": status}
            if status in STATUSES_CHECKED:
                changes["Last checked"] = today
            if latest:
                changes["Evidence (latest)"] = latest
            rtext = read(record)
            rnew = set_table_cells(rtext, lambda c: re.match(rf"{node}\b", c[0]) is not None, changes, ("Node",)) if rtext else None
            ptext = read(plan)
            pnew = set_table_cells(ptext, lambda c: c[0] == node, {"Status": status}, ("Id",)) if ptext else None
            if rnew is None and pnew is None:
                problems.append(f"@node {node}: no row for {node} in record.md or plan.md")
                continue
            if rnew is not None:
                files[record] = rnew
            if pnew is not None:
                files[plan] = pnew
            if note_path:
                files[note_path] = add_note_node(read(note_path), node)
            missing = [f for f, t in ((record.name, rnew), (plan.name, pnew)) if t is None]
            saved.append(f"{node} → {status}" + (f" (no row in {', '.join(missing)})" if missing else ""))
            if missing:
                problems.append(f"@node {node}: no row in {', '.join(missing)}; the other table was updated")
        else:
            if not note_path:
                problems.append(f"@{key}: {subject} has no open session note")
                continue
            text = read(note_path)
            if key == "lesson":
                text = drop_placeholder(text)
            new = append_to_section(text, SECTIONS[key], body)
            if new is None:
                problems.append(f"@{key}: the session note has no {SECTIONS[key]} section")
                continue
            files[note_path] = new
            saved.append(f"{SECTIONS[key].lower()} in the session note")
        seen.append(d)

    for path, text in files.items():
        if text is not None and (not path.is_file() or path.read_text() != text):
            tmp = path.with_name("." + path.name + ".save-tmp")
            tmp.write_text(text)
            tmp.replace(path)
    seen_path.parent.mkdir(parents=True, exist_ok=True)
    seen_path.write_text(json.dumps(seen[-DIGESTS_KEEP:]))
    return saved, problems


def notice(problems):
    """The line the next turn's hook gives the tutor when part of a save note was not written."""
    if not problems:
        return ""
    return ("Part of your last save note was not written: " + "; ".join(problems) +
            ". Write those again in this reply's save note, or edit the file directly.")
