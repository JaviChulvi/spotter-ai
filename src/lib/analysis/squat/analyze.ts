// Orchestrates a full squat set analysis from a frame series into a SquatSetAnalysis.
import { Frame, KP, dist } from "../keypoints";
import { mean, stdev, mode, median } from "../util";
import { segmentReps, repTempo, RepOptions } from "../reps";
import { computeSquatSeries } from "./signals";
import {
  minKneeAngle,
  hipsBelowKnees,
  depthClass,
  maxTorsoLean,
  depthSymmetry,
  stickyZone,
  isBounce,
  Depth,
  Zone,
} from "./form";
import {
  SQUAT_REP_TOP_THRESHOLD,
  SQUAT_REP_BOTTOM_THRESHOLD,
  SQUAT_MIN_REP_DURATION_S,
  SQUAT_REP_MIN_SPACING_S,
  SQUAT_REP_PROMINENCE_FRAC,
  SQUAT_REP_AMP_MIN,
  SQUAT_MIN_KNEE_FLEXION_DEG,
  SQUAT_TORSO_LEAN_WARN_DEG,
  SQUAT_DEPTH_ASYM_THRESHOLD,
  PERSON_CONF_THRESHOLD,
} from "../../config";

const SQUAT_REP_OPTIONS: RepOptions = {
  topThreshold: SQUAT_REP_TOP_THRESHOLD,
  bottomThreshold: SQUAT_REP_BOTTOM_THRESHOLD,
  minRepDurationS: SQUAT_MIN_REP_DURATION_S,
  minSpacingS: SQUAT_REP_MIN_SPACING_S,
  prominenceFrac: SQUAT_REP_PROMINENCE_FRAC,
  ampMin: SQUAT_REP_AMP_MIN,
};

export interface SquatRep {
  index: number;
  startT: number;
  bottomT: number;
  endT: number;
  eccentricS: number;
  concentricS: number;
  pauseS: number;
  totalS: number;
  depthNorm: number; // hip travel as a fraction of the set's deepest (~1 = full depth)
  minKneeAngle: number; // deg; 180 = straight, smaller = deeper
  kneeFlexion: number; // deg of knee bend (180 - minKneeAngle)
  depth: Depth;
  hipsBelowKnees: boolean;
  atLeastParallel: boolean;
  meanConcentricVel: number; // ROM fraction per second (bottom -> stand)
  peakConcentricVel: number;
  maxTorsoLean: number; // deg forward lean from vertical
  stickyZone: Zone;
  bounce: boolean;
  symmetry: number; // normalized L/R hip-height difference (low-confidence off-side)
}

export interface SquatFormFlags {
  depthConsistency: number; // 0..1
  repsAtDepth: number; // count reaching at least parallel
  shallowReps: number[]; // above parallel
  meanMinKneeAngle: number;
  torsoLeanWarnReps: number[];
  maxTorsoLean: number;
  symmetry: number;
  asymmetric: boolean;
  bounceReps: number[];
}

export interface SquatFatigue {
  concentricTimeTrendPct: number;
  velocityLossPct: number;
}

export interface SquatStickyPoint {
  dominantZone: Zone;
  repsAffected: number[];
}

