# Integrating Imitation and the Wave 2 game

Other workstreams own `prototypes/imitation/` and `prototypes/wave2-original/`; this branch does not touch them. When the student approves integration:

1. Move the prototype's game logic into `js/games/<id>.js` as a class extending `Game` from `js/core/game.js` (see `docs/ARCHITECTURE.md` for the contract: `step(input)`, `draw(ctx)`, `hud()`, `result`) and export `meta`.
   * Wave 2 original game: human-only play is allowed, so `rules`/`controls` can describe one mode; the shell passes `mode` but the game may ignore it. If it only supports one mode, set `meta.singleMode = true` — **not yet implemented in the shell** (small change in `renderDetails()` in `js/main.js` to hide the mode fieldset).
2. Register it in `js/registry.js`: import `meta` and add it to `GAMES`; delete the matching entry from `COMING_SOON` (`imitation`).
3. Imitation needs two browsers talking. The shell is static, so use a browser-only transport the prototype already uses (e.g. WebRTC with copy/paste signalling, or a public relay the student approves — nothing with secrets in browser code). Keep the transport behind the game's own module; the shell only calls `step`/`draw`. If the game needs async setup, show it from inside `draw`/`hud` and keep `state` as `'ready'` until the match starts.
4. Add `tests/<id>.test.mjs` (the registry-wide contract tests in `tests/core.test.mjs` pick the game up automatically; they run both modes, so Imitation must tolerate `mode: 'flipped'` or be exempted there).
5. Wave 2 requires sound in every original game. There is no audio layer yet; add one module (`js/core/audio.js`, WebAudio, muted by default behind a button) and call it from the games.
