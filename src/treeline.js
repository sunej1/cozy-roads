import * as THREE from 'three/webgpu';
import { conifer, coniferMaterial } from './forest.js';
import { noise, randomFor, smooth } from './route.js';

const SIZE = 384;
const dummy = new THREE.Object3D();
const tint = new THREE.Color();

function crownCards() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const random = randomFor(19831);
  ctx.fillStyle = '#5b5246';
  ctx.fillRect(46, 16, 4, 173);
  for (let tier = 0; tier < 39; tier++) {
    const f = tier / 39,
      y = 16 + f * 144;
    for (const sign of [-1, 1]) {
      const width = (3 + 41 * f ** 0.78) * (0.65 + 0.34 * random());
      const shade = Math.round(52 + 28 * random() + (1 - f) * 24);
      ctx.fillStyle = 'rgb(' + (shade - 9) + ',' + (shade + 6) + ',' + (shade - 7) + ')';
      ctx.beginPath();
      ctx.moveTo(48, y - 12);
      for (let twig = 1; twig <= 9; twig++) {
        const t = twig / 9;
        ctx.lineTo(48 + sign * (t * width - 2), y - 9 + t * 14);
        ctx.lineTo(48 + sign * t * width, y + 1 + t * 15 + random() * 5);
      }
      ctx.lineTo(48, y + 4);
      ctx.fill();
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.24, side: THREE.DoubleSide });
  const positions = [],
    uv = [],
    indices = [];
  for (const a of [0, Math.PI / 2]) {
    const x = 2.45 * Math.cos(a),
      z = 2.45 * Math.sin(a),
      i = positions.length / 3;
    positions.push(-x, 0, -z, x, 0, z, x, 8.2, z, -x, 8.2, -z);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(Array.from({ length: 8 }, () => [0, 1, 0]).flat(), 3),
  );
  geometry.setIndex(indices);
  return { geometry, material };
}

export class Treeline {
  constructor(scene, world, surface) {
    this.scene = scene;
    this.world = world;
    this.surface = surface;
    this.cards = crownCards();
    this.cells = new Map();
  }

  plant(cx, cs, close) {
    const grid = 25,
      world = this.world;
    const rng = randomFor(world.seed ^ Math.imul(cx, 776531) ^ Math.imul(cs, 379387));
    const mesh = new THREE.InstancedMesh(this.cards.geometry, this.cards.material, grid * grid);
    let count = 0;
    for (let j = 0; j < grid; j++)
      for (let i = 0; i < grid; i++) {
        const x = (cx + (i + rng()) / grid) * SIZE,
          s = (cs + (j + rng()) / grid) * SIZE;
        const row = world.section(s),
          lateral = x - row.x;
        if (Math.abs(lateral) < 160) continue;
        const y = world.sampleTerrain(row, lateral);
        const grove = noise(x / 125 + (world.seed % 997), s / 152);
        const limit = 380 + grove * 170 + 65 * noise(x / 44, s / 58);
        if (y < 5 || y > limit || grove < 0.24) continue;
        const grade =
          Math.hypot(
            world.sampleTerrain(row, lateral + 5) - y,
            world.terrainHeight(s + 5, x - world.centerX(s + 5)) - y,
          ) / 5;
        const cover =
          smooth(0.24, 0.67, grove) * (1 - smooth(0.65, 1.24, grade)) * (1 - smooth(limit - 120, limit, y));
        if (rng() > cover * 0.91) continue;
        const scale = (0.73 + 1.18 * rng()) * (1 - 0.4 * smooth(260, 540, y));
        dummy.position.set(x, (close ? this.surface(s, x) : y) - 0.45, -s);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.scale.set(scale * (0.84 + rng() * 0.2), scale, scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(count, dummy.matrix);
        mesh.setColorAt(count++, tint.setRGB(0.62 + grove * 0.3, 0.76 + grove * 0.22, 0.67 + grove * 0.28));
      }
    mesh.count = count;
    mesh.receiveShadow = true;
    if (close) {
      mesh.geometry = conifer;
      mesh.material = coniferMaterial;
    }
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    return mesh;
  }

  update(car, low) {
    const cx = Math.floor(car.x / SIZE),
      cs = Math.floor(car.s / SIZE);
    const radius = low ? 4 : 8;
    if (this.cx === cx && this.cs === cs && this.radius === radius) return;
    this.cx = cx;
    this.cs = cs;
    this.radius = radius;
    const keep = new Set();
    for (let z = -radius; z <= radius; z++)
      for (let x = -radius; x <= radius; x++) {
        if (x * x + z * z > (radius + 0.5) ** 2) continue;
        const i = cx + x,
          j = cs + z,
          key = i + ':' + j,
          close = !low && Math.max(Math.abs(x), Math.abs(z)) <= 1;
        keep.add(key);
        const previous = this.cells.get(key);
        if (previous && previous.close === close) continue;
        if (previous) {
          this.scene.remove(previous.mesh);
          previous.mesh.dispose();
        }
        this.cells.set(key, { close, mesh: this.plant(i, j, close) });
      }
    for (const [key, { mesh }] of this.cells)
      if (!keep.has(key)) {
        this.scene.remove(mesh);
        mesh.dispose();
        this.cells.delete(key);
      }
  }
}
