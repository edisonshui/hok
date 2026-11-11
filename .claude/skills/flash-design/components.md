# Flash components

This file gives every UI part as HTML and CSS for Flash's Electron renderer (`app/renderer/`). Take every value from [tokens.css](tokens.css). The snippets render together in `.scratch/flash-brand/components/preview.html`, which `build.py` in that folder regenerates from this file. Rebuild it after editing a snippet and look at the screenshot.

Markup uses `${ic("name")}` from [icons.js](icons.js), which returns an inline SVG. In a static file, paste the SVG from `icons/<name>.svg` instead.

## Base

Load the two bundled fonts, the tokens, and the icon base. Night mode is `data-theme="night"` on `<html>`, which `applyTheme()` in `app.js` sets.

```css
@font-face{font-family:"Figtree";src:url(fonts/figtree.woff2) format("woff2");font-weight:300 900}
@font-face{font-family:"Geist Mono";src:url(fonts/geist-mono.woff2) format("woff2");font-weight:100 900}
body{margin:0;background:var(--color-bg);color:var(--color-ink);font:var(--type-ui);-webkit-font-smoothing:antialiased}
.ico{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;width:var(--icon-ui);height:var(--icon-ui);stroke-width:var(--icon-ui-stroke);flex:none;display:block}
.ico.sm{width:var(--icon-sm);height:var(--icon-sm);stroke-width:var(--icon-sm-stroke)}
.mono{font-family:var(--font-mono)}
.cap{font:var(--type-caption);color:var(--color-ink-3)}
:focus-visible{outline:none;box-shadow:var(--focus-ring)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
```

## Window

The grey frame holds the sidebar, a white main panel inset 8px, and on Session the plan panel. Add `icons` to fold the sidebar, `bare` to hide it, and `planned` when the plan panel shows.

```html
<div class="window planned">
  <aside class="sidebar">…</aside>
  <main class="panel">…</main>
  <aside class="plan">…</aside>
</div>
```

```css
.window{display:grid;grid-template-columns:var(--sidebar) 1fr;height:100vh;background:var(--color-bg);transition:grid-template-columns var(--duration-base) var(--ease-out)}
.window.icons{grid-template-columns:var(--sidebar-icons) 1fr}
.window.bare{grid-template-columns:1fr}
.window.planned{grid-template-columns:var(--sidebar) 1fr var(--plan-panel)}
.window.icons.planned{grid-template-columns:var(--sidebar-icons) 1fr var(--plan-panel)}
.window.bare.planned{grid-template-columns:1fr var(--plan-panel)}
.panel{position:relative;overflow:hidden;background:var(--color-surface);border:1px solid var(--color-line);border-radius:var(--radius-card);margin:8px 8px 8px 0}
.window.bare .panel{margin:8px}
```

## Sidebar

The sidebar holds screens on top, subjects in the middle, and Today and the streak card pinned to the bottom. One row is selected at a time: a screen, or the subject whose session is open. Subjects run in recommended order, each with its deadline word or its due count.

```html
<aside class="sidebar">
  <div class="brand"><span class="mark">…bolt svg…</span><b class="lbl">Flash</b><button class="icon-btn" aria-label="Search and commands">${ic("search")}</button></div>
  <nav>
    <a class="nav-row on">${ic("home")}<span class="lbl">Home</span></a>
    <a class="nav-row">${ic("skills")}<span class="lbl">All skills</span></a>
    <a class="nav-row">${ic("dashboard")}<span class="lbl">Dashboard</span></a>
  </nav>
  <h4 class="side-label">Subjects</h4>
  <a class="nav-row subject" style="--c:var(--subject-math)"><span class="tile-icon">${ic("math")}</span><span class="lbl">MATH 241 HW24</span><span class="n">Wed</span></a>
  <a class="nav-row subject on" style="--c:var(--subject-code)"><span class="tile-icon">${ic("code")}</span><span class="lbl">CS 124 Quiz 9</span><span class="n"><i class="live" aria-label="Session running"></i></span></a>
  <a class="nav-row add"><span class="tile-add">${ic("plus")}</span><span class="lbl">Start a subject</span></a>
  <div class="grow"></div>
  <h4 class="side-label">Today</h4>
  <a class="nav-row"><span class="status-icon amber">${ic("review")}</span><span class="lbl">Reviews due</span><span class="n">116</span></a>
  <a class="nav-row"><span class="status-icon coral">${ic("repair")}</span><span class="lbl">To repair</span><span class="n">3</span></a>
  <a class="nav-row">${ic("settings")}<span class="lbl">Settings</span></a>
  <a class="streak-card"><span class="status-icon coral">${ic("streak")}</span><span class="lbl"><b>5-week review streak</b><span>Best 5 · 116 due this week</span></span>${ic("chev","sm")}</a>
</aside>
```

