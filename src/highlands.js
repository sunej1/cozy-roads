import { mix, noise, randomFor } from './route.js';

export const RELIEF_SIZE = 768;
const SIZE = RELIEF_SIZE;
function mirror(n) {
  const period = 2 * (SIZE - 1);
  const p = ((n % period) + period) % period;
  return Math.min(p, period - p);
}

// Warp and cross-blend two orientations of the surveyed relief. A summit keeps
// its drainage channels while the range surrounding it varies with the seed.
export function highlands(seed, elevations) {
  if (elevations?.length !== SIZE * SIZE) throw new Error('Incomplete Shuksan elevation raster');
  const rng = randomFor(seed);
  const angle = rng() * Math.PI * 2,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const u0 = rng() * SIZE,
    v0 = rng() * SIZE;
  function sample(u, v) {
    const x = mirror(u),
      y = mirror(v);
    const i = Math.floor(x),
      j = Math.floor(y),
      right = Math.min(i + 1, SIZE - 1);
    const top = j * SIZE,
      bottom = Math.min(j + 1, SIZE - 1) * SIZE;
    return (
      0.25 *
      mix(
        mix(elevations[top + i], elevations[top + right], x - i),
        mix(elevations[bottom + i], elevations[bottom + right], x - i),
        y - j,
      )
    );
  }
  function coordinates(x, s, target, index = 0) {
    target[index] = (x * cos + s * sin) * 0.107 + u0 + 30 * noise(x / 1030 + u0, s / 1280 + v0);
    target[index + 1] = (s * cos - x * sin) * 0.107 + v0 + 26 * noise(s / 970, x / 1160 + v0);
    target[index + 2] = 0.1 + 0.29 * noise(s / 1910 + u0, x / 2100);
  }
  const local = new Float64Array(3);
  function height(x, s) {
    coordinates(x, s, local);
    const [u, v, blend] = local;
    const altitude = mix(sample(u, v), sample(0.71 * v - 0.53 * u + 279, 0.53 * v + 0.71 * u - 374), blend);
    return 42 + Math.max(0, altitude - 460) * 0.67;
  }
  return { height, coordinates };
}
