import { describe, it, expect } from "vitest";
import { Frame, Keypoints, KP } from "../keypoints";
import { analyzeSquatSet } from "./analyze";
import { toSquatSetSummary } from "./summary";

// ---- synthetic side-view squat fixture ----
// phase 0 = standing tall (legs straight, ~180deg knee), phase 1 = deep bottom
// (knee bent ~60deg, hips below knees). All key joints interpolate linearly.
const STAND = {
  shoulder: [500, 200],
  hip: [500, 400],
  knee: [500, 650],
  ankle: [500, 900],
} as const;
const BOTTOM = {
  shoulder: [520, 480],
  hip: [460, 740],
  knee: [560, 720],
  ankle: [500, 900],
} as const;

function lerp(a: readonly number[], b: readonly number[], f: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function kpAtPhase(phase: number): Keypoints {
  const p = (xy: [number, number], dx: number, c = 0.9) => ({
    x: xy[0] + dx,
    y: xy[1],
    c,
  });
  const sh = lerp(STAND.shoulder, BOTTOM.shoulder, phase);
  const hip = lerp(STAND.hip, BOTTOM.hip, phase);
  const knee = lerp(STAND.knee, BOTTOM.knee, phase);
  const ank = lerp(STAND.ankle, BOTTOM.ankle, phase);
  const kp: Keypoints = Array.from({ length: 17 }, () => p(sh, 0));
  kp[KP.leftShoulder] = p(sh, -8);
  kp[KP.rightShoulder] = p(sh, 8);
  kp[KP.leftHip] = p(hip, -8);
  kp[KP.rightHip] = p(hip, 8);
  kp[KP.leftKnee] = p(knee, -8);
  kp[KP.rightKnee] = p(knee, 8);
  kp[KP.leftAnkle] = p(ank, -8);
  kp[KP.rightAnkle] = p(ank, 8);
  return kp;
}

interface Seg {
  to: number;
  dur: number;
}
function build(from: number, segs: Seg[], fps = 30): { t: number; phase: number }[] {
  const out = [{ t: 0, phase: from }];
  let t = 0;
  let cur = from;
  for (const s of segs) {
    const n = Math.max(1, Math.round(s.dur * fps));
    for (let i = 1; i <= n; i++) {
      t += 1 / fps;
      out.push({ t, phase: cur + (s.to - cur) * (i / n) });
    }
    cur = s.to;
  }
  return out;
}
function toFrames(pts: { t: number; phase: number }[]): Frame[] {
  return pts.map((p) => ({ t: p.t, kp: kpAtPhase(p.phase) }));
}
// stand -> descend 1.0s -> pause 0.3s -> ascend 0.8s -> stand
function cleanRep(depth = 1): Seg[] {
  return [
    { to: 0, dur: 0.5 },
    { to: depth, dur: 1.0 },
    { to: depth, dur: 0.3 },
    { to: 0, dur: 0.8 },
  ];
}

describe("analyzeSquatSet", () => {
  it("counts three clean deep reps with sane tempo and depth", () => {
    const frames = toFrames(build(0, [...cleanRep(), ...cleanRep(), ...cleanRep()]));
    const a = analyzeSquatSet(frames);
    expect(a.repCount).toBe(3);
    expect(a.cameraView).toBe("side");
    for (const r of a.reps) {
      expect(r.eccentricS).toBeGreaterThan(0.6);
      expect(r.eccentricS).toBeLessThan(1.4);
      expect(r.concentricS).toBeGreaterThan(0.4);
      expect(r.concentricS).toBeLessThan(1.2);
      expect(r.depth).toBe("below_parallel");
      expect(r.hipsBelowKnees).toBe(true);
      expect(r.atLeastParallel).toBe(true);
      expect(r.minKneeAngle).toBeLessThan(90);
      expect(r.meanConcentricVel).toBeGreaterThan(0);
    }
    expect(a.formFlags.shallowReps).toHaveLength(0);
    expect(a.formFlags.repsAtDepth).toBe(3);
  });

  it("detects zero reps when standing still", () => {
    const frames = toFrames(build(0, [{ to: 0, dur: 5 }]));
    const a = analyzeSquatSet(frames);
    expect(a.repCount).toBe(0);
    expect(a.caveats.length).toBeGreaterThan(0);
  });

  it("flags shallow (above-parallel) squats", () => {
    // phase 0.6 ~ knee stays ~135deg (above parallel) but the hips still travel
    // far enough to be a real rep, not a wobble.
    const frames = toFrames(
      build(0, [...cleanRep(0.6), ...cleanRep(0.6)]),
    );
    const a = analyzeSquatSet(frames);
    expect(a.repCount).toBe(2);
    for (const r of a.reps) {
      expect(r.atLeastParallel).toBe(false);
      expect(r.depth).toBe("above_parallel");
    }
    expect(a.formFlags.shallowReps).toEqual([0, 1]);
    expect(a.formFlags.repsAtDepth).toBe(0);
  });

  it("produces a squat coach summary DTO", () => {
    const frames = toFrames(build(0, [...cleanRep(), ...cleanRep()]));
    const a = analyzeSquatSet(frames);
    const s = toSquatSetSummary(a);
    expect(s.exercise).toBe("squat");
    expect(s.reps).toBe(2);
    expect(s.per_rep).toHaveLength(2);
    expect(s.per_rep[0].depth).toBe("below_parallel");
    expect(typeof s.fatigue.velocity_loss_pct).toBe("number");
  });
});
