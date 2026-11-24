// Original game meshes. All dimensions are in metres, with the nose along -Z.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const { lerp, clamp } = THREE.MathUtils;
const tau = 2 * Math.PI;
const point = (x, y, z) => new THREE.Vector3(x, y, z);

function profile(stations, z, column) {
  if (z <= stations[0][0]) return stations[0][column];
  if (z >= stations.at(-1)[0]) return stations.at(-1)[column];
  const i = stations.findIndex((row) => row[0] >= z);
  const a = stations[i - 1],
    b = stations[i];
  const prev = stations[Math.max(0, i - 2)],
    next = stations[Math.min(stations.length - 1, i + 1)];
  const span = b[0] - a[0],
    t = clamp((z - a[0]) / span, 0, 1);
  const leftSlope = (b[column] - prev[column]) / (b[0] - prev[0]);
  const rightSlope = (next[column] - a[column]) / (next[0] - a[0]);
  return lerp(a[column], b[column], t * t * (3 - 2 * t)) + span * t * (1 - t) * (leftSlope * (1 - t) - rightSlope * t);
}

function patch(nx, ny, position) {
  const vertices = [],
    indices = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      vertices.push(...position(i / nx, j / ny));
      if (i && j) {
        const d = j * (nx + 1) + i,
          a = d - nx - 2;
        indices.push(a, d - 1, a + 1, a + 1, d - 1, d);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Static parts of the same finish share a draw call. Wheels remain independent rigs.
function assembly() {
  const parts = new Map();
  function add(material, geometry) {
    geometry.deleteAttribute('uv');
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geometry);
  }
  function box(material, size, at, tilt = 0) {
    add(material, new THREE.BoxGeometry(...size).rotateX(tilt).translate(...at));
  }
  function oval(material, size, at, tilt = 0) {
    add(
      material,
      new THREE.SphereGeometry(1, 24, 14)
        .scale(...size)
        .rotateX(tilt)
        .translate(...at)
    );
  }
  function tube(material, points, radius) {
    const path = new THREE.CatmullRomCurve3(points.map((p) => point(...p)));
    add(material, new THREE.TubeGeometry(path, Math.max(8, points.length * 2), radius, 6, false));
  }
  function finish() {
    const root = new THREE.Group();
    for (const [material, geometries] of parts) root.add(new THREE.Mesh(mergeGeometries(geometries), material));
    return root;
  }
  return { add, box, oval, tube, finish };
}

const finish = (name, color, metalness, roughness) =>
  new THREE.MeshStandardMaterial({ name, color, metalness, roughness, side: THREE.DoubleSide });
const rubber = finish('Rubber', '#222529', 0.03, 0.86);
const carbon = finish('Aero', '#252c32', 0.38, 0.32);
const alloy = finish('Machined alloy', '#c9ced0', 0.88, 0.25);
const glass = finish('Smoked glass', '#394955', 0.5, 0.14);
const chrome = finish('Lamp bezel', '#dfe0d8', 0.91, 0.18);
const lens = finish('Headlight glass', '#e4eadb', 0.47, 0.15);
const amber = finish('Indicator', '#f79733', 0.29, 0.22);
const wheelRed = finish('Carmine wheels', '#ae1737', 0.7, 0.29);

function wheel(radius, width, modern, side) {
  const part = assembly(),
    front = (side * width) / 2;
  // Rounded shoulders, recessed rim and a separate hub keep the spokes open.
  const sections = [
    [-0.83, 0.58],
    [-0.98, 0.71],
    [-1, 0.88],
    [-0.82, 0.975],
    [-0.55, 1],
    [0.55, 1],
    [0.82, 0.975],
    [1, 0.88],
    [0.98, 0.71],
    [0.83, 0.58],
  ];
  part.add(
    rubber,
    patch(48, sections.length - 1, (u, v) => {
      const [x, r] = sections[Math.round(v * (sections.length - 1))];
      return [(x * width) / 2, r * radius * Math.cos(tau * u), r * radius * Math.sin(tau * u)];
    })
  );
  function disk(material, r, depth, x) {
    part.add(material, new THREE.CylinderGeometry(r, r, depth, 48).rotateZ(Math.PI / 2).translate(x, 0, 0));
  }
  disk(carbon, radius * 0.72, width * 0.86, 0);
  disk(alloy, radius * 0.52, 0.012, front * 0.76);
  const rimRadius = radius * (modern ? 0.795 : 0.7);
  part.add(
    modern ? wheelRed : alloy,
    new THREE.TorusGeometry(rimRadius, 0.014, 8, 48).rotateY(Math.PI / 2).translate(front, 0, 0)
  );
  const count = modern ? 10 : 5;
  for (let i = 0; i < count; i++) {
    const angle = (i * tau) / count;
    for (const fork of modern ? [-1, 1] : [0]) {
      const shape = new THREE.Shape();
      const corners = modern
        ? [
            [-0.011, 0.045],
            [0.013, 0.045],
            [0.015, 0.135],
            [fork * 0.026 + 0.012, rimRadius],
            [fork * 0.026 - 0.009, rimRadius],
            [-0.01, 0.14],
          ]
        : [
            [-0.024, 0.038],
            [0.035, 0.04],
            [0.056, 0.132],
            [0.037, rimRadius],
            [-0.023, rimRadius],
            [-0.047, 0.14],
          ];
      corners.forEach(([x, y], j) => (j ? shape.lineTo(x, y) : shape.moveTo(x, y)));
      const geo = new THREE.ShapeGeometry(shape);
      part.add(
        modern ? wheelRed : alloy,
        geo
          .rotateY(Math.PI / 2)
          .rotateX(angle)
          .translate(front * 0.99, 0, 0)
      );
    }
  }
  disk(modern ? carbon : alloy, 0.053, 0.025, front);
  return part.finish();
}

export function makePorsche(modern, decals) {
  const body = assembly();
  const paint = finish('Bodywork', modern ? '#ecece4' : '#e64a25', 0.55, 0.24);
  const rearLamp = finish('RearLamps', '#a51119', 0.28, 0.21);
  rearLamp.emissive.set('#c8191b');
  const length = modern ? 2.29 : 2.145,
    radius = modern ? 0.347 : 0.307;
  const axles = modern ? [-1.255, 1.205] : [-1.17, 1.1];
  // Station, half-width, centre deck height, fender crest above the deck.
  const sections = modern
    ? [
        [-1, 0.79, 0.41, 0.1],
        [-0.88, 0.93, 0.52, 0.15],
        [-0.62, 0.962, 0.64, 0.2],
        [-0.35, 0.92, 0.75, 0.09],
        [0, 0.89, 0.8, 0.025],
        [0.34, 0.98, 0.83, 0.09],
        [0.57, 1.005, 0.82, 0.14],
        [0.82, 0.965, 0.79, 0.075],
        [1, 0.82, 0.68, 0.02],
      ]
    : [
        [-1, 0.69, 0.45, 0.06],
        [-0.9, 0.77, 0.51, 0.17],
        [-0.74, 0.84, 0.57, 0.25],
        [-0.55, 0.86, 0.63, 0.22],
        [-0.32, 0.8, 0.71, 0.06],
        [0, 0.79, 0.755, 0.025],
        [0.31, 0.85, 0.78, 0.07],
        [0.55, 0.895, 0.77, 0.13],
        [0.76, 0.87, 0.7, 0.08],
        [1, 0.72, 0.6, 0.01],
      ];
  function deck(t, s) {
    const width = profile(sections, s, 1),
      f = Math.abs(t);
    const z = s * length - Math.sign(s) * Math.pow(Math.abs(s), 7) * f * f * 0.245;
    const crest = Math.exp(-((f - 0.79) ** 2) / 0.048);
    let y = profile(sections, s, 2) + profile(sections, s, 3) * crest - 0.038 * f ** 7;
    const dz = Math.min(...axles.map((a) => Math.abs(z - a)));
    const arch = radius + 0.052;
    if (dz < arch)
      y = Math.max(y, (radius + 0.035 + Math.sqrt(arch * arch - dz * dz)) * THREE.MathUtils.smoothstep(f, 0.64, 0.96));
    const lampStation = modern ? -0.77 : -0.815,
      lampWidth = modern ? 0.157 : 0.151,
      lampLength = modern ? 0.067 : 0.046;
    const bezel = Math.hypot((f - (modern ? 0.762 : 0.79)) / lampWidth, (s - lampStation) / lampLength);
    if (bezel < 1.65) {
      const mountingPlane = (modern ? 0.735 : 0.723) + (s - lampStation) * length * (modern ? 0.85 : 1.38);
      y = lerp(mountingPlane, y, THREE.MathUtils.smoothstep(bezel, 0.94, 1.65));
    }
    return [t * width, y, z];
  }
  body.add(
    paint,
    patch(40, 84, (u, v) => deck(2 * u - 1, 2 * v - 1))
  );
  function flank(side, s, v, depth = 0) {
    const [x, y, z] = deck(side, s);
    const dz = Math.min(...axles.map((a) => Math.abs(z - a)));
    const arch = radius + 0.044,
      skirt = modern ? 0.168 : 0.205;
    const base = dz < arch ? Math.max(skirt, radius + Math.sqrt(Math.max(0, arch * arch - dz * dz))) : skirt;
    return [x + side * (depth - 0.041 * (1 - v) ** 2 + 0.012 * Math.sin(v * Math.PI)), lerp(base, y, v), z];
  }
  for (const side of [-1, 1]) {
    body.add(
      paint,
      patch(116, 10, (u, v) => flank(side, 2 * u - 1, v))
    );
    body.box(carbon, [0.105, 0.076, axles[1] - axles[0] - 0.66], [side * (modern ? 0.905 : 0.775), 0.206, -0.03]);
  }
  // The screens and side glazing follow the same curved shell as the painted pillars.
  const cabin = modern
    ? [
        [-0.46, 0.65, 0.735, 0.765],
        [-0.33, 0.746, 0.78, 1.0],
        [-0.13, 0.765, 0.8, 1.263],
        [0.07, 0.77, 0.818, 1.31],
        [0.25, 0.764, 0.83, 1.266],
        [0.46, 0.698, 0.84, 1.094],
        [0.68, 0.556, 0.816, 0.84],
      ]
    : [
        [-0.38, 0.636, 0.713, 0.757],
        [-0.3, 0.701, 0.741, 0.886],
        [-0.12, 0.714, 0.76, 1.235],
        [0.055, 0.719, 0.775, 1.305],
        [0.23, 0.705, 0.789, 1.266],
        [0.41, 0.634, 0.79, 1.099],
        [0.645, 0.48, 0.747, 0.765],
      ];
  const cabinStart = cabin[0][0],
    cabinEnd = cabin.at(-1)[0];
  function roof(t, s, lift = 0) {
    const w = profile(cabin, s, 1),
      base = profile(cabin, s, 2),
      crown = profile(cabin, s, 3);
    return [t * (w + lift), lerp(crown, base, Math.abs(t) ** 4.2) + lift, s * length];
  }
  body.add(
    paint,
    patch(40, 48, (u, v) => roof(2 * u - 1, lerp(cabinStart, cabinEnd, v)))
  );
  const windBase = modern ? -0.424 : -0.349,
    windTop = modern ? -0.132 : -0.116;
  const rearTop = modern ? 0.246 : 0.205,
    rearBase = modern ? 0.623 : 0.568;
  for (const [a, b] of [
    [windBase, windTop],
    [rearTop, rearBase],
  ]) {
    body.add(
      glass,
      patch(26, 12, (u, v) => roof((2 * u - 1) * lerp(0.89, 0.82, v), lerp(a, b, v), 0.006))
    );
    for (const s of [a, b])
      body.tube(
        modern ? carbon : chrome,
        Array.from({ length: 15 }, (_, i) => roof((i / 7 - 1) * (s === a ? 0.89 : 0.82), s, 0.01)),
        0.006
      );
  }
  for (const side of [-1, 1]) {
    for (const [left, right] of [
      [windBase + 0.018, 0.071],
      [0.087, rearBase - 0.018],
    ]) {
      body.add(
        glass,
        patch(20, 8, (u, v) => {
          const topStart = left < 0 ? windTop + 0.012 : left,
            topEnd = right > 0.1 ? rearTop + 0.02 : right;
          const s = lerp(lerp(left, topStart, v), lerp(right, topEnd, v), u);
          return roof(side * lerp(0.993, 0.792, v), s, 0.006);
        })
      );
    }
    body.tube(
      modern ? carbon : chrome,
      [windBase, -0.15, 0.09, 0.29, rearBase].map((s) => roof(side * 0.995, s, 0.008)),
      0.009
    );
    body.tube(
      carbon,
      [
        [side * 0.75, 0.84, -0.53],
        [side * 0.89, 0.89, -0.56],
      ],
      0.023
    );
    body.oval(paint, [0.092, 0.055, 0.108], [side * (modern ? 0.94 : 0.884), 0.918, -0.575]);
    body.box(modern ? carbon : chrome, [0.027, 0.027, 0.115], [side * (modern ? 0.896 : 0.802), 0.71, 0.2]);
  }
  // The bumper fascias wrap around the corners of the body.
  function bumper(t, s, y, depth = 0) {
    const [x, top, z] = deck(t, s);
    const fraction = clamp((y - 0.2) / Math.max(0.04, top - 0.2), 0, 1);
    const round = 0.062 * (1 - t ** 4) * Math.sin(Math.PI * fraction);
    return [x, y, z + s * (depth + round)];
  }
  function fascia(material, s, bottom, top, depth, left = -1, right = 1) {
    body.add(
      material,
      patch(40, 8, (u, v) => {
        const t = lerp(left, right, u),
          y = lerp(bottom(t), top(t, deck(t, s)[1]), v);
        return bumper(t, s, y, depth);
      })
    );
  }
  for (const s of [-1, 1]) {
    fascia(
      paint,
      s,
      () => 0.2,
      (_, y) => y,
      0.001
    );
    fascia(
      carbon,
      s,
      () => (modern ? 0.155 : 0.31),
      () => (modern ? 0.238 : 0.401),
      0.006
    );
  }
  const rearLightY = modern ? 0.616 : 0.532;
  fascia(
    rearLamp,
    1,
    (t) => rearLightY - 0.016 - (modern ? 0.03 : 0) * t * t,
    (t) => rearLightY + (modern ? 0.016 : 0.049) - 0.024 * t * t,
    0.012,
    -0.977,
    0.977
  );
  const plateY = modern ? 0.407 : 0.42;
  fascia(
    carbon,
    1,
    () => plateY - 0.059,
    () => plateY + 0.059,
    0.025,
    -0.236,
    0.236
  );
  fascia(
    lens,
    1,
    () => plateY - 0.044,
    () => plateY + 0.044,
    0.03,
    -0.212,
    0.212
  );
  for (const side of [-1, 1]) {
    // Map the lens and bezel onto the sloping fender, including its curvature.
    function headlight(x, y, lift) {
      const s = (modern ? -0.77 : -0.815) + y * (modern ? 0.067 : 0.046);
      const t = side * ((modern ? 0.762 : 0.79) + x * (modern ? 0.157 : 0.151));
      const p = deck(t, s);
      p[1] += lift;
      p[2] -= lift * 0.55;
      return p;
    }
    function lampDisc(material, r, lift) {
      body.add(
        material,
        patch(40, 6, (u, v) =>
          headlight(r * v * Math.cos(tau * u), r * v * Math.sin(tau * u), lift + 0.008 * (1 - v * v))
        )
      );
    }
    lampDisc(modern ? carbon : chrome, 1, 0.012);
    lampDisc(modern ? glass : lens, 0.873, 0.022);
    if (modern) {
      for (const x of [-0.38, 0.38])
        for (const y of [-0.41, 0.41]) {
          body.add(
            lens,
            patch(12, 3, (u, v) => headlight(x + v * 0.15 * Math.cos(tau * u), y + v * 0.1 * Math.sin(tau * u), 0.036))
          );
        }
    } else {
      for (const y of [-0.43, -0.2, 0.04, 0.29, 0.51])
        body.tube(
          chrome,
          [-0.55, 0, 0.55].map((x) => headlight(x, y, 0.035)),
          0.0027
        );
    }
    if (!modern) {
      fascia(
        amber,
        -1,
        () => 0.415,
        () => 0.462,
        0.01,
        ...(side < 0 ? [-0.97, -0.72] : [0.72, 0.97])
      );
      body.box(rubber, [0.085, 0.143, 0.095], [side * 0.447, 0.367, length - 0.022]);
      body.box(rubber, [0.081, 0.137, 0.088], [side * 0.45, 0.359, -length + 0.008]);
    } else {
      fascia(
        carbon,
        -1,
        () => 0.244,
        () => 0.401,
        0.013,
        ...(side < 0 ? [-0.95, -0.53] : [0.53, 0.95])
      );
      // Paired bonnet nostrils and front wing louvres sit flush with the panel.
      body.add(
        carbon,
        patch(10, 12, (u, v) => {
          const s = lerp(-0.78, -0.49, v),
            t = side * lerp(0.13 + 0.12 * v, 0.47 + 0.06 * v, u);
          const p = deck(t, s);
          p[1] += 0.008;
          return p;
        })
      );
      for (let i = 0; i < 5; i++) {
        const s = -0.61 + i * 0.023,
          p = deck(side * 0.8, s);
        body.box(carbon, [0.143, 0.021, 0.026], [p[0], p[1] + 0.01, p[2]], -0.15);
      }
    }
  }
  // Panel gaps follow the skin, keeping the lid and doors readable in reflections.
  function seam(points, r = 0.005) {
    body.tube(rubber, points, r);
  }
  const lid = (t, s) => {
    const p = deck(t, s);
    p[1] += 0.005;
    return p;
  };
  for (const side of [-1, 1]) {
    seam([-0.9, -0.8, -0.67, -0.5, -0.398].map((s, i) => lid(side * (0.51 + i * 0.035), s)));
    const door = new THREE.SplineCurve(
      [
        [-0.3, 0.86],
        [-0.312, 0.53],
        [-0.305, 0.17],
        [-0.26, 0.11],
        [0.12, 0.11],
        [0.18, 0.17],
        [0.216, 0.49],
        [0.229, 0.87],
      ].map(([s, v]) => new THREE.Vector2(s, v))
    );
    seam(
      door.getPoints(34).map(({ x: s, y: v }) => flank(side, s, v, 0.0035)),
      0.0038
    );
    const trim = new THREE.SplineCurve(
      [
        [windBase, 0.984],
        [windTop, 0.814],
        [0.04, 0.8],
        [rearTop, 0.824],
        [rearBase, 0.985],
      ].map(([s, t]) => new THREE.Vector2(s, t))
    );
    seam(
      trim.getPoints(36).map(({ x: s, y: t }) => roof(side * t, s, 0.008)),
      0.0055
    );
  }
  seam(Array.from({ length: 17 }, (_, i) => lid((i / 8 - 1) * 0.51, -0.9 + 0.015 * (i / 8 - 1) ** 2)));
  for (const s of [rearTop + 0.055, rearTop + 0.092, rearTop + 0.129, rearTop + 0.166]) {
    body.tube(
      carbon,
      Array.from({ length: 13 }, (_, i) => roof((i / 6 - 1) * 0.773, s, 0.009)),
      0.0023
    );
  }
  if (modern) {
    fascia(
      carbon,
      1,
      (t) => 0.188 + 0.018 * Math.abs(t),
      (t) => 0.322 + 0.122 * Math.abs(t) ** 2,
      0.012,
      -0.96,
      0.96
    );
    fascia(
      carbon,
      1,
      () => 0.487,
      (t) => 0.508 + 0.013 * t * t,
      0.009,
      -0.92,
      0.92
    );
    fascia(
      carbon,
      -1,
      () => 0.2,
      (t) => 0.295 + 0.029 * t * t,
      0.01,
      -0.5,
      0.5
    );
    for (const side of [-1, 1]) {
      // Exit behind the front wheel and intake ahead of the rear wheel.
      for (const [station, half, height] of [
        [-0.321, 0.035, 0.4],
        [0.294, 0.047, 0.48],
      ]) {
        body.add(
          carbon,
          patch(12, 8, (u, v) =>
            flank(side, station + (2 * u - 1) * half * (0.48 + 0.52 * v) - 0.027 * v, 0.17 + v * height, 0.006)
          )
        );
      }
      const sill = side * 0.93;
      body.tube(
        carbon,
        [
          [sill, 0.192, -0.8],
          [sill, 0.171, -0.3],
          [sill, 0.172, 0.32],
          [side * 0.966, 0.205, 0.78],
        ],
        0.037
      );
      for (let i = 0; i < 7; i++)
        body.tube(
          carbon,
          [0.33, 0.54, 0.7].map((t) => lid(side * t, 0.705 + 0.019 * i)),
          0.011
        );
    }
    // Two top-mounted swan necks hook over a slotted, above-roof rear wing.
    for (const side of [-1, 1]) {
      const x = side * 0.463;
      body.tube(
        carbon,
        [
          [x, 0.78, 1.3],
          [x, 0.91, 1.42],
          [x, 1.23, 1.75],
          [x, 1.385, 1.72],
          [x, 1.399, 1.65],
          [x, 1.35, 1.63],
        ],
        0.034
      );
      body.add(
        carbon,
        patch(10, 5, (u, v) => [
          side * (1.006 + 0.012 * v),
          1.255 + 0.052 * u + 0.137 * v + 0.024 * Math.sin(Math.PI * u),
          1.51 + 0.55 * u + 0.053 * (1 - v),
        ])
      );
    }
    for (const [start, end, height] of [
      [1.5, 1.82, 1.314],
      [1.85, 2.035, 1.342],
    ]) {
      // A closed airfoil retains a silhouette from the low chase camera.
      body.add(
        carbon,
        patch(32, 24, (u, v) => {
          const t = 2 * u - 1,
            chord = 0.5 - 0.5 * Math.cos(tau * v);
          return [
            t * 1.012,
            height + 0.034 * t * t + 0.044 * chord + 0.02 * Math.sin(tau * v) * (1.34 - chord),
            lerp(start, end, chord) + 0.075 * t * t,
          ];
        })
      );
    }
    for (let i = -2; i <= 2; i++) body.box(carbon, [0.025, 0.14, 0.36], [i * 0.246, 0.18, 2.07], -0.13);
    for (const x of [-0.099, 0.099]) body.oval(alloy, [0.079, 0.065, 0.052], [x, 0.294, length - 0.015]);
  } else {
    // The early 930 tail grows out of the engine lid and rolls up into a black lip.
    const tail = [
      [-1, 0.403, 0.778],
      [-0.63, 0.541, 0.785],
      [-0.15, 0.674, 0.828],
      [0.46, 0.715, 0.846],
      [1, 0.62, 0.861],
    ];
    function spoiler(t, s) {
      const w = profile(tail, s, 1),
        y = profile(tail, s, 2);
      return [t * w, y + 0.021 * t * t + 0.013 * (1 - t * t), 1.52 + s * 0.51 - 0.13 * Math.abs(t) ** 4];
    }
    body.add(
      paint,
      patch(32, 18, (u, v) => spoiler(u * 2 - 1, 2 * v - 1))
    );
    for (const side of [-1, 1])
      body.add(
        paint,
        patch(24, 5, (u, v) => {
          const s = u * 2 - 1,
            p = spoiler(side, s);
          return [p[0] * lerp(0.77, 1, v), lerp(0.667, p[1], v), p[2]];
        })
      );
    body.add(
      paint,
      patch(32, 4, (u, v) => {
        const p = spoiler(2 * u - 1, 1);
        return [p[0] * lerp(0.9, 1, v), lerp(0.683, p[1], v), p[2] - 0.074 * (1 - v)];
      })
    );
    const lip = [
      ...Array.from({ length: 10 }, (_, i) => spoiler(-1, -0.46 + (i * 1.46) / 9)),
      ...Array.from({ length: 21 }, (_, i) => spoiler(-1 + (2 * i) / 20, 1)),
      ...Array.from({ length: 10 }, (_, i) => spoiler(1, 1 - (i * 1.46) / 9)),
    ];
    body.tube(rubber, lip, 0.035);
    body.add(
      carbon,
      patch(16, 10, (u, v) => {
        const p = spoiler((2 * u - 1) * 0.73, lerp(-0.88, 0.24, v));
        p[1] += 0.008;
        return p;
      })
    );
    for (let i = 0; i < 11; i++)
      body.tube(
        rubber,
        [-0.7, 0, 0.7].map((t) => {
          const p = spoiler(t, -0.84 + i * 0.102);
          p[1] += 0.016;
          return p;
        }),
        0.008
      );
    fascia(
      carbon,
      1,
      () => 0.51,
      () => 0.567,
      0.017,
      -0.56,
      0.56
    );
    for (const side of [-1, 1]) {
      fascia(
        amber,
        1,
        () => 0.508,
        () => 0.56,
        0.018,
        ...(side < 0 ? [-0.966, -0.858] : [0.858, 0.966])
      );
      for (let i = 0; i < 4; i++)
        body.box(rubber, [0.018, 0.083, 0.08], [side * (0.596 + i * 0.027), 0.348, length - 0.089 - i * 0.016]);
    }
    body.oval(alloy, [0.064, 0.051, 0.092], [-0.54, 0.219, length - 0.1]);
  }
  const root = body.finish();
  if (decals) {
    const labels = [];
    function label(row, width, height, y, offset) {
      const mesh = patch(24, 4, (u, v) => bumper((2 * u - 1) * width, 1, y + (v - 0.5) * height, offset));
      const uv = [];
      for (let j = 0; j <= 4; j++) for (let i = 0; i <= 24; i++) uv.push(i / 24, 1 - (row + 1 - j / 4) / 4);
      mesh.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      labels.push(mesh);
    }
    label(modern ? 0 : 1, modern ? 0.45 : 0.52, modern ? 0.063 : 0.053, modern ? 0.558 : 0.535, 0.022);
    label(2, 0.209, 0.085, modern ? 0.407 : 0.42, 0.035);
    label(3, 0.15, 0.05, modern ? 0.482 : 0.476, 0.023);
    const lettering = new THREE.MeshStandardMaterial({
      map: decals,
      transparent: true,
      alphaTest: 0.17,
      depthWrite: false,
      roughness: 0.57,
      side: THREE.DoubleSide,
    });
    root.add(new THREE.Mesh(mergeGeometries(labels), lettering));
  }
  for (const [index, z] of axles.entries())
    for (const side of [-1, 1]) {
      const width = modern ? (index ? 0.316 : 0.272) : index ? 0.23 : 0.206;
      const tire = wheel(radius, width, modern, side);
      tire.position.set(side * ((modern ? (index ? 0.997 : 0.956) : index ? 0.89 : 0.853) - width * 0.52), radius, z);
      tire.name = 'wheel_' + (index ? 'r' : 'f') + (side < 0 ? 'l' : 'r');
      root.add(tire);
    }
  return root;
}
