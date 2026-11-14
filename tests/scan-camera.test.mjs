import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentCamera } from '../scan-camera.js';

test('camera permissions, cancellation, manual capture and lifecycle cleanup', async t => {
  const saved = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  function environment(getUserMedia) {
    const elements = new Map();
    class Element extends EventTarget {
      constructor() { super(); this.hidden = false; this.disabled = false; this.textContent = ''; this.width = 0; this.height = 0; this.attributes = new Map(); }
      setAttribute(key, value) { this.attributes.set(key, value); }
      removeAttribute(key) { this.attributes.delete(key); }
      getContext() { return { drawImage() {}, getImageData: () => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(this.width * this.height * 4) }) }; }
    }
    const document = new EventTarget();
    document.getElementById = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
    document.createElement = () => new Element();
    const window = new EventTarget(); window.isSecureContext = true;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
    const video = document.getElementById('scan-video'); video.readyState = 4; video.videoWidth = 1200; video.videoHeight = 1600; video.play = async () => {};
    const captures = [], messages = [];
    const camera = createDocumentCamera((canvas, corners) => captures.push({ canvas, corners }), (...args) => messages.push(args));
    const click = name => document.getElementById(`scan-${name}`).dispatchEvent(new Event('click'));
    return { camera, click, document, window, video, captures, messages, get: name => document.getElementById(`scan-${name}`) };
  }
  function media() {
    const track = new EventTarget(); track.stops = 0; track.stop = () => { track.stops++; };
    return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } };
  }
  await t.test('denied permissions display a fallback and clear the live panel', async () => {
    const env = environment(async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); });
    await env.camera.start();
    assert.equal(env.get('live').hidden, true); assert.equal(env.get('camera').disabled, false);
    assert.match(env.messages[0][0], /อนุญาต/);
  });
  await t.test('late permission grant after cancellation releases the acquired camera', async () => {
    const { track, stream } = media(); let grant;
    const env = environment(() => new Promise(resolve => { grant = resolve; }));
    const pending = env.camera.start(); env.camera.stop(); grant(stream); await pending;
    assert.equal(track.stops, 1); assert.equal(env.video.srcObject, null); assert.equal(env.get('live').hidden, true);
  });
  await t.test('manual capture works without detected edges and stops the stream before review', async () => {
    const { track, stream } = media(); let requested;
    const env = environment(async options => { requested = options; return stream; });
    await env.camera.start();
    assert.equal(requested.audio, false); assert.equal(requested.video.facingMode.ideal, 'environment');
    assert.equal(env.get('shutter').disabled, false);
    env.click('shutter');
    assert.equal(env.captures.length, 1); assert.equal(env.captures[0].corners, undefined);
    assert.equal(env.captures[0].canvas.width, 1200); assert.equal(env.captures[0].canvas.height, 1600);
    assert.equal(track.stops, 1); assert.equal(env.video.srcObject, null);
    env.click('shutter'); assert.equal(env.captures.length, 1);
  });
  await t.test('leaving the scan tool, hiding the page and ending the track stop the camera', async () => {
    for (const reason of ['toolchange', 'visibilitychange', 'ended', 'pagehide']) {
      const { track, stream } = media(); const env = environment(async () => stream);
      await env.camera.start();
      if (reason === 'toolchange') { const event = new Event(reason); event.detail = 'merge'; env.document.dispatchEvent(event); }
      if (reason === 'visibilitychange') { env.document.hidden = true; env.document.dispatchEvent(new Event(reason)); }
      if (reason === 'ended') track.dispatchEvent(new Event(reason));
      if (reason === 'pagehide') env.window.dispatchEvent(new Event(reason));
      assert.equal(track.stops, 1, reason); assert.equal(env.get('live').hidden, true);
    }
  });
  await t.test('insecure contexts do not request a camera and video startup failures release it', async () => {
    let requests = 0; const { track, stream } = media();
    const env = environment(async () => { requests++; return stream; });
    env.window.isSecureContext = false; await env.camera.start(); assert.equal(requests, 0);
    assert.match(env.messages[0][0], /HTTPS/);
    env.window.isSecureContext = true; env.video.play = async () => { throw new Error('Cannot play'); };
    await env.camera.start(); assert.ok(track.stops >= 1); assert.equal(env.video.srcObject, null);
  });
});
