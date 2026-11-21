import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import {
  attribute, cameraPosition, color, dot, float, fog, mix, normalViewGeometry, normalWorldGeometry, positionView, positionWorld, reflector,
  screenUV, smoothstep, texture, triplanarTexture, uniform, vec2, vec3, vertexColor,
} from 'three/tsl';

export const SUN = new THREE.Vector3(-0.35, 0.28, -0.89).normalize();

export function atmosphere(scene) {
  const far = uniform(1400);
  const ray = positionWorld.sub(cameraPosition);
  const distance = ray.length();
  const first = cameraPosition.y.max(0);
  const last = positionWorld.y.max(0);
  const lower = first.min(last);
  const heightDelta = first.sub(last).abs().mul(0.022);
  const lowAir = lower.mul(-0.022).exp()
    .mul(heightDelta.lessThan(0.001).select(1, heightDelta.negate().exp().oneMinus().div(heightDelta.max(0.001))));
  const extinction = distance.mul(float(0.00031).add(lowAir.mul(0.00106)));
  const aerial = extinction.negate().exp().oneMinus();
  const cover = smoothstep(far.mul(0.57), far, distance).mul(0.94);
  const glow = dot(ray.normalize(), vec3(SUN.x, SUN.y, SUN.z)).max(0).pow(7);
  const haze = mix(color('#9cb7ca'), color('#edc397'), glow.mul(0.84));
  scene.fogNode = fog(haze, aerial.max(cover));
  return far;
}

export function makeSky() {
  const sky = new SkyMesh();
  sky.scale.setScalar(2500);
  sky.sunPosition.value.copy(SUN).multiplyScalar(8000);
  sky.turbidity.value = 2.7;
  sky.rayleigh.value = 1.55;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.83;
  sky.cloudCoverage.value = 0.43;
  sky.cloudDensity.value = 0.61;
  sky.cloudScale.value = 0.00059;
  sky.cloudElevation.value = 0.31;
  sky.cloudSpeed.value = 0.000012;
  sky.material.fog = false;
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}

