import * as THREE from 'three/webgpu';
import { uv, vec3, smoothstep } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { VEHICLES } from './vehicles.js';

const paint = new THREE.MeshPhysicalMaterial({ color: '#d48932', roughness: 0.29, metalness: 0.37, clearcoat: 1, clearcoatRoughness: 0.16 });
const glass = new THREE.MeshPhysicalMaterial({ color: '#13262a', roughness: 0.14, metalness: 0.38, clearcoat: 1, clearcoatRoughness: 0.13, side: THREE.DoubleSide });
const rubber = new THREE.MeshStandardMaterial({ color: '#222724', roughness: 0.94 });
const trim = new THREE.MeshStandardMaterial({ color: '#404642', roughness: 0.6 });
const alloy = new THREE.MeshStandardMaterial({ color: '#b7bcb1', roughness: 0.48, metalness: 0.4 });
const tail = new THREE.MeshStandardMaterial({ color: '#a33222', emissive: '#4e160e', emissiveIntensity: 0.36 });
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

function bodyShell(sections = [
    [-2.095, 0.78, 0.55, 0.73], [-1.87, 0.90, 0.44, 0.82], [-1.36, 0.94, 0.41, 0.88],
    [-0.62, 0.945, 0.40, 0.92], [1.12, 0.945, 0.41, 0.91],
    [1.85, 0.91, 0.45, 0.88], [2.12, 0.83, 0.50, 0.85],
  ], material = paint) {
  const positions = [];
  const indices = [];
  for (const [z, x, bottom, top] of sections) {
    positions.push(
      -x + 0.10, bottom, z, -x, bottom + 0.08, z, -x, top - 0.10, z, -x + 0.11, top, z,
      x - 0.11, top, z, x, top - 0.10, z, x, bottom + 0.08, z, x - 0.10, bottom, z,
    );
  }
  for (let row = 1; row < sections.length; row++) {
    for (let i = 0; i < 8; i++) {
      const a = (row - 1) * 8 + i;
      const b = (row - 1) * 8 + (i + 1) % 8;
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
  }
  const last = (sections.length - 1) * 8;
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

function windowPanel(parent, corners, normal, frame = paint) {
  const center = new THREE.Vector3();
  corners.forEach(corner => center.add(corner));
  center.multiplyScalar(0.25);
  quad(parent, corners, frame);
  const inset = corners.map(corner => corner.clone().lerp(center, 0.12).addScaledVector(normal, 0.012));
  quad(parent, inset, glass);
}

export function makeCar() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(bodyShell());
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
  windowPanel(body, [brl, trl, tfl, bfl], point(-1, 0, 0));
  windowPanel(body, [bfr, tfr, trr, brr], point(1, 0, 0));

  const rearWiper = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.49, 8), gasket);
  rearWiper.position.set(0.16, 1.015, 1.476);
  rearWiper.rotation.z = 1.37;
  body.add(rearWiper);

  const tires = [];
  const wheelArch = new THREE.TorusGeometry(0.365, 0.029, 6, 22, Math.PI).rotateY(Math.PI / 2);
  const tireGeometry = new THREE.CylinderGeometry(0.345, 0.345, 0.24, 16).rotateZ(Math.PI / 2);
  const rimGeometry = new THREE.CylinderGeometry(0.206, 0.206, 0.253, 12).rotateZ(Math.PI / 2);
  for (const side of [-1, 1]) {
    box(body, taillightHousing, [0.25, 0.225, 0.10], [side * 0.70, 0.741, 2.101], 0.025);
    box(body, tail, [0.227, 0.088, 0.049], [side * 0.70, 0.784, 2.156], 0.015);
    box(body, marker, [0.213, 0.034, 0.025], [side * 0.70, 0.720, 2.157], 0.007);
    box(body, reversingLight, [0.212, 0.034, 0.022], [side * 0.70, 0.676, 2.153], 0.006);
    box(body, gasket, [0.032, 0.065, 2.89], [side * 0.939, 0.61, 0.03], 0.013);
    box(body, alloy, [0.031, 0.028, 0.19], [side * 0.932, 0.844, 0.065], 0.009);
    box(body, alloy, [0.031, 0.028, 0.19], [side * 0.932, 0.844, 0.97], 0.009);
    box(body, lamp, [0.34, 0.13, 0.075], [side * 0.65, 0.74, -2.04], 0.025);
    box(body, trim, [0.19, 0.092, 0.21], [side * 0.94, 1.02, -0.62], 0.027);
    for (const axle of [-1, 1]) {
      const arch = new THREE.Mesh(wheelArch, gasket);
      arch.position.set(side * 0.94, 0.39, axle * 1.29);
      body.add(arch);
      const pivot = new THREE.Group();
      const wheel = new THREE.Group();
      pivot.position.set(side * 0.91, 0.347, axle * 1.29);
      pivot.add(wheel);
      wheel.add(new THREE.Mesh(tireGeometry, rubber), new THREE.Mesh(rimGeometry, alloy));
      box(wheel, trim, [0.258, 0.057, 0.31], [0, 0, 0], 0.011);
      box(wheel, trim, [0.258, 0.31, 0.057], [0, 0, 0], 0.011);
      root.add(pivot);
      tires.push({ pivot, wheel, front: axle === -1 });
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
  return { root, tires, brake: active => { brakeLamp.emissiveIntensity = active ? 2.35 : 0.38; } };
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
  body.add(bodyShell(design.sections, finish));

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
  windowPanel(body, [bl, tbl, tfl, fl], corner(-1, 0, 0), finish);
  windowPanel(body, [fr, tfr, tbr, br], corner(1, 0, 0), finish);
  box(body, trail ? gasket : finish, [topWidth * 2.03, 0.075, roofRear - roofFront + 0.05], [0, roof, (roofFront + roofRear) * 0.5], 0.034);

  const back = design.sections.at(-1);
  const front = design.sections[0];
  box(body, gasket, [spec.width * 0.94, trail ? 0.16 : 0.065, 0.20], [0, back[2] + 0.04, back[0] - 0.015], 0.029);
  box(body, gasket, [spec.width * 0.93, trail ? 0.14 : 0.048, 0.16], [0, front[2] + 0.045, front[0] + 0.018], 0.023);
  box(body, plate, [0.30, 0.080, 0.018], [trail ? -0.55 : 0, back[2] + 0.18, back[0] + 0.019], 0.006);
  const lens = new THREE.CylinderGeometry(0.071, 0.071, 0.036, 18).rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    box(body, finish, [0.19, 0.081, 0.20], [side * w * 1.25, sill + 0.13, glassFront + 0.47], 0.019);
    box(body, lamp, [trail ? 0.27 : 0.37, trail ? 0.20 : 0.044, 0.046],
      [side * spec.width * 0.31, front[3] - 0.05, front[0] - 0.026], 0.012);
    if (retro) {
      for (const offset of [0, 0.16]) {
        const light = new THREE.Mesh(lens, brakeLamp);
        light.position.set(side * (0.52 + offset), 0.58, back[0] + 0.020);
        body.add(light);
      }
      box(body, finish, [0.10, 0.23, 0.12], [side * 0.66, 0.82, 1.98], 0.02);
    } else {
      box(body, brakeLamp, [trail ? 0.118 : 0.62, trail ? 0.182 : 0.036, 0.036],
        [side * (trail ? 0.69 : 0.55), back[3] - 0.09, back[0] + 0.024], 0.010);
    }
    if (id === 'hyper') {
      box(body, gasket, [0.19, 0.065, 0.83], [side * 0.82, 0.683, 1.06], 0.024);
      box(body, gasket, [0.032, 0.083, 0.28], [side * 0.952, 0.42, 0.56], 0.016);
    }
  }
  if (retro) box(body, finish, [1.73, 0.062, 0.33], [0, 0.95, 1.99], 0.025);
  if (trail) {
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.382, 0.382, 0.23, 28).rotateX(Math.PI / 2), rubber);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.243, 18).rotateX(Math.PI / 2), alloy);
    spare.position.set(0.15, 1.06, 1.86);
    hub.position.copy(spare.position);
    body.add(spare, hub);
    for (const side of [-1, 1]) box(body, gasket, [0.056, 0.066, 1.49], [side * 0.64, 2.005, 0.24], 0.022);
  }

  const tires = [];
  const tireWidth = trail ? 0.28 : 0.26;
  const wheelGeometry = new THREE.CylinderGeometry(spec.radius, spec.radius, tireWidth, 24).rotateZ(Math.PI / 2);
  const rimGeometry = new THREE.CylinderGeometry(spec.radius * 0.62, spec.radius * 0.62, tireWidth + 0.012, 16).rotateZ(Math.PI / 2);
  const arch = new THREE.TorusGeometry(spec.radius * 1.04, trail ? 0.061 : 0.028, 6, 22, Math.PI).rotateY(Math.PI / 2);
  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) {
      const x = side * spec.width * (trail ? 0.52 : 0.49);
      const z = axle * spec.wheelbase * 0.5;
      const wheelArch = new THREE.Mesh(arch, trail ? gasket : finish);
      wheelArch.position.set(x, spec.radius + 0.035, z);
      body.add(wheelArch);
      const pivot = new THREE.Group();
      pivot.position.set(x, spec.radius, z);
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(wheelGeometry, rubber), new THREE.Mesh(rimGeometry, alloy));
      box(wheel, trim, [tireWidth + 0.018, spec.radius * 0.12, spec.radius * 1.10], [0, 0, 0], 0.011);
      box(wheel, trim, [tireWidth + 0.018, spec.radius * 1.10, spec.radius * 0.12], [0, 0, 0], 0.011);
      pivot.add(wheel);
      root.add(pivot);
      tires.push({ pivot, wheel, front: axle === -1 });
    }
  }
  return finishModel(root, tires, brakeLamp, trail ? 3.7 : 3.6, trail ? 5.5 : 6);
}
