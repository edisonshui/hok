#!/usr/bin/env python3
"""Deterministic checks on what the tutor says to the learner.

  reply-check.py hook                  Stop hook: hold a rule-breaking tutoring reply back once
  reply-check.py closing <file or ->   report what a drafted /learn-end closing block must not say
  reply-check.py report                count what the logging-only checks would have held

The rules are the ones already written in learn/system/tutor.md (Pacing,
Feedback, Reply shape) and in step 8 of .claude/skills/learn-end/SKILL.md.
More prose there has not stopped the breaks, so this catches them as they
happen. Nothing here calls a model or the network: every check is a regex or a
count, and every check prefers a miss to a false alarm, because a blocked good
reply costs the learner a wait and a rewrite.

The Stop hook runs on tutoring replies only. A conversation is tutoring when
the obsidian-live mirror has routed it to a subject (`subject` in its state
file, set by /learn-start, /learn-resume or /learn-practice and cleared by
/learn-end), which is the same test that decides which log.md receives the
conversation. With no subject it does nothing, so an engineering chat in the
same vault is never held back.

A flagged reply is held back once, the way the picker guard in obsidian-live.py
withdraws a flagged question once: the reply's digest is remembered, and the
same text is never blocked twice. A Stop that arrives with `stop_hook_active`
set is a continuation another Stop hook already asked for, and is never blocked.
"""

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jev  # noqa: E402  -- NODE_MENTION, the one node id regex


