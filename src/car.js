import * as THREE from 'three/webgpu';
import { uv, vec3, smoothstep } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VEHICLES } from './vehicles.js';

const paint = new THREE.MeshPhysicalMaterial({ color: '#c97e2e', roughness: 0.28, metalness: 0.30, clearcoat: 0.88, clearcoatRoughness: 0.12 });
const glass = new THREE.MeshPhysicalMaterial({ color: '#121d28', roughness: 0.19, metalness: 0.22, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: 0.13, side: THREE.DoubleSide });
const rubber = new THREE.MeshStandardMaterial({ color: '#222724', roughness: 0.94 });
const trim = new THREE.MeshStandardMaterial({ color: '#404642', roughness: 0.6 });
const alloy = new THREE.MeshStandardMaterial({ color: '#b9c3bc', roughness: 0.33, metalness: 0.83 });
const tail = new THREE.MeshPhysicalMaterial({ color: '#962018', roughness: 0.30, clearcoat: 1, emissive: '#c72c1d', emissiveIntensity: 0.21 });
const lamp = new THREE.MeshStandardMaterial({ color: '#efe0b7', emissive: '#715631', emissiveIntensity: 0.2 });
const plate = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.66 });
const taillightHousing = new THREE.MeshPhysicalMaterial({ color: '#380a09', roughness: 0.21, clearcoat: 1, clearcoatRoughness: 0.11 });
const reversingLight = new THREE.MeshStandardMaterial({ color: '#cad0bb', roughness: 0.43 });
const gasket = new THREE.MeshStandardMaterial({ color: '#1b2423', roughness: 0.63 });
const marker = new THREE.MeshStandardMaterial({ color: '#de8b37', emissive: '#683314', emissiveIntensity: 0.24 });

function plateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e3e7d4';
  ctx.fillRect(0, 0, 256, 72);
  ctx.fillStyle = '#324b65';
  ctx.fillRect(0, 0, 20, 72);
  ctx.font = 'bold 46px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#232821';
  ctx.fillText('FJ 2714', 137, 37);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

const wagonSections = [
  [-2.095, 0.78, 0.53, 0.73], [-1.87, 0.88, 0.41, 0.83], [-1.36, 0.945, 0.35, 0.89],
  [-0.62, 0.942, 0.35, 0.92], [0.64, 0.936, 0.36, 0.91], [1.30, 0.946, 0.36, 0.91],
  [1.85, 0.91, 0.44, 0.87], [2.12, 0.83, 0.50, 0.82],
];

function bodyShell(sections, material, spec) {
  const positions = [];
  const indices = [];
  const rings = new Set(sections.map(section => section[0]));
  const centers = [-spec.wheelbase * 0.5, spec.wheelbase * 0.5];
  const opening = spec.radius * 1.19;
  for (const center of centers) {
    for (let point = 0; point <= 12; point++) {
      const z = center + opening * Math.cos(point / 12 * Math.PI);
      if (z > sections[0][0] && z < sections.at(-1)[0]) rings.add(z);
    }
  }
  for (const z of [...rings].sort((a, b) => a - b)) {
    const end = sections.findIndex(section => section[0] >= z);
    const a = sections[Math.max(0, end - 1)];
    const b = sections[end];
    const t = end === 0 ? 0 : (z - a[0]) / (b[0] - a[0]);
    const x = THREE.MathUtils.lerp(a[1], b[1], t);
    const top = THREE.MathUtils.lerp(a[3], b[3], t);
    const baseline = THREE.MathUtils.lerp(a[2], b[2], t);
    const distance = Math.min(...centers.map(center => Math.abs(center - z)));
    const arch = distance < opening ? spec.radius + Math.sqrt(opening ** 2 - distance ** 2) * 0.97 : baseline;
    const bottom = Math.min(top - 0.054, Math.max(baseline, arch));
    const bevel = Math.min(0.085, (top - bottom) * 0.37);
    positions.push(
      -x + 0.092, bottom, z, -x, bottom + bevel, z, -x, top - bevel, z, -x + 0.085, top, z,
      x - 0.085, top, z, x, top - bevel, z, x, bottom + bevel, z, x - 0.092, bottom, z,
    );
  }
  for (let row = 1; row < rings.size; row++) {
    for (let i = 0; i < 8; i++) {
      const a = (row - 1) * 8 + i;
      const b = (row - 1) * 8 + (i + 1) % 8;
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
  }
  const last = (rings.size - 1) * 8;
  for (let i = 1; i < 7; i++) indices.push(0, i, i + 1, last, last + i + 1, last + i);
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shape.setIndex(indices);
  shape.computeVertexNormals();
  return new THREE.Mesh(shape, material);
}

function box(parent, material, size, position, radius = 0) {
  const shape = radius ? new RoundedBoxGeometry(...size, 2, radius) : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(shape, material);
  mesh.position.set(...position);
  parent.add(mesh);
}

function quad(parent, points, material) {
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(point => point.toArray()), 3));
  shape.setIndex([0, 1, 2, 0, 2, 3]);
  shape.computeVertexNormals();
  parent.add(new THREE.Mesh(shape, material));
}

