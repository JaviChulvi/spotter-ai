// Decodes a YOLO-pose ONNX output tensor into person detections (17 keypoints
// each, in model-input / letterbox space). Handles two families:
//
//  * YOLO26 end-to-end / NMS-free pose: [1, 300, 57]
//      57 = box(4) + score(1) + class(1) + 17*(x,y,conf).  Keypoints offset 6.
//      Box is xyxy; already reduced to final detections, so no NMS is needed.
//  * yolo11 / yolov8 raw pose: [1, 56, N] or [1, N, 56]
//      56 = box(4) + score(1) + 17*(x,y,conf).  Keypoints offset 5. Box is xywh.
//
// decodePoses() returns every detection above the confidence threshold (boxes
// normalized to xyxy) so a tracker can pick the subject across frames.
// decodePose() keeps the simple "largest (nearest) person" pick for callers/tests
// that just want one person from a single frame.
import { PERSON_CONF_THRESHOLD } from "../config";
import { NUM_KEYPOINTS } from "../analysis/keypoints";

export interface RawKeypoint {
  x: number;
  y: number;
  c: number;
}

export interface Detection {
  score: number;
  box: [number, number, number, number]; // xyxy
  keypoints: RawKeypoint[];
}

export const FEAT_RAW = 5 + 3 * NUM_KEYPOINTS; // 56
export const FEAT_E2E = 6 + 3 * NUM_KEYPOINTS; // 57
/** Kept for existing tests: the raw (non-end-to-end) feature width. */
export const FEATURES = FEAT_RAW;

function isFeat(x: number): boolean {
  return x === FEAT_RAW || x === FEAT_E2E;
}

interface Layout {
  read: (f: number, i: number) => number;
  n: number;
  kptOffset: number;
}

/** Resolve the tensor layout ([1,N,feat] / [1,feat,N] / [N,feat]) or null. */
function resolveLayout(data: Float32Array, dims: readonly number[]): Layout | null {
  let feat = -1;
  let n = -1;
  let featMajor = false;

  if (dims.length === 3) {
    const [, a, b] = dims;
    if (isFeat(b)) {
      feat = b;
      n = a;
      featMajor = false; // [1, N, feat]
    } else if (isFeat(a)) {
      feat = a;
      n = b;
      featMajor = true; // [1, feat, N]
    } else {
      return null;
    }
  } else if (dims.length === 2 && isFeat(dims[1])) {
    feat = dims[1];
    n = dims[0];
    featMajor = false;
  } else {
    return null;
  }

  const read = featMajor
    ? (f: number, i: number) => data[f * n + i]
    : (f: number, i: number) => data[i * feat + f];
  const kptOffset = feat === FEAT_E2E ? 6 : 5;
  return { read, n, kptOffset };
}

/** Every detection above PERSON_CONF_THRESHOLD, boxes normalized to xyxy. */
export function decodePoses(
  data: Float32Array,
  dims: readonly number[],
): Detection[] {
  const layout = resolveLayout(data, dims);
  if (!layout) return [];
  const { read, n, kptOffset } = layout;

  const dets: Detection[] = [];
  for (let i = 0; i < n; i++) {
    const score = read(4, i);
    if (score < PERSON_CONF_THRESHOLD) continue;

    let box: [number, number, number, number];
    if (kptOffset === 6) {
      box = [read(0, i), read(1, i), read(2, i), read(3, i)]; // xyxy
    } else {
      const cx = read(0, i);
      const cy = read(1, i);
      const w = read(2, i);
      const h = read(3, i);
      box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]; // xywh -> xyxy
    }

    const keypoints: RawKeypoint[] = [];
    for (let k = 0; k < NUM_KEYPOINTS; k++) {
      keypoints.push({
        x: read(kptOffset + k * 3, i),
        y: read(kptOffset + 1 + k * 3, i),
        c: read(kptOffset + 2 + k * 3, i),
      });
    }
    dets.push({ score, box, keypoints });
  }
  return dets;
}

export function boxArea(box: [number, number, number, number]): number {
  return Math.abs((box[2] - box[0]) * (box[3] - box[1]));
}

/**
 * The single largest (nearest-the-camera) person in one frame. With multiple
 * people in view the biggest box is the lifter; per-frame only — use PersonTracker
 * for temporal continuity across a clip.
 */
export function decodePose(
  data: Float32Array,
  dims: readonly number[],
): Detection | null {
  const dets = decodePoses(data, dims);
  if (!dets.length) return null;
  let best = dets[0];
  let bestArea = boxArea(best.box);
  for (let i = 1; i < dets.length; i++) {
    const a = boxArea(dets[i].box);
    if (a > bestArea) {
      bestArea = a;
      best = dets[i];
    }
  }
  return best;
}
