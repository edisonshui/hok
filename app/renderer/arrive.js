// How the tutor's words arrive (spec, "Session slice": reply arrival, locked 29 Oct).
//
// The hook writes log.md a paragraph at a time (step 1, measured), so the app
// releases the words itself: 30 a second, a breath after a sentence (+80 ms) and
// after a comma (+30 ms). When a chunk lands with words still waiting, the pace
// quickens just enough to catch up, never past 90 a second. Each word comes into
// focus with blur on the settle spring. A formula arrives symbol by symbol at the
// same pace, in reading order (numerator before denominator). Words wait in place
// at opacity 0, so their layout is already there and nothing reflows.
//
// Reduce motion keeps the pace and rhythm as a plain fade (fading is not movement).
// Typing in the composer releases every waiting word. A window you are not looking
// at shows words as they arrive.
(function () {
  "use strict";
  const { clock, curve } = window.motion;
  const PACE = 30, MAX = 90, LAG = 0.4, BLUR = 3, SENTENCE = 0.08, COMMA = 0.03;
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const looking = () => document.visibilityState === "visible" && document.hasFocus();

  // key -> { toks: Element[], released, starts: Map<index, clock time> }
  const items = new Map();
  const order = [];            // keys with words still waiting, oldest first
  let nextAt = 0, rate = PACE, off = null, lastRelease = 0;

  // ---------- tokens ----------
  // Words become spans; a formula gives up its symbols; a picture or a diagram is one token.
  const WHOLE = "img, svg, canvas, video, button, .mermaid, kbd";
  // A box (a code block, a table, a quote) is a token of its own, ahead of its words: its background waits its turn
  // too, instead of standing empty below words still arriving (Edison, 7 Nov).
  const BOX = ".codeblock, pre, table, blockquote, .callout";
  function tokenize(root) {
    const out = [];
    const walk = (n) => {
      for (const c of [...n.childNodes]) {
        if (c.nodeType === 3) {
          if (!c.textContent.trim()) continue;
          const f = document.createDocumentFragment();
          for (const w of c.textContent.split(/(\s+)/)) {
            if (!w) continue;
            if (/^\s+$/.test(w)) { f.append(w); continue; }
            const s = document.createElement("span");
            s.className = "w"; s.textContent = w;
            out.push(s); f.append(s);
          }
          c.replaceWith(f);
        } else if (c.nodeType === 1) {
          if (c.classList.contains("katex")) mathTokens(c, out);
          else if (c.matches(WHOLE)) out.push(c);
          else if (c.matches(BOX)) { out.push(c); walk(c); }
          else walk(c);
        }
      }
    };
    walk(root);
    return out;
  }
  // KaTeX stacks a fraction bottom to top in its markup; read it top to bottom, so the
  // numerator is written before its line and the line before the denominator. A root's
  // sign is drawn before what sits under it.
  function mathTokens(k, out) {
    const html = k.querySelector(".katex-html") || k;
    const walk = (n) => {
      let kids = [...n.children];
      if (n.classList.contains("vlist")) {
        if (kids.some((r) => r.querySelector(":scope > .frac-line"))) kids.sort((a, b) => parseFloat(a.style.top || 0) - parseFloat(b.style.top || 0));
        else if (kids.some((r) => r.querySelector(":scope > .hide-tail"))) kids.sort((a, b) => !!b.querySelector(":scope > .hide-tail") - !!a.querySelector(":scope > .hide-tail"));
      }
      for (const c of kids) {
        if (c.tagName.toLowerCase() === "svg" || c.classList.contains("frac-line") || c.classList.contains("hide-tail")) { out.push(c); continue; }
        if (!c.children.length) { if (c.textContent.replace(/[\s​]/g, "")) out.push(c); continue; }
        walk(c);
      }
    };
    walk(html);
  }
  const breath = (el) => {
    const t = (el.textContent || "").replace(/["'”’)\]*]+$/, "");
    return /[.?!]$/.test(t) ? SENTENCE : /[,;:]$/.test(t) ? COMMA : 0;
  };

  // ---------- how one token lands ----------
  const settle = curve("settle"), snappy = curve("snappy");
  const span = () => (calm() ? snappy : settle);
  function paintTok(el, age) {
    const cv = span();
    if (age >= cv.duration) { el.style.opacity = ""; el.style.filter = ""; return true; }
    const v = Math.max(0, cv(age));
    el.style.opacity = v.toFixed(3);
    el.style.filter = calm() || v > 0.99 ? "" : `blur(${((1 - v) * BLUR).toFixed(2)}px)`;
    return false;
  }

  // ---------- the check card lands: Grow (spec, locked 29 Oct) ----------
  // The card forms, then the tutor writes on it: its kicker, the question word by word
  // in the reply's voice, then each option's key and symbols at 45 a second, the next
  // row starting at 75% of the one before. The sheet lengthens on the snappy spring a
  // beat (0.1 s) ahead of each line, so it is never an empty box. Reduce motion: the
  // card is its full height at once and the writing is a plain fade at the same pace.
  // A card waits its turn behind words still arriving above it.
  const cards = new Map();     // key -> card plan, while it lands
  function planCard(card) {
    const steps = [], grows = [];
    const add = (el, at, how = "blur") => { el.style.opacity = "0"; steps.push({ el, at, how }); };
    const kicker = card.querySelector(".cc-kicker"), stem = card.querySelector(".cc-q");
    add(kicker, 0.15);
    grows.push({ at: 0, el: kicker });
    let w = 0.25;
    if (stem) {
      grows.push({ at: 0.2, el: stem });
      for (const el of tokenize(stem)) { w += 1 / PACE; add(el, w); w += breath(el) > COMMA ? SENTENCE : 0; }
    }
    let o0 = w + 0.12;
    for (const o of card.querySelectorAll(".cc-opt")) {
      const glyphs = [o.querySelector(".cc-key"), ...tokenize(o.querySelector(".cc-o"))].filter(Boolean);
      grows.push({ at: o0 - 0.1, el: o });
      add(o, o0, "row");
      glyphs.forEach((g, k) => add(g, o0 + 0.04 + k / 45));
      o0 += 0.04 + (glyphs.length / 45) * 0.75;
    }
    // Controls already open (the tutor went quiet before the card was drawn) land last.
    const fold = card.querySelector(".cc-fold");
    const rest = o0 + 0.08;
    if (fold && getComputedStyle(fold).display !== "none") [...fold.children].forEach((r, i) => { grows.push({ at: rest + i * 0.06 - 0.1, el: r }); add(r, rest + i * 0.06, "row"); });
    return { card, steps, grows, end: rest + 0.5, write: rest, t0: null, hs: null };
  }
  const padB = (card) => parseFloat(getComputedStyle(card).paddingBottom) + parseFloat(getComputedStyle(card).borderBottomWidth);
  const upTo = (card, el) => Math.round(el.getBoundingClientRect().bottom - card.getBoundingClientRect().top + padB(card));
  function startCard(p, t0) {
    p.t0 = t0;
    p.card.style.opacity = "0";
    if (calm()) return;
    const h = upTo(p.card, p.grows[0].el);
    window.ARRIVE.layout(() => { p.card.style.overflow = "hidden"; p.card.style.height = `${h}px`; });
    p.hs = window.motion.spring(h, { to: h, feel: "snappy", onUpdate: (v) => window.ARRIVE.layout(() => { if (p.card.isConnected) p.card.style.height = `${v.toFixed(1)}px`; }) });
  }
  function finishCard(key, p) {
    if (p.hs) p.hs.stop();
    window.ARRIVE.layout(() => { p.card.style.height = ""; p.card.style.overflow = ""; p.card.style.opacity = ""; });
    for (const s of p.steps) { s.el.style.opacity = ""; s.el.style.filter = ""; }
    cards.delete(key);
    p.card._growing = false;
    const after = p.card._afterGrow; p.card._afterGrow = null;
    if (after) after();
  }
  // One frame of a landing card. Returns true while it still moves.
  function paintCard(key, p, now) {
    if (p.t0 == null) return false;
    const age = now - p.t0;
    if (age >= p.end) { finishCard(key, p); return false; }
    const form = settle(age);
    p.card.style.opacity = Math.min(1, form * 3).toFixed(3);
    if (p.hs) for (const g of p.grows) if (!g.done && age >= g.at) { g.done = true; p.hs.to(upTo(p.card, g.el)); }
    for (const s of p.steps) {
      if (s.done || age < s.at) continue;
      if (s.how === "row") { const v = snappy(age - s.at); s.el.style.opacity = v >= 1 ? "" : v.toFixed(3); if (v >= 1) s.done = true; }
      else if (paintTok(s.el, age - s.at)) s.done = true;
    }
    return true;
  }
  function card(node, key) {
    const c = node.querySelector(".check-card");
    if (!c) return;
    const p = planCard(c);
    c._growing = true;
    c.style.opacity = "0";   // the sheet itself waits its turn too
    if (!looking()) { cards.set(key, p); finishCard(key, p); return; }
    const idle = waiting() === 0;
    cards.set(key, p);
    order.push(key);
    items.set(key, { toks: [], released: 0, starts: new Map(), card: p });
    if (idle) nextAt = Math.max(nextAt, clock.now());
    run();
  }

  // ---------- the clock ----------
  const waiting = () => order.reduce((n, k) => { const st = items.get(k); return n + (st ? (st.card ? (st.card.t0 == null ? 1 : 0) : st.toks.length - st.released) : 0); }, 0);
  // An item can ask for a lower ceiling (Questions: a reply arrives in big chunks, and catching up at 90 a second read
  // as "too fast, and choppy", Edison 7 Nov). Session replies have none, so their pace is unchanged.
  function paceFor(n) {
    const cap = order.reduce((m, k) => { const st = items.get(k); return st && st.max ? Math.min(m, st.max) : m; }, MAX);
    rate = Math.min(cap, Math.max(PACE, n / LAG));
  }
  function tick() {
    const now = clock.now();
    // Release every token whose time has come; each keeps the time it was due, so a
    // long frame still lands them in rhythm.
    while (order.length && nextAt <= now) {
      const st = items.get(order[0]);
      if (st && st.card) {   // a card's turn: it lands now, and words after it wait for its writing
        if (st.card.t0 == null) { startCard(st.card, nextAt); nextAt += st.card.write; }
        order.shift(); continue;
      }
      if (!st || st.released >= st.toks.length) { order.shift(); continue; }
      const i = st.released++;
      st.starts.set(i, nextAt);
      nextAt += (1 + breath(st.toks[i]) * PACE) / rate;
      lastRelease = Date.now();
    }
    let moving = false;
    for (const [key, p] of [...cards]) if (paintCard(key, p, now)) moving = true;
    for (const st of items.values()) {
      if (st.card) continue;
      for (const [i, t0] of st.starts) {
        const el = st.toks[i];
        if (!el || paintTok(el, now - t0)) st.starts.delete(i); else moving = true;
      }
    }
    if (!order.length && !moving) { off(); off = null; }
  }
  const run = () => { if (!off) off = clock.on(tick); };

  // ---------- the interface paintLog uses ----------
  // adopt(node, key): the tutor item's markup was just rebuilt (a new chunk, or its
  // first). Words already released keep their place in the motion; new ones wait.
  function adopt(node, key, opts) {
    const toks = tokenize(node);
    const idle = waiting() === 0;
    let st = items.get(key);
    if (!st) items.set(key, (st = { toks, released: 0, starts: new Map() }));
    st.toks = toks;
    if (opts && opts.max) st.max = opts.max;
    if (st.released > toks.length) st.released = toks.length;
    const now = clock.now();
    toks.forEach((el, i) => {
      if (i >= st.released) { el.style.opacity = "0"; return; }
      const t0 = st.starts.get(i);
      if (t0 != null) paintTok(el, now - t0);
    });
    if (!looking()) { releaseAll(key, true); return; }
    if (st.released < toks.length) {
      if (!order.includes(key)) order.push(key);
      if (idle) nextAt = Math.max(nextAt, now);   // after a silence, the first word comes now
      paceFor(waiting());                          // one pace per chunk, so the words stay steady
      run();
    }
  }
  // Every waiting word comes in now. instant: no motion at all (a window you aren't
  // looking at, or a repaint from scratch).
  function releaseAll(only, instant) {
    const now = clock.now();
    for (const [key, st] of items) {
      if (only && key !== only) continue;
      if (st.card) { if (cards.has(key)) finishCard(key, st.card); continue; }
      for (let i = st.released; i < st.toks.length; i++) {
        if (instant) { st.toks[i].style.opacity = ""; st.toks[i].style.filter = ""; }
        else st.starts.set(i, now);
      }
      if (instant) for (const [i] of st.starts) { st.toks[i].style.opacity = ""; st.toks[i].style.filter = ""; st.starts.delete(i); }
      st.released = st.toks.length;
    }
    for (let i = order.length - 1; i >= 0; i--) if (!only || order[i] === only) order.splice(i, 1);
    lastRelease = Date.now();
    if (!instant) run();
  }
  // A full repaint draws everything at rest; the old nodes are gone.
  function reset() { releaseAll(null, true); items.clear(); order.length = 0; }
  const forget = (key) => { const i = order.indexOf(key); if (i >= 0) order.splice(i, 1); if (cards.has(key)) finishCard(key, cards.get(key)); items.delete(key); };

  window.addEventListener("blur", () => releaseAll(null, true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") releaseAll(null, true); });

  window.ARRIVE = {
    adopt, card, reset, forget,
    // Height changes go through here, so the app can keep your place while a card grows.
    layout: (fn) => fn(),
    flush: () => releaseAll(null, false),
    waiting,
    // Anything still arriving: words waiting, or a card landing.
    busy: () => waiting() > 0 || cards.size > 0,
    // Wall-clock ms of the last word released, so the Working line waits for the words.
    get lastRelease() { return lastRelease; },
    get rate() { return rate; },
    // For the tests in .scratch/flash-redesign/build/b4: an item's tokens and how many are out.
    peek: (key) => { const st = items.get(key); return st ? { toks: st.toks, released: st.released } : null; },
  };
})();