```css
.sidebar{background:var(--color-side);display:flex;flex-direction:column;padding:12px 10px 10px;min-height:0;overflow:hidden}
.brand{display:flex;align-items:center;gap:9px;padding:4px 6px 14px}.brand b{font:700 15px/20px var(--font-sans)}.brand .icon-btn{margin-left:auto}
.mark{width:24px;height:24px;border-radius:7px;background:var(--color-ink);color:var(--color-gold);display:grid;place-items:center}.mark .ico{width:15px;height:15px;stroke-width:2.2}
.nav-row{display:flex;align-items:center;gap:10px;height:32px;padding:0 9px;border-radius:var(--radius-option);color:var(--color-ink-2);font:var(--type-ui);font-size:13.5px;text-decoration:none;transition:background var(--duration-fast) var(--ease-out)}
.nav-row>.ico{color:var(--color-ink-3)}
.nav-row:hover{background:color-mix(in srgb,var(--color-selected) 60%,var(--color-side));color:var(--color-ink)}
.nav-row.on{background:var(--color-row-selected);box-shadow:0 0 0 1px var(--color-line-strong);color:var(--color-ink);font-weight:500}.nav-row.on>.ico{color:var(--color-ink)}
.nav-row.subject{padding-left:7px}.nav-row.add{color:var(--color-ink-3)}
.nav-row .n{margin-left:auto;font:var(--type-caption);color:var(--color-ink-3);font-variant-numeric:tabular-nums}
.side-label{font:600 11.5px/16px var(--font-sans);color:var(--color-ink-3);margin:18px 9px 6px}
.grow{flex:1}
.tile-add{width:20px;height:20px;border-radius:var(--radius-icon);border:1px dashed var(--color-untaught);display:grid;place-items:center;color:var(--color-ink-3)}.tile-add .ico{width:12px;height:12px}
.status-icon{display:grid;place-items:center;color:var(--color-ink-3)}.status-icon.amber{color:var(--color-amber)}.status-icon.coral{color:var(--color-coral)}
.live{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--color-ink);box-shadow:0 0 0 3px var(--color-selected)}
.streak-card{margin-top:10px;display:flex;align-items:center;gap:10px;background:var(--color-surface);border:1px solid var(--color-line-strong);border-radius:var(--radius-card);padding:9px 10px;color:var(--color-ink);text-decoration:none}
.streak-card .lbl b{display:block;font:var(--type-ui-strong)}.streak-card .lbl span{font:var(--type-caption);color:var(--color-ink-3)}.streak-card>.ico{margin-left:auto;color:var(--color-ink-3)}
/* Folded to icons (⌘\). Labels fade in the first 80ms so text never squeezes. */
.window.icons .sidebar{padding:12px 8px;align-items:center}
.window.icons .lbl,.window.icons .nav-row .n,.window.icons .brand .icon-btn{display:none}
.window.icons .side-label{width:24px;height:1px;background:var(--color-line-strong);margin:12px 0;font-size:0}
.window.icons .nav-row{width:36px;justify-content:center;padding:0}
.window.icons .nav-row.subject.on{background:none;box-shadow:none}
.window.icons .tile-icon{width:28px;height:28px;border-radius:8px}.window.icons .tile-icon .ico{width:18px;height:18px;stroke-width:1.9}
.window.icons .nav-row.subject.on .tile-icon{box-shadow:0 0 0 2px var(--color-side),0 0 0 3.5px var(--c)}
.window.icons .streak-card{padding:8px;border-radius:var(--radius-option)}.window.icons .streak-card>.ico{display:none}
```

