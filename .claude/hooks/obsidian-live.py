#!/usr/bin/env python3
"""Mirror Claude Code's visible conversation to Markdown using lifecycle hooks.

MessageDisplay delivers whole-line batches while interactive responses stream.
The persisted JSONL is used for backfill and reconciliation at turn boundaries.
No network calls, background service, Obsidian plugin, or AI tokens are needed.
"""

import argparse
import base64
try:
    import fcntl
except ImportError:  # Windows has no fcntl: turns are not locked against each other there
    fcntl = None
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vaultlib import frontmatter, open_session_note, theme_of  # noqa: E402


IDLE_SECONDS = 15 * 60      # a longer gap means the learner stepped away
BREAK_SECONDS = 45 * 60     # the working block from learn/me/preferences.md
REMIND_SECONDS = 20 * 60    # re-offer a break this often after the first
CLOCK_KEEP = 50             # session clocks retained in clocks.json
PENDING_KEEP = 2            # undelivered notices held per session
NOTICE_KEEP = 20            # standing log notices held per conversation
FLAGGED_KEEP = 40           # probe digests remembered, so one is withdrawn once
PROBE_BUDGET = 3.0          # seconds of Jev time per picker; the hook timeout is 5
NOTICE_ROLE = "Tutor — notice"
CODE_ROLE = "You — code"
SHARE_MAX_AGE = 6 * 3600    # a runner share older than this is stale, not a reply
SHARE_CODE_CHARS = 20000
SHARE_OUTPUT_CHARS = 8000


def now():
    return datetime.now(timezone.utc).isoformat()


