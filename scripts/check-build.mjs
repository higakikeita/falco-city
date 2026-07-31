/* Guard rails for the generated single-file build. Cheap, and it catches the
 * failure modes we have actually hit: the three bundle getting corrupted by
 * `$`-pattern expansion, and the app still being an ES module (which would
 * silently break file:// for anyone we hand the file to). */
import { readFileSync, existsSync } from 'node:fs';

const OUT = 'docs/index.html';
if(!existsSync(OUT)){ fail(`${OUT} was not produced`); }
const html = readFileSync(OUT, 'utf8');

const checks = [
  ['no ES module script',      () => !html.includes('type="module"')],
  ['no importmap',             () => !html.includes('importmap')],
  ['no CDN import for three',  () => !/from ['"]three['"]/.test(html)],
  ['three bundle inlined',     () => html.includes('THREEBUNDLE')],
  ['bundle not corrupted',     () => !/P=<script>/.test(html)],
  ['script tags balanced',     () => (html.match(/<script/g)||[]).length === (html.match(/<\/script>/g)||[]).length],
  ['plausible size (>500KB)',  () => html.length > 500_000],
  ['districts present',        () => html.includes('DISTRICTS')],
];

let bad = 0;
for(const [name, fn] of checks){
  let ok = false;
  try { ok = fn(); } catch { ok = false; }
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if(!ok) bad++;
}
console.log(`\n${(html.length/1024/1024).toFixed(2)} MB`);
if(bad) fail(`${bad} check(s) failed`);

function fail(msg){ console.error('check-build: ' + msg); process.exit(1); }
