#!/usr/bin/env python3
"""Flag labels that collide in a math figure, before the learner sees them.

  svg-check.py <file.svg> [...]    print each collision; exit 1 if any

A figure's labels are placed by coordinates, so two labels set beside the same
point land on top of each other and nothing complains (math241-hw24's triangle
strip, 2026-10-28: "top: y = x" sat on the edge's own "y = x"). This estimates
each label's box from its font size and anchor and reports:

  * two labels whose boxes overlap,
  * a label crossed by a straight line, polyline, rect edge, or straight path
    segment,
  * a label that runs outside the viewBox.

The box is an estimate (average glyph width, no font metrics), so it errs a few
pixels either way. Curved path segments and anything under a transform are
skipped rather than guessed at.
"""

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://www.w3.org/2000/svg}"
WIDTH = {"normal": 0.55, "bold": 0.6}  # average glyph width, in ems
PAD = 1.0  # shrink each box this much, so labels that merely touch pass


def tag(el):
    return el.tag.replace(NS, "")


def class_rules(root):
    """Font size and weight per class, from the figure's <style> block."""
    rules = {}
    for style in root.iter(f"{NS}style"):
        css = re.sub(r"/\*.*?\*/", "", style.text or "", flags=re.S)
        css = re.sub(r"@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}", "", css)  # night colors only
        for selectors, body in re.findall(r"([^{}]+)\{([^}]*)\}", css):
            size = re.search(r"font-size:\s*([\d.]+)", body)
            weight = re.search(r"font-weight:\s*(\w+)", body)
            for sel in selectors.split(","):
                sel = sel.strip()
                if sel.startswith("."):
                    r = rules.setdefault(sel[1:], {})
                    if size:
                        r["size"] = float(size.group(1))
                    if weight:
                        r["bold"] = weight.group(1) in ("bold", "600", "700", "800", "900")
    return rules


def inline(el, prop):
    m = re.search(rf"{prop}:\s*([\w.]+)", el.get("style", ""))
    return m.group(1) if m else el.get(prop)


def text_box(el, rules, root_size):
    words = "".join(el.itertext()).strip()
    if not words:
        return None
    size, bold = root_size, False
    for cls in (el.get("class") or "").split():
        size = rules.get(cls, {}).get("size", size)
        bold = rules.get(cls, {}).get("bold", bold)
    if inline(el, "font-size"):
        size = float(re.sub(r"px$", "", inline(el, "font-size")))
    if inline(el, "font-weight"):
        bold = inline(el, "font-weight") in ("bold", "600", "700", "800", "900")
    x, y = float(el.get("x", 0)), float(el.get("y", 0))
    w = len(words) * size * WIDTH["bold" if bold else "normal"]
    anchor = inline(el, "text-anchor") or "start"
    left = x - (w / 2 if anchor == "middle" else w if anchor == "end" else 0)
    return words, (left, y - 0.75 * size, left + w, y + 0.22 * size)


def segments(el):
    """Straight segments an element draws, as ((x1, y1), (x2, y2))."""
    t = tag(el)
    f = lambda k: float(el.get(k, 0))
    if t == "line":
        return [((f("x1"), f("y1")), (f("x2"), f("y2")))]
    if t == "rect":
        x, y, w, h = f("x"), f("y"), f("width"), f("height")
        c = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        return list(zip(c, c[1:] + c[:1]))
    if t in ("polyline", "polygon"):
        n = [float(v) for v in re.findall(r"-?[\d.]+(?:e-?\d+)?", el.get("points", ""))]
        pts = list(zip(n[::2], n[1::2]))
        if t == "polygon" and pts:
            pts.append(pts[0])
        return list(zip(pts, pts[1:]))
    if t == "path":
        return path_segments(el.get("d", ""))
    return []


