import { attribute, cameraPosition, color, diffuseColor, dot, luminance, normalWorldGeometry, mix as mixColor, positionWorld, shadow, smoothstep, texture, uniform, uv, vec3, vec4 } from 'three/tsl';
import { mountainLight } from './mountain-light.js';
import { canopyShade } from './canopy-shade.js';
import { GrassTracks } from './grass-tracks.js';
import { cloudLayer } from './clouds.js';
import { SnowSurface } from './snow.js';
import { daylight, seasons } from './climate.js';
import { Horizon, horizonRange } from './horizon.js';
import { wayside } from './wayside.js';
import { Treeline, timberline } from './treeline.js';
import { Meadow, MEADOW_DETAIL_LAYER } from './meadow.js';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_LENGTH, mix, noise, randomFor, restrictedPassing, ROAD_EDGE, smooth } from './route.js';
import { atmosphere, makeSky, makeReliefTexture, makeTerrainMaterial, makeBoulderMaterial, makeWater, skyEnvironment, SUN } from './landscape.js';
import { applyMeadowWind, aspen, aspenMaterial, coniferMaterial, grassMaterial, bladeMaterial, flowerMaterial, understory, understoryMaterial } from './forest.js';
import { bandBounds, buildTerrain, buildWater, terrainBand, TERRAIN_STEP as STEP, tileSurface } from './terrain.js';

const paintMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91 });
const railMaterial = new THREE.MeshStandardMaterial({ color: 0x939e9c, metalness: 0.67, roughness: 0.58 });
const mineral = new THREE.Color();
const stone = new THREE.Color('#a7a6a1');
const asphalt = new THREE.Color('#c6cacf');
const ivory = new THREE.Color('#e6e6ce');
const amber = new THREE.Color('#dbc28a');
const dummy = new THREE.Object3D();

function strip(world, columns, start, end, step, sample) {
  const position = [];
  const colors = [];
  const uv = [];
  const index = [];
  let row = 0;
  for (let s = start; s <= end; s += step, row++) {
    const x = world.centerX(s);
    for (let col = 0; col < columns.length; col++) {
      const lateral = columns[col];
      const { y, color } = sample(s, lateral, col);
      position.push(x + lateral, y, -s);
      colors.push(color.r, color.g, color.b);
      uv.push((x + lateral) / 5.8, s / 5.8);
      if (row > 0 && col > 0) {
        const d = row * columns.length + col;
        const c = d - 1;
        const b = d - columns.length;
        index.push(b - 1, b, c, b, d, c);
      }
    }
  }
  const shape = geometry(position, colors, index);
  shape.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return shape;
}

function geometry(position, colors, index) {
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  shape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shape.setIndex(index);
  shape.computeVertexNormals();
  return shape;
}

function markings(world, start, end) {
  const position = [];
  const colors = [];
  const index = [];

  function line(left, right, first, last, shade) {
    const count = Math.ceil((last - first) / STEP);
    for (let row = 0; row <= count; row++) {
      const s = mix(first, last, row / count);
      const x = world.centerX(s);
      const i = position.length / 3;
      position.push(x + left, world.roadHeight(s, left) + 0.069, -s);
      position.push(x + right, world.roadHeight(s, right) + 0.069, -s);
      const wear = 0.83 + noise(s * 0.47, left * 2) * 0.17;
      colors.push(shade.r * wear, shade.g * wear, shade.b * wear, shade.r * wear, shade.g * wear, shade.b * wear);
      if (row) index.push(i - 2, i - 1, i, i - 1, i + 1, i);
    }
  }

  for (let s = Math.floor(start / 12) * 12; s < end; s += 12) {
    const first = Math.max(start, s), last = Math.min(end, s + 12);
    const dashEnd = Math.min(end, s + 4);
    const turnout = world.turnoutWidth(s + 6);
    for (const side of [-1, 1]) {
      const entrance = turnout * side > 0.35 && turnout * side < 10.5;
      const stop = entrance ? dashEnd : last;
      if (stop > first) line(side * 3.99 - 0.07, side * 3.99 + 0.07, first, stop, ivory);
    }
    if (restrictedPassing(world, s)) {
      line(-0.20, -0.075, first, last, amber);
      line(0.075, 0.20, first, last, amber);
    } else if (first < dashEnd) line(-0.065, 0.065, first, dashEnd, amber);
  }
  return geometry(position, colors, index);
}

const shrub = understory();
const broadleaf = aspen();
const rock = makeRock();
const railBeam = makeBeam();
const railPost = new THREE.BoxGeometry(0.12, 1.06, 0.16);
const roadPost = mergeGeometries([
  postPart(0.12, 0.92, 0.10, 0.40, '#cdd1c4'),
  postPart(0.128, 0.16, 0.107, 0.715, '#282e2e'),
  postPart(0.076, 0.065, 0.116, 0.72, '#de8f48'),
]);

function postPart(width, height, depth, y, tint) {
  const shape = new THREE.BoxGeometry(width, height, depth).translate(0, y, 0);
  const shade = new THREE.Color(tint);
  shape.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: shape.getAttribute('position').count }, () => shade.toArray()).flat(), 3));
  return shape;
}

