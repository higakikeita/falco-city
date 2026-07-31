/* Catch a module using a shared symbol it forgot to import.
 *
 * esbuild happily bundles an undefined global, so this class of mistake shows
 * up only at runtime, and only one error at a time. With several sessions
 * editing different modules it is the most likely way to break the build, so
 * check it directly: collect every exported name, then for each module flag
 * the ones it references without importing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';


/* Blank out comments and string literals so the scan sees code only.
 * Template literals keep their ${...} contents — real references live there. */
function codeOnly(s){
  let out = '', i = 0, n = s.length;
  const depth = [];                        // template-literal ${ } nesting
  while(i < n){
    const c = s[i], d = s[i+1];
    if(c === '/' && d === '*'){ const e = s.indexOf('*/', i+2); i = e < 0 ? n : e+2; out += ' '; continue; }
    if(c === '/' && d === '/'){ const e = s.indexOf('\n', i);  i = e < 0 ? n : e;   out += ' '; continue; }
    if(c === '"' || c === "'"){
      i++; while(i < n && s[i] !== c){ if(s[i] === '\\') i++; i++; }
      i++; out += '""'; continue;
    }
    if(c === '`'){
      i++;
      while(i < n){
        if(s[i] === '\\'){ i += 2; continue; }
        if(s[i] === '`'){ i++; break; }
        if(s[i] === '$' && s[i+1] === '{'){
          i += 2; let k = 1; let inner = '';
          while(i < n && k > 0){
            if(s[i] === '{') k++;
            else if(s[i] === '}') { k--; if(!k){ i++; break; } }
            inner += s[i]; i++;
          }
          out += '(' + codeOnly(inner) + ')';
          continue;
        }
        i++;
      }
      out += '``'; continue;
    }
    out += c; i++;
  }
  return out;
}

/* Walk the whole tree, not just the top level. src/scenarios/ was invisible to
 * this check while it was reading readdirSync('src') — and that is the one
 * directory that grows by one file per content session, so it is exactly where
 * a forgotten import would land. Keys are paths relative to src/, so the
 * DOM-free list below can name a nested file. */
const DIR = 'src';
function walk(dir, prefix = ''){
  const out = [];
  for(const e of readdirSync(dir, {withFileTypes:true})){
    if(e.name.startsWith('.')) continue;
    if(e.isDirectory()) out.push(...walk(`${dir}/${e.name}`, `${prefix}${e.name}/`));
    else if(e.name.endsWith('.js')) out.push(`${prefix}${e.name}`);
  }
  return out;
}
const files = walk(DIR).sort();
const src = Object.fromEntries(files.map(f => [f, readFileSync(`${DIR}/${f}`, 'utf8')]));

/* names each module exports */
const exported = {};
for(const [f, s] of Object.entries(src)){
  const names = new Set();
  const block = s.match(/export\s*\{([\s\S]*?)\}\s*;/g) || [];
  for(const b of block)
    for(const n of b.replace(/export\s*\{|\}\s*;/g,'').split(','))
      { const t = n.trim().split(/\s+as\s+/).pop().trim(); if(t) names.add(t); }
  for(const m of s.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)/g))
    names.add(m[1]);
  exported[f] = names;
}
const owner = new Map();
for(const [f, names] of Object.entries(exported))
  for(const n of names) if(!owner.has(n)) owner.set(n, f);
owner.set('THREE', "three (import * as THREE from 'three')");

let bad = 0;
for(const [f, s] of Object.entries(src)){
  const imported = new Set();
  for(const m of s.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)){
    const clause = m[1];
    const ns = clause.match(/\*\s+as\s+([\w$]+)/);
    if(ns) imported.add(ns[1]);
    const named = clause.match(/\{([\s\S]*?)\}/);
    if(named) for(const n of named[1].split(','))
      { const t = n.trim().split(/\s+as\s+/).pop().trim(); if(t) imported.add(t); }
  }
  const body = codeOnly(s)
                .replace(/^import[\s\S]*?from\s+["'][^"']*["'];?$/gm, '')
                .replace(/export\s*\{[\s\S]*?\}\s*;/g, '')
                .replace(/([{,]\s*)([\w$]+)\s*:/g, '$1');   // object-literal keys
  const missing = [];
  for(const [name, from] of owner){
    if(from === f) continue;
    if(imported.has(name)) continue;
    if(exported[f]?.has(name)) continue;                 // re-declared locally
    if(new RegExp(`(^|[^\\w$.'"\`])${name}\\b`).test(body)
       && !new RegExp(`(?:const|let|var|function|class)\\s+${name}\\b`).test(body))
      missing.push(`${name} (from ${from})`);
  }
  if(missing.length){
    bad++;
    console.log(`FAIL  ${DIR}/${f}`);
    for(const m of missing) console.log(`        missing import: ${m}`);
  } else console.log(`ok    ${DIR}/${f}`);
}
/* Rules / rendering separation: campaign.js decides, ui.js draws. If game logic
 * starts reaching for the DOM the split stops being real, so assert it.
 *
 * scenarios/** is on the list as a directory rather than as filenames, because a
 * scenario is pure data (scenarios/schema.js §purity) and the whole point is
 * that a new one needs no entry anywhere. The same property is what lets
 * scripts/regress.mjs run the game headless. */
