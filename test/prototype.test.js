import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CHUNK_LENGTH, drive, newCarState, spawnStation, roadBend, restrictedPassing, ROAD_EDGE, LANE_CENTER, surfaceAt, TOUR_SPEED } from '../src/route.js';
import { bandBounds, buildTerrain, buildWater, terrainBand, tileSurface, TERRAIN_COLUMNS } from '../src/terrain.js';
import { createWorld as seededWorld, DEFAULT_SEED, parseSeed, REGION_LENGTH } from '../src/world.js';
import { carveBedrock } from '../src/highlands.js';
import { mountainPage } from '../src/horizon.js';
import { VEHICLES, vehicleId } from '../src/vehicles.js';
import { RecentFrames, ResolutionBudget, summarize } from '../src/timing.js';

const raster = readFileSync(new URL('../assets/shuksan.u16', import.meta.url));
const elevations = carveBedrock(new Uint16Array(raster.buffer, raster.byteOffset, raster.byteLength / 2));
const createWorld = seed => seededWorld(seed, elevations);

test('adaptive resolution ignores an isolated long frame and responds to sustained pressure', () => {
  const budget = new ResolutionBudget();
  assert.equal(budget.observe(80), false);
  for (let frame = 0; frame < 120; frame++) budget.observe(33.4);
  assert.equal(budget.scale, 1);
  assert.equal(budget.observe(45), false);
  assert.equal(budget.observe(45), true);
  assert.equal(budget.scale, 0.94);
  for (let frame = 0; frame < 551; frame++) budget.observe(16.7);
  assert.equal(budget.scale, 0.94);
  assert.equal(budget.observe(16.7), true);
  assert.equal(budget.scale, 1);
});

test('auto-drive is repeatable and keeps moving past the previous route boundary', () => {
  const world = createWorld();
  const run = () => {
    const car = { ...newCarState(world), speed: TOUR_SPEED };
    for (let step = 0; step < 3600; step++) drive(car, 1 / 120, {}, true, world, () => 0, VEHICLES.wagon);
    return car;
  };
  const car = run();
  assert.deepEqual(car, run());
  assert.ok(Math.abs(car.distance - 600) < 1e-8);
  assert.equal(car.x, world.centerX(car.s) + LANE_CENTER);
  for (let step = 0; step < 18000; step++) drive(car, 1 / 120, {}, true, world, () => 0, VEHICLES.wagon);
  assert.ok(car.s > 3000);
  assert.ok(Math.abs(car.distance - 3600) < 1e-7);
});

test('the seed fixes the road, all terrain types recur, and lakes close off the roadway', () => {
  assert.equal(parseSeed('?seed=0'), 0);
  assert.equal(parseSeed('?seed=4294967295'), 4294967295);
  assert.equal(parseSeed('?seed=-12'), DEFAULT_SEED);
  const world = createWorld();
  const other = createWorld(275);
  assert.notEqual(world.centerX(230), other.centerX(230));

  for (const start of [0, 4, 40]) {
    const names = Array.from({ length: 4 }, (_, i) => world.biomeAt((start + i) * REGION_LENGTH).name);
    assert.deepEqual(names.sort(), ['Alpine mountains', start % 8 === 0 ? 'Lakeshore' : 'Fjords', 'Pine forest', 'River valley']);
  }

  const start = world.section(0);
  assert.ok(world.sampleTerrain(start, start.lakes[0].lateral) < -1);
  assert.ok(world.sampleTerrain(start, 0) > 0);
  assert.ok(world.sampleTerrain(start, start.lakes[0].lateral - 400) > 1);
  assert.ok(world.sampleTerrain(world.section(350), start.lakes[0].lateral) > 1);
});

test('terrain tiles match across boundaries regardless of build order', () => {
  const world = createWorld();
  for (const index of [-1, 0, 12, 290]) {
    const next = buildTerrain(world, index + 1);
    const tile = buildTerrain(world, index);
    const stride = TERRAIN_COLUMNS.length * 3;
    assert.deepEqual(tile.position.slice(-stride), next.position.slice(0, stride));
    assert.deepEqual(tile.normal.slice(-stride), next.normal.slice(0, stride));
    const uvStride = TERRAIN_COLUMNS.length * 4;
    assert.deepEqual(tile.relief.slice(-uvStride), next.relief.slice(0, uvStride));
    assert.deepEqual(tile, buildTerrain(createWorld(), index));
  }
  const lake = buildWater(world, 0);
  assert.ok(lake?.index.length > 0);
  assert.ok(lake.depth.some(value => value === 0) && lake.depth.some(value => value > 15));
  for (const [i, depth] of lake.depth.entries()) {
    const x = lake.position[i * 3], level = lake.position[i * 3 + 1], s = -lake.position[i * 3 + 2];
    assert.ok(Math.abs(depth - Math.max(0, level - world.terrainHeight(s, x - world.centerX(s)))) < 0.001);
  }
  const river = buildWater(world, 6);
  assert.equal(river.hasLake, false);
  assert.equal(lake.hasLake, true);
  assert.ok(river.flow.some((value, i) => i % 3 === 1 && value > 0.5));
  const next = buildWater(world, 7);
  for (const [field, stride] of [['position', 39], ['flow', 39], ['depth', 13], ['banks', 26]]) {
    assert.deepEqual(river[field].slice(-stride), next[field].slice(0, stride));
  }
});

