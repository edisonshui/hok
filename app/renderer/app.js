// Flash: the window. Screens are drawn from learn-status.py --json. The tutor
// runs in a real terminal that opens in a drawer; the Session thread is read
// from the subject's log.md, and the composer types into the terminal.
// Design rules: .claude/skills/flash-design.
"use strict";

const { esc, inline, renderMd, typeset } = window.MD;
const F = window.flash;
const $ = (id) => document.getElementById(id);

// ---------- state ----------
let S = null, cfg = null, info = null;
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
const deadlineWord = (days) => (days <= 1 ? dayWord(days).toLowerCase() : dayWord(days));
function dayWord(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
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
  return { why, line: sentence(cap(reason)) };
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
function swap(paint) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // A hidden or background window has nothing to animate; the transition would only throw.
  if (!document.startViewTransition || calm || document.visibilityState !== "visible") return paint();
  // The browser skips the update when it aborts a transition, so paint once either way.
  let done = false;
  const once = () => { if (!done) { done = true; paint(); } };
  const t = document.startViewTransition(once);
  t.ready.catch(() => {}); t.finished.catch(() => {}); t.updateCallbackDone.catch(() => {});
  setTimeout(once, 300);
}
function go(name, slug) {
  if (!S && name !== "setup") return;
  if (SUBJECT_ROUTES.includes(name) && !slug) slug = route.slug || defaultSlug();
  if (SUBJECT_ROUTES.includes(name) && !subj(slug) && name !== "session") return;
  const before = routeKey();
  scrolls[before] = scrollerOf(route.name).scrollTop;
  route = { name, slug: slug || route.slug };
  const after = routeKey();
  if (before === after) return render();
  swap(() => {
    render();
    // A new screen opens at the top; coming back returns to where you were.
    if (route.name !== "session") $("screen").scrollTop = scrolls[after] || 0;
  });
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
  if (route.slug && !subj(route.slug)) route.slug = defaultSlug();
  paintShell(); paintSide(); paintIslands();
  const inSession = route.name === "session";
  $("session").classList.toggle("hidden", !inSession);
  $("screen").classList.toggle("hidden", inSession);
  if (inSession) return paintSession();
  ({ home: paintHome, dashboard: paintDashboard, system: paintSystem, progress: paintProgress, map: paintMap })[route.name]();
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
  w.classList.toggle("icons", mode === "icons");
  w.classList.toggle("bare", mode === "hidden");
  const planned = route.name === "session" && cfg.panel && !!subj(route.slug);
  w.classList.toggle("planned", planned);
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
function paintSide() {
  const el = $("side"), icons = sideMode() === "icons";
  const tip = (t) => (icons ? ` data-tip="${t}" data-tip-side="right"` : "");
  const due = dueCount();
  const repairs = S.ranked.filter((x) => x.kind === "Repair");
  const live = S.subjects.filter((s) => s.status !== "done");
  const done = S.subjects.filter((s) => s.status === "done");
  const nav = (r, ic, name, k) => `<button class="nav-row ${route.name === r ? "on" : ""}" data-act="go" data-arg="${r}"${tip(`${name}  ${key(k)}`)}>${icon(ic)}<span class="lbl">${name}</span></button>`;
  const isOn = (s) => s.slug === route.slug && SUBJECT_ROUTES.includes(route.name);
  const tagOf = (s) => (T.running && LOG.slug === s.slug ? `<i class="live" aria-label="Session running"></i>` : esc(rightTag(s)));
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
  const top = el.scrollTop;
  if (!put(el, `<div class="side-top"></div>
    <div class="brand"><span class="mark">${icon("bolt")}</span><b>${esc(info.name)}</b><button class="icon-btn search" data-act="palette" aria-label="Search and commands" data-tip="Search  ${key("K")}" data-tip-side="left-down">${icon("search")}</button><button class="icon-btn side-toggle" data-act="toggle-side" aria-label="${sideMode() === "icons" ? "Open" : "Fold"} sidebar" data-tip="${sideMode() === "icons" ? "Open" : "Fold"} sidebar  ${key("\\")}" data-tip-side="${sideMode() === "icons" ? "right" : "left-down"}">${icon("sidebar")}</button></div>
    <div class="side-scroll">
      ${nav("home", "home", "Home", "1")}${nav("system", "skills", "All skills", "3")}${nav("dashboard", "dashboard", "Dashboard", "4")}
      <h4 class="side-label">Subjects</h4>
      ${grouped(live) || `<div class="cap" style="padding:4px 9px">No subjects yet.</div>`}
      ${done.length ? `<button class="nav-row add" data-act="toggle-done" aria-expanded="${doneOpen}"${tip("Done")}>${icon(doneOpen ? "down" : "chev", "sm")}<span class="lbl">Done</span><span class="n">${done.length}</span></button>` : ""}
      ${doneOpen ? grouped(done) : ""}
      <button class="nav-row add" data-act="start"${tip(`Start a subject  ${key("N")}`)}><span class="tile-add">${icon("plus")}</span><span class="lbl">Start a subject</span></button>
    </div>
    <div class="side-foot">
      <h4 class="side-label">Today</h4>
      <button class="nav-row" data-act="review" ${due ? "" : "disabled"}${tip(`Reviews due: ${due}`)}><span class="status-icon amber">${icon("review")}</span><span class="lbl">Reviews due</span><span class="n">${due}</span></button>
      <button class="nav-row" data-act="repair" ${repairs.length ? "" : "disabled"}${tip(`To repair: ${repairs.length}`)}><span class="status-icon coral">${icon("repair")}</span><span class="lbl">To repair</span><span class="n">${repairs.length}</span></button>
      <button class="nav-row" data-act="settings"${tip(`Settings  ${key(",")}`)}>${icon("settings")}<span class="lbl">Settings</span></button>
    </div>
    ${streak}`)) return;
  el.scrollTop = top;
}

// The two islands over a subject's screens: the switcher and the three tabs,
// then on Session the status line and the Note, Terminal, and plan buttons.
function paintIslands() {
  const el = $("islands"), s = subj(route.slug);
  const show = SUBJECT_ROUTES.includes(route.name) && !!s;
  el.classList.toggle("hidden", !show);
  if (!show) { el.innerHTML = ""; return; }
  const bare = sideMode() === "hidden";
  const tabs = [["session", "Session", "2"], ["map", "Skill map", "6"], ["progress", "Progress", "5"]]
    .map(([r, l, k]) => `<button role="tab" aria-selected="${route.name === r}" class="${route.name === r ? "on" : ""}" data-act="go-subject" data-arg="${r}" data-tip="${key(k)}">${l}</button>`).join("");
  const left = `<div class="island">${bare ? `<button class="icon-btn" data-act="hide-side" aria-label="Show sidebar" data-tip="Show sidebar  ${keyShift("\\")}">${icon("sidebar")}</button><button class="mark" data-act="go" data-arg="home" aria-label="Home" data-tip="Home  ${key("1")}">${icon("bolt")}</button><span class="divider"></span>` : ""}
    <button class="switcher" id="switcher" data-act="switcher" aria-haspopup="menu" aria-expanded="false" title="${esc(s.title)}">${tileIcon(s)}<span class="lbl">${esc(nick(s))}</span>${icon("down", "dn")}</button>
    <span class="divider"></span><div class="tabs" role="tablist">${tabs}</div></div>`;
  const right = route.name === "session" ? `<div class="island"><span class="status-line" id="statusLine"></span><span class="divider"></span>
    <button class="icon-btn ${LOG.tab === "note" ? "on" : ""}" data-act="toggle-note" aria-label="Session note" aria-pressed="${LOG.tab === "note"}" data-tip="${LOG.tab === "note" ? "Back to the thread" : "Session note"}  ${keyAlt("2")}" data-tip-side="left-down">${icon("note")}</button>
    <button class="icon-btn ${T.drawer ? "on" : ""}" data-act="toggle-term" aria-label="Terminal" aria-pressed="${T.drawer}" data-tip="Terminal  Ctrl+\`" data-tip-side="left-down">${icon("terminal")}</button>
    <button class="icon-btn flip ${cfg.panel ? "on" : ""}" data-act="toggle-panel" aria-label="${cfg.panel ? "Hide" : "Show"} plan" aria-pressed="${cfg.panel}" data-tip="${cfg.panel ? "Hide" : "Show"} plan  ${keyAlt("0")}" data-tip-side="left-down">${icon("sidebar")}</button></div>` : "";
  el.innerHTML = left + right;
  slideTab();
  paintStatus();
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
function busy() { return SES.busy(); }
function paintStatus() {
  const el = $("statusLine");
  if (!el) return;
  const s = subj(route.slug);
  el.innerHTML = busy() ? `<i class="spin"></i>The tutor is writing…`
    : T.running && lastSaved ? `${icon("check")}Saved to record · ${hhmm(lastSaved)}`
    : T.running ? `${esc(tutorName())} is running`
    : T.starting ? `<i class="spin"></i>Starting…`
    : T.ended ? "The tutor stopped"
    : s && s.last_session ? `Last session ${shortD(s.last_session)}` : "Not started";
  paintSend();
}

// ---------- running things ----------
// Every command goes to the tutor's terminal, exactly as the learner would type it.
function command(cmd) { return sigil() + cmd; }
function run(found) {
  if (!found || !found.command) return toast("Nothing to run right now.");
  const slug = found.subject || (found.command.match(/^learn-\w+ ([a-z0-9-]+)/) || [])[1] || route.slug;
  runTyped(found.typed || command(found.command), slug);
}
function runTyped(text, slug) {
  if (slug && subj(slug)) route.slug = slug;
  go("session", route.slug);
  tutorSend(text);
}
ACTIONS.go = (r) => go(r);
ACTIONS["go-subject"] = (r) => go(r, route.slug);
ACTIONS.subject = (slug) => { closeOverlay(); go(SUBJECT_ROUTES.includes(route.name) ? route.name : "session", slug); };
ACTIONS["toggle-done"] = () => { doneOpen = !doneOpen; paintSide(); };
ACTIONS.review = () => run(S.ranked.find((x) => x.kind === "Review") || { command: "learn-review" });
ACTIONS.repair = () => run(S.ranked.find((x) => x.kind === "Repair"));
ACTIONS.start = () => { closeOverlay(); runTyped(command("learn-start"), null); };
ACTIONS.run = (i) => run(S.ranked[+i]);
ACTIONS.resume = (slug) => run(S.ranked.find((x) => x.subject === slug && x.kind !== "Repair") || { command: `learn-resume ${slug}`, subject: slug });
ACTIONS.practice = (slug) => run({ command: `learn-practice ${slug}`, subject: slug });
// The fold animates the sidebar's width; its labels fade out first, so text never squeezes.
ACTIONS["hide-side"] = () => setSide(sideMode() === "hidden" ? "full" : "hidden");
ACTIONS["toggle-side"] = () => setSide(sideMode() === "full" ? "icons" : "full");
function setSide(next) {
  const w = $("win");
  const apply = () => { setCfg({ sidebarMode: next }); paintShell(); paintSide(); paintIslands(); fitSoon(); };
  if (next === "icons") { w.classList.add("folding"); setTimeout(() => { apply(); w.classList.remove("folding"); }, 80); }
  else if (next === "full") { w.classList.add("folding"); apply(); setTimeout(() => w.classList.remove("folding"), 200); }
  else apply();
}
ACTIONS["toggle-panel"] = () => { setCfg({ panel: !cfg.panel }); paintShell(); paintIslands(); fitSoon(); };
let inkAction = null;
ACTIONS.ink = () => inkAction && inkAction();

async function setCfg(patch) { cfg = { ...cfg, ...patch }; cfg = await F.setConfig(patch); }

// The subject switcher in the left island: the same menu as the sidebar's list.
ACTIONS.switcher = (_a, el) => {
  const r = el.getBoundingClientRect();
  const live = S.subjects.filter((s) => s.status !== "done");
  const scrim = $("scrim");
  scrim.classList.add("on", "clear");
  scrim.innerHTML = `<div class="menu" role="menu" style="left:${r.left}px;top:${r.bottom + 6}px">
    <div class="f">Switch subject</div>
    <button class="menu-item" role="menuitem" data-act="go-home">${icon("home")}<span class="lbl">Home</span><kbd>${key("1")}</kbd></button><div class="sep"></div>
    ${live.map((s) => `<button class="menu-item ${s.slug === route.slug ? "hl" : ""}" role="menuitem" data-act="subject" data-arg="${s.slug}" title="${esc(s.title)}">${tileIcon(s)}<span class="lbl">${esc(nick(s))}</span><kbd>${s.slug === route.slug ? icon("check", "xs") : esc(rightTag(s))}</kbd></button>`).join("")}
    <div class="sep"></div><button class="menu-item" role="menuitem" data-act="start">${icon("plus")}<span class="lbl">Start a subject</span><kbd>${key("N")}</kbd></button></div>`;
  el.setAttribute("aria-expanded", "true");
  const first = scrim.querySelector(".menu-item.hl") || scrim.querySelector(".menu-item");
  if (first) first.focus();
};
ACTIONS["go-home"] = () => { closeOverlay(); go("home"); };

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
let homeShown = false;
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
// has the button. The first click arms it and a second within 4s runs it, since
// it changes the record. Close-outs run one at a time (each is a background
// tutor run of about a minute), so a click while another runs waits in line.
const isLeftOpen = (slug) => leftOpen().some((x) => x.slug === slug);
function repaintClose() { if (route.name === "session") { paintActs(); if (LOG.data) paintThread(false); } }
const CLOSE = window.Session.createCloseout({
  closeOut: (slug) => F.closeOut(slug),
  subject: (slug) => subj(slug),
  onEvent: (kind, payload) => {
    if (kind === "queued-behind") toast("Queued. It closes out once the one running now finishes.");
    if (kind === "finished") {
      const s = subj(payload.slug), result = payload.result;
      toast(result.ok ? `Closed out ${s ? nick(s) : "the subject"}. It's in Done now, and its skills still come up for review.` : `Couldn't close out ${s ? nick(s) : "the session"}: ${result.text.split("\n").pop().slice(0, 160)}`);
    }
    repaintClose();
  },
});
const canClose = (s) => CLOSE.canClose(s);
ACTIONS["close-open"] = (slug) => CLOSE.request(slug);
function paintHome() {
  const top = S.ranked[0], s = top && top.subject ? subj(top.subject) : null;
  inkAction = () => run(top);
  let { why, line } = plain(top);
  if (top.kind === "Start") line = "Pick a topic and a goal. The tutor asks a few questions to find where you start, then builds a plan.";
  const due = dueCount(), repairs = S.ranked.filter((x) => x.kind === "Repair"), dl = deadlinesThisWeek();
  const firstRepair = repairs[0] && subj(repairs[0].subject);
  const tile = (cls, act, arg, ic, label, value, note, off) => `<button class="count-tile ${cls}" data-act="${act}" ${arg ? `data-arg="${arg}"` : ""} ${off ? "disabled" : ""}><div class="ct-label">${icon(ic, "sm")}${label}</div><div class="ct-value">${value}</div><div class="ct-note">${note}</div></button>`;
  const whyChip = why ? `<span class="chip ${s && s.days_to_deadline !== null && s.days_to_deadline <= 0 ? "now" : "soon"}">${esc(why)}${s && isoDate(s.deadline) ? ` · ${DAYS[isoDate(s.deadline).getDay()]} ${shortD(s.deadline)}` : ""}</span>` : "";
  const subjectsShown = [...new Set(S.ranked.map((x) => x.subject).filter(Boolean))].map(subj).filter((x) => x && x.status !== "done" && x !== s).slice(0, 3);
  const dayRow = (d) => `<div class="week-row quiet"><span class="day">${DAYS[dayDate(d).getDay()]}</span><span class="cap">No deadline</span></div>`;
  const weekRows = [0, 1, 2, 3, 4, 5, 6].map((d) => dl.filter((x) => x.days_to_deadline === d).map((x) => {
    const repair = (x.pending || "").match(/(\d+) to repair/);
    const chip = repair ? `<span class="chip now">${repair[1]} to repair</span>` : d === 0 ? `<span class="chip now">Today</span>` : d <= 2 ? `<span class="chip soon">${dayWord(d)}</span>` : "";
    return `<button class="week-row" data-act="subject" data-arg="${x.slug}" data-prefetch="${x.slug}"><span class="day ${d === 0 ? "now" : ""}">${DAYS[dayDate(d).getDay()]}</span>${tileIcon(x)}<span class="wr-title">${esc(nick(x))}</span>${chip}</button>`;
  }).join("") || dayRow(d)).join("");
  const today = new Date(S.today + "T12:00:00");
  const intro = !homeShown; homeShown = true;
  if (!put($("screen"), `<div class="content${intro ? " intro" : ""}">
    <h1 class="t-greeting">${esc(greeting())}</h1>
    <div class="home-date">${DAYS_LONG[today.getDay()]} ${today.getDate()} ${MONTHS_LONG[today.getMonth()]}</div>
    <div class="count-tiles">
      ${tile("coral", "repair", "", "repair", "To repair", repairs.length, firstRepair ? `${esc(nick(firstRepair))} first` : "Nothing slipped", !repairs.length)}
      ${tile("amber", "subject", dl[0] ? dl[0].slug : "", "end", "Deadlines this week", dl.length, dl[0] ? `Next: ${esc(nick(dl[0]))}, ${deadlineWord(dl[0].days_to_deadline)}` : "None this week", !dl.length)}
      ${tile("grey", "review", "", "review", "Reviews due", due, `Across ${S.subjects.filter((x) => x.nodes.some((n) => n.due)).length} subjects`, !due)}
      ${tile("green", "go", "dashboard", "check", "Checks passed", checksLastWeek(), "In the last 7 days")}
    </div>
    <div class="home-two">
      <div class="action-card" style="${subjVar(s)}">
        ${whyChip}
        ${s ? `<div class="eyebrow">${tileIcon(s)}${esc(courseCode(s))}</div>` : ""}
        <div class="t-head" style="margin-top:${s ? 2 : 0}px">${s ? md(afterCode(s)) : top.kind === "Review" ? "Review across subjects" : "Start something new"}</div>
        <div class="line">${md(line)}</div>
        ${s && s.nodes.length ? `<div class="discs">${s.nodes.slice(0, 16).map((n) => discEl(n, s)).join("")}</div>` : ""}
        <div class="action-foot"><button class="btn" data-act="ink" data-prefetch="${s ? s.slug : ""}" data-tip="${key("↩")}">${icon("resume", "sm")}${VERB[top.kind] || "Start"}</button>${s && s.total ? `<span class="cap">${s.proven} of ${s.total} skills passed</span>` : ""}</div>
      </div>
      <div class="card list-card week-card"><div class="list-head">${icon("end")}This week</div>${weekRows || `<div class="cap" style="padding:6px 0">No deadlines in the next 7 days.</div>`}
        ${S.rewards_on ? `<button class="week-foot" data-act="go" data-arg="dashboard"><span>${S.streak.current}-week review streak</span><span class="streak-weeks">${S.streak.weeks.slice(-6).map((w) => w.result === "pass" || w.result === "repaired" || w.result === "forgiven" ? `<i>${icon("check")}</i>` : w.result === "pending" ? `<i class="open"></i>` : w.result === "miss" ? `<i class="miss"></i>` : `<i class="none"></i>`).join("")}</span></button>` : ""}</div>
    </div>
    ${subjectsShown.length ? `<div class="card subjects-card"><div class="list-head">${icon("dashboard")}Subjects<button class="more" data-act="go" data-arg="dashboard">View all</button></div><div class="grid3">
      ${subjectsShown.map((x) => `<button class="subject-card" data-act="subject" data-arg="${x.slug}" data-prefetch="${x.slug}"><div class="sc-title">${tileIcon(x)}<span>${esc(nick(x))}</span></div><span class="bar"><i style="width:${x.total ? Math.round((100 * x.proven) / x.total) : 0}%"></i></span><div class="cap">${x.total ? `${x.proven} of ${x.total}` : "No plan yet"}${x.up_next ? ` · ${md((x.nodes.find((n) => n.id === x.up_next) || {}).name || "")} next` : ""}</div></button>`).join("")}
    </div></div>` : ""}
  </div>
  <div class="hcomp"><div class="composer"><input id="ask" placeholder="Ask your tutor anything, or name a subject to start" aria-label="Ask your tutor" autocomplete="off"><button class="send" data-act="ask" id="askSend" aria-label="Send" disabled>${icon("send", "sm")}</button></div></div>`)) return;
  const ask = $("ask");
  ask.addEventListener("input", () => { $("askSend").disabled = !ask.value.trim(); });
  ask.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ACTIONS.ask(); } });
}
// A subject's name resumes it; anything else starts the tutor with the question.
ACTIONS.ask = () => {
  const text = ($("ask") || {}).value ? $("ask").value.trim() : "";
  if (!text) return;
  const q = text.toLowerCase();
  const hit = S.subjects.find((s) => q === shortTitle(s).toLowerCase() || q === s.slug || (q.length > 3 && shortTitle(s).toLowerCase().includes(q)));
  if (hit) return ACTIONS.resume(hit.slug);
  runTyped(text, null);
};

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
function paintProgress() {
  const s = subj(route.slug);
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
    unput(el); el.innerHTML = `<div class="mapwrap space"${skyTheme()}><div class="map-empty"><div><div class="t-head">No map yet</div><div class="t-ui ink2" style="margin-top:6px">${esc(shortTitle(s))} has no plan yet. A few more questions to find where you start.</div><button class="btn" style="margin-top:16px" data-act="ink">Resume</button></div></div></div>`;
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
  if (!put(el, `<div class="mapwrap space grid" id="mapwrap"${skyTheme()}><div class="map-glow" style="${subjVar(s)}"></div>
    <div class="canvas" id="canvas" style="width:${widthPx}px;height:${heightPx}px">
      <svg id="mapEdges" width="${widthPx}" height="${heightPx}" style="position:absolute;left:0;top:0;stroke:var(--color-line-strong)" stroke-width="1.4" fill="none"></svg>
      ${s.nodes.map((n) => { const c = discClass(n, s); return `<div class="node ${c === "not" ? "not" : ""} ${c === "up" ? "upn" : ""}" data-id="${n.id}" style="left:${pos[n.id].x}px;top:${pos[n.id].y}px${line(n) ? `;min-height:${H}px` : ""}" title="${STATUS_WORD[n.status] || ""}">${discEl(n, s, "md")}<div><b>${md(n.name)}</b><span>${line(n)}</span></div></div>`; }).join("")}
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
  if (!S.subjects.length) { unput(el); el.innerHTML = `<div class="mapwrap space"${skyTheme()}><div class="map-empty"><div class="t-ui ink2">No subjects yet.</div></div></div>`; return; }
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
// The window-only fields; lib/session.js owns the session's state and fills in
// the rest (running, starting, trust, route, queue, …) so paints read T as before.
const T = { term: null, fit: null, drawer: false };
const { msgText, msgImages } = window.Session;
const SES = window.Session.createSession({
  state: T,
  write: (d) => F.pty.write(d),
  startProcess: (prompt) => F.pty.start({ cols: T.term.cols, rows: T.term.rows, prompt }),
  stopProcess: () => F.pty.stop(),
  prepare: async () => {
    await ensureTerm();
    try { T.fit.fit(); } catch { /* drawer not laid out yet */ }
    T.term.clear();
    T.term.reset();
  },
  saveImage: (bytes, type) => F.saveImage(bytes, type),
  inputLine: () => inputLine(),
  cols: () => (T.term && T.term.cols) || 80,
  currentSubject: () => subj(route.slug),
  reopenCommand: (s) => command(`${s.status === "done" ? "learn-practice" : "learn-resume"} ${s.slug}`),
  hasWaitingQuestion: () => logEntries().some((e) => e.waiting),
  restoreDraft: (kept) => { if (msgEmpty()) setMsg(kept); },
  onEvent: (kind, payload) => {
    if (kind === "term") afterTermChange();
    else if (kind === "route") { if (route.name === "session") paintComposer(); }
    else if (kind === "sent" || kind === "stick") LOG.stick = true;
    else if (kind === "queued") { LOG.stick = true; if (route.name === "session" && LOG.data) paintThread(false); }
    else if (kind === "flushed") { if (route.name === "session" && LOG.data) paintThread(false); }
    else if (kind === "started") { if (T.drawer) T.term.focus(); else focusMsg(); }
    else if (kind === "start-failed") toast(`Could not start ${tutorName()}: ${payload}. Check that it runs in Terminal, then try again.`);
  },
});
function termTheme() {
  const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
  // ANSI colors come from the tokens, so the terminal keeps the app's contrast in both themes.
  return {
    background: v("--color-surface"), foreground: v("--color-ink"), cursor: v("--color-ink"), cursorAccent: v("--color-surface"),
    selectionBackground: v("--color-selected"), black: v("--color-ink"), red: v("--color-coral-text"), green: v("--color-green"), yellow: v("--color-amber-text"),
    blue: v("--subject-code"), magenta: v("--subject-circuits"), cyan: v("--subject-math"), white: v("--color-ink-3"),
    brightBlack: v("--color-ink-3"), brightRed: v("--color-coral"), brightGreen: v("--color-green"), brightYellow: v("--color-amber"),
    brightBlue: v("--subject-code"), brightMagenta: v("--subject-circuits"), brightCyan: v("--subject-math"), brightWhite: v("--color-ink"),
  };
}
async function ensureTerm() {
  if (T.term) return T.term;
  await document.fonts.load('13px "Geist Mono"');
  const term = new window.Terminal({
    fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: 13, lineHeight: 1.25,
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
    SES.onUserInput(d);
  });
  F.pty.onData((d) => {
    term.write(d);
    const was = SES.onOutput(d);
    if (!was) paintStatus();
    clearTimeout(T.idle);
    T.idle = setTimeout(paintStatus, 1300);
  });
  F.pty.onExit(() => SES.onExit());
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
    if (T.running) F.pty.resize(T.term.cols, T.term.rows);
  }, 30);
}
function afterTermChange() {
  if (!S) return;
  paintSide();
  if (route.name !== "session") return;
  paintStatus(); paintActs(); paintComposer(); paintDrawerNote();
  if (LOG.data) paintThread(false);
}
// Starting, sending, routing, the queue, trust, and interrupts live in
// lib/session.js; these two names stay for the call sites below.
function startTutor(prompt) { return SES.start(prompt); }
function tutorSend(message) { return SES.send(message); }
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
const sessionOpen = () => SES.sessionOpen();
ACTIONS["tutor-start"] = (arg) => startTutor(arg === "plain" ? "" : arg);
ACTIONS.hint = () => T.running ? SES.say("Can I have a hint?") : toast(`The tutor isn't running. Open Session to start ${tutorName()}.`);
ACTIONS.check = () => T.running || route.slug ? SES.say(command("learn-check")) : null;
ACTIONS.break = () => T.running && sessionOpen() ? tutorSend(command("learn-end break")) : toast(T.running ? "This session is already saved." : "No session is running.");
ACTIONS.end = () => T.running && sessionOpen() ? tutorSend(command("learn-end")) : toast(T.running ? "This session is already saved." : "No session is running.");
ACTIONS.restart = async () => { await SES.stop(); startTutor(""); };
ACTIONS.interrupt = () => SES.interrupt();
ACTIONS.trust = (answer) => SES.answerTrust(answer);
ACTIONS["toggle-term"] = () => {
  if (route.name !== "session") go("session");
  T.drawer = !T.drawer;
  $("drawer").classList.toggle("on", T.drawer);
  paintIslands();
  paintDrawerNote();
  if (T.drawer) { fitSoon(); setTimeout(() => T.term && T.term.focus(), 220); } else focusMsg();
};
ACTIONS["open-term"] = () => { if (!T.drawer) ACTIONS["toggle-term"](); else if (T.term) T.term.focus(); };
function paintDrawerNote() {
  $("drawerNote").textContent = T.running ? `${tutorName()} in your vault` : T.starting ? "Starting…" : "";
  const empty = $("drawerEmpty");
  empty.classList.toggle("on", !T.running && !T.starting);
  empty.innerHTML = `<span class="empty-icon">${icon("terminal")}</span><b class="t-sec">The tutor isn't running</b><p>The tutor runs here during a session. Resume, or send a message, to start it.</p><button class="btn neutral" data-act="tutor-start" data-arg="plain">Start the tutor</button>`;
}

// ---------- session ----------
const LOG = { slug: null, data: null, tab: "log", showAll: false, think: {}, stick: true, asked: null, changedAt: 0 };
const sessionCache = {};
function prefetchSession(slug) { if (slug && !sessionCache[slug]) sessionCache[slug] = F.session(slug); }

async function paintSession() {
  const s = subj(route.slug);
  paintActs(); paintComposer(); paintDrawerNote();
  await ensureTerm();
  fitSoon();
  if (!s) {
    LOG.slug = null;
    LOG.data = { conversations: [], note: null };
    return paintThread(true);
  }
  if (LOG.slug !== s.slug) {
    LOG.slug = s.slug; LOG.showAll = false; LOG.think = {}; LOG.stick = true; LOG.tab = "log";
    prefetchSession(s.slug);
    const data = await sessionCache[s.slug];
    if (LOG.slug !== s.slug) return;
    LOG.data = data;
    paintIslands(); paintComposer();
    paintThread(true);
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
    inkAction = null;
    const acts = [["hint", "hint", "Hint", key("/")], ["check", "checkme", "Check me", key("J")], ["break", "pause", "Break", key("B")], ["end", "end", "End", keyShift("E")]];
    el.innerHTML = acts.map(([a, ic, label, k]) => `<button class="btn text" data-act="${a}" data-tip="${k}" data-tip-side="up" ${T.running ? "" : "disabled"}>${icon(ic, "sm")}${label}</button>`).join("");
    return;
  }
  const typed = s ? resumeTyped(s) : command("learn-start");
  inkAction = T.ended && !s ? () => startTutor("") : () => startTutor(typed);
  const verb = T.ended ? "Start again" : s ? (s.status === "done" ? "Practice" : "Resume") : "Start";
  const hasLog = logEntries().some((e) => e.key.includes(":"));
  const close = hasLog && canClose(s) ? closeBtn(s) : "";
  el.innerHTML = (hasLog ? `<button class="btn sm" data-act="ink" data-tip="${key("↩")}" data-tip-side="up">${icon("resume", "sm")}${verb}</button>` : "") + close;
}
function closeBtn(s, big) {
  const state = CLOSE.state.closing === s.slug ? "run" : CLOSE.state.queue.includes(s.slug) ? "wait" : CLOSE.state.armed === s.slug ? "armed" : "";
  const tip = state === "wait" ? "Waiting for the close-out running now" : state === "armed" ? "Moves this subject to Done" : "Finished with this subject? Settles any open session and moves it to Done";
  const label = state === "run" ? `<i class="spin"></i>Closing out` : state === "wait" ? `${icon("pause", "sm")}Queued` : state === "armed" ? `${icon("check", "sm")}Click again to close out` : `${icon("check", "sm")}Close out`;
  return `<button class="btn neutral ${big ? "" : "sm"} ${state === "armed" ? "armed" : ""}" data-act="close-open" data-arg="${s.slug}" ${state === "run" || state === "wait" ? "disabled" : ""} data-tip="${tip}" data-tip-side="up">${label}</button>`;
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
  send.dataset.act = stop ? "interrupt" : "send";
  send.setAttribute("aria-label", stop ? "Stop the tutor" : "Send");
  send.innerHTML = icon(stop ? "stop" : "send", "sm");
  send.disabled = !stop && msgEmpty() && !ATT.length;
}
ACTIONS.send = () => {
  const text = msgValue().trim();
  if (!text && !ATT.length) return;
  const message = ATT.length ? { text, images: ATT.splice(0) } : text;
  if (message.images) rememberSent(text, message.images);
  paintAttach();
  const s = subj(route.slug);
  SES.submit(message, s ? resumeTyped(s) : "");
  setMsg("");
};
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
// A chip goes out as standard LaTeX (\mathrm{d}, not MathLive's \differentialD),
// with a space between it and a word or another chip, so "$dx$which" and "$a$$b$"
// (which reads as display math) never reach the tutor.
const MATHLIVE_CMD = /\\(differentialD|capitalDifferentialD|exponentialE|imaginaryI|imaginaryJ)(?![a-zA-Z])/g;
function chipLatex(mf) {
  return mf.value.trim().replace(MATHLIVE_CMD, (m) => (window.MD && MD.MATHLIVE_MACROS[m]) || m);
}
function msgValue() {
  let out = "", afterChip = false;
  const tail = () => out.replace(/\u200b+$/, "").slice(-1);
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        if (afterChip && /^[\u200b]*[\w(]/.test(n.nodeValue)) out += " ";
        out += n.nodeValue;
        if (n.nodeValue.replace(/\u200b/g, "")) afterChip = false;
      } else if (n.tagName === "MATH-FIELD") {
        const v = chipLatex(n);
        if (!v) continue;
        if (/[\w$).,]/.test(tail())) out += " ";
        out += `$${v}$`;
        afterChip = true;
      }
      else if (n.tagName === "BR") { out += "\n"; afterChip = false; }
      else { if (/^(DIV|P)$/.test(n.tagName) && out && !out.endsWith("\n")) { out += "\n"; afterChip = false; } walk(n); }
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
}
MSG.addEventListener("input", afterMsgInput);
// Capture phase, so a chip's keys are handled before MathLive sees them.
MSG.addEventListener("keydown", (e) => {
  const chip = e.target.closest && e.target.closest("math-field");
  if (chip) {
    if (e.key === "$") {
      e.preventDefault(); e.stopPropagation();
      if (!chip.value.trim()) { const box = chip.chip || chip, at = box.previousSibling; box.remove(); MSG.focus(); if (at) caretAt(at, "after"); document.execCommand("insertText", false, "$"); }
      else leaveChip(chip, "after");
    } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); leaveChip(chip, "after"); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); ACTIONS.send(); }
    return;
  }
  if (e.key === "$" && !e.metaKey && !e.ctrlKey && window.MathLive) { e.preventDefault(); insertMath(); }
  else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ACTIONS.send(); }
  else if (e.key === "Escape" && busy()) { e.preventDefault(); ACTIONS.interrupt(); }
}, true);
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
  convos.forEach((c, ci) => {
    out.push({ key: `c${ci}`, html: `<div class="convo-sep">${longD(c.date)}${c.model ? ` · ${esc(prettyModel(c.model))}` : ""}</div>` });
    const lastQ = ci === convos.length - 1 ? c.items.map((x) => x.kind).lastIndexOf("question") : -1;
    c.items.forEach((it, i) => {
      const waiting = i === lastQ && !it.answered && !it.withdrawn && T.running;
      const html = itemHtml(it, waiting, `${ci}:${i}`);
      if (html) out.push({ key: `${ci}:${i}`, html, waiting });
    });
  });
  if (T.trust) out.push({ key: "x:trust", html: trustHtml() });
  T.queue.forEach((q, i) => {
    const text = msgText(q), shots = msgImages(q).map((im) => `<img src="${im.url}" alt="Screenshot you pasted">`).join("");
    if (!/^\s*[/$]learn-/.test(text)) out.push({ key: `x:q${i}`, html: `<div class="me pending"><span class="bubble">${shots ? `<span class="shots">${shots}</span>` : ""}${youText(text)}</span><span class="cap">Sends when the tutor is ready</span></div>` });
  });
  return out;
}
function trustHtml() {
  const folder = (cfg && cfg.vault ? cfg.vault.split(/[\\/]/).filter(Boolean).pop() : "") || "your vault";
  return `<div class="question waiting trust"><div class="q-text"><p><b>Claude Code asks first: do you trust this folder?</b></p>
    <p>It's your vault, <span class="mono">${esc(folder)}</span>. Claude Code reads, edits, and runs files there, so it asks once for each new folder. Your message waits until you answer.</p></div>
    <div class="trust-acts"><button class="btn sm" data-act="trust" data-arg="yes">Trust this folder</button><button class="btn neutral sm" data-act="trust" data-arg="no">Not now</button></div></div>`;
}
// While the tutor works and nothing new has reached the thread, a row at its end
// says so and counts the seconds. The terminal's output is the signal: Claude
// Code animates its spinner for as long as a turn runs.
const workEl = document.createElement("div");
workEl.className = "working";
workEl.setAttribute("aria-live", "polite");
function paintWorking() {
  const on = route.name === "session" && LOG.tab === "log" && T.running && !T.trust && busy() && Date.now() - LOG.changedAt > 1500;
  if (on !== workEl.classList.contains("on")) {
    const b = $("threadScroll"), near = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
    workEl.classList.toggle("on", on);
    if (on) workEl.innerHTML = `<i class="spin"></i><span>Working</span>`;
    if (on && near) b.scrollTop = b.scrollHeight;
  }
  if (on) {
    const sec = Math.floor((Date.now() - T.workFrom) / 1000), t = sec >= 3 ? `Working · ${sec}s` : "Working";
    const span = workEl.querySelector("span");
    if (span.textContent !== t) span.textContent = t;
  }
}
setInterval(paintWorking, 500);
function itemHtml(it, waiting, k) {
  if (it.kind === "tutor") return `<div class="tutor">${renderMd(it.text)}</div>`;
  if (it.kind === "you" && /^[/$]learn-/.test(it.text)) {
    const c = it.text.split("\n")[0].trim(), verb = (c.match(/^[/$]learn-(\w+)/) || [])[1];
    const word = /learn-end break/.test(c) ? "Break" : ({ end: "Session saved", start: "Session started", resume: "Resumed", check: "Check", review: "Review", practice: "Practice" })[verb] || c;
    return `<div class="cmd-line" title="${esc(c)}">${esc(word)}${it.time ? ` · ${esc(it.time)}` : ""}</div>`;
  }
  if (it.kind === "you") {
    const cmd = false;
    return `<div class="me"><span class="bubble ${cmd ? "cmd" : ""}" title="${esc(it.time)}">${cmd ? esc(it.text.split("\n")[0]) : youText(it.text)}</span></div>`;
  }
  if (it.kind === "code") return `<div class="me"><div class="bubble"><span class="cap">Your code</span>${renderMd(it.text)}</div></div>`;
  if (it.kind === "thinking") {
    const open = LOG.think[k];
    return `<div class="steps"><div class="step"><button data-act="think" data-arg="${k}" aria-expanded="${!!open}">Thinking${icon(open ? "down" : "chev")}</button></div>${open ? `<div class="step-body">${renderMd(it.text)}</div>` : ""}</div>`;
  }
  if (it.kind === "question") {
    if (it.withdrawn) return "";
    return (it.groups || []).map((g) => `<div class="question ${waiting ? "waiting" : ""}">
      ${g.body.trim() ? `<div class="q-text">${renderMd(g.body)}</div>` : ""}
      ${g.options.map((o, n) => `<div class="option ${it.picked.includes(o.label) ? "sel" : ""}"><i class="radio"></i><span><span class="${/[;(){}=]/.test(o.label) ? "codey" : ""}">${inline(o.label)}</span>${o.desc.length > 2 && o.desc !== o.label ? `<span class="od">${inline(o.desc)}</span>` : ""}</span><kbd>${n + 1}</kbd></div>`).join("")}
      ${waiting ? `<div class="how">${icon("terminal", "xs")}Pick your answer in the terminal, where the tutor asked. <button data-act="open-term">Open the terminal</button></div>` : ""}
    </div>`).join("");
  }
  // A check the tutor wrote as a `> [!check]` callout (tutor.md, 2026-10-29): stem,
  // lettered options, then the confidence ask. Answered by typing, like any chat check.
  if (it.kind === "check") {
    const lines = it.text.split("\n"), opt = /^([A-Z])\.\s+(.*)$/;
    const first = lines.findIndex((l) => opt.test(l)), last = lines.length - 1 - [...lines].reverse().findIndex((l) => opt.test(l));
    const stem = first < 0 ? it.text : lines.slice(0, first).join("\n"), ask = first < 0 ? "" : lines.slice(last + 1).join("\n");
    const opts = first < 0 ? [] : lines.slice(first, last + 1).filter((l) => opt.test(l)).map((l) => l.match(opt));
    return `<div class="question">
      <div class="q-text"><b>${esc(it.label || "Check")}</b></div>
      ${stem.trim() ? `<div class="q-text">${renderMd(stem)}</div>` : ""}
      ${opts.map(([, k, o]) => `<div class="option"><i class="radio"></i><span><b>${k}.</b> ${inline(o)}</span></div>`).join("")}
      ${ask.trim() ? `<div class="q-text">${renderMd(ask)}</div>` : ""}
    </div>`;
  }
  if (it.kind === "answer") {
    if (it.skipped) return `<div class="me"><span class="bubble ink2">Skipped the question to say something first.</span></div>`;
    return it.parts && it.parts.length ? `<div class="me"><span class="bubble">${it.parts.map(youText).join("\n\n")}</span></div>` : "";
  }
  return "";  // probe notices and the hook's own messages are plumbing
}
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
function youText(t) {
  const plain = String(t).replace(/\[Image #\d+\]\s*/g, "").trim();
  const sent = /\[Image #\d+\]/.test(t) ? [...SENT].reverse().find((x) => x.text === plain) : null;
  let n = 0;
  const shot = () => {
    const i = n++, url = sent && ((sent.urls && sent.urls[i]) || (sent.names[i] && `vault-file:///${encodeURIComponent(sent.names[i])}`));
    return url ? `<img class="shot" alt="Screenshot you sent" src="${url}">` : `<span class="shot-chip">${icon("note", "xs")}Screenshot</span>`;
  };
  return esc(t).replace(/\[Image #\d+\]\s*/g, () => shot()).replace(/!\[\[([^\]|]+?\.(?:png|jpe?g|gif|webp))(?:\|\d+)?\]\]/gi,
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
    paintActs();
    return;
  }
  const hidden = LOG.showAll ? 0 : Math.max(0, entries.length - SHOW);
  entries = entries.slice(hidden);
  let list = host.querySelector(".log");
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  if (full || !list) {
    host.innerHTML = `${hidden ? `<button class="btn text earlier" data-act="log-all">${icon("chev", "sm")}Show ${hidden} earlier</button>` : ""}<div class="log"></div>`;
    list = host.querySelector(".log");
  } else {
    const btn = host.querySelector(".earlier");
    if (btn) btn.innerHTML = `${icon("chev", "sm")}Show ${hidden} earlier`;
  }
  const existing = new Map([...list.children].map((n) => [n.dataset.key, n]));
  const changed = [];
  let prev = null;
  for (const e of entries) {
    let node = existing.get(e.key);
    if (node && node.dataset.html !== String(hash(e.html))) { node.innerHTML = e.html; node.dataset.html = hash(e.html); changed.push(node); }
    if (!node) {
      node = document.createElement("div");
      node.className = full ? "item" : "item enter";
      node.dataset.key = e.key;
      node.dataset.html = hash(e.html);
      node.innerHTML = e.html;
      changed.push(node);
    }
    existing.delete(e.key);
    if (prev ? prev.nextSibling !== node : list.firstChild !== node) list.insertBefore(node, prev ? prev.nextSibling : list.firstChild);
    prev = node;
  }
  existing.forEach((n) => n.remove());
  changed.forEach((n) => typeset(n));
  if (changed.length && !full) LOG.changedAt = Date.now();
  if (host.lastChild !== workEl) host.appendChild(workEl);
  if (full || atBottom || LOG.stick) { scroller.scrollTop = scroller.scrollHeight; LOG.stick = false; $("newPill").classList.remove("on"); }
  else if (changed.length) $("newPill").classList.add("on");
  // A question the tutor is waiting on is answered in the terminal, so the drawer opens once for it.
  const waiting = entries.find((e) => e.waiting);
  if (waiting && LOG.asked !== waiting.key) { LOG.asked = waiting.key; if (!T.drawer) ACTIONS["toggle-term"](); }
  paintActs();
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; }
// The thread ends above the dock however tall the composer grows (long
// messages, math, pasted images), and stays pinned if you were at the bottom.
new ResizeObserver(() => {
  const b = $("threadScroll"), near = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
  $("session").style.setProperty("--dock-h", `${$("dock").offsetHeight}px`);
  if (near) b.scrollTop = b.scrollHeight;
}).observe($("dock"));
$("threadScroll").addEventListener("scroll", () => {
  const b = $("threadScroll");
  if (b.scrollHeight - b.scrollTop - b.clientHeight < 80) $("newPill").classList.remove("on");
});
ACTIONS["log-bottom"] = () => { const b = $("threadScroll"); b.scrollTo({ top: b.scrollHeight, behavior: "smooth" }); $("newPill").classList.remove("on"); };
ACTIONS["log-all"] = () => { LOG.showAll = true; paintThread(true); };
ACTIONS.think = (k) => {
  LOG.think[k] = !LOG.think[k];
  const top = $("threadScroll").scrollTop;
  paintLog(false);
  $("threadScroll").scrollTop = top;
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
      return `<button class="plan-card ${cur && n.id === cur.id ? "cur" : ""} ${c === "checked" || c === "solid" ? "done" : ""}" data-act="go-subject" data-arg="map">${discEl(n, s)}<div><span class="pc-name">${md(n.name)}</span>${n.can_do ? `<span class="pc-sub">${md(cap(n.can_do))}</span>` : ""}</div>${icon("chev")}</button>`;
    }).join("") : `<div class="cap" style="padding:8px 0">No plan yet. A few more questions to find where you start.</div>`}
    <div class="plan-foot">${s.status === "done" ? "Goal met." : s.total ? `${left} ${left === 1 ? "skill" : "skills"} to go` : ""}</div>`;
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
    { label: "Show the terminal", ic: "terminal", run: ACTIONS["toggle-term"], keys: "Ctrl+`" },
    { label: "Start a subject", ic: "plus", run: ACTIONS.start, keys: key("N") },
    { label: `Restart ${tutorName()}`, ic: "review", run: ACTIONS.restart },
    { label: `Open ${tutorName()} with no command`, ic: "terminal", run: () => { go("session"); startTutor(""); } },
  ];
  const resumes = S.ranked.filter((x) => x.subject && x.kind !== "Review").slice(0, 12).map((x) => {
    const s = subj(x.subject);
    return { label: `${x.kind === "Repair" ? "Repair" : "Resume"} ${esc(shortTitle(s))}`, why: plain(x).line, s, run: () => run(x) };
  });
  const practice = S.subjects.filter((s) => s.proven).map((s) => ({ label: `Practice ${esc(shortTitle(s))}`, s, run: () => ACTIONS.practice(s.slug) }));
  const goTo = [
    { label: "Home", ic: "home", run: () => go("home"), keys: key("1") },
    { label: "Session", ic: "session", run: () => go("session"), keys: key("2") },
    { label: "All skills", ic: "skills", run: () => go("system"), keys: key("3") },
    { label: "Dashboard", ic: "dashboard", run: () => go("dashboard"), keys: key("4") },
    { label: "Progress", ic: "dashboard", run: () => go("progress"), keys: key("5") },
    { label: "Skill map", ic: "skills", run: () => go("map"), keys: key("6") },
    { label: "Settings", ic: "settings", run: openSettings, keys: key(",") },
    { label: "Open another vault", ic: "note", run: chooseVault, keys: key("O") },
  ];
  const subjects = S.subjects.map((s) => ({ label: md(s.title), s, run: () => go("session", s.slug) }));
  pal = { q: "", sel: 0, groups: [["Next step", recents], ["Session", session], ["Resume", resumes], ["Go to", goTo], ["Subjects", subjects], ["Practice", practice]] };
  const scrim = $("scrim");
  scrim.classList.remove("clear");
  scrim.classList.add("on");
  scrim.innerHTML = `<div class="card float palette" role="dialog" aria-label="Search and commands"><div class="head">${icon("search")}<input id="palq" placeholder="Search or run a command" autocomplete="off" spellcheck="false" aria-label="Search"></div><div class="list" id="palList" role="listbox"></div><div class="foot cap"><span class="kbd">↑</span><span class="kbd">↓</span>Move<span class="kbd" style="margin-left:10px">↩</span>Open<span class="kbd" style="margin-left:10px">Esc</span>Close</div></div>`;
  const q = $("palq");
  q.focus();
  q.oninput = () => { pal.q = q.value.toLowerCase().trim(); pal.sel = 0; palList(); };
  palList();
}
function palItems() {
  return pal.groups.map(([g, items]) => [g, items.filter((i) => !pal.q || (i.label + " " + (i.why || "")).replace(/<[^>]+>/g, "").toLowerCase().includes(pal.q))])
    .filter(([g, items]) => items.length && (pal.q || g !== "Practice"));
}
function palList() {
  let i = 0;
  $("palList").innerHTML = palItems().map(([g, items]) => `<div class="cap grp">${g}</div>` + items.map((it) => {
    const n = i++;
    return `<button class="item ${n === pal.sel ? "sel" : ""}" role="option" aria-selected="${n === pal.sel}" data-act="pal-run" data-arg="${n}" data-pal="${n}">${it.s ? tileIcon(it.s) : icon(it.ic || "chev", "sm")}<span style="flex:none">${it.label}</span>${it.why ? `<span class="why">${md(it.why)}</span>` : ""}${it.keys ? `<span style="margin-left:auto;padding-left:10px" class="keys">${it.keys.split(/(?<=⌘|⇧|⌥)|\+/).filter(Boolean).map((x) => `<span class="kbd">${esc(x)}</span>`).join("")}</span>` : ""}</button>`;
  }).join("")).join("") || `<div class="cap" style="padding:16px">Nothing matches.</div>`;
  const sel = document.querySelector(".palette .item.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}
$("scrim").addEventListener("mousemove", (e) => {
  const it = e.target.closest("[data-pal]");
  if (it && pal && +it.dataset.pal !== pal.sel) { pal.sel = +it.dataset.pal; [...document.querySelectorAll(".palette .item")].forEach((x) => x.classList.toggle("sel", +x.dataset.pal === pal.sel)); }
});
$("scrim").addEventListener("mousedown", (e) => { if (e.target === $("scrim")) closeOverlay(); });
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
  // Each preview wears its own theme's tokens, so it shows true colors in either mode.
  const pv = (t) => `<span data-theme="${t}"><i></i><i></i></span>`;
  const thumb = (value, label, preview) => `<button class="thumb ${theme === value ? "on" : ""}" data-act="set-theme" data-arg="${value}" aria-pressed="${theme === value}"><div class="pv">${preview}</div><div class="lab">${label}</div></button>`;
  scrim.innerHTML = `<div class="card float sheet" role="dialog" aria-label="Settings">
    <div style="display:flex;align-items:center"><h2 class="t-head">Settings</h2><button style="margin-left:auto" class="icon-btn" data-act="close" aria-label="Close" data-tip="Esc">${icon("x")}</button></div>
    <div class="sec"><div class="t-sec">Appearance</div>
      <div class="thumbs">${thumb("system", "System", pv("light") + pv("night"))}${thumb("light", "Light", pv("light"))}${thumb("night", "Night", pv("night"))}</div></div>
    <div class="sec"><div class="t-sec">Your name</div>
      <div class="cap" style="margin-top:2px">For the greeting on Home.</div>
      <input id="nameIn" class="field" value="${esc(firstName())}" placeholder="Your first name" aria-label="Your first name"></div>
    <div class="sec"><div class="t-sec">Tutor</div>
      <div class="cap" style="margin-top:2px">The command Flash runs in your vault. It uses your own sign-in.</div>
      <div class="seg" style="margin-top:8px" role="radiogroup">${[["claude", "Claude Code"], ["codex", "Codex"]].map(([v, l]) => `<button class="${cfg.host === v ? "on" : ""}" role="radio" aria-checked="${cfg.host === v}" data-act="set-host" data-arg="${v}">${l}</button>`).join("")}</div></div>
    <div class="sec"><div class="t-sec">Rewards ${S && S.rewards_on ? "on" : "off"}</div>
      <div class="cap" style="margin-top:2px">Badges and the review streak. Ask the tutor to turn them ${S && S.rewards_on ? "off" : "on"}; it is the <span class="mono">rewards:</span> line in learn/me/preferences.md.</div></div>
    <div class="sec"><div style="display:flex;align-items:center;gap:12px"><div style="min-width:0;flex:1"><div class="t-sec">Vault folder</div><div class="cap mono selectable" style="margin-top:2px;word-break:break-all">${esc(cfg.vault || "None")}</div></div><button class="btn neutral" style="flex:none" data-act="choose-vault" data-tip="${key("O")}">Change…</button></div></div>
    <div class="cap" style="padding-top:12px;border-top:1px solid var(--color-line)">${esc(info.name)} ${esc(info.version)}. Flash writes no learning record; the tutor does.</div>
  </div>`;
  const nameIn = $("nameIn");
  nameIn.addEventListener("change", () => { setCfg({ name: nameIn.value.trim() }); if (route.name === "home") paintHome(); });
}
ACTIONS.settings = () => openSettings();
ACTIONS.close = () => closeOverlay();
ACTIONS["set-theme"] = async (t) => { await setCfg({ theme: t }); applyTheme(); openSettings(); };
ACTIONS["set-host"] = async (h) => {
  if (h === cfg.host) return;
  if (T.running && !confirm(`Switch to ${h === "codex" ? "Codex" : "Claude Code"}? The running tutor stops. Your records stay as they are.`)) return;
  await SES.stop();
  await setCfg({ host: h });
  closeOverlay();
  boot();
};
ACTIONS["choose-vault"] = () => chooseVault();
function closeOverlay() {
  const s = $("scrim");
  s.classList.remove("on", "clear"); s.innerHTML = ""; pal = null;
  const sw = $("switcher"); if (sw) sw.setAttribute("aria-expanded", "false");
  if (route.name === "session") { if (T.drawer && T.term) T.term.focus(); else focusMsg(); }
}

async function chooseVault() {
  closeOverlay();
  const r = await F.chooseVault();
  if (r.canceled) return;
  if (r.problem) { toast(r.problem); return; }
  SES.markStopped();
  Object.keys(sessionCache).forEach((k) => delete sessionCache[k]);
  Object.keys(mapViews).forEach((k) => delete mapViews[k]);
  LOG.slug = null;
  if (T.term) T.term.reset();
  boot();
}
ACTIONS["open-vault"] = () => chooseVault();

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
    { ok: vaultOk, title: "Your learning vault", text: vaultOk ? "" : v.vault ? v.vaultProblem : `Pick the folder that holds your copy of the learning vault. It has a learn/ folder inside.`, path: v.vault, action: true },
    ...(v.problems || []).map((p) => ({ ok: false, title: p.what, text: p.fix })),
  ];
  if (!(v.problems || []).length) steps.push({ ok: true, title: `Python 3 and ${tutorName()} found`, text: "" });
  inkAction = vaultOk ? null : chooseVault;
  unput($("screen")); $("screen").innerHTML = `<div class="setup">
    <h1 class="t-title">Welcome to ${esc(info.name)}</h1>
    <p class="t-ui ink2" style="font-size:15px;line-height:22px;margin-top:8px">Your tutor, your skill maps, and your progress in one window. ${esc(info.name)} runs your own ${esc(tutorName())} in your vault, so everything works as it does in the terminal.</p>
    ${steps.map((st, i) => `<div class="card stepc"><span class="num ${st.ok ? "ok" : ""}">${st.ok ? icon("check", "xs") : i + 1}</span><div style="flex:1;min-width:0">
      <div class="t-sec">${esc(st.title)}</div>${st.path ? `<div class="path">${esc(st.path)}</div>` : ""}${st.text ? `<div class="fix">${esc(st.text)}</div>` : ""}
      ${st.action ? `<div style="margin-top:12px">${vaultOk ? `<button class="btn neutral" data-act="choose-vault">Choose another folder</button>` : `<button class="btn" data-act="choose-vault" data-tip="${key("O")}">Choose folder</button>`}</div>` : ""}
    </div></div>`).join("")}
    ${vaultOk && (v.problems || []).length ? `<div style="margin-top:18px;display:flex;gap:10px;align-items:center"><button class="btn" data-act="recheck">Check again</button><span class="cap">After installing, check again.</span></div>` : ""}
    <div class="seg" style="margin-top:22px" role="radiogroup" aria-label="Tutor">${[["claude", "Claude Code"], ["codex", "Codex"]].map(([h, l]) => `<button class="${cfg.host === h ? "on" : ""}" role="radio" aria-checked="${cfg.host === h}" data-act="setup-host" data-arg="${h}">${l}</button>`).join("")}</div>
  </div>`;
  if (vaultOk && (v.problems || []).length) inkAction = boot;
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

