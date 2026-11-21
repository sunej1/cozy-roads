import { buildTerrain } from './terrain.js';
import { createWorld } from './world.js';

let world;
self.addEventListener('message', ({ data: { id, band, seed } }) => {
  if (!world || world.seed !== seed) world = createWorld(seed);
  const tile = buildTerrain(world, id, band);
  const buffers = [tile.position, tile.normal, tile.color, tile.index];
  if (tile.water) buffers.push(tile.water.position, tile.water.shore, tile.water.index);
  self.postMessage({ id, band, tile }, buffers.map(buffer => buffer.buffer));
});
