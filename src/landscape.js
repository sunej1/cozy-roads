import * as THREE from 'three/webgpu';
import { RELIEF_SIZE } from './highlands.js';
import { randomFor } from './route.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import {
  attribute, cameraPosition, color, dot, float, fog, mix, normalViewGeometry, normalWorldGeometry, positionView, positionWorld, reflector,
  screenUV, smoothstep, texture, uniform, vec2, vec3,
} from 'three/tsl';

export const SUN = new THREE.Vector3(-0.84, 0.48, 0.23).normalize();

export function atmosphere(scene) {
  const far = uniform(7600);
  const ray = positionWorld.sub(cameraPosition);
  const distance = ray.length();
  const first = cameraPosition.y.max(0);
  const last = positionWorld.y.max(0);
  const lower = first.min(last);
  const heightDelta = first.sub(last).abs().mul(0.022);
  const lowAir = lower.mul(-0.022).exp()
    .mul(heightDelta.lessThan(0.001).select(1, heightDelta.negate().exp().oneMinus().div(heightDelta.max(0.001))));
  const extinction = distance.mul(float(0.000105).add(lowAir.mul(0.00042)));
  const aerial = extinction.negate().exp().oneMinus();
  const cover = smoothstep(far.mul(0.78), far, distance);
  const glow = dot(ray.normalize(), vec3(SUN.x, SUN.y, SUN.z)).max(0).pow(7);
  const highAir = mix(color('#6687ac'), color('#b6cbd6'), smoothstep(800, 7400, distance));
  const haze = mix(highAir, color('#f1d6ad'), glow.mul(0.74));
  scene.fogNode = fog(haze, aerial.max(cover));
  return far;
}

export function makeSky() {
  const sky = new SkyMesh();
  sky.scale.setScalar(2500);
  sky.sunPosition.value.copy(SUN).multiplyScalar(8000);
  sky.turbidity.value = 2.2;
  sky.rayleigh.value = 1.85;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.83;
  sky.cloudCoverage.value = 0.54;
  sky.cloudDensity.value = 0.79;
  sky.cloudScale.value = 0.00083;
  sky.cloudElevation.value = 0.31;
  sky.cloudSpeed.value = 0.000012;
  sky.material.fog = false;
  sky.frustumCulled = false;
  sky.renderOrder = 100;
  return sky;
}

