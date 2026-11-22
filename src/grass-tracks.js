import * as THREE from 'three/webgpu';
import { float, Fn, If, texture, uniform } from 'three/tsl';

const SIZE = 160,
  SPACING = 0.2,
  SPAN = SIZE * SPACING;
const MAX_AGE = 10;

// Only the ground around the car needs a footprint history. Shift in whole texels
// so parked tire marks stay attached to the same leaves as the car moves.
export class GrassTracks {
  constructor() {
    this.data = new Uint8Array(SIZE * SIZE);
    this.map = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RedFormat);
    this.map.minFilter = this.map.magFilter = THREE.LinearFilter;
    this.map.needsUpdate = true;
    this.origin = uniform(new THREE.Vector2());
    this.active = uniform(0);
    this.wheels = [];
    this.contact = new THREE.Vector3();
    this.lastStamp = -Infinity;
    this.lastFade = 0;
    this.pressure = Fn(([point]) => {
      const uv = point.sub(this.origin).div(SPAN);
      const result = float(0).toVar();
      If(this.active.greaterThan(0).and(uv.greaterThan(0).all()).and(uv.lessThan(1).all()), () => {
        result.assign(texture(this.map, uv).level(0).r);
      });
      return result;
    });
  }

  clear() {
    this.data.fill(0);
    this.wheels.length = 0;
    this.active.value = 0;
    this.map.needsUpdate = true;
    this.lastStamp = -Infinity;
  }

  update(time, root, tires, onGrass) {
    if (time - this.lastStamp > MAX_AGE && this.active.value) this.clear();
    if (!onGrass && !this.active.value) return;
    const origin = this.origin.value;
    const x = root.position.x,
      z = root.position.z;
    if (!this.active.value || Math.abs(x - origin.x - SPAN / 2) > 5 || Math.abs(z - origin.y - SPAN / 2) > 5) {
      const nextX = Math.floor((x - SPAN / 2) / SPACING) * SPACING;
      const nextZ = Math.floor((z - SPAN / 2) / SPACING) * SPACING;
      const dx = Math.round((nextX - origin.x) / SPACING),
        dz = Math.round((nextZ - origin.y) / SPACING);
      const next = new Uint8Array(this.data.length);
      if (Math.abs(dx) < SIZE && Math.abs(dz) < SIZE) {
        const left = Math.max(0, dx),
          right = Math.min(SIZE, SIZE + dx);
        for (let j = Math.max(0, dz); j < Math.min(SIZE, SIZE + dz); j++) {
          next.set(this.data.subarray(j * SIZE + left, j * SIZE + right), (j - dz) * SIZE + left - dx);
        }
      } else this.wheels.length = 0;
      this.data.set(next);
      origin.set(nextX, nextZ);
      this.map.needsUpdate = true;
    }
    const elapsed = time - this.lastFade;
    if (elapsed >= 0.16) {
      const drop = Math.round((255 * elapsed) / MAX_AGE);
      for (let i = 0; i < this.data.length; i++) this.data[i] = Math.max(0, this.data[i] - drop);
      this.lastFade = time;
      this.map.needsUpdate = true;
    }
    if (!onGrass) {
      this.wheels.length = 0;
      return;
    }
    root.updateWorldMatrix(true, false);
    for (let i = 0; i < tires.length; i++) {
      const point = this.contact.copy(tires[i].pivot.position).applyMatrix4(root.matrixWorld);
      const previous = this.wheels[i] ?? point;
      const distance = Math.hypot(point.x - previous.x, point.z - previous.z);
      const steps = distance < 8 ? Math.max(1, Math.ceil(distance / SPACING)) : 1;
      for (let j = 1; j <= steps; j++) {
        this.stamp(
          THREE.MathUtils.lerp(previous.x, point.x, j / steps),
          THREE.MathUtils.lerp(previous.z, point.z, j / steps),
        );
      }
      (this.wheels[i] ??= new THREE.Vector3()).copy(point);
    }
    this.lastStamp = time;
    this.active.value = 1;
    this.map.needsUpdate = true;
  }

  stamp(x, z) {
    const cx = (x - this.origin.value.x) / SPACING - 0.5,
      cz = (z - this.origin.value.y) / SPACING - 0.5;
    for (let j = Math.max(0, Math.ceil(cz - 1.6)); j <= Math.min(SIZE - 1, cz + 1.6); j++) {
      for (let i = Math.max(0, Math.ceil(cx - 1.6)); i <= Math.min(SIZE - 1, cx + 1.6); i++) {
        const pressure = Math.max(0, 1 - ((i - cx) ** 2 + (j - cz) ** 2) / 2.56);
        const index = j * SIZE + i;
        this.data[index] = Math.max(this.data[index], Math.round(255 * Math.min(1, pressure * 1.5)));
      }
    }
  }
}
