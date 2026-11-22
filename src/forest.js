import * as THREE from 'three/webgpu';
import { cameraPosition, diffuseColor, normalViewGeometry, positionWorld, referenceAttribute, smoothstep, uniform, positionGeometry, positionLocal, time, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomFor } from './route.js';

export const coniferMaterial = new THREE.MeshStandardNodeMaterial({
  roughness: 0.93, vertexColors: true, alphaTest: 0.24, side: THREE.DoubleSide,
});
export const grassMaterial = new THREE.MeshStandardNodeMaterial({
  roughness: 0.95, vertexColors: true, alphaTest: 0.24, side: THREE.DoubleSide,
});
export const bladeMaterial = new THREE.MeshStandardNodeMaterial({
  roughness: 0.96, vertexColors: true, side: THREE.DoubleSide,
});
// Both sides of a foliage card represent the same outward-facing canopy.
bladeMaterial.normalNode = grassMaterial.normalNode = coniferMaterial.normalNode = normalViewGeometry;
// Transmitted skylight lifts thin leaves above the deep shadow between their roots.
for (const material of [grassMaterial, bladeMaterial]) {
  material.emissiveNode = diffuseColor.rgb.mul(0.34);
}
export const understoryMaterial = new THREE.MeshStandardNodeMaterial({
  roughness: 0.91, side: THREE.DoubleSide, vertexColors: true, emissive: '#283113', emissiveIntensity: 0.22,
});

export const aspenMaterial = new THREE.MeshStandardNodeMaterial({
  roughness: 0.93, alphaTest: 0.36, side: THREE.DoubleSide,
});
export const flowerMaterial = new THREE.MeshStandardNodeMaterial({
  roughness: 0.93, alphaTest: 0.34, side: THREE.DoubleSide, vertexColors: true,
});
flowerMaterial.normalNode = aspenMaterial.normalNode = normalViewGeometry;

for (const material of [coniferMaterial,aspenMaterial]) {
  material.alphaTestNode = smoothstep(1.8,6.8,positionWorld.sub(cameraPosition).length()).oneMinus().mul(.80).add(material.alphaTest);
}

function windBend(height, amplitude) {
  const space = positionLocal.x.mul(0.068).add(positionLocal.z.mul(0.11));
  const gust = space.add(time.mul(1.8)).sin().add(space.mul(2.1).add(time.mul(3.1)).sin().mul(0.24));
  const bend = positionGeometry.y.div(height).clamp(0, 1).pow(2).mul(gust).mul(amplitude);
  return positionLocal.add(vec3(bend, bend.mul(0.08), bend.mul(0.54)));
}
coniferMaterial.positionNode = windBend(8.2, 0.24);
aspenMaterial.positionNode = windBend(6.6, 0.31);

export const meadowCenter = uniform(new THREE.Vector2());
export const meadowRange = uniform(new THREE.Vector2(24, 56));
export const bladeRange = uniform(new THREE.Vector2(15, 31));
const tuftRoot = referenceAttribute('instanceMatrix', 'mat4').element(3).xyz;
for (const [material, range] of [[grassMaterial, meadowRange], [bladeMaterial, bladeRange], [flowerMaterial, meadowRange]]) {
  const scale = smoothstep(range.x, range.y, tuftRoot.xz.sub(meadowCenter).length()).oneMinus();
  material.positionNode = tuftRoot.add(windBend(0.5, 0.065).sub(tuftRoot).mul(scale));
}

understoryMaterial.positionNode = windBend(0.61, 0.12);

