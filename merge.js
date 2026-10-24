const $ = id => document.getElementById(id);
const MAX = { files: 20, each: 50 * 1024 * 1024, total: 100 * 1024 * 1024 };
const sizes = bytes => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
let files = [];
let outputUrl = null;
let controller = null;
let revision = 0;
let validating = false;
const message = (text, error = false) => { $('merge-status').textContent = text; $('merge-status').classList.toggle('error', error); };
function clearResult() {
  $('merge-result').hidden = true;
  $('merge-download').removeAttribute('href');
  $('merge-preview').removeAttribute('href');
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}
function controls() {
  const disabled = !!controller || validating;
  $('merge-browse').disabled = disabled;
  $('merge-input').disabled = disabled;
  $('merge-submit').disabled = disabled || files.length < 2;
  $('merge-submit').textContent = controller ? 'กำลังรวม PDF…' : 'รวม PDF ＋';
  $('merge-progress').hidden = !controller;
  $('merge-list').querySelectorAll('button').forEach(button => { button.disabled = disabled || button.dataset.boundary === 'true'; });
}
function render() {
  $('merge-list').replaceChildren();
  files.forEach((file, index) => {
    const item = document.createElement('li');
    item.className = 'merge-row';
    item.tabIndex = -1;
    const number = document.createElement('span');
    number.className = 'merge-number'; number.textContent = index + 1;
    const detail = document.createElement('div'); detail.className = 'file-details';
    const name = document.createElement('strong'); name.textContent = file.name;
    const size = document.createElement('span'); size.textContent = sizes(file.size);
    detail.append(name, size);
    const actions = document.createElement('div'); actions.className = 'merge-row-actions';
    for (const [label, title, direction] of [['↑', 'เลื่อนขึ้น', -1], ['↓', 'เลื่อนลง', 1], ['×', 'นำออก', 0]]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-button';
      button.textContent = label; button.setAttribute('aria-label', `${title}: ${file.name}`);
      button.dataset.boundary = String(direction !== 0 && (index + direction < 0 || index + direction >= files.length));
      button.addEventListener('click', () => {
        if (controller || validating) return;
        clearResult();
        const next = direction ? index + direction : Math.min(index, files.length - 2);
        if (direction) [files[index], files[next]] = [files[next], files[index]];
        else files.splice(index, 1);
        render();
        message(direction ? `ย้ายไฟล์ไปลำดับ ${next + 1} แล้ว` : 'นำไฟล์ออกแล้ว');
        if (next >= 0) $('merge-list').children[next]?.focus();
        else $('merge-browse').focus();
      });
      actions.append(button);
    }
    item.append(number, detail, actions);
    $('merge-list').append(item);
  });
  $('merge-summary').textContent = files.length ? `${files.length} ไฟล์ · รวม ${sizes(files.reduce((sum, file) => sum + file.size, 0))}` : 'ยังไม่มีไฟล์ที่เลือก';
  controls();
}
async function addFiles(candidates) {
  if (controller || validating || !candidates.length) return;
  validating = true;
  controls();
  try {
    if (files.length + candidates.length > MAX.files) throw new Error('เลือกได้สูงสุด 20 ไฟล์ต่อการรวมหนึ่งครั้ง');
    if ([...files, ...candidates].reduce((sum, file) => sum + file.size, 0) > MAX.total) throw new Error('ขนาดไฟล์รวมต้องไม่เกิน 100 MB');
    const checked = [];
    for (const candidate of candidates) {
      if (!/\.pdf$/i.test(candidate.name) || candidate.type && candidate.type !== 'application/pdf') throw new Error('รองรับเฉพาะไฟล์ PDF สำหรับการรวมไฟล์');
      if (!candidate.size || candidate.size > MAX.each) throw new Error('แต่ละ PDF ต้องมีข้อมูลและขนาดไม่เกิน 50 MB');
      const signature = new TextDecoder().decode(await candidate.slice(0, 8).arrayBuffer());
      if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(signature)) throw new Error(`ไฟล์ ${candidate.name} ไม่มี signature PDF ที่ถูกต้อง`);
      checked.push(new File([candidate], candidate.name, { type: 'application/pdf' }));
    }
    clearResult();
    files.push(...checked);
    render();
    message(files.length < 2 ? 'เพิ่ม PDF อีกอย่างน้อย 1 ไฟล์เพื่อรวม' : 'ไฟล์พร้อมแล้ว จัดลำดับและกดรวม PDF');
  } catch (error) { message(error.message, true); }
  finally { validating = false; $('merge-input').value = ''; controls(); }
}
async function merge() {
  if (controller || validating || files.length < 2) return;
  const current = ++revision;
  const request = new AbortController(); controller = request;
  clearResult(); controls();
  message('กำลังรวม PDF ที่ localhost…');
  try {
    const form = new FormData();
    // Array order is the page order, including intentionally repeated files.
    files.forEach((file, index) => form.append('files', file, `${index + 1}.pdf`));
    const response = await fetch('/api/pdf/merge', { method: 'POST', headers: { 'X-File-Compressor': '1' }, body: form, signal: request.signal });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `รวม PDF ไม่สำเร็จ (HTTP ${response.status}) กรุณารีเฟรชแล้วลองอีกครั้ง`);
    }
    const output = await response.blob();
    if (current !== revision) return;
    if (output.type !== 'application/pdf') throw new Error('ผลลัพธ์ไม่ใช่ PDF กรุณาลองใหม่');
    outputUrl = URL.createObjectURL(output);
    $('merge-download').href = outputUrl;
    $('merge-preview').href = outputUrl;
    $('merge-result-info').textContent = `${response.headers.get('X-PDF-Files')} ไฟล์ → 1 PDF · ${response.headers.get('X-PDF-Pages')} หน้า · ${sizes(output.size)}`;
    $('merge-result').hidden = false;
    message('รวม PDF สำเร็จแล้ว ดาวน์โหลดหรือเปิดดูผลลัพธ์ได้เลย');
    $('merge-result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  } catch (error) { if (current === revision && error.name !== 'AbortError') message(error.message, true); }
  finally { if (controller === request) controller = null; controls(); }
}
function selectTool(merging) {
  $('compress-panel').hidden = merging;
  $('merge-panel').hidden = !merging;
  $('compression-tab').setAttribute('aria-pressed', String(!merging));
  $('merge-tab').setAttribute('aria-pressed', String(merging));
}
$('compression-tab').addEventListener('click', () => selectTool(false));
$('merge-tab').addEventListener('click', () => selectTool(true));
$('merge-browse').addEventListener('click', () => $('merge-input').click());
$('merge-input').addEventListener('change', event => addFiles([...event.target.files]));
$('merge-drop').addEventListener('dragover', event => { event.preventDefault(); if (!controller && !validating) $('merge-drop').classList.add('dragging'); });
$('merge-drop').addEventListener('dragleave', () => $('merge-drop').classList.remove('dragging'));
$('merge-drop').addEventListener('drop', event => { event.preventDefault(); $('merge-drop').classList.remove('dragging'); addFiles([...event.dataTransfer.files]); });
$('merge-submit').addEventListener('click', merge);
$('merge-cancel').addEventListener('click', () => { revision++; controller?.abort(); controller = null; controls(); message('ยกเลิกแล้ว จัดลำดับหรือกดรวม PDF เพื่อลองใหม่'); });
window.addEventListener('pagehide', () => { controller?.abort(); if (outputUrl) URL.revokeObjectURL(outputUrl); });
render();
