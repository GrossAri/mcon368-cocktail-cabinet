# Architecture

Static site, no build step, no backend, no secrets. Netlify publishes the repository root (`netlify.toml`).

```
index.html            cabinet page (menu, stage, overlay, touch pad)
css/cabinet.css
js/main.js            UI: menu, stage, overlay, HUD, fixed-timestep loop, deep links (#snake/flipped)
js/registry.js        the list of games on the cabinet  <- add Imitation / Wave 2 game here
js/core/game.js       Game base class (the contract every game follows)
js/core/input.js      keyboard + pointer polling (WASD mapped onto arrows)
js/core/rng.js        seeded PRNG (reproducible games and tests)
js/core/util.js       constants, geometry, drawing helpers
js/games/*.js         snake, breakout, splat, asteroids, missile, pong
tests/*.test.mjs      node:test unit/simulation tests (npm test)
tests/browser/        Playwright smoke test (npm run test:browser)
```

## Game contract (`js/core/game.js`)

Games are plain classes with **no DOM access in the logic**, so they run headless in tests.

| Member | Meaning |
| --- | --- |
| `new Game({ mode: 'normal' \| 'flipped', seed })` | mode picks who plays which side |
| `state` | `'ready'` → `'playing'` → `'over'` |
| `step(input)` | advance one fixed 1/60 s tick. `input = { keys, pressed, mouse }` |
| `draw(ctx)` | render only; never mutates game state |
| `hud()` | `[{label, value}]` for the status bar |
| `result` | `null` or `{ outcome: 'win'\|'lose', message }` — **outcome is always from the human's point of view** |

A game module exports `meta = { id, title, tagline, accent, Game, rules: {normal, flipped}, controls: {normal, flipped} }`.

## How "flipped" is implemented and kept honest

* Each game has one rule set. The computer pilot (snake AI, bird AI, ship AI, defender AI, paddle AI) acts **only through the same actions the human has** (heading choice, flap, the four ship buttons, firing interceptors from batteries, moving a paddle at a capped speed). Walls, collisions, ammo, reload and speed caps are enforced by the game, not the AI.
* AIs perceive only visible state, react with a delay and have aim error that shrinks per level — none of them read the human's intent or skip collisions.
* Anything the human can place is validated by the shared rules (snake apples only on empty squares; splat gaps clamped to what the bird can physically reach; asteroid and missile launches cost energy/supply and have reloads). Stalling never wins: the computer takes over placement after a timeout.
* Difficulty is a pure function of `level` and is covered by tests.

## Tests

`npm test` runs `node --test` (no dependencies). Besides unit tests of each rule, the suites include **simulation tests**: computer opponents play seeded full games against scripted humans (idle, random, naive, skilled) to check that each flipped game is both *winnable* and *losable* by the human, and that computer-built layouts are always passable.
`npm run test:browser` drives real Chromium through the UI (needs Playwright; uses the global install if present).
