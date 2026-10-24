import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
function originValue(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Origins must be http(s) origins without paths or credentials');
  return url.origin;
}
const publicOrigin = process.env.PUBLIC_ORIGIN ? originValue(process.env.PUBLIC_ORIGIN) : '';
if (process.env.NODE_ENV === 'production' && !publicOrigin) throw new Error('Set PUBLIC_ORIGIN to the backend public HTTPS origin before starting production');
if (process.env.NODE_ENV === 'production' && new URL(publicOrigin).protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(new URL(publicOrigin).hostname)) throw new Error('Production PUBLIC_ORIGIN must use HTTPS');
const localOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
const allowedOrigins = new Set([...(publicOrigin ? [publicOrigin] : localOrigins), ...(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(originValue)]);
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, ...(publicOrigin ? [new URL(publicOrigin).host] : [])]);
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_MERGE_BYTES = 100 * 1024 * 1024;
const WORKER_TIMEOUT = 90_000;
const root = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.PDF_PYTHON || join(root, '.venv/bin/python');
const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/merge.js': ['merge.js', 'text/javascript'], '/api.js': ['api.js', 'text/javascript'], '/config.js': ['config.js', 'text/javascript'] };
let active = false;
function json(res, code, error) { if (!res.destroyed && !res.writableEnded) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error })); } }
async function pdf(req, res, url) {
  const merging = url.pathname === '/api/pdf/merge';
  const maxBytes = merging ? MAX_MERGE_BYTES + 1024 * 1024 : MAX_PDF_BYTES;
  if (req.headers['x-file-compressor'] !== '1') return json(res, 403, 'ไม่อนุญาตคำขอนี้');
  if (merging ? !/^multipart\/form-data;\s*boundary=/i.test(req.headers['content-type'] || '') : req.headers['content-type'] !== 'application/pdf') return json(res, 415, 'กรุณาเลือกไฟล์ PDF');
  const quality = Number(url.searchParams.get('quality'));
  if (!merging && (!Number.isInteger(quality) || quality < 10 || quality > 100)) return json(res, 400, 'คุณภาพต้องอยู่ระหว่าง 10–100');
  if (Number(req.headers['content-length']) > maxBytes) return json(res, 413, merging ? 'ขนาดไฟล์รวมต้องไม่เกิน 100 MB' : 'PDF ต้องมีขนาดไม่เกิน 50 MB');
  if (active) return json(res, 429, 'มี PDF กำลังประมวลผลอยู่ กรุณารอสักครู่แล้วลองอีกครั้ง');
  active = true;
  let directory, child, timer, resultBody, resultHeaders, failure;
  let cancelled = false;
  const cancel = () => { cancelled = true; child?.kill('SIGKILL'); };
  req.once('aborted', cancel);
  res.once('close', cancel);
  req.setTimeout(30_000, () => req.destroy());
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) { json(res, 413, 'ขนาดไฟล์เกินกำหนด'); return; }
      chunks.push(chunk);
    }
    req.setTimeout(0);
    const input = Buffer.concat(chunks);
    if (!merging && !/^%PDF-(?:1\.[0-7]|2\.0)/.test(input.subarray(0, 8).toString('ascii'))) return json(res, 400, 'ไม่พบ signature PDF ที่ถูกต้อง');
    directory = await mkdtemp(join(tmpdir(), 'lightly-pdf-'));
    const source = join(directory, merging ? 'manifest.json' : 'input.pdf'), target = join(directory, 'output.pdf');
    if (merging) {
      let form;
      try { form = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: input }).formData(); }
      catch { throw new Error('ข้อมูลอัปโหลดไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่'); }
      const uploads = form.getAll('files');
      if (uploads.length < 2 || uploads.length > 20 || [...form.keys()].some(key => key !== 'files')) throw new Error('กรุณาเลือก PDF ตั้งแต่ 2 ถึง 20 ไฟล์');
      const paths = [];
      let total = 0;
      for (const [i, upload] of uploads.entries()) {
        if (typeof upload === 'string' || upload.type !== 'application/pdf' || !/\.pdf$/i.test(upload.name) || !upload.size || upload.size > MAX_PDF_BYTES) throw new Error(`ไฟล์ลำดับ ${i + 1} ต้องเป็น PDF ขนาดไม่เกิน 50 MB`);
        total += upload.size;
        if (total > MAX_MERGE_BYTES) throw new Error('ขนาดไฟล์รวมต้องไม่เกิน 100 MB');
        const bytes = Buffer.from(await upload.arrayBuffer());
        if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(bytes.subarray(0, 8).toString('ascii'))) throw new Error(`ไฟล์ลำดับ ${i + 1} ไม่มี signature PDF ที่ถูกต้อง`);
        const path = join(directory, `${i}.pdf`);
        await writeFile(path, bytes, { mode: 0o600 });
        paths.push(path);
      }
      await writeFile(source, JSON.stringify(paths), { mode: 0o600 });
    } else await writeFile(source, input, { mode: 0o600 });
    if (cancelled) return;
    let timedOut = false;
    const metadata = await new Promise((resolve, reject) => {
      child = spawn(python, [join(root, 'pdf-worker.py'), source, target, merging ? 'merge' : String(quality)], { cwd: directory, stdio: ['ignore', 'pipe', 'ignore'] });
      let text = '';
      child.stdout.on('data', chunk => { if (text.length < 65536) text += chunk.toString(); });
      timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, WORKER_TIMEOUT);
      child.once('error', () => reject(new Error('ไม่พบ PDF worker กรุณาติดตั้ง dependencies ตาม README')));
      child.once('close', code => {
        clearTimeout(timer);
        if (timedOut) return reject(new Error('ประมวลผลเกิน 90 วินาที ลองใช้ PDF ที่เล็กลง'));
        if (cancelled) return reject(new Error('ยกเลิกแล้ว'));
        try { const data = JSON.parse(text); if (code !== 0 || data.error) reject(new Error(data.error || 'ประมวลผล PDF ไม่สำเร็จ')); else resolve(data); }
        catch { reject(new Error('PDF worker ประมวลผลไม่สำเร็จ กรุณาลองไฟล์ที่เล็กลง')); }
      });
    });
    const output = await readFile(target);
    if (cancelled) return;
    const smaller = merging || output.length < input.length;
    const result = smaller ? output : input;
    resultHeaders = { 'Content-Type': 'application/pdf', 'Content-Length': result.length, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${merging ? 'merged' : 'compressed'}.pdf"`, 'X-PDF-Pages': metadata.pages, 'X-PDF-DPI': metadata.dpi || 0, 'X-PDF-Files': metadata.files || 1, 'X-PDF-Original': smaller ? '0' : '1' };
    resultBody = result;
  } catch (error) { failure = error.message; }
  finally {
    clearTimeout(timer);
    req.removeListener('aborted', cancel);
    res.removeListener('close', cancel);
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { active = false; }
  }
  if (cancelled || res.destroyed) return;
  if (failure) return json(res, 422, failure);
  res.writeHead(200, resultHeaders);
  res.end(resultBody);
}
http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!allowedHosts.has(req.headers.host)) return json(res, 403, 'ไม่อนุญาต hostname นี้');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : '{"status":"ok"}');
  }
  if (['/api/pdf', '/api/pdf/merge'].includes(url.pathname)) {
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return json(res, 403, 'ไม่อนุญาตคำขอจากเว็บไซต์อื่น');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', 'X-PDF-Pages, X-PDF-DPI, X-PDF-Files, X-PDF-Original, Content-Disposition');
    }
    if (req.method === 'OPTIONS') {
      const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (!origin || req.headers['access-control-request-method'] !== 'POST' || headers.some(value => !['content-type', 'x-file-compressor'].includes(value))) return json(res, 403, 'ไม่อนุญาตคำขอนี้');
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-File-Compressor', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
  }
  if (['/api/pdf', '/api/pdf/merge'].includes(url.pathname) && req.method === 'POST') return pdf(req, res, url);
  const file = files[url.pathname];
  if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end('Unable to read application file'); }
}).listen(port, host, () => console.log(`File Compressor ready: ${publicOrigin || `http://localhost:${port}`}`));