function branchTree(detail, seed) {
  const random = randomFor(seed);
  const positions = [];
  const normals = [];
  const uv = [];
  const colors = [];
  const indices = [];
  const height = 8.2;
  const tint = new THREE.Color();

  function vertex(x, y, z, nx, ny, nz, u, v, color) {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uv.push(u, v);
    colors.push(color.r, color.g, color.b);
  }

  tint.setRGB(0.89, 0.81, 0.73);
  const barkSides = 7;
  for (let ring = 0; ring <= 3; ring++) {
    const y = height * ring / 3;
    const width = 0.135 * (1 - ring / 3) + 0.022;
    for (let side = 0; side <= barkSides; side++) {
      const a = side / barkSides * Math.PI * 2;
      vertex(Math.cos(a) * width, y, Math.sin(a) * width, Math.cos(a), 0, Math.sin(a),
        0.80 + side / barkSides * 0.14, 0.12 + ring * 0.25, tint);
      if (ring && side) {
        const i = ring * (barkSides + 1) + side;
        indices.push(i - barkSides - 2, i - 1, i, i - barkSides - 2, i, i - barkSides - 1);
      }
    }
  }

  for (let tier = 0; tier < detail; tier++) {
    const fraction = tier / (detail - 1);
    const y = 1.12 + 6.42 * fraction;
    const reach = 2.43 * Math.pow(1 - fraction * 0.94, 0.91);
    const arms = tier < detail * 0.7 ? 7 : 5;
    for (let arm = 0; arm < arms; arm++) {
      const angle = (arm / arms + tier * 0.093) * Math.PI * 2 + random() * 0.32;
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      const length = reach * (0.77 + random() * 0.42);
      const width = length * (0.23 + random() * 0.15);
      const tip = y + (0.12 + fraction * 0.65) * (0.3 + random()) - length * (0.15 + random() * 0.28);
      const shade = 0.73 + fraction * 0.18 + random() * 0.11;
      tint.setRGB(shade * 0.88, shade, shade * 0.85);
      const i = positions.length / 3;

      vertex(0, y, 0, x * 0.24, 0.96, z * 0.24, 0.365, 0.059, tint);
      vertex(x * length * 0.43 - z * width, y + 0.14, z * length * 0.43 + x * width,
        x * 0.26 - z * 0.25, 0.92, z * 0.26 + x * 0.25, 0.015, 0.43, tint);
      vertex(x * length, tip, z * length, x * 0.52, 0.85, z * 0.52, 0.365, 0.985, tint);
      vertex(x * length * 0.43 + z * width, y - 0.17, z * length * 0.43 - x * width,
        x * 0.26 + z * 0.25, 0.92, z * 0.26 - x * 0.25, 0.72, 0.43, tint);
      vertex(x * length * 0.50, y + 0.37, z * length * 0.50, x * 0.32, 0.94, z * 0.32, 0.365, 0.50, tint);
      indices.push(i, i + 4, i + 1, i + 1, i + 4, i + 2, i + 2, i + 4, i + 3, i + 3, i + 4, i);
    }
  }

  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shape.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  shape.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shape.setIndex(indices);
  return shape;
}

export const conifer = branchTree(15, 3108);
export const distantConifer = branchTree(6, 5219);

export function aspen() {
  const random = randomFor(612);
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  function limb(beg, end, wide, tip) {
    const direction = end.clone().sub(beg);
    const trunk = new THREE.CylinderGeometry(tip, wide, direction.length(), 6, 1, true);
    trunk.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
    trunk.translate(...beg.clone().lerp(end, 0.5).toArray());
    const uv = trunk.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, 0.77 + uv.getX(i) * 0.20);
    parts.push(trunk);
  }
  limb(new THREE.Vector3(0, -0.14, 0), new THREE.Vector3(0.17, 6.35, -0.08), 0.149, 0.024);
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const angle = i * 2.399 + random() * 0.4;
    const length = (0.41 + Math.sin(t * Math.PI) * 1.53) * (0.89 + random() * 0.25);
    const y = 2.35 + t * 3.65;
    const branch = new THREE.Vector3(Math.cos(angle) * length, y + 0.8, Math.sin(angle) * length);
    limb(new THREE.Vector3(0.14 * t, y - 0.77, -0.08 * t), branch, 0.071 - t * 0.028, 0.011);
    for (let plane = 0; plane < 3; plane++) {
      const crown = new THREE.PlaneGeometry(1.60 + length * 0.79, 1.75 + length * 0.40, 2, 2);
      const uv = crown.getAttribute('uv');
      for (let j = 0; j < uv.count; j++) uv.setX(j, uv.getX(j) * 0.69);
      const vertices = crown.getAttribute('position');
      for (let j = 0; j < vertices.count; j++) vertices.setZ(j, Math.sin(uv.getY(j) * Math.PI) * 0.39);
      // Shade each leafy spray as a canopy even when seen through its reverse side.
      const normals = crown.getAttribute('normal');
      for (let v = 0; v < normals.count; v++) {
        const nx = vertices.getX(v) * 0.48, ny = 0.78 + vertices.getY(v) * 0.16;
        const len = Math.hypot(nx, ny, 0.56);
        normals.setXYZ(v, nx / len, ny / len, 0.56 / len);
      }
      crown.rotateX((plane - 1) * 0.59).rotateY(angle + plane * 1.047).translate(branch.x, branch.y - 0.23, branch.z);
      parts.push(crown);
    }
  }
  return mergeGeometries(parts);
}