## Subject tile

A subject's drawn icon in its color on a tint of that color. It is the only place subject color sits behind an icon. Set `--c` to the subject's token from `theme:` in `record.md`.

```html
<span class="tile-icon" style="--c:var(--subject-literature)">${ic("literature")}</span>
```

```css
.tile-icon{width:20px;height:20px;border-radius:var(--radius-icon);display:inline-grid;place-items:center;flex:none;background:color-mix(in srgb,var(--c) var(--subject-soft),var(--color-surface));color:var(--c)}
.tile-icon .ico{width:var(--icon-tile);height:var(--icon-tile);stroke-width:var(--icon-tile-stroke)}
```

## Header islands

Two islands float over the top of the Session panel. The left island holds the subject switcher and the three tabs. The right island holds the status line and icon buttons for Note, Terminal, and the plan panel. With the sidebar hidden, the left island starts with the Flash mark, which goes Home. The thread scrolls under a 64px fade.

```html
<div class="islands">
  <div class="island">
    <button class="switcher" style="--c:var(--subject-math)"><span class="tile-icon">${ic("math")}</span><b>MATH 241 HW24</b>${ic("chev","down")}</button>
    <span class="divider"></span>
    <div class="tabs" role="tablist"><button class="on" role="tab">Session</button><button role="tab">Skill map</button><button role="tab">Progress</button></div>
  </div>
  <div class="island">
    <span class="status-line">${ic("check")}Saved · 17:42</span><span class="divider"></span>
    <button class="icon-btn" aria-label="Note">${ic("note")}</button><button class="icon-btn" aria-label="Terminal">${ic("terminal")}</button><button class="icon-btn flip" aria-label="Hide plan">${ic("sidebar")}</button>
  </div>
</div>
```

```css
.islands{position:absolute;top:10px;left:12px;right:12px;display:flex;justify-content:space-between;align-items:center;z-index:2}
.panel.session::before{content:"";position:absolute;inset:0 0 auto;height:64px;background:linear-gradient(var(--color-surface) 55%,transparent);z-index:1}
.island{display:inline-flex;align-items:center;gap:4px;height:var(--island-height);padding:0 4px;background:var(--color-surface);border:1px solid var(--color-line-strong);border-radius:var(--radius-input)}
.island .divider{width:1px;height:20px;background:var(--color-line);margin:0 4px}
.switcher{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 8px 0 6px;border:0;border-radius:var(--radius-option);background:none;color:var(--color-ink);font:var(--type-ui-strong);cursor:pointer}
.switcher:hover,.switcher[aria-expanded="true"]{background:var(--color-selected)}
.ico.down{width:13px;height:13px;transform:rotate(90deg);color:var(--color-ink-3)}
.tabs{display:inline-flex;gap:2px;padding:2px;background:var(--color-side);border-radius:9px}
.tabs button{padding:5px 11px;border:0;border-radius:7px;background:none;font:var(--type-ui);color:var(--color-ink-2);cursor:pointer}
.tabs button.on{background:var(--color-surface);box-shadow:0 0 0 1px var(--color-line-strong);color:var(--color-ink);font-weight:600}
.icon-btn{width:32px;height:32px;border:0;border-radius:var(--radius-option);background:none;display:grid;place-items:center;color:var(--color-ink-3);cursor:pointer;transition:background var(--duration-fast) var(--ease-out)}
.icon-btn:hover{background:var(--color-selected);color:var(--color-ink)}.icon-btn .ico{width:17px;height:17px}.icon-btn.flip .ico{transform:scaleX(-1)}
.status-line{display:inline-flex;align-items:center;gap:5px;padding:0 6px 0 8px;font:var(--type-caption);color:var(--color-ink-3)}.status-line .ico{width:13px;height:13px;stroke-width:2.2}
```

## Buttons

One filled ink button per screen. Everything else is a neutral button or a text button. Buttons are flat rounded squares (8px). Each action's shortcut goes in its hover tip (`data-tip`) and the command palette, never beside the button.

