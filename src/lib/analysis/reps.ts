// Rep segmentation (batch) + a live incremental counter for the HUD.
// Exercise-agnostic: works on any 1-D "height" signal where local maxima of
// `barY` are rep bottoms (hips at squat depth) and `d` is that signal normalized
// to 0 = top/standing, 1 = deepest. The squat engine feeds it a SquatSeries and
// passes per-exercise thresholds via RepOptions.
import { percentile, median } from "./util";
import {
  REP_TOP_THRESHOLD,
  REP_BOTTOM_THRESHOLD,
  MIN_REP_DURATION_S,
  REP_MIN_SPACING_S,
  REP_PROMINENCE_FRAC,
  REP_AMP_MIN,
} from "../config";

/** Minimal signal the segmenter needs (SquatSeries satisfies it). */
export interface RepSignal {
  t: number[];
  d: number[];
  barY: number[]; // raw tracked height (larger = deeper); local maxima are bottoms
  scale: number[]; // per-frame body-scale reference in px (torso / leg length)
  romPx: number;
}

/** Per-exercise segmentation thresholds. Defaults are the generic REP_* config values. */
export interface RepOptions {
  topThreshold: number;
  bottomThreshold: number;
  minRepDurationS: number;
  minSpacingS: number;
  prominenceFrac: number;
  ampMin: number;
}

export const DEFAULT_REP_OPTIONS: RepOptions = {
  topThreshold: REP_TOP_THRESHOLD,
  bottomThreshold: REP_BOTTOM_THRESHOLD,
  minRepDurationS: MIN_REP_DURATION_S,
  minSpacingS: REP_MIN_SPACING_S,
  prominenceFrac: REP_PROMINENCE_FRAC,
  ampMin: REP_AMP_MIN,
};

export interface RepSegment {
  index: number;
  startIdx: number; // eccentric start (leaving lockout)
  bottomIdx: number; // deepest point (at chest)
  endIdx: number; // back to lockout (rep complete)
  startT: number;
  bottomT: number;
  endT: number;
  maxD: number; // deepest normalized displacement reached
}

function argMinRange(d: number[], a: number, b: number): number {
  let mi = a;
  let mv = d[a];
  for (let i = a; i <= b; i++) {
    if (d[i] < mv) {
      mv = d[i];
      mi = i;
    }
  }
  return mi;
}

/**
 * Peak-centered segmentation for one lying bout. Chest peaks are local maxima of
 * bar height that (a) reach the bottom threshold, (b) are spaced at least
 * REP_MIN_SPACING_S apart, and (c) rise above their neighbouring lockout troughs
 * by at least REP_PROMINENCE_FRAC of torso length. The torso-relative prominence
 * is the key: it's camera-invariant and separates full reps from small wobbles,
 * without a detrend step (whole-clip drift is handled by analyzing per bout).
 */
