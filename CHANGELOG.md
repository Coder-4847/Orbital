# Changelog

Newest first. One line per notable change.

## 1.1.2 — The numbers during the orbit burn no longer look like a failure
- Found by the owner: with apoapsis at 106 km the Periapsis read "-5.4 Mm" and the flight looked lost. Flying the guide in the browser gave exactly those numbers: during the whole "Gain speed" burn the apoapsis sits near 106-108 km and the periapsis stays about -5 Mm underground, then jumps to +90 km in the last 5 seconds. It was correct physics but nothing said so.
- The "Gain speed for orbit" card now says Periapsis reading "underground" is normal until the last seconds, and its status line and bar show the figure that does move steadily: speed around the Earth against the speed a circular orbit needs ("Speed 4.0 km/s of 7.9 km/s"). It used to show a bar from surface speed over a fixed 7.6 km/s.
- The HUD Periapsis reads "underground" instead of a negative distance; distances of thousands of km read "5,360 km" instead of "5.36 Mm" (the debug overlay still uses Mm). How to play no longer says to "watch Periapsis climb".

## 1.1.1 — The first orbit no longer runs out of fuel
- Fixed: **players ran out of fuel on the periapsis step and could not reach orbit.** Two causes. (1) Above 55 km the guide asked for a nose angle that kept the rocket climbing at about 900 m/s instead of building sideways speed; it now holds the altitude near 110 km (`ascentPitch`: lower the nose while climbing fast, down to 5 degrees below the horizon, raise it when sinking). (2) Pathfinder had a weak 110 kN upper stage and only about 1 t of fuel to spare; it is now a 2.5 m rocket (Titan-2500 under three tanks, Vac-600 upper stage) with 4 to 7 t to spare for the careful, average and clumsy simulated players. In the browser, flown by a script that only reads the guide, the Pathfinder reaches an 86 x 600 km orbit.
- The guide warns when fuel is almost gone and the orbit is not made, and says to restart; the orbit step needs the periapsis 3 km clear of the air so cutting the engine at once is safe; the descent step no longer flickers to "Re-entry" at touchdown.
- Verified end to end in the browser: launch, orbit, then (from a teleported orbit) the retrograde burn, staging down to the capsule, re-entry, parachutes and touchdown with all four parts intact; Hangar to Launch, map, quick save and load, six preset switches, Explorer, Settings, About, and the WebGL 2 backend, with no console errors.