function windowPanel(parent, corners, normal, frame = paint, divider = false) {
  const center = new THREE.Vector3();
  corners.forEach(corner => center.add(corner));
  center.multiplyScalar(0.25);
  quad(parent, corners, frame);
  quad(parent, corners.map(corner => corner.clone().lerp(center, 0.09).addScaledVector(normal, 0.008)), gasket);
  const inset = corners.map(corner => corner.clone().lerp(center, 0.15).addScaledVector(normal, 0.015));
  quad(parent, inset, glass);
  if (divider) {
    const point = (a, b, t) => inset[a].clone().lerp(inset[b], t).addScaledVector(normal, 0.009);
    quad(parent, [point(0, 3, 0.483), point(1, 2, 0.484), point(1, 2, 0.516), point(0, 3, 0.517)], gasket);
  }
}

function wheelParts(radius, width, id) {
  const trail = id === 'trail';
  const style = { wagon: [8, 0.88, 0.047], retro: [5, 0.98, 0.050], hyper: [10, 1.06, 0.037], trail: [6, 0.76, 0.073] };
  const [spokes, size, cut] = style[id];
  const rimRadius = radius * 0.63 * size;
  const tireProfile = [
    [rimRadius, -0.42], [radius * 0.77, -0.51], [radius * 0.91, -0.48], [radius * 0.985, -0.34], [radius, -0.22],
    [radius, 0.22], [radius * 0.985, 0.34], [radius * 0.91, 0.48], [radius * 0.77, 0.51], [rimRadius, 0.42],
  ];
  const lathe = profile => new THREE.LatheGeometry(profile.map(([r, w]) => new THREE.Vector2(r, w * width)), 36).rotateZ(-Math.PI / 2);
  const tread = [lathe(tireProfile)];
  for (let tooth = 0; trail && tooth < 28; tooth++) {
    for (const side of [-1, 1]) {
      tread.push(new THREE.BoxGeometry(width * 0.44, radius * 0.065, radius * 0.15)
        .rotateY(side * 0.38).translate(side * width * 0.27, radius * 0.985, 0)
        .rotateX((tooth + (side === 1 ? 0.47 : 0)) * Math.PI / 14));
    }
  }
  const rims = [lathe([
    [rimRadius * 0.96, -0.42], [rimRadius, -0.46], [rimRadius * 1.04, -0.48], [rimRadius * 1.07, -0.41],
    [rimRadius * 1.07, 0.41], [rimRadius * 1.04, 0.48], [rimRadius, 0.46], [rimRadius * 0.96, 0.42],
  ])];
  for (const side of [-1, 1]) {
    for (let index = 0; index < spokes; index++) {
      rims.push(new THREE.BoxGeometry(0.023, rimRadius * 0.79, cut)
        .rotateY(id === 'hyper' ? 0.34 : 0.06).rotateZ(side * 0.16)
        .translate(side * width * 0.443, rimRadius * 0.55, 0).rotateX(index * Math.PI * 2 / spokes));
    }
  }
  const ring = new THREE.CylinderGeometry(rimRadius * 0.37, rimRadius * 0.37, width * 0.92, 12).rotateZ(Math.PI / 2);
  rims.push(ring);
  return [
    [mergeGeometries(tread), rubber], [mergeGeometries(rims), alloy],
    [new THREE.CylinderGeometry(rimRadius * 0.80, rimRadius * 0.80, width * 0.61, 24).rotateZ(Math.PI / 2), trim],
  ];
}

