import { PDFDocument, PDFSignature, PDFName, PDFDict } from './vendor/pdf-lib.esm.min.js';

// Used inside a disposable worker so cancellation also stops PDF parsing.
export async function mergePdfFiles(files) {
  if (files.length < 2 || files.length > 20) throw new Error('เลือก PDF ตั้งแต่ 2 ถึง 20 ไฟล์');
  if (files.some(file => !file.size || file.size > 50 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new Error('ไฟล์ละไม่เกิน 50 MB และขนาดรวมไม่เกิน 100 MB');
  const output = await PDFDocument.create();
  for (const file of files) {
    let source, pageCount;
    try {
      source = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false, throwOnInvalidObject: true });
      pageCount = source.getPageCount();
    } catch {
      throw new Error(`อ่านไฟล์ ${file.name} ไม่ได้ กรุณาใช้ PDF ที่ไม่เสียหายและไม่ได้เข้ารหัส`);
    }
    if (!pageCount) throw new Error(`ไฟล์ ${file.name} ไม่มีหน้าเอกสาร`);
    if (output.getPageCount() + pageCount > 500) throw new Error('รวมได้ไม่เกิน 500 หน้า');
    // Flatten ordinary forms to preserve their visible values when copying pages.
    // Signed documents cannot be rewritten without invalidating their signatures.
    const acroForm = source.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (acroForm?.has(PDFName.of('XFA'))) throw new Error(`ไฟล์ ${file.name} เป็นฟอร์ม XFA ไม่รองรับการรวมในเบราว์เซอร์`);
    const form = source.getForm();
    if (form.getFields().some(field => field instanceof PDFSignature)) throw new Error(`ไฟล์ ${file.name} มีช่องลายเซ็นดิจิทัล ไม่รองรับการรวม`);
    if (form.getFields().length) form.flatten({ updateFieldAppearances: false });
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }
  return { bytes: await output.save(), pages: output.getPageCount(), files: files.length };
}
