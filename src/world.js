import { highlands } from './highlands.js';
import { clamp, mix, noise, randomFor, ROAD_EDGE, smooth } from './route.js';

export const DEFAULT_SEED = 83472;
export const REGION_LENGTH = 1280;

const BIOMES = [
  { name: 'Lakeshore', hills: 6, ridge: 48, trees: 0.74 },
  { name: 'Pine forest', hills: 10, ridge: 36, trees: 1 },
  { name: 'River valley', hills: 4, ridge: 58, trees: 0.47 },
  { name: 'Alpine mountains', hills: 57, ridge: 310, trees: 0.69 },
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
      ...(fjord && { name: 'Fjords', ridge: 148, trees: 0.48 }),
      index,
      lake: biome === 0 ? {
        side,
        s: index * REGION_LENGTH + (index === 0 ? 38 : (random() - 0.5) * 22),
        fjord,
        length: fjord ? length * 5.3 : length,
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

  function valleyX(s) {
    return (noise(key + 1, s / 268) - 0.5) * 125
      + (noise(key + 80, s / 122) - 0.5) * 44
      + (noise(key - 13, s / 53) - 0.5) * 12;
  }

  function blendAt(s) {
    const phase = s / REGION_LENGTH;
    const index = Math.floor(phase);
    return { a: region(index), b: region(index + 1), blend: smooth(0.085, 0.915, phase - index) };
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
      ? 64 + 106 * mouth + 11 * Math.sin(5.6 * t + lake.phase)
      : lake.width * (1 + 0.12 * Math.sin(t * 5.8 + lake.phase));
    const lakeX = lake.fjord
      ? lake.side * (lakeWidth + 71 + 66 * Math.sin(t * 4.8 + lake.phase) + 24 * Math.cos(t * 8.1 - lake.phase))
      : lake.lateral + Math.sin(t * 4.2 + lake.phase) * 9;
    const lakes = fromShore < 200 ? [{
      s: lake.s, lateral: lakeX, width: lakeWidth, t, pastHead: fromShore,
    }] : [];
    const fjord = lake.fjord && fromShore < 200 ? {
      side: lake.side, t, center: lakeX, length: lake.length, phase: lake.phase,
      weight: 1 - smooth(0, 200, fromShore),
    } : null;
    const openWidth = lakeWidth * Math.sqrt(Math.max(0, 1 - t * t));
    const toDivide = shoreGap * 0.5 - fromShore;
    // Both tributaries meet the same ground elevation at their common divide.
    const head = Math.max(1, shoreGap * 0.5);
    const pass = mountainPass(s, home, neighbor, shoreGap);
    const datum = 7 * -Math.expm1(-Math.max(0, fromShore) / 510)
      + Math.min(36, 0.010 * head) * smooth(0, head, fromShore);
    const divide = 1 - smooth(0, 265, toDivide);
    if (toDivide <= 8) return { lakes, fjord, datum, divide, pass, water: null };

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
    const curve = valleyX(s - 16) + valleyX(s + 16) - 2 * valleyX(s)
      - lake.side * (0.29 * Math.sin(s / 126 + lake.phase) + 0.63 * Math.sin(s / 53 + lake.phase));
    return { lakes, fjord, divide, datum, pass, water: {
      basin: lake.s, center, width, left, right, source, riffle, valleyAccess: source * smooth(130, 325, fromShore), bend: clamp(curve, -1, 1) * smooth(90, 185, fromShore),
      level: datum + (pass ? pass.lift * 0.80 * smooth(0.26, 0.94, pass.weight) : 0),
      flow: Math.sign(t) * current, lake: openWidth > 0,
    } };
  }

  function waterLevel(s, x) {
    const lateral = x - valleyX(s);
    const { water } = drainage(s);
    return water && lateral >= water.left - 10 && lateral <= water.right + 10 ? water.level : 0;
  }

  // A range separates two drainage basins. Its saddle has room for a sustained
  // climb on both sides, and its two streams drain toward different lakes.
  function mountainPass(s, lake, neighbor, gap) {
    if (gap < 2450) return null;
    const left = lake.s < neighbor.s ? lake : neighbor;
    const right = lake.s < neighbor.s ? neighbor : lake;
    const summit = (left.s + left.length + right.s - right.length) / 2;
    const run = Math.min(3200, gap * 0.5 - 95);
    const u = (s - summit) / run;
    if (Math.abs(u) >= 1) return null;
    const weight = 1 - smooth(0, 1, Math.abs(u));
    const side = mix(-left.side, -right.side, smooth(-0.15, 0.15, u));
    const bend = Math.sin(u * 6.4 + left.phase) + 0.45 * Math.sin(u * 12 - right.phase);
    const notch = side * (225 + 62 * bend) + 24 * Math.sin(u * 4.3 + right.phase);
    return { summit, run, u, weight, notch, lift: run * 0.041 * weight };
  }

  function landSection(s) {
    const { a, b, blend } = blendAt(s);
    const basin = drainage(s);
    const hills = mix(a.hills, b.hills, blend);
    const valley = mix(Number(a.name === 'River valley'), Number(b.name === 'River valley'), blend);
    const axis = valleyX(s);
    const moraine = noise(key + 76, s / 370);
    const floor = basin.datum + 3.4 + 4.8 * moraine
      + basin.divide * (1.8 + hills * 0.055) * (0.65 + 0.5 * moraine);
    const side = Math.sign(basin.water?.center ?? 0) * (basin.water?.source ?? 0);
    const crossfall = (1 - 0.92 * valley) * ((noise(key + 12, s / 360) - 0.5) * 0.07
      - side * (0.036 + 0.105 * smooth(8, 50, hills)));
    return {
      s, x: axis, axis, floor, crossfall, hills, valley,
      turnout: turnoutWidth(s),
      ridge: mix(a.ridge, b.ridge, blend),
      trees: mix(a.trees, b.trees, blend),
      ...basin,
    };
  }

  // Survey dry points along the valley before laying pavement. The spline fits
  // the same ground that will remain visible outside the construction footprint.
  const spacing = 32;
  const knots = new Map();
  function roadKnot(index) {
    if (knots.has(index)) return knots.get(index);
    const s = index * spacing, land = landSection(s);
    let offset = (noise(key - 49, s / 180) - 0.5) * 17;
    if (land.pass) offset = mix(offset, land.pass.notch, land.pass.weight);
    if (land.water) {
      const side = Math.sign(land.water.center);
      const nearBank = side > 0 ? land.water.left : -land.water.right;
      if (land.fjord) {
        const coast = land.fjord.weight * (1 - smooth(0.64, 0.98, Math.abs(land.fjord.t)));
        offset = mix(offset, side * (nearBank - 35), coast);
      }
      const riverside = land.valley * (1 - smooth(0, 0.16, land.pass?.weight ?? 0)) * land.water.valleyAccess;
      const setback = 31 - 11 * riverside + Math.max(0, side * land.turnout);
      offset = mix(offset, side * (nearBank - setback - 2), riverside);
      offset -= side * Math.max(0, setback - nearBank + side * offset) * land.water.source;
    }
    const knot = { x: land.axis + offset, ground: Math.max(0, naturalHeight(land, offset)) };
    knots.set(index, knot);
    if (knots.size > 1024) knots.delete(knots.keys().next().value);
    return knot;
  }

  // Trim short summits to a drivable grade. More distant samples cannot affect
  // the cut once the rising grade line clears the knot's height above sea level.
  function knotValue(index, field) {
    const knot = roadKnot(index);
    if (field === 'x') return knot.x;
    if (knot.grade === undefined) {
      const rise = spacing * 0.09;
      let level = knot.ground;
      for (let n = 1; n * rise < level; n++) {
        level = Math.min(level, n * rise + Math.min(roadKnot(index - n).ground, roadKnot(index + n).ground));
      }
      knot.grade = level;
    }
    return knot.grade;
  }

  function alignment(s, field) {
    const station = s / spacing, i = Math.floor(station), t = station - i;
    const u = 1 - t;
    return (u ** 3 * knotValue(i - 1, field) + (4 - 6 * t * t + 3 * t ** 3) * knotValue(i, field)
      + (4 - 6 * u * u + 3 * u ** 3) * knotValue(i + 1, field) + t ** 3 * knotValue(i + 2, field)) / 6;
  }

  function centerX(s) {
    return alignment(s, 'x');
  }

  function crown(lateral) {
    return 0.085 * (1 - (lateral / ROAD_EDGE) ** 2);
  }

  function roadHeight(s, lateral = 0) {
    return alignment(s, 'grade') + crown(lateral);
  }

  function section(s) {
    const row = landSection(s);
    row.x = centerX(s);
    row.grade = alignment(s, 'grade');
    // Rendering and wheels take road-relative offsets. Keep the watershed fixed in world space.
    const shift = row.axis - row.x;
    for (const lake of row.lakes) lake.lateral += shift;
    if (row.fjord) row.fjord.center += shift;
    if (row.water) {
      row.water.center += shift;
      row.water.left += shift;
      row.water.right += shift;
    }
    return row;
  }

  function outletShore(fjord, lateral) {
    if (!fjord) return -Infinity;
    const across = fjord.side * (lateral - fjord.center);
    const bend = smooth(0, 1450, across);
    const axis = 0.38 + 0.32 * bend + 0.063 * Math.sin(across / 580 + fjord.phase) + 0.032 * bend * Math.sin(across / 330 - fjord.phase);
    const halfWidth = 0.115 + 0.085 * bend;
    return Math.min(across, (halfWidth - Math.abs(fjord.t - axis)) * fjord.length);
  }

  function shoreDistance(row, lateral) {
    let closest = row.water && row.water.flow !== 0 ? row.water.width - Math.abs(lateral - row.water.center) : -Infinity;
    for (const lake of row.lakes) {
      const ellipse = (1 - Math.hypot((lateral - lake.lateral) / lake.width, lake.t)) * lake.width;
      // A long inlet must run out of bank influence before its descriptor leaves the tile.
      closest = Math.max(closest, lake.pastHead > 0 ? Math.min(ellipse, -lake.pastHead) : ellipse);
    }
    return Math.max(closest, outletShore(row.fjord, lateral));
  }

  function mountainWeight(distance) {
    return smooth(245, 1710, distance);
  }

  function reliefCoordinates(row, lateral, target, index) {
    mountains.coordinates(row.x + lateral, row.s, target, index);
    target[index + 3] = mountainWeight(Math.abs(row.x - row.axis + lateral));
  }

  function bankHeight(row, lateral, base) {
    const shore = shoreDistance(row, lateral);
    const tidal = row.fjord?.weight ?? 0;
    // Give high headlands a long footslope instead of dropping the whole massif at the waterline.
    const water = row.water;
    const bar = water ? water.bend * clamp((lateral - water.center) / Math.max(1, water.width), -1, 1) : 0;
    const coastReach = smooth(420, 1500, Math.abs(lateral + row.x - row.axis));
    const bankRun = 42 - 16 * (water?.valleyAccess ?? 0) + 14 * bar * smooth(-18, -2, shore) + Math.abs(water?.flow ?? 0) * Math.min(31, Math.max(0, base - (water?.level ?? 0)))
      + (row.pass?.weight ?? 0) * Math.min(185, 0.48 * Math.max(0, base - (water?.level ?? 0)))
      + tidal * Math.min(66 + 380 * coastReach, Math.max(0, base) * (0.32 + 0.9 * coastReach));
    if (shore < -bankRun) return base;
    const level = row.water?.level ?? 0;
    const depth = (25 + 78 * tidal) * smooth(0, 92 - 31 * tidal, shore) + 1.05 * smooth(0, 9, shore);
    const beach = smooth(0, bankRun, -shore);
    const barCrest = smooth(0.27, 0.82, bar) * smooth(-2, 2, shore) * (1 - smooth(3, 10, shore));
    const bedDepth = depth * (1 - 0.76 * bar) * (1 - 0.43 * (water?.riffle ?? 0));
    const bank = level + barCrest * 0.64 + Math.max(1.5, base - level) * beach - bedDepth;
    return mix(base, bank, smooth(0, 0.92, water?.source ?? 1));
  }

  function naturalHeight(row, lateral) {
    const offset = lateral + (row.x - row.axis);
    const distance = Math.abs(offset);

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
    const rough = smooth(20, 110, distance);
    const rugged = smooth(50, 240, row.ridge);
    const terrace = Math.max(row.datum + 1.6, row.floor + 105 * Math.tanh(offset / 105) * row.crossfall);
    const inner = terrace + slope + massif * .60 - erosion * .74
      + hummock * mix(1.3, 3.5 + 10 * rugged, rough) + surface * mix(0.23, 0.65 + 2.1 * rugged, rough)
      + range * cracks * mix(9, 32, rugged);
    const floodplain = terrace + hummock * 1.3 + surface * 0.23;
    let foothills = mix(inner, floodplain, row.valley * (1 - smooth(118, 410, distance)));
    if (row.pass) {
      const pass = row.pass, crest = pass.weight * pass.notch;
      const cross = offset - crest;
      const travel = Math.abs(cross);
      // The pass crosses the spine of the range. A wind gap cuts through the
      // crest; on the approaches, one flank falls away into the tributary valley.
      const openSide = Math.tanh(pass.notch / 80);
      const gap = 1 - smooth(0.10, 0.38, Math.abs(pass.u));
      const crossSlope = Math.tanh(cross / 125) * openSide * mix(67, 18, gap);
      const wall = smooth(22, 240 + 65 * rolling, travel)
        * (0.60 + 0.61 * fold + 0.33 * rolling - 0.18 * ravine);
      const ridge = (200 + 155 * noise(s / 410 + key, offset / 370)) * wall
        * mix(gap, 1, smooth(-35, 100, cross * openSide));
      const mountain = row.floor + pass.weight * (crossSlope + ridge)
        + hummock * mix(1.2, 8, smooth(25, 140, travel));
      const extent = 1 - smooth(440, 980, travel);
      foothills = mix(foothills, mountain, extent * smooth(0, 0.22, pass.weight)) + extent * pass.lift;
    }
    let base = outer > 0 ? mix(foothills, mountains.height(x, s), outer) : foothills;
    if (row.fjord) {
      const f = row.fjord, coast = shoreDistance(row, lateral);
      const inland = Math.max(0, -coast), fjordSide = (lateral - f.center) * f.side;
      // Bedrock buttresses alternate with hanging gullies above the glacial trough.
      const ravineAxis = s / 139 + 1.7 * noise(x / 310 + key, s / 440);
      const gully = Math.pow(1 - Math.abs(Math.sin(ravineAxis)), 4);
      const headwall = 1 - smooth(0.65, 1.14, Math.abs(f.t));
      const escarpment = (255 + 195 * rolling + 85 * fold - 140 * gully)
        * smooth(1, 141 + 38 * gully, inland) * (1 - smooth(340, 1050, inland));
      const back = smooth(-15, 70, fjordSide);
      const upland = smooth(118, 310, inland) * smooth(40, 170, -f.side * offset);
      const terrace = row.floor + 9 * smooth(1, 160, inland) + hummock * 0.8;
      const coastalRelief = f.weight * (1 - smooth(1000, 1680, distance));
      base = mix(base, terrace, coastalRelief * (1 - back) * (1 - upland));
      // The outer headlands descend toward the mouth of the sound.
      const headland = smooth(0.12, 0.55, f.t) * (1 - smooth(0.82, 1.04, f.t)) * back;
      base = mix(base, row.floor + 0.48 * Math.max(0, base - row.floor),
        coastalRelief * headland * (1 - smooth(260, 800, inland)));
      base += coastalRelief * headwall * (1 - 0.54 * headland) * escarpment * mix(0.55, 1, back)
        * mix(upland, 1, back);
    }
    return bankHeight(row, lateral, base);
  }

  function sampleTerrain(row, lateral) {
    const distance = Math.abs(lateral);
    if (distance <= ROAD_EDGE) return row.grade + crown(lateral);
    const ground = naturalHeight(row, lateral);
    const edge = ROAD_EDGE + Math.max(0, Math.sign(lateral) * row.turnout);
    if (distance >= edge + 10) return ground;
    const shoulder = row.grade - 0.022 * (distance - ROAD_EDGE);
    const run = 2 + Math.min(8, 2.8 * Math.abs(shoulder - ground));
    return mix(shoulder, ground, smooth(edge, edge + run, distance));
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
    seed, centerX, roadHeight, turnoutWidth, section, naturalHeight, sampleTerrain, reliefCoordinates, shoreDistance, waterLevel, terrainHeight, routePose,
    biomeAt: s => region(Math.floor(s / REGION_LENGTH + 0.5)),
  };
}