test('terrain bands stitch across the lateral grid and stream away from the road', () => {
  const world = createWorld();
  assert.equal(terrainBand(959), 0);
  assert.equal(terrainBand(960), 1);
  assert.equal(terrainBand(-960), -1);
  for (const [left, right] of [[-2, -1], [-1, 0], [0, 1], [1, 2]]) {
    assert.equal(bandBounds(left)[1], bandBounds(right)[0]);
    const outerRows = CHUNK_LENGTH / 4 + 1;
    const west = buildTerrain(world, 2, left);
    const east = buildTerrain(world, 2, right);
    for (const attribute of ['position', 'relief', 'normal']) {
      const width = attribute === 'relief' ? 4 : 3;
      const westStride = west[attribute].length / outerRows;
      const eastStride = east[attribute].length / outerRows;
      for (let row = 0; row < outerRows; row++) {
        const last = (row + 1) * westStride;
        const first = row * eastStride;
        assert.deepEqual(west[attribute].slice(last - width, last), east[attribute].slice(first, first + width));
      }
    }
  }
});

test('manual steering can leave the road, turn back and reverse', () => {
  const world = createWorld();
  const flat = () => 0;
  const car = newCarState(world);
  for (let i = 0; i < 300; i++) drive(car, 1 / 120, { throttle: true, right: true }, false, world, flat, VEHICLES.retro);
  assert.ok(Math.abs(car.x - world.centerX(car.s)) > ROAD_EDGE + 4);
  assert.equal(surfaceAt(car, world, flat), 'Off road');
  assert.ok(Math.cos(car.heading) < 0);
  const beforeReverse = car.distance;
  for (let i = 0; i < 470; i++) drive(car, 1 / 120, { brake: true }, false, world, flat, VEHICLES.retro);
  assert.ok(car.speed < 0 && car.distance > beforeReverse);
});

test('vehicle response differs between pavement and steep trails', () => {
  const world = { centerX: () => 0, routePose: () => ({ length: 1, yaw: 0 }) };
  const flat = () => 0;
  const climb = s => 0.64 * s;
  const run = (vehicle, height, x) => {
    const car = { ...newCarState(world), x };
    for (let frame = 0; frame < 1080; frame++) drive(car, 1 / 120, { throttle: true }, false, world, height, vehicle);
    return car;
  };
  assert.equal(vehicleId('__proto__'), 'wagon');
  assert.ok(run(VEHICLES.hyper, flat, 0).speed > run(VEHICLES.retro, flat, 0).speed);
  assert.ok(run(VEHICLES.retro, flat, 0).speed > run(VEHICLES.wagon, flat, 0).speed);
  assert.ok(run(VEHICLES.trail, climb, 40).distance > 10);
  assert.ok(run(VEHICLES.hyper, climb, 40).distance < 1);
});

test('rolling samples preserve order and benchmark math includes slow frames', () => {
  const recent = new RecentFrames(4);
  for (const frame of [8, 10, 14, 16, 40]) recent.add(frame);
  assert.deepEqual([...recent.values()], [10, 14, 16, 40]);
  const stats = summarize(recent.values());
  assert.equal(stats.fps, 50);
  assert.equal(stats.medianMs, 15);
  assert.ok(Math.abs(stats.p95Ms - 36.4) < 1e-8);
  assert.equal(stats.framesOver33Ms, 1);
  assert.equal(stats.maxMs, 40);
  recent.clear();
  assert.equal(summarize(recent.values()), null);
});

