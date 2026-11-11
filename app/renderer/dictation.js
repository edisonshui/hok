// Dictation (11 Nov 2026): the microphone button beside every field you type to the tutor in (Home's field, a
// session's composer, a question's box), and ⌘D / Ctrl+Shift+D. Press to talk, press again (or Return) to write
// what you said where the caret is; Esc throws it away. The speech becomes text on this computer
// (dictate-worker.js, lib/dictation.js). The first press asks to download the speech model once.
(function () {
  const F = window.flash;
  if (!F || !F.dictation) { window.Dictate = { toggle() {}, active: () => false }; return; }
  const MAX_SECONDS = 180;   // a dictation stops itself after three minutes
  let kind = null;           // "gpu" or "cpu": which encoder this computer runs (lib/dictation.js)
  let worker = null, seq = 0;
  const waits = new Map();
  let rec = null;            // the recording in progress: { btn, target, range, chunks, stream, ctx, timer }
  let busyBtn = null;

  async function whichKind() {
    if (kind) return kind;
    try { kind = navigator.gpu && (await navigator.gpu.requestAdapter()) ? "gpu" : "cpu"; } catch { kind = "cpu"; }
    return kind;
  }
  function ask(msg, transfer) {
    if (!worker) {
      worker = new Worker(new URL("dictate-worker.js", location.href), { type: "module" });
      worker.onmessage = ({ data }) => { const w = waits.get(data.id); if (!w) return; waits.delete(data.id); data.type === "error" ? w.reject(new Error(data.error)) : w.resolve(data); };
      worker.onerror = (e) => { for (const w of waits.values()) w.reject(new Error(e.message || "The speech worker stopped")); waits.clear(); worker = null; };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => { waits.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }, transfer || []); });
  }
  const device = () => (kind === "gpu" ? "webgpu" : "wasm");
  const say = (t) => (window.toast ? window.toast(t) : console.log(t));
  const mb = (b) => `${Math.max(1, Math.round(b / 1e6))} MB`;

  // ---- the first press: get the model ----
  function offerDownload(st) {
    return new Promise((resolve) => {
      const scrim = document.getElementById("scrim");
      scrim.innerHTML = `<div class="card float quit-card dict-card" role="dialog" aria-labelledby="dictQ"><div class="qc-h" id="dictQ">Turn on dictation?</div>
        <p class="qc-p">Dictation turns your voice into text on this computer, with Whisper, an open-source speech model. It downloads once, ${mb(st.need)}. Your voice is never sent anywhere.</p>
        <div class="dict-prog" hidden><i><b></b></i><span>Starting…</span></div>
        <div class="qc-b"><button class="btn text" data-dict="no">Not now</button><button class="btn" data-dict="yes">Download</button></div></div>`;
      scrim.classList.add("on", "veil");
      const card = scrim.querySelector(".dict-card"), yes = card.querySelector('[data-dict="yes"]'), no = card.querySelector('[data-dict="no"]'), prog = card.querySelector(".dict-prog");
      let going = false, off = null, closed = false;
      const outside = (e) => { if (e.target === scrim) { if (going) F.dictation.stop(); close(false); } };
      const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); if (going) F.dictation.stop(); close(false); } };
      const close = (ok) => { if (closed) return; closed = true; if (off) off(); scrim.removeEventListener("mousedown", outside); document.removeEventListener("keydown", esc, true); scrim.classList.remove("on", "veil"); scrim.innerHTML = ""; resolve(ok); };
      scrim.addEventListener("mousedown", outside); document.addEventListener("keydown", esc, true);
      card.addEventListener("click", (e) => e.stopPropagation());
      no.addEventListener("click", () => { if (going) F.dictation.stop(); close(false); });
      yes.addEventListener("click", async () => {
        if (going) return; going = true;
        yes.disabled = true; no.textContent = "Cancel"; prog.hidden = false;
        off = F.dictation.onProgress((p) => { prog.querySelector("b").style.width = `${Math.round((p.done / p.total) * 100)}%`; prog.querySelector("span").textContent = `${mb(p.done)} of ${mb(p.total)}`; });
        const r = await F.dictation.download(kind);
        if (r && r.error) { if (r.error !== "stopped") { prog.querySelector("span").textContent = r.error; yes.disabled = false; yes.textContent = "Try again"; going = false; } return; }
        close(true);
      });
      yes.focus({ preventScroll: true });
    });
  }

  // ---- listening ----
  function saveRange(target) {
    if (target.isContentEditable) { const s = getSelection(); return s.rangeCount && target.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; }
    return { start: target.selectionStart ?? target.value.length, end: target.selectionEnd ?? target.value.length };
  }
  async function start(btn, target) {
    await whichKind();
    let st = await F.dictation.status(kind);
    if (!st.ready) { if (!(await offerDownload(st))) return; st = await F.dictation.status(kind); if (!st.ready) return; }
    if (!(await F.dictation.mic())) { say("The app can't use the microphone. Allow it in System Settings, Privacy & Security, Microphone."); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch { say("No microphone was found, or the app isn't allowed to use it."); return; }
    ask({ type: "load", device: device() }).catch(() => {});   // the model loads while you talk
    const ctx = new AudioContext({ sampleRate: 16000 }), src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1), chunks = [];
    node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
      let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] * d[i];
      btn.style.setProperty("--lvl", Math.min(1, Math.sqrt(s / (d.length / 16)) * 6).toFixed(2));
    };
    src.connect(node); node.connect(ctx.destination);
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    rec = { btn, target, range: saveRange(target), chunks, stream, ctx, node, timer: setTimeout(() => stop(true), MAX_SECONDS * 1000) };
    btn.classList.add("rec"); btn.setAttribute("aria-label", "Stop dictating"); btn.setAttribute("aria-pressed", "true");
    // the field says it is listening, in place of its usual hint (11 Nov: Edison asked to always see what is happening)
    const ph = target.isContentEditable ? "data-placeholder" : "placeholder";
    rec.hint = [ph, target.getAttribute(ph)]; target.setAttribute(ph, "Listening… press Return to write it in, Esc to cancel");
    document.addEventListener("keydown", keys, true);
  }
  function keys(e) {
    if (!rec) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(false); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); stop(true); }   // Return writes it in; it never sends
  }
  async function stop(keep) {
    const r = rec; if (!r) return; rec = null;
    clearTimeout(r.timer); document.removeEventListener("keydown", keys, true);
    r.node.disconnect(); r.stream.getTracks().forEach((t) => t.stop()); r.ctx.close().catch(() => {});
    if (r.hint && r.hint[1] != null) r.target.setAttribute(r.hint[0], r.hint[1]);
    r.btn.classList.remove("rec"); r.btn.style.removeProperty("--lvl"); r.btn.setAttribute("aria-label", "Dictate"); r.btn.removeAttribute("aria-pressed");
    if (!keep) return;
    const n = r.chunks.reduce((a, c) => a + c.length, 0);
    if (n < 16000 * 0.4) return;   // under half a second: nothing said
    const audio = new Float32Array(n); let o = 0; for (const c of r.chunks) { audio.set(c, o); o += c.length; }
    busyBtn = r.btn; r.btn.classList.add("busy");
    try {
      const lang = window.Dictate.lang === "auto" ? null : "en";   // Settings' Dictation language (app.js sets it)
      const { text } = await ask({ type: "run", device: device(), audio, language: lang }, [audio.buffer]);
      if (text && !/^\[.*\]$|^\(.*\)$/.test(text)) write(r, text);   // Whisper's "[BLANK_AUDIO]" and "(music)" are not words
    } catch (e) { say(`Dictation stopped: ${e.message}`); }
    finally { r.btn.classList.remove("busy"); busyBtn = null; }
  }
  // the words go where the caret was when you started, as typing would put them (so the field's own handlers run)
  function write(r, text) {
    const t = r.target; if (!t.isConnected) return;
    t.focus({ preventScroll: true });
    let before = "";
    if (t.isContentEditable) {
      const s = getSelection();
      if (r.range) { s.removeAllRanges(); s.addRange(r.range); } else { const g = document.createRange(); g.selectNodeContents(t); g.collapse(false); s.removeAllRanges(); s.addRange(g); }
      const g2 = s.getRangeAt(0).cloneRange(); g2.setStart(t, 0); before = g2.toString();
    } else {
      t.setSelectionRange(r.range.start, r.range.end); before = t.value.slice(0, r.range.start);
    }
    const lead = before && !/\s$/.test(before) ? " " : "";
    document.execCommand("insertText", false, lead + text);
  }

  async function toggle(btn, target) {
    if (busyBtn) return;
    if (rec) return stop(true);
    if (!target) return;
    try { await start(btn, target); } catch (e) { say(`Dictation couldn't start: ${e.message}`); }
  }
  window.Dictate = {
    toggle,
    lang: "en",
    active: () => !!rec,
    // Settings: what is on this computer, and taking it off
    status: async () => { await whichKind(); return { ...(await F.dictation.status(kind)), kind }; },
    remove: async () => { await whichKind(); if (worker) { worker.terminate(); worker = null; } return F.dictation.remove(kind); },
  };
})();
