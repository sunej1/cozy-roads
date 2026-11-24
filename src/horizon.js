import * as THREE from 'three/webgpu';
import { bandBounds, bandColumns, TERRAIN_STEP } from './terrain.js';
import { CHUNK_LENGTH } from './route.js';

const LENGTH = 1024;
const STRIPS = LENGTH / CHUNK_LENGTH;
const EDGES = [1, 2, 4];
export function horizonRange(low) {
  return low ? 7600 : 13600;
}

function footprint(column) {
  if (Math.abs(column) <= 1) return { band: 0, left: column * 640 - 320, width: 640 };
  const band = column - Math.sign(column);
  const [left, right] = bandBounds(band);
  return { band, left, width: right - left };
}

// Eight separately selectable clusters share one vertex buffer and one draw.
// Their outlines retain the driveable mesh's exact samples at every detail level.
export function mountainPage(world, column, page, divisions, rows = new Map()) {
  const { left, width, band } = footprint(column);
  const start = page * LENGTH;
  const side = divisions + 1;
  const skyline = divisions === 16;
  const steps = skyline ? [1] : EDGES;
  const positions = [],
    normals = [],
    relief = [],
    groundOffsets = [],
    lookup = new Map();
  const edge = bandColumns(band)
    .filter((x) => x >= left && x <= left + width)
    .map((x) => x - left);
  const rowAt = (s) => {
    let row = rows.get(s);
    if (!row) {
      row = world.section(s);
      rows.set(s, row);
    }
    return row;
  };
  const at = (u, v) => world.sampleTerrain(rowAt(start + v), left + u);
  function vertex(u, v) {
    const key = v * 8192 + Math.round(u * 10);
    let id = lookup.get(key);
    if (id !== undefined) return id;
    id = positions.length / 3;
    lookup.set(key, id);
    const row = rowAt(start + v);
    const y = world.sampleTerrain(row, left + u);
    positions.push(row.x + left + u, y, -row.s);
    groundOffsets.push(left + u, Math.max(-128, world.shoreDistance(row, left + u)), row.water?.level ?? 0, row.turnout);
    normals.push(0, 1, 0);
    world.reliefCoordinates(row, left + u, relief, id * 4);
    return id;
  }
  const uAt = (i) => (i * width) / divisions;
  const vAt = (j) => (j * LENGTH) / divisions;
  for (let j = 0; j <= divisions; j++) for (let i = 0; i <= divisions; i++) vertex(uAt(i), vAt(j));
  const height = (i, j) => positions[(j * side + i) * 3 + 1];
  const errors = Array.from({ length: STRIPS }, () => steps.map(() => 0));
  for (let level = 1; level < steps.length; level++) {
    const step = steps[level];
    for (let j = 0; j < divisions; j++)
      for (let i = 0; i < divisions; i++) {
        const x = i - (i % step),
          z = j - (j % step);
        const u = (i - x) / step,
          v = (j - z) / step;
        const b = height(x + step, z),
          c = height(x, z + step);
        const a = u + v <= 1 ? height(x, z) : height(x + step, z + step);
        const y = u + v <= 1 ? a + (b - a) * u + (c - a) * v : a + (c - a) * (1 - u) + (b - a) * (1 - v);
        const error = errors[Math.floor((j * STRIPS) / divisions)];
        error[level] = Math.max(error[level], Math.abs(height(i, j) - y));
      }
  }

  const lod = errors.map((_, strip) =>
    steps.map((step) => {
      const indices = [];
      const first = (divisions * strip) / STRIPS,
        end = first + divisions / STRIPS;
      for (let j = first; j < end; j += step)
        for (let i = 0; i < divisions; i += step) {
          const u = uAt(i),
            v = vAt(j),
            w = uAt(i + step),
            t = vAt(j + step);
          const a = vertex(u, v),
            b = vertex(w, v),
            c = vertex(u, t),
            d = vertex(w, t);
          const south = j === (skyline ? 0 : first);
          const north = j + step === (skyline ? divisions : end);
          // A narrow peak or notch can fall between all four skyline samples.
          const split = skyline && Math.abs(at((u + w) / 2, (v + t) / 2)
            - (positions[b * 3 + 1] + positions[c * 3 + 1]) / 2) > 12;
          if (!split && i && !south && i + step < divisions && !north) {
            indices.push(a, b, c, b, d, c);
            continue;
          }
          const ring = [a];
          if (south) for (const x of edge) if (x > u && x < w) ring.push(vertex(x, v));
          ring.push(b);
          if (i + step === divisions)
            for (let z = v + TERRAIN_STEP; z < t; z += TERRAIN_STEP) ring.push(vertex(w, z));
          ring.push(d);
          if (north)
            for (let k = edge.length - 1; k >= 0; k--)
              if (edge[k] > u && edge[k] < w) ring.push(vertex(edge[k], t));
          ring.push(c);
          if (i === 0) for (let z = t - TERRAIN_STEP; z > v; z -= TERRAIN_STEP) ring.push(vertex(u, z));
          if (!split && ring.length === 4) indices.push(a, b, c, b, d, c);
          else {
            const center = vertex((u + w) / 2, (v + t) / 2);
            for (let k = 0; k < ring.length; k++) indices.push(center, ring[k], ring[(k + 1) % ring.length]);
          }
        }
      return Uint16Array.from(indices);
    }),
  );

  for (let id = 0; id < positions.length / 3; id++) {
    const k = 3 * id,
      s = -positions[k + 2],
      v = s - start;
    const u = positions[k] - rowAt(s).x - left;
    const i = Math.round(u / uAt(1)),
      j = Math.round(v / vAt(1));
    const interior = id < side * side && i > 0 && i < divisions && j > 0 && j < divisions;
    const dx = interior ? uAt(1) : 6,
      ds = interior ? vAt(1) : 6;
    const across = (interior ? height(i + 1, j) - height(i - 1, j) : at(u + dx, v) - at(u - dx, v)) / (2 * dx);
    const along = (interior ? height(i, j + 1) - height(i, j - 1) : at(u, v + ds) - at(u, v - ds)) / (2 * ds);
    const nz = along - (across * (rowAt(s + ds).x - rowAt(s - ds).x)) / (2 * ds);
    const length = Math.hypot(across, 1, nz);
    normals[k] = -across / length;
    normals[k + 1] = 1 / length;
    normals[k + 2] = nz / length;
  }
  return {
    left,
    width,
    band,
    start,
    lod,
    errors,
    position: Float32Array.from(positions),
    normal: Float32Array.from(normals),
    relief: Float32Array.from(relief),
    groundOffsets: Float32Array.from(groundOffsets),
  };
}

