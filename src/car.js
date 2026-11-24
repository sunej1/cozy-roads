import * as THREE from 'three/webgpu';
import { makePorsche } from './porsche.js';
import { smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import decalSheet from '../assets/vehicles/911-decals.svg';
import panorama from '../assets/vehicles/kloppenheim.jpg';
import wagon from '../assets/vehicles/wagon.glb?url';
import retro from '../assets/vehicles/coupe.glb?url';
import hyper from '../assets/vehicles/hyper.glb?url';
import trail from '../assets/vehicles/offroad.glb?url';

export async function loadVehicles() {
  const loader = new GLTFLoader();
  const urls = { wagon, retro, hyper, trail };
  const [environment, decals, ...cars] = await Promise.all([
    new THREE.TextureLoader().loadAsync(panorama),
    new THREE.TextureLoader().loadAsync(decalSheet),
    ...Object.values(urls).map((url) => loader.loadAsync(url)),
  ]);
  decals.colorSpace = THREE.SRGBColorSpace;
  decals.anisotropy = 4;
  environment.mapping = THREE.EquirectangularReflectionMapping;
  environment.colorSpace = THREE.SRGBColorSpace;
  const garage = new Map(Object.keys(urls).map((id, i) => [id, makeVehicle(cars[i].scene, environment)]));
  garage.set('930', makeVehicle(makePorsche(false, decals), environment));
  garage.set('gt3rs', makeVehicle(makePorsche(true, decals), environment));
  return garage;
}

function makeVehicle(root, environment) {
  const tires = [];
  let brakeLamp;
  for (const wheel of [...root.children]) {
    if (!wheel.name.startsWith('wheel_')) continue;
    const pivot = new THREE.Group();
    pivot.position.copy(wheel.position);
    wheel.position.set(0, 0, 0);
    pivot.add(wheel);
    root.add(pivot);
    tires.push({ pivot, wheel, restY: pivot.position.y, front: wheel.name.startsWith('wheel_f') });
  }
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.material.envMap = environment;
    object.material.envMapIntensity = 1.1;
    object.castShadow = object.receiveShadow = true;
    if (object.material.name === 'RearLamps' || object.material.name === 'Light_Red') brakeLamp = object.material;
  });
  const { x: width, z: length } = new THREE.Box3().setFromObject(root, true).getSize(new THREE.Vector3());
  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const distance = uv().sub(0.5).abs().mul(2);
  shadowMaterial.colorNode = vec3(0.019, 0.025, 0.021);
  const shadowStrength = uniform(0.53);
  shadowMaterial.opacityNode = smoothstep(0.16, 1, distance.x.pow(3).add(distance.y.pow(4)))
    .oneMinus()
    .mul(shadowStrength);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2), shadowMaterial);
  root.rotation.order = 'YXZ';
  return {
    root,
    tires,
    contactShadow: shadow,
    shadowStrength,
    brake: (active) => {
      brakeLamp.emissiveIntensity = active ? 4 : 0.42;
    },
  };
}
