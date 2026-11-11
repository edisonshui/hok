#!/usr/bin/env python3
"""Codex hook adapter for the shared learning vault.

Codex hook payloads differ from Claude Code's. Keep separate runtime state and
conversation logs, while reusing the existing record reader and clock logic.
The log uses the transcript when available and falls back to final messages.
"""

import argparse
try:
    import fcntl
except ImportError:  # Windows has no fcntl: turns are not locked against each other there
    fcntl = None
import importlib.util
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

VAULT = Path(__file__).resolve().parents[2]
CLAUDE_HOOKS = VAULT / ".claude" / "hooks"
sys.path.insert(0, str(CLAUDE_HOOKS))
from session_context import start_context  # noqa: E402

spec = importlib.util.spec_from_file_location("shared_learning_clock", CLAUDE_HOOKS / "obsidian-live.py")
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,63}$")
SKILL_SUBJECT = re.compile(r"(?:^|\s)(?:\$|/)?learn-(?:start|resume|practice)\s+([a-z0-9][a-z0-9-]{0,63})(?=\s|$)", re.I)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def runtime(vault):
    path = vault / "learn" / ".codex-runtime"
    path.mkdir(parents=True, exist_ok=True)
    return path


def session_id(payload):
    value = payload.get("session_id", "")
    return value if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) else None


def load_state(path, sid):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"session_id": sid, "entries": [], "subject": None}


def subject_from_prompt(vault, prompt):
    explicit = SKILL_SUBJECT.search(prompt)
    if explicit:
        return explicit.group(1).lower()
    # Natural phrasing is useful when resuming an existing subject, but avoid
    # guessing a new folder name from an arbitrary sentence.
    if not re.search(r"\b(?:learn|resume|continue|study)\b", prompt, re.I):
        return None
    subjects = vault / "learn" / "subjects"
    matches = [path.name for path in subjects.iterdir()
               if path.is_dir() and re.search(r"(?<![\w-])" + re.escape(path.name) + r"(?![\w-])", prompt, re.I)] if subjects.is_dir() else []
    return matches[0] if len(matches) == 1 else None


def transcript_messages(path, sid):
    """Read completed learner-facing messages from the current Codex rollout shape."""
    if not path:
        return None
    try:
        rows = [json.loads(line) for line in Path(path).read_text().splitlines()]
        if not rows or rows[0].get("type") != "session_meta" or rows[0]["payload"].get("session_id") != sid:
            return None
        messages = {}
        for row in rows:
            payload = row.get("payload", {})
            if row.get("type") != "event_msg" or payload.get("type") != "item_completed":
                continue
            item = payload.get("item", {})
            if item.get("type") != "AgentMessage":
                continue
            turn = payload.get("turn_id")
            parts = item.get("content", [])
            if not turn or not isinstance(parts, list) or any(part.get("type") != "Text" for part in parts):
                return None
            message = "\n".join(part["text"] for part in parts).strip()
            if message:
                messages.setdefault(turn, []).append({"turn": turn, "role": "assistant", "text": message,
                                                     "time": row["timestamp"]})
        return messages
    except (OSError, ValueError, KeyError, TypeError):
        return None


def save_log(vault, rt, subject):
    folder = vault / "learn" / "subjects" / subject
    if not folder.is_dir():
        return
    states = []
    for path in rt.glob("*.json"):
        if path.name == "clocks.json":
            continue
        try:
            state = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        captured = transcript_messages(state.get("transcript_path"), state.get("session_id"))
        entries = []
        for item in state.get("entries", []):
            if item.get("subject") != subject:
                continue
            if item["role"] == "user":
                entries.append(item)
                entries.extend({**reply, "subject": subject} for reply in (captured or {}).get(item.get("turn"), []))
            elif not captured or item.get("turn") not in captured:
                entries.append(item)
        if entries:
            states.append({**state, "entries": entries, "transcript_captured": captured is not None})
    states.sort(key=lambda state: (state["entries"][0]["time"], state["session_id"]))
    lines = ["---", "type: learning-chat-log", f"subject: {json.dumps(subject)}",
             "source: codex", f"conversations: {len(states)}",
             f"updated: {json.dumps(datetime.now().strftime('%Y-%m-%d'))}",
             "---", "", "# Codex chat log", "",
             "> [!info] Codex chat log", "> Transcript messages appear when available. Otherwise, each turn shows its final reply only.",
             f"> [[learn/subjects/{subject}/record|Record]] · [[learn/subjects/{subject}/plan|Plan]] · [[learn/subjects/{subject}/progress|Progress]]", ""]
    for state in states:
        lines += [f"## Conversation — {state['entries'][0]['time'][:10]}", "",
                  f"*{state.get('model') or 'Model not reported'}*", "",
                  "Transcript messages" if state["transcript_captured"] else "Completed-turn summary", ""]
        replied_turns = {item.get("turn") for item in state["entries"] if item["role"] == "assistant"}
        for item in state["entries"]:
            message = item["text"].strip()
            if not message:
                continue
            time = shared.local_clock(item["time"])
            if item["role"] == "user":
                lines += [f"> [!quote] You · {time}"] + ["> " + line if line else ">" for line in message.splitlines()] + [""]
                if item.get("turn") not in replied_turns:
                    lines += ["> [!warning] Reply not captured for this prompt", ""]
            else:
                lines += [message, ""]
    shared.atomic_write(folder / "codex-log.md", "\n".join(lines))


