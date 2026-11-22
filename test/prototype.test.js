import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CHUNK_LENGTH, drive, newCarState, ROAD_EDGE, surfaceAt, TOUR_SPEED } from '../src/route.js';
import { bandBounds, buildTerrain, terrainBand, TERRAIN_COLUMNS } from '../src/terrain.js';
import { createWorld as seededWorld, DEFAULT_SEED, parseSeed, REGION_LENGTH } from '../src/world.js';
import { mountainPage } from '../src/horizon.js';
import { VEHICLES, vehicleId } from '../src/vehicles.js';
import { RecentFrames, ResolutionBudget, summarize } from '../src/timing.js';

const raster = readFileSync(new URL('../assets/shuksan.u16', import.meta.url));
const elevations = new Uint16Array(raster.buffer, raster.byteOffset, raster.byteLength / 2);
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
  assert.equal(car.x, world.centerX(car.s));
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
    assert.equal(new Set(names).size, 4);
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
  const lake = buildTerrain(world, 0).water;
  assert.ok(lake?.index.length > 0);
  assert.ok(lake.shore.some(value => value > 0));
  assert.equal(buildTerrain(world, 6).water, null);
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