```html
<button class="btn">${ic("resume","sm")}Resume</button>
<button class="btn" disabled>Resume</button>
<button class="btn" aria-busy="true"><i class="spin"></i>Starting</button>
<button class="btn neutral"><span class="status-icon amber">${ic("review","sm")}</span>Review 116 due</button>
<button class="btn text">${ic("hint","sm")}Hint</button>
```

```css
.btn{display:inline-flex;align-items:center;gap:6px;height:var(--button-height);padding:0 18px;border:0;border-radius:var(--radius-button);font:var(--type-ui);font-weight:500;background:var(--color-action);color:var(--color-action-ink);cursor:pointer;transition:background var(--duration-fast) var(--ease-out),transform var(--duration-fast) var(--ease-out)}
.btn:hover{background:color-mix(in srgb,var(--color-action) 88%,var(--color-ink))}
.btn:active{background:color-mix(in srgb,var(--color-action) 78%,var(--color-ink));transform:scale(.98)}
.btn:disabled{background:var(--color-selected);color:var(--color-ink-3);cursor:default}
.btn.neutral{background:var(--color-surface);border:1px solid var(--color-line-strong);color:var(--color-ink-2);font-weight:400}
.btn.neutral:hover{background:var(--color-selected);color:var(--color-ink)}
.btn.text{background:none;color:var(--color-ink-3);padding:0 8px;font-weight:400;gap:5px}.btn.text:hover{background:var(--color-selected);color:var(--color-ink)}
.spin{width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
```

## Chips and progress bar

A deadline chip carries one fact: coral for now, amber for coming up, the subject's tint otherwise.

```html
<span class="chip now">HW23 · 2 to repair</span><span class="chip soon">CS 124 Quiz 9</span><span class="chip" style="--c:var(--subject-math)">HW24</span>
<span class="bar"><i style="width:60%"></i></span>
```

```css
.chip{display:inline-flex;align-items:center;gap:6px;font:var(--type-caption);font-size:12.5px;padding:4px 8px;border-radius:var(--radius-chip);background:color-mix(in srgb,var(--c) var(--subject-soft),var(--color-surface));color:var(--color-ink);border-left:2.5px solid var(--c)}
.chip.now{background:var(--color-coral-soft);color:var(--color-coral-text);border-left-color:var(--color-coral);font-weight:600}
.chip.soon{background:var(--color-amber-soft);color:var(--color-amber-text);border-left-color:var(--color-amber);font-weight:600}
.bar{display:block;height:5px;border-radius:3px;background:var(--color-track);overflow:hidden}.bar i{display:block;height:100%;background:var(--color-green);border-radius:3px}
```

## Skill discs

A node's state from the record: Not yet, introduced, up next, checked, Solid. Flat, no lip. The Solid fill is the 320ms signature motion.

```html
<i class="disc"></i><i class="disc intro"></i><i class="disc up"></i><i class="disc ok"></i><i class="disc solid"></i>
```

```css
.disc{display:inline-block;width:18px;height:18px;border-radius:50%;border:1.8px dashed var(--color-untaught);flex:none}
.disc.intro{border:2px solid var(--color-ink-2)}
.disc.up{border:2px solid var(--color-amber);box-shadow:0 0 0 3px var(--color-amber-soft)}
.disc.ok{border:0;background:var(--color-green)}
.disc.solid{border:1.5px solid var(--color-gold-edge);background:linear-gradient(var(--color-gold),var(--color-gold)) bottom/100% 100% no-repeat}
.disc.solid.landing{animation:fill var(--duration-proof) var(--ease-out)}
@keyframes fill{from{background-size:100% 0}}
```

## Thread

Tutor replies sit in the read color at the reading size, at most 660px wide. Your messages are grey bubbles on the right. A step list shows what the tutor did, from the log. A question is a card with numbered options. A wrong pick stays neutral: the right option turns green and the explanation sits under it.