test('mixed-detail mountain clusters share their actual drawn edges with each other and driving tiles', () => {
  const world = createWorld(275);
  const west = mountainPage(world, 1, -1, 64);
  const east = mountainPage(world, 2, -1, 32);
  const strip = 5;
  function seam(page, level) {
    const result = [];
    for (const id of new Set(page.lod[strip][level])) {
      const p = Array.from(page.position.slice(id * 3, id * 3 + 3));
      if (Math.abs(p[0] - world.centerX(-p[2]) - 960) < 0.001) result.push(p);
    }
    return result.sort((a, b) => b[2] - a[2]);
  }
  const boundary = seam(west, 0);
  assert.equal(boundary.length, CHUNK_LENGTH / 4 + 1);
  const driving = buildTerrain(world, -8 + strip, 1);
  for (let i = 0; i < boundary.length; i++) {
    const k = (i * driving.position.length) / boundary.length;
    assert.deepEqual(Array.from(driving.position.slice(k, k + 3)), boundary[i]);
  }
  for (const level of [0, 1, 2]) {
    assert.deepEqual(seam(west, level), boundary);
    assert.deepEqual(seam(east, level), boundary);
  }
  assert.ok(east.lod[strip][2].length < east.lod[strip][0].length);
  assert.ok(west.errors[strip][2] > 0);
  const next = mountainPage(world, 1, 0, 32);
  function northEdge(page, strip, level) {
    const points = [...new Set(page.lod[strip][level])].map((id) =>
      Array.from(page.position.slice(3 * id, 3 * id + 3)),
    );
    return points.filter((p) => p[2] === 0).sort((a, b) => a[0] - b[0]);
  }
  assert.deepEqual(northEdge(west, 7, 1), northEdge(next, 0, 2));
});

test('distant shadow rebuilds stay bounded during a drive and restart after a reversal', async () => {
  const { mountainLight } = await import('../src/mountain-light.js');
  let samples = 0;
  const world = {
    section: () => ({ x: 0 }),
    sampleTerrain: () => { samples++; return 100; },
  };
  const shadows = mountainLight(world, { x: -0.84, y: 0.48, z: 0.23 });
  const start = { x: 0, s: 0 }, next = { x: 0, s: 1536 };
  function count(position, eager = false) {
    samples = 0;
    shadows.update(position, eager);
    return samples;
  }
  const full = count(start, true);
  const batch = count(next);
  assert.ok(batch > 0 && batch < full / 10);
  assert.equal(count(start), 0);
  let total = 0;
  for (let i = 0; i < Math.ceil(full / batch); i++) total += count(next);
  assert.equal(total, full);
  assert.equal(count(next), 0);
});

test('every garage model ships with four wheel pivots on the correct axles and brake lights', () => {
  for (const name of ['wagon', 'coupe', 'hyper', 'offroad']) {
    const bytes = readFileSync(new URL('../assets/vehicles/' + name + '.glb', import.meta.url));
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    const roots = json.scenes[json.scene].nodes.map(index => json.nodes[index]);
    for (const axle of ['f', 'r']) {
      for (const side of ['l', 'r']) {
        const wheel = roots.find(node => node.name === 'wheel_' + axle + side);
        assert.ok(wheel?.children?.length, name);
        const z = wheel.translation?.[2] ?? wheel.matrix[14];
        assert.ok(z * (axle === 'f' ? -1 : 1) > 0, name);
      }
    }
    assert.ok(json.materials.some(m => ['RearLamps', 'Light_Red'].includes(m.name) && m.emissiveFactor[0] > 0), name);
  }
});

test('meadow and fir detail levels progressively simplify the same vegetation', () => {
  for (const [file, names] of [
    ['meadow-leaves', ['Meadow', 'MeadowMid', 'MeadowFar']],
    ['fir-canopy', ['Canopy', 'Silhouette']],
  ]) {
    const bytes = readFileSync(new URL('../assets/' + file + '.glb', import.meta.url));
    const model = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    let previous = Infinity;
    for (const name of names) {
      const mesh = model.meshes[model.nodes.find(node => node.name === name).mesh].primitives[0];
      const indices = model.accessors[mesh.indices].count;
      const bounds = model.accessors[mesh.attributes.POSITION];
      assert.ok(indices > 0 && indices % 3 === 0 && indices < previous, name);
      assert.ok(bounds.min[1] <= 0.4 && bounds.max[1] > 0.18);
      previous = indices;
    }
  }
});

test('cloud density, lighting and projected shadows ship together', async () => {
  const { gunzipSync } = await import('node:zlib');
  const { CLOUD_WIDTH, CLOUD_LAYERS } = await import('../src/cloud-field.js');
  const field = gunzipSync(readFileSync(new URL('../assets/cloud-field.bin', import.meta.url)));
  const plane = CLOUD_WIDTH ** 2;
  assert.equal(field.length, plane * (2 * CLOUD_LAYERS + 1));
  const shade = field.subarray(-plane);
  assert.ok(shade.some(x => x < 90) && shade.some(x => x === 255));
});

