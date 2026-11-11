#!/usr/bin/env node
// Builds a starter vault for a new learner from a working learning vault, and reports every line that still names
// its owner, for a person to read before anything is shared.
//
//   node scripts/make-starter-vault.js <vault> [out]      out defaults to ./starter-vault (git-ignored)
//
// Only files the vault tracks in git are candidates, so its ignore rules already keep out the owner's subjects,
// preferences, reviews and conversations. From those, only the teaching system is copied (KEEP below): the
// /learn-* skills, the hooks, the Codex mirror, the Obsidian plugin and styles, and learn/system. The owner's build
// tools (the app, design skills, docs) stay behind. The new learner's own folders start empty.
//
// Nothing here publishes anything. The review file is written next to the starter, never inside it.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// What a learner's vault needs, as path patterns relative to the vault.
const KEEP = [
  /^CLAUDE\.md$/, /^AGENTS\.md$/, /^\.gitignore$/,
  /^learn\/README\.md$/, /^learn\/Queries\.md$/, /^learn\/system\//,
  /^\.claude\/settings\.json$/, /^\.claude\/hooks\//, /^\.claude\/agents\//, /^\.claude\/skills\/learn-[a-z]+\//,
  /^\.agents\/skills\/learn-[a-z]+\//,
  /^\.codex\//,
  /^\.obsidian\/(app|appearance|community-plugins|core-plugins|graph)\.json$/, /^\.obsidian\/plugins\/learn-live\//, /^\.obsidian\/snippets\//,
];
// Within what is kept: the owner's working notes about the system, and the hooks' own tests.
const DROP = [/^learn\/system\/(AUDIT|PLAN|SPEC)-/, /(^|\/)test_[^/]+\.py$/, /(^|\/)__pycache__\//];

// The owner's name in the instructions becomes the learner's, in the starter only: a new learner's tutor reads these
// files, and "Propose changes for Edison to edit" would have it address them by someone else's name. A dated note
// keeps its date and loses the name. Each rule runs on prose, so code and identifiers are left alone.
const GENERALIZE = [
  [/\(Edison,\s*/g, "("],                                  // (Edison, 2026-10-25) → (2026-10-25)
  [/\bEdison's\b/g, (m, at, text) => (startsSentence(text, at) ? "The learner's" : "the learner's")],
  [/\bEdison\b/g, (m, at, text) => (startsSentence(text, at) ? "The learner" : "the learner")],
  // The app's old working name, in the instructions the tutor reads.
  [/\bFlash's\b/g, (m, at, text) => (startsSentence(text, at) ? "The app's" : "the app's")],
  [/\bFlash\b/g, (m, at, text) => (startsSentence(text, at) ? "The app" : "the app")],
];
// True when the match opens a sentence: at a line's start after comment or list marks, or after a full stop.
function startsSentence(text, at) {
  const before = text.slice(Math.max(0, text.lastIndexOf("\n", at - 1) + 1), at);
  return /^[\s#*>\-"'/(]*$/.test(before) || /[.!?]["')]?\s+$/.test(before);
}
function generalize(text) {
  for (const [re, to] of GENERALIZE) text = text.replace(re, typeof to === "function" ? (m, ...rest) => to(m, rest[rest.length - 2], rest[rest.length - 1]) : to);
  return text;
}
// The owner's own build tools, left out of the starter; a starter file that still points at one is a dead reference.
const LEFT_OUT_SKILLS = ["flash-design", "vault-design", "verify-vault", "plan-checkpoint", "impeccable", "encode-lessons"];

// What marks a line as the owner's: names, accounts, school, courses, and the slugs of their subjects.
function ownerMarks(vault) {
  const subjects = fs.existsSync(path.join(vault, "learn", "subjects"))
    ? fs.readdirSync(path.join(vault, "learn", "subjects")).filter((d) => /^[a-z0-9][a-z0-9-]*$/.test(d)) : [];
  // The owner's own words (name, accounts, school, courses) are personal, so they live in scripts/owner-words.txt,
  // one per line, which git ignores. Without that file (a build on GitHub), only the subject slugs are searched for.
  const wordsFile = path.join(__dirname, "owner-words.txt");
  // A line that starts with "=" is matched in its exact case (a short name that is also a common word).
  const words = fs.existsSync(wordsFile) ? fs.readFileSync(wordsFile, "utf8").split("\n").map((w) => w.trim()).filter((w) => w && !w.startsWith("#")) : [];
  if (!words.length) console.warn("No scripts/owner-words.txt: the review will only look for subject names.");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [
    ...words.map((line) => { const exact = line.startsWith("="), w = exact ? line.slice(1) : line; return { label: w, re: new RegExp(/^[A-Za-z]/.test(w) ? `\\b${esc(w)}\\b` : esc(w), exact ? "" : "i") }; }),
    ...subjects.map((s) => ({ label: `subject ${s}`, re: new RegExp(`\\b${esc(s)}\\b`) })),
  ];
}

function tracked(vault) {
  return execFileSync("git", ["-C", vault, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

// The new learner's preferences start blank, in the shape the tutor reads (learn/me/preferences.md).
const PREFERENCES = `---
type: learner-preferences
---

# Learner preferences

## Stated

*What you tell the tutor about how you like to learn. Write it in your own words, or let the tutor ask on your first subject.*

## Operational summary

- Pacing: one reasoning step, then a check.
- Explanation order: a concrete example, then the general rule, then how they connect.
- Hints: when stuck, point to a fact you already know before giving the answer.

## Observed (appended by the tutor, evidence-based)

## Candidates (running tally — not yet at the bar)

## Proposed changes to Stated (for the learner to accept or reject)
`;

function build(vault, out) {
  vault = path.resolve(vault); out = path.resolve(out);
  if (!fs.existsSync(path.join(vault, ".claude", "hooks", "learn-status.py"))) throw new Error(`${vault} is not a learning vault`);
  if (out === vault || out.startsWith(vault + path.sep)) throw new Error("the starter must live outside the vault");
  fs.rmSync(out, { recursive: true, force: true });
  const files = tracked(vault).filter((f) => KEEP.some((re) => re.test(f)) && !DROP.some((re) => re.test(f)));
  for (const f of files) {
    const from = path.join(vault, f), to = path.join(out, f);
    if (!fs.existsSync(from)) continue;   // tracked but deleted in the working tree
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const buf = fs.readFileSync(from);
    if (buf.includes(0) || /\.(png|jpe?g|gif|webp|woff2?|ttf)$/i.test(f)) fs.copyFileSync(from, to);
    else fs.writeFileSync(to, generalize(buf.toString("utf8")));
    fs.chmodSync(to, fs.statSync(from).mode);   // a hook script that loses its executable bit cannot start
  }
  for (const d of ["learn/subjects", "learn/reviews", "learn/me"]) {
    fs.mkdirSync(path.join(out, d), { recursive: true });
    if (d !== "learn/me") fs.writeFileSync(path.join(out, d, ".gitkeep"), "");
  }
  fs.writeFileSync(path.join(out, "learn", "me", "preferences.md"), PREFERENCES);
  fs.writeFileSync(path.join(out, ".starter-vault"), `Made from a learning vault on ${new Date().toISOString().slice(0, 10)}.\n`);
  return { files: files.length + 2, review: review(vault, out) };
}

// Every line in the starter that names the owner, by file, for a person to read. Binary files are skipped.
function review(vault, out) {
  const marks = ownerMarks(vault), hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      const buf = fs.readFileSync(full);
      if (buf.includes(0)) continue;
      buf.toString("utf8").split("\n").forEach((line, i) => {
        const found = marks.filter((m) => m.re.test(line)).map((m) => m.label)
          .concat(LEFT_OUT_SKILLS.filter((n) => new RegExp(`\\b${n}\\b`).test(line)).map((n) => `left-out skill ${n}`))
          // In the instructions, a "he" left over may still mean the owner; code is not read for it.
          .concat(/\.md$/.test(name) && /\b(he|him|his)\b/i.test(line) ? ["he/him/his"] : []);
        if (found.length) hits.push({ file: path.relative(out, full), line: i + 1, found, text: line.trim().slice(0, 160) });
      });
    }
  };
  walk(out);
  return hits;
}

function reviewMarkdown(hits, files) {
  const byFile = new Map();
  for (const h of hits) { if (!byFile.has(h.file)) byFile.set(h.file, []); byFile.get(h.file).push(h); }
  const counts = {};
  for (const h of hits) for (const f of h.found) counts[f] = (counts[f] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ");
  return `# Starter vault: what still names you

${files} files copied. ${hits.length} lines in ${byFile.size} files mention you, your school, your courses or your subjects.
Most common: ${top || "none"}.

Each line below needs a decision before the starter goes to anyone: make it general, cut it, or keep it.

${[...byFile].sort((a, b) => b[1].length - a[1].length).map(([file, list]) => `## ${file} (${list.length})\n\n${list.map((h) => `- ${h.line}: ${h.found.join(", ")} · \`${h.text.replace(/`/g, "'")}\``).join("\n")}`).join("\n\n")}
`;
}

if (require.main === module) {
  const [vault, outArg] = process.argv.slice(2);
  if (!vault) { console.error("usage: make-starter-vault.js <vault> [out]"); process.exit(2); }
  const out = path.resolve(outArg || path.join(__dirname, "..", "starter-vault"));
  const { files, review: hits } = build(vault, out);
  const report = out + "-review.md";
  fs.writeFileSync(report, reviewMarkdown(hits, files));
  console.log(`${files} files in ${out}\n${hits.length} lines name the owner; see ${report}`);
}

module.exports = { build, review, KEEP, DROP };
