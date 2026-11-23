import * as THREE from 'three/webgpu';
import './style.css';
import { loadLandscapeAssets } from './assets.js';
import { loadVehicles } from './car.js';
import { driverEye } from './forest.js';
import { WorldView } from './world-view.js';
import { createWorld, parseSeed } from './world.js';
import { makeCinematic } from './cinematic.js';
import { ROAD_EDGE, BENCHMARK_SECONDS, clamp, drive, groundPose, joinRoad, mix, newCarState, spawnStation, surfaceAt, TOUR_SPEED } from './route.js';
import { VEHICLES, vehicleId } from './vehicles.js';
import { RecentFrames, ResolutionBudget, summarize } from './timing.js';

const element = id => document.getElementById(id);
const canvas = element('view');
let world;
const ui = Object.fromEntries([
  'intro', 'intro-title', 'intro-description', 'start', 'auto', 'restart', 'new-world', 'pause', 'vehicle', 'vehicle-description',
  'performance-toggle', 'performance', 'quality', 'resolution', 'fps', 'median', 'p95',
  'graph', 'benchmark-status', 'benchmark', 'export', 'distance', 'biome', 'surface', 'seed', 'reverse', 'speed', 'touch',
].map(id => [id, element(id)]));
const graph = ui.graph.getContext('2d');
const keyMap = new Map(Object.entries({
  KeyW: 'throttle', ArrowUp: 'throttle', KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
}));
const keyboard = new Set();
const pointers = new Map();
const input = { throttle: false, brake: false, left: false, right: false };
const recent = new RecentFrames();
const resolutionBudget = new ResolutionBudget();
const cameraTarget = new THREE.Vector3();
const lastAnchor = new THREE.Vector2();
const previousPose = {};
const desiredCamera = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const drawingBuffer = new THREE.Vector2();
const inputKeys = Object.keys(input);
const STEP = 1 / 120;
let car;
let selectedVehicle = vehicleId(new URLSearchParams(location.search).get('car'));
let models;
let mode = 'loading';
let automatic = false;
let low = false;
let benchmark = null;
let result = null;
let previousTime = null;
let nextUi = 0;
let accumulator = 0;
let wheelTurn = 0;
let needsRender = true;
let renderer;
let rendererName;
let cinematic = null;
let useCinematic = false;
let scene;
let landscape;
let model;
let camera;
const height = (s, x) => landscape.surfaceHeight(s, x);

function isMoving() {
  return mode === 'driving' || mode === 'benchmark';
}

function resetTime() {
  previousTime = null;
  accumulator = 0;
  Object.assign(previousPose, car, { wheelTurn });
  recent.clear();
  nextUi = 0;
}

function setMode(next) {
  mode = next;
  needsRender = true;
  resetTime();
  keyboard.clear();
  pointers.clear();
  ui.intro.hidden = isMoving();
  ui.pause.hidden = !isMoving();
  ui.pause.textContent = mode === 'benchmark' ? 'Cancel run' : 'Pause';
  ui.touch.hidden = mode !== 'driving';
  ui['benchmark'].disabled = mode === 'benchmark';
  ui.quality.disabled = mode === 'benchmark';
  ui.start.disabled = false;
  ui.auto.disabled = false;
  ui.auto.hidden = false;
  ui.restart.hidden = mode !== 'paused';
  ui['new-world'].disabled = false;
  ui.vehicle.disabled = false;

  if (mode === 'ready') {
    ui['intro-title'].textContent = 'The Open Road';
    ui['intro-description'].textContent = 'An endless drive through forests, river valleys, alpine lakes, and fjords.';
    ui.start.textContent = 'Start drive';
    ui.auto.textContent = 'Auto-drive';
  } else if (mode === 'paused') {
    ui['intro-title'].textContent = 'Drive paused';
    ui['intro-description'].textContent = automatic ? 'Auto-drive will pick up where you left off.' : 'WASD or arrow keys to drive.';
    ui.start.textContent = 'Resume drive';
    ui.auto.textContent = automatic ? 'Drive manually' : 'Auto-drive';
  }
  updateHud();
}

function startDrive(useAuto, restart = false) {
  if (restart) {
    car = newCarState(world, spawnStation(location.search));
    landscape.tracks.clear();
    wheelTurn = 0;
  }
  if (useAuto) joinRoad(car, world);
  landscape.update(car, low, true);
  automatic = useAuto;
  setMode('driving');
  poseScene(1);
}

