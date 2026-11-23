import { highlands } from './highlands.js';
import { clamp, mix, noise, randomFor, ROAD_EDGE, smooth } from './route.js';

export const DEFAULT_SEED = 83472;
export const REGION_LENGTH = 560;

const BIOMES = [
  { name: 'Lakeshore', grade: 11, hills: 6, ridge: 48, trees: 0.74 },
  { name: 'Pine forest', grade: 24, hills: 10, ridge: 36, trees: 1 },
  { name: 'River valley', grade: 13, hills: 4, ridge: 58, trees: 0.47 },
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

    // Keep one inland lake and one tidal inlet in each pair of landscape groups.
    const coastal = Math.abs(group % 2) === 1;
    if (coastal) {
      const lakeSlot = slots.indexOf(0);
      const interior = 1 + (order() < 0.5 ? 0 : 1);
      [slots[lakeSlot], slots[interior]] = [slots[interior], slots[lakeSlot]];
    }
    const biome = slots[index - group * 4];
    const fjord = coastal && biome === 0;
    const random = randomFor(seed ^ Math.imul(index + 479, 0x18a4f29));
    const side = index === 0 || random() < 0.53 ? -1 : 1;
    const length = 212 + random() * 44;
    const width = 100 + random() * 49;
    feature = {
      ...BIOMES[biome],
      ...(fjord && { name: 'Fjords', grade: 21, ridge: 148, trees: 0.48 }),
      index,
      lake: biome === 0 ? {
        side,
        s: index * REGION_LENGTH + (index === 0 ? 38 : (random() - 0.5) * 22),
        fjord,
        length: fjord ? length * 2.15 : length,
        width,
        lateral: side * (width + 26 + random() * 22),
        phase: random() * Math.PI * 2,
      } : null,
    };
    if (feature.lake) {
      const lake = feature.lake;
      lake.overlook = lake.s + Math.sin(lake.phase) * lake.length * 0.36;
    }
    features.set(index, feature);
    if (features.size > 40) features.delete(features.keys().next().value);
    return feature;
  }

  function turnoutWidth(s) {
    const lake = region(Math.round(s / REGION_LENGTH)).lake;
    return lake ? lake.side * 12 * (1 - smooth(14, 48, Math.abs(s - lake.overlook))) : 0;
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

  const groupLakes = new Map();
  function lakeIn(group) {
    if (groupLakes.has(group)) return groupLakes.get(group);
    for (let i = 0; i < 4; i++) {
      const lake = region(group * 4 + i).lake;
      if (lake) {
        groupLakes.set(group, lake);
        if (groupLakes.size > 12) groupLakes.delete(groupLakes.keys().next().value);
        return lake;
      }
    }
  }

  // Tributaries drain toward the nearer lakeshore and taper into springs at the divide.
  function drainage(s) {
    const group = Math.floor(s / (4 * REGION_LENGTH));
    const home = lakeIn(group);
    const neighbor = lakeIn(group + (s < home.s ? -1 : 1));
    const shoreGap = Math.abs(neighbor.s - home.s) - home.length - neighbor.length;
    const lake = Math.abs(s - home.s) - home.length < Math.abs(s - neighbor.s) - neighbor.length ? home : neighbor;
    const t = (s - lake.s) / lake.length;
    const fromShore = Math.abs(s - lake.s) - lake.length;
    // The glacial trough bends past a narrow headland before opening into a deep outer sound.
    const mouth = smooth(-0.24, 0.56, t);
    const lakeWidth = lake.fjord
      ? 106 + 196 * mouth + 22 * Math.sin(4.6 * t + lake.phase)
      : lake.width * (1 + 0.12 * Math.sin(t * 5.8 + lake.phase));
    const lakeX = lake.fjord
      ? lake.side * (lakeWidth + 47 + 22 * Math.sin(t * 5.2 + lake.phase) + 13 * Math.cos(t * 8.1 - lake.phase))
      : lake.lateral + Math.sin(t * 4.2 + lake.phase) * 9;
    const lakes = fromShore < 80 ? [{ s: lake.s, lateral: lakeX, width: lakeWidth, t, edgeScale: lakeWidth }] : [];
    const fjord = lake.fjord && fromShore < 200 ? {
      side: lake.side, t, center: lakeX, length: lake.length, phase: lake.phase,
      weight: 1 - smooth(0, 200, fromShore),
    } : null;
    const openWidth = lakeWidth * Math.sqrt(Math.max(0, 1 - t * t));
    const toDivide = shoreGap * 0.5 - fromShore;
    if (toDivide <= 8) return { lakes, fjord, water: null };

    const source = smooth(8, Math.min(90, shoreGap * 0.4), toDivide);
    const current = smooth(-36, 24, fromShore);
    const meander = Math.sin(s / 126 + lake.phase) * 18 + Math.sin(s / 53 + lake.phase) * 7;
    const center = mix(lakeX, lake.side * (61 + meander), smooth(-16, 185, fromShore));
    const catchment = clamp(toDivide / Math.max(1, shoreGap * 0.5), 0, 1);
    const width = (17 + 4 * Math.sin(s / 94 + lake.phase)) * source * mix(0.67, 1, Math.sqrt(catchment));
    const riffle = smooth(0.45, 0.74, noise(s / 53 + lake.phase, key + 61)) * current * source;
    const left = Math.min(openWidth > 0 ? lakeX - openWidth : Infinity, center - width);
    const right = Math.max(openWidth > 0 ? lakeX + openWidth : -Infinity, center + width);
    // Positive curvature puts the inside of the bend on the positive-X bank.
    const curve = centerX(s - 16) + centerX(s + 16) - 2 * centerX(s)
      - lake.side * (0.29 * Math.sin(s / 126 + lake.phase) + 0.63 * Math.sin(s / 53 + lake.phase));
    return { lakes, fjord, water: {
      basin: lake.s, center, width, left, right, source, riffle, bend: clamp(curve, -1, 1) * smooth(90, 185, fromShore),
      level: 7 * (1 - Math.exp(-Math.max(0, fromShore) / 510)),
      flow: Math.sign(t) * current, lake: openWidth > 0,
    } };
  }

  function waterLevel(s, x) {
    const lateral = x - centerX(s);
    if (Math.abs(lateral) < 12 || Math.abs(lateral) > 900) return 0;
    const { water } = drainage(s);
    return water && lateral >= water.left - 10 && lateral <= water.right + 10 ? water.level : 0;
  }

  function section(s) {
    const { a, b, blend } = blendAt(s);
    return {
      s,
      x: centerX(s),
      grade: roadGrade(s, a, b, blend),
      turnout: turnoutWidth(s),
      hills: mix(a.hills, b.hills, blend),
      ridge: mix(a.ridge, b.ridge, blend),
      trees: mix(a.trees, b.trees, blend),
      valley: mix(Number(a.name === 'River valley'), Number(b.name === 'River valley'), blend),
      ...drainage(s),
    };
  }

  function outletShore(fjord, lateral) {
    if (!fjord) return -Infinity;
    const across = fjord.side * (lateral - fjord.center);
    const bend = smooth(0, 1450, across);
    const axis = 0.22 + 0.36 * bend + 0.115 * Math.sin(across / 580 + fjord.phase) + 0.07 * bend * Math.sin(across / 230 - fjord.phase);
    const halfWidth = 0.13 + 0.15 * bend;
    return Math.min(across, (halfWidth - Math.abs(fjord.t - axis)) * fjord.length);
  }

  function shoreDistance(row, lateral) {
    let closest = row.water && row.water.flow !== 0 ? row.water.width - Math.abs(lateral - row.water.center) : -Infinity;
    for (const lake of row.lakes) {
      const shore = (1 - Math.hypot((lateral - lake.lateral) / lake.width, lake.t)) * lake.edgeScale;
      closest = Math.max(closest, shore);
    }
    return Math.max(closest, outletShore(row.fjord, lateral));
  }

  function mountainWeight(distance) {
    return smooth(245, 1710, distance);
  }

  function reliefCoordinates(row, lateral, target, index) {
    mountains.coordinates(row.x + lateral, row.s, target, index);
    target[index + 3] = mountainWeight(Math.abs(lateral));
  }

  function bankHeight(row, lateral, base) {
    const shore = shoreDistance(row, lateral);
    const tidal = row.fjord?.weight ?? 0;
    // Give high headlands a long footslope instead of dropping the whole massif at the waterline.
    const water = row.water;
    const bar = water ? water.bend * clamp((lateral - water.center) / Math.max(1, water.width), -1, 1) : 0;
    const bankRun = 42 + 20 * bar + Math.abs(row.water?.flow ?? 0) * row.grade
      + tidal * Math.min(530, Math.max(0, base) * 1.6);
    if (shore < -bankRun) return base;
    const level = row.water?.level ?? 0;
    const depth = (25 + 54 * tidal) * smooth(0, 92 + 36 * tidal, shore) + 1.05 * smooth(0, 9, shore);
    // The shoulder stays attached to the road even when an irregular bank approaches it.
    const beach = smooth(0, bankRun, -shore);
    const barCrest = smooth(0.27, 0.82, bar) * smooth(-2, 2, shore) * (1 - smooth(3, 10, shore));
    const bedDepth = depth * (1 - 0.76 * bar) * (1 - 0.43 * (water?.riffle ?? 0));
    const bank = level + barCrest * 0.64 + Math.max(1.5, base - level) * beach - bedDepth;
    return mix(base, bank, smooth(7.5, 30 - 11 * Math.abs(water?.flow ?? 0), Math.abs(lateral)) * (row.water?.source ?? 1));
  }

  function sampleTerrain(row, lateral) {
    const distance = Math.abs(lateral);
    if (distance <= ROAD_EDGE) return row.grade + 0.12 * (1 - (lateral / ROAD_EDGE) ** 2);

    const s = row.s;
    const x = row.x + lateral;
    const outer = mountainWeight(distance);
    if (outer === 1) {
      const altitude = mountains.height(x, s);
      return row.fjord ? bankHeight(row, lateral, altitude) : altitude;
    }
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
    const rugged = smooth(50, 240, row.ridge);
    const inner = row.grade + slope + massif * .60 - erosion * .74
      + gravel * (hummock * mix(3.5, 14, rugged) + surface * mix(0.65, 2.8, rugged))
      + range * cracks * mix(9, 32, rugged);
    const floodplain = row.grade + gravel * (hummock * 2 + surface * 0.35);
    const foothills = mix(inner, floodplain, row.valley * (1 - smooth(118, 410, distance)));
    const base = outer > 0 ? mix(foothills, mountains.height(x, s), outer) : foothills;
    const ground = bankHeight(row, lateral, base);
    if (row.turnout * lateral <= 0 || distance > 30) return ground;
    const edge = ROAD_EDGE + Math.abs(row.turnout);
    const shelf = smooth(0, 4, Math.abs(row.turnout)) * (1 - smooth(edge, edge + 10, distance));
    return mix(ground, row.grade - 0.022 * (distance - ROAD_EDGE), shelf);
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
    seed, centerX, roadHeight, turnoutWidth, section, sampleTerrain, reliefCoordinates, shoreDistance, waterLevel, terrainHeight, routePose,
    biomeAt: s => region(Math.floor(s / REGION_LENGTH + 0.5)),
  };
}