def session_start(vault, subject=None):
    return start_context(vault, subject, host="codex")


def hook(vault, payload):
    event = payload.get("hook_event_name")
    sid = session_id(payload)
    if not sid:
        return ""
    rt = runtime(vault)
    with (rt / (sid + ".lock")).open("w") as lock:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX)
        path = rt / (sid + ".json")
        state = load_state(path, sid)
        if payload.get("model"):
            state["model"] = payload["model"]
        if payload.get("transcript_path"):
            state["transcript_path"] = payload["transcript_path"]
        notice = ""
        previous_subject = state.get("subject")
        if event == "UserPromptSubmit":
            prompt = payload.get("prompt", "")
            if subject := subject_from_prompt(vault, prompt):
                state["subject"] = subject
            turn = payload.get("turn_id") or "prompt-" + str(len(state["entries"]))
            if prompt and not any(item.get("turn") == turn and item["role"] == "user" for item in state["entries"]):
                state["entries"].append({"turn": turn, "role": "user", "text": prompt,
                                         "time": stamp(), "subject": state.get("subject")})
                if state.get("subject"):
                    notice = shared.update_clock(vault, rt, state, "prompt")
        elif event == "Stop":
            message = payload.get("last_assistant_message")
            turn = payload.get("turn_id") or "reply-" + str(len(state["entries"]))
            if message and not any(item.get("turn") == turn and item["role"] == "assistant" for item in state["entries"]):
                state["entries"].append({"turn": turn, "role": "assistant", "text": message,
                                         "time": stamp(), "subject": state.get("subject")})
        shared.atomic_write(path, json.dumps(state, ensure_ascii=False))
        shared.atomic_write(rt / "active-session", sid)
        for subject in {previous_subject, state.get("subject")} - {None}:
            save_log(vault, rt, subject)
        if event == "SessionStart":
            return session_start(vault, state.get("subject"))
        return notice


def select(vault, subject):
    if not SLUG.fullmatch(subject):
        raise ValueError("subject must be a lowercase hyphenated slug")
    rt = runtime(vault)
    active = rt / "active-session"
    if not active.is_file():
        return "No active Codex hook session. The learning records still work."
    sid = active.read_text().strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", sid):
        return "No valid active Codex hook session."
    with (rt / (sid + ".lock")).open("w") as lock:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX)
        path = rt / (sid + ".json")
        state = load_state(path, sid)
        state["subject"] = subject
        for item in state["entries"]:
            if not item.get("subject"):
                item["subject"] = subject
        shared.atomic_write(path, json.dumps(state, ensure_ascii=False))
        save_log(vault, rt, subject)
    return f"Codex log selected: learn/subjects/{subject}/codex-log.md"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["hook", "clock", "select"])
    parser.add_argument("--subject")
    parser.add_argument("--vault", type=Path, default=VAULT)
    args = parser.parse_args()
    vault = args.vault.resolve()
    if args.mode == "clock":
        if not args.subject:
            parser.error("clock needs --subject")
        print(shared.clock_report(vault, vault / "learn" / ".codex-runtime", args.subject))
    elif args.mode == "select":
        if not args.subject:
            parser.error("select needs --subject")
        print(select(vault, args.subject))
    else:
        payload = json.load(sys.stdin)
        try:
            result = hook(vault, payload)
            if payload.get("hook_event_name") == "Stop":
                print('{"continue": true}')
            elif result:
                print(result)
        except Exception as error:
            print("Codex learning hook failed: " + str(error), file=sys.stderr)
            if payload.get("hook_event_name") == "Stop":
                print('{"continue": true}')


if __name__ == "__main__":
    main()
