/* Package docs/ as the zip itch.io wants. `npm run package`.
 * ---------------------------------------------------------------------------
 * itch.io serves an HTML5 game by extracting an uploaded zip onto its own CDN
 * and serving the contents as-is from a subdirectory. So the zip is not an
 * archive of the project, it IS the site: index.html has to sit at the ROOT of
 * the zip (not inside a folder), and every path inside has to be relative.
 * scripts/check-build.mjs is what enforces both, and `npm run package` runs it
 * first for that reason.
 *
 * itch.io's documented limits (https://itch.io/docs/creators/html5):
 *
 *   index.html at the zip root      (a single HTML file may be uploaded bare)
 *   extracted total    ≤ 500 MB
 *   any single file    ≤ 200 MB
 *   file count         ≤ 1000 after extraction
 *   path length        ≤ 240 characters, UTF-8, CASE SENSITIVE
 *   absolute paths break — the game lives under /html/<id>/ on their CDN
 *
 * They are asserted here as well as in check-build, because this is the last
 * thing that runs before a human uploads the file.
 *
 * WHY A ZIP WRITER LIVES IN THIS REPO. Two rejected alternatives:
 *
 *   `zip -r`     not present on every runner image, and the flags that make it
 *                deterministic differ between Info-ZIP and BSD zip
 *   a dependency archiver/jszip is ~40 packages for one deflate stream, in a
 *                project whose entire dependency list is esbuild and three
 *
 * node:zlib already has raw deflate, and a store-only-or-deflate zip is a
 * header format. So it is written out below, in about 60 lines, and the
 * timestamps are FIXED rather than taken from the filesystem: the same docs/
 * produces a byte-identical zip, which is what makes "did the build change?"
 * answerable with a checksum.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const OUT  = 'docs';
const DIST = 'dist';
const ENTRY = 'index.html';

/* itch.io's hard limits */
const ITCH = { total: 500*1024*1024, file: 200*1024*1024, files: 1000, path: 240 };

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const name = `${pkg.name}-v${pkg.version}-web.zip`;

if(!existsSync(OUT)) fail(`${OUT}/ が無い — 先に \`npm run build\``);

/* ---------------------------------------------------------------- collect */
function walk(dir, prefix = ''){
  const out = [];
  for(const e of readdirSync(dir, {withFileTypes:true})){
    const p = prefix ? posix.join(prefix, e.name) : e.name;
    if(e.isDirectory()) out.push(...walk(join(dir, e.name), p));
    else out.push(p);
  }
  return out;
}
/* Sorted, so the archive order does not depend on the filesystem. */
const all = walk(OUT).sort();
/* A source map ships readable sources and this is going on sale. build.mjs
   leaves them off by default; if one is here anyway it does not get uploaded. */
const skipped = all.filter(f => f.endsWith('.map'));
const files = all.filter(f => !skipped.includes(f));

if(!files.includes(ENTRY))
  fail(`${ENTRY} が ${OUT}/ のルートに無い — itch.io は zip のルートに index.html を要求する`);
if(!files.length) fail(`${OUT}/ が空`);

const bytes = Object.fromEntries(files.map(f => [f, readFileSync(join(OUT, f))]));
const total = files.reduce((a,f) => a + bytes[f].length, 0);

const over = [];
if(total > ITCH.total)      over.push(`展開後 ${mb(total)} > 500 MB`);
if(files.length > ITCH.files) over.push(`ファイル数 ${files.length} > 1000`);
for(const f of files){
  if(bytes[f].length > ITCH.file) over.push(`${f} が ${mb(bytes[f].length)} > 200 MB`);
  if(f.length > ITCH.path)        over.push(`${f} のパスが ${f.length} 文字 > 240`);
}
if(over.length) fail('itch.io の制約に収まっていません:\n  - ' + over.join('\n  - '));

/* ------------------------------------------------------------------- zip
   Local headers + central directory + EOCD. Flag 0x0800 marks names as UTF-8,
   which is what itch.io asks for. Sizes are known up front, so no data
   descriptors are needed. */
const CRC = (() => {
  const t = new Int32Array(256);
  for(let n=0;n<256;n++){
    let c = n;
    for(let k=0;k<8;k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return buf => {
    let c = -1;
    for(let i=0;i<buf.length;i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

/* fixed timestamp: 2026-01-01 00:00:00, DOS format */
const DOS_TIME = 0;
const DOS_DATE = ((2026-1980) << 9) | (1 << 5) | 1;

const local = [], central = [];
let offset = 0;
for(const f of files){
  const raw  = bytes[f];
  const name8 = Buffer.from(f, 'utf8');
  const comp = deflateRawSync(raw, {level:9});
  /* store rather than deflate when compression does not pay (tiny files,
     already-compressed assets) */
  const deflated = comp.length < raw.length;
  const body   = deflated ? comp : raw;
  const method = deflated ? 8 : 0;
  const crc    = CRC(raw);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);            // version needed
  lh.writeUInt16LE(0x0800, 6);        // UTF-8 names
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(DOS_TIME, 10);
  lh.writeUInt16LE(DOS_DATE, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(name8.length, 26);
  lh.writeUInt16LE(0, 28);
  local.push(lh, name8, body);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(0x031E, 4);        // made by: UNIX, zip 3.0
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(DOS_TIME, 12);
  ch.writeUInt16LE(DOS_DATE, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20);
  ch.writeUInt32LE(raw.length, 24);
  ch.writeUInt16LE(name8.length, 28);
  ch.writeUInt16LE(0, 30);            // extra
  ch.writeUInt16LE(0, 32);            // comment
  ch.writeUInt16LE(0, 34);            // disk
  ch.writeUInt16LE(0, 36);            // internal attrs
  /* external attrs: regular file, 0644. `>>> 0` because a left shift in JS is
     signed and 0o100644 << 16 lands past 2^31 */
  ch.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, name8);

  offset += lh.length + name8.length + body.length;
}

const cd = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...local, cd, eocd]);

/* ------------------------------------------------------------------ write
   dist/ carries its own .gitignore containing `*`, so the artifact cannot be
   committed by accident even though the repo's root .gitignore belongs to
   another lane (BOARD §2). */
mkdirSync(DIST, {recursive:true});
writeFileSync(join(DIST, '.gitignore'), '*\n');
const out = join(DIST, name);
writeFileSync(out, zip);

const sha = createHash('sha256').update(zip).digest('hex');
console.log(`${out}`);
console.log(`  ${files.length} ファイル · 展開後 ${mb(total)} · zip ${mb(zip.length)}`
          + `（圧縮率 ${(100*zip.length/total).toFixed(0)}%）`);
console.log(`  sha256 ${sha.slice(0,16)}…（タイムスタンプ固定なので同じ docs/ からは同じ zip）`);
if(skipped.length) console.log(`  除外: ${skipped.join(' ')}（ソースが読めるため配らない）`);
console.log(`\nitch.io: Kind of project = HTML · この zip をアップロード ·`
          + ` index.html は zip のルート（${files.includes(ENTRY) ? 'ok' : 'NG'}）`);
console.log('確認:  node scripts/verify-zip.mjs   （展開して静的配信で開く）');

function mb(n){ return (n/1024/1024).toFixed(2) + ' MB'; }
function fail(msg){ console.error('package: ' + msg); process.exit(1); }
