#!/usr/bin/env python3
"""Usage: leak-check.py <stdout.txt | step dir | run dir> ...
Flags learner-visible tutor text that carries the tutor's working notes or the
record's internal terms (tutor.md, *Reply shape*). Reads claude -p stream-json:
every top-level assistant text block, including the ones written between tool
calls, because the learner sees those as they stream. Fenced code is skipped
(mermaid sources name nodes by design), and so are links to a subject's log.md.
Prints one line per hit and exits 1 if there were any, 0 if none.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "hooks"))
import save_note  # noqa: E402  the hidden save note is not learner-visible text

PATTERNS = [
    ("working note", re.compile(r"^(Now|Next),? (the )?(record|plan|resume|session note|preferences)\b", re.I)),
    ("working note", re.compile(r"\b(Mirror nodes|from the templates?|plan reorder|State loaded|Both reviews are back|Applying (those|their) fixes|Trimming the resume|resume summary (is|ran)|200-word)\b", re.I)),
    ("working note", re.compile(r"^Step \d+[,:.] ")),
    ("working note", re.compile(r"\b(Logged|I logged|I've logged|Logging)\b.*\b(note|record|evidence)\b|\bSetting up (today's |the )?(practice |session )?note\b|\bneeded approval\b", re.I)),
    ("session label", re.compile(r"\b([Ss]ession|[Pp]ractice|[Ll]esson|[Rr]eview)( note)? [sr]\d+\b")),
    ("node label", re.compile(r"(?<![\w./-])n\d+[a-z]?\b")),
    ("record term", re.compile(r"\b(strands?|two-sighting|decay[- ]check|floor and ceiling|evidence log|transition marker)\b", re.I)),
    ("record term", re.compile(r"\bchanges? (its |a |the )?status\b|\bstatus (doesn't|does not|won't|will not) change\b", re.I)),
    ("helper name", re.compile(r"\b(fact-checker|plan[- ]reviewer|reviewers|the checker|mc-preflight|write-check|learn-status)\b", re.I)),
    ("file name", re.compile(r"\b(record|plan|resume|preferences|progress|Home|Dashboard)\.md\b")),
]
FENCE = re.compile(r"^\s*(```|~~~)")
LOG_LINK = re.compile(r"\[\[[^\]]*log(\|[^\]]*)?\]\]|`?[\w./-]*log\.md`?")


def visible_text(stream: Path):
    for raw in stream.read_text(errors="replace").splitlines():
        try:
            ev = json.loads(raw)
        except ValueError:
            continue
        if ev.get("type") != "assistant" or ev.get("parent_tool_use_id"):
            continue
        for block in ev.get("message", {}).get("content", []):
            if block.get("type") == "text":
                yield save_note.strip(block["text"])


def scan(stream: Path, label: str) -> int:
    hits = 0
    for text in visible_text(stream):
        in_fence = False
        for line in text.splitlines():
            if FENCE.match(line):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            line = LOG_LINK.sub("", line)
            for kind, pat in PATTERNS:
                m = pat.search(line)
                if m:
                    hits += 1
                    print(f"{label}: {kind} '{m.group(0)}': {line.strip()[:160]}")
                    break
    return hits


def streams(arg: Path):
    if arg.is_file():
        yield arg, arg.parent.name
    elif (arg / "stdout.txt").is_file():
        yield arg / "stdout.txt", arg.name
    else:
        for step in sorted(p for p in arg.iterdir() if (p / "stdout.txt").is_file()):
            yield step / "stdout.txt", f"{arg.name}/{step.name}"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    total = sum(scan(s, label) for a in sys.argv[1:] for s, label in streams(Path(a)))
    print(f"{total} leak(s)")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
