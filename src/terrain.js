import { CHUNK_LENGTH, mix, noise, ROAD_EDGE, smooth } from './route.js';

export const TERRAIN_STEP = 4;

const negativeColumns = [
  -960, -780, -668, -570, -500, -448, -405, -375, -346, -321, -297, -272,
  -250, -228, -208, -190, -171, -153, -136, -119, -103, -89, -77, -65, -55,
  -47, -40, -33, -27, -22, -17, -13, -10, -8, -6.4, -ROAD_EDGE,
];
const refined = negativeColumns.flatMap((x, i) => {
  const next = negativeColumns[i + 1] ?? 0;
  const count = Math.ceil((next - x) / 24);
  return Array.from({length: count}, (_, j) => mix(x, next, j / count));
});
export const TERRAIN_COLUMNS = [...refined, 0, ...refined.slice().reverse().map(n => -n)];
const BAND_WIDTH = 768;
const MAIN_EDGE = TERRAIN_COLUMNS.at(-1);

export function terrainBand(lateral) {
  const distance = Math.abs(lateral);
  return distance < MAIN_EDGE ? 0 : Math.sign(lateral) * (1 + Math.floor((distance - MAIN_EDGE) / BAND_WIDTH));
}

export function bandBounds(band) {
  if (band === 0) return [-MAIN_EDGE, MAIN_EDGE];
  const start = MAIN_EDGE + (Math.abs(band) - 1) * BAND_WIDTH;
  return band > 0 ? [start, start + BAND_WIDTH] : [-start - BAND_WIDTH, -start];
}

const extraOffsets = Array.from({ length: BAND_WIDTH / 16 + 1 }, (_, index) => index * 16);
const offsetCache = new Map();

function bandColumns(band) {
  if (band === 0) return TERRAIN_COLUMNS;
  if (!offsetCache.has(band)) {
    const [start] = bandBounds(band);
    offsetCache.set(band, extraOffsets.map(offset => start + offset));
    if (offsetCache.size > 16) offsetCache.delete(offsetCache.keys().next().value);
  }
  return offsetCache.get(band);
}
const rows = CHUNK_LENGTH / TERRAIN_STEP + 1;

