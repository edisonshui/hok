#!/usr/bin/env python3
"""Check an SVG figure or demo and render it to a PNG, so whoever drew it can look at it before the learner does.

    python3 .claude/hooks/look-figure.py <file.svg>

Prints `xml ok` and the path of a PNG (Quick Look's render, padded to a square, light mode), or the XML error and
exit 1. One command, so the vault's settings can allow it and drawing never stops on a permission prompt. The PNG goes
to .claude/figure-looks/ (git-ignored, inside the vault so reading it back needs no prompt either), replacing the
last look at the same file. Rules for figures and demos: learn/system/diagrams.md,
learn/system/demos.md.
"""
import os
import subprocess
import sys


def look(svg):
    if not svg.endswith(".svg") or not os.path.isfile(svg):
        return 2, f"not an SVG file: {svg}"
    xml = subprocess.run(["xmllint", "--noout", svg], capture_output=True, text=True)
    if xml.returncode != 0:
        return 1, (xml.stderr or xml.stdout).strip()
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "figure-looks")
    os.makedirs(out, exist_ok=True)
    stale = os.path.join(out, os.path.basename(svg) + ".png")
    if os.path.exists(stale):
        os.remove(stale)
    try:
        subprocess.run(["qlmanage", "-t", "-s", "1520", "-o", out, svg], capture_output=True, timeout=45)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return 0, "xml ok\nno render: Quick Look (qlmanage) is missing or timed out; read the file's code instead"
    png = os.path.join(out, os.path.basename(svg) + ".png")
    if not os.path.isfile(png):
        return 0, "xml ok\nno render: Quick Look made no PNG; read the file's code instead"
    return 0, f"xml ok\n{png}"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__.strip().split("\n\n")[1].strip())
        sys.exit(2)
    code, text = look(sys.argv[1])
    print(text)
    sys.exit(code)
