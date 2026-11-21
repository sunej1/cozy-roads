import { RenderPipeline } from 'three/webgpu';
import { color, mrt, normalView, output, pass, velocity, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';

export function makeCinematic(renderer, scene, camera, sun) {
  const beauty = pass(scene, camera, { samples: 0 });
  beauty.setMRT(mrt({ output, motion: velocity, normal: normalView }));
  const base = beauty.getTextureNode();
  const depth = beauty.getTextureNode('depth');
  const resolve = taau(base, depth, beauty.getTextureNode('motion'), camera);
  resolve.currentFrameWeight = 0.075;

  const bounce = ssgi(base, depth, beauty.getTextureNode('normal'), camera);
  bounce.resolutionScale = 0.52;
  bounce.sliceCount.value = 2;
  bounce.stepCount.value = 9;
  bounce.radius.value = 4.2;
  bounce.thickness.value = 0.45;
  bounce.giIntensity.value = 4.6;

  const sunbeams = godrays(depth, camera, sun);
  sunbeams.resolutionScale = 0.38;
  sunbeams.raymarchSteps.value = 25;
  sunbeams.density.value = 0.58;
  sunbeams.maxDensity.value = 0.15;
  sunbeams.distanceAttenuation.value = 1.1;

  const glare = bloom(base, 0.17, 0.40, 1.34).setResolutionScale(0.33);
  const highlight = glare.rgb.div(glare.rgb.mul(15).add(1));
  const indirect = bounce.getGINode().rgb.min(0.18).mul(0.29);
  const contact = bounce.getAONode().r.mul(0.53).add(0.47);
  const air = color('#ffdda8').mul(sunbeams.r).mul(0.26);
  const pipeline = new RenderPipeline(renderer, vec4(resolve.rgb.mul(contact).add(indirect, air, highlight), resolve.a));
  return {
    render: () => pipeline.render(),
    setScale: scale => beauty.setResolutionScale(scale),
  };
}
