function percentile(sorted, fraction) {
  const rank = (sorted.length - 1) * fraction;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

export function summarize(frames) {
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a - b);
  const total = frames.reduce((sum, frame) => sum + frame, 0);
  return {
    frames: frames.length,
    seconds: total / 1000,
    fps: 1000 * frames.length / total,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1),
    framesOver33Ms: frames.filter(frame => frame > 1000 / 30).length,
  };
}

export class RecentFrames {
  constructor(capacity = 180) {
    this.buffer = new Float64Array(capacity);
    this.clear();
  }

  clear() {
    this.position = 0;
    this.count = 0;
  }

  add(ms) {
    this.buffer[this.position] = ms;
    this.position = (this.position + 1) % this.buffer.length;
    this.count = Math.min(this.count + 1, this.buffer.length);
  }

  values() {
    if (this.count < this.buffer.length) return this.buffer.slice(0, this.count);
    const chronological = new Float64Array(this.count);
    chronological.set(this.buffer.subarray(this.position));
    chronological.set(this.buffer.subarray(0, this.position), this.count - this.position);
    return chronological;
  }
}

const RENDER_SCALES = [1, 0.94, 0.90];

export class ResolutionBudget {
  constructor() {
    this.reset();
  }

  reset(level = 0) {
    this.level = level;
    this.pressure = 0;
    this.fast = 0;
    this.cooldown = 0;
  }

  get scale() {
    return RENDER_SCALES[this.level];
  }

  observe(ms) {
    if (ms <= 0) return false;
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }
    this.pressure = Math.max(0, this.pressure + (ms > 36 ? 3 : -1));
    this.fast = ms < 20 ? this.fast + 1 : 0;
    let next = this.level;
    if (this.pressure >= 6) next = Math.min(this.level + 1, RENDER_SCALES.length - 1);
    else if (this.fast >= 540) next = Math.max(0, this.level - 1);
    if (next === this.level) return false;
    this.reset(next);
    this.cooldown = 12;
    return true;
  }
}