function addWheel(parts, center, tires, root, front) {
  const pivot = new THREE.Group();
  const wheel = new THREE.Group();
  pivot.position.set(...center);
  for (const [geometry, material] of parts) wheel.add(new THREE.Mesh(geometry, material));
  pivot.add(wheel);
  root.add(pivot);
  tires.push({ pivot, wheel, front });
}

function exhaust(body, x, y, z, radius) {
  const pipe = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.85, radius * 0.15, 7, 20), alloy);
  const lining = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.81, 20), gasket);
  pipe.position.set(x, y, z);
  lining.position.set(x, y, z - 0.006);
  body.add(pipe, lining);
}

export function makeCar() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const spec = VEHICLES.wagon;
  body.add(bodyShell(wagonSections, paint, spec));
  box(body, trim, [1.87, 0.125, 0.20], [0, 0.485, 2.085], 0.051);
  box(body, trim, [1.8, 0.103, 0.18], [0, 0.47, -2.04], 0.041);
  box(body, gasket, [1.19, 0.28, 0.041], [0, 0.69, 2.132], 0.015);
  box(body, paint, [0.94, 0.25, 0.040], [0, 0.68, 2.151], 0.012);
  box(body, alloy, [1.45, 0.025, 0.04], [0, 0.52, 2.19]);
  box(body, paint, [1.48, 0.13, 1.76], [0, 1.49, 0.26], 0.06);
  box(body, trim, [1.46, 0.045, 0.1], [0, 1.48, 1.15]);
  box(body, trim, [0.09, 0.065, 1.24], [-0.61, 1.575, 0.28], 0.021);
  box(body, trim, [0.09, 0.065, 1.24], [0.61, 1.575, 0.28], 0.021);
  box(body, gasket, [0.37, 0.107, 0.025], [0, 0.66, 2.171], 0.01);
  box(body, plate, [0.32, 0.089, 0.014], [0, 0.66, 2.184], 0.006);
  box(body, alloy, [0.11, 0.044, 0.015], [0, 0.77, 2.173], 0.006);
  box(body, gasket, [1.32, 0.033, 0.055], [0, 0.568, 2.211], 0.008);
  exhaust(body, -0.64, 0.38, 2.155, 0.045);
  for (const z of [-0.12, 0.76]) box(body, alloy, [1.28, 0.036, 0.055], [0, 1.603, z], 0.012);

  const point = (x, y, z) => new THREE.Vector3(x, y, z);
  const bfl = point(-0.82, 0.89, -1.04);
  const bfr = point(0.82, 0.89, -1.04);
  const brl = point(-0.82, 0.89, 1.55);
  const brr = point(0.82, 0.89, 1.55);
  const tfl = point(-0.71, 1.47, -0.58);
  const tfr = point(0.71, 1.47, -0.58);
  const trl = point(-0.71, 1.47, 1.11);
  const trr = point(0.71, 1.47, 1.11);
  windowPanel(body, [bfl, tfl, tfr, bfr], point(0, 0, -1));
  windowPanel(body, [brr, trr, trl, brl], point(0, 0, 1));
  windowPanel(body, [brl, trl, tfl, bfl], point(-1, 0, 0), paint, true);
  windowPanel(body, [bfr, tfr, trr, brr], point(1, 0, 0), paint, true);

  const rearWiper = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.49, 8), gasket);
  rearWiper.position.set(0.16, 1.015, 1.476);
  rearWiper.rotation.z = 1.37;
  body.add(rearWiper);

  const tires = [];
  const wheelArch = new THREE.TorusGeometry(0.365, 0.029, 6, 22, Math.PI).rotateY(Math.PI / 2);
  const wheels = wheelParts(spec.radius, 0.235, 'wagon');
  for (const side of [-1, 1]) {
    box(body, taillightHousing, [0.25, 0.225, 0.10], [side * 0.70, 0.741, 2.101], 0.025);
    box(body, tail, [0.227, 0.088, 0.049], [side * 0.70, 0.784, 2.156], 0.015);
    box(body, reversingLight, [0.21, 0.012, 0.009], [side * 0.70, 0.813, 2.180], 0.004);
    box(body, marker, [0.213, 0.034, 0.025], [side * 0.70, 0.720, 2.157], 0.007);
    box(body, reversingLight, [0.212, 0.034, 0.022], [side * 0.70, 0.676, 2.153], 0.006);
    box(body, gasket, [0.032, 0.065, 2.89], [side * 0.939, 0.61, 0.03], 0.013);
    box(body, alloy, [0.031, 0.028, 0.19], [side * 0.932, 0.844, 0.065], 0.009);
    box(body, alloy, [0.031, 0.028, 0.19], [side * 0.932, 0.844, 0.97], 0.009);
    box(body, lamp, [0.34, 0.13, 0.075], [side * 0.65, 0.74, -2.04], 0.025);
    box(body, trim, [0.19, 0.092, 0.21], [side * 0.94, 1.02, -0.62], 0.027);
    for (const axle of [-1, 1]) {
      const arch = new THREE.Mesh(wheelArch, gasket);
      arch.position.set(side * 0.918, 0.372, axle * 1.29);
      body.add(arch);
      addWheel(wheels, [side * 0.876, spec.radius, axle * 1.29], tires, root, axle === -1);
    }
  }

  return finishModel(root, tires, tail, 3.45, 5.9);
}

