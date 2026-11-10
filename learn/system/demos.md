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

Teaching waits for the demo the way it waits for a fact check: send the brief, say one line to the learner ("Drawing the two screens."), and embed the file when it returns.

## Craft rules

These are the rules the builder applies. Each one comes from how people learn from pictures (Mayer, *Multimedia Learning*; Schwartz and Bransford, "A Time for Telling", 1998) or how good interfaces are drawn (Tufte's data-ink; the platform guidelines of Apple and Material).

### Teach the difference

- **Change only what is taught.** Two versions are a *contrasting case*: the learner notices the feature that differs because everything else holds still. Same copy, same content, same size, same position, except the variable the brief names. A version B that also changes the logo, the title and the button count teaches nothing about any one of them. When the brief asks for a whole-design judgment, every difference must be one the rubric names.
- **One signal, only in `teach`.** Mark the one feature the lesson is about with the template's `key` stroke and one short label beside it. Everything else stays quiet (Mayer's signaling).
- **In `check` and `diagnose`, show without telling.** No arrows, rings, labels or caption that point at a difference or rank the versions. Versions are labeled only `A` and `B`. The caption states the task ("Two sign-in screens for the same bank app"), never the answer. Randomize which version holds the better design. A check whose picture points at its answer produces no evidence.

### Draw the real thing

- **Real content.** Write the words a real product would print: a plausible app name, a real-sounding headline, real field labels, real numbers. Never lorem ipsum, never "Button", never "Title here".
- **Real proportions.** A phone screen is 390 by 844 points, a laptop window about 1440 by 900; scale the whole screen evenly, never squash it. When a whole screen would shrink below legible, crop it to the part the question is about and keep that part at its real scale: the crop is honest, the shrink is not. Use the platform's real sizes in proportion: body text 15 to 17 pt, a tap target at least 44 pt tall, margins 16 to 24 pt.
- **Real hierarchy.** Draw type the way a good designer sets it: one size for the title, one for body, one for secondary text, with a clear step between each. Align everything to one left edge or one center line, and space with a consistent rhythm (multiples of 4 or 8).
- **The thing's own color only when color is the point.** Inside a screen frame, the depicted product may use its own colors when the lesson is about color, emphasis or contrast (the big blue button is the point). Otherwise draw it as a grayscale wireframe. The frame, the `A` / `B` labels and the caption always use the template's ink classes, so the vault's own color jobs stay intact.
- **A screen keeps its own mode.** A depicted light-mode screen stays light at night; it is an object, like a photo. Only the frame, labels and caption follow night mode.

### Leave out everything else

- Every mark is either part of the depicted thing or the one teaching signal. Cut the rest: gradients, glows, drop shadows on the frame, decorative icons, emoji, illustrated people, background blobs, accent colors that carry no fact. Draw a phone as a plain rounded rectangle with a thin `other` stroke. A heavy frame or a detailed bezel competes with the screen.
- Icons inside the depicted UI are simple geometric glyphs (a lock, an eye, a back chevron) drawn in two or three strokes, only where a real product would have one.

### Fit the card

- `viewBox` 760 wide, 470 to 560 tall. Two versions sit side by side at the same scale, tops aligned, with the `A` and `B` labels above them in `label-key`.
- The app shows a demo at the card's width, which is only about 575 px in a 1400 px window (up to 760 px in a wide one), so the picture shrinks to three quarters of its viewBox. Every word on it is at least 15 px in the viewBox, the depicted screen's smallest text included; size the screen up or crop it before shrinking a word below that. Only true texture (a fine-print footer nobody reads) may be smaller.
- One caption line at the bottom, in `label-2`.

## Building it

1. Start from `learn/system/templates/figure.svg` and keep its style block and classes for the frame, labels and caption. The depicted UI may add its own classes in the same style block.
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
- Every word is at least 15 px in the viewBox, so it stays legible at 575 px wide.
- `look-figure.py` prints `xml ok`, and its PNG shows every label inside the box.

## What the builder returns

Three lines, nothing else: the embed line (`![[<file name>]]`), one sentence stating exactly how the versions differ (the tutor's rubric depends on it), and either "Looked at the render; every done-list line holds." or the done-list lines that still fail (and "No render" if `look-figure.py` could not make one). The tutor trusts that line and does not render the file again.
