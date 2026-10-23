/* Imitation — signalling-code codec and data-channel message protocol (pure, testable). */
(function (root) {
  'use strict';

  const VERSION = 1;
  const MAX_TEXT = 500;

  function toB64Url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64Url(str) {
    const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Session description → short copy/paste code. */
  async function encodeCode(desc) {
    const json = new TextEncoder().encode(JSON.stringify({ v: VERSION, type: desc.type, sdp: desc.sdp }));
    if (typeof CompressionStream !== 'undefined') {
      return 'IMG1.' + toB64Url(await pipe(json, new CompressionStream('deflate')));
    }
    return 'IMG0.' + toB64Url(json);
  }

  /** Throws a user-readable Error on malformed input. */
  async function decodeCode(code, expectedType) {
    const s = String(code || '').replace(/\s+/g, '');
    const dot = s.indexOf('.');
    if (dot < 0) throw new Error('That does not look like an Imitation code.');
    const tag = s.slice(0, dot), body = s.slice(dot + 1);
    let obj;
    try {
      let bytes = fromB64Url(body);
      if (tag === 'IMG1') bytes = await pipe(bytes, new DecompressionStream('deflate'));
      else if (tag !== 'IMG0') throw new Error('tag');
      obj = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error('That code is damaged or incomplete. Copy the whole code and try again.');
    }
    if (!obj || obj.v !== VERSION || typeof obj.sdp !== 'string' || !obj.sdp.startsWith('v=0')) {
      throw new Error('That code is from an incompatible version.');
    }
    if (expectedType && obj.type !== expectedType) {
      throw new Error(expectedType === 'offer'
        ? 'That is an answer code. Paste the host’s invite code here instead.'
        : 'That is an invite code. Paste the guest’s reply code here instead.');
    }
    return { type: obj.type, sdp: obj.sdp };
  }

  const TYPES = ['hello', 'round', 'open', 'msg', 'typing', 'verdict', 'next', 'bye'];

  /** Validates an incoming (untrusted) peer message. Returns a clean object or null. */
  function parseMessage(raw) {
    let m;
    try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    if (!m || typeof m !== 'object' || TYPES.indexOf(m.t) < 0) return null;
    const out = { t: m.t };
    if (m.t === 'msg') {
      if (typeof m.text !== 'string' || !m.text.trim()) return null;
      out.text = m.text.slice(0, MAX_TEXT);
    } else if (m.t === 'round') {
      if (!Number.isInteger(m.n) || m.n < 1 || (m.judge !== 'host' && m.judge !== 'guest')) return null;
      out.n = m.n; out.judge = m.judge;
    } else if (m.t === 'typing') {
      out.on = !!m.on;
    } else if (m.t === 'verdict') {
      if (m.guess !== 'human' && m.guess !== 'ai') return null;
      out.guess = m.guess;
      out.truth = m.truth === 'human' ? 'human' : 'ai';
    } else if (m.t === 'hello') {
      out.v = m.v;
    }
    return out;
  }

  const api = { VERSION: VERSION, MAX_TEXT: MAX_TEXT, encodeCode: encodeCode, decodeCode: decodeCode, parseMessage: parseMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImitationProtocol = api;
})(typeof self !== 'undefined' ? self : this);