test('tire marks follow separate wheel paths, survive field shifts, recover and clear on restart', async () => {
  const { Object3D } = await import('three/webgpu');
  const { GrassTracks } = await import('../src/grass-tracks.js');
  const tracks = new GrassTracks(), root = new Object3D();
  const tires = [-0.8, 0.8].map(x => {
    const pivot = new Object3D();
    pivot.position.x = x;
    return { pivot };
  });
  const value = (x, z) => {
    const { width, height, data } = tracks.map.image;
    const spacing = 0.20;
    const i = Math.floor((x - tracks.origin.value.x) / spacing);
    const j = Math.floor((z - tracks.origin.value.y) / spacing);
    return i >= 0 && i < width && j >= 0 && j < height ? data[j * width + i] : 0;
  };
  tracks.update(1, root, tires, false);
  assert.equal(tracks.active.value, 0);
  for (let i = 0; i <= 7; i++) {
    root.position.z = -i;
    tracks.update(1 + i / 10, root, tires, true);
  }
  assert.ok(value(-0.8, -2) > 170 && value(0.8, -2) > 170);
  assert.equal(value(0, -2), 0);
  tracks.update(8, root, tires, false);
  assert.ok(value(0.8, -2) > 0 && value(0.8, -2) < 130);
  tracks.update(13, root, tires, false);
  assert.equal(value(0.8, -2), 0);
  root.position.x = -100;
  tracks.update(14, root, tires, true);
  assert.ok(value(-100.8, -7) > 160);
  tracks.clear();
  assert.equal(tracks.active.value, 0);
  assert.ok(tracks.data.every(x => x === 0));
});

test('canopy shade follows planted trees across chunk and field boundaries', async () => {
  const { canopyShade } = await import('../src/canopy-shade.js');
  const { Matrix4 } = await import('three/webgpu');
  const canopy = canopyShade();
  let map;
  canopy.ambient.traverse(node => { if (node.isTextureNode) map = node.value; });
  const tree = new Matrix4().makeTranslation(7.5, 0, -129);
  const stand = { count: 1, instanceMatrix: { array: tree.elements } };
  const chunks = new Map([['1:0', { id: 1, trees: stand, aspens: { count: 0, instanceMatrix: { array: [] } } }]]);
  for (const x of [0, 32]) {
    canopy.update({ x, s: 128 }, chunks, 1);
    const { data, width } = map.image;
    const u = Math.floor((7.5 - x) / 1.25 + width / 2);
    const v = Math.floor(-1 / 1.25 + width / 2);
    assert.ok(data[v * width + u] > 120);
    assert.equal(data[v * width + u + 6], 0);
    const version = map.version;
    canopy.update({ x, s: 128 }, chunks, 1);
    assert.equal(map.version, version);
  }
  canopy.update({ x: 32, s: 128 }, new Map(), 2);
  assert.ok(map.image.data.every(x => x === 0));
});

test('the shadow behind an isolated ridge follows the sun from either side of the route', async () => {
  const { mountainLight } = await import('../src/mountain-light.js');
  const { DataUtils } = await import('three/webgpu');
  const world = {
    section: s => ({ x: 0, s }),
    sampleTerrain: (row, x) => Math.abs(x + 168) < 1 && Math.abs(row.s - 24) < 1 ? 1300 : 0,
  };
  for (const direction of [-1, 1]) {
    const light = mountainLight(world, { x: -1, y: 0.5, z: direction });
    light.update({ x: 0, s: 0 }, true);
    let map;
    light.visibility.traverse(node => { if (node.isTextureNode) map = node.value; });
    const { data, width } = map.image;
    const height = (x, s) => DataUtils.fromHalfFloat(data[Math.floor(s / 48 + width / 2) * width + Math.floor(x / 48 + width / 2)]);
    assert.ok(height(24, 24 + direction * 192) > 1000);
    assert.ok(height(24, 24 - direction * 192) < 1);
  }
});

