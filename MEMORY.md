# ORBITAL — project memory

Single source of truth between sessions. Read first; update after every meaningful task.

## 1. Project summary
Orbital is a browser-based 3D spaceflight simulator: build rockets in a Hangar, launch from a real-scale Earth, reach orbit, plan
patched-conic trajectories on a map, travel the real solar system. Pure static web app (no backend), built to deploy on GitHub Pages (repo Coder-4847/Orbital).
The full spec is the "ORBITAL — Master Prompt" the user supplied (8 phases). Work one phase at a time; stop and report after each; wait for "continue".

## 2. Tech stack and versions
- Vite 8.3 + TypeScript 7.0 (strict, `noUncheckedIndexedAccess`), Node 24, npm 11
- three.js r186 (`three/webgpu` WebGPURenderer + TSL node materials). **One code path**: WebGPURenderer auto-falls back to its WebGL2 backend, same TSL graphs run on both.
- Vitest 5 (+ `fake-indexeddb`, `pngjs` for loading baked rasters in tests), `@types/node`
- Fonts vendored (latin subset only, SIL OFL): Inter variable + JetBrains Mono variable in `src/assets/fonts/`
- Baked data (committed, public domain) in `src/assets/data/` (~1.4 MB): `earth-elevation.png` 4096x2048, `earth-land.png` 4096x2048 (anti-aliased coast coverage),
  `earth-coast.png` 1024x512 (ocean distance to coast), `earth-lights.png` 1024x512 (city density). Sources: NASA Visible Earth 73934 heightmap
  (via Wikimedia Commons), Natural Earth populated places. Re-bake with `tools/bake-earth-data.py` / `tools/bake-lights.py` (Python + Pillow + numpy; see script headers).
- Web Audio (synthesised, no files); GitHub Actions workflow in `.github/workflows/deploy.yml` (Pages)

