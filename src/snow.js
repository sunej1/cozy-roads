import * as THREE from 'three/webgpu';
import { attribute, color, mix as blend, positionGeometry, smoothstep, uniform, vec3 } from 'three/tsl';
import { clamp, mix, noise, ROAD_EDGE, smooth } from './route.js';

const STEP = 0.2,
  CELLS = 40,
  TILE = STEP * CELLS;
const key = (x, z) => x + ',' + z;

// Signed millimetres in world space. Only driven tiles need a history.
export class Snowpack {
  constructor() {
    this.tiles = new Map();
    this.dirty = new Set();
  }

  change(i, j, amount) {
    const x = Math.floor(i / CELLS),
      z = Math.floor(j / CELLS);
    const id = key(x, z);
    let tile = this.tiles.get(id);
    if (!tile) {
      if (this.tiles.size >= 512) this.tiles.delete(this.tiles.keys().next().value);
      tile = new Int16Array(CELLS * CELLS);
      this.tiles.set(id, tile);
    }
    const col = i - x * CELLS,
      row = j - z * CELLS;
    const index = row * CELLS + col;
    tile[index] = clamp(tile[index] + amount, -270, 150);
    this.dirty.add(id);
    if (!col) this.dirty.add(key(x - 1, z));
    if (!row) this.dirty.add(key(x, z - 1));
    if (!row && !col) this.dirty.add(key(x - 1, z - 1));
  }

  at(i, j) {
    const x = Math.floor(i / CELLS),
      z = Math.floor(j / CELLS);
    return this.tiles.get(key(x, z))?.[(j - z * CELLS) * CELLS + i - x * CELLS] ?? 0;
  }

  offset(x, z) {
    const u = x / STEP,
      v = z / STEP,
      i = Math.floor(u),
      j = Math.floor(v);
    return (
      0.001 *
      mix(mix(this.at(i, j), this.at(i + 1, j), u - i), mix(this.at(i, j + 1), this.at(i + 1, j + 1), u - i), v - j)
    );
  }

  stamp(x, z, tx, tz, depth) {
    if (depth < 0.025) return;
    const i = Math.round(x / STEP),
      j = Math.round(z / STEP);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const rx = (i + dx) * STEP - x,
          rz = (j + dz) * STEP - z;
        const radius = ((rx * tx + rz * tz) / 0.31) ** 2 + ((rz * tx - rx * tz) / 0.205) ** 2;
        if (radius >= 1) continue;
        const col = i + dx,
          row = j + dz,
          old = this.at(col, row);
        const target = -Math.round(1000 * depth * 0.73 * (1 - radius));
        const removed = Math.max(0, Math.round((old - target) * 0.64));
        if (!removed) continue;
        this.change(col, row, -removed);
        // Most powder compacts. Roll the loose remainder out of the contact patch.
        const rim = Math.round(removed * 0.22);
        if (rim)
          for (const side of [-1, 1]) {
            this.change(col + Math.round(-tz * 1.8 * side), row + Math.round(tx * 1.8 * side), rim);
          }
      }
  }
}

export class SnowSurface {
  constructor(scene, world, height) {
    this.scene = scene;
    this.world = world;
    this.height = height;
    this.pack = new Snowpack();
    this.meshes = new Map();
    this.wheels = [];
    this.center = uniform(new THREE.Vector2());
    this.material = new THREE.MeshStandardNodeMaterial({ roughness: 0.87, transparent: true });
    const cover = attribute('snowCover', 'vec3');
    const edge = smoothstep(11, 15.5, positionGeometry.xz.sub(this.center).length());
    const distance = positionGeometry.xz.sub(this.center).length();
    const imprint = cover.z.abs().mul(3.8).clamp(0, 1);
    this.material.opacityNode = blend(edge.oneMinus().mul(0.22), 1, imprint).mul(
      smoothstep(46, 64, distance).oneMinus(),
    );
    this.material.positionNode = positionGeometry.sub(vec3(0, edge.mul(0.65, imprint.oneMinus()), 0));
    const fresh = blend(color('#b7c9d6'), color('#e2e9ed'), cover.y);
    this.material.colorNode = blend(fresh, color('#5b7286'), cover.z.max(0).mul(0.94)).mul(cover.x.mul(0.2).add(0.8));
  }

