export const ROAD_EDGE = 4.4;
export const CHUNK_LENGTH = 128;
export const BENCHMARK_SECONDS = 30;
export const TOUR_SPEED = 20;
const GRAVITY = 9.81;

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
  car.clearance = 0;
  car.verticalSpeed = 0;
  car.pitch = car.roll = null;
  alignToRoad(car, world);
}

function alignToRoad(car, world) {
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

export function groundPose(s, x, heading, height, vehicle) {
  const fx = Math.sin(heading), fs = Math.cos(heading);
  const axle = vehicle.wheelbase * 0.5, side = vehicle.width * 0.46;
  const front = height(s + fs * axle, x + fx * axle);
  const rear = height(s - fs * axle, x - fx * axle);
  const right = height(s - fx * side, x + fs * side);
  const left = height(s + fx * side, x - fs * side);
  const grade = (front - rear) / vehicle.wheelbase;
  return {
    y: Math.max(-vehicle.ford, mix(height(s, x), (front + rear + right + left) * 0.25, 0.68)),
    pitch: clamp(Math.atan(grade), -0.78, 0.78),
    roll: clamp(Math.atan2(right - left, 2 * side), -0.68, 0.68),
    grade,
  };
}

function manualStep(car, dt, input, world, height, vehicle, ground) {
  const speed = Math.abs(car.speed);
  const roughness = smooth(ROAD_EDGE - 0.2, ROAD_EDGE + 4.2, Math.abs(car.x - world.centerX(car.s)));
  const grip = mix(1, vehicle.roughGrip, roughness) * (ground.y < 0 ? 0.59 : 1);
  const maximum = vehicle.topSpeed * mix(1, 0.40 + vehicle.roughGrip * 0.39, roughness) * (ground.y < 0 ? 0.32 : 1);
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  car.steering = mix(car.steering, steer, 1 - Math.exp(-(4.5 + vehicle.turn) * dt));

  if (car.clearance === 0) {
    const reverse = input.brake && !input.throttle && car.speed <= 0;
    const uphill = reverse ? -ground.grade : ground.grade;
    const pull = vehicle.pull * grip * (1 - 0.62 * smooth(vehicle.climb, vehicle.climb + 0.32, uphill));
    const engine = (input.throttle ? pull : 0) - (input.brake ? (reverse ? pull * 0.56 : 13) : 0);
    const slope = GRAVITY * ground.grade / Math.hypot(1, ground.grade);
    const resistance = 0.30 + speed * (0.064 + roughness * (1.1 - vehicle.roughGrip) * 0.16);
    const driven = car.speed + (engine - slope) * dt;
    car.speed = Math.sign(driven) * Math.max(0, Math.abs(driven) - resistance * dt);
    if (input.throttle && !input.brake && driven < 0 && speed < 0.1) car.speed = 0;
    if (input.brake && !input.throttle && ((!reverse && driven < 0) || (reverse && driven > 0))) car.speed = 0;
    car.speed = clamp(car.speed, -Math.min(8.5, maximum * 0.46), maximum);
    const turn = vehicle.turn * grip * Math.tanh(Math.abs(car.speed) / 4.2) * (1 - 0.63 * smooth(6, 39, speed));
    car.heading += car.steering * turn * Math.sign(car.speed) * dt;
    car.heading = Math.atan2(Math.sin(car.heading), Math.cos(car.heading));
  }

  const step = car.speed * dt;
  const nextX = car.x + Math.sin(car.heading) * step, nextS = car.s + Math.cos(car.heading) * step;
  const nextHeight = height(nextS, nextX);
  const aboveWater = car.clearance > 0 && ground.y + car.clearance > 0;
  if (!aboveWater && nextHeight < -vehicle.ford && nextHeight < height(car.s, car.x)) {
    car.speed = 0;
    return;
  }
  car.x = nextX;
  car.s = nextS;
  car.distance += Math.abs(step);
}

export function drive(car, dt, input, automatic, world, height, vehicle) {
  if (dt <= 0) return;
  const ground = groundPose(car.s, car.x, car.heading, height, vehicle);
  if (car.pitch === null) car.verticalSpeed = ground.grade * car.speed;
  if (automatic) {
    car.speed = mix(car.speed, TOUR_SPEED, 1 - Math.exp(-1.65 * dt));
    car.s += car.speed * dt / world.routePose(car.s).length;
    car.distance += car.speed * dt;
    alignToRoad(car, world);
  } else {
    manualStep(car, dt, input, world, height, vehicle, ground);
  }

  // The ground can push the tires up. A falling road cannot pull the car down.
  const next = groundPose(car.s, car.x, car.heading, height, vehicle);
  const freeHeight = ground.y + car.clearance + car.verticalSpeed * dt - 0.5 * GRAVITY * dt * dt;
  car.clearance = Math.max(0, freeHeight - next.y);
  const airborne = car.clearance > 0;
  car.verticalSpeed = airborne ? car.verticalSpeed - GRAVITY * dt : (next.y - ground.y) / dt;
  const pitch = airborne ? clamp(Math.atan2(car.verticalSpeed * Math.sign(car.speed), Math.max(4, Math.abs(car.speed))), -0.62, 0.62) : next.pitch;
  const follow = 1 - Math.exp(-(airborne ? 2.8 : 16) * dt);
  car.pitch = mix(car.pitch ?? ground.pitch, pitch, follow);
  car.roll = mix(car.roll ?? ground.roll, airborne ? 0 : next.roll, follow);
}