export function skyEnvironment() {
  const width = 128;
  const height = 64;
  const data = new Uint16Array(width * height * 4);
  const high = new THREE.Color('#a2c9f4');
  const horizon = new THREE.Color('#e4eced');
  const earth = new THREE.Color('#384235');
  const light = new THREE.Color('#fff1d2');
  const direction = new THREE.Vector3();
  const sample = new THREE.Color();
  for (let row = 0; row < height; row++) {
    const latitude = (row + 0.5) * Math.PI / height;
    for (let col = 0; col < width; col++) {
      const longitude = ((col + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(Math.sin(latitude) * Math.cos(longitude), -Math.cos(latitude), Math.sin(latitude) * Math.sin(longitude));
      const y = direction.y;
      sample.copy(horizon).lerp(y > 0 ? high : earth, Math.min(1, Math.abs(y) * (y > 0 ? 1.3 : 3.8)));
      const facing = Math.max(0, SUN.dot(direction));
      const sunGlow = facing ** 24 * 0.40 + facing ** 145 * 4.8;
      const cloud = Math.max(0, Math.sin(longitude * 3 + y * 12) * Math.sin(longitude * 7 - y * 24) - 0.05)
        * Math.max(0, 1 - Math.abs(y - 0.30) * 3.5) * 0.46;
      sample.lerp(light, cloud);
      sample.r += light.r * sunGlow;
      sample.g += light.g * sunGlow;
      sample.b += light.b * sunGlow;
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
  const bankRipples = wave3.add(wave2.sin().mul(0.52)).sin().mul(0.5).add(0.5);
  const shoal = mix(color('#468c86'), color('#9bc5a8'), bankRipples.mul(0.37));
  const lakeColor = mix(color('#153d49'), shoal, shallows.mul(0.90));
  const surfaceScatter = wave1.sin().mul(0.56).add(wave2.sin().mul(0.23)).mul(waveFalloff).mul(0.025);
  const sunlight = vec3(SUN.x, SUN.y, SUN.z);
  const glint = dot(waterNormal, sunlight.add(view).normalize()).max(0).pow(190).mul(1.12);
  const skyTint = mix(color('#759fae'), color('#e5cbb0'), dot(view.negate(), sunlight).max(0).pow(6));
  const distortion = vec2(ripple.x, ripple.y).mul(0.135).mul(smoothstep(0, 6, bank));
  const reflected = planar.sample(screenUV.flipX().add(distortion).clamp(0.004, 0.996)).rgb;
  const path = reflected.mul(color('#d7eeee')).add(skyTint.mul(0.075));
  const waveFront = bank.mul(3.5).add(wave1.sin().mul(0.69)).sub(clock.mul(2.7)).cos().max(0).pow(9);
  const foamEdge = smoothstep(1.1, 3.5, bank).oneMinus().mul(smoothstep(0, 0.5, bank)).mul(waveFront).mul(0.30);

  const material = new THREE.MeshBasicNodeMaterial();
  const lowMaterial = new THREE.MeshBasicNodeMaterial();
  for (const [surface, reflection] of [[material, path], [lowMaterial, skyTint]]) {
    surface.colorNode = mix(lakeColor, reflection, fresnel.mul(0.89))
      .add(surfaceScatter).add(color('#ffce92').mul(glint).mul(1.28)).add(color('#b9afa0').mul(foamEdge));
  }

  return { anchor, clock, material, lowMaterial };
}

// Four seamless, band-limited noise fields. Hardware mipmaps filter the grain
// at distance, and world-space projections carry continuously across terrain rows.
function groundNoise() {
  const size=256, pixels=new Uint8Array(size*size*4), random=randomFor(92048);
  for(const [channel,frequency] of [5,17,43,128].entries()) {
    const values=Float32Array.from({length:frequency*frequency},()=>random());
    const value=(x,y)=>values[(y%frequency)*frequency+(x%frequency)];
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const u=x*frequency/size, v=y*frequency/size, i=Math.floor(u), j=Math.floor(v);
      const a=u-i, b=v-j, fx=a*a*(3-2*a), fy=b*b*(3-2*b);
      const top=THREE.MathUtils.lerp(value(i,j),value(i+1,j),fx);
      const bottom=THREE.MathUtils.lerp(value(i,j+1),value(i+1,j+1),fx);
      pixels[(y*size+x)*4+channel]=Math.round(255*THREE.MathUtils.lerp(top,bottom,fy));
    }
  }
  const map=new THREE.DataTexture(pixels,size,size);
  map.wrapS=map.wrapT=THREE.RepeatWrapping;
  map.generateMipmaps=true;
  map.minFilter=THREE.LinearMipmapLinearFilter;
  map.magFilter=THREE.LinearFilter;
  map.anisotropy=4;
  map.needsUpdate=true;
  return map;
}

const mineralNoise=groundNoise();
export function makeReliefTexture(elevations) {
  // Encode slopes directly. Differentiating a filtered kilometre-high elevation
  // in a fragment shader can turn half-float rounding into visible contour lines.
  const size = RELIEF_SIZE;
  const smooth = new Float32Array(elevations.length);
  const residual = new Float32Array(elevations.length);
  const index = (x, y) => Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -6; k <= 6; k++) sum += elevations[index(x + k, y)] * (7 - Math.abs(k));
      smooth[y * size + x] = sum / (4 * 49);
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -6; k <= 6; k++) sum += smooth[index(x, y + k)] * (7 - Math.abs(k));
      residual[y * size + x] = elevations[y * size + x] * 0.25 - sum / 49;
    }
  const data = new Uint8Array(elevations.length * 4);
  const encode = (value, range) => Math.round(255 * THREE.MathUtils.clamp(0.5 + value / (2 * range), 0, 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = encode((residual[index(x + 1, y)] - residual[index(x - 1, y)]) * 0.5, 40);
      data[i + 1] = encode((residual[index(x, y + 1)] - residual[index(x, y - 1)]) * 0.5, 40);
      data[i + 2] = encode(residual[index(x, y)], 90);
      data[i + 3] = 255;
    }
  const map = new THREE.DataTexture(data, size, size);
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

function surveyDetail(map) {
  const basis = attribute('reliefField', 'vec4');
  const uv = basis.xy;
  const rotated = vec2(uv.y.mul(0.71).sub(uv.x.mul(0.53)).add(279), uv.y.mul(0.53).add(uv.x.mul(0.71)).sub(374));
  function residual(point) {
    const half = RELIEF_SIZE - 1;
    const mirrored = point
      .div(2 * half)
      .fract()
      .mul(2)
      .sub(1)
      .abs()
      .oneMinus()
      .mul(half)
      .toVar();
    const sample = texture(map, mirrored.add(0.5).div(RELIEF_SIZE)).rgb.sub(0.5);
    const slope = sample.rg.mul(80);
    return vec3(dot(slope, mirrored.dFdx()), dot(slope, mirrored.dFdy()), sample.b.mul(180));
  }
  return mix(residual(uv), residual(rotated), basis.z).mul(basis.w, 0.67).toVar();
}

export function makeTerrainMaterial(reliefMap, low = false) {
  const material = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld,
    nWorld = normalWorldGeometry.normalize();
  const axes = nWorld.abs().pow(4);
  const weights = axes.div(axes.x.add(axes.y, axes.z)).toVar();
  function triplanar(scale) {
    return texture(mineralNoise, p.zy.mul(scale))
      .mul(weights.x)
      .add(
        texture(mineralNoise, p.xz.mul(scale)).mul(weights.y),
        texture(mineralNoise, p.xy.mul(scale)).mul(weights.z),
      )
      .toVar();
  }
  const field = triplanar(0.0062),
    grain = triplanar(0.148);
  const zoom = p.sub(cameraPosition).length();
  const macro = texture(mineralNoise, vec2(p.x.add(p.z.mul(0.34)), p.z.sub(p.x.mul(0.26))).mul(0.00074)).toVar();
  const meadow = mix(
    color('#455e36'),
    color('#a0a068'),
    field.r.mul(0.52).add(field.g.mul(0.36), field.b.mul(0.12)),
  );
  const residual = surveyDetail(reliefMap);
  const aspect = dot(nWorld, vec3(0.74, 0, -0.42));
  // Two intersecting joint sets break up folded beds into separate rock faces.
  const warp = field.g.sub(0.5).mul(3.3).add(macro.r.mul(10));
  const bed = p.y.mul(0.25).add(p.x.mul(0.048), p.z.mul(0.083), warp).sin().abs();
  const joint = p.x
    .mul(0.18)
    .sub(p.y.mul(0.075))
    .add(p.z.mul(0.12), field.r.mul(4.4), grain.g.mul(0.5))
    .sin()
    .abs();
  const fissure = smoothstep(0.03, 0.18, bed.min(joint)).oneMinus();
  const strata = mix(
    color('#575c60'),
    color('#9e988b'),
    field.r.mul(0.48).add(field.b.mul(0.25), macro.g.mul(0.27)),
  );
  const stone = strata.mul(fissure.mul(-0.18).add(1), grain.g.mul(0.14).add(0.94));
  const high = p.y.add(macro.r.sub(0.5).mul(110));
  const exposed = smoothstep(0.45, 0.83, nWorld.y)
    .oneMinus()
    .max(smoothstep(170, 420, high));
  const shelter = residual.z.negate().clamp(-40, 40).mul(4.8).add(aspect.mul(80), field.r.sub(0.5).mul(115));
  const snowline = smoothstep(325, 750, high.add(shelter));
  const adhesion = smoothstep(0.38, 0.84, nWorld.y.add(aspect.mul(0.12), field.g.sub(0.5).mul(0.2)));
  const snow = smoothstep(0.27, 0.74, snowline.mul(adhesion));
  const forest = smoothstep(0.28, 0.66, macro.g.mul(0.68).add(field.r.mul(0.32))).mul(
    smoothstep(180, 440, high).oneMinus(),
    smoothstep(0.53, 0.8, nWorld.y),
    smoothstep(90, 540, zoom),
  );
  const canopy = mix(color('#273e38'), color('#566449'), field.b.mul(0.6).add(grain.g.mul(0.4)));
  const drifts = mix(color('#b1c3cf'), color('#faf8ef'), field.g.mul(0.38).add(0.46));
  const coarse = mix(mix(mix(meadow, canopy, forest), stone, exposed), drifts, snow);
  material.colorNode = coarse.mul(grain.a.mul(0.14).add(grain.b.mul(0.12), 0.87));
  material.roughnessNode = mix(0.94, 0.66, snow);
  if (low) return material;
  const near = smoothstep(60, 390, zoom).oneMinus();
  const crag = field.g.mul(0.62).add(field.b.mul(0.4), fissure.mul(-0.33), grain.g.mul(near).mul(0.09));
  const relief = crag.mul(exposed, snow.mul(-0.72).add(1)).add(grain.b.mul(near).mul(0.038)).toVar();
  const n = normalViewGeometry.normalize();
  const dx = positionView.dFdx();
  const dy = positionView.dFdy();
  const across = dy.cross(n);
  const along = n.cross(dx);
  const determinant = dot(dx, across);
  // Surface-gradient bump mapping keeps the relief oriented across all three projections.
  const gradient = across
    .mul(relief.dFdx().add(residual.x.mul(0.73)))
    .add(along.mul(relief.dFdy().add(residual.y.mul(0.73))))
    .mul(determinant.sign());
  material.normalNode = n.mul(determinant.abs().max(0.0000001)).sub(gradient).normalize();
  return material;
}
