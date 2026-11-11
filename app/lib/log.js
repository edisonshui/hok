// Reads a subject's log.md, the live conversation the vault's hook writes.
//
// The hook (.claude/hooks/obsidian-live.py) writes: `## Conversation — date`, an
// italic model line, then callouts (`> [!quote] You · 22:51`, `> [!question]
// Question · 14:22`, `> [!quote] Your answer`, `> [!thinking]+ Thinking`,
// `> [!code] Your code`, `> [!warning] Probe check`), with the tutor's replies as
// plain Markdown between them. This is the log, not the learning record, so it is
// read here and not by learn-status.py.

const CALLOUT = /^> \[!(\w+)\][+-]?\s*(.*)$/;
const MODEL = /^\*[^*]+·[^*]+\*$/;

// A picker the hook held back comes back as an "answer" holding the hook's own
// message. It is plumbing, not something the learner said (cs124-quiz9, 2026-10-26).
const HOOK_NOISE = /^(PreToolUse|PostToolUse):\S+ hook error/;

function stripFrontmatter(text) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  return end < 0 ? text : text.slice(text.indexOf("\n", end + 1) + 1);
}

function parseLog(text) {
  const body = stripFrontmatter(String(text || "").replace(/\r/g, ""));
  const chunks = body.split(/^## Conversation\s*\S\s*/m).slice(1);
  return chunks.map((chunk) => {
    const lines = chunk.split("\n");
    const convo = { date: lines[0].trim(), model: "", items: [] };
    let tutor = [];
    const flush = () => {
      const t = tutor.join("\n").trim();
      if (t) convo.items.push({ kind: "tutor", label: "", time: "", text: t });
      tutor = [];
    };
    let i = 1;
    while (i < lines.length) {
      const line = lines[i];
      const head = line.match(CALLOUT);
      if (!convo.model && MODEL.test(line.trim())) {
        convo.model = line.trim().replace(/^\*|\*$/g, "");
        i++;
        continue;
      }
      if (!head) {
        tutor.push(line);
        i++;
        continue;
      }
      flush();
      let [, kind, title] = head;
      const block = [];
      i++;
      while (i < lines.length && lines[i].startsWith(">")) block.push(lines[i++].replace(/^> ?/, ""));
      const label = title.split("·")[0].trim();
      const time = title.includes("·") ? title.split("·").pop().trim() : "";
      if (kind === "quote") kind = label.startsWith("Your answer") ? "answer" : "you";
      const text = block.join("\n").trim();
      if (kind === "answer" && HOOK_NOISE.test(text)) continue;
      // The whole title too: a check's ("Warm-up 1 of 2 · HW23") is not a label and a time.
      convo.items.push({ kind, label, time, title: title.trim(), text });
    }
    flush();
    return convo;
  });
}

// Blank-line blocks, keeping fenced code whole.
function paragraphs(text) {
  const out = [];
  let cur = [], fence = false;
  for (const l of String(text).split("\n")) {
    if (/^```/.test(l)) fence = !fence;
    if (!l.trim() && !fence) {
      if (cur.length) out.push(cur.join("\n"));
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

// A question callout as groups of {body, options: [{label, desc}]}. One picker
// can hold several questions, each a bold line or a body, then `- **label** — desc`.
function parseQuestion(text) {
  const groups = [];
  for (const p of paragraphs(text)) {
    if (/^- \*\*/.test(p)) {
      if (!groups.length) groups.push({ body: "", options: [] });
      const g = groups[groups.length - 1];
      for (const l of p.split("\n")) {
        const m = l.match(/^- \*\*(.+?)\*\*(?:\s+\S\s+(.*))?$/);
        if (m) g.options.push({ label: m[1], desc: m[2] || "" });
      }
    } else if (groups.length && !groups[groups.length - 1].options.length) {
      groups[groups.length - 1].body += "\n\n" + p;
    } else groups.push({ body: p, options: [] });
  }
  return groups;
}

// What the learner wrote in an answer: every paragraph that is not a repeat of
// the question text the hook copies above each answer.
function answerParts(question, answer) {
  const asked = new Set(paragraphs(question || "").map((p) => p.trim()));
  return paragraphs(answer || "").map((p) => p.trim()).filter((p) => !asked.has(p) && !/^\*\*.*\*\*$/.test(p));
}

// Which answer went with which question, for a card folded down once it's answered: an option picked in a group goes
// with that group, and words typed in place of an option go, in order, to the groups left with none. Anything still
// over is kept as extra, so no answer is lost from the folded card.
function answersByGroup(groups, picked) {
  const labels = new Set(groups.flatMap((g) => g.options.map((o) => o.label)));
  const typed = (picked || []).filter((p) => !labels.has(p));
  const per = groups.map((g) => g.options.filter((o) => (picked || []).includes(o.label)).map((o) => o.label));
  per.forEach((a) => { if (!a.length && typed.length) a.push(typed.shift()); });
  return { per, extra: typed };
}

// The renderer has no require(), so the main process does the reading: each
// question gets its groups and the learner's picks, each answer its own words.
function readLog(text) {
  const conversations = parseLog(text);
  for (const convo of conversations) {
    let lastQuestion = null;
    convo.items.forEach((item, index) => {
      if (item.kind === "question") {
        lastQuestion = item;
        item.groups = parseQuestion(item.text);
        const next = convo.items.slice(index + 1).find((x) => x.kind !== "warning");
        // Held back by the hook and asked again: only the second one reached the learner.
        item.withdrawn = !!(next && next.kind === "question");
        item.picked = next && next.kind === "answer" ? answerParts(item.text, next.text) : [];
        item.answered = !!(next && next.kind === "answer");
        if (item.answered && item.groups.some((g) => g.options.length)) item.answers = answersByGroup(item.groups, item.picked);
      } else if (item.kind === "answer") {
        item.parts = answerParts(lastQuestion ? lastQuestion.text : "", item.text);
        item.skipped = /doesn't want to proceed/.test(item.text);
        // Its question's card shows these answers once folded, so the bubble would say them twice.
        item.onCard = !item.skipped && !!(lastQuestion && lastQuestion.answers && convo.items.slice(0, index).reverse().find((x) => x.kind !== "warning") === lastQuestion);
      }
    });
  }
  return conversations;
}

module.exports = { parseLog, readLog, parseQuestion, paragraphs, answerParts, answersByGroup, stripFrontmatter };
