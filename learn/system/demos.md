# Demos: pictures of the thing itself

A **demo** is a still picture of the concrete thing a lesson is about, drawn the way the learner would meet it: a sign-in screen, a menu, a poster, a page of type, a chart, a form. A diagram (`diagrams.md`) draws the *shape of an idea*; a demo draws the *object*. The `demo-builder` subagent makes them, following this file. The tutor only writes the brief and embeds the result.

The bar: a working designer would accept the demo as a fair picture of the thing, and a teacher would accept it as a fair test of the idea. A demo that looks generated teaches the learner to judge generated things.

## When the tutor asks for one

Ask for a demo whenever a reply would otherwise describe something visual in words: "Version A has a big blue button…", "imagine a page where…", "a chart with three bars…". Reading a description tests reading. A picture tests seeing, which is the skill.

The brief, in this order:

1. **Subject slug** and **file name**: `<slug>-demo-<topic>.svg`, named by topic.
2. **Use**: `teach` (the learner should notice one thing), `check` (the learner judges; nothing may point at the answer), or `diagnose` (a check before teaching).
3. **The point**: the one thing to notice, or for a check, what the rubric rewards and the answer you expect.
4. **The versions** and exactly how they differ. Everything not listed stays identical across versions.
5. **The setting**: device, product, audience. "A phone sign-in for a bank", not "a sign-in screen".

**The picture carries the material; the words around it don't restate it.** A stem that says what the picture shows ("the plate is in 44 pt bold") hands over the answer the picture was meant to test, and says everything twice (Mayer's redundancy principle). The stem asks the question and names nothing the learner should find by looking. The learner sees the picture in the app or in the log in Obsidian, not in the terminal, and that is fine.

Teaching waits for the demo the way it waits for a fact check. First write one line to the learner that names what is being drawn ("Drawing the two sign-in screens for you to compare."), then send the brief, and embed the file when it returns. The wait is one to three minutes; the live log and the app show a *Drawing* line with that time while it lasts, so the learner knows what the pause is for.

## Craft rules

These are the rules the builder applies. Each one comes from how people learn from pictures (Mayer, *Multimedia Learning*; Schwartz and Bransford, "A Time for Telling", 1998) or how good interfaces are drawn (Tufte's data-ink; the platform guidelines of Apple and Material).

### Teach the difference

- **Change only what is taught.** Two versions are a *contrasting case*: the learner notices the feature that differs because everything else holds still. Same copy, same content, same size, same position, except the variable the brief names. A version B that also changes the logo, the title and the button count teaches nothing about any one of them. When the brief asks for a whole-design judgment, every difference must be one the rubric names.
- **One signal, only in `teach`.** Mark the one feature the lesson is about with the template's `key` stroke and one short label beside it. Everything else stays quiet (Mayer's signaling).
- **In `check` and `diagnose`, show without telling.** No arrows, rings, labels or caption that point at a difference or rank the versions. Versions are labeled only `A` and `B`. The caption states the task ("Two sign-in screens for the same bank app"), never the answer. Randomize which version holds the better design. A check whose picture points at its answer produces no evidence.

### Draw the real thing

