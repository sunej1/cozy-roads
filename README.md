# Cozy Roads

A local Three.js driving prototype. **The Open Road** keeps generating a road through lake basins, pine forests, rolling hills, and alpine mountains as you drive.

## Run locally

Use Node.js 20.19 or later in the 20.x line, or Node.js 22.12 or later. The game opens in Cinematic on WebGPU and Standard on the automatic WebGL 2 fallback. Add `?renderer=webgl` to force the fallback for testing.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Use **W** to accelerate, **A/D** to steer, and **S** to brake. Hold **S** from a stop to reverse. The arrow keys and touch controls do the same. **Esc** pauses the drive. Manual steering works on and off the road. Choosing **Auto-drive** from a pause brings the car back to the road at its current point along the route.

## Explore a world

The default seed is `83472`. Choose **New world** from the start or pause screen to generate another seed. Share or reload the resulting URL to reproduce its road and scenery. You can also enter a seed directly, for example `?seed=275`. **Restart** returns to the beginning of the current seed.

Landscape types blend along a continuous height field. Lakes occupy enclosed basins, and the road follows the same elevation as the terrain beneath it. A Web Worker samples upcoming terrain in 128 m rows. Terrain streams in the direction you turn and extends sideways in bands as you move away from the road. The renderer releases meshes outside the active window. Farther ridges use streamed, elevation-derived geometry with detail selected by projected height error. Standard and Cinematic stream mountain pages out to 7.8 km and Low to 5 km. [Terrain rendering research and implementation](docs/terrain-rendering.md)

## Vehicles

Select a vehicle on the start or pause screen. The **Wayfarer** family wagon feels predictable on gravel. **Redline 92** is a retro coupe with quick turn-in. **Vela** pulls hardest on pavement but loses more traction on rough ground. The **Ridgeline 4×4** keeps climbing on steeper slopes and can cross deeper shallows. Deep water limits each vehicle's progress.

## Measure a drive

1. Open **Performance** and choose a quality preset.
2. Click **Run benchmark**. After the renderer warms up, the game drives the current seed's opening 600 m at 72 km/h for 30 seconds.
3. Click **Save JSON** to keep the frame samples, world seed, vehicle, preset, backend, output resolution, and range of internal render scales. Use the same seed, vehicle, viewport, and device pixel ratio to compare presets.

The measurements are elapsed time between browser animation callbacks. They include display pacing and browser overhead. The panel shows rolling FPS, median frame time, and p95 while driving. The benchmark also reports p99 and the count of frames longer than 33.3 ms. A tab switch or viewport resize cancels an in-progress run.

| Preset | Rendering |
| --- | --- |
| Standard | Surveyed mountain relief, slope-dependent snow, distant forest stands, volumetric clouds, terrain and cloud shadows, layered meadow grass that bends under the tires, wind-animated trees, and planar lake reflections. |
| Cinematic | Screen-space diffuse bounce and ambient occlusion, ray-marched sunbeams, and HDR bloom in addition to Standard. Begins rendering at full resolution, can reduce each internal dimension to 90% under sustained load, and temporally reconstructs to the fixed output size. Requires WebGPU. |
| Low | Shorter draw distance, fewer trees, lower internal resolution, and simpler terrain, water, and lighting. |

The drive, speed, and starting point are shared across presets.

## Art credits

Cozy Roads blends public-domain USGS elevation samples from Mount Shuksan into its procedural world. The meadows, trees, rock faces and gravel shoulders use adapted Poly Haven assets. Poly Haven also supplies the reflection panorama, asphalt and mossy boulders. [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) · [Art credits and sources](public/art-credits.txt) · [Poly Haven CC0 license](https://polyhaven.com/license)

The Wayfarer, Redline 92 and Ridgeline use Comrade1280’s *Generic passenger car pack*. Cozy Roads converts the meshes to glTF, adjusts scale and paint, and rigs the wheels and brake lights. [Original models](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5) · [Source distribution](https://github.com/TUM-VT/Sumonity-PassengerCars) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

The Vela uses the *Collect Cars* hypercar by drcollect. Cozy Roads simplifies the geometry, changes the finish and lights, and rigs the wheels. [Original model](https://github.com/drcollect/collect-cars) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Verify and build

```sh
npm test
npm run build
npm run preview
```
