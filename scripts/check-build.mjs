/* Guard rails for docs/ — the directory Pages publishes and the itch.io zip
 * carries. Run after `npm run build`.
 * ---------------------------------------------------------------------------
 * This used to check two things about ONE file: that docs/index.html existed
 * and that it was bigger than 500 KB. Both stop being true the moment the build
 * splits (decision 21 was withdrawn on 2026-07-31: file:// and offline are no
 * longer requirements, so the deliverable is a directory). So the checks are
 * now about the thing that actually breaks when you split:
 *
 *   1. there is an entry — docs/index.html, at the root. itch.io requires it
 *      there and Pages serves it as the directory index
 *   2. every reference resolves — no broken links. This is the failure mode
 *      splitting INTRODUCES, and it is invisible until someone loads the page
 *   3. no absolute paths. Both outlets serve the game from a SUBDIRECTORY
 *      (/falco-city/ on Pages, /html/<id>/ on itch's CDN), so a leading `/`
 *      is a request that leaves the game and 404s in production while working
 *      perfectly on a local server rooted at docs/
 *   4. the code is really in there — districts, and three bundled rather than
 *      imported from a CDN. A build that emits an empty shell passes 1–3
 *   5. total size, file count and first-load weight, printed, and capped
 *
 * It works on EITHER shape. `build.mjs` is owned by another session and is
 * mid-split, so shape is detected rather than assumed, and the shape-specific
 * assertions are the ones that still mean something:
 *
 *   single   one HTML file, no shipped JS  -> nothing may be an ES module, and
 *            three has to be inlined in the HTML (that was the whole point)
 *   split    HTML + JS  -> the entry has to reference a local script, and three
 *            has to be inlined in one of the shipped modules
 *
 * The caps below are deliberately far tighter than what itch.io actually
 * rejects (500 MB extracted / 200 MB per file / 1000 files / 240-char paths).
 * itch's limits would happily let this ship a 400 MB first load; these are
 * about the first load staying respectable, which is the constraint the
 * roadmap actually set. They are recorded in
 * .claude/handoffs/RELEASE-CHECKLIST.md together with what to do when one is
 * hit — raising a cap is a decision, not a formality.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { classify, extractRefs, isCss, isHtml, isJs, sizesOf, walkFiles }
  from './lib/refs.mjs';

const OUT   = 'docs';
const ENTRY = 'index.html';

/* ---- the caps ---- */
const MAX_TOTAL_MB  = 24;    // everything docs/ contains, uncompressed
const MAX_FILE_MB   = 16;    // any one file (a stray uncompressed texture)
const MAX_FIRST_MB  = 3;     // gzipped bytes fetched before the game can start
const MAX_FILES     = 64;    // itch.io's own ceiling is 1000
const MAX_PATH_LEN  = 200;   // itch.io rejects paths over 240 chars

const MB = 1024*1024;
const kb = n => (n/1024).toFixed(1) + ' KB';
const mb = n => (n/MB).toFixed(2) + ' MB';

if(!existsSync(OUT) || !statSync(OUT).isDirectory())
  fail(`${OUT}/ was not produced — run \`npm run build\` first`);

/* ------------------------------------------------------------------ files */
const files = walkFiles(OUT);
if(!files.length) fail(`${OUT}/ is empty`);
const size = sizesOf(OUT, files);
const text = f => readFileSync(join(OUT, f), 'utf8');

const html = files.filter(isHtml);
const js   = files.filter(isJs);
const shape = js.length === 0 && html.length === 1 ? 'single' : 'split';

/* --------------------------------------------------------- references
   Walk out from the entry, resolving every reference on the way (scripts/lib
   /refs.mjs is the scanner; scripts/verify-zip.mjs uses the same one against a
   real HTTP server). */
const broken = [], absolute = [], bareImports = [], remoteImports = [];
const remoteRefs = new Set();
const reachable = new Set([ENTRY]);
const refsOf = new Map();
const queue = [ENTRY];

while(queue.length){
  const f = queue.shift();
  if(!(f in size) || !(isHtml(f) || isJs(f) || isCss(f))) continue;
  const found = extractRefs(f, text(f));
  refsOf.set(f, found);
  for(const ref of found){
    const c = classify(f, ref);
    switch(c.type){
      case 'skip': break;
      case 'remote':
        if(c.kind === 'esm') remoteImports.push(`${f} -> ${ref.value}`);
        else remoteRefs.add(ref.value.split('?')[0]);
        break;
      case 'absolute': absolute.push(`${f} -> ${ref.value}`); break;
      case 'escapes':  absolute.push(`${f} -> ${ref.value}（${OUT}/ の外）`); break;
      case 'bare':     bareImports.push(`${f} -> ${ref.value}`); break;
      case 'local':
        if(!(c.target in size)){ broken.push(`${f} -> ${ref.value}`); break; }
        if(!reachable.has(c.target)){ reachable.add(c.target); queue.push(c.target); }
        break;
    }
  }
}

/* what a first load costs: the entry plus everything reachable from it. Nothing
   is lazy today; when something is (dynamic import behind a click), it will
   show up here and the number to watch is this one, not the total. */
const firstLoad = [...reachable].filter(f => f in size);
const wire = f => gzipSync(readFileSync(join(OUT, f))).length;
const firstBytes = firstLoad.reduce((a,f) => a + wire(f), 0);
const totalBytes = files.reduce((a,f) => a + size[f], 0);
const biggest    = Math.max(...Object.values(size));
const orphans    = files.filter(f => !reachable.has(f) && f !== '.nojekyll');

