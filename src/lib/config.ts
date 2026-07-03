// Central configuration: model, inference, analysis thresholds, and coach model.
// Per project decision, the app reads exactly ONE secret from the environment:
// OPENAI_API_KEY (consumed by the OpenAI SDK on the server). Everything else here
// is an in-code constant so there are no other env vars to manage.

// --- Model / inference ---
export const MODEL_URL = "/models/yolo26n-pose.onnx"; // yolo26n-pose only, no fallback
// 960, not 640: portrait phone clips put the (side-on) lifter in a thin
// horizontal band, so 640 shrinks them too much. 960 roughly doubles arm/wrist
// keypoint confidence. The ONNX must be exported at this size (scripts/export_model.md).
export const MODEL_INPUT_SIZE = 960;
// ONNX Runtime Web wasm/webgpu binaries (matches installed onnxruntime-web version).
export const ORT_WASM_BASE =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

// --- Keypoint confidence ---
export const KEYPOINT_CONF_THRESHOLD = 0.2; // below this a keypoint is untrusted (0.2 keeps marginal arm points visible)
export const PERSON_CONF_THRESHOLD = 0.35; // min detection confidence to accept a person

// --- Height-series calibration (percentiles used for the top / bottom of the ROM) ---
export const LOCKOUT_PERCENTILE = 2; // near the top / standing (min y)
export const CHEST_PERCENTILE = 98; // near the bottom / deepest (max y)

// --- Rep FSM defaults (d = normalized displacement; 0 = top, 1 = deepest) ---
// Generic fallbacks for segmentReps(); the squat engine passes its own RepOptions
// (the SQUAT_* values below).
export const REP_TOP_THRESHOLD = 0.15; // considered "at the top" below this
export const REP_BOTTOM_THRESHOLD = 0.7; // a depth peak must reach this (fraction of ROM)
export const MIN_REP_DURATION_S = 0.4; // reject reps shorter than this
export const REP_MIN_SPACING_S = 1.0; // min time between rep peaks (keep the deeper one)
export const REP_AMP_MIN = 0.2; // min oscillation (fraction of ROM) or no reps
export const REP_PROMINENCE_FRAC = 0.22; // peak must rise this * body-scale above neighbours

// --- Bounce (bouncing out of the bottom of the rep) ---
export const BOUNCE_MAX_PAUSE_S = 0.12; // pause shorter than this at the bottom ...
export const BOUNCE_MIN_REBOUND_VEL = 2.5; // ... plus fast rebound (d units/s) => bounce

// --- Squat analysis (back/front barbell squat) ---
// The tracked signal is HIP height: the lifter stands tall at the top (small y)
// and drops at the bottom (large y), so local maxima of hip height are rep
// bottoms, which the generic rep FSM segments using these thresholds. Scale
// reference is LEG length (femur+shin), which is rigid and camera-depth
// invariant, unlike hip-to-ankle vertical distance.
export const SQUAT_BAR_SMOOTH_WINDOW_S = 0.3; // moving-average window on the hip signal
export const SQUAT_REP_TOP_THRESHOLD = 0.15; // "stood up" boundary; touch-and-go reps fall back to the trough
export const SQUAT_REP_BOTTOM_THRESHOLD = 0.6; // a depth peak must reach this fraction of the set ROM
export const SQUAT_MIN_REP_DURATION_S = 0.6; // reject reps shorter than this (trough -> trough)
export const SQUAT_REP_MIN_SPACING_S = 0.8; // min time between depth peaks (keep the deeper one)
export const SQUAT_REP_PROMINENCE_FRAC = 0.25; // depth peak must rise this * leg-length above neighbouring standing
export const SQUAT_REP_AMP_MIN = 0.2; // min clip oscillation (fraction of ROM) or no reps

// Person-consistency gate: the lifter is the large, roughly stationary subject.
// Frames whose torso-center x deviates too far, or whose body scale is too small,
// are bystanders / occlusion flips (e.g. the lifter hidden behind the plates) and
// are dropped, then bridged by interpolation so the hip signal stays continuous.
export const SQUAT_CONF_THRESHOLD = 0.25; // min shoulder/hip keypoint confidence for a usable frame
export const SQUAT_CENTER_TOL_FRAC = 1.6; // reject if |center.x - median center.x| > this * median scale
export const SQUAT_SCALE_MIN_FRAC = 0.5; // reject if leg length < this * median leg length (far bystander)

// Depth (interior knee angle hip-knee-ankle; 180 = standing, smaller = deeper).
// "Depth past 90 degrees" of knee flexion == interior angle below 90.
export const SQUAT_ABOVE_PARALLEL_DEG = 110; // min knee angle above this => shallow (above parallel)
export const SQUAT_PARALLEL_DEG = 95; // at/below this (or hips below knees) => at least parallel
export const SQUAT_MIN_KNEE_FLEXION_DEG = 145; // a real rep must bend the knee below this at some point
// Forward torso lean from vertical (shoulder->hip vs. gravity), degrees.
export const SQUAT_TORSO_LEAN_WARN_DEG = 60; // sustained lean beyond this => good-morning / chest-drop risk
export const SQUAT_DEPTH_ASYM_THRESHOLD = 0.12; // |L-R hip height| / leg over the rep => asymmetric

// --- OpenAI coach ---
// GPT-4-class model with Structured Outputs + streaming support. Swap this one
// line to change models; the app still reads only OPENAI_API_KEY from the env.
export const OPENAI_MODEL = "gpt-4o";
