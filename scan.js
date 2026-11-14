import { createScanPdf } from './scan-pdf.js';
import { detectDocument, fullFrame, validCorners, rectifyDocument } from './scan-vision.js';
import { createDocumentCamera } from './scan-camera.js';
const $ = id => document.getElementById(`scan-${id}`);
const edges = ['top', 'bottom', 'left', 'right'];
const pages = [];
let source = null, sourceName = '', outputUrl = null, busy = false, frame = 0;
let corners = fullFrame(), initialCorners = fullFrame(), rectified = null;
const message = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const camera = createDocumentCamera((canvas, detected) => {
  try { acceptSource(canvas, `scan-${pages.length + 1}.jpg`, detected); }
  catch { message('เตรียมภาพไม่สำเร็จ กรุณาถ่ายใหม่', true); }
}, message);
function clearResult() {
  $('result').hidden = true;
  $('download').removeAttribute('href'); $('open').removeAttribute('href');
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}
function controls() {
  for (const id of ['browse', 'camera', 'native-camera', 'input', 'capture', 'rotate', 'reset', 'detect', 'full-frame', 'mode', 'brightness', ...edges]) $(id).disabled = busy;
  $('corner-handles').querySelectorAll('button').forEach(button => { button.disabled = busy; });
  $('add').disabled = busy || !source || pages.length >= 20;
  const count = pages.length + Number(!!source);
  $('export').disabled = busy || !count;
  $('export').textContent = busy ? 'กำลังประมวลผล…' : count ? `สร้าง PDF (${count} หน้า) ↓` : 'สร้าง PDF ↓';
  $('summary').textContent = source ? `${pages.length} หน้าในรายการ + ภาพที่กำลังตรวจ 1 หน้า · กดสร้าง PDF เพื่อบันทึกทั้งหมดได้เลย` : pages.length ? `พร้อมสร้าง PDF ${pages.length} หน้า` : 'ถ่ายภาพหรือเลือกรูป แล้วกดสร้าง PDF ได้เลย';
  $('list').querySelectorAll('button').forEach(button => { button.disabled = busy || button.dataset.boundary === 'true'; });
}
function resetAdjustments() {
  for (const edge of edges) $(edge).value = 0;
  $('brightness').value = 100; $('mode').value = 'color';
  corners = initialCorners.map(p => ({ ...p })); rectified = null; drawCorners();
  preview();
}
function drawCorners() {
  $('corners-outline').setAttribute('points', corners.map(p => `${p.x * 1000},${p.y * 1000}`).join(' '));
  [...$('corner-handles').children].forEach((button, i) => {
    button.style.left = `${corners[i].x * 100}%`; button.style.top = `${corners[i].y * 100}%`;
    button.setAttribute('aria-label', `${['มุมซ้ายบน', 'มุมขวาบน', 'มุมขวาล่าง', 'มุมซ้ายล่าง'][i]}: ${Math.round(corners[i].x * 100)}%, ${Math.round(corners[i].y * 100)}% ใช้ปุ่มลูกศรเพื่อขยับ`);
  });
}
function findCorners(canvas) {
  const small = document.createElement('canvas'), scale = Math.min(1, 360 / Math.max(canvas.width, canvas.height));
  small.width = Math.max(2, Math.round(canvas.width * scale)); small.height = Math.max(2, Math.round(canvas.height * scale));
  const ctx = small.getContext('2d'); ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return detectDocument(ctx.getImageData(0, 0, small.width, small.height));
}
function acceptSource(canvas, name, detected = null) {
  source = canvas; sourceName = name;
  const found = detected || findCorners(canvas);
  initialCorners = found || fullFrame();
  cancelAnimationFrame(frame); drawOriginal(); resetAdjustments(); $('editor').hidden = false;
  clearResult();
  controls();
  message(found ? 'จับขอบและปรับมุมให้แล้ว ตรวจภาพแล้วกด “สร้าง PDF” ได้เลย หรือเพิ่มหน้าเพื่อสแกนต่อ' : 'ยังจับขอบไม่ได้ ลากจุดทั้ง 4 ให้ตรงมุมกระดาษ หรือใช้ภาพเต็ม แล้วกดสร้าง PDF');
}
function rectifiedSource() {
  if (!rectified) {
    const ctx = source.getContext('2d');
    const result = rectifyDocument(ctx.getImageData(0, 0, source.width, source.height), corners);
    rectified = document.createElement('canvas'); rectified.width = result.width; rectified.height = result.height;
    rectified.getContext('2d').putImageData(new ImageData(result.data, result.width, result.height), 0, 0);
  }
  return rectified;
}
function preview() {
  if (!source) return;
  const corrected = rectifiedSource();
  const crop = Object.fromEntries(edges.map(edge => [edge, Number($(edge).value) / 100]));
  for (const edge of edges) {
    $(`${edge}-value`).textContent = `${$(edge).value}%`;
  }
  $('brightness-value').textContent = `${$('brightness').value}%`;
  const canvas = $('preview');
  const w = corrected.width * (1 - crop.left - crop.right), h = corrected.height * (1 - crop.top - crop.bottom);
  canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(corrected, corrected.width * crop.left, corrected.height * crop.top, w, h, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const brightness = Number($('brightness').value) / 100, mode = $('mode').value;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const d = pixels.data;
    if (mode === 'color') { for (let j = 0; j < 3; j++) d[i + j] *= brightness; }
    else {
      const gray = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) * brightness;
      d[i] = d[i + 1] = d[i + 2] = mode === 'bw' ? (gray >= 150 ? 255 : 0) : gray;
    }
  }
  ctx.putImageData(pixels, 0, 0);
}
function schedulePreview() { cancelAnimationFrame(frame); frame = requestAnimationFrame(preview); }
function drawOriginal() {
  const canvas = $('original'); canvas.width = source.width; canvas.height = source.height;
  canvas.parentElement.style.width = `${430 * source.width / source.height}px`;
  canvas.getContext('2d').drawImage(source, 0, 0);
}
async function load(file) {
  if (!file || busy) return;
  camera.stop();
  busy = true; controls(); message('กำลังเปิดภาพ…');
  let bitmap;
  try {
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('รูปต้องมีข้อมูลและขนาดไม่เกิน 20 MB');
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
    const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    if (!jpg && !png && !webp) throw new Error('รองรับ JPG / PNG / WebP กรุณาแปลง HEIC เป็น JPG ก่อน');
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (bitmap.width * bitmap.height > 40_000_000 || Math.max(bitmap.width, bitmap.height) > 16384) throw new Error('รูปต้องไม่เกิน 40 ล้านพิกเซล และด้านละ 16,384 px');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const next = document.createElement('canvas');
    next.width = Math.max(1, Math.round(bitmap.width * scale)); next.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = next.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, next.width, next.height);
    ctx.drawImage(bitmap, 0, 0, next.width, next.height);
    acceptSource(next, file.name);
  } catch (error) { message(error.message || 'เปิดภาพไม่สำเร็จ กรุณาลองรูปอื่น', true); }
  finally { bitmap?.close(); busy = false; $('input').value = ''; $('capture').value = ''; controls(); }
}
function render() {
  $('list').replaceChildren();
  pages.forEach((page, index) => {
    const item = document.createElement('li'); item.className = 'merge-row'; item.tabIndex = -1;
    const image = document.createElement('img'); image.src = page.url; image.alt = `หน้าที่ ${index + 1}`; image.className = 'scan-thumbnail';
    const detail = document.createElement('div'); detail.className = 'file-details';
    const name = document.createElement('strong'); name.textContent = `${index + 1}. ${page.name}`;
    const size = document.createElement('span'); size.textContent = `${page.width} × ${page.height} px`;
    detail.append(name, size);
    const actions = document.createElement('div'); actions.className = 'merge-row-actions';
    for (const [label, title, direction] of [['↑', 'เลื่อนขึ้น', -1], ['↓', 'เลื่อนลง', 1], ['×', 'นำออก', 0]]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-button'; button.textContent = label;
      button.setAttribute('aria-label', `${title} หน้าที่ ${index + 1}`);
      button.dataset.boundary = String(!!direction && (index + direction < 0 || index + direction >= pages.length));
      button.addEventListener('click', () => {
        if (busy) return;
        clearResult();
        if (direction) [pages[index], pages[index + direction]] = [pages[index + direction], pages[index]];
        else { URL.revokeObjectURL(page.url); pages.splice(index, 1); }
        render(); message(`มีเอกสาร ${pages.length} หน้า พร้อมสร้าง PDF`);
        const next = direction ? index + direction : Math.min(index, pages.length - 1);
        if (next >= 0) $('list').children[next]?.focus(); else $('browse').focus();
      });
      actions.append(button);
    }
    item.append(image, detail, actions); $('list').append(item);
  });
  controls();
}
$('browse').addEventListener('click', () => { camera.stop(); $('input').click(); });
$('camera').addEventListener('click', () => { if (!busy) camera.start(); });
$('native-camera').addEventListener('click', () => { camera.stop(); $('capture').click(); });
for (const id of ['input', 'capture']) $(id).addEventListener('change', event => load(event.target.files[0]));
for (const id of [...edges, 'brightness', 'mode']) $(id).addEventListener('input', schedulePreview);
$('reset').addEventListener('click', resetAdjustments);
$('detect').addEventListener('click', () => {
  if (!source || busy) return;
  const found = findCorners(source);
  if (!found) { message('ยังจับขอบไม่ได้ ลองลากจุดทั้ง 4 ให้ตรงมุมกระดาษ', true); return; }
  corners = found; rectified = null; drawCorners(); schedulePreview(); message('จับขอบใหม่แล้ว ตรวจภาพก่อนเพิ่มหน้า');
});
$('full-frame').addEventListener('click', () => { if (busy) return; corners = fullFrame(); rectified = null; drawCorners(); schedulePreview(); });
for (let i = 0; i < 4; i++) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'scan-corner';
  button.textContent = String(i + 1);
  function move(x, y) {
    if (!source || busy) return;
    const next = corners.map(p => ({ ...p })); next[i] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    if (validCorners(next)) { corners = next; rectified = null; drawCorners(); }
  }
  button.addEventListener('pointerdown', event => { if (busy) return; event.preventDefault(); button.focus(); button.setPointerCapture(event.pointerId); });
  button.addEventListener('pointermove', event => {
    if (!button.hasPointerCapture(event.pointerId)) return;
    const box = $('original').getBoundingClientRect(); move((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, schedulePreview);
  button.addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault(); const step = event.shiftKey ? .02 : .005;
    move(corners[i].x + delta[0] * step, corners[i].y + delta[1] * step); schedulePreview();
  });
  $('corner-handles').append(button);
}
$('rotate').addEventListener('click', () => {
  if (!source || busy) return;
  const next = document.createElement('canvas'); next.width = source.height; next.height = source.width;
  const ctx = next.getContext('2d'); ctx.translate(next.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(source, 0, 0);
  const turned = corners.map(p => ({ x: 1 - p.y, y: p.x }));
  initialCorners = [turned[3], turned[0], turned[1], turned[2]];
  source = next; drawOriginal(); resetAdjustments();
});
async function appendCurrentPage() {
  if (!source) return;
  if (pages.length >= 20) throw new Error('บันทึกได้สูงสุด 20 หน้า กรุณานำบางหน้าออกก่อนสร้าง PDF');
  cancelAnimationFrame(frame); preview();
  const canvas = $('preview');
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
  if (!blob) throw new Error('ประมวลผลภาพไม่สำเร็จ กรุณาลองใหม่');
  if (pages.reduce((sum, page) => sum + page.bytes.length, 0) + blob.size > 60 * 1024 * 1024) throw new Error('ภาพรวมต้องไม่เกิน 60 MB กรุณานำบางหน้าออก');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const page = { width: canvas.width, height: canvas.height, bytes, name: sourceName, url: URL.createObjectURL(blob) };
  clearResult(); pages.push(page);
  source = null; rectified = null; $('editor').hidden = true;
  for (const id of ['original', 'preview']) { $(id).width = 1; $(id).height = 1; }
  render();
}
$('add').addEventListener('click', async () => {
  if (!source || busy || pages.length >= 20) return;
  busy = true;
  try {
    controls(); message('กำลังเพิ่มหน้า…'); camera.stop();
    await appendCurrentPage();
    message(`เพิ่มแล้ว ${pages.length} หน้า เปิดกล้องสแกนหน้าถัดไปหรือสร้าง PDF ได้เลย`);
  } catch (error) { message(error.message, true); }
  finally { busy = false; controls(); }
});
$('export').addEventListener('click', async () => {
  if (busy) return;
  if (!pages.length && !source) { message('ถ่ายภาพหรือเลือกรูปก่อนสร้าง PDF', true); return; }
  busy = true;
  try {
    controls(); clearResult(); message('กำลังสร้าง PDF…'); camera.stop();
    await appendCurrentPage();
    const blob = createScanPdf(pages); outputUrl = URL.createObjectURL(blob);
    $('download').href = outputUrl; $('open').href = outputUrl;
    $('result-info').textContent = `${pages.length} หน้า · ${(blob.size / 1048576).toFixed(2)} MB`;
    $('result').hidden = false; message('สร้าง PDF สำเร็จ ดาวน์โหลดได้เลย');
    $('result').scrollIntoView({ behavior: 'auto', block: 'nearest' });
  } catch (error) { message(error.message || 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่', true); }
  finally { busy = false; controls(); }
});
window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); });
render();