```html
<div class="thread">
  <p>The squares are gone, so it integrates directly.</p>
  <span class="math-line">sin²θ = (1 − cos 2θ) / 2</span>
  <div class="me"><span class="bubble">so for sin² it's the same thing but with a minus?</span></div>
  <div class="steps"><div class="step">Thinking · 14s ${ic("chev","down")}</div><div class="step ok">${ic("check")}Checked your answer against the record</div><div class="step ok">${ic("check")}Saved to today's session note</div></div>
  <div class="question">
    <div class="q-text">∫<sub>0</sub><sup>π</sup> sin²θ dθ = ?</div>
    <button class="option after"><i class="radio"></i>π/4<kbd>1</kbd></button>
    <button class="option right"><i class="radio"></i>π/2<kbd>2</kbd></button>
    <button class="option after"><i class="radio"></i>π<kbd>3</kbd></button>
    <div class="verdict">Right. Half of π, because sin² averages ½ over a full period.</div>
  </div>
</div>
```

```css
.thread{max-width:var(--reading-max);margin:0 auto;padding:74px 0 170px;font:var(--type-reading);color:var(--color-read)}
.thread p{margin:0 0 10px}
.thread>*{animation:enter var(--duration-message) var(--ease-out)}
@keyframes enter{from{opacity:0;transform:translateY(4px)}}
.math-line{display:block;text-align:center;margin:12px 0;font:var(--type-code);color:var(--color-ink)}
.me{display:flex;justify-content:flex-end;margin:18px 0}
.bubble{max-width:70%;background:var(--color-bubble);color:var(--color-ink);border-radius:16px 16px 5px 16px;padding:8px 14px;font:var(--type-reading);font-size:14px;line-height:21px}
.steps{margin:6px 0 14px;border-left:1.5px solid var(--color-line-strong);padding-left:12px}
.step{display:flex;align-items:center;gap:7px;font:var(--type-ui);color:var(--color-ink-3);padding:3px 0}.step .ico{width:14px;height:14px}.step.ok .ico{color:var(--color-green);stroke-width:2.4}
.question{background:var(--color-surface);border:1px solid var(--color-line-strong);border-radius:var(--radius-card);padding:16px 18px;margin:12px 0}
.q-text{font:700 15px/22px var(--font-sans);color:var(--color-ink)}
.option{display:flex;width:100%;gap:10px;align-items:center;margin-top:8px;padding:9px 12px;border:1px solid var(--color-line-strong);border-radius:var(--radius-option);background:var(--color-surface);font:var(--type-ui);font-size:14px;color:var(--color-ink);text-align:left;cursor:pointer}
.option kbd{margin-left:auto;font:var(--type-key);color:var(--color-ink-3)}
.option .radio{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--color-untaught);flex:none}
.option:hover{border-color:var(--color-action);box-shadow:inset 0 0 0 1px var(--color-action)}
.option.sel{border-color:var(--color-action);background:var(--color-action-soft);box-shadow:inset 0 0 0 1px var(--color-action)}.option.sel .radio{border:4px solid var(--color-action)}
.option.right{border-color:var(--color-green);background:var(--color-green-soft)}.option.right .radio{border-color:var(--color-green);background:var(--color-green)}
.option.after{color:var(--color-ink-3)}
.verdict{font:600 13px/18px var(--font-sans);color:var(--color-green);margin-top:10px}
```

## Composer

The composer docks at the bottom of the thread over a fade, with Hint, Check me, Break, and End as text buttons above it. Send stays grey until there is text. The bottom row holds attach, the model and effort, and send. Home uses the one-line form.

```html
<div class="dock"><div class="dock-in">
  <div class="acts"><button class="btn text">${ic("hint","sm")}Hint</button><button class="btn text">${ic("checkme","sm")}Check me</button><button class="btn text">${ic("pause","sm")}Break</button><button class="btn text">${ic("end","sm")}End</button></div>
  <div class="composer"><textarea placeholder="Reply to your tutor, or paste a screenshot"></textarea>
    <div class="composer-row"><button class="icon-btn" aria-label="Attach">${ic("plus","sm")}</button><button class="model">Opus 5.5 · high ${ic("chev","down")}</button><button class="send" aria-label="Send" disabled>${ic("send","sm")}</button></div></div>
</div></div>
```