export function grassTuft() {
  const positions = [], normals = [], colors = [], uvs = [], indices = [];
  // Each curved ribbon carries a photographed stand of grass. Stagger the roots
  // and bow the middle so the stand also has volume when seen along a ribbon.
  for (let strip = 0; strip < 4; strip++) {
    const angle = strip * 2.40;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const width = [0.84, 0.96, 0.83, 0.88][strip], height = [0.25, 0.26, 0.20, 0.24][strip];
    const first = positions.length / 3;
    for (let col = 0; col < 3; col++) {
      const across = (col - 1) * width / 2;
      const bow = col === 1 ? 0.08 : -0.03;
      for (let row = 0; row < 2; row++) {
        const drift = bow + (strip - 1.5) * 0.15 + row * 0.06;
        positions.push(across * dx - drift * dz, row * height - 0.035, across * dz + drift * dx);
        normals.push(dx * (col - 1) * 0.23 - dz * 0.35, 0.92, dz * (col - 1) * 0.23 + dx * 0.35);
        const shade = row ? 1.16 : 0.88;
        colors.push(shade, shade, shade);
        uvs.push(((strip % 2) + 0.009 + col * 0.491) / 2, (1 - Math.floor(strip / 2) + 0.018 + row * 0.964) / 2);
      }
      if (col) {
        const k = first + col * 2;
        indices.push(k - 2, k - 1, k, k, k - 1, k + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function meadowFlowers() {
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  function leaf(x, y, z, radius, corner, warm) {
    const first = positions.length / 3;
    const tint = warm ? [1.10, 0.96, 0.75] : [0.82, 1.11, 0.73];
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]) {
      positions.push(x + (u - 0.5) * radius, y + (u - v) * radius * 0.18 + (u === 0.5 ? -0.009 : 0),
        z + (0.5 - v) * radius);
      normals.push((u - 0.5) * 0.3, 0.97, (0.5 - v) * 0.3);
      colors.push(...tint);
      uvs.push(corner + u * 0.496, v);
    }
    for (let i = 0; i < 4; i++) indices.push(first + i, first + (i + 1) % 4, first + 4);
  }
  for (const [x, z, h] of [[0, 0, 0.36], [0.14, -0.11, 0.43], [-0.18, 0.16, 0.29]]) {
    const first = positions.length / 3;
    for (const [dx, y] of [[-0.002, 0], [0.002, 0], [-0.002, h], [0.002, h]]) {
      positions.push(x + dx + 0.08 * y, y, z - y * 0.13);
      normals.push(0, 0.9, 0.36); colors.push(0.47, 0.68, 0.31); uvs.push(0.75, 0.50);
    }
    indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
    leaf(x + h * 0.08, h, z - h * 0.13, 0.085, 0, true);
    leaf(x - 0.012, h * 0.44, z + 0.015, 0.155, 0.5, false);
  }
  const g = new THREE.BufferGeometry();
  for (const [key, data, components] of [['position', positions, 3], ['normal', normals, 3],
    ['color', colors, 3], ['uv', uvs, 2]]) g.setAttribute(key, new THREE.Float32BufferAttribute(data, components));
  g.setIndex(indices);
  return g;
}

export function understory() {
  const random = randomFor(41881);
  const positions = [];
  const colors = [];
  const indices = [];
  const base = new THREE.Color('#546937');
  const tip = new THREE.Color('#b8bd5b');
  const shade = new THREE.Color();
  for (let frond = 0; frond < 8; frond++) {
    const angle = frond * 2.399 + random() * 0.33;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    const reach = 0.40 + random() * 0.50;
    const height = 0.39 + random() * 0.34;
    for (let row = 0; row < 5; row++) {
      const t = (row + 1) / 6;
      const stem = t * t * reach;
      const y = height * Math.sin(t * 2.1);
      const span = (0.97 - t) * reach * 0.49;
      for (const side of [-1, 1]) {
        const width = span * (0.80 + random() * 0.38);
        const across = side * width;
        const k = positions.length / 3;
        positions.push(x * stem, y, z * stem,
          x * (stem + width * 0.34) - z * across * 0.60, y + 0.05, z * (stem + width * 0.34) + x * across * 0.60,
          x * (stem + width * 0.95) - z * across, y + 0.025, z * (stem + width * 0.95) + x * across,
          x * (stem + width * 0.66) - z * across * 0.47, y + 0.008, z * (stem + width * 0.66) + x * across * 0.47);
        indices.push(k, k + 1, k + 3, k + 1, k + 2, k + 3);
        for (const position of [0, 0.27, 0.66, 0.16]) {
          shade.copy(base).lerp(tip, position + t * 0.28);
          colors.push(shade.r, shade.g, shade.b);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
