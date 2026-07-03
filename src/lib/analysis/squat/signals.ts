// Derives the squat depth signal and geometry from a frame series.
//
// The squat's motion signal is HIP height: the lifter stands tall at the top
// (small y) and sinks at the bottom (large y), so local maxima of hip height are
// rep bottoms, which the generic rep FSM segments. Depth *quality* is read from
// the interior knee angle and a hips-below-knees check.
//
// A person-consistency gate rejects frames that are actually a background
// bystander or a bad detection (which happens when the lifter is briefly hidden
// behind the plates at the bottom): the lifter is the large, roughly stationary
// subject, so frames with a too-small body scale, an off-column torso, or
// low-confidence trunk keypoints are dropped and bridged by interpolation so the
// hip signal stays continuous.
import {
  Frame,
  KP,
  Keypoints,
  Point,
  dist,
  angleDeg,
  hipMid,
  shoulderMid,
} from "../keypoints";
import { clamp, percentile, median, movingAverage } from "../util";
import {
  LOCKOUT_PERCENTILE,
  CHEST_PERCENTILE,
  SQUAT_BAR_SMOOTH_WINDOW_S,
  SQUAT_CONF_THRESHOLD,
  SQUAT_CENTER_TOL_FRAC,
  SQUAT_SCALE_MIN_FRAC,
} from "../../config";
import type { RepSignal } from "../reps";

export type Side = "left" | "right";

const LEG: Record<Side, { hip: number; knee: number; ankle: number }> = {
  left: { hip: KP.leftHip, knee: KP.leftKnee, ankle: KP.leftAnkle },
  right: { hip: KP.rightHip, knee: KP.rightKnee, ankle: KP.rightAnkle },
};

/** Confidence-weighted midpoint of the hips (near hip dominates on a side view). */
export function hipPoint(kp: Keypoints): Point {
  const l = kp[KP.leftHip];
  const r = kp[KP.rightHip];
  const wl = Math.max(l.c, 1e-3) ** 2;
  const wr = Math.max(r.c, 1e-3) ** 2;
  return {
    x: (l.x * wl + r.x * wr) / (wl + wr),
    y: (l.y * wl + r.y * wr) / (wl + wr),
    c: Math.max(l.c, r.c),
  };
}

/** Summed hip+knee+ankle confidence for a leg (used to pick the visible leg). */
export function legConfidence(kp: Keypoints, side: Side): number {
  const j = LEG[side];
  return kp[j.hip].c + kp[j.knee].c + kp[j.ankle].c;
}

/** Rigid leg length (femur + shin) in px — a depth-invariant scale reference. */
export function legLength(kp: Keypoints, side: Side): number {
  const j = LEG[side];
  return dist(kp[j.hip], kp[j.knee]) + dist(kp[j.knee], kp[j.ankle]);
}

/** Interior knee angle (deg): 180 = fully extended (standing), smaller = deeper. */
export function kneeAngle(kp: Keypoints, side: Side): number {
  const j = LEG[side];
  return angleDeg(kp[j.hip], kp[j.knee], kp[j.ankle]);
}

/** The better-detected leg for this frame. */
export function bestLeg(kp: Keypoints): Side {
  return legConfidence(kp, "left") >= legConfidence(kp, "right")
    ? "left"
    : "right";
}

