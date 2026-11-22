import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  color,
  dot,
  float,
  Fn,
  If,
  Loop,
  mix,
  positionWorld,
  smoothstep,
  texture, texture3D, vec2,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { CLOUD_WIDTH, CLOUD_LAYERS, CLOUD_BOTTOM, CLOUD_TOP, CLOUD_SCALE_X, CLOUD_SCALE_Z } from './cloud-field.js';

export function cloudLayer(sky, sun, field) {
  const length = CLOUD_WIDTH * CLOUD_WIDTH * CLOUD_LAYERS * 2;
  const noise = new THREE.Data3DTexture(field.subarray(0, length), CLOUD_WIDTH, CLOUD_LAYERS, CLOUD_WIDTH);
  noise.format = THREE.RGFormat;
  noise.minFilter = noise.magFilter = THREE.LinearFilter;
  noise.wrapS = noise.wrapR = THREE.RepeatWrapping;
  noise.needsUpdate = true;
  const clock = uniform(0);
  const sunlight = vec3(sun.x, sun.y, sun.z);
  const bottom = CLOUD_BOTTOM,
    top = CLOUD_TOP;
  const sampleCloud = Fn(([p]) => {
    const h = p.y
      .sub(bottom)
      .div(top - bottom)
      .mul((CLOUD_LAYERS - 1) / CLOUD_LAYERS)
      .add(0.5 / CLOUD_LAYERS);
    const uvw = vec3(p.x.add(clock.mul(3.8)).mul(CLOUD_SCALE_X), h, p.z.add(clock.mul(1.3)).mul(CLOUD_SCALE_Z));
    return texture3D(noise, uvw).level(0).rg;
  });
  const original = sky.material.colorNode;
  sky.cloudCoverage.value = 0;
  sky.material.colorNode = Fn(() => {
    const base = original.rgb.toVar();
    const direction = positionWorld.sub(cameraPosition).normalize().toVar();
    const result = base.toVar();
    If(direction.y.greaterThan(0.022), () => {
      const entry = float(bottom).sub(cameraPosition.y).div(direction.y).max(0);
      const exit = float(top).sub(cameraPosition.y).div(direction.y).max(0);
      const step = exit.sub(entry).div(18).toVar();
      const p = cameraPosition.add(direction.mul(entry.add(step.mul(0.5)))).toVar();
      const transmission = float(1).toVar(),
        light = vec3(0).toVar();
      Loop(18, () => {
        const cloud = sampleCloud(p).toVar();
        const d = cloud.r.mul(2);
        const opacity = d.mul(step).mul(-0.0054).max(-10).exp().oneMinus();
        const direct = cloud.g;
        const silver = dot(sunlight, direction).max(0).pow(12).mul(0.72);
        const source = mix(color('#879ab3'), vec3(1.26, 1.2, 1.09), direct).add(silver.mul(direct));
        light.addAssign(source.mul(opacity).mul(transmission));
        transmission.mulAssign(opacity.oneMinus());
        p.addAssign(direction.mul(step));
      });
      result.assign(mix(base, base.mul(transmission).add(light), smoothstep(0.022, 0.13, direction.y).mul(0.9)));
    });
    return vec4(result, 1);
  })();
  const mask = new THREE.DataTexture(field.subarray(length), CLOUD_WIDTH, CLOUD_WIDTH, THREE.RedFormat);
  mask.minFilter = mask.magFilter = THREE.LinearFilter;
  mask.wrapS = mask.wrapT = THREE.RepeatWrapping;
  mask.needsUpdate = true;
  const projected = positionWorld.xz.add(sunlight.xz.mul(float(bottom).sub(positionWorld.y).div(sun.y)));
  const shadow = texture(mask, projected.add(vec2(clock.mul(3.8), clock.mul(1.3))).mul(vec2(CLOUD_SCALE_X, CLOUD_SCALE_Z))).r;
  return { clock, shadow };
}
