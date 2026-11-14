import { createScanPdf } from './scan-pdf.js';
const $ = id => document.getElementById(`scan-${id}`);
const edges = ['top', 'bottom', 'left', 'right'];
const pages = [];
let source = null, sourceName = '', outputUrl = null, busy = false, frame = 0;
const message = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
function clearResult() {
  $('result').hidden = true;
  $('download').removeAttribute('href'); $('open').removeAttribute('href');
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}
function controls() {
  for (const id of ['browse', 'camera', 'input', 'capture', 'rotate', 'reset', 'mode', 'brightness', ...edges]) $(id).disabled = busy;
  $('add').disabled = busy || !source || pages.length >= 20;
  $('export').disabled = busy || !pages.length;
  $('list').querySelectorAll('button').forEach(button => { button.disabled = busy || button.dataset.boundary === 'true'; });
}
function resetAdjustments() {
  for (const edge of edges) $(edge).value = 0;
  $('brightness').value = 100; $('mode').value = 'color';
  preview();
}
function preview() {
  if (!source) return;
  const crop = Object.fromEntries(edges.map(edge => [edge, Number($(edge).value) / 100]));
  for (const edge of edges) {
    $(`${edge}-value`).textContent = `${$(edge).value}%`;
    $('crop').style[edge] = `${$(edge).value}%`;
  }
  $('brightness-value').textContent = `${$('brightness').value}%`;
  const canvas = $('preview');
  const w = source.width * (1 - crop.left - crop.right), h = source.height * (1 - crop.top - crop.bottom);
  canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, source.width * crop.left, source.height * crop.top, w, h, 0, 0, canvas.width, canvas.height);
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
    source = next; sourceName = file.name;
    cancelAnimationFrame(frame); drawOriginal(); resetAdjustments(); $('editor').hidden = false;
    message('ปรับภาพแล้วกด “เพิ่มหน้านี้” จากนั้นถ่ายหรือเลือกรูปหน้าถัดไป');
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
$('browse').addEventListener('click', () => $('input').click());
$('camera').addEventListener('click', () => $('capture').click());
for (const id of ['input', 'capture']) $(id).addEventListener('change', event => load(event.target.files[0]));
for (const id of [...edges, 'brightness', 'mode']) $(id).addEventListener('input', schedulePreview);
$('reset').addEventListener('click', resetAdjustments);
$('rotate').addEventListener('click', () => {
  if (!source || busy) return;
  const next = document.createElement('canvas'); next.width = source.height; next.height = source.width;
  const ctx = next.getContext('2d'); ctx.translate(next.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(source, 0, 0);
  source = next; drawOriginal(); resetAdjustments();
});
$('add').addEventListener('click', async () => {
  if (!source || busy || pages.length >= 20) return;
  busy = true; controls(); message('กำลังเพิ่มหน้า…');
  try {
    cancelAnimationFrame(frame); preview();
    const canvas = $('preview');
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
    if (!blob) throw new Error('ประมวลผลภาพไม่สำเร็จ กรุณาลองใหม่');
    if (pages.reduce((sum, page) => sum + page.bytes.length, 0) + blob.size > 60 * 1024 * 1024) throw new Error('ภาพรวมต้องไม่เกิน 60 MB กรุณานำบางหน้าออก');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    clearResult(); pages.push({ width: canvas.width, height: canvas.height, bytes, name: sourceName, url: URL.createObjectURL(blob) });
    source = null; $('editor').hidden = true;
    for (const id of ['original', 'preview']) { $(id).width = 1; $(id).height = 1; }
    render(); message(`เพิ่มแล้ว ${pages.length} หน้า เลือกรูปถัดไปหรือสร้าง PDF ได้เลย`);
  } catch (error) { message(error.message, true); }
  finally { busy = false; controls(); }
});
$('export').addEventListener('click', async () => {
  if (busy || !pages.length) return;
  busy = true; controls(); clearResult(); message('กำลังสร้าง PDF…');
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const blob = createScanPdf(pages); outputUrl = URL.createObjectURL(blob);
    $('download').href = outputUrl; $('open').href = outputUrl;
    $('result-info').textContent = `${pages.length} หน้า · ${(blob.size / 1048576).toFixed(2)} MB`;
    $('result').hidden = false; message('สร้าง PDF สำเร็จ ดาวน์โหลดได้เลย');
  } catch (error) { message(error.message || 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่', true); }
  finally { busy = false; controls(); }
});
window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); });
render();
