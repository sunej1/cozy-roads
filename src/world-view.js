import { cameraPosition, diffuseColor, dot, luminance, mix as mixColor, positionWorld, shadow, smoothstep, texture, vec3 } from 'three/tsl';
import { mountainLight } from './mountain-light.js';
import { canopyShade } from './canopy-shade.js';
import { GrassTracks } from './grass-tracks.js';
import { cloudLayer } from './clouds.js';
import { Horizon } from './horizon.js';
import { Treeline } from './treeline.js';
import { Meadow, MEADOW_DETAIL_LAYER } from './meadow.js';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_LENGTH, mix, noise, randomFor, ROAD_EDGE, smooth } from './route.js';
import { atmosphere, makeSky, makeReliefTexture, makeTerrainMaterial, makeBoulderMaterial, makeWater, skyEnvironment, SUN } from './landscape.js';
import { applyMeadowWind, aspen, aspenMaterial, coniferMaterial, grassMaterial, bladeMaterial, flowerMaterial, understory, understoryMaterial } from './forest.js';
import { bandBounds, buildTerrain, terrainBand, TERRAIN_STEP as STEP, tileSurface } from './terrain.js';

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

  line(-4.06, -3.92, start, end, ivory);
  line(3.92, 4.06, start, end, ivory);
  for (let s = Math.floor(start / 12) * 12; s < end; s += 12) {
    const first = Math.max(start, s);
    const last = Math.min(end, s + 4);
    if (first < last) line(-0.065, 0.065, first, last, amber);
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
    const lookOut = s > -22 && s < 52 && lateral < 0;
    if (lookOut || y < 3 || y > 205 || random() > (0.15 + row.trees * .87) * (0.35 + clearing * 1.10)) continue;
    const scale = (0.65 + random() ** 1.5 * 1.27) * (1 - 0.36 * smooth(63, 151, y)) * (1 + woodland * 0.24);
    dummy.position.set(row.x + lateral, y - 0.26, -s);
    dummy.rotation.set((random() - 0.5) * 0.17, random() * Math.PI * 2, (random() - 0.5) * 0.11);
    const breadth = scale * (0.74 + random() * 0.36);
    dummy.scale.set(breadth, scale, breadth);
    dummy.updateMatrix();
    treeTint.setRGB(0.71 + random() * 0.27, 0.82 + random() * 0.18, 0.76 + random() * 0.29);
    const grove = y < 100 ? noise(lateral * 0.026 + 79, s * 0.025 + 11) : 0;
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
    const y = tileSurface(tile, chunkId, s, world.centerX(s) + lateral, band);
    if (y < -0.2) continue;
    const size = 0.40 + random() ** 2 * 3.6;
    dummy.position.set(world.centerX(s) + lateral, y - 0.04, -s);
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
    if (y < -0.03 || y > 124 || cover < 0.44) continue;
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

function railing(world, start, end) {
  const step = 4;
  const capacity = Math.ceil((end - start) / step) * 2;
  const beams = new THREE.InstancedMesh(railBeam, railMaterial, capacity);
  const posts = new THREE.InstancedMesh(railPost, railMaterial, capacity);
  let count = 0;
  for (let s = start; s < end; s += step) {
    const next = s + step;
    const row = world.section(s + 2);
    for (const side of [-1, 1]) {
      if (world.shoreDistance(row, side * 58) < -9 && world.sampleTerrain(row, side * 21) >= row.grade - 3) continue;
      const offset = side * 7.62;
      const x = world.centerX(s) + offset;
      const x1 = world.centerX(next) + offset;
      const y = world.terrainHeight(s, offset);
      const y1 = world.terrainHeight(next, offset);
      const length = Math.hypot(step, x1 - x, y1 - y);
      dummy.position.set(x, y + 0.53, -s);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      posts.setMatrixAt(count, dummy.matrix);
      dummy.position.set((x + x1) / 2, (y + y1) / 2 + 0.91, -(s + next) / 2);
      dummy.rotation.set(0, Math.atan2(step, x1 - x), 0);
      dummy.rotateZ(Math.asin((y1 - y) / length));
      dummy.scale.set(length + 0.01, 1, 1);
      dummy.updateMatrix();
      beams.setMatrixAt(count++, dummy.matrix);
    }
  }
  posts.count = beams.count = count;
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
    applyMeadowWind(this.tracks);
    this.meadow = new Meadow(scene, world, (s,x) => this.surfaceHeight(s,x), assets.leafLevels, camera.position);
    const reliefMap = makeReliefTexture(assets.elevations);
    this.terrainMaterial = makeTerrainMaterial(reliefMap, assets.turf, assets.bedrock, this.tracks);
    this.lowTerrainMaterial = makeTerrainMaterial(reliefMap, assets.turf, assets.bedrock, this.tracks, true);
    this.canopy = canopyShade();
    for (const material of [this.terrainMaterial, this.lowTerrainMaterial, bladeMaterial, grassMaterial, flowerMaterial, understoryMaterial]) {
      material.aoNode = this.canopy.ambient;
    }
    this.horizon = new Horizon(scene, world, this.terrainMaterial, (id, band) => this.chunks.has(id + ':' + band));
    this.roadMaterial = new THREE.MeshStandardNodeMaterial({
      vertexColors: true, map: assets.pavement, normalMap: assets.normal,
      normalScale: new THREE.Vector2(0.58, 0.58), roughnessMap: assets.rough, roughness: 0.97,
    });
    const pavement = texture(assets.pavement);
    // Preserve the aggregate detail while weathering the brown binder toward grey.
    this.roadMaterial.colorNode = mixColor(vec3(luminance(pavement.rgb)), pavement.rgb, 0.21).mul(1.53);
    const paintGrain = texture(assets.pavement, positionWorld.xz.div(5.8)).r;
    this.markingMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.91 });
    this.markingMaterial.colorNode = vec3(smoothstep(0.017, 0.085, paintGrain).mul(0.45).add(0.51));
    this.rockMaterial = makeBoulderMaterial(assets.bedrock);
    this.rockModels = assets.rocks;
    this.sky = makeSky();
    scene.environment = skyEnvironment();
    scene.environmentIntensity = 0.48;

    const skyLight = new THREE.HemisphereLight('#c2d9f6', '#8a805b', 0.82);
    this.sun = new THREE.DirectionalLight('#ffdfb0', 4.45);
    this.sun.position.copy(SUN).multiplyScalar(125);
    this.sun.castShadow = true;
    this.clouds = cloudLayer(this.sky, SUN, assets.clouds);
    this.mountainLight = mountainLight(world, SUN);
    const sunlight = this.mountainLight.visibility.mul(this.clouds.shadow);
    this.far = atmosphere(scene, this.mountainLight.visibilityAt);
    const backlight = dot(positionWorld.sub(cameraPosition).normalize(), vec3(...SUN.toArray())).max(0).pow(3);
    for (const material of [grassMaterial, bladeMaterial, flowerMaterial, aspenMaterial]) {
      material.emissiveNode = diffuseColor.rgb.mul(backlight.mul(sunlight, 0.53).add(0.19));
    }
    this.water = makeWater(sunlight);
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
    scene.add(this.sky, this.water.anchor, skyLight, this.lowSun, this.sun, this.sun.target);
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
    ground.setAttribute('groundOffsets', new THREE.BufferAttribute(tile.groundOffsets, 2));
    ground.setIndex(new THREE.BufferAttribute(tile.index, 1));
    const groundMesh = new THREE.Mesh(ground, this.low ? this.lowTerrainMaterial : this.terrainMaterial);
    groundMesh.receiveShadow = true;
    chunk.add(groundMesh);

    let water = null;
    if (tile.water) {
      const surface = new THREE.BufferGeometry();
      surface.setAttribute('position', new THREE.BufferAttribute(tile.water.position, 3));
      surface.setAttribute('shore', new THREE.BufferAttribute(tile.water.shore, 1));
      surface.setIndex(new THREE.BufferAttribute(tile.water.index, 1));
      surface.computeVertexNormals();
      water = new THREE.Mesh(surface, this.low ? this.water.lowMaterial : this.water.material);
      chunk.add(water);
    }

    if (band === 0) {
      const cols = [-ROAD_EDGE, -3.5, -2.15, 0, 2.15, 3.5, ROAD_EDGE];
      const road = new THREE.Mesh(strip(world, cols, start, end, STEP, (s, lateral) => {
        const mottling = noise(lateral * 0.95 + 1, s / 4);
        const roadDust = 0.16 * smooth(2.9, ROAD_EDGE, Math.abs(lateral));
        const traffic = 0.12 * (1 - smooth(0.15, 1.1, Math.abs(Math.abs(lateral) - 2.15)));
        mineral.copy(asphalt).multiplyScalar(0.88 + mottling * 0.24 + roadDust - traffic);
        return { y: world.roadHeight(s, lateral) + 0.03, color: mineral };
      }), this.roadMaterial);
      const lines = new THREE.Mesh(markings(world, start, end), this.markingMaterial);
      road.receiveShadow = lines.receiveShadow = true;
      const rails = railing(world, start, end);
      rails.forEach(rail => { rail.castShadow = rail.receiveShadow = true; });
      chunk.add(road, lines, delineators(world, start, end), ...rails);
    }

    const { trees, aspens, rocks, nearStones, scanned, shrubs } = scatter(world, tile, id, band, start, band === 0 ? this.rockModels : [], this.conifer, this.rockMaterial);
    trees.castShadow = aspens.castShadow = rocks.castShadow = true;
    trees.receiveShadow = aspens.receiveShadow = rocks.receiveShadow = shrubs.receiveShadow = true;
    chunk.add(trees, aspens, rocks, nearStones, ...scanned, shrubs);
    this.chunks.set(id + ':' + band, { id, band, tile, chunk, groundMesh, water, trees, aspens, rocks, nearStones, scanned, shrubs, treeCount: trees.count });
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

  update(car, low, eager = false) {
    const current = Math.floor(car.s / CHUNK_LENGTH);
    const lateral = car.x - this.world.centerX(car.s);
    const along = Math.cos(car.heading);
    const across = Math.sin(car.heading);
    const reach = low ? 9 : 12;
    const backwards = Math.ceil(mix(3, reach, smooth(-0.55, 0.36, -along)));
    const forwards = Math.ceil(mix(3, reach, smooth(-0.55, 0.36, along)));
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
    this.meadow.update(car, low, eager);
    const currentBand = terrainBand(lateral);
    for (const { id, band, trees, aspens, rocks, nearStones, scanned, shrubs, treeCount } of this.chunks.values()) {
      const rowDistance = Math.abs(id - current);
      const near = rowDistance <= 1 && band === currentBand;
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

  setQuality(low) {
    this.far.value = low ? 4880 : 7600;
    this.low = low;
    this.sun.visible = !low;
    this.lowSun.visible = low;
    this.horizon.material = low ? this.lowTerrainMaterial : this.terrainMaterial;
    for (const { mesh } of this.horizon.pages.values()) mesh.material = this.horizon.material;
    for (const { groundMesh, water } of this.chunks.values()) {
      groundMesh.material = low ? this.lowTerrainMaterial : this.terrainMaterial;
      if (water) water.material = low ? this.water.lowMaterial : this.water.material;
    }
  }

  animate(time, camera, car) {
    this.sky.position.copy(camera.position);
    this.water.clock.value = time;
    this.clouds.clock.value = time;
    const s = car.s + Math.cos(car.heading) * 31;
    const x = car.x + Math.sin(car.heading) * 31;
    this.sun.target.position.set(Math.round(x), Math.round(this.surfaceHeight(s, x)), -Math.round(s));
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN, 125);
    this.lowSun.position.copy(this.sun.position);
  }
}