/* everything shipped as code, for the "is the app actually in here" checks */
const code = [...html, ...js].map(text).join('\n');

/* ------------------------------------------------------------------ checks */
const checks = [
  [`エントリがある（${OUT}/${ENTRY}・itch.io は zip のルート必須）`,
    () => ENTRY in size && size[ENTRY] > 0],

  ['参照が全部解決する（壊れたリンクが無い）',
    () => broken.length === 0, () => broken.map(b => `        ${b}`).join('\n')],

  ['絶対パスが無い（Pages / itch.io はサブディレクトリ配信）',
    () => absolute.length === 0, () => absolute.map(b => `        ${b}`).join('\n')],

  ['bare specifier を import していない（three は同梱）',
    () => bareImports.length === 0, () => bareImports.map(b => `        ${b}`).join('\n')],

  ['CDN からコードを import していない',
    () => remoteImports.length === 0, () => remoteImports.map(b => `        ${b}`).join('\n')],

  ['地区が入っている（DISTRICTS）',
    () => /DISTRICTS/.test(code)],

  ['three が同梱されている（WebGLRenderer）',
    () => code.includes('WebGLRenderer')],

  ['シナリオが入っている（greenfield）',
    () => /greenfield/.test(code)],

  ['script タグの数が合っている',
    () => html.every(f => {
      const s = text(f);
      return (s.match(/<script[\s>]/gi)||[]).length === (s.match(/<\/script>/gi)||[]).length;
    })],

  ['Pages が Jekyll を通さない（.nojekyll）',
    () => '.nojekyll' in size],

  [`パス長が itch.io の上限内（≤ ${MAX_PATH_LEN} 文字）`,
    () => files.every(f => f.length <= MAX_PATH_LEN),
    () => files.filter(f => f.length > MAX_PATH_LEN).map(f => `        ${f.length}: ${f}`).join('\n')],

  [`ファイル数 ${files.length} ≤ ${MAX_FILES}`,
    () => files.length <= MAX_FILES],

  [`総容量 ${mb(totalBytes)} ≤ ${MAX_TOTAL_MB} MB`,
    () => totalBytes <= MAX_TOTAL_MB*MB],

  [`最大ファイル ${mb(biggest)} ≤ ${MAX_FILE_MB} MB`,
    () => biggest <= MAX_FILE_MB*MB],

  [`初回ロード ${kb(firstBytes)}（gzip）≤ ${MAX_FIRST_MB} MB`,
    () => firstBytes <= MAX_FIRST_MB*MB]
];

/* shape-specific: whichever form the build is in, the property that form was
   supposed to have is still asserted */
if(shape === 'single'){
  checks.push(
    ['[単一] ES モジュールになっていない', () => !/type\s*=\s*["']module["']/.test(code)],
    ['[単一] importmap が残っていない',    () => !code.includes('importmap')],
    ['[単一] three が HTML の中にある',    () => text(html[0]).includes('WebGLRenderer')]
  );
} else {
  checks.push(
    ['[分割] エントリがローカルのスクリプトを読む',
      () => (refsOf.get(ENTRY) || []).some(r => {
        const c = classify(ENTRY, r);
        return c.type === 'local' && isJs(c.target);
      })],
    ['[分割] three が同梱モジュールの中にある',
      () => js.some(f => text(f).includes('WebGLRenderer'))],
    ['[分割] source map を配っていない（売り物なのでソースは出さない）',
      () => files.every(f => !f.endsWith('.map'))]
  );
}

/* ------------------------------------------------------------------ report */
console.log(`${OUT}/ — ${shape === 'single' ? '単一ファイル' : '複数ファイル'}形式`
          + ` · ${files.length} ファイル · ${mb(totalBytes)}\n`);
for(const f of [...files].sort((a,b) => size[b]-size[a]).slice(0, 12))
  console.log(`  ${reachable.has(f) ? '初回' : '    '} ${f.padEnd(28)}`
            + `${kb(size[f]).padStart(11)}`
            + (isHtml(f)||isJs(f)||isCss(f) ? `   ${kb(wire(f)).padStart(11)} gzip` : ''));
if(files.length > 12) console.log(`       … 他 ${files.length-12} ファイル`);
console.log(`\n  初回ロード: ${firstLoad.length} リクエスト · ${kb(firstBytes)}（gzip）`
          + ` / ${kb(firstLoad.reduce((a,f)=>a+size[f],0))}（非圧縮）`);
if(remoteRefs.size)
  console.log(`  外部参照 ${remoteRefs.size} 件（初回ロードの数に入れていない）: `
            + [...remoteRefs].join(' '));
if(orphans.length)
  console.log(`  note  ${orphans.length} ファイルがエントリから辿れません: ${orphans.join(' ')}`
            + '\n        消し忘れか、参照の書き方がこの検査から見えていません（zip には入ります）');
console.log('');

let bad = 0;
for(const [name, fn, detail] of checks){
  let ok = false;
  try { ok = !!fn(); } catch { ok = false; }
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if(!ok){
    bad++;
    const d = detail && detail();
    if(d) console.log(d);
  }
}
if(bad) fail(`${bad} check(s) failed`);
console.log(`\n${OUT}/ は配れる形です — Pages はディレクトリごと、`
          + 'itch.io は `npm run package` の zip');

function fail(msg){ console.error('check-build: ' + msg); process.exit(1); }
