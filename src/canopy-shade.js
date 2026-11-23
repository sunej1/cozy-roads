import * as THREE from 'three/webgpu';
import { positionWorld, smoothstep, texture, uniform } from 'three/tsl';
import { CHUNK_LENGTH } from './route.js';

const SIZE = 192,
  STEP = 1.25,
  SPAN = SIZE * STEP;

export function canopyShade() {
  const data = new Uint8Array(SIZE * SIZE);
  const map = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  const origin = uniform(new THREE.Vector2());
  function coverAt(point) {
    const uv = point.sub(origin).div(SPAN);
    const edge = uv.min(uv.oneMinus());
    return texture(map, uv).level(0).r.mul(smoothstep(0, 0.08, edge.x.min(edge.y)));
  }
  const cover = coverAt(positionWorld.xz);
  let revision;
  function update(car, chunks, terrainRevision) {
    const x = Math.round(car.x / 32) * 32 - SPAN / 2,
      z = Math.round(-car.s / 32) * 32 - SPAN / 2;
    if (revision === terrainRevision && x === origin.value.x && z === origin.value.y) return;
    revision = terrainRevision;
    origin.value.set(x, z);
    data.fill(0);
    for (const chunk of chunks.values()) {
      if (chunk.id * CHUNK_LENGTH > -z + 12 || (chunk.id + 1) * CHUNK_LENGTH < -z - SPAN - 12) continue;
      for (const trees of [chunk.trees, chunk.aspens]) {
        const matrices = trees.instanceMatrix.array;
        for (let i = 0; i < trees.count * 16; i += 16) {
          const u = (matrices[i + 12] - x) / STEP - 0.5,
            v = (matrices[i + 14] - z) / STEP - 0.5;
          const radius = (3.5 * Math.hypot(matrices[i], matrices[i + 1], matrices[i + 2])) / STEP;
          if (u + radius < 0 || u - radius >= SIZE || v + radius < 0 || v - radius >= SIZE) continue;
          for (let j = Math.max(0, Math.ceil(v - radius)); j <= Math.min(SIZE - 1, v + radius); j++) {
            for (let k = Math.max(0, Math.ceil(u - radius)); k <= Math.min(SIZE - 1, u + radius); k++) {
              const weight = Math.max(0, 1 - ((k - u) ** 2 + (j - v) ** 2) / (radius * radius));
              const index = j * SIZE + k;
              data[index] += Math.round((255 - data[index]) * weight * weight * 0.72);
            }
          }
        }
      }
    }
    map.needsUpdate = true;
  }
  return { ambient: cover.oneMinus(), cover, coverAt, update };
}
