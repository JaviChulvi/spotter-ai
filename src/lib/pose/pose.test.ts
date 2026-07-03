import { describe, it, expect } from "vitest";
import { decodePose, FEATURES } from "./decode";
import { OneEuro } from "./smoothing";

describe("decodePose", () => {
  it("extracts the top-confidence person's keypoints from [1,56,N]", () => {
    const n = 3;
    const data = new Float32Array(FEATURES * n);
    const set = (f: number, a: number, v: number) => {
      data[f * n + a] = v;
    };
    // anchor 1 is the winner
    set(4, 0, 0.1);
    set(4, 1, 0.9);
    set(4, 2, 0.2);
    for (let i = 0; i < 17; i++) {
      set(5 + i * 3, 1, i * 10);
      set(6 + i * 3, 1, i * 10 + 1);
      set(7 + i * 3, 1, 0.8);
    }
    const det = decodePose(data, [1, FEATURES, n]);
    expect(det).not.toBeNull();
    expect(det!.score).toBeCloseTo(0.9);
    expect(det!.keypoints).toHaveLength(17);
    expect(det!.keypoints[5].x).toBeCloseTo(50);
    expect(det!.keypoints[5].y).toBeCloseTo(51);
    expect(det!.keypoints[16].c).toBeCloseTo(0.8);
  });

  it("handles anchor-major [1,N,56] layout", () => {
    const n = 2;
    const data = new Float32Array(n * FEATURES);
    data[0 * FEATURES + 4] = 0.2;
    data[1 * FEATURES + 4] = 0.95;
    data[1 * FEATURES + 5] = 123; // kp0.x of the winning anchor
    const det = decodePose(data, [1, n, FEATURES]);
    expect(det!.score).toBeCloseTo(0.95);
    expect(det!.keypoints[0].x).toBeCloseTo(123);
  });

  it("decodes YOLO26 end-to-end [1,300,57] (keypoints offset by 6, class at 5)", () => {
    const n = 300;
    const F = 57;
    const data = new Float32Array(n * F);
    data[0 * F + 4] = 0.88; // score
    data[0 * F + 5] = 0; // class
    for (let i = 0; i < 17; i++) {
      data[0 * F + 6 + i * 3] = i * 5;
      data[0 * F + 7 + i * 3] = i * 5 + 2;
      data[0 * F + 8 + i * 3] = 0.7;
    }
    const det = decodePose(data, [1, n, F]);
    expect(det).not.toBeNull();
    expect(det!.score).toBeCloseTo(0.88);
    expect(det!.keypoints[3].x).toBeCloseTo(15);
    expect(det!.keypoints[3].y).toBeCloseTo(17);
    expect(det!.keypoints[16].c).toBeCloseTo(0.7);
  });

  it("selects the largest person, not the highest-confidence one (bystander)", () => {
    const n = 300;
    const F = 57;
    const data = new Float32Array(n * F);
    // det0: small box, HIGH score (background bystander) — must NOT be chosen
    data[0 * F + 0] = 100;
    data[0 * F + 1] = 100;
    data[0 * F + 2] = 140;
    data[0 * F + 3] = 200; // 40 x 100
    data[0 * F + 4] = 0.9;
    data[0 * F + 6] = 999; // kp0.x of the bystander
    // det1: large box, lower score (the lifter, nearest the camera) — chosen
    data[1 * F + 0] = 10;
    data[1 * F + 1] = 10;
    data[1 * F + 2] = 600;
    data[1 * F + 3] = 500; // 590 x 490
    data[1 * F + 4] = 0.6;
    data[1 * F + 6] = 123; // kp0.x of the lifter
    const det = decodePose(data, [1, n, F]);
    expect(det!.score).toBeCloseTo(0.6);
    expect(det!.keypoints[0].x).toBeCloseTo(123);
  });

  it("returns null below the confidence threshold and for bad layouts", () => {
    const data = new Float32Array(FEATURES * 2);
    expect(decodePose(data, [1, FEATURES, 2])).toBeNull(); // all zero conf
    expect(decodePose(data, [1, 2, 3, 4])).toBeNull(); // unsupported dims
  });
});

describe("OneEuro", () => {
  it("passes a constant signal through unchanged", () => {
    const f = new OneEuro();
    let out = 0;
    for (let i = 0; i < 10; i++) out = f.filter(10, i / 30);
    expect(out).toBeCloseTo(10, 5);
  });

  it("damps a step (output lags the jump)", () => {
    const f = new OneEuro();
    f.filter(0, 0);
    const out = f.filter(10, 1 / 30);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(10);
  });
});
