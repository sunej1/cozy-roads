import * as THREE from 'three/webgpu';
import { smoothstep, uv, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import panorama from '../assets/vehicles/kloppenheim.jpg';
import wagon from '../assets/vehicles/wagon.glb?url';
import retro from '../assets/vehicles/coupe.glb?url';
import hyper from '../assets/vehicles/hyper.glb?url';
import trail from '../assets/vehicles/offroad.glb?url';

export async function loadVehicles() {
  const loader = new GLTFLoader();
  const urls = { wagon, retro, hyper, trail };
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
    root.add(pivot);
    tires.push({ pivot, wheel, front: wheel.name.startsWith('wheel_f') });
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
  shadowMaterial.opacityNode = smoothstep(0.16, 1, distance.x.pow(3).add(distance.y.pow(4)))
    .oneMinus()
    .mul(0.53);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2), shadowMaterial);
  shadow.position.y = 0.045;
  root.add(shadow);
  root.rotation.order = 'YXZ';
  return {
    root,
    tires,
    brake: (active) => {
      brakeLamp.emissiveIntensity = active ? 4 : 0.42;
    },
  };
}
