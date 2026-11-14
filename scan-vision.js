// Small local document detector: bright connected regions, convex hull and a
// quadrilateral fit. It deliberately declines uncertain scenes.
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const fullFrame = () => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export function polygonArea(points) {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - p.y * q.x; }, 0)) / 2;
}
export function validCorners(points) {
  return points.length === 4 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    && points.every((p, i) => cross(p, points[(i + 1) % 4], points[(i + 2) % 4]) > .002)
    && polygonArea(points) > .015;
}
function hull(points) {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const half = values => { const out = []; for (const p of values) { while (out.length > 1 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop(); out.push(p); } return out; };
  const lower = half(points), upper = half([...points].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function quadFromHull(outline) {
  const quad = [...outline];
  while (quad.length > 4) {
    let least = Infinity, index = 0;
    quad.forEach((p, i) => { const loss = Math.abs(cross(quad[(i + quad.length - 1) % quad.length], p, quad[(i + 1) % quad.length])); if (loss < least) { least = loss; index = i; } });
    quad.splice(index, 1);
  }
  // Clockwise in screen coordinates, starting with the top-left corner.
  let start = 0;
  quad.forEach((p, i) => { if (p.x + p.y < quad[start].x + quad[start].y) start = i; });
  return [...quad.slice(start), ...quad.slice(0, start)];
}
export function grayscale({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2];
  return gray;
}
export function detectDocument(image) {
  const { width, height } = image, gray = grayscale(image), count = width * height;
  const hist = new Uint32Array(256);
  let sum = 0;
  for (const value of gray) { hist[value]++; sum += value; }
  let low = 0, lowSum = 0, best = 0, threshold = 128;
  for (let value = 0; value < 255; value++) {
    low += hist[value]; lowSum += hist[value] * value;
    if (!low || low === count) continue;
    const gap = lowSum / low - (sum - lowSum) / (count - low);
    const score = low * (count - low) * gap * gap;
    if (score > best) { best = score; threshold = value; }
  }
  if (!best) return null;
  let winner = null, winnerScore = 0;
  // The higher thresholds help exclude soft shadows adjoining a sheet.
  for (const cut of new Set([Math.max(70, threshold + 10), Math.max(100, threshold + 35), 190])) {
    const visited = new Uint8Array(count), queue = new Int32Array(count);
    for (let seed = 0; seed < count; seed++) {
      if (visited[seed] || gray[seed] < cut) continue;
      let head = 0, tail = 1, touches = false;
      queue[0] = seed; visited[seed] = 1;
      const boundary = [];
      while (head < tail) {
        const index = queue[head++], x = index % width, y = Math.floor(index / width);
        if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) touches = true;
        let edge = false;
        for (const next of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y ? index - width : -1, y < height - 1 ? index + width : -1]) {
          if (next < 0 || gray[next] < cut) { edge = true; continue; }
          if (!visited[next]) { visited[next] = 1; queue[tail++] = next; }
        }
        if (edge) boundary.push({ x: x / (width - 1), y: y / (height - 1) });
      }
      if (touches || tail < count * .14 || tail > count * .92 || boundary.length < 4) continue;
      const outline = hull(boundary);
      if (outline.length < 4) continue;
      const quad = quadFromHull(outline), area = polygonArea(quad), fit = area / polygonArea(outline);
      if (!validCorners(quad) || fit < .90 || area < .16 || area > .90 || tail / count / area < .68) continue;
      const sides = quad.map((p, i) => Math.hypot((p.x - quad[(i + 1) % 4].x) * width, (p.y - quad[(i + 1) % 4].y) * height));
      if (Math.min(...sides) / Math.max(...sides) < .28) continue;
      const score = area * fit;
      if (score > winnerScore) { winner = quad; winnerScore = score; }
    }
  }
  return winner;
}

// Projective map from a unit rectangle to the four selected source corners.
export function projectiveMap(points) {
  if (!validCorners(points)) throw new Error('กรอบเอกสารไม่ถูกต้อง กรุณาปรับมุมใหม่');
  const [a, b, c, d] = points;
  const dx1 = b.x - c.x, dx2 = d.x - c.x, sx = a.x - b.x + c.x - d.x;
  const dy1 = b.y - c.y, dy2 = d.y - c.y, sy = a.y - b.y + c.y - d.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / determinant;
  const h = (dx1 * sy - sx * dy1) / determinant;
  const ax = b.x - a.x + g * b.x, bx = d.x - a.x + h * d.x;
  const ay = b.y - a.y + g * b.y, by = d.y - a.y + h * d.y;
  return (u, v) => { const w = g * u + h * v + 1; return { x: (ax * u + bx * v + a.x) / w, y: (ay * u + by * v + a.y) / w }; };
}
export function rectifyDocument(image, corners, maxSide = 2400) {
  const map = projectiveMap(corners), { width: sw, height: sh, data: src } = image;
  const p = corners.map(v => ({ x: v.x * (sw - 1), y: v.y * (sh - 1) }));
  const w = Math.max(distance(p[0], p[1]), distance(p[3], p[2]));
  const h = Math.max(distance(p[0], p[3]), distance(p[1], p[2]));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const width = Math.max(2, Math.round(w * scale)), height = Math.max(2, Math.round(h * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const point = map(x / (width - 1), y / (height - 1));
    const sx = Math.max(0, Math.min(sw - 1, point.x * (sw - 1))), sy = Math.max(0, Math.min(sh - 1, point.y * (sh - 1)));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    const out = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) data[out + channel] = (src[(y0 * sw + x0) * 4 + channel] * (1 - fx) + src[(y0 * sw + x1) * 4 + channel] * fx) * (1 - fy) + (src[(y1 * sw + x0) * 4 + channel] * (1 - fx) + src[(y1 * sw + x1) * 4 + channel] * fx) * fy;
    data[out + 3] = 255;
  }
  return { data, width, height };
}

export function frameQuality(image, corners, previous) {
  const gray = grayscale(image), { width, height } = image;
  const left = Math.max(1, Math.floor(Math.min(...corners.map(p => p.x)) * width));
  const right = Math.min(width - 1, Math.ceil(Math.max(...corners.map(p => p.x)) * width));
  const top = Math.max(1, Math.floor(Math.min(...corners.map(p => p.y)) * height));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(...corners.map(p => p.y)) * height));
  let sum = 0, squares = 0, movement = 0, n = 0;
  for (let y = top; y < bottom; y += 2) for (let x = left; x < right; x += 2) {
    const i = y * width + x, lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
    sum += lap; squares += lap * lap; movement += previous?.length === gray.length ? Math.abs(gray[i] - previous[i]) : 255; n++;
  }
  return { gray, sharpness: n ? squares / n - (sum / n) ** 2 : 0, movement: n ? movement / n : 255 };
}
export class CaptureStability {
  reset() { this.anchor = null; this.since = 0; this.frames = 0; }
  constructor() { this.reset(); }
  update(corners, sharpness, movement, now) {
    if (!corners || sharpness < 45 || movement > 6) { this.reset(); return 0; }
    if (!this.anchor || corners.some((p, i) => distance(p, this.anchor[i]) > .018)) {
      this.anchor = corners.map(p => ({ ...p })); this.since = now; this.frames = 1; return 0;
    }
    this.frames++;
    return this.frames >= 6 ? Math.min(1, (now - this.since) / 1300) : 0;
  }
}
