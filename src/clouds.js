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
import { randomFor } from './route.js';

function cloudNoise() {
  const size = 64,
    cells = 6,
    rng = randomFor(31715);
  const values = Float32Array.from({ length: cells ** 3 * 4 }, () => rng());
  const pixels = new Uint8Array(size ** 3 * 4);
  const wrap = (n) => (n + cells) % cells;
  const point = (x, y, z) => ((wrap(z) * cells + wrap(y)) * cells + wrap(x)) * 4;
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const [px, py, pz] = [x, y, z].map((n) => (n * cells) / size);
        const i = Math.floor(px),
          j = Math.floor(py),
          k = Math.floor(pz);
        let distance = 2,
          broad = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const n = point(i + dx, j + dy, k + dz);
              const ex = i + dx + values[n] - px,
                ey = j + dy + values[n + 1] - py,
                ez = k + dz + values[n + 2] - pz;
              distance = Math.min(distance, ex * ex + ey * ey + ez * ez);
              if (dx < 0 || dy < 0 || dz < 0) continue;
              const weight = (v, side) => {
                const a = v * v * (3 - 2 * v);
                return side ? a : 1 - a;
              };
              broad += values[n + 3] * weight(px - i, dx) * weight(py - j, dy) * weight(pz - k, dz);
            }
        const at = ((z * size + y) * size + x) * 4;
        pixels[at] = Math.round(255 * broad);
        pixels[at + 1] = Math.round(255 * Math.max(0, 1 - Math.sqrt(distance)));
        pixels[at + 3] = 255;
      }
  const map = new THREE.Data3DTexture(pixels, size, size, size);
  map.format = THREE.RGBAFormat;
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.wrapS = map.wrapT = map.wrapR = THREE.RepeatWrapping;
  map.needsUpdate = true;
  return map;
}

export function cloudLayer(sky, sun) {
  const noise = cloudNoise(),
    clock = uniform(0);
  const sunlight = vec3(sun.x, sun.y, sun.z);
  const bottom = 1730,
    top = 2420;
  const density = Fn(([p]) => {
    const advected = p.add(vec3(clock.mul(3.8), 0, clock.mul(1.3)));
    const q = advected.mul(vec3(0.000105, 0.00023, 0.00013)).toVar();
    const a = texture3D(noise, q).level(0);
    const b = texture3D(noise, q.mul(3.36).add(0.37)).level(0);
    const c = texture3D(noise, q.mul(10.7).sub(0.21)).level(0);
    const profile = smoothstep(bottom, bottom + 130, p.y).mul(smoothstep(top - 330, top, p.y).oneMinus());
    return a.r
      .mul(0.84)
      .add(a.g.mul(0.26), b.g.mul(0.18), c.g.mul(0.065), profile.mul(0.28))
      .sub(0.8)
      .max(0)
      .mul(3.4);
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
        const d = density(p).toVar();
        const opacity = d.mul(step).mul(-0.0054).max(-10).exp().oneMinus();
        const upstream = density(p.add(sunlight.mul(135)))
          .mul(0.95)
          .add(density(p.add(sunlight.mul(370))).mul(0.68));
        const direct = upstream.mul(-2.7).exp().mul(0.72).add(0.28);
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
    const optical = density(projected(bottom + 165)).add(
      density(projected(bottom + 340)),
      density(projected(bottom + 515)),
    );
    return optical.mul(-0.76).exp().mul(0.77).add(0.23);
  })();
  return { clock, shadow };
}