export interface SquatSetAnalysis {
  exercise: "squat";
  cameraView: "side" | "front_or_rear" | "angled";
  repCount: number;
  durationS: number;
  reps: SquatRep[];
  formFlags: SquatFormFlags;
  fatigue: SquatFatigue;
  stickyPoint: SquatStickyPoint;
  detectionConfidence: number; // 0..1
  caveats: string[];
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function avgFirst(xs: number[], k: number): number {
  return mean(xs.slice(0, Math.min(k, xs.length)));
}
function avgLast(xs: number[], k: number): number {
  return mean(xs.slice(Math.max(0, xs.length - k)));
}

/** Rough camera view from the median shoulder-width / leg-length ratio: a side
 *  view foreshortens the shoulders (small ratio); a front/rear view keeps them
 *  wide. Only used to caveat knee-angle depth accuracy. */
function cameraView(frames: Frame[]): SquatSetAnalysis["cameraView"] {
  const ratios: number[] = [];
  for (const f of frames) {
    const sw = dist(f.kp[KP.leftShoulder], f.kp[KP.rightShoulder]);
    const leg =
      dist(f.kp[KP.leftHip], f.kp[KP.leftKnee]) +
      dist(f.kp[KP.leftKnee], f.kp[KP.leftAnkle]);
    if (leg > 1) ratios.push(sw / leg);
  }
  const r = ratios.length ? median(ratios) : 0;
  if (r < 0.32) return "side";
  if (r > 0.55) return "front_or_rear";
  return "angled";
}

export function analyzeSquatSet(frames: Frame[]): SquatSetAnalysis {
  const caveats: string[] = [];
  const duration = frames.length
    ? frames[frames.length - 1].t - frames[0].t
    : 0;

  const empty: SquatSetAnalysis = {
    exercise: "squat",
    cameraView: "angled",
    repCount: 0,
    durationS: round(duration),
    reps: [],
    formFlags: {
      depthConsistency: 0,
      repsAtDepth: 0,
      shallowReps: [],
      meanMinKneeAngle: 0,
      torsoLeanWarnReps: [],
      maxTorsoLean: 0,
      symmetry: 0,
      asymmetric: false,
      bounceReps: [],
    },
    fatigue: { concentricTimeTrendPct: 0, velocityLossPct: 0 },
    stickyPoint: { dominantZone: "none", repsAffected: [] },
    detectionConfidence: 0,
    caveats,
  };

  if (frames.length < 5) {
    caveats.push("Too few frames to analyze.");
    return empty;
  }

  const series = computeSquatSeries(frames);
  const validConf = series.keyConf.filter((c) => c > 0);
  const detConf = validConf.length ? mean(validConf) : 0;
  const view = cameraView(frames);

  if (series.validFraction < 0.4) {
    caveats.push(
      "The lifter could not be tracked reliably for much of the clip (occlusion, bystanders, or off-frame). Interpret with caution.",
    );
  }
  if (detConf < PERSON_CONF_THRESHOLD) {
    caveats.push(
      "Low keypoint confidence — detections may be unreliable; interpret with caution.",
    );
  }

  const segs = segmentReps(series, SQUAT_REP_OPTIONS);
  const reps: SquatRep[] = [];
  for (const seg of segs) {
    const minKnee = minKneeAngle(series, seg);
    // Reject "reps" that never bend the knee (walkout sway, rack adjustments).
    if (Number.isFinite(minKnee) && minKnee > SQUAT_MIN_KNEE_FLEXION_DEG) continue;

    const tempo = repTempo(series, seg);
    const hipBelow = hipsBelowKnees(series, seg);
    const depth = depthClass(minKnee, hipBelow);
    const lean = maxTorsoLean(series, seg);
    reps.push({
      index: reps.length,
      startT: round(seg.startT),
      bottomT: round(seg.bottomT),
      endT: round(seg.endT),
      eccentricS: round(tempo.eccentricS),
      concentricS: round(tempo.concentricS),
      pauseS: round(tempo.pauseS),
      totalS: round(tempo.totalS),
      depthNorm: round(seg.maxD),
      minKneeAngle: Number.isFinite(minKnee) ? round(minKnee) : 0,
      kneeFlexion: Number.isFinite(minKnee) ? round(180 - minKnee) : 0,
      depth,
      hipsBelowKnees: hipBelow,
      atLeastParallel: depth !== "above_parallel",
      meanConcentricVel: round(tempo.meanConcentricVel),
      peakConcentricVel: round(tempo.peakConcentricVel),
      maxTorsoLean: Number.isFinite(lean) ? round(lean) : 0,
      stickyZone: stickyZone(series, seg),
      bounce: isBounce(series, seg, tempo),
      symmetry: round(depthSymmetry(series, seg)),
    });
  }

  if (!reps.length) {
    caveats.push("No complete squat reps detected.");
    return { ...empty, cameraView: view, detectionConfidence: round(detConf) };
  }

  // --- form flags (set level) ---
  const depths = reps.map((r) => r.depthNorm);
  const depthConsistency = depths.length
    ? clamp01(1 - stdev(depths) / (mean(depths) || 1))
    : 0;
  const symMean = mean(reps.map((r) => r.symmetry));
  const kneeVals = reps.map((r) => r.minKneeAngle).filter((v) => v > 0);
  const leanMax = Math.max(...reps.map((r) => r.maxTorsoLean));

  const formFlags: SquatFormFlags = {
    depthConsistency: round(depthConsistency),
    repsAtDepth: reps.filter((r) => r.atLeastParallel).length,
    shallowReps: reps.filter((r) => !r.atLeastParallel).map((r) => r.index),
    meanMinKneeAngle: kneeVals.length ? round(mean(kneeVals)) : 0,
    torsoLeanWarnReps: reps
      .filter((r) => r.maxTorsoLean > SQUAT_TORSO_LEAN_WARN_DEG)
      .map((r) => r.index),
    maxTorsoLean: round(leanMax),
    symmetry: round(symMean),
    asymmetric: symMean > SQUAT_DEPTH_ASYM_THRESHOLD,
    bounceReps: reps.filter((r) => r.bounce).map((r) => r.index),
  };

  if (view !== "side") {
    caveats.push(
      "Camera is not a clean side view, so knee-angle depth is approximate; the hips-below-knees check is used as a cross-reference. Film from the side for the most accurate depth.",
    );
  }
  caveats.push(
    "Frontal-plane faults (knee cave/valgus, heel lift, weight shift) are not assessed from this view.",
  );
  caveats.push(
    "Left/right symmetry is low-confidence: on a side or rear view the far hip is occluded.",
  );

  // --- fatigue ---
  const concTimes = reps.map((r) => r.concentricS);
  const vels = reps.map((r) => r.meanConcentricVel);
  const k = Math.min(2, reps.length);
  const firstT = avgFirst(concTimes, k);
  const lastT = avgLast(concTimes, k);
  const firstV = avgFirst(vels, k);
  const lastV = avgLast(vels, k);
  const fatigue: SquatFatigue = {
    concentricTimeTrendPct:
      firstT > 0 ? round(((lastT - firstT) / firstT) * 100) : 0,
    velocityLossPct: firstV > 0 ? round(((firstV - lastV) / firstV) * 100) : 0,
  };

  // --- sticky point (aggregate) ---
  const zones = reps.map((r) => r.stickyZone).filter((z) => z !== "none");
  const dominant = (mode(zones) ?? "none") as Zone;
  const stickyPoint: SquatStickyPoint = {
    dominantZone: dominant,
    repsAffected:
      dominant === "none"
        ? []
        : reps.filter((r) => r.stickyZone === dominant).map((r) => r.index),
  };

  return {
    exercise: "squat",
    cameraView: view,
    repCount: reps.length,
    durationS: round(duration),
    reps,
    formFlags,
    fatigue,
    stickyPoint,
    detectionConfidence: round(detConf),
    caveats,
  };
}