// ---------- toast ----------
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(text)}</span><button class="icon-btn" data-act="toast-close" aria-label="Dismiss">${icon("x", "sm")}</button>`;
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
  if (T.term) T.term.options.theme = termTheme();
  if (S && route.name !== "session") render();
  else if (S) paintThread(true);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

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
  else if (e.key === "Escape" && T.drawer && route.name === "session" && !MSG.contains(document.activeElement) && !document.activeElement.closest(".xterm")) { ACTIONS["toggle-term"](); e.preventDefault(); }
});
F.onMenu((id) => {
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
  // A refresh repaints what changed and keeps your place; the terminal and the
  // thread are never repainted by it.
  if (route.name === "session" && T.running) lastSaved = Date.now();
  paintSide();
  if (route.name === "session") { paintStatus(); if (cfg.panel) paintPlan(); if (!T.running) { paintActs(); if (LOG.data) paintThread(false); } return; }
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
  if (!S || route.name === "setup") return;
  const state = await F.state();
  if (state && !state.error && JSON.stringify(state) !== JSON.stringify(S)) {
    S = state; const top = $("screen").scrollTop;
    paintSide();
    if (route.name !== "session") { render(); $("screen").scrollTop = top; }
  }
});
window.addEventListener("resize", () => { if (MAPS.includes(route.name)) applyMap(); });

// ---------- boot ----------
async function boot() {
  info = info || await F.info();
  cfg = await F.config();
  document.body.classList.toggle("mac", info.platform === "darwin");
  document.body.classList.toggle("win", info.platform !== "darwin");
  applyTheme();
  setupInfo = await F.setupCheck();
  if (setupInfo.vaultProblem || setupInfo.problems.length) {
    route = { name: "setup", slug: null };
    return paintSetup();
  }
  $("win").classList.remove("bare");
  unput($("screen")); $("screen").innerHTML = `<div style="padding:40px" class="cap">Reading your records…</div>`;
  const state = await F.state();
  if (!state || state.error) return paintError(state || {});
  S = state;
  if (route.name === "setup") route = { name: "home", slug: null };
  if (!route.slug || !subj(route.slug)) route.slug = defaultSlug();
  render();
}
boot();
