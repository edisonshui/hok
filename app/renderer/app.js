// Flash: the window. Screens are drawn from learn-status.py --json. The tutor
// runs in a real terminal that opens in a drawer; the Session thread is read
// from the subject's log.md, and the composer types into the terminal.
// Design rules: .claude/skills/flash-design.
"use strict";

const { esc, inline, renderMd, typeset } = window.MD;
const F = window.flash;
if (F.onZoom) F.onZoom((z) => { document.documentElement.style.setProperty("--z", z); document.documentElement.classList.toggle("zoomed", z !== 1); });   // main.js fitZoom: what lines up with the traffic lights divides by it
const $ = (id) => document.getElementById(id);

// ---------- state ----------
let S = null, cfg = null, info = null;
// macOS draws the window as glass over the desktop (main.js, vibrancy); the page then paints only tints
// Every system gets the glass look. On a Mac the glass is the window itself; elsewhere the page draws the stone glass
// under its own sheets (wallpaper.js), so Windows and Linux show the same design, not the older flat one (11 Nov;
// seen off the Mac only in a simulated run).
const GLASS = true;
if (GLASS) document.documentElement.classList.add("glass");
let route = { name: "home", slug: null };
let setupInfo = null;
let lastSaved = 0;
const scrolls = {};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SUBJECT_ROUTES = ["session", "progress", "map"];
const MAPS = ["map", "system"];
const NAMES = { home: "Home", session: "Session", system: "All skills", dashboard: "Dashboard", progress: "Progress", map: "Skill map", setup: "Set up" };
const THEMES = ["code", "math", "circuits", "literature", "design", "calm"];

// ---------- small helpers ----------
const icon = (id, cls = "") => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;  // sprite ids carry "i-" so they never collide with element ids
const isMac = () => !info || info.platform === "darwin";
const key = (k) => (isMac() ? "⌘" : "Ctrl+Shift+") + k;
const keyAlt = (k) => (isMac() ? "⌥⌘" : "Ctrl+Shift+Alt+") + k;
const keyShift = (k) => (isMac() ? "⇧⌘" : "Ctrl+Shift+Alt+") + k;
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const sentence = (t) => (!t ? "" : /[.?!]$/.test(t.trim()) ? t.trim() : t.trim() + ".");
const isoDate = (t) => (/^\d{4}-\d{2}-\d{2}/.test(t || "") ? new Date(t.slice(0, 10) + "T12:00:00") : null);
const shortD = (t) => { const d = isoDate(t); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : ""; };
const longD = (t) => { const d = isoDate(t); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : ""; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const subj = (slug) => (S && S.subjects.find((s) => s.slug === slug)) || null;
const themeOf = (s) => (s && THEMES.includes(s.theme) ? s.theme : "calm");
const subjVar = (s) => `--c:var(--subject-${themeOf(s)})`;
const tileIcon = (s, cls = "") => `<span class="tile-icon ${cls}" style="${subjVar(s)}">${icon(themeOf(s))}</span>`;
// The sidebar's short name: the record title up to its first dash or parenthesis.
const shortTitle = (s) => String(s.title || s.slug).replace(/\s+[—–-]\s+.*$/, "").replace(/\s*\(.*\)\s*$/, "");
// Subjects of one course: "CS 124 Quiz 7", "CS 124 Quiz 8: References…" group under "CS 124".
function courseGroups(list) {
  const m = new Map();
  list.forEach((s) => { const code = (s.title.match(/^[A-Z]{2,5} \d{2,3}/) || [null])[0], k = code || s.slug; if (!m.has(k)) m.set(k, { code, list: [] }); m.get(k).list.push(s); });
  return [...m.values()];
}
// The name a subject goes by next to its tile: "MATH 241 HW24", or the short title when its course has one subject.
function nick(s) {
  const code = (s.title.match(/^[A-Z]{2,5} \d{2,3}/) || [null])[0];
  return code && S.subjects.filter((x) => x.title.startsWith(code + " ")).length > 1 ? `${code} ${subName(s)}` : shortTitle(s);
}
// One short name per subject, used by the index and Home (5 Nov): the name Home and the sidebar share when it fits
// (20 characters), else the course code and the Skills page's short name ("MATH 241 Lagrange", "OOP").
function indexName(x) {
  const n = nick(x);
  if (n.length <= 20 && !/\sQuiz$/.test(n)) return n;
  const code = (x.title.match(/^[A-Z]{2,5} \d{2,3}/) || [null])[0], short = window.SkillsPage ? SkillsPage.shortOf(x) : n;
  return code ? `${code} ${short}` : short;
}
const subName = (s) => afterCode(s).replace(/:.*$/, "").replace(/\s+[—–-]\s+.*$/, "").replace(/\s*\(.*\)\s*$/, "").trim() || shortTitle(s);
const courseCode = (s) => (s.title.match(/^[A-Z]{2,5} \d{2,3}/) || [shortTitle(s)])[0];
const afterCode = (s) => s.title.replace(/^[A-Z]{2,5} \d{2,3}\s+/, "");
// Node names carry their strand, "(S2)", which is the tutor's bookkeeping.
const nodeName = (n) => String(n || "").replace(/\s*\(S\d+\)\s*$/, "");
const md = (t) => inline(nodeName(t));
const sigil = () => (cfg && cfg.host === "codex" ? "$" : "/");
const tutorName = () => (cfg && cfg.host === "codex" ? "Codex" : "Claude Code");
const firstName = () => (cfg && cfg.name) || (info && info.firstName) || "";

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return firstName() ? `${part}, ${firstName()}` : part;
}
function dayDate(days) { const d = new Date(S.today + "T12:00:00"); d.setDate(d.getDate() + days); return d; }
// "Deadline tomorrow", "Deadline Fri": a weekday keeps its capital.
const deadlineWord = (days) => (/^(Today|Tomorrow)$/.test(dayWord(days)) ? dayWord(days).toLowerCase() : dayWord(days));
// Between midnight and 4 am, "today" and "tomorrow" mean the wrong day to someone
// who hasn't slept, so the app says the weekday instead (spec, Home on launch).
const lateNight = () => new Date().getHours() < 4;
function dayWord(days) {
  if (days === 0 && !lateNight()) return "Today";
  if (days === 1 && !lateNight()) return "Tomorrow";
  if (days >= 0 && days <= 1) return DAYS[dayDate(days).getDay()];
  return days < 7 ? DAYS[dayDate(days).getDay()] : shortD(ymd(dayDate(days)));
}
// "claude-opus-5-5 · medium effort" reads as "Opus 5.5 · medium".
function prettyModel(m) {
  if (!m) return "";
  const [name, effort] = m.split("·").map((x) => x.trim());
  const found = name.match(/^claude-([a-z]+)-(\d+)-(\d+)/i);
  const label = found ? `${cap(found[1])} ${found[2]}.${found[3]}` : name;
  const e = (effort || "").replace(/\s*effort$/i, "");
  return e ? `${label} · ${e}` : label;
}

// The ranking speaks the vault's own words ("nodes", "s01 note"). The app says
// what happens instead (flash-design, Voice).
function plain(found) {
  const s = found.subject ? subj(found.subject) : null;
  let reason = String(found.reason || "").replace(/\*/g, "");
  reason = reason.replace(/\s*Its open s\d+ note is closed out first\./, "").replace(/\bnodes\b/g, "skills").replace(/\bnode\b/g, "skill");
  reason = reason.replace(/\s*\(S\d+\)/g, "");
  let why = null;
  if (found.kind === "Deadline") {
    const m = reason.match(/^deadline ([^:]+):\s*(.*)$/);
    if (m) { why = cap(`deadline ${m[1]}`); reason = m[2]; }
  }
  if (found.kind === "Repair") reason = reason.replace(/^(.*) slipped on (.*)$/, "Worth a refresh: $1. It slipped on $2");
  if (s && s.status === "diagnosing") reason = "a few more questions to find where you start";
  return { why: why && lateWords(why), line: lateWords(sentence(cap(reason))) };
}
// The records' own "today" and "tomorrow", as weekdays late at night.
function lateWords(t) {
  if (!lateNight() || !S) return t;
  const name = (d) => DAYS_LONG[dayDate(d).getDay()];
  return String(t).replace(/\b(today|tomorrow)\b/gi, (w) => { const n = name(/^today$/i.test(w) ? 0 : 1); return w[0] === w[0].toUpperCase() ? n : n; });
}
const VERB = { Deadline: "Resume", Repair: "Repair", Review: "Review", Resume: "Resume", Start: "Start", "Continue a break": "Resume" };

// ---------- clicks: one listener, actions by name ----------
const ACTIONS = {};
document.addEventListener("click", (e) => {
  const link = e.target.closest("a.lnk[data-href]");
  if (link) { e.preventDefault(); F.openExternal(link.dataset.href); return; }
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset.arg, el, e); }
});
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-prefetch]");
  if (el) prefetchSession(el.dataset.prefetch);
});

// ---------- routing ----------
function routeKey(r = route) { return SUBJECT_ROUTES.includes(r.name) ? `${r.name}/${r.slug}` : r.name; }
// Page switches (5 Nov: a View Transition snapshots the whole window, both pages, and on the glass window that is what
// made Home and Skills lag; measured 35 to 42 ms frames here, worse on Edison's Mac). Switching pages happens tens of
// times a day, so an ordinary switch is a 120 ms fade of the new page, run by the compositor. Only the glide (Home into
// a subject and back) keeps the View Transition, where the motion carries meaning.
// Frame log (5 Nov, temporary): how smooth the screen is during launch and after each page switch, on the Mac it runs
// on. main.js writes these lines to perf.log in the app's folder, so lag can be measured there instead of guessed.
function perfWatch(label, ms = 1200) {
  const d = []; let last = performance.now(); const t0 = last;
  const f = (t) => { d.push(t - last); last = t; if (t - t0 < ms) return requestAnimationFrame(f);
    d.sort((a, b) => a - b); console.info(`[perf] ${label} frames=${d.length} median=${d[d.length >> 1].toFixed(1)}ms worst=${d.at(-1).toFixed(1)}ms over25=${d.filter((x) => x > 25).length} over50=${d.filter((x) => x > 50).length}`); };
  requestAnimationFrame(f);
}
let sessionArrive = false;
function arrive(el) {
  el.style.opacity = "";
  // 150 ms in, a 6 px rise over 220 ms on a strong ease-out (Edison, 5 Nov: 200/320 on the spring felt slow for a switch)
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
  el.animate([{ transform: "translateY(6px)" }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
}
function swap(paint, glide = false) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!glide) {
    paint();
    // The new page arrives (Edison, 5 Nov: switches between session, Home and Skills looked like they had no animation,
    // a 120 ms fade nobody saw): it fades in and rises 6 px. Compositor-only, so it holds its frames.
    if (!calm && document.visibilityState === "visible" && route.name !== "home") {
      // A subject not yet drawn waits, unseen, until its thread is painted (paintSession), then rises: risen at once,
      // the page arrived empty and the thread popped in mid-motion (100 to 117 ms frames, measured 5 Nov).
      if (route.name === "session" && LOG.slug !== route.slug && subj(route.slug)) { sessionArrive = true; $("session").style.opacity = "0"; setTimeout(() => { if (sessionArrive) { sessionArrive = false; arrive($("session")); } }, 700); }   // never left unseen
      else for (const el of [$("screen"), $("session")]) if (el && !el.classList.contains("hidden")) arrive(el);
    }
    return;
  }
  // A hidden or background window has nothing to animate; the transition would only throw.
  if (!document.startViewTransition || calm || document.visibilityState !== "visible") return paint();
  // The browser skips the update when it aborts a transition, so paint once either way.
  let done = false;
  const once = () => { if (!done) { done = true; paint(); } };
  const t = document.startViewTransition(once);
  t.ready.catch(() => {}); t.finished.catch(() => {}); t.updateCallbackDone.catch(() => {});
  setTimeout(once, 300);
}
// The subjects you opened last, newest first, for the subject menu (Edison, 5 Nov: "the last five opened subjects").
const RECENT_KEY = "ol.recentSubjects", ACTIVE_KEY = "ol.activeAt";
// When you last did something in a subject (sent it a message, ran one of its steps): the list's order. Only opening
// it does not count (Edison, 7 Nov: clicking into a subject reshuffled the list).
function noteActive(slug) {
  if (!slug) return;
  try { const o = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "{}"); o[slug] = Date.now(); localStorage.setItem(ACTIVE_KEY, JSON.stringify(o)); } catch { /* private storage off */ }
}
function noteRecent(slug) {
  if (!slug) return;
  try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((x) => x !== slug && subj(x)); r.unshift(slug); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 12))); } catch { /* private storage off */ }   // a renamed or deleted subject drops out
}
function recentSubjects(n, skip) {
  let r = []; try { r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { /* none */ }
  return r.filter((x) => x !== skip).map(subj).filter((x) => x && x.status !== "done").slice(0, n);
}
function go(name, slug) {
  if (!S && name !== "setup") return;
  if (SUBJECT_ROUTES.includes(name) && !slug) slug = route.slug || defaultSlug();
  if (SUBJECT_ROUTES.includes(name) && !subj(slug) && name !== "session") return;
  const before = routeKey(), from = route.name, glide = (route.name === "home" && (name === "session" || name === "question")) || ((route.name === "session" || route.name === "question") && name === "home");
  scrolls[before] = scrollerOf(route.name).scrollTop;
  route = { name, slug: slug || route.slug };
  const after = routeKey();
  if (before === after) return render();
  perfWatch(`${from} to ${name}${glide ? " (glide)" : ""}`);
  if (SUBJECT_ROUTES.includes(name)) noteRecent(route.slug);
  homeArrive = name === "home" && from !== "home";
  if (from === "system" && name !== "system" && window.SkillsPage && SkillsPage.forget) SkillsPage.forget();
  if (glide) document.documentElement.dataset.glide = name === "home" ? "home" : "session";   // which way the field glides (styles.css)
  if (window.Wall) Wall.route(name);   // the wallpaper holds still off Home (wallpaper.js); set before the glide takes its picture
  swap(() => {
    render();
    // A new screen opens at the top; coming back returns to where you were.
    if (route.name !== "session") $("screen").scrollTop = scrolls[after] || 0;
  }, glide);
}
function scrollerOf(name) { return name === "session" ? $("threadScroll") : $("screen"); }
function defaultSlug() {
  if (!S) return null;
  const top = S.ranked.find((x) => x.subject);
  return top ? top.subject : S.subjects[0] && S.subjects[0].slug;
}

function render() {
  if (route.name === "setup") return paintSetup();
  if (!S) return;
  if (route.name === "home") homeStale = false;
  if (window.Wall) Wall.route(route.name);
  if (route.slug && !subj(route.slug)) route.slug = defaultSlug();
  paintShell(); paintSide(); paintIslands();
  const inSession = route.name === "session";
  $("session").classList.toggle("hidden", !inSession);
  $("screen").classList.toggle("hidden", inSession);
  if (inSession) return paintSession();
  ({ home: paintHome, dashboard: paintDashboard, system: paintSystem, progress: paintProgress, map: paintMap, question: () => paintQuestion(true) })[route.name]();
  typeset($("screen"));
}

// A refresh that changes nothing repaints nothing (flash-design principle 5):
// put() sets the markup only when it differs from what is on screen.
function put(el, html) {
  const h = String(hash(html));
  if (el.dataset.h === h) return false;
  el.dataset.h = h;
  el.innerHTML = html;
  return true;
}
const unput = (el) => { delete el.dataset.h; };

// ---------- shell ----------
const SIDE_MODES = ["full", "icons", "hidden"];
function sideMode() { return SIDE_MODES.includes(cfg.sidebarMode) ? cfg.sidebarMode : cfg.sidebar === false ? "hidden" : "full"; }
function paintShell() {
  const mode = sideMode(), w = $("win");
  const planned = route.name === "session" && cfg.panel && !!subj(route.slug);
  // Arriving on a session with the plan open (or leaving one), the plan column is simply there: animating it under the
  // Home-to-Session glide relaid and repainted the whole thread every frame (7 Nov: 121 ms of paint against 10 without
  // the plan; Edison: "laggy"). Only the plan button's own toggle moves it.
  if (planned !== w.classList.contains("planned") && !w.classList.contains("plan-move") && sideMode() === (w.classList.contains("bare") ? "hidden" : w.classList.contains("icons") ? "icons" : "full")) {
    w.classList.add("snap"); requestAnimationFrame(() => requestAnimationFrame(() => w.classList.remove("snap")));
  }
  w.classList.toggle("planned", planned);
  w.classList.toggle("icons", mode === "icons");
  w.classList.toggle("bare", mode === "hidden");
  $("plan").classList.toggle("hidden", route.name !== "session" || !subj(route.slug));
  if (planned) paintPlan();

}
let doneOpen = false;
function rightTag(s) {
  if (s.days_to_deadline !== null && s.days_to_deadline >= 0 && s.days_to_deadline < 7) return dayWord(s.days_to_deadline);
  const m = (s.pending || "").match(/^(\d+)/);
  return m ? m[1] : "";
}
function dueCount() { return S.subjects.reduce((n, s) => n + s.nodes.filter((x) => x.due).length, 0); }
// One list (Edison, 7 Nov: two lists were "extra friction"): your latest questions sit at the top of the subjects,
// newest first, in a lighter ink, since they keep no record. Older ones wait in Search.
// The list runs newest first (Edison, 7 Nov: a question that became a lesson dropped from the top to its course's
// place): a subject by when you last opened it or last had a session, a question by its last message.
function sideOrder(subjects) {
  let opened = {}; try { opened = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "{}"); } catch { /* none */ }
  const at = (s) => Math.max(opened[s.slug] || 0, s.last_session ? +new Date(`${s.last_session}T12:00:00`) || 0 : 0);
  const rows = subjects.map((s, i) => ({ s, t: at(s), i }));
  Q.list.filter((q) => Date.now() - new Date(q.updated) < 14 * 864e5).slice(0, 5).forEach((q, i) => rows.push({ q, t: +new Date(q.updated), i: -1 - i }));
  return rows.sort((a, b) => b.t - a.t || a.i - b.i);
}
function qRow(q, tip, icons) {
  return `<div class="q-side"><button class="nav-row subject ix q-row-side ${route.name === "question" && Q.id === q.id ? "on" : ""}" data-act="question" data-arg="${q.id}" title="${esc(q.title)}"${tip(esc(q.title))}><span class="lbl">${esc(q.title)}</span></button>${icons ? "" : `<button class="q-arch" data-act="question-archive" data-arg="${q.id}" aria-label="Archive" data-tip="Archive" data-tip-side="right">${icon("archive", "sm")}</button>`}</div>`;
}
function paintSide() {
  const el = $("side"), icons = sideMode() === "icons";
  const tip = (t) => (icons ? ` data-tip="${t}" data-tip-side="right"` : "");
  const due = dueCount();
  const repairs = S.ranked.filter((x) => x.kind === "Repair");
  const live = S.subjects.filter((s) => s.status !== "done");
  const done = S.subjects.filter((s) => s.status === "done");
  const nav = (r, ic, name, k) => `<button class="nav-row ${route.name === r ? "on" : ""}" data-act="go" data-arg="${r}"${tip(`${name}  ${key(k)}`)}>${icon(ic)}<span class="lbl">${name}</span></button>`;
  const isOn = (s) => s.slug === route.slug && SUBJECT_ROUTES.includes(route.name);
  // No "running" dot (7 Nov, Edison: "goofy", and it lit the subject on screen, not the one the tutor was in).
  const tagOf = (s) => esc(rightTag(s));
  const mini = (s) => {
    const c = (s.title.match(/^[A-Z]{2,5} (\d{2,3})/) || [])[1]; if (c) return c;
    const t = shortTitle(s), caps = t.split(/[\s-]+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("");
    const first = t.split(/\s+/)[0];
    // "Object-Oriented Programming" reads as OOP; "Homelessness in Champaign" as Home.
    return first.includes("-") && caps.length >= 3 ? caps.slice(0, 3) : first.length <= 6 ? first : first.slice(0, 4);
  };
  const row = (s, child) => `<button class="nav-row subject ${child ? "child" : ""} ${isOn(s) ? "on" : ""}" data-prefetch="${s.slug}" data-act="subject" data-arg="${s.slug}" title="${esc(s.title)}"${tip(esc(shortTitle(s)))}>${child ? "" : tileIcon(s, "side-tile") + `<span class="mini">${esc(mini(s))}</span>`}<span class="lbl">${esc(child ? subName(s) : shortTitle(s))}</span><span class="n">${tagOf(s)}</span></button>`;
  // A course with several subjects shows its code once and short names under it.
  // Folded to icons, the course is one tile that opens its first subject.
  const grouped = (list) => courseGroups(list).map((g) => g.list.length < 2 || !g.code ? g.list.map((s) => row(s, false)).join("")
    : `<button class="nav-row subject course ${g.list.some(isOn) ? "has-on" : ""}" data-act="subject" data-arg="${g.list[0].slug}"${tip(esc(g.code))}>${tileIcon(g.list[0], "side-tile")}<span class="lbl">${esc(g.code)}</span><span class="mini">${esc(g.code.split(" ")[1])}</span></button>` + g.list.map((s) => row(s, true)).join("")).join("");
  const streak = S.rewards_on ? `<button class="streak-card" data-act="go" data-arg="dashboard"${tip(`${S.streak.current}-week review streak`)}><span class="status-icon coral">${icon("streak")}</span><span class="lbl"><b>${S.streak.current}-week review streak</b><span>Best ${S.counts.best_streak} ${S.counts.best_streak === 1 ? "week" : "weeks"}</span></span>${icon("chev", "xs")}</button>` : "";
  // The index (5 Nov, the v2 prototype's): a row to fold it, Home, Skills and Search, then your open subjects in one list,
  // each by the name Home uses, with its deadline word when it is due within two days. Dashboard and the streak live
  // in the app menu (⌘4); Settings sits at the foot (10 Nov, Edison: "there isn't a settings button"), and is ⌘, too; finished subjects come up in Search.
  const nameOf = indexName;
  const when = (x) => { const d = x.days_to_deadline; return d === null || d === undefined || d === "" || +d < 0 || +d > 2 ? "" : `<span class="n${+d === 0 ? " now" : ""}">${dayWord(+d)}</span>`; };
  const subjectRow = (x) => `<button class="nav-row subject ix ${isOn(x) ? "on" : ""}" data-prefetch="${x.slug}" data-act="subject" data-arg="${x.slug}" title="${esc(x.title)}"${tip(esc(nameOf(x)))}><span class="lbl">${esc(nameOf(x))}</span>${when(x)}</button>`;
  const top = el.scrollTop;
  if (!put(el, `<div class="side-top"></div>
    <div class="side-scroll">
      <button class="nav-row fold" data-act="toggle-side" aria-label="${icons ? "Unfold sidebar" : "Fold sidebar"}"${tip(`${icons ? "Unfold" : "Fold"} sidebar  ${key("\\")}`)}>${icon("sidebar")}<span class="lbl">Fold sidebar</span></button>
      ${nav("home", "home", "Home", "1")}${nav("system", "skills", "Skills", "3")}
      <button class="nav-row" data-act="palette"${tip(`Search  ${key("K")}`)}>${icon("search")}<span class="lbl">Search</span><span class="n k">${key("K")}</span></button>
      <h4 class="side-label ix">Learning</h4>
      ${sideOrder(courseGroups(live).flatMap((g) => g.list)).map((x) => (x.q ? qRow(x.q, tip, icons) : subjectRow(x.s))).join("") || `<div class="cap side-empty">Your subjects and questions show up here.</div>`}
    </div>
    <div class="side-end"><button class="nav-row" data-act="settings" aria-label="Settings">${icon("settings")}<span class="lbl">Settings</span></button></div>`)) return;
  el.scrollTop = top;
}

// The two islands over a subject's screens: the switcher and the three tabs,
// then on Session the status line and the Note, Terminal, and plan buttons.
// In the title strip (Home, Skills) the button stands alone, as the Mac's own sidebar buttons do, its label to the right
// so it never covers a page title; in a subject's island it sits beside the Home mark.
// "MATH 241 HW24: polar regions and applications (15.3, 15.4)" → code "HW24", about "Polar regions and applications".
function headName(s) {
  const t = String(s.title || ""), m = t.match(/^([^:—]+?)\s*[:—]\s*(.+)$/);
  const about = m ? m[2].replace(/\s*\([^)]*\)\s*$/, "").trim() : "";
  return { code: nick(s), about: about ? about[0].toUpperCase() + about.slice(1) : "" };
}
const bareButtons = (strip) => `<button class="icon-btn" data-act="hide-side" aria-label="Show sidebar" data-tip="Show sidebar  ${keyShift("\\")}"${strip ? ' data-tip-side="right"' : ""}>${icon("sidebar")}</button>`;
function paintIslands() {
  const el = $("islands"), s = subj(route.slug);
  const show = SUBJECT_ROUTES.includes(route.name) && !!s;
  const bare = sideMode() === "hidden";
  // Every other screen keeps a way back with the mouse: with the sidebar hidden, a small island by the traffic lights
  // holds Show sidebar (styles.css, "only-bare"). It is always in the page so it can fade with the fold.
  el.classList.toggle("only-bare", !show);
  el.classList.remove("hidden");
  if (!show) { el.innerHTML = `<div class="island"><span class="bare-only"${bare ? "" : " inert"}>${bareButtons(true)}</span></div>`; return; }
  // The header (5 Nov, the v2 prototype's line; Edison: "build the v2 line"): the subject's name and what it covers,
  // its deadline, and on Session what is next with the subject's bricks. Plain words on the glass, no islands. The
  // name opens the subject menu, which also holds Session, Skill map and Progress (⌘2, ⌘6, ⌘5).
  const { code, about } = headName(s), d = s.days_to_deadline;
  const due = d !== null && d !== undefined && d !== "" && +d >= 0 && +d < 7 ? `<span class="s-due">Due ${deadlineWord(+d)}</span>` : "";
  const view = route.name === "map" ? "Skill map" : route.name === "progress" ? "Progress" : "";
  const left = `<div class="island s-head-l"><span class="bare-only"${bare ? "" : " inert"}>${bareButtons()}</span>
    <button class="s-title" id="switcher" data-act="switcher" aria-haspopup="menu" aria-expanded="false" title="${esc(s.title)}"><b>${esc(code)}</b>${about ? `<span class="sep">·</span><span class="mu">${esc(about)}</span>` : ""}${view ? `<span class="sep">·</span><span class="mu">${view}</span>` : ""}${icon("down", "dn")}</button>
    ${due}<span class="warm-label" id="warmLabel"></span></div>`;
  const up = s.nodes.find((n) => n.id === s.up_next), done = s.nodes.filter((n) => ["solid", "checked", "decayed"].includes(n.status)).length;
  const brick = (n) => `<i class="${n.status === "decayed" ? "due" : n.status === "solid" || n.status === "checked" ? "pass" : up && n.id === up.id ? "now" : "not"}" title="${esc(nodeName(n.name))}"></i>`;
  const right = route.name === "session" ? `<div class="island s-head-r">${up ? `<span class="s-now">Now <b>${esc(nodeName(up.name))}</b></span>` : ""}<span class="s-count">${s.total ? s.proven : done} of ${s.total || s.nodes.length}</span><span class="s-bond" aria-hidden="true">${s.nodes.map(brick).join("")}</span>
    <span class="status-line" id="statusLine"></span>
    <button class="icon-btn ${LOG.tab === "note" ? "on" : ""}" data-act="toggle-note" aria-label="Session note" aria-pressed="${LOG.tab === "note"}" data-tip="${LOG.tab === "note" ? "Back to the thread" : "Session note"}  ${keyAlt("2")}" data-tip-side="left-down">${icon("note")}</button>
    <button class="icon-btn ${T.drawer ? "on" : ""}" data-act="toggle-term" aria-label="Terminal" aria-pressed="${T.drawer}" data-tip="Terminal  Ctrl+\`" data-tip-side="left-down">${icon("terminal")}</button>
    <button class="icon-btn flip ${cfg.panel ? "on" : ""}" data-act="toggle-panel" aria-label="${cfg.panel ? "Hide" : "Show"} plan" aria-pressed="${cfg.panel}" data-tip="${cfg.panel ? "Hide" : "Show"} plan  ${keyAlt("0")}" data-tip-side="left-down">${icon("sidebar")}</button></div>` : "";
  el.innerHTML = left + right;
  slideTab();
  paintStatus();
  paintWarm();
}
// While you warm up, the header is honest about it: "Warm-up HW23" (spec, 1 Nov).
// No skill of this subject is named or lit until the last warm-up's key comes back.
function paintWarm() {
  const el = $("warmLabel");
  if (!el) return;
  const w = route.name === "session" && LOG.slug === route.slug && LOG.tab === "log" ? LOG.warm : null;
  const html = w ? `Warm-up${w.from ? ` <b>${esc(w.from)}</b>` : ""}` : "";
  if (el.innerHTML !== html) el.innerHTML = html;
  el.classList.toggle("on", !!w);
}
// The selected tab's pill slides from the last tab to the new one.
let lastTab = null;
function slideTab() {
  const tabs = document.querySelector("#islands .tabs"), on = tabs && tabs.querySelector("button.on");
  if (!on) return;
  const ind = document.createElement("i");
  ind.className = "ind";
  tabs.prepend(ind);
  const to = { x: on.offsetLeft, w: on.offsetWidth }, from = lastTab || to;
  ind.style.transition = "none";
  ind.style.transform = `translateX(${from.x}px)`; ind.style.width = `${from.w}px`;
  ind.getBoundingClientRect();
  ind.style.transition = "";
  ind.style.transform = `translateX(${to.x}px)`; ind.style.width = `${to.w}px`;
  lastTab = to;
}
function busy() { return T.running && Date.now() - T.lastData < 1200; }
// The vault's hook ends the log with a Drawing line while the demo-builder draws a picture (one to three minutes),
// so the wait says what it is for (Edison, 10 Nov: "you have to tell the user what they are waiting for").
function drawing() {
  const convos = (LOG.data && LOG.data.conversations) || [], items = convos.length ? convos[convos.length - 1].items : [];
  return T.running && !!items.length && items[items.length - 1].kind === "drawing";
}
function paintStatus() {
  const el = $("statusLine");
  if (!el) return;
  const s = subj(route.slug);
  el.innerHTML = busy() && drawing() ? `<i class="spin"></i>Drawing the picture…`
    : busy() ? `<i class="spin"></i>The tutor is writing…`
    : T.running && lastSaved ? `${icon("check")}Saved to record · ${hhmm(lastSaved)}`
    : T.running ? `${esc(tutorName())} is running`
    : T.starting ? `<i class="spin"></i>Starting…`
    : T.ended ? "The tutor stopped"
    : "";   // idle, the header's "Now" line says where you are
  paintSend();
  updatePill();   // writing turns to "New reply below" when the reply ends
}

// ---------- running things ----------
// Every command goes to the tutor's terminal, exactly as the learner would type it.
function command(cmd) { return sigil() + cmd; }
function run(found) {
  if (!found || !found.command) return toast("Nothing to run right now.");
  if (/^learn-start\s*$/.test(found.command)) return askStart();   // a start with no topic asks for one first
  const slug = found.subject || (found.command.match(/^learn-\w+ ([a-z0-9-]+)/) || [])[1] || route.slug;
  runTyped(found.typed || command(found.command), slug);
}
function runTyped(text, slug) {
  if (slug && subj(slug)) { route.slug = slug; noteActive(slug); }
  go("session", route.slug);
  sendCommand(text);
}
ACTIONS.go = (r) => go(r);
ACTIONS["go-subject"] = (r) => go(r, route.slug);
ACTIONS.subject = (slug) => { closeOverlay(); go(SUBJECT_ROUTES.includes(route.name) ? route.name : "session", slug); };
ACTIONS["toggle-done"] = () => { doneOpen = !doneOpen; paintSide(); };
ACTIONS.review = () => run(S.ranked.find((x) => x.kind === "Review") || { command: "learn-review" });
ACTIONS.repair = () => run(S.ranked.find((x) => x.kind === "Repair"));
// Start a subject (9 Nov): a card asks what to learn, and the tutor sets the subject up out of sight, as a question
// that becomes a lesson does; the terminal no longer opens for it. Once the subject's folder exists, Home moves to it.
ACTIONS.start = () => askStart();
let startCard = null;
function askStart() {
  closeOverlay();
  const scrim = $("scrim");
  scrim.innerHTML = `<div class="card float quit-card start-card" role="dialog" aria-labelledby="startQ"><div class="qc-h" id="startQ">What do you want to learn?</div>
    <p class="qc-p">A topic, and what it's for if there's something: a class, an exam, a project. The tutor asks a few questions to find where you start, then builds a plan.</p>
    <input class="field start-in" id="startIn" placeholder="${START_EXAMPLE}" aria-label="What you want to learn" autocomplete="off">
    <div class="qc-b"><button class="btn text" data-act="start-answer" data-arg="">Cancel</button><button class="btn" data-act="start-answer" data-arg="go" disabled>Start</button></div></div>`;
  scrim.classList.add("on", "veil");
  const card = scrim.querySelector(".start-card"), p = $("panel").getBoundingClientRect(), input = $("startIn"), go = card.querySelector('[data-arg="go"]');
  card.style.translate = `${Math.round(p.left + p.width / 2 - innerWidth / 2)}px 0`;
  startCard = card;
  input.addEventListener("input", () => { go.disabled = !input.value.trim(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !composing(e) && input.value.trim()) { e.preventDefault(); ACTIONS["start-answer"]("go"); } else if (e.key === "Escape") { e.preventDefault(); ACTIONS["start-answer"](""); } });
  scrim.style.opacity = "0"; card.style.opacity = "0";
  tweenAlways("snappy", (v) => { scrim.style.opacity = v >= 1 ? "" : String(v); card.style.opacity = v >= 1 ? "" : String(v); });
  input.focus({ preventScroll: true });
}
ACTIONS["start-answer"] = (arg) => {
  const card = startCard; startCard = null;
  if (!card || !card.isConnected) return;
  const topic = arg ? (card.querySelector(".start-in").value || "").trim() : "";
  const done = () => { const scrim = $("scrim"); scrim.style.opacity = ""; scrim.classList.remove("veil"); closeOverlay(); };
  if (!topic) { tweenAlways("snappy", (v) => { if (card.isConnected) { card.style.opacity = String(1 - v); $("scrim").style.opacity = String(1 - v); } }).then(() => { if (card.isConnected) done(); }); return; }
  done();
  startTopic(topic);
};
// The example in every "what do you want to learn" field: a topic and what it's for, that means something at any school.
const START_EXAMPLE = "How vaccines work, for Friday's bio exam";
function startTopic(topic) {
  const slug = startSlug(topic);
  Q.pending = { id: null, home: true, slug, topic, at: Date.now(), known: new Set(S.subjects.map((x) => x.slug)) };
  sendCommand(`${command(`learn-start ${slug}`)} ${topic}`);
  toast("Setting up your new subject. It opens here when it's ready.");
}
// A subject's name from what you typed: its course code first (the vault names subjects that way), then up to three
// words that carry the topic, never one that exists.
const START_FILLER = new Set("i im i'm want wanna to learn learning about how the a an for my me on in of and with some more understand study get better at is are what do does really please".split(" "));
function startSlug(text) {
  text = text.replace(/['’]s\b/g, "");   // "CS 124's quiz" is about the quiz, not an s
  const code = text.match(/\b([A-Za-z]{2,5})\s?(\d{2,3})\b/);
  const rest = (code ? text.replace(code[0], " ") : text).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w && !START_FILLER.has(w));
  let slug = `${code ? code[1].toLowerCase() + code[2] : "personal"}-${rest.slice(0, 3).join("-") || "topic"}`.replace(/-+/g, "-").slice(0, 60).replace(/-$/, "");
  for (let n = 2, base = slug; subj(slug); n++) slug = `${base}-${n}`;
  return slug;
}
ACTIONS.run = (i) => run(S.ranked[+i]);
ACTIONS.resume = (slug) => run(S.ranked.find((x) => x.subject === slug && x.kind !== "Repair") || { command: `learn-resume ${slug}`, subject: slug });
ACTIONS.practice = (slug) => run({ command: `learn-practice ${slug}`, subject: slug });
// The fold is one motion (styles.css, "The fold is one motion"; timings in tokens.css). Closing (to the icon rail or
// to hidden), the columns head for their new size at once and the labels fade while they move; the folded layout takes
// over only once the width has arrived, so nothing snaps. Opening, the full layout comes in at once with its labels
// hidden, and they fade in once there is room. A second click mid-fold turns it around from where it is.
let closeTimer = 0, settleTimer = 0, foldTo = null, foldLand = null, foldAbort = null;   // closeTimer: the fallback for when a close lands; settleTimer: when a fold's classes go
const curSide = () => foldTo || sideMode();
const foldMs = (name) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return (parseFloat(v) || 0) * (/[^m]s$/.test(v) ? 1000 : 1); };
const FOLD_CLASSES = ["folding", "opening", "turning", "to-icons", "to-bare", "fold-open", "fold-close"];
ACTIONS["hide-side"] = () => setSide(curSide() === "hidden" ? "full" : "hidden");
ACTIONS["toggle-side"] = () => setSide(curSide() === "full" ? "icons" : "full");
function setSide(next) {
  const w = $("win"), from = sideMode();
  perfWatch(`sidebar ${next} on ${route.name}`, 500);
  const apply = () => { setCfg({ sidebarMode: next }); paintShell(); paintSide(); paintIslands(); fitSoon(); };
  const settle = (ms) => { clearTimeout(settleTimer); settleTimer = setTimeout(() => w.classList.remove(...FOLD_CLASSES), ms); };
  const pending = foldTo; clearTimeout(closeTimer); clearTimeout(settleTimer); foldTo = null; foldLand = null;
  if (foldAbort) { foldAbort.abort(); foldAbort = null; }
  w.classList.remove(...FOLD_CLASSES);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
  if (pending && next === from) {   // turned around before a close landed: nothing was repainted, so just open back up
    w.classList.add("fold-open", "opening", "turning"); return settle(foldMs("--duration-fold-open"));
  }
  const rank = { hidden: 0, icons: 1, full: 2 };
  if (rank[next] < rank[from]) {
    foldTo = next;
    w.classList.add("fold-close", "folding", next === "icons" ? "to-icons" : "to-bare");
    // It lands when the columns arrive; the timer is the fallback if that event never comes (a cancelled transition).
    const land = () => { if (foldLand !== land) return; foldLand = foldTo = null; clearTimeout(closeTimer); foldAbort.abort(); foldAbort = null; apply(); w.classList.remove(...FOLD_CLASSES); };
    foldLand = land; foldAbort = new AbortController();
    w.addEventListener("transitionend", (e) => { if (e.target === w && e.propertyName === "grid-template-columns") land(); }, { signal: foldAbort.signal });
    closeTimer = setTimeout(land, foldMs("--duration-fold-close") + 120);
  } else if (rank[next] > rank[from]) {
    w.classList.add("fold-open", "folding"); apply();
    const l = $("side").querySelector(".lbl"); if (l) getComputedStyle(l).opacity;   // the labels start hidden
    w.classList.remove("folding"); if (next === "full") w.classList.add("opening");
    settle(foldMs("--duration-fold-open"));
  } else apply();
}
// The plan panel opens on a slower, settling curve than the 200 ms the sidebar uses (7 Nov, Edison: "moves kind of fast").
let planMove = 0;
ACTIONS["toggle-panel"] = () => {
  const w = $("win"); w.classList.add("plan-move"); clearTimeout(planMove);
  planMove = setTimeout(() => w.classList.remove("plan-move"), 380);
  setCfg({ panel: !cfg.panel }); paintShell(); paintIslands(); fitSoon();
};
let inkAction = null;
ACTIONS.ink = () => inkAction && inkAction();

