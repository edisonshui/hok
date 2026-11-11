// Markdown, enough for the tutor's replies and session notes, plus math and
// diagrams. KaTeX and Mermaid are 3 MB, so they load the first time a page needs them.
(() => {
"use strict";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(t) {
  let h = esc(t);
  const codes = [];
  h = h.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  h = h.replace(/!\[\[([^\]|]+?\.(?:png|jpe?g|gif|webp|svg))(?:\|\d+)?\]\]/gi, (_, p) => {
    const name = p.replace(/&amp;/g, "&").split("/").pop(), svg = /\.svg$/i.test(name);
    // A demo (learn/system/demos.md: a picture of the thing itself, a screen or a page) is drawn to be read at the card's
    // full width; a math figure keeps its narrower measure.
    const demo = svg && /-demo-/.test(name);
    return `<img class="${svg ? `figure${demo ? " demo" : ""}` : "shot"}" alt="${demo ? "Demo" : svg ? "Figure" : "Screenshot you sent"}" src="vault-file:///${encodeURIComponent(name)}">`;
  });
  h = h.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "<span>$2</span>")
    .replace(/\[\[([^\]]+)\]\]/g, (_, p) => `<span>${p.split("/").pop()}</span>`)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a class="lnk" data-href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<i>$2</i>");
  return h.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${codes[n]}</code>`);
}

function codeBlock(lang, code) {
  lang = (lang || "").toLowerCase().trim();
  if (lang === "mermaid") return `<div class="codeblock"><div class="mermaid" data-src="${esc(code)}">${esc(code)}</div></div>`;
  return `<div class="codeblock"><button class="copy" data-act="copy-code">Copy</button><pre data-lang="${esc(lang)}">${esc(code)}</pre></div>`;
}

function renderMd(src) {
  const L = String(src || "").replace(/\r/g, "").split("\n"), out = [];
  let i = 0;
  const isBlock = (l) => /^```|^\|.*\|\s*$|^#{1,6} |^\s*([-*]|\d+\.) |^> |^\$\$|^---\s*$/.test(l);
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) {
      const lang = l.slice(3).trim(), b = [];
      i++;
      while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]);
      i++;
      out.push(codeBlock(lang, b.join("\n")));
      continue;
    }
    if (/^\$\$/.test(l.trim())) {
      const b = [l];
      if (!/^\$\$.+\$\$$/.test(l.trim())) { i++; while (i < L.length && !/\$\$\s*$/.test(L[i])) b.push(L[i++]); b.push(L[i] || ""); }
      i++;
      out.push(`<p class="math">${esc(b.join("\n"))}</p>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l)) {
      const rows = [];
      while (i < L.length && /^\|.*\|\s*$/.test(L[i])) rows.push(L[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
      const sep = (r) => /^\|[\s:|-]+\|$/.test((r || "").trim());
      const head = rows.length > 1 && sep(rows[1]);
      const body = rows.filter((r) => !sep(r));
      out.push(`<table class="mdtable">${body.map((r, n) => `<tr>${cells(r).map((c) => (n === 0 && head ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    if (/^#{1,6} /.test(l)) { out.push(`<h5>${inline(l.replace(/^#+ /, ""))}</h5>`); i++; continue; }
    if (/^---\s*$/.test(l)) { out.push(`<div class="hr" style="margin:12px 0"></div>`); i++; continue; }
    if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordered = /^\s*\d+\./.test(l), items = [];
      const start = ordered ? parseInt(l.trim(), 10) : 1;
      while (i < L.length && (/^\s*([-*]|\d+\.) /.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) {
        if (/^\s*([-*]|\d+\.) /.test(L[i]) && !/^\s{2,}/.test(L[i])) items.push(L[i].replace(/^\s*([-*]|\d+\.) /, ""));
        else items[items.length - 1] += "\n" + L[i].trim();
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${items.map((x) => `<li>${x.split("\n").map(inline).join("<br>")}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (/^>/.test(l)) {
      const b = [];
      while (i < L.length && /^>/.test(L[i])) b.push(L[i++].replace(/^> ?/, ""));
      const callout = b[0] && b[0].match(/^\[!(\w+)\][+-]?\s*(.*)$/);
      if (callout) b[0] = callout[2] ? `**${callout[2]}**` : "";
      out.push(`<div class="quote">${renderMd(b.join("\n"))}</div>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const b = [];
    while (i < L.length && L[i].trim() && !isBlock(L[i])) b.push(L[i++]);
    out.push(`<p>${b.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}

// ---------- math and diagrams ----------
let libs = null;
function loadLibs() {
  if (libs) return libs;
  const add = (tag, attrs) => new Promise((ok) => {
    const el = Object.assign(document.createElement(tag), attrs, { onload: ok, onerror: ok });
    document.head.append(el);
  });
  libs = Promise.all([
    add("link", { rel: "stylesheet", href: "../node_modules/katex/dist/katex.min.css" }),
    add("script", { src: "../node_modules/katex/dist/katex.min.js" })
      .then(() => add("script", { src: "../node_modules/katex/dist/contrib/auto-render.min.js" })),
    add("script", { src: "../node_modules/mermaid/dist/mermaid.min.js" }),
  ]);
  return libs;
}

const needsLibs = (el) => /\$|\\\(/.test(el.textContent) || el.querySelector(".mermaid");
let mermaidTheme = "";
let mermaidSeq = 0;
// onMath runs the moment the math is drawn, before any diagram, so a reply's words
// can be taken apart for their arrival in the same task as the markup changed.
async function typeset(el, onMath) {
  if (!el || !needsLibs(el)) { if (el && onMath) onMath(); return; }
  await loadLibs();
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }],
      throwOnError: false,
      ignoredClasses: ["codeblock", "mermaid"],
    });
  }
  if (onMath) onMath();
  const diagrams = [...el.querySelectorAll(".mermaid:not([data-done])")];
  if (window.mermaid && diagrams.length) {
    const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
    const theme = document.documentElement.dataset.theme || "light";
    if (mermaidTheme !== theme) {
      mermaidTheme = theme;
      window.mermaid.initialize({
        startOnLoad: false, theme: "base", securityLevel: "strict",
        themeVariables: {
          fontFamily: "IBM Plex Sans", fontSize: "13px",
          primaryColor: v("--color-surface"), primaryBorderColor: v("--color-line-strong"), primaryTextColor: v("--color-ink"),
          lineColor: v("--color-ink-3"), secondaryColor: v("--color-side"), tertiaryColor: v("--color-bg"),
          noteBkgColor: v("--color-side"), noteTextColor: v("--color-ink"), actorBkg: v("--color-surface"), actorBorder: v("--color-line-strong"),
        },
      });
    }
    for (const d of diagrams) {
      d.dataset.done = "1";
      try {
        const { svg } = await window.mermaid.render(`mm${++mermaidSeq}`, d.dataset.src);
        d.innerHTML = svg;
      } catch {
        // A diagram still streaming in, or one the tutor wrote wrong: show its source.
        d.outerHTML = `<pre>${esc(d.dataset.src)}</pre>`;
      }
    }
  }
}

window.MD = { esc, inline, renderMd, typeset, preload: loadLibs };
})();
