import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual scan.js event handlers without camera hardware. Canvas
// decoding/encoding is stubbed; PDF output still uses the production PDF writer.
async function scanner(t, { pauseAnimationFrames = false } = {}) {
  const keys = ['document', 'window', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'createImageBitmap', 'ImageData'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const urls = [];
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = blob => { const url = createObjectURL(blob); urls.push(url); return url; };
  t.after(() => {
    URL.createObjectURL = createObjectURL; urls.forEach(url => URL.revokeObjectURL(url));
    for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = new Map(); this.style = {}; this.dataset = {}; this.attributes = {}; this.classList = { toggle() {} }; this.disabled = false; this.hidden = false; this.value = ''; this.width = 0; this.height = 0; this.textContent = ''; }
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
    async emit(type, extra = {}) { for (const handler of this.listeners.get(type) || []) await handler({ target: this, preventDefault() {}, ...extra }); }
    async click() { if (!this.disabled) await this.emit('click'); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; if (name === 'href') this.href = ''; }
    focus() {}
    scrollIntoView() {}
    getContext() { return { fillRect() {}, drawImage() {}, putImageData() {}, translate() {}, rotate() {}, getImageData: () => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(this.width * this.height * 4).fill(255) }) }; }
    toBlob(callback) { queueMicrotask(() => callback(new Blob([new Uint8Array([255, 216, 255, 0, 255, 217])], { type: 'image/jpeg' }))); }
  }
  const elements = new Map();
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [, tag, id, attributes] of html.matchAll(/<([\w-]+)\b[^>]*?\bid="([^"]+)"([^>]*)>/g)) {
    const element = new Element(tag); element.hidden = /\bhidden\b/.test(attributes); element.disabled = /\bdisabled\b/.test(attributes); elements.set(id, element);
  }
  for (const edge of ['top', 'bottom', 'left', 'right']) elements.get(`scan-${edge}`).value = '0';
  elements.get('scan-brightness').value = '100'; elements.get('scan-mode').value = 'color';
  elements.get('scan-original').parentElement = new Element();
  const document = new Element(); document.createElement = tag => new Element(tag);
  document.getElementById = id => { assert.ok(elements.has(id), `Missing HTML element ${id}`); return elements.get(id); };
  document.dispatchEvent = event => document.emit(event.type, event);
  const window = new Element(); window.isSecureContext = true;
  let frame = 0; const cancelled = new Set();
  const globals = { document, window, navigator: { mediaDevices: {} },
    requestAnimationFrame: callback => { const id = ++frame; if (!pauseAnimationFrames) queueMicrotask(() => { if (!cancelled.has(id)) callback(0); }); return id; },
    cancelAnimationFrame: id => cancelled.add(id),
    createImageBitmap: async () => ({ width: 40, height: 60, close() {} }),
    ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } }
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  await import(`../scan.js?flow=${Math.random()}`);
  const get = name => document.getElementById(`scan-${name}`);
  async function select() {
    get('input').files = [new File([new Uint8Array([255, 216, 255, 0])], 'document.jpg', { type: 'image/jpeg' })];
    await get('input').emit('change');
    assert.equal(get('editor').hidden, false);
  }
  return { get, select, urls };
}

test('a selected scan can be exported directly without a separate add-page step', async t => {
  const { get, select } = await scanner(t);
  await select();
  assert.equal(get('export').disabled, false, 'Create PDF must accept the scan currently in the editor');
  await get('export').click();
  assert.equal(get('result').hidden, false);
  assert.ok(get('open').href); assert.ok(get('download').href);
  const response = await fetch(get('download').href);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(await response.text(), /\/Count 1 /);
});

test('control: explicitly adding a scan already allows PDF preview and download', async t => {
  const { get, select } = await scanner(t);
  await select(); await get('add').click();
  assert.equal(get('export').disabled, false);
  await get('export').click();
  assert.equal(get('result').hidden, false);
  assert.equal(get('open').href, get('download').href);
  assert.match(await (await fetch(get('download').href)).text(), /\/Count 1 /);
});

test('export includes the current scan after earlier pages and repeated exports do not duplicate it', async t => {
  const { get, select } = await scanner(t);
  await select(); await get('add').click(); await select();
  await get('export').click();
  assert.match(await (await fetch(get('download').href)).text(), /\/Count 2 /);
  await get('export').click();
  assert.match(await (await fetch(get('download').href)).text(), /\/Count 2 /);
});

test('PDF export does not wait for a browser animation frame to display its result', async t => {
  const { get, select } = await scanner(t, { pauseAnimationFrames: true });
  await select(); await get('add').click();
  const completed = get('export').click().then(() => true);
  const result = await Promise.race([completed, new Promise(resolve => setTimeout(() => resolve(false), 80))]);
  assert.equal(result, true, 'PDF creation stalled while waiting for requestAnimationFrame');
  assert.equal(get('result').hidden, false);
});

test('failed image encoding reports an error, preserves the scan, and permits retry', async t => {
  const { get, select } = await scanner(t);
  await select();
  const encode = get('preview').toBlob;
  get('preview').toBlob = callback => queueMicrotask(() => callback(null));
  await get('export').click();
  assert.equal(get('result').hidden, true); assert.equal(get('editor').hidden, false);
  assert.match(get('status').textContent, /ประมวลผลภาพไม่สำเร็จ/);
  assert.equal(get('export').disabled, false);
  get('preview').toBlob = encode;
  await get('export').click();
  assert.equal(get('result').hidden, false);
  assert.match(await (await fetch(get('download').href)).text(), /\/Count 1 /);
});

test('a new scan invalidates old PDF links and double-tapping export does not add duplicate pages', async t => {
  const { get, select } = await scanner(t);
  await select(); await get('export').click();
  const oldUrl = get('download').href;
  await select();
  assert.equal(get('result').hidden, true); assert.equal(get('download').href, ''); assert.equal(get('open').href, '');
  await assert.rejects(fetch(oldUrl));
  await Promise.all([get('export').click(), get('export').click()]);
  assert.match(await (await fetch(get('download').href)).text(), /\/Count 2 /);
  assert.equal(get('export').disabled, false);
});