export class Horizon {
  constructor(scene, world, material, covered) {
    this.scene = scene;
    this.covered = covered;
    this.world = world;
    this.material = material;
    this.pages = new Map();
    this.focal = 1000;
    this.revision = -1;
  }

  update(car, low, revision, eager) {
    const x = car.x - this.world.centerX(car.s);
    const cx = Math.floor(x / 96),
      cs = Math.floor(car.s / 96);
    if (
      !this.pending &&
      this.cx === cx &&
      this.cs === cs &&
      this.low === low &&
      this.revision === revision &&
      this.lastFocal === this.focal
    )
      return;
    Object.assign(this, { cx, cs, low, revision, lastFocal: this.focal });
    const range = horizonRange(low);
    const keep = new Set();
    const rows = new Map(); // Neighbouring pages sample the same road stations.
    let built = 0;
    this.pending = false;
    const radius = Math.ceil(range / 640) + 2;
    const center =
      Math.abs(x) < 960 ? Math.round(x / 640) : Math.sign(x) * (2 + Math.floor((Math.abs(x) - 960) / 768));
    const row = Math.floor(car.s / LENGTH);
    for (let col = center - radius; col <= center + radius; col++) {
      const { left, width, band } = footprint(col);
      const dx = Math.max(0, left - x, x - left - width);
      for (let p = row - Math.ceil(range / LENGTH); p <= row + Math.ceil(range / LENGTH); p++) {
        const dz = Math.max(0, p * LENGTH - car.s, car.s - (p + 1) * LENGTH);
        const distance = Math.hypot(dx, dz);
        if (distance > range) continue;
        const id = col + ':' + p;
        let entry = this.pages.get(id);
        let mask = 0;
        for (let k = 0; k < STRIPS; k++) if (this.covered(p * STRIPS + k, band)) mask |= 1 << k;
        if (mask === 255 && !entry) continue;
        keep.add(id);
        const skylineStart = (low ? 3500 : 5600) + (entry?.divisions === 32 ? 350 : 0);
        const divisions = distance > skylineStart ? 16
          : !low && distance < (entry?.divisions === 64 ? 3600 : 3150) ? 64 : 32;
        if (!entry || (mask !== 255 && divisions !== entry.divisions)) {
          if (!eager && built >= 2 && (entry || distance > 1750)) {
            this.pending = true;
            if (!entry) continue;
          } else {
            if (entry) {
              this.scene.remove(entry.mesh);
              entry.mesh.geometry.dispose();
            }
            const data = mountainPage(this.world, col, p, divisions, rows);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
            geometry.setAttribute('reliefField', new THREE.BufferAttribute(data.relief, 4));
            geometry.setAttribute('groundOffsets', new THREE.BufferAttribute(data.groundOffsets, 4));
            const capacity = data.lod.reduce((sum, levels) => sum + Math.max(...levels.map((l) => l.length)), 0);
            geometry.setIndex(
              new THREE.BufferAttribute(new Uint16Array(capacity), 1).setUsage(THREE.DynamicDrawUsage),
            );
            geometry.computeBoundingSphere();
            const mesh = new THREE.Mesh(geometry, this.material);
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            entry = { data, mesh, divisions, signature: -1 };
            built++;
            this.pages.set(id, entry);
          }
        }
        const { data, mesh } = entry;
        mesh.visible = mask !== 255;
        if (!mesh.visible) continue;
        let signature = 0;
        const levels = data.errors.map((errors, k) => {
          const s = (p * STRIPS + k + 0.5) * CHUNK_LENGTH;
          const pixelsPerMeter = this.focal / Math.max(64, Math.hypot(dx, s - car.s) - CHUNK_LENGTH / 2);
          let level = 0;
          while (level + 1 < errors.length && errors[level + 1] * pixelsPerMeter < (low ? 6 : 2.2)) level++;
          if (mask & (1 << k)) level = 3;
          signature = signature * 4 + level;
          return level;
        });
        if (signature === entry.signature) continue;
        entry.signature = signature;
        let count = 0;
        const index = mesh.geometry.index;
        for (let k = 0; k < STRIPS; k++) {
          if (levels[k] === 3) continue;
          const triangles = data.lod[k][levels[k]];
          index.array.set(triangles, count);
          count += triangles.length;
        }
        index.clearUpdateRanges();
        index.addUpdateRange(0, count);
        index.needsUpdate = true;
        mesh.geometry.setDrawRange(0, count);
      }
    }
    for (const [id, { mesh }] of this.pages)
      if (!keep.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.pages.delete(id);
      }
  }
}