def parse_time(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def local_clock(value):
    """A wall-clock HH:MM in the learner's timezone, or an empty string."""
    stamp = parse_time(value)
    return stamp.astimezone().strftime("%H:%M") if stamp else ""


def local_date(value):
    """The YYYY-MM-DD in the learner's timezone; a UTC slice dates evening starts a day late."""
    stamp = parse_time(value)
    return stamp.astimezone().strftime("%Y-%m-%d") if stamp else str(value)[:10]


def minutes(seconds):
    return int(round(seconds / 60.0))


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text() == content:
        return
    fd, temporary = tempfile.mkstemp(prefix=".live-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def entry(key, role, text, timestamp=None):
    return {"key": key, "role": role, "text": text, "time": timestamp or now()}


def emphasize(prompt):
    """Bold a one-line prompt; leave a multi-line or fenced one alone.

    A probe is required to carry its own code (learn/system/tutor.md), and
    wrapping a fenced block in ** would break both the fence and the emphasis.
    """
    if not prompt or "\n" in prompt or "`" in prompt:
        return prompt
    return "**" + prompt + "**"


def questions_text(questions):
    parts = []
    for question in questions:
        prompt = question.get("question", "")
        if prompt:
            parts.append(emphasize(prompt))
        options = question.get("options", [])
        if options:
            parts.append("\n".join(
                "- **" + option.get("label", "") + "**" +
                (" — " + option["description"] if option.get("description") else "")
                for option in options
            ))
    return "\n\n".join(parts)


def answers_text(result):
    if isinstance(result, dict) and isinstance(result.get("answers"), dict):
        # The learner's typed note on a pick is the reasoning behind it, so it is logged with the answer.
        annotations = result.get("annotations") if isinstance(result.get("annotations"), dict) else {}
        parts = []
        for question, answer in result["answers"].items():
            note = annotations.get(question, {}).get("notes") if isinstance(annotations.get(question), dict) else None
            parts.append(emphasize(question) + "\n\n" + str(answer) + ("\n\nNote: " + note if note else ""))
        return "\n\n".join(parts)
    return ""


def user_text(text):
    # User-typed skills are persisted as XML; their expanded instructions are meta.
    command = re.search(r"<command-name>(.*?)</command-name>", text, re.S)
    if command:
        arguments = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
        return command[1] + (" " + arguments[1] if arguments and arguments[1] else "")
    if text.lstrip().startswith(("<task-notification>", "<local-command-", "<system-reminder>", "<agent-message")):
        return ""
    return text


def stop_feedback(row):
    """A meta row a blocking Stop hook leaves, telling the model to redo its reply."""
    content = row.get("message", {}).get("content", "")
    if isinstance(content, list):
        content = "".join(block.get("text", "") for block in content if block.get("type") == "text")
    return row.get("type") == "user" and str(content).startswith("Stop hook feedback:")


IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
ATTACHMENTS = "Claude outputs/attachments"   # gitignored with the rest of Claude outputs/


def save_image(vault, block):
    """Write a pasted image into the vault once, named by its content, and
    return the embed for it, or "" when it cannot be shown."""
    source = block.get("source") or {}
    extension = IMAGE_TYPES.get(source.get("media_type"))
    if not vault or source.get("type") != "base64" or not extension:
        return ""
    try:
        data = base64.b64decode(source.get("data", ""), validate=True)
    except ValueError:
        return ""
    name = hashlib.sha256(data).hexdigest()[:16] + "." + extension
    path = vault / ATTACHMENTS / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return "![[%s/%s|600]]" % (ATTACHMENTS, name)


def place_images(texts, embeds, paste_ids):
    """Swap each "[Image #N]" token for its embed; return the embeds left over.

    `imagePasteIds` lists the paste number of each image block in order, which
    is what the terminal printed as [Image #N].
    """
    leftover = []
    for position, embed in enumerate(embeds):
        token = "[Image #%s]" % paste_ids[position] if position < len(paste_ids) else None
        holder = next((item for item in texts if token and token in item["display"]), None)
        if holder:
            holder["display"] = holder["display"].replace(token, embed, 1)
        else:
            leftover.append(embed)
    return leftover


def read_transcript(path, vault=None):
    """Read the transcript into log entries.

    A blocking Stop hook (the em-dash check) makes the model rewrite its last
    reply, and both versions stay in the JSONL. The blocked one is dropped here
    and its text returned in metadata["superseded"], so a copy that already
    streamed into the live buffer can be dropped too.
    """
    entries, question_ids, seen = [], set(), set()
    metadata = {}
    reply_id, reply_keys = None, []   # the text entries of the latest Claude reply
    if not path or not Path(path).is_file():
        return entries, metadata
    with Path(path).open() as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue  # A hook can run before the final JSONL line is flushed.
            if row.get("isMeta") and stop_feedback(row) and reply_keys:
                metadata.setdefault("superseded", []).extend(
                    item["text"] for item in entries if item["key"] in reply_keys)
                entries = [item for item in entries if item["key"] not in reply_keys]
                reply_id, reply_keys = None, []
            if row.get("isSidechain") or row.get("isMeta"):
                continue
            kind = row.get("type")
            if kind not in ("assistant", "user"):
                continue
            row_id = row.get("uuid")
            if row_id and row_id in seen:
                continue
            if row_id:
                seen.add(row_id)
            message = row.get("message", {})
            content = message.get("content", [])
            stamp = row.get("timestamp")
            key = row_id or f"row-{len(seen)}"
            if kind == "assistant":
                model = message.get("model")
                if model and model != "<synthetic>":
                    metadata["model"] = model
                effort = row.get("effort")
                if effort:
                    metadata["effort"] = effort
            if isinstance(content, str):
                text = user_text(content) if kind == "user" else content
                if text:
                    entries.append(entry(key, "You" if kind == "user" else "Claude", text, stamp))
                continue
            texts, embeds = [], []
            for index, block in enumerate(content):
                block_type = block.get("type")
                if block_type == "text":
                    text = block.get("text", "")
                    if kind == "user":
                        text = user_text(text)
                    if text:
                        entries.append(entry(f"{key}-{index}", "You" if kind == "user" else "Claude", text, stamp))
                        if kind == "user":
                            # `text` stays as typed so reconciliation still matches
                            # the prompt the hook saw; only rendering reads display.
                            entries[-1]["display"] = text
                            texts.append(entries[-1])
                        if kind == "assistant":
                            message_id = message.get("id") or key
                            if message_id != reply_id:
                                reply_id, reply_keys = message_id, []
                            reply_keys.append(f"{key}-{index}")
                elif block_type == "thinking" and kind == "assistant":
                    # The terminal prints the thinking summary; twice a lesson
                    # explanation existed only there, so the log must show it too.
                    text = (block.get("thinking") or "").strip()
                    if text:
                        entries.append(entry(f"{key}-{index}", "Claude — thinking", text, stamp))
                elif block_type == "image" and kind == "user":
                    embeds.append((index, save_image(vault, block) or "[Image attached in the terminal]"))
                elif block_type == "tool_use" and block.get("name") == "AskUserQuestion":
                    question_ids.add(block["id"])
                    entries.append(entry("questions-" + block["id"], "Claude — questions",
                                         questions_text(block.get("input", {}).get("questions", [])), stamp))
                elif block_type == "tool_result" and block.get("tool_use_id") in question_ids:
                    text = answers_text(row.get("toolUseResult"))
                    if not text:
                        # Older clients persist the answer only as a tool result string.
                        text = block.get("content", "")
                        if not isinstance(text, str):
                            text = "\n".join(b.get("text", "") for b in text if b.get("type") == "text")
                    if text:
                        entries.append(entry("answers-" + block["tool_use_id"], "You — answers", text, stamp))
            if embeds:
                leftover = place_images(texts, [embed for _, embed in embeds], row.get("imagePasteIds") or [])
                for index, embed in [pair for pair in embeds if pair[1] in leftover]:
                    entries.append(entry(f"{key}-{index}", "You", embed, stamp))
    return entries, metadata


def read_clocks(runtime):
    path = runtime / "clocks.json"
    if not path.exists():
        return {"notes": {}}
    try:
        store = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {"notes": {}}   # a corrupt clock loses minutes, never a session
    store.setdefault("notes", {})
    return store


def prune_clocks(notes):
    """Keep the most recently touched sessions and drop the rest.

    The file is append-only in practice -- one small entry per session note,
    forever -- so it is bounded here rather than left to grow. Ordering is by
    last_user because a session's last message is what makes its clock stale.
    """
    if len(notes) <= CLOCK_KEEP:
        return
    ordered = sorted(notes, key=lambda key: notes[key].get("last_user", ""), reverse=True)
    for key in ordered[CLOCK_KEEP:]:
        del notes[key]


def away_notice(gap, active, idle):
    return ("Clock: %d minutes since the learner's previous message, so they stepped away. "
            "Recap where you left off in at most two lines before asking anything new. That "
            "gap does not count toward the working block. Active time so far: %d minutes "
            "(away: %d minutes in total)."
            % (minutes(gap), minutes(active), minutes(idle)))


def break_notice(active):
    return ("Clock: %d minutes of active working time, away time excluded. Say so, offer a "
            "5-10 minute break, and checkpoint with /learn-end break before pausing."
            % minutes(active))


def update_clock(vault, runtime, state, kind):
    """Time the session note this turn belongs to, and hand back anything to say.

    Wall-clock elapsed time is a bad proxy for a 45-minute working block: in the
    first real session the learner stepped away for 103 minutes mid-plan and the
    break timer measured from the wrong anchor. A hook can measure this exactly
    and a model cannot measure it at all, so it is measured here.

    Two things this gets right that the previous version did not.

    First, the clock is keyed on the **session note**, not on the Claude Code
    conversation. s02 and s03 ran inside one conversation, so s03's clock carried
    s02's total and reported it as its own. The note is the correct key because
    the note is also what decides whether a resume continues a session or opens a
    new one -- key the clock to it and the two cannot disagree. A brand-new note
    starts from zero rather than inheriting the previous session's last message,
    so time *between* sessions is never billed to the session that follows.

    Second, a notice is queued rather than returned when the caller cannot deliver
    it. Claude Code puts plain hook stdout into context for UserPromptSubmit and
    SessionStart only, so the 45-minute announcement this used to emit from the
    AskUserQuestion PostToolUse hook was discarded -- while the counter that
    suppresses it for the next twenty minutes was incremented anyway. Crossing the
    mark while answering a picker therefore lost the announcement outright. Now
    accumulation always happens and delivery waits for a turn that reaches the
    learner.
    """
    subject = state.get("subject")
    if not subject:
        return ""                    # no learning session selected yet
    found = open_session_note(vault, subject)
    if not found:
        return ""                    # between sessions: the note is closed
    note_path, _ = found
    key = "%s/%s" % (subject, note_path.stem)
    stamp = datetime.now(timezone.utc)
    notice = ""
    with (runtime / "clocks.lock").open("w") as lock:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX)
        store = read_clocks(runtime)
        notes = store["notes"]
        clock = notes.setdefault(key, {})
        previous = parse_time(clock.get("last_user"))
        gap = (stamp - previous).total_seconds() if previous else 0.0
        away = gap > IDLE_SECONDS
        if previous:
            clock["idle" if away else "active"] = clock.get("idle" if away else "active", 0.0) + gap
        clock["last_user"] = stamp.isoformat()
        clock.setdefault("first_user", clock["last_user"])
        clock["note"] = str(note_path.relative_to(vault))
        active = clock.get("active", 0.0)
        pending = clock.setdefault("pending", [])
        if away:
            pending.append(away_notice(gap, active, clock.get("idle", 0.0)))
        announced = clock.get("announced", 0)
        if active >= BREAK_SECONDS + announced * REMIND_SECONDS:
            clock["announced"] = announced + 1
            pending.append(break_notice(active))
        del pending[:-PENDING_KEEP]
        if kind == "prompt" and pending:
            # UserPromptSubmit is one of the two events whose stdout reaches context.
            notice = "\n".join(pending)
            clock["pending"] = []
        prune_clocks(notes)
        atomic_write(runtime / "clocks.json", json.dumps(store, ensure_ascii=False))
    return notice


def clock_report(vault, runtime, subject):
    """What /learn-end writes into `active_minutes:` / `idle_minutes:`.

    The measurement existed from the start and nothing ever read it back, so both
    fields were written `unknown` in every note that had them. This is that read
    path. It reports `unknown` rather than zero when no clock was recorded: zero
    is a measurement, and claiming one that was never taken is the kind of false
    record the whole system is built to avoid.
    """
    found = open_session_note(vault, subject) if subject else None
    if not found:
        return ("note: none\nactive_minutes: unknown\nidle_minutes: unknown\n"
                "reason: no open session note for %s" % (subject or "any subject"))
    note_path, _ = found
    clock = read_clocks(runtime)["notes"].get("%s/%s" % (subject, note_path.stem))
    if not clock or not clock.get("first_user"):
        return ("note: %s\nactive_minutes: unknown\nidle_minutes: unknown\n"
                "reason: the note is open but no clock was recorded for it"
                % note_path.relative_to(vault))
    return ("note: %s\nactive_minutes: %d\nidle_minutes: %d"
            % (note_path.relative_to(vault),
               minutes(clock.get("active", 0.0)), minutes(clock.get("idle", 0.0))))


def promote_or_reconcile(state, canonical):
    """Prefer JSONL once it contains the visible turn, retaining interrupted text."""
    current = state.get("current", [])
    baseline_keys = {item["key"] for item in state.get("baseline", [])}
    new_canonical = [item for item in canonical if item["key"] not in baseline_keys]
    remaining = list(new_canonical)
    complete = True
    for item in current:
        match = next((i for i, other in enumerate(remaining)
                      if other["role"] == item["role"] and other["text"] == item["text"]), None)
        if match is None:
            complete = False
            break
        remaining.pop(match)
    if complete:
        state["baseline"] = canonical
        state["current"] = []
    return complete


def put_current(state, item):
    for index, existing in enumerate(state["current"]):
        if existing["key"] == item["key"]:
            state["current"][index] = item
            return
    state["current"].append(item)


def put_notice(state, notice):
    """Record a standing notice about an entry, at most once per key."""
    notices = state.setdefault("notices", [])
    if any(existing["key"] == notice["key"] for existing in notices):
        return
    notices.append(notice)
    del notices[:-NOTICE_KEEP]


def merge_notices(items, notices):
    """Splice standing notices into the conversation, after the entry each is about.

    This is the seam PLAN-2026-09-22.md asked for before any code was written.
    A notice cannot live in `baseline` or `current`: `promote_or_reconcile`
    replaces `baseline` wholesale with the JSONL transcript as soon as the
    visible turn lands there, and a notice has no JSONL row to be replaced by,
    so it would vanish on the next keystroke. That is the exact reason the
    inline half of J1 was declined twice. Held in a third list and merged only
    at render time, it survives every reconciliation, because reconciliation
    never sees it.

    The anchor is an entry key, never a position. `questions-<tool_use_id>` is
    built identically by the PreToolUse branch and by `read_transcript`, so it
    names the same question before and after promotion -- verified against the
    saved state, where all 100 recorded question entries carry a real `toolu_`
    id and none fell back to the placeholder key.

    An anchor that is not present yet, or ever, puts its notice at the end
    rather than dropping it. A warning in the wrong place is recoverable; a
    warning silently discarded is the failure this whole function exists to fix.
    """
    if not notices:
        return items
    merged, pending = [], list(notices)
    for item in items:
        merged.append(item)
        for notice in [row for row in pending if row.get("anchor") == item["key"]]:
            pending.remove(notice)
            merged.append(notice)
    return merged + pending


def merge_by_time(items, extras):
    """Put each extra entry before the first conversation entry that is later.

    Code sent from the runner has no JSONL row, so like a notice it must live
    outside `baseline` and `current`. It has no entry to anchor to either: the
    prompt it precedes changes key when the transcript catches up. Its time
    does not change, and it was sent before the prompt that delivered it.
    """
    merged, pending = [], sorted(extras, key=lambda item: item["time"])
    for item in items:
        stamp = parse_time(item.get("time"))
        while pending and stamp and parse_time(pending[0]["time"]) < stamp:
            merged.append(pending.pop(0))
        merged.append(item)
    return merged + pending


def all_entries(state):
    """The one definition of "the conversation", notices and shared code included."""
    return merge_by_time(merge_notices(state.get("baseline", []) + state.get("current", []),
                                       state.get("notices", [])),
                         state.get("shared", []))


def clip(text, limit):
    text = str(text or "")
    return text if len(text) <= limit else text[:limit] + "\n[... cut at %d characters]" % limit


def share_body(share):
    """The code and its result, as Markdown: what the log shows and the tutor reads."""
    language = re.sub(r"[^a-z0-9+#]", "", str(share.get("language", "")).lower())
    if share.get("timed_out"):
        result = "stopped after %s ms (time limit)" % share.get("ms", "?")
    else:
        result = "exit %s in %s ms" % (share.get("exit_code", "?"), share.get("ms", "?"))
    parts = ["```" + language, clip(share.get("code"), SHARE_CODE_CHARS).rstrip("\n"), "```", "",
             "Result: " + result]
    for label, key in (("Input", "stdin"), ("Output", "stdout"), ("Errors", "stderr")):
        if str(share.get(key) or "").strip():
            parts.extend(["", label + ":", "```text",
                          clip(share[key], SHARE_OUTPUT_CHARS).rstrip("\n"), "```"])
    return "\n".join(parts)


def take_share(runtime, state):
    """Claim code the learner sent from the Obsidian runner, at most once.

    The runner pane (.obsidian/plugins/learn-live) writes runner/shared.json
    and cannot reach the terminal itself, so the next prompt carries it.
    `delivered` is global, not per conversation: a share is one message from
    the learner and only one conversation should answer it. A share stamped
    with a `subject` (the learning note the learner last had open) waits for
    the conversation teaching that subject, so a side chat cannot take it.
    """
    folder = runtime / "runner"
    try:
        share = json.loads((folder / "shared.json").read_text())
    except (OSError, json.JSONDecodeError):
        return ""
    if share.get("subject") and share["subject"] != state.get("subject"):
        return ""
    share_id = str(share.get("id", ""))
    delivered = folder / "delivered"
    sent = parse_time(share.get("sent_at"))
    if (not share_id or not sent
            or (delivered.exists() and delivered.read_text() == share_id)
            or (datetime.now(timezone.utc) - sent).total_seconds() > SHARE_MAX_AGE):
        return ""
    atomic_write(delivered, share_id)
    body = share_body(share)
    shared = state.setdefault("shared", [])
    shared.append(entry("code-" + share_id, CODE_ROLE, body, sent.isoformat()))
    del shared[:-NOTICE_KEEP]
    return ("The learner sent this from the Code runner pane in Obsidian. It is "
            "their own work, already shown in log.md, so do not paste it back:\n\n" + body)


# A dot is allowed so "14.8" is read as a word; command_slug turns it into the hyphen slugs use.
LEARN_COMMAND = re.compile(r"^\s*/learn-(start|resume|practice)\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,63})(?:\s|$)")
LEARN_END = re.compile(r"^\s*/learn-end(?:\s|$)")


def command_slug(match):
    return match[2].rstrip(".").replace(".", "-")


def known_subjects(vault):
    """A subject is a folder with record.md, the same test learn-status.py uses."""
    root = vault / "learn" / "subjects"
    return {path.parent.name for path in root.glob("*/record.md")} if root.is_dir() else set()


def subject_segments(vault, state):
    """Route messages following /learn-start or /learn-resume to that subject.

    /learn-start takes free text, so the word after it is a slug only when that
    subject already exists. Otherwise the turns are held, never written to a
    folder named after the word, until the conversation says which subject they
    belong to: a later command naming an existing subject, or the one subject
    whose record.md appeared after the command was typed. The subjects present
    at that moment are saved in the state, keyed by the command text, because
    the entry key changes when the transcript catches up.

    /learn-end closes the route. Its own turn, the wrap-up and any questions it
    asks, still lands in the log; the next prompt does not, and neither does
    anything after it until another /learn-start or /learn-resume.

    /learn-practice routes like /learn-resume, and every turn it routes is
    marked `practice`: the tutor solves each problem in thinking before posing
    it, so the log folds that thinking closed (`learn/system/practice.md`).
    """
    known = known_subjects(vault)
    before = state.setdefault("subjects_at_command", {})
    segments, subject, held, held_command, ended, practice = {}, None, [], None, False, False
    for item in all_entries(state):
        if item["role"] == "You":
            command = LEARN_COMMAND.match(item["text"])
            if not command and ended:
                subject, ended, practice = None, False, False
            if command:
                ended, practice = False, command[1] == "practice"
            elif subject and LEARN_END.match(item["text"]):
                ended = True
            if command and command_slug(command) in known:
                subject = command_slug(command)
                segments.setdefault(subject, []).extend(held)
                held, held_command = [], None
            elif command:
                before.setdefault(item["text"], sorted(known))
                subject, held_command = None, item["text"]
        if not subject and held_command:
            created = known - set(before[held_command])
            if len(created) == 1:
                subject = created.pop()
                segments.setdefault(subject, []).extend(held)
                held, held_command = [], None
        if subject:
            if practice:
                item["practice"] = True
            segments.setdefault(subject, []).append(item)
        elif held_command:
            held.append(item)
    return segments, subject


NODE_HEADING = re.compile(r"\*\*(?:Node\s+)?(n\d+[a-z]?)\s*[—–:-]\s*([^*\n]+?)\*\*")


def callout(text, kind, title, fold=""):
    """Wrap a message in an Obsidian callout, one '>' per line.

    `fold` is "+" (foldable, open) or "-" (foldable, closed).

    Fenced code survives this: Obsidian renders a code block inside a callout as
    long as every line carries the marker.
    """
    lines = ["> [!" + kind + "]" + fold + " " + title]
    for line in text.splitlines():
        lines.append("> " + line if line.strip() else ">")
    return lines


def node_heading(text):
    """Split 'Node n4 — inheritance, formalized' out as a real Markdown heading.

    This is what turns the log into a document: Obsidian's outline pane becomes a
    table of contents for the session instead of a wall of speaker labels.

    Returns (heading, before, after). When the label stands on its own line it is
    consumed, so the heading replaces it instead of appearing twice; when it is
    part of a sentence the sentence is left intact and the heading goes above it.
    """
    rows = text.splitlines()
    for index, row in enumerate(rows):
        match = NODE_HEADING.search(row)
        if not match:
            continue
        heading = "### " + match.group(1) + " — " + match.group(2).strip().rstrip(".")
        label = match.group(0).strip()
        if row.strip() in (label, label + ".", label + ":", label + " —"):
            before = "\n".join(rows[:index]).strip()
            after = "\n".join(rows[index + 1:]).strip()
            return heading, before, after
        return heading, "", text
    return None, "", text


def entry_lines(items):
    """Render the conversation as a readable note rather than a chat dump.

    Tutor prose becomes body text, so a session reads as continuous teaching.
    Every learner turn and every probe becomes a timestamped callout, which keeps
    the pacing information that makes a session reviewable afterwards.
    """
    lines, headings = [], set()
    for item in items:
        text = (item.get("display") or item.get("text") or "").strip()
        if not text:
            continue
        stamp = local_clock(item.get("time"))
        suffix = " · " + stamp if stamp else ""
        role = item["role"]
        if role == "Claude":
            heading, before, after = node_heading(text)
            if heading and heading not in headings:
                headings.add(heading)
                if before:
                    lines.extend([before, ""])
                lines.extend([heading, ""])
                if after:
                    lines.extend([after, ""])
            else:
                lines.extend([text, ""])
        elif role == "Claude — thinking":
            # Folded closed in practice: it holds the solution worked out before the problem was posed.
            lines.extend(callout(text, "thinking", "Thinking (shown in the terminal)",
                                 "-" if item.get("practice") else "+") + [""])
        elif role == "Claude — questions":
            lines.extend(callout(text, "question", "Question" + suffix) + [""])
        elif role == "You — answers":
            lines.extend(callout(text, "quote", "Your answer" + suffix) + [""])
        elif role == CODE_ROLE:
            lines.extend(callout(text, "code", "Your code" + suffix) + [""])
        elif role == NOTICE_ROLE:
            lines.extend(callout(text, "warning", "Probe check" + suffix) + [""])
        else:
            lines.extend(callout(text, "quote", "You" + suffix) + [""])
    return lines


def subject_theme(vault, subject):
    """The background a subject's log is drawn with; see `vaultlib.theme_of`."""
    return theme_of(frontmatter(vault / "learn" / "subjects" / subject / "record.md"), subject)


def write_subject_logs(vault, runtime, state):
    """Update one visible log.md per subject, retaining earlier conversations."""
    segments, active_subject = subject_segments(vault, state)
    # Cleared while a new subject is unresolved, so its turns are not timed
    # against the previous subject's open note.
    state["subject"] = active_subject
    for subject, items in segments.items():
        directory = runtime / "subjects" / subject
        snapshot = {"session_id": state["session_id"], "model": state.get("model"),
                    "effort": state.get("effort"), "entries": items}
        atomic_write(directory / f"{state['session_id']}.json", json.dumps(snapshot, ensure_ascii=False))
        conversations = [json.loads(path.read_text()) for path in directory.glob("*.json")]
        conversations.sort(key=lambda conversation: (conversation["entries"][0]["time"], conversation["session_id"]))
        lines = ["---", "type: learning-chat-log", f"subject: {json.dumps(subject)}",
                 f"cssclasses: [learning-log, lv-theme-{subject_theme(vault, subject)}]",
                 f"conversations: {len(conversations)}",
                 f"updated: {json.dumps(datetime.now().strftime('%Y-%m-%d'))}", "---", "",
                 "# Chat log", "",
                 "> [!info] Live note",
                 "> This updates while you chat in the terminal — read here, reply there.",
                 f"> [[learn/subjects/{subject}/record|Record]] · "
                 f"[[learn/subjects/{subject}/plan|Plan]] · "
                 f"[[learn/subjects/{subject}/progress|Progress]] · "
                 "[[learn/Home|Home]]", ""]
        for conversation in conversations:
            first_time = local_date(conversation["entries"][0]["time"])
            model = conversation.get("model") or "Not reported"
            effort = conversation.get("effort") or "Not reported"
            lines.extend([f"## Conversation — {first_time}", "",
                          f"*{model} · {effort} effort*", ""])
            lines.extend(entry_lines(conversation["entries"]))
        atomic_write(vault / "learn" / "subjects" / subject / "log.md", "\n".join(lines))


def render(state):
    session_id = state["session_id"]
    model = state.get("model") or "Waiting for Claude Code"
    effort = state.get("effort") or "Not reported"
    lines = ["---", "type: claude-conversation", f"session: {json.dumps(session_id)}",
             f"model: {json.dumps(model)}", f"effort: {json.dumps(effort)}", "---", "",
             "# Current conversation", "", f"**Model:** {model} · **Effort:** {effort}", "",
             "> [!info] Live note",
             "> Read here; type or speak your replies in the terminal. It updates as Claude speaks.", "",
             f"[[Claude outputs/Conversations/{session_id}|Saved conversation]] · [[learn/Home|Home]]", ""]
    lines.extend(entry_lines(all_entries(state)))
    return "\n".join(lines)


ASKED_ANYWAY = ("Asked anyway. If you cannot see what it refers to, say so rather than "
                "guessing -- an answer to a question you could not fully see is evidence "
                "about the interface, not about you.")

WITHDRAWN = "Withdrawn before it was asked. The tutor is re-asking with the material inline."

REPAIR = ("Put the material the question depends on inside the question text, fenced with "
          "its language (tutor.md, Self-containment), and ask again. If the probe does "
          "stand alone, re-issue the same question unchanged and it will go through.")

# Math in the picker arrives as plain text: `int_0^2 int_0^1 6xy dy dx` was
# unreadable and the learner turned the picker down (2026-10-25). Chat renders it.
MATH_IN_PICKER = re.compile(
    r"\$[^$\n]*[\\^_=][^$\n]*\$|\\(?:i?int|frac|sum|sqrt|theta|pi|cdot|le|ge|infty|partial|nabla)\b"
    r"|\b(?:i?int|sum|lim)_|[A-Za-z0-9)\]]\^[-A-Za-z0-9({]|\bsqrt\(")
CODE_SPANS = re.compile(r"```.*?```|`[^`\n]*`", re.S)
MATH_REASON = ("This question has math in it (\"%s\"), and the question picker shows math as "
               "plain text, which the learner could not read (2026-10-25). Ask it in chat "
               "instead: the math rendered with $...$, lettered options, and the confidence "
               "question in the same message.")
MATH_REPAIR = ("If the match is code, not math, re-issue the same question unchanged and it "
               "will go through.")

# A flagged probe in a turn whose reply text is this short has nothing visible for it
# to point at. The six success criteria lived only in thinking twice (cs124-quiz8
# 2026-10-20, math241-hw23 2026-10-25), flagged at p=0.80 and 0.87, under the block line.
THIN_TURN_CHARS = 200
THIN_REASON = ("Nothing the learner can read this turn holds that material: thinking and "
               "files are invisible to them. Write it as reply text first, then ask.")
# A thin turn gets a second hold, and its repair drops "re-issue unchanged". On
# cs124-quiz9 2026-10-26 a p=0.91 block named only self-containment; the code was
# already inline, so the tutor re-issued it unchanged while the rule it quizzed
# lived only in thinking, and the learner said half the lesson was cut.
THIN_REPAIR = ("Write what the question depends on as reply text, then ask again. A "
               "re-issue while the reply is still this short is held back once more.")


def picker_math(question):
    """The first math-looking snippet in a picker question or its options, or ""."""
    parts = [str(question.get("question", ""))]
    for option in question.get("options") or []:
        parts += [str(option.get("label", "")), str(option.get("description") or "")]
    text = CODE_SPANS.sub(" ", "\n".join(parts))
    found = MATH_IN_PICKER.search(text)
    return found.group(0) if found else ""


def turn_reply_chars(state, canonical):
    """Characters of reply text the learner has seen since their last message.

    Read from both the live buffer and the transcript, since either can be
    behind at PreToolUse; a text both hold counts once.
    """
    texts = set()
    for items in (state.get("current", []), canonical or []):
        tail = []
        for item in items:
            if item.get("role", "").startswith("You"):
                tail = []
            elif item.get("role") == "Claude" and str(item.get("text", "")).strip():
                tail.append(str(item["text"]).strip())
        texts.update(tail)
    return sum(len(text) for text in texts)


def probe_guard(state, questions, tool_id, canonical=None):
    """J1 inline: judge each question in a picker before the learner answers it.

    Returns the reason to deny the tool call with, or "" to let it through.

    A notice is written into `state["notices"]` either way, so a flag that does
    not rise to a withdrawal still lands next to the question in `log.md` --
    which is where the learner is already reading the question, and `tutor.md`
    already tells them what to do about it: say you cannot see the material
    rather than guess.

    One withdrawal per distinct question text. Asking the same thing twice means
    the tutor read the reason and decided the probe does stand alone, and a gate
    its own advisee cannot overrule is a wall, not a gate. It also makes a
    retry loop impossible, since the cache would otherwise hand back the same
    judgement forever.

    Fails open at every level: no `jev` module, no key, no network, or a probe
    that takes longer than the budget all end with the question being asked.
    """
    flagged = state.setdefault("probes_flagged", [])
    reasons, repairs = [], []
    for index, question in enumerate(questions):
        snippet = picker_math(question)
        if not snippet:
            continue
        digest = hashlib.sha256(("math:" + json.dumps(question, sort_keys=True)).encode()).hexdigest()[:16]
        withdraw = digest not in flagged
        if withdraw:
            flagged.append(digest)
            del flagged[:-FLAGGED_KEEP]
            reasons.append(MATH_REASON % snippet)
            repairs.append(MATH_REPAIR)
        put_notice(state, {"key": "notice-math-%s-%d" % (tool_id, index),
                           "anchor": "questions-" + tool_id, "role": NOTICE_ROLE, "time": now(),
                           "text": (MATH_REASON % snippet) + "\n\n"
                                   + (WITHDRAWN if withdraw else ASKED_ANYWAY)})
    try:
        import jev
    except Exception:  # noqa: BLE001 -- the mirror works with no semantic module at all
        return (" ".join(reasons + repairs)) if reasons else ""
    deadline = time.monotonic() + PROBE_BUDGET
    thin = turn_reply_chars(state, canonical) < THIN_TURN_CHARS
    for index, question in enumerate(questions):
        try:
            text = jev.probe_text(question)
            # Past the budget, hand the check an asker that answers nothing: that
            # is already the "Jev unreachable" path, and it routes to the offline
            # regex instead of adding latency to a learner who is waiting.
            spent = time.monotonic() >= deadline
            level, reason = jev.inline_probe_check(
                text, ask_fn=(lambda *a, **k: None) if spent else None)
        except Exception:  # noqa: BLE001
            continue
        if not level:
            continue
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        # Jev's flag only: the offline regex never gets to withdraw a question.
        thin_flag = thin and "Jev p=" in reason
        if thin_flag:
            level, reason = "block", reason + " " + THIN_REASON
        key = digest
        if thin_flag and digest in flagged:
            key = "thin:" + digest
        withdraw = level == "block" and key not in flagged
        if withdraw:
            flagged.append(key)
            del flagged[:-FLAGGED_KEEP]
            reasons.append(reason)
            repairs.append(THIN_REPAIR if thin_flag else REPAIR)
        put_notice(state, {"key": "notice-%s-%d" % (tool_id, index),
                           "anchor": "questions-" + tool_id, "role": NOTICE_ROLE,
                           "time": now(),
                           "text": reason + "\n\n" + (WITHDRAWN if withdraw else ASKED_ANYWAY)})
    return " ".join(reasons + list(dict.fromkeys(repairs))) if reasons else ""


def status_text(payload, state):
    model = payload.get("model", {})
    name = (model.get("display_name") if isinstance(model, dict) else model) or state.get("model") or "Model unknown"
    effort = payload.get("effort", {})
    level = effort.get("level") if isinstance(effort, dict) else effort
    suffix = f"{level} effort" if level else "effort not reported"
    destination = f"{state['subject']}/log.md" if state.get("subject") else "Choose a learning subject"
    return f"{name} · {suffix} · Obsidian: {destination}"


def process(vault, payload, mode="hook"):
    if payload.get("agent_id") or "/subagents/" in payload.get("transcript_path", ""):
        return ""  # Hooks also fire within reviewers; keep their private chat separate.
    session_id = payload.get("session_id", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session_id):
        return "Model unknown · no session data" if mode == "status" else ""
    runtime = vault / ".claude" / "obsidian-live"
    runtime.mkdir(parents=True, exist_ok=True)
    with (runtime / f"{session_id}.lock").open("w") as lock:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX)
        state_path = runtime / f"{session_id}.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {
            "session_id": session_id, "baseline": [], "current": [], "streams": {},
            "notices": []
        }
        transcript = payload.get("transcript_path") or state.get("transcript_path")
        if transcript:
            state["transcript_path"] = transcript
        event = payload.get("hook_event_name", "")
        notice = ""
        deny = ""          # set only by the PreToolUse probe guard
        clock_event = ""   # set by whichever branch below counts as a turn
        canonical, metadata = read_transcript(transcript, vault) if mode != "status" else ([], {})
        superseded = metadata.pop("superseded", [])
        if superseded:
            state["current"] = [item for item in state["current"]
                                if not (item["role"] == "Claude" and item["text"] in superseded)]
        for key, value in metadata.items():
            state.setdefault(key, value)
        model = payload.get("model")
        if model:
            state["model"] = model.get("id", model.get("display_name")) if isinstance(model, dict) else model
        effort = payload.get("effort")
        if effort:
            state["effort"] = effort.get("level") if isinstance(effort, dict) else effort
        elif mode == "status":
            state.pop("effort", None)  # Never invent effort for a model that does not report it.
        if event in ("SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"):
            reconciled = promote_or_reconcile(state, canonical)
            if event in ("SessionStart", "UserPromptSubmit"):
                if not reconciled:
                    state["baseline"] += state["current"]
                    state["current"] = []
                state["streams"] = {}
            if event == "UserPromptSubmit":
                clock_event = "prompt"
                if mode != "status":
                    notice = take_share(runtime, state)
                prompt = payload.get("prompt", "")
                # A queued subagent hand-back or task-notification can be absorbed
                # into this same turn by the harness, arriving here as raw prompt
                # text rather than through the transcript read_transcript() covers.
                # Filter it the same way, or it leaks into the log unfiltered.
                prompt = user_text(prompt)
                # Some clients flush the human prompt before invoking this hook.
                if prompt and (not canonical or canonical[-1]["role"] != "You" or canonical[-1]["text"] != prompt):
                    put_current(state, entry("prompt-" + str(len(state["baseline"])), "You", prompt))
        elif event == "MessageDisplay":
            message_id = payload.get("message_id", "")
            stream = state["streams"].setdefault(message_id, {"chunks": {}, "time": now()})
            stream["chunks"][str(payload.get("index", 0))] = payload.get("delta", "")
            stream["final"] = bool(payload.get("final"))
            text = "".join(stream["chunks"][index] for index in sorted(stream["chunks"], key=int))
            put_current(state, entry("stream-" + message_id, "Claude", text, stream["time"]))
        elif payload.get("tool_name") == "AskUserQuestion":
            tool_id = payload.get("tool_use_id", "question")
            if event == "PreToolUse":
                asked = payload.get("tool_input", {}).get("questions", [])
                put_current(state, entry("questions-" + tool_id, "Claude — questions",
                                         questions_text(asked)))
                if mode != "status":
                    deny = probe_guard(state, asked, tool_id, canonical)
            elif event == "PostToolUse":
                result = payload.get("tool_response", {})
                if isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except json.JSONDecodeError:
                        pass
                text = answers_text(result)
                if not text:
                    text = next((item["text"] for item in canonical if item["key"] == "answers-" + tool_id), "")
                if text:
                    put_current(state, entry("answers-" + tool_id, "You — answers", text))
                clock_event = "answer"
        write_subject_logs(vault, runtime, state)
        # After write_subject_logs, not before: it is what resolves which subject
        # this conversation is teaching, and the clock is keyed on that subject's
        # open note. Timing the turn any earlier reads the previous turn's subject.
        if clock_event and mode != "status":
            notice = "\n\n".join(part for part in (notice, update_clock(vault, runtime, state, clock_event)) if part)
        content = render(state)
        archive = vault / "Claude outputs" / "Conversations" / f"{session_id}.md"
        atomic_write(archive, content)
        active_path = runtime / "active-session"
        if mode != "status":
            atomic_write(active_path, session_id)
        if not active_path.exists() or active_path.read_text() == session_id:
            atomic_write(vault / "Claude outputs" / "Current conversation.md", content)
        atomic_write(state_path, json.dumps(state, ensure_ascii=False))
        if mode == "status":
            return status_text(payload, state)
        if deny:
            # PreToolUse stdout goes to the debug log and never reaches the model
            # (code.claude.com/docs/en/hooks: only UserPromptSubmit, SessionStart,
            # UserPromptExpansion and PostModelSwitch add plain stdout as context).
            # `hookSpecificOutput` is the documented channel that does. Emitted
            # only to deny: an "allow" from here would silently override the
            # permission rules in settings.json.
            return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                           "permissionDecision": "deny",
                                           "permissionDecisionReason": deny}}
        if event == "SessionStart":
            destination = f"[[learn/subjects/{state['subject']}/log]]" if state.get("subject") else "the subject's log.md after /learn-start or /learn-resume"
            return "Live chat: " + destination + ". Open this Markdown file in Obsidian; it updates as responses stream. Reply in the terminal. Model: " + str(state.get("model", "not reported")) + ". Use /model and /effort to choose."
        return notice


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["hook", "status", "backfill", "clock"])
    parser.add_argument("transcript", nargs="?")
    parser.add_argument("--vault", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--subject", help="clock mode: which subject's open note to report on")
    args = parser.parse_args()
    try:
        if args.mode == "clock":
            # Read-only: /learn-end asks what the session actually cost. Touches no
            # state, so asking twice cannot change the answer.
            vault = args.vault.resolve()
            runtime = vault / ".claude" / "obsidian-live"
            print(clock_report(vault, runtime, args.subject))
            return
        if args.mode == "backfill":
            if not args.transcript:
                parser.error("backfill requires a transcript path")
            payload = {"session_id": Path(args.transcript).stem, "transcript_path": args.transcript,
                       "hook_event_name": "SessionStart"}
        else:
            payload = json.load(sys.stdin)
        output = process(args.vault.resolve(), payload, "status" if args.mode == "status" else "hook")
        if isinstance(output, dict):
            print(json.dumps(output))   # a hook decision, not a line of prose
        elif output:
            print(output)
    except Exception as error:
        # Fail visibly in hook diagnostics, while never making a policy decision.
        print("Obsidian conversation mirror: " + str(error), file=sys.stderr)
        if args.mode == "status":
            print("Obsidian mirror needs attention")
        sys.exit(1)


if __name__ == "__main__":
    main()