export function segmentReps(
  series: RepSignal,
  opts: RepOptions = DEFAULT_REP_OPTIONS,
): RepSegment[] {
  const { d, t, barY, scale } = series;
  const n = d.length;
  if (n < 3) return [];
  if (percentile(d, 95) - percentile(d, 5) < opts.ampMin) return []; // no oscillation

  const scales = scale.filter((s) => Number.isFinite(s) && s > 0);
  const scaleRef = scales.length ? median(scales) : series.romPx;
  const minPromPx = opts.prominenceFrac * scaleRef;

  // 1. Candidate chest peaks: local maxima of bar height reaching the bottom
  //    threshold, spaced >= REP_MIN_SPACING_S (when too close, keep the deeper).
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (
      barY[i] >= barY[i - 1] &&
      barY[i] > barY[i + 1] &&
      d[i] >= opts.bottomThreshold
    ) {
      const last = peaks[peaks.length - 1];
      if (peaks.length > 0 && t[i] - t[last] < opts.minSpacingS) {
        if (barY[i] > barY[last]) peaks[peaks.length - 1] = i;
      } else {
        peaks.push(i);
      }
    }
  }

  // 2. Prominence filter (in px): chest must rise minPromPx above the higher of
  //    its two neighbouring lockout troughs.
  const minBarBetween = (a: number, b: number): number => {
    let m = Infinity;
    for (let k = a; k <= b; k++) if (barY[k] < m) m = barY[k];
    return m;
  };
  const kept: number[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i];
    const lo = i > 0 ? peaks[i - 1] : 0;
    const hi = i < peaks.length - 1 ? peaks[i + 1] : n - 1;
    const base = Math.max(minBarBetween(lo, p), minBarBetween(p, hi));
    if (barY[p] - base >= minPromPx) kept.push(p);
  }

  // 3. One segment per peak, bounded by the return toward lockout.
  const reps: RepSegment[] = [];
  for (let i = 0; i < kept.length; i++) {
    const p = kept[i];
    const lb = i > 0 ? kept[i - 1] : 0;
    const rb = i < kept.length - 1 ? kept[i + 1] : n - 1;

    let startIdx = -1;
    for (let k = p - 1; k >= lb; k--) {
      if (d[k] <= opts.topThreshold) {
        startIdx = k;
        break;
      }
    }
    if (startIdx < 0) startIdx = argMinRange(d, lb, p);

    let endIdx = -1;
    for (let k = p + 1; k <= rb; k++) {
      if (d[k] <= opts.topThreshold) {
        endIdx = k;
        break;
      }
    }
    if (endIdx < 0) endIdx = argMinRange(d, p, rb);

    if (t[endIdx] - t[startIdx] < opts.minRepDurationS) continue;

    reps.push({
      index: reps.length,
      startIdx,
      bottomIdx: p,
      endIdx,
      startT: t[startIdx],
      bottomT: t[p],
      endT: t[endIdx],
      maxD: d[p],
    });
  }
  return reps;
}

export interface RepTempo {
  eccentricS: number;
  concentricS: number;
  pauseS: number;
  totalS: number;
  meanConcentricVel: number; // ROM fraction per second (bottom -> top)
  peakConcentricVel: number;
}

export function repTempo(
  series: { t: number[]; d: number[] },
  seg: RepSegment,
): RepTempo {
  const { t, d } = series;
  // Bottom dwell = contiguous run near max depth (small deadband). This cleanly
  // separates a genuinely held pause from an instant bounce turnaround, and lets
  // eccentric / pause / concentric be measured without lumping the pause in.
  const dead = 0.03;
  let lo = seg.bottomIdx;
  let hi = seg.bottomIdx;
  while (lo - 1 >= seg.startIdx && d[lo - 1] >= seg.maxD - dead) lo--;
  while (hi + 1 <= seg.endIdx && d[hi + 1] >= seg.maxD - dead) hi++;

  // Measure the eccentric/concentric over the ACTUAL movement, not from the rep's
  // boundary troughs: a lifter may stand and rest for seconds at the top between
  // reps (squats), and that standing time must not count as descent/ascent. The
  // rep's own standing level is the higher of its two boundary troughs; movement
  // is anything more than 10% of the rep's amplitude below the bottom.
  const topD = Math.min(d[seg.startIdx], d[seg.endIdx]);
  const amp = Math.max(seg.maxD - topD, 1e-6);
  const moveTh = topD + 0.1 * amp;
  let ds = seg.startIdx; // descent start (top of the eccentric)
  for (let k = lo; k >= seg.startIdx; k--) {
    if (d[k] <= moveTh) {
      ds = k;
      break;
    }
  }
  let ae = seg.endIdx; // ascent end (back to standing)
  for (let k = hi; k <= seg.endIdx; k++) {
    if (d[k] <= moveTh) {
      ae = k;
      break;
    }
  }

  const eccentricS = Math.max(0, t[lo] - t[ds]);
  const pauseS = Math.max(0, t[hi] - t[lo]);
  const concentricS = Math.max(0, t[ae] - t[hi]);
  const totalS = t[ae] - t[ds];

  // Concentric velocity: d decreases from ~maxD (bottom) to ~top over the ascent.
  let peak = 0;
  for (let k = hi; k < ae; k++) {
    const dt = t[k + 1] - t[k];
    if (dt <= 0) continue;
    const v = (d[k] - d[k + 1]) / dt; // positive while ascending
    if (v > peak) peak = v;
  }
  const meanConcentricVel =
    concentricS > 0 ? (d[hi] - d[ae]) / concentricS : 0;

  return {
    eccentricS,
    concentricS,
    pauseS,
    totalS,
    meanConcentricVel,
    peakConcentricVel: peak,
  };
}
