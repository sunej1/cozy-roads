import { highlands } from './highlands.js';
import { clamp, mix, noise, randomFor, ROAD_EDGE, smooth } from './route.js';

export const DEFAULT_SEED = 83472;
export const REGION_LENGTH = 560;

const BIOMES = [
  { name: 'Lakeshore', grade: 11, hills: 24, ridge: 48, trees: 0.74 },
  { name: 'Pine forest', grade: 24, hills: 34, ridge: 36, trees: 1 },
  { name: 'Rolling hills', grade: 31, hills: 71, ridge: 44, trees: 0.39 },
  { name: 'Alpine mountains', grade: 56, hills: 57, ridge: 310, trees: 0.69 },
];

export function parseSeed(query) {
  const value = new URLSearchParams(query).get('seed');
  if (value === null || !/^\d{1,10}$/.test(value) || Number(value) > 0xffffffff) return DEFAULT_SEED;
  return Number(value);
}

export function createWorld(seed = DEFAULT_SEED, elevations) {
  const key = (seed % 160001) * 0.031;
  const features = new Map();
  const mountains = highlands(seed, elevations);

  function region(index) {
    let feature = features.get(index);
    if (feature) return feature;

    const group = Math.floor(index / 4);
    const slots = [0, 1, 2, 3];
    const order = randomFor(seed ^ Math.imul(group + 11, 0x26911cb));
    // Vary the order while making all four landscapes recur on every seed.
    const offset = group === 0 ? 1 : 0;
    for (let i = slots.length - 1; i > offset; i--) {
      const j = offset + Math.floor(order() * (i - offset + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    const biome = slots[index - group * 4];
    const random = randomFor(seed ^ Math.imul(index + 479, 0x18a4f29));
    const side = index === 0 || random() < 0.53 ? -1 : 1;
    const length = 212 + random() * 44;
    const width = 100 + random() * 49;
    feature = {
      ...BIOMES[biome],
      index,
      lake: biome === 0 ? {
        side,
        s: index * REGION_LENGTH + (index === 0 ? 38 : (random() - 0.5) * 22),
        length,
        width,
        lateral: side * (width + 26 + random() * 22),
        phase: random() * Math.PI * 2,
      } : null,
    };
    features.set(index, feature);
    if (features.size > 40) features.delete(features.keys().next().value);
    return feature;
  }

  function centerX(s) {
    return (noise(key + 1, s / 268) - 0.5) * 125
      + (noise(key + 80, s / 122) - 0.5) * 44
      + (noise(key - 13, s / 53) - 0.5) * 12;
  }

  function blendAt(s) {
    const phase = s / REGION_LENGTH;
    const index = Math.floor(phase);
    return { a: region(index), b: region(index + 1), blend: smooth(0.085, 0.915, phase - index) };
  }

  function roadGrade(s, a, b, blend) {
    return mix(a.grade, b.grade, blend)
      + (noise(key + 76, s / 236) - 0.5) * 9
      + (noise(key + 97, s / 71) - 0.5) * 2.8;
  }

  function roadHeight(s, lateral = 0) {
    const { a, b, blend } = blendAt(s);
    return roadGrade(s, a, b, blend) + 0.12 * (1 - (lateral / ROAD_EDGE) ** 2);
  }

  function section(s) {
    const { a, b, blend } = blendAt(s);
    const lakes = [];
    for (const lake of [a.lake, b.lake]) {
      if (!lake || Math.abs(s - lake.s) > lake.length + 80) continue;
      const t = (s - lake.s) / lake.length;
      const lateral = lake.lateral + Math.sin(t * 4.2 + lake.phase) * 9;
      const width = lake.width * (1 + 0.12 * Math.sin(t * 5.8 + lake.phase));
      lakes.push({ s: lake.s, lateral, width, t, edgeScale: Math.min(width, lake.length) });
    }
    return {
      s,
      x: centerX(s),
      grade: roadGrade(s, a, b, blend),
      hills: mix(a.hills, b.hills, blend),
      ridge: mix(a.ridge, b.ridge, blend),
      trees: mix(a.trees, b.trees, blend),
      lakes,
    };
  }

  function shoreDistance(row, lateral) {
    let closest = -Infinity;
    for (const lake of row.lakes) {
      const shore = (1 - Math.hypot((lateral - lake.lateral) / lake.width, lake.t)) * lake.edgeScale;
      closest = Math.max(closest, shore);
    }
    return closest;
  }

  function mountainWeight(distance) {
    return smooth(245, 1710, distance);
  }

  function reliefCoordinates(row, lateral, target, index) {
    mountains.coordinates(row.x + lateral, row.s, target, index);
    target[index + 3] = mountainWeight(Math.abs(lateral));
  }

  function sampleTerrain(row, lateral) {
    const distance = Math.abs(lateral);
    if (distance <= ROAD_EDGE) return row.grade + 0.12 * (1 - (lateral / ROAD_EDGE) ** 2);

    const s = row.s;
    const x = row.x + lateral;
    const outer = mountainWeight(distance);
    if (outer === 1) return mountains.height(x, s);
    const rolling = noise(x / 112 + key, s / 168);
    const hummock = noise(x / 37 + key + 25, s / 51) - 0.5;
    const surface = noise(x / 8.5 + key + 4, s / 13) - 0.5;
    const warp = (noise(x / 120 + key + 37, s / 150) - 0.5) * 58;
    const fold = 1 - Math.abs(2 * noise((s + warp) / 102, (x + s * 0.28) / 119 + key) - 1);
    const cracks = noise(x / 28 + key - 72, (s + x * 0.22) / 39) - 0.5;
    const range = smooth(34, 476, distance);
    const slope = row.hills * smooth(10, 240, distance) * (0.08 + rolling * 0.94);
    // Broad valleys break up the ridgeline. Nested gullies run down its flanks.
    const valley = noise(s / 310 + key + 43, x / 460);
    const massif = row.ridge * range * (0.21 + fold * fold * 0.81 + rolling * 0.54) * (0.55 + .81 * valley);
    const channel = (s + warp + x * .21) / 59;
    const ravine = (1 - Math.abs(Math.sin(channel))) ** 4;
    const tributary = (1 - Math.abs(Math.sin(channel * 2.7 + rolling * 5))) ** 5;
    const erosion = range * (row.ridge * .19 + row.hills * .22) * (ravine + .39 * tributary);
    const gravel = smooth(7.5, 30, distance);
    const inner = row.grade + slope + massif * .60 - erosion * .74 + gravel * (hummock * 14 + surface * 2.8) + range * cracks * 32;
    const base = outer > 0 ? mix(inner, mountains.height(x, s), outer) : inner;
    const shore = shoreDistance(row, lateral);
    if (shore >= 0) return -25 * smooth(0, 92, shore) - 0.5 * smooth(0, 4, shore);
    // The shoulder stays attached to the road even when an irregular bank approaches it.
    const beach = smooth(0, 29, -shore);
    return mix(Math.max(1.5, base) * beach, base, 1 - gravel);
  }

  function terrainHeight(s, lateral) {
    return sampleTerrain(section(s), lateral);
  }

  function routePose(s) {
    const across = (centerX(s + 1) - centerX(s - 1)) / 2;
    const length = Math.hypot(1, across);
    return {
      length,
      yaw: -Math.atan(across),
      pitch: Math.atan2(roadHeight(s + 1) - roadHeight(s - 1), 2 * length),
    };
  }

  return {
    seed, centerX, roadHeight, section, sampleTerrain, reliefCoordinates, shoreDistance, terrainHeight, routePose,
    biomeAt: s => region(Math.floor(s / REGION_LENGTH + 0.5)),
  };
}
