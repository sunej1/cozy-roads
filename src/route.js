export const ROAD_EDGE = 4.4;
export const LANE_CENTER = ROAD_EDGE / 2;
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

export function spawnStation(query, random = Math.random) {
  const start = new URLSearchParams(query).get('start');
  if (start !== null && /^-?\d{1,5}$/.test(start)) return Number(start);
  return Math.floor(random() * 24001) - 12000;
}

export function roadBend(world, s) {
  return (world.centerX(s - 42) + world.centerX(s + 42)) / 2 - world.centerX(s);
}

// Evaluate a full sight-distance window on one grid so paint meets across tiles.
export function restrictedPassing(world, s) {
  const middle = (Math.floor(s / 48) + 0.5) * 48;
  const before = middle - 42, after = middle + 42;
  const crest = world.roadHeight(middle) - (world.roadHeight(before) + world.roadHeight(after)) / 2;
  return Math.abs(roadBend(world, middle)) > 2.7 || crest > 0.75;
}

export function newCarState(world, station = 0) {
  const car = { x: 0, s: station, distance: 0, heading: 0, speed: 0, steering: 0 };
  joinRoad(car, world);
  return car;
}

export function joinRoad(car, world) {
  car.clearance = 0;
  car.extension = 0;
  car.verticalSpeed = 0;
  car.pitch = car.roll = null;
  alignToRoad(car, world);
}

function alignToRoad(car, world) {
  car.x = world.centerX(car.s) + LANE_CENTER;
  car.heading = -world.routePose(car.s).yaw;
  car.speed = Math.max(0, car.speed);
  car.steering = 0;
}

export function surfaceAt(car, world, height) {
  const roadDistance = Math.abs(car.x - world.centerX(car.s));
  if (roadDistance <= ROAD_EDGE) return 'Pavement';
  if (height(car.s, car.x) < (world.waterLevel?.(car.s, car.x) ?? 0) - 0.02) return 'Shallows';
  const turnout = (world.turnoutWidth?.(car.s) ?? 0) * Math.sign(car.x - world.centerX(car.s));
  return roadDistance <= ROAD_EDGE + Math.max(1, turnout + 1) ? 'Gravel' : 'Off road';
}

export function groundPose(s, x, heading, height, vehicle, waterLevel = 0) {
  const fx = Math.sin(heading), fs = Math.cos(heading);
  const axle = vehicle.wheelbase * 0.5, side = vehicle.width * 0.46;
  const wheel = (along, across) => Math.max(waterLevel - vehicle.ford,
    height(s + fs * along - fx * across, x + fx * along + fs * across));
  const fl = wheel(axle, -side), fr = wheel(axle, side);
  const rl = wheel(-axle, -side), rr = wheel(-axle, side);
  const grade = (fl + fr - rl - rr) / (2 * vehicle.wheelbase);
  return {
    y: (fl + fr + rl + rr) * 0.25,
    pitch: clamp(Math.atan(grade), -0.78, 0.78),
    roll: clamp(Math.atan2(fr + rr - fl - rl, 4 * side), -0.68, 0.68),
    waterLevel,
    grade,
  };
}

