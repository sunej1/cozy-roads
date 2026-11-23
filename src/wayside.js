import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_LENGTH, noise, randomFor, roadBend, ROAD_EDGE } from './route.js';
import { tileSurface } from './terrain.js';

const timber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
const rushMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, side: THREE.DoubleSide });
const pose = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);

function stain(shape, tint) {
  const shade = new THREE.Color(tint);
  const colors = [];
  for (let i = 0; i < shape.attributes.position.count; i++) colors.push(shade.r, shade.g, shade.b);
  shape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return shape;
}

function board(x, y, z, w, h, d, color) {
  return stain(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

// The seat faces local +X. Leave a clear apron on the road side.
const bench = mergeGeometries([
  ...[-0.80, 0.80].flatMap(z => [
    board(-0.24, 0.40, z, 0.095, 1.03, 0.11, '#594a38'),
    board(0.20, 0.17, z, 0.10, 0.56, 0.11, '#625541'),
    board(0, 0.41, z, 0.61, 0.10, 0.12, '#69553e'),
  ]),
  ...[-0.17, 0, 0.17].map((x, i) => board(x, 0.49, 0, 0.154, 0.072, 2.12, ['#aa8b61','#99805d','#a38764'][i])),
  ...[0.73, 0.89].map(y => board(-0.24, y, 0, 0.065, 0.125, 2.12, '#957b58')),
]);
const sleeper = board(0, 0.08, 0, 0.19, 0.18, 2.05, '#8b795d');

function bendMarker() {
  const arrow = new THREE.Shape();
  arrow.moveTo(-0.24, 0.30);
  for (const [x, y] of [[-0.04, 0.30], [0.25, 0], [-0.04, -0.30], [-0.24, -0.30], [0.04, 0]]) arrow.lineTo(x, y);
  arrow.closePath();
  const faces = new THREE.ExtrudeGeometry(arrow, { depth: 0.062, bevelEnabled: false }).translate(0, 1.54, -0.031);
  return mergeGeometries([
    board(0, 0.72, 0, 0.075, 1.65, 0.07, '#767a70').toNonIndexed(),
    board(0, 1.54, 0, 0.68, 0.83, 0.056, '#d7a53b').toNonIndexed(),
    stain(faces, '#272b28'),
  ]);
}
const marker = bendMarker();

function rushClump() {
  const pos = [], colors = [], rng = randomFor(451);
  for (let i = 0; i < 36; i++) {
    const a = rng() * Math.PI * 2, radius = 0.36 * Math.sqrt(rng());
    const x = radius * Math.cos(a), z = radius * Math.sin(a);
    const w = 0.017 + rng() * 0.017, h = 0.50 + rng() * 0.91;
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
    const leanX = -Math.sin(a) * h * 0.25, leanZ = Math.cos(a) * h * 0.25;
    const left = [x - dx, 0, z - dz], right = [x + dx, 0, z + dz];
    const middleX = x + leanX * 0.34, middleZ = z + leanZ * 0.34;
    const upperLeft = [middleX - dx * 0.58, h * 0.72, middleZ - dz * 0.58];
    const upperRight = [middleX + dx * 0.58, h * 0.72, middleZ + dz * 0.58];
    pos.push(...left, ...right, ...upperLeft, ...right, ...upperRight, ...upperLeft,
      ...upperLeft, ...upperRight, x + leanX, h, z + leanZ);
    const base = new THREE.Color(i % 6 ? '#67733e' : '#977e4b');
    const tip = base.clone().lerp(new THREE.Color('#c6b77b'), 0.45 + rng() * 0.38);
    for (const c of [base, base, tip, base, tip, tip, tip, tip, tip]) colors.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
const rushes = rushClump();
const fallen = mergeGeometries([
  stain(new THREE.CylinderGeometry(0.62, 1, 1, 8), '#7f6b50'),
  stain(new THREE.CylinderGeometry(0.13, 0.34, 0.19, 5).rotateZ(0.83).translate(-0.65, 0.22, 0), '#96846b'),
  stain(new THREE.CylinderGeometry(0.19, 0.42, 0.17, 5).rotateX(0.76).translate(0, -0.22, 0.61), '#665c47'),
]);

export function wayside(world, tile, id, rock, rockMaterial) {
  const start = id * CHUNK_LENGTH, end = start + CHUNK_LENGTH;
  const random = randomFor(world.seed ^ Math.imul(id + 83, 0x45d9f3b));
  const height = (s, x) => tileSurface(tile, id, s, x);
  const result = [];
  function batch(name, shape, material, matrices) {
    if (!matrices.length) return;
    const mesh = new THREE.InstancedMesh(shape, material, matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.name = name;
    mesh.receiveShadow = true;
    result.push(mesh);
  }
  function place(matrices, x, y, s, yaw, w, h, d) {
    pose.position.set(x, y, -s);
    pose.rotation.set(0, yaw, 0);
    pose.scale.set(w, h, d);
    pose.updateMatrix();
    matrices.push(pose.matrix.clone());
  }
  const signs = [], seats = [], stops = [], blades = [], cobbles = [], logs = [];
  for (let s = Math.ceil(start / 20) * 20; s < end; s += 20) {
    const bend = roadBend(world, s), outside = -Math.sign(bend);
    if (Math.abs(bend) < 5.2 || world.turnoutWidth(s) * outside > 0.2) continue;
    const x = world.centerX(s) + outside * 8.4;
    place(signs, x, height(s, x), s, world.routePose(s).yaw + (bend < 0 ? Math.PI : 0), 1, 1, 1);
  }
  const lake = world.biomeAt((start + end) / 2).lake;
  if (lake) {
    for (const ds of [-10, -4.5, 0, 4.5, 10]) {
      const s = lake.overlook + ds;
      if (s < start || s >= end) continue;
      const seat = ds === 0;
      const x = world.centerX(s) + lake.side * (seat ? 15 : 12.6);
      const yaw = world.routePose(s).yaw + (seat && lake.side < 0 ? Math.PI : 0);
      place(seat ? seats : stops, x, height(s, x), s, yaw, 1, 1, 1);
    }
  }

  for (let i = 0; i < 24; i++) {
    const s = start + 3 + random() * (CHUNK_LENGTH - 6);
    const row = world.section(s), water = row.water;
    if (!water || water.source < 0.85) continue;
    const side = random() < 0.5 ? -1 : 1;
    if (water.riffle > 0.46 && i % 3 === 0) {
      const flank = water.bend >= 0 ? 1 : -1;
      const bar = water.center + flank * water.width * (0.23 + random() * 0.55);
      for (let j = 0; j < 5; j++) {
        const x = row.x + bar + (random() - 0.5) * 4, station = s + (random() - 0.5) * 5;
        const y = height(station, x), size = 0.42 + random() ** 2 * 1.05;
        if (y < water.level && y + size * 0.62 > water.level - 0.3) {
          place(cobbles, x, y, station, random() * 6.28, size, size * 0.68, size * 0.78);
        }
      }
    }
    const edge = side < 0 ? water.left : water.right;
    const patch = noise((row.x + edge) / 21 + world.seed % 97, s / 34);
    for (let j = 0; j < 6; j++) {
      const station = s + (random() - 0.5) * 5;
      const x = row.x + edge + side * (random() * 10 - 5);
      const y = height(station, x), level = world.waterLevel(station, x);
      if (Math.abs(x - world.centerX(station)) < 24 || y < level - 0.65 || y > level + 0.9) continue;
      const size = 0.32 + random() * 0.80;
      if (!row.fjord && patch > 0.49 && y < level + 0.36) {
        place(blades, x, y - 0.03, station, random() * 6.28, size, size, size);
      } else if (patch < 0.47 || row.fjord) {
        place(cobbles, x, y - size * 0.13, station, random() * 6.28, size, size * 0.48, size * 0.70);
      }
    }
  }
  for (let i = 0; i < 9; i++) {
    const s = start + 6 + random() * (CHUNK_LENGTH - 12), row = world.section(s);
    const side = random() < 0.5 ? -1 : 1;
    const bank = i < 4 && row.water;
    const offset = bank ? (side < 0 ? bank.left : bank.right) + side * (2 + random() * 4) : side * (15 + random() * 65);
    if (Math.abs(offset) < ROAD_EDGE + 8 + Math.max(0, row.turnout * Math.sign(offset)) || (!bank && row.trees < 0.78)) continue;
    const x = row.x + offset, y = height(s, x);
    const yaw = bank ? (random() - 0.5) * 0.85 : random() * Math.PI * 2;
    const length = 2.4 + random() * 5, radius = 0.11 + random() * 0.15;
    const dx = Math.sin(yaw) * length / 2, ds = Math.cos(yaw) * length / 2;
    const a = height(s - ds, x - dx), b = height(s + ds, x + dx);
    const middle = (a + b) / 2;
    if ((bank && (y < bank.level || y > bank.level + 1.5)) || y > 195 || Math.abs(a - b) > length * 0.54 || Math.abs(middle - y) > radius) continue;
    pose.quaternion.setFromUnitVectors(up, new THREE.Vector3(2 * dx, b - a, -2 * ds).normalize());
    pose.scale.set(radius, Math.hypot(length, b - a), radius);
    pose.position.set(x, middle + radius * 0.54, -s);
    pose.updateMatrix();
    logs.push(pose.matrix.clone());
  }
  batch('Bend markers', marker, timber, signs);
  batch('Overlook bench', bench, timber, seats);
  batch('Parking stops', sleeper, timber, stops);
  batch('Bank rushes', rushes, rushMaterial, blades);
  batch('Shore stones', rock, rockMaterial, cobbles);
  batch('Fallen wood', fallen, timber, logs);
  return result;
}
