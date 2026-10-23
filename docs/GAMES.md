# How each game plays (normal and flipped)

"Normal" = you play the classic role. "Flipped" = you take the opposite role and the computer plays the classic one, under the same rules. Pause: **P**, restart: **R**, menu: **Esc**. Phones get an on-screen pad; pointer/tap works in every game.

| Game | Normal — you are… | Flipped — you are… |
| --- | --- | --- |
| Snake | the snake | the apple dropper |
| Breakout | the paddle | the wall's deflector |
| Splat | the bird | the column builder |
| Asteroids | the pilot | the rock thrower |
| Missile Command | the defender | the attacker |
| Pong | the left paddle | the ball |

## Snake
* **Normal** — Arrows/WASD (or touch pad). Eat 20 apples; walls and your own body kill you. The computer only drops apples you can reach. Speeds up every 4 apples; you grow 3 segments per apple.
* **Flipped** — Mouse or arrows to move the cursor, click/Space to drop one apple at a time on an empty square. The computer snake chases it with a BFS path. It dies on walls/itself or **starves** if it can't reach your apple within its move budget (68 moves at level 1, shrinking to 53). Early levels the snake is greedy (can be lured into its own tail); from level 3 it only takes routes that leave it room. Stall and the computer drops an apple for you. The snake wins at 20 apples.

## Breakout
* **Normal** — Left/Right or mouse; Space/click serves. 3 lives, 3 levels (more rows each level, top row takes 2 hits). Ball speeds up as bricks fall.
* **Flipped** — Left/Right or mouse moves the **deflector** (teal bar, mid-court). The computer plays the paddle and clears bricks. When the ball travels upward and touches the deflector it is knocked back down, at an angle set by where it lands, so you can steer it past the paddle. Each deflection uses a quarter of a recharging meter (grey = passes through). Make the computer lose 3 lives before it clears the wall. The paddle gets faster and aims better every 10 bricks.

## Splat
* **Normal** — Space / Up / click / tap to flap through 25 columns. Every 5 columns: faster scroll, smaller gaps. Layouts are random but always within what's physically reachable.
* **Flipped** — Mouse or Up/Down picks the gap height, click/Space places a column when the meter is ready. The highlighted band is the highest climb / lowest drop the bird can always make in time, so every layout is passable. The bird (AI) flies with the same physics; narrower gaps and faster scrolling come as it scores. Splat it before it clears 25.

## Asteroids
* **Normal** — Left/Right rotate, Up thrust, Space fire. Big rocks split. 3 ships, 5 waves, short shield after respawn, screen wraps.
* **Flipped** — Mouse (or Left/Right) slides the launch point around the screen border; click/Space throws a rock; 1/2/3 or Q/E choose small/medium/large (cost 1/2/3 energy; energy refills slowly). Rocks head toward the ship's current position with some scatter. The AI pilot uses the same turn rate, thrust and gun; it reacts faster and aims better every 15 s. Destroy all 3 of its ships before it survives 90 s.

## Missile Command
* **Normal** — Click (or crosshair + Space) to fire an interceptor from the nearest battery with ammo; it explodes where you aimed, so lead your targets. 5 shots per battery, 6 cities, 5 waves; one city repaired between waves; later waves can split in flight.
* **Flipped** — Slide the launcher along the top (pointer in the top strip, or J/L), then click a target (or Space at the crosshair). 11 missiles in wave 1, +2 per wave, with a reload between shots. The computer defends with real interceptors: finite speed, 5 shots per battery, per-battery reload, reaction delay that shrinks each wave. Knock out batteries, then destroy all 6 cities; if any city survives wave 5, the computer wins.

## Pong
* **Normal** — Up/Down or W/S or mouse. First to 7. Ball speeds up each hit; the computer paddle gets faster and sharper each time you score.
* **Flipped** — You are the **ball**: no paddle, the left edge is a wall. Up/Down curves the ball (limited fuel that recharges). Slip it past the computer paddle; if the paddle returns the ball too many times in one rally (5, shrinking to 3) the defender takes the point. First to 7.