function makeBeam() {
  const profile = new THREE.Shape();
  const folds = [[-0.06, 0.13], [0.061, 0.108], [0.067, 0.06], [-0.018, 0.0],
    [0.067, -0.06], [0.061, -0.108], [-0.06, -0.13]];
  profile.moveTo(...folds[0]);
  for (const point of folds.slice(1)) profile.lineTo(...point);
  for (const [x, y] of [...folds].reverse()) profile.lineTo(x - 0.017, y);
  profile.closePath();
  return new THREE.ExtrudeGeometry(profile, { depth: 1, steps: 1, bevelEnabled: false })
    .rotateY(Math.PI / 2).translate(-0.5, 0, 0);
}

function makeRock() {
  const shape = new THREE.IcosahedronGeometry(1, 2);
  const vertices = shape.getAttribute('position');
  const colors = [];
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i);
    const y = vertices.getY(i);
    const z = vertices.getZ(i);
    const crumble = noise(x * 6 + y, z * 5 - y * 2);
    const r = 0.82 + noise(x * 1.8 + 6, z * 2.7 + y * 1.67) * 0.35 + crumble * 0.13;
    vertices.setXYZ(i, x * r + y * 0.28, Math.min(y * r, 0.78 + x * 0.23), z * r);
    const shade = 0.50 + crumble * 0.23 + smooth(-0.55, 0.70, y) * 0.34;
    colors.push(shade * 1.06, shade, shade * 0.96);
  }
  shape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shape.computeVertexNormals();
  return shape;
}

