import { describe, it, expect } from "vitest";
import { PersonTracker } from "./tracker";
import type { Detection } from "./decode";

// box [x1,y1,x2,y2]; tag rides in keypoint[0].x so we can tell who was picked.
function det(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tag: number,
): Detection {
  return {
    score: 0.9,
    box: [x1, y1, x2, y2],
    keypoints: Array.from({ length: 17 }, () => ({ x: tag, y: 0, c: 0.9 })),
  };
}
const tagOf = (d: Detection | null) => (d ? d.keypoints[0].x : null);

const LIFTER = () => det(400, 200, 600, 900, 1); // big, centered (nearest)
const BYSTANDER = () => det(50, 300, 120, 600, 2); // small, far left

describe("PersonTracker", () => {
  it("acquires the largest (nearest) person, then follows it past a bystander", () => {
    const t = new PersonTracker();
    expect(tagOf(t.select([BYSTANDER(), LIFTER()]))).toBe(1);
    // lifter drifts slightly; bystander still present -> stays locked on lifter
    expect(tagOf(t.select([BYSTANDER(), det(410, 210, 610, 910, 1)]))).toBe(1);
  });

  it("returns null (coasts) instead of jumping to a bystander when occluded", () => {
    const t = new PersonTracker();
    t.select([LIFTER()]); // lock
    expect(t.select([BYSTANDER()])).toBeNull();
    expect(t.select([BYSTANDER()])).toBeNull();
    // lifter reappears near its last position -> re-locks
    expect(tagOf(t.select([BYSTANDER(), det(405, 205, 605, 905, 1)]))).toBe(1);
  });

  it("keeps the lock through a deep squat that shrinks the box", () => {
    const t = new PersonTracker();
    t.select([LIFTER()]); // standing
    // crouched: shorter + a bit wider, center drops
    expect(tagOf(t.select([det(390, 450, 620, 900, 1)]))).toBe(1);
  });

  it("re-acquires the largest person after a long occlusion", () => {
    const t = new PersonTracker();
    t.select([LIFTER()]);
    for (let i = 0; i < 16; i++) t.select([BYSTANDER()]); // exceed the coast window
    // lock dropped -> next frame acquires whoever is largest present
    expect(tagOf(t.select([BYSTANDER()]))).toBe(2);
  });

  it("returns null when there are no detections", () => {
    const t = new PersonTracker();
    expect(t.select([])).toBeNull();
    t.select([LIFTER()]);
    expect(t.select([])).toBeNull();
  });

  it("re-acquires after reset()", () => {
    const t = new PersonTracker();
    t.select([LIFTER()]);
    t.reset();
    // after reset, a lone bystander is acquired as the new (only) subject
    expect(tagOf(t.select([BYSTANDER()]))).toBe(2);
  });
});