async function setCfg(patch) { cfg = { ...cfg, ...patch }; cfg = await F.setConfig(patch); }

// The subject switcher in the left island: the same menu as the sidebar's list.
ACTIONS.switcher = (_a, el) => {
  // The subject menu (5 Nov): this subject's three views, then the five subjects you opened last, by the names the
  // sidebar uses. The full list is the sidebar's job, and ⌘K finds any subject.
  const r = el.getBoundingClientRect(), cur = subj(route.slug);
  const recent = recentSubjects(5, route.slug);
  const scrim = $("scrim");
  scrim.classList.add("on", "clear");
  const views = cur && SUBJECT_ROUTES.includes(route.name) ? [["session", "Session", "2", "session"], ["map", "Skill map", "6", "skills"], ["progress", "Progress", "5", "checkme"]]
    .map(([v, l, k, ic]) => `<button class="menu-item ${route.name === v ? "hl" : ""}" role="menuitem" data-act="view" data-arg="${v}">${icon(ic)}<span class="lbl">${l}</span><kbd>${route.name === v ? icon("check", "xs") : key(k)}</kbd></button>`).join("") : "";
  scrim.innerHTML = `<div class="menu" role="menu" style="left:${r.left}px;top:${r.bottom + 6}px">
    ${views}
    ${recent.length ? `<div class="sep"></div><div class="f">Recent</div>${recent.map((s) => `<button class="menu-item subj" role="menuitem" data-act="subject" data-arg="${s.slug}" title="${esc(s.title)}" style="${subjVar(s)}">${icon(themeOf(s))}<span class="lbl">${esc(indexName(s))}</span><kbd>${esc(rightTag(s))}</kbd></button>`).join("")}` : ""}
    ${menuClose(cur)}
    <div class="sep"></div><button class="menu-item" role="menuitem" data-act="go-home">${icon("home")}<span class="lbl">Home</span><kbd>${key("1")}</kbd></button>
    <button class="menu-item" role="menuitem" data-act="palette">${icon("search")}<span class="lbl">Find a subject</span><kbd>${key("K")}</kbd></button></div>`;
  el.setAttribute("aria-expanded", "true");
  const first = scrim.querySelector(".menu-item.hl") || scrim.querySelector(".menu-item");
  if (first) first.focus();
};
// Close out in the subject menu (7 Nov, Edison picked it out of the composer). It asks in a card over the session
// (7 Nov: a "Click again" row that stayed armed after the menu closed read as broken).
function menuClose(s) {
  if (!s || !canClose(s) || T.running || T.starting || !SUBJECT_ROUTES.includes(route.name)) return "";
  const state = closing === s.slug ? "run" : closeQueue.includes(s.slug) ? "wait" : "";
  const label = state === "run" ? "Closing out…" : state === "wait" ? "Queued" : "Close out…";
  return `<div class="sep"></div><button class="menu-item" role="menuitem" data-act="close-menu" data-arg="${s.slug}" ${state ? "disabled" : ""}>${icon(state === "wait" ? "pause" : "check")}<span class="lbl">${label}</span></button>`;
}
ACTIONS["close-menu"] = (slug) => { closeOverlay(); ACTIONS["close-open"](slug); };
// The confirm card sits in the middle of the session's panel, not the window, and fades (a click has no direction).
let closeCard = null;
function askClose(slug) {
  const s = subj(slug), scrim = $("scrim");
  scrim.innerHTML = `<div class="card float quit-card close-card" role="alertdialog" aria-labelledby="closeQ" aria-describedby="closeP"><div class="qc-h" id="closeQ">Close out ${esc(shortTitle(s))}?</div>
    <p class="qc-p" id="closeP">Any session left open gets saved, and the subject moves to Done. Its skills still come up in reviews.</p>
    <div class="qc-b"><button class="btn text" data-act="close-answer" data-arg="">Cancel</button><button class="btn" data-act="close-answer" data-arg="${slug}">Close out</button></div></div>`;
  scrim.classList.add("on", "veil");
  const card = scrim.querySelector(".close-card"), p = $("panel").getBoundingClientRect();
  card.style.translate = `${Math.round(p.left + p.width / 2 - innerWidth / 2)}px 0`;
  closeCard = card;
  scrim.style.opacity = "0"; card.style.opacity = "0";
  tweenAlways("snappy", (v) => { scrim.style.opacity = v >= 1 ? "" : String(v); card.style.opacity = v >= 1 ? "" : String(v); });
  card.querySelector('[data-act="close-answer"][data-arg]:not([data-arg=""])').focus({ preventScroll: true });
}
ACTIONS["close-answer"] = (slug) => {
  const card = closeCard; closeCard = null;
  if (!card || !card.isConnected) return;
  const done = () => { const scrim = $("scrim"); scrim.style.opacity = ""; scrim.classList.remove("veil"); closeOverlay(); };
  if (!slug) { tweenAlways("snappy", (v) => { if (card.isConnected) { card.style.opacity = String(1 - v); $("scrim").style.opacity = String(1 - v); } }).then(() => { if (card.isConnected) done(); }); return; }
  done();
  const s = subj(slug);
  closeQueue.push(slug);
  if (closing) { repaintClose(); toast("Queued. It closes out once the one running now finishes."); }
  else { nextClose(); toast(`Closing out ${s ? nick(s) : "the subject"}. It takes about a minute.`); }
};
ACTIONS["go-home"] = () => { closeOverlay(); go("home"); };
ACTIONS.view = (r) => { closeOverlay(); go(r, route.slug); };

// ---------- Home ----------
function checksLastWeek() {
  const from = ymd(dayDate(-6));
  return Object.entries(S.heat || {}).reduce((n, [d, c]) => n + (d >= from && d <= S.today ? c : 0), 0);
}
function deadlinesThisWeek() {
  return S.subjects.filter((x) => x.status !== "done" && x.days_to_deadline !== null && x.days_to_deadline >= 0 && x.days_to_deadline < 7)
    .sort((a, b) => a.days_to_deadline - b.days_to_deadline);
}
function discClass(n, s) {
  if (n.status === "solid") return "solid";
  if (n.status === "checked" || n.status === "decayed") return "checked";
  if (n.status === "introduced") return "learn";
  if (n.status === "planned" && n.id === s.up_next) return "up";
  return "not";
}
function discEl(n, s, size = "") {
  const c = discClass(n, s);
  const ic = c === "solid" || c === "checked" ? icon("check") : "";
  const rf = n.status === "decayed" ? `<i class="rf">${icon("review")}</i>` : "";
  return `<i class="disc ${c} ${size}" title="${esc(nodeName(n.name))}: ${STATUS_WORD[n.status] || ""}">${size ? ic : ""}${rf}</i>`;
}
const STATUS_WORD = { solid: "Solid", checked: "Checked", decayed: "Worth a refresh", introduced: "Learning", planned: "Not yet" };
// Session notes left open: cut off, or paused and never resumed. A live break
// (paused under 6 hours ago) is not listed, since resuming picks it back up.
function leftOpen() {
  return (S.open_notes || []).map((line) => line.match(/^(\S+) (\S+): (.*)$/)).filter((m) => m && !/a live break/.test(m[3]))
    .map((m) => ({ slug: m[1], note: m[2], s: subj(m[1]) })).filter((x) => x.s);
}
// Settling a left-open note happens on that subject's Session, beside Resume,
// so the learner closes only the sessions they have stopped working on.
// Close out means the learner is finished with a subject: /learn-close settles
// any session it left open and moves it to Done. Every subject not yet done
// has the button. It asks first in a card, since it changes the record. Close-outs run one at a time (each is a background
// tutor run of about a minute), so a click while another runs waits in line.
let closing = null;
const closeQueue = [];
const isLeftOpen = (slug) => leftOpen().some((x) => x.slug === slug);
const closePending = (slug) => closing === slug || closeQueue.includes(slug);
const canClose = (s) => !!s && (s.status !== "done" || closePending(s.slug));
function repaintClose() {
  if (route.name === "session") { paintActs(); if (LOG.data) paintThread(false); }
  const row = document.querySelector('#scrim [data-act="close-menu"]');
  if (row) { const focused = document.activeElement === row, s = subj(row.dataset.arg), box = document.createElement("div");
    box.innerHTML = menuClose(s); row.previousElementSibling.remove(); row.replaceWith(...box.childNodes);
    if (focused) { const n = document.querySelector('#scrim [data-act="close-menu"]'); if (n) n.focus({ preventScroll: true }); } }
}
ACTIONS["close-open"] = (slug) => {
  const s = subj(slug);
  if (!s || closePending(slug) || s.status === "done") return;
  askClose(slug);
};
async function nextClose() {
  closing = closeQueue.shift() || null;
  repaintClose();
  if (!closing) return;
  const slug = closing, s = subj(slug);
  const result = await F.closeOut(slug);
  closing = null;
  toast(result.ok ? `Closed out ${s ? nick(s) : "the subject"}. It's in Done now, and its skills still come up for review.` : `Couldn't close out ${s ? nick(s) : "the session"}: ${result.text.split("\n").pop().slice(0, 160)}`);
  nextClose();
}
function paintHome() {
  // Home (5 Nov, the locked front page of the v2 prototype): a headline, one line of what and why, one button for the
  // tutor's top pick, the field centred on the window every day, and under it rows only when they earn their place:
  // Due (a deadline within two days), Waiting (a subject with no deadline left two weeks or more), Ended (past its date,
  // not closed out). No tiles, feeds or streaks: Home answers "what should I do now".
  const top = S.ranked[0], s = top && top.subject ? subj(top.subject) : null;
  // With nothing to continue, Home has one thing to do, so it has one field (11 Nov, Edison asked how Start something
  // new differed from Ask your tutor anything; on this Home they both began a conversation). The field starts a subject,
  // the button goes, and the headline asks the question when there are no subjects yet.
  const starting = top.kind === "Start";
  inkAction = starting ? () => $("ask") && $("ask").focus() : () => run(top);
  let { line } = plain(top);
  if (starting) line = "Your tutor asks a few questions, then builds a plan.";   // 11 Nov, Edison: the longer line was "a bit long to read"
  const has = (x) => x.days_to_deadline !== null && x.days_to_deadline !== undefined && x.days_to_deadline !== "";
  const soon = S.subjects.filter((x) => x.status !== "done" && has(x) && +x.days_to_deadline >= 0 && +x.days_to_deadline <= 2).sort((p, q) => p.days_to_deadline - q.days_to_deadline);
  const topic = (x) => { const m = afterCode(x).match(/(?: [—–-] |: )(.+)$/); return m ? m[1].replace(/\s*\([^)]*\)\s*$/, "") : ""; };
  const when = (d) => lateWords(d === 0 ? "today" : d === 1 ? "tomorrow" : DAYS_LONG[dayDate(d).getDay()]);
  const head = s && has(s) && +s.days_to_deadline >= 0 && +s.days_to_deadline <= 6 ? `${nick(s)} is due ${when(+s.days_to_deadline)}.`
    : soon.length ? `${greeting()}.` : starting && !S.subjects.length ? `What do you want to learn${firstName() ? `, ${firstName()}` : ""}?` : `Your day is clear${firstName() ? `, ${firstName()}` : ""}.`;
  const label = top.kind === "Start" ? "Start something new" : top.kind === "Review" && !s ? "Review across subjects" : `${top.kind === "Repair" ? "Repair" : top.kind === "Review" ? "Review" : "Continue"} ${s ? nick(s) : ""}`.trim();
  // a name that says which subject: "CS 100 Quiz" alone does not, so a bare quiz takes its topic's first words
  const homeName = indexName;
  const rows = [];
  soon.filter((x) => x !== s).forEach((x, i) => rows.push({ key: `due-${x.slug}`, lab: i ? "" : "Due", name: homeName(x), what: topic(x), cap: dayWord(+x.days_to_deadline), now: +x.days_to_deadline === 0, slug: x.slug, g: !i }));
  const since = (x) => (x.last_session ? Math.round((dayDate(0) - new Date(x.last_session + "T12:00:00")) / 864e5) : null);
  const waiting = S.subjects.filter((x) => x.status === "active" && !has(x) && x !== s && since(x) >= 14).sort((p, q) => since(q) - since(p))[0];
  if (waiting) {
    const w = Math.round(since(waiting) / 7), NUM = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"], nn = (waiting.nodes || []).find((n) => n.id === waiting.up_next), nx = nn ? ` ${cap(nn.name)} is next.` : "";   // up_next is a skill's id
    rows.push({ key: `wait-${waiting.slug}`, lab: "Waiting", name: homeName(waiting), what: `${NUM[w] || w} weeks since your last session.${nx}`, cap: "", slug: waiting.slug, g: true });
  }
  const ended = endedSubjects();
  if (ended.length) rows.push({ key: "ended", lab: "Ended", name: `${ended.length} ${ended.length === 1 ? "subject" : "subjects"}`, what: listOf(ended.map(homeName)), ended: true, g: true });
  const rowHtml = (r) => r.ended
    ? `<div class="h-row g" data-line="row-${r.key}"><span class="h-l">${r.lab}</span><span class="h-n">${esc(r.name)}</span><span class="h-d">${esc(r.what)}</span><span class="h-c"><button class="pill" data-act="close-ended">Close out</button></span></div>`
    : `<button class="h-row${r.g ? " g" : ""}" data-line="row-${r.key}" data-act="subject" data-arg="${r.slug}" data-prefetch="${r.slug}"><span class="h-l">${r.lab}</span><span class="h-n">${esc(r.name)}</span><span class="h-d">${esc(r.what)}</span><span class="h-c${r.now ? " now" : ""}">${esc(r.cap)}</span></button>`;
  const changed = put($("screen"), `<div class="home2"><div class="h-col">
    <h1 class="h-head" data-line="greeting">${esc(head)}</h1>
    <div class="h-sub" data-line="action-line">${md(line)}</div>
    ${starting ? "" : `<div class="h-go"><button class="btn" id="homeGo" data-line="go" data-surface data-act="ink" data-prefetch="${s ? s.slug : ""}">${esc(label)}</button><button class="h-new" data-act="start">Start a subject</button></div>`}
    <div class="composer h-field${starting ? " h-start" : ""}" data-line="field" data-surface><div class="h-att" id="homeAtt"></div><input id="ask" placeholder="Ask your tutor anything" aria-label="${starting ? "What you want to learn" : "Ask your tutor"}" autocomplete="off"><button class="send" data-act="ask" id="askSend" aria-label="Send" disabled>${icon("send", "sm")}</button></div>
    ${rows.length ? `<div class="h-also">${rows.map(rowHtml).join("")}</div>` : ""}
  </div></div>`);
  centerHome();
  if (!changed) { if (homeArrive) settleHome(); return; }
  const ask = $("ask");
  // Home's field keeps half-typed words across quits, as subjects do (rule 5).
  ask.value = localStorage.getItem("flash-home-draft") || "";
  const typed = () => {
    $("askSend").disabled = !ask.value.trim() && !HOME_ATT.length;
    foldReturn(!ask.value.trim() && !HOME_ATT.length);
    if (ask.value.trim()) localStorage.setItem("flash-home-draft", ask.value); else localStorage.removeItem("flash-home-draft");
  };
  ask.addEventListener("input", typed);
  // A screenshot pasted here waits in the field, as words do (Edison, 7 Nov: jumping to a chat before sending felt
  // wrong, and laggy). Sending takes both to a new question.
  ask.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.items : [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    files.forEach(homeAddImage);
  });
  const field = ask.closest(".h-field");
  field.addEventListener("dragover", (e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) e.preventDefault(); });
  field.addEventListener("drop", (e) => { const f = [...e.dataTransfer.files].filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); f.forEach(homeAddImage); } });
  paintHomeAtt();
  $("askSend").disabled = !ask.value.trim();
  foldReturn(!ask.value.trim(), true);
  // Return in the empty field means Continue: the button's ↩ says so.
  ask.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || composing(e)) return;
    e.preventDefault();
    if (ask.value.trim() || HOME_ATT.length) ACTIONS.ask(); else ACTIONS.ink();
  });
  settleHome();
}
// Continue's quiet ↩ folds away the moment you type, since Return would then send
// your words, and comes back when the field is empty (snappy spring, from its right edge).
const RET_ICON = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 2v3.4a1.5 1.5 0 0 1-1.5 1.5H2.2"/><path d="M4.3 4.8 2.2 6.9 4.3 9"/></svg>`;
// The field's middle sits on the window's middle every day, whatever is above or below it (spec, 29 Oct).
function centerHome() {
  const el = $("screen"), col = el.querySelector(".home2 .h-col"), box = col && col.querySelector(".h-field");
  if (!box) return;
  col.style.marginTop = "0px";
  const off = box.getBoundingClientRect().top - col.getBoundingClientRect().top;
  col.style.marginTop = `${Math.max(32, Math.round(el.clientHeight / 2 - box.offsetHeight / 2 - off))}px`;
}
addEventListener("resize", () => { if (route.name === "home") centerHome(); });
const endedSubjects = () => S.subjects.filter((x) => x.status !== "done" && x.days_to_deadline !== null && x.days_to_deadline !== undefined && x.days_to_deadline !== "" && +x.days_to_deadline < 0);
const listOf = (names) => (names.length <= 1 ? names.join("") : names.length <= 3 ? `${names.slice(0, -1).join(", ")}${names.length > 2 ? "," : ""} and ${names.at(-1)}` : `${names[0]} and ${names.length - 1} more`);   // one name, so the row never cuts off
// Close out on Home's Ended row: the first press asks, the second closes every ended subject, one after another.
let endedArmed = 0;
ACTIONS["close-ended"] = (_a, el) => {
  const ended = endedSubjects().filter((x) => !closePending(x.slug));
  if (!ended.length) return;
  if (!endedArmed) { endedArmed = setTimeout(() => { endedArmed = 0; if (el.isConnected) el.textContent = "Close out"; }, 4000); el.textContent = `Close out ${ended.length}?`; return; }
  clearTimeout(endedArmed); endedArmed = 0; el.textContent = "Closing…"; el.disabled = true;
  closeQueue.push(...ended.map((x) => x.slug)); toast(`Closing out ${ended.length} ${ended.length === 1 ? "subject" : "subjects"}, one at a time.`);
  if (!closing) nextClose();
};
const RK_W = 20;   // the hint's room: its gap and the 11px glyph
let rkSpring = null, rkAt = 1;
function foldReturn(show, now) {
  const rk = document.querySelector("#homeGo .rk");
  if (!rk) return;
  const draw = (v) => { rkAt = v; rk.style.width = `${(RK_W * Math.max(0, v)).toFixed(2)}px`; rk.style.opacity = (Math.max(0, v) ** 2).toFixed(3); };
  if (now || calm()) { if (rkSpring) rkSpring.stop(); rkSpring = null; return draw(show ? 1 : 0); }
  if (rkSpring) { rkSpring.to(show ? 1 : 0); return; }
  const me = (rkSpring = window.motion.spring(rkAt, { to: show ? 1 : 0, feel: "snappy", onUpdate: draw }));
  me.done.then(() => { if (rkSpring === me) rkSpring = null; });
}

// ---------- Home: motion marks a change ----------
// Home settles in only the lines that changed since you last saw them. A line is
// compared as words, so "Tomorrow" turning "Today" settles once. What you saw is
// kept in Flash's own data folder, never the vault (spec, Home on launch).
let SEEN_HOME = null;   // loaded at boot
const homeLines = () => [...document.querySelectorAll("#screen [data-line]")];
const lineWords = (el) => (el.dataset.words != null ? el.dataset.words : el.textContent).replace(/\s+/g, " ").trim();
// Home settles every time it opens (Edison, 5 Nov: "the home page words should settle every time", replacing the
// 1 Nov rule that only changed lines move): the full settle at launch, a quicker one coming back from another page.
let homeArrive = false;
function settleHome() {
  if (!SEEN_HOME) return;
  const quick = homeArrive; homeArrive = false;
  const changed = homeLines();
  if (!changed.length) return;
  // Top to bottom as you see it, not page order: Home's two columns sit side by side.
  const at = new Map(changed.map((el) => { const r = el.getBoundingClientRect(); return [el, r.top + r.left / 1e4]; }));
  changed.sort((a, b) => at.get(a) - at.get(b));
  const parts = (el) => (el.hasAttribute("data-kids") ? [...el.children] : [el]);
  changed.forEach((el) => parts(el).forEach((p) => { p.style.opacity = "0"; }));
  // At launch the window is still hidden: the words settle once it is in front.
  // Lines on one row start together, rows 0.05 s apart, and the whole page is in
  // within about half a second however many rows Home has (spec: done in about 0.5 s).
  const rows = [];
  changed.forEach((el) => { const top = el.getBoundingClientRect().top, row = rows.find((r) => Math.abs(r.top - top) < 6); if (row) row.els.push(el); else rows.push({ top, els: [el] }); });
  const gap = rows.length > 1 ? Math.min(quick ? 0.03 : 0.05, (quick ? 0.2 : 0.45) / (rows.length - 1)) : 0;
  // Started all at once with delays, so the browser runs them: they keep going while the main thread is busy at launch.
  const go = () => rows.forEach((r, i) => r.els.forEach((el) => parts(el).forEach((p) => settleIn(p, el.hasAttribute("data-surface"), (0.04 + i * gap) * 1000, quick ? 300 : 480))));
  if (windowShown && document.visibilityState === "visible") go();
  else whenShown(go);
}
// Words come into focus, blur and rise sized to the text (0.1 em, 0.25 em); a
// surface only fades up 4px. Reduce motion: a plain fade.
// (5 Nov: this ran from JavaScript each frame and stalled in steps whenever launch kept the main thread busy, measured
// on a screen recording. Now it is a Web Animation on opacity and translate only, which the compositor runs; the blur
// is gone, since a blur repaints the text every frame.)
function settleIn(el, surface, delay = 0, duration = 480) {
  el.style.opacity = "";
  if (calm()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay, easing: "ease", fill: "backwards" }); return; }
  const em = parseFloat(getComputedStyle(el).fontSize) || 14;
  el.animate([{ opacity: 0, translate: `0 ${(surface ? 4 : 0.25 * em).toFixed(2)}px` }, { opacity: 1, translate: "0 0" }],
    { duration, delay, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "backwards" });
}
// Run fn after `sec` on the motion clock, so a recording steps it frame for frame.
function onClock(sec, fn) {
  const { clock } = window.motion, t0 = clock.now();
  if (sec <= 0) return fn();
  const off = clock.on(() => { if (clock.now() - t0 >= sec - 1e-9) { off(); fn(); } });
}
// A plain timed fade on the motion clock; Reduce motion's stand-in for motion (spec: plain 0.2 s fades).
function fadeFor(sec, fn) {
  const { clock } = window.motion, t0 = clock.now();
  fn(0);
  const off = clock.on(() => { const a = Math.min(1, (clock.now() - t0) / sec); fn(a); if (a >= 1) off(); });
}
// A spring that runs even with Reduce motion on, for the fades that stand in for motion there.
function tweenAlways(feel, fn) { fn(0); return window.motion.spring(0, { to: 1, feel, onUpdate: fn }).done; }
// At launch the window is still hidden (main shows it once Home is drawn), and a
// hidden new window can report itself visible, so the settle waits for main's word.
let windowShown = false;
const shownWaiters = [];
F.onShown(() => { windowShown = true; shownWaiters.splice(0).forEach((fn) => fn()); perfWatch("launch, first 2 s", 2000);
  // KaTeX and Mermaid load while the app is idle after launch. Loaded on the first glide into a session instead,
  // Mermaid's start-up held one frame for 87 ms in the middle of it (measured, 5 Nov).
  setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 0)))(() => MD.preload(), { timeout: 4000 }), 1500); });
function whenShown(fn) { if (windowShown) fn(); else shownWaiters.push(fn); }
// Seen means seen: Home's lines count once Home has been in front, window visible
// and focused, for about a second.
let homeFront = 0;
setInterval(() => {
  const front = route.name === "home" && S && windowShown && document.visibilityState === "visible" && document.hasFocus() && !homeStale;
  homeFront = front ? homeFront + 250 : 0;
  if (homeFront < 1000 || !SEEN_HOME) return;
  const now = {};
  homeLines().forEach((el) => { now[el.dataset.line] = lineWords(el); });
  if (JSON.stringify(now) === JSON.stringify(SEEN_HOME)) return;
  SEEN_HOME = now;
  F.seen.set(now);
}, 250);
// Lines that go out of date while Home is in front (the quiz time passes) change
// only when you come back, and settle then (rule 6).
let homeStale = false;
// A subject's name resumes it; anything else starts the tutor with the question.
ACTIONS.ask = () => {
  const text = ($("ask") || {}).value ? $("ask").value.trim() : "";
  if ($("ask") && $("ask").closest(".h-start")) {   // Home's start field (paintHome)
    if (!text) return;
    HOME_ATT.splice(0); paintHomeAtt(); localStorage.removeItem("flash-home-draft");
    return startTopic(text);
  }
  const att = HOME_ATT.splice(0);
  if (!text && !att.length) return;
  const q = text.toLowerCase();
  const hit = !att.length && S.subjects.find((s) => q === shortTitle(s).toLowerCase() || q === s.slug || (q.length > 3 && shortTitle(s).toLowerCase().includes(q)));
  localStorage.removeItem("flash-home-draft");
  if (hit) return ACTIONS.resume(hit.slug);
  askQuestion(null, text, att).then((ok) => { if (!ok) { HOME_ATT.push(...att); paintHomeAtt(); if ($("ask")) $("ask").value = text; localStorage.setItem("flash-home-draft", text); } });
};
// Screenshots waiting in Home's field, as small thumbnails before the words.
const HOME_ATT = [];
function homeAddImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  file.arrayBuffer().then((buf) => { HOME_ATT.push({ url: URL.createObjectURL(file), bytes: new Uint8Array(buf), type: file.type }); paintHomeAtt(); if ($("ask")) $("ask").focus(); });
}
ACTIONS["home-unattach"] = (i) => { HOME_ATT.splice(+i, 1); paintHomeAtt(); if ($("ask")) $("ask").focus(); };
function paintHomeAtt() {
  const el = $("homeAtt"), ask = $("ask"); if (!el || !ask) return;
  el.innerHTML = HOME_ATT.map((a, i) => `<span class="att sm"><img src="${a.url}" alt="Pasted image ${i + 1}" data-view><button data-act="home-unattach" data-arg="${i}" aria-label="Remove image ${i + 1}" data-tip="Remove" data-tip-side="up">${icon("plus")}</button></span>`).join("");
  el.classList.toggle("on", HOME_ATT.length > 0);
  $("askSend").disabled = !ask.value.trim() && !HOME_ATT.length;
  foldReturn(!ask.value.trim() && !HOME_ATT.length);
}

