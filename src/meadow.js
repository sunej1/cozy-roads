import * as THREE from 'three/webgpu';
import { grassMaterial, grassTuft, meadowFlowers, flowerMaterial, bladeMaterial, bladeRange, meadowCenter, meadowRange } from './forest.js';
import { noise, randomFor, ROAD_EDGE, smooth } from './route.js';

const CELL = 16;
export const MEADOW_DETAIL_LAYER = 1;
const patch = grassTuft();
const rosette = meadowFlowers();
const tuft = new THREE.Object3D();
const tint = new THREE.Color();
const spring = new THREE.Color('#ddedc7');
const dry = new THREE.Color('#ffe1aa');

// A cell owns its samples in world space, so turning around reproduces each blade.
export class Meadow {
  constructor(scene, world, height, leafLevels = [], cameraPosition) {
    this.scene = scene;
    this.world = world;
    this.height = height;
    this.leafLevels = leafLevels;
    this.cameraPosition = cameraPosition;
    this.cells = new Map();
  }

  plant(cx, cs, low) {
    const grid = low ? 10 : 17;
    const mesh = new THREE.InstancedMesh(patch, grassMaterial, grid * grid);
    const random = randomFor(this.world.seed ^ Math.imul(cx, 73856093) ^ Math.imul(cs, 19349663));
    let count = 0;
    const blooms = [];
    for (let i = 0; i < grid * grid; i++) {
      // Shuffle each cell’s stratified samples deterministically.
      const slot = (i * 47) % (grid * grid);
      const x = (cx + ((slot % grid) + random()) / grid) * CELL;
      const s = (cs + (Math.floor(slot / grid) + random()) / grid) * CELL;
      const verge = Math.abs(x - this.world.centerX(s)) - ROAD_EDGE;
      if (verge < 0.48) continue;
      const y = this.height(s, x);
      if (y < 0.2 || y > 220) continue;
      if (y < 5) {
        const row = this.world.section(s);
        if (this.world.shoreDistance(row, x - row.x) > -3 - 2 * noise(x / 8, s / 8)) continue;
      }
      const dx = this.height(s, x + 0.8) - y,
        ds = this.height(s + 0.8, x) - y;
      const grade = Math.hypot(dx, ds) / 0.8;
      const cover = noise(x / 17, s / 21);
      if (grade > 1.18 || random() < 0.035 + 0.63 * smooth(145, 220, y) + 0.16 * (1 - cover)) continue;
      tuft.position.set(x, y - 0.018, -s);
      tuft.rotation.set(Math.atan2(ds, 0.8), random() * Math.PI * 2, Math.atan2(dx, 0.8), 'ZXY');
      const pasture = smooth(0.30, 0.73, noise(x / 36 + 51, s / 42 - 23));
      const size = 0.80 + random() * 0.44;
      const cut = 0.32 + 0.68 * smooth(0.6, 3.8, verge);
      const spread = Math.min(size * (low ? 2.22 : 1.78), verge * 1.13);
      tuft.scale.set(spread, (0.55 + 0.48 * cover + 0.48 * pasture) * size * cut, spread);
      tuft.updateMatrix();
      mesh.setMatrixAt(count, tuft.matrix);
      if (verge > 1.7 && y < 175 && i % 5 === 1 && pasture > 0.68 && cover > 0.49) blooms.push(count);
      mesh.setColorAt(
        count++,
        tint
          .copy(spring)
          .lerp(dry, 0.08 + 0.46 * cover + 0.34 * pasture)
          .multiplyScalar(0.83 + random() * 0.3),
      );
    }
    mesh.count = count;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    let flowers;
    if (blooms.length) {
      flowers = new THREE.InstancedMesh(rosette, flowerMaterial, blooms.length);
      for (const [i, index] of blooms.entries()) {
        mesh.getMatrixAt(index, tuft.matrix);
        flowers.setMatrixAt(i, tuft.matrix);
      }
      flowers.computeBoundingSphere();
      flowers.receiveShadow = true;
      this.scene.add(flowers);
    }
    return { mesh, flowers, cx, cs, low };
  }

