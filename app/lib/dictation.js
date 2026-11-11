// Dictation's speech model (11 Nov 2026, Edison: "a way for people to use dictation... open source and not require
// extra plugins"). Speech is turned into text on this computer by Whisper (OpenAI's open speech model, MIT licence),
// run by Transformers.js (Apache 2.0), whose files ship inside the app (scripts/vendor-dictation.js). Only the model
// is downloaded, once, the first time someone dictates: from Hugging Face, at one fixed revision, and every file is
// checked against its SHA-256 before it is used. The voice itself never leaves the computer.
//
// Two encoders: the full one where the graphics chip can run it (WebGPU: 5 s of speech in 0.8 s, measured 11 Nov on
// an Apple-chip Mac) and the compressed one elsewhere (2.0 s). The decoder is the compressed one everywhere.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MODEL = "onnx-community/whisper-base";
const REV = "27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c";
const COMMON = [
  ["config.json", 2243, "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b"],
  ["generation_config.json", 3832, "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0"],
  ["preprocessor_config.json", 339, "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"],
  ["tokenizer.json", 2480466, "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"],
  ["tokenizer_config.json", 282682, "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573"],
  ["onnx/decoder_model_merged_quantized.onnx", 53693315, "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b"],
];
const ENCODER = {
  gpu: ["onnx/encoder_model.onnx", 82468078, "a9f3b752833b49e880dec91ee5b6d936112be7c3ea07c221024ba493439f46fe"],
  cpu: ["onnx/encoder_model_quantized.onnx", 23201314, "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46"],
};

function make({ net, userData, onProgress }) {
  const ROOT = path.join(userData, "dictation");
  const DIR = path.join(ROOT, ...MODEL.split("/"));
  const list = (kind) => [...COMMON, ENCODER[kind === "gpu" ? "gpu" : "cpu"]];
  const have = ([f, size]) => { try { return fs.statSync(path.join(DIR, f)).size === size; } catch { return false; } };
  const bytesOf = (files) => files.reduce((n, [, s]) => n + s, 0);
  function status(kind) {
    const files = list(kind), kept = files.filter(have);
    let onDisk = 0; try { for (const f of walk(ROOT)) onDisk += fs.statSync(f).size; } catch { /* nothing there */ }
    return { ready: kept.length === files.length, need: bytesOf(files.filter((f) => !have(f))), total: bytesOf(files), onDisk, downloading: !!job };
  }
  function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }

  let job = null;
  // One download at a time; a second ask waits for the first. Progress goes out as { done, total } in bytes.
  function download(kind) {
    if (job) return job;
    const files = list(kind).filter((f) => !have(f)), total = bytesOf(files);
    let done = 0, stopped = false;
    job = (async () => {
      for (const [f, size, sha] of files) {
        if (stopped) throw new Error("stopped");
        const out = path.join(DIR, f), part = out + ".part";
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const res = await net.fetch(`https://huggingface.co/${MODEL}/resolve/${REV}/${f}`);
        if (!res.ok || !res.body) throw new Error(`Hugging Face answered ${res.status} for ${f}`);
        const hash = crypto.createHash("sha256"), fd = fs.openSync(part, "w");
        try {
          const reader = res.body.getReader();
          for (;;) {
            const { value, done: end } = await reader.read();
            if (end) break;
            if (stopped) { reader.cancel().catch(() => {}); throw new Error("stopped"); }
            fs.writeSync(fd, value); hash.update(value); done += value.length;
            onProgress({ done, total });
          }
        } finally { fs.closeSync(fd); }
        if (hash.digest("hex") !== sha || fs.statSync(part).size !== size) { fs.rmSync(part, { force: true }); throw new Error(`${f} did not match its checksum`); }
        fs.renameSync(part, out);
      }
      return status(kind);
    })().finally(() => { job = null; });
    job.stop = () => { stopped = true; };
    return job;
  }
  const stop = () => { if (job && job.stop) job.stop(); };
  function remove() { stop(); fs.rmSync(ROOT, { recursive: true, force: true }); }

  // dict-file://m/<model>/<file>: only the model's own files, from the folder above, with the header the speech
  // worker's fetch needs.
  const allowed = new Set([...COMMON, ENCODER.gpu, ENCODER.cpu].map(([f]) => `${MODEL}/${f}`));
  function serve(request) {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const file = path.join(ROOT, ...rel.split("/"));
    if (!allowed.has(rel) || !fs.existsSync(file)) return new Response("not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    return new Response(fs.readFileSync(file), { headers: { "Content-Type": rel.endsWith(".json") ? "application/json" : "application/octet-stream", "Access-Control-Allow-Origin": "*" } });
  }

  return { status, download, stop, remove, serve };
}

module.exports = { make, MODEL };
