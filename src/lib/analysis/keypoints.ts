// COCO-17 keypoint model, skeleton edges, and geometry helpers.
import { clamp } from "./util";

/** A single 2D keypoint with a detection confidence in [0,1]. */
export interface Point {
  x: number;
  y: number;
  c: number;
}

/** 17 COCO keypoints, in COCO order. Image coordinates (y grows downward). */
export type Keypoints = Point[];

/** One video frame: timestamp (seconds) + detected keypoints. */
export interface Frame {
  t: number;
  kp: Keypoints;
}

/** COCO-17 keypoint indices. */
export const KP = {
  nose: 0,
  leftEye: 1,
  rightEye: 2,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
  leftKnee: 13,
  rightKnee: 14,
  leftAnkle: 15,
  rightAnkle: 16,
} as const;

export const NUM_KEYPOINTS = 17;

/** Skeleton edges for drawing the overlay. */
export const SKELETON: ReadonlyArray<readonly [number, number]> = [
  [5, 7],
  [7, 9], // left arm
  [6, 8],
  [8, 10], // right arm
  [5, 6], // shoulders
  [5, 11],
  [6, 12],
  [11, 12], // torso
  [11, 13],
  [13, 15], // left leg
  [12, 14],
  [14, 16], // right leg
  [0, 5],
  [0, 6], // head to shoulders
];

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, c: Math.min(a.c, b.c) };
}

/** Interior angle (degrees) at vertex `b` formed by segments b->a and b->c. */
export function angleDeg(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return NaN;
  const dot = v1x * v2x + v1y * v2y;
  return (Math.acos(clamp(dot / (m1 * m2), -1, 1)) * 180) / Math.PI;
}

/** Confidence-aware midpoint of the two shoulders. */
export function shoulderMid(kp: Keypoints): Point {
  return midpoint(kp[KP.leftShoulder], kp[KP.rightShoulder]);
}

/** Confidence-aware midpoint of the two hips. */
export function hipMid(kp: Keypoints): Point {
  return midpoint(kp[KP.leftHip], kp[KP.rightHip]);
}
