# Imitation — standalone prototype

Static HTML/CSS/JS (no build step, no backend, no secrets). Open `index.html` through any static server
(`npx serve .`, `python3 -m http.server`) — WebRTC needs `http://localhost` or HTTPS, not `file://`.

## Status summary (read this first)

| Requirement | Status |
|---|---|
| Real human↔human play between two separate browsers | **Working and tested**, using WebRTC with *manual* code exchange (see below) |
| Automatic matchmaking with strangers ("click and get paired") | **Blocked** — needs external signalling infrastructure; not implemented |
| Believable matchmaking so the AI isn't obvious | **Implemented** (hidden coin flip + same randomised 4–10 s wait either way). Only partly verifiable: see caveats |
| AI opponent powered by Claude in the user's browser, no API key | **Blocked** — no supported mechanism exists for a static site. Built-in opponent is a **local rule-based chatbot, not Claude** |
| Clear instructions and result feedback | Implemented (menu rules, per-round reveal, score) |
| Compatible with the shared static cabinet | Implemented (mounts into any element, scoped CSS) — not yet integrated or tested inside the real cabinet |

**This game must not be marked fully compliant**: the "Claude in the browser" requirement is unmet, and automatic matchmaking is not provided.

## Architecture findings

### Human-to-human
WebRTC data channels are genuinely peer-to-peer, but two browsers cannot find each other without a *signalling* channel to exchange session descriptions (SDP/ICE). Options:

1. **Manual signalling (implemented).** Host gets an invite code (compressed, ~0.5–1.5 KB), sends it to the friend by any means, the friend pastes it and returns a reply code, the host pastes that. Needs no server of ours, no credentials, deploys on Netlify as-is. Cost: players must already know each other; no strangers matchmaking.
2. **Public third-party signalling** (PeerJS Cloud broker, public MQTT/Nostr/BitTorrent-tracker relays, e.g. via the Trystero library). Would enable "room name" pairing. These are external infrastructure outside our control (rate limits, outages, privacy), and **could not be tested here** — the sandbox network blocks those hosts — so nothing is claimed or coded for them. `PeerLink` in `js/rtc.js` is the only place to change: replace the copy/paste step with automatic transport of the same two codes.
3. **Own signalling backend / serverless function** (Netlify Functions, WebSocket service). Violates the "no custom backend" constraint; not done.
4. `BroadcastChannel`/`localStorage` only link tabs of one browser profile — not separate browsers; deliberately not used.

STUN: default config uses Google's public STUN (`stun.l.google.com:19302`) so players on different networks can usually connect. That is third-party infrastructure and **was not reachable from the test sandbox**, so cross-network connection is unverified. Symmetric NATs/strict firewalls need a TURN relay (paid/hosted; not included). Tests run with `?stun=0` (loopback host candidates only).

### Claude in the browser
There is no documented, supported way for a plain static site to call Claude without an API key (the Anthropic API requires a key; shipping one in browser code would expose it; claude.ai's artifact runtime is only available to pages hosted inside claude.ai, not on a Netlify domain). No undocumented API was invented. Possible future routes, all needing student approval and decisions: a user-supplied key typed at runtime (BYO key, stored only in their browser), or a key-holding proxy (a backend — disallowed). The opponent therefore uses `ImitationBot` (`js/bot.js`), clearly labelled as a local chatbot in the UI.

## Game design
- **Two-browser match:** players alternate judge/witness. The judge's client flips a secure coin: chat is relayed to the real partner, or answered by the built-in bot. The matchmaking wait uses the same distribution for both routes, then the result screen reveals which it was. The witness is only shown a chat when routed to them, and is told afterwards if the judge faced the bot.
- **Practice:** you judge the built-in bot. The UI states the opponent is the bot (no hidden identity is possible with one player).
- **Flipped:** the *computer* judges you via five questions and a transparent scoring heuristic (length, casual phrasing, timing variance, etc.); signals are listed. It is a heuristic, not an AI or a real detector.

Caveat on believability: in a pair session the judge knows a partner exists, so the "is it a person" uncertainty is the coin flip, not total. The bot is simple and an attentive player can tell it apart; no claim of fairness/fun has been playtested by a human.

## Files
`index.html` · `style.css` (all rules under `.imi`) · `js/protocol.js` (code codec, message validation) · `js/rtc.js` (`PeerLink`) · `js/bot.js` (bot + judge) · `js/game.js` (UI/controller) · `tests/`

## Integration into the cabinet
1. Copy `style.css`, `js/*.js` (load order: protocol, bot, rtc, game) into the cabinet's assets.
2. Add a container and call `ImitationGame.mount(containerEl)`. It renders its own title; call the returned `reset()` when the player leaves the game (closes any peer connection and timers).
3. Needs `http://localhost` or HTTPS (Netlify provides HTTPS). No build step, no env vars, no CSP exceptions except WebRTC STUN to `stun.l.google.com` if the cabinet sets a strict `connect-src`/ICE policy.
4. Options: `mount(el, { iceServers: [...], fast: false })`. `?fast=1` (short delays) and `?stun=0` (no ICE servers) URL flags exist for tests only; do not ship links using them.
5. "Flipped mode" is covered by the `Flipped` button (computer judges human); the human-as-witness role inside a Two-browser match covers "human on the other side".

## Tests (`npm test` in this folder)
- `tests/unit.test.js` (node:test, no deps): bot replies/delays/non-repetition, judge heuristic, message validation, code encode/decode and error cases.
- `tests/e2e.js` (Playwright, Chromium): launches **two separate browser processes**, exchanges codes, verifies a real data channel opens; across many rounds verifies role alternation, that messages reach the real peer only on human-routed rounds and never on bot rounds, result/reveal feedback on both sides, error messages for garbage/wrong-type codes, partner-disconnect handling, practice mode, flipped mode, no uncaught page errors. Requires `playwright` (globally installed here at `/opt/node-tools/node_modules`; set `PLAYWRIGHT_PATH` otherwise).

Not tested: different machines/networks, STUN/NAT traversal, Safari/Firefox, mobile, any public signalling service, real human playtesting.
