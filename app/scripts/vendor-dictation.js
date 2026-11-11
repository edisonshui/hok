// Copies dictation's speech engine into the app (lib/dictation.js): Transformers.js (Apache 2.0) and the ONNX Runtime
// WebAssembly build it runs on (MIT). Only these three browser files ship; the packages themselves are build tools
// (devDependencies), so their Node parts (about 300 MB) never reach the app. Runs after npm install.
const fs = require("fs"), path = require("path");
const nm = path.join(__dirname, "..", "node_modules"), out = path.join(__dirname, "..", "renderer", "vendor", "dictation");
const files = [
  ["@huggingface/transformers/dist/transformers.min.js", "transformers.min.js"],
  // the build Transformers.js 4.3 asks for, on WebGPU and on the CPU alike (11 Nov: the jsep pair was not it)
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.mjs"],
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.asyncify.wasm"],
  ["@huggingface/transformers/LICENSE", "LICENSE-transformers.txt"],
];
// licences travel with the files; ONNX Runtime's package carries its MIT licence in package.json only
const notices = [["@huggingface/transformers/LICENSE", "LICENSE-transformers.txt"]];
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
let missing = 0;
for (const [from, to] of files) {
  const src = path.join(nm, from);
  if (!fs.existsSync(src)) { console.warn(`vendor-dictation: missing ${from}`); missing++; continue; }
  fs.copyFileSync(src, path.join(out, to));
}
for (const [from, to] of notices) { const src = path.join(nm, from); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, to)); }
fs.writeFileSync(path.join(out, "LICENSE-onnxruntime.txt"), "ONNX Runtime Web (onnxruntime-web), Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/onnxruntime/blob/main/LICENSE\n");
console.log(missing ? `vendor-dictation: ${missing} missing, dictation will not work` : "vendor-dictation: speech engine copied to renderer/vendor/dictation");
