/* Prove the zip works the way itch.io will serve it.
 * ---------------------------------------------------------------------------
 * `npm run package` produces a zip. That the zip EXISTS proves nothing: itch.io
 * extracts it onto its CDN and serves the contents from a subdirectory, and the
 * two things that break there both look fine locally —
 *
 *   an absolute path      /main.js works when a dev server is rooted at docs/,
 *                         and 404s under /html/<id>/
 *   a case mismatch       macOS opens Main.js for main.js. The CDN does not
 *
 * So this extracts the archive with its own reader (never reading docs/ — if
 * the zip writer is wrong, that is exactly what has to surface), serves the
 * result under a NESTED BASE PATH, and fetches everything the entry references.
 *
 *   node scripts/verify-zip.mjs              extract, serve, fetch, report, exit
 *   node scripts/verify-zip.mjs --serve      leave it running for a browser
 *   node scripts/verify-zip.mjs --port 8763  pick the port (default 8763)
 *
 * The default is not 8722 (`npm run dev`) and not 8749 (a parallel session was
 * found on it). Parallel sessions share this machine, so if the port is busy,
 * pass another one rather than assuming the failure is in the zip.
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { classify, extractRefs, isCss, isHtml, isJs, walkFiles } from './lib/refs.mjs';

const DIST  = 'dist';
const ENTRY = 'index.html';
/* a path with two segments and a digit, like itch's /html/1234567/ */
const BASE  = '/html/falco-city-verify';

const argv  = process.argv.slice(2);
const serve = argv.includes('--serve');
const port  = Number(argv[argv.indexOf('--port')+1]) || 8763;

/* ------------------------------------------------------------------ find it */
const zips = (() => {
  try { return walkFiles(DIST).filter(f => f.endsWith('.zip')); }
  catch { return []; }
})();
if(!zips.length) fail(`${DIST}/ に zip がありません — 先に \`npm run package\``);
const zipPath = join(DIST, zips.sort().pop());
const buf = readFileSync(zipPath);

/* ------------------------------------------------------------- unzip
   Read the central directory rather than scanning for local headers: that is
   the authoritative index, and reading it means a corrupt directory (the most
   likely bug in a hand-written writer) fails here rather than in a browser. */
