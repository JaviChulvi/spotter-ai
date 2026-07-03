// One-Euro filter (Casiez et al.) to stabilize keypoint jitter before the
// analysis reads angles and velocities. Pure math — testable in Node.

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPass {
  private s: number | undefined;
  filter(x: number, a: number): number {
    this.s = this.s === undefined ? x : a * x + (1 - a) * this.s;
    return this.s;
  }
}

export class OneEuro {
  private xLp = new LowPass();
  private dxLp = new LowPass();
  private lastT: number | undefined;
  private lastX: number | undefined;

  constructor(
    private minCutoff = 1.5,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  filter(x: number, t: number): number {
    if (this.lastT === undefined || t <= this.lastT) {
      this.lastT = t;
      this.lastX = x;
      return this.xLp.filter(x, 1);
    }
    const dt = t - this.lastT;
    this.lastT = t;
    const dx = (x - (this.lastX ?? x)) / dt;
    this.lastX = x;
    const edx = this.dxLp.filter(dx, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xLp.filter(x, alpha(cutoff, dt));
  }
}

export interface XYC {
  x: number;
  y: number;
  c: number;
}

/** Smooths the x/y of each keypoint independently; confidence passes through. */
export class KeypointSmoother {
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];

  constructor(count: number, minCutoff = 1.5, beta = 0.02) {
    for (let i = 0; i < count; i++) {
      this.fx.push(new OneEuro(minCutoff, beta));
      this.fy.push(new OneEuro(minCutoff, beta));
    }
  }

  smooth(kp: XYC[], t: number): XYC[] {
    return kp.map((p, i) => ({
      x: this.fx[i].filter(p.x, t),
      y: this.fy[i].filter(p.y, t),
      c: p.c,
    }));
  }
}