// ---------- Questions ----------
// A question from Home belongs to no subject, so it gets a chat of its own (7 Nov, Edison: "the more normal and
// conventional way", LearnHarness's): sending makes the chat and names it, and each message runs one short Claude Code
// turn that resumes that chat and exits (lib/questions.js). It never goes into the subject tutor in the terminal.
const Q = { list: [], id: null, chat: null, drafts: {}, att: {} };
const qPage = () => route.name === "question";
let QALL = [];   // every question, archived ones too, for Search
async function qRefresh() { [Q.list, QALL] = await Promise.all([F.questions.list(), F.questions.list(true)]); }
const qKey = () => Q.id || "new";
const qShow = () => { if (qPage()) { paintSide(); paintQuestion(true); } else go("question"); };
async function askQuestion(id, text, images = []) {
  const r = await F.questions.ask(id, text, images.map((a) => ({ type: a.type, bytes: a.bytes })));
  if (r.error) { toast(r.error === "busy" ? "The tutor is still answering. Send this once it's done." : r.error); return false; }
  await qRefresh();
  Q.id = r.id; Q.chat = await F.questions.get(r.id);
  qShow();
  return true;
}
ACTIONS.question = async (id) => { closeOverlay(); const was = QALL.find((x) => x.id === id); if (was && was.archived && !was.lesson) F.questions.archive(id, false); Q.id = id; Q.chat = await F.questions.get(id); qShow(); };
ACTIONS["question-send"] = () => {
  const box = $("qMsg"); if (!box || !Q.chat) return;
  const k = qKey(), text = box.value.trim(), att = Q.att[k] || [];
  if (!text && !att.length) return;
  box.value = ""; delete Q.drafts[k]; Q.att[k] = []; paintQAttach();
  askQuestion(Q.id, text, att).then((ok) => { if (!ok) { Q.att[k] = att; if ($("qMsg")) $("qMsg").value = text; paintQAttach(); } });
};
ACTIONS["question-stop"] = () => { if (Q.id) F.questions.stop(Q.id); };
// The hover button on a sidebar row (T3 Code's): archive, and the toast says where it went (Edison, 7 Nov: "where does
// it go"). An archived question waits in Search; opening it there, or writing to it, brings it back.
ACTIONS["question-archive"] = async (id) => {
  await F.questions.archive(id, true);
  if (qPage() && Q.id === id) go("home");
  toast(`Archived. Find it in Search (${key("K")}).`, { label: "Undo", act: "question-unarchive", arg: id });
};
ACTIONS["question-unarchive"] = async (id) => { $("toast").classList.remove("on"); await F.questions.archive(id, false); };
function qAddImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const k = qKey();
  file.arrayBuffer().then((buf) => { (Q.att[k] = Q.att[k] || []).push({ url: URL.createObjectURL(file), bytes: new Uint8Array(buf), type: file.type }); paintQAttach(); if ($("qMsg")) $("qMsg").focus(); });
}
ACTIONS["question-unattach"] = (i) => { (Q.att[qKey()] || []).splice(+i, 1); paintQAttach(); };
function paintQAttach() {
  const el = $("qAttach"); if (!el) return;
  const att = Q.att[qKey()] || [];
  el.innerHTML = att.map((a, i) => `<span class="att"><img src="${a.url}" alt="Pasted image ${i + 1}" data-view><button data-act="question-unattach" data-arg="${i}" aria-label="Remove image ${i + 1}" data-tip="Remove" data-tip-side="up">${icon("plus")}</button></span>`).join("");
  el.classList.toggle("on", att.length > 0);
  qSendState();
}
function qSendState() {
  const b = $("qSend"), box = $("qMsg"); if (!b || !box || !Q.chat || Q.chat.running) return;
  b.disabled = !box.value.trim() && !(Q.att[qKey()] || []).length;
}
// The tutor marks a topic worth a lesson with <lesson>…</lesson> on its last line (main.js, the Questions prompt).
// It marks a question that fits a subject you already have with <subject>slug</subject>.
const LESSON = /\n?\s*<lesson>([^<\n]{1,120})<\/lesson>\s*$/, FITS = /\n?\s*<subject>([a-z0-9-]{1,80})<\/subject>\s*$/;
const qClean = (t) => String(t || "").replace(LESSON, "").replace(FITS, "").replace(/\n?\s*<(lesson|subject)>[^<\n]*$/, "");
const qLast = (c) => [...c.messages].reverse().find((x) => x.role === "tutor" && x.text);
const qOffer = (c) => { if (!c || !c.id || c.lesson || c.moved || c.offer === "no" || c.running) return null; const m = qLast(c); const hit = m && LESSON.exec(m.text); return hit ? hit[1].trim() : null; };
const qFits = (c) => { if (!c || !c.id || c.lesson || c.moved || c.offer === "no" || c.running) return null; const m = qLast(c); const hit = m && FITS.exec(m.text); const s = hit && subj(hit[1]); return s && s.status !== "done" ? s : null; };
const qFitsHtml = (s) => `<div class="q-offer" role="group" aria-label="Continue in a subject">
  <div class="qo-t">Continue in ${esc(shortTitle(s))}?</div>
  <div class="qo-p">This fits a subject you already have, where the tutor knows what you've covered.</div>
  <div class="qo-b"><button class="btn text" data-act="question-offer-no">Keep it here</button><button class="btn" data-act="question-continue" data-arg="${s.slug}">Continue there</button></div>
</div>`;
// Your question moves to the subject's Session as your next message there, and this chat is archived with a note.
ACTIONS["question-continue"] = async (slug) => {
  const id = Q.id, c = Q.chat, s = subj(slug); if (!id || !c || !s) return;
  const mine = c.messages.filter((m) => m.role === "you" && m.text).map((m) => m.text);
  await F.questions.mark(id, { moved: slug });
  go("session", slug);
  // As the composer sends it: a stopped tutor resumes the subject first and then reads it.
  const text = `I asked this on Home first: ${mine.join("\n\n")}`;
  noteActive(slug); paintSide();
  if (!T.running) { enqueue(text); startTutor(resumeTyped(s)); } else speak(text);
  // A tutor in the middle of a reply reads it when that reply ends (Edison, 8 Nov: it showed up late, unexplained).
  if (T.running && busy()) toast(`Your question waits until the tutor finishes its reply in ${shortTitle(s)}.`);
};
const qOfferHtml = (topic) => `<div class="q-offer" role="group" aria-label="Turn this into a lesson">
  <div class="qo-t">Turn this into a lesson?</div>
  <div class="qo-p"><b>${esc(topic)}</b>. The tutor picks up from this chat, builds a plan, tracks each skill, and brings them back in reviews.</div>
  <div class="qo-b"><button class="btn text" data-act="question-offer-no">Not now</button><button class="btn" data-act="question-lesson" data-arg="${esc(topic)}">Start the lesson</button></div>
</div>`;
ACTIONS["question-offer-no"] = async () => { if (!Q.id) return; const el = document.querySelector(".q-offer"); if (el) { el.classList.add("out"); await new Promise((r) => setTimeout(r, 180)); } await F.questions.mark(Q.id, { offer: "no" }); };
// The lesson starts in the subject tutor with Start a subject's own command: a slug from the topic (course code first,
// the way the vault's subjects are named), the topic as the goal hint, and the file holding this chat.
function lessonSlug(topic) {
  const m = topic.match(/^([A-Za-z]{2,5})\s?(\d{2,3})\b\s*(.*)$/);
  const kebab = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 4).join("-");
  return m ? `${m[1].toLowerCase()}${m[2]}-${kebab(m[3] || "topic")}` : `personal-${kebab(topic)}`;
}
ACTIONS["question-lesson"] = async (topic) => {
  const id = Q.id; if (!id) return;
  topic = String(topic || Q.chat.title).trim();
  const r = await F.questions.mark(id, { lesson: topic });
  if (!r || !r.file) return toast("Couldn't hand this chat to the tutor.");
  // The tutor sets the subject up out of sight (Edison, 7 Nov: the terminal opening was unwanted). This page says so,
  // and once the new subject's folder exists the app goes to its Session, where the tutor's first questions show.
  const slug = lessonSlug(topic);
  Q.pending = { id, slug, topic, at: Date.now(), known: new Set(S.subjects.map((x) => x.slug)) };
  sendCommand(`${command(`learn-start ${slug}`)} ${topic}. This started as a question I asked; read ${r.file} first and pick up from what it covered.`);
  if (qPage()) paintQuestion(false);
};
// The new subject has appeared in the vault: by its slug, or failing that any subject that wasn't there before.
function lessonArrived() {
  const p = Q.pending; if (!p || !S) return;
  const s = subj(p.slug) || S.subjects.find((x) => !p.known.has(x.slug) && x.status !== "done");
  if (!s) return;
  Q.pending = null;
  noteActive(s.slug);
  if (p.home ? route.name === "home" : qPage() && Q.id === p.id) go("session", s.slug);
  else toast(`${shortTitle(s)} is ready.`, { label: "Open", act: "subject", arg: s.slug });
}
setInterval(() => {
  const p = Q.pending; if (!p || Date.now() - p.at < 180000) return;
  if (p.home) { if (!p.warned) { p.warned = true; toast(`Still setting up ${p.topic.slice(0, 40)}.`, { label: "See what it's doing", act: "open-term", arg: "" }); } }
  else if (qPage() && Q.id === p.id && !document.querySelector(".q-setup.slow")) paintQuestion(false);
}, 10000);
const qMsgHtml = (m) => m.role === "you" ? `<div class="me"><span class="bubble">${m.images ? `<span class="shots">${m.images.map((n) => `<img src="q-file:///${Q.id}/${n}" alt="Screenshot you pasted" data-view>`).join("")}</span>` : ""}${esc(m.text)}</span></div>`
  : m.error ? `<div class="q-err">Couldn't get an answer. ${esc(m.error)}</div>`
  : `<div class="tutor">${renderMd(qClean(m.text))}${m.stopped ? `<div class="cap">Stopped</div>` : ""}</div>`;
const qLiveHtml = (text) => text.trim() ? renderMd(text) : `<div class="working on"><i class="spin"></i><span>Thinking</span></div>`;
// Math in a reply still streaming draws as it arrives (Edison, 7 Nov: the formula stayed raw until the reply ended).
// Only the math: a diagram waits for the finished reply, since half a diagram cannot be drawn.
function qMath(el) {
  if (window.renderMathInElement) window.renderMathInElement(el, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }], throwOnError: false, ignoredClasses: ["codeblock", "mermaid"] });
  else typeset(el);
}
function paintQuestion(toEnd) {
  const el = $("screen"), c = Q.chat;
  if (!c) { unput(el); el.innerHTML = `<div class="thread-empty" style="padding-top:30vh"><b class="t-sec">This question is gone</b></div>`; return; }
  const box = $("qMsg"), was = el.querySelector(".qchat");
  if (box && was) Q.drafts[was.dataset.id || "new"] = box.value;
  const scroller = el.querySelector(".q-scroll"), wasEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  unput(el);
  el.innerHTML = `<div class="qchat" data-id="${c.id || ""}">
    <div class="q-scroll"><div class="thread q-thread">
      ${c.messages.map(qMsgHtml).join("")}
      ${c.running ? `<div class="tutor" id="qLive">${qLiveHtml("")}</div>` : ""}
      ${qOffer(c) ? qOfferHtml(qOffer(c)) : qFits(c) ? qFitsHtml(qFits(c)) : ""}
      ${Q.pending && Q.pending.id === c.id ? (Date.now() - Q.pending.at > 180000
        ? `<div class="q-setup slow">The tutor is still setting up ${esc(Q.pending.topic)}. <button class="btn text" data-act="toggle-term">See what it's doing</button></div>`
        : `<div class="q-setup"><i class="spin"></i>Setting up your lesson on ${esc(Q.pending.topic)}. It opens here when it's ready.</div>`)
        : c.moved && subj(c.moved) ? `<div class="cmd-line">Moved to ${esc(shortTitle(subj(c.moved)))} · <button class="btn text" data-act="subject" data-arg="${c.moved}">Open it</button></div>`
        : c.lesson ? `<div class="cmd-line">Became a lesson: ${esc(c.lesson)}${(() => { const s = subj(lessonSlug(c.lesson)); return s ? ` · <button class="btn text" data-act="subject" data-arg="${s.slug}">Open it</button>` : ""; })()}</div>` : ""}
    </div></div>
    <div class="q-dock"><div class="composer q-field">
      <div class="attach" id="qAttach"></div>
      <div class="q-row">
        <textarea id="qMsg" rows="1" placeholder="${c.id ? "Ask a follow-up, or paste a screenshot" : "Ask about it"}" aria-label="Message"></textarea>
        <button class="send" id="qSend" data-act="${c.running ? "question-stop" : "question-send"}" aria-label="${c.running ? "Stop" : "Send"}" ${c.running ? "" : "disabled"}>${icon(c.running ? "stop" : "send", "sm")}</button>
      </div>
    </div></div>
  </div>`;
  const msg = $("qMsg"), field = el.querySelector(".q-field");
  msg.value = Q.drafts[qKey()] || "";
  const fit = () => { msg.style.height = "auto"; msg.style.height = Math.min(msg.scrollHeight, 200) + "px"; qSendState(); };
  msg.addEventListener("input", () => { Q.drafts[qKey()] = msg.value; fit(); });
  msg.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !composing(e)) { e.preventDefault(); if (!Q.chat.running) ACTIONS["question-send"](); } });
  msg.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.items : [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
    if (files.length) { e.preventDefault(); files.forEach(qAddImage); }
  });
  field.addEventListener("dragover", (e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) e.preventDefault(); });
  field.addEventListener("drop", (e) => { const f = [...e.dataTransfer.files].filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); f.forEach(qAddImage); } });
  paintQAttach();
  fit();
  typeset(el);
  const sc = el.querySelector(".q-scroll");
  if (toEnd || wasEnd) sc.scrollTop = sc.scrollHeight;
  QF.on = true;
  sc.addEventListener("wheel", (e) => { if (e.deltaY < 0) QF.on = false; }, { passive: true });
  sc.addEventListener("scroll", () => { if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40) QF.on = true; }, { passive: true });
  if (c.running && c.live) qFill($("qLive"), qCut(c.live));
  if (document.activeElement === document.body || toEnd) msg.focus({ preventScroll: true });
}
F.questions.onChanged(async ({ id }) => {
  await qRefresh();
  if (S) paintSide();
  if (id !== Q.id) return;
  const was = Q.chat, fresh = await F.questions.get(id), live = $("qLive");
  Q.chat = fresh;
  if (!qPage()) return;
  // The reply just finished: its last words still arrive at the reading pace, then the page settles.
  if (live && was && was.running && fresh && !fresh.running) {
    clearTimeout(qTimer); qTimer = 0;
    const last = fresh.messages[fresh.messages.length - 1];
    if (last && last.role === "tutor" && last.text) qFill(live, qClean(last.text));
    const b = $("qSend"); if (b) { b.dataset.act = "question-send"; b.setAttribute("aria-label", "Send"); b.innerHTML = icon("send", "sm"); qSendState(); }
    const key = `q:${id}`, wait = setInterval(() => {
      const p = ARRIVE.peek(key);
      if (p && p.released < p.toks.length) return;
      clearInterval(wait);
      setTimeout(() => { ARRIVE.forget(key); if (Q.id === id && qPage() && !Q.chat.running) paintQuestion(false); }, 450);
    }, 120);
    return;
  }
  paintQuestion(false);
});
// The reply arrives the way a session's does (arrive.js: 30 words a second, a breath after each sentence, each word
// coming into focus). Edison, 7 Nov: the raw stream was "too fast, and choppy". Only whole words and closed formulas
// are drawn, so a word never grows in place and a half-written formula never shows as code.
function qCut(text) {
  let t = qClean(text).replace(/\S+$/, "");
  if (((t.match(/(?<!\\)\$/g) || []).length) % 2) t = t.slice(0, t.lastIndexOf("$"));
  return t;
}
function qFill(live, text) {
  const key = `q:${Q.id}`;
  if (!text.trim()) { live.innerHTML = qLiveHtml(""); return; }
  live.style.opacity = "0";
  live.innerHTML = renderMd(text);
  const done = () => { ARRIVE.adopt(live, key, { max: 40 }); live.style.opacity = ""; qFollow(); };
  if (window.renderMathInElement) { qMath(live); done(); } else typeset(live, done);
}
// While words arrive, the page keeps the newest one in view, unless you scrolled up to read.
const QF = { on: true, raf: 0 };
function qFollow() {
  if (QF.raf) return;
  const step = () => {
    QF.raf = 0;
    const sc = document.querySelector(".q-scroll"), p = Q.id && ARRIVE.peek(`q:${Q.id}`);
    if (!sc || !p || !qPage()) return;
    const tok = p.toks[p.released - 1];
    if (QF.on && tok && tok.isConnected) {
      const over = tok.getBoundingClientRect().bottom - (sc.getBoundingClientRect().bottom - 48);
      if (over > 0) sc.scrollTop += Math.max(1, over * 0.18);
    }
    if (p.released < p.toks.length || (Q.chat && Q.chat.running)) QF.raf = requestAnimationFrame(step);
  };
  QF.raf = requestAnimationFrame(step);
}
let qTimer = 0;
F.questions.onDelta(({ id, text }) => {
  if (id !== Q.id || !Q.chat) return;
  Q.chat.live = text;
  if (qTimer || !qPage()) return;
  qTimer = setTimeout(() => {
    qTimer = 0;
    const live = $("qLive");
    if (live && Q.chat.running) qFill(live, qCut(Q.chat.live));
  }, 120);
});

// ---------- Dashboard ----------
let badgesOpen = false;
const PLAIN_BADGE = { "Goal met": "Goal reached", Recovered: "Remembered again after slipping", Solid: "Remembered on a later day" };
function badgeName(b) { return b.kind === "Goal met" ? shortTitle({ title: b.title }) : nodeName(b.name); }
function sealEl(kind, s) {
  if (kind === "Goal met") return `<i class="seal goal" style="${subjVar(s)}">${icon("end")}</i>`;
  if (kind === "Recovered") return `<i class="seal recovered">${icon("review")}</i>`;
  return `<i class="seal solid">${icon("check")}</i>`;
}
// A day's wins in one subject stack into one row; a goal gets a row of its own.
function badgeGroups() {
  const groups = [];
  S.badges.forEach((b) => {
    const k = b.kind === "Goal met" ? `goal/${b.subject}/${b.date}` : `${b.subject}/${b.date}`;
    let g = groups.find((x) => x.k === k);
    if (!g) groups.push((g = { k, date: b.date, subject: b.subject, title: b.title, list: [] }));
    g.list.push(b);
  });
  return groups;
}
function badgeRow(g) {
  const s = subj(g.subject) || { title: g.title, theme: "calm" };
  const n = g.list.length, rec = g.list.filter((b) => b.kind === "Recovered").length, sol = g.list.filter((b) => b.kind === "Solid").length;
  if (g.list[0].kind === "Goal met") return `<div class="badge-row">${sealEl("Goal met", s)}<div class="bt"><b>Goal reached</b> · ${esc(shortTitle(s))}<div class="bd">${shortD(g.date)}</div></div></div>`;
  const ordered = [...g.list].sort((a, b) => (a.kind === "Recovered" ? -1 : 1) - (b.kind === "Recovered" ? -1 : 1)).slice(0, 4);
  const stack = `<span class="seal-stack">${ordered.map((b) => sealEl(b.kind, s)).join("")}</span>`;
  const title = n === 1 ? `<b>${PLAIN_BADGE[g.list[0].kind]}</b> · ${md(badgeName(g.list[0]))}` : `<b>${n} wins</b> · ${esc(shortTitle(s))}`;
  const detail = n === 1 ? `${esc(shortTitle(s))} · ${shortD(g.date)}` : [rec ? `${rec} remembered again after slipping` : "", sol ? `${sol} remembered on a later day` : ""].filter(Boolean).join(", ") + ` · ${shortD(g.date)}`;
  return `<div class="badge-row">${stack}<div class="bt">${title}<div class="bd">${detail}</div></div></div>`;
}
function paintDashboard() {
  const top = S.ranked[0];
  inkAction = () => run(top);
  const solid = S.subjects.reduce((n, s) => n + s.nodes.filter((x) => x.status === "solid").length, 0);
  const groups = [["Active", (s) => s.status === "active" || s.status === "diagnosing"], ["Paused", (s) => s.status === "paused"], ["Done", (s) => s.status === "done"]];
  const recallOnly = S.subjects.reduce((n, s) => n + s.recall_only, 0);
  const list = groups.map(([g, f]) => {
    const rows = S.subjects.filter(f).sort((a, b) => (b.last_session || "").localeCompare(a.last_session || ""));
    if (!rows.length) return "";
    return `<div class="group-label">${g}</div>` + rows.map((s) => {
      const meter = s.total ? `<span class="bar" title="${s.proven} of ${s.total} skills passed"><i style="width:${Math.round((100 * s.proven) / s.total)}%"></i></span>` : "<span></span>";
      const dl = s.days_to_deadline, repair = (s.pending || "").match(/(\d+) to repair/);
      const tag = repair ? `<span class="chip now">${repair[1]} to repair</span>`
        : dl === 0 ? `<span class="chip now">Deadline today</span>`
        : dl !== null && dl > 0 && dl <= 2 ? `<span class="chip soon">Deadline ${deadlineWord(dl)}</span>`
        : dl !== null && dl > 0 ? `<span class="chip">Deadline ${deadlineWord(dl)}</span>`
        : s.pending ? `<span class="cap">${esc(s.pending.replace(" for review", ""))}</span>` : s.goal_met ? `<span class="cap">Goal met</span>` : "";
      return `<button class="row" style="grid-template-columns:20px minmax(0,1fr) 88px 56px 150px" data-act="subject-progress" data-arg="${s.slug}" data-prefetch="${s.slug}">${tileIcon(s)}<span class="t-ui" style="padding-right:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${md(s.title)}</span>${meter}<span class="cap">${shortD(s.last_session)}</span><span style="display:flex;justify-content:flex-end">${tag}</span></button>`;
    }).join("");
  }).join("");
  const bg = S.rewards_on && S.badges.length ? badgeGroups() : [];
  const badges = bg.length ? `<div class="card list-card"><div class="list-head">Recently earned${bg.length > 3 ? `<button class="more" data-act="badges-more">${badgesOpen ? "Fewer" : `All ${S.badges.length}`}</button>` : ""}</div>
      ${bg.slice(0, badgesOpen ? 999 : 3).map(badgeRow).join("")}</div>` : "";
  if (!put($("screen"), `<div class="content wide">
    <div class="page-head">
      <h1 class="t-title">All subjects</h1>
      ${top.kind === "Start" ? "" : `<button class="btn neutral" data-act="start" data-tip="${key("N")}">${icon("plus", "sm")}Start a subject</button>`}
      <button class="btn" data-act="ink" data-tip="${key("↩")}">${top.kind === "Start" ? "Start a subject" : (VERB[top.kind] || "Start") + (top.subject ? " " + esc(subName(subj(top.subject))) : "")}</button>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:24px;margin-top:22px">
      <div>
        <div class="stat-tiles" style="grid-template-columns:repeat(${S.rewards_on ? 4 : 2},1fr);margin-bottom:16px">
          <div class="stat"><b>${solid}</b><span>Skills solid</span></div>
          <div class="stat"><b>${S.counts.nodes_proven}</b><span>Skills passed</span></div>
          ${S.rewards_on ? `<div class="stat"><b>${S.counts.current_streak}</b><span>Week streak</span></div><div class="stat"><b>${S.counts.goals_met}</b><span>Goals met</span></div>` : ""}
        </div>
        <div class="card" style="padding:4px 14px 8px">${list || `<div class="t-ui ink2" style="padding:16px 0">No subjects yet. Start one to see it here.</div>`}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${S.rewards_on ? streakCard() : ""}
        <div class="card list-card"><div class="list-head">Checks passed</div>${heat(S.heat, 16)}</div>
        ${badges}
        ${recallOnly ? `<div class="card list-card"><div class="t-ui">${recallOnly} skills passed from memory only</div><div class="cap" style="margin-top:2px">A review asks one of them a new way.</div></div>` : ""}
      </div>
    </div></div>`)) return;
}
ACTIONS["badges-more"] = () => { badgesOpen = !badgesOpen; paintDashboard(); };
ACTIONS["subject-progress"] = (slug) => go("progress", slug);

function streakCard() {
  const weeks = S.streak.weeks.slice(-8);
  const disc = (w) => w.result === "pass" || w.result === "repaired" || w.result === "forgiven" ? `<i title="Week of ${longD(w.start)}">${icon("check")}</i>`
    : w.result === "pending" ? `<i class="open" title="Week of ${longD(w.start)}: still open"></i>`
    : w.result === "miss" ? `<i class="miss" title="Week of ${longD(w.start)}: missed"></i>`
    : `<i class="none" title="Week of ${longD(w.start)}: nothing due"></i>`;
  return `<div class="card list-card">
    <div class="list-head"><span class="status-icon coral">${icon("streak")}</span>${S.streak.current} ${S.streak.current === 1 ? "week" : "weeks"} of reviews</div>
    <div class="streak-weeks">${weeks.map(disc).join("")}</div></div>`;
}
function subjectWeeks(s) {
  const first = Object.keys(s.heat).sort()[0];
  if (!first) return 6;
  return Math.max(6, Math.min(16, Math.ceil((new Date(S.today) - new Date(first)) / 6048e5) + 1));
}
function heat(data, weeks) {
  const today = new Date(S.today + "T12:00:00");
  const end = new Date(today); end.setDate(end.getDate() + (7 - (end.getDay() || 7)));
  const start = new Date(end); start.setDate(end.getDate() - 7 * weeks + 1);
  const lvl = (n) => (!n ? "" : n <= 2 ? "h1" : n <= 5 ? "h2" : n <= 9 ? "h3" : "h4");
  let h = "";
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = ymd(d), n = data[k] || 0;
    h += `<i class="${lvl(n)}${d > today ? " fut" : ""}" title="${longD(k)}: ${n} ${n === 1 ? "check" : "checks"} passed"></i>`;
  }
  return `<div class="heat">${h}</div>`;
}