/** Forward lean of the trunk from vertical (deg): 0 = upright, 90 = horizontal. */
export function torsoLeanDeg(kp: Keypoints): number {
  const s = shoulderMid(kp);
  const h = hipMid(kp);
  const dx = h.x - s.x;
  const dy = h.y - s.y; // hips are below shoulders (y grows downward) when upright
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return NaN;
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

/** Fill `false`-masked entries by linear interpolation between valid neighbours,
 *  edge-holding at the ends. Keeps a per-frame signal continuous across dropped
 *  (bystander / occluded) frames without inventing motion. */
function bridge(values: number[], valid: boolean[]): number[] {
  const n = values.length;
  const out = values.slice();
  let i = 0;
  while (i < n) {
    if (valid[i]) {
      i++;
      continue;
    }
    const lo = i - 1; // last valid before the gap
    let j = i;
    while (j < n && !valid[j]) j++;
    const hi = j; // first valid after the gap
    if (lo < 0 && hi >= n) return out; // nothing valid at all
    if (lo < 0) {
      for (let k = i; k < hi; k++) out[k] = out[hi]; // edge-hold left
    } else if (hi >= n) {
      for (let k = i; k < n; k++) out[k] = out[lo]; // edge-hold right
    } else {
      const span = hi - lo;
      for (let k = i; k < hi; k++) {
        const f = (k - lo) / span;
        out[k] = out[lo] * (1 - f) + out[hi] * f;
      }
    }
    i = hi;
  }
  return out;
}

export interface SquatSeries extends RepSignal {
  // RepSignal: t, d, barY (smoothed hip height), scale (leg length px), romPx
  kneeAngle: number[]; // best-leg interior knee angle per frame (deg)
  torsoLean: number[]; // forward trunk lean per frame (deg)
  hipBelowKnee: boolean[]; // hip lower than knee (deeper than knee) per frame
  leftHipY: number[];
  rightHipY: number[];
  leftHipC: number[];
  rightHipC: number[];
  keyConf: number[]; // min trunk-keypoint confidence per frame (0 on dropped frames)
  valid: boolean[]; // frame passed the lifter-consistency gate
  lockoutY: number; // standing hip height (px)
  bottomY: number; // deepest hip height (px)
  validFraction: number; // share of frames that passed the gate
}

export function computeSquatSeries(frames: Frame[]): SquatSeries {
  const n = frames.length;
  const t = frames.map((f) => f.t);

  // --- pass 1: raw per-frame features + "detected" (trunk keypoints present) ---
  const rawHipY = new Array<number>(n);
  const rawLegLen = new Array<number>(n);
  const centerX = new Array<number>(n);
  const rawKnee = new Array<number>(n);
  const rawLean = new Array<number>(n);
  const rawHBK = new Array<boolean>(n);
  const leftHipY = new Array<number>(n);
  const rightHipY = new Array<number>(n);
  const leftHipC = new Array<number>(n);
  const rightHipC = new Array<number>(n);
  const trunkConf = new Array<number>(n);
  const detected = new Array<boolean>(n);

  for (let i = 0; i < n; i++) {
    const kp = frames[i].kp;
    const hp = hipPoint(kp);
    const s = shoulderMid(kp);
    const side = bestLeg(kp);
    const j = LEG[side];
    rawHipY[i] = hp.y;
    rawLegLen[i] = legLength(kp, side);
    centerX[i] = (s.x + hp.x) / 2;
    rawKnee[i] = kneeAngle(kp, side);
    rawLean[i] = torsoLeanDeg(kp);
    rawHBK[i] = kp[j.hip].y > kp[j.knee].y; // hip below knee (image y grows down)
    leftHipY[i] = kp[KP.leftHip].y;
    rightHipY[i] = kp[KP.rightHip].y;
    leftHipC[i] = kp[KP.leftHip].c;
    rightHipC[i] = kp[KP.rightHip].c;
    trunkConf[i] = Math.min(kp[KP.leftShoulder].c, kp[KP.rightShoulder].c, hp.c);
    detected[i] =
      trunkConf[i] >= SQUAT_CONF_THRESHOLD &&
      Number.isFinite(rawHipY[i]) &&
      Number.isFinite(rawLegLen[i]) &&
      rawLegLen[i] > 1;
  }

  // --- lifter reference: median column and body scale over detected frames ---
  const detCenters: number[] = [];
  const detLegs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (detected[i]) {
      detCenters.push(centerX[i]);
      detLegs.push(rawLegLen[i]);
    }
  }
  const medCenter = detCenters.length ? median(detCenters) : NaN;
  const medLeg = detLegs.length ? median(detLegs) : NaN;

  // --- pass 2: consistency gate (drop bystanders / occlusion flips) ---
  const valid = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    valid[i] =
      detected[i] &&
      (!Number.isFinite(medLeg) ||
        (rawLegLen[i] >= SQUAT_SCALE_MIN_FRAC * medLeg &&
          Math.abs(centerX[i] - medCenter) <= SQUAT_CENTER_TOL_FRAC * medLeg));
  }
  const validCount = valid.reduce((a, v) => a + (v ? 1 : 0), 0);

  // --- bridge every per-frame signal across dropped frames, then smooth hip ---
  const hipYBridged = bridge(rawHipY, valid);
  const barY = movingAverage(hipYBridged, t, SQUAT_BAR_SMOOTH_WINDOW_S);
  const scale = bridge(rawLegLen, valid);
  const kneeA = bridge(rawKnee, valid);
  const lean = bridge(rawLean, valid);
  const lHipY = bridge(leftHipY, valid);
  const rHipY = bridge(rightHipY, valid);

  const lockoutY = percentile(barY, LOCKOUT_PERCENTILE);
  const bottomY = percentile(barY, CHEST_PERCENTILE);
  const romPx = Math.max(bottomY - lockoutY, 1e-6);
  const d = barY.map((y) => clamp((y - lockoutY) / romPx, 0, 1));

  const keyConf = trunkConf.map((c, i) => (valid[i] ? c : 0));

  return {
    t,
    d,
    barY,
    scale,
    romPx,
    kneeAngle: kneeA,
    torsoLean: lean,
    hipBelowKnee: rawHBK,
    leftHipY: lHipY,
    rightHipY: rHipY,
    leftHipC,
    rightHipC,
    keyConf,
    valid,
    lockoutY,
    bottomY,
    validFraction: n ? validCount / n : 0,
  };
}