export function skyEnvironment() {
  const width = 128;
  const height = 64;
  const data = new Uint16Array(width * height * 4);
  const high = new THREE.Color('#9fbadb');
  const horizon = new THREE.Color('#f2dac1');
  const earth = new THREE.Color('#4b6457');
  const light = new THREE.Color('#fff1cc');
  const direction = new THREE.Vector3();
  const sample = new THREE.Color();
  for (let row = 0; row < height; row++) {
    const latitude = (row + 0.5) * Math.PI / height;
    for (let col = 0; col < width; col++) {
      const longitude = ((col + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(Math.sin(latitude) * Math.cos(longitude), -Math.cos(latitude), Math.sin(latitude) * Math.sin(longitude));
      const y = direction.y;
      sample.copy(horizon).lerp(y > 0 ? high : earth, Math.min(1, Math.abs(y) * (y > 0 ? 1.3 : 3.8)));
      const glow = Math.max(0, SUN.dot(direction)) ** 78 * 2.4;
      sample.r += light.r * glow;
      sample.g += light.g * glow;
      sample.b += light.b * glow;
      const i = (row * width + col) * 4;
      data[i] = THREE.DataUtils.toHalfFloat(sample.r);
      data[i + 1] = THREE.DataUtils.toHalfFloat(sample.g);
      data[i + 2] = THREE.DataUtils.toHalfFloat(sample.b);
      data[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  map.mapping = THREE.EquirectangularReflectionMapping;
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

export function makeWater() {
  const clock = uniform(0);
  const anchor = new THREE.Object3D();
  anchor.rotation.x = -Math.PI / 2;
  const planar = reflector({ target: anchor, resolutionScale: 0.50, bounces: false, samples: 0 });
  const p = positionWorld.xz;
  const view = cameraPosition.sub(positionWorld).normalize();
  const distance = cameraPosition.sub(positionWorld).length();
  const wave1 = dot(p, vec2(0.49, 0.82)).add(clock.mul(1.1));
  const wave2 = dot(p, vec2(-1.38, 0.65)).sub(clock.mul(1.73));
  const wind = dot(p, vec2(0.034, 0.073)).sub(clock.mul(0.16)).sin();
  const wave3 = dot(p, vec2(2.11, -1.72)).add(clock.mul(2.41)).add(wind.mul(4.1));
  const wave4 = dot(p, vec2(4.42, 1.65)).add(clock.mul(3.1)).add(wind.mul(2.6));
  const wave5 = dot(p, vec2(-0.15, 0.48)).sub(clock.mul(0.82));
  const waveFalloff = smoothstep(28, 390, distance).oneMinus();
  const ripple = vec2(wave1.cos().mul(0.026).add(wave2.sin().mul(0.024), wave4.sin().mul(0.022), wave5.sin().mul(0.017)),
    wave2.cos().mul(0.027).add(wave3.sin().mul(0.025), wave4.cos().mul(0.026), wave5.cos().mul(0.020)))
    .mul(waveFalloff.mul(0.83).add(0.17)).toVar();
  const waterNormal = vec3(ripple.x, 1, ripple.y).normalize();
  const fresnel = dot(waterNormal, view).clamp(0, 1).oneMinus().pow(5).mul(0.97).add(0.025);
  const bank = attribute('shore', 'float');
  const shallows = smoothstep(1.2, 21, bank).oneMinus().mul(smoothstep(-2, 1, bank));
  const lakeColor = mix(color('#23494b'), color('#64a49c'), shallows.mul(0.81));
  const surfaceScatter = wave1.sin().mul(0.56).add(wave2.sin().mul(0.23)).mul(waveFalloff).mul(0.025);
  const sunlight = vec3(SUN.x, SUN.y, SUN.z);
  const glint = dot(waterNormal, sunlight.add(view).normalize()).max(0).pow(190).mul(1.12);
  const skyTint = mix(color('#759fae'), color('#e5cbb0'), dot(view.negate(), sunlight).max(0).pow(6));
  const distortion = vec2(ripple.x, ripple.y).mul(0.135).mul(smoothstep(0, 6, bank));
  const reflected = planar.sample(screenUV.flipX().add(distortion).clamp(0.004, 0.996)).rgb;
  const path = reflected.mul(color('#d7eeee')).add(skyTint.mul(0.075));
  const foam = wave1.sin().mul(0.65).add(wave2.sin().mul(0.35));
  const foamEdge = smoothstep(1.1, 3.6, bank.sub(foam)).oneMinus().mul(smoothstep(0, 1, bank)).mul(0.24);

  const material = new THREE.MeshBasicNodeMaterial();
  const lowMaterial = new THREE.MeshBasicNodeMaterial();
  for (const [surface, reflection] of [[material, path], [lowMaterial, skyTint]]) {
    surface.colorNode = mix(lakeColor, reflection, fresnel.mul(0.89))
      .add(surfaceScatter).add(color('#ffce92').mul(glint).mul(1.28)).add(color('#b9afa0').mul(foamEdge));
  }

  return { anchor, clock, material, lowMaterial };
}

export function makeTerrainMaterial(assets) {
  const material = new THREE.MeshStandardNodeMaterial();
  const normal = normalWorldGeometry.normalize().toVar();
  const rockFace = smoothstep(0.36, 0.83, normal.y).oneMinus();
  const slope = rockFace.max(smoothstep(67, 151, positionWorld.y)).toVar();
  const zoom = positionWorld.sub(cameraPosition).length();
  const rockPos = vec3(positionWorld.x.add(positionWorld.y.mul(0.28)), positionWorld.y, positionWorld.z);
  const rock = map => triplanarTexture(texture(map), null, null, float(0.15), rockPos, normal);
  const floorUV = positionWorld.xz.mul(0.26);
  const treeFloor = texture(assets.floor, floorUV).rgb.toVar();
  const cliff = rock(assets.cliff).rgb.toVar();
  const floorColor = treeFloor.mul(color('#d2e4c3')).mul(1.1);
  const cliffColor = cliff.mul(color('#d2e1e8')).mul(1.68);
  const drift = smoothstep(172, 254, positionWorld.y.add(cliff.r.mul(56))).mul(rockFace.mul(0.88).oneMinus()).toVar();
  const snow = texture(assets.snow, positionWorld.xz.mul(0.12)).rgb.mul(color('#cfdfef'));
  const near = mix(mix(floorColor, cliffColor, slope), snow, drift);
  const macro = vertexColor().rgb;
  const detail = smoothstep(33, 650, zoom).oneMinus().mul(0.53).add(0.18);
  material.colorNode = mix(macro, near, detail);
  material.roughnessNode = mix(0.91, 0.74, drift);

  const relief = mix(texture(assets.floorRelief, floorUV).r.mul(0.095), rock(assets.cliffRelief).r.mul(0.28), slope)
    .mul(smoothstep(25, 190, zoom).oneMinus()).mul(drift.mul(0.76).oneMinus()).toVar();
  const n = normalViewGeometry.normalize();
  const dx = positionView.dFdx();
  const dy = positionView.dFdy();
  const across = dy.cross(n);
  const along = n.cross(dx);
  const determinant = dot(dx, across);
  // Surface-gradient bump mapping keeps the relief oriented across all three projections.
  const gradient = across.mul(relief.dFdx()).add(along.mul(relief.dFdy())).mul(determinant.sign());
  material.normalNode = n.mul(determinant.abs().max(0.0000001)).sub(gradient).normalize();
  return material;
}
