// Maps a SquatSetAnalysis into the SquatSetSummary DTO the coach consumes.
import { SquatSetAnalysis } from "./analyze";
import { SquatSetSummary } from "../../coach/schema";

export function toSquatSetSummary(a: SquatSetAnalysis): SquatSetSummary {
  return {
    exercise: "squat",
    reps: a.repCount,
    camera_view: a.cameraView,
    per_rep: a.reps.map((r) => ({
      index: r.index,
      eccentric_s: r.eccentricS,
      concentric_s: r.concentricS,
      pause_s: r.pauseS,
      depth_norm: r.depthNorm,
      min_knee_angle_deg: r.minKneeAngle,
      knee_flexion_deg: r.kneeFlexion,
      depth: r.depth,
      hips_below_knees: r.hipsBelowKnees,
      at_least_parallel: r.atLeastParallel,
      mean_concentric_vel: r.meanConcentricVel,
      max_torso_lean_deg: r.maxTorsoLean,
      sticky_zone: r.stickyZone,
      bounce: r.bounce,
    })),
    form_flags: {
      depth_consistency: a.formFlags.depthConsistency,
      reps_at_depth: a.formFlags.repsAtDepth,
      shallow_reps: a.formFlags.shallowReps,
      mean_min_knee_angle_deg: a.formFlags.meanMinKneeAngle,
      torso_lean_warn_reps: a.formFlags.torsoLeanWarnReps,
      max_torso_lean_deg: a.formFlags.maxTorsoLean,
      symmetry: a.formFlags.symmetry,
      asymmetric: a.formFlags.asymmetric,
      bounce_reps: a.formFlags.bounceReps,
    },
    fatigue: {
      concentric_time_trend_pct: a.fatigue.concentricTimeTrendPct,
      velocity_loss_pct: a.fatigue.velocityLossPct,
    },
    sticky_point: {
      dominant_zone: a.stickyPoint.dominantZone,
      reps_affected: a.stickyPoint.repsAffected,
    },
    detection_confidence: a.detectionConfidence,
    caveats: a.caveats,
  };
}
