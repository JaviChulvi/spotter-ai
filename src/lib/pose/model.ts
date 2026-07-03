// Loads the yolo26n-pose ONNX model with ONNX Runtime Web (WebGPU, WASM
// fallback) and runs a single frame. Browser/worker only.
import * as ort from "onnxruntime-web";
import { MODEL_URL, MODEL_INPUT_SIZE, ORT_WASM_BASE } from "../config";

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let activeProvider = "unknown";

export function getActiveProvider(): string {
  return activeProvider;
}

export function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    ort.env.wasm.wasmPaths = ORT_WASM_BASE;
    ort.env.wasm.numThreads = 1; // avoid needing cross-origin isolation (SAB)
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["webgpu", "wasm"],
      graphOptimizationLevel: "all",
    }).then((s) => {
      // ORT does not report the chosen EP directly; assume WebGPU if available.
      activeProvider =
        typeof navigator !== "undefined" && "gpu" in navigator
          ? "webgpu"
          : "wasm";
      return s;
    });
  }
  return sessionPromise;
}

export async function runPose(
  data: Float32Array,
): Promise<{ output: Float32Array; dims: readonly number[] }> {
  const session = await getSession();
  const input = new ort.Tensor("float32", data, [
    1,
    3,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]);
  const feeds: Record<string, ort.Tensor> = {
    [session.inputNames[0]]: input,
  };
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]];
  return { output: out.data as Float32Array, dims: out.dims };
}
