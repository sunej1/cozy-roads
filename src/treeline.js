import * as THREE from 'three/webgpu';
import { coniferMaterial } from './forest.js';
import { noise, randomFor, smooth } from './route.js';

const SIZE = 384;
const dummy = new THREE.Object3D();
const tint = new THREE.Color();

export class Treeline {
  constructor(scene, world, surface, silhouette) {
    this.scene = scene;
    this.world = world;
    this.surface = surface;
    this.silhouette = silhouette;
    this.cells = new Map();
  }

  plant(cx, cs, close) {
    const grid = 25,
      world = this.world;
    const rng = randomFor(world.seed ^ Math.imul(cx, 776531) ^ Math.imul(cs, 379387));
    const mesh = new THREE.InstancedMesh(this.silhouette, coniferMaterial, grid * grid);
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
        if (y < 5 || y > limit || grove < 0.24 || (y < (row.water?.level ?? 0) + 2 && world.shoreDistance(row, lateral) > -2)) continue;
        const grade =
          Math.hypot(
            world.sampleTerrain(row, lateral + 5) - y,
            world.terrainHeight(s + 5, x - world.centerX(s + 5)) - y,
          ) / 5;
        const cover = smooth(0.24, 0.67, grove) * (1 - smooth(0.65, 1.24, grade)) * (1 - smooth(limit - 120, limit, y));
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
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    return mesh;
  }

  update(car, low, eager = false) {
    const cx = Math.floor(car.x / SIZE),
      cs = Math.floor(car.s / SIZE);
    const radius = low ? 4 : 8;
    if (this.cx !== cx || this.cs !== cs || this.radius !== radius) {
      this.cx = cx;
      this.cs = cs;
      this.radius = radius;
      this.pending = [];
      const keep = new Set();
      for (let z = -radius; z <= radius; z++) {
        for (let x = -radius; x <= radius; x++) {
          const distance = x * x + z * z;
          if (distance > (radius + 0.5) ** 2) continue;
          const i = cx + x,
            j = cs + z,
            key = i + ':' + j;
          const close = !low && Math.max(Math.abs(x), Math.abs(z)) <= 1;
          keep.add(key);
          if (this.cells.get(key)?.close !== close) this.pending.push({ i, j, key, close, distance });
        }
      }
      for (const [key, { mesh }] of this.cells) {
        if (keep.has(key)) continue;
        this.scene.remove(mesh);
        mesh.dispose();
        this.cells.delete(key);
      }
      this.pending.sort((a, b) => b.distance - a.distance);
    }
    const budget = eager ? this.pending.length : 1;
    for (let i = 0; i < budget && this.pending.length; i++) {
      const { key, i: x, j: s, close } = this.pending.pop();
      const mesh = this.plant(x, s, close);
      const previous = this.cells.get(key);
      if (previous) {
        this.scene.remove(previous.mesh);
        previous.mesh.dispose();
      }
      this.cells.set(key, { close, mesh });
    }
  }
}
