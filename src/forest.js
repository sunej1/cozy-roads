import * as THREE from 'three/webgpu';
import { cameraPosition, positionWorld, smoothstep, positionGeometry, positionLocal, time, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomFor } from './route.js';

function branchAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const random = randomFor(38484);

  ctx.fillStyle = '#584839';
  ctx.fillRect(389, 21, 105, 212);
  for (let i = 0; i < 136; i++) {
    ctx.strokeStyle = i % 2 ? '#776550' : '#39362e';
    ctx.globalAlpha = 0.18 + random() * 0.34;
    ctx.lineWidth = 0.5 + random() * 2.6;
    const x = 390 + random() * 102;
    ctx.beginPath();
    ctx.moveTo(x, 21);
    ctx.bezierCurveTo(x - 5, 87, x + 7, 163, x - 3, 233);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  const needleColors = ['#334a32', '#435937', '#506940', '#61794d', '#72935c', '#8c9e63'];
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < 18; i++) {
      const t = (i + random()*.45) / 18;
      const y = 228 - 205 * t;
      const reach = (0.16 + 0.74 * Math.sin(t * Math.PI) ** 0.64) * (1 - 0.59 * t) * 164;
      for (const side of [-1, 1]) {
        const tipX = 188 + side * reach * (0.64 + random() * 0.38);
        const tipY = y - (12 + random() * 23) * (1 - 0.42 * t);
        ctx.strokeStyle = layer ? '#667748' : '#263c2d';
        ctx.lineWidth = layer ? 1.4 : 3.7;
        ctx.beginPath();
        ctx.moveTo(188, y);
        ctx.quadraticCurveTo((tipX + 188) * 0.5, y + 7, tipX, tipY);
        ctx.stroke();

        for (let leaf = 0; leaf < 15; leaf++) {
          const u = leaf / 15;
          const x = 188 + (tipX - 188) * u;
          const sy = y + (tipY - y) * u * u;
          const span = (5 + 17 * (1 - u) * (0.45 + random())) * (1 - t * 0.31);
          for (const pitch of [-1, 1]) {
            ctx.strokeStyle = needleColors[Math.floor(random() * needleColors.length)];
            ctx.lineWidth = (layer ? 1.15 : 1.65) + random() * 1.05;
            ctx.beginPath();
            ctx.moveTo(x, sy);
            ctx.lineTo(x + side * span * 0.76, sy + pitch * span * (0.41 + random() * 0.43));
            ctx.stroke();
          }
        }
      }
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

const foliageMap = branchAtlas();
export const coniferMaterial = new THREE.MeshStandardNodeMaterial({
  map: foliageMap, roughness: 0.92, vertexColors: true, alphaTest: 0.30, side: THREE.DoubleSide,
  emissive: '#233b22', emissiveMap: foliageMap, emissiveIntensity: 0.3,
});
export const grassMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
export const understoryMaterial = new THREE.MeshStandardNodeMaterial({
  roughness: 0.91, side: THREE.DoubleSide, vertexColors: true, emissive: '#283113', emissiveIntensity: 0.22,
});

function aspenAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const random = randomFor(99410);
  const leaves = ['#536238', '#6e853f', '#8c9a4e', '#a6a75b', '#bac56f'];
  for (let i = 0; i < 1700; i++) {
    const angle = random() * Math.PI * 2;
    const clumps = 0.82 + 0.10 * Math.sin(angle * 5) + 0.09 * Math.cos(angle * 9);
    const radius = Math.sqrt(random()) * clumps;
    const x = 176 + Math.cos(angle) * radius * 157;
    const y = 130 + Math.sin(angle) * radius * 116;
    const size = 1.8 + random() * 4.8;
    ctx.fillStyle = leaves[Math.floor(random() * leaves.length)];
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * 0.48, angle + random(), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#d0cbbb';
  ctx.fillRect(378, 0, 134, 256);
  for (let i = 0; i < 86; i++) {
    const x = 381 + random() * 128;
    ctx.fillStyle = i % 4 ? '#a4a08e' : '#67665b';
    ctx.fillRect(x, random() * 256, Math.min(12 + random() * 31, 512 - x), 0.6 + random() * 3.2);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

const broadleafMap = aspenAtlas();
export const aspenMaterial = new THREE.MeshStandardNodeMaterial({
  map: broadleafMap, roughness: 0.91, alphaTest: 0.40, side: THREE.DoubleSide,
  emissiveMap: broadleafMap, emissive: '#665831', emissiveIntensity: 0.3,
});

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
grassMaterial.positionNode = windBend(0.81, 0.23);
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
      crown.computeVertexNormals();
      crown.rotateX((plane - 1) * 0.59).rotateY(angle + plane * 1.047).translate(branch.x, branch.y - 0.23, branch.z);
      parts.push(crown);
    }
  }
  return mergeGeometries(parts);
}

export function grassTuft() {
  const random = randomFor(55217);
  const positions = [],
    colors = [],
    normals = [],
    indices = [];
  for (let i = 0; i < 23; i++) {
    const angle = random() * Math.PI * 2,
      reach = Math.sqrt(random()) * 0.68;
    const x = Math.cos(angle) * reach,
      z = Math.sin(angle) * reach;
    const heading = angle + (random() - 0.5) * 1.4;
    const dx = Math.cos(heading),
      dz = Math.sin(heading);
    const h = 0.2 + random() * 0.33,
      width = 0.017 + random() * 0.024,
      lean = 0.06 + random() * 0.23;
    const first = positions.length / 3;
    for (const t of [0, 0.56, 1]) {
      for (const side of [-1, 1]) {
        const w = width * (1 - t) * side;
        positions.push(x + dx * t * t * lean - dz * w, t * h, z + dz * t * t * lean + dx * w);
        colors.push(0.28 + 0.82 * t, 0.38 + 0.67 * t, 0.19 + 0.45 * t);
        normals.push(dx * 0.18, 0.98, dz * 0.18);
      }
    }
    indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2, first + 2, first + 3, first + 4);
  }
  const g = new THREE.BufferGeometry();
  for (const [name, data] of [
    ['position', positions],
    ['color', colors],
    ['normal', normals],
  ])
    g.setAttribute(name, new THREE.Float32BufferAttribute(data, 3));
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
