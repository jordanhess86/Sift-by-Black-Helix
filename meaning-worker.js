// Runs the AI model away from the page, so the page stays responsive. The model and
// its runtime are files inside this extension, and remote loading is switched off.
// The extension's security policy also blocks every outside address.
import { env, pipeline } from "./vendor/transformers/transformers.min.js";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL("./models/", self.location.href).href;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/transformers/", self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;

const MODEL = "all-MiniLM-L6-v2";
const VECTOR_SIZE = 384;
let modelPromise = null;

self.addEventListener("message", async ({ data: { id, texts } }) => {
  try {
    modelPromise ??= pipeline("feature-extraction", MODEL, { dtype: "q8", device: "wasm" });
    const model = await modelPromise;
    const vectors = new Float32Array(texts.length * VECTOR_SIZE);
    for (const [position, text] of texts.entries()) {
      const output = await model(text, { pooling: "mean", normalize: true });
      vectors.set(output.data, position * VECTOR_SIZE);
    }
    self.postMessage({ id, vectors }, [vectors.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error?.message || "unknown error" });
  }
});