  depth(x, z, base, row) {
    const lateral = x - row.x;
    const bank = row.water?.level ?? 0;
    if (base < bank + 0.04 && this.world.shoreDistance(row, lateral) > -1) return 0;
    const verge = Math.abs(lateral) - ROAD_EDGE;
    const field = noise(x / 6.7, z / 8.2);
    const slope = Math.hypot(this.height(-z, x + 0.5) - base, this.height(-z + 0.5, x) - base) * 2;
    return mix(0.121 + field * 0.026, 0.18 + field * 0.15, smooth(0, 2.6, verge)) * (1 - smooth(0.56, 1.35, slope));
  }

  ground(s, x, base) {
    const depth = this.depth(x, -s, base, this.world.section(s));
    return base + (depth > 0 ? Math.max(0, depth + this.pack.offset(x, -s)) : 0);
  }

  tile(cx, cz) {
    const count = (CELLS + 1) ** 2,
      pos = new Float32Array(count * 3),
      shades = new Float32Array(count * 3);
    const base = new Float32Array(count),
      depth = new Float32Array(count),
      indices = [];
    for (let j = 0; j <= CELLS; j++) {
      const z = (cz * CELLS + j) * STEP,
        row = this.world.section(-z);
      for (let i = 0; i <= CELLS; i++) {
        const n = j * (CELLS + 1) + i,
          x = (cx * CELLS + i) * STEP;
        pos[3 * n] = x;
        pos[3 * n + 2] = z;
        base[n] = this.height(-z, x);
        depth[n] = this.depth(x, z, base[n], row);
        shades[3 * n] = smooth(0.09, 0.23, depth[n]);
        shades[3 * n + 1] = noise(x / 3, z / 4);
        if (i < CELLS && j < CELLS) {
          const b = n + CELLS + 1;
          indices.push(n, b, n + 1, b, b + 1, n + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('snowCover', new THREE.BufferAttribute(shades, 3));
    g.setIndex(indices);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return { mesh, cx, cz, base, depth };
  }

  refresh(tile) {
    const { mesh, base, depth, cx, cz } = tile,
      g = mesh.geometry;
    const pos = g.attributes.position,
      shade = g.attributes.snowCover;
    for (let j = 0; j <= CELLS; j++)
      for (let i = 0; i <= CELLS; i++) {
        const n = j * (CELLS + 1) + i,
          delta = this.pack.at(cx * CELLS + i, cz * CELLS + j) * 0.001;
        pos.setY(n, base[n] + (depth[n] > 0.015 ? Math.max(0, depth[n] + delta) : -0.07));
        shade.setZ(n, clamp(-delta / Math.max(0.05, depth[n]), -1, 1));
      }
    pos.needsUpdate = true;
    shade.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }

  contact(root, tires, grounded) {
    if (!grounded) {
      this.wheels.length = 0;
      return;
    }
    root.updateWorldMatrix(true, false);
    for (const [i, tire] of tires.entries()) {
      const point = tire.pivot.position.clone().applyMatrix4(root.matrixWorld);
      const last = this.wheels[i];
      this.wheels[i] = point;
      if (!last) continue;
      const dx = point.x - last.x,
        dz = point.z - last.z,
        length = Math.hypot(dx, dz);
      if (length < 0.055) {
        this.wheels[i] = last;
        continue;
      }
      if (length > 7) continue;
      const count = Math.ceil(length / 0.13);
      for (let j = 1; j <= count; j++) {
        const x = last.x + (dx * j) / count,
          z = last.z + (dz * j) / count;
        this.pack.stamp(x, z, dx / length, dz / length, this.depth(x, z, this.height(-z, x), this.world.section(-z)));
      }
    }
  }

  update(x, z) {
    this.center.value.set(x, z);
    const cx = Math.floor(x / TILE),
      cz = Math.floor(z / TILE);
    for (const [id, t] of this.meshes)
      if (Math.max(Math.abs(t.cx - cx), Math.abs(t.cz - cz)) > (this.pack.tiles.has(id) ? 8 : 2)) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        this.meshes.delete(id);
      }
    for (let j = cz - 2; j <= cz + 2; j++)
      for (let i = cx - 2; i <= cx + 2; i++) {
        const id = key(i, j);
        let t = this.meshes.get(id);
        if (!t) {
          t = this.tile(i, j);
          this.meshes.set(id, t);
          this.refresh(t);
        } else if (this.pack.dirty.has(id)) this.refresh(t);
      }
    this.pack.dirty.clear();
  }

  clear() {
    for (const { mesh } of this.meshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
    this.wheels.length = 0;
    this.pack = new Snowpack();
  }
}
