// Small numeric helpers used across the analysis engine. Pure functions.

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Linear-interpolated percentile (p in 0..100). */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = clamp((p / 100) * (s.length - 1), 0, s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  const f = idx - lo;
  return s[lo] * (1 - f) + s[hi] * f;
}

export function median(xs: number[]): number {
  return percentile(xs, 50);
}

export function argmax(xs: number[]): number {
  let bi = -1;
  let bv = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] > bv) {
      bv = xs[i];
      bi = i;
    }
  }
  return bi;
}

/**
 * Centered, time-windowed moving average. Denoises a per-frame signal so jitter
 * doesn't create phantom peaks. `winS` is the full window in seconds; `t` is the
 * matching timestamp array (assumed roughly uniform).
 */
export function movingAverage(y: number[], t: number[], winS: number): number[] {
  const n = y.length;
  if (n < 3) return y.slice();
  const dt = (t[n - 1] - t[0]) / (n - 1);
  const half = Math.max(0, Math.round(winS / Math.max(dt, 1e-6) / 2));
  if (half === 0) return y.slice();
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + y[i];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
  }
  return out;
}

/** Most frequent value. Returns undefined for empty input. */
export function mode<T extends string | number>(xs: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | undefined;
  let bc = -1;
  for (const [k, v] of counts) {
    if (v > bc) {
      bc = v;
      best = k;
    }
  }
  return best;
}
