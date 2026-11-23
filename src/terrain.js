import { CHUNK_LENGTH, mix, ROAD_EDGE } from './route.js';

export const TERRAIN_STEP = 4;

const verge = [ROAD_EDGE, 6.4, 8, 10, 13, 17, 22, 27, 33, 40, 47];
const ridgeColumns = Array.from({ length: 193 }, (_, i) => (i - 96) * 10);
const bankColumns = Array.from({ length: 24 }, (_, i) => 5 + i * 10);
const shoulderColumns = [...verge, ...bankColumns];
export const TERRAIN_COLUMNS = [...new Set([...ridgeColumns, ...shoulderColumns, ...shoulderColumns.map(x => -x)])].sort((a, b) => a - b);
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

const extraOffsets = Array.from({ length: BAND_WIDTH / 12 + 1 }, (_, index) => index * 12);
const offsetCache = new Map();

export function bandColumns(band) {
  if (band === 0) return TERRAIN_COLUMNS;
  if (!offsetCache.has(band)) {
    const [start] = bandBounds(band);
    offsetCache.set(band, extraOffsets.map(offset => start + offset));
    if (offsetCache.size > 16) offsetCache.delete(offsetCache.keys().next().value);
  }
  return offsetCache.get(band);
}
const rows = CHUNK_LENGTH / TERRAIN_STEP + 1;

export function buildWater(world, id, seaReach = 14000) {
  const scanlines = Array.from({length: rows + 2}, (_, i) => world.section(id * CHUNK_LENGTH + (i - 1) * TERRAIN_STEP));
  const positions = [];
  const depth = [];
  const indices = [];
  const flow = [];
  const segments = 12;
  let previous = null, hasLake = false;
  for (let row = 0; row < rows; row++) {
    const sample = scanlines[row + 1], water = sample.water;
    if (!water) { previous = null; continue; }
    const start = positions.length / 3;
    const before = scanlines[row], after = scanlines[row + 2];
    const across = (after.x + (after.water?.center ?? water.center)
      - before.x - (before.water?.center ?? water.center)) / (2 * TERRAIN_STEP);
    const current = water.flow / Math.hypot(1, across);
    const f = sample.fjord;
    // Surround the whole curved outlet. The terrain occludes the dry parts of the strip.
    const outlet = f && Math.abs(f.t - 0.43) < 0.70 ? f.side : 0;
    const margin = Math.min(10, (water.right - water.left) * 0.05);
    const left = water.left - margin, right = water.right + margin;
    function vertex(lateral) {
      positions.push(sample.x + lateral, water.level, -sample.s);
      depth.push(Math.max(0, water.level - world.sampleTerrain(sample, lateral)));
      flow.push(-across * current, current);
    }
    // Denser samples at either shore resolve the shallow shelf on wide inlets.
    for (let j = 0; j <= segments; j++) vertex(mix(left, right, 0.5 - 0.5 * Math.cos(Math.PI * j / segments)));
    if (outlet) {
      const bank = outlet < 0 ? left : right;
      for (const span of [80, 240, 650, 1600, 4000]) vertex(bank + outlet * span);
      vertex(outlet * seaReach);
    }
    if (previous?.basin === water.basin) {
      const quad = (a, b, c, d) => indices.push(a, b, c, b, d, c);
      for (let j = 0; j < segments; j++) {
        quad(previous.start + j, previous.start + j + 1, start + j, start + j + 1);
      }
      if (outlet && outlet === previous.outlet) {
        let edge = outlet < 0 ? 0 : segments;
        for (let j = segments + 1; j < positions.length / 3 - start; j++) {
          const west = outlet < 0 ? j : edge, east = outlet < 0 ? edge : j;
          quad(previous.start + west, previous.start + east, start + west, start + east);
          edge = j;
        }
      }
    }
    previous = { start, basin: water.basin, outlet };
    hasLake ||= water.lake;
  }

  return indices.length ? {
    position: new Float32Array(positions),
    depth: new Float32Array(depth),
    flow: new Float32Array(flow),
    hasLake,
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
  const relief = new Float32Array(rows * columns * 4);
  const index = new Uint16Array((rows - 1) * (columns - 1) * 6);
  const groundOffsets = new Float32Array(position.length);
  let face = 0;

  for (let i = 0; i < rows; i++) {
    const row = scanlines[i + 1];
    const yValues = heights[i + 1];
    const roadCurve = scanlines[i + 2].x - scanlines[i].x;
    for (let j = 0; j < columns; j++) {
      const vertex = i * columns + j;
      const k = vertex * 3;
      const lateral = offsets[j];
      groundOffsets[k] = lateral;
      groundOffsets[k + 1] = Math.max(-128, world.shoreDistance(row, lateral));
      groundOffsets[k + 2] = row.water?.level ?? 0;
      const y = yValues[j];
      world.reliefCoordinates(row, lateral, relief, vertex * 4);
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
      if (i > 0 && j > 0) {
        const a = vertex - columns - 1;
        const b = a + 1;
        const c = vertex - 1;
        index.set([a, b, c, b, vertex, c], face);
        face += 6;
      }
    }
  }
  return { position, normal, relief, groundOffsets, index };
}

export function tileSurface(data, id, s, x, band = 0) {
  const offsets = bandColumns(band);
  const columns = offsets.length;
  const local = Math.max(0, Math.min((s - id * CHUNK_LENGTH) / TERRAIN_STEP, rows - 1));
  const row = Math.min(rows - 2, Math.floor(local));
  const v = local - row;
  const lateral = x - mix(data.position[row * columns * 3], data.position[(row + 1) * columns * 3], v) + offsets[0];
  let lo = 1, right = columns - 1;
  while (lo < right) {
    const mid = (lo + right) >>> 1;
    if (offsets[mid] <= lateral) lo = mid + 1;
    else right = mid;
  }
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