function unzip(b){
  const eocd = (() => {
    for(let i = b.length - 22; i >= 0; i--)
      if(b.readUInt32LE(i) === 0x06054b50) return i;
    return -1;
  })();
  if(eocd < 0) fail('EOCD が見つかりません（zip が壊れています）');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = [];
  for(let i=0;i<count;i++){
    if(b.readUInt32LE(p) !== 0x02014b50) fail(`中央ディレクトリの ${i} 番目が壊れています`);
    const method  = b.readUInt16LE(p + 10);
    const crc     = b.readUInt32LE(p + 16);
    const csize   = b.readUInt32LE(p + 20);
    const usize   = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extra   = b.readUInt16LE(p + 30);
    const comment = b.readUInt16LE(p + 32);
    const offset  = b.readUInt32LE(p + 42);
    const name    = b.slice(p + 46, p + 46 + nameLen).toString('utf8');
    /* the local header repeats the name; skip past it to the data */
    if(b.readUInt32LE(offset) !== 0x04034b50) fail(`${name} のローカルヘッダが壊れています`);
    const lname = b.readUInt16LE(offset + 26);
    const lextra = b.readUInt16LE(offset + 28);
    const start = offset + 30 + lname + lextra;
    const raw = b.slice(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : fail(`${name}: 未対応の圧縮 ${method}`);
    if(data.length !== usize) fail(`${name}: 展開後のサイズが宣言と違う（${data.length} vs ${usize}）`);
    out.push({name, data, crc});
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
const entries = unzip(buf);

/* the paths itch.io cares about */
if(!entries.some(e => e.name === ENTRY))
  fail(`zip のルートに ${ENTRY} がありません（入っているのは ${entries.map(e=>e.name).join(' ')}）`);
const bad = entries.filter(e => e.name.startsWith('/') || e.name.includes('..')
                             || e.name.includes('\\'));
if(bad.length) fail(`危険なパスが入っています: ${bad.map(e=>e.name).join(' ')}`);

const dir = mkdtempSync(join(tmpdir(), 'falco-city-itch-'));
for(const e of entries){
  const p = join(dir, e.name);
  mkdirSync(dirname(p), {recursive:true});
  writeFileSync(p, e.data);
}

/* --------------------------------------------------------------- serve
   Case-sensitive on purpose: it reads the file list once and answers only
   exact matches, so a `Main.js` that macOS would have forgiven 404s here. */
const byPath = new Map(entries.map(e => [e.name, e.data]));
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2',
  '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.wasm':'application/wasm',
  '.glb':'model/gltf-binary', '.map':'application/json'
};
const served = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;
  if(rel === null){
    /* Anything outside the base path is what an absolute path would produce.
       Answer 404 and remember it: that is the itch.io failure, reproduced. */
    served.push({path:url.pathname, status:404, outside:true});
    res.writeHead(404).end('outside the game directory');
    return;
  }
  rel = rel.replace(/^\//, '');
  if(rel === '' || rel.endsWith('/')) rel += ENTRY;
  const body = byPath.get(rel);
  served.push({path:url.pathname, status: body ? 200 : 404, outside:false});
  if(!body){ res.writeHead(404).end('not found'); return; }
  res.writeHead(200, {'content-type': MIME[extname(rel)] || 'application/octet-stream',
                      'content-length': body.length}).end(body);
});

await new Promise(r => server.listen(port, r));
const root = `http://localhost:${port}${BASE}/`;

/* ------------------------------------------------------ fetch what it needs */
const problems = [];
const fetched = new Set();
const queue = [ENTRY];
let bytes = 0;
while(queue.length){
  const f = queue.shift();
  if(fetched.has(f)) continue;
  fetched.add(f);
  const r = await fetch(root + f);
  if(!r.ok){ problems.push(`${f} -> HTTP ${r.status}`); continue; }
  const body = Buffer.from(await r.arrayBuffer());
  bytes += body.length;
  const declared = byPath.get(f);
  if(declared && !declared.equals(body))
    problems.push(`${f}: 配信された内容が zip の中身と違う`);
  if(!(isHtml(f) || isJs(f) || isCss(f))) continue;
  for(const ref of extractRefs(f, body.toString('utf8'))){
    const c = classify(f, ref);
    if(c.type === 'absolute')
      problems.push(`${f} -> ${ref.value} は絶対パス（${BASE}/ の外に出る）`);
    else if(c.type === 'bare')
      problems.push(`${f} -> ${ref.value} は bare specifier（同梱されていない）`);
    else if(c.type === 'local' && !fetched.has(c.target)) queue.push(c.target);
  }
}

const unreachable = entries.filter(e => !fetched.has(e.name) && e.name !== '.nojekyll');

console.log(`${zipPath} — ${entries.length} ファイル`);
console.log(`  展開 → ${dir}`);
console.log(`  配信 → ${root}  （サブディレクトリ配信・大文字小文字を区別）`);
console.log(`  取得 ${fetched.size} リクエスト · ${(bytes/1024).toFixed(1)} KB`
          + ` · 404 ${served.filter(s => s.status === 404).length} 件`);
if(unreachable.length)
  console.log(`  note  エントリから辿れないファイル: ${unreachable.map(e=>e.name).join(' ')}`);

if(problems.length){
  console.error('\nverify-zip: 展開して配信すると壊れています:');
  for(const p of problems) console.error(`  - ${p}`);
  if(!serve) server.close();
  process.exit(1);
}
console.log('\nzip は itch.io の配信の形（サブディレクトリ・静的配信）で動きます。');

if(serve){
  console.log(`\n開いて確認: ${root}`);
  console.log('  window.__errs が空であること / 1280×720 で崩れないこと');
  console.log('  終了は Ctrl-C');
} else {
  server.close();
}

function fail(msg){ console.error('verify-zip: ' + msg); process.exit(1); }
