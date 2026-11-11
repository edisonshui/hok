#!/usr/bin/env python3
"""Place a multiple-choice key before display and return the matching log field."""

import argparse
try:
    import fcntl
except ImportError:  # Windows has no fcntl: turns are not locked against each other there
    fcntl = None
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

import session_note
import slot_rotation


def notes_folder(vault, scope, subject):
    if scope == "review":
        return vault / "learn/reviews"
    return vault / "learn/subjects" / subject / "sessions"


def bodies(folder):
    return [session_note.read(path).body for path in sorted(folder.glob("*.md"))] if folder.is_dir() else []


def still_counting(vault, prepared, now):
    """The prepared entries that still count for their own scope and subject.

    Everything else was logged, abandoned, or written before entries carried
    their evidence and time, and is dropped when the file is rewritten.
    """
    kept, read = [], {}
    for entry in prepared:
        if not isinstance(entry, dict) or entry.get("scope") not in ("lesson", "review") \
                or not isinstance(entry.get("subject"), str):
            continue
        folder = notes_folder(vault, entry["scope"], entry["subject"])
        if folder not in read:
            read[folder] = bodies(folder)
        kept += slot_rotation.pending([entry], entry["scope"], entry["subject"], read[folder], now)
    return kept


def prepare(vault, scope, subject, question, correct, distractors):
    options = [correct, *distractors]
    if len(options) < 3 or len(options) > 26 or any(not option.strip() or " / " in option for option in options):
        raise ValueError("provide 3–26 nonempty options without the evidence separator ' / '")
    if len(set(options)) != len(options) or not question.strip():
        raise ValueError("question must be nonempty and options must be distinct")
    runtime = vault / "learn/.mc-runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    with (runtime / "placement.lock").open("w") as lock:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX)
        state_path = runtime / "placement.json"
        try:
            prepared = json.loads(state_path.read_text())
        except FileNotFoundError:
            prepared = []
        now = datetime.now()
        prepared = still_counting(vault, prepared, now)
        folder = notes_folder(vault, scope, subject)
        history = ([slot for _, slot in slot_rotation.logged(folder)]
                   + [entry["slot"] for entry in slot_rotation.pending(prepared, scope, subject, bodies(folder), now)])
        candidates = [slot for slot in range(1, len(options) + 1) if slot_rotation.allowed(slot, history)]
        if not candidates:
            raise ValueError("no key slot satisfies the current sequence; inspect the logged history")
        recent = history[-(slot_rotation.WINDOW - 1):]
        slot = min(candidates, key=lambda candidate: (recent.count(candidate), candidate))
        ordered = [*distractors]
        ordered.insert(slot - 1, correct)
        result = {
            "slot": slot,
            "options": ordered,
            "display": question + "\n" + "\n".join(f"{chr(65 + index)}. {option}" for index, option in enumerate(ordered)),
            "evidence": f"key: {slot}/{len(ordered)} — options: " + " / ".join(ordered),
        }
        prepared.append({"scope": scope, "subject": subject, "slot": slot, "evidence": result["evidence"],
                         "prepared": now.isoformat(timespec="seconds")})
        with tempfile.NamedTemporaryFile("w", dir=runtime, delete=False) as temporary:
            json.dump(prepared, temporary)
            temporary_path = temporary.name
        os.replace(temporary_path, state_path)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--scope", choices=("lesson", "review"), required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--question", required=True)
    parser.add_argument("--correct", required=True)
    parser.add_argument("--distractor", action="append", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", args.subject):
        parser.error("subject must be a lowercase hyphenated slug")
    print(json.dumps(prepare(args.vault, args.scope, args.subject, args.question,
                             args.correct, args.distractor), ensure_ascii=False))


if __name__ == "__main__":
    main()
