import { clamp, mix, noise, randomFor, smooth } from './route.js';

export const RELIEF_SIZE = 768;
const SIZE = RELIEF_SIZE;
function mirror(n) {
  const period = 2 * (SIZE - 1);
  const p = ((n % period) + period) % period;
  return Math.min(p, period - p);
}

// Amplify survey-scale buttresses and cut tilted ledges into steep bedrock.
// All consumers use this field, including tires, the worker and the shading normals.
export function carveBedrock(source) {
  if (source.length !== SIZE * SIZE) throw new Error('Incomplete Shuksan elevation raster');
  const result = new Uint16Array(source.length);
  for (let z = 0; z < SIZE; z++) {
    const north = Math.max(0, z - 6) * SIZE, south = Math.min(SIZE - 1, z + 6) * SIZE;
    for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x;
      const west = source[z * SIZE + Math.max(0, x - 6)], east = source[z * SIZE + Math.min(SIZE - 1, x + 6)];
      const up = source[north + x], down = source[south + x];
      const slope = Math.hypot(east - west, down - up) / (4 * 12 * 19.75);
      const strength = smooth(0.22, 0.76, slope);
      const prominence = (source[i] - (west + east + up + down) * 0.25) / 4;
      const bed = (source[i] / 4 + x * 3.7 - z * 2.4 + 74 * noise(x / 29, z / 31)) / 79;
      const phase = bed - Math.floor(bed);
      const ledge = (smooth(0.32, 0.64, phase) - phase) * 43;
      const change = strength * (clamp(prominence * 0.85, -38, 38) + ledge);
      result[i] = clamp(Math.round(source[i] + 4 * change), 0, 65535);
    }
  }
  return result;
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
  function height(x, s, valleyDistance) {
    coordinates(x, s, local);
    const [u, v, blend] = local;
    const altitude = mix(sample(u, v), sample(0.71 * v - 0.53 * u + 279, 0.53 * v + 0.71 * u - 374), blend);
    const foothill = 42 + Math.max(0, altitude - 460) * 0.67;
    // Keep low passes through the front range. Higher, more distant divides
    // retain the cirques and saddles of the survey as they rise behind it.
    const inland = smooth(1450, 6400, valleyDistance);
    return foothill + inland * (95 + 1.65 * Math.max(0, foothill - 230));
  }
  return { height, coordinates };
}
