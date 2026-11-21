import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import cliffColor from '../assets/cliff-color.jpg';
import cliffHeight from '../assets/cliff-height.jpg';
import forestColor from '../assets/forest-color.jpg';
import forestHeight from '../assets/forest-height.jpg';
import snowColor from '../assets/snow-color.jpg';
import asphaltColor from '../assets/asphalt-color.jpg';
import asphaltNormal from '../assets/asphalt-normal.jpg';
import asphaltRough from '../assets/asphalt-rough.jpg';
import boulders from '../assets/mossy-boulders.glb?url';

export async function loadLandscapeAssets() {
  const loader = new THREE.TextureLoader();
  async function load(source, srgb = false) {
    const map = await loader.loadAsync(source);
    if (srgb) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    return map;
  }

  const [cliff, cliffRelief, floor, floorRelief, snow, pavement, normal, rough, scans] = await Promise.all([
    load(cliffColor, true), load(cliffHeight), load(forestColor, true), load(forestHeight),
    load(snowColor, true), load(asphaltColor, true), load(asphaltNormal), load(asphaltRough),
    new GLTFLoader().loadAsync(boulders),
  ]);
  const rocks = [];
  scans.scene.traverse(object => {
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
  return { cliff, cliffRelief, floor, floorRelief, snow, pavement, normal, rough, rocks };
}
