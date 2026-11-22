import * as THREE from 'three/webgpu';
import { grassMaterial, grassTuft, meadowCenter, meadowRange } from './forest.js';
import { noise, randomFor, ROAD_EDGE, smooth } from './route.js';

const CELL = 16;
const patch = grassTuft();
const tuft = new THREE.Object3D();
const tint = new THREE.Color();
const spring = new THREE.Color('#718840');
const dry = new THREE.Color('#a39a55');

// A cell owns its samples in world space, so turning around reproduces each blade.
export class Meadow {
  constructor(scene, world, height) {
    this.scene = scene;
    this.world = world;
    this.height = height;
    this.cells = new Map();
  }

  plant(cx, cs, low) {
    const grid = low ? 8 : 13;
    const mesh = new THREE.InstancedMesh(patch, grassMaterial, grid * grid);
    const random = randomFor(this.world.seed ^ Math.imul(cx, 73856093) ^ Math.imul(cs, 19349663));
    let count = 0;
    for (let i = 0; i < grid * grid; i++) {
      // Keep each seed’s original tuft positions.
      const slot = (i * 47) % (grid * grid);
      const x = (cx + ((slot % grid) + random()) / grid) * CELL;
      const s = (cs + (Math.floor(slot / grid) + random()) / grid) * CELL;
      if (Math.abs(x - this.world.centerX(s)) < ROAD_EDGE + 0.72) continue;
      const y = this.height(s, x);
      if (y < 0.2 || y > 220) continue;
      const dx = this.height(s, x + 0.8) - y,
        ds = this.height(s + 0.8, x) - y;
      const grade = Math.hypot(dx, ds) / 0.8;
      const cover = noise(x / 17, s / 21);
      if (grade > 1.18 || random() < 0.09 + 0.63 * smooth(145, 220, y) + 0.16 * (1 - cover)) continue;
      tuft.position.set(x, y - 0.042, -s);
      tuft.rotation.set(Math.atan2(ds, 0.8), random() * Math.PI * 2, Math.atan2(dx, 0.8), 'ZXY');
      const size = 0.64 + random() * 0.49;
      tuft.scale.set(size * (low ? 1.54 : 1.19), (0.65 + 0.62 * cover) * size, size * (low ? 1.54 : 1.19));
      tuft.updateMatrix();
      mesh.setMatrixAt(count, tuft.matrix);
      mesh.setColorAt(
        count++,
        tint
          .copy(spring)
          .lerp(dry, 0.1 + 0.74 * cover)
          .multiplyScalar(0.83 + random() * 0.3),
      );
    }
    mesh.count = count;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return { mesh, cx, cs, low };
  }

  update(car, low, eager = false) {
    const cx = Math.floor(car.x / CELL),
      cs = Math.floor(car.s / CELL);
    const radius = low ? 4 : 5;
    meadowCenter.value.set(car.x, -car.s);
    meadowRange.value.set(low ? 14 : 24, low ? 35 : 55);
    if (this.cx !== cx || this.cs !== cs || this.low !== low) {
      this.cx = cx;
      this.cs = cs;
      this.low = low;
      this.pending = [];
      for (const [key, cell] of this.cells) {
        if (cell.low === low && Math.hypot(cell.cx - cx, cell.cs - cs) <= radius + 0.6) continue;
        this.scene.remove(cell.mesh);
        cell.mesh.dispose();
        this.cells.delete(key);
      }
      for (let x = cx - radius; x <= cx + radius; x++) {
        for (let s = cs - radius; s <= cs + radius; s++) {
          const key = x + ',' + s;
          const distance = Math.hypot(x - cx, s - cs);
          if (distance <= radius + 0.6 && !this.cells.has(key)) this.pending.push({ key, x, s, distance });
        }
      }
      this.pending.sort((a, b) => b.distance - a.distance);
    }
    // During a drive the new cells are still beyond the fade when they enter the queue.
    const budget = eager ? this.pending.length : 2;
    for (let i = 0; i < budget && this.pending.length; i++) {
      const { key, x, s } = this.pending.pop();
      this.cells.set(key, this.plant(x, s, low));
    }
    const reach = meadowRange.value.y;
    for (const { mesh, cx: x, cs: s } of this.cells.values()) {
      const dx = Math.max(x * CELL - car.x, car.x - (x + 1) * CELL, 0);
      const ds = Math.max(s * CELL - car.s, car.s - (s + 1) * CELL, 0);
      mesh.visible = dx * dx + ds * ds < reach * reach;
    }
  }
}