function linearColor(hex) {
  return [16, 8, 0].map(shift => {
    const n = ((hex >> shift) & 255) / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
}

const pine = linearColor(0x345136);
const grass = linearColor(0x748150);
const gravel = linearColor(0x998a71);
const rock = linearColor(0x7a797a);
const snow = linearColor(0xf4f3ea);
const lakebed = linearColor(0x586656);

function waterMesh(world, scanlines) {
  const positions = [];
  const shore = [];
  const indices = [];
  const lastRow = new Map();
  const segments = 12;

  for (let row = 0; row < rows; row++) {
    const sample = scanlines[row + 1];
    for (const lake of sample.lakes) {
      if (Math.abs(lake.t) > 1.10) continue;
      const halfWidth = lake.width * Math.sqrt(Math.max(0, 1 - lake.t ** 2)) + 14;
      const start = positions.length / 3;
      for (let j = 0; j <= segments; j++) {
        const lateral = lake.lateral + halfWidth * (2 * j / segments - 1);
        positions.push(sample.x + lateral, 0, -sample.s);
        shore.push(world.shoreDistance(sample, lateral));
      }
      const previous = lastRow.get(lake.s);
      if (previous?.row === row - 1) {
        for (let j = 0; j < segments; j++) {
          const a = previous.start + j;
          const b = start + j;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      lastRow.set(lake.s, { row, start });
    }
  }

  return indices.length ? {
    position: new Float32Array(positions),
    shore: new Float32Array(shore),
    index: new Uint16Array(indices),
  } : null;
}

export function buildTerrain(world, id, band = 0) {
  const offsets = bandColumns(band);
  const columns = offsets.length;
  const start = id * CHUNK_LENGTH;
  // The extra rows give neighboring tiles the same normals at their shared edge.
  const scanlines = Array.from({ length: rows + 2 }, (_, i) => world.section(start + (i - 1) * TERRAIN_STEP));
  const heights = scanlines.map(row => offsets.map(x => world.sampleTerrain(row, x)));
  const position = new Float32Array(rows * columns * 3);
  const normal = new Float32Array(position.length);
  const color = new Float32Array(position.length);
  const index = new Uint16Array((rows - 1) * (columns - 1) * 6);
  let face = 0;

  for (let i = 0; i < rows; i++) {
    const row = scanlines[i + 1];
    const yValues = heights[i + 1];
    const roadCurve = scanlines[i + 2].x - scanlines[i].x;
    for (let j = 0; j < columns; j++) {
      const vertex = i * columns + j;
      const k = vertex * 3;
      const lateral = offsets[j];
      const y = yValues[j];
      position[k] = row.x + lateral;
      position[k + 1] = y;
      position[k + 2] = -row.s;
      const left = Math.max(0, j - 1);
      const right = Math.min(columns - 1, j + 1);
      const edge = j === 0 || j === columns - 1;
      const dx = edge ? 32 : offsets[right] - offsets[left];
      const across = edge ? world.sampleTerrain(row, lateral + 16) - world.sampleTerrain(row, lateral - 16)
        : yValues[right] - yValues[left];
      const along = heights[i + 2][j] - heights[i][j];
      const nx = -across * 2 * TERRAIN_STEP;
      const ny = dx * 2 * TERRAIN_STEP;
      const nz = dx * along - roadCurve * across;
      const length = Math.hypot(nx, ny, nz);
      normal[k] = nx / length;
      normal[k + 1] = ny / length;
      normal[k + 2] = nz / length;
      const mottling = noise(position[k] / 25 + world.seed % 7001, row.s / 45);
      const clearing = mix(0.42, 0.94, mottling) * (1.42 - row.trees * 0.60);
      const exposed = Math.max(smooth(77, 176, y), 1 - smooth(0.37, 0.79, ny / length));
      const snowline = smooth(198, 315, y + (mottling - 0.5) * 80) * smooth(0.37, 0.82, ny / length);
      const nearRoad = 1 - smooth(5.0, 11, Math.abs(lateral));
      const nearWater = 1 - smooth(0, 5.5, y);
      for (let channel = 0; channel < 3; channel++) {
        const land = mix(mix(pine[channel], grass[channel], Math.min(1, clearing)), rock[channel], exposed * 0.88);
        const upper = mix(land, snow[channel], snowline);
        const bank = mix(lakebed[channel], gravel[channel], smooth(-1, 0.7, y));
        color[k + channel] = mix(mix(upper, bank, nearWater * 0.70), gravel[channel], nearRoad * 0.85)
          * (0.78 + mottling * 0.35);
      }

      if (i > 0 && j > 0) {
        const a = vertex - columns - 1;
        const b = a + 1;
        const c = vertex - 1;
        index.set([a, b, c, b, vertex, c], face);
        face += 6;
      }
    }
  }
  return { position, normal, color, index, water: band === 0 ? waterMesh(world, scanlines) : null };
}

export function tileSurface(data, id, s, x, band = 0) {
  const offsets = bandColumns(band);
  const columns = offsets.length;
  const local = Math.max(0, Math.min((s - id * CHUNK_LENGTH) / TERRAIN_STEP, rows - 1));
  const row = Math.min(rows - 2, Math.floor(local));
  const v = local - row;
  const lateral = x - mix(data.position[row * columns * 3], data.position[(row + 1) * columns * 3], v) + offsets[0];
  const next = offsets.findIndex(offset => offset > lateral);
  const right = next < 0 ? columns - 1 : Math.max(1, next);
  const left = right - 1;
  const u = Math.max(0, Math.min(1, (lateral - offsets[left]) / (offsets[right] - offsets[left])));
  const y = (i, j) => data.position[(i * columns + j) * 3 + 1];
  const b = y(row, right);
  const c = y(row + 1, left);
  if (u + v <= 1) {
    const a = y(row, left);
    return a + (b - a) * u + (c - a) * v;
  }
  const d = y(row + 1, right);
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
