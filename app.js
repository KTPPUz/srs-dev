// Images stay in the browser; PDF is processed by the local server.
const CONFIG = Object.freeze({ maxFileBytes: 20 * 1024 * 1024, maxPdfBytes: 50 * 1024 * 1024, maxPixels: 40_000_000, maxDimension: 16384 });
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(['file-input', 'browse', 'drop-zone', 'limits', 'selected', 'file-name', 'file-size', 'remove', 'quality', 'quality-value', 'format', 'dimension', 'format-note', 'compress', 'progress-area', 'progress', 'cancel', 'status', 'result', 'before', 'after', 'before-size', 'after-size', 'saved-badge', 'result-note', 'download'].map(id => [id, $(id)]));
let file = null;
let inputUrl = null;
let outputUrl = null;
let revision = 0;
let busy = false;
let pdfController = null;
const isPdf = () => file?.type === 'application/pdf';
function pdfMode(enabled) {
  document.querySelector('.options').hidden = enabled;
  $('pdf-notice').hidden = !enabled;
  ui.before.hidden = enabled;
  ui.after.hidden = enabled;
  $('pdf-before').hidden = !enabled;
  $('pdf-after').hidden = !enabled;
  document.querySelector('label[for="quality"]').textContent = enabled ? 'คุณภาพภาพภายใน PDF' : 'คุณภาพภาพ';
  ui.download.textContent = enabled ? 'ดาวน์โหลด PDF ↓' : 'ดาวน์โหลดภาพ ↓';
}
const sizes = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
function status(message, error = false) { ui.status.textContent = message; ui.status.classList.toggle('error', error); }
function clearResult() {
  ui.result.hidden = true;
  ui.after.removeAttribute('src');
  ui.download.removeAttribute('href');
  $('pdf-after').removeAttribute('href');
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}
function processing(value) {
  busy = value;
  ui.compress.disabled = value || !file;
  ui['progress-area'].hidden = !value;
  [ui.quality, ui.format, ui.dimension, ...document.querySelectorAll('[data-quality]')].forEach(el => { el.disabled = value; });
  ui.compress.textContent = value ? 'กำลังประมวลผล…' : isPdf() ? 'บีบอัด PDF ↘' : 'บีบอัดภาพ ↘';
}
function reset() {
  revision++;
  pdfController?.abort();
  pdfController = null;
  file = null;
  processing(false);
  clearResult();
  ui.before.removeAttribute('src');
  $('pdf-before').removeAttribute('href');
  pdfMode(false);
  if (inputUrl) URL.revokeObjectURL(inputUrl);
  inputUrl = null;
  ui.selected.hidden = true;
  ui['file-input'].value = '';
  settingsChanged();
  status('เลือกภาพเพื่อเริ่มต้น');
}
function imageInfo(buffer) {
  const a = new Uint8Array(buffer);
  const d = new DataView(buffer);
  const ascii = (at, length) => String.fromCharCode(...a.slice(at, at + length));
  if (a.length >= 24 && a[0] === 137 && ascii(1, 7) === 'PNG\r\n\x1a\n' && ascii(12, 4) === 'IHDR') {
    return { type: 'image/png', width: d.getUint32(16), height: d.getUint32(20) };
  }
  if (a.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    const u24 = (p) => a[p] | a[p + 1] << 8 | a[p + 2] << 16;
    if (kind === 'VP8X') {
      if (a[20] & 2) throw new Error('ยังไม่รองรับ WebP แบบเคลื่อนไหว กรุณาเลือกภาพนิ่ง');
      return { type: 'image/webp', width: u24(24) + 1, height: u24(27) + 1 };
    }
    if (kind === 'VP8 ' && a[23] === 157 && a[24] === 1 && a[25] === 42) return { type: 'image/webp', width: d.getUint16(26, true) & 16383, height: d.getUint16(28, true) & 16383 };
    if (kind === 'VP8L' && a[20] === 47) {
      const bits = d.getUint32(21, true);
      return { type: 'image/webp', width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 };
    }
  }
  if (a[0] === 255 && a[1] === 216 && a[2] === 255) {
    let p = 2;
    while (p + 4 <= a.length) {
      if (a[p++] !== 255) break;
      while (a[p] === 255) p++;
      const marker = a[p++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (p + 2 > a.length) break;
      const length = d.getUint16(p);
      if (length < 2 || p + length > a.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) return { type: 'image/jpeg', width: d.getUint16(p + 5), height: d.getUint16(p + 3) };
      p += length;
    }
  }
  throw new Error('ไม่พบข้อมูลภาพที่ถูกต้อง รองรับเฉพาะ JPG, PNG และ WebP');
}
async function selectFile(files) {
  reset();
  const current = revision;
  if (!files.length) return;
  if (files.length !== 1) { status('กรุณาเลือกครั้งละ 1 ไฟล์ ยังไม่รองรับ batch', true); return; }
  const candidate = files[0];
  try {
    if (!candidate.size) throw new Error('ไฟล์นี้ไม่มีข้อมูล กรุณาเลือกภาพอื่น');
    const pdfCandidate = /\.pdf$/i.test(candidate.name) || candidate.type === 'application/pdf';
    const limit = pdfCandidate ? CONFIG.maxPdfBytes : CONFIG.maxFileBytes;
    if (candidate.size > limit) throw new Error(`ไฟล์ใหญ่เกินกำหนด สูงสุด ${sizes(limit)} ต่อไฟล์`);
    status('กำลังตรวจสอบไฟล์…');
    if (pdfCandidate) {
      const signature = new TextDecoder().decode(await candidate.slice(0, 8).arrayBuffer());
      if (current !== revision) return;
      if (!/\.pdf$/i.test(candidate.name) || candidate.type && candidate.type !== 'application/pdf' || !/^%PDF-(?:1\.[0-7]|2\.0)/.test(signature)) throw new Error('นามสกุล ชนิดไฟล์ หรือ signature PDF ไม่ถูกต้อง');
      file = new File([candidate], candidate.name, { type: 'application/pdf' });
      inputUrl = URL.createObjectURL(file);
      $('pdf-before').href = inputUrl;
      pdfMode(true);
      ui['file-name'].textContent = file.name;
      ui['file-size'].textContent = `${sizes(file.size)} · PDF`;
      ui.selected.hidden = false;
      processing(false);
      settingsChanged();
      status('PDF พร้อมแล้ว เลือกคุณภาพและกดบีบอัด PDF');
      return;
    }
    const info = imageInfo(await candidate.arrayBuffer());
    if (current !== revision) return;
    const extensions = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'image/webp': /\.webp$/i };
    if (!extensions[info.type].test(candidate.name) || candidate.type && candidate.type !== info.type) throw new Error('นามสกุล ชนิดไฟล์ และข้อมูลภายในไม่ตรงกัน กรุณาใช้ไฟล์ภาพที่ถูกต้อง');
    if (!info.width || !info.height || info.width * info.height > CONFIG.maxPixels || Math.max(info.width, info.height) > CONFIG.maxDimension) throw new Error(`ภาพมีความละเอียดเกินกำหนด (สูงสุด ${CONFIG.maxPixels / 1000000} ล้านพิกเซล และด้านละ ${CONFIG.maxDimension.toLocaleString()} px)`);
    file = candidate.type ? candidate : new File([candidate], candidate.name, { type: info.type });
    inputUrl = URL.createObjectURL(file);
    ui.before.src = inputUrl;
    ui['file-name'].textContent = file.name;
    ui['file-size'].textContent = `${sizes(file.size)} · ${info.width.toLocaleString()} × ${info.height.toLocaleString()} px`;
    ui.selected.hidden = false;
    processing(false);
    settingsChanged();
    status('ภาพพร้อมแล้ว เลือกการตั้งค่าแล้วกดบีบอัดภาพ');
  } catch (error) { if (current === revision) status(error.message, true); }
}
function settingsChanged() {
  clearResult();
  ui['quality-value'].value = `${ui.quality.value}%`;
  document.querySelectorAll('[data-quality]').forEach(button => {
    const active = button.dataset.quality === ui.quality.value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const png = ui.format.value === 'image/png' || ui.format.value === 'original' && file?.type === 'image/png';
  if (isPdf()) {
    const dpi = Number(ui.quality.value) >= 85 ? 200 : Number(ui.quality.value) >= 60 ? 150 : 96;
    ui['format-note'].textContent = `PDF → PDF • ภาพภายในเอกสารสูงสุดประมาณ ${dpi} DPI • ไฟล์ที่บีบอัดแล้วอาจไม่เล็กลง`;
    return;
  }
  ui['format-note'].textContent = png ? 'PNG ไม่ใช้ค่า quality; ลดขนาดด้วยการปรับความละเอียด หรือเลือก WebP • ลบ metadata' : ui.format.value === 'image/jpeg' ? 'JPG จะเปลี่ยนพื้นหลังโปร่งใสเป็นสีขาว • ข้อมูล metadata จะถูกลบ' : 'WebP / PNG รองรับพื้นหลังโปร่งใส • ข้อมูล metadata จะถูกลบ';
}
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
function safeName(name, type) {
  const stem = name.replace(/\.[^.]+$/, '').normalize('NFKC').replace(/[\x00-\x1f\x7f/\\:*?"<>|\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100) || 'image';
  return `${stem}-compressed.${{ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[type]}`;
}
async function compressPdf() {
  const current = ++revision;
  const source = file;
  const controller = new AbortController();
  pdfController = controller;
  clearResult();
  processing(true);
  ui.progress.value = 10;
  status('กำลังส่ง PDF ไปประมวลผลที่ localhost…');
  let stage;
  try {
    stage = setTimeout(() => { if (current === revision) { ui.progress.removeAttribute('value'); status('กำลังบีบอัด PDF… ระยะเวลาขึ้นกับจำนวนหน้าและภาพภายในเอกสาร'); } }, 500);
    const response = await fetch(`/api/pdf?quality=${ui.quality.value}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-File-Compressor': '1' }, body: source, signal: controller.signal });
    if (!response.ok) {
      const message = await response.json().catch(() => ({}));
      throw new Error(message.error || 'ไม่สามารถใช้ PDF worker ได้ กรุณาเปิดเว็บผ่าน npm start ที่ localhost:3000');
    }
    const result = await response.blob();
    if (current !== revision) return;
    if (result.type !== 'application/pdf') throw new Error('ผลลัพธ์ PDF ไม่ถูกต้อง กรุณาลองอีกครั้ง');
    const original = response.headers.get('X-PDF-Original') === '1';
    outputUrl = URL.createObjectURL(result);
    $('pdf-after').href = outputUrl;
    ui['before-size'].textContent = sizes(source.size);
    ui['after-size'].textContent = sizes(result.size);
    ui['saved-badge'].textContent = `ลดลง ${Math.max(0, (1 - result.size / source.size) * 100).toFixed(1)}%`;
    ui['result-note'].textContent = original ? 'PDF นี้ลดขนาดเพิ่มเติมไม่ได้ด้วยการตั้งค่านี้ จึงเสนอไฟล์ต้นฉบับแทน ลองเลือกคุณภาพต่ำลง' : `PDF ${response.headers.get('X-PDF-Pages')} หน้า • คงข้อความและเวกเตอร์ • ลดคุณภาพภาพภายในเอกสารและลบ metadata • ไฟล์ชั่วคราวถูกลบเมื่อจบงาน`;
    ui.download.href = outputUrl;
    ui.download.download = safeName(source.name, result.type);
    ui.result.hidden = false;
    status(original ? 'เสร็จแล้ว — เสนอไฟล์ต้นฉบับซึ่งมีขนาดเล็กกว่าหรือเท่ากัน' : `เสร็จแล้ว! ประหยัดพื้นที่ ${sizes(source.size - result.size)}`);
    ui.result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  } catch (error) {
    if (current === revision && error.name !== 'AbortError') status(error.message || 'บีบอัด PDF ไม่สำเร็จ กรุณาลองอีกครั้ง', true);
  } finally {
    clearTimeout(stage);
    if (pdfController === controller) pdfController = null;
    if (current === revision) processing(false);
  }
}
async function compress() {
  if (!file || busy) return;
  if (isPdf()) return compressPdf();
  const current = ++revision;
  const source = file;
  let bitmap;
  let canvas;
  clearResult();
  processing(true);
  ui.progress.value = 5;
  status('กำลังอ่านภาพ…');
  try {
    await nextFrame();
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    if (current !== revision) return;
    ui.progress.value = 35;
    const max = Number(ui.dimension.value);
    const ratio = max ? Math.min(1, max / Math.max(bitmap.width, bitmap.height)) : 1;
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const type = ui.format.value === 'original' ? source.type : ui.format.value;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('อุปกรณ์มีหน่วยความจำไม่พอ กรุณาลดความละเอียดหรือใช้ภาพที่เล็กลง');
    if (type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close(); bitmap = null;
    ui.progress.value = 65;
    status('กำลังเข้ารหัสภาพ… คุณสามารถยกเลิกผลลัพธ์ได้');
    await nextFrame();
    if (current !== revision) return;
    const encoded = await new Promise(resolve => canvas.toBlob(resolve, type, Number(ui.quality.value) / 100));
    if (current !== revision) return;
    if (!encoded) throw new Error('ไม่สามารถประมวลผลภาพนี้ได้ ลองลดความละเอียดหรือเลือกภาพอื่น');
    if (encoded.type !== type) throw new Error('เบราว์เซอร์นี้ไม่รองรับการบันทึกรูปแบบที่เลือก กรุณาลอง JPG หรือ PNG');
    const smaller = encoded.size < source.size;
    const result = smaller ? encoded : source;
    const saved = Math.max(0, (1 - result.size / source.size) * 100);
    outputUrl = URL.createObjectURL(result);
    ui.after.src = outputUrl;
    ui['before-size'].textContent = sizes(source.size);
    ui['after-size'].textContent = sizes(result.size);
    ui['saved-badge'].textContent = `ลดลง ${saved.toFixed(1)}%`;
    ui['result-note'].textContent = smaller ? `ผลลัพธ์ ${canvas.width.toLocaleString()} × ${canvas.height.toLocaleString()} px · ${result.type.split('/')[1].toUpperCase()} · ข้อมูล metadata ถูกลบ; สีอาจต่างจากต้นฉบับเล็กน้อย` : 'ภาพนี้ลดขนาดเพิ่มเติมไม่ได้ด้วยการตั้งค่านี้ จึงเสนอไฟล์ต้นฉบับแทน (รูปแบบ ความละเอียด และ metadata เดิม) ลองลดคุณภาพหรือความละเอียดอีกครั้ง';
    ui.download.href = outputUrl;
    ui.download.download = safeName(source.name, result.type);
    ui.progress.value = 100;
    ui.result.hidden = false;
    status(smaller ? `เสร็จแล้ว! ประหยัดพื้นที่ ${sizes(source.size - result.size)}` : 'เสร็จแล้ว — ไฟล์ต้นฉบับมีขนาดเล็กกว่าหรือเท่ากับผลลัพธ์');
    ui.result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  } catch (error) {
    if (current === revision) status(error.name === 'InvalidStateError' ? 'ไม่สามารถอ่านภาพได้ ไฟล์อาจเสีย กรุณาเลือกภาพอื่น' : error.message || 'ประมวลผลล้มเหลว กรุณาลองอีกครั้ง', true);
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (current === revision) processing(false);
  }
}
ui.limits.textContent = `JPG, PNG, WebP ≤ ${sizes(CONFIG.maxFileBytes)} · PDF ≤ ${sizes(CONFIG.maxPdfBytes)}`;
ui.browse.addEventListener('click', () => ui['file-input'].click());
ui['file-input'].addEventListener('change', e => { selectFile([...e.target.files]); });
ui.remove.addEventListener('click', reset);
ui['drop-zone'].addEventListener('dragover', e => { e.preventDefault(); ui['drop-zone'].classList.add('dragging'); });
ui['drop-zone'].addEventListener('dragleave', () => ui['drop-zone'].classList.remove('dragging'));
ui['drop-zone'].addEventListener('drop', e => { e.preventDefault(); ui['drop-zone'].classList.remove('dragging'); selectFile([...e.dataTransfer.files]); });
// Prevent dropping files elsewhere from navigating away from the application.
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
document.querySelectorAll('[data-quality]').forEach(button => button.addEventListener('click', () => { ui.quality.value = button.dataset.quality; settingsChanged(); }));
[ui.quality, ui.format, ui.dimension].forEach(el => el.addEventListener('input', settingsChanged));
ui.compress.addEventListener('click', compress);
ui.cancel.addEventListener('click', () => { revision++; pdfController?.abort(); pdfController = null; processing(false); status('ยกเลิกแล้ว ปรับการตั้งค่าหรือกดบีบอัดเพื่อลองอีกครั้ง'); });
window.addEventListener('pagehide', () => { pdfController?.abort(); if (inputUrl) URL.revokeObjectURL(inputUrl); if (outputUrl) URL.revokeObjectURL(outputUrl); });
settingsChanged();
