# Echo Heist — Wave 2 original game prototype

A standalone, static HTML/CSS/JavaScript game intended to become the cabinet's eighth game.
No build step, no dependencies, no server code, no keys. Open `index.html` through any static server.

**Status:** prototype for student review. The student has not yet playtested it; see "Needs a human" below.

## The game
Steal every gem in a vault and reach the exit. Each time you clear a round, your exact route is recorded as an **Echo**. In every later round the Echoes replay your old routes, starting **4 steps after you first move**. Touching an Echo (same tile, or swapping places with one) ends your run. Run out of the timer and the run also ends.

- A vault is **5 rounds** on one floor plan; gems are re-placed each round and Echoes stack up (0 → 4).
- Clearing round 5 cracks the vault: Echoes dissolve and a new floor plan starts (4 layouts, then they loop with an extra gem and a shorter clock).
- Your clever route is the thing that later hunts you, so planning means choosing routes you'll be able to dodge.
- Echoes show a dotted trail of their next 7 steps, so nothing is hidden. Waiting Echoes sit in a ring around the start tile and show a wake-up ring.
- The clock starts on your first real step, so you can look at the board first.

Scoring: 10 per gem, 50 per round clear, + time bonus, + 200 for cracking a vault. Best score is kept in `localStorage` (optional; the game works without it).

### Controls
`←↑↓→` / `WASD` move one tile per step (tap = one step, hold = keep stepping) · `Space` wait · `P`/`Esc` pause · `R` restart run · `M` mute. On touch screens an on-screen pad appears. Sound is generated with WebAudio (no audio files); there is a mute button and volume slider.

### Level select (for testing)
`index.html?vault=3&round=5` starts at vault 3, round 5 with realistic Echoes from rounds 1–4 pre-generated. `&seed=123` makes gem placement repeatable.

## Files
| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page and styling. CSS is scoped under `.eh` and ids are prefixed `eh-`. |
| `core.js` | Game rules, layouts, seeded gem placement, Echo replay/collision, and an exact solver. No DOM. Works in browser and Node. |
| `audio.js` | WebAudio sound effects and mute/volume. |
| `main.js` | Input, rendering, HUD, overlays, game flow. Exposes `window.EchoHeistDebug` for tests. |
| `tests/core.test.js` | Node tests of the rules (13). |
| `tests/browser.test.js` | Playwright end-to-end test (9). |

Globals added: `EchoCore`, `EchoAudio`, `EchoHeistDebug`. `localStorage` keys: `echoheist.best`, `echoheist.muted`, `echoheist.vol`.

## Running the tests
```
node prototypes/wave2-original/tests/core.test.js
(cd prototypes/wave2-original && python3 -m http.server 8765) &
NODE_PATH=$(npm root -g) node prototypes/wave2-original/tests/browser.test.js   # needs Playwright + Chromium
```
The solver test searches every vault/round/seed combination tested for a survivable route against the stacked Echoes and replays it through the real engine. Echoes created by a *human* can be less friendly than solver routes (for example, a long wait inside a one-tile corridor), so this shows fairness of the generated levels only, not of every possible human run.

## Integrating into the cabinet (not done here)
1. Copy this folder to the cabinet, e.g. `games/echo-heist/`.
2. Simplest: link or embed it, e.g. `<iframe src="games/echo-heist/index.html" title="Echo Heist" allow="autoplay">`. Keyboard focus must be inside the iframe (click it) for keys to work.
3. Without an iframe: copy the four scripts/styles and the `<main id="echo-heist">` block into a cabinet screen; keep script order `core.js`, `audio.js`, `main.js`. Remove the `<body>`/`:root`/`body` rules from `style.css` if the cabinet has its own theme. `main.js` attaches `keydown`/`keyup` listeners on `window`, so the cabinet should only load/start it while this game is visible, or the arrow keys and `P`/`R`/`M` will be captured by it.
4. Add a menu entry named "Echo Heist". It is a human-only game; no flipped mode or AI opponent is needed for Wave 2.
5. Cabinet-wide sound or pause controls, if any, can call `EchoAudio.setMuted(bool)`; the game pauses automatically when the tab is hidden.

## Needs a human (not verified by me)
- Playtesting for fun, difficulty curve and fairness by real people, including someone who has never seen it. I only ran automated tests.
- Whether 150 ms per step, the 4-step wake delay, the timers and the layouts feel right (all are constants at the top of `core.js` / `roundConfig`).
- Real speakers/headphones: audio code ran without errors, but I could not hear it.
- Real mobile device and other browsers (only headless Chromium was used).
- The originality claim: the "your past run becomes the enemy" idea has precedent (time-loop and ghost-replay games). Decide how you will explain what is different about it.
- Wave 2 items for the existing seven games, the improvement log and Slack reviews are outside this prototype.
