import * as THREE from 'three/webgpu';
import { randomFor } from './route.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import {
  attribute, cameraPosition, color, dot, float, fog, mix, normalViewGeometry, normalWorldGeometry, positionView, positionWorld, reflector,
  screenUV, smoothstep, texture, uniform, vec2, vec3, vertexColor,
} from 'three/tsl';

export const SUN = new THREE.Vector3(-0.84, 0.48, 0.23).normalize();

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
  const extinction = distance.mul(float(0.00023).add(lowAir.mul(0.00084)));
  const aerial = extinction.negate().exp().oneMinus();
  const cover = smoothstep(far.mul(0.57), far, distance).mul(0.94);
  const glow = dot(ray.normalize(), vec3(SUN.x, SUN.y, SUN.z)).max(0).pow(7);
  const highAir = mix(color('#a9c1cb'), color('#829cb6'), smoothstep(-0.08, 0.29, ray.normalize().y));
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
  sky.renderOrder = -100;
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
export function makeTerrainMaterial(low=false) {
  const material=new THREE.MeshStandardNodeMaterial();
  const p=positionWorld, nWorld=normalWorldGeometry.normalize();
  const projection=vec2(p.x.add(p.z.mul(.31)),p.z.sub(p.x.mul(.24)).add(p.y.mul(.74)));
  const field=texture(mineralNoise,projection.mul(.0062)).toVar();
  const grain=texture(mineralNoise,vec2(p.z.add(p.y.mul(.71)),p.x.sub(p.y.mul(.34))).mul(.155)).toVar();
  const meadow=mix(color('#476638'),color('#aba665'),field.r.mul(.52).add(field.g.mul(.36),field.b.mul(.12)));
  const mineral=field.b.mul(.47).add(field.g.mul(.30),grain.g.mul(.23));
  const bedding=p.y.mul(.40).add(p.x.mul(.073),p.z.mul(.095),field.g.mul(6)).sin().mul(.09).add(.95);
  const stone=mix(color('#4a5355'),color('#acaaa0'),mineral).mul(bedding);
  const exposed=smoothstep(.38,.82,nWorld.y).oneMinus().max(smoothstep(97,190,p.y.add(field.r.mul(40))));
  const snow=smoothstep(186,239,p.y.add(field.r.mul(52),field.b.mul(27))).mul(smoothstep(.34,.84,nWorld.y));
  const coarse=mix(mix(meadow,stone,exposed),mix(color('#a9bac7'),color('#f1f4ef'),field.b),snow);
  const grit=grain.a.mul(.26).add(grain.b.mul(.23),.76);
  material.colorNode=mix(vertexColor().rgb,coarse,.74).mul(grit);
  material.roughnessNode=mix(.94,.74,snow);
  if(low) return material;
  const zoom=p.sub(cameraPosition).length();
  const relief=grain.b.mul(.050).add(grain.a.mul(.017),grain.g.mul(exposed).mul(.16),field.b.mul(exposed).mul(.63))
    .mul(smoothstep(40,260,zoom).oneMinus()).toVar();
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
