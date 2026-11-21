import * as THREE from 'three/webgpu';
import { positionGeometry, positionLocal, time, vec3 } from 'three/tsl';
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
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const y = 228 - 205 * t;
      const reach = (0.24 + 0.76 * Math.sin(t * Math.PI) ** 0.64) * (1 - 0.59 * t) * 164;
      for (const side of [-1, 1]) {
        const tipX = 188 + side * reach * (0.64 + random() * 0.38);
        const tipY = y - (12 + random() * 23) * (1 - 0.42 * t);
        ctx.strokeStyle = layer ? '#667748' : '#263c2d';
        ctx.lineWidth = layer ? 1.4 : 3.7;
        ctx.beginPath();
        ctx.moveTo(188, y);
        ctx.quadraticCurveTo((tipX + 188) * 0.5, y + 7, tipX, tipY);
        ctx.stroke();

        for (let leaf = 0; leaf < 24; leaf++) {
          const u = leaf / 24;
          const x = 188 + (tipX - 188) * u;
          const sy = y + (tipY - y) * u * u;
          const span = (5 + 17 * (1 - u) * (0.45 + random())) * (1 - t * 0.31);
          for (const pitch of [-1, 1]) {
            ctx.strokeStyle = needleColors[Math.floor(random() * needleColors.length)];
            ctx.lineWidth = (layer ? 1.15 : 1.95) + random() * 1.25;
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
export const grassMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 1, side: THREE.DoubleSide });

function windBend(height, amplitude) {
  const space = positionLocal.x.mul(0.068).add(positionLocal.z.mul(0.11));
  const gust = space.add(time.mul(1.8)).sin().add(space.mul(2.1).add(time.mul(3.1)).sin().mul(0.24));
  const bend = positionGeometry.y.div(height).clamp(0, 1).pow(2).mul(gust).mul(amplitude);
  return positionLocal.add(vec3(bend, bend.mul(0.08), bend.mul(0.54)));
}
coniferMaterial.positionNode = windBend(8.2, 0.24);
grassMaterial.positionNode = windBend(0.81, 0.23);

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
    const y = 1.48 + 5.95 * fraction;
    const reach = 2.43 * Math.pow(1 - fraction * 0.94, 0.91);
    const arms = tier < detail * 0.7 ? 5 : 4;
    for (let arm = 0; arm < arms; arm++) {
      const angle = (arm / arms + tier * 0.093) * Math.PI * 2 + random() * 0.32;
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      const length = reach * (0.77 + random() * 0.42);
      const width = length * (0.32 + random() * 0.12);
      const tip = y + (0.33 + fraction * 0.56) * (0.48 + random() * 0.89) - length * 0.15;
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

export const conifer = branchTree(13, 3108);
export const distantConifer = branchTree(6, 5219);

export function grassTuft() {
  const random = randomFor(55217);
  const positions = [];
  const indices = [];
  for (let i = 0; i < 8; i++) {
    const angle = i * 2.399 + random() * 0.6;
    const bend = 0.07 + random() * 0.2;
    const height = 0.25 + random() * 0.52;
    const width = 0.018 + random() * 0.018;
    const dx = Math.cos(angle) * width;
    const dz = Math.sin(angle) * width;
    const x = (random() - 0.5) * 0.18;
    const z = (random() - 0.5) * 0.18;
    const k = positions.length / 3;
    positions.push(x - dx, 0, z - dz, x + dx, 0, z + dz,
      x + dx + bend * 0.38, height * 0.56, z + dz + bend * 0.2,
      x + bend, height, z + bend * 0.5,
      x - dx + bend * 0.38, height * 0.56, z - dz + bend * 0.2);
    indices.push(k, k + 1, k + 4, k + 1, k + 2, k + 4, k + 2, k + 3, k + 4);
  }
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shape.setIndex(indices);
  shape.computeVertexNormals();
  return shape;
}
