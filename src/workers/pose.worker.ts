// Web Worker: receives video frames (as ImageBitmap), runs yolo26n-pose via
// ONNX Runtime Web, decodes + smooths keypoints, and posts them back. Keeps
// heavy inference off the UI thread.
import { letterbox, unletterbox } from "../lib/pose/preprocess";
import { decodePoses } from "../lib/pose/decode";
import { PersonTracker } from "../lib/pose/tracker";
import { runPose, getSession, getActiveProvider } from "../lib/pose/model";
import { KeypointSmoother, XYC } from "../lib/pose/smoothing";
import { NUM_KEYPOINTS } from "../lib/analysis/keypoints";
import { MODEL_INPUT_SIZE } from "../lib/config";

type InitMsg = { type: "init" };
type FrameMsg = {
  type: "frame";
  bitmap: ImageBitmap;
  t: number;
  w: number;
  h: number;
};
type InMsg = InitMsg | FrameMsg;

export type PoseOut = { type: "pose"; t: number; kp: XYC[] | null };
export type ReadyOut = { type: "ready"; provider: string };
export type ErrorOut = { type: "error"; error: string };
export type OutMsg = PoseOut | ReadyOut | ErrorOut;

let smoother = new KeypointSmoother(NUM_KEYPOINTS);
const tracker = new PersonTracker();
let lastT = -Infinity;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function post(m: OutMsg): void {
  (self as unknown as { postMessage: (m: OutMsg) => void }).postMessage(m);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function handle(msg: InMsg): Promise<void> {
  if (msg.type === "init") {
    const canvas = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    try {
      await getSession();
      // Warm up the execution provider with a zero frame.
      await runPose(new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE));
      post({ type: "ready", provider: getActiveProvider() });
    } catch (err) {
      post({ type: "error", error: errText(err) });
    }
    return;
  }

  // frame
  if (!ctx) {
    msg.bitmap.close();
    return;
  }
  // A new clip (or a seek backwards) rewinds the timestamp — start tracking and
  // smoothing fresh so nothing from the previous clip leaks in.
  if (msg.t <= lastT) {
    tracker.reset();
    smoother = new KeypointSmoother(NUM_KEYPOINTS);
  }
  lastT = msg.t;

  try {
    const { data, lb } = letterbox(msg.bitmap, msg.w, msg.h, ctx);
    msg.bitmap.close();
    const { output, dims } = await runPose(data);
    const det = tracker.select(decodePoses(output, dims));
    if (!det) {
      post({ type: "pose", t: msg.t, kp: null });
      return;
    }
    const raw: XYC[] = det.keypoints.map((k) => {
      const p = unletterbox(k.x, k.y, lb);
      return { x: p.x, y: p.y, c: k.c };
    });
    post({ type: "pose", t: msg.t, kp: smoother.smooth(raw, msg.t) });
  } catch (err) {
    post({ type: "error", error: errText(err) });
  }
}

self.addEventListener("message", (e) => {
  void handle((e as MessageEvent<InMsg>).data);
});
