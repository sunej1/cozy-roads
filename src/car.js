import * as THREE from 'three/webgpu';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import turbo from '../assets/vehicles/930.glb?url';
import gt3rs from '../assets/vehicles/gt3rs.glb?url';
import panorama from '../assets/vehicles/kloppenheim.jpg';
import wagon from '../assets/vehicles/wagon.glb?url';
import retro from '../assets/vehicles/coupe.glb?url';
import hyper from '../assets/vehicles/hyper.glb?url';
import trail from '../assets/vehicles/offroad.glb?url';

export async function loadVehicles() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const urls = { wagon, retro, hyper, trail, 930: turbo, gt3rs };
  const [environment, ...cars] = await Promise.all([
    new THREE.TextureLoader().loadAsync(panorama),
    ...Object.values(urls).map((url) => loader.loadAsync(url)),
  ]);
  environment.mapping = THREE.EquirectangularReflectionMapping;
  environment.colorSpace = THREE.SRGBColorSpace;
  return new Map(Object.keys(urls).map((id, i) => [id, makeVehicle(cars[i].scene, environment)]));
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
    // The caliper steers and travels with the hub while the rotor spins inside it.
    for (const part of [...wheel.children]) if (part.name.startsWith('caliper')) pivot.add(part);
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