function pauseDrive() {
  if (mode === 'benchmark') {
    finishBenchmark('Benchmark cancelled.');
  } else if (mode === 'driving') {
    setMode('paused');
    ui.start.focus();
  }
}

function readInput() {
  for (const key of inputKeys) input[key] = false;
  for (const key of keyboard) input[keyMap.get(key)] = true;
  for (const key of pointers.values()) input[key] = true;
  if (input.throttle || input.brake || input.left || input.right) automatic = false;
}

function chooseVehicle(value, persist = true) {
  const id = vehicleId(value);
  selectedVehicle = id;
  ui.vehicle.value = id;
  ui['vehicle-description'].textContent = VEHICLES[id].description;
  if (model) scene.remove(model.root, model.contactShadow);
  model = models.get(id);
  scene.add(model.root, model.contactShadow);
  if (persist) {
    const url = new URL(location.href);
    url.searchParams.set('car', id);
    history.replaceState(history.state, '', url);
    car.speed = 0;
    wheelTurn = 0;
    poseScene(1);
    updateHud();
    needsRender = true;
  }
}

function poseScene(blend) {
  const alpha = blend === 1 || !isMoving() ? 1 : clamp(accumulator / STEP, 0, 1);
  const x = mix(previousPose.x ?? car.x, car.x, alpha);
  const s = mix(previousPose.s ?? car.s, car.s, alpha);
  const angle = car.heading - (previousPose.heading ?? car.heading);
  const heading = car.heading - Math.atan2(Math.sin(angle), Math.cos(angle)) * (1 - alpha);
  const vehicle = VEHICLES[selectedVehicle];
  const forwardX = Math.sin(heading);
  const forwardS = Math.cos(heading);
  const y = height(s, x);
  const ground = groundPose(s, x, heading, height, vehicle, world.waterLevel(s, x));
  const lift = mix(previousPose.clearance ?? 0, car.clearance, alpha);
  const extension = mix(previousPose.extension ?? 0, car.extension, alpha);
  const pitch = mix(previousPose.pitch ?? ground.pitch, car.pitch ?? ground.pitch, alpha);
  const roll = mix(previousPose.roll ?? ground.roll, car.roll ?? ground.roll, alpha);
  const bodyLean = (1 - clamp(lift / 0.2, 0, 1)) * car.steering * clamp(Math.abs(car.speed) / 26, 0, 1) * (0.14 - vehicle.suspension * 0.09);
  model.root.position.set(x, ground.y + extension + lift, -s);
  model.contactShadow.position.set(x, ground.y + 0.045, -s);
  model.contactShadow.rotation.set(ground.pitch, -heading, ground.roll, 'YXZ');
  model.shadowStrength.value = 0.53 / (1 + lift * 3);
  driverEye.value.copy(model.root.position);
  driverEye.value.y += 0.88;
  model.brake(mode === 'driving' && input.brake && car.speed >= 0);
  model.root.rotation.set(pitch, -heading, roll + bodyLean);
  for (const { pivot, wheel, front, restY } of model.tires) {
    pivot.position.y = restY - extension;
    pivot.rotation.y = front ? -car.steering * 0.38 : 0;
    wheel.rotation.x = -mix(previousPose.wheelTurn ?? wheelTurn, wheelTurn, alpha);
  }

  if (mode === 'ready' || automatic) {
    const intro = mode === 'ready';
    const lookAhead = intro ? 34 : 17;
    const back = intro ? 9.7 : 7.75;
    desiredCamera.set(world.centerX(s - back) + (intro ? 3.15 : 1.10), y + (intro ? 3.52 : 2.92), -s + back);
    desiredTarget.set(world.centerX(s + lookAhead) - (intro ? 21 : 0),
      world.roadHeight(s + lookAhead) + (intro ? 4.7 : 1.55), -s - lookAhead);
  } else {
    const back = 7.95;
    const shoulder = 0.74;
    const cameraX = x - forwardX * back + forwardS * shoulder;
    const cameraS = s - forwardS * back - forwardX * shoulder;
    let cameraY = Math.max(y + 2.97, height(cameraS, cameraX) + 1.7);
    const roof = model.root.position.y + 1.35;
    for (const t of [.25, .5, .75]) {
      const ground = height(mix(s, cameraS, t), mix(x, cameraX, t));
      cameraY = Math.max(cameraY, roof + (ground + .55 - roof) / t);
    }
    const ahead = 15;
    const targetX = x + forwardX * ahead;
    const targetS = s + forwardS * ahead;
    const groundAhead = height(targetS, targetX);
    desiredCamera.set(cameraX, cameraY, -cameraS);
    const aim = y + 1.8 + clamp(groundAhead - y, -3, 5) * .38;
    const roofAngle = Math.atan2(roof - cameraY, back);
    const framed = cameraY + (back + ahead) * Math.tan(roofAngle + .17);
    desiredTarget.set(targetX, Math.min(aim, framed), -targetS);
  }
  // Carry the chase rig with the car so uneven frame intervals cannot pump its following distance.
  if (blend < 1) {
    camera.position.x += x - lastAnchor.x;
    camera.position.z -= s - lastAnchor.y;
    cameraTarget.x += x - lastAnchor.x;
    cameraTarget.z -= s - lastAnchor.y;
  }
  lastAnchor.set(x, s);
  camera.position.lerp(desiredCamera, blend);
  if (mode !== 'ready' && !automatic) {
    camera.position.y = Math.max(camera.position.y, height(-camera.position.z, camera.position.x) + 1.2);
  }
  cameraTarget.lerp(desiredTarget, blend);
  camera.lookAt(cameraTarget);
}