```css
.dock{position:absolute;left:0;right:0;bottom:0;padding:30px 0 18px;background:linear-gradient(transparent,var(--color-surface) 45%)}
.dock-in{max-width:var(--reading-max);margin:0 auto}.acts{display:flex;gap:2px;margin:0 0 6px}
.composer{display:flex;flex-direction:column;gap:10px;background:var(--color-surface);border:1px solid var(--color-line-strong);border-radius:var(--radius-input);padding:12px 10px 8px 14px}
.composer:focus-within{border-color:var(--color-action);box-shadow:0 0 0 3px var(--color-action-soft)}
.composer textarea{border:0;outline:0;resize:none;background:none;font:var(--type-ui);font-size:14px;color:var(--color-ink);min-height:20px}
.composer textarea::placeholder{color:var(--color-ink-3)}
.composer-row{display:flex;align-items:center;gap:6px}.composer-row .icon-btn{width:28px;height:28px;margin-left:-6px}
.model{margin-left:auto;display:inline-flex;align-items:center;gap:4px;border:0;background:none;font:var(--type-caption);color:var(--color-ink-2);padding:4px 8px;border-radius:7px;cursor:pointer}.model:hover{background:var(--color-selected)}
.send{width:26px;height:26px;border:0;border-radius:7px;display:grid;place-items:center;background:var(--color-action);color:var(--color-action-ink);cursor:pointer}
.send:disabled{background:var(--color-selected);color:var(--color-ink-3);cursor:default}
```

## Plan panel

The plan panel lists this session's skills in plan order, each with its disc and its homework question, and the final check at the bottom. The current skill has a grey fill. Clicking a card opens the skill on the Skill map.

```html
<aside class="plan">
  <div class="plan-head"><b>This session</b><button class="icon-btn" aria-label="Hide plan">${ic("sidebar")}</button></div>
  <div class="cap">HW24 · due Wed 11:00 · about 90 min</div>
  <a class="plan-card cur"><i class="disc intro"></i><div><b>Half-angle identity</b><span>Integrate sin², cos², cos⁴</span></div>${ic("chev","sm")}</a>
  <a class="plan-card"><i class="disc up"></i><div><b>Off-center circles</b><span>HW Q1</span></div>${ic("chev","sm")}</a>
  <div class="plan-foot">Final check: Q1-3 and Q5-7 in your own work</div>
</aside>
```

```css
.plan{background:var(--color-surface);border:1px solid var(--color-line);border-radius:var(--radius-card);margin:8px 8px 8px 0;padding:14px;display:flex;flex-direction:column;gap:8px;overflow:auto}
.plan-head{display:flex;align-items:center}.plan-head b{font:var(--type-section)}.plan-head .icon-btn{margin-left:auto;width:28px;height:28px}
.plan-card{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--color-line-strong);border-radius:var(--radius-card);color:var(--color-ink);text-decoration:none}
.plan-card:hover{background:var(--color-selected)}
.plan-card b{display:block;font:var(--type-ui-strong)}.plan-card span{font:var(--type-caption);color:var(--color-ink-3)}.plan-card>.ico{margin-left:auto;color:var(--color-ink-3)}
.plan-card.cur{background:var(--color-selected);border-color:var(--color-selected)}
.plan-foot{margin-top:auto;padding-top:8px;border-top:1px solid var(--color-line);font:var(--type-caption);color:var(--color-ink-3)}
```

## Home parts

Home stacks the greeting with the date under it, four count tiles, the recommended action card, This week, and Subjects. Each tile wears the status color of its fact, at the soft tint: coral to repair, amber deadlines, grey reviews, green remembered. The recommended card carries Home's only subject wash and its only filled button.