// ---------- Progress ----------
let canOpen = false;
// Progress on the glass (7 Nov, Edison picked "rethink it, one column"): one headline, the subject's bricks with each
// skill's state, then what you can do now. The old page said 5 of 5 three times, put "Nothing planned yet" beside
// "Next: a few more questions", and drew a check grid that held one square.
function paintProgress2(s) {
  const canNow = s.nodes.filter((n) => ["checked", "solid", "decayed"].includes(n.status));
  const up = s.nodes.find((n) => n.id === s.up_next) || s.nodes.find((n) => n.status === "introduced");
  const verb = s.status === "done" ? "Practice" : "Resume";
  inkAction = s.status === "done" ? () => ACTIONS.practice(s.slug) : () => ACTIONS.resume(s.slug);
  const sessions = s.notes.length, d = s.days_to_deadline;
  const head = s.status === "done" ? "Goal met" : !s.total ? "No plan yet" : s.proven === s.total ? `All ${s.total} skills passed` : `${s.proven} of ${s.total} skills passed`;
  const due = s.deadline && s.status !== "done" ? (d !== null && d !== undefined && d < 0 ? `Deadline passed ${shortD(s.deadline)}` : `Due ${d !== null && d >= 0 && d < 7 ? deadlineWord(+d) + " " : ""}${shortD(s.deadline)}`) : "";
  const last = s.notes.length ? shortD(s.notes[s.notes.length - 1].name) : "";
  const sub = [due, sessions ? `${sessions} ${sessions === 1 ? "session" : "sessions"}${last ? `, last ${last}` : ""}` : "No sessions yet"].filter(Boolean).join(" · ");
  const state = (n) => {
    const c = discClass(n, s);
    if (n.status === "decayed") return ["due", "Worth a refresh"];
    if (c === "checked" || c === "solid") return ["pass", n.checked && n.checked !== "—" ? `Passed ${shortD(n.checked)}` : "Passed"];
    if (up && n.id === up.id) return ["now", n.status === "introduced" ? "Learning" : "Up next"];
    return ["not", ""];
  };
  const rows = s.nodes.map((n) => { const [bk, word] = state(n), isUp = up && n.id === up.id;
    // Pointing at a skill says what it is (7 Nov, Edison): what it lets you do, and when it was last checked.
    const can = n.can_do ? `${bk === "pass" || bk === "due" ? "You can" : "You'll be able to"} ${md(n.can_do)}.` : "";
    const seen = n.checked && n.checked !== "—" ? `Last checked ${shortD(n.checked)}` : bk === "not" ? "Not taught yet" : "";
    const tip = can || seen ? `<div class="pg-tip" role="tooltip">${can ? `<p>${can}</p>` : ""}${seen ? `<span>${seen}</span>` : ""}</div>` : "";
    return `<div class="pg-row ${bk}" tabindex="-1"><span class="s-bond pg-bk"><i class="${bk}"></i></span><div class="pg-name"><b>${md(n.name)}</b>${isUp && n.can_do ? `<span>You'll be able to ${md(n.can_do)}.</span>` : ""}</div><span class="pg-when">${word}</span>${tip}</div>`; }).join("");
  if (!put($("screen"), `<div class="content prog2">
    <div class="pg-head"><div><h1 class="t-title">${head}</h1><div class="pg-sub">${sub}</div></div>
      <button class="btn pg-go" data-act="ink" data-prefetch="${s.slug}" data-tip="${key("↩")}">${verb}</button></div>
    ${s.total ? `<div class="pg-rows">${rows}</div>` : `<p class="pg-sub" style="margin-top:20px">A few more questions to find where you start.</p>`}
    ${canNow.length ? (() => { const li = (n) => `<li><span>${icon("check", "sm")}</span><span>${md(cap(n.can_do))}.</span></li>`;
      // The rest unfold in place (7 Nov: "8 more" redrew the page and the list jumped open)
      return `<div class="t-sec pg-sec">You can now</div><ul class="check-list">${canNow.slice(0, 4).map(li).join("")}</ul>
      ${canNow.length > 4 ? `<div class="pg-extra ${canOpen ? "open" : ""}"><div><ul class="check-list">${canNow.slice(4).map(li).join("")}</ul></div></div>
      <button class="pg-more ${canOpen ? "open" : ""}" data-act="pg-more" aria-expanded="${canOpen}"><span>${canOpen ? "Show fewer" : `${canNow.length - 4} more`}</span>${icon("down", "sm")}</button>` : ""}`; })() : ""}
  </div>`)) return;
}
function paintProgress() {
  const s = subj(route.slug);
  if (GLASS) return paintProgress2(s);
  const canNow = s.nodes.filter((n) => ["checked", "solid", "decayed"].includes(n.status));
  const up = s.nodes.find((n) => n.id === s.up_next);
  const solid = s.nodes.filter((n) => n.status === "solid").length;
  const notes = s.notes.slice().reverse();
  const verb = s.status === "done" ? "Practice" : "Resume";
  inkAction = s.status === "done" ? () => ACTIONS.practice(s.slug) : () => ACTIONS.resume(s.slug);
  if (!put($("screen"), `<div class="content wide" style="padding-top:74px">
    <div class="page-head">
      <h1 class="t-title">${md(s.title)}</h1>
      <button class="btn" data-act="ink" data-prefetch="${s.slug}" data-tip="${key("↩")}">${icon("resume", "sm")}${verb}</button>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:24px;margin-top:20px">
      <div>
        ${s.total ? `<div class="card" style="padding:20px 16px"><div class="disc-grid" style="${s.nodes.length <= 6 ? `grid-template-columns:repeat(${s.nodes.length},1fr)` : ""}">
          ${s.nodes.map((n) => `<div class="disc-cell" title="${STATUS_WORD[n.status] || ""}${n.checked && n.checked !== "—" ? ", last checked " + longD(n.checked) : ""}">
            <div style="display:flex;justify-content:center">${discEl(n, s, "lg")}</div>
            <div class="cap" style="color:var(--color-${discClass(n, s) === "not" ? "ink-3" : "ink"});${n.id === s.up_next ? "font-weight:700" : ""}">${md(n.name)}</div>
          </div>`).join("")}</div></div>` : `<div class="card" style="padding:20px"><div class="t-ui ink2">No plan yet. A few more questions to find where you start.</div></div>`}
        <div style="display:grid;grid-template-columns:${canNow.length ? "1fr 1fr" : "1fr"};gap:20px;margin-top:22px">
          ${canNow.length ? "" : "<!--"}<div><div class="t-sec">You can now</div>
            ${canNow.length ? `<ul class="check-list">${canNow.slice(0, canOpen ? 999 : 4).map((n) => `<li><span>${icon("check", "sm")}</span><span>${md(cap(n.can_do))}.</span></li>`).join("")}</ul>
            ${canNow.length > 4 ? `<button class="btn text" style="margin-left:14px" data-act="can-more">${canOpen ? "Fewer" : `${canNow.length - 4} more`}</button>` : ""}` : ""}
          </div>${canNow.length ? "" : "-->"}
          <div><div class="t-sec">Up next</div>
            <div class="t-ui" style="margin-top:6px">${up ? `<b>${md(up.name)}.</b> You'll be able to ${md(up.can_do)}.` : s.status === "done" ? "Goal met. Nothing left to teach." : "Nothing planned yet."}</div>
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="action-card" style="${subjVar(s)}">
          <div class="eyebrow" style="margin-top:0">${tileIcon(s)}${esc(courseCode(s))}</div>
          <div class="t-head" style="margin-top:6px">${s.total ? `${s.proven} of ${s.total} skills` : "No plan yet"}</div>
          <div class="line">Next: ${up ? md(up.name) : s.status === "done" ? "goal met" : "a few more questions"}</div>
          ${s.deadline ? `<div style="margin-top:12px"><span class="chip ${s.days_to_deadline === 0 ? "now" : s.days_to_deadline !== null && s.days_to_deadline > 0 && s.days_to_deadline <= 2 ? "soon" : ""}">Deadline ${shortD(s.deadline)}</span></div>` : ""}
        </div>
        ${s.proven ? `<div class="stat-tiles" style="grid-template-columns:1fr 1fr">
          <div class="stat"><b>${solid}</b><span>Skills solid</span></div>
          <div class="stat"><b>${s.proven}</b><span>Skills passed</span></div>
        </div>
        <div class="card list-card"><div class="list-head">Checks passed</div>${heat(s.heat, subjectWeeks(s))}</div>` : `<div class="card list-card"><div class="list-head">${icon("checkme")}No checks yet</div><div class="cap">The first check comes after two or three skills. Passed skills and your check history show here.</div></div>`}
        <div class="card list-card"><div class="list-head">Sessions</div>
          ${notes.length ? notes.slice(0, 6).map((n) => `<div class="week-row" style="cursor:default"><span>${noteLabel(n.name)}</span><span class="cap" style="margin-left:auto">${shortD(n.name)}</span></div>`).join("") : `<div class="cap">No sessions yet.</div>`}
        </div>
      </div>
    </div></div>`)) return;
}
ACTIONS["pg-more"] = (_a, el) => {
  canOpen = !canOpen;
  const box = el.previousElementSibling; box.classList.toggle("open", canOpen); el.classList.toggle("open", canOpen);
  el.setAttribute("aria-expanded", canOpen); el.querySelector("span").textContent = canOpen ? "Show fewer" : `${box.querySelectorAll("li").length} more`;
};
ACTIONS["can-more"] = () => { canOpen = !canOpen; paintProgress(); typeset($("screen")); };
function noteLabel(name) {
  const m = String(name).match(/-([sr])0*(\d+)$/);
  return m ? `${m[1] === "s" ? "Session" : "Review"} ${m[2]}` : esc(name);
}

// ---------- Skill map ----------
let mapView = null;
function paintMap() {
  const s = subj(route.slug);
  inkAction = s.status === "done" ? () => ACTIONS.practice(s.slug) : () => ACTIONS.resume(s.slug);
  const el = $("screen");
  if (!s.nodes.length || !s.layout) {
    unput(el); el.innerHTML = `<div class="mapwrap space"${GLASS ? "" : skyTheme()}><div class="map-empty"><div><div class="t-head">No map yet</div><div class="t-ui ink2" style="margin-top:6px">${esc(shortTitle(s))} has no plan yet. A few more questions to find where you start.</div><button class="btn" style="margin-top:16px" data-act="ink">Resume</button></div></div></div>`;
    return;
  }
  const L = s.layout, W = 210, H = 92, GY = 64;
  const top = Math.max(...Object.values(L.rank));
  const X = (v) => 60 + L.x[v], Y = (v) => 90 + (top - L.rank[v]) * (H + GY), pos = {};
  s.nodes.forEach((n) => { pos[n.id] = { x: X(n.id) - W / 2 + 105, y: Y(n.id) }; });
  // Edges are drawn after the nodes are laid out, so each one ends at its node's real height.
  const edgesFor = (hs) => L.chains.map(([a, b, chain]) => {
    const pts = chain.map((v) => [X(v) + 105, Y(v) + H / 2]);
    pts[0][1] = Y(a);
    pts[pts.length - 1][1] = Y(b) + (hs[b] || H);
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], m = (y1 + y2) / 2; d += ` C ${x1} ${m}, ${x2} ${m}, ${x2} ${y2}`; }
    return `<path d="${d}"/>`;
  }).join("");
  const widthPx = 120 + Math.max(...Object.values(L.x)) + W, heightPx = 140 + (top + 1) * (H + GY);
  const line = (n) => {
    const c = discClass(n, s);
    if (c === "not" || !n.can_do) return "";
    return `${c === "up" || c === "learn" ? "You'll be able to" : "You can"} ${md(n.can_do)}.`;
  };
  // On the glass (7 Nov, Edison: "box in a box", old style) the map sits straight on the panel in the app's own theme,
  // with the Skills bricks in place of the old check discs.
  const brick = (n) => { const c = discClass(n, s); return `<span class="s-bond nd-bk"><i class="${n.status === "decayed" ? "due" : c === "checked" || c === "solid" ? "pass" : c === "up" || c === "learn" ? "now" : "not"}"></i></span>`; };
  if (!put(el, `<div class="mapwrap space grid" id="mapwrap"${GLASS ? "" : skyTheme()}><div class="map-glow" style="${subjVar(s)}"></div>
    <div class="canvas" id="canvas" style="width:${widthPx}px;height:${heightPx}px">
      <svg id="mapEdges" width="${widthPx}" height="${heightPx}" style="position:absolute;left:0;top:0;stroke:var(--color-line-strong)" stroke-width="1.4" fill="none"></svg>
      ${s.nodes.map((n) => { const c = discClass(n, s); return `<div class="node ${c === "not" ? "not" : ""} ${c === "up" ? "upn" : ""}" data-id="${n.id}" style="left:${pos[n.id].x}px;top:${pos[n.id].y}px${line(n) ? `;min-height:${H}px` : ""}" title="${STATUS_WORD[n.status] || ""}">${GLASS ? brick(n) : discEl(n, s, "md")}<div><b>${md(n.name)}</b><span>${line(n)}</span></div></div>`; }).join("")}
    </div></div>
    <div class="card float mapctl">
      <button class="btn text" data-act="zoom" data-arg="in" aria-label="Zoom in" data-tip="${key("=")}" data-tip-side="up">+</button><button class="btn text" data-act="zoom" data-arg="out" aria-label="Zoom out" data-tip="${key("-")}" data-tip-side="up">−</button><button class="btn text" data-act="zoom" data-arg="fit" data-tip="${key("0")}" data-tip-side="up">Fit</button>
      <button class="btn sm" data-act="ink" data-tip="${key("↩")}" data-tip-side="up">${s.status === "done" ? "Practice" : "Resume"}</button>
    </div>`)) return;
  const wrap = $("mapwrap");
  const hs = {};
  wrap.querySelectorAll(".node").forEach((n) => { hs[n.dataset.id] = n.offsetHeight; });
  $("mapEdges").innerHTML = edgesFor(hs);
  const keyName = `map/${s.slug}`;
  mapView = mapViews[keyName] || null;
  if (!mapView) {
    // Open on the whole map; if that is too small to read, on the up-next skill.
    fitMap(true);
    const target = pos[s.up_next];
    if (mapView.k < 0.75 && target) mapView = viewFor(target.x + W / 2, target.y + H / 2, 0.9);
  }
  mapViews[keyName] = mapView;
  applyMap();
  panZoom(wrap, keyName);
}
const mapViews = {};
function panZoom(wrap, keyName) {
  let dragging = null;
  wrap.onmousedown = (e) => { if (e.target.closest("button,input") || e.button !== 0) return; cancelAnimationFrame(flight); dragging = { x: e.clientX - mapView.x, y: e.clientY - mapView.y }; wrap.classList.add("drag"); };
  window.onmousemove = (e) => { if (dragging) { mapView.x = e.clientX - dragging.x; mapView.y = e.clientY - dragging.y; applyMap(); } };
  window.onmouseup = () => { dragging = null; wrap.classList.remove("drag"); mapViews[keyName] = mapView; };
  wrap.onwheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, e);
    else { mapView.x -= e.deltaX; mapView.y -= e.deltaY; applyMap(); }
    mapViews[keyName] = mapView;
  };
}
function applyMap() {
  const c = $("canvas");
  if (!c || !mapView) return;
  c.style.transform = `translate(${mapView.x}px,${mapView.y}px) scale(${mapView.k})`;
  // Skill names appear once you zoom in close enough to read them.
  c.classList.toggle("near", mapView.k >= 1.05);
  c.style.setProperty("--k", mapView.k.toFixed(3));
  clearTimeout(declutterTimer);
  declutterTimer = setTimeout(declutter, 120);
}
// Maps are a dark sky inset in the panel (Edison, 27 Oct 2026, from his constellation
// reference); the header islands and map controls keep the app's own theme.
const skyTheme = () => (cfg.mapTheme === "light" ? "" : ' data-theme="night"');
// Titles keep clear of each other: in priority order (active subjects, then the
// bigger ones), a title that would overlap one already placed waits for hover or zoom.
let declutterTimer = 0;
function declutter() {
  const svg = $("sys"); if (!svg) return;
  const placed = [];
  [...svg.querySelectorAll(".tl")].sort((a, b) => +a.dataset.p - +b.dataset.p).forEach((g) => {
    g.classList.remove("crowd");
    if (g.closest(".planet.done") && !$("canvas").classList.contains("near")) return;
    const b = g.getBBox(), box = { x0: b.x - 4, y0: b.y - 2, x1: b.x + b.width + 4, y1: b.y + b.height + 2 };
    if (placed.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) g.classList.add("crowd");
    else placed.push(box);
  });
}
const mapKey = () => (route.name === "map" ? `map/${route.slug}` : "system");
let flight = 0;
function flyTo(target, ms = 420, done) {
  cancelAnimationFrame(flight);
  if (!target) return;
  if (!mapView || matchMedia("(prefers-reduced-motion: reduce)").matches) { mapView = { ...target }; applyMap(); mapViews[mapKey()] = mapView; return done && done(); }
  const from = { ...mapView }, t0 = performance.now(), ease = (q) => 1 - Math.pow(1 - q, 3);
  const step = (now) => {
    const q = Math.min(1, (now - t0) / ms), e = ease(q);
    mapView = { k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
    applyMap();
    if (q < 1) flight = requestAnimationFrame(step); else { mapViews[mapKey()] = mapView; if (done) done(); }
  };
  flight = requestAnimationFrame(step);
}
function viewFor(cx, cy, k) { const w = $("mapwrap"); return { k, x: w.clientWidth / 2 - cx * k, y: w.clientHeight / 2 - cy * k }; }
function zoomBy(f, e) {
  const wrap = $("mapwrap"); if (!wrap || !mapView) return;
  const r = wrap.getBoundingClientRect();
  const cx = e ? e.clientX - r.left : r.width / 2, cy = e ? e.clientY - r.top : r.height / 2;
  const k = Math.min(2.5, Math.max(0.3, mapView.k * f)), ratio = k / mapView.k;
  mapView.x = cx - (cx - mapView.x) * ratio; mapView.y = cy - (cy - mapView.y) * ratio; mapView.k = k;
  applyMap();
}
// The view that shows a box: on All skills its stars, on a Skill map the whole canvas.
function fitView() {
  const wrap = $("mapwrap"), c = $("canvas"); if (!wrap || !c) return null;
  const b = route.name === "system" && sysBox ? sysBox : { x0: 0, y0: 0, x1: c.offsetWidth, y1: c.offsetHeight };
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const k = Math.max(0.3, Math.min(route.name === "system" ? 1.2 : 1, (wrap.clientWidth - 60) / bw, (wrap.clientHeight - 120) / bh));
  // Leave room for the header islands and the search box above the content.
  return viewFor((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 - 24 / k, k);
}
function fitMap(noApply) { const v = fitView(); if (!v) return; mapView = v; if (!noApply) applyMap(); }
ACTIONS.zoom = (how) => {
  if (!MAPS.includes(route.name) || !mapView) return;
  if (how === "fit") return flyTo(fitView(), 360);
  const w = $("mapwrap"), cx = (w.clientWidth / 2 - mapView.x) / mapView.k, cy = (w.clientHeight / 2 - mapView.y) / mapView.k;
  flyTo(viewFor(cx, cy, Math.min(2.5, Math.max(0.3, mapView.k * (how === "in" ? 1.3 : 1 / 1.3)))), 240);
};

// ---------- All skills ----------
// A constellation (Edison, 27 Oct 2026, from his reference): each subject is a
// petal of its skills reaching out from the center, foundations nearest the
// middle, in a soft glow of its subject color. Domains keep their sectors and
// subjects their orbits (active, paused, done), as in the 17 Oct merge.
// Overlaps between subjects are inferred (skill_overlap.py).
const DOMAIN = { code: "Code", math: "Math", circuits: "Circuits", literature: "Literature", design: "Design", calm: "Other" };
const ORBIT = { active: 0, diagnosing: 0, paused: 1, done: 2 };
function statusOf(n, x) { return ({ solid: "m-solid", checked: "m-checked", decayed: "m-checked", introduced: "m-learn" })[n.status] || (n.id === x.up_next ? "m-up" : "m-not"); }
let sysBox = null, sysClusters = {};
function paintSystem() {
  inkAction = () => run(S.ranked[0]);
  const el = $("screen");
  // the Skills page (skills.js, 5 Nov): the list of subjects and their bricks, under the glass hills
  if (window.SkillsPage && S.subjects.length) { unput(el); return SkillsPage.paint(el, S, { night: document.documentElement.dataset.theme === "night", run: (cmd, slug) => run({ command: cmd, subject: slug }) }); }
  if (!S.subjects.length) { unput(el); el.innerHTML = `<div class="mapwrap space"${GLASS ? "" : skyTheme()}><div class="map-empty"><div><div class="t-head">No skills yet</div><div class="t-ui ink2" style="margin-top:6px">Each subject you start draws its skills here, and they light up as you pass them.</div><button class="btn" style="margin-top:16px" data-act="start">Start a subject</button></div></div></div>`; return; }
  const C = 1000, rad = (d) => (d * Math.PI) / 180, f1 = (v) => v.toFixed(1);
  // The panel is wider than tall, so the petals spread sideways to fill it.
  const SX = Math.max(1, Math.min(1.5, ($("screen").clientWidth || 1200) / ($("screen").clientHeight || 800)));
  const X = (x) => C + (x - C) * SX;
  const byTheme = {};
  S.subjects.forEach((x) => (byTheme[themeOf(x)] ??= []).push(x));
  const themes = Object.keys(DOMAIN).filter((t) => byTheme[t]);
  // A domain's slice grows with how much is in it, so a crowded domain gets room.
  const weight = (t) => byTheme[t].reduce((n, x) => n + 1 + Math.sqrt(x.nodes.length), 0);
  let spans = themes.map((t) => Math.max(26, weight(t)));
  const k0 = 360 / spans.reduce((p, q) => p + q, 0); spans = spans.map((x) => x * k0);
  // Each petal needs about 11 degrees; a domain short of that borrows from the roomy ones.
  const need = themes.map((t) => (Math.max(...[0, 1, 2].map((o) => byTheme[t].filter((x) => (ORBIT[x.status] ?? 1) === o).length)) + 1) * 11);
  const lack = spans.map((x, i) => Math.max(0, need[i] - x)), give = lack.reduce((p, q) => p + q, 0);
  const spare = spans.map((x, i) => Math.max(0, x - need[i])), pool = spare.reduce((p, q) => p + q, 0);
  if (give && pool > give) spans = spans.map((x, i) => (lack[i] ? need[i] : x - (spare[i] / pool) * give));
  let ang = -90 - spans[0] / 2;
  const sectors = [];
  themes.forEach((t, i) => { sectors.push({ t, from: ang, to: ang + spans[i] }); ang += spans[i]; });
  const R0 = [110, 320, 540], clusters = [];
  sectors.forEach(({ t, from, to }) => [0, 1, 2].forEach((o) => {
    const list = byTheme[t].filter((x) => (ORBIT[x.status] ?? 1) === o).sort((p, q) => (q.last_session || "").localeCompare(p.last_session || ""));
    list.forEach((x, k) => {
      const d = from + ((to - from) * (k + 1)) / (list.length + 1), r0 = R0[o] + (list.length > 2 && k % 2 ? 70 : 0);
      clusters.push({ x, t, d, r0, arc: rad((to - from) / (list.length + 1)) * (r0 + 100) });
    });
  }));
  const pos = {};
  let x0 = C, y0 = C, x1 = C, y1 = C;
  const grow = (x, y, m) => { x0 = Math.min(x0, x - m); y0 = Math.min(y0, y - m); x1 = Math.max(x1, x + m); y1 = Math.max(y1, y + m); };
  sysClusters = {};
  clusters.forEach((c) => {
    const s = c.x, L = s.layout, ux = Math.cos(rad(c.d)), uy = Math.sin(rad(c.d));
    const ids = L ? s.nodes.map((n) => n.id).filter((i) => L.rank[i] !== undefined && L.x[i] !== undefined) : [];
    const top = Math.max(1, ...ids.map((i) => L.rank[i]));
    const xs = ids.map((i) => L.x[i]), minx = Math.min(...xs), spanx = Math.max(...xs) - minx || 1;
    c.len = ids.length ? Math.min(250, 40 + top * 48) : 30;
    c.wid = Math.max(26, Math.min(120, c.arc * 0.9));
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    ids.forEach((i) => {
      const u = L.rank[i] / top, v = ids.length > 1 ? (L.x[i] - minx) / spanx - 0.5 : 0, r = c.r0 + u * c.len;
      const pt = [X(C + ux * r - uy * v * c.wid), C + uy * r + ux * v * c.wid];
      pos[`${s.slug}/${i}`] = pt;
      bx0 = Math.min(bx0, pt[0]); by0 = Math.min(by0, pt[1]); bx1 = Math.max(bx1, pt[0]); by1 = Math.max(by1, pt[1]);
    });
    const mid = c.r0 + c.len / 2;
    c.cx = X(C + ux * mid); c.cy = C + uy * mid; c.ux = ux; c.uy = uy;
    c.tx = X(C + ux * (c.r0 + c.len + 20)); c.ty = C + uy * (c.r0 + c.len + 20);
    if (!ids.length) { bx0 = bx1 = c.cx; by0 = by1 = c.cy; }
    sysClusters[s.slug] = { x0: bx0 - 30, y0: by0 - 30, x1: bx1 + 30, y1: by1 + 30 };
    grow(c.tx, c.ty, 70); grow(bx0, by0, 40); grow(bx1, by1, 40);
  });
  sysBox = { x0, y0, x1, y1 };
  const col = (t) => `var(--subject-${t})`;
  const defs = themes.map((t) => `<radialGradient id="neb-${t}"><stop offset="0" style="stop-color:${col(t)};stop-opacity:.34"/><stop offset=".55" style="stop-color:${col(t)};stop-opacity:.1"/><stop offset="1" style="stop-color:${col(t)};stop-opacity:0"/></radialGradient>`).join("");
  const nebula = clusters.map((c) => `<ellipse cx="${f1(c.cx)}" cy="${f1(c.cy)}" rx="${f1(c.len / 2 + 95)}" ry="${f1(c.wid / 2 + 70)}" transform="rotate(${f1(c.d)} ${f1(c.cx)} ${f1(c.cy)})" fill="url(#neb-${c.t})"/>`).join("");
  const pairs = {};
  S.overlaps.forEach((o) => { const k = [o.a, o.b].sort().join("|"); (pairs[k] ??= []).push(o); });
  const byslug = Object.fromEntries(clusters.map((c) => [c.x.slug, c]));
  const links = Object.entries(pairs).map(([k, list]) => {
    const [p, q] = k.split("|").map((x) => byslug[x]); if (!p || !q) return "";
    const mx = (p.cx + q.cx) / 2, my = (p.cy + q.cy) / 2;
    return `<path class="plink" data-a="${p.x.slug}" data-b="${q.x.slug}" d="M${f1(p.cx)} ${f1(p.cy)} Q${f1(C + (mx - C) * 0.5)} ${f1(C + (my - C) * 0.5)} ${f1(q.cx)} ${f1(q.cy)}"><title>${list.length} skills overlap (inferred from their names)</title></path>`;
  }).join("");
  const short = (t) => { const n = nodeName(t).replace(/[*$\\]/g, "").replace(/`/g, ""); return n.length > 30 ? n.slice(0, 29) + "…" : n; };
  const title = (s) => { const words = nick(s).split(" "), lines = [""]; words.forEach((w) => ((lines[lines.length - 1] + " " + w).trim().length > 20 ? lines.push(w) : (lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim()))); return lines.slice(0, 3); };
  const groups = clusters.map((c) => {
    const s = c.x, anchor = c.ux > 0.35 ? "start" : c.ux < -0.35 ? "end" : "middle";
    const edges = s.nodes.flatMap((n) => (n.prereqs || []).filter((q) => pos[`${s.slug}/${q}`] && pos[`${s.slug}/${n.id}`]).map((q) => {
      const [ax, ay] = pos[`${s.slug}/${q}`], [bx, by] = pos[`${s.slug}/${n.id}`];
      return `<line class="edge" x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(bx)}" y2="${f1(by)}"/>`;
    })).join("");
    const stars = s.nodes.filter((n) => pos[`${s.slug}/${n.id}`]).map((n) => {
      const [x, y] = pos[`${s.slug}/${n.id}`], cls = statusOf(n, s), r = cls === "m-solid" ? 4.4 : cls === "m-not" ? 2.6 : 3.6;
      return `<g class="node" data-n="${esc(nodeName(n.name).toLowerCase())}" data-x="${f1(x)}" data-y="${f1(y)}"><circle class="star ${cls}" cx="${f1(x)}" cy="${f1(y)}" r="${r}"><title>${esc(nodeName(n.name))} · ${esc(shortTitle(s))}</title></circle><text class="nl" x="${f1(x)}" y="${f1(y + 10)}" text-anchor="middle">${esc(short(n.name))}</text></g>`;
    }).join("") || `<circle class="star m-not" cx="${f1(c.cx)}" cy="${f1(c.cy)}" r="3"/>`;
    // Lines step in em, so a title keeps its shape as the zoom rescales its type.
    const tl = title(s), lift = c.uy < -0.35 ? tl.length - 1 : 0;
    const lines = `<g class="tl" data-p="${(ORBIT[s.status] ?? 1) * 1000 - s.nodes.length}">` + tl.map((l, i) => `<text class="ttl" x="${f1(c.tx)}" y="${f1(c.ty + 4)}" dy="${((i - lift) * 1.25).toFixed(2)}em" text-anchor="${anchor}">${esc(l)}</text>`).join("") + "</g>";
    return `<g class="planet ${s.status === "done" ? "done" : ""}" data-slug="${s.slug}" data-act="subject-zoom" data-arg="${s.slug}" role="button" aria-label="${esc(s.title)}">
      <ellipse class="hit" cx="${f1(c.cx)}" cy="${f1(c.cy)}" rx="${f1(c.len / 2 + 34)}" ry="${f1(c.wid / 2 + 26)}" transform="rotate(${f1(c.d)} ${f1(c.cx)} ${f1(c.cy)})"/>${edges}${stars}${lines}</g>`;
  }).join("");
  const total = S.subjects.reduce((n, x) => n + x.nodes.length, 0);
  const html = `<div class="mapwrap space" id="mapwrap"${skyTheme()}>
    <div class="canvas" id="canvas" style="width:${Math.round(2 * C * SX)}px;height:${2 * C}px">
      <svg class="sys" id="sys" width="${Math.round(2 * C * SX)}" height="${2 * C}" style="position:absolute;left:0;top:0;overflow:visible">
        <defs>${defs}</defs><g class="nebula">${nebula}</g>${links}${groups}<circle class="you" cx="${C}" cy="${C}" r="3"/>
      </svg>
    </div></div>
    <div class="map-search">${icon("search", "sm")}<input id="mapq" placeholder="Search ${total} skills" autocomplete="off" spellcheck="false" aria-label="Search skills"><span class="cap" id="mapqn"></span></div>
    <div class="card float mapctl">
      <button class="btn text" data-act="zoom" data-arg="in" aria-label="Zoom in" data-tip="${key("=")}" data-tip-side="up">+</button><button class="btn text" data-act="zoom" data-arg="out" aria-label="Zoom out" data-tip="${key("-")}" data-tip-side="up">−</button><button class="btn text" data-act="zoom" data-arg="fit" data-tip="${key("0")}" data-tip-side="up">Fit</button>
      <button class="btn sm" data-act="ink" data-tip="${key("↩")}" data-tip-side="up">${VERB[S.ranked[0].kind] || "Start"}</button>
    </div>`;
  if (!put(el, html)) return;
  const wrap = $("mapwrap");
  mapView = mapViews.system || null;
  if (!mapView) fitMap(true);
  mapViews.system = mapView;
  applyMap();
  panZoom(wrap, "system");
  const svg = $("sys");
  svg.querySelectorAll(".planet").forEach((g) => {
    g.addEventListener("mouseenter", () => sysFocus(g.dataset.slug));
    g.addEventListener("mouseleave", () => sysFocus(null));
  });
  const q = $("mapq");
  q.oninput = () => {
    const v = q.value.trim().toLowerCase();
    svg.classList.toggle("searching", !!v);
    let n = 0;
    svg.querySelectorAll(".node").forEach((g) => { const hit = !!v && g.dataset.n.includes(v); g.classList.toggle("hit", hit); n += hit; });
    $("mapqn").textContent = v ? `${n} ${n === 1 ? "skill" : "skills"}` : "";
  };
  q.onkeydown = (e) => {
    if (e.key === "Enter") { const g = svg.querySelector(".node.hit"); if (g) flyTo(viewFor(+g.dataset.x, +g.dataset.y, 1.9), 480); e.preventDefault(); }
    if (e.key === "Escape") { q.value = ""; q.oninput(); q.blur(); e.stopPropagation(); }
  };
}
// The authored moment: the camera flies into the subject's petal, then opens its
// Skill map. Coming back to All skills returns to the view you left.
ACTIONS["subject-zoom"] = (slug) => {
  const b = sysClusters[slug], wrap = $("mapwrap");
  if (!b || !wrap || !mapView) return go("map", slug);
  const saved = { ...mapView };
  const k = Math.min(2.6, Math.max(0.8, 0.6 * Math.min(wrap.clientWidth / (b.x1 - b.x0), wrap.clientHeight / (b.y1 - b.y0))));
  sysFocus(null);
  flyTo(viewFor((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, k), 460, () => { mapViews.system = saved; go("map", slug); });
};
ACTIONS["subject-map"] = (slug) => go("map", slug);
function sysFocus(slug) {
  const svg = $("sys"); if (!svg) return;
  svg.querySelectorAll(".hot").forEach((e) => e.classList.remove("hot"));
  svg.classList.toggle("focus", !!slug);
  if (!slug) return;
  const others = new Set([slug]);
  svg.querySelectorAll(".plink").forEach((e) => { if (e.dataset.a === slug || e.dataset.b === slug) { e.classList.add("hot"); others.add(e.dataset.a); others.add(e.dataset.b); } });
  svg.querySelectorAll(".planet").forEach((g) => { if (others.has(g.dataset.slug)) { g.classList.add("hot"); g.querySelectorAll(".moon").forEach((m) => m.classList.add("hot")); } });
}

// ---------- the tutor's terminal ----------
const T = { term: null, fit: null, running: false, starting: false, startedAt: 0, ended: null, failed: null, drawer: false, lastData: 0,
  queue: [], read: [], deleted: [], landed: new Map(), raw: "", trust: false, trustSeen: false, route: null, routeEnded: false, lastSent: "", interrupted: 0, typed: "", workFrom: 0 };
// Claude Code asks once per folder whether to trust it, and its default answer is
// "No, exit". Its text arrives split by cursor moves, so it is matched without spaces.
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]/g;
// The tutor's first question in a folder it hasn't seen, with the spaces taken out: Claude Code's "Yes, I trust this
// folder", or Codex's "Trust this folder? … 1. Trust and continue" (measured 9 Nov, codex-cli 0.167.0, in a new vault).
const TRUST_ASK = /Yes,Itrustthisfolder|Trustthisfolder\?.*Trustandcontinue/;
// The vault's hook files a message under a subject only after /learn-start,
// /learn-resume, or /learn-practice names it, and stops after /learn-end's turn.
// Flash follows the same rule so a message never lands outside the thread.
const ROUTE_CMD = /^\s*[/$]learn-(start|resume|practice)\s+([A-Za-z0-9][A-Za-z0-9_.-]*)/;
const END_CMD = /^\s*[/$]learn-end(?:\s|$)/;
function noteRoute(text) {
  const m = String(text).match(ROUTE_CMD);
  if (m) { T.route = m[2].replace(/\.$/, "").replace(/\./g, "-"); T.routeEnded = false; }
  else if (END_CMD.test(text)) { T.endPrev = { route: T.route }; T.route = null; T.routeEnded = true; }
  else return;
  if (route.name === "session") paintComposer();
}
function termTheme() {
  const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
  // ANSI colors come from the tokens, so the terminal keeps the app's contrast in both themes.
  return {
    background: v("--term-bg") || v("--color-surface"), foreground: v("--color-ink"), cursor: v("--color-ink"), cursorAccent: v("--term-bg") || v("--color-surface"),
    selectionBackground: v("--color-selected"), black: v("--color-ink"), red: v("--color-coral-text"), green: v("--color-green"), yellow: v("--color-amber-text"),
    blue: v("--subject-code"), magenta: v("--subject-circuits"), cyan: v("--subject-math"), white: v("--color-ink-3"),
    brightBlack: v("--color-ink-3"), brightRed: v("--color-coral"), brightGreen: v("--color-green"), brightYellow: v("--color-amber"),
    brightBlue: v("--subject-code"), brightMagenta: v("--subject-circuits"), brightCyan: v("--subject-math"), brightWhite: v("--color-ink"),
  };
}
async function ensureTerm() {
  if (T.term) return T.term;
  await document.fonts.load('13px "IBM Plex Mono"');
  const term = new window.Terminal({
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 13, lineHeight: 1.25,
    cursorBlink: true, cursorStyle: "bar", scrollback: 10000, allowProposedApi: true,
    macOptionIsMeta: true, theme: termTheme(), drawBoldTextInBrightColors: false, minimumContrastRatio: 4.5,
  });
  T.fit = new window.FitAddon.FitAddon();
  term.loadAddon(T.fit);
  term.loadAddon(new window.WebLinksAddon.WebLinksAddon((_e, url) => F.openExternal(url)));
  term.open($("term"));
  term.onData((d) => {
    if (!T.running) return;
    F.pty.write(d);
    // A command typed straight into the terminal still moves the route.
    for (const ch of d) {
      if (ch === "\r") { noteRoute(T.typed); T.typed = ""; }
      else if (ch === "\x7f") T.typed = T.typed.slice(0, -1);
      else if (ch >= " ") T.typed += ch;
    }
  });
  F.pty.onData((d) => {
    term.write(d);
    const was = busy();
    // A resize (opening the terminal or the plan) makes the tutor's screen redraw; that isn't the tutor writing (6 Nov
    // run-through: "The tutor is writing…" and Stop for 1.3 s, and anything sent then was queued).
    if (was || Date.now() - (T.resizedAt || 0) >= 500) { T.lastData = Date.now(); if (!was) T.workFrom = T.lastData; }
    if (!T.trustSeen) {
      T.raw = (T.raw + d).slice(-8000);
      if (TRUST_ASK.test(T.raw.replace(ANSI, "").replace(/\s+/g, ""))) { T.trust = T.trustSeen = true; afterTermChange(); }
    }
    // Answered in the terminal instead: Claude Code's banner follows a yes; Codex's question leaves the screen.
    else if (T.trust && cfg.host !== "codex" && /ClaudeCodev\d/.test(d.replace(ANSI, "").replace(/\s+/g, ""))) { T.trust = false; afterTermChange(); }
    else if (T.trust && cfg.host === "codex") setTimeout(() => { if (T.trust && !/Trust this folder\?/.test(termTail(30))) { T.trust = false; afterTermChange(); } }, 60);
    if (T.queue.length) scheduleFlush();
    if (!was) paintStatus();
    clearTimeout(T.idle);
    T.idle = setTimeout(paintStatus, 1300);
  });
  F.pty.onExit(() => {
    T.running = false;
    T.ended = new Date();
    T.trust = false; T.route = null; T.routeEnded = false;
    afterTermChange();
  });
  new ResizeObserver(() => fitSoon()).observe($("termcard"));
  T.term = term;
  return term;
}
let fitTimer = null;
function fitSoon() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    if (!T.term || route.name !== "session" || !$("termcard").offsetWidth) return;
    try { T.fit.fit(); } catch { return; }
    if (T.running) { T.resizedAt = Date.now(); F.pty.resize(T.term.cols, T.term.rows); }
  }, 30);
}
function afterTermChange() {
  if (!S) return;
  paintSide();
  if (route.name !== "session") return;
  paintStatus(); paintActs(); paintComposer(); paintDrawerNote();
  if (LOG.data) paintThread(false);
}
async function startTutor(prompt) {
  if (T.starting) return;
  T.starting = true;
  afterTermChange();
  await ensureTerm();
  try { T.fit.fit(); } catch { /* drawer not laid out yet */ }
  T.term.clear();
  T.term.reset();
  T.raw = ""; T.trust = T.trustSeen = false; T.interrupted = 0; T.typed = ""; T.route = null; T.routeEnded = false;
  noteRoute(prompt || "");
  const result = await F.pty.start({ cols: T.term.cols, rows: T.term.rows, prompt: prompt || "" });
  T.starting = false;
  if (result && result.error) {
    T.failed = result.error;
    afterTermChange();
    toast(`Could not start ${tutorName()}: ${result.error}. Check that it runs in Terminal, then try again.`);
    return;
  }
  T.running = true; T.startedAt = Date.now(); T.ended = null; T.failed = null;
  afterTermChange();
  if (T.drawer) T.term.focus(); else focusMsg();
}
// Type into the running tutor as the learner would: the text, then Return.
// Several lines go in as one bracketed paste, so the first line break does not send.
// After Esc, Claude Code puts the interrupted message back in its input box, where
// Flash can't see it. Ctrl+U deletes one screen line or line break per press, and
// an extra press on an empty box does nothing, so Flash presses it generously.
// Each press goes alone: sent in one burst with the text, Claude Code reads the
// whole burst as a paste and Return no longer sends.
// A message is its text, or { text, images } when screenshots were pasted. Each
// image is saved to a temp file and its path pasted before the text, which
// Claude Code attaches as an image; it shows there as [Image #N].
// Return during Chinese or Japanese input confirms the characters. Chromium marks
// that keydown isComposing; keyCode 229 covers the one that ends composition.
const composing = (e) => e.isComposing || e.keyCode === 229;
const msgText = (m) => (typeof m === "string" ? m : (m && m.text) || "");
const msgImages = (m) => (m && typeof m === "object" && m.images) || [];
async function tutorSend(message) {
  const text = msgText(message), images = msgImages(message);
  if (!text && !images.length) return;
  if (!T.running) return startTutor(text);
  await ensureTerm();
  if (T.interrupted) {
    const presses = Math.min(60, T.interrupted + 4);
    T.interrupted = 0;
    for (let i = 0; i < presses; i++) { F.pty.write("\x15"); await new Promise((r) => setTimeout(r, 30)); }
  }
  for (const image of images) {
    const file = await F.saveImage(image.bytes, image.type);
    F.pty.write(`\x1b[200~${file}\x1b[201~`);
    await new Promise((r) => setTimeout(r, 300));
  }
  const body = images.length && text ? ` ${text}` : text;
  if (body) F.pty.write(body.includes("\n") ? `\x1b[200~${body}\x1b[201~` : body);
  setTimeout(() => F.pty.write("\r"), 90);
  // Right after an interrupt, Claude Code can drop that Return. If the message
  // still sits in its input box 1.5s later, press Return once more.
  const probe = text.split("\n")[0].trim().slice(0, 24);
  setTimeout(() => { if (T.running && probe && inputLine().includes(probe)) F.pty.write("\r"); }, 1500);
  T.lastSent = text;
  noteRoute(text);
}
// The text in Claude Code's input box: the last line on screen that starts with
// its ❯ prompt. Earlier ❯ lines are messages already sent.
function inputLine() {
  const b = T.term && T.term.buffer.active;
  if (!b) return "";
  for (let i = b.length - 1; i >= Math.max(0, b.length - 20); i--) {
    const m = b.getLine(i).translateToString(true).match(/^\s*❯\s?(.*)$/);
    if (m) return m[1].trim();
  }
  return "";
}
// What the learner says on a subject's Session goes to that subject. When no
// session is open for it (never resumed, or saved with /learn-end), Flash
// resumes first and sends the message once the tutor is quiet.
const OWN_ROUTE = /^\s*[/$]learn-(start|resume|practice|review|end)\b/;
const IS_CMD = /^\s*[/$]learn-/;
// A check card's answer goes alone too, and never shows as a bubble: the card holds it.
const solo = (m) => IS_CMD.test(msgText(m)) || !!(m && m.check);
// The tutor first resumes a subject whose session isn't the one running. True when it had to.
function routeFirst(slug, text) {
  const s = subj(slug);
  if (!s || !T.running || T.route === s.slug || OWN_ROUTE.test(text)) return false;
  // Already asked: the route moves only once tutorSend has typed it, so never ask twice.
  if (T.routing === s.slug && Date.now() - T.routingAt < 15000) return true;
  T.routing = s.slug; T.routingAt = Date.now();
  tutorSend(command(`${s.status === "done" ? "learn-practice" : "learn-resume"} ${s.slug}`));
  return true;
}
function say(message, slug = route.slug) {
  noteActive(slug); if (S) paintSide();
  if (routeFirst(slug, msgText(message))) return enqueue(message, slug, true);
  tutorSend(message);
  return null;
}
// What you send while the tutor writes goes into the thread as unread and waits
// there (spec C, 31 Oct). When the reply ends, the tutor reads all of it as one
// message. A /learn- command is never joined to anything: it goes alone, in order.
let queueId = 0;
function enqueue(message, slug = route.slug, first = false) {
  const item = { id: ++queueId, slug, message };
  if (first) T.queue.unshift(item); else T.queue.push(item);
  scheduleFlush();
  if (route.name === "session" && LOG.data) paintThread(false);
  return item;
}
// Anything you say goes through here: straight to an idle tutor, into the
// unread run while it writes, or behind messages already waiting.
const holding = () => T.running && (busy() || T.queue.length > 0 || T.trust);
function speak(message) {
  if (holding()) return enqueue(message);
  return say(message);
}
// Break, End, and commands run from Home or the palette wait their turn too.
function sendCommand(text) {
  if (holding()) enqueue(text); else tutorSend(text);
}
// The tutor reads what waits once the terminal has been quiet for 1.5s.
function scheduleFlush() { clearTimeout(T.queueTimer); T.queueTimer = setTimeout(flushQueue, 1500); }
// A picker the tutor is waiting on, in a subject's log: its last question, unanswered.
function pickerWaiting(data) {
  const convos = (data && data.conversations) || [], c = convos[convos.length - 1];
  if (!c) return false;
  const i = c.items.map((x) => x.kind).lastIndexOf("question");
  return i >= 0 && !c.items[i].answered && !c.items[i].withdrawn;
}
// Unread messages wait for a quiet terminal, and never go into a picker the
// tutor is waiting on (keys there would pick an answer) or into Claude Code's
// trust question. `now` is Stop: the reply was just ended, so don't wait for quiet.
async function flushQueue(now) {
  if (T.flushing || !T.running || !T.queue.length || T.trust) return;
  if (!now && busy()) return scheduleFlush();
  T.flushing = true;
  try {
    // The picker that matters is in the log the tutor is writing, which may not be the one on screen.
    const live = T.route || T.queue[0].slug;
    const liveData = live === LOG.slug ? LOG.data : await F.session(live).catch(() => null);
    if (pickerWaiting(liveData) || !T.queue.length) return;   // answering it makes output, which re-arms the timer
    const slug = T.queue[0].slug;
    const data = slug === LOG.slug ? LOG.data : slug === live ? liveData : await F.session(slug).catch(() => null);
    if (!T.queue.length || T.queue[0].slug !== slug) return scheduleFlush();
    await sendHead(slug, data);
  } finally { T.flushing = false; }
}
async function sendHead(slug, data) {
  const head = T.queue[0];
  if (routeFirst(slug, msgText(head.message))) return;
  let take = 1;
  if (!solo(head.message)) {
    while (take < T.queue.length && T.queue[take].slug === slug && !solo(T.queue[take].message)) take++;
  }
  const items = T.queue.splice(0, take);
  const parts = items.map((i) => msgText(i.message).trim()).filter(Boolean);
  const images = items.flatMap((i) => msgImages(i.message));
  const text = parts.join("\n\n");
  T.deleted = T.deleted.filter((d) => d.item.slug !== slug);
  if (!solo(head.message)) markRead(items, parts, text, slug, data, images.length > 0);
  if (images.length) rememberSent(text, images);
  if (route.name === "session" && LOG.data) paintThread(false);
  await tutorSend(images.length ? { text, images } : text);
}
const sessionOpen = () => !T.running || !subj(route.slug) || T.route === route.slug;
ACTIONS["tutor-start"] = (arg) => startTutor(arg === "plain" ? "" : arg);
ACTIONS.hint = () => T.running ? (speak("Can I have a hint?") || sendGlide(showSent("Can I have a hint?"), null)) : toast(`The tutor isn't running. Open Session to start ${tutorName()}.`);
ACTIONS.check = () => T.running ? speak(command("learn-check")) : route.slug ? say(command("learn-check")) : null;
ACTIONS.break = () => T.running && sessionOpen() ? sendCommand(command("learn-end break")) : toast(T.running ? "This session is already saved." : "No session is running.");
ACTIONS.end = () => T.running && sessionOpen() ? sendCommand(command("learn-end")) : toast(T.running ? "This session is already saved." : "No session is running.");
ACTIONS.restart = async () => { await F.pty.stop(); T.running = false; startTutor(""); };
ACTIONS.interrupt = () => {
  if (!T.running) return;
  F.pty.write("\x1b");
  // Stopped while /learn-end (or a break) was still running: the session was not saved, so it stays open (6 Nov run-through:
  // End and Break then refused with "already saved" while the note had no end).
  if (T.routeEnded && T.endPrev && busy()) { T.route = T.endPrev.route; T.routeEnded = false; T.endPrev = null; if (route.name === "session") { paintComposer(); paintActs(); } }
  const cols = Math.max(20, ((T.term && T.term.cols) || 80) - 6);
  T.interrupted = T.lastSent.split("\n").reduce((n, line) => n + 2 + Math.floor(line.length / cols), 0);
  // Stop ends the reply, so the tutor reads your unread messages at once.
  if (T.queue.length) { clearTimeout(T.stopTimer); T.stopTimer = setTimeout(() => flushQueue(true), 300); }
};
// Claude Code's trust question, answered from the thread: down selects "Yes".
ACTIONS.trust = (answer) => {
  if (!T.running || !T.trust) return;
  T.trust = false;
  // Claude Code's picker starts on "No, exit", so yes is one row down; Codex's starts on "Trust and continue".
  if (answer === "yes") { if (cfg.host === "codex") F.pty.write("\r"); else { F.pty.write("\x1b[B"); setTimeout(() => F.pty.write("\r"), 120); } }
  else {
    const kept = T.queue.filter((q) => !solo(q.message)).map((q) => msgText(q.message)).filter(Boolean).join("\n\n");
    // A card answer that was waiting is not sent now, so its card waits for you again.
    T.queue.forEach((q) => { if (q.message && q.message.check && CARDS.has(q.message.check)) CARDS.get(q.message.check).sent = null; });
    T.queue = [];
    if (kept && msgEmpty()) setMsg(kept);
    // Claude Code's highlighted answer is "No, exit". Codex's is "Trust and continue", so Return would trust; the
    // tutor is stopped instead, as Claude Code's no does.
    if (cfg.host === "codex") { F.pty.stop().then(() => { T.running = false; T.ended = new Date(); afterTermChange(); }); }
    else F.pty.write("\r");
  }
  afterTermChange();
};
ACTIONS["toggle-term"] = () => {
  if (route.name !== "session") go("session");
  T.drawer = !T.drawer;
  $("drawer").classList.toggle("on", T.drawer);
  paintIslands();
  paintDrawerNote();
  if (T.drawer) { fitSoon(); setTimeout(() => T.term && T.term.focus(), 220); } else focusMsg();
};
// ---------- answering the tutor's question from the thread ----------
// Claude Code's picker, measured 7 Nov (v2.1.319): with one question a number picks that option and sends it; with
// several, each number answers one and moves to the next, and a review asks to submit (1). The option after the last,
// "Type something", takes your words and Return. One that takes several answers draws checkboxes ([ ] / [✔]).
const PICKS = { sel: {}, items: {}, sending: false };
function termTail(n = 40) {
  const b = T.term && T.term.buffer.active; if (!b) return "";
  const out = []; for (let i = Math.max(0, b.length - n); i < b.length; i++) out.push(b.getLine(i).translateToString(true));
  return out.join("\n");
}
const pickerLive = () => /Enter to select/.test(termTail());
const pickerMulti = () => /\[[ ✔]\]/.test(termTail().split(/Enter to select/)[0].split("\n").slice(-30).join("\n"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function pickKeys(k) {
  const it = PICKS.items[k], st = PICKS.sel[k] || {}; if (!it || PICKS.sending) return;
  if (!pickerLive()) { toast("The tutor isn't waiting on that question anymore."); return; }
  PICKS.sending = true;
  try {
    for (const [gi, g] of (it.groups || []).entries()) {
      const a = st[gi];
      if (typeof a === "string") { F.pty.write(String(g.options.length + 1)); await wait(200); F.pty.write(a.replace(/[\r\n]+/g, " ")); await wait(150); F.pty.write("\r"); }
      else F.pty.write(String(a + 1));
      await wait(300);
    }
    if ((it.groups || []).length > 1) { await wait(200); F.pty.write("1"); }
  } finally { PICKS.sending = false; }
  LOG.asked = k;
}
ACTIONS.pick = (arg) => {
  const [k, gi, n] = String(arg).split("|"), it = PICKS.items[k]; if (!it) return;
  (PICKS.sel[k] = PICKS.sel[k] || {})[+gi] = +n;
  paintThread(false);
  if ((it.groups || []).length === 1) pickKeys(k);
};
ACTIONS["pick-send"] = (k) => pickKeys(k);
document.addEventListener("input", (e) => {
  const el = e.target.closest && e.target.closest(".pick-other"); if (!el) return;
  (PICKS.sel[el.dataset.key] = PICKS.sel[el.dataset.key] || {})[+el.dataset.g] = el.value;
  el.closest(".option").classList.toggle("sel", !!el.value.trim());
  const go = document.querySelector(`[data-act="pick-send"][data-arg="${el.dataset.key}"]`);
  if (go) { const it = PICKS.items[el.dataset.key], st = PICKS.sel[el.dataset.key]; go.disabled = !(it.groups || []).every((_, gi) => st[gi] !== undefined && st[gi] !== ""); }
});
document.addEventListener("keydown", (e) => {
  const el = e.target.closest && e.target.closest(".pick-other"); if (!el || e.key !== "Enter" || composing(e)) return;
  e.preventDefault(); e.stopPropagation();
  const k = el.dataset.key, it = PICKS.items[k]; if (!it || !el.value.trim()) return;
  if ((it.groups || []).length === 1) pickKeys(k); else { const go = document.querySelector(`[data-act="pick-send"][data-arg="${k}"]`); if (go && !go.disabled) pickKeys(k); }
}, true);
ACTIONS["open-term"] = () => { if (!T.drawer) ACTIONS["toggle-term"](); else if (T.term) T.term.focus(); };
function paintDrawerNote() {
  $("drawerNote").textContent = T.running ? `${tutorName()} in your vault` : T.starting ? "Starting…" : "";
  const empty = $("drawerEmpty");
  empty.classList.toggle("on", !T.running && !T.starting);
  empty.innerHTML = `<span class="empty-icon">${icon("terminal")}</span><b class="t-sec">The tutor isn't running</b><p>The tutor runs here during a session. Resume, or send a message, to start it.</p><button class="btn neutral" data-act="tutor-start" data-arg="plain">Start the tutor</button>`;
}

// ---------- session ----------
const LOG = { slug: null, data: null, tab: "log", showAll: false, think: {}, unfold: {}, stick: true, asked: null, changedAt: 0 };
const sessionCache = {};
function prefetchSession(slug) { if (slug && !sessionCache[slug]) sessionCache[slug] = F.session(slug); }

// The session you are most likely to open next (Home's recommendation) is drawn before the window first shows,
// hidden but laid out (styles.css, "#session.hidden"), so the first glide into it costs what later ones do: drawn on
// the glide instead, its first layout held one frame for 110 to 170 ms (measured 5 Nov).
async function warmSession(slug) {
  if (!slug || LOG.slug || route.name !== "home" || !subj(slug)) return;
  prefetchSession(slug);
  const data = await sessionCache[slug];
  if (LOG.slug || route.name !== "home") return;   // you went somewhere first
  LOG.slug = slug; LOG.showAll = false; LOG.think = {}; LOG.unfold = {}; LOG.stick = true; SC.follow = false; LOG.tab = "log"; LOG.data = data;
  const keep = route.slug, ink = inkAction; route.slug = slug;
  try { paintThread(true); } finally { route.slug = keep; inkAction = ink; }   // Home's ↩ stays Home's (paintActs sets the session's)
}
async function paintSession() {
  const s = subj(route.slug);
  paintActs(); paintComposer(); paintDrawerNote();
  MD.preload();   // so the first formula of a reply never holds its words back while KaTeX loads
  loadDraft(s ? s.slug : null);
  await ensureTerm();
  fitSoon();
  if (!s) {
    LOG.slug = null;
    LOG.data = { conversations: [], note: null };
    return paintThread(true);
  }
  if (LOG.slug !== s.slug) {
    LOG.slug = s.slug; LOG.showAll = false; LOG.think = {}; LOG.unfold = {}; LOG.stick = true; SC.follow = false; LOG.tab = "log";
    prefetchSession(s.slug);
    const data = await sessionCache[s.slug];
    if (LOG.slug !== s.slug) return;
    LOG.data = data;
    paintIslands(); paintComposer();
    paintThread(true);
    if (sessionArrive) { sessionArrive = false; requestAnimationFrame(() => arrive($("session"))); }   // drawn: now it rises
  } else paintThread(false);
  if (!T.drawer) focusMsg();
}
function resumeTyped(s) {
  const found = S.ranked.find((x) => x.subject === s.slug && x.kind !== "Repair") || { command: `learn-resume ${s.slug}`, subject: s.slug };
  return s.status === "done" ? command(`learn-practice ${s.slug}`) : found.typed || command(found.command);
}
// Hint, Check me, Break, and End while the tutor runs. When it doesn't, the dock
// holds the screen's one filled button, unless the empty thread already does.
function paintActs() {
  const s = subj(route.slug), el = $("acts");
  if (T.running || T.starting) {
    inkAction = null; composerIdle = null;
    const acts = [["hint", "hint", "Hint", key("/")], ["check", "checkme", "Check me", key("J")], ["break", "pause", "Break", key("B")], ["end", "end", "End", keyShift("E")]];
    el.innerHTML = acts.map(([a, ic, label, k]) => `<button class="btn text" data-act="${a}" data-tip="${k}" data-tip-side="up" ${T.running ? "" : "disabled"}>${icon(ic, "sm")}${label}</button>`).join("");
    return;
  }
  const typed = s ? resumeTyped(s) : command("learn-start");
  inkAction = T.ended && !s ? () => startTutor("") : () => startTutor(typed);
  const verb = T.ended ? "Start again" : s ? (s.status === "done" ? "Practice" : "Resume") : "Start";
  const hasLog = logEntries().some((e) => e.key.includes(":"));
  // Not running (6 Nov, Edison: Resume and Close out "stuck out" above the box, "handled ugly"; 7 Nov: still too many
  // buttons in the box). With the box empty its send button turns into Resume, same size, a play mark, the one thing
  // ↩ does here; typing turns it back into send (a message resumes too). Close out lives in the subject's name menu.
  el.innerHTML = "";
  composerIdle = hasLog ? verb : null;
  paintSend();
}
let composerIdle = null;   // the composer's Resume label while the tutor is off (paintActs)
function closeBtn(s, big) {
  const state = closing === s.slug ? "run" : closeQueue.includes(s.slug) ? "wait" : "";
  const tip = state === "wait" ? "Waiting for the close-out running now" : "Finished with this subject? Settles any open session and moves it to Done";
  const label = state === "run" ? `<i class="spin"></i>Closing out` : state === "wait" ? `${icon("pause", "sm")}Queued` : `${icon("check", "sm")}Close out`;
  return `<button class="btn neutral ${big ? "" : "sm"}" data-act="close-open" data-arg="${s.slug}" ${state === "run" || state === "wait" ? "disabled" : ""} data-tip="${tip}" data-tip-side="up">${label}</button>`;
}
function paintComposer() {
  const msg = $("msg");
  const s = subj(route.slug);
  msg.dataset.placeholder = T.running && !sessionOpen() ? (T.routeEnded ? "Session saved. Send a message to start a new one" : `Message your tutor to resume ${subName(s)}`)
    : T.running ? "Reply to your tutor, or paste a screenshot" : T.starting ? `Starting ${tutorName()}…` : s ? `Message your tutor to resume ${subName(s)}` : "Message your tutor to start";
  const convos = (LOG.data && LOG.data.conversations) || [];
  const model = prettyModel([...convos].reverse().map((c) => c.model).find(Boolean));
  $("model").innerHTML = `${esc(model || tutorName())}${icon("down", "dn")}`;
  $("model").dataset.tip = T.running ? "Change the model in the terminal" : "The model the tutor used last";
  $("model").dataset.tipSide = "up";
  paintSend();
}
function paintSend() {
  const send = $("send");
  if (!send) return;
  const stop = busy() && msgEmpty() && !ATT.length;
  const resume = !stop && composerIdle && !T.running && !T.starting && msgEmpty() && !ATT.length;
  send.classList.toggle("resume", !!resume);
  if (resume) {
    send.dataset.act = "ink"; send.setAttribute("aria-label", composerIdle); send.dataset.tip = `${composerIdle}  ${key("↩")}`; send.dataset.tipSide = "up";
    send.innerHTML = icon("send", "sm"); send.disabled = false; return;   // the send arrow (7 Nov: a play mark read as a media button)
  }
  delete send.dataset.tip;
  send.dataset.act = stop ? "interrupt" : "send";
  send.setAttribute("aria-label", stop ? "Stop the tutor" : "Send");
  send.innerHTML = icon(stop ? "stop" : "send", "sm");
  send.disabled = !stop && msgEmpty() && !ATT.length;
}
ACTIONS.send = () => {
  const text = msgValue().trim();
  if (!text && !ATT.length) { if (composerIdle && !T.running && !T.starting) ACTIONS.ink(); return; }   // ↩ in an empty box resumes
  const message = ATT.length ? { text, images: ATT.splice(0) } : text;
  if (message.images) rememberSent(text, message.images);
  paintAttach();
  const from = lineRect();
  setMsg("");
  noteActive(route.slug); paintSide();
  if (!T.running) {
    const s = subj(route.slug);
    rise(enqueue(message), from);
    startTutor(s ? resumeTyped(s) : "");
  } else {
    const item = speak(message);
    if (item) rise(item, from);
    else if (text && !IS_CMD.test(text)) sendGlide(showSent(message), from);
  }
};
// A message sent straight to the tutor shows in the thread at once, in ink, and
// hands over to the log's copy when the hook writes it.
function showSent(message) {
  const item = { id: ++queueId, slug: route.slug, message }, text = msgText(message).trim();
  T.read.push({ slug: item.slug, items: [item], text, seen: youCount(LOG.data, text), at: Date.now(), ink: 1 });
  if (route.name === "session" && LOG.data) paintThread(false);
  return item;
}
ACTIONS.model = () => {
  if (!T.running) return toast(`Start the tutor first, then change its model with ${sigil()}model.`);
  ACTIONS["open-term"]();
  tutorSend(`${sigil()}model`);
};
ACTIONS.attach = async () => {
  const file = await F.chooseFile();
  if (!file) return;
  focusMsg();
  document.execCommand("insertText", false, `@${file.includes(" ") ? `"${file}"` : file} `);
};
// ---------- the message box ----------
// Editable text with inline math chips, Desmos style. $ or ⌘E opens a chip
// (MathLive's <math-field>) at the caret: / stacks a fraction, ^ raises an
// exponent, int, sqrt, sum, and pi turn into symbols. Arrow past either end,
// Escape, or $ leaves the chip; $ in an empty chip types a plain $ instead.
// The tutor receives each chip as $LaTeX$, which the thread renders as math.
const MSG = $("msg");
if (window.MathLive) {
  MathLive.MathfieldElement.soundsDirectory = null;
  MathLive.MathfieldElement.plonkSound = null;
}
function msgValue() {
  let out = "";
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.tagName === "MATH-FIELD") { const v = n.value.trim(); if (v) out += `$${v}$`; }
      else if (n.tagName === "BR") out += "\n";
      else { if (/^(DIV|P)$/.test(n.tagName) && out && !out.endsWith("\n")) out += "\n"; walk(n); }
    }
  };
  walk(MSG);
  return out.replace(/\u200b/g, "").replace(/\u00a0/g, " ");
}
const msgEmpty = () => !msgValue().trim();
// A message with $…$ in it comes back as text and chips.
function setMsg(text) {
  MSG.textContent = "";
  String(text || "").split(/(\$[^$\n]+\$)/).forEach((part) => {
    if (/^\$[^$]+\$$/.test(part) && window.MathLive) MSG.append(makeChip(part.slice(1, -1)).chip, "\u200b");
    else if (part) MSG.append(part);
  });
  afterMsgInput();
}
function focusMsg() {
  if (MSG.contains(document.activeElement)) return;
  MSG.focus({ preventScroll: true });
  caretAt(MSG, "end");
}
function caretAt(node, where) {
  const range = document.createRange(), sel = getSelection();
  if (where === "end") { range.selectNodeContents(node); range.collapse(false); }
  else if (where === "after") { range.setStartAfter(node); range.collapse(true); }
  else { range.setStartBefore(node); range.collapse(true); }
  sel.removeAllRanges(); sel.addRange(range);
}
// The field sits in a non-editable wrapper, so the box treats it as one unit.
// (contenteditable="false" on the field itself stops MathLive taking keys.)
function makeChip(latex) {
  const chip = document.createElement("span");
  chip.className = "chip-wrap";
  chip.setAttribute("contenteditable", "false");
  const mf = new MathLive.MathfieldElement();
  mf.chip = chip;
  chip.append(mf);
  mf.mathVirtualKeyboardPolicy = "manual";
  mf.value = latex || "";
  mf.addEventListener("move-out", (e) => {
    e.preventDefault();
    leaveChip(mf, e.detail.direction === "backward" ? "before" : "after");
  });
  mf.addEventListener("input", () => paintSend());
  mf.addEventListener("focusout", () => setTimeout(() => {
    if (document.activeElement !== mf && !mf.value.trim()) { chip.remove(); afterMsgInput(); }
  }));
  return mf;
}
function leaveChip(mf, side) {
  const chip = mf.chip || mf;
  MSG.focus({ preventScroll: true });
  if (side === "before") return caretAt(chip, "before");
  let t = chip.nextSibling;
  if (!t || t.nodeType !== 3) { t = document.createTextNode("\u200b"); chip.after(t); }
  const r = document.createRange(), sel = getSelection();
  r.setStart(t, t.nodeValue.startsWith("\u200b") ? 1 : 0); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}
