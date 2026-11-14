import { detectDocument, frameQuality, CaptureStability } from './scan-vision.js';

export function createDocumentCamera(onCapture, message) {
  const $ = id => document.getElementById(`scan-${id}`);
  const video = $('video'), overlay = $('live-outline'), stability = new CaptureStability();
  const sample = document.createElement('canvas'), ctx = sample.getContext('2d', { willReadFrequently: true });
  let stream = null, timer = null, generation = 0, previous = null, corners = null, starting = false, capturing = false;
  const status = text => { if ($('camera-status').textContent !== text) $('camera-status').textContent = text; };
  function stop() {
    generation++; starting = false; capturing = false;
    clearTimeout(timer); timer = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.srcObject = null; $('live').hidden = true;
    $('camera').disabled = false; $('shutter').disabled = true;
    previous = null; corners = null; stability.reset(); overlay.removeAttribute('points');
    $('auto-progress').value = 0;
  }
  function capture() {
    if (!stream || capturing || !video.videoWidth || video.readyState < 2) return;
    capturing = true;
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const detected = corners?.map(p => ({ ...p }));
      stop(); onCapture(canvas, detected);
    } catch { stop(); message('ถ่ายภาพไม่สำเร็จ กรุณาเปิดกล้องแล้วลองใหม่', true); }
  }
  function tick(token) {
    if (token !== generation || !stream) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        $('shutter').disabled = false;
        const ratio = video.videoWidth / video.videoHeight;
        const w = Math.round(ratio >= 1 ? 320 : 320 * ratio), h = Math.round(ratio >= 1 ? 320 / ratio : 320);
        if (sample.width !== w || sample.height !== h) { sample.width = w; sample.height = h; previous = null; stability.reset(); }
        ctx.drawImage(video, 0, 0, w, h);
        const image = ctx.getImageData(0, 0, w, h);
        corners = detectDocument(image);
        let progress = 0;
        if (corners) {
          overlay.setAttribute('points', corners.map(p => `${p.x * 1000},${p.y * 1000}`).join(' '));
          const quality = frameQuality(image, corners, previous); previous = quality.gray;
          progress = stability.update(corners, quality.sharpness, quality.movement, performance.now());
          status(quality.sharpness < 45 ? 'ภาพยังไม่คมชัด ลองเพิ่มแสงหรือขยับระยะกล้อง' : quality.movement > 6 ? 'พบเอกสารแล้ว ถือกล้องให้นิ่ง' : $('auto').checked ? 'ถือให้นิ่ง กำลังเตรียมถ่ายอัตโนมัติ…' : 'พบเอกสารแล้ว กดถ่ายภาพได้เลย');
        } else {
          overlay.removeAttribute('points'); previous = null; stability.reset();
          status('วางเอกสารให้เห็นครบทั้งแผ่น บนพื้นหลังที่สีต่างจากกระดาษ');
        }
        $('auto-progress').value = $('auto').checked ? progress : 0;
        if ($('auto').checked && progress >= 1) { capture(); return; }
      }
    } catch {
      // Manual capture stays available even if the detector cannot read a frame.
      corners = null; previous = null; stability.reset(); overlay.removeAttribute('points');
      $('auto-progress').value = 0; status('ตรวจขอบไม่ได้ในขณะนี้ คุณยังกดถ่ายภาพเองได้');
    }
    timer = setTimeout(() => tick(token), 180);
  }
  async function start() {
    if (starting || stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      message('กล้องสดต้องเปิดเว็บผ่าน HTTPS หรือ localhost ใช้ “กล้องของเครื่อง” หรือเลือกรูปแทนได้', true);
      return;
    }
    const token = ++generation; starting = true; $('camera').disabled = true;
    $('live').hidden = false; $('shutter').disabled = true; status('กำลังขอเปิดกล้อง…');
    let acquired;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
      if (token !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired; video.srcObject = stream;
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (stream === acquired) { stop(); message('กล้องหยุดทำงาน เปิดกล้องอีกครั้งเพื่อสแกนต่อ'); } });
      await video.play();
      if (token !== generation) return;
      starting = false; tick(token);
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop());
      if (token !== generation) return;
      stop();
      const detail = error.name === 'NotAllowedError' ? 'ยังไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตกล้องในการตั้งค่าเว็บไซต์' : error.name === 'NotFoundError' ? 'ไม่พบกล้องในอุปกรณ์นี้' : 'เปิดกล้องไม่ได้ กล้องอาจถูกใช้งานโดยแอปอื่น';
      message(`${detail} หรือใช้ “กล้องของเครื่อง” / เลือกรูปแทน`, true);
    }
  }
  $('shutter').addEventListener('click', capture);
  $('camera-close').addEventListener('click', stop);
  $('auto').addEventListener('change', () => stability.reset());
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  document.addEventListener('toolchange', event => { if (event.detail !== 'scan') stop(); });
  return { start, stop };
}
