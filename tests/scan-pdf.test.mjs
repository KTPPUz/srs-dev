import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanPdf } from '../scan-pdf.js';

test('PDF stores image streams in page order with byte-accurate xref and lengths', async () => {
  const images = [new Uint8Array([255, 216, 255, 0, 128, 10, 255, 217]), new Uint8Array([255, 216, 255, 10, 0, 255, 217])];
  const blob = createScanPdf([{ width: 100, height: 200, bytes: images[0] }, { width: 300, height: 100, bytes: images[1] }]);
  assert.equal(blob.type, 'application/pdf');
  const bytes = Buffer.from(await blob.arrayBuffer());
  const text = bytes.toString('latin1');
  assert.match(text, /\/Count 2 \/Kids \[3 0 R 6 0 R\]/);
  assert.match(text, /\/MediaBox \[0 0 595.28 841.89\]/);
  assert.match(text, /\/MediaBox \[0 0 841.89 595.28\]/);
  const start = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(start, start + 4), 'xref');
  const rows = text.slice(start).split('\n');
  assert.equal(rows[1], '0 9');
  for (let id = 1; id <= 8; id++) {
    const offset = Number(rows[id + 2].slice(0, 10));
    assert.equal(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`);
  }
  for (const [index, image] of images.entries()) {
    const object = text.indexOf(`${4 + index * 3} 0 obj\n`);
    const stream = text.indexOf('\nstream\n', object) + 8;
    assert.deepEqual(bytes.subarray(stream, stream + image.length), Buffer.from(image));
    assert.equal(text.slice(stream + image.length, stream + image.length + 10), '\nendstream');
  }
});

test('PDF rejects empty, excessive, and invalid page sets', () => {
  assert.throws(() => createScanPdf([]));
  assert.throws(() => createScanPdf(Array(21).fill({})));
  for (const width of [0, -1, NaN, 1.5]) assert.throws(() => createScanPdf([{ width, height: 100, bytes: new Uint8Array([1]) }]));
  assert.throws(() => createScanPdf([{ width: 100, height: 100, bytes: new Uint8Array() }]));
});
