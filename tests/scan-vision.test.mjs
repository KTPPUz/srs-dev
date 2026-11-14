import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDocument, fullFrame, projectiveMap, rectifyDocument, CaptureStability, validCorners, frameQuality } from '../scan-vision.js';

function scene(points, { circle = false, text = true } = {}) {
  const width = 240, height = 300, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = { x: x / (width - 1), y: y / (height - 1) };
    const inside = circle ? Math.hypot((p.x - .5) / .36, (p.y - .5) / .38) < 1 : points?.every((a, i) => {
      const b = points[(i + 1) % 4]; return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    });
    let value = inside ? 220 + p.y * 25 : 35 + p.x * 12;
    if (inside && text && x > 80 && x < 160 && y > 90 && y < 210 && y % 18 < 2) value = 55;
    const index = (y * width + x) * 4; data[index] = data[index + 1] = data[index + 2] = value; data[index + 3] = 255;
  }
  return { data, width, height };
}
const paper = [{ x: .23, y: .12 }, { x: .82, y: .19 }, { x: .88, y: .87 }, { x: .12, y: .83 }];
test('detects the four outer paper corners despite text and a brightness gradient', () => {
  const found = detectDocument(scene(paper));
  assert.ok(found);
  found.forEach((p, i) => assert.ok(Math.hypot(p.x - paper[i].x, p.y - paper[i].y) < .018, JSON.stringify(found)));
});
test('declines uniform backgrounds, circles, tiny sheets and sheets cut by the frame', () => {
  assert.equal(detectDocument(scene(null)), null);
  assert.equal(detectDocument(scene(null, { circle: true, text: false })), null);
  assert.equal(detectDocument(scene([{ x: .4, y: .4 }, { x: .6, y: .4 }, { x: .6, y: .6 }, { x: .4, y: .6 }])), null);
  assert.equal(detectDocument(scene([{ x: 0, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .9 }, { x: 0, y: .9 }])), null);
});
test('projective mapping matches all corners and the known interior of a trapezoid', () => {
  const points = [{ x: .25, y: .2 }, { x: .75, y: .2 }, { x: .9, y: .8 }, { x: .1, y: .8 }];
  const map = projectiveMap(points);
  fullFrame().forEach((p, i) => {
    const out = map(p.x, p.y); assert.ok(Math.hypot(out.x - points[i].x, out.y - points[i].y) < 1e-10);
  });
  const center = map(.5, .5); assert.ok(Math.abs(center.x - .5) < 1e-10); assert.ok(Math.abs(center.y - .430769230769) < 1e-10);
  assert.equal(validCorners([points[0], points[2], points[1], points[3]]), false);
  assert.throws(() => projectiveMap([points[0], points[0], points[0], points[0]]));
});
test('rectification removes outside pixels, retains orientation, and bounds output size', () => {
  const result = rectifyDocument(scene(paper, { text: false }), paper, 180);
  assert.equal(Math.max(result.width, result.height), 180);
  const sample = (x, y) => result.data[(Math.floor(y * (result.height - 1)) * result.width + Math.floor(x * (result.width - 1))) * 4];
  for (const [x, y] of [[.1, .1], [.9, .1], [.9, .9], [.1, .9], [.5, .5]]) assert.ok(sample(x, y) > 215);
  assert.ok(sample(.5, .9) > sample(.5, .1));
});
test('auto capture requires several sharp stable frames and resets for motion, blur, missing edges, or slow drift', () => {
  const stable = new CaptureStability();
  assert.equal(stable.update(paper, 100, 0, 0), 0);
  for (let t = 200; t < 1300; t += 200) assert.ok(stable.update(paper, 100, 0, t) < 1);
  assert.equal(stable.update(paper, 100, 0, 1400), 1);
  for (const [points, sharpness, motion] of [[null, 100, 0], [paper, 10, 0], [paper, 100, 10]]) {
    assert.equal(stable.update(points, sharpness, motion, 1500), 0);
    assert.equal(stable.update(paper, 100, 0, 3000), 0);
  }
  stable.reset();
  for (let i = 0; i < 15; i++) assert.ok(stable.update(paper.map(p => ({ x: p.x + i * .003, y: p.y })), 100, 0, i * 200) < 1);
});
test('image quality distinguishes identical frames, changed frames, and flat blurred scenes', () => {
  const image = scene(paper), first = frameQuality(image, paper);
  assert.ok(first.sharpness > 45);
  assert.equal(frameQuality(image, paper, first.gray).movement, 0);
  const flat = scene(null), quality = frameQuality(flat, paper, first.gray);
  assert.ok(quality.sharpness < 45); assert.ok(quality.movement > 6);
});
