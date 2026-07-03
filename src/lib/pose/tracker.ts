// Single-person tracker: locks onto the lifter (the nearest / largest person)
// and follows them across frames, so a background bystander who briefly becomes
// the largest box — e.g. when the lifter is hidden behind the plates at the
// bottom of a rep — is never picked up.
//
// Per frame it is handed every detection above the confidence threshold and:
//  - with no current lock, acquires the largest (nearest) box;
//  - with a lock, keeps only detections close to and similar in size to the
//    tracked subject, then takes the largest of those;
//  - if none qualify (the subject is occluded / gone) it returns null and coasts,
//    holding the lock for a short while before re-acquiring. Returning null (not a
//    wrong person) lets the overlay/live-counter/analysis simply skip the frame.
import { Detection, boxArea } from "./decode";

interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

// The subject's box may move up to this fraction of its own diagonal between
// processed frames, and shrink to this fraction of its diagonal (a deep squat
// compresses the box) and still count as the same person.
const GATE_DIST_FRAC = 1.0;
const MIN_SIZE_RATIO = 0.5;
// Keep the lock through this many consecutive missed frames (occlusion) before
// giving up and re-acquiring the largest person.
const MAX_COAST_FRAMES = 15;
// Exponential smoothing of the tracked box (stabilizes the gate, damps jitter).
const BOX_EMA = 0.5;

function toBox(b: [number, number, number, number]): Box {
  return {
    cx: (b[0] + b[2]) / 2,
    cy: (b[1] + b[3]) / 2,
    w: Math.abs(b[2] - b[0]),
    h: Math.abs(b[3] - b[1]),
  };
}
function diag(b: Box): number {
  return Math.hypot(b.w, b.h);
}

export class PersonTracker {
  private last: Box | null = null;
  private misses = 0;

  reset(): void {
    this.last = null;
    this.misses = 0;
  }

  /** Pick the tracked subject from this frame's detections (or null if missing). */
  select(candidates: Detection[]): Detection | null {
    if (!candidates.length) return this.miss();
    if (this.last === null) return this.acquire(candidates);

    const last = this.last;
    const d = diag(last) || 1;
    let best: Detection | null = null;
    let bestArea = -1;
    for (const c of candidates) {
      const b = toBox(c.box);
      const dist = Math.hypot(b.cx - last.cx, b.cy - last.cy);
      const sizeRatio = diag(b) / d;
      if (dist <= GATE_DIST_FRAC * d && sizeRatio >= MIN_SIZE_RATIO) {
        const a = boxArea(c.box);
        if (a > bestArea) {
          bestArea = a;
          best = c;
        }
      }
    }
    if (!best) return this.miss();

    this.misses = 0;
    const b = toBox(best.box);
    this.last = {
      cx: BOX_EMA * b.cx + (1 - BOX_EMA) * last.cx,
      cy: BOX_EMA * b.cy + (1 - BOX_EMA) * last.cy,
      w: BOX_EMA * b.w + (1 - BOX_EMA) * last.w,
      h: BOX_EMA * b.h + (1 - BOX_EMA) * last.h,
    };
    return best;
  }

  private acquire(candidates: Detection[]): Detection {
    let best = candidates[0];
    let bestArea = boxArea(best.box);
    for (let i = 1; i < candidates.length; i++) {
      const a = boxArea(candidates[i].box);
      if (a > bestArea) {
        bestArea = a;
        best = candidates[i];
      }
    }
    this.last = toBox(best.box);
    this.misses = 0;
    return best;
  }

  private miss(): null {
    this.misses++;
    if (this.misses > MAX_COAST_FRAMES) this.last = null; // give up; re-acquire next time
    return null;
  }
}
