# Planet Bounce

A mobile-first gravity adventure: bounce from planet to planet using nothing but momentum and gravity.

Built with TypeScript, Canvas 2D and WebAudio, and bundled with Vite. It has no runtime dependencies and runs in any modern mobile or desktop browser. It can be wrapped for app stores later with Capacitor.

## Run

```bash
npm install
npm run dev        # dev server, also exposed on LAN for phone testing
npm test           # physics, generator fairness, progression, persistence
npm run build      # typecheck + production build in dist/
```

## Controls

- **Aim and launch:** drag anywhere, then release. By default you pull back like a slingshot; Settings can switch this to push. If you aim away from the surface, the probe crawls around the world to face that way.
- **Thrust in flight:** hold and drag. Thrust uses fuel, so trust gravity first.
- **Abilities:** tap the ability buttons, or press `1`/`2` on a keyboard.
- **Inspect a world:** tap it.
- **Pause:** `Esc`. **Recall:** `R`, or the Recall button.

## What is in the vertical slice

- **Physics:** fixed 120 Hz timestep with velocity-Verlet integration, so orbits stay stable. A single `step()` function drives the game, the trajectory preview and the route solver, so the preview always matches what actually happens. Each body's gravity fades smoothly at the edge of its sphere of influence. Bodies bounce, slide or come to rest with Coulomb-like friction. Gas giants apply atmospheric drag, and moons and binaries follow analytic orbits.
- **13 body types:** rocky, moon, ocean giant, gas giant, ice, volcanic (eruption rhythm), crystal, pulsar (gravity that pulses), star, warp gate, derelict (secret), asteroid and the Rogue Giant boss. All are defined as data in `src/data/planetTypes.ts`.
- **Curated procedural sectors:** each sector is built from a main route, side branches, a slingshot shortcut, unknown `?` worlds, unstable worlds, asteroid streams and a hidden derelict. Every layout is then **validated with the real physics**. The gate must be reachable, and every world must be both reachable and escapable; layouts that fail are regenerated. Validation runs in a Web Worker. Seeds are deterministic.
- **Run structure:** The Inner Belt has 3 sectors and then the Rogue Giant boss. After each sector you choose between **pushing deeper** (pick 1 of 3 run modules) and **extracting** (bank 100%). There is a Daily Expedition with a shared seed. The Shattered Moons region (binary pairs, Twin Giants boss) unlocks once the Inner Belt is complete.
- **Progression:** 18 permanent tech nodes across 5 branches. Each tier unlocks a capability rather than a percentage, and some nodes are gated by discoveries or mastery. There are 16 run modules built around distinct archetypes, 4 physics abilities, a Cosmic Atlas, 13 mastery challenges, a journal that surfaces past memories, and lore fragments.
- **Fair failure:** every failure shows a replay of your path, the impact point, your closest approach to the target and a concrete tip, for example "You entered its gravity well 1.3 s before impact, at 380 u/s."
- **Onboarding:** three short hands-on lessons with no menus. If you fail the slingshot lesson, the route solver draws a golden demonstration path.
- **Feel:** procedural WebAudio, where pitch follows speed and a hum grows inside gravity wells. There are pooled particles, a dynamic camera, screen shake, haptics and slow motion on reveals.
- **Accessibility:** UI scale, left-handed layout, high-contrast trajectory, reduced effects, assist mode, screen shake slider, haptics toggle and a choice of aim style.
- **Save and resume:** the expedition is saved on every landing, and the profile is saved locally.

## Architecture

```
src/
  core/          math, seeded RNG, event bus
  data/          planet types, modules, abilities, tech, discoveries, achievements, regions
  physics/       body (analytic orbits), sim (the one step function), predictor, route solver
  world/         world, curated generator + validation, worker loader, tutorial levels
  run/           run state, flight tracker (assists/orbits/maneuvers), failure analysis
  progression/   profile/persistence, tech and module rules, derived player stats
  game/          game controller, telemetry (local only), dev hooks
  presentation/  camera, renderer, sprites, particles, audio, haptics
  ui/            DOM HUD and screens
```

In dev builds, `window.__pb` exposes scripted-play helpers (`flyTo`, `nextHop`, `game.devSpeed`) for automated play-tests.