```html
<h1 class="greeting">Good evening, Edison</h1><div class="cap">Monday 26 October</div>
<div class="count-tiles">
  <div class="count-tile coral"><div class="ct-label">${ic("repair","sm")}To repair</div><div class="ct-value">3</div><div class="ct-note">2 in HW23, due today</div></div>
  <div class="count-tile amber"><div class="ct-label">${ic("end","sm")}Deadlines this week</div><div class="ct-value">4</div><div class="ct-note">Next: CS 124 Quiz 9, tomorrow</div></div>
  <div class="count-tile grey"><div class="ct-label">${ic("review","sm")}Reviews due</div><div class="ct-value">116</div><div class="ct-note">Week 6 of your streak</div></div>
  <div class="count-tile green"><div class="ct-label">${ic("check","sm")}Remembered</div><div class="ct-value">8</div><div class="ct-note">In the last 7 days</div></div>
</div>
<div class="action-card" style="--c:var(--subject-literature)">
  <span class="chip soon">Deadline in 4 days · Fri 30 Oct</span>
  <div class="cap"><span class="tile-icon">${ic("literature")}</span>EALC 275</div>
  <div class="action-title">Quiz 3, Story of the Stone</div>
  <p>Paused at 17:26. Next up: Hsi-feng's two family ties.</p>
  <button class="btn">${ic("resume","sm")}Resume</button>
</div>
<div class="list-card"><div class="list-head">${ic("end","sm")}This week</div>
  <div class="week-row"><span class="day now">Mon</span><span class="tile-icon" style="--c:var(--subject-math)">${ic("math")}</span>HW23<span class="chip now">2 to repair</span></div>
</div>
<div class="subject-card" style="--c:var(--subject-code)"><div class="sc-title"><span class="tile-icon">${ic("code")}</span>CS 124 Quiz 9</div><span class="bar"><i style="width:89%"></i></span><div class="cap">8 of 9 · PQ9 misses review next</div></div>
```

```css
.greeting{font:var(--type-greeting);letter-spacing:var(--tracking-title);margin:0}
.count-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:22px}
.count-tile{--tint:var(--tile-tint);--edge:var(--tile-edge);border-radius:var(--radius-input);padding:12px 14px 13px;background:color-mix(in srgb,var(--t) var(--tint),var(--color-surface));border:1px solid color-mix(in srgb,var(--t) var(--edge),var(--color-surface))}
.count-tile.coral{--t:var(--color-coral);--tx:var(--color-coral-text)}.count-tile.amber{--t:var(--color-amber);--tx:var(--color-amber-text)}
.count-tile.green{--t:var(--color-green);--tx:var(--color-green)}.count-tile.grey{--t:var(--color-ink-3);--tx:var(--color-ink-2);--tint:5%;--edge:14%}
.ct-label{display:flex;align-items:center;gap:6px;font:600 12.5px/16px var(--font-sans);color:var(--tx)}
.ct-value{font:700 32px/36px var(--font-sans);letter-spacing:-.02em;color:var(--color-ink);margin-top:12px;font-variant-numeric:tabular-nums}
.ct-note{font:var(--type-caption);color:var(--color-ink-2);margin-top:2px}
.action-card{padding:18px 20px;border:1px solid var(--color-line-strong);border-radius:var(--radius-card);background:linear-gradient(color-mix(in srgb,var(--c) var(--subject-wash),var(--color-surface)),var(--color-surface) 70%)}
.action-card .cap{display:flex;align-items:center;gap:8px;margin-top:10px}
.action-title{font:var(--type-heading);letter-spacing:var(--tracking-heading);margin-top:2px}
.action-card p{color:var(--color-ink-2);font:var(--type-ui);font-size:13.5px;margin:4px 0 16px}
.list-card{padding:14px 16px;border:1px solid var(--color-line-strong);border-radius:var(--radius-card);background:var(--color-surface)}
.list-head{display:flex;align-items:center;gap:8px;font:var(--type-ui-strong);margin-bottom:6px}.list-head .ico{color:var(--color-ink-3)}
.week-row{display:flex;align-items:center;gap:9px;padding:7px 0;border-top:1px solid var(--color-line);font:var(--type-ui);color:var(--color-ink)}.week-row:first-of-type{border-top:0}
.week-row .chip{margin-left:auto;padding:2px 7px}.day{width:30px;font:var(--type-caption);color:var(--color-ink-3)}.day.now{color:var(--color-ink);font-weight:700}
.subject-card{border:1px solid var(--color-line);border-radius:var(--radius-card);padding:12px 14px;background:var(--color-surface)}
.sc-title{display:flex;gap:8px;align-items:center;font:var(--type-ui-strong)}.subject-card .bar{margin:12px 0 6px}
```

