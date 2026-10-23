/* Imitation — serverless WebRTC link using manual (copy/paste) signalling. */
(function (root) {
  'use strict';
  const P = root.ImitationProtocol || (typeof require !== 'undefined' ? require('./protocol.js') : null);

  const GATHER_TIMEOUT_MS = 6000;

  function PeerLink(opts) {
    opts = opts || {};
    this.iceServers = opts.iceServers === undefined ? [{ urls: 'stun:stun.l.google.com:19302' }] : opts.iceServers;
    this.onmessage = function () {};
    this.onstate = function () {};
    this.pc = null; this.dc = null; this.role = null;
    this.state = 'new';
  }

  PeerLink.prototype._setState = function (s) { this.state = s; this.onstate(s); };

  PeerLink.prototype._init = function () {
    const self = this;
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.onconnectionstatechange = function () {
      const s = self.pc.connectionState;
      if (s === 'failed' || s === 'disconnected' || s === 'closed') self._setState(s === 'closed' ? 'closed' : 'lost');
    };
  };

  PeerLink.prototype._wire = function (dc) {
    const self = this;
    this.dc = dc;
    dc.onopen = function () { self._setState('open'); };
    dc.onclose = function () { if (self.state !== 'closed') self._setState('lost'); };
    dc.onmessage = function (e) {
      const m = P.parseMessage(e.data);
      if (m) self.onmessage(m);
    };
  };

  PeerLink.prototype._gathered = function () {
    const pc = this.pc;
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      const done = function () { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(t); resolve(); };
      const check = function () { if (pc.iceGatheringState === 'complete') done(); };
      const t = setTimeout(done, GATHER_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', check);
    });
  };

  /** Host step 1 → invite code. */
  PeerLink.prototype.createInvite = async function () {
    this.role = 'host';
    this._init();
    this._wire(this.pc.createDataChannel('imitation', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this._gathered();
    this._setState('waiting-for-answer');
    return P.encodeCode(this.pc.localDescription);
  };

  /** Guest step → reply code. */
  PeerLink.prototype.acceptInvite = async function (code) {
    const offer = await P.decodeCode(code, 'offer');
    this.role = 'guest';
    this._init();
    const self = this;
    this.pc.ondatachannel = function (e) { self._wire(e.channel); };
    await this.pc.setRemoteDescription(offer);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this._gathered();
    this._setState('waiting-for-host');
    return P.encodeCode(this.pc.localDescription);
  };

  /** Host step 2: paste guest's reply. */
  PeerLink.prototype.acceptAnswer = async function (code) {
    if (!this.pc || this.role !== 'host') throw new Error('Create an invite first.');
    const answer = await P.decodeCode(code, 'answer');
    await this.pc.setRemoteDescription(answer);
    this._setState('connecting');
  };

  PeerLink.prototype.send = function (obj) {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(JSON.stringify(obj));
    return true;
  };

  PeerLink.prototype.close = function () {
    this._setState('closed');
    try { if (this.dc) this.dc.close(); } catch (e) {}
    try { if (this.pc) this.pc.close(); } catch (e) {}
  };

  root.ImitationRTC = { PeerLink: PeerLink };
})(typeof self !== 'undefined' ? self : this);
