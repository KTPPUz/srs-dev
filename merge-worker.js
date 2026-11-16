import { mergePdfFiles } from './merge-pdf.js';

self.onmessage = async event => {
  try {
    const result = await mergePdfFiles(event.data);
    self.postMessage(result, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || 'รวม PDF ไม่สำเร็จ กรุณาลองใหม่' });
  }
};
