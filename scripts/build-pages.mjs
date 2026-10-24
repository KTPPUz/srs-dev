import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
let api = (process.env.API_BASE_URL || '').trim();
if (api) {
  const url = new URL(api);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('API_BASE_URL must be an HTTPS origin, e.g. https://api.example.com');
  api = url.origin;
}
const output = new URL('_site/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'merge.js', 'api.js']) await copyFile(new URL(file, root), new URL(file, output));
await writeFile(new URL('config.js', output), `export const API_BASE_URL = ${JSON.stringify(api)};\nexport const STATIC_ONLY = true;\n`);
await writeFile(new URL('.nojekyll', output), '');
console.log(`Pages files ready: ${fileURLToPath(output)} (${api ? 'PDF backend configured' : 'images only; set API_BASE_URL to enable PDF'})`);