function applyQuality() {
  low = ui.quality.value === 'low';
  useCinematic = ui.quality.value === 'cinematic';
  if (useCinematic) {
    cinematic ??= makeCinematic(renderer, scene, camera, landscape.sun);
    resolutionBudget.reset();
    applyRenderScale();
  }
  landscape.setQuality(low);
  resize();
  landscape.update(car, low, !isMoving());
  resetTime();
}

function resize() {
  const { clientWidth: width, clientHeight: height } = canvas;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.fov = width < height ? 70 : 59;
  camera.updateProjectionMatrix();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5) * (low ? 0.68 : 1);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.getDrawingBufferSize(drawingBuffer);
  landscape.horizon.focal = drawingBuffer.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  showResolution();
  needsRender = true;
}

function showResolution() {
  const scale = resolutionBudget.scale;
  const source = useCinematic && scale < 1
    ? Math.round(drawingBuffer.x * scale) + ' × ' + Math.round(drawingBuffer.y * scale) + ' → '
    : '';
  ui.resolution.textContent = source + drawingBuffer.x + ' × ' + drawingBuffer.y + ' · ' + rendererName;
}

function applyRenderScale() {
  cinematic.setScale(resolutionBudget.scale);
  showResolution();
}

function drawGraph(values) {
  const width = ui.graph.width;
  const height = ui.graph.height;
  graph.clearRect(0, 0, width, height);
  if (!values.length) return;
  const top = Math.max(40, Math.min(105, Math.max(...values)));
  const y = ms => height - 5 - clamp(ms / top, 0, 1) * (height - 10);
  graph.lineWidth = 1;
  graph.strokeStyle = '#53695f';
  graph.setLineDash([4, 5]);
  for (const guide of [1000 / 60, 1000 / 30]) {
    graph.beginPath();
    graph.moveTo(0, y(guide));
    graph.lineTo(width, y(guide));
    graph.stroke();
  }
  graph.setLineDash([]);
  graph.lineWidth = 2.3;
  graph.strokeStyle = '#ddeb9f';
  graph.beginPath();
  values.forEach((ms, index) => {
    const x = width * index / Math.max(1, values.length - 1);
    if (index === 0) graph.moveTo(x, y(ms));
    else graph.lineTo(x, y(ms));
  });
  graph.stroke();
}

function updateHud() {
  ui.distance.textContent = (car.distance / 1000).toFixed(2) + ' km';
  ui.biome.textContent = world.biomeAt(car.s).name;
  ui.surface.textContent = surfaceAt(car, world, height);
  ui.reverse.hidden = car.speed >= -0.15;
  ui.speed.textContent = String(Math.round(Math.abs(car.speed) * 3.6)).padStart(2, '0');
  if (ui.performance.hidden) return;

  const history = recent.values();
  const statistics = history.length ? summarize(history) : result?.summary;
  ui.fps.textContent = statistics ? statistics.fps.toFixed(0) : '—';
  ui.median.textContent = statistics ? statistics.medianMs.toFixed(1) + ' ms' : '—';
  ui.p95.textContent = statistics ? statistics.p95Ms.toFixed(1) + ' ms' : '—';
  drawGraph(history.length ? history : result?.frameTimesMs.slice(-180) ?? []);
  if (benchmark && benchmark.started !== null) {
    ui['benchmark-status'].textContent = 'Recording ' + Math.min(BENCHMARK_SECONDS, Math.floor(benchmark.elapsed)) + ' / ' + BENCHMARK_SECONDS + ' seconds…';
  }
}

