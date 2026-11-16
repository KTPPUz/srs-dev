import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';
import { mergePdfFiles } from '../merge-pdf.js';

test('static hosting can select, reorder, merge, cancel and retry without an API', async t => {
  execFileSync(process.execPath, ['scripts/build-pages.mjs'], { cwd: new URL('../', import.meta.url), env: { ...process.env, API_BASE_URL: '' } });
  // Import the actual built UI: STATIC_ONLY=true, API_BASE_URL="".
  const keys = ['document', 'window', 'Worker', 'matchMedia'];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const urls = [];
  t.after(() => {
    urls.forEach(url => URL.revokeObjectURL(url));
    keys.forEach((key, i) => saved[i] ? Object.defineProperty(globalThis, key, saved[i]) : delete globalThis[key]);
  });
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.classList = { toggle() {} }; this.disabled = false; this.hidden = false; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    async emit(type, extra = {}) { return this.listeners[type]?.({ target: this, preventDefault() {}, ...extra }); }
    async click() { if (!this.disabled) return this.emit('click'); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    setAttribute() {}
    removeAttribute(name) { delete this[name]; }
    focus() {}
    scrollIntoView() {}
  }
  const elements = new Map([...readFileSync(new URL('../_site/index.html', import.meta.url), 'utf8').matchAll(/<([\w-]+)\b[^>]*?\bid="([^"]+)"([^>]*)>/g)].map(([, tag, id, attrs]) => {
    const element = new Element(tag); element.disabled = /\bdisabled\b/.test(attrs); element.hidden = /\bhidden\b/.test(attrs); return [id, element];
  }));
  let terminated = 0, pause = false;
  class Worker {
    constructor(url, options) { assert.match(url.pathname, /merge-worker.js$/); assert.equal(options.type, 'module'); }
    terminate() { this.stopped = true; terminated++; }
    postMessage(files) {
      if (pause) return;
      mergePdfFiles(files).then(result => { if (!this.stopped) this.onmessage({ data: result }); }, error => { if (!this.stopped) this.onmessage({ data: { error: error.message } }); });
    }
  }
  const globals = { document: { getElementById: id => elements.get(id), createElement: tag => new Element(tag) }, window: { addEventListener() {} }, Worker, matchMedia: () => ({ matches: true }) };
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  await import(`../_site/merge.js?test=${Date.now()}`);
  const get = name => elements.get(`merge-${name}`);
  assert.equal(get('browse').disabled, false);
  assert.equal(get('input').disabled, false);
  assert.equal(get('submit').disabled, true);
  assert.match(get('privacy').textContent, /ไม่อัปโหลด/);
  const make = async width => { const doc = await PDFDocument.create(); doc.addPage([width, 300]); return new File([await doc.save()], 'test.pdf', { type: 'application/pdf' }); };
  get('input').files = [await make(100), await make(200)];
  await get('input').emit('change');
  assert.equal(get('submit').disabled, false);
  await get('list').children[1].children[2].children[0].click();
  await get('submit').click();
  assert.equal(get('result').hidden, false);
  urls.push(get('download').href);
  const output = await PDFDocument.load(await (await fetch(get('download').href)).arrayBuffer());
  assert.deepEqual(output.getPages().map(page => page.getWidth()), [200, 100]);
  assert.match(get('result-info').textContent, /2 ไฟล์ → 1 PDF · 2 หน้า/);
  pause = true;
  const pending = get('submit').click();
  assert.equal(get('browse').disabled, true);
  await get('cancel').click(); await pending;
  assert.equal(get('browse').disabled, false);
  assert.equal(get('result').hidden, true);
  pause = false;
  await get('submit').click();
  assert.equal(get('result').hidden, false);
  urls.push(get('download').href);
  assert.equal(terminated, 3);
});
