/* Catch a module using a shared symbol it forgot to import.
 *
 * esbuild happily bundles an undefined global, so this class of mistake shows
 * up only at runtime, and only one error at a time. With several sessions
 * editing different modules it is the most likely way to break the build, so
 * check it directly: collect every exported name, then for each module flag
 * the ones it references without importing.
 */
import { readdirSync, readFileSync } from 'node:fs';


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

const DIR = 'src';
const files = readdirSync(DIR).filter(f => f.endsWith('.js'));
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
 * starts reaching for the DOM the split stops being real, so assert it. */
const DOM_FREE = ['campaign.js', 'state.js', 'layout.js'];
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

if(bad){ console.error(`\ncheck-imports: ${bad} problem(s)`); process.exit(1); }
console.log('\nall modules import what they use, and the rules layer holds no DOM');