function scatter(world, tile, chunkId, band, start, scans, conifer, rockMaterial) {
  const random = randomFor(world.seed ^ Math.imul(chunkId + 17, 0x7c4a541) ^ Math.imul(band, 0x567721));
  const density = world.section(start + CHUNK_LENGTH * 0.5).trees;
  const [left, right] = bandBounds(band);
  const treeAttempts = band === 0 ? Math.round(mix(540, 850, smooth(0.73, 1, density))) : 440;
  const trees = new THREE.InstancedMesh(conifer, coniferMaterial, treeAttempts);
  const aspens = new THREE.InstancedMesh(broadleaf, aspenMaterial, band === 0 ? 155 : 80);
  const shrubs = new THREE.InstancedMesh(shrub, understoryMaterial, band === 0 ? 235 : 38);
  const rocks = new THREE.InstancedMesh(rock, rockMaterial, band === 0 ? 25 : 12);
  const treeTint = new THREE.Color();
  let planted = 0;
  let aspensPlanted = 0;
  let stones = 0;
  const scanned = scans.map(({ geometry, material }) => {
    const batch = new THREE.InstancedMesh(geometry, material, 4);
    batch.count = 0;
    batch.castShadow = batch.receiveShadow = true;
    return batch;
  });

  for (let i = 0; i < trees.count; i++) {
    const s = start + random() * CHUNK_LENGTH;
    const row = world.section(s);
    const woodland = smooth(0.72, 1, row.trees);
    const nearRoad = i % 7 !== 0;
    const lateral = band === 0
      ? (random() < 0.5 ? -1 : 1) * (nearRoad ? 10.5 + random() ** mix(1.68, 2.42, woodland) * 436 : mix(410, right, random()))
      : mix(left, right, random());
    const y = tileSurface(tile, chunkId, s, row.x + lateral, band);
    const clearing = noise(lateral / 38 + world.seed % 83, s / 57);
    const shore = world.shoreDistance(row, lateral);
    const lookOut = row.turnout * Math.sign(lateral) > 2 && Math.abs(lateral) < 48;
    const grade = Math.hypot(tileSurface(tile, chunkId, s, row.x + lateral + 2, band) - y,
      tileSurface(tile, chunkId, s + 2, row.x + lateral, band) - y) / 2;
    const treeline = timberline(row, noise((row.x + lateral) / 125 + world.seed % 997, s / 152));
    const alpineCover = 1 - smooth(treeline - 125, treeline, y);
    const scoured = smooth(-34, -1, shore) * (1 - smooth(2, 9, y - (row.water?.level ?? 0)))
      * Math.abs(row.water?.flow ?? 0);
    if (lookOut || grade > 0.98 + clearing * 0.24 || y < 3 || shore > -2 || random() > alpineCover * (1 - 0.82 * scoured) * (0.15 + row.trees * .87) * (0.35 + clearing * 1.10)) continue;
    const scale = (0.65 + random() ** 1.5 * 1.27) * (1 - 0.36 * smooth(63, 151, y)) * (1 + woodland * 0.24);
    dummy.position.set(row.x + lateral, y - 0.26, -s);
    dummy.rotation.set((random() - 0.5) * 0.17, random() * Math.PI * 2, (random() - 0.5) * 0.11);
    const breadth = scale * (0.74 + random() * 0.36);
    dummy.scale.set(breadth, scale, breadth);
    dummy.updateMatrix();
    treeTint.setRGB(0.71 + random() * 0.27, 0.82 + random() * 0.18, 0.76 + random() * 0.29);
    const damp = (1 - smooth(4, 43, -shore)) * (1 - smooth(2, 17, y - (row.water?.level ?? 0)));
    const grove = noise((row.x + lateral) / 44 + 79, s / 51 + 11)
      + damp * 0.19 - smooth(0.33, 0.81, grade) * 0.32 - smooth(65, 130, y) * 0.32;
    if (aspensPlanted < aspens.count && grove > 0.60) {
      aspens.setMatrixAt(aspensPlanted, dummy.matrix);
      aspens.setColorAt(aspensPlanted++, treeTint.setRGB(1.25 + grove * 0.37, 0.96, 0.61));
      continue;
    }
    trees.setMatrixAt(planted, dummy.matrix);
    trees.setColorAt(planted++, treeTint);
  }
  trees.count = planted;
  aspens.count = aspensPlanted;
  trees.computeBoundingSphere();

  for (let i = 0; i < rocks.count; i++) {
    const s = start + random() * CHUNK_LENGTH;
    const lateral = band === 0
      ? (random() < 0.48 ? -1 : 1) * (10.5 + random() ** 2 * 94) : mix(left, right, random());
    const row = world.section(s), x = row.x + lateral;
    const y = tileSurface(tile, chunkId, s, x, band);
    if (row.turnout * Math.sign(lateral) + ROAD_EDGE + 5 > Math.abs(lateral) || y < -0.2) continue;
    const uphill = Math.max(tileSurface(tile, chunkId, s, x - 16, band), tileSurface(tile, chunkId, s, x + 16, band),
      tileSurface(tile, chunkId, s - 14, x, band), tileSurface(tile, chunkId, s + 14, x, band)) - y;
    const bank = 1 - smooth(1, 10, Math.abs(world.shoreDistance(row, lateral)));
    const talus = Math.max(smooth(3, 13, uphill), 0.58 * bank);
    const erratic = random() < 0.026;
    const size = 0.30 + random() ** 2 * (erratic ? 3.6 : mix(0.88, 3.6, talus));
    const foot = Math.min(tileSurface(tile, chunkId, s, x - size, band), tileSurface(tile, chunkId, s, x + size, band),
      tileSurface(tile, chunkId, s - size, x, band), tileSurface(tile, chunkId, s + size, x, band));
    // Loose talus settles below a rock face. Reject perches with an unsupported downslope edge.
    if (y - foot > size * 0.96) continue;
    dummy.position.set(x, Math.min(y - 0.10 * size, foot + 0.16 * size), -s);
    const angle = random() * Math.PI * 2;
    dummy.rotation.set(random() * 0.78, angle, random() * 0.72);
    dummy.scale.set(size * 1.1, size * 0.66, size);
    dummy.updateMatrix();
    rocks.setMatrixAt(stones, dummy.matrix);
    rocks.setColorAt(stones++, mineral.copy(stone).multiplyScalar(0.67 + random() * 0.31));
  }
  rocks.count = stones;
  const largest = [];
  for (let i = 0; i < stones; i++) {
    rocks.getMatrixAt(i, dummy.matrix);
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
    largest.push([i, dummy.scale.x]);
  }
  largest.sort((a, b) => b[1] - a[1]);
  const nearStones = new THREE.InstancedMesh(rock, rockMaterial, 25);
  const replaced = new Set(largest.slice(0, scanned.length * 2).map(([i]) => i));
  let row = 0;
  let fitted = 0;
  for (let i = 0; i < stones; i++) {
    rocks.getMatrixAt(i, dummy.matrix);
    if (replaced.has(i)) {
      const batch = scanned[fitted++ % scanned.length];
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      dummy.rotation.set(0, dummy.rotation.y, 0);
      dummy.scale.y = dummy.scale.x;
      dummy.updateMatrix();
      batch.setMatrixAt(batch.count++, dummy.matrix);
    } else {
      rocks.getColorAt(i, mineral);
      nearStones.setMatrixAt(row, dummy.matrix);
      nearStones.setColorAt(row++, mineral);
    }
  }
  nearStones.count = row;
  nearStones.castShadow = nearStones.receiveShadow = true;

  const grassTint = new THREE.Color();
  let shrubCount = 0;
  const leaves = new THREE.Color('#6b9e52');
  const pale = new THREE.Color('#efdd96');
  for (let i = 0; i < shrubs.count; i++) {
    const s = start + random() * CHUNK_LENGTH;
    const offset = band === 0 ? (i % 2 ? 1 : -1) * (5.7 + random() ** 1.55 * 74) : mix(left, right, random());
    const x = world.centerX(s) + offset;
    const y = tileSurface(tile, chunkId, s, x, band);
    const cover = noise(offset * 0.16 + 38, s * 0.12);
    if (Math.abs(offset) < ROAD_EDGE + 1 + Math.max(0, world.turnoutWidth(s) * Math.sign(offset)) || y < -0.03 || y > 124 || cover < 0.44 || world.shoreDistance(world.section(s), offset) > -1) continue;
    dummy.position.set(x, y - 0.018, -s);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    const size = 0.39 + random() ** 1.4 * 1.13;
    dummy.scale.set(size, size * (0.54 + random() * 0.57), size);
    dummy.updateMatrix();
    shrubs.setMatrixAt(shrubCount, dummy.matrix);
    shrubs.setColorAt(shrubCount++, grassTint.copy(leaves).lerp(pale, smooth(0.51, 0.87, cover)));
  }
  shrubs.count = shrubCount;
  return { trees, aspens, rocks, nearStones, scanned, shrubs };
}