def path_segments(d):
    out, cur, start = [], (0.0, 0.0), (0.0, 0.0)
    for cmd, args in re.findall(r"([MmLlHhVvZzCcSsQqTtAa])([^MmLlHhVvZzCcSsQqTtAa]*)", d):
        n = [float(v) for v in re.findall(r"-?[\d.]+(?:e-?\d+)?", args)]
        rel = cmd.islower()
        c = cmd.upper()
        if c == "Z":
            out.append((cur, start))
            cur = start
            continue
        if c in "ML":
            for i in range(0, len(n) - 1, 2):
                p = (cur[0] + n[i], cur[1] + n[i + 1]) if rel else (n[i], n[i + 1])
                if c == "M" and i == 0:
                    start = p
                else:
                    out.append((cur, p))
                cur = p
        elif c == "H":
            for v in n:
                p = (cur[0] + v if rel else v, cur[1])
                out.append((cur, p))
                cur = p
        elif c == "V":
            for v in n:
                p = (cur[0], cur[1] + v if rel else v)
                out.append((cur, p))
                cur = p
        else:  # a curve: skip it, but keep the pen where it ends
            step = {"C": 6, "S": 4, "Q": 4, "T": 2, "A": 7}[c]
            for i in range(0, len(n) - step + 1, step):
                end = (n[i + step - 2], n[i + step - 1])
                cur = (cur[0] + end[0], cur[1] + end[1]) if rel else end
    return out


def crosses(seg, box):
    """Liang-Barsky: does the segment pass through the box's inside?"""
    (x1, y1), (x2, y2) = seg
    l, t, r, b = box[0] + PAD, box[1] + PAD, box[2] - PAD, box[3] - PAD
    dx, dy, lo, hi = x2 - x1, y2 - y1, 0.0, 1.0
    for p, q in ((-dx, x1 - l), (dx, r - x1), (-dy, y1 - t), (dy, b - y1)):
        if p == 0:
            if q < 0:
                return False
        else:
            u = q / p
            if p < 0:
                lo = max(lo, u)
            else:
                hi = min(hi, u)
            if lo > hi:
                return False
    return True


def overlap(a, b):
    return a[0] + PAD < b[2] - PAD and b[0] + PAD < a[2] - PAD and a[1] + PAD < b[3] - PAD and b[1] + PAD < a[3] - PAD


def check(path):
    root = ET.parse(path).getroot()
    rules = class_rules(root)
    root_size = float(re.sub(r"px$", "", root.get("font-size", "16")))
    vb = [float(v) for v in (root.get("viewBox") or "0 0 760 470").replace(",", " ").split()]
    parents = {c: p for p in root.iter() for c in p}

    def transformed(el):
        while el is not None:
            if el.get("transform"):
                return True
            el = parents.get(el)
        return False

    labels, shapes = [], []
    for el in root.iter():
        if tag(el) in ("defs", "marker", "symbol", "clipPath", "mask") or transformed(el):
            continue
        if any(tag(a) in ("defs", "marker", "symbol") for a in iter_ancestors(el, parents)):
            continue
        if tag(el) == "text":
            box = text_box(el, rules, root_size)
            if box:
                labels.append(box)
        elif "paper" not in (el.get("class") or ""):
            shapes.extend(segments(el))

    problems = []
    for i, (wa, a) in enumerate(labels):
        for wb, b in labels[i + 1:]:
            if overlap(a, b):
                problems.append(f'labels overlap: "{wa}" and "{wb}"')
        if a[0] < vb[0] or a[1] < vb[1] or a[2] > vb[0] + vb[2] or a[3] > vb[1] + vb[3]:
            problems.append(f'label runs outside the box: "{wa}"')
        hits = sum(crosses(s, a) for s in shapes)
        if hits:
            problems.append(f'a line crosses label "{wa}"')
    return problems


def iter_ancestors(el, parents):
    el = parents.get(el)
    while el is not None:
        yield el
        el = parents.get(el)


def main(paths):
    bad = 0
    for p in paths:
        try:
            problems = check(Path(p))
        except ET.ParseError as e:
            problems = [f"not valid SVG: {e}"]
        for msg in problems:
            print(f"{p}: {msg}")
        bad += bool(problems)
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