test('driving tiles and mountain pages carry finite signed distances to the road, waterline and shore', () => {
  const world = createWorld(DEFAULT_SEED);
  for (const mesh of [buildTerrain(world, 0), buildTerrain(world, 6), mountainPage(world, 0, 0, 32)]) {
    assert.equal(mesh.groundOffsets.length, mesh.position.length / 3 * 4);
    let wet = 0, dry = 0;
    for (let i = 0; i < mesh.groundOffsets.length / 4; i++) {
      const row = world.section(-mesh.position[i * 3 + 2]);
      const offset = mesh.groundOffsets[i * 4], shore = mesh.groundOffsets[i * 4 + 1];
      assert.ok(Math.abs(mesh.groundOffsets[i * 4 + 2] - (row.water?.level ?? 0)) < 0.001);
      assert.ok(Math.abs(row.x + offset - mesh.position[i * 3]) < 0.001);
      assert.ok(Math.abs(shore - Math.max(-128, world.shoreDistance(row, offset))) < 0.001);
      assert.ok(Math.abs(mesh.groundOffsets[i * 4 + 3] - world.turnoutWidth(row.s)) < 0.001);
      if (shore > 0) wet++;
      if (shore < -8) dry++;
    }
    assert.ok(wet > 0 && dry > 0);
  }
});

test('quality changes keep the meadow visible while cell densities are replaced', async () => {
  const { Scene } = await import('three/webgpu');
  const { Meadow } = await import('../src/meadow.js');
  const meadow = new Meadow(new Scene(), { seed: 17, centerX: () => -1000, turnoutWidth: () => 0 }, () => 40);
  const car = { x: 0, s: 0 };
  meadow.update(car, false, true);
  const sample = () => {
    for (let s = -2; s <= 1; s++) {
      for (let x = -2; x <= 1; x++) assert.ok(meadow.cells.get(x + ',' + s)?.mesh.count > 0);
    }
  };
  for (const low of [true, false]) {
    meadow.update(car, low);
    sample();
    assert.ok([...meadow.cells.values()].some(cell => cell.low !== low));
    while (meadow.pending.length) { meadow.update(car, low); sample(); }
    assert.ok([...meadow.cells.values()].every(cell => cell.low === low));
  }
});

test('gravity rolls downhill, slows an uphill coast and leaves a cross-slope car planted', () => {
  const world = { centerX: () => 0, routePose: () => ({ length: 1, yaw: 0 }) };
  const coast = (height, speed) => {
    const car = { ...newCarState(world), speed };
    for (let i = 0; i < 120; i++) drive(car, 1 / 120, {}, false, world, height, VEHICLES.wagon);
    return car;
  };
  const downhill = coast(s => 100 - s * 0.16, 0);
  assert.ok(downhill.s > 0.4 && downhill.speed > 1);
  assert.equal(downhill.clearance, 0);
  assert.ok(coast(s => 100 + s * 0.16, 12).speed < coast(() => 100, 12).speed);
  const crossSlope = coast((s, x) => 100 + x * 0.38, 12);
  assert.equal(crossSlope.x, LANE_CENTER);
  assert.ok(crossSlope.roll > 0.3);
});

test('a crest launches the car, gravity brings it down, and steering stays predictable', () => {
  const world = { centerX: () => 0, routePose: () => ({ length: 1, yaw: 0 }) };
  const height = s => 100 + Math.min(s, 0) * 0.30;
  for (const vehicle of Object.values(VEHICLES)) {
    const car = { ...newCarState(world), speed: 20, s: -5 };
    let peak = 0, flight = 0, landed = false;
    for (let i = 0; i < 350; i++) {
      const airborne = car.clearance > 0;
      const oldVelocity = car.verticalSpeed, oldSpeed = car.speed;
      drive(car, 1 / 120, { right: airborne, throttle: airborne }, false, world, height, vehicle);
      peak = Math.max(peak, car.clearance);
      if (airborne && car.clearance > 0) {
        assert.ok(Math.abs(car.verticalSpeed - oldVelocity + 9.81 / 120) < 1e-10);
        assert.equal(car.speed, oldSpeed);
        assert.equal(car.heading, 0);
        flight++;
      }
      if (airborne && car.clearance === 0) { landed = true; break; }
    }
    assert.ok(landed && peak > 0.75 && peak < 2.3 && flight > 75, vehicle.name);
    for (let i = 0; i < 120; i++) drive(car, 1 / 120, { right: true }, false, world, height, vehicle);
    assert.equal(car.clearance, 0);
    assert.ok(car.heading > 0.3);
  }
});

test('bedrock shaping preserves flat elevations and changes the surveyed cliff relief', () => {
  const original = new Uint16Array(raster.buffer, raster.byteOffset, raster.byteLength / 2);
  const plain = new Uint16Array(original.length).fill(2400);
  assert.deepEqual(carveBedrock(plain), plain);
  let incised = 0, raised = 0;
  for (let i = 0; i < original.length; i++) {
    const delta = elevations[i] - original[i];
    if (delta < -24) incised++;
    if (delta > 24) raised++;
  }
  assert.ok(incised > 1000 && raised > 1000);
});

