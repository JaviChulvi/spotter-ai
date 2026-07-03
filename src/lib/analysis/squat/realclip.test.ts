import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Frame, Keypoints } from "../keypoints";
import { analyzeSquatSet } from "./analyze";
import { PersonTracker } from "../../pose/tracker";
import { boxArea, type Detection } from "../../pose/decode";

// Validates the squat engine + person tracker against REAL keypoints dumped from
// IMG_5057.MOV by scripts/dump_pose.py (same yolo26n-pose model the browser runs,
// now with every candidate person per frame). Skipped when the dump is absent.
const DUMP = path.resolve(process.cwd(), "scratchpad/pose_5057.json");

interface Person {
  box: [number, number, number, number];
  score: number;
  kp: [number, number, number][];
}
interface Dump {
  fps: number;
  frames: { t: number; kp: [number, number, number][] | null; persons: Person[] }[];
}

const toKp = (kp: [number, number, number][]): Keypoints =>
  kp.map(([x, y, c]) => ({ x, y, c })) as Keypoints;
const toDet = (p: Person): Detection => ({
  score: p.score,
  box: p.box,
  keypoints: p.kp.map(([x, y, c]) => ({ x, y, c })),
});
const largest = (ps: Person[]): Person | null =>
  ps.length
    ? ps.reduce((a, b) => (boxArea(b.box) > boxArea(a.box) ? b : a))
    : null;

const maybe = existsSync(DUMP) ? describe : describe.skip;

maybe("analyzeSquatSet + PersonTracker on IMG_5057.MOV", () => {
  const dump = JSON.parse(readFileSync(DUMP, "utf8")) as Dump;

  // Replay every frame's candidates through the tracker (the browser pipeline).
  const tracker = new PersonTracker();
  const trackedFrames: Frame[] = [];
  let corrected = 0; // frames where the tracker avoided the old "largest box" pick
  for (const f of dump.frames) {
    const pick = tracker.select(f.persons.map(toDet));
    const big = largest(f.persons);
    // old behaviour used `big` every frame; count where the tracker differs
    if (big && (!pick || pick.keypoints[0].x !== big.kp[0][0])) corrected++;
    if (pick) trackedFrames.push({ t: f.t, kp: toKp(pick.keypoints.map((k) => [k.x, k.y, k.c] as [number, number, number])) });
  }
  const a = analyzeSquatSet(trackedFrames);

  it("prints tracked analysis + how many bystander/occlusion frames it corrected", () => {
    console.log(
      JSON.stringify(
        {
          totalFrames: dump.frames.length,
          trackedFrames: trackedFrames.length,
          correctedFrames: corrected,
          repCount: a.repCount,
          repsToDepth: `${a.formFlags.repsAtDepth}/${a.repCount}`,
          meanMinKneeAngle: a.formFlags.meanMinKneeAngle,
          detectionConfidence: a.detectionConfidence,
          cameraView: a.cameraView,
          velocityLossPct: a.fatigue.velocityLossPct,
        },
        null,
        2,
      ),
    );
    expect(a.repCount).toBeGreaterThan(0);
  });

  it("still counts the ~11 reps with the tracker in the loop", () => {
    expect(a.repCount).toBeGreaterThanOrEqual(10);
    expect(a.repCount).toBeLessThanOrEqual(12);
  });

  it("corrects the bystander/occlusion frames the old per-frame pick would use", () => {
    // there ARE multi-person frames + occlusion in this clip, so the tracker must
    // diverge from a naive largest-box pick on a meaningful number of them
    expect(corrected).toBeGreaterThan(5);
  });

  it("keeps depth, velocity and tempo sane for every rep", () => {
    const parallelish = a.reps.filter((r) => r.atLeastParallel).length;
    expect(parallelish / a.repCount).toBeGreaterThanOrEqual(0.8);
    for (const r of a.reps) {
      expect(r.totalS).toBeGreaterThan(0.5);
      expect(r.eccentricS).toBeGreaterThan(0);
      expect(r.eccentricS).toBeLessThan(2.5);
      expect(r.concentricS).toBeGreaterThan(0);
      expect(r.concentricS).toBeLessThan(2.5);
      expect(r.meanConcentricVel).toBeGreaterThan(0);
    }
  });
});