function delineators(world, start, end) {
  const stride = 32;
  const mesh = new THREE.InstancedMesh(roadPost, paintMaterial, Math.ceil((end - start) / stride) * 2);
  let count = 0;
  for (let s = start + 12; s < end; s += stride) {
    for (const side of [-1, 1]) {
      if (world.turnoutWidth(s) * side > 0.1) continue;
      const lateral = side * 5.80;
      dummy.position.set(world.centerX(s) + lateral, world.terrainHeight(s, lateral), -s);
      dummy.rotation.set(0, world.routePose(s).yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(count++, dummy.matrix);
    }
  }
  mesh.count = count;
  mesh.receiveShadow = true;
  return mesh;
}

function railing(world, tile, id, start, end) {
  const step = 4;
  const capacity = Math.ceil((end - start) / step) * 2;
  const beams = new THREE.InstancedMesh(railBeam, railMaterial, capacity);
  const posts = new THREE.InstancedMesh(railPost, railMaterial, capacity * 2);
  let count = 0, postCount = 0;
  function post(x, y, s) {
    dummy.position.set(x, y + 0.53, -s);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    posts.setMatrixAt(postCount++, dummy.matrix);
  }
  function offset(row, side) {
    return side * (7.1 + Math.max(0, row.turnout * side));
  }
  function exposed(row, side) {
    const edge = offset(row, side);
    const downhill = world.sampleTerrain(row, edge) - world.sampleTerrain(row, edge + side * 14);
    return downhill > 2.25 || (downhill > 0.75 && world.shoreDistance(row, edge + side * 19) > -3);
  }
  for (let s = start; s < end; s += step) {
    const next = s + step;
    const row = world.section(s + step / 2), ahead = world.section(next + step / 2);
    for (const side of [-1, 1]) {
      if (!exposed(row, side)) continue;
      const edge = offset(world.section(s), side), farEdge = offset(world.section(next), side);
      const x = world.centerX(s) + edge, x1 = world.centerX(next) + farEdge;
      const y = tileSurface(tile, id, s, x), y1 = tileSurface(tile, id, next, x1);
      post(x, y, s);
      if (!exposed(ahead, side)) post(x1, y1, next);
      const length = Math.hypot(step, x1 - x, y1 - y);
      dummy.position.set((x + x1) / 2, (y + y1) / 2 + 0.91, -(s + next) / 2);
      dummy.rotation.set(0, Math.atan2(step, x1 - x), 0);
      dummy.rotateZ(Math.asin((y1 - y) / length));
      dummy.scale.set(length + 0.01, 1, 1);
      dummy.updateMatrix();
      beams.setMatrixAt(count++, dummy.matrix);
    }
  }
  beams.count = count;
  posts.count = postCount;
  return [beams, posts];
}

export class WorldView {
  constructor(scene, assets, world, camera) {
    this.scene = scene;
    this.world = world;
    this.low = false;
    this.inFlight = null;
    this.readyTile = null;
    try {
      this.worker = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
      this.worker.postMessage({ seed: world.seed, elevations: assets.elevations });
      this.worker.addEventListener('message', ({ data }) => {
        this.inFlight = null;
        this.readyTile = data;
      });
      this.worker.addEventListener('error', () => {
        this.inFlight = null;
        this.worker?.terminate();
        this.worker = null;
      });
    } catch {
      this.worker = null;
    }
    this.waterStrips = new Map();
    this.chunks = new Map();
    this.terrainRevision = 0;
    coniferMaterial.map = assets.canopy;
    this.conifer = assets.conifer;
    this.distantConifer = assets.distantConifer;
    grassMaterial.map = assets.clumps;
    aspenMaterial.map = assets.spray;
    flowerMaterial.map = assets.blossoms;
    this.treeline = new Treeline(scene, world, (s,x) => this.surfaceHeight(s,x), this.distantConifer);
    this.tracks = new GrassTracks();
    this.canopy = canopyShade();
    applyMeadowWind(this.tracks, this.canopy);
    this.meadow = new Meadow(scene, world, (s,x) => this.surfaceHeight(s,x), assets.leafLevels, camera.position);
    this.cozy = uniform(1);
    this.winter = uniform(0);
    this.meadowColor = uniform(new THREE.Color(0xffffff));
    this.sunDirection = uniform(SUN.clone());
    this.skyTint = uniform(new THREE.Color(0xffffff));
    this.airTint = uniform(new THREE.Color(0xffffff));
    this.night = uniform(0);
    this.snow = new SnowSurface(scene, world, (s,x) => this.surfaceHeight(s,x));
    aspenMaterial.maskNode = this.winter.lessThan(0.5).or(uv().x.greaterThan(0.73));
    const needles = texture(assets.canopy);
    const frost = smoothstep(0.12, 0.62, normalWorldGeometry.y.add(needles.g.mul(0.65))).mul(this.winter,0.79);
    coniferMaterial.colorNode = vec4(mixColor(needles.rgb, color('#d6e1e8'), frost),needles.a);
    const reliefMap = makeReliefTexture(assets.elevations);
    this.terrainMaterial = makeTerrainMaterial(reliefMap, assets.turf, assets.bedrock, this.tracks, this.cozy, this.canopy.cover, this.winter, this.meadowColor);
    this.lowTerrainMaterial = makeTerrainMaterial(reliefMap, assets.turf, assets.bedrock, this.tracks, this.cozy, this.canopy.cover, this.winter, this.meadowColor, true);
    for (const material of [this.terrainMaterial, this.lowTerrainMaterial, bladeMaterial, grassMaterial, flowerMaterial, understoryMaterial]) {
      material.aoNode = material.aoNode ? material.aoNode.mul(this.canopy.ambient) : this.canopy.ambient;
    }
    this.horizon = new Horizon(scene, world, this.terrainMaterial, (id, band) => this.chunks.has(id + ':' + band));
    this.roadMaterial = new THREE.MeshStandardNodeMaterial({
      vertexColors: false, map: assets.pavement, normalMap: assets.normal,
      normalScale: new THREE.Vector2(0.58, 0.58), roughnessMap: assets.rough, roughness: 0.97,
    });
    const pavement = texture(assets.pavement);
    // Preserve the aggregate detail while weathering the brown binder toward grey.
    this.roadMaterial.colorNode = mixColor(vec3(luminance(pavement.rgb)), pavement.rgb, 0.21).mul(1.53, attribute('color','vec3'));
    this.roadMaterial.colorNode = mixColor(this.roadMaterial.colorNode, color('#bbc9d6')
      .mul(pavement.g.mul(0.24).add(0.88)), this.winter);
    const paintGrain = texture(assets.pavement, positionWorld.xz.div(5.8)).r;
    this.markingMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.91 });
    this.markingMaterial.maskNode = this.winter.lessThan(0.5);
    this.markingMaterial.colorNode = vec3(smoothstep(0.017, 0.085, paintGrain).mul(0.45).add(0.51));
    this.rockMaterial = makeBoulderMaterial(assets.bedrock);
    this.rockModels = assets.rocks;
    this.headlight = new THREE.SpotLight(0xffdfa6, 1450, 85, 0.42, 0.64, 1.85);
    scene.add(this.headlight, this.headlight.target);
    this.sky = makeSky();

    scene.environmentIntensity = 0.48;

    this.skyLight = new THREE.HemisphereLight('#c2d9f6', '#8a805b', 0.82);
    this.sun = new THREE.DirectionalLight('#ffdfb0', 4.45);
    this.sun.position.copy(SUN).multiplyScalar(125);
    this.sun.castShadow = true;
    this.clouds = cloudLayer(this.sky, this.sunDirection, assets.clouds);
    const elevation = positionWorld.sub(cameraPosition).normalize().y;
    const horizonTint = mixColor(color('#f2bda3'), color('#acbfdc'), smoothstep(0.01, 0.54, elevation));
    const cloudlight = this.sky.material.colorNode;
    this.sky.material.colorNode = mixColor(cloudlight.rgb, cloudlight.rgb.mul(0.46).add(horizonTint.mul(0.75)),
      this.cozy.mul(0.78)).mul(this.skyTint);
    const sight = positionWorld.sub(cameraPosition).normalize();
    const moon = smoothstep(0.99988, 0.99997, dot(sight, this.sunDirection));
    const starUV = sight.xz.div(sight.y.max(0).add(1)).mul(235);
    const star = smoothstep(0.015, 0.12, starUV.fract().sub(0.5).length()).oneMinus()
      .mul(dot(starUV.floor(),vec3(12.9898,78.233,0).xy).sin().mul(43758.55).fract().greaterThan(0.978),
        smoothstep(0.12,0.48,sight.y));
    const moonlit = mixColor(color('#394963'),color('#101d34'),smoothstep(0.01,0.65,sight.y))
      .add(color('#c8d9f4').mul(moon.add(star.mul(0.38))));
    this.sky.material.colorNode = mixColor(this.sky.material.colorNode,moonlit,this.night);
    this.mountainLight = mountainLight(world, this.sunDirection.value);
    const sunlight = this.mountainLight.visibility.mul(this.clouds.shadow);
    this.far = atmosphere(scene, this.mountainLight.visibilityAt, this.cozy, this.sunDirection, this.airTint);
    const backlight = dot(positionWorld.sub(cameraPosition).normalize(), this.sunDirection).max(0).pow(3);
    for (const material of [grassMaterial, bladeMaterial, flowerMaterial, aspenMaterial]) {
      material.emissiveNode = diffuseColor.rgb.mul(backlight.mul(sunlight, 0.53).add(0.19).mul(this.airTint));
    }
    this.water = makeWater(sunlight, assets.bedrock, this.cozy, this.sunDirection, this.airTint);
    // The half-resolution lake keeps the meadow clumps. Individual blades only resolve in the main view.
    camera.layers.enable(MEADOW_DETAIL_LAYER);
    this.water.reflector.getVirtualCamera(camera).layers.disable(MEADOW_DETAIL_LAYER);
    this.lowSun = new THREE.DirectionalLight(this.sun.color, this.sun.intensity);
    this.lowSun.target = this.sun.target;
    this.lowSun.castShadow = true;
    this.lowSun.shadow.shadowNode = sunlight;
    this.lowSun.visible = false;
    this.sun.shadow.shadowNode = shadow(this.sun).mul(sunlight);
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -56, right: 56, top: 56, bottom: -56, near: 10, far: 285 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.068;
    this.sun.shadow.bias = -0.00022;
    this.sun.shadow.radius = 2.12;
    scene.add(this.sky, this.water.anchor, this.skyLight, this.lowSun, this.sun, this.sun.target);
  }

  build(id, band, tile) {
    const chunk = new THREE.Group();
    const start = id * CHUNK_LENGTH;
    const end = start + CHUNK_LENGTH;
    const world = this.world;
    const ground = new THREE.BufferGeometry();
    ground.setAttribute('position', new THREE.BufferAttribute(tile.position, 3));
    ground.setAttribute('normal', new THREE.BufferAttribute(tile.normal, 3));
    ground.setAttribute('reliefField', new THREE.BufferAttribute(tile.relief, 4));
    ground.setAttribute('groundOffsets', new THREE.BufferAttribute(tile.groundOffsets, 4));
    ground.setIndex(new THREE.BufferAttribute(tile.index, 1));
    const groundMesh = new THREE.Mesh(ground, this.low ? this.lowTerrainMaterial : this.terrainMaterial);
    groundMesh.receiveShadow = true;
    chunk.add(groundMesh);

    const detail = band === 0 ? wayside(world, tile, id, rock, this.rockMaterial) : [];
    for (const mesh of detail) chunk.add(mesh);
    if (band === 0) {
      const cols = [-ROAD_EDGE, -2.95, -2.15, -1.35, 0, 1.35, 2.15, 2.95, ROAD_EDGE];
      const road = new THREE.Mesh(strip(world, cols, start, end, STEP, (s, lateral) => {
        const mottling = noise(lateral * 0.95 + 1, s / 4);
        const roadDust = 0.16 * smooth(2.9, ROAD_EDGE, Math.abs(lateral));
        const traffic = 0.12 * (1 - smooth(0.15, 1.1, Math.abs(Math.abs(Math.abs(lateral) - 2.15) - 0.8)));
        mineral.copy(asphalt).multiplyScalar(0.88 + mottling * 0.24 + roadDust - traffic);
        return { y: world.roadHeight(s, lateral) + 0.03, color: mineral };
      }), this.roadMaterial);
      const lines = new THREE.Mesh(markings(world, start, end), this.markingMaterial);
      road.receiveShadow = lines.receiveShadow = true;
      const rails = railing(world, tile, id, start, end);
      rails.forEach(rail => { rail.castShadow = rail.receiveShadow = true; });
      chunk.add(road, lines, delineators(world, start, end), ...rails);
    }

    const { trees, aspens, rocks, nearStones, scanned, shrubs } = scatter(world, tile, id, band, start, band === 0 ? this.rockModels : [], this.conifer, this.rockMaterial);
    trees.castShadow = aspens.castShadow = rocks.castShadow = true;
    trees.receiveShadow = aspens.receiveShadow = rocks.receiveShadow = shrubs.receiveShadow = true;
    chunk.add(trees, aspens, rocks, nearStones, ...scanned, shrubs);
    this.chunks.set(id + ':' + band, { id, band, tile, chunk, groundMesh, detail, trees, aspens, rocks, nearStones, scanned, shrubs, treeCount: trees.count });
    this.scene.add(chunk);
    this.terrainRevision++;
  }

  surfaceHeight(s, x) {
    const id = Math.floor(s / CHUNK_LENGTH);
    const lateral = x - this.world.centerX(s);
    const band = terrainBand(lateral);
    const chunk = this.chunks.get(id + ':' + band);
    return chunk ? tileSurface(chunk.tile, id, s, x, band) : this.world.terrainHeight(s, lateral);
  }

  updateWater(first, last, x, current) {
    const reach = (Math.floor(Math.abs(x) / 4096) + 4) * 4096;
    if (first === this.waterFirst && last === this.waterLast && reach === this.seaReach) return;
    const range = Math.ceil(horizonRange(this.low) / CHUNK_LENGTH);
    const near = id => id >= first && id <= last;
    for (const [id, mesh] of this.waterStrips) {
      if ((near(id) || (mesh?.userData.hasLake && Math.abs(id - current) <= range)) && reach === this.seaReach) continue;
      if (mesh) { this.scene.remove(mesh); mesh.geometry.dispose(); mesh.children.forEach(child => child.dispose()); }
      this.waterStrips.delete(id);
    }
    this.waterFirst = first;
    this.waterLast = last;
    this.seaReach = reach;
    for (let id = current - range; id <= current + range; id++) {
      if (this.waterStrips.has(id)) continue;
      if (!near(id)) {
        const row = this.world.section((id + 0.5) * CHUNK_LENGTH);
        if (!row.lakes.some(lake => lake.pastHead <= CHUNK_LENGTH / 2)) continue;
      }
      const data = buildWater(this.world, id, reach);
      let mesh = null;
      if (data) {
        const surface = new THREE.BufferGeometry();
        surface.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
        surface.setAttribute('channel', new THREE.BufferAttribute(data.channel, 2));
        surface.setAttribute('obstacle', new THREE.BufferAttribute(data.obstacle, 3));
        surface.setAttribute('flow', new THREE.BufferAttribute(data.flow, 3));
        surface.setAttribute('banks', new THREE.BufferAttribute(data.banks, 2));
        surface.setAttribute('waterDepth', new THREE.BufferAttribute(data.depth, 1));
        surface.setIndex(new THREE.BufferAttribute(data.index, 1));
        surface.computeVertexNormals();
        mesh = new THREE.Mesh(surface, data.hasLake && !this.low ? this.water.material : this.water.lowMaterial);
        mesh.userData.hasLake = data.hasLake;
        if (data.boulders.length) {
          const stones = new THREE.InstancedMesh(rock, this.rockMaterial, data.boulders.length);
          for (const [i, b] of data.boulders.entries()) {
            dummy.position.set(b.x, b.level - 0.32 * b.radius, -b.station);
            dummy.rotation.set(0, b.angle, 0);
            dummy.scale.set(b.radius, Math.max(b.radius, b.depth + 0.2), b.radius * 0.91);
            dummy.updateMatrix();
            stones.setMatrixAt(i, dummy.matrix);
          }
          stones.receiveShadow = true;
          mesh.add(stones);
        }
        this.scene.add(mesh);
      }
      this.waterStrips.set(id, mesh);
    }
  }

  update(car, low, eager = false) {
    const current = Math.floor(car.s / CHUNK_LENGTH);
    const lateral = car.x - this.world.centerX(car.s);
    const along = Math.cos(car.heading);
    const across = Math.sin(car.heading);
    const reach = low ? 9 : 12;
    const backwards = Math.ceil(mix(3, reach, smooth(-0.55, 0.36, -along)));
    const forwards = Math.ceil(mix(3, reach, smooth(-0.55, 0.36, along)));
    this.updateWater(current - backwards, current + forwards, car.x, current);
    const sideRange = low ? 740 : 910;
    const left = terrainBand(lateral - sideRange - Math.max(0, -across) * 410);
    const right = terrainBand(lateral + sideRange + Math.max(0, across) * 410);
    const fits = (id, band) => id >= current - backwards && id <= current + forwards && band >= left && band <= right;
    for (const [key, { id, band, chunk }] of this.chunks) {
      if (fits(id, band)) continue;
      for (const mesh of chunk.children) {
        if (mesh.isInstancedMesh) mesh.dispose();
        else mesh.geometry.dispose();
      }
      this.scene.remove(chunk);
      this.chunks.delete(key);
      this.terrainRevision++;
    }

    if (this.readyTile) {
      const { id, band, tile } = this.readyTile;
      this.readyTile = null;
      if (fits(id, band) && !this.chunks.has(id + ':' + band)) this.build(id, band, tile);
    }

    let closest = null;
    for (let id = current - backwards; id <= current + forwards; id++) {
      for (let band = left; band <= right; band++) {
        if (this.chunks.has(id + ':' + band)) continue;
        if (eager) {
          this.build(id, band, buildTerrain(this.world, id, band));
          continue;
        }
        const [from, to] = bandBounds(band);
        const distance = Math.hypot((id - current) * CHUNK_LENGTH, Math.max(from - lateral, lateral - to, 0));
        if (!closest || distance < closest.distance) closest = { id, band, distance };
      }
    }
    if (closest) {
      const { id, band, distance } = closest;
      if (!this.worker || distance < 146) {
        this.build(id, band, buildTerrain(this.world, id, band));
      } else if (this.inFlight === null) {
        this.inFlight = id + ':' + band;
        this.worker.postMessage({ id, band, seed: this.world.seed });
      }
    }

    this.canopy.update(car, this.chunks, this.terrainRevision);
    this.mountainLight.update(car, eager);
    this.horizon.update(car, low, this.terrainRevision, eager);
    this.treeline.update(car, low, eager);
    if (!this.winter.value) this.meadow.update(car, low, eager);
    else if (eager) this.snow.update(car.x, -car.s);
    const currentBand = terrainBand(lateral);
    for (const { id, band, detail, trees, aspens, rocks, nearStones, scanned, shrubs, treeCount } of this.chunks.values()) {
      const rowDistance = Math.abs(id - current);
      const near = rowDistance <= 1 && band === currentBand;
      for (const mesh of detail) {
        mesh.visible = rowDistance <= (low ? 1 : 2) && Math.abs(lateral) < 680;
        mesh.castShadow = near;
      }
      trees.visible = treeCount > 0 && rowDistance <= (low ? 6 : 8);
      trees.geometry = near && !low ? this.conifer : this.distantConifer;
      trees.castShadow = near;
      aspens.visible = aspens.count > 0 && rowDistance <= (low ? 3 : 6);
      aspens.castShadow = near;
      const useScans = near && !low && scanned.length > 0;
      rocks.visible = !useScans;
      nearStones.visible = useScans;
      for (const batch of scanned) batch.visible = useScans && batch.count > 0;
      trees.count = low ? Math.floor(treeCount * 0.69) : treeCount;
      shrubs.visible = !low && shrubs.count > 0 && near;
    }
  }

  setLook(cozy) {
    this.cozy.value = cozy ? 1 : 0;
    this.setClimate(this.season ?? 'autumn', this.timeOfDay ?? 'day');
  }

  setClimate(season, time) {
    const light = daylight[time], plants = seasons[season];
    if (time !== this.timeOfDay) {
      this.sunDirection.value.fromArray(light.direction).normalize();
      this.sky.sunPosition.value.copy(this.sunDirection.value).multiplyScalar(8000);
      this.skyTint.value.set(light.sky);
      this.airTint.value.set(light.air);
      this.night.value = Number(time === 'night');
      this.mountainLight.invalidate();
      this.scene.environment?.dispose();
      this.scene.environment = skyEnvironment(this.sunDirection.value, this.skyTint.value);
    }
    this.headlight.visible = time === 'night' || time === 'dusk';
    this.timeOfDay = time;
    this.skyLight.color.set(this.cozy.value ? '#e6d7ee' : '#c2d9f6').lerp(this.skyTint.value,0.35);
    this.skyLight.groundColor.set(plants.winter ? '#bfcee0' : '#938970');
    this.skyLight.intensity = (this.cozy.value ? 1.14 : 0.82) * light.ambient;
    this.sun.color.set(light.sun);
    this.lowSun.color.copy(this.sun.color);
    this.sun.intensity = this.lowSun.intensity = light.power * (this.cozy.value ? 0.84 : 1);
    if (this.winter.value && !plants.winter) this.snow.clear();
    this.season = season;
    this.winter.value = plants.winter;
    this.meadowColor.value.set(plants.meadow);
    aspenMaterial.color.set(plants.foliage);
    grassMaterial.color.set(plants.grass);
    bladeMaterial.color.copy(grassMaterial.color);
    coniferMaterial.color.set(plants.winter ? '#c8d5db' : '#ffffff');
    this.meadow.showFlowers = season === 'spring' || season === 'summer';
    for (const {mesh, flowers, blades} of this.meadow.cells.values()) {
      mesh.visible = !plants.winter;
      if (flowers) flowers.visible = this.meadow.showFlowers;
      if (plants.winter) for (const group of blades ?? []) group.visible = false;
    }
  }

  setQuality(low) {
    this.far.value = horizonRange(low) - 320;
    this.low = low;
    this.sun.visible = !low;
    this.lowSun.visible = low;
    this.horizon.material = low ? this.lowTerrainMaterial : this.terrainMaterial;
    for (const { mesh } of this.horizon.pages.values()) mesh.material = this.horizon.material;
    for (const { groundMesh } of this.chunks.values()) {
      groundMesh.material = low ? this.lowTerrainMaterial : this.terrainMaterial;
    }
    for (const water of this.waterStrips.values()) {
      if (water) water.material = water.userData.hasLake && !low ? this.water.material : this.water.lowMaterial;
    }
  }

  animate(time, camera, car) {
    if (this.headlight.visible) {
      const fx = Math.sin(car.heading), fs = Math.cos(car.heading);
      const y = this.surfaceHeight(car.s,car.x) + (car.clearance || 0);
      this.headlight.position.set(car.x+fx*2,y+0.91,-car.s-fs*2);
      const ahead = this.surfaceHeight(car.s+fs*18,car.x+fx*18);
      this.headlight.target.position.set(car.x+fx*24,y+(ahead-y)*1.33-0.12,-car.s-fs*24);
    }
    this.sky.position.copy(camera.position);
    this.water.clock.value = time;
    this.clouds.clock.value = time;
    const s = car.s + Math.cos(car.heading) * 31;
    const x = car.x + Math.sin(car.heading) * 31;
    this.sun.target.position.set(Math.round(x), Math.round(this.surfaceHeight(s, x)), -Math.round(s));
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDirection.value, 125);
    this.lowSun.position.copy(this.sun.position);
  }
}
