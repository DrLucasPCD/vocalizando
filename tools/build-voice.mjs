import { build } from "esbuild";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vendor = join(root, "vendor", "voice");
const piperPackage = join(root, "node_modules", "@mintplex-labs", "piper-tts-web", "dist");
const phonemizer = join(root, "node_modules", "@diffusionstudio", "piper-wasm", "build");
const onnx = join(root, "node_modules", "onnxruntime-web", "dist");

await mkdir(vendor, { recursive: true });
await build({
  entryPoints: [join(root, "voice-runtime.js")],
  bundle: true,
  format: "esm",
  splitting: true,
  platform: "browser",
  target: ["safari15.4", "chrome100"],
  outdir: vendor,
  entryNames: "voice-runtime",
  chunkNames: "chunk-[hash]",
  minify: true,
  plugins: [{
    name: "local-piper-model",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^(fs|path)$/ }, args => ({ path: args.path, namespace: "node-stub" }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({ contents: "export default {};", loader: "js" }));
      pluginBuild.onLoad({ filter: /piper-tts-web\/dist\/piper-tts-web\.js$/ }, async args => {
        let contents = await readFile(args.path, "utf8");
        for (const [before, after] of [
          ["https://huggingface.co/diffusionstudio/piper-voices/resolve/main", "/models/piper-faber"],
          ["pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx", "model.onnx"],
          ["https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/", "/vendor/voice/"],
          ["https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize", "/vendor/voice/piper_phonemize"],
          ["https://huggingface.co", "/models/piper-faber/"],
          ["ort.env.wasm.numThreads = navigator.hardwareConcurrency;", "ort.env.wasm.numThreads = 1;"],
        ]) {
          if (!contents.includes(before)) throw new Error(`Piper dependency changed: ${before}`);
          contents = contents.replaceAll(before, after);
        }
        return { contents, loader: "js", resolveDir: piperPackage };
      });
    },
  }],
});

for (const name of ["piper_phonemize.data", "piper_phonemize.wasm"]) {
  await copyFile(join(phonemizer, name), join(vendor, name));
}
for (const name of ["ort-wasm-simd.wasm", "ort-wasm.wasm"]) {
  await copyFile(join(onnx, name), join(vendor, name));
}