function manualStep(car, dt, input, world, vehicle, ground, snowDepth) {
  const speed = Math.abs(car.speed);
  const lateral = car.x - world.centerX(car.s);
  const turnout = (world.turnoutWidth?.(car.s) ?? 0) * Math.sign(lateral);
  const verge = Math.abs(lateral) - ROAD_EDGE;
  const roughness = smooth(-0.2, 4.2, verge) * mix(0.46, 1, smooth(turnout - 1, turnout + 1, verge));
  const packed = smooth(0.025, 0.24, snowDepth);
  const grip = (1 - 0.37 * packed) * mix(1, vehicle.roughGrip, roughness) * (ground.y < ground.waterLevel ? 0.59 : 1);
  const maximum = vehicle.topSpeed * mix(1, 0.29 + vehicle.roughGrip * 0.29, roughness) * (ground.y < ground.waterLevel ? 0.32 : 1);
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  car.steering = mix(car.steering, steer, 1 - Math.exp(-(4.5 + vehicle.turn) * dt));

  if (car.clearance === 0) {
    const reverse = input.brake && !input.throttle && car.speed <= 0;
    const uphill = reverse ? -ground.grade : ground.grade;
    const pull = vehicle.pull * grip * (1 - 0.62 * smooth(vehicle.climb, vehicle.climb + 0.32, uphill));
    const engine = (input.throttle ? pull : 0) - (input.brake ? (reverse ? pull * 0.56 : 13) : 0);
    const slope = GRAVITY * ground.grade / Math.hypot(1, ground.grade);
    const resistance = 0.30 + 0.62 * packed + speed * (0.064 + roughness * (1.1 - vehicle.roughGrip) * 0.16);
    const driven = car.speed + (engine - slope) * dt;
    car.speed = Math.sign(driven) * Math.max(0, Math.abs(driven) - resistance * dt);
    if (input.throttle && !input.brake && driven < 0 && speed < 0.1) car.speed = 0;
    if (input.brake && !input.throttle && ((!reverse && driven < 0) || (reverse && driven > 0))) car.speed = 0;
    const brakingLimit = speed - 4 * dt;
    const forwardLimit = Math.max(maximum, brakingLimit);
    const reverseLimit = Math.max(Math.min(8.5, maximum * 0.46), brakingLimit);
    car.speed = clamp(car.speed, -reverseLimit, forwardLimit);
    const turn = vehicle.turn * grip * Math.tanh(Math.abs(car.speed) / 4.2) * (1 - 0.63 * smooth(6, 39, speed));
    car.heading += car.steering * turn * Math.sign(car.speed) * dt;
    car.heading = Math.atan2(Math.sin(car.heading), Math.cos(car.heading));
  }

  const step = car.speed * dt / (car.clearance > 0 ? 1 : Math.hypot(1, ground.grade));
  car.x += Math.sin(car.heading) * step;
  car.s += Math.cos(car.heading) * step;
  car.distance += Math.abs(step);
}

export function drive(car, dt, input, automatic, world, height, vehicle, snowDepth = 0) {
  if (dt <= 0) return;
  const ground = groundPose(car.s, car.x, car.heading, height, vehicle, world.waterLevel?.(car.s, car.x));
  if (car.pitch === null) car.verticalSpeed = ground.grade * car.speed / Math.hypot(1, ground.grade);
  if (automatic) {
    car.speed = mix(car.speed, TOUR_SPEED, 1 - Math.exp(-1.65 * dt));
    car.s += car.speed * dt / world.routePose(car.s).length;
    car.distance += car.speed * dt;
    alignToRoad(car, world);
  } else {
    manualStep(car, dt, input, world, vehicle, ground, snowDepth);
  }

  const next = groundPose(car.s, car.x, car.heading, height, vehicle, world.waterLevel?.(car.s, car.x));
  const wasAirborne = car.clearance > 0;
  const travel = 0.06 + vehicle.suspension * 0.18;
  const stiffness = GRAVITY / travel;
  const supportSpeed = (next.y - ground.y) / dt;
  // Loaded springs support the body at rest. Fully extended wheels exert no force.
  const support = wasAirborne ? 0 : Math.max(0, stiffness * (travel - car.extension)
    + 1.7 * Math.sqrt(stiffness) * (supportSpeed - car.verticalSpeed));
  const acceleration = support - GRAVITY;
  const offset = car.extension + car.clearance + (car.verticalSpeed - supportSpeed) * dt + 0.5 * acceleration * dt * dt;
  car.verticalSpeed += acceleration * dt;
  car.extension = clamp(offset, -travel * 0.8, travel);
  car.clearance = Math.max(0, offset - travel);
  if (offset < -travel * 0.8) car.verticalSpeed = Math.max(car.verticalSpeed, supportSpeed);
  if (!automatic) {
    if (height(car.s, car.x) < next.waterLevel - vehicle.ford && next.y + car.extension + car.clearance <= next.waterLevel) {
      car.speed = 0;
      joinRoad(car, world);
      return 'deep-water';
    }
    if (!wasAirborne && car.clearance > 0) car.speed /= Math.hypot(1, ground.grade);
    if (wasAirborne && car.clearance === 0) {
      car.speed = (car.speed + car.verticalSpeed * next.grade) / Math.hypot(1, next.grade);
    }
  }
  // Gravity accelerates the center of mass without pitching the nose toward the ground.
  const follow = car.clearance > 0 ? 0 : 1 - Math.exp(-13 * dt);
  car.pitch = mix(car.pitch ?? ground.pitch, next.pitch, follow);
  car.roll = mix(car.roll ?? ground.roll, next.roll, follow);
}