test('a car can clear a flooded ditch and recovers if it lands in deep water', () => {
  const world = { centerX: () => 0, routePose: () => ({ length: 1, yaw: 0 }) };
  const vehicle = VEHICLES.trail;
  const water = s => s <= 0 || s >= 3 ? 0.25 : -3;
  const jump = { ...newCarState(world), s: -1, speed: 12, pitch: 0, clearance: 1.5, verticalSpeed: 1 };
  for (let i = 0; i < 55; i++) drive(jump, 1 / 120, {}, false, world, water, vehicle);
  assert.ok(jump.s > 3 && jump.speed > 10);
  const falling = { ...newCarState(world), x: 20, clearance: 2, pitch: 0 };
  const basin = (s, x) => x > 10 ? -12 : 3;
  assert.equal(drive(falling, 1 / 120, {}, false, world, basin, vehicle), undefined);
  let recovery;
  for (let i = 0; i < 180 && !recovery; i++) recovery = drive(falling, 1 / 120, {}, false, world, basin, vehicle);
  assert.equal(recovery, 'deep-water');
  assert.equal(falling.x, LANE_CENTER);
  assert.equal(falling.clearance, 0);
});

test('seeded rivers run downhill into lakes on either side of a divide and keep the roadway dry', () => {
  for (const seed of [0, DEFAULT_SEED, 4294967295]) {
    const world = createWorld(seed);
    let left = 0, right = 0, mouths = 0;
    for (let s = -8200; s < 8200; s += 4) {
      const row = world.section(s), water = row.water;
      assert.ok(world.shoreDistance(row, 0) < -ROAD_EDGE);
      if (!water || Math.abs(water.flow) < 0.01 || water.source < 0.999) continue;
      const x = row.x + water.center;
      const downstream = world.section(s - Math.sign(water.flow) * 4);
      assert.equal(downstream.water.basin, water.basin);
      assert.ok(downstream.water.level <= water.level);
      assert.ok(world.sampleTerrain(row, water.center) < water.level - 0.3);
      assert.equal(world.waterLevel(s, x), water.level);
      assert.equal(surfaceAt({s, x}, world, () => world.sampleTerrain(row, water.center)), 'Shallows');
      if (water.level > 0 && downstream.water.level === 0) mouths++;
      if (water.flow > 0) left++;
      else right++;
    }
    assert.ok(left > 500 && right > 500 && mouths >= 8);
  }
});

test('trail suspension absorbs small crests and preserves takeoff pitch over a drop', () => {
  const world = createWorld();
  const tiles = new Map();
  const height = (s, x) => {
    const id = Math.floor(s / CHUNK_LENGTH);
    if (!tiles.has(id)) tiles.set(id, buildTerrain(world, id));
    return tileSurface(tiles.get(id), id, s, x);
  };
  const car = { ...newCarState(world), s: 430, x: world.centerX(430) + 160, heading: -0.8 };
  let peak = 0, extended = false, compressed = false;
  for (let i = 0; i < 1400; i++) {
    const inAir = car.clearance > 0, pitch = car.pitch;
    drive(car, 1 / 120, { throttle: true }, false, world, height, VEHICLES.trail);
    if (inAir && car.clearance > 0) assert.equal(car.pitch, pitch);
    peak = Math.max(peak, car.clearance);
    extended ||= car.extension > 0.1;
    compressed ||= car.extension < -0.05;
  }
  assert.ok(extended && compressed && peak > 0.05 && peak < 0.55);
  assert.equal(car.clearance, 0);
});

test('river valleys have a broad floor', () => {
  const world = createWorld();
  const s = 1840, row = world.section(s);
  assert.equal(world.biomeAt(s).name, 'River valley');
  const drySide = -Math.sign(row.water.center);
  const floor = [25, 50, 75, 100].map(offset => world.sampleTerrain(row, drySide * offset));
  assert.ok(Math.max(...floor) - Math.min(...floor) < 2);
  assert.ok(world.sampleTerrain(row, 1700) > Math.max(...floor) + 100);
});

