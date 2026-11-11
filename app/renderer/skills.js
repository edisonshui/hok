// The Skills page (5 Nov 2026), ported from the v2 prototype (.scratch/flash-redesign/directions/v2/live/sky/sky.js,
// lart=none&hills=1). The title and its counts sit in a sky of rolling glass hills; below, one row per subject with a
// brick per skill. A row opens in place to list its skills in plain words; a brick names itself on hover; the label on
// the right is the row's one action. Scrolling dissolves the title and hills from their top edge and brings in a slim
// bar with the totals and the course you are in.
//
// SkillsPage.paint(el, S, { night, run }) draws into el (the app's .screen). S is learn-status.py --json.
// run(command, slug) starts a session, the way the app's other buttons do.
(function () {
  const COURSE_NAMES = { cs100: "CS 100", cs124: "CS 124", dtx221: "DTX 221", ealc275: "EALC 275", math241: "MATH 241", personal: "Personal" };
  const SHORT = { "cs100-algorithms": "Algorithms", "cs100-architecture": "Architecture", "cs100-design-lab": "Design lab", "cs100-pointers": "Pointers", "cs100-systems": "Systems", "cs100-trees-bsts": "Trees", "cs100-programming-languages-and-compilers": "Languages", "dtx221-midterm": "Midterm", "ealc275-midterm1-review": "Midterm 1", "math241-exam1-review": "Exam 1", "math241-exam2-review": "Exam 2", "math241-lagrange": "Lagrange", "personal-homelessness-champaign": "Homelessness", "personal-oop": "OOP" };
  // the vault's statuses in the page's five words
  const FIVE = { planned: "planned", introduced: "taught", checked: "passed", skipped: "passed", solid: "solid", decayed: "shaky" };

  const courseOf = (slug) => slug.split("-")[0];
  const courseName = (k) => COURSE_NAMES[k] || k.replace(/^([a-z]+)(\d+)$/, (_, a, b) => `${a.toUpperCase()} ${b}`).replace(/^./, (c) => c.toUpperCase());
  function shortOf(s) {
    if (SHORT[s.slug]) return SHORT[s.slug];
    let t = s.title.replace(/^[A-Z]{2,5} \d{2,3}\s+/, "");
    const m = t.match(/^(Quiz \d+|HW ?\d+|Exam \d+|Midterm(?: \d+)?)\b/); if (m) return m[1].replace(/^HW (\d)/, "HW$1");
    t = t.replace(/^(Quiz|Lesson \d+):\s*/, "").replace(/\s*\([^)]*\)/g, "").split(/ — |: /)[0].trim();
    return t.length > 22 ? t.split(/ and |, /)[0] : t;
  }
  const dayNum = (d) => Date.parse(d + "T12:00:00");
  const ago = (d) => (d === 0 ? "today" : d === 1 ? "yesterday" : d < 60 ? `${d} days ago` : d < 730 ? `${Math.round(d / 30)} months ago` : `${(d / 365).toFixed(1)} years ago`);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const inl = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\$([^$]+)\$/g, "<code>$1</code>");

  function model(S) {
    const today = S.today;
    const depthSort = (nodes) => { const byId = Object.fromEntries(nodes.map((n) => [n.id, n])), memo = {};
      const depth = (n, seen = new Set()) => memo[n.id] ?? (seen.has(n.id) ? 0 : (seen.add(n.id), (memo[n.id] = 1 + Math.max(-1, ...(n.prereqs || []).filter((p) => byId[p]).map((p) => depth(byId[p], seen))))));
      return [...nodes].sort((a, b) => depth(a) - depth(b)); };
    const groups = new Map();
    for (const s of S.subjects) {
      const k = courseOf(s.slug); if (!groups.has(k)) groups.set(k, { k, name: courseName(k), subjects: [] });
      const skills = depthSort(s.nodes || []).map((n) => { const d = n.checked === "today" ? today : n.checked && /^\d{4}-\d\d-\d\d/.test(n.checked) ? n.checked.slice(0, 10) : null;
        return { name: n.name, cando: n.can_do || null, st: FIVE[n.status] || "planned", days: d ? Math.max(0, Math.round((dayNum(today) - dayNum(d)) / 864e5)) : null, due: !!n.due }; });
      const first = skills.map((x) => x.days).filter((x) => x != null).sort((a, b) => b - a)[0] ?? -1;
      groups.get(k).subjects.push({ slug: s.slug, title: s.title, short: shortOf(s), skills, first });
    }
    const courses = [...groups.values()].sort((a, b) => (a.k === "personal") - (b.k === "personal") || a.k.localeCompare(b.k));
    courses.forEach((c) => c.subjects.sort((a, b) => b.first - a.first));   // the oldest work first, as the prototype did
    // the next review: the vault's own due flag, the most overdue first, at most six and two per subject (learn-review)
    const NEXT = new Set(), per = new Map();
    for (const { k, s } of courses.flatMap((c) => c.subjects.flatMap((s) => s.skills.map((k) => ({ k, s })))).filter(({ k }) => k.due && k.days != null).sort((a, b) => b.k.days - a.k.days)) {
      if (NEXT.size >= 6) break; const n = per.get(s) || 0; if (n < 2) { per.set(s, n + 1); NEXT.add(k); } }
    return { courses, NEXT };
  }

  let stop = null;
  // Which rows are open and how far the list is scrolled, kept across paints, so leaving Skills and coming back finds it
  // as you left it (Edison, 5 Nov: rows "close on their own" when switching pages).
  const MEM = { open: new Set(), y: 0 };
  const skScale = () => (Math.min(16.5, Math.max(15, 10 + 0.0033 * innerWidth)) / 15).toFixed(4);   // the thread's --read-size over its 15 px floor
  function paint(el, S, opts) {
    if (stop) stop(); document.querySelectorAll(".sk-float").forEach((e) => e.remove());
    const night = !!opts.night, run = opts.run;
    const { courses, NEXT } = model(S);
    const all = courses.flatMap((c) => c.subjects.flatMap((s) => s.skills));
    const passed = all.filter((k) => k.st === "passed" || k.st === "solid").length, due = NEXT.size, shaky = all.filter((k) => k.st === "shaky").length;
    const kind = (k) => (NEXT.has(k) ? "now" : k.st === "shaky" ? "repair" : k.st === "planned" || k.st === "taught" ? "gap" : "laid");
    const word = (k) => (NEXT.has(k) ? "Review due" : k.st === "shaky" ? "Shaky" : k.st === "passed" || k.st === "solid" ? "Passed" : k.st === "taught" ? "Learning" : "Not started");
    const tipLine = (k) => (NEXT.has(k) ? "Review due" : k.st === "shaky" ? "Shaky, missed its last check" : k.st === "passed" || k.st === "solid" ? "Passed" : k.st === "taught" ? "Learning, taught but not checked" : "Not started yet");
    const cap = (t) => t[0].toUpperCase() + t.slice(1);
    const mini = (cls) => `<span class="mk mini"><u class="${cls}"></u></span>`;
    // colours: the metal palette's ink and the review orange; three text strengths, measured over the glass (prototype)
    const INK = document.documentElement.dataset.stone ? "var(--color-ink)" : night ? "#EAE9E6" : "#191A1B", NOW = night ? "#FF8A3D" : "#E2602A";
    // on a stone the ink is the stone's own deep shade (10 Nov), read from the page's tokens
    const ST = !!document.documentElement.dataset.stone;
    const ink = (a) => (ST ? `color-mix(in srgb,var(--color-ink) ${Math.round(a * 100)}%,transparent)` : night ? `rgba(234,233,230,${a})` : `rgba(25,26,27,${a})`), T2 = ST ? "var(--color-ink-2)" : ink(night ? 0.72 : 0.9), T3 = ST ? "var(--color-ink-3)" : ink(night ? 0.6 : 0.8);
    const GL = (a) => night
      ? `background: rgba(255,255,255,${a}); box-shadow: inset 0 1px 0 rgba(255,255,255,${(a * 1.6).toFixed(3)}), inset 0 0 0 0.5px rgba(255,255,255,${(a * 2).toFixed(3)});`
      : `background: rgba(255,255,255,${a}); box-shadow: inset 0 1px 0 rgba(255,255,255,.95), inset 0 0 0 0.5px rgba(255,255,255,.8), 0 1px 2px rgba(30,34,42,.07);`;
    const W = el.clientWidth || 1100, GROUND = 196, BOT = GROUND - 4, CW = Math.max(W, screen.width || W);   // CW: as wide as the panel can ever be

    const css = `
      .sk { position: absolute; inset: 0; overflow: hidden; color: ${INK}; --eo: cubic-bezier(0.23, 1, 0.32, 1); font-family: var(--font-sans), system-ui, sans-serif; }
      .sk canvas.sk-hills { position: absolute; left: 0; top: 0; pointer-events: none; -webkit-mask-image: linear-gradient(#000 ${GROUND - 10}px, transparent ${GROUND + 120}px); }
      .sk h1 { position: absolute; left: 52px; top: 46px; margin: 0; font: 600 34px/1.05 var(--font-sans); letter-spacing: -0.025em; z-index: 1; pointer-events: none; }
      .sk .m { position: absolute; left: 52px; top: 96px; display: flex; gap: 18px; font: 11px/1 var(--font-mono); letter-spacing: .09em; text-transform: uppercase; color: ${T2}; z-index: 1; pointer-events: none; }
      .sk .m .mk.mini { margin-right: 8px; vertical-align: 1px; }
      .sk .ls { position: absolute; left: 0; top: 0; bottom: 0; width: ${CW}px; z-index: 2; overflow-y: auto; scrollbar-width: none; padding: 0 52px 120px 52px; overscroll-behavior: contain;
        -webkit-mask-image: linear-gradient(transparent 0, transparent 46px, #000 104px, #000 calc(100% - 90px), transparent); }
      .sk .ls::-webkit-scrollbar { display: none; }
      /* the scroll box is one fixed size, as wide as the screen, and the panel clips it: when the sidebar folds nothing inside
         changes size, so nothing is redrawn (5 Nov). The list is up to 1052 wide. */
      .sk .course { content-visibility: auto; contain-intrinsic-size: auto 420px; width: calc(min(1052px, calc(100vw - 392px)) + 52px); margin: 0 -26px; padding: 0 26px; }   /* sized by the window (272 sidebar, margins, 52 each side), which a fold does not change. content-visibility clips paint at the box, so the box carries the rows' 26 px bleed each side (Edison, 5 Nov: the open row's left edge was cut) */
      /* While the sidebar folds (6 Nov) each course block is its own layer, so the fold moves it without redrawing its bricks. At
         the 27" display's 1.08 zoom the bricks' glows were redrawn every frame: the Skills fold went from 0 to 4-6 frames over 20 ms.
         Only then, and only zoomed: kept on, layers drawn as courses scroll into view cost fast scrolling 1-2 slow frames, and
         at zoom 1 the layers' first draw costs the fold a 21 ms start frame it didn't have (all measured). */
      html.zoomed .window:is(.folding, .opening, .turning, .fold-open, .fold-close) .sk .course { will-change: transform; }
      .sk .lc { font: 11px/16px var(--font-mono); letter-spacing: .09em; text-transform: uppercase; color: ${T2}; margin: 20px 0 4px; }
      .sk .grp > .lr { position: relative; }   /* above the hover highlight */
      .sk .grp { position: relative; border-top: 1px solid ${ink(night ? 0.08 : 0.1)}; margin: 0 -26px; padding: 0 26px; }   /* no hover fade either way: the highlight is exactly where the pointer is */
      /* One model for every highlight (Edison, 5 Nov: the gaps around them differed): rows are bands split by hairlines, and
         an open card, like a hovered row, is a rounded glass shape floating 4 px inside its band, with no margins, and the
         hairlines beside it hidden. So every highlight sits 4 px from its band's edge, and two side by side are 9 apart. */
      .sk .grp.open { border-top-color: transparent; }
      .sk .grp.open::before { content: ""; position: absolute; inset: 4px 0 3px; border-radius: 10px; ${GL(night ? 0.045 : 0.42)} pointer-events: none; transition: opacity 300ms ease; }
      .sk .grp > .lx { position: relative; }
      .sk .grp.open + .grp { border-top-color: transparent; }
      .sk .grp.measure, .sk .grp.measure * { transition: none !important; }
      .sk .bkw { display: flex; align-items: center; gap: 16px; min-width: 0; }
      .sk .sd { flex: 0 1000 auto; min-width: 0; font: 12px/16px var(--font-sans); color: ${T3}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; transition: opacity 200ms ease; }
      .sk .grp.open .sd { opacity: 1; } .sk .grp.open.closing .sd { opacity: 0; transition-duration: 120ms; }
      .sk .grp.open.closing .lx > div > * { opacity: 0; transform: translateY(-6px); transition: opacity 160ms ease, transform 300ms var(--ease-fold); transition-delay: 0ms; }
      .sk .grp.open.closing::before { opacity: 0; }   /* the card's glass fades as it folds, so nothing pops when it lands */
      .sk .lr { display: grid; grid-template-columns: 300px 1fr 100px 160px; align-items: center; height: 34px;   /* 34: the 22 px button keeps 3 px inside a highlight floating 3 to 4 px in; 42 and 38 made the list long (Edison, 5 Nov) */
        font: 13.5px/18px var(--font-sans); outline: none; cursor: default; }
      .sk .lr > span:first-child { display: flex; align-items: center; gap: 8px; min-width: 0; } .sk .lr > span:first-child b { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sk .lr:focus-visible { box-shadow: 0 0 0 1.5px ${ink(night ? 0.38 : 0.45)}; border-radius: 10px; }   /* a soft ring (Edison, 5 Nov: the edges were too hard) */
      /* the chevron (Edison, 5 Nov): hidden until you point at a row, so the list stays quiet; it stays while the row is open */
      /* The chevron turns the moment you click, on the card's own spring and length (6 Nov, Edison: it only turned once the
         drop-down had finished). It follows aria-expanded, which flips at the click, not .open, which a closing card keeps
         until it lands; and opening, .open arrives during the measuring pass, where transitions are off. */
      .sk .cv { width: 10px; height: 10px; flex: none; margin-left: -18px; opacity: 0; transition: transform 300ms var(--ease-fold), opacity 150ms ease; }
      .sk .lr[aria-expanded="true"] .cv { opacity: .9; transform: rotate(90deg); transition-duration: 360ms, 150ms; }
      .sk .lr:focus-visible .cv { opacity: .9; }
      .sk .ct { font: 11px/16px var(--font-mono); letter-spacing: .06em; color: ${T2}; text-align: right; padding-right: 24px; white-space: nowrap; }
      .sk .bkw > .mk { flex: 0 1 auto; min-width: 0; overflow: visible; } .sk .bkw > .mk u { flex: 0 1 24px; min-width: 8px; }   /* 6 Nov: the date gives way first (it shrinks 1000x faster); only when the column is still too narrow do the bricks narrow, all alike, never clipped or over the count */
      .sk .mk { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; overflow: hidden; }
      .sk .mk u { flex: none; width: 24px; height: 7px; border-radius: 1.5px; }
      .sk .mk u.laid { ${night
        ? "background: linear-gradient(180deg, rgba(244,246,255,.58), rgba(232,236,248,.34)); box-shadow: inset 0 1px 0 rgba(250,252,255,.95), inset 0 0 3px rgba(255,255,255,.35), inset 0 0 0 0.5px rgba(248,250,255,.5), 0 0 8px rgba(226,230,242,.24);"
        : "background: linear-gradient(180deg, rgba(255,255,255,.75), rgba(255,255,255,.3)); box-shadow: inset 0 1px 0 rgba(255,255,255,1), inset 0 0 0 0.5px rgba(25,26,27,.16), 0 1px 2px rgba(30,34,42,.2), 0 2px 5px rgba(30,34,42,.08);"} }   /* day: on macOS's pale glass the brick shows by its shadow and rim */
      .sk .mk u.gap { box-shadow: inset 0 0 0 1px ${ink(0.32)}; } .sk .mk u.repair { box-shadow: inset 0 0 0 1.5px ${ink(0.62)}; }
      .sk .mk u.now { ${night
        ? "background: linear-gradient(180deg, #FFB070, #FF8A3D 55%, #E8682A); box-shadow: inset 0 1px 0 rgba(255,238,214,.9), inset 0 0 3px rgba(255,226,190,.55), inset 0 0 0 0.5px rgba(255,214,170,.6), 0 0 14px rgba(255,138,61,.75), 0 0 4px rgba(255,170,100,.9);"
        : "background: linear-gradient(180deg, #F08A52, #E2602A 55%, #CC5222); box-shadow: inset 0 1px 0 rgba(255,228,206,.85), inset 0 0 0 0.5px rgba(255,200,170,.5), 0 1px 2px rgba(120,40,10,.22);"} }
      .sk .mk:has(u.hot) u:not(.hot) { opacity: .38; }   /* a pointed-at skill line: its brick stays, the others step back */
      .sk .mk:not(.mini) u { transition: opacity 120ms ease; }
      /* the mark: a flat 10 x 4 dash in the brick's colour, set like a bullet */
      .sk .mk.mini, .sk-float .mk.mini { display: inline-flex; gap: 0; transform: translateY(-0.5px); overflow: visible; }
      .sk .mk.mini u, .sk-float .mk.mini u { width: 10px; height: 4px; border-radius: 2px; }
      .sk .mk.mini u.now, .sk-float .mk.mini u.now { background: ${NOW}; box-shadow: ${night ? `0 0 5px color-mix(in srgb, ${NOW} 70%, transparent)` : "none"}; }
      .sk .mk.mini u.repair, .sk-float .mk.mini u.repair { background: none; box-shadow: inset 0 0 0 1px ${ink(night ? 0.7 : 0.75)}; }
      .sk-float .mk.mini u.gap { background: none; box-shadow: inset 0 0 0 1px ${ink(0.45)}; } .sk-float .mk.mini u.laid { background: ${ink(night ? 0.75 : 0.7)}; }
      .sk .pb { justify-self: start; display: inline-flex; align-items: center; gap: 8px; height: 22px; padding: 0 12px; border: 0; border-radius: 6px; font: 13px/18px var(--font-sans); color: ${INK}; cursor: default; ${GL(night ? 0.07 : 0.55)}
        transition: background 90ms ease, transform 160ms var(--eo); }
      .sk .pb:active { transform: scale(.97); } .sk .pb:focus-visible { outline: 2px solid ${INK}; outline-offset: 2px; }
      .sk .lx { display: grid; grid-template-rows: 0fr; } .sk .grp.open .lx { grid-template-rows: 1fr; }
      .sk .lx > div { overflow: hidden; } .sk .grp.open .lx > div { padding: 2px 0 10px; }
      .sk .lx > div > * { opacity: 0; transform: translateY(-6px); transition: opacity 100ms ease, transform 150ms var(--eo); }
      /* opening (Edison, 5 Nov: too sudden): the sidebar's spring, and the skills arrive one after another, 28 ms apart */
      .sk .grp.open .lx > div > * { opacity: 1; transform: none; transition: opacity 240ms ease-out, transform var(--duration-fold-open) var(--ease-fold); transition-delay: calc(min(var(--i, 0), 8) * 28ms); }
      .sk .grp.kb, .sk .grp.kb * { transition: none !important; }
      .sk .ll { display: grid; grid-template-columns: 1fr 180px 160px; align-items: center; height: 28px; font: 13px/18px var(--font-sans); border-radius: 6px; }
      .sk .ll.hot { background: ${night ? "rgba(255,255,255,.04)" : "rgba(255,255,255,.35)"}; }
      /* the highlight reaches 10 px past the brick (Edison, 5 Nov: it sat flush on the brick's left edge); the list carries the room */
      .sk .ll { margin: 0 -10px; padding: 0 10px; } .sk .grp.open .lx > div, .sk .lx > div { margin: 0 -10px; padding-left: 10px; padding-right: 10px; }
      .sk .ll .nm { display: flex; align-items: center; gap: 14px; min-width: 0; } .sk .ll .nm b { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .sk .ll .nm .mk { flex: none; }
      .sk .ll .wn, .sk .lf { font: 12px/16px var(--font-sans); color: ${T3}; white-space: nowrap; } .sk .ll .wn { text-align: right; padding-right: 24px; }
      .sk .lf { height: 28px; display: flex; align-items: center; padding-left: 38px; }
      /* the state words start where the row button's words do: its dash over theirs, its words over theirs (Edison, 5 Nov) */
      .sk .ll .wd { padding-left: 12px; display: flex; align-items: center; gap: 8px; font: 11px/16px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: ${T2}; }
      .sk .ll .wd.now, .sk .ll .wd.rp { color: ${INK}; } .sk .ll .wd.dim { color: ${T3}; } .sk .ll .wd:not(.now):not(.rp) { padding-left: 30px; }
      .sk code, .sk-float code { font-family: var(--font-mono); font-size: .9em; }
      .sk .edge { position: absolute; left: 0; right: 0; top: 0; height: 72px; z-index: 3; pointer-events: none; }
      .sk .edge .bt, .sk .edge .bc { position: absolute; top: 20px; display: flex; align-items: center; gap: 16px; opacity: 0; transform: translateY(4px); white-space: nowrap; }
      .sk .edge .bt { left: 52px; } .sk .edge .bt b { font: 600 15px/20px var(--font-sans); letter-spacing: -0.01em; }
      .sk .edge .bt span { display: inline-flex; align-items: center; font: 11px/16px var(--font-mono); letter-spacing: .09em; text-transform: uppercase; color: ${T2}; } .sk .edge .bt span .mk { margin-right: 8px; }
      .sk .edge .bc { top: 22px; right: max(52px, calc(100% - 1104px)); font: 11px/16px var(--font-mono); letter-spacing: .09em; text-transform: uppercase; color: ${T2}; }
      @media (hover: hover) and (pointer: fine) {
        /* Row hover is .hov, set from where the pointer really is, also while the list scrolls under it (Chromium holds
           :hover still during a scroll, so the highlight trailed the pointer: Edison, 5 Nov). It moves at once, no fade. */
        /* the hover highlight floats 4 px inside its row, the same model as an open card */
        .sk .grp:not(.open).hov::before { content: ""; position: absolute; inset: 4px 0 3px; border-radius: 10px; background: ${night ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.26)"}; pointer-events: none; }
        .sk .grp.hov .lr:not([aria-expanded="true"]) .cv { opacity: .7; }   /* pointed at and closed or closing: the chevron stays, turning back (6 Nov review) */
        .sk .grp:not(.open).hov, .sk .grp.hov + .grp { border-top-color: transparent; }
        /* the hover lands at once and leaves in 90 ms; on an open card's glass it is a step stronger, or it barely showed (Edison, 5 Nov: "a bit slow") */
        .sk .pb:hover { background: ${night ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.85)"}; transition-duration: 0ms, 160ms; }
        .sk .grp.open .pb:hover { background: ${night ? "rgba(255,255,255,.17)" : "rgba(255,255,255,.95)"}; }
        /* A pointed-at brick stays and its row's others step back (Edison, 5 Nov: an outline ran into the empty brick beside
           it, and a lift looked tacky). Nothing moves; contrast does the pointing. */
        .sk .mk:not(.mini):has(u:hover) u:not(:hover) { opacity: .38; }
      }
      /* the hover label lives at the page level so its glass can blur what is under it */
      .sk-float { position: fixed; inset: 0; pointer-events: none; z-index: 60; color: ${INK}; font-family: var(--font-sans), system-ui, sans-serif; }
      .sk-float .tip { position: absolute; width: max-content; max-width: 340px; padding: 10px 14px 12px; border-radius: 10px; opacity: 0; transform: scale(.97); transition: opacity 90ms ease, transform 90ms var(--eo);
        ${night ? "background: #262727; box-shadow: inset 0 1px 0 rgba(255,255,255,.10), inset 0 0 0 0.5px rgba(255,255,255,.14), 0 10px 30px rgba(0,0,0,.35);"
          : "background: linear-gradient(180deg, rgba(255,255,255,.84), rgba(255,255,255,.68)); -webkit-backdrop-filter: blur(22px) saturate(1.7) brightness(1.06); backdrop-filter: blur(22px) saturate(1.7) brightness(1.06); box-shadow: inset 0 1px 0 #fff, inset 0 0 0 0.5px rgba(255,255,255,.95), inset 0 -1px 0 rgba(25,26,27,.05), 0 0 0 0.5px rgba(25,26,27,.06), 0 14px 34px rgba(30,34,42,.15), 0 2px 6px rgba(30,34,42,.06);"} }
      ${night ? "" : `.sk-float .tip::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: radial-gradient(120% 70% at 18% -10%, rgba(255,255,255,.7), rgba(255,255,255,0) 60%); } .sk-float .tip > * { position: relative; }`}
      .sk-float .tip.on { opacity: 1; transform: none; transition-duration: 125ms; } .sk-float .tip.instant { transition-duration: 0ms; }
      .sk-float .t0 { font: 10.5px/14px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: ${T3}; margin-bottom: 4px; }
      .sk-float .t1 { font: 600 13.5px/18px var(--font-sans); } .sk-float .t2 { font: 12.5px/17px var(--font-sans); color: ${T2}; margin-top: 3px; }
      .sk-float .t3 { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 9px; border-top: 1px solid ${ink(night ? 0.1 : 0.09)}; font: 11px/16px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
      .sk-float .t4 { margin-top: 6px; font: 12px/16px var(--font-sans); color: ${T3}; }
      @media (prefers-reduced-motion: reduce) { .sk .lx, .sk .cv { transition: none !important; } .sk .lx > div > * { transition-delay: 0s !important; } .sk .lx > div > *, .sk-float .tip { transform: none !important; } .sk .pb:active { transform: none; } }`;

    const CV = `<svg class="cv" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 6.5 5 3.5 8"/></svg>`;
    // Sizes follow the window like the thread's type (6 Nov, Edison: "make this text scale also relatively"): --read-size
    // goes 15 to 16.5 px between 1515 and 1970 px wide, so every size here over 2 px (type, rows, bricks, gaps) goes 100 to
    // 110% on the same span (skScale). Hairlines stay, and so do the hills (their mask line is left alone).
    const cssS = css.split("\n").map((l) => (l.includes("sk-hills") ? l : l.replace(/(?<![\w.#])(-?\d+(?:\.\d+)?)px/g, (m, n) => (Math.abs(n) <= 2 ? m : `calc(${n}px * var(--sks, 1))`)))).join("\n");
    el.innerHTML = `<div class="sk" style="--sks:${skScale()}"><style>${cssS}</style><canvas class="sk-hills"></canvas><h1>${passed} of ${all.length} skills passed</h1>
      <div class="m"><span>${mini("now")}${due} ${due === 1 ? "review" : "reviews"} due</span>${shaky ? `<span>${mini("repair")}${shaky} shaky</span>` : ""}</div>
      <div class="ls"></div><div class="edge"><div class="bt"><b>${passed} of ${all.length} skills passed</b><span>${mini("now")}${due} ${due === 1 ? "review" : "reviews"} due</span>${shaky ? `<span>${mini("repair")}${shaky} shaky</span>` : ""}</div><div class="bc"></div></div></div>`;
    const root = el.querySelector(".sk"), ls = root.querySelector(".ls"), cv = root.querySelector("canvas"), edge = root.querySelector(".edge");
    const sp = document.createElement("div"); sp.style.height = (BOT + 8) + "px"; ls.append(sp);   // the list starts about 40 px under the lowest wave (it was 60; Edison, 5 Nov: the list ran long)
    const SK = [], WH = [];
    // Each course is its own block, drawn only once it is near the screen (content-visibility: 5 Nov, the first Skills
    // after launch froze for 174 ms on Edison's Mac building all 31 rows and 245 bricks at once).
    const flight = { land: null };   // the one row animation in flight, so a second toggle lands it first
    const remember = (slug, o) => { if (o) MEM.open.add(slug); else MEM.open.delete(slug); };
    for (const c of courses) {
      const cb = document.createElement("div"); cb.className = "course"; ls.append(cb);
      const lc = document.createElement("div"); lc.className = "lc"; lc.textContent = c.name; cb.append(lc);
      for (const s of c.subjects) {
        const nd = s.skills.filter((k) => NEXT.has(k)).length, ns = s.skills.filter((k) => k.st === "shaky").length, np = s.skills.filter((k) => k.st === "passed" || k.st === "solid").length;
        const bricks = `<span class="mk">${s.skills.map((k) => (SK.push(k), WH.push(`${c.name} · ${s.short}`), `<u class="${kind(k)}" data-k="${SK.length - 1}"></u>`)).join("")}</span>`;
        // the row's one action: a review of its due skills, or a session on the subject aimed at the shaky one
        const act = nd ? `<button class="pb" data-run="review">${mini("now")}Review ${nd} ${nd === 1 ? "skill" : "skills"}</button>` : ns ? `<button class="pb" data-run="practice">${mini("repair")}Practice ${ns} shaky</button>` : `<span></span>`;
        const g2 = document.createElement("div"); g2.className = "grp"; g2.dataset.slug = s.slug;
        const row = document.createElement("div"); row.className = "lr"; row.tabIndex = 0; row.setAttribute("role", "button"); row.setAttribute("aria-expanded", "false"); row.title = s.title;
        // the shared check date said once, beside the bricks while the row is open (it was a footer row under the list,
        // which arrived last and read as a stutter: Edison, 5 Nov); a skill checked on another day carries its own
        const ds = s.skills.filter((k) => k.days != null).map((k) => k.days), cnt = new Map(); ds.forEach((d) => cnt.set(d, (cnt.get(d) || 0) + 1));
        let m = null, mc = 0; for (const [d, n] of cnt) if (n > mc || (n === mc && d < m)) { m = d; mc = n; }
        const shared = mc >= 2 ? m : null, odd = ds.some((d) => d !== shared);
        row.innerHTML = `<span>${CV}<b>${esc(s.short)}</b></span><span class="bkw">${bricks}${shared != null ? `<span class="sd">${odd ? "The rest checked" : "All checked"} ${ago(shared)}</span>` : ""}</span><span class="ct">${np} of ${s.skills.length}</span>${act}`;
        const lines = s.skills.map((k) => { const w = word(k), cls = w === "Review due" ? "now" : w === "Shaky" ? "rp" : w === "Not started" || w === "Learning" ? "dim" : "", i = SK.indexOf(k);
          return `<div class="ll" data-k="${i}"><span class="nm"><span class="mk"><u class="${kind(k)}" data-k="${i}"></u></span><b>${inl(k.name)}</b></span><span class="wn">${k.days != null && k.days !== shared ? `Checked ${ago(k.days)}` : ""}</span><span class="wd ${cls}">${cls === "now" ? mini("now") : cls === "rp" ? mini("repair") : ""}${w}</span></div>`; }).join("");
        const lx = document.createElement("div"); lx.className = "lx"; lx.innerHTML = `<div>${lines}</div>`;
        { const kids = [...lx.firstElementChild.children]; kids.forEach((c, n) => c.style.setProperty("--i", c.classList.contains("lf") ? Math.max(0, n - 1) : n)); }   // the stagger order; the footer ("The rest checked …") arrives with the last skill and does not rise on its own, which read as a late stutter at the bottom (Edison, 5 Nov)
        // Opening (5 Nov: animating the height re-laid out and repainted every row below on each frame, measured at 8 to 11
        // dropped frames near the top). The space now opens at once and the motion is all transforms: the rows below start
        // where they were and slide to their new place, and the open group is unclipped in step with them (FLIP).
        // What slides when this row opens or closes: the rows after it in its course, then whole course blocks after that.
        // Each block clips its own paint (content-visibility), so moving another course's rows one by one cut them off at
        // their block's edge mid-slide (Edison, 5 Nov: "a weird visual glitch on the bottom half"); a block moves whole.
        const movers = (reach) => { const out = [], cb2 = g2.parentElement; let past = false;
          for (const e of cb2.children) { if (e === g2) past = true; else if (past) out.push(e); }
          for (let n = cb2.nextElementSibling; n; n = n.nextElementSibling) { if (n.getBoundingClientRect().top > reach) break; out.push(n); }
          return out; };
        const toggle = (kb) => {
          if (flight.land) flight.land();   // another row still moving: land it now, so two never fight over the same rows
          const animate = !kb && !reduce, was = g2.classList.contains("open");
          if (!animate) { g2.classList.toggle("kb", kb); const o = g2.classList.toggle("open"); row.setAttribute("aria-expanded", String(o)); remember(s.slug, o); setTimeout(() => hoverAt(), 0); return; }
          g2.classList.remove("kb");
          // Where this card and everything below sit now, and where they sit with the row toggled, measured (with motion
          // held off), so every gap and margin lands exactly. Opening, they start where they were and slide to their new
          // place while the card is uncovered from its header down. Closing runs that backwards (Edison, 5 Nov): the row
          // stays laid out open while its skills fade, the card is clipped up to its header as its glass fades, and the
          // rows below rise; only then does the layout close, under transforms that already show it closed.
          const reach = ls.getBoundingClientRect().bottom + (was ? lx.offsetHeight : 0) + 60, items = [g2, ...movers(reach)];
          const before = items.map((e) => e.getBoundingClientRect().top), hOpen = was ? lx.offsetHeight : 0;
          g2.classList.add("measure"); g2.classList.toggle("open");
          const after = items.map((e) => e.getBoundingClientRect().top), h = was ? hOpen : lx.offsetHeight;
          if (was) g2.classList.add("open");   // closing: back to open, now that the closed layout is known
          void g2.offsetWidth; g2.classList.remove("measure");
          const ms = was ? 300 : 360, tr = (prop) => `${prop} ${ms}ms var(--ease-fold)`;
          for (const e of items) e.style.transition = "none";
          if (was) {
            g2.classList.add("closing"); row.setAttribute("aria-expanded", "false"); remember(s.slug, false);
            g2.style.clipPath = "inset(0 0 0px 0 round 10px)"; void g2.offsetWidth;
            g2.style.transition = `${tr("transform")}, ${tr("clip-path")}`;
            g2.style.clipPath = `inset(0 0 ${h}px 0 round 10px)`;
            items.forEach((e, n) => { if (n) e.style.transition = tr("transform"); const d = after[n] - before[n]; if (d) e.style.transform = `translateY(${d}px)`; });
          } else {
            row.setAttribute("aria-expanded", "true"); remember(s.slug, true);
            items.forEach((e, n) => { const d = before[n] - after[n]; if (d) e.style.transform = `translateY(${d}px)`; });
            g2.style.clipPath = `inset(0 0 ${h}px 0 round 10px)`; void g2.offsetWidth;
            g2.style.transition = `${tr("transform")}, ${tr("clip-path")}`; g2.style.clipPath = "inset(0 0 0px 0 round 10px)";
            items.forEach((e, n) => { if (n) e.style.transition = tr("transform"); e.style.transform = ""; });
          }
          let t = 0; const land = () => { clearTimeout(t); flight.land = null;
            for (const e of items) { e.style.transition = "none"; e.style.transform = ""; e.style.clipPath = ""; }
            if (was) g2.classList.remove("open", "closing");
            void g2.offsetWidth; for (const e of items) e.style.transition = "";
            hoverAt(); };
          flight.land = land; t = setTimeout(land, ms + (was ? 0 : 20));
        };
        row.addEventListener("click", (ev) => { const b = ev.target.closest(".pb"); if (b) { run(b.dataset.run === "review" ? `learn-review ${nd} ${s.slug}` : `learn-resume ${s.slug}`, s.slug); return; } if (ev.detail === 0) return; toggle(false); });
        row.addEventListener("keydown", (ev) => { if (ev.target !== row) return; if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(true); } });
        g2.append(row, lx); cb.append(g2);
      }
    }

    // the hover label (Emil Kowalski's tooltip rule): 250ms before the first, then each next one swaps at once
    const fl = document.createElement("div"); fl.className = "sk-float"; document.body.append(fl); const tip = document.createElement("div"); tip.className = "tip"; fl.append(tip);
    let wait = 0, hideT = 0, lastHide = -1e9, hotK = null;
    const mark = (i, on) => ls.querySelectorAll(`[data-k="${i}"]`).forEach((e) => e.classList.toggle("hot", on));
    const show = (u) => { const i = +u.dataset.k, k = SK[i];
      tip.innerHTML = `<div class="t0">${esc(WH[i])}</div><div class="t1">${inl(k.name)}</div>${k.cando ? `<div class="t2">${inl(cap(k.cando))}</div>` : ""}<div class="t3">${mini(kind(k))}${tipLine(k)}</div><div class="t4">${k.days != null ? `Checked ${ago(k.days)}` : "No checks yet"}</div>`;
      const b = u.getBoundingClientRect(), R = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, cx = b.left + b.width / 2;
      let Y = b.top - th - 12, up = true; if (Y < R.top + (ls.scrollTop > 30 ? 96 : 12)) { Y = b.bottom + 12; up = false; }
      const X = Math.max(R.left + 12, Math.min(R.right - tw - 12, cx - tw / 2));
      tip.style.left = X + "px"; tip.style.top = Y + "px"; tip.style.transformOrigin = `${cx - X}px ${up ? "100%" : "0"}`; tip.classList.add("on"); };
    const hide = () => { clearTimeout(wait); clearTimeout(hideT); hideT = setTimeout(() => { if (!tip.classList.contains("on")) return; tip.classList.remove("instant", "on"); lastHide = performance.now(); }, 60); };
    ls.addEventListener("pointerover", (ev) => { const u = ev.target.closest(".mk:not(.mini) u, .ll"); if (!u) return; const i = +u.dataset.k;
      if (hotK != null && hotK !== i) mark(hotK, false); hotK = i; mark(i, true); if (!u.matches(".mk u")) return;
      clearTimeout(wait); clearTimeout(hideT);
      if (tip.classList.contains("on") || performance.now() - lastHide < 300) { tip.classList.add("instant"); show(u); } else { tip.classList.remove("instant"); wait = setTimeout(() => show(u), 250); } });
    ls.addEventListener("pointerout", (ev) => { const to = ev.relatedTarget?.closest?.(".mk:not(.mini) u, .ll"); if (!to) { if (hotK != null) mark(hotK, false); hotK = null; } if (ev.target.closest(".mk u") && !to?.matches?.(".mk u")) hide(); });

    // the hills: three layers of clear glass that roll left to right, low on the left so the title sits in the sky
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, DPR = devicePixelRatio || 1, CH = GROUND + 130;
    // The hills' shape is set by the width at paint (W0), so a sidebar fold only uncovers or covers them; computed from
    // the live width, every wave stretched and its phase slid as the panel moved (Edison, 5 Nov: "its physics reset").
    // A real window resize reshapes them. Wl is the live width they must reach.
    let Wl = W, W0 = W;
    // The size follows once the window settles (6 Nov, Edison: resizing on Skills felt laggy): restyling every row's sizes on
    // each resize step cost 33 frames over 20 ms in a 1.5 s drag, against 4 without it (measured).
    let sksT = 0;
    const onWinResize = () => { if (!root.isConnected) return removeEventListener("resize", onWinResize); W0 = Wl = el.clientWidth || W0;
      clearTimeout(sksT); sksT = setTimeout(() => { const v = skScale(); if (root.style.getPropertyValue("--sks") !== v) root.style.setProperty("--sks", v); }, 140); };
    addEventListener("resize", onWinResize);
    cv.width = CW * DPR; cv.height = CH * DPR; cv.style.width = CW + "px"; cv.style.height = CH + "px";
    const g = cv.getContext("2d"), HSC = document.createElement("canvas"); HSC.width = CW * DPR; HSC.height = CH * DPR; const oc = HSC.getContext("2d");
    const LAYERS = [
      { h: 160, env0: 0.30, a: 0.08, v: 19, bob: [3.5, 9.0, 0.2], Pk: 1.9, k: [[1, 0.32, 0.4], [2, 0.12, 2.1]] },
      { h: 100, env0: 0.32, a: 0.093, v: 34, bob: [4.5, 7.0, 2.3], Pk: 1.5, k: [[1, 0.30, 1.9], [2, 0.12, 0.3]] },
      { h: 56, env0: 0.55, a: 0.105, v: 51, bob: [5, 5.5, 4.1], Pk: 1.2, k: [[1, 0.30, 3.4], [2, 0.12, 1.2]] }];
    let SX = W * 0.70; const SY = GROUND - 40;
    // the sun glow takes your stone (10 Nov, Edison: a gold band on every stone looked wrong); read again when the stone changes
    let sunRGB = [255, night ? 192 : 214, night ? 122 : 156], sunKey = "";
    const gold = (a) => `rgba(${sunRGB.join(",")},${a})`, crestGlow = (a) => `rgba(${sunRGB.map((v) => Math.round(v + (255 - v) * 0.5)).join(",")},${a})`;
    const sun = (c, r, a0, warm) => { const gr = c.createRadialGradient(SX, SY, 0, SX, SY, r); gr.addColorStop(0, warm(a0)); gr.addColorStop(0.45, warm(a0 * 0.35)); gr.addColorStop(1, warm(0)); return gr; };
    const bloom = document.createElement("canvas"); bloom.width = W * DPR; bloom.height = CH * DPR;
    const paintBloom = () => { const b = bloom.getContext("2d"); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, bloom.width, bloom.height); b.scale(DPR, DPR); b.translate(SX, SY); b.scale(1, 0.32); b.translate(-SX, -SY); b.fillStyle = sun(b, W * 0.75, night ? 0.025 : 0.16, gold); b.fillRect(-W, -CH, 3 * W, 3 * CH); };
    const readSun = () => { const de = document.documentElement, k = (de.dataset.stone || "") + (de.dataset.theme || ""); if (k === sunKey) return; sunKey = k;
      const hx = getComputedStyle(de).getPropertyValue("--stone-glow").trim();
      if (/^#[0-9a-f]{6}$/i.test(hx)) sunRGB = [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16));
      paintBloom(); };
    readSun();
    const ss = (a, b, v) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
    let sy = 0, raf = 0, alive = true;
    const drawHills = (now) => {
      readSun(); const t = reduce ? 0 : now / 1000, W = W0, WL = Math.max(W0, Wl); SX = W * 0.70;
      g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, CW, CH);
      if (sy > 320) return;
      g.globalAlpha = 1 - ss(0, 220, sy); g.drawImage(bloom, 0, 0, WL, CH); g.globalAlpha = 1;   // drawn once for the width at paint, stretched to the live width
      LAYERS.forEach((k, li) => {
        // scroll: each layer rises at its own depth, calms, and fades along its own line, the far one first
        const d = ss(li * 40, li * 40 + 200, sy); if (d >= 1) return;
        const G0 = GROUND - (reduce ? 0 : sy * [0.22, 0.36, 0.5][li]), hk = k.h * (1 - (reduce ? 0 : 0.45 * d)); g.globalAlpha = 1 - d;
        const y = (x) => { const u = Math.min(1, Math.max(0, x / (W * 0.62))), env = k.env0 + (1 - k.env0) * u * u * (3 - 2 * u);
          let w = 0.56; for (const [n, amp, ph] of k.k) w += amp * Math.sin((2 * Math.PI * n * (x - k.v * t)) / (k.Pk * W) + ph);
          const [ba, bp, bph] = k.bob, swell = Math.sin((t / bp) * Math.PI * 2 + bph); return G0 - hk * env * w * (1 + 0.06 * swell) - ba * env * (0.5 + 0.5 * swell); };
        const crest = new Path2D(); let top = G0; for (let x = -8; x <= WL + 8; x += 6) { const yy = y(x); top = Math.min(top, yy); x === -8 ? crest.moveTo(x, yy) : crest.lineTo(x, yy); }
        const body = new Path2D(crest); body.lineTo(WL + 8, G0 + 30); body.lineTo(-8, G0 + 30); body.closePath();
        // the glass: white, thinning toward the ground so it has no bottom edge (night: the same glass, dimmer)
        const gr = g.createLinearGradient(0, top, 0, G0 + 30);
        gr.addColorStop(0, `rgba(255,255,255,${k.a * (night ? 0.7 : 3.2)})`); gr.addColorStop(0.5, `rgba(255,255,255,${k.a * (night ? 0.22 : 1.1)})`); gr.addColorStop(0.85, "rgba(255,255,255,0)");
        g.save(); if (!night) { g.shadowColor = "rgba(30,34,42,.22)"; g.shadowBlur = 14; g.shadowOffsetY = -2; }   // day: the hills show by their shadow g.fillStyle = gr; g.fill(body); g.restore();
        // sunlight through the glass, thinning exactly as the glass does
        oc.setTransform(DPR, 0, 0, DPR, 0, 0); oc.globalCompositeOperation = "source-over"; oc.clearRect(0, 0, CW, CH);
        oc.fillStyle = sun(oc, W * 0.8, night ? k.a * 0.12 : k.a * 1.8, gold); oc.fill(body);
        const fade = oc.createLinearGradient(0, top, 0, G0 + 30); fade.addColorStop(0, "#000"); fade.addColorStop(0.5, "rgba(0,0,0,.4)"); fade.addColorStop(0.85, "rgba(0,0,0,0)");
        oc.globalCompositeOperation = "destination-in"; oc.fillStyle = fade; oc.fillRect(0, 0, CW, CH);
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = night ? "lighter" : "screen"; g.drawImage(HSC, 0, 0); g.restore();
        if (night) { g.lineWidth = 2.5; g.strokeStyle = "rgba(236,238,246,.07)"; g.stroke(crest); }   // a glow that hugs the line
        g.lineWidth = 1; g.strokeStyle = night ? `rgba(240,242,250,${0.42 + k.a * 1.8})` : "rgba(255,255,255,.95)"; g.stroke(crest);
        g.save(); g.globalCompositeOperation = night ? "lighter" : "source-over"; g.lineWidth = 1.5; g.strokeStyle = sun(g, W * 0.8, night ? 0.12 : 0.6, crestGlow); g.stroke(crest); g.restore();
      });
      g.globalAlpha = 1;
    };
    const loop = (now) => { if (!alive || !root.isConnected) { alive = false; fl.remove(); return; } drawHills(now); if (!reduce) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    // scroll: the title and counts dissolve from their top edge through the top 46px; the hills leave in the canvas; past
    // the title the bar comes in with the scroll (100 to 140px), and names the course you are in
    const heads = [root.querySelector("h1"), root.querySelector(".m")], lcs = [...ls.querySelectorAll(".lc")], bc = edge.querySelector(".bc"), bars = [...edge.querySelectorAll(".bt, .bc")];
    let sraf = 0;
    const onScroll = () => { sraf = 0; const y = ls.scrollTop; sy = y; MEM.y = y; if (reduce) drawHills(0);
      heads.forEach((e, i) => { const top = (i ? 96 : 46) - y, m = `linear-gradient(transparent ${-top}px, #000 ${46 - top}px)`; e.style.transform = `translateY(${-y}px)`; e.style.webkitMaskImage = m; e.style.maskImage = m; });
      const bp = Math.min(1, Math.max(0, (y - 100) / 40)); bars.forEach((e) => { e.style.opacity = bp; e.style.transform = reduce ? "" : `translateY(${(1 - bp) * 4}px)`; });
      let cur = lcs[0]; const top = ls.getBoundingClientRect().top; for (const l of lcs) if (l.getBoundingClientRect().top - top < 70) cur = l;
      if (cur && bc.textContent !== cur.textContent) bc.textContent = cur.textContent;
      clearTimeout(wait); tip.classList.add("instant"); tip.classList.remove("on"); };
    ls.addEventListener("scroll", () => { if (!sraf) sraf = requestAnimationFrame(onScroll); scrollHover(); }, { passive: true });
    // the hovered row, from where the pointer is (see .hov in the styles)
    let px = -1, py = -1, hraf = 0, hovG = null, hst = 0;
    // While the list scrolls the highlight steps away, and it lands on the row under the pointer 90 ms after the scroll
    // settles: asking which row is under the pointer on every scroll frame cost 1 to 6 frames over 20 ms (measured 5 Nov).
    const scrollHover = () => { if (hovG) { hovG.classList.remove("hov"); hovG = null; } clearTimeout(hst); hst = setTimeout(() => { hst = 0; requestAnimationFrame(hoverAt); }, 90); };   // inside a frame, where the layout is being done anyway
    const hoverAt = () => { hraf = 0; const e = px < 0 ? null : document.elementFromPoint(px, py), g = e && ls.contains(e) ? e.closest(".grp") : null;
      if (g !== hovG) { if (hovG) hovG.classList.remove("hov"); if (g) g.classList.add("hov"); hovG = g; } };
    ls.addEventListener("pointermove", (ev) => { if (ev.pointerType !== "mouse") return; px = ev.clientX; py = ev.clientY; if (!hst) hoverAt(); }, { passive: true });   // mid-scroll, the settle sets it
    ls.addEventListener("pointerleave", () => { px = py = -1; hoverAt(); });
    // Redrawn at a new width, the page comes back as you left it: scrolled to the same place, the same rows open.
    const keep = opts.keep || (MEM.open.size || MEM.y ? { open: [...MEM.open], y: MEM.y } : null);
    if (keep) { for (const slug of keep.open) { const g3 = ls.querySelector(`.grp[data-slug="${slug}"]`); if (g3) { g3.classList.add("open"); g3.querySelector(".lr").setAttribute("aria-expanded", "true"); } } ls.scrollTop = keep.y; onScroll(); }
    // The page flows with its space (the sidebar folding, the window resizing), the way Home does: the list keeps its
    // width and only its right margin moves, and the hills draw to the live width every frame (5 Nov: holding the width
    // and redrawing at the end made Skills slide, then snap, unlike Home).
    const ro = new ResizeObserver(() => { if (!root.isConnected) { ro.disconnect(); return; } Wl = el.clientWidth || Wl; if (reduce) drawHills(0); });
    ro.observe(el);
    stop = () => { alive = false; cancelAnimationFrame(raf); fl.remove(); };
  }
  // leaving Skills: the next visit starts with every row closed and the list at the top (Edison, 5 Nov); a redraw while
  // you stay (new records, a resize) keeps them
  window.SkillsPage = { paint, shortOf, forget: () => { MEM.open.clear(); MEM.y = 0; } };
})();
