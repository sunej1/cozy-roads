import * as THREE from 'three/webgpu';
import { mix, positionWorld, smoothstep, texture, uniform, vec2 } from 'three/tsl';

const SIZE = 320;
const STEP = 48;

// Sweep toward the lee side from the sun-facing edge. The running envelope
// stores the highest upstream blocker projected down to each point.
export function mountainLight(world, sun) {
  const data = new Uint16Array(SIZE * SIZE);
  const map = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat, THREE.HalfFloatType);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  const origin = uniform(new THREE.Vector2());
  const uv = vec2(positionWorld.x, positionWorld.z.negate())
    .sub(origin)
    .div(SIZE * STEP);
  const blocker = texture(map, uv).r;
  const border = uv.min(uv.oneMinus());
  const interior = border.x.min(border.y);
  const visibility = mix(1, smoothstep(-8, 24, positionWorld.y.sub(blocker)), smoothstep(0.025, 0.09, interior));
  let activeX, activeS, pending;
  const back = new Uint16Array(SIZE * SIZE);
  function update(car, eager = false) {
    const x = Math.round(car.x / 1536) * 1536 - (SIZE * STEP) / 2;
    const s = Math.round(car.s / 1536) * 1536 - (SIZE * STEP) / 2;
    if (x === activeX && s === activeS) {
      pending = null;
      return;
    }
    if (!pending || pending.x !== x || pending.s !== s) {
      pending = {
        x,
        s,
        column: 0,
        previous: new Float32Array(SIZE).fill(-2000),
        next: new Float32Array(SIZE),
        rows: Array.from({ length: SIZE }, (_, j) => world.section(s + (j + 0.5) * STEP)),
      };
    }
    const { rows } = pending;
    const drift = sun.z / -sun.x,
      drop = (STEP * sun.y) / -sun.x;
    const end = eager || activeX === undefined ? SIZE : Math.min(SIZE, pending.column + 4);
    for (let i = pending.column; i < end; i++) {
      const { previous, next } = pending;
      const wx = x + (i + 0.5) * STEP;
      for (let j = 0; j < SIZE; j++) {
        const height = world.sampleTerrain(rows[j], wx - rows[j].x);
        const upstream = previous[j] + (previous[Math.max(0, j - 1)] - previous[j]) * drift - drop;
        back[j * SIZE + i] = THREE.DataUtils.toHalfFloat(upstream);
        next[j] = Math.max(height, upstream);
      }
      pending.previous = next;
      pending.next = previous;
    }
    pending.column = end;
    if (end < SIZE) return;
    data.set(back);
    origin.value.set(x, s);
    activeX = x;
    activeS = s;
    pending = null;
    map.needsUpdate = true;
  }
  return { visibility, update };
}