function startBenchmark() {
  if (benchmark || !renderer) return;
  benchmark = {
    saved: { car, mode, automatic, wheelTurn, level: resolutionBudget.level },
    quality: ui.quality.value,
    width: drawingBuffer.x,
    height: drawingBuffer.y,
    started: null,
    warmFrames: 0,
    elapsed: 0,
    frames: [],
    minScale: 1,
    maxScale: 0,
  };
  if (useCinematic) {
    resolutionBudget.reset();
    applyRenderScale();
  }
  landscape.tracks.clear();
  car = { ...newCarState(world), speed: TOUR_SPEED };
  wheelTurn = 0;
  automatic = true;
  landscape.update(car, low, true);
  setMode('benchmark');
  poseScene(1);
  ui['benchmark-status'].textContent = 'Warming up the renderer…';
}

function finishBenchmark(cancelMessage) {
  const run = benchmark;
  if (!run) return;
  benchmark = null;
  if (!cancelMessage) {
    result = {
      route: 'The Open Road',
      worldSeed: world.seed,
      vehicle: selectedVehicle,
      quality: run.quality,
      resolution: [run.width, run.height],
      renderScaleRange: [run.minScale, run.maxScale],
      backend: rendererName,
      browser: navigator.userAgent,
      capturedAt: new Date().toISOString(),
      measurement: 'Consecutive requestAnimationFrame intervals, in milliseconds',
      routeEndMeters: Number(car.distance.toFixed(2)),
      summary: summarize(run.frames),
      frameTimesMs: run.frames.map(ms => Number(ms.toFixed(3))),
    };
    const stats = result.summary;
    const preset = ui.quality.selectedOptions[0].textContent;
    ui['benchmark-status'].textContent = preset + ' · p95 '
      + stats.p95Ms.toFixed(1) + ' ms · p99 ' + stats.p99Ms.toFixed(1) + ' ms · '
      + stats.framesOver33Ms + ' frames over 33.3 ms';
    ui.export.hidden = false;
  } else {
    ui['benchmark-status'].textContent = cancelMessage;
  }
  ({ car, automatic, wheelTurn } = run.saved);
  if (useCinematic) {
    resolutionBudget.reset(run.saved.level);
    applyRenderScale();
  }
  setMode(run.saved.mode);
  landscape.update(car, low, true);
  poseScene(1);
  ui.benchmark.focus();
}

