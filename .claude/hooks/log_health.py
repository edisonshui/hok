"""Is the selected subject's log.md keeping up with the conversation?

Read at session start, for the agent only. obsidian-live.py writes a subject's
log.md from one snapshot per conversation, `.claude/obsidian-live/subjects/
<subject>/<session_id>.json`, which it rewrites on every hook event from the
turns `subject_segments` routes to that subject. So the log is healthy when the
learner's messages the transcript routes to the subject are in that snapshot,
and the snapshot's latest message is in log.md. It is broken in three ways this
reads directly off those files:

  * stopped updating: two or more of the learner's messages the transcript
    routes to the subject are not in its snapshot (one may be in flight);
  * misrouted: one of those missing messages is in another subject's snapshot
    for this same conversation;
  * not written: log.md is missing, or its newest learner message is not in it.

The report is one line telling the agent to keep teaching. Six sessions lost
pre-quiz minutes to debugging detours (tutor.md, Reply shape), so the line
never asks for a fix now.
"""

import importlib.util
import json
from collections import Counter
from pathlib import Path

MISSING_TURNS = 2   # one missing message can be the turn the hooks have not flushed yet


def load_live():
    spec = importlib.util.spec_from_file_location(
        "obsidian_live", Path(__file__).with_name("obsidian-live.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def learner_texts(entries):
    return Counter(str(item.get("text", "")) for item in entries or [] if item.get("role") == "You")


def first_line(item):
    text = str(item.get("display") or item.get("text") or "")
    return next((line.strip() for line in text.splitlines() if line.strip()), "")


def diagnose(vault, session_id, live=None):
    """(subject, what is wrong) for this conversation, or (subject, "") when healthy."""
    vault = Path(vault)
    live = live or load_live()
    runtime = vault / ".claude" / "obsidian-live"
    state = read_json(runtime / (session_id + ".json"))
    if not isinstance(state, dict) or not state.get("subject"):
        return None, ""
    subject = state["subject"]
    canonical, _ = live.read_transcript(state.get("transcript_path"), None)
    routed = {"baseline": canonical, "current": [], "notices": [], "shared": [],
              "subjects_at_command": dict(state.get("subjects_at_command") or {})}
    segments, _ = live.subject_segments(vault, routed)
    expected = learner_texts(segments.get(subject, []))
    snapshot = read_json(runtime / "subjects" / subject / (session_id + ".json")) or {}
    entries = snapshot.get("entries") if isinstance(snapshot, dict) else None
    held = learner_texts(entries)
    missing = expected - held
    lost = sum(missing.values())
    if lost >= MISSING_TURNS:
        for other in sorted((runtime / "subjects").glob("*/" + session_id + ".json")):
            slug = other.parent.name
            if slug == subject:
                continue
            elsewhere = read_json(other) or {}
            if missing & learner_texts(elsewhere.get("entries") if isinstance(elsewhere, dict) else None):
                return subject, ("turns of this conversation went to learn/subjects/%s/log.md instead"
                                 % slug)
        return subject, ("it stopped updating: %d of the learner's messages in this conversation "
                         "never reached it" % lost)
    log = vault / "learn" / "subjects" / subject / "log.md"
    learner_entries = [item for item in entries or [] if item.get("role") == "You"]
    if learner_entries:
        if not log.is_file():
            return subject, "the file is missing"
        newest = first_line(learner_entries[-1])
        if newest and newest not in log.read_text():
            return subject, "it is not being rewritten: the learner's newest message is not in it"
    return subject, ""


def report(vault, session_id, live=None):
    """The one agent-only line, or "" when the log is healthy or there is no subject."""
    try:
        subject, trouble = diagnose(vault, session_id, live)
    except Exception as error:  # noqa: BLE001 -- a health check must never stop a session
        return "Log health check failed (%s); teach as normal." % error
    if not trouble:
        return ""
    return ("Log health: learn/subjects/%s/log.md looks broken, %s. Keep teaching. Tell the "
            "learner in one sentence what they lose and one workaround (the terminal still has "
            "everything), and offer to fix the cause after the session. No debugging now."
            % (subject, trouble))
