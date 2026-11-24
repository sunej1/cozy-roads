# Cozy Roads

A Three.js driving game. **The Open Road** keeps generating a road through lake basins, pine forests, river valleys, alpine mountains, and coastal fjords as you drive. [Play Cozy Roads](https://sunej1.github.io/cozy-roads/)

## Run locally

Use Node.js 20.19 or later in the 20.x line, or Node.js 22.12 or later. The game opens in Cinematic on WebGPU and Standard on the automatic WebGL 2 fallback. Add `?renderer=webgl` to force the fallback for testing.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Use **W** to accelerate, **A/D** to steer, and **S** to brake. Hold **S** from a stop to reverse. The arrow keys and touch controls do the same. Hold **Q/E** or drag the scenery to glance sideways. Release to face the road again. Looking around also works during auto-drive. **Esc** pauses the drive. Manual steering works on and off the road. Gravity changes your speed on slopes. The suspension absorbs small crests. A fast drop can still lift all four tires, and steering takes effect again at contact. Choosing **Auto-drive** from a pause brings the car back to the road at its current point along the route.

## Explore a world

The default seed is `83472`. Choose **New world** from the start or pause screen to generate another seed. Share or reload the resulting URL to reproduce its road and scenery. You can also enter a seed directly, for example `?seed=275`. Ordinary visits and **Restart** pick a random road position. Resume keeps your position, and the trip meter starts at zero for each new drive. Add `start` in metres to replay a particular departure, such as `?seed=83472&start=6050` for a fjord.

Gravel pullouts overlook lakes and fjords. On the default seed, start at 90 m to approach a lakeside bench or at 4,920 m to follow a river. Auto-drive keeps to the right-hand lane. Double centerlines mark sharp bends and blind crests.

Landscape types blend along a continuous height field. Rivers descend from springs into lake basins. Alternating groups of landscapes include inland lakes and steep-sided coastal inlets with an open passage to the sea. In long gaps between basins, the road leaves the valley, climbs a mountainside, crosses the drainage divide through a saddle and descends along a different tributary. Foam drifts through river bends and separates around exposed boulders. [Approach a mountain pass](https://sunej1.github.io/cozy-roads/?seed=83472&start=2280) · [Drive the fjord shore](https://sunej1.github.io/cozy-roads/?seed=83472&start=6050)

A Web Worker samples upcoming terrain in 128 m rows. Terrain streams in the direction you turn and extends sideways in bands as you move away from the road. The renderer releases meshes outside the active window. Farther ridges use streamed, elevation-derived geometry with detail selected by projected height error. Standard and Cinematic stream mountain pages out to 13.6 km and Low to 7.6 km. The outer ridgelines use coarser interiors and keep the detailed edges where neighbouring pages meet. Snow collects in sheltered bowls and gullies. [Terrain rendering research and implementation](docs/terrain-rendering.md)

The **Look** selector on the start and pause screens switches between **Cozy** (peach horizons, sage grass and softer rock detail) and **Classic**. It remembers your choice on this browser.

Use **Season** and **Time** on the start or pause screen. Dawn and dusk cast long shadows from opposite sides of the landscape. Headlights come on at dusk and at night. Winter covers the road and meadows with snow. Driving compacts it under each tire and pushes loose snow into ridges. Returning to a recently driven area reveals the tracks again. Changing season away from winter, restarting, or reloading clears the snow history. Season and time are included in the share URL. [Winter at dawn](https://sunej1.github.io/cozy-roads/?seed=83472&start=2280&season=winter&time=dawn)

## Vehicles

Select a vehicle on the start or pause screen. The **Wayfarer** family wagon feels predictable on gravel. **Redline 92** is a retro coupe with quick turn-in. **Vela** pulls hardest on pavement but loses more traction on rough ground. The **Ridgeline 4×4** keeps climbing on steeper slopes and can cross deeper shallows. The **Porsche 911 Turbo (930)** has a low whale tail, flared arches and a short wheelbase. The **Porsche 911 GT3 RS** has an above-roof, twin-element rear wing, quicker steering and lower clearance. Entering water deeper than the vehicle can ford returns it to the nearby road and preserves the trip distance.

## Measure a drive

1. Open **Performance** and choose a quality preset.
2. Click **Run benchmark**. After the renderer warms up, the game drives the current seed's opening 600 m at 72 km/h for 30 seconds.
3. Click **Save JSON** to keep the frame samples, world seed, vehicle, season, time of day, preset, backend, output resolution, and range of internal render scales. Use the same seed, vehicle, viewport, and device pixel ratio to compare presets.

The measurements are elapsed time between browser animation callbacks. They include display pacing and browser overhead. The panel shows rolling FPS, median frame time, and p95 while driving. The benchmark also reports p99 and the count of frames longer than 33.3 ms. A tab switch or viewport resize cancels an in-progress run.

| Preset | Rendering |
| --- | --- |
| Standard | Surveyed mountain relief, slope-dependent snow, distant forest stands, volumetric clouds, terrain and cloud shadows, layered meadow grass that bends under the tires, wind-animated trees, softened planar reflections on lakes, and depth-dependent ripples that drift with the river current. |
| Cinematic | Traces short sun-contact rays and reflection rays against the visible depth buffer. Water and polished materials receive screen-space reflections. Planar water and environment reflections supply off-screen scenery. Also includes diffuse bounce, ambient occlusion, sunbeams and HDR bloom. Begins rendering at full resolution, can reduce each internal dimension to 90% under sustained load, and temporally reconstructs to the fixed output size. Requires WebGPU. |
| Low | Shorter draw distance, fewer trees, lower internal resolution, and simpler terrain, water, and lighting. |

The benchmark always begins at station zero on the selected seed and restores your drive afterward.

## Art credits

Cozy Roads blends public-domain USGS elevation samples from Mount Shuksan into its procedural world. The meadows, trees, rock faces and gravel shoulders use adapted Poly Haven assets. Poly Haven also supplies the reflection panorama, asphalt and mossy boulders. [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) · [Art credits and sources](public/art-credits.txt) · [Poly Haven CC0 license](https://polyhaven.com/license)

The Wayfarer, Redline 92 and Ridgeline use Comrade1280’s *Generic passenger car pack*. Cozy Roads converts the meshes to glTF, adjusts scale and paint, and rigs the wheels and brake lights. [Original models](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5) · [Source distribution](https://github.com/TUM-VT/Sumonity-PassengerCars) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

The Vela uses the *Collect Cars* hypercar by drcollect. Cozy Roads simplifies the geometry, changes the finish and lights, and rigs the wheels. [Original model](https://github.com/drcollect/collect-cars) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

The 1975 Turbo uses Lionsharp Studios’ 930, and the GT3 RS uses Black Snow’s 992 with mesh preparation from Gioele Dalla Pozza’s configurator. Cozy Roads simplifies the meshes and textures, adjusts finishes and fits the wheel and brake-light rigs. [1975 Turbo model](https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e) · [GT3 RS model](https://sketchfab.com/3d-models/porsche-gt3-rs-e738eae819c34d19a31dd066c45e0f3d) · [Configurator](https://github.com/gioeledallapozza/porsche-gt3rs-configurator) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Verify and build

```sh
npm test
npm run build
npm run preview
```