## 1.1.0 — Launch site, graphics and a guide to flying
- Fixed: **the launch pad stood on a round sand island in the open sea.** The baked heightmap has one grey step per ~35 m and the bake treats anything under about 70 m as ocean, so Florida and the whole coastal plain of the south-east United States were missing; only the levelled disc under the pad stood above the water. `terrain/lowlands.ts` adds hand-traced outlines of low plains (Mobile to Virginia Beach, with Lake Okeechobee) that `EarthSource` turns into low, humid land with a fractal coast, dunes, lagoons and a proper shelf offshore. Other low coasts of the world are still missing (see MEMORY, section 8).
- Fixed: **the launch complex was visible from space** (drawn out to 300 km, on a bright disc). It is now drawn within 60 km only, and its ground no longer contrasts with the land around it.
- Launch complex rebuilt: octagonal hardstand on a gravel apron, perimeter road, four lightning masts, flood-light towers, a water tower, horizontal tanks, a crawlerway to a vehicle assembly building with a launch-control wing, and 1,500 scrub bushes for a sense of scale.
- Earth surface: vegetation is patchy at 25 km and 3 km scales (direction-based noise, never tiles); the coarse detail no longer shows as a grid from the air (two non-commensurate scales that fade out sooner); sand is a strip at the waterline instead of everything under 10 m.
- Engine plumes: lathe-shaped shells that fade at their silhouette, with streaming knots and shock diamonds at sea level, instead of two hard cones.
- **Flight guide** (`flight/guide.ts`, `ui/flight/guide-panel.ts`, `scenes/flight-guide.ts`): a card that is always on screen in flight and says the one thing to do next with the player's own key names: throttle, lift off, climb, lean over (with the nose angle to aim for right now), stage, gain speed (steering by vertical speed), orbit, then deorbit, re-entry, parachutes and landing. A row of phases shows where the flight is. Switch in the HUD top bar and in Settings; the hints it makes redundant are suppressed while it is on.
- **How to play** pages (main menu, pause menu, HUD, the guide's ? button): what the game is, a first flight step by step, what every part of the screen means, the map, coming home and a glossary.
- HUD readouts show a short list by default (altitude, vertical speed, apoapsis, periapsis, time to apoapsis, attitude, propellant) with More for the rest; every row has a tooltip that explains it.
- New default rocket **Pathfinder** (`starterCraft`): thrust-to-weight about 1.25, about 11 km/s of delta-v, heat shield and both parachutes on a capsule that separates. Sparrow-1 reached orbit only with near-perfect steering and had no heat shield. A double tap on Stage within 0.7 s no longer drops the stage that has just lit.
- Tests: 281. `tests/guide.test.ts` checks the guide's rules and flies the starter rocket to orbit with three simulated clumsy players who only do what the guide says.

## 1.0.0 — Phase 8: optimisation, bug fixes and release
- Memory: terrain chunks now drop their CPU copy of the vertex data once the renderer has uploaded it (`TerrainBody.releaseUploaded`, `render/uploaded.ts`), and Earth chunks no longer keep the `aSurfB` attribute their material never reads. JavaScript heap in flight at High went from about 830 MB to 575 MB (Medium about 400 MB).
- Bundle: three.js is its own cacheable chunk (about 960 kB, 262 kB gzipped); the application entry is 33 kB. Everything still loads from relative URLs.
- First run: the graphics preset is chosen from the GPU (`suggestPreset`: discrete GPUs High, integrated or unknown Medium, software renderers Low); saved settings are never touched.
- Fixed: **black screen after changing the graphics preset in flight** (WebGPU validation error "depth texture used as attachment and binding") when shadows came on while MSAA came on, or when the shadow map size changed: the sun light is now replaced when its shadow map changes size and shadow changes wait a quarter of a second after a pipeline rebuild. Preset switching was stress-tested through every scene.
- Fixed: **exhaust smoke and fire sprites ignored their fade** (an `opacityNode` replaces `material.opacity`), so the pad was buried in opaque white puffs at lift-off; they now fade and dissolve.
- Fixed: **exposure leaked between scenes**: leaving the Explorer at Saturn (exposure about 90) or a night-side Moon landing left the next scene (Hangar, menu) blown out; the exposure resets whenever a scene exits.
- Pad camera moved to the east side of the rocket and closer, so the whole tower, spheres and rocket are in frame; the Hangar toolbar stays on one row down to 1000 px wide.
- `flight-scene.ts` split: depth range (`flight-depth.ts`), time stepping (`flight-time.ts`), event handling (`flight-events.ts`), HUD and sound readouts (`flight-readouts.ts`), camera mouse input and shadow marking moved out (653 to 570 lines).
- Release: GitHub Actions workflow that tests, builds and deploys to GitHub Pages; `.nojekyll`; README with screenshots, performance guide and exact push and Pages steps; verified from a `/orbital/` subpath including workers, data and fonts.
- Tests: 270 (time stepping, readouts, GPU preset suggestion on top of the earlier suites).

## 0.7.0 — Phase 7: saves, settings, cheats, audio and polish
- Save system: named slots in IndexedDB with a screenshot thumbnail, in-game date and last-played time; quick save / quick load (F5 / F9); an autosave every two minutes and when leaving a flight; Continue on the main menu loads the latest; save and load dialog with overwrite, delete, export to a file and import. A saved flight holds every vessel with every part's state, the body and universal time, the maneuver nodes and target, and the launch craft (so "restart on the pad" still works). Versioned schema with a migration chain; saves from a newer game or with parts that no longer exist are refused with a readable message.
- Settings: Controls tab with full key rebinding for flight (a used key swaps with its owner; Shift/Ctrl match either side), mouse sensitivity and invert, optional gamepad with dead zone; Graphics gains shadow quality and effects density; Gameplay gains hints (and a reset) and the units switch now works (metric / imperial in the HUD, map and node editor); frame cap, FOV, resolution scale, bloom, clouds, terrain and UI scale already worked. Settings schema 2 (old files migrate).
- Cheats menu (F10, pause menu, also in the Hangar): unlimited fuel, unlimited charge, maximum engine power, no crash damage, no re-entry heating, no aerodynamic forces, zero gravity, maximum time warp, unlimited building space, unlock all parts (always on: there is no progression), debug overlay; refuel and repair; teleport to a circular orbit around any body at any altitude; teleport to the ground at any latitude and longitude on any rocky body, or to the launch pad; jump the universal time to a date. A badge in the HUD says cheats are on.
- Audio (all synthesised): shared mixer with master / effects / ambience / music buses following the settings; UI clicks, hovers, toggles, confirmations and dialogs by event delegation; engine, wind and rumble through the mixer; one-shots for staging, separation, ignition, explosions, touchdown and parachutes; generative ambient music (modal chords on a pad, bells, drone, long reverb) that ducks under engines and changes mood per scene. Mute moved to V.
- Pause menu (resume, save and load, quick save/load, settings, controls reference, cheats, restart, Hangar, main menu); first-time hints (Hangar, pad, gravity turn, empty stage, orbit, map, nodes, burn, new sphere of influence, re-entry, parachutes, legs, landing) shown once each; a loading card with tips between scenes; chase camera; shadows of the vessel and the launch pad; dialogs now centre correctly with tall content.
- Tests: 262.

## 0.6.0 — Phase 6: orbital navigation, maneuvers and interplanetary travel
- Patched-conic trajectory prediction (`flight/trajectory.ts`, pure): Kepler propagation with exact apsis-based crossing times, sphere-of-influence entry and exit for every body (conservative stepping that cannot skip a sphere), impact and "rails floor" detection, closest approach to a target, up to 8 patches, maneuver nodes applied on the way.
- Maneuver nodes with a prograde / normal / radial editor: burn estimate (time and stage delta-v), SAS "Mnv" mode that points at the burn, a navball maneuver marker, a HUD banner with the countdown, burn guidance from delivered delta-v (a burn can start early and still finish on target).
- Time warp on rails (`flight/navigator.ts`, `flight/warp.ts`): analytic orbit propagation at up to 100,000x with sphere-of-influence hand-overs, automatic stop at the top of the air or near the ground, refusal while engines run; physics warp 1-4x as before; "warp to" node / apoapsis / periapsis / SOI change with a slow-down on approach.
- Flight map (M): the solar-system map with the vessel's patched path, apsis / encounter / escape / impact / node markers, click the orbit to add a node, node editor, target body with closest-approach marker, warp shortcuts.
- Many bodies: a vessel hands over between the Earth, Moon, Sun and every planet and moon (`FlightWorld.switchBody`, state kept heliocentrically); per-body flight environments (gravity, spin, air, crush pressure, ground from the same terrain function the renderer draws); lighting and exposure per body; landing, take-off and rest on any rocky world.
- Re-entry heating (`flight/heating.ts`): Sutton-Graves stagnation heating with wall-enthalpy limiting, shielded rear parts, radiative cooling, ablative heat shields that burn away, parts destroyed above their limit; plasma glow and a hot trail on the leading end; hull-heat readout. Part temperature limits lowered to realistic values.
- Gas giants have no ground and crush a vessel at 120 bar (Venus's surface is survivable).
- Parachutes: a drogue chute for fast air and a main chute for landing (the drogue stacks on the main); heat shields tolerate harder landings.
- New parts: Saturn-12000 (12 MN) first-stage engine and Vac-1500 upper-stage engine. New examples: **Selene** is now a complete 950 t Moon mission (two-stage launcher, transfer stage, lander with legs, capsule with heat shield and drogue) and **Selene module** is its 40 t Moon part, for starting in orbit. Hangar height limit raised to 130 m.
- Pause menu cheat: skip to a 200 km circular Earth orbit. Mute moved to V (M is the map).
- Fixes found on the way: the launch crash (stale planet orientation in terrain lookups, see 0.5.0), rails stopping exactly at the floor, node horizons, SOI re-entry roundoff, HUD buttons no longer take focus.
- Tests: 229 (patched-conic maths against the ephemeris, Moon encounter found from a trans-lunar burn, rails and hand-overs, heating and shields, crush depth, Mars entry, and `moon-mission.test.ts`: a scripted pilot flies the Selene module from low Earth orbit through trans-lunar injection, a mid-course correction, rails to the Moon, lunar orbit insertion, deorbit, a powered landing on legs, take-off, lunar orbit, trans-Earth injection, rails home, re-entry on the heat shield and a parachute landing; plus the Selene launcher reaching orbit from the pad).

## 0.5.0 — Phase 5: launch and atmospheric flight
- Flight scene (Hangar → Launch): a launch complex at Cape Canaveral (levelled terrain, pad, adaptive service tower, lightning mast, service building, spheres), launch at about 08:30 local solar time, sunlight and sky ambient from the same atmosphere model the terrain uses.
- Vessel physics (pure, `src/flight`): 6-DOF rigid body in the planet-centred inertial frame at a fixed 120 Hz (up to 4× physics warp), per-part mass/inertia, thrust and Isp that vary with ambient pressure, propellant pools per stage segment and fuel kind, gimballing, throttle, ion-engine power draw, solid boosters, stage activation (decouplers carve the craft into separate vessels with a small separation impulse).
- Aerodynamics per part: axial and cross-flow drag, normal force through each part's centre of pressure, fins with control deflection, Mach drag rise, US-1976 atmosphere; parachutes (arm, semi-deploy, full deploy) and landing legs.
- Attitude control: reaction wheels, RCS (rotation and translation), engine gimbal, fin control surfaces, SAS (stability, prograde, retrograde, normal, anti-normal, radial in/out) blended with pilot input.
- Ground contact against the same terrain height function the renderer uses (plane fit, spring-damper, viscous-capped friction), crash tolerance per part, structural joint loads (axial, shear, bending): a rocket that folds, tumbles or lands too hard breaks into debris.
- Cameras (orbit, pad, nose), flight HUD (stage list, SAS/RCS/legs/brakes/chutes buttons, throttle bar, surface readouts, orbit readouts), software-rendered navball with prograde/retrograde/normal/radial markers, messages feed and a pause menu.
- Procedural engine, rumble and wind sound (Web Audio), engine plumes that grow in vacuum, smoke, explosions, sparks.
- Input: keyboard (W S A D Q E, Shift/Ctrl, Z X, Space, T Y U R G B P C, I K J L H N, , . /) and optional gamepad; `?pad=off` disables the gamepad (for automated testing).
- Explorer (Phase 2 free camera) moved to its own menu entry.
- Fixes found on the way: terrain height lookups used a render-time orientation cache, so the ground looked 4 m underground for the first frames and the rocket's engine tore off at liftoff (`Planet.surfaceHeightUnder` now uses the current orientation); joint loads ignored ground-contact forces; friction chatter at rest; HUD buttons stole Space presses (they no longer take focus).
- Tests: 201 (rocket in vacuum matches the Hangar's delta-v within 1%, weathervane stability, tumble and breakup of an unfinned rocket, an under-powered rocket stays on the pad, landing with legs, parachute descent, scripted ascent reaching a stable orbit, navball maths, pad terrain).

## 0.4.0 — Phase 4: rocket builder (Hangar)
- Hangar scene: orbit camera (right-drag orbit, middle-drag pan, wheel zoom), PBR-lit studio with image-based lighting, procedural part meshes (no model files).
- 51 parts in 13 categories: command pods, tanks (1.25 / 2.5 / 3.75 m, several lengths, xenon), engines (small upper stage, vacuum, sea-level, high-thrust booster, heavy, 2.5 m vacuum, ion, solid booster), decouplers (stack + radial), nose cones and fairing, adapters, fins and control fins, landing legs, parachutes, heat shields, solar panels and batteries, RCS, reaction wheels.
- Attachment nodes with size matching, flip, side attachment with grid snapping, boosters hung on radial decouplers; symmetry 1x/2x/3x/4x/6x/8x (copies are edited, rotated, moved and deleted together); rotate, slide, copy/paste, delete, undo/redo.
- Live stats: mass, size, centre of mass and pressure (with markers), stability, per-stage delta-v (vacuum and sea level), thrust-to-weight and burn time from a staged burn simulation (boosters drop when spent, carried-over engines keep burning); advice for common mistakes.
- Staging editor with auto-staging from the structure, drag parts between stages, reorder stages, drop for a new stage.
- Craft save/load (IndexedDB), JSON export/import with validation and readable errors, autosave and restore on reload, three example crafts (orbital rocket, Moon lander stack, heavy interplanetary stack).
- "Unlimited building space" cheat lifts part-count, size and mass limits.
- Fixes found on the way: WebGL2 fallback now uses standard depth; Saturn rings used the wrong radius units.
- Tests: 173 (rocket equation against hand calculations for single/serial/parallel stages, geometry of stacking and symmetry, copy/paste, snapping, staging, history, limits, serialization, storage, editor).

## 0.3.0 — Phase 3: the whole solar system on rails
- All 21 bodies (Sun, 8 planets, Moon, Mars/Jupiter/Saturn moons, Pluto) with real radii, GM, IAU pole/rotation; planets from JPL Standish elements, Earth-Moon barycentre offset, Moon with Meeus perturbation terms (2024 eclipse axis hits Earth in a test).
- Pure physics library (`src/physics`): Kepler solver (elliptic + hyperbolic), elements <-> state vectors, universal-variable propagation, SOI radii, orbit points; 14+ tests.
- Time: universal time with warp ladder 1x..10,000,000x (map) and jump-to-date; positions are analytic in UT so warping and jumping are exact.
- Generic procedural terrain for 11 rocky/icy worlds, banded gas/ice giants, emissive Sun with limb darkening, Saturn rings (analytic profile, planet shadow on rings, ring shadow on planet).
- Atmospheres for Venus (opaque deck shell), Mars, Titan, plus gas giants, switched at runtime in one full-screen pass; exposure follows sunlight at each body's distance.
- Eclipses (exact disc overlap) on surfaces, water glint and atmosphere in-scatter; point markers for unresolved bodies.
- Map view (M): orbit lines, labels, info card, focus switching (click/Tab), smooth log zoom, Enter flies there.
- Fixes: exposure/fade multiplied alpha (canvas clamped everything below exposure 1); WebGL2 fallback now uses standard depth (float MSAA depth blit failed); ring radius units.
- Tests: 129.

## 0.2.0 — Phase 2: planet rendering (space, atmosphere, terrain)
- Real-scale Earth and Moon on a cubed-sphere quadtree: 64x64-cell chunks generated in 3 Web Workers, skirts, horizon culling, streaming with no holes, LRU eviction.
- Earth from real NASA elevation + anti-aliased coastlines + synthetic bathymetry + fractal detail down to ~0.6 m; biomes, snow, ocean depth colours, sun glint, waves, night-side city lights from Natural Earth data.
- Moon with real maria/landmark-crater positions, procedural crater population, regolith detail and opposition surge.
- Floating origin (camera at the render-space origin, doubles on the CPU) and reversed-Z float depth: no jitter from 6 Mm to 2 m; fallback for browsers without reversed-Z.
- LUT-based atmosphere (Rayleigh + Mie + ozone) ray-marched per pixel: blue sky, sunsets, glowing limb, aerial perspective, planet-shadow terminator; validated against a CPU reference.
- Procedural cloud deck composited inside the atmosphere integral, with self-shadowing and cloud shadows on the ground.
- Stars, Milky Way and the Sun at true angular size; daylight hides the stars; the Moon and Sun are depth-correct.
- Perceptual auto-exposure (twilight curve) and bloom-after-exposure; HDR pipeline unchanged on WebGL2.
- Explorer scene (Launch): free-fly camera with altitude-scaled speed, horizon levelling, ground collision, reference-frame anchoring, 8 teleport presets, time warp, F3 overlay with CPU/GPU timing.
- Settings: terrain detail and atmosphere/cloud quality; Low/Medium/High/Ultra presets now drive LOD split distance and ray-march samples.
- Tests: 74 (cube sphere seams and winding, height sources on real data, chunk builder, skirt-covers-crack guarantee, LOD rules, floating-origin precision, atmosphere maths, ephemeris).

## 0.1.0 — Phase 1: foundation, UI shell, main menu
- Live 3D main menu: Earth limb with ray-marched atmosphere, sun glare, procedural stars and Milky Way, rocket silhouette, slow camera drift.
- Scene manager with fade transitions between Menu, Hangar (placeholder) and Flight (placeholder); scenes are code-split.
- WebGPU renderer with automatic WebGL2 fallback (same TSL materials), friendly "can't start graphics" message, `?backend=webgl2` override.
- Post pipeline: MSAA HDR scene pass, bloom, exposure/fade uniforms, ACES tone mapping; guards against zero-size canvas.
- Internal UI kit: buttons, sliders, toggles, segmented controls, tabs, tooltips, focus-trapped modals; dark space-themed design tokens; bundled fonts.
- Settings dialog (Graphics, Audio, Controls, Gameplay, Interface) with quality presets, persisted to localStorage with versioned migration.
- Storage layer: IndexedDB wrapper and SaveRepository (slots, list/get/put/delete, export/import, schema migrations).
- Game loop with fixed 120 Hz accumulator, frame cap and FPS stats.
- Vitest suite (27 tests) covering settings, saves, time utilities, events/store, GPU-name cleanup.
- Static-hosting ready: relative `base`, configurable via `ORBITAL_BASE`; production build is ~1.1 MB.