## 3. How to run / build / test / deploy
```
npm install
npm run dev            # http://localhost:5173  (also: preview_start "orbital-dev" via .claude/launch.json)
npm test               # vitest run (281 tests; the Moon mission test takes ~15 s)
npm run typecheck
npm run build          # tsc --noEmit && vite build -> dist/  (~2.5 MB: 1 MB code, 1.4 MB data, 90 KB fonts)
npm run preview
ORBITAL_BASE=/repo/ npm run build   # optional absolute base; default './' (relative) works at any subpath
```
URL flags (dev & prod): `?backend=webgl2` forces compatibility renderer; `?depth=standard` disables reversed-Z (tests the fallback);
`?profile` enables GPU timestamp queries in production builds (always on in dev); `?raf=timer` drives animation from timers (only for hidden/headless
browser panes where requestAnimationFrame is paused — the Claude desktop Browser pane is often hidden, so use this when verifying visually); `?pad=off` ignores gamepads (the user's DualSense is plugged in and its stray presses staged the rocket during automated tests: ALWAYS use `?raf=timer&pad=off` when testing flight).
Dev only: `window.__orbital = { ctx, loop }`. Scene internals: `__orbital.ctx.scenes.current` (e.g. `.system`, `.free`, `.camera`).
Handy dev snippets: teleports via `window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit2'}))`; custom viewpoints via
`const t = await import('/src/flight/teleport.ts'); t.placeOver(s.free, s.system.earth, lon, lat, alt, pitch, heading); s.ut = t.solarTimeAt(s.ut, lon, hour)`.
Deploy: push to `main` on GitHub with Pages source set to "GitHub Actions"; the workflow tests, builds and publishes `dist/` (see README, "Deploying to GitHub Pages").

## 4. Architecture
```
index.html            boot splash (#boot), #app (canvas), #ui-root (DOM UI), test hook for ?raf=timer
vite.config.ts        base from ORBITAL_BASE (default './'), __APP_VERSION__ define, vitest config
src/main.ts           boot: settings -> Gfx.create -> GameLoop -> AppContext -> SceneManager -> menu
src/core/             keymap (flight actions + default key bindings, rebinding), units (metric/imperial formatting), events, store, loop (GameLoop: fixed 120 Hz accumulator + frame cap, stats), scene-manager (GameScene, AppContext, fades),
                      time (UT <-> date, J2000), apply-settings, ephemeris-lite (Earth spin, Sun, circular Moon: REPLACED in Phase 3)
src/data/quality.ts   Low/Medium/High/Ultra preset values (pure data)
src/terrain/          PURE (no three): cube-sphere (faces, nodes, keys, lon/lat), noise (simplex3, fbm), types, sampling (equirect raster),
                      earth-source (real data + fractal detail, climate), lowlands (hand-traced coastal plains the heightmap misses: Florida and the US south-east), moon-source (maria, named + procedural craters),
                      chunk-builder (64x64-cell chunks, skirts, normals from the height field), lod (split/horizon rules, quality table)
                      RENDER-SIDE: terrain-data (decode PNGs), chunk-worker + worker-pool + worker-protocol (Web Workers),
                      terrain-body (quadtree selection, streaming, eviction, meshes)
src/render/           gfx (renderer, RenderPipeline: MSAA scene pass -> compose hook -> exposure -> bloom -> fade; reversed-Z, GPU timing),
                      atmosphere-model (CPU Earth atmosphere, transmittance, exposure curves), atmosphere-lut (GPU transmittance LUT bake + lookup),
                      atmosphere-lighting (sun colour + sky ambient at a point), atmosphere-pass (full-screen ray march + clouds composite),
                      clouds (procedural cloud shell), terrain-material (Earth + Moon shaders), detail-texture, raster-texture, planet-uniforms,
                      planet (double-precision pose + floating origin placement), planetary-system (Earth + Moon + pool + LUT + atmosphere),
                      sky-backdrop (stars, Milky Way, true-size Sun), starfield, demo-rocket, dispose, gpu-name (+ suggestPreset), uploaded (has the renderer uploaded this attribute);
                      Phase-1 menu backdrop only (not used by the explorer): space-view, earth-lite, atmosphere, sun
src/flight/           EXPLORER: free-camera, teleport, debug-overlay, map-view, time-panel, presets, exposure.
                      FLIGHT PHYSICS (pure, no three): math3, atmosphere (US-1976 `earthAir`, Mach drag), env (FlightEnv: mu, radius, spin, air, planetQuat, groundRadius, sunDir),
                      vessel (FlightPart/Vessel, buildVessel from a Craft, mass/inertia, carve/splitDisconnected), aero, propulsion, sas, contact (ground), structure (joint loads),
                      flight-ops (staging, chutes, legs, power, destruction), flight-world (FlightWorld: launch/stage/step), orbit-info, earth-env (adapter from SolarSystem/Planet).
                      PHASE 6 NAVIGATION (pure): body-env (FlightEnv for every body from the ephemeris + a BodyHost for ground height; AIR_MODELS incl. gas giants; CRUSH_PRESSURE), trajectory (patched conics, SOI events, closestApproach), maneuver (nodes, burn frame, burnEstimate),
                      navigator (nodes, prediction cache, markers, rails stepping with SOI hand-over, remainingBurn from delivered dv, patchAnchors), warp (ladder + warp-to), heating (re-entry), guidance (burn guidance), relocate (cheat teleports and clock jumps), format-time.
                      FLIGHT RENDER/UI: plume, vessel-view, effects, pad (LaunchPad), flight-camera, flight-input (keyboard + gamepad), navball(-math), hud, flight-commands, flight-lighting, scene-lighting (per-body light + exposure), exhaust, plasma (re-entry glow), flight-map + node-panel (map overlay, markers, node editor; uses MapView with a 'vessel' focus).
src/audio/            audio-manager (AudioContext, master + effects/ambience/music buses, UI and event one-shots), music (generative ambient music), engine-sound, ui-sounds (event delegation), event-sounds
src/scenes/           menu-scene, hangar-scene (Phase 4 builder), flight-scene (FlightScene, id 'flight'; integration only), explorer-scene (free camera + map, id 'explorer');
                      flight helpers split out of flight-scene: flight-saves (autosave/quicksave/load), flight-cheats (cheat flags + actions), flight-diagnostics (debug overlay data), flight-depth (camera near/far), flight-time (physics steps / rails), flight-events (HUD messages, particles, sounds), flight-readouts (warp text, navball markers, sound levels), flight-guide (drives the flight guide card)
src/ui/               kit/ (dom, controls, modal, tooltip), menu/ (main menu, dialogs, save-manager), settings/ (panel + controls-panel with key rebinding), cheats/, flight/ (pause menu, key reference, guide-panel), help/ (how-to-play), hint-card, styles/, scene-chrome, fatal
src/save/             settings (localStorage, schema 2), cheats (CheatStore), db (IndexedDB), saves (SaveRepository + migrations), flight-state (capture/restore of a flight, pure)
tools/                bake-earth-data.py, bake-lights.py
docs/screenshots/     README images
.github/workflows/    deploy.yml (test, build, publish to GitHub Pages on push to main)
tests/                settings, saves, core, gpu-name, cube-sphere, terrain-sources, chunk-builder, terrain-seams, lod, atmosphere-model, ephemeris-lite
```
Flow (explorer): `FlightScene.update` -> free camera moves (double-precision position) -> reference-frame anchoring (camera glued to nearest body's
surface frame below 0.4 radii, follows translation within 30 radii) -> `PlanetarySystem.advance(ut)` poses bodies -> `place(camera)` sets each terrain group
camera-relative (FLOATING ORIGIN: the three.js camera is always at the origin, only rotates) and runs quadtree LOD -> render: terrain meshes + sky ->
`AtmospherePass.compose` (reads depth) -> exposure -> bloom -> tone map.

## 5. Current phase and status
- **Phases 1–3: DONE** (see CHANGELOG). **Phase 4 — Rocket builder (Hangar): DONE** : src/builder/ (pure model + editor + stats) and the Hangar scene.
- **Phase 4 architecture:** `part-types/part-library` (data, 51 parts), `craft` (instances, nodes, attachment maths, tree, serialization), `edit` (placement + radial symmetry, rotate/offset, copy/paste), `snap` (node/side snapping from a pointer ray),
  `staging` (segments cut at decouplers, auto-staging, manual stage edits), `stats` (mass, CoM/CoP, staged burn simulation -> delta-v/TWR), `history` (JSON snapshots), `limits` (hangar limits + advice), `craft-store` (IndexedDB `crafts` store, JSON import/export),
  `examples`, `compose` (build crafts in code), `editor` (HangarEditor session: tools, preview/commit, selection, undo, autosave; NO DOM/three), `format`. Render/UI: `part-meshes` (PartFactory, procedural PBR), `hangar-view`, `hangar-panels`, `hangar-dialogs`, `scenes/hangar-scene`, `ui/styles/hangar.css`.
- **Phase 5 — Launch and atmospheric flight: DONE** . The Hangar's Launch button opens FlightScene with the autosaved craft (or the Sparrow example). A scripted pilot (tests/helpers/autopilot.ts) flies the Sparrow to orbit using only player-level controls; an unfinned rocket tumbles and breaks; an under-powered one stays on the pad.
- **Phase 6 — Orbital navigation, maneuvers, interplanetary travel: DONE** . `tests/moon-mission.test.ts` flies the whole Moon round trip with a scripted pilot (helpers in tests/helpers/mission.ts and transfer.ts); Mars entry and gas-giant crush are tested; Selene reaches orbit from the pad in flight-orbit.test.ts.
- **Phase 7 — Saves, settings, cheats, audio, polish: DONE** . Saves/quick save/autosave/export-import with thumbnails, key rebinding, cheats menu, procedural audio and music, hints, pause menu, loading card, shadows, units.
- **Phase 8 — Optimisation, testing, release: DONE** (v1.0.0; all eight phases finished). Nothing is planned; new work would be bug fixes or the gaps listed in section 8.
- **1.1.0 (2026-10-09), after the release: launch site, graphics, onboarding. DONE, not committed or pushed yet** (the owner had not asked for a commit; pushing to `main` redeploys the site). The owner's complaints were: the game reads like a simulation with no idea what to do; the pad was visible from space; the pad was "a little island in the ocean". See CHANGELOG 1.1.0.
- **1.1.0 notes:** `flight/guide.ts` is the pure rule for the always-on flight guide card (`guide(state)` -> step; `ascentPitch(alt, verticalSpeed)` is the taught ascent: altitude table to 55 km, then by vertical speed, one continuous burn, cut when periapsis > 85 km). `tests/guide.test.ts` flies it with simulated clumsy players: KEEP IT GREEN when touching the guide, the starter rocket, SAS or aerodynamics. The default craft is `starterCraft()` = Pathfinder (examples.ts), NOT `EXAMPLES[0]` (still Sparrow, which other tests use). Lessons: (1) "cut at apoapsis 100 km, coast, circularise" does NOT work for these rockets (punchy first stage, weak upper stage: the circularisation burn is most of orbital speed and the vessel falls back); (2) SAS prograde alone does not gravity-turn a high-TWR rocket; (3) telling the player to pitch below the horizon when climbing fast made precise pilots dive and fall back, so the guide never asks for less than 5 degrees; (4) W (pitchUp) tips the nose east/down from vertical, S brings it back up; (5) the settings field `gameplay.guide` was added without a schema bump (the overlay fills missing keys with defaults); (6) the Bash tool here rejects some heredocs (unmatched-quote error): write scripts with the Write tool into the scratchpad and run them.
- **Phase 8 notes:** memory (terrain chunks free their CPU vertex arrays after upload via `uploaded()` + `TerrainBody.releaseUploaded`; Earth chunks omit `aSurfB`), three.js split into its own chunk (`vite.config.ts` `advancedChunks`), first-run preset from the GPU (`suggestPreset`), `flight-scene.ts` helpers (`flight-depth/time/events/readouts.ts`), README screenshots in `docs/screenshots/` (canvas captures through `Gfx.capture(width)` posted to a throwaway local server; UI shots from the pane).
- **Phase 8 lessons (keep):** (1) a TSL `opacityNode` REPLACES `material.opacity`: multiply `materialOpacity` back in when you animate opacity; (2) WebGPU rejected a frame ("texture depth used as attachment and binding", black screen that persisted) when the sun's shadow map was resized/enabled in the same moment MSAA was switched on: replace the light when the map size changes and defer shadow changes (`FlightScene.qualityTimer`); always stress preset switching (`applyPreset` high/low/medium/ultra in sequence) and count `console.error` after touching the render pipeline or lights; (3) `Gfx.exposure` is shared by all scenes: `clearView()` resets it to 1; (4) git-bash rewrites an argument like `/orbital/` into a Windows path: set `MSYS_NO_PATHCONV=1`; (5) never `cd` the persistent shell into a subfolder (the working directory follows it).

## 6. Decisions made and why
- **WebGPURenderer for both backends** (see Phase 1). `Gfx.create` retries with `forceWebGL` on a fresh canvas.
- **Floating origin by construction**: simulation in doubles (three.js Vector3/Matrix4 use JS numbers), render objects are placed relative to the camera in double
  precision on the CPU; GPU only ever sees small numbers. Vertex data is stored relative to a per-chunk origin. Verified by tests and by flying 6 Mm -> 2 m.
- **Reversed-Z float depth** (`reversedDepthBuffer`, near 0.1 m, far 1e13 m). Where EXT_clip_control is missing (some WebGL2 / Safari) three silently falls back, so
  FlightScene.fitDepthRange() keeps near ∝ altitude, far = 1.2e9 and scales the sky backdrop uniformly. `isSky` is exactly "depth == cleared value": far objects (Moon, Sun) have tiny but non-zero depth.
- **Terrain**: 64x64-cell chunks (a quarter of the draw calls of 32 at equal density). Skirts (0.7 x cell + 0.3 m) hide LOD T-junction cracks: a unit test proves the skirt depth
  ≥ worst-case mismatch for Earth and Moon. Normals come from the height function itself (border ring), so lighting is continuous across chunks/LODs. No geomorphing yet.
  A node is drawn only once its mesh exists and is replaced only when all four children exist, so there are never holes while streaming. Chunks stay "in flight" until meshed (fixes duplicate requests).
  Flat open-ocean chunks stop splitting at level 8 (waves are shading). Hidden chunk meshes have `matrixWorldAutoUpdate=false`.
- **One deterministic height function per body** (`terrain/*-source.ts`), used by workers and the main thread (camera collision); octaves finer than 2x the sample spacing are skipped (LOD-limited).
- **Earth data**: NASA heightmap has flat ocean and no bathymetry: depth is synthesised from distance-to-coast. Coastline = 0.5 contour of an anti-aliased land-coverage raster with fractal jitter.
  Land elevation: v/255 * 8848 m (calibrated against Everest, Tibet, Alps, Greenland). Climate is a latitude/elevation model (lapse 0.125/km), deserts emerge from the subtropical dry belt.
- **Moon is procedural** (NASA SVS unreachable from the build sandbox): maria and ~16 landmark craters at real selenographic coordinates + a power-law crater population.
- **Atmosphere**: single scattering (Rayleigh + Mie + ozone) ray-marched per pixel in km units, sun transmittance from a baked 256x64 LUT (validated against the CPU reference to 3-4 digits),
  x1.3 constant stand-in for multiple scattering, no ground-bounce. Planet shadow/terminator come free from the LUT (zero when the ray hits the planet).
  Atmosphere ALWAYS needs its loop inside a TSL `Fn` (a Loop outside one is silently dropped: this bug made every transmittance 1 until fixed).
- **Clouds**: one flat shell at 2.8 km, opacity from direction-based noise (body-fixed, so they rotate with the planet), composited *inside* the atmosphere integral
  (`S_c + a*T_c*cloud + (1-a)*(S_total - S_c + scene*T)`), self-shadowed by sampling opacity toward the sun, cloud shadows on terrain by projecting the sun ray onto the shell.
- **Exposure**: not measured from the image. Perceptual curve vs sun elevation inside an atmosphere (log-interpolated, cap 150), physical albedo model for airless bodies; fixed 1 in space.
  Adaptation in log space (fast to darken, slow to brighten). Exposure is applied BEFORE bloom so thresholds mean the same at noon and midnight.
- **Camera reference frame**: without it the Moon slides away at 1 km/s and Earth's ground at 465 m/s under a fixed inertial camera.
- **Frame/axes**: inertial = three.js world axes: +Y ecliptic north, +X vernal equinox J2000, ecliptic longitude increases toward -Z. Body-fixed: +Y north pole, +X lon 0, east toward -Z.
  Earth orientation = Rx(-obliquity) * Ry(GMST). Moon is tidally locked (+X faces Earth).
- Settings UI exposes only options that do something: terrain detail and atmosphere quality are now exposed; shadowQuality/particleScale stay hidden until used.
- `git init` was only run in Phase 8, when the user gave the repo URL (https://github.com/Coder-4847/Orbital.git): one commit "Orbital 1.0.0" on `main`, tag `v1.0.0`. Commits made after that follow normal git practice.

- **Phase 3 decisions:** planets = JPL Standish (valid 1800–2050, degrade outside); Moon = mean elements + Meeus longitude terms (~0.3 deg; latitude terms not modelled); other moons = mean Keplerian elements, phase not ephemeris-exact.
  One atmosphere is active at a time (largest angular size). Venus uses an opaque deck shell (a volumetric opaque deck is missed by the ray march). Exposure model in flight/exposure.ts (pure, tested) scales with sunlight at the body's distance; teleports snap exposure.
  Gfx must scale RGB only by exposure/fade (alpha scaling made the premultiplied canvas clamp output). WebGL2 backend uses standard depth. Sun material derives limb darkening from the centre uniform, radiance 900.
  Dev snippet: `s=__orbital.ctx.scenes.current; s.goTo('saturn'); s.ut=...; s.toggleMap()`.

- **Phase 4 decisions:** Parts only rotate about Y (`yaw`) and may be flipped (`flip`, half turn about X): exact maths, tiny JSON. Craft frame: +Y up, first part at origin; the view lifts the craft so its lowest point rests on the floor.
  Root for staging/fuel = first command part (else first part placed): `buildTree` re-roots the undirected attachment graph. Decouplers release everything on the far side from the root and leave with it. Fuel is pooled per segment (cut at decouplers) and propellant kind; no crossfeed across decouplers.
  Stage simulation: stage k fires its decouplers, ignites its engines, then burns ALL active engines until the next stage's decouplers would drop only spent engines (so boosters separate when empty while the core continues). Auto-staging key = serial depth (stack decoupler = one stage deeper, radial = parallel; radial decoupler fires half a stage after its parent stage ignites).
  Radial decoupler has an 'outer' node (0.5 m out) that boosters attach to via their 'surface' node. Side parts attach at any angle/height on parts with `hostsSurface`. Cheat "unlimited building space" lives in localStorage (`orbital.cheat.unlimitedBuild`) until Phase 7's cheats menu moves it into settings. Autosave key `orbital.craft.autosave`.
  Hangar coordinates in screenshots of the in-app browser: computer-tool coordinates are in screenshot space (800 px wide), not CSS pixels; `find` refs click in CSS pixels.

- **Phase 5 decisions:** Physics runs in the planet-centred inertial frame (world axes); state = centre-of-mass position/velocity, quaternion q (body→inertial), body angular velocity; craft frame is the body frame (+Y nose). Semi-implicit Euler at fixed 120 Hz.
  Control convention: pitch>0 tips the nose toward body +X (east on a 90° launch heading), yaw>0 toward +Z, roll about +Y. A vessel at rest rides the rotating planet (restPos/restQ body-fixed) until thrust·up exceeds weight; then it is 'flying'. Staging, decoupling and breakage split vessels (`carve`), debris becomes separate vessels (culled when still/far).
  Aero is per part: exposed-end axial drag, cross-flow drag, normal force through cpWeight, fin deflection (finMix), chute canopy area; thrust and Isp interpolate linearly with ambient/sea-level pressure. Fuel pools per (segment, propellant kind). Gimbal = lateral thrust deflection.
  Ground contact: per-part contact points, plane fit from 3 terrain samples, spring k = Mg/(8·0.05 m), damping, friction capped by a viscous gain using dt (fixes chatter), crash tolerance destroys parts; contact forces also feed joint loads. Joint strength constants in structure.ts (AXIAL 1.5e6 N/m², SHEAR 1e6, BENDING 4e5, radial ×8).
  `Planet.surfaceHeightUnder` must use the CURRENT orientation (physics advances the planet many times per frame; the render-time `inverseOrientation` cache was stale and put the ground 4 m under the pad at liftoff, tearing off the engine).
  Launch pad ground is levelled in EarthSource (flat 300 m radius, blend to 2.5 km, height 4 m). Launch at 08:30 local solar time. Lighting from the CPU atmosphere (`lightingAt`) → DirectionalLight + HemisphereLight; navball is a software canvas; HUD is DOM.
  Orbit camera tilts 0.1 rad down so the vessel sits above the navball. HUD buttons never take keyboard focus (Space belongs to staging). Gamepad: right trigger throttle, A stage, X SAS, Y RCS, B legs, bumpers camera/SAS mode.

- **Phase 6 decisions:** `FlightWorld` is expressed in the frame of ONE body (`bodyId`, `env`); `switchBody` re-expresses every flying vessel from heliocentric states and drops vessels at rest on the old body (landed leftovers are not kept yet). `step()` checks the SOI every 0.25 s; rails stepping gets its events from the prediction. `world.version` increments per physics step (and on body changes): the Navigator recomputes its trajectory when it changes (rails moves do NOT change it).
  Trajectory: one patch per conic; crossings of impact radius / rails floor / SOI radius are found analytically from apsides (bound) or hyperbolic anomaly (open); entry to a child's SOI by conservative stepping with a 1 m inside margin (roundoff otherwise causes empty ping-pong patches). Nodes beyond the normal horizon are always reached. Patch drawing anchors: first patch about the body now, encounter patches about the child's position at that time, exits about the parent (Sun at the origin).
  Rails: allowed above `env.railsFloor` (top of the atmosphere, 15 km on airless bodies) with no thrust; stops exactly at the floor (the hop that ends there counts); `railsMove` keeps SAS attitude modes. Burn guidance: the remaining delta-v is |node| minus `vessel.dvSpent` since the engine started, along the node's components in the CURRENT burn frame (propagated-orbit differences drifted by hundreds of m/s for long burns).
  Heating: q = 1.74e-4 sqrt(rho/Rn) v^3 on the leading end only, times (1 - cp T_wall / h_total); skin = 3% of part mass; radiative cooling; shields pass 12% and ablate (`part.ablator`, 55% of dry mass); destroyed above 1.02x maxTemp (typical part 1200 K, engines 2400, shields 3600). Parachutes: drogue tolerates 45 kPa, main 14 kPa. Gas giants: ground 50,000 km below the 1-bar level, crush at 120 bar. Hangar height limit 130 m.
  Tests of the whole mission use `sphereHost` (smooth ground, no terrain): pilots must tolerate that; the scene uses the real terrain via `systemHost`. The test pilot steers powered descent with `world.maneuverDir` (explicit guidance), which a player cannot do.
  The example Selene is 950 t: engines Saturn-12000 (12 MN, 310/338 s) and Vac-1500 were added to the library for it (clusters of engines are not possible, so big rockets need big engines). Flying it by hand needs a gentle gravity turn; the scripted pilot reaches ~150 x 800 km and uses S2 reserves to circularise.
  Browser pane quirk: the computer tool sends punctuation keys with an empty `code`, so `,` `.` `/` do not work there: click the HUD warp buttons. The user's DualSense is plugged in: always test with `?pad=off`.

- **Phase 7 decisions:** `core/keymap.ts` is the single list of flight actions and defaults (KeyboardEvent.code; Shift/Ctrl/Alt normalised to the Left code); `rebind` swaps on conflict; `sanitize` restores defaults for junk or duplicates. `FlightInput` takes `bindings()`/`gamepad()` getters, so changes apply live; the Hangar and Explorer keep fixed keys except F10 (cheats) in the Hangar.
  Saves: `SaveRecord.data` for a flight is `FlightSaveData` (schema 1: kind 'flight'); to change it bump `SAVE_SCHEMA_VERSION` and add `MIGRATIONS[n]` in save/saves.ts. Slots: 'quicksave' and 'autosave' are fixed ids, named saves get uuids. The autosave is skipped until the vessel has left the ground. Thumbnails come from `Gfx.capture()` (reads the canvas in the same task as the draw; scenes leaving skip it). Loading builds a new `FlightWorld` for the saved body (`worldFor`) and `FlightScene.adopt`s it; vessels resting on a body are saved and restored exactly (restPos/restQ).
  Cheats: `CheatStore` (localStorage 'orbital.cheats', mirrors the Hangar's legacy 'orbital.cheat.unlimitedBuild' key) -> `toFlags` -> `world.cheats` (CheatFlags read inside `stepVessel`/`heatAndCrush`/`Navigator.railsBlocker`). 'Auto-warp safety' off == the maxWarp flag. Teleports and time jumps are pure functions in flight/relocate.ts (they drop other vessels). 'Unlock all parts' is a switch that is always on (no progression exists).
  Audio: one `AudioManager` in AppContext; everything connects to its buses; slider->gain is squared. Music is composed live from `CHORDS` with a seeded rng (`nextChord`); mood per scene, ducked by engine thrust. UI sounds are installed once in main.ts by delegation (no per-button wiring).
  Hints: `flight/hints.ts` `nextHint(state)` is the pure rule (tested); `HintCard` shows one at a time and stores seen ids in localStorage 'orbital.hints'; Settings can reset them.
  Dialog fix: `.modal-backdrop` grid rows are `minmax(0, 1fr)` so tall content never pushes a fixed-height dialog off screen; content of "lg" dialogs that is not a tab panel needs the `.scroll-fill` wrapper.
  Shadows: sun DirectionalLight with an orthographic shadow box around the vessel (extent from rocket height); parts and pad meshes are flagged once a second; terrain does not receive shadows. `particleScale` thins smoke, exhaust and plasma via `FlightEffects.density`.

## 7. Conventions
- Units: SI (metres, seconds, kg, radians internally). Scene units in the menu/hangar are arbitrary; the explorer is real metres. UT = seconds since J2000.
- Pure math/physics modules must not import rendering code and need Vitest coverage (terrain/, atmosphere-model, physics/, flight/exposure, core/).
- Files < ~400 lines; brief "why" comments; kebab-case filenames; TS strict. Use the Write tool for files, not shell heredocs (large heredocs failed here).
- Shaders are TSL: build node graphs in plain functions; put loops/ifs inside `Fn`; `uv()` in the post quad has origin top-left (flip Y for NDC); no `atan2` (use `atan(y, x)`).
- Never dispose `Sprite` geometry (shared in three.js); per-chunk index attributes are separate objects over one shared Uint16Array.
- Dispose everything in `exit()`; `disposeTree` for scenes, `PlanetarySystem.dispose` for planets/workers.
- UI: rem sizes, tokens in `tokens.css`, one accent colour, mono + tabular numerals for readouts, tooltips via `data-tip`.
- Remember when testing in the in-app browser: settings persist in localStorage (a stale "Low" preset made all Phase 2 screenshots run with no bloom/MSAA until noticed).

## 8. Known bugs and TODOs
- **Hardware coverage (Phase 8):** only an RTX 5080 laptop in Chrome (WebGPU and the forced WebGL 2 path) was available. Measured there in flight on the pad: Low about 5 ms/frame and 380 MB heap, Medium about 10 ms and 400 MB, High about 8-16 ms and 575 MB (CPU time in the pane is noisy). No Firefox, Safari, integrated GPU or phone was tested; the first-run preset guess and the Low preset are untested on real weak hardware. Terrain chunks that were selected but never drawn (off-screen, parents) keep their CPU arrays until drawn or evicted (about 1600 of 2100 chunks at High on the pad): more memory could be saved by evicting them sooner.
- **Earth data misses every low coast** (found in 1.1.0): `tools/bake-earth-data.py` thresholds the NASA heightmap at grey 14 (sea level 12, ~36 m per step), so land under about 70 m is ocean: Florida and the US south-east were patched by hand in `terrain/lowlands.ts`, but the Netherlands, Bangladesh, the Amazon and Mississippi deltas, Yucatan, the Bahamas, West Siberia and so on are still water. The real fix is to re-bake `earth-land.png` from a true land mask (Natural Earth land polygons, public domain); that needs a download the owner has not approved yet. After that, `lowlands.ts` is only needed for the elevation ramp.
- Flight guide gaps: it covers Earth launch, orbit and return, and one generic card elsewhere (no Moon transfer or landing walkthrough); the return leg (deorbit, re-entry, parachutes) is covered by rule tests only, not flown end to end with Pathfinder; eccentric first orbits are common (apoapsis of a few thousand km) because the taught ascent never pitches below 5 degrees; the Hangar has only its one-off hint.
- Clouds: single flat shell (no true volumetric depth, no cirrus layer); fine detail is limited to what the noise gives; cloud shadow darkens the whole pixel (incl. ambient).
- Atmosphere: single scattering only; one active atmosphere at a time; Neptune/Titan/Venus looks are art-directed. CPU frame times in the in-app browser pane are noisy (menu showed 30 ms); trust GPU ms (~1 ms).
- Phase 7 gaps: key rebinding covers flight only (Hangar, Explorer and menus use fixed keys); no save of the Hangar's craft inside flight saves other than the launch craft; no cloud sync; the music is simple (no per-situation score); the loading card is a plain overlay with no real progress; shadows are limited to the vessel and pad (not terrain, not clouds); 'Unlock all parts' does nothing because there is no progression; flight-scene.ts is ~570 lines (above the guideline: it integrates everything; saving, cheats, diagnostics, hints, depth, time stepping and events are split out); `?pad=off` is still needed when testing with a controller plugged in.
- Phase 6 gaps: no vessels persist off-screen (landed leftovers disappear when you leave a body's sphere; no switching between vessels, no docking); no Oberth/finite-burn planner (nodes are impulsive; long burns need to start early); the predictor ignores atmospheric drag, perturbations and the Sun's pull inside a planet's SOI (patched conics only); the map does not show the Sun-frame patch at true scale next to a planet patch (anchoring is per patch); node editing is numeric (no draggable handles); AN/DN markers and a transfer-window helper are missing; time warp on rails also drops debris in flight; re-entry has no crew g-limit; gas-giant "terrain" is the plain gas shader; Mars/Venus landings are possible but no example craft is built for them; flight-scene.ts is large (see Phase 7 gaps).
- Phase 5 gaps: no re-entry heating or part temperature effects yet (Phase 6); no gravity gradient; ground fit is a plane (no tilting on slopes steeper than the 3-sample fit resolves); simple aerodynamics (no body lift model beyond normal force, no wing parts, no shock cones); joint strengths are tuned constants, not per-part data; RCS fuel use simplified; brakes only add friction; debris is culled; engine sound is minimal noise; no wheels; only Earth has an atmosphere model plus Mars/Venus/Titan exponential fits (untested in flight); the Hangar-saved craft is flown as is (no pad placement options); camera in pad mode is fixed at the first launch pad only.
- Phase 4 gaps: no fuel lines/crossfeed, no part variants (colours), no fairing payload logic, no collision test between placed parts (parts can overlap visually when side-mounted), CoP is a weighted estimate (real aerodynamics arrive in Phase 5), no touch input in the Hangar.
- Phase 3 gaps: Jupiter has no Great Red Spot visible at default views; Moon latitude perturbations missing; eclipse shadow position can be ~1000 km off; map UI is cramped in narrow windows; Moon preset 5 shows a 2 km ridge with striped triplanar detail at grazing light.
- Terrain: no geomorphing (LOD pops are sub-pixel-ish at High but exist), no detail normal maps (geometry detail to ~0.6 m cells only), water waves are triplanar-noise based with visible tiling at some angles,
  coasts are limited by the 10 km source raster plus fractal jitter, climate is not real biome data. Skirts can show as thin slabs at extreme grazing angles.
- Sun: no lens flare; glare = atmosphere + bloom only. Eclipses done in Phase 3.
- Free camera uses a debug exposure; no manual exposure override. Night-side exposure capped at x150.
- Workers receive ~17 MB of raster data each (copy, no SharedArrayBuffer on static hosting): ~70 MB total with the main-thread copy.
- Production build keeps `window.__orbital` out; overlay stats now come from AppContext.loopStats.
- Phase 1 leftovers: menu rocket is a placeholder; `renderer.info.memory` read as zeros; no service worker (no offline play); no LICENSE file (the owner has not chosen one); the dev server shows a stale version string until restarted (the define reads package.json once).

## 9. Deploy status
- **Live:** https://coder-4847.github.io/Orbital/ (verified 2026-10-09: page and all assets 200, the flight scene loads with terrain workers and data, no game errors in the console; the only 404 is the browser's automatic /favicon.ico request).
- **The live site is still 1.0.0**: the 1.1.0 work is in the working tree only until the owner asks for a commit and push.
- Repo: https://github.com/Coder-4847/Orbital (public), branch `main`, tag `v1.0.0`. Every push to `main` re-runs `.github/workflows/deploy.yml` (npm ci, 270 tests, build, deploy). Pages source is "GitHub Actions" (set by the owner).
- `dist/` is about 2.8 MB (three.js chunk 961 kB, app 33 kB + scene chunks, data 1.4 MB, fonts 90 kB). Relative base, so the repository name needs no configuration.
