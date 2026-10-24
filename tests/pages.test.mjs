import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
function build(api = '') {
  execFileSync(process.execPath, ['scripts/build-pages.mjs'], { cwd: root, env: { ...process.env, API_BASE_URL: api } });
}
function client(expression) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import { apiUrl, pdfAvailable } from './_site/api.js'; ${expression}`], { cwd: root }).toString();
}
test('Pages publishes only browser assets and configures the API independently of repository paths', () => {
  build();
  assert.deepEqual(readdirSync(new URL('_site/', root)).sort(), ['.nojekyll', 'api.js', 'app.js', 'config.js', 'index.html', 'merge.js', 'styles.css'].sort());
  client("assert.equal(pdfAvailable, false); assert.throws(() => apiUrl('/api/pdf')); ");
  build('https://api.example.com/');
  client("assert.equal(pdfAvailable, true); assert.equal(apiUrl('/api/pdf?quality=75'), 'https://api.example.com/api/pdf?quality=75'); assert.equal(apiUrl('/api/pdf/merge'), 'https://api.example.com/api/pdf/merge');");
  for (const invalid of ['http://api.example.com', 'https://user:secret@api.example.com', 'https://api.example.com/path', 'javascript:alert(1)']) {
    const result = spawnSync(process.execPath, ['scripts/build-pages.mjs'], { cwd: root, env: { ...process.env, API_BASE_URL: invalid } });
    assert.notEqual(result.status, 0);
  }
  build();
});
