import { carveBedrock } from './highlands.js';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import meadowClumps from '../assets/meadow-clumps.webp';
import meadowLeaves from '../assets/meadow-leaves.glb?url';
import meadowFloor from '../assets/meadow-floor.webp';
import floweringMeadow from '../assets/meadow-flowers.webp';
import aspenSpray from '../assets/aspen-spray.webp';
import firMap from '../assets/fir-canopy.webp';
import firModel from '../assets/fir-canopy.glb?url';
import rockAndGravel from '../assets/rock-and-gravel.webp';
import asphaltColor from '../assets/asphalt-color.jpg';
import asphaltNormal from '../assets/asphalt-normal.jpg';
import asphaltRough from '../assets/asphalt-rough.jpg';
import boulders from '../assets/mossy-boulders.glb?url';

async function loadField(url, ArrayType, gzip = false) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load ' + url.pathname);
  const body = gzip ? new Response(response.body.pipeThrough(new DecompressionStream('gzip'))) : response;
  return new ArrayType(await body.arrayBuffer());
}

export async function loadLandscapeAssets() {
  const loader = new THREE.TextureLoader();
  async function load(source, srgb = false) {
    const map = await loader.loadAsync(source);
    if (srgb) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    return map;
  }

  const [
    pavement,
    normal,
    rough,
    scans,
    elevations,
    clouds,
    clumps,
    turf,
    canopy,
    fir,
    blades,
    bedrock,
    blossoms,
    spray,
  ] = await Promise.all([
    load(asphaltColor, true),
    load(asphaltNormal),
    load(asphaltRough),
    new GLTFLoader().loadAsync(boulders),
    loadField(new URL('../assets/shuksan.u16', import.meta.url), Uint16Array),
    loadField(new URL('../assets/cloud-field.bin', import.meta.url), Uint8Array, true),
    load(meadowClumps, true),
    load(meadowFloor, true),
    load(firMap, true),
    new GLTFLoader().loadAsync(firModel),
    new GLTFLoader().loadAsync(meadowLeaves),
    load(rockAndGravel),
    load(floweringMeadow, true),
    load(aspenSpray, true),
  ]);
  const rocks = [];
  scans.scene.traverse((object) => {
    if (!object.isMesh || ![0, 2, 5].includes(scans.scene.children.indexOf(object))) return;
    const geometry = object.geometry;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 2 / Math.max(size.x, size.z);
    geometry.translate(-center.x, -bounds.min.y - size.y * 0.19, -center.z);
    geometry.scale(scale, scale, scale);
    for (const map of [object.material.map, object.material.normalMap, object.material.roughnessMap]) {
      if (map) map.anisotropy = 8;
    }
    rocks.push({ geometry, material: object.material });
  });
  return {
    pavement,
    normal,
    rough,
    rocks,
    elevations: carveBedrock(elevations),
    clouds,
    clumps,
    turf,
    canopy,
    bedrock,
    blossoms,
    spray,
    conifer: fir.scene.getObjectByName('Canopy').geometry,
    distantConifer: fir.scene.getObjectByName('Silhouette').geometry,
    leafLevels: ['Meadow', 'MeadowMid', 'MeadowFar'].map((name) => blades.scene.getObjectByName(name).geometry),
  };
}