function finishModel(root, tires, brakeLamp, width, length) {
  root.traverse(object => {
    if (object.isMesh) object.castShadow = object.receiveShadow = true;
  });
  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const distance = uv().sub(0.5).abs().mul(2);
  shadowMaterial.colorNode = vec3(0.019, 0.025, 0.021);
  shadowMaterial.opacityNode = smoothstep(0.16, 1, distance.x.pow(3).add(distance.y.pow(4))).oneMinus().mul(0.53);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2), shadowMaterial);
  shadow.position.y = 0.084;
  root.add(shadow);
  root.rotation.order = 'YXZ';
  return { root, tires, brake: active => { brakeLamp.emissiveIntensity = active ? 1.65 : 0.19; } };
}

const SHAPES = {
  retro: {
    color: '#b42e25', roof: 1.17, roofFront: -0.31, roofRear: 0.79, glassFront: -0.91, glassRear: 1.53,
    sill: 0.68, cabinWidth: 0.725,
    sections: [
      [-2.17, 0.77, 0.29, 0.56], [-1.72, 0.92, 0.32, 0.62], [-0.88, 0.94, 0.30, 0.68],
      [0.80, 0.92, 0.30, 0.71], [1.68, 0.94, 0.34, 0.75], [2.12, 0.85, 0.37, 0.70],
    ],
  },
  hyper: {
    color: '#238b89', roof: 1.07, roofFront: -0.36, roofRear: 0.51, glassFront: -1.24, glassRear: 1.35,
    sill: 0.63, cabinWidth: 0.63,
    sections: [
      [-2.19, 0.86, 0.23, 0.42], [-1.70, 1.00, 0.24, 0.54], [-0.76, 0.94, 0.29, 0.63],
      [0.65, 0.94, 0.24, 0.69], [1.57, 1.02, 0.27, 0.73], [2.09, 0.92, 0.32, 0.67],
    ],
  },
  trail: {
    color: '#798253', roof: 1.91, roofFront: -0.56, roofRear: 1.06, glassFront: -0.85, glassRear: 1.40,
    sill: 1.10, cabinWidth: 0.796,
    sections: [
      [-1.99, 0.85, 0.61, 1.02], [-1.61, 0.92, 0.61, 1.12], [-0.87, 0.92, 0.60, 1.11],
      [0.63, 0.92, 0.60, 1.09], [1.41, 0.91, 0.61, 1.10], [1.74, 0.83, 0.63, 1.08],
    ],
  },
};