function insertMath() {
  if (!window.MathLive) return toast("The math editor didn't load. Type math as LaTeX between $ signs instead.");
  if (route.name !== "session") return;
  MSG.focus({ preventScroll: true });
  const sel = getSelection();
  let range = sel.rangeCount && MSG.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
  if (!range) { range = document.createRange(); range.selectNodeContents(MSG); range.collapse(false); }
  range.deleteContents();
  const mf = makeChip("");
  range.insertNode(mf.chip);
  mf.chip.after("\u200b");
  afterMsgInput();
  requestAnimationFrame(() => mf.focus());
}
ACTIONS.math = () => insertMath();
function afterMsgInput() {
  // A box emptied by deleting keeps a stray <br>; clearing it brings the placeholder back.
  if (!MSG.querySelector("math-field") && !MSG.textContent.replace(/\u200b/g, "").trim()) MSG.textContent = "";
  paintSend();
  fadeTop();
  saveDraftSoon();
}
let lastTyped = 0;
// Typing releases every word still waiting to arrive: you have moved on from reading.
MSG.addEventListener("input", () => { lastTyped = Date.now(); ARRIVE.flush(); afterMsgInput(); });
// Past a third of the window the box scrolls inside, and its top line fades.
function fadeTop() { MSG.classList.toggle("fade-top", MSG.scrollTop > 0); }
MSG.addEventListener("scroll", fadeTop);
// A half-typed reply stays with its subject, across switching and quitting.
const DRAFTS = (() => { try { return JSON.parse(localStorage.getItem("flash-drafts") || "{}"); } catch { return {}; } })();
let draftSlug;   // the subject the box holds a draft for; undefined before Session first opens
let draftTimer = null;
const ATT_BY = {};
const draftKey = (slug) => slug || "-";
function saveDraft() {
  clearTimeout(draftTimer);
  if (draftSlug === undefined) return;
  const v = msgValue();
  if (v.trim()) DRAFTS[draftKey(draftSlug)] = v; else delete DRAFTS[draftKey(draftSlug)];
  localStorage.setItem("flash-drafts", JSON.stringify(DRAFTS));
}
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 250); }
function loadDraft(slug) {
  if (draftSlug === slug) return;
  saveDraft();
  // Pasted images stay with their subject too, while Flash is open.
  if (draftSlug !== undefined) ATT_BY[draftKey(draftSlug)] = ATT.splice(0);
  draftSlug = slug;
  ATT.push(...(ATT_BY[draftKey(slug)] || []));
  paintAttach();
  setMsg(DRAFTS[draftKey(slug)] || "");
}
window.addEventListener("beforeunload", () => { saveDraft(); unreadToDrafts(); });
// The thread's end clears the dock however tall the box has grown, and a thread
// that was at its end stays there.
new ResizeObserver(() => {
  const b = $("threadScroll"), near = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
  $("session").style.setProperty("--dock-h", `${$("dock").offsetHeight}px`);
  if (near) b.scrollTop = b.scrollHeight;
}).observe($("dock"));
// Capture phase, so a chip's keys are handled before MathLive sees them.
MSG.addEventListener("keydown", (e) => {
  const chip = e.target.closest && e.target.closest("math-field");
  if (chip) {
    if (e.key === "$") {
      e.preventDefault(); e.stopPropagation();
      if (!chip.value.trim()) { const box = chip.chip || chip, at = box.previousSibling; box.remove(); MSG.focus(); if (at) caretAt(at, "after"); document.execCommand("insertText", false, "$"); }
      else leaveChip(chip, "after");
    } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); leaveChip(chip, "after"); }
    else if (e.key === "Enter" && !e.shiftKey && !composing(e)) { e.preventDefault(); e.stopPropagation(); ACTIONS.send(); }
    return;
  }
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (composing(e)) return;   // Chinese or Japanese input: Return confirms the characters, never sends
  if (e.key === "$" && !e.metaKey && !e.ctrlKey && window.MathLive) { e.preventDefault(); insertMath(); }
  else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ACTIONS.send(); }
  else if (e.key === "Escape") { if (escapeSession()) e.preventDefault(); }
  else if (e.key === "ArrowUp" && !e.shiftKey && !mod && !e.altKey && msgEmpty() && !ATT.length) { if (editLast()) e.preventDefault(); }
  else if (mod && !e.shiftKey && e.key.toLowerCase() === "z" && lastDeleted() && (msgEmpty() || lastDeleted().when > lastTyped)) { if (undoDelete()) e.preventDefault(); }
}, true);
// Esc closes the innermost thing first, then stops the tutor. (Menus, the
// palette, and a math chip catch it before this.) True when it did something.
function escapeSession() {
  if (route.name !== "session") return false;
  if (T.drawer) { ACTIONS["toggle-term"](); return true; }
  if (busy()) { ACTIONS.interrupt(); return true; }
  return false;
}
// Pasted or dropped images wait in the composer as thumbnails, so you see what
// you are sending, and go to the tutor with the message (tutorSend).
const ATT = [];
function addImage(file) {
  if (!file || !file.type.startsWith("image/")) return false;
  file.arrayBuffer().then((buf) => { ATT.push({ url: URL.createObjectURL(file), bytes: new Uint8Array(buf), type: file.type }); paintAttach(); focusMsg(); });
  return true;
}
function paintAttach() {
  const el = $("attach");
  el.innerHTML = ATT.map((a, i) => `<span class="att"><img src="${a.url}" alt="Pasted image ${i + 1}"><button data-act="unattach" data-arg="${i}" aria-label="Remove image ${i + 1}" data-tip="Remove" data-tip-side="up">${icon("plus")}</button></span>`).join("");
  el.classList.toggle("on", ATT.length > 0);
  paintSend();
}
ACTIONS.unattach = (i) => { ATT.splice(Number(i), 1); paintAttach(); focusMsg(); };
MSG.addEventListener("paste", (e) => {
  if (e.target.closest && e.target.closest("math-field")) return;
  const files = [...(e.clipboardData ? e.clipboardData.items : [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
  e.preventDefault();
  if (files.length) return files.forEach(addImage);
  // Text arrives plain, so no formatting from a web page lands in the box.
  document.execCommand("insertText", false, (e.clipboardData && e.clipboardData.getData("text/plain")) || "");
});
$("composer").addEventListener("dragover", (e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) e.preventDefault(); });
$("composer").addEventListener("drop", (e) => {
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  e.preventDefault();
  files.forEach(addImage);
});

function paintThread(full) {
  if (LOG.tab === "note") return paintNote();
  paintLog(full);
}
function paintNote() {
  const el = $("thread"), note = LOG.data && LOG.data.note;
  el.innerHTML = note ? `<div class="note"><div class="t-sec" style="margin-bottom:8px">${noteLabel(note.name)} · ${longD(note.name)}</div>${renderMd(note.text.replace(/^# .*\n/, ""))}</div>`
    : `<div class="thread-empty"><span class="empty-icon">${icon("note")}</span><b class="t-sec">No session note yet</b><p>The tutor writes one when a session starts, and it fills in here as you go.</p></div>`;
  typeset(el);
}
ACTIONS["toggle-note"] = () => { LOG.tab = LOG.tab === "note" ? "log" : "note"; paintIslands(); paintThread(true); };

// The thread, drawn item by item: a streaming reply repaints only itself, so the
// rest of the thread, its diagrams, and your scroll position stay put.
const SHOW = 80;
function logEntries() {
  const convos = (LOG.data && LOG.data.conversations) || [];
  const out = [];
  settleRead();
  LOG.cards = new Map(); LOG.liveCard = null; LOG.writingCard = null; LOG.warm = null;
  const fold = cardsAll(convos);
  let brk = null;   // the last break, so the resume after it can say how long you were away
  convos.forEach((c, ci) => {
    // A conversation can run past midnight without a new date: a time earlier than the
    // one before it is the next day.
    let day = 0, prevMin = -1;
    out.push({ key: `c${ci}`, html: `<div class="convo-sep">${longD(c.date)}${c.model ? ` · ${esc(prettyModel(c.model))}` : ""}</div>` });
    const lastQ = ci === convos.length - 1 ? c.items.map((x) => x.kind).lastIndexOf("question") : -1;
    c.items.forEach((it, i) => {
      const hm = /^(\d{1,2}):(\d{2})$/.exec(String(it.time || "").trim());
      if (hm) { const mins = +hm[1] * 60 + +hm[2]; if (prevMin >= 0 && mins < prevMin) day++; prevMin = mins; }
      if (fold.has(`${ci}:${i}`)) return;   // your answer to a check card shows on the card, not as a bubble
      let back = "";
      if (it.kind === "you" && IS_CMD.test(it.text)) {
        const at = logTime(c.date, it.time, day);
        if (/^\s*[/$]learn-end\s+break\b/.test(it.text)) brk = at;
        else if (/^\s*[/$]learn-(resume|start|practice)\b/.test(it.text) && brk && at) back = backAfter(brk, at);
        if (!/^\s*[/$]learn-end\s+break\b/.test(it.text)) brk = null;
      }
      const waiting = i === lastQ && !it.answered && !it.withdrawn && T.running;
      const html = itemHtml(it, waiting, `${ci}:${i}`, back);
      // Your read messages hand over to the log's copy in place, with no entrance.
      const landed = it.kind === "you" ? T.landed.get(norm(it.text)) : null;
      if (html) out.push({ key: `${ci}:${i}`, html, waiting, noEnter: !!landed, landed, tutor: it.kind === "tutor", check: it.kind === "check" });
    });
  });
  if (T.trust) out.push({ key: "x:trust", html: trustHtml() });
  // Yours that the tutor has just read wait here until the log shows them, so
  // nothing blinks between Flash sending them and the hook writing them down.
  T.read.filter((r) => r.slug === LOG.slug).forEach((r) => r.items.forEach((q) => { if (!solo(q.message)) out.push({ key: `x:q${q.id}`, html: queuedHtml(q, false), mine: true, noEnter: true }); }));
  const unread = T.queue.filter((q) => q.slug === LOG.slug && !solo(q.message));
  unread.forEach((q) => out.push({ key: `x:q${q.id}`, html: queuedHtml(q, true), mine: true, noEnter: true }));
  if (unread.length) out.push({ key: "x:after", html: `<div class="after-reply">After this reply</div>`, mine: true, noEnter: true });
  return out;
}
function queuedHtml(q, unread) {
  const text = msgText(q.message), shots = msgImages(q.message).map((im) => `<img src="${im.url}" alt="Screenshot you pasted">`).join("");
  const bubble = `<span class="bubble">${shots ? `<span class="shots">${shots}</span>` : ""}${youText(text)}</span>`;
  if (!unread) return `<div class="me"><span class="me-b">${bubble}</span></div>`;
  return `<div class="me unread"><span class="me-b"><span class="me-acts"><button class="btn text" data-act="q-edit" data-arg="${q.id}">Edit</button><button class="btn text" data-act="q-delete" data-arg="${q.id}">Delete</button></span>${bubble}</span></div>`;
}
// ---------- unread messages: read, edited, deleted, and how they move ----------
// Compared without pasted images, which the log writes as [Image #N] or an embed.
const norm = (t) => String(t || "").replace(/\[Image #\d+\]/g, "").replace(/!\[\[[^\]]+\]\]/g, "").replace(/\s+/g, " ").trim();
// Joined messages, by their text, so the log shows them as the run you sent.
const JOINED = (() => { try { return JSON.parse(localStorage.getItem("flash-joined") || "{}"); } catch { return {}; } })();
function rememberJoin(text, parts) {
  if (parts.length < 2) return;
  JOINED[norm(text)] = parts;
  const keys = Object.keys(JOINED);
  keys.slice(0, Math.max(0, keys.length - 50)).forEach((k) => delete JOINED[k]);
  localStorage.setItem("flash-joined", JSON.stringify(JOINED));
}
const youCount = (data, text) => {
  const n = norm(text), convos = (data && data.conversations) || [];
  return convos.reduce((c, convo) => c + convo.items.filter((it) => it.kind === "you" && norm(it.text) === n).length, 0);
};
function markRead(items, parts, text, slug, data, images) {
  if (!images) rememberJoin(text, parts);   // a run with screenshots shows as one bubble, images first
  T.read.push({ slug, items, text, seen: data ? youCount(data, text) : -1, at: Date.now() });
  items.forEach((q) => { q.justRead = true; });
}
// A read message leaves once the log holds it (one more copy than when it was
// sent), or after a minute if the hook never writes it.
function settleRead() {
  T.read = T.read.filter((r) => {
    if (Date.now() - r.at > 60000) return false;
    if (r.slug !== LOG.slug) return true;
    if (r.seen < 0) { r.seen = youCount(LOG.data, r.text); return true; }
    if (youCount(LOG.data, r.text) <= r.seen) return true;
    T.landed.set(norm(r.text), r);
    return false;
  });
}
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// One number from 0 to 1 on a named spring. Reduce motion jumps to the end.
function tween(feel, fn) {
  if (calm()) { fn(1); return Promise.resolve(); }
  fn(0);   // the starting state paints now, not on the next tick, so nothing flashes at its end state for a frame
  return window.motion.spring(0, { to: 1, feel, onUpdate: fn }).done;
}
const queueNode = (id) => document.querySelector(`#thread .item[data-key="x:q${id}"]`);
// Where the first line of the box starts, so a message can rise from it.
function lineRect() {
  const r = MSG.getBoundingClientRect(), cs = getComputedStyle(MSG);
  return { left: r.left + parseFloat(cs.paddingLeft || 0), top: r.top + parseFloat(cs.paddingTop || 0) };
}
// Your message rises from the line you typed it on into its place in the thread,
// its fill gathering on the way. "After this reply" waits until it lands.
function rise(item, from, feel = "settle") {
  const node = item && queueNode(item.id);
  const after = document.querySelector('#thread .item[data-key="x:after"]');
  if (!node || !from) return;
  const b = node.querySelector(".bubble");
  if (calm()) return;
  const to = b.getBoundingClientRect(), cs = getComputedStyle(b);
  // It rises only if its place is in view; below the fold, the pill says it is there.
  if (feel === "settle" && to.top > scroller.getBoundingClientRect().top + scroller.clientHeight - dockH()) return;
  const dx = from.left - (to.left + parseFloat(cs.paddingLeft)), dy = from.top - (to.top + parseFloat(cs.paddingTop));
  if (after) after.style.opacity = "0";
  node.classList.add("rising");   // its Edit and Delete wait until it lands
  tween(feel, (v) => {
    b.style.transform = v >= 1 ? "" : `translate(${(dx * (1 - v)).toFixed(1)}px, ${(dy * (1 - v)).toFixed(1)}px)`;
    b.style.background = v >= 1 ? "" : `color-mix(in srgb, var(--color-bubble) ${(100 * Math.min(1, v)).toFixed(1)}%, transparent)`;
  }).then(() => {
    node.classList.remove("rising");
    const cap = document.querySelector('#thread .item[data-key="x:after"]');
    if (cap && cap.style.opacity === "0") tween("snappy", (v) => { cap.style.opacity = v >= 1 ? "" : String(v); });
  });
}
// Read: your words settle from ink 2 to ink.
function settleInk() {
  T.read.forEach((r) => r.items.forEach((q) => {
    if (!q.justRead) return;
    const b = queueNode(q.id) && queueNode(q.id).querySelector(".bubble");
    if (!b) return;
    q.justRead = false;
    r.ink = 0;
    tween("snappy", (v, velocity) => { r.ink = v; r.inkSpeed = velocity || 0; inkAt(b, v); });
  }));
}
const inkAt = (b, v) => { b.style.color = v >= 1 ? "" : `color-mix(in srgb, var(--color-ink) ${(100 * v).toFixed(1)}%, var(--color-ink-2))`; };
// The log's copy takes over mid-change: it carries on from where the ink had got to.
function carryInk(node, r) {
  if (!(r.ink < 1) || calm()) return;
  const bubbles = [...node.querySelectorAll(".bubble")];
  bubbles.forEach((b) => inkAt(b, r.ink));
  window.motion.spring(r.ink, { to: 1, feel: "snappy", velocity: r.inkSpeed, onUpdate: (v) => bubbles.forEach((b) => inkAt(b, v)) });
}
// Anything of yours a change above pushes down glides there instead of jumping.
// Measured on screen, so while the thread follows the bottom they stay put and
// the reply scrolls up instead.
function measureMine() {
  const m = new Map();
  document.querySelectorAll('#thread .item[data-key^="x:"]').forEach((n) => m.set(n, n.getBoundingClientRect().top));
  return m;
}
function glideMine(before) {
  if (calm()) return;
  before.forEach((top, n) => {
    if (!n.isConnected) return;
    const delta = top - n.getBoundingClientRect().top;
    if (Math.abs(delta) < 0.5) return;
    const g = n._glide || (n._glide = { off: 0, s: null });
    g.off += delta;
    const velocity = g.s ? g.s.velocity : 0;
    if (g.s) g.s.stop();
    n.style.translate = `0 ${g.off.toFixed(2)}px`;   // hold its old place this frame; the spring takes it from here
    g.s = window.motion.spring(g.off, { to: 0, feel: "glide", velocity, onUpdate: (v) => { g.off = v; n.style.translate = Math.abs(v) < 0.01 ? "" : `0 ${v.toFixed(2)}px`; } });
  });
}
ACTIONS["q-delete"] = (id) => {
  const i = T.queue.findIndex((q) => q.id === Number(id));
  if (i < 0) return;
  T.deleted.push({ item: T.queue[i], at: i, when: Date.now() });
  T.queue.splice(i, 1);
  paintThread(false);
  focusMsg();
};
// ⌘Z in the box brings back the last one you deleted, if you haven't typed since.
const lastDeleted = () => [...T.deleted].reverse().find((d) => d.item.slug === LOG.slug);
function undoDelete() {
  const d = lastDeleted();
  if (!d) return false;
  T.deleted.splice(T.deleted.indexOf(d), 1);
  T.queue.splice(Math.min(d.at, T.queue.length), 0, d.item);
  scheduleFlush();
  paintThread(false);
  return true;
}
// Edit: the message leaves the thread and drops back into the box where you
// wrote it, the reverse of sending. Return sends it again.
ACTIONS["q-edit"] = (id) => {
  const i = T.queue.findIndex((q) => q.id === Number(id));
  if (i < 0) return;
  const q = T.queue[i], node = queueNode(q.id), b = node && node.querySelector(".bubble");
  const from = b && b.getBoundingClientRect();
  // Read before the bubble leaves the thread: a detached node has no computed style.
  const pad = b ? { left: parseFloat(getComputedStyle(b).paddingLeft), top: parseFloat(getComputedStyle(b).paddingTop) } : null;
  T.queue.splice(i, 1);
  paintThread(false);
  const before = msgValue().trim(), text = msgText(q.message);
  setMsg(before ? `${text}\n${before}` : text);
  msgImages(q.message).forEach((im) => ATT.push(im));
  paintAttach();
  MSG.focus({ preventScroll: true });
  caretAt(MSG, "end");
  if (!from || calm()) return;
  const to = lineRect();
  const fly = b.cloneNode(true);
  fly.classList.add("fly");
  Object.assign(fly.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px` });
  document.body.appendChild(fly);
  const dx = to.left - (from.left + pad.left), dy = to.top - (from.top + pad.top);
  if (!before) MSG.classList.add("landing");   // a draft already in the box stays in sight
  tween("settle", (v) => {
    fly.style.transform = `translate(${(dx * v).toFixed(1)}px, ${(dy * v).toFixed(1)}px)`;
    fly.style.background = `color-mix(in srgb, var(--color-bubble) ${(100 * Math.max(0, 1 - v)).toFixed(1)}%, transparent)`;
    fly.style.color = `color-mix(in srgb, var(--color-ink) ${(100 * Math.min(1, v)).toFixed(1)}%, var(--color-ink-2))`;
  }).then(() => { fly.remove(); MSG.classList.remove("landing"); });
};
function editLast() {
  const mine = T.queue.filter((q) => q.slug === LOG.slug && !solo(q.message));
  if (!mine.length) return false;
  ACTIONS["q-edit"](mine[mine.length - 1].id);
  return true;
}

function trustHtml() {
  const folder = (cfg && cfg.vault ? cfg.vault.split(/[\\/]/).filter(Boolean).pop() : "") || "your vault";
  return `<div class="question waiting trust"><div class="q-text"><p><b>${esc(tutorName())} asks first: do you trust this folder?</b></p>
    <p>It's your vault, <span class="mono">${esc(folder)}</span>. ${esc(tutorName())} reads, edits, and runs files there, so it asks once for each new folder. Your message waits until you answer.</p></div>
    <div class="trust-acts"><button class="btn sm" data-act="trust" data-arg="yes">Trust this folder</button><button class="btn neutral sm" data-act="trust" data-arg="no">Not now</button></div></div>`;
}
// While the tutor works and nothing new has reached the thread, a row at its end
// says so and counts the seconds. The terminal's output is the signal: Claude
// Code animates its spinner for as long as a turn runs.
const W = { drawFrom: 0 };
const workEl = document.createElement("div");
workEl.className = "working";
workEl.setAttribute("aria-live", "polite");
function paintWorking() {
  const on = route.name === "session" && LOG.tab === "log" && T.running && !T.trust && busy() && Date.now() - Math.max(LOG.changedAt, ARRIVE.lastRelease) > 1500 && !ARRIVE.busy();
  if (on !== workEl.classList.contains("on")) {
    // The row going away must not shorten the thread under you: keepPlace pads the spacer
    // before the layout changes, so the scroll position is never clamped.
    if (route.name === "session") keepPlace(() => workEl.classList.toggle("on", on)); else workEl.classList.toggle("on", on);
    updatePill();
    if (on) workEl.innerHTML = `<i class="spin"></i><span>Working</span><span class="wk-note"></span>`;
  }
  if (on) {
    const draw = drawing();
    if (draw && !W.drawFrom) W.drawFrom = Date.now();
    if (!draw) W.drawFrom = 0;
    const from = draw ? W.drawFrom : T.workFrom, sec = Math.floor((Date.now() - from) / 1000), word = draw ? "Drawing the picture" : "Working";
    const t = sec >= 3 ? `${word} · ${sec}s` : word, note = draw ? "Usually one to three minutes" : "";
    const [span, quiet] = workEl.querySelectorAll("span");
    if (span.textContent !== t) span.textContent = t;
    if (quiet.textContent !== note) quiet.textContent = note;
  }
}
setInterval(paintWorking, 500);
// A card the tutor was writing opens its controls once the terminal goes quiet.
setInterval(() => { if (LOG.writingCard && route.name === "session" && LOG.data && !busy()) paintThread(false); }, 250);
function itemHtml(it, waiting, k, back) {
  if (it.kind === "tutor") return `<div class="tutor">${renderMd(it.text)}</div>`;
  if (it.kind === "you" && /^[/$]learn-/.test(it.text)) {
    const c = it.text.split("\n")[0].trim(), verb = (c.match(/^[/$]learn-(\w+)/) || [])[1];
    // Back from a break, the divider says when and how long (spec, 1 Nov): "Monday, 11:33 pm · back after 3 hours".
    if (back) return `<div class="cmd-line" title="${esc(c)}">${esc(back)}</div>`;
    const word = /learn-end break/.test(c) ? "Break" : ({ end: "Session saved", start: "Session started", resume: "Resumed", check: "Check", review: "Review", practice: "Practice" })[verb] || c;
    return `<div class="cmd-line" title="${esc(c)}">${esc(word)}${it.time ? ` · ${esc(it.time)}` : ""}</div>`;
  }
  if (it.kind === "check") { const st = LOG.cards.get(`${LOG.slug}|${k}`); return st ? cardHtml(st.cc, st.id) : ""; }
  if (it.kind === "you") {
    // Messages the tutor read as one keep the run they were sent as.
    const parts = JOINED[norm(it.text)] || [it.text];
    return parts.map((t) => `<div class="me"><span class="bubble" title="${esc(it.time)}">${youText(t)}</span></div>`).join("");
  }
  if (it.kind === "drawing") return "";   // the Working row at the end says it, with the seconds
  if (it.kind === "code") return `<div class="me"><div class="bubble"><span class="cap">Your code</span>${renderMd(it.text)}</div></div>`;
  if (it.kind === "thinking") {
    const open = LOG.think[k];
    return `<div class="steps"><div class="step"><button data-act="think" data-arg="${k}" aria-expanded="${!!open}">Thinking${icon(open ? "down" : "chev")}</button></div>${open ? `<div class="step-body">${renderMd(it.text)}</div>` : ""}</div>`;
  }
  if (it.kind === "question") {
    if (it.withdrawn) return "";
    // A question the tutor is waiting on is answered here (Edison, 7 Nov: the cards "don't actually work"). The app
    // presses the picker's own keys in the terminal (pickKeys). One that takes several answers stays in the terminal.
    // Answering from the thread presses Claude Code's picker keys (measured); Codex's picker is untested, so with Codex
    // the card shows and the answer is picked in the terminal, as before.
    const live = waiting && T.running && cfg.host === "claude", groups = it.groups || [];
    // Asked by a tutor that has since stopped, and never answered: it can't be answered now, so it is one quiet line,
    // not a second set of cards (Edison, 7 Nov: two sets came up, "one I can't click and one I can").
    if (!waiting && !it.answered && !(it.picked || []).length) return `<div class="cmd-line">${groups.length === 1 ? "A question" : `${groups.length} questions`} the tutor asked here went unanswered</div>`;
    if (live) PICKS.items[k] = it;
    // Answered, a card folds to one line per question with what you picked (Edison, 9 Nov: "collapse after you're done
    // with them"). Clicking it opens the whole card again; your answer bubble isn't drawn, since the card says it.
    if (!waiting && it.answers && !LOG.unfold[k]) {
      const ask = (g) => (g.body.split("\n").map((l) => l.trim()).find((l) => l && !/^```/.test(l)) || "").replace(/^#+\s*/, "");
      const rows = groups.map((g, gi) => [ask(g), (it.answers.per[gi] || []).join(", ")]).concat(it.answers.extra.map((x) => ["", x]));
      return `<button class="question folded" data-act="q-unfold" data-arg="${k}" aria-label="Show the whole question">${rows.map(([q, a]) =>
        `<span class="qf-row">${q ? `<span class="qf-q">${inline(q)}</span>` : ""}<span class="qf-a${a ? "" : " none"}">${a ? inline(a) : "No answer"}</span></span>`).join("")}</button>`;
    }
    const st = PICKS.sel[k] || {}, multi = live && pickerMulti(), many = groups.length > 1;
    const row = (o, n, gi) => { const on = live ? st[gi] === n : it.picked.includes(o.label);
      return `<${live && !multi ? `button data-act="pick" data-arg="${k}|${gi}|${n}"` : "div"} class="option ${on ? "sel" : ""}${live && !multi ? " live" : ""}"><i class="radio"></i>${(live && !multi) || !waiting ? `<span class="pick-check">${icon("check", "sm")}</span>` : ""}<span><span class="${/[;(){}=]/.test(o.label) ? "codey" : ""}">${inline(o.label)}</span>${o.desc.length > 2 && o.desc !== o.label ? `<span class="od">${inline(o.desc)}</span>` : ""}</span><kbd>${n + 1}</kbd></${live && !multi ? "button" : "div"}>`; };
    const other = (gi) => { const t = typeof st[gi] === "string" ? st[gi] : "";
      return `<label class="option other ${t ? "sel" : ""}"><input class="pick-other" data-key="${k}" data-g="${gi}" placeholder="Something else" value="${esc(t)}" aria-label="Your own answer"></label>`; };
    const ready = groups.every((_, gi) => st[gi] !== undefined && st[gi] !== "");
    const refold = !waiting && it.answers ? ` refold" data-act="q-unfold" data-arg="${k}" title="Fold it again` : "";
    return groups.map((g, gi) => `<div class="question ${waiting ? "waiting" : ""}${live && !multi ? " answerable" : ""}${refold}">
      ${g.body.trim() ? `<div class="q-text">${renderMd(g.body)}</div>` : ""}
      ${g.options.map((o, n) => row(o, n, gi)).join("")}
      ${live && !multi ? other(gi) : ""}
      ${!waiting && it.answers ? (it.answers.per[gi] || []).filter((x) => !g.options.some((o) => o.label === x)).concat(gi === groups.length - 1 ? it.answers.extra : []).map((x) => `<div class="option sel typed"><span>${youText(x)}</span><span class="pick-check">${icon("check", "sm")}</span></div>`).join("") : ""}
      ${live && multi ? `<div class="how">${icon("terminal", "xs")}This one takes several answers, so it's picked in the terminal. <button data-act="open-term">Open the terminal</button></div>` : ""}
      ${waiting && !live ? `<div class="how">${icon("terminal", "xs")}Pick your answer in the terminal, where the tutor asked. <button data-act="open-term">Open the terminal</button></div>` : ""}
      ${live && !multi && many && gi === groups.length - 1 ? `<div class="pick-go"><button class="btn" data-act="pick-send" data-arg="${k}" ${ready ? "" : "disabled"}>Send answers</button></div>` : ""}
    </div>`).join("");
  }
  if (it.kind === "answer") {
    if (it.onCard) return "";
    if (it.skipped) return `<div class="me"><span class="bubble ink2">Skipped the question to say something first.</span></div>`;
    return it.parts && it.parts.length ? `<div class="me"><span class="bubble">${it.parts.map(youText).join("\n\n")}</span></div>` : "";
  }
  return "";  // probe notices and the hook's own messages are plumbing
}
// ---------- back from a break ----------
// A log time as a Date: the conversation's date and the callout's HH:MM.
function logTime(date, time, days = 0) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "").trim()) || !m) return null;
  const d = new Date(`${date.trim()}T00:00:00`);
  d.setDate(d.getDate() + days);
  d.setHours(+m[1], +m[2]);
  return d;
}
// "Monday, 11:33 pm · back after 3 hours". A conversation can run past midnight
// without a new date, so a resume earlier in the day than its break is the next day.
function backAfter(from, to) {
  const at = new Date(to);
  if (at < from) at.setDate(at.getDate() + 1);   // a new conversation's date is its first message's; the break was the night before
  const mins = Math.round((at - from) / 60000);
  const gap = mins < 60 ? `${Math.max(1, mins)} ${mins <= 1 ? "minute" : "minutes"}`
    : mins < 60 * 24 ? `${Math.round(mins / 60)} ${Math.round(mins / 60) === 1 ? "hour" : "hours"}`
    : `${Math.round(mins / 1440)} ${Math.round(mins / 1440) === 1 ? "day" : "days"}`;
  return `${whenWords(at)} · back after ${gap}`;
}
// Today, Yesterday, then the weekday within the week, then the date; with the time, 12-hour.
function whenWords(d) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const ago = Math.round((day(new Date()) - day(d)) / 86400000);
  const w = ago === 0 ? "Today" : ago === 1 ? "Yesterday" : ago > 1 && ago < 7 ? DAYS_LONG[d.getDay()] : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const h = d.getHours() % 12 || 12, ap = d.getHours() < 12 ? "am" : "pm";
  return `${w}, ${h}:${String(d.getMinutes()).padStart(2, "0")} ${ap}`;
}

// ---------- the check card ----------
// A check the tutor writes as a `> [!check]` callout (tutor.md on vault-app, 29 Oct):
// a title, the stem, options lettered `A.`, `B.`, `C.`, then the confidence ask, which
// the card replaces with its own How sure. You answer on the card; it sends
// "B, 90%. why" as your reply and folds that reply back into itself, so there is no
// second bubble. The tutor's grading reply starts with `> [!key] B`, and the right
// answer gets the mark. A warm-up's title is "Warm-up 1 of 2 · HW23": the label never
// names the skill, because naming the idea before you answer is a hint (spec, 1 Nov).
const CONF = ["Guess", 50, 60, 70, 80, 90, 100];
const confWord = (c) => (c === "Guess" ? "guess" : `${c}%`);
const CARDS = new Map();   // per card, while Flash is open: your pick, how sure, why, and what you sent
const OPT_LINE = /^([A-Z])\.\s+(.*)$/;
const WARM = /^warm-?up\b(?:\s+(\d+)\s+of\s+(\d+))?\s*(?:·\s*(.+))?$/i;
function parseCheck(it) {
  if (it._cc) return it._cc;
  const lines = String(it.text || "").split("\n");
  // Options are one run starting at "A.": a line that isn't a letter (display math, a wrapped
  // line) belongs to the option above, and the run ends at a blank line. "I." or "II." in a
  // stem stays in the stem.
  const first = lines.findIndex((l) => /^A\.\s+/.test(l));
  const opts = [];
  let end = first;
  if (first >= 0) {
    for (end = first; end < lines.length && lines[end].trim(); end++) {
      const m = lines[end].match(OPT_LINE);
      if (m && m[1] === String.fromCharCode(65 + opts.length)) opts.push({ letter: m[1], text: m[2] });
      else opts[opts.length - 1].text += ` ${lines[end].trim()}`;
    }
  }
  // The confidence ask goes: the card asks it. With options it follows them; without, it is the last paragraph.
  let paras = (first < 0 ? lines : lines.slice(0, first)).join("\n").split(/\n\s*\n/);
  if (first < 0 && paras.length > 1 && /how sure|confiden/i.test(paras[paras.length - 1])) paras = paras.slice(0, -1);
  const title = String(it.title || it.label || "").trim(), w = title.match(WARM);
  const from = w && w[3] ? w[3].trim() : "";
  return (it._cc = { title, opts, stem: paras.join("\n\n").trim(), warm: w ? { n: +w[1] || 0, of: +w[2] || 0, from: subj(from) ? nick(subj(from)) : from } : null });
}
// When the session that asked has ended, the answer carries its question, so the new
// session can grade it. The card hides this part when it folds the answer back in.
const CONTEXT = /\n\n\(Answering your check from before:[\s\S]*\)\s*$/;
function withQuestion(cc, text) {
  const q = `${cc.stem.replace(/\s*\n\s*/g, " ")}${cc.opts.map((o) => ` ${o.letter}. ${o.text}`).join("")}`;
  return `${text}\n\n(Answering your check from before: ${q})`;
}
// Your reply to a check, read back from the log, strictly, so a question you typed
// is never taken for an answer. Multiple choice: an offered letter alone ("B"), or a
// letter, how sure as N% or guess, then why ("B, 90%. why"). Free response: the card
// sends "your answer (90%)" or "(guess)".
const SURE = (w) => (/^guess/i.test(w) ? "Guess" : Math.min(100, Number(w.replace(/\D/g, ""))));
function readAnswer(cc, text) {
  const t = String(text || "").replace(CONTEXT, "").trim();
  if (cc.opts.length) {
    const alone = t.match(/^\(?([A-Za-z])\)?\.?$/);
    const full = t.match(/^\(?([A-Za-z])\)?\s*[,.:;]\s*(guess|\d{1,3}\s*%)(?:\s*sure)?\s*[.,;:]?\s*([\s\S]*)$/i);
    const m = full || alone;
    if (!m) return null;
    const pick = cc.opts.findIndex((o) => o.letter === m[1].toUpperCase());
    if (pick < 0) return null;
    return { pick, conf: full ? SURE(full[2]) : null, why: full ? full[3].trim() : "" };
  }
  const m = t.match(/^([\s\S]+?)\s*\((guess|\d{1,3}\s*%)\)$/i);
  return m ? { pick: null, conf: SURE(m[2]), why: m[1].trim() } : null;
}
// Every check in the log: where it stands, and which reply of yours it folds in. An
// answer can land in a later conversation (answering starts a new tutor session, and
// the hook gives each session its own section), so the search runs to the next check.
// writing: the tutor is still writing it. live: waiting on you. sent: you answered.
// keyed: the tutor's key came back. past: a later check, the session's end, or a key
// that says it was skipped.
function cardsAll(convos) {
  const fold = new Set(), flat = [];
  convos.forEach((c, ci) => c.items.forEach((it, i) => flat.push({ it, ci, i })));
  const checks = flat.map((x, n) => (x.it.kind === "check" ? n : -1)).filter((n) => n >= 0);
  checks.forEach((n, ix) => {
    const { it, ci, i } = flat[n], cc = parseCheck(it), id = `${LOG.slug}|${ci}:${i}`, local = CARDS.get(id);
    const end = ix + 1 < checks.length ? checks[ix + 1] : flat.length;
    let logged = null, at = -1, ended = false;
    for (let m = n + 1; m < end; m++) {
      const x = flat[m].it;
      if (x.kind !== "you") continue;
      if (/^\s*[/$]learn-end\b(?!\s+break)/.test(x.text)) ended = true;
      if (logged || IS_CMD.test(x.text)) continue;
      const a = readAnswer(cc, x.text);
      if (a) { logged = a; at = m; fold.add(`${flat[m].ci}:${flat[m].i}`); }
    }
    const sent = logged || (local && local.sent) || null;
    let key = null, skipped = false, graded = false;
    for (let m = (at >= 0 ? at : n) + 1; m < end; m++) {
      const x = flat[m].it;
      if (x.kind !== "key") continue;
      const t = String(x.title || x.label || "").trim(), k = t.match(/^\W*([A-Za-z])\b/);
      graded = true;   // the tutor has answered it, even if the card can't read what you sent
      if (/^\W*skip/i.test(t)) skipped = true;
      else if (k && sent) key = cc.opts.findIndex((o) => o.letter === k[1].toUpperCase());
      break;
    }
    if (key < 0) key = null;
    const last = ix === checks.length - 1;
    const mode = sent && !skipped ? (key != null ? "keyed" : "sent")
      : skipped || ended || graded || !last ? "past"
      : n === flat.length - 1 && T.running && busy() ? "writing" : "live";
    LOG.cards.set(id, { id, cc, mode, sent: mode === "sent" || mode === "keyed" ? sent : null, key, older: ci < convos.length - 1 });
    if (mode === "live") LOG.liveCard = id;
    if (mode === "writing") LOG.writingCard = id;
    // The header says "Warm-up HW23" from the first warm-up card until the last one's key comes back.
    if (last) LOG.warm = cc.warm && (mode === "live" || mode === "writing" || mode === "sent" || (mode === "keyed" && cc.warm.n < cc.warm.of)) ? cc.warm : null;
  });
  return fold;
}
function cardHtml(cc, id) {
  const a = esc(id);
  const kick = cc.warm ? `<b>Warm-up</b>${cc.warm.of >= 2 ? ` ${cc.warm.n} of ${cc.warm.of}` : ""}` : `<b>Check</b>${cc.title ? `<span class="sep">·</span>${inline(cc.title)}` : ""}`;
  const opts = cc.opts.map((o, n) => `<button class="cc-opt" role="radio" aria-checked="false" data-act="cc-pick" data-arg="${a}|${n}"><span class="cc-key">${n + 1}</span><span class="cc-o">${inline(o.text)}</span><span class="cc-mark" aria-hidden="true">${icon("check", "sm")}</span></button>`).join("");
  return `<div class="check-card" data-card="${a}">
    <div class="cc-kicker">${kick}</div>
    ${cc.stem ? `<div class="cc-q">${renderMd(cc.stem)}</div>` : ""}
    ${opts ? `<div class="cc-opts" role="radiogroup" aria-label="Your answer">${opts}</div>` : ""}
    <div class="cc-tail"><div class="cc-fold">
      ${cc.opts.length ? "" : `<div class="cc-row"><span class="cc-lab">Answer</span><textarea class="cc-field" rows="1" placeholder="Your answer" aria-label="Your answer"></textarea></div>`}
      <div class="cc-row"><span class="cc-lab">How sure?</span><div class="seg cc-sure" role="radiogroup" aria-label="How sure"><i class="seg-thumb" aria-hidden="true"></i>${CONF.map((c) => `<button role="radio" aria-checked="false" data-act="cc-sure" data-arg="${a}|${c}">${c === "Guess" ? "Guess" : `${c}%`}</button>`).join("")}</div></div>
      ${cc.opts.length ? `<div class="cc-row"><span class="cc-lab">Why?</span><textarea class="cc-field" rows="1" placeholder="One line: why this one?" aria-label="Why"></textarea></div>` : ""}
      <div class="cc-foot"><button class="btn sm cc-send" data-act="cc-send" data-arg="${a}" disabled>Check</button></div>
    </div><div class="cc-said" aria-live="polite"></div></div>
  </div>`;
}
const cardLocal = (id) => { if (!CARDS.has(id)) CARDS.set(id, { pick: null, conf: null, why: "", engaged: false, sent: null }); return CARDS.get(id); };
const cardReady = (st, l) => l.conf != null && (st.cc.opts.length ? l.pick != null : !!l.why.trim());
const cardNode = (id) => [...document.querySelectorAll("#thread .check-card")].find((n) => n.dataset.card === id) || null;
// "You said 90% sure." in quieter ink, then your words in your ink.
function saidHtml(sent) {
  const sure = sent.conf == null ? "" : sent.conf === "Guess" ? "You said it was a guess." : `You said ${sent.conf}% sure.`;
  return `${sure ? `<span class="cc-ys">${sure}</span>` : ""}${sure && sent.why ? " " : ""}${sent.why ? `<span class="cc-yw">${youText(sent.why)}</span>` : ""}`;
}
// How sure's highlight is one piece that slides to your pick (Edison, 9 Nov: switching should animate). The first
// pick fades it in where it lands; later ones slide it there.
function slideThumb(seg) {
  const th = seg && seg.querySelector(".seg-thumb"), on = seg && seg.querySelector("button.on");
  if (!th) return;
  if (!on) { th.classList.remove("on"); return; }
  const place = () => { th.style.transform = `translateX(${on.offsetLeft}px)`; th.style.width = `${on.offsetWidth}px`; };
  if (!th.classList.contains("on")) { th.classList.add("still"); place(); th.getBoundingClientRect(); th.classList.remove("still"); th.classList.add("on"); }
  else place();
}
// What you've chosen so far, drawn on a live card. The Check button wakes on the snappy spring.
function paintPicks(node, st, l, fresh) {
  node.querySelectorAll(".cc-opt").forEach((o, n) => { o.classList.toggle("picked", n === l.pick); o.setAttribute("aria-checked", String(n === l.pick)); });
  node.querySelectorAll(".cc-sure button").forEach((b, n) => { const on = CONF[n] === l.conf; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
  slideThumb(node.querySelector(".cc-sure"));
  const field = node.querySelector(".cc-field");
  if (field && fresh) { field.value = l.why; fitField(field); }
  const btn = node.querySelector(".cc-send"), ready = cardReady(st, l);
  if (btn.disabled === !ready) return;
  btn.disabled = !ready;
  if (fresh || calm()) { btn.style.removeProperty("--wake"); return; }
  const from = ready ? 0 : 1;
  tween("snappy", (v) => { const w = from + (1 - 2 * from) * v; btn.style.setProperty("--wake", w.toFixed(3)); if (v >= 1) btn.style.removeProperty("--wake"); });
}
// The field grows with what you write (border-box, so its height is the text plus padding and border).
function fitField(f) { f.style.height = "auto"; f.style.height = `${f.scrollHeight + f.offsetHeight - f.clientHeight}px`; }
// The thread keeps your place while the card gets shorter below what you read:
// the spacer takes up what the card gives back, so nothing above it moves.
ARRIVE.layout = (fn) => keepPlace(fn);   // a card growing at the end never moves what you're reading
function keepPlace(fn) {
  const top = scroller.scrollTop;
  spacer.style.height = `${spacer.offsetHeight + 4000}px`;
  fn();
  scroller.scrollTop = top;
  fitSpacer();
}
// A fade on the motion clock that runs under Reduce motion too (spec: plain 0.2 s fades there).
const fadeDone = (sec, fn) => new Promise((done) => fadeFor(sec, (v) => { fn(v); if (v >= 1) done(); }));
// Draw each card in the state the log and your answers put it in. A change seen
// happen settles on the springs; opening a subject draws the end state.
function syncCards(full) {
  document.querySelectorAll("#thread .check-card").forEach((node) => {
    const st = LOG.cards.get(node.dataset.card);
    if (!st) return;
    const l = cardLocal(st.id), fresh = full || node._mode === undefined;   // a new node: nothing on it has been seen moving
    if (st.mode === "live") paintPicks(node, st, l, fresh);
    const was = fresh ? null : node._mode;
    if (was === st.mode) return;
    node._mode = st.mode;
    node.classList.toggle("cc-live", st.mode === "live");
    node.classList.toggle("cc-past", st.mode === "past" || st.mode === "writing");
    node.querySelectorAll(".cc-opt").forEach((o) => { if (st.mode === "live") o.removeAttribute("aria-disabled"); else o.setAttribute("aria-disabled", "true"); });
    // The tutor finished writing it: its controls open below the options, nothing above moves.
    // While the card is still being written on (Grow), they wait for it to finish.
    if (st.mode === "live" && was === "writing") {
      if (!node._growing) openCard(node);
      else {
        const tail = node.querySelector(".cc-tail");
        tail.style.overflow = "hidden"; tail.style.height = "0px";   // held shut until the card is written
        node._afterGrow = () => { tail.style.height = ""; tail.style.overflow = ""; openCard(node); };
      }
    }
    if (st.mode === "live" || st.mode === "past" || st.mode === "writing") return;
    const sent = st.sent;
    node.querySelectorAll(".cc-opt").forEach((o, n) => {
      o.classList.toggle("picked", n === sent.pick); o.setAttribute("aria-checked", String(n === sent.pick));
      o.classList.toggle("right", n === st.key);
      const mark = o.querySelector(".cc-mark");
      if (n === st.key) { mark.removeAttribute("aria-hidden"); mark.setAttribute("aria-label", "Right answer"); }
      o.classList.toggle("dim", st.key != null && n !== st.key && n !== sent.pick);
    });
    const said = node.querySelector(".cc-said");
    if (!node.classList.contains("cc-sent")) { said.innerHTML = saidHtml(sent); typeset(said); }
    const settleNow = was === "live", relaxNow = st.mode === "keyed" && was !== null;
    if (settleNow) settleCard(node);   // measures the live card before it changes, then adds "sent"
    node.classList.add("cc-sent");
    node.classList.toggle("cc-keyed", st.mode === "keyed");
    if (relaxNow) {
      // Settled: the right answer carries the loudest mark. Your pick relaxes to a
      // hairline and its key greys; the option nobody picked steps back to half.
      node.style.setProperty("--relax", "0");
      const set = (v) => { if (v >= 1) node.style.removeProperty("--relax"); else node.style.setProperty("--relax", Math.max(0, v).toFixed(3)); };
      if (calm()) fadeDone(0.2, set); else tween("settle", set);
    }
  });
}
// On Check the card settles into what you sent: the controls you no longer need
// step back while the card closes up around one quiet line. Its top never moves.
function settleCard(node) {
  const tail = node.querySelector(".cc-tail"), fold = node.querySelector(".cc-fold"), said = node.querySelector(".cc-said");
  // Hold the tail at the live card's height first, so no layout ever sees it collapse.
  const h0 = tail.offsetHeight;
  tail.style.height = `${h0}px`;
  node.classList.add("cc-sent", "cc-settling");
  const h1 = said.offsetHeight + parseFloat(getComputedStyle(said).marginTop);
  const set = (v) => keepPlace(() => {
    if (v >= 1) { node.classList.remove("cc-settling"); tail.style.height = ""; fold.style.opacity = ""; said.style.opacity = ""; return; }
    tail.style.height = `${(h0 + (h1 - h0) * (calm() ? (v < 1 ? 0 : 1) : v)).toFixed(1)}px`;
    // In sequence, never crossed: the controls are gone before the line comes in (two layers of text in one place read as noise).
    fold.style.opacity = String(Math.max(0, 1 - v * 2.4));
    said.style.opacity = String(Math.min(1, Math.max(0, (v - 0.5) * 2)));
  });
  set(0);
  if (calm()) fadeDone(0.2, set); else tween("settle", set);
}
// The reverse of settling: the controls open on the settle spring below the options.
function openCard(node) {
  const tail = node.querySelector(".cc-tail"), fold = node.querySelector(".cc-fold");
  const h1 = tail.offsetHeight;
  const set = (v) => keepPlace(() => {
    if (v >= 1) { tail.style.height = ""; tail.style.overflow = ""; fold.style.opacity = ""; return; }
    tail.style.overflow = "hidden";
    tail.style.height = `${(calm() ? h1 : h1 * Math.max(0, v)).toFixed(1)}px`;
    fold.style.opacity = String(Math.min(1, Math.max(0, v)));
  });
  set(0);
  if (calm()) fadeDone(0.2, set); else tween("settle", set);
}
function cardAct(arg) {
  const cut = String(arg).lastIndexOf("|"), id = cut < 0 ? String(arg) : String(arg).slice(0, cut), val = cut < 0 ? "" : String(arg).slice(cut + 1);
  const st = LOG.cards && LOG.cards.get(id);
  return st && st.mode === "live" ? { st, l: cardLocal(id), node: cardNode(id), val } : null;
}
ACTIONS["cc-pick"] = (arg) => { const c = cardAct(arg); if (!c) return; c.l.pick = Number(c.val); c.l.engaged = true; paintPicks(c.node, c.st, c.l); };
ACTIONS["cc-sure"] = (arg) => { const c = cardAct(arg); if (!c) return; c.l.conf = c.val === "Guess" ? "Guess" : Number(c.val); c.l.engaged = true; paintPicks(c.node, c.st, c.l); };
ACTIONS["cc-send"] = (id) => cardSend(id);
// Check: your answer goes to the tutor as plain text, and the card holds it.
// Nothing glides: the card stays where you answered it, and the reply writes below.
function cardSend(id) {
  const c = cardAct(`${id}|`);
  if (!c || !cardReady(c.st, c.l)) return;
  const { st, l } = c, why = l.why.trim().replace(/\s*\n\s*/g, " ");
  let text = st.cc.opts.length ? `${st.cc.opts[l.pick].letter}, ${confWord(l.conf)}.${why ? ` ${why}` : ""}` : `${why} (${confWord(l.conf)})`;
  // The session that asked has ended, or will be a new one: the answer carries its question.
  if (st.older || !T.running) text = withQuestion(st.cc, text);
  l.sent = { pick: st.cc.opts.length ? l.pick : null, conf: l.conf, why };
  const message = { text, check: id };
  if (document.activeElement && document.activeElement.closest(".check-card")) MSG.focus({ preventScroll: true });
  if (!T.running) { enqueue(message); const s = subj(route.slug); startTutor(s ? resumeTyped(s) : ""); }
  else speak(message);
  paintThread(false);
}
document.addEventListener("input", (e) => {
  const f = e.target.closest && e.target.closest(".check-card .cc-field");
  if (!f) return;
  const c = cardAct(`${f.closest(".check-card").dataset.card}|`);
  fitField(f);
  if (!c) return;
  c.l.why = f.value; c.l.engaged = true;
  paintPicks(c.node, c.st, c.l);
});
// Choosing the box means you're writing to the tutor: typing stops landing on the card.
MSG.addEventListener("pointerdown", () => { const c = LOG.liveCard && cardAct(`${LOG.liveCard}|`); if (c) c.l.engaged = false; });
// The whole card answers from the keyboard (spec, 1 Nov): 1 to 3 pick, then 5 to 9
// set 50 to 90%, 0 sets 100%, G sets Guess, and Return checks. Card keys act while
// the box is empty or the focus is on the card, never while you type a message.
// After a pick, other typing goes into Why. A free-response card takes your typing
// as its answer once you've clicked into it.
function cardKeys(e) {
  if (route.name !== "session" || LOG.tab !== "log" || T.drawer || pal || quitCard || $("scrim").classList.contains("on")) return;
  if (!LOG.liveCard || composing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  const c = cardAct(`${LOG.liveCard}|`);
  if (!c || !c.node) return;
  const { st, l, node } = c, a = document.activeElement, field = node.querySelector(".cc-field");
  const inField = a === field, mc = st.cc.opts.length > 0;
  const boxEmpty = MSG.contains(a) && !(a.closest && a.closest("math-field")) && msgEmpty() && !ATT.length;
  const loose = !a || a === document.body || (node.contains(a) && !inField) || (!MSG.contains(a) && !(a.closest && a.closest("input, textarea, select, [contenteditable], math-field, .xterm")));
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (inField) {
    if (e.key === "Enter") { stop(); if (cardReady(st, l)) cardSend(st.id); }
    else if (e.key === "Escape") { stop(); l.engaged = false; MSG.focus({ preventScroll: true }); }
    return;
  }
  if (!boxEmpty && !loose) return;
  if (e.key === "Enter" && !e.shiftKey) { if (cardReady(st, l)) { stop(); cardSend(st.id); } return; }
  if (e.key.length !== 1 || e.key === " ") return;
  const k = e.key.toLowerCase();
  // 1 to 4 pick (a fifth option and beyond take a click, so 5 to 9 always mean how sure).
  if (mc && /^[1-4]$/.test(k) && Number(k) <= st.cc.opts.length) { stop(); return ACTIONS["cc-pick"](`${st.id}|${Number(k) - 1}`); }
  // How sure follows a pick, so a message that starts with G or a number still types.
  const sureKey = /^[5-9]$/.test(k) ? Number(k) * 10 : k === "0" ? 100 : k === "g" ? "Guess" : null;
  const canSure = l.engaged && (mc ? l.pick != null : loose && !!l.why.trim());
  if (sureKey != null && canSure) { stop(); return ACTIONS["cc-sure"](`${st.id}|${sureKey}`); }
  // Anything else you type on an engaged card is your why (or your answer); the key types there.
  if (l.engaged && field && (!mc || l.pick != null)) field.focus({ preventScroll: true });
}
window.addEventListener("keydown", cardKeys, true);

// Images you sent, so a bubble can show them at once. Claude Code logs a pasted
// image as [Image #N], and the hook swaps in the saved file only a turn later.
// The hook names that file by the first 16 hex digits of the image's SHA-256,
// so the names kept here still find it after Flash restarts.
const SENT = (() => { try { return JSON.parse(localStorage.getItem("flash-sent-images") || "[]"); } catch { return []; } })();
async function rememberSent(text, images) {
  const names = await Promise.all(images.map(async (im) => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", im.bytes));
    const ext = { "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[im.type] || "png";
    return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("") + "." + ext;
  }));
  SENT.push({ text: text.trim(), names, urls: images.map((im) => im.url) });
  SENT.splice(0, Math.max(0, SENT.length - 50));
  localStorage.setItem("flash-sent-images", JSON.stringify(SENT.map(({ text: t, names: n }) => ({ text: t, names: n }))));
}
// A fraction in your sentence is drawn full size (\dfrac, locked 31 Oct), but one in a
// limit or an exponent stays script size: inside _ or ^, and anything braced after them.
function fullFrac(tex) {
  let out = "", pend = false;
  const stack = [];
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "\\" && /[a-zA-Z]/.test(tex[i + 1] || "")) {
      const name = tex.slice(i).match(/^\\[a-zA-Z]+/)[0];
      const script = pend || stack.includes(true);
      out += name === "\\frac" && !script ? "\\dfrac" : name;
      i += name.length - 1;
      if (name !== "\\frac") pend = false;
      continue;
    }
    if (ch === "_" || ch === "^") { out += ch; pend = true; continue; }
    if (ch === "{") { stack.push(pend || stack[stack.length - 1] === true); pend = false; out += ch; continue; }
    if (ch === "}") { stack.pop(); out += ch; continue; }
    if (!/\s/.test(ch)) pend = false;
    out += ch;
  }
  return out;
}
const yourMath = (t) => String(t).replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (m, d, i) => (d != null ? `$$${fullFrac(d)}$$` : `$${fullFrac(i)}$`));
function youText(t) {
  const plain = String(t).replace(/\[Image #\d+\]\s*/g, "").trim();
  const sent = /\[Image #\d+\]/.test(t) ? [...SENT].reverse().find((x) => x.text === plain) : null;
  let n = 0;
  const shot = () => {
    const i = n++, url = sent && ((sent.urls && sent.urls[i]) || (sent.names[i] && `vault-file:///${encodeURIComponent(sent.names[i])}`));
    return url ? `<img class="shot" alt="Screenshot you sent" src="${url}">` : `<span class="shot-chip">${icon("note", "xs")}Screenshot</span>`;
  };
  return yourMath(esc(t)).replace(/\[Image #\d+\]\s*/g, () => shot()).replace(/!\[\[([^\]|]+?\.(?:png|jpe?g|gif|webp))(?:\|\d+)?\]\]/gi,
    (_, p) => `<img class="shot" alt="Screenshot you sent" src="vault-file:///${encodeURIComponent(p.replace(/&amp;/g, "&").split("/").pop())}">`).trim();
}
function threadEmpty() {
  const s = subj(route.slug);
  if (T.running || T.starting) return `<div class="thread-empty"><span class="empty-icon">${icon("session")}</span><b class="t-sec">${T.starting ? `Starting ${esc(tutorName())}` : "The tutor is getting ready"}</b><p>The conversation shows here as the tutor writes. Reply in the box below.</p></div>`;
  const typed = s ? resumeTyped(s) : command("learn-start");
  const verb = s ? (s.status === "done" ? "Practice" : "Resume") : "Start";
  const open = s && !T.ended && isLeftOpen(s.slug) ? leftOpen().find((x) => x.slug === s.slug) : null;
  if (open) return `<div class="thread-empty"><span class="empty-icon">${icon("session")}</span>
    <b class="t-sec">Your session from ${shortD(open.note.slice(0, 10))} was left open</b>
    <p>Resume to pick it up where it stopped. If you're finished with this subject, close it out: the session is settled and the subject moves to Done.</p>
    <div class="empty-acts"><button class="btn" data-act="ink" data-tip="${key("↩")}">${icon("resume", "sm")}${verb}</button>${closeBtn(s, true)}</div>
</div>`;
  return `<div class="thread-empty"><span class="empty-icon">${icon("session")}</span>
    <b class="t-sec">${T.ended ? `${esc(tutorName())} stopped` : s ? `${verb} ${md(shortTitle(s))}` : "Start a subject"}</b>
    <p>${T.ended ? "The session ended. Your records are saved as the tutor left them." : `${esc(tutorName())} opens in your vault and runs <span class="mono">${esc(typed)}</span>. Its replies show here.`}</p>
    <div class="empty-acts"><button class="btn" data-act="ink" data-tip="${key("↩")}">${icon("resume", "sm")}${T.ended ? "Start again" : verb}</button>${s && !T.ended && canClose(s) ? closeBtn(s, true) : ""}</div>
</div>`;
}
function paintLog(full) {
  const host = $("thread"), scroller = $("threadScroll");
  let entries = logEntries();
  if (!entries.some((e) => e.key.includes(":"))) {
    host.innerHTML = threadEmpty();
    host.appendChild(workEl);
    host.appendChild(spacer);
    spacer.style.height = "0px";
    paintActs();
    return;
  }
  const hidden = LOG.showAll ? 0 : Math.max(0, entries.length - SHOW);
  entries = entries.slice(hidden);
  let list = host.querySelector(".log");
  if (full || !list) {
    host.innerHTML = `${hidden ? `<button class="btn text earlier" data-act="log-all">${icon("chev", "sm")}Show ${hidden} earlier</button>` : ""}<div class="log"></div>`;
    list = host.querySelector(".log");
  } else {
    const btn = host.querySelector(".earlier");
    if (btn) btn.innerHTML = `${icon("chev", "sm")}Show ${hidden} earlier`;
  }
  if (full) ARRIVE.reset();
  const existing = new Map([...list.children].map((n) => [n.dataset.key, n]));
  const before = full ? new Map() : measureMine();
  // The tutor's words arrive at the app's own pace while it writes (arrive.js); a
  // reply already there when you open a subject is simply there.
  const arriving = new Set(), landing = new Set(), after = new Set();
  const endBefore = full ? 0 : contentEnd();
  const changed = [];
  let prev = null;
  for (const e of entries) {
    let node = existing.get(e.key);
    const live = !full && e.tutor && T.running;
    const lands = !full && e.check && T.running && !existing.get(e.key);   // a check card the tutor is writing now
    // The tutor's question waits for the words above it (Edison, 7 Nov: cards showed before the text was done).
    const waits = !full && T.running && !existing.get(e.key) && !e.tutor && !e.check && /class="question/.test(e.html);
    if (node && node.dataset.html !== String(hash(e.html))) { node.innerHTML = e.html; node.dataset.html = hash(e.html); changed.push(node); if (live) arriving.add(node); }
    if (!node) {
      node = document.createElement("div");
      node.className = full || e.noEnter || live || lands || waits ? "item" : "item enter";
      if (live) arriving.add(node);
      if (waits) after.add(node);
      if (lands) landing.add(node);
      node.dataset.key = e.key;
      node.dataset.html = hash(e.html);
      node.innerHTML = e.html;
      changed.push(node);
      if (e.landed && !full) carryInk(node, e.landed);
    }
    existing.delete(e.key);
    if (prev ? prev.nextSibling !== node : list.firstChild !== node) list.insertBefore(node, prev ? prev.nextSibling : list.firstChild);
    prev = node;
  }
  existing.forEach((n) => {
    // "After this reply" fades when nothing of yours is left unread.
    if (n.dataset.key !== "x:after" || full || calm()) { ARRIVE.forget(n.dataset.key); return n.remove(); }
    n.dataset.key = "x:gone";
    const o = Number(n.style.opacity || 1);
    tween("snappy", (v) => { n.style.opacity = String(o * (1 - v)); }).then(() => n.remove());
  });
  // An arriving reply is hidden only until its words are taken apart, which happens
  // in this same task once the math is drawn, so nothing already read blinks.
  changed.forEach((n) => {
    if (landing.has(n)) { n.style.opacity = "0"; return typeset(n, () => { ARRIVE.card(n, n.dataset.key); n.style.opacity = ""; paintWorking(); }); }
    if (after.has(n)) { n.style.opacity = "0"; typeset(n); return afterWords(n); }
    if (!arriving.has(n)) return typeset(n);
    n.style.opacity = "0";
    typeset(n, () => { ARRIVE.adopt(n, n.dataset.key); n.style.opacity = ""; paintWorking(); });   // words are coming: Working goes now, not at the next half-second
  });
  if (changed.length && !full) LOG.changedAt = Date.now();
  if (spacer.previousSibling !== workEl || workEl.previousSibling !== (host.querySelector(".log"))) { host.appendChild(workEl); host.appendChild(spacer); }
  // Nothing scrolls while you read (spec, Scrolling a long thread). Opening a
  // subject starts where you stopped: its end.
  paintWarm();
  if (full) { syncCards(true); SC.hold = null; takeOver(); spacer.style.height = "0px"; scroller.scrollTop = scroller.scrollHeight; SC.seen = true; SC.pinUntil = Date.now() + 1500; }
  else {
    keepPlace(() => syncCards(false));   // a card that closes up gives its space to the spacer, so nothing above moves
    if (contentEnd() > endBefore + 1 && SC.gapNow() > 24) SC.seen = false;   // something new arrived out of sight below
  }
  updatePill();
  glideMine(before);
  settleInk();
  // A question the tutor is waiting on is answered in the terminal, so the drawer opens once for it.
  const waiting = entries.find((e) => e.waiting);
  // Only while the tutor runs: a picker left unanswered in an old conversation opened the terminal on every launch (7 Nov).
  // Since 7 Nov the thread answers it; only one that takes several answers still needs the terminal.
  if (waiting && T.running && LOG.asked !== waiting.key && (cfg.host !== "claude" || pickerMulti())) { LOG.asked = waiting.key; if (!T.drawer) ACTIONS["toggle-term"](); }
  paintActs();
}
// Shows a node once every word before it has arrived: it rises 6 px and fades in, as a new item does.
function afterWords(n) {
  const go = () => {
    if (!n.isConnected) return;
    if (ARRIVE.busy()) return void setTimeout(go, 120);
    n.style.opacity = "";
    if (!calm()) n.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  };
  go();
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; }
// ---------- scrolling a long thread ----------
// Scrolling is native, so it follows the trackpad exactly. The thread moves on its
// own only when you send: your message glides to 40px below the top, and a space
// below it holds that place while the reply fills in, melting away as you scroll
// up. Sent from far up, the thread dissolves to the bottom instead (spec, 1 Nov).
const scroller = $("threadScroll");
const spacer = document.createElement("div");
spacer.className = "spacer";
const SC = { hold: null, spring: null, aim: null, follow: false, moving: false, seen: true, pa: 0, paSpring: null, pillOn: false, pillText: "", gapNow: () => gapAt(SC.aim ?? scroller.scrollTop) };
// The reading area runs from under the header islands to the top of the dock.
const topInset = () => { const i = $("islands"); return i && !i.classList.contains("hidden") ? Math.max(0, i.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top) : 0; };
const dockH = () => $("dock").offsetHeight;
const maxTop = () => scroller.scrollHeight - scroller.clientHeight;
// Where what's written ends, in the thread's own coordinates.
function contentEnd() {
  const host = $("thread"), last = workEl.classList.contains("on") ? workEl : host.querySelector(".log") || host.querySelector(".note") || host.querySelector(".thread-empty");
  if (!last) return 0;
  return last.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop;
}
const gapAt = (top) => contentEnd() - (top + scroller.clientHeight - dockH());
const nodeTop = (n) => n.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
function fitSpacer() {
  const h = spacer.offsetHeight, natural = scroller.scrollHeight - h;
  const need = (SC.hold ?? scroller.scrollTop) + scroller.clientHeight - natural;
  // Exactly what keeps your place: it grows only to hold the glide's target or to
  // cover something below that went away (the Working row), and melts as you scroll up.
  const next = Math.max(0, Math.round(need));
  if (next !== h) spacer.style.height = `${next}px`;
}
// A glide you can always take over: a wheel, a press, or a key stops it where it is.
function glideTo(y) {
  y = Math.max(0, Math.min(y, maxTop()));
  if (calm()) { takeOver(); scroller.scrollTop = y; return; }
  SC.aim = y;
  if (SC.spring) { SC.spring.to(y); return; }
  const me = (SC.spring = window.motion.spring(scroller.scrollTop, { to: y, feel: "glide", onUpdate: (v) => { scroller.scrollTop = v; } }));
  me.done.then(() => { if (SC.spring === me) { SC.spring = null; SC.aim = null; SC.hold = null; fitSpacer(); updatePill(); } });
}
function takeOver() { if (SC.spring) SC.spring.stop(); SC.spring = null; SC.aim = null; SC.hold = null; SC.pinUntil = 0; SC.follow = false; }
// Opening a subject lands at its end, and stays there while its math and figures
// finish drawing, until you scroll or 1.5s pass.
new ResizeObserver(() => { if (Date.now() < (SC.pinUntil || 0)) scroller.scrollTop = maxTop(); }).observe($("thread"));
scroller.addEventListener("wheel", takeOver, { passive: true });
scroller.addEventListener("pointerdown", takeOver);
scroller.addEventListener("keydown", (e) => { if (/^(Arrow|Page|Home|End| )/.test(e.key)) takeOver(); });
// Sending: the message is in the thread at once, read, and glides up with the thread.
// From far up (more than about a screen), the thread dissolves to its end first.
async function sendGlide(item, from) {
  if (!item) return;
  SC.follow = false;   // a send lands on your message, not the end
  const far = !calm() && maxTop() - scroller.scrollTop > scroller.clientHeight * 0.75;
  if (far) {
    takeOver(); SC.moving = true; updatePill();
    const t = $("thread");
    await timed(0.12, (v) => { t.style.opacity = String(1 - v); });
    spacer.style.height = "0px"; scroller.scrollTop = maxTop();
    timed(0.16, (v) => { t.style.opacity = v >= 1 ? "" : String(v); });
    SC.moving = false;
  }
  const node = queueNode(item.id);
  if (!node) return;
  SC.seen = false;
  SC.hold = nodeTop(node) - topInset() - 40;
  fitSpacer();
  rise(item, from, "glide");   // on the thread's own glide, so it never overtakes the words above it
  glideTo(SC.hold);
}
// A timed ease on the motion clock, for the dissolve's fixed 0.12 s and 0.16 s.
function timed(sec, fn) {
  if (calm()) { fn(1); return Promise.resolve(); }
  const { clock } = window.motion, t0 = clock.now();
  fn(0);
  return new Promise((done) => { const off = clock.on(() => { const a = Math.min(1, (clock.now() - t0) / sec), v = 1 - (1 - a) ** 2; fn(v); if (a >= 1) { off(); done(); } }); });
}

// The pill: one quiet glass pill when something new is out of sight below,
// "Your tutor is writing", then "New reply below". It judges from where a glide
// is headed, so it never flashes during a send, and it fades with your scrolling
// over its last 64px, so it is gone exactly as the new part comes into view.
const pill = $("newPill");
pill.innerHTML = `<span class="lab"></span>${icon("down", "sm")}`;
function updatePill() {
  if (route.name !== "session" || LOG.tab !== "log") { setPill(false); return drawEdges(); }
  const gap = SC.gapNow(), out = !SC.moving && gap > 24, writing = T.running && busy();
  if (!out && !writing) SC.seen = true;
  setPill(out && (writing || !SC.seen), writing ? "Your tutor is writing" : "New reply below");
  drawPill();
}
// Gone at 24px left and fully there 64px further out (spec tuning: opacity 0 at 24px),
// so it never sits faintly on the last line as that line comes into view.
const pillLeft = () => Math.max(0, Math.min(1, (SC.gapNow() - 24) / 64));
function drawPill() {
  const pk = pillLeft(), o = SC.pa * pk;
  pill.style.opacity = o.toFixed(3);
  pill.style.filter = SC.pa > 0.99 || calm() ? "" : `blur(${((1 - SC.pa) * 3).toFixed(2)}px)`;
  pill.style.translate = `-50% ${calm() ? 0 : ((1 - SC.pa) * 6).toFixed(2)}px`;
  pill.classList.toggle("on", SC.pillOn && o > 0.4);
  drawEdges(pk);
}
function setPill(on, text) {
  const lab = pill.querySelector(".lab");
  if (on && text !== SC.pillText) {
    const w0 = pill.offsetWidth;
    lab.textContent = text; SC.pillText = text;
    if (SC.pillOn && !calm()) {   // the words change in place: the pill eases to its new width, the words come into focus
      pill.style.width = "auto"; const w1 = pill.offsetWidth; pill.style.width = `${w0}px`;
      tween("settle", (v) => { pill.style.width = v >= 1 ? "" : `${(w0 + (w1 - w0) * v).toFixed(1)}px`; lab.style.opacity = v >= 1 ? "" : String(v); lab.style.filter = v > 0.99 ? "" : `blur(${((1 - v) * 3).toFixed(2)}px)`; });
    }
  }
  if (on === SC.pillOn) return;
  SC.pillOn = on;
  if (SC.paSpring) SC.paSpring.stop();
  if (calm()) { SC.pa = on ? 1 : 0; return drawPill(); }
  SC.paSpring = window.motion.spring(SC.pa, { to: on ? 1 : 0, feel: on ? "settle" : "snappy", onUpdate: (v) => { SC.pa = Math.max(0, Math.min(1, v)); drawPill(); } });
}
// It takes you to the end and keeps you there while the tutor writes, until you scroll (Edison, 9 Nov: it "doesn't go
// all the way down", since the reply grew past where the glide was headed). From more than a screen and a half away the
// thread dissolves to the end, as a send from far up does, instead of a long glide.
const endTop = () => Math.max(0, Math.min(maxTop(), contentEnd() - (scroller.clientHeight - dockH()) + 24));
ACTIONS["log-bottom"] = async () => {
  const far = !calm() && endTop() - scroller.scrollTop > scroller.clientHeight * 1.5;
  if (calm()) { takeOver(); SC.follow = true; scroller.scrollTop = endTop(); return; }
  SC.follow = true;
  if (!far) return glideTo(endTop());
  if (SC.spring) SC.spring.stop(); SC.spring = null; SC.aim = null; SC.hold = null;
  SC.moving = true; updatePill();
  const t = $("thread");
  await timed(0.12, (v) => { t.style.opacity = String(1 - v); });
  fitSpacer(); scroller.scrollTop = endTop();
  SC.moving = false; updatePill();
  timed(0.16, (v) => { t.style.opacity = v >= 1 ? "" : String(v); });
};
// While it follows, what the tutor adds moves the glide's aim with it.
new ResizeObserver(() => { if (SC.follow && route.name === "session" && !SC.moving) { const y = endTop(); if (Math.abs(y - (SC.aim ?? scroller.scrollTop)) > 1) glideTo(y); } }).observe($("thread"));
// The edge fades exist only when there is more past the edge, as deep as the
// distance left: up to 28px under the header, 18px above the dock, deepening to
// 52px under the pill so no line of text runs through it.
function drawEdges(pk) {
  if (pk == null) pk = pillLeft();
  const top = scroller.scrollTop, rest = Math.max(0, SC.gapNow());
  // On glass the depths go on the scroller, as its mask (styles.css, "the session on glass"); elsewhere on the session,
  // for the painted fades.
  const [el, ft, fbN, fsN] = GLASS ? [scroller, "--mt", "--mb", "--ms"] : [$("session"), "--ft", "--fb", "--fs"];
  el.style.setProperty(ft, `${Math.min(28, top).toFixed(1)}px`);
  const fb = Math.min(18 + 34 * SC.pa * pk, rest);
  el.style.setProperty(fbN, `${fb.toFixed(1)}px`);
  // Under the pill the fade is solid, so no line of text shows on either side of it.
  el.style.setProperty(fsN, `${Math.min(fb, 38 * SC.pa * pk).toFixed(1)}px`);
}

// The scroll bar is drawn the way the Mac draws its overlay one: a thin thumb that
// shows while you scroll and fades 0.8 s after, with no track, so the panel stays
// one surface. Pointed at, it grows and darkens; drag it, or click where the track
// would be to move a page.
const sbZone = document.createElement("div"), sbThumb = document.createElement("div");
sbZone.className = "sb-zone"; sbThumb.className = "sb-thumb";
$("session").append(sbZone, sbThumb);
const SB = { at: -1e9, on: false, hot: false, drag: null, hide: null, len: 36 };
function drawBar() {
  const top = topInset() + 6, bottom = scroller.clientHeight - dockH() - 6, track = Math.max(0, bottom - top);
  sbZone.style.top = `${top}px`; sbZone.style.height = `${track}px`;
  const S0 = scroller.scrollHeight, H = scroller.clientHeight;
  if (S0 <= H + 1 || track < 40) { sbThumb.style.visibility = "hidden"; return; }
  sbThumb.style.visibility = "";
  SB.len = Math.max(36, track * (H / S0));
  const y = top + (scroller.scrollTop / Math.max(1, maxTop())) * (track - SB.len);
  sbThumb.style.height = `${SB.len.toFixed(1)}px`;
  sbThumb.style.transform = `translateY(${y.toFixed(1)}px)`;
}
function barVisible(on) {
  if (on === SB.on) return;
  SB.on = on;
  tweenAlways("snappy", (v) => { if (SB.on === on) sbThumb.style.opacity = String(on ? v : 1 - v); });
}
function pokeBar() {
  drawBar(); barVisible(true);
  clearTimeout(SB.hide);
  SB.hide = setTimeout(function check() { if (SB.hot || SB.drag) { SB.hide = setTimeout(check, 300); return; } barVisible(false); }, 800);
}
const setHot = (v) => { SB.hot = v; sbThumb.classList.toggle("hot", v || !!SB.drag); if (v) pokeBar(); };
// A trackpad over the thumb's strip still scrolls the thread, as the Mac's own bar does.
for (const el of [sbZone, sbThumb]) el.addEventListener("wheel", (e) => { takeOver(); scroller.scrollBy(e.deltaX, e.deltaY); e.preventDefault(); }, { passive: false });
sbZone.addEventListener("pointerenter", () => setHot(true));
sbZone.addEventListener("pointerleave", () => setHot(false));
sbThumb.addEventListener("pointerenter", () => setHot(true));
sbThumb.addEventListener("pointerleave", () => { if (!SB.drag) setHot(false); });
sbThumb.addEventListener("pointerdown", (e) => { e.preventDefault(); takeOver(); sbThumb.setPointerCapture(e.pointerId); SB.drag = { y: e.clientY, s: scroller.scrollTop }; setHot(true); });
sbThumb.addEventListener("pointermove", (e) => {
  if (!SB.drag) return;
  const track = scroller.clientHeight - dockH() - 12 - topInset();
  scroller.scrollTop = SB.drag.s + (e.clientY - SB.drag.y) * maxTop() / Math.max(1, track - SB.len);
});
sbThumb.addEventListener("pointerup", () => { SB.drag = null; setHot(sbThumb.matches(":hover")); });
sbZone.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const r = sbThumb.getBoundingClientRect(), page = (scroller.clientHeight - dockH() - topInset()) * 0.9;
  glideTo(scroller.scrollTop + (e.clientY < r.top ? -page : page));
});
scroller.addEventListener("scroll", () => {
  if (SC.hold == null) fitSpacer();
  updatePill();
  pokeBar();
}, { passive: true });
new ResizeObserver(() => { drawBar(); updatePill(); }).observe(scroller);
ACTIONS["log-all"] = () => { LOG.showAll = true; paintThread(true); };
ACTIONS.think = (k) => {
  LOG.think[k] = !LOG.think[k];
  const top = $("threadScroll").scrollTop;
  paintLog(false);
  $("threadScroll").scrollTop = top;
};
// Opening and folding a card: its space eases to the new height on the glide spring's curve while the new face fades
// in, so the thread below slides rather than jumps (Edison, 9 Nov: "make an animation to open up the card").
ACTIONS["q-unfold"] = (k) => {
  if (getSelection && String(getSelection()).trim()) return;   // selecting words on a card isn't a click on it
  const at = () => document.querySelector(`#thread .item[data-key="${CSS.escape(k)}"]`);
  const h0 = at() ? at().offsetHeight : 0;
  LOG.unfold[k] = !LOG.unfold[k];
  const top = $("threadScroll").scrollTop;
  paintLog(false);
  $("threadScroll").scrollTop = top;
  const n = at();
  if (!n || !h0 || calm()) return;
  const h1 = n.offsetHeight, open = LOG.unfold[k];
  n.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: open ? 340 : 280, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
  n.style.overflow = "clip";
  setTimeout(() => { if (n.isConnected) n.style.overflow = ""; }, open ? 360 : 300);
  [...n.children].forEach((c) => c.animate([{ opacity: 0, transform: open ? "translateY(-4px)" : "none" }, { opacity: 1, transform: "none" }], { duration: open ? 240 : 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }));
};
ACTIONS["copy-code"] = (_a, el) => {
  const pre = el.parentElement.querySelector("pre");
  navigator.clipboard.writeText(pre ? pre.textContent : "");
  el.textContent = "Copied";
  setTimeout(() => { el.textContent = "Copy"; }, 1200);
};

// ---------- plan panel ----------
function paintPlan() {
  const s = subj(route.slug), el = $("plan");
  if (!s) { el.innerHTML = ""; return; }
  const cur = s.nodes.find((n) => n.status === "introduced") || s.nodes.find((n) => n.id === s.up_next);
  const left = s.total - s.proven;
  const top = el.scrollTop;
  el.innerHTML = `<div class="plan-head"><b>This session</b><button class="icon-btn flip" data-act="toggle-panel" aria-label="Hide plan" data-tip="Hide plan  ${keyAlt("0")}" data-tip-side="left-down">${icon("sidebar")}</button></div>
    <div class="cap">${[courseCode(s), s.deadline ? `due ${dayWord(s.days_to_deadline ?? 99).toLowerCase()}` : "", s.total ? `${s.proven} of ${s.total} passed` : ""].filter(Boolean).join(" · ")}</div>
    ${s.nodes.length ? s.nodes.map((n) => {
      const c = discClass(n, s);
      // the Skills page's brick for each skill (6 Nov: the panel was the old style): lit when passed, orange when due, ringed for now
      const bk = n.status === "decayed" ? "due" : c === "checked" || c === "solid" ? "pass" : cur && n.id === cur.id ? "now" : "not";
      return `<button class="plan-card ${cur && n.id === cur.id ? "cur" : ""} ${c === "checked" || c === "solid" ? "done" : ""}" data-act="go-subject" data-arg="map"${n.can_do && !(cur && n.id === cur.id) ? ` title="${esc(cap(n.can_do.replace(/[`*]/g, "")))}"` : ""}>${GLASS ? `<span class="s-bond pc-bk" title="${esc(STATUS_WORD[n.status] || "")}"><i class="${bk}"></i></span>` : discEl(n, s)}<div><span class="pc-name">${md(n.name)}</span>${n.can_do && cur && n.id === cur.id ? `<span class="pc-sub">${md(cap(n.can_do))}</span>` : ""}</div>${icon("chev")}</button>`;
    }).join("") : `<div class="cap" style="padding:8px 0">No plan yet. A few more questions to find where you start.</div>`}
    <div class="plan-foot">${s.status === "done" ? "Goal met." : s.total ? (left ? `${left} ${left === 1 ? "skill" : "skills"} to go` : "Every skill passed") : ""}</div>`;
  el.scrollTop = top;
  typeset(el);
}

// ---------- palette ----------
let pal = null;
function openPalette() {
  if (!S) return;
  const top = S.ranked[0];
  const recents = top ? [{ label: `${VERB[top.kind] || "Start"} ${top.subject ? esc(shortTitle(subj(top.subject))) : top.kind === "Review" ? "review" : "something new"}`, why: plain(top).line, s: top.subject ? subj(top.subject) : null, run: () => run(top), keys: key("↩") }] : [];
  const session = [
    { label: "Start a review", ic: "review", run: ACTIONS.review, keys: key("R") },
    { label: "Check me", ic: "checkme", run: ACTIONS.check, keys: key("J") },
    { label: "Ask for a hint", ic: "hint", run: ACTIONS.hint, keys: key("/") },
    { label: "Take a break", ic: "pause", run: ACTIONS.break, keys: key("B") },
    { label: "End and save the session", ic: "end", run: ACTIONS.end, keys: keyShift("E") },
    { label: "Start a subject", ic: "plus", run: ACTIONS.start, keys: key("N") },
    { label: "Show the terminal", ic: "terminal", run: ACTIONS["toggle-term"], keys: "Ctrl+`", more: true },
    { label: `Restart ${tutorName()}`, ic: "review", run: ACTIONS.restart, more: true },
    { label: `Open ${tutorName()} with no command`, ic: "terminal", run: () => { go("session"); startTutor(""); }, more: true },
  ];
  // An empty search shows what is usually picked (6 Nov, Edison: the list was long and hard to read on a 27" screen):
  // the next step, five session commands, the next four subjects after it, four places. The rest ("more") and every
  // subject wait for a word typed.
  const resumes = S.ranked.filter((x) => x.subject && x.kind !== "Review" && x !== top).slice(0, 12).map((x, i) => {
    const s = subj(x.subject);
    return { label: `${x.kind === "Repair" ? "Repair" : "Resume"} ${esc(shortTitle(s))}`, why: plain(x).line, s, run: () => run(x), more: i >= 4 };
  });
  const practice = S.subjects.filter((s) => s.proven).map((s) => ({ label: `Practice ${esc(shortTitle(s))}`, s, run: () => ACTIONS.practice(s.slug) }));
  const goTo = [
    { label: "Home", ic: "home", run: () => go("home"), keys: key("1") },
    { label: "Session", ic: "session", run: () => go("session"), keys: key("2") },
    { label: "All skills", ic: "skills", run: () => go("system"), keys: key("3") },
    { label: "Settings", ic: "settings", run: openSettings, keys: key(",") },
    { label: "Dashboard", ic: "dashboard", run: () => go("dashboard"), keys: key("4"), more: true },
    { label: "Progress", ic: "dashboard", run: () => go("progress"), keys: key("5"), more: true },
    { label: "Skill map", ic: "skills", run: () => go("map"), keys: key("6"), more: true },
    { label: "Open another vault", ic: "note", run: chooseVault, keys: key("O"), more: true },
  ];
  const subjects = S.subjects.map((s) => ({ label: md(s.title), s, run: () => go("session", s.slug) }));
  const questions = (QALL || []).map((x) => ({ label: esc(x.title), why: x.lesson ? `Became a lesson` : x.moved ? "Moved to its subject" : x.archived ? "Archived" : "", ic: "session", run: () => ACTIONS.question(x.id) }));
  if (qPage() && Q.id && Q.chat && !Q.chat.lesson) session.unshift({ label: "Turn this question into a lesson", ic: "plus", run: () => ACTIONS["question-lesson"](Q.chat.title) });
  pal = { q: "", sel: 0, groups: [["Next step", recents], ["Session", session], ["Resume", resumes], ["Go to", goTo], ["Subjects", subjects], ["Questions", questions], ["Practice", practice]] };
  const scrim = $("scrim");
  scrim.classList.remove("clear");
  scrim.classList.add("on");
  scrim.innerHTML = `<div class="card float palette" role="dialog" aria-label="Search and commands"><div class="head">${icon("search")}<input id="palq" placeholder="Search or run a command" autocomplete="off" spellcheck="false" aria-label="Search"></div><div class="list" id="palList" role="listbox"></div><div class="foot cap"><span class="kbd">↑</span><span class="kbd">↓</span>Move<span class="kbd" style="margin-left:10px">↩</span>Open<span class="kbd" style="margin-left:10px">Esc</span>Close<span style="margin-left:auto">Type to search everything</span></div></div>`;
  const q = $("palq");
  q.focus();
  q.oninput = () => { pal.q = q.value.toLowerCase().trim(); pal.sel = 0; palList(); };
  palList();
}
function palItems() {
  return pal.groups.map(([g, items]) => [g, items.filter((i) => pal.q ? (i.label + " " + (i.why || "")).replace(/<[^>]+>/g, "").toLowerCase().includes(pal.q) : !i.more)])
    .filter(([g, items]) => items.length && (pal.q || (g !== "Practice" && g !== "Subjects" && g !== "Questions")));
}
function palList() {
  let i = 0;
  $("palList").innerHTML = palItems().map(([g, items]) => `<div class="cap grp">${g}</div>` + items.map((it) => {
    const n = i++;
    return `<button class="item ${n === pal.sel ? "sel" : ""} ${g === "Next step" ? "lead" : ""} ${it.s ? "subj" : ""}" role="option" aria-selected="${n === pal.sel}" data-act="pal-run" data-arg="${n}" data-pal="${n}"${it.s ? ` style="${subjVar(it.s)}"` : ""}>${icon(it.s ? themeOf(it.s) : it.ic || "chev", "sm")}<span style="flex:none">${it.label}</span>${it.why ? `<span class="why">${md(it.why)}</span>` : ""}${it.keys ? `<span style="margin-left:auto;padding-left:10px" class="keys">${it.keys.split(/(?<=⌘|⇧|⌥)|\+/).filter(Boolean).map((x) => `<span class="kbd">${esc(x)}</span>`).join("")}</span>` : ""}</button>`;
  }).join("")).join("") || `<div class="cap" style="padding:16px">Nothing matches.</div>`;
  const sel = document.querySelector(".palette .item.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}
$("scrim").addEventListener("mousemove", (e) => {
  const it = e.target.closest("[data-pal]");
  if (it && pal && +it.dataset.pal !== pal.sel) { pal.sel = +it.dataset.pal; [...document.querySelectorAll(".palette .item")].forEach((x) => x.classList.toggle("sel", +x.dataset.pal === pal.sel)); }
});
$("scrim").addEventListener("mousedown", (e) => { if (e.target !== $("scrim")) return; if (quitCard) answerQuit("cancel"); else closeOverlay(); });
ACTIONS["pal-run"] = (n) => palRun(+n);
function palRun(n) { const it = palItems().flatMap(([, items]) => items)[n]; closeOverlay(); if (it) it.run(); }
ACTIONS.palette = () => openPalette();

// ---------- settings ----------
async function openSettings() {
  pal = null;
  const scrim = $("scrim");
  scrim.classList.remove("clear");
  scrim.classList.add("on");
  const theme = cfg.theme || "system";
  const stone = Stone.pick(cfg.stone), nightNow = document.documentElement.dataset.theme === "night";
  // Each preview wears its own theme's tokens, so it shows true colors in either mode.
  // Each preview is a small window of the app in that theme: the stone's glass, a sidebar, a sheet with a headline and
  // the field (11 Nov, Edison: the flat white and black bars "don't match the vibe of the app").
  const pv = (t) => `<span class="pv-${t}" style="--pv-tone:${Stone.tone(stone, t === "night")}"><b class="pv-side"></b><b class="pv-sheet"><i></i><i></i><u></u></b></span>`;
  const wallSection = F.wall && F.platform === "darwin" ? await wallSettings() : "";   // pictures come from macOS; elsewhere the wallpaper is the stone glass
  const thumb = (value, label, preview) => `<button class="thumb ${theme === value ? "on" : ""}" data-act="set-theme" data-arg="${value}" aria-pressed="${theme === value}"><div class="pv">${preview}</div><div class="lab">${label}</div></button>`;
  scrim.innerHTML = `<div class="card float sheet" role="dialog" aria-label="Settings">
    <div style="display:flex;align-items:center"><h2 class="t-head">Settings</h2><button style="margin-left:auto" class="icon-btn" data-act="close" aria-label="Close" data-tip="Esc">${icon("x")}</button></div>
    <div class="sec"><div class="t-sec">Appearance</div>
      <div class="thumbs">${thumb("system", "System", pv("light") + pv("night"))}${thumb("light", "Light", pv("light"))}${thumb("night", "Night", pv("night"))}</div></div>
    <div class="sec"><div class="t-sec">Stone</div>
      <div class="stones" role="radiogroup" aria-label="Stone">${Stone.ORDER.map((c) => `<button class="stone ${stone === c ? "on" : ""}" role="radio" aria-checked="${stone === c}" data-act="set-stone" data-arg="${c}"><span class="st-tile"><img alt="" src="${Stone.icon(c, nightNow)}"></span><span class="lab">${Stone.NAMES[c]}</span></button>`).join("")}</div></div>
    ${wallSection}
    <div class="sec"><div class="t-sec">Your name</div>
      <div class="cap" style="margin-top:2px">For the greeting on Home.</div>
      <input id="nameIn" class="field" value="${esc(firstName())}" placeholder="Your first name" aria-label="Your first name"></div>
    <div class="sec"><div class="t-sec">Tutor</div>
      <div class="cap" style="margin-top:2px">The command this app runs in your vault. It uses your own sign-in.</div>
      <div class="seg" style="margin-top:8px" role="radiogroup">${[["claude", "Claude Code"], ["codex", "Codex"]].map(([v, l]) => `<button class="${cfg.host === v ? "on" : ""}" role="radio" aria-checked="${cfg.host === v}" data-act="set-host" data-arg="${v}">${l}</button>`).join("")}</div></div>
    <div class="sec"><div class="t-sec">Rewards ${S && S.rewards_on ? "on" : "off"}</div>
      <div class="cap" style="margin-top:2px">Badges and the review streak. Ask the tutor to turn them ${S && S.rewards_on ? "off" : "on"}; it is the <span class="mono">rewards:</span> line in learn/me/preferences.md.</div></div>
    <div class="sec"><div style="display:flex;align-items:center;gap:12px"><div style="min-width:0;flex:1"><div class="t-sec">Vault folder</div><div class="cap mono selectable" style="margin-top:2px;word-break:break-all">${esc(cfg.vault || "None")}</div></div><button class="btn neutral" style="flex:none" data-act="choose-vault" data-tip="${key("O")}">Change…</button></div></div>
    <div class="cap" style="padding-top:12px;border-top:1px solid var(--color-line)">${esc(info.name)} ${esc(info.version)}. The app writes no learning record; the tutor does.</div>
  </div>`;
  const nameIn = $("nameIn");
  nameIn.addEventListener("change", () => { setCfg({ name: nameIn.value.trim() }); if (route.name === "home") paintHome(); });
}
ACTIONS.settings = () => openSettings();
// Settings' Wallpaper choices: your desktop, stone glass, a photo, the moving Mac wallpapers, then the Aerials
// Edison picked (lib/wallpaper-picks.json) by group. Thumbnails are files already on this Mac.
async function wallSettings() {
  const cat = await F.wall.catalog(), wk = wallKey(cfg.wallpaper);
  // A moving wallpaper plays from a small copy the app makes once (about a minute and a half). A tile says where its
  // copy stands, on the tile itself (11 Nov, Edison: "nothing was loading... didn't know things were downloading",
  // "no indication of what wallpapers I have downloaded"): an arrow when there is none yet, a bar while it is made.
  const opt = (arg, label, inner, act = "set-wall", st = null) => `<button class="wall-opt ${(arg || "photo") === wk || (act === "wall-photo" && wk.startsWith("photo")) ? "on" : ""}${st && !st.ready ? " need" : ""}${st && st.busy ? " busy" : ""}" role="radio" aria-checked="${arg === wk}" data-act="${act}"${arg ? ` data-arg="${esc(arg)}"` : ""}${st ? ` data-key="${esc(st.key)}"` : ""}><span class="wt">${inner}${st ? `<i class="wt-get" aria-hidden="true">${WALL_GET}</i><i class="wt-bar" aria-hidden="true"><b></b></i>` : ""}</span><span class="wl">${esc(label)}</span></button>`;
  const img = (u) => (u ? `<img alt="" loading="lazy" src="${esc(u)}">` : "");
  const air = (a) => opt(`aerial:${a.id}`, a.name, img(a.thumb), "set-wall", a);
  const groups = ["Landscapes", "Underwater", "Space"].map((g) => {
    const xs = cat.aerials.filter((a) => a.group === g); if (!xs.length) return "";
    return `<div class="wall-group">${g}</div><div class="walls" role="radiogroup" aria-label="${g}">${xs.map(air).join("")}</div>`;
  }).join("");
  const macAerials = cat.aerials.filter((a) => a.group === "Mac");   // Apple files some Aerials under Mac (Mac Blue)
  const mac = cat.mac.length || macAerials.length ? `<div class="wall-group">Mac</div><div class="walls" role="radiogroup" aria-label="Mac">${cat.mac.map((m) => opt(`mac:${m.id}`, m.name, img(m.thumb), "set-wall", m)).join("")}${macAerials.map(air).join("")}</div>` : "";
  return `<div class="sec"><div class="t-sec">Wallpaper</div>
      <div class="cap" style="margin-top:2px">Moves on Home while your Mac is plugged in. Holds still in sessions and on battery. A wallpaper marked with an arrow gets ready the first time you pick it, in about a minute and a half. Its still shows until then.</div>
      <div class="walls" role="radiogroup" aria-label="Wallpaper">${opt("desktop", "Your desktop", img(cat.desktopThumb))}${opt("stone", "Stone glass", '<i class="wt-stone"></i>')}${opt("", "A photo…", cat.photoThumb ? img(cat.photoThumb) : `<i class="wt-add">${icon("plus")}</i>`, "wall-photo")}</div>
      ${mac}${groups}
      <div id="wallStatus" class="cap wall-status" aria-live="polite"></div>
      <div class="wall-kept"><span class="cap" id="wallKept">${keptWords(cat.copies)}</span><button class="btn text" id="wallClear" data-act="wall-clear"${cat.copies && cat.copies.count > 1 ? "" : " hidden"}>Remove the others</button></div></div>`;
}
const WALL_GET = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1.8v6.4"/><path d="M3.4 5.8 6 8.4l2.6-2.6"/><path d="M2.4 10.4h7.2"/></svg>`;
const keptWords = (c) => (!c || !c.count ? "No moving wallpapers are kept on this Mac yet." : `${c.count} moving ${c.count === 1 ? "wallpaper is" : "wallpapers are"} kept on this Mac, ${Math.max(1, Math.round(c.bytes / 1e6))} MB.`);
// Give the space back: every copy goes but the one in use. A removed wallpaper shows its arrow again.
ACTIONS["wall-clear"] = async () => {
  const c = await F.wall.clear(document.documentElement.dataset.theme === "night"), cat = await F.wall.catalog();
  const ready = new Set([...cat.aerials, ...cat.mac].filter((x) => x.ready).map((x) => x.key));
  document.querySelectorAll("#scrim .wall-opt[data-key]").forEach((b) => b.classList.toggle("need", !ready.has(b.dataset.key)));
  if ($("wallKept")) $("wallKept").textContent = keptWords(c);
  if ($("wallClear")) $("wallClear").hidden = !(c.count > 1);
};
ACTIONS.close = () => closeOverlay();
// Picking a theme or a stone updates the open sheet in place; drawing it again replayed its entrance (10 Nov, Edison:
// "the settings tab pops up again or like reloads when you switch the colors").
function syncSettings() {
  const sheet = document.querySelector("#scrim .sheet"); if (!sheet) return;
  const theme = cfg.theme || "system", stone = Stone.pick(cfg.stone), night = document.documentElement.dataset.theme === "night";
  sheet.querySelectorAll('.thumb[data-act="set-theme"]').forEach((b) => { const on = b.dataset.arg === theme; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  sheet.querySelectorAll(".thumb .pv span").forEach((sp) => sp.style.setProperty("--pv-tone", Stone.tone(stone, sp.classList.contains("pv-night"))));
  const wk = wallKey(cfg.wallpaper);
  sheet.querySelectorAll(".wall-opt").forEach((b) => { const on = (b.dataset.arg || "photo") === wk || (b.dataset.act === "wall-photo" && wk.startsWith("photo")); b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  sheet.querySelectorAll('.stone[data-act="set-stone"]').forEach((b) => {
    const on = b.dataset.arg === stone; b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
    const img = b.querySelector("img"), src = Stone.icon(b.dataset.arg, night); if (img && img.getAttribute("src") !== src) img.src = src;
  });
}
ACTIONS["set-theme"] = async (t) => { await setCfg({ theme: t }); applyTheme(); syncSettings(); if (window.Wall) Wall.reload(); };
ACTIONS["set-stone"] = async (c) => { await setCfg({ stone: c }); applyStone(document.documentElement.dataset.theme === "night"); syncSettings(); if (window.Wall) Wall.stone(); };
// The wallpaper (wallpaper.js, lib/wallpaper.js). data-arg is "kind" or "kind:id".
const wallKey = (w) => (w && w.kind ? (w.id ? `${w.kind}:${w.id}` : w.kind) : "desktop");
ACTIONS["set-wall"] = async (arg) => {
  const [kind, ...rest] = arg.split(":"), id = rest.join(":");
  await setCfg({ wallpaper: id ? { kind, id } : { kind } }); syncSettings(); if (window.Wall) Wall.reload(true);   // a pick you make tries again even after a failure
};
ACTIONS["wall-photo"] = async () => {
  const file = await F.wall.choosePhoto(); if (!file) return;
  await setCfg({ wallpaper: { kind: "photo", file } }); syncSettings(); if (window.Wall) Wall.reload();
};
// A copy being made shows on its own tile (a bar that fills) and in one line above the choices, while Settings is open.
const wallTile = (key) => [...document.querySelectorAll("#scrim .wall-opt[data-key]")].find((b) => key === b.dataset.key || key === b.dataset.key + "-dark");
if (F.wall) F.wall.onStatus((st) => {
  const el = document.querySelector("#scrim #wallStatus"), tile = wallTile(st.key);
  if (tile) {
    tile.classList.toggle("busy", !st.done);
    if (!st.done) tile.style.setProperty("--p", `${st.progress || 0}%`);
    if (st.done && st.ok) tile.classList.remove("need");
  }
  if (st.done && st.ok) F.wall.catalog().then((cat) => { if ($("wallKept")) $("wallKept").textContent = keptWords(cat.copies); if ($("wallClear")) $("wallClear").hidden = !(cat.copies.count > 1); });
  if (!el || st.stopped) return;
  el.textContent = st.done ? (st.ok ? `${st.label} is ready.` : `Couldn't get ${st.label}. Check your connection and pick it again.`) : `Getting ${st.label} ready… ${st.progress || 0}%`;
});
ACTIONS["set-host"] = async (h) => {
  if (h === cfg.host) return;
  if (T.running && !confirm(`Switch to ${h === "codex" ? "Codex" : "Claude Code"}? The running tutor stops. Your records stay as they are.`)) return;
  await F.pty.stop(); T.running = false;
  await setCfg({ host: h });
  closeOverlay();
  boot();
};
ACTIONS["choose-vault"] = () => chooseVault();
function closeOverlay() {
  const s = $("scrim");
  s.classList.remove("on", "clear", "veil"); s.style.opacity = ""; s.innerHTML = ""; pal = null; closeCard = null;   // Esc on a card left .veil, an invisible scrim over everything (7 Nov)
  const sw = $("switcher"); if (sw) sw.setAttribute("aria-expanded", "false");
  if (route.name === "session") { if (T.drawer && T.term) T.term.focus(); else focusMsg(); }
}

async function chooseVault(make) {
  closeOverlay();
  const r = await (make ? F.createVault(vaultParent()) : F.chooseVault());
  if (r.canceled) return;
  if (r.problem) { toast(r.problem); return; }
  T.running = false;
  Object.keys(sessionCache).forEach((k) => delete sessionCache[k]);
  Object.keys(mapViews).forEach((k) => delete mapViews[k]);
  LOG.slug = null;
  if (T.term) T.term.reset();
  boot();
}
ACTIONS["open-vault"] = () => chooseVault();
ACTIONS["make-vault"] = () => chooseVault(true);
// Where a new vault goes (11 Nov, Edison: let a friend choose, Documents by default). Setup offers Documents, the
// Desktop, or any folder; the line under the choice says the exact folder Make a new vault will create.
let vaultWhere = { key: "documents", dir: null };
const vaultParent = () => vaultWhere.dir || ((setupInfo || {}).places || {})[vaultWhere.key] || null;
ACTIONS["vault-where"] = async (k) => {
  if (k === "other") { const dir = await F.pickVaultParent(); if (!dir) return; vaultWhere = { key: "other", dir }; }
  else vaultWhere = { key: k, dir: null };
  paintSetup();
};
async function showVaultTarget() {
  const el = $("vaultTarget"), parent = vaultParent();
  if (!el || !parent) return;
  const dir = await F.vaultTarget(parent), home = ((setupInfo || {}).places || {}).home;
  if (el.isConnected && dir) el.textContent = home && F.platform !== "win32" && dir.startsWith(home + "/") ? "~" + dir.slice(home.length) : dir;
}

// ---------- setup ----------
function paintSetup() {
  $("session").classList.add("hidden");
  $("islands").classList.add("hidden");
  $("screen").classList.remove("hidden");
  $("win").classList.add("bare");
  $("win").classList.remove("planned", "icons");
  $("plan").classList.add("hidden");
  const v = setupInfo || {};
  const vaultOk = !v.vaultProblem;
  const steps = [
    { title: "Your learning vault", text: vaultOk ? "" : v.vault ? v.vaultProblem : v.starter ? "The folder where your subjects, plans and progress live. Make a fresh one, or open one you already have." : `Pick the folder that holds your copy of the learning vault. It has a learn/ folder inside.`, path: v.vault, action: true },
    ...(v.problems || []).map((p) => ({ title: p.what, text: p.fix })),
  ];
  // a found tool is a quiet row with its state on the right, as in System Settings (11 Nov, Edison: the green check
  // "makes it seem unprofessional")
  if (!(v.problems || []).length) steps.push({ title: `Python 3 and ${tutorName()}`, state: "Installed" });
  inkAction = vaultOk ? null : v.starter ? () => chooseVault(true) : chooseVault;   // Return takes the first button
  const where = !vaultOk && v.starter ? `<div class="where"><span class="where-l">Make it in</span><div class="seg" role="radiogroup" aria-label="Where your vault goes">${[["documents", "Documents"], ["desktop", "Desktop"], ["other", "Other folder…"]].filter(([k]) => k === "other" || (v.places || {})[k]).map(([k, l]) => `<button class="${vaultWhere.key === k ? "on" : ""}" role="radio" aria-checked="${vaultWhere.key === k}" data-act="vault-where" data-arg="${k}">${l}</button>`).join("")}</div></div><div class="path" id="vaultTarget">&nbsp;</div>` : "";
  unput($("screen")); $("screen").innerHTML = `<div class="setup">
    <h1 class="t-title">Welcome to ${esc(info.name)}</h1>
    <p class="t-ui ink2" style="font-size:15px;line-height:22px;margin-top:8px">Your tutor, your skill maps, and your progress in one window. ${esc(info.name)} runs your own ${esc(tutorName())} in your vault, so everything works as it does in the terminal.</p>
    ${steps.map((st) => `<div class="card stepc${st.state ? " row" : ""}"><div class="sc-top"><div class="t-sec">${esc(st.title)}</div>${st.state ? `<span class="sc-state">${esc(st.state)}</span>` : ""}</div>
      ${st.path ? `<div class="path">${esc(st.path)}</div>` : ""}${st.text ? `<div class="fix">${esc(st.text)}</div>` : ""}
      ${st.action ? `${where}<div class="sc-acts">${vaultOk ? `<button class="btn neutral" data-act="choose-vault">Choose another folder</button>`
        : v.starter ? `<button class="btn" data-act="make-vault">Make a new vault</button><button class="btn neutral" data-act="choose-vault" data-tip="${key("O")}">Open one I have</button>`
        : `<button class="btn" data-act="choose-vault" data-tip="${key("O")}">Choose folder</button>`}</div>` : ""}
    </div>`).join("")}
    ${(v.problems || []).length ? `<div style="margin-top:18px;display:flex;gap:10px;align-items:center"><button class="btn${vaultOk ? "" : " neutral"}" data-act="recheck">Check again</button><span class="cap">After installing or signing in, check again.</span></div>` : ""}
    <div class="t-sec" style="margin-top:26px">Your tutor</div><div class="cap" style="margin-top:2px">The app runs it with your own subscription.</div>
    <div class="seg" style="margin-top:10px" role="radiogroup" aria-label="Tutor">${[["claude", "Claude Code"], ["codex", "Codex"]].map(([h, l]) => `<button class="${cfg.host === h ? "on" : ""}" role="radio" aria-checked="${cfg.host === h}" data-act="setup-host" data-arg="${h}">${l}</button>`).join("")}</div>
  </div>`;
  if (vaultOk && (v.problems || []).length) inkAction = boot;
  showVaultTarget();
}
ACTIONS.recheck = () => boot();
ACTIONS["setup-host"] = async (h) => { await setCfg({ host: h }); boot(); };

function paintError(state) {
  route = { name: "home", slug: route.slug };
  $("session").classList.add("hidden");
  $("islands").classList.add("hidden");
  $("screen").classList.remove("hidden");
  inkAction = boot;
  unput($("screen")); $("screen").innerHTML = `<div class="setup"><h1 class="t-head">Could not read the records</h1>
    <p class="t-ui ink2" style="margin-top:8px">learn-status.py stopped with an error, so nothing is shown. Your files were not changed.</p>
    ${state.detail ? `<pre class="card selectable" style="margin-top:14px;padding:12px;white-space:pre-wrap;font:var(--type-code);font-size:12px;color:var(--color-ink-2)">${esc(state.detail)}</pre>` : ""}
    <div style="margin-top:16px;display:flex;gap:10px"><button class="btn" data-act="recheck">Try again</button><button class="btn neutral" data-act="choose-vault">Choose another folder</button></div></div>`;
}

// ---------- quitting while the tutor writes ----------
// ⌘Q asks the window first (main.js). While the tutor writes, the question comes
// over everything the way ⌘K does, on the same veil, front and center (spec,
// Quit card locked 1 Nov). Return quits after this reply, Esc or a click on the
// veil cancels, and ⌘Q again quits now. If the reply ends while you decide, the
// question answers itself.
let quitCard = null;     // the card while it is up
let quitAfter = false;   // "Quit after this reply": the window has gone; Flash waits for the tutor
F.onQuitRequest(() => {
  F.quitAck();
  if (quitCard || quitAfter) return quitNow();   // ⌘Q again
  if (T.running && busy()) return askQuit();
  quitNow();
});
function quitNow() { saveDraft(); unreadToDrafts(); F.quitNow(); }
// Messages still waiting to be sent survive a quit: they go back into their
// subject's draft, ahead of anything half-typed there, so Return sends them again.
function unreadToDrafts() {
  const left = T.queue.filter((q) => !solo(q.message) && msgText(q.message).trim());
  if (!left.length) return;
  T.queue = [];
  const bySlug = {};
  left.forEach((q) => (bySlug[draftKey(q.slug)] = bySlug[draftKey(q.slug)] || []).push(msgText(q.message).trim()));
  Object.entries(bySlug).forEach(([k, texts]) => {
    const had = k === draftKey(draftSlug) ? msgValue().trim() : (DRAFTS[k] || "").trim();
    DRAFTS[k] = [...texts, had].filter(Boolean).join("\n\n");
    if (k === draftKey(draftSlug)) setMsg(DRAFTS[k]);   // the box and the saved draft stay the same words
  });
  localStorage.setItem("flash-drafts", JSON.stringify(DRAFTS));
}
function askQuit() {
  F.showWindow();
  if ($("scrim").classList.contains("on")) closeOverlay();
  const scrim = $("scrim");
  scrim.innerHTML = `<div class="card float quit-card" role="alertdialog" aria-labelledby="quitQ"><div class="qc-h" id="quitQ">Quit while your tutor is writing?</div>
    <div class="qc-b"><button class="btn text" data-act="quit-answer" data-arg="cancel">Cancel</button><button class="btn text" data-act="quit-answer" data-arg="now">Quit now</button><button class="btn" data-act="quit-answer" data-arg="after">Quit after this reply<span class="rk" aria-hidden="true">${RET_ICON}</span></button></div></div>`;
  scrim.classList.add("on", "veil");
  const card = scrim.querySelector(".quit-card");
  scrim.style.opacity = "";
  quitCard = { card, watch: setInterval(() => { if (quitCard && !quitCard.said && !busy()) answerQuit("finished"); }, 200) };
  // A fade, because a key press has no direction (⌘K's rule).
  scrim.style.opacity = "0"; card.style.opacity = "0";
  tweenAlways("snappy", (v) => { scrim.style.opacity = v >= 1 ? "" : String(v); card.style.opacity = v >= 1 ? "" : String(v); });
  card.querySelector('[data-arg="after"]').focus({ preventScroll: true });
}
ACTIONS["quit-answer"] = (a) => answerQuit(a);
function answerQuit(a) {
  const q = quitCard;
  if (!q || q.said) return;
  if (a === "cancel") {
    clearInterval(q.watch); quitCard = null;
    // the card goes first, the place sharpens after, so two layers never cross
    const scrim = $("scrim"), card = q.card;
    tweenAlways("snappy", (v) => { card.style.opacity = String(1 - v); });
    // A card asked again before this one finished leaving keeps the veil: only this card's veil goes.
    onClock(0.06, () => { if (!card.isConnected || quitCard) return; tweenAlways("snappy", (v) => { if (card.isConnected && !quitCard) scrim.style.opacity = String(1 - v); }).then(() => { if (!card.isConnected || quitCard) return; scrim.style.opacity = ""; scrim.classList.remove("veil"); closeOverlay(); }); });
    return;
  }
  if (a === "now") { clearInterval(q.watch); return quitNow(); }
  // after, or finished: say it in place, then the window goes
  q.said = true; clearInterval(q.watch);
  sayInPlace(q.card, a === "finished" ? "Your tutor just finished. Quitting." : "Quitting after this reply.");
  setTimeout(() => {
    // The reply already ended: quit now, and anything still waiting goes back into its draft.
    if (a === "finished") return quitNow();
    // Otherwise the window goes now, with its card, and Flash leaves once the tutor is done.
    quitAfter = true; F.quitWaiting(true); F.hideWindow();
    quitCard = null; $("scrim").classList.remove("veil"); $("scrim").style.opacity = ""; closeOverlay();
  }, 900);
}
// Brought back from the Dock while it waited: you want Flash, so it stays.
function keepOpen() {
  if (!quitAfter) return;
  quitAfter = false; F.quitWaiting(false);
  toast("The app will stay open.");
}
// The card keeps its place: the buttons step away, the words change, and the card
// closes up around them instead of keeping an empty row.
function sayInPlace(card, text) {
  const head = card.querySelector(".qc-h"), row = card.querySelector(".qc-b");
  const from = card.offsetHeight;
  tweenAlways("snappy", (v) => { row.style.opacity = String(1 - v); head.style.opacity = String(1 - v); }).then(() => {
    head.textContent = text;
    row.style.display = "none";
    const to = card.offsetHeight;
    card.style.overflow = "hidden";
    if (calm()) { card.style.height = ""; } else tween("settle", (v) => { card.style.height = v >= 1 ? "" : `${(from + (to - from) * v).toFixed(2)}px`; });
    tweenAlways("snappy", (v) => { head.style.opacity = v >= 1 ? "" : String(v); });
  });
}
// Quit after this reply: the tutor reads anything still waiting first, answers it,
// and Flash quits once the terminal has been quiet for 1.5s. Messages a picker is
// holding stay unsent and go back into their drafts.
setInterval(() => {
  if (!quitAfter) return;
  if (!T.running) return quitNow();
  const quietFor = Date.now() - T.lastData;
  if (busy() || T.flushing || quietFor < 1500) return;
  if (T.queue.length && quietFor < 4000) return;
  quitNow();
}, 250);
document.addEventListener("keydown", (e) => {
  if (!quitCard) return;
  if (e.key === "Enter" && !composing(e)) {
    e.preventDefault(); e.stopPropagation();
    const b = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-act="quit-answer"]');
    answerQuit(b ? b.dataset.arg : "after");   // Return is "Quit after this reply" unless you tabbed to another answer
  }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); answerQuit("cancel"); }
  else if (e.key === "Tab") return;
  else if (!e.metaKey) e.stopPropagation();   // nothing types into the box behind the veil
}, true);

// ---------- a screenshot, full size ----------
// Any screenshot you pasted opens full size when clicked (Edison, 7 Nov): in a field before sending, or in a bubble
// after. Esc, a click, or the close button puts it back.
const VIEWABLE = "img[data-view], .bubble .shots img, .me .shot, .att img";
document.addEventListener("click", (e) => {
  const img = e.target.closest && e.target.closest(VIEWABLE);
  if (!img || e.target.closest("button")) return;
  e.preventDefault(); e.stopPropagation();
  openViewer(img);
}, true);
function openViewer(img) {
  closeViewer(true);
  const v = document.createElement("div");
  v.className = "viewer"; v.id = "viewer"; v.setAttribute("role", "dialog"); v.setAttribute("aria-label", "Screenshot");
  v.innerHTML = `<img src="${img.currentSrc || img.src}" alt="${esc(img.alt || "Screenshot")}"><button class="icon-btn v-x" aria-label="Close">${icon("x", "sm")}</button>`;
  v.addEventListener("click", () => closeViewer());
  document.body.append(v);
  requestAnimationFrame(() => v.classList.add("on"));
}
function closeViewer(now) {
  const v = $("viewer"); if (!v) return;
  v.id = "";
  if (now || matchMedia("(prefers-reduced-motion: reduce)").matches) return v.remove();
  v.classList.remove("on");
  setTimeout(() => v.remove(), 200);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("viewer")) { e.preventDefault(); e.stopPropagation(); closeViewer(); } }, true);

// ---------- toast ----------
let toastTimer;
function toast(text, action) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(text)}</span>${action ? `<button class="btn text" data-act="${action.act}" data-arg="${esc(action.arg)}">${esc(action.label)}</button>` : ""}<button class="icon-btn" data-act="toast-close" aria-label="Dismiss">${icon("x", "sm")}</button>`;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 5000);
}
ACTIONS["toast-close"] = () => $("toast").classList.remove("on");

// ---------- theme ----------
function applyTheme() {
  const pref = cfg.theme || "system";
  const night = pref === "night" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (night) document.documentElement.dataset.theme = "night"; else delete document.documentElement.dataset.theme;
  applyStone(night);
  if (T.term) T.term.options.theme = termTheme();
  if (S && route.name !== "session") render();
  else if (S) paintThread(true);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
// the stone: the glass tint, your laid bricks and the Dock icon, in this light (stone.js)
let dockKey = "";
function applyStone(night) {
  if (!window.Stone) return;
  const stone = Stone.pick(cfg && cfg.stone);
  Stone.apply(stone, night);
  const k = stone + (night ? "-night" : "-day");
  if (k !== dockKey && F.setDockIcon) { dockKey = k; Stone.png(stone, night).then((png) => png && dockKey === k && F.setDockIcon(png)); }
}

// ---------- keys ----------
document.addEventListener("keydown", (e) => {
  if (pal) {
    const n = palItems().flatMap(([, i]) => i).length;
    if (e.key === "ArrowDown") { pal.sel = Math.min(n - 1, pal.sel + 1); palList(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { pal.sel = Math.max(0, pal.sel - 1); palList(); e.preventDefault(); }
    else if (e.key === "Enter") { palRun(pal.sel); e.preventDefault(); }
    else if (e.key === "Escape") { closeOverlay(); e.preventDefault(); }
    return;
  }
  const menu = document.querySelector("#scrim .menu");
  if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    const items = [...menu.querySelectorAll(".menu-item")], i = items.indexOf(document.activeElement);
    const next = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    if (next) next.focus();
    e.preventDefault();
    return;
  }
  if (e.key === "Escape" && $("scrim").classList.contains("on")) { closeOverlay(); e.preventDefault(); }
  else if (e.key === "Escape" && route.name === "session" && !MSG.contains(document.activeElement) && !document.activeElement.closest(".xterm")) { if (escapeSession()) e.preventDefault(); }
  else if (route.name === "session" && !T.drawer && !$("scrim").classList.contains("on") && typesIntoBox(e)) focusMsg();
});
// Typing anywhere on Session lands in the box: focus moves there on the keydown,
// so the key itself types the character (and ⌘V pastes there).
function typesIntoBox(e) {
  const a = document.activeElement;
  if (MSG.contains(a) || (a && a.closest && a.closest("input, textarea, select, [contenteditable], math-field, .xterm"))) return false;
  if (e.key === "v" && (isMac() ? e.metaKey : e.ctrlKey) && !e.altKey) return true;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === " ") return false;   // space still scrolls the thread or presses a button
  return e.key.length === 1 || e.key === "Process";
}
F.onMenu((id) => {
  if (quitCard) return;   // the quit card holds the window until it is answered
  if ($("scrim").classList.contains("on") && !["palette", "settings"].includes(id)) closeOverlay();
  if (route.name === "setup" && !["open-vault", "settings"].includes(id)) return;
  if (id.startsWith("go:")) return go(id.slice(3));
  const map = {
    palette: openPalette, settings: openSettings, "open-vault": chooseVault, ink: ACTIONS.ink,
    review: ACTIONS.review, check: ACTIONS.check, hint: ACTIONS.hint, break: ACTIONS.break, end: ACTIONS.end,
    start: ACTIONS.start, restart: ACTIONS.restart, "toggle-side": ACTIONS["toggle-side"], "hide-side": ACTIONS["hide-side"],
    "toggle-panel": () => { if (route.name === "session") ACTIONS["toggle-panel"](); },
    "toggle-term": ACTIONS["toggle-term"], math: ACTIONS.math,
    "tab:note": () => { if (route.name !== "session") go("session"); ACTIONS["toggle-note"](); },
    "zoom-in": () => ACTIONS.zoom("in"), "zoom-out": () => ACTIONS.zoom("out"), "zoom-fit": () => ACTIONS.zoom("fit"),
  };
  if (map[id]) map[id]();
});

// ---------- live updates ----------
F.onState((state) => {
  if (!state || state.error) return;
  const screen = $("screen"), top = screen.scrollTop;
  S = state;
  lessonArrived();
  // A refresh repaints what changed and keeps your place; the terminal and the
  // thread are never repainted by it.
  if (route.name === "session" && T.running) lastSaved = Date.now();
  paintSide();
  if (route.name === "question") return;   // a vault change never touches a question chat
  if (route.name === "session") { paintStatus(); if (cfg.panel) paintPlan(); if (!T.running) { paintActs(); if (LOG.data) paintThread(false); } return; }
  // Home never changes under you: it waits until you come back (rule 6).
  if (route.name === "home") { homeStale = true; return; }
  if (pal || $("scrim").classList.contains("on")) return;
  render();
  screen.scrollTop = top;
});
F.onSession(async ({ slug, kind }) => {
  delete sessionCache[slug];
  // While the tutor runs, the thread follows the subject it is writing to.
  if (T.running && kind === "log" && route.name === "session" && slug !== route.slug && subj(slug)) {
    const data = await F.session(slug);
    if (data.logMtime > T.startedAt) { sessionCache[slug] = Promise.resolve(data); route.slug = slug; render(); return; }
  }
  if (slug !== LOG.slug) return;
  prefetchSession(slug);
  const data = await sessionCache[slug];
  if (slug !== LOG.slug) return;
  LOG.data = data;
  if (route.name === "session" && (kind === "log" ? LOG.tab === "log" : LOG.tab === "note")) { paintThread(false); paintComposer(); }
});
F.onFocus(async () => {
  keepOpen();
  if (!S || route.name === "setup") return;
  const state = await F.state();
  const changed = state && !state.error && JSON.stringify(state) !== JSON.stringify(S);
  if (changed) { S = state; paintSide(); }
  if ((changed || homeStale) && route.name !== "session" && !quitCard) {
    const top = $("screen").scrollTop, caret = document.activeElement && document.activeElement.id === "ask";
    render(); $("screen").scrollTop = top;
    if (caret && $("ask")) $("ask").focus({ preventScroll: true });   // coming back never moves you
  }
});
window.addEventListener("resize", () => { if (MAPS.includes(route.name)) applyMap(); });

// ---------- boot ----------
let booted = false;
async function boot() {
  info = info || await F.info();
  cfg = await F.config();
  // The plan panel starts closed each launch (7 Nov, Edison: it shouldn't be remembered after a quit); the terminal
  // already starts closed. Within a run, the toggle holds.
  if (!booted) { booted = true; if (cfg.panel) setCfg({ panel: false }); }
  document.body.classList.toggle("mac", info.platform === "darwin");
  document.body.classList.toggle("win", info.platform !== "darwin");
  applyTheme();
  setupInfo = await F.setupCheck();
  if (setupInfo.vaultProblem || setupInfo.problems.length) {
    route = { name: "setup", slug: null };
    return paintSetup();
  }
  $("win").classList.remove("bare");
  if (document.visibilityState === "visible") { unput($("screen")); $("screen").innerHTML = `<div style="padding:40px" class="cap">Reading your records…</div>`; }
  const [state, seen] = await Promise.all([F.state(), SEEN_HOME ? SEEN_HOME : F.seen.get().catch(() => ({}))]);
  SEEN_HOME = seen || {};
  await qRefresh().catch(() => {});
  if (!state || state.error) return paintError(state || {});
  S = state;
  if (route.name === "setup") route = { name: "home", slug: null };
  if (!route.slug || !subj(route.slug)) route.slug = defaultSlug();
  render();
}
// The window shows once the first screen is fully drawn: data, fonts, and math,
// so its first frame is final. The caret is already in Home's field.
// Warm-up (5 Nov): the first time the Skills page is drawn, the graphics card prepares its glass, glows, gradients and
// hills, and on Edison's Mac that froze the window for 174 ms in its first moments (perf.log). The page is drawn once,
// invisibly, while the window is still hidden, so that cost is paid before anything can be seen or clicked.
async function warmSkills() {
  if (!window.SkillsPage || !S || !S.subjects.length) return;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:0;top:0;width:1100px;height:800px;opacity:0.01;pointer-events:none;z-index:-1;overflow:hidden";
  document.body.append(box);
  try { SkillsPage.paint(box, S, { night: document.documentElement.dataset.theme === "night", run: () => {} }); } catch (e) { console.error(e); }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
  box.remove();
}
async function bootAndShow() {
  try { await boot(); } catch (e) { console.error(e); }
  await document.fonts.ready;
  if (route.name === "home" && $("ask")) $("ask").focus({ preventScroll: true });
  await warmSkills();
  // The likely next session is drawn now too, while the window is still hidden (warmSession), with KaTeX and Mermaid
  // loaded first, and given two frames to lay out: drawn at idle on Home instead, it held one frame for 117 ms right when
  // you start using the app, and Mermaid's start-up another 100 ms (measured 5 Nov).
  try { await MD.preload(); await MD.warm(); await warmSession(defaultSlug()); } catch (e) { console.error(e); }
  // The tutor's terminal is made now too, unseen: made on the first open of a session it took about 20 ms of the
  // glide's frame (xterm setting its theme and measuring its font, measured 11 Nov).
  try { await ensureTerm(); } catch (e) { console.error(e); }   // KaTeX and Mermaid first: the warm thread typesets with them
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  requestAnimationFrame(() => requestAnimationFrame(() => F.windowReady()));
}
document.body.classList.add("still");
for (const ev of ["mousemove", "wheel", "pointerdown"]) window.addEventListener(ev, () => document.body.classList.remove("still"), { once: true, capture: true });
bootAndShow();
