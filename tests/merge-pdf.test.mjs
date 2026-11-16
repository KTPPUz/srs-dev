import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from '../vendor/pdf-lib.esm.min.js';
import { mergePdfFiles } from '../merge-pdf.js';

async function pdf(widths, prepare = () => {}) {
  const doc = await PDFDocument.create();
  widths.forEach(width => doc.addPage([width, 300]).drawText(`Page ${width}`));
  prepare(doc);
  return new File([await doc.save({ updateFieldAppearances: false })], 'document.pdf', { type: 'application/pdf' });
}

test('local merge preserves page order, dimensions, vector content and repeated files', async () => {
  const a = await pdf([101, 102]), b = await pdf([201]);
  const result = await mergePdfFiles([b, a, b]);
  const output = await PDFDocument.load(result.bytes);
  assert.deepEqual(output.getPages().map(page => page.getWidth()), [201, 101, 102, 201]);
  assert.equal(result.pages, 4);
  assert.equal(result.files, 3);
  assert.ok(output.getPages().every(page => page.node.Contents()), 'Copied pages must retain their drawing commands');
});

test('rejects corrupt and encrypted inputs without returning a partial merge', async () => {
  const valid = await pdf([100]);
  await assert.rejects(mergePdfFiles([valid, new File(['%PDF-1.7 invalid'], 'bad.pdf')]), /อ่านไฟล์ bad.pdf ไม่ได้/);
  const encrypted = await pdf([100], doc => {
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }));
  });
  await assert.rejects(mergePdfFiles([valid, encrypted]), /ไม่ได้เข้ารหัส/);
});

test('enforces file count, byte and page limits', async () => {
  const valid = await pdf([100]);
  await assert.rejects(mergePdfFiles([valid]), /2 ถึง 20/);
  await assert.rejects(mergePdfFiles(Array(21).fill(valid)), /2 ถึง 20/);
  await assert.rejects(mergePdfFiles([valid, { size: 51 * 1024 * 1024 }]), /50 MB/);
  const many = await pdf(Array(251).fill(100));
  await assert.rejects(mergePdfFiles([many, many]), /500 หน้า/);
});

test('flattens form values and rejects signature fields and XFA', async () => {
  const valid = await pdf([100]);
  const form = await pdf([200], doc => {
    const field = doc.getForm().createTextField('name');
    field.setText('Example'); field.addToPage(doc.getPage(0));
  });
  const merged = await PDFDocument.load((await mergePdfFiles([form, valid])).bytes);
  assert.equal(merged.getForm().getFields().length, 0);
  assert.equal(merged.getPageCount(), 2);
  const signature = await pdf([100], doc => {
    const ref = doc.context.register(doc.context.obj({ FT: 'Sig', T: PDFString.of('signature') }));
    doc.getForm().acroForm.addField(ref);
  });
  await assert.rejects(mergePdfFiles([signature, valid]), /ลายเซ็น/);
  const xfa = await pdf([100], doc => doc.getForm().acroForm.dict.set(PDFName.of('XFA'), PDFString.of('form')));
  await assert.rejects(mergePdfFiles([xfa, valid]), /XFA/);
});