test('every car can ford shallows and drive away after deep water at lake, river and fjord shores', () => {
  const world = createWorld();
  for (const s of [0, 1840, 2800]) {
    const row = world.section(s), id = Math.floor(s / CHUNK_LENGTH), tile = buildTerrain(world, id);
    const height = (station, x) => tileSurface(tile, id, station, x);
    for (const vehicle of Object.values(VEHICLES)) {
      const car = newCarState(world, s);
      car.heading = Math.sign(row.water.center) * Math.PI / 2;
      let recovery, waded = false;
      for (let i = 0; i < 2400 && !recovery; i++) {
        recovery = drive(car, 1 / 120, { throttle: true }, false, world, height, vehicle);
        const depth = world.waterLevel(car.s, car.x) - height(car.s, car.x);
        waded ||= depth > 0 && depth <= vehicle.ford && car.speed > 0;
      }
      assert.ok(waded);
      assert.equal(recovery, 'deep-water');
      assert.equal(car.x, world.centerX(car.s) + LANE_CENTER);
      assert.equal(car.speed, 0);
      const distance = car.distance;
      assert.ok(distance > 10);
      for (let i = 0; i < 120; i++) drive(car, 1 / 120, { throttle: true }, false, world, height, vehicle);
      assert.ok(car.distance > distance + 1 && car.speed > 1);
    }
  }
});

test('random departures start on pavement with a fresh trip meter and pinned starts replay', () => {
  const world = createWorld();
  const sample = [0, 0.33, 0.7, 0.999999].map(r => spawnStation('', () => r));
  assert.equal(new Set(sample).size, 4);
  for (const s of sample) {
    const car = newCarState(world, s);
    assert.equal(car.s, s);
    assert.equal(car.x, world.centerX(s) + LANE_CENTER);
    assert.equal(car.heading, -world.routePose(s).yaw);
    assert.equal(car.distance, 0);
    assert.equal(car.speed, 0);
  }
  assert.equal(spawnStation('?start=-2800'), -2800);
  assert.equal(spawnStation('?start=NaN', () => 0), sample[0]);
});

test('fjords have a deep tidal trough, a winding outlet, a widening sound and sloping shores', () => {
  for (const seed of [0, DEFAULT_SEED, 4294967295]) {
    const world = createWorld(seed);
    for (const group of [-3, -1, 1, 3]) {
      const regions = Array.from({length: 4}, (_, i) => world.biomeAt((4 * group + i) * REGION_LENGTH));
      const inlet = regions.find(region => region.name === 'Fjords').lake;
      const inner = world.section(inlet.s - 0.37 * inlet.length);
      const outer = world.section(inlet.s + 0.66 * inlet.length);
      assert.ok(outer.water.right - outer.water.left > 1.8 * (inner.water.right - inner.water.left));
      const mouth = world.section(inlet.s + 0.38 * inlet.length);
      // Follow the submerged channel seawards. Neighboring sections must overlap at depth.
      let last = null;
      for (const lateral of [420, 510, 620, 770, 950, 1200, 1450, 1710, 2000, 2400, 3200, 4000, 8000]) {
        const wet = new Set();
        for (let t = 0; t <= 100; t += 2) {
          const row = world.section(inlet.s + t / 100 * inlet.length);
          if (world.sampleTerrain(row, inlet.side * lateral) < -1) wet.add(t);
        }
        assert.ok(wet.size > 3 && (!last || [...last].some(t => wet.has(t))), 'continuous tidal channel');
        last = wet;
      }
      const sea = buildWater(world, Math.floor(mouth.s / CHUNK_LENGTH));
      assert.ok(sea.position.some((v, i) => i % 3 === 0 && v * inlet.side > 9000));
      for (const row of [inner, outer]) {
        assert.equal(row.water.level, 0);
        assert.ok(world.sampleTerrain(row, row.fjord.center) < (row === outer ? -60 : -25));
        const bank = inlet.side > 0 ? row.water.right : row.water.left;
        const shelf = world.sampleTerrain(row, bank + inlet.side * 25);
        assert.ok(shelf >= 0 && shelf < 15);
        assert.ok(world.sampleTerrain(row, bank + inlet.side * 80) > shelf + 8);
        if (row === inner) assert.ok(world.sampleTerrain(row, bank + inlet.side * 400) > 95);
        assert.ok(world.shoreDistance(row, 0) < -ROAD_EDGE);
      }
    }
  }
});