export function makeVehicle(id) {
  if (id === 'wagon') return makeCar();

  const spec = VEHICLES[id];
  const design = SHAPES[id];
  const trail = id === 'trail';
  const retro = id === 'retro';
  const root = new THREE.Group();
  const body = new THREE.Group();
  const finish = new THREE.MeshPhysicalMaterial({
    color: design.color, roughness: trail ? 0.53 : 0.26, metalness: trail ? 0.12 : 0.42,
    clearcoat: trail ? 0.38 : 1, clearcoatRoughness: 0.19,
  });
  const brakeLamp = tail.clone();
  root.add(body);
  body.add(bodyShell(design.sections, finish, spec));

  const { cabinWidth: w, glassFront, glassRear, roofFront, roofRear, sill, roof } = design;
  const topWidth = w * (trail ? 0.95 : 0.82);
  const corner = (x, y, z) => new THREE.Vector3(x, y, z);
  const fl = corner(-w, sill, glassFront);
  const fr = corner(w, sill, glassFront);
  const bl = corner(-w, sill, glassRear);
  const br = corner(w, sill, glassRear);
  const tfl = corner(-topWidth, roof, roofFront);
  const tfr = corner(topWidth, roof, roofFront);
  const tbl = corner(-topWidth, roof, roofRear);
  const tbr = corner(topWidth, roof, roofRear);
  windowPanel(body, [fl, tfl, tfr, fr], corner(0, 0, -1), finish);
  windowPanel(body, [br, tbr, tbl, bl], corner(0, 0, 1), finish);
  windowPanel(body, [bl, tbl, tfl, fl], corner(-1, 0, 0), finish, trail);
  windowPanel(body, [fr, tfr, tbr, br], corner(1, 0, 0), finish, trail);
  box(body, trail ? gasket : finish, [topWidth * 2.03, 0.075, roofRear - roofFront + 0.05], [0, roof, (roofFront + roofRear) * 0.5], 0.034);

  const back = design.sections.at(-1);
  const front = design.sections[0];
  box(body, gasket, [spec.width * 0.94, trail ? 0.16 : 0.065, 0.20], [0, back[2] + 0.04, back[0] - 0.015], 0.029);
  box(body, gasket, [spec.width * 0.93, trail ? 0.14 : 0.048, 0.16], [0, front[2] + 0.045, front[0] + 0.018], 0.023);
  box(body, plate, [0.30, 0.080, 0.018], [trail ? -0.55 : 0, back[2] + 0.18, back[0] + 0.019], 0.006);
  const wheelWidth = trail ? 0.294 : 0.252;
  const wheels = wheelParts(spec.radius, wheelWidth, id);
  const lens = new THREE.CylinderGeometry(0.071, 0.071, 0.036, 18).rotateX(Math.PI / 2);
  const lensRecess = new THREE.CylinderGeometry(0.084, 0.084, 0.023, 20).rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    box(body, finish, [0.19, 0.081, 0.20], [side * w * 1.25, sill + 0.13, glassFront + 0.47], 0.019);
    box(body, lamp, [trail ? 0.27 : 0.37, trail ? 0.20 : 0.044, 0.046],
      [side * spec.width * 0.31, front[3] - 0.05, front[0] - 0.026], 0.012);
    box(body, gasket, [0.054, trail ? 0.066 : 0.030, 1.07], [side * spec.width * 0.50, trail ? 0.69 : 0.37, -0.04], 0.013);
    box(body, trail ? alloy : gasket, [0.026, 0.026, 0.18], [side * spec.width * 0.50, sill - 0.063, 0.35], 0.008);
    if (retro) {
      for (const offset of [0, 0.16]) {
        const light = new THREE.Mesh(lens, brakeLamp);
        const bezel = new THREE.Mesh(lensRecess, taillightHousing);
        bezel.position.set(side * (0.52 + offset), 0.58, back[0] + 0.009);
        light.position.copy(bezel.position);
        light.position.z += 0.013;
        body.add(bezel, light);
      }
      box(body, finish, [0.10, 0.23, 0.12], [side * 0.66, 0.82, 1.98], 0.02);
      box(body, gasket, [0.39, 0.022, 0.036], [side * 0.51, 0.468, back[0] + 0.026], 0.006);
    } else {
      box(body, taillightHousing, [trail ? 0.142 : 0.68, trail ? 0.222 : 0.083, 0.048],
        [side * (trail ? 0.69 : 0.55), back[3] - 0.09, back[0] + 0.013], 0.015);
      box(body, brakeLamp, [trail ? 0.118 : 0.62, trail ? 0.182 : 0.036, 0.036],
        [side * (trail ? 0.69 : 0.55), back[3] - 0.09, back[0] + 0.039], 0.010);
      if (trail) box(body, reversingLight, [0.101, 0.025, 0.026], [side * 0.69, 0.925, back[0] + 0.054], 0.004);
    }
    if (id === 'hyper') {
      box(body, gasket, [0.24, 0.066, 0.75], [side * 0.80, 0.715, 1.32], 0.022);
      for (let vent = 0; vent < 4; vent++) {
        box(body, trim, [0.224, 0.019, 0.039], [side * 0.80, 0.748, 1.10 + vent * 0.135], 0.006);
      }
      box(body, gasket, [0.045, 0.10, 0.43], [side * 0.955, 0.47, 0.53], 0.016);
      exhaust(body, side * 0.62, 0.46, back[0] + 0.064, 0.053);
    }
  }
  if (retro) {
    box(body, finish, [1.73, 0.062, 0.33], [0, 0.95, 1.99], 0.025);
    exhaust(body, -0.63, 0.335, back[0] + 0.053, 0.064);
  }
  if (id === 'hyper') {
    box(body, gasket, [1.39, 0.083, 0.143], [0, 0.34, back[0] + 0.055], 0.023);
    for (const x of [-0.51, -0.27, 0.27, 0.51]) {
      box(body, trim, [0.028, 0.061, 0.23], [x, 0.315, back[0] + 0.049], 0.007);
    }
  }
  if (trail) {
    const spare = new THREE.Group();
    for (const [geometry, material] of wheels) spare.add(new THREE.Mesh(geometry, material));
    spare.rotation.y = Math.PI / 2;
    spare.position.set(0.11, 1.10, 1.87);
    spare.scale.setScalar(0.91);
    body.add(spare);
    for (const side of [-1, 1]) {
      box(body, gasket, [0.056, 0.066, 1.49], [side * 0.64, 1.997, 0.24], 0.022);
      box(body, trim, [0.11, 0.12, 0.076], [side * 0.66, 0.52, 1.80], 0.014);
    }
    for (const z of [-0.24, 0.52]) box(body, trim, [1.33, 0.040, 0.079], [0, 2.022, z], 0.013);
    exhaust(body, -0.52, 0.50, back[0] + 0.034, 0.053);
  }

  const tires = [];
  const arch = new THREE.TorusGeometry(spec.radius * 1.04, trail ? 0.061 : 0.028, 6, 22, Math.PI).rotateY(Math.PI / 2);
  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) {
      const x = side * spec.width * (trail ? 0.49 : 0.465);
      const z = axle * spec.wheelbase * 0.5;
      const wheelArch = new THREE.Mesh(arch, trail ? gasket : finish);
      wheelArch.position.set(side * spec.width * 0.49, spec.radius + 0.053, z);
      body.add(wheelArch);
      addWheel(wheels, [x, spec.radius, z], tires, root, axle === -1);
    }
  }
  return finishModel(root, tires, brakeLamp, trail ? 3.7 : 3.6, trail ? 5.5 : 6);
}
