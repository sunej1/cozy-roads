import { RenderPipeline } from 'three/webgpu';
import { color, float, mrt, normalView, output, pass, uniform, velocity, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { sss } from 'three/addons/tsl/display/SSSNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';

export function makeCinematic(renderer, scene, camera, sun) {
  const beauty = pass(scene, camera, { samples: 0 });
  // Pack the reflection mask beside the normal so matte terrain skips the ray march.
  const gloss = uniform(0).onObjectUpdate(({ material }) => material.userData.waterReflection
    ?? ((material.metalness || 0) * Math.max(0, 1 - (material.roughness ?? 1))));
  beauty.setMRT(mrt({ output, motion: velocity, normal: vec4(normalView, gloss) }));
  const base = beauty.getTextureNode();
  const depth = beauty.getTextureNode('depth');
  const resolve = taau(base, depth, beauty.getTextureNode('motion'), camera);
  resolve.currentFrameWeight = 0.105;

  const normals = beauty.getTextureNode('normal');
  const reflection = ssr(base, depth, normals, { camera, metalnessNode: normals.a, roughnessNode: float(0.21) });
  reflection.resolutionScale = 0.5;
  reflection.maxDistance.value = 32;
  reflection.thickness.value = 0.18;
  reflection.quality.value = 0.22;
  reflection.intensity.value = 0.55;
  const sunContact = sss(depth, camera, sun);
  sunContact.resolutionScale = 0.5;
  sunContact.maxDistance.value = 0.8;
  sunContact.quality.value = 0.32;
  sunContact.shadowIntensity.value = 0.18;

  const bounce = ssgi(base, depth, normals, camera);
  bounce.resolutionScale = 0.52;
  bounce.sliceCount.value = 2;
  bounce.stepCount.value = 9;
  bounce.radius.value = 3.6;
  bounce.thickness.value = 0.58;
  bounce.giIntensity.value = 4.8;

  const sunbeams = godrays(depth, camera, sun);
  sunbeams.resolutionScale = 0.38;
  sunbeams.raymarchSteps.value = 25;
  sunbeams.density.value = 0.48;
  sunbeams.maxDensity.value = 0.14;
  sunbeams.distanceAttenuation.value = 1.1;

  const glare = bloom(base, 0.17, 0.40, 1.34).setResolutionScale(0.33);
  const highlight = glare.rgb.div(glare.rgb.mul(15).add(1));
  const indirect = bounce.getGINode().rgb.min(0.20).mul(0.36);
  const contact = bounce.getAONode().r.mul(0.47).add(0.53);
  const air = color('#ffdaa7').mul(sunbeams.r).mul(0.23);
  const pipeline = new RenderPipeline(renderer, vec4(resolve.rgb.mul(contact, sunContact.r).add(indirect, air, highlight, reflection.rgb.mul(normals.a)), resolve.a));
  return {
    render: () => pipeline.render(),
    setScale: scale => beauty.setResolutionScale(scale),
  };
}