def load_live():
    """obsidian-live.py as a module; its name has a hyphen, so no plain import."""
    spec = importlib.util.spec_from_file_location(
        "obsidian_live", Path(__file__).with_name("obsidian-live.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


live = load_live()

# tutor.md says "under about 120 words". The gate sits above the rule on
# purpose: a 130-word reply is "about 120", and a false hold costs more than a
# ten-word overrun. Code, diagrams, math and embeds are not counted.
PROSE_WORDS = 150
FLAGGED_KEEP = 40          # reply digests remembered per conversation, as probes_flagged
ANSWER_MAX_WORDS = 80      # a longer learner message is a discussion, not an answer

# What is stripped before any prose check. Fenced blocks cover code, mermaid and
# fenced SVG; `$$` and `$` cover math; the embed form covers SVG figures and
# images; a wikilink is something the learner is told to open, so it is allowed.
FENCE = re.compile(r"```.*?```|~~~.*?~~~", re.S)
DISPLAY_MATH = re.compile(r"\$\$.*?\$\$", re.S)
INLINE_MATH = re.compile(r"(?<![\w$])\$[^$\n]+?\$(?![\w$])")
EMBED = re.compile(r"!?\[\[[^\]\n]*\]\]")
INLINE_SVG = re.compile(r"<svg\b.*?</svg>", re.S | re.I)
CODE_SPAN = re.compile(r"`[^`\n]*`")
QUOTED = re.compile(r"\"[^\"\n]*\"|“[^”\n]*”|‘[^’\n]*’")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)
WORD = re.compile(r"[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9]+)*")

# Names the learner never needs. `Jev` is case-sensitive so a lower-case word
# in a lesson is not mistaken for the checker; the script names carry no such
# risk. A path is one with a slash under a vault folder, or any script file.
SCRIPT_NAMES = re.compile(
    r"\b(mc-preflight|learn-status|write-check|svg-check|obsidian-live|session-start|"
    r"session_context|reply-check|fact-checker|plan-reviewer)\b", re.I)
JEV = re.compile(r"\bJev\b")
PATHS = re.compile(r"(?<![\w/])(?:\.claude|\.agents|\.codex|\.obsidian|learn)/[\w./-]*[\w/]"
                   r"|\b[\w-]+\.(?:py|sh)\b")

# A sentence ends at . ! or ? followed by space or end, or at a line break.
SENTENCE_END = re.compile(r"(?<=[.!?])\s+|\n+")
# Markdown furniture at the start of a line that is not part of the sentence.
LEAD_MARKUP = re.compile(r"^(?:[#>*_\-\s]|\d+[.)]\s)+")
TRAIL_MARKUP = re.compile(r"[*_]+$")

VERDICT = re.compile(
    r"\b(right|correct|yes|yep|exactly|spot on|wrong|incorrect|no|nope|not quite|not right|"
    r"partly|partially|half right|half|close|almost|nearly|missed|true|false|that's it|"
    r"you've got it|you got it|got it|off by)\b", re.I)

# A question the tutor asks that is not a check: logistics, pacing, a prediction
# before teaching (tutor.md, Pacing: never graded, never evidence), or a "ready?".
NOT_A_CHECK = re.compile(
    r"\b(ready|want|would you like|shall|should (?:i|we)|ok\b|okay|break|continue|go on|"
    r"keep going|prefer|which subject|sound (?:good|right)|does that (?:help|make sense)|"
    r"make sense|predict|guess|what do you think|what would you try|before (?:i|we) (?:show|look)|"
    r"can you see|see (?:this|it|that)|visible|match what you want|which (?:one|do you want|first)|"
    r"start|next\?)", re.I)
# A learner message that is not an answer to grade.
NOT_AN_ANSWER = re.compile(
    r"^\W*(pass|skip|no idea|idk|i don'?t know|not sure|dunno|tell me|just tell me|"
    r"show me|hint|help|wait|hold on|one sec|brb|back)\b", re.I)

# "The question is waiting above" and its relatives.
NUDGE = re.compile(
    r"\b(?:question|check)\b[^.?!\n]{0,60}\b(?:is )?(?:still )?(?:waiting|open|stands|above|up there)\b"
    r"|\b(?:still )?waiting (?:on|for) (?:your|an|the) answer\b"
    r"|\banswer (?:the|that|my) question (?:above|first)\b"
    r"|\bwhen you'?re ready,? (?:the|my) question\b", re.I)

LEARN_COMMAND = re.compile(r"^\s*/learn-([a-z]+)")
SKIP_COMMANDS = {"end", "close", "start", "review"}   # replies shaped by a skill, not a lesson

# Which checks hold a reply back. The rest only log what they would have held,
# to `.claude/obsidian-live/reply-check-log.jsonl`. Replayed over 1,017 real
# tutoring replies (4 Nov 2026), all five together would have held 36% of them;
# the machinery check (10%) was right in every sample read, while the length,
# two-question and verdict checks flagged good replies ("4 for 4, ..." as no
# verdict, a confidence question as a second question). `reply-check.py report`
# counts the log, to tune a check before it joins HOLD.
KINDS = ("length", "questions", "verdict", "nudge", "machinery")
HOLD = {"machinery"}
LOG_KEEP = 2000            # lines kept in the would-hold log


# ------------------------------------------------------------------ prose

def prose(text):
    """The reply with everything that is not prose removed."""
    text = FENCE.sub(" ", str(text or ""))
    text = HTML_COMMENT.sub(" ", text)
    text = INLINE_SVG.sub(" ", text)
    text = DISPLAY_MATH.sub(" ", text)
    text = INLINE_MATH.sub(" ", text)
    text = EMBED.sub(" ", text)
    return text


def word_count(text):
    return len(WORD.findall(CODE_SPAN.sub(" ", prose(text))))


def sentences(text):
    out = []
    for raw in SENTENCE_END.split(text):
        clean = TRAIL_MARKUP.sub("", LEAD_MARKUP.sub("", raw.strip())).strip()
        if clean:
            out.append(clean)
    return out


def first_sentence(text):
    found = sentences(prose(text))
    return found[0] if found else ""


def unasked(match):
    """A quoted or coded span with its question marks removed, so it is kept
    readable in a reason but never counted as a question."""
    return match.group(0).replace("?", "")


def questions(text):
    """Question sentences aimed at the learner.

    Quoted and coded text is removed first, so a quoted check or a `?:` in
    code is not a question. A quoted line of the learner's is not either. A
    question of one or two words ("Why?") is a rhetorical beat, not a probe.
    """
    body = QUOTED.sub(unasked, CODE_SPAN.sub(unasked, prose(text)))
    body = "\n".join(line for line in body.splitlines() if not line.lstrip().startswith(">"))
    found = []
    for sentence in sentences(body):
        if sentence.endswith("?") and len(WORD.findall(sentence)) >= 3:
            found.append(sentence)
    return found


def machinery(text):
    """Node ids, paths, scripts and checker names in the prose, in order seen."""
    body = CODE_SPAN.sub(" ", prose(text))
    found = []
    for pattern in (jev.NODE_MENTION, PATHS, SCRIPT_NAMES, JEV):
        for match in pattern.finditer(body):
            token = match.group(0)
            # The learner is told to open log.md; a name inside a path already
            # found (learn-status in learn-status.py) is not a second finding.
            if token.endswith("log.md") or any(token in seen for seen in found):
                continue
            found.append(token)
    return found


def is_nudge(text):
    return bool(NUDGE.search(QUOTED.sub(" ", CODE_SPAN.sub(" ", prose(text)))))


def opens_with_verdict(text):
    return bool(VERDICT.search(first_sentence(text)))


# ------------------------------------------------------------------ the transcript

def turns(path):
    """The conversation as a flat list of learner and tutor items, in order.

    Each item is {"who": "learner" | "tutor" | "feedback", "kind", "text"}:
    a learner item is typed text or a picker answer, a tutor item is one text
    block or one picker, and a feedback item marks where a Stop hook blocked
    the reply before it. Sidechains, tool rows and other meta rows are skipped,
    the way obsidian-live.py's read_transcript skips them.
    """
    items, pickers = [], set()
    path = Path(path) if path else None
    if not path or not path.is_file():
        return items
    with path.open() as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("isSidechain"):
                continue
            if row.get("isMeta"):
                if live.stop_feedback(row):
                    items.append({"who": "feedback", "kind": "feedback", "text": ""})
                continue
            kind = row.get("type")
            if kind not in ("assistant", "user"):
                continue
            content = row.get("message", {}).get("content", [])
            if isinstance(content, str):
                text = live.user_text(content) if kind == "user" else content
                if text.strip():
                    items.append({"who": "learner" if kind == "user" else "tutor",
                                  "kind": "text", "text": text})
                continue
            for block in content:
                block_type = block.get("type")
                if block_type == "text":
                    text = block.get("text", "")
                    if kind == "user":
                        text = live.user_text(text)
                    if text.strip():
                        items.append({"who": "learner" if kind == "user" else "tutor",
                                      "kind": "text", "text": text})
                elif block_type == "tool_use" and block.get("name") == "AskUserQuestion":
                    pickers.add(block.get("id"))
                    items.append({"who": "tutor", "kind": "picker",
                                  "text": live.questions_text(block.get("input", {}).get("questions", []))})
                elif block_type == "tool_result" and block.get("tool_use_id") in pickers:
                    text = live.answers_text(row.get("toolUseResult"))
                    if not text:
                        text = block.get("content", "")
                        if not isinstance(text, str):
                            text = "\n".join(b.get("text", "") for b in text if b.get("type") == "text")
                    items.append({"who": "learner", "kind": "answer", "text": text})
    return items


def split_last_turn(items):
    """(asked, learner, reply): the tutor items before the learner's last message,
    that message, and the tutor text since it. After a blocked draft, the reply
    is only what came after the block; the draft never reached the learner.
    """
    learner_at = [index for index, item in enumerate(items) if item["who"] == "learner"]
    if not learner_at:
        return [], None, []
    last = learner_at[-1]
    previous = learner_at[-2] if len(learner_at) > 1 else -1
    asked = [item for item in items[previous + 1:last] if item["who"] == "tutor"]
    after = items[last + 1:]
    feedback_at = [index for index, item in enumerate(after) if item["who"] == "feedback"]
    if feedback_at:
        after = after[feedback_at[-1] + 1:]
    reply = [item["text"] for item in after if item["who"] == "tutor" and item["kind"] == "text"]
    return asked, items[last], reply


def learner_command(learner):
    """The /learn-* verb the learner's last message starts with, or ""."""
    if not learner or learner["kind"] != "text":
        return ""
    match = LEARN_COMMAND.match(learner["text"])
    return match[1] if match else ""


def asked_a_check(asked):
    """True only when the tutor's previous turn plainly ended with a check.

    A picker is a check unless its question is logistics. Prose is a check when
    its last sentence is a question of three or more words that is not
    logistics or a prediction. Anything less certain is not a check, and no
    verdict is demanded (the rule: when you cannot tell, do not flag).
    """
    if not asked:
        return False
    last = asked[-1]
    if last["kind"] == "picker":
        head = last["text"].splitlines()[0] if last["text"] else ""
        return bool(head) and not NOT_A_CHECK.search(head)
    found = sentences(QUOTED.sub(" ", CODE_SPAN.sub(" ", prose(last["text"]))))
    if not found:
        return False
    final = found[-1]
    return (final.endswith("?") and len(WORD.findall(final)) >= 3
            and not NOT_A_CHECK.search(final))


def answered(learner):
    """True when the learner's last message reads as an answer to grade."""
    if not learner:
        return False
    if learner["kind"] == "answer":
        return True
    text = learner["text"].strip()
    if not text or "?" in text or text.startswith("/") or NOT_AN_ANSWER.match(text):
        return False
    return len(WORD.findall(text)) <= ANSWER_MAX_WORDS


# ------------------------------------------------------------------ the reply checks

def reply_findings(reply, asked=(), learner=None, command=""):
    """Everything wrong with the reply, as (kind, one sentence saying what to fix).

    `reply` is the list of text blocks the learner saw this turn, `asked` the
    tutor items before the learner's last message, `learner` that message, and
    `command` the /learn-* verb it was, if any. On a command turn the reply is
    skill-shaped (a recap, a plan), so only the one-question rule and the
    machinery rule apply.
    """
    text = "\n\n".join(block for block in reply if block.strip())
    if not text.strip():
        return []
    problems = []
    if not command:
        words = word_count(text)
        if words > PROSE_WORDS:
            problems.append(("length", "Prose is %d words; tutor.md (Reply shape) keeps it under about 120. "
                            "Keep one idea and the check, and move the rest to the next message."
                            % words))
    asked_questions = questions(text)
    if len(asked_questions) > 1:
        problems.append(("questions", "Two questions to the learner (\"%s\" and \"%s\"); tutor.md (Reply shape) allows "
                        "one. Keep one and hold the other for the next message."
                        % (asked_questions[0][:80], asked_questions[1][:80])))
    nudges = sum(1 for block in reply if is_nudge(block))
    # A nudge says the learner did not answer; demanding a verdict too would
    # contradict it, and the learner's non-answer is the case this rule cannot
    # tell from an answer on its own.
    if (not command and not nudges and asked_a_check(asked) and answered(learner)
            and not opens_with_verdict(text)):
        problems.append(("verdict", "The learner's last message answers your check, but the first sentence is "
                        "\"%s\", not a verdict. Open with right, wrong, or partly right, then the reason "
                        "(tutor.md, Feedback)." % first_sentence(text)[:100]))
    earlier = any(is_nudge(item["text"]) for item in asked if item["kind"] == "text")
    if nudges and (nudges > 1 or earlier):
        problems.append(("nudge", "This is the second time this turn says the question is still waiting. Either "
                        "answer what the learner said or ask the question again in full; do not "
                        "point back at it."))
    names = machinery(text)
    if names:
        problems.append(("machinery", "The prose names %s. Say the topic's name instead; the learner never reads "
                        "node ids, file paths, scripts, or checkers (tutor.md, Reply shape)."
                        % ", ".join(names[:4])))
    return problems


def reply_problems(reply, asked=(), learner=None, command=""):
    """Every problem's sentence, held or not, in the order the checks run."""
    return [text for _, text in reply_findings(reply, asked, learner, command)]


# ------------------------------------------------------------------ the Stop hook

def memory_path(vault, session_id):
    return Path(vault) / ".claude" / "obsidian-live" / (session_id + ".reply-check.json")


def log_path(vault):
    return Path(vault) / ".claude" / "obsidian-live" / "reply-check-log.jsonl"


def log_would_hold(vault, session_id, digest, logged, reply):
    """Append one line per check that would have held this reply, once per reply."""
    path = log_path(vault)
    try:
        lines = path.read_text().splitlines() if path.is_file() else []
    except OSError:
        lines = []
    seen = {(row.get("digest"), row.get("kind")) for row in map(parse_line, lines) if row}
    stamp = time.strftime("%Y-%m-%d %H:%M")
    for kind, text in logged:
        if (digest, kind) in seen:
            continue
        lines.append(json.dumps({"time": stamp, "session": session_id, "digest": digest, "kind": kind,
                                 "reason": text, "reply": "\n\n".join(reply)[:600]}, ensure_ascii=False))
    path.parent.mkdir(parents=True, exist_ok=True)
    live.atomic_write(path, "\n".join(lines[-LOG_KEEP:]) + "\n")


def parse_line(line):
    try:
        row = json.loads(line)
    except ValueError:
        return None
    return row if isinstance(row, dict) else None


def log_report(vault, last=5):
    """Counts per check in the would-hold log, and the latest examples of each."""
    path = log_path(vault)
    rows = [row for row in map(parse_line, path.read_text().splitlines())] if path.is_file() else []
    rows = [row for row in rows if row]
    if not rows:
        return "No would-hold entries yet."
    out = ["%d would-hold entries, %s to %s" % (len(rows), rows[0].get("time", "?"), rows[-1].get("time", "?"))]
    for kind in KINDS:
        mine = [row for row in rows if row.get("kind") == kind]
        if not mine:
            continue
        out.append("")
        out.append("%s: %d" % (kind, len(mine)))
        for row in mine[-last:]:
            out.append("  %s  %s" % (row.get("time", ""), " ".join(row.get("reply", "").split())[:160]))
    return "\n".join(out)


def read_memory(path):
    try:
        store = json.loads(path.read_text())
    except (OSError, ValueError):
        return {"flagged": []}
    if not isinstance(store, dict) or not isinstance(store.get("flagged"), list):
        return {"flagged": []}
    return store


def selected_subject(vault, session_id):
    """The subject obsidian-live.py routed this conversation to, or None."""
    try:
        state = json.loads((Path(vault) / ".claude" / "obsidian-live" / (session_id + ".json")).read_text())
    except (OSError, ValueError):
        return None
    return state.get("subject") if isinstance(state, dict) else None


def process(vault, payload):
    """The Stop hook. Returns the block decision as a dict, or "" to let the reply stand."""
    if payload.get("agent_id") or "/subagents/" in str(payload.get("transcript_path", "")):
        return ""
    if payload.get("stop_hook_active"):
        return ""
    session_id = str(payload.get("session_id", ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session_id):
        return ""
    if not selected_subject(vault, session_id):
        return ""
    items = turns(payload.get("transcript_path"))
    asked, learner, reply = split_last_turn(items)
    command = learner_command(learner)
    if command in SKIP_COMMANDS or not reply:
        return ""
    findings = reply_findings(reply, asked, learner, command)
    if not findings:
        return ""
    digest = hashlib.sha256("\n\n".join(reply).encode("utf-8")).hexdigest()[:16]
    logged = [(kind, text) for kind, text in findings if kind not in HOLD]
    if logged:
        log_would_hold(vault, session_id, digest, logged, reply)
    problems = [text for kind, text in findings if kind in HOLD]
    if not problems:
        return ""
    path = memory_path(vault, session_id)
    memory = read_memory(path)
    if digest in memory["flagged"]:
        return ""   # held once already; a gate its advisee cannot pass is a wall
    memory["flagged"].append(digest)
    del memory["flagged"][:-FLAGGED_KEEP]
    live.atomic_write(path, json.dumps(memory))
    reason = ("Reply check (tutor.md): " + " ".join(problems)
              + " Rewrite the reply with these fixed; the same reply is never held twice.")
    return {"decision": "block", "reason": reason}


# ------------------------------------------------------------------ the closing block

# The only lines in a closing block that may carry the record's words: what
# `learn-status.py --rewards` prints, pasted verbatim. The prefixes are the ones
# reward_lines() builds from; test_hooks.py pins them to that module's labels.
REWARD_PREFIXES = ("Slipped: ", "Topics passed: ", "Topics remembered on a later day: ",
                   "Goals reached: ", "Goal reached: ", "Remembered again after slipping: ",
                   "Remembered on a later day: ", "Review streak: ",
                   "This week's review isn't done yet: ")
WINS_LINE = re.compile(r"^\d+ wins: ")
CLOSING_STRINGS = (("I followed", re.compile(r"\bI followed\b")),
                   ("workflow", re.compile(r"workflow", re.I)),
                   ("Jev", re.compile(r"\bjev\b", re.I)),
                   ("mc-preflight", re.compile(r"mc-preflight", re.I)),
                   ("learn-status", re.compile(r"learn-status", re.I)),
                   ("write-check", re.compile(r"write-check", re.I)),
                   ("semantic:", re.compile(r"semantic:", re.I)))


def is_reward_line(line):
    bare = re.sub(r"^\s*(?:[-*>]\s+)?", "", line)
    return bare.startswith(REWARD_PREFIXES) or bool(WINS_LINE.match(bare))


def closing_problems(text):
    """One finding per hit: (line number, what, the line). Reward lines are exempt."""
    found = []
    for number, line in enumerate(str(text or "").splitlines(), 1):
        if is_reward_line(line):
            continue
        outside_quotes = QUOTED.sub(" ", CODE_SPAN.sub(" ", line))
        if "?" in outside_quotes:
            found.append((number, "a question mark outside a quoted check", line))
        for label, pattern in CLOSING_STRINGS:
            if pattern.search(line):
                found.append((number, "the string %r" % label, line))
        for match in jev.NODE_MENTION.finditer(line):
            found.append((number, "the node id %s" % match.group(0), line))
    return found


def closing_report(text):
    problems = closing_problems(text)
    if not problems:
        return "closing block: clean", 0
    lines = ["line %d: %s\n    %s" % (number, what, line.strip()) for number, what, line in problems]
    lines.append("%d problem%s: rewrite the closing block in the learner's words, then check it again."
                 % (len(problems), "" if len(problems) == 1 else "s"))
    return "\n".join(lines), 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=["hook", "closing", "report"])
    parser.add_argument("source", nargs="?", help="closing: a file, or - for stdin")
    parser.add_argument("--vault", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    if args.mode == "report":
        print(log_report(args.vault.resolve()))
        return
    if args.mode == "closing":
        if not args.source:
            parser.error("closing needs a file path or - for stdin")
        text = sys.stdin.read() if args.source == "-" else Path(args.source).read_text()
        report, code = closing_report(text)
        print(report)
        sys.exit(code)
    try:
        output = process(args.vault.resolve(), json.load(sys.stdin))
    except Exception as error:  # noqa: BLE001 -- a broken checker must never hold a reply
        print("Reply check: " + str(error), file=sys.stderr)
        return
    if output:
        print(json.dumps(output))


if __name__ == "__main__":
    main()