- **Real content.** Write the words a real product would print: a plausible app name, a real-sounding headline, real field labels, real numbers. Never lorem ipsum, never "Button", never "Title here".
- **Real proportions.** A phone screen is 390 by 844 points, a laptop window about 1440 by 900; scale the whole screen evenly, never squash it. When a whole screen would shrink below legible, crop it to the part the question is about and keep that part at its real scale: the crop is honest, the shrink is not. Use the platform's real sizes: body text 17 pt, secondary 15, footnote 13, a tap target at least 44 pt tall, a filled button about 50 pt tall, side margins 16 to 20 pt. `templates/demo.svg` draws each phone in real points, so these numbers are typed as they are.
- **Real polish.** Each screen has to pass as a screenshot of a shipped app. Use the template's iOS font and system colors (`ui-*` classes). Draw the status bar whole, from the template, or leave it out; a half-drawn one looks fake. A logo is a believable mark, such as the app's initial in a rounded square of its brand color, never a placeholder shape. Lay each screen out the way its designer would have: shared elements line up across the two versions where both screens would naturally put them, and an empty band forced in only to line things up is a flaw.
- **Real hierarchy.** Draw type the way a good designer sets it: one size for the title, one for body, one for secondary text, with a clear step between each. Align everything to one left edge or one center line, and space with a consistent rhythm (multiples of 4 or 8).
- **The thing's own color only when color is the point.** Inside a screen frame, the depicted product may use its own colors when the lesson is about color, emphasis or contrast (the big blue button is the point). Otherwise draw it as a grayscale wireframe. The frame, the `A` / `B` labels and the caption always use the template's ink classes, so the vault's own color jobs stay intact.
- **A screen keeps its own mode.** A depicted light-mode screen stays light at night; it is an object, like a photo. Only the frame, labels and caption follow night mode.

### Leave out everything else

- Every mark is either part of the depicted thing or the one teaching signal. Cut the rest: gradients, glows, drop shadows on the frame, decorative icons, emoji, illustrated people, background blobs, accent colors that carry no fact. Draw a phone as the template's thin outline. A heavy frame or a detailed bezel competes with the screen.
- **No background.** A demo has no paper or plate behind it: it sits on whatever the lesson is shown on, the app's glass or an Obsidian note, and its ink labels follow that surface's light or night. Only the depicted screens are solid.
- Icons inside the depicted UI are simple geometric glyphs (a lock, an eye, a back chevron) drawn in two or three strokes, only where a real product would have one.

### Fit the card

- `viewBox` 760 wide, 470 to 560 tall. Two versions sit side by side at the same scale, tops aligned, with the `A` and `B` labels above them in `label-key`. `templates/demo.svg` has this layout for two phones.
- The app shows a demo at the card's width, about 575 px in a 1400 px window and up to 760 px in a wide one. At the template's scale, iOS's 17 pt body reads at about 11 px at the narrowest, the size of fine print in a real app. So nothing on a screen goes below 13 pt (the footnote size), and labels and the caption stay at the template's sizes.
- One caption line at the bottom, in `label-2`.

## Building it

1. For phone screens, start from `learn/system/templates/demo.svg`. For anything else (a chart, a poster, a page), start from `learn/system/templates/figure.svg` and delete its `paper` rect. Keep the template's style block and classes for the labels and caption; the depicted thing may add its own classes there.
2. Write it to `learn/subjects/<slug>/figures/<file name>`.
3. **Look at it.** Run `python3 .claude/hooks/look-figure.py <file>`. It checks the XML (a malformed SVG shows as a broken image) and prints the path of a PNG render, padded to a square; read that PNG. Judge it at full size as the harshest art director you know: the composition first, then the hierarchy, then the details.
4. Go through the **done list** below. Fix what fails and look again. Three rounds at most; if something still fails, say what in the report.

## Done list

The demo is done when every line is true:

- The versions differ in exactly what the brief names, and in nothing else.
- In `check` or `diagnose`: nothing on the picture points at, labels or ranks the answer.
- In `teach`: exactly one feature carries the `key` signal.
- Every word on the depicted thing is something a real product would print.
- Proportions, sizes and spacing match the real device.
- No gradient, glow, shadow, decorative icon or meaningless color.
- Each screen would pass as a screenshot of a shipped app: real font, whole status bar or none, a believable logo, no empty band.
- Nothing on a screen is under 13 pt, and there is no background rect.
- `look-figure.py` prints `xml ok`, and its PNG shows every label inside the box.

## What the builder returns

Three lines, nothing else: the embed line (`![[<file name>]]`), one sentence stating exactly how the versions differ (the tutor's rubric depends on it), and either "Looked at the render; every done-list line holds." or the done-list lines that still fail (and "No render" if `look-figure.py` could not make one). The tutor trusts that line and does not render the file again.
