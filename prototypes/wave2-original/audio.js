/* Echo Heist — tiny WebAudio synth. No audio files; everything is generated. */
(function (root) {
  'use strict';
  let ctx = null, master = null;
  let muted = false, volume = 0.6;
  try {
    muted = localStorage.getItem('echoheist.muted') === '1';
    const v = parseFloat(localStorage.getItem('echoheist.vol'));
    if (!isNaN(v)) volume = Math.min(1, Math.max(0, v));
  } catch (e) { /* storage unavailable: defaults are fine */ }

  function save() {
    try { localStorage.setItem('echoheist.muted', muted ? '1' : '0'); localStorage.setItem('echoheist.vol', String(volume)); } catch (e) { /* ignore */ }
  }
  function applyGain() { if (master) master.gain.value = muted ? 0 : volume * 0.5; }

  /** Must be called from a user gesture (key or click) before sound can play. */
  function unlock() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      applyGain();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, start, dur, type, vol, slideTo) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + start;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  const sounds = {
    start() { tone(330, 0, .08, 'triangle', .2); tone(495, .07, .12, 'triangle', .2); },
    move() { tone(180, 0, .04, 'triangle', .07); },
    bump() { tone(90, 0, .07, 'square', .1); },
    gem(left) { const b = 700 + (6 - Math.min(left, 6)) * 60; tone(b, 0, .09, 'sine', .25); tone(b * 1.5, .08, .16, 'sine', .22); },
    exitOpen() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .07, .16, 'triangle', .22)); },
    wake() { tone(200, 0, .35, 'sawtooth', .12, 80); },
    cleared() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * .09, .22, 'square', .16)); },
    vault() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * .1, .25, 'square', .16)); },
    caught() { tone(400, 0, .5, 'sawtooth', .22, 60); tone(200, .05, .5, 'square', .12, 40); },
    timeout() { [440, 392, 349, 294].forEach((f, i) => tone(f, i * .14, .22, 'triangle', .2)); },
    tick() { tone(1200, 0, .03, 'square', .08); },
  };

  root.EchoAudio = {
    unlock,
    play(name, arg) { if (sounds[name]) sounds[name](arg); },
    get muted() { return muted; },
    get volume() { return volume; },
    setMuted(m) { muted = !!m; applyGain(); save(); },
    setVolume(v) { volume = Math.min(1, Math.max(0, v)); applyGain(); save(); },
  };
})(typeof self !== 'undefined' ? self : this);