  update(car, low, eager = false) {
    const cx = Math.floor(car.x / CELL),
      cs = Math.floor(car.s / CELL);
    const radius = low ? 4 : 5;
    bladeRange.value.set(low ? 7 : 14, low ? 16 : 29);
    meadowCenter.value.set(car.x, -car.s);
    meadowRange.value.set(low ? 14 : 24, low ? 35 : 55);
    if (this.cx !== cx || this.cs !== cs || this.low !== low) {
      this.cx = cx;
      this.cs = cs;
      this.low = low;
      this.pending = [];
      for (const [key, cell] of this.cells) {
        if (Math.hypot(cell.cx - cx, cell.cs - cs) <= radius + 0.6) continue;
        this.remove(cell);
        this.cells.delete(key);
      }
      for (let x = cx - radius; x <= cx + radius; x++) {
        for (let s = cs - radius; s <= cs + radius; s++) {
          const key = x + ',' + s;
          const distance = Math.hypot(x - cx, s - cs);
          if (distance <= radius + 0.6 && this.cells.get(key)?.low !== low) this.pending.push({ key, x, s, distance });
        }
      }
      this.pending.sort((a, b) => b.distance - a.distance);
    }
    // During a drive the new cells are still beyond the fade when they enter the queue.
    const budget = eager ? this.pending.length : 2;
    for (let i = 0; i < budget && this.pending.length; i++) {
      const { key, x, s } = this.pending.pop();
      const previous = this.cells.get(key);
      this.cells.set(key, this.plant(x, s, low));
      if (previous) this.remove(previous);
    }
    const reach = meadowRange.value.y;
    const leafDistance2 = (bladeRange.value.y + 4) ** 2;
    const near2 = (low ? 6 : 11) ** 2, middle2 = (low ? 13 : 20) ** 2;
    for (const cell of this.cells.values()) {
      const { mesh, cx: x, cs: s } = cell;
      const dx = Math.max(x * CELL - car.x, car.x - (x + 1) * CELL, 0);
      const ds = Math.max(s * CELL - car.s, car.s - (s + 1) * CELL, 0);
      const d2 = dx * dx + ds * ds;
      mesh.visible = d2 < reach * reach;
      if (cell.flowers) cell.flowers.visible = mesh.visible;
      if (!cell.blades && this.leafLevels.length && d2 < (bladeRange.value.y + 8) ** 2) {
        cell.blades = this.leafGroups(cell);
      }
      for (const group of cell.blades ?? []) {
        const center = group.boundingSphere.center;
        const distance2 = (car.x - center.x) ** 2 + (car.s + center.z) ** 2;
        group.visible = distance2 < leafDistance2;
        if (group.visible) {
          const eye2 = (this.cameraPosition.x - center.x) ** 2 + (this.cameraPosition.z - center.z) ** 2;
          group.geometry = this.leafLevels[eye2 < near2 ? 0 : eye2 < middle2 ? 1 : 2];
        }
      }
    }
  }

  remove(cell) {
    this.scene.remove(cell.mesh);
    cell.mesh.dispose();
    if (cell.flowers) {
      this.scene.remove(cell.flowers);
      cell.flowers.dispose();
    }
    for (const group of cell.blades ?? []) {
      this.scene.remove(group);
      group.dispose();
    }
  }

  leafGroups({ mesh, cx, cs }) {
    // Cull the detailed leaves in four-metre blocks along the view frustum.
    const buckets = Array.from({ length: 16 }, () => []);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, tuft.matrix);
      const x = Math.min(3, Math.max(0, Math.floor((tuft.matrix.elements[12] - cx * CELL) / 4)));
      const s = Math.min(3, Math.max(0, Math.floor((-tuft.matrix.elements[14] - cs * CELL) / 4)));
      buckets[s * 4 + x].push(i);
    }
    return buckets.filter(indices => indices.length).map(indices => {
      const group = new THREE.InstancedMesh(this.leafLevels[0], bladeMaterial, indices.length);
      for (const [i, source] of indices.entries()) {
        mesh.getMatrixAt(source, tuft.matrix);
        mesh.getColorAt(source, tint);
        group.setMatrixAt(i, tuft.matrix);
        group.setColorAt(i, tint);
      }
      group.layers.set(MEADOW_DETAIL_LAYER);
      group.computeBoundingSphere();
      group.receiveShadow = true;
      this.scene.add(group);
      return group;
    });
  }
}
