import { buildTerrain } from './terrain.js';
import { createWorld } from './world.js';

let world;
self.addEventListener('message', ({ data: { id, band, seed, elevations } }) => {
  if (elevations) {
    world = createWorld(seed, elevations);
    return;
  }
  const tile = buildTerrain(world, id, band);
  const buffers = [tile.position, tile.normal, tile.relief, tile.groundOffsets, tile.index];
  if (tile.water) buffers.push(tile.water.position, tile.water.shore, tile.water.index);
  self.postMessage({ id, band, tile }, buffers.map(buffer => buffer.buffer));
});