## Badges

Badges are flat seals drawn like the skill discs. The rarer the badge, the louder: Solid stacks small by day, Recovered gets its own row, Goal met sits on the subject's card and is the only one that animates. Words come verbatim from `learn-status.py --rewards`.

```html
<span class="seal-stack"><i class="seal solid">${ic("check")}</i><i class="seal solid">${ic("check")}</i></span>
<i class="seal recovered">${ic("review")}</i>
<i class="seal goal" style="--c:var(--subject-code)">${ic("end")}</i>
```

```css
.seal{border-radius:50%;display:inline-grid;place-items:center;flex:none}.seal .ico{stroke-width:2.2}
.seal.solid{width:var(--seal-solid);height:var(--seal-solid);background:var(--color-gold);box-shadow:inset 0 0 0 1.5px var(--color-gold-edge),0 0 0 2px var(--color-surface);color:var(--color-gold-ink)}.seal.solid .ico{width:13px;height:13px}
.seal.recovered{width:var(--seal-recovered);height:var(--seal-recovered);background:var(--color-green-soft);box-shadow:inset 0 0 0 1.5px var(--color-green),0 0 0 2px var(--color-surface);color:var(--color-green)}.seal.recovered .ico{width:15px;height:15px}
.seal.goal{width:var(--seal-goal);height:var(--seal-goal);background:color-mix(in srgb,var(--c) var(--subject-soft),var(--color-surface));box-shadow:inset 0 0 0 2px var(--c);color:var(--c)}.seal.goal .ico{width:19px;height:19px;stroke-width:2}
.seal.goal.landing{animation:land var(--duration-proof) var(--ease-out)}
@keyframes land{from{opacity:0;transform:scale(.9)}}
.seal-stack{display:flex}.seal-stack .seal+.seal{margin-left:-9px}
```

## Empty state, menu, and switcher

An empty state has a drawn icon, a title, one line on what will appear, and one action. A menu opens with a filter and lists each item's shortcut on the right. The subject switcher is the same menu, opened from the left island.

```html
<div class="empty"><span class="empty-icon">${ic("note")}</span><b>No session note yet</b><span class="cap">The tutor writes one when a session starts, and it fills in here as you go.</span><button class="btn neutral">Start session</button></div>
<div class="menu" role="menu"><input class="menu-filter" placeholder="Filter actions">
  <button class="menu-item hl" role="menuitem">${ic("resume","sm")}Resume<kbd>⌘↩</kbd></button>
  <button class="menu-item" role="menuitem">${ic("checkme","sm")}Check me<kbd>⌘J</kbd></button>
</div>
```

```css
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;padding:22px 18px;max-width:300px}
.empty-icon{width:40px;height:40px;border-radius:10px;border:1.5px dashed var(--color-untaught);display:grid;place-items:center;color:var(--color-ink-3);margin-bottom:6px}.empty-icon .ico{width:20px;height:20px}
.empty b{font:var(--type-section)}.empty .cap{color:var(--color-ink-2);margin-bottom:8px}
.menu{background:var(--color-surface);border:1px solid var(--color-line-strong);border-radius:var(--radius-card);box-shadow:var(--shadow-float);padding:6px;width:260px}
.menu-filter{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--color-line);padding:6px 8px 8px;margin-bottom:4px;font:var(--type-ui);background:none;color:var(--color-ink);outline:0}
.menu-item{display:flex;width:100%;align-items:center;gap:8px;padding:6px 8px;border:0;border-radius:6px;background:none;font:var(--type-ui);color:var(--color-ink);text-align:left;cursor:pointer}
.menu-item .ico{color:var(--color-ink-3)}.menu-item.hl,.menu-item:hover{background:var(--color-selected)}
.menu-item kbd{margin-left:auto;font:var(--type-key);color:var(--color-ink-3)}
```