function exportResult() {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cozy-roads-' + result.quality + '-benchmark.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function advance(seconds) {
  accumulator += seconds;
  readInput();
  while (accumulator + 1e-9 >= STEP) {
    Object.assign(previousPose, car);
    previousPose.wheelTurn = wheelTurn;
    drive(car, STEP, input, automatic, world, height, VEHICLES[selectedVehicle]);
    wheelTurn += car.speed * STEP / VEHICLES[selectedVehicle].radius;
    accumulator -= STEP;
  }
  landscape.update(car, low);
}

function frame(now) {
  const delta = previousTime === null ? 0 : now - previousTime;
  previousTime = now;

  if (mode === 'benchmark') {
    benchmark.readyAt ??= now + 2000;
    if (benchmark.started === null) {
      benchmark.warmFrames++;
      if (now >= benchmark.readyAt && benchmark.warmFrames >= 30) {
        benchmark.started = now;
        nextUi = 0;
      }
    } else if (benchmark.started !== null && delta > 0) {
      const elapsed = (now - benchmark.started) / 1000;
      advance(Math.min(elapsed, BENCHMARK_SECONDS) - benchmark.elapsed);
      benchmark.elapsed = Math.min(elapsed, BENCHMARK_SECONDS);
      benchmark.frames.push(delta);
      recent.add(delta);
      const scale = useCinematic ? resolutionBudget.scale : 1;
      benchmark.minScale = Math.min(benchmark.minScale, scale);
      benchmark.maxScale = Math.max(benchmark.maxScale, scale);
      if (elapsed >= BENCHMARK_SECONDS) finishBenchmark();
    }
  } else if (mode === 'driving' && delta > 0) {
    recent.add(delta);
    advance(Math.min(delta / 1000, 0.13));
  }

  if (isMoving() || needsRender) {
    poseScene(1 - Math.exp(-11 * Math.min(delta / 1000, 0.13)));
    const onGrass = car.clearance < 0.025 && Math.abs(model.root.position.x - world.centerX(-model.root.position.z)) > ROAD_EDGE - 1.1;
    landscape.tracks.update(now / 1000, model.root, model.tires, onGrass);
    landscape.animate(now / 1000, camera, car);
    if (useCinematic) {
      if (isMoving() && resolutionBudget.observe(delta)) applyRenderScale();
      cinematic.render();
    } else {
      renderer.render(scene, camera);
    }
    needsRender = false;
  }

  if (now >= nextUi) {
    nextUi = now + 225;
    updateHud();
  }
  requestAnimationFrame(frame);
}

function bindControls() {
  ui.start.addEventListener('click', () => startDrive(mode === 'paused' && automatic));
  ui.auto.addEventListener('click', () => startDrive(!(mode === 'paused' && automatic)));
  ui.restart.addEventListener('click', () => startDrive(false, true));
  ui.vehicle.addEventListener('change', () => chooseVehicle(ui.vehicle.value));
  ui['new-world'].addEventListener('click', () => {
    const next = new URL(location.href);
    const [seed] = crypto.getRandomValues(new Uint32Array(1));
    next.searchParams.set('seed', String(seed));
    next.searchParams.delete('start');
    location.assign(next);
  });
  ui.pause.addEventListener('click', pauseDrive);
  ui.quality.addEventListener('change', applyQuality);
  ui.benchmark.addEventListener('click', startBenchmark);
  ui.export.addEventListener('click', exportResult);
  ui['performance-toggle'].addEventListener('click', () => {
    ui.performance.hidden = !ui.performance.hidden;
    ui['performance-toggle'].setAttribute('aria-expanded', String(!ui.performance.hidden));
    updateHud();
  });
  window.addEventListener('resize', () => {
    resize();
    if (benchmark && (drawingBuffer.x !== benchmark.width || drawingBuffer.y !== benchmark.height)) {
      finishBenchmark('Benchmark cancelled because the viewport resized.');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.code === 'Escape' && !event.repeat) {
      if (isMoving()) pauseDrive();
      else if (mode === 'paused') startDrive(automatic);
    }
    if (mode !== 'driving' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLSelectElement || !keyMap.has(event.code)) return;
    event.preventDefault();
    keyboard.add(event.code);
  });
  document.addEventListener('keyup', event => keyboard.delete(event.code));
  window.addEventListener('blur', () => {
    keyboard.clear();
    pointers.clear();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (benchmark) finishBenchmark('Benchmark cancelled because the tab was hidden.');
    else if (mode === 'driving') pauseDrive();
    resetTime();
  });
  for (const button of ui.touch.querySelectorAll('button')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, button.dataset.key);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(name, event => pointers.delete(event.pointerId));
    }
  }
}

async function initialize() {
  const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl';
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  const [, assets, vehicles] = await Promise.all([renderer.init(), loadLandscapeAssets(), loadVehicles()]);
  models = vehicles;
  world = createWorld(parseSeed(location.search), assets.elevations);
  car = newCarState(world, spawnStation(location.search));
  rendererName = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  const cinematicOption = ui.quality.querySelector('[value=cinematic]');
  cinematicOption.hidden = cinematicOption.disabled = rendererName !== 'WebGPU';
  ui.quality.value = rendererName === 'WebGPU' ? 'cinematic' : 'standard';
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.96;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#aec5c6');
  camera = new THREE.PerspectiveCamera(59, 1, 0.25, 9800);
  renderer.shadowMap.enabled = true;
  landscape = new WorldView(scene, assets, world, camera);
  ui.seed.textContent = 'World seed ' + world.seed;
  chooseVehicle(selectedVehicle, false);
  applyQuality();
  mode = 'ready';
  poseScene(1);
  await renderer.compileAsync(scene, camera);
  landscape.animate(performance.now() / 1000, camera, car);
  // Initialize the shadow map and PBR lookups before the depth-dependent effects.
  renderer.render(scene, camera);
  if (useCinematic) cinematic.render();
  bindControls();
  setMode('ready');
  requestAnimationFrame(frame);
}

initialize().catch(error => {
  console.error(error);
  ui['intro-title'].textContent = 'The road couldn’t load';
  ui['intro-description'].textContent = 'This prototype needs a browser with WebGL 2 and hardware acceleration.';
  ui.start.hidden = true;
  ui.auto.hidden = true;
  ui['new-world'].hidden = true;
  ui.vehicle.closest('.garage').hidden = true;
  ui['performance-toggle'].hidden = true;
});
