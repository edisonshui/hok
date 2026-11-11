// Dictation's speech worker (lib/dictation.js): Whisper, run by Transformers.js on this computer, off the page's
// thread so the window never stalls while it listens or writes. The model is read from dict-file:, never fetched.
import { pipeline, env } from "./vendor/dictation/transformers.min.js";
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.localModelPath = "dict-file://m/";
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/dictation/", import.meta.url).href;
if (!self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = 1;   // threads need an isolated page; one is enough here

let asr = null, loading = null, loadedFor = null;
function load(device) {
  if (loading && loadedFor === device) return loading;
  loadedFor = device;
  loading = pipeline("automatic-speech-recognition", "onnx-community/whisper-base", { device, dtype: { encoder_model: device === "webgpu" ? "fp32" : "q8", decoder_model_merged: "q8" } })
    .then((p) => (asr = p))
    .catch((e) => { loading = null; throw e; });
  return loading;
}
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "load") { await load(m.device); self.postMessage({ type: "loaded", id: m.id }); return; }
    if (m.type === "run") {
      await load(m.device);
      const r = await asr(m.audio, { language: m.language || null, task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
      self.postMessage({ type: "text", id: m.id, text: String(r.text || "").trim() });
    }
  } catch (e) { self.postMessage({ type: "error", id: m.id, error: String((e && e.message) || e) }); }
};
