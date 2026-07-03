// Per-rep squat form checks: depth (knee angle + hips-below-knees), torso lean,
// left/right depth symmetry, and the generic ascent helpers (sticky zone +
// bounce), which read only the normalized signal + timestamps.
import { RepSegment, RepTempo } from "../reps";
import { mean, percentile } from "../util";
import { SquatSeries } from "./signals";
import {
  SQUAT_ABOVE_PARALLEL_DEG,
  SQUAT_PARALLEL_DEG,
  KEYPOINT_CONF_THRESHOLD,
  BOUNCE_MAX_PAUSE_S,
  BOUNCE_MIN_REBOUND_VEL,
} from "../../config";

export type Depth = "above_parallel" | "parallel" | "below_parallel";

/** Where in the ascent the rep is slowest. */
export type Zone = "bottom" | "mid" | "lockout" | "none";

/** The subset of a signal the ascent/velocity helpers need. */
export interface AscentSignal {
  t: number[];
  d: number[];
}

function repRange(series: { t: number[] }, seg: RepSegment): [number, number] {
  return [seg.startIdx, seg.endIdx];
}

/** Robust minimum interior knee angle over the rep (deg); smaller = deeper. */
export function minKneeAngle(series: SquatSeries, seg: RepSegment): number {
  const vals: number[] = [];
  for (let k = seg.startIdx; k <= seg.endIdx; k++) {
    if (Number.isFinite(series.kneeAngle[k])) vals.push(series.kneeAngle[k]);
  }
  if (!vals.length) return NaN;
  return percentile(vals, 5); // 5th percentile ~ deepest, robust to single-frame dips
}

/** True when the hips are at/below the knees near the bottom (majority vote). */
export function hipsBelowKnees(series: SquatSeries, seg: RepSegment): boolean {
  const lo = Math.max(seg.startIdx, seg.bottomIdx - 3);
  const hi = Math.min(seg.endIdx, seg.bottomIdx + 3);
  let yes = 0;
  let total = 0;
  for (let k = lo; k <= hi; k++) {
    total++;
    if (series.hipBelowKnee[k]) yes++;
  }
  return total > 0 && yes * 2 >= total;
}

/** Classify depth from the deepest knee angle + the hips-below-knees check. */
export function depthClass(minKnee: number, hipBelow: boolean): Depth {
  if (hipBelow || (Number.isFinite(minKnee) && minKnee <= SQUAT_PARALLEL_DEG)) {
    return "below_parallel";
  }
  if (Number.isFinite(minKnee) && minKnee <= SQUAT_ABOVE_PARALLEL_DEG) {
    return "parallel";
  }
  return "above_parallel";
}

/** Peak sustained forward trunk lean during the rep (deg), robust to spikes. */
export function maxTorsoLean(series: SquatSeries, seg: RepSegment): number {
  const [a, b] = repRange(series, seg);
  const vals: number[] = [];
  for (let k = a; k <= b; k++) {
    if (Number.isFinite(series.torsoLean[k])) vals.push(series.torsoLean[k]);
  }
  return vals.length ? percentile(vals, 90) : NaN;
}

/**
 * Mean left/right hip-height difference over the rep, normalized by leg length.
 * Only frames where BOTH hips are confidently seen are used — on a side/rear view
 * the far hip is often occluded, which would fake asymmetry (low-confidence).
 */
export function depthSymmetry(series: SquatSeries, seg: RepSegment): number {
  const diffs: number[] = [];
  for (let k = seg.startIdx; k <= seg.endIdx; k++) {
    const sc = series.scale[k];
    if (!Number.isFinite(sc) || sc <= 0) continue;
    if (
      series.leftHipC[k] < KEYPOINT_CONF_THRESHOLD ||
      series.rightHipC[k] < KEYPOINT_CONF_THRESHOLD
    ) {
      continue;
    }
    diffs.push(Math.abs(series.leftHipY[k] - series.rightHipY[k]) / sc);
  }
  return diffs.length ? mean(diffs) : 0;
}

/** Peak upward speed (d units/s) in the first 0.2s out of the hole. */
export function reboundVel(series: AscentSignal, seg: RepSegment): number {
  const { t, d } = series;
  const t0 = t[seg.bottomIdx];
  let peak = 0;
  for (let k = seg.bottomIdx; k < seg.endIdx; k++) {
    if (t[k] - t0 > 0.2) break;
    const dt = t[k + 1] - t[k];
    if (dt <= 0) continue;
    const v = (d[k] - d[k + 1]) / dt;
    if (v > peak) peak = v;
  }
  return peak;
}

/** No pause at the bottom + a fast rebound == bouncing out of the hole. */
export function isBounce(
  series: AscentSignal,
  seg: RepSegment,
  tempo: RepTempo,
): boolean {
  return (
    tempo.pauseS < BOUNCE_MAX_PAUSE_S &&
    reboundVel(series, seg) >= BOUNCE_MIN_REBOUND_VEL
  );
}

/**
 * Sticky zone for one rep: split the ascent into three zones by height
 * (bottom = out of the hole, lockout = near standing) and return the zone with
 * the lowest mean ascending speed. Needs at least two populated zones to compare.
 */
export function stickyZone(series: AscentSignal, seg: RepSegment): Zone {
  const { t, d } = series;
  const speeds: Record<"bottom" | "mid" | "lockout", number[]> = {
    bottom: [],
    mid: [],
    lockout: [],
  };
  for (let k = seg.bottomIdx; k < seg.endIdx; k++) {
    const dt = t[k + 1] - t[k];
    if (dt <= 0) continue;
    const v = (d[k] - d[k + 1]) / dt;
    if (v <= 0) continue; // only ascending motion
    const dm = (d[k] + d[k + 1]) / 2;
    if (dm > 2 / 3) speeds.bottom.push(v);
    else if (dm > 1 / 3) speeds.mid.push(v);
    else speeds.lockout.push(v);
  }
  const entries: [Zone, number][] = [];
  if (speeds.bottom.length) entries.push(["bottom", mean(speeds.bottom)]);
  if (speeds.mid.length) entries.push(["mid", mean(speeds.mid)]);
  if (speeds.lockout.length) entries.push(["lockout", mean(speeds.lockout)]);
  if (entries.length < 2) return "none";
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0][0];
}
