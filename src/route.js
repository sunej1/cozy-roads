export const ROAD_EDGE = 4.4;
export const CHUNK_LENGTH = 128;
export const BENCHMARK_SECONDS = 30;
export const TOUR_SPEED = 20;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const mix = (start, end, amount) => start + (end - start) * amount;

export function smooth(min, max, value) {
  const amount = clamp((value - min) / (max - min), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function gridNoise(x, z) {
  let n = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ 0x1b56c4e9;
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

export function noise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const u = smooth(0, 1, x - x0);
  const v = smooth(0, 1, z - z0);
  return mix(
    mix(gridNoise(x0, z0), gridNoise(x0 + 1, z0), u),
    mix(gridNoise(x0, z0 + 1), gridNoise(x0 + 1, z0 + 1), u),
    v,
  );
}

export function newCarState(world) {
  const car = { x: 0, s: 0, distance: 0, heading: 0, speed: 0, steering: 0 };
  joinRoad(car, world);
  return car;
}

export function joinRoad(car, world) {
  car.x = world.centerX(car.s);
  car.heading = -world.routePose(car.s).yaw;
  car.speed = Math.max(0, car.speed);
  car.steering = 0;
}

export function surfaceAt(car, world, height) {
  const roadDistance = Math.abs(car.x - world.centerX(car.s));
  if (height(car.s, car.x) < -0.02) return 'Shallows';
  if (roadDistance <= ROAD_EDGE) return 'Pavement';
  return roadDistance <= ROAD_EDGE + 3 ? 'Gravel' : 'Off road';
}

export function drive(car, dt, input, automatic, world, height, vehicle) {
  if (automatic) {
    car.speed = mix(car.speed, TOUR_SPEED, 1 - Math.exp(-1.65 * dt));
    car.s += car.speed * dt / world.routePose(car.s).length;
    car.distance += car.speed * dt;
    joinRoad(car, world);
    return;
  }

  const speed = Math.abs(car.speed);
  const lateral = Math.abs(car.x - world.centerX(car.s));
  const roughness = smooth(ROAD_EDGE - 0.2, ROAD_EDGE + 4.2, lateral);
  const y = height(car.s, car.x);
  const grip = mix(1, vehicle.roughGrip, roughness) * (y < 0 ? 0.59 : 1);
  const xForward = Math.sin(car.heading);
  const sForward = Math.cos(car.heading);
  const direction = car.speed < -0.04 || (car.speed <= 0 && input.brake && !input.throttle) ? -1 : 1;
  const grade = (height(car.s + sForward * 3 * direction, car.x + xForward * 3 * direction) - y) / 3;
  const load = clamp(grade / vehicle.climb, -0.20, 1.6);
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  car.steering = mix(car.steering, steer, 1 - Math.exp(-(4.5 + vehicle.turn) * dt));
  const maximum = vehicle.topSpeed * mix(1, 0.40 + vehicle.roughGrip * 0.39, roughness) * (y < 0 ? 0.32 : 1);
  const engine = input.throttle ? vehicle.pull * grip : 0;
  const braking = input.brake ? (car.speed > 0 ? 13 : vehicle.pull * grip * 0.56) : 0;
  const drag = Math.sign(car.speed) * (0.30 + speed * (0.064 + roughness * (1.1 - vehicle.roughGrip) * 0.16));
  const gravity = speed > 0.06 || input.throttle || input.brake ? load * vehicle.pull * 0.83 * direction : 0;
  const candidate = car.speed + (engine - braking - drag - gravity) * dt;
  car.speed = clamp(candidate, -Math.min(8.5, maximum * 0.46), maximum);
  if ((input.brake && candidate < 0 && direction > 0) ||
      (!input.brake && !input.throttle && Math.sign(candidate) !== direction)) car.speed = 0;
  if (input.throttle && !input.brake && direction > 0 && car.speed < 0) car.speed = 0;
  if (!input.throttle && input.brake && direction < 0 && car.speed > 0) car.speed = 0;

  const turn = vehicle.turn * grip * Math.tanh(Math.abs(car.speed) / 4.2) * (1 - 0.63 * smooth(6, 39, speed));
  car.heading += car.steering * turn * Math.sign(car.speed) * dt;
  car.heading = Math.atan2(Math.sin(car.heading), Math.cos(car.heading));

  const step = car.speed * dt;
  const nextX = car.x + Math.sin(car.heading) * step;
  const nextS = car.s + Math.cos(car.heading) * step;
  const nextHeight = height(nextS, nextX);
  if (nextHeight < -vehicle.ford && nextHeight < y) {
    car.speed = 0;
    return;
  }
  car.x = nextX;
  car.s = nextS;
  car.distance += Math.abs(step);
}
