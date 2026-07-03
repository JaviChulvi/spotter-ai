// DTOs + JSON Schema for the OpenAI squat coach.
// SquatSetSummary is the coach *input* (built from a SquatSetAnalysis).
// CoachFeedback is the structured *output* enforced via OpenAI Structured Outputs.

// --- Squat set summary (coach input for the squat page) ---
export interface SquatRepSummary {
  index: number;
  eccentric_s: number;
  concentric_s: number;
  pause_s: number;
  depth_norm: number;
  min_knee_angle_deg: number;
  knee_flexion_deg: number;
  depth: string; // above_parallel | parallel | below_parallel
  hips_below_knees: boolean;
  at_least_parallel: boolean;
  mean_concentric_vel: number;
  max_torso_lean_deg: number;
  sticky_zone: string;
  bounce: boolean;
}

export interface SquatSetSummary {
  exercise: "squat";
  reps: number;
  camera_view: string;
  per_rep: SquatRepSummary[];
  form_flags: {
    depth_consistency: number;
    reps_at_depth: number;
    shallow_reps: number[];
    mean_min_knee_angle_deg: number;
    torso_lean_warn_reps: number[];
    max_torso_lean_deg: number;
    symmetry: number;
    asymmetric: boolean;
    bounce_reps: number[];
  };
  fatigue: {
    concentric_time_trend_pct: number;
    velocity_loss_pct: number;
  };
  sticky_point: {
    dominant_zone: string;
    reps_affected: number[];
  };
  detection_confidence: number;
  caveats: string[];
}

export interface CoachFeedback {
  summary: string;
  priorities: { issue: string; why: string; cue: string }[];
  accessory_recommendations: { movement: string; reason: string }[];
  fatigue_note: string;
  safety_flags: string[];
}

/** JSON Schema passed to OpenAI as response_format.json_schema (strict mode). */
export const COACH_FEEDBACK_JSON_SCHEMA = {
  name: "coach_feedback",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      priorities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            issue: { type: "string" },
            why: { type: "string" },
            cue: { type: "string" },
          },
          required: ["issue", "why", "cue"],
        },
      },
      accessory_recommendations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            movement: { type: "string" },
            reason: { type: "string" },
          },
          required: ["movement", "reason"],
        },
      },
      fatigue_note: { type: "string" },
      safety_flags: { type: "array", items: { type: "string" } },
    },
    required: [
      "summary",
      "priorities",
      "accessory_recommendations",
      "fatigue_note",
      "safety_flags",
    ],
  },
};
