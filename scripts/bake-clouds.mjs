import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { randomFor, smooth } from '../src/route.js';

import {
  CLOUD_WIDTH as width,
  CLOUD_LAYERS as layers,
  CLOUD_BOTTOM as bottom,
  CLOUD_TOP as top,
  CLOUD_SCALE_X,
  CLOUD_SCALE_Z,
  SUN_DIRECTION,
} from '../src/cloud-field.js';

// Keep density and its sunward attenuation together so a sky ray needs one lookup per step.
function cloudNoise() {
  const size = 64,
    cells = 6,
    rng = randomFor(31715);
  const values = Float32Array.from({ length: cells ** 3 * 4 }, () => rng());
  const pixels = new Uint8Array(size ** 3 * 4);
  const wrap = (n) => (n + cells) % cells;
  const point = (x, y, z) => ((wrap(z) * cells + wrap(y)) * cells + wrap(x)) * 4;
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const [px, py, pz] = [x, y, z].map((n) => (n * cells) / size);
        const i = Math.floor(px),
          j = Math.floor(py),
          k = Math.floor(pz);
        let distance = 2,
          broad = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const n = point(i + dx, j + dy, k + dz);
              const ex = i + dx + values[n] - px,
                ey = j + dy + values[n + 1] - py,
                ez = k + dz + values[n + 2] - pz;
              distance = Math.min(distance, ex * ex + ey * ey + ez * ez);
              if (dx < 0 || dy < 0 || dz < 0) continue;
              const weight = (v, side) => {
                const a = v * v * (3 - 2 * v);
                return side ? a : 1 - a;
              };
              broad += values[n + 3] * weight(px - i, dx) * weight(py - j, dy) * weight(pz - k, dz);
            }
        const at = ((z * size + y) * size + x) * 4;
        pixels[at] = Math.round(255 * broad);
        pixels[at + 1] = Math.round(255 * Math.max(0, 1 - Math.sqrt(distance)));
        pixels[at + 3] = 255;
      }
  return pixels;
}

const noise = cloudNoise();
const samples = 64;
function sample(x, y, z, channel) {
  x = x * samples - 0.5;
  y = y * samples - 0.5;
  z = z * samples - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  let value = 0;
  for (let k = 0; k < 2; k++)
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const index = ((((iz + k) & 63) * 64 + ((iy + j) & 63)) * 64 + ((ix + i) & 63)) * 4;
        value += noise[index + channel] * (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz);
      }
  return value / 255;
}

function density(x, h, z) {
  if (h <= bottom || h >= top) return 0;
  const t = (h - bottom) / (top - bottom);
  const weather = sample(x, 0.42, z, 0);
  const ceiling = 0.47 + 0.51 * weather;
  const lift = smooth(0, 0.17, t) * (1 - smooth(ceiling - 0.23, ceiling + 0.12, t));
  const y = t * 0.48 + 0.19;
  const core = 0.84 * sample(x, y, z, 0) + 0.28 * sample(x * 2, y, z * 2, 1);
  const billows = 0.21 * sample(x * 4 + 0.37, y * 1.9, z * 4 + 0.37, 1)
    + 0.075 * sample(x * 11 - 0.21, y * 3, z * 11 - 0.21, 1);
  return Math.max(0, core + billows + 0.23 * weather - 0.79) * 4.7 * lift;
}
const [sunX, sunY, sunZ] = SUN_DIRECTION.map((v) => v / Math.hypot(...SUN_DIRECTION));
const data = new Uint8Array(width * layers * width * 2);
for (let z = 0; z < width; z++)
  for (let y = 0; y < layers; y++)
    for (let x = 0; x < width; x++) {
      const px = (x + 0.5) / width,
        pz = (z + 0.5) / width,
        h = bottom + (y / (layers - 1)) * (top - bottom);
      const ahead = (d) => density(px + d * sunX * CLOUD_SCALE_X, h + d * sunY, pz + d * sunZ * CLOUD_SCALE_Z);
      const offset = ((z * layers + y) * width + x) * 2;
      data[offset] = Math.round(Math.min(1, density(px, h, pz) / 2) * 255);
      const optical = ahead(65) + ahead(190) + ahead(355) + ahead(565) + ahead(830);
      data[offset + 1] = Math.round((0.16 + 0.84 * Math.exp(-optical * 1.48)) * 255);
    }
// Integrate sunlight once per ground column. Receivers then project onto this
// plane with parallax at their own elevation, including the reflective lake.
const shade = new Uint8Array(width * width);
for (let z = 0; z < width; z++) {
  for (let x = 0; x < width; x++) {
    let optical = 0;
    for (let k = 0; k < 16; k++) {
      const h = bottom + ((k + 0.5) / 16) * (top - bottom);
      const d = (h - bottom) / sunY;
      optical += density((x + 0.5) / width + d * sunX * CLOUD_SCALE_X, h, (z + 0.5) / width + d * sunZ * CLOUD_SCALE_Z);
    }
    shade[z * width + x] = Math.round(255 * (0.20 + 0.80 * Math.exp(-optical * 0.165)));
  }
}
writeFileSync(new URL('../assets/cloud-field.bin', import.meta.url), gzipSync(Buffer.concat([data, shade]), { level: 9 }));
