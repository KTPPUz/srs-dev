// A small image-only PDF writer. All lengths and offsets count bytes, not characters.
export function createScanPdf(pages) {
  if (!pages.length || pages.length > 20) throw new Error('PDF requires 1–20 pages');
  const encode = value => new TextEncoder().encode(value);
  const parts = [], offsets = [0];
  let length = 0;
  const append = value => { const bytes = typeof value === 'string' ? encode(value) : value; parts.push(bytes); length += bytes.byteLength; };
  const object = (id, content, stream) => {
    offsets[id] = length;
    append(`${id} 0 obj\n${content}`);
    if (stream) { append('\nstream\n'); append(stream); append('\nendstream'); }
    append('\nendobj\n');
  };
  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach(({ width, height, bytes }, index) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Invalid page image');
    const id = 3 + index * 3;
    const [pw, ph] = width > height ? [841.89, 595.28] : [595.28, 841.89];
    const scale = Math.min((pw - 36) / width, (ph - 36) / height);
    const w = width * scale, h = height * scale;
    const draw = encode(`q ${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${((pw - w) / 2).toFixed(3)} ${((ph - h) / 2).toFixed(3)} cm /Image Do Q\n`);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Image ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, bytes);
    object(id + 2, `<< /Length ${draw.length} >>`, draw);
  });
  const start = length, count = offsets.length;
  append(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) append(`${String(offset).padStart(10, '0')} 00000 n \n`);
  append(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