test('overlooks provide a dry gravel apron and one set of furniture across tile boundaries', async () => {
  const { BoxGeometry, MeshBasicMaterial } = await import('three/webgpu');
  const { wayside } = await import('../src/wayside.js');
  const rock = new BoxGeometry(), material = new MeshBasicMaterial();
  for (const seed of [0, DEFAULT_SEED, 4294967295]) {
    const world = createWorld(seed);
    for (const group of [-1, 0, 1]) {
      const lake = Array.from({length: 4}, (_, i) => world.biomeAt((group * 4 + i) * REGION_LENGTH).lake).find(Boolean);
      const s = lake.overlook;
      assert.equal(world.turnoutWidth(s), 12 * lake.side);
      for (const d of [-49, 49]) assert.equal(Math.abs(world.turnoutWidth(s + d)), 0);
      const counts = {};
      for (let id = Math.floor((s - 12) / CHUNK_LENGTH); id <= Math.floor((s + 12) / CHUNK_LENGTH); id++) {
        const tile = buildTerrain(world, id);
        const fixtures = wayside(world, tile, id, rock, material);
        const rebuilt = wayside(world, tile, id, rock, material);
        assert.deepEqual(fixtures.map(mesh => mesh.instanceMatrix.array), rebuilt.map(mesh => mesh.instanceMatrix.array));
        for (const mesh of fixtures) {
          counts[mesh.name] = (counts[mesh.name] ?? 0) + mesh.count;
          for (let i = 0; i < mesh.count; i++) {
            const [x, y, z] = mesh.instanceMatrix.array.slice(16 * i + 12, 16 * i + 15);
            assert.ok(Number.isFinite(x + y + z));
            assert.ok(Math.abs(x - world.centerX(-z)) > ROAD_EDGE);
            if (mesh.name === 'Bend markers') {
              const bend = roadBend(world, -z);
              assert.ok(Math.abs(bend) >= 5.2 && (x - world.centerX(-z)) * bend < 0);
            }
            if (mesh.name === 'Overlook bench' || mesh.name === 'Parking stops') {
              assert.ok(y > world.waterLevel(-z, x) + 0.5);
              assert.ok(Math.abs(y - tileSurface(tile, id, -z, x)) < 0.01);
            }
          }
        }
      }
      assert.equal(counts['Overlook bench'], 1);
      assert.equal(counts['Parking stops'], 4);
      const h = (s, x) => world.terrainHeight(s, x - world.centerX(s));
      const x = world.centerX(s) + 11 * lake.side;
      assert.equal(surfaceAt({s, x}, world, h), 'Gravel');
      assert.equal(surfaceAt({s, x: world.centerX(s) - 11 * lake.side}, world, h), 'Off road');
      assert.ok(Math.abs(h(s, x) - world.roadHeight(s)) < 0.65);
    }
  }
});

test('shallower inner banks, slower margins and riffle reaches follow the generated stream', () => {
  for (const seed of [DEFAULT_SEED, 9, 190013]) {
    const world = createWorld(seed);
    let bends = 0, runs = 0, riffles = 0, bars = 0;
    for (let s = -1250; s < 1500; s += 8) {
      const row = world.section(s), w = row.water;
      if (!w || w.lake || w.source < 0.99 || Math.abs(w.flow) < 0.99) continue;
      if (w.riffle > 0.7) riffles++;
      if (w.riffle < 0.1) runs++;
      if (Math.abs(w.bend) < 0.75) continue;
      const inside = Math.sign(w.bend) * 0.74 * w.width;
      const shelf = world.sampleTerrain(row, w.center + inside);
      assert.ok(shelf > world.sampleTerrain(row, w.center - inside));
      if (shelf >= w.level) bars++;
      bends++;
    }
    assert.ok(bends > 10 && riffles > 3 && runs > 3 && bars > 0);
    const strip = buildWater(world, 0);
    assert.ok(strip.flow.every(Number.isFinite));
    assert.equal(strip.banks.length, strip.depth.length * 2);
    assert.ok(strip.banks.every(value => Number.isFinite(value) && value >= 0 && value <= 2));
    assert.equal(strip.flow.length, strip.position.length);
    const river = Array.from({length: 8}, (_, i) => buildWater(world, i + 4)).find(mesh => mesh && !mesh.hasLake && Math.abs(mesh.flow[19]) > 0.8);
    assert.ok(river);
    const velocity = i => Math.hypot(river.flow[3*i], river.flow[3*i+1]);
    assert.ok(velocity(6) > velocity(0) * 1.5 && velocity(6) > velocity(12) * 1.5);
  }
});

test('blind crests and tight curves use solid markings and open straights allow passing', () => {
  const flat = () => 0;
  assert.equal(restrictedPassing({centerX: flat, roadHeight: flat}, 0), false);
  for (const s of [-47, -4, 0, 12, 120, 128]) {
    assert.equal(restrictedPassing({centerX: s => 0.003*s*s, roadHeight: flat}, s), true);
    assert.equal(restrictedPassing({centerX: flat, roadHeight: s => 90 - 0.001*s*s}, s), true);
    assert.equal(restrictedPassing({centerX: flat, roadHeight: s => 90 + 0.001*s*s}, s), false);
  }
});
