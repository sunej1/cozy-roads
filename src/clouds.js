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
  texture3D,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { CLOUD_WIDTH, CLOUD_LAYERS, CLOUD_BOTTOM, CLOUD_TOP, CLOUD_SCALE_X, CLOUD_SCALE_Z } from './cloud-field.js';

export function cloudLayer(sky, sun, field) {
  const noise = new THREE.Data3DTexture(field, CLOUD_WIDTH, CLOUD_LAYERS, CLOUD_WIDTH);
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
  // Integrate the same moving density along the sunlight path onto the world.
  const shadow = Fn(() => {
    const p = positionWorld;
    const projected = (h) => p.add(sunlight.mul(float(h).sub(p.y).div(sun.y)));
    const optical = sampleCloud(projected(bottom + 165)).r.add(
      sampleCloud(projected(bottom + 340)).r,
      sampleCloud(projected(bottom + 515)).r,
    );
    return optical.mul(-1.52).exp().mul(0.77).add(0.23);
  })();
  return { clock, shadow };
}