/* The eight data-layer modules are on the list before they land (the loop below
   skips names it cannot find), so the DOM-free property is enforced by the same
   run that first sees the file rather than by somebody remembering to add it.
   That is GATE-FREEPLAY F2, and it closes BOARD D19 / #49. They are pure data by
   contract — no imports at all — which is also what lets scripts/harness
   /cases-freeplay.mjs read them straight from Node without the fake DOM. */
const DATA_LAYER = ['archetypes.js', 'stages.js', 'versions.js', 'policies.js',
                    'timeline.js', 'score.js', 'vulns.js', 'campaigns.js'];
const DOM_FREE = ['campaign.js', 'state.js', 'layout.js', ...DATA_LAYER,
                  ...files.filter(f => f.startsWith('scenarios/'))];
for(const f of DOM_FREE){
  if(!src[f]) continue;
  const body = codeOnly(src[f]);
  const hits = [...body.matchAll(/\b(document|getElementById|querySelector(?:All)?|innerHTML)\b/g)]
    .map(m => m[1]);
  if(hits.length){
    bad++;
    console.log(`FAIL  ${DIR}/${f} must stay DOM-free`);
    console.log(`        found: ${[...new Set(hits)].join(', ')}`);
  } else console.log(`ok    ${DIR}/${f} is DOM-free`);
}

/* The scenario registry drops an invalid file and reports it rather than taking
 * the game down (scenarios/index.js). That is the right runtime behaviour and
 * the wrong CI behaviour: a scenario nobody can play would ship silently. So
 * pin the list to empty. This runs here rather than only in the regression
 * harness because it needs no DOM at all — scenarios and their schema import
 * nothing that touches the browser, and if that ever stops being true this
 * import is where it surfaces.
 *
 * Referential errors (unknown step ids, unbuildable start.built) need the rule
 * tables in campaign.js, which does need three and a DOM; scripts/regress.mjs
 * starts all seven scenarios and re-checks the same list there. */
process.removeAllListeners('warning');      // ESM-in-.js reparse notices only
try {
  const { SCENARIO_ERRORS, SCENARIOS } =
    await import(pathToFileURL(`${process.cwd()}/${DIR}/scenarios/index.js`).href);
  if(SCENARIO_ERRORS.length){
    bad++;
    console.log(`FAIL  ${DIR}/scenarios: ${SCENARIO_ERRORS.length} invalid scenario(s)`);
    for(const e of SCENARIO_ERRORS) console.log(`        ${e}`);
  } else {
    console.log(`ok    ${DIR}/scenarios: ${SCENARIOS.length} valid, 0 errors`);
  }
  /* A scenario file that index.js does not import is content nobody can reach.
   * Parking one is legitimate (2d9ca9b unregistered rules-not-followed because
   * its example rule turned out to be bundled after all), so this cannot be a
   * failure — but an unreachable file is invisible otherwise, and two of them
   * arrived without anyone noticing. Say it out loud instead. */
  const known = new Set(SCENARIOS.map(s => s.id));
  const orphans = files
    .filter(f => f.startsWith('scenarios/')
              && !['scenarios/index.js', 'scenarios/schema.js'].includes(f))
    .filter(f => !known.has(f.slice('scenarios/'.length, -3)));
  if(orphans.length){
    console.log(`note  ${orphans.length} scenario file(s) are not registered in `
              + `${DIR}/scenarios/index.js — nobody can play them:`);
    for(const o of orphans) console.log(`        ${DIR}/${o}`);
    console.log('        Deliberate? Say so in the file. Otherwise add the import.');
  }
} catch (e) {
  bad++;
  console.log(`FAIL  ${DIR}/scenarios could not be loaded without a DOM`);
  console.log(`        ${e.message}`);
  console.log('        scenarios and schema.js must stay importable in plain Node.');
}

if(bad){ console.error(`\ncheck-imports: ${bad} problem(s)`); process.exit(1); }
console.log(`\nall ${files.length} modules import what they use, `
          + 'the rules layer holds no DOM, and every scenario validates');
