/* What a built page asks the browser to fetch, and how to classify it.
 * ---------------------------------------------------------------------------
 * Shared by scripts/check-build.mjs (does every reference resolve on disk?) and
 * scripts/verify-zip.mjs (does every reference return 200 when the zip is served
 * from a subdirectory, the way itch.io serves it?). One parser, so the two
 * cannot disagree about what counts as a reference — which is the whole point of
 * checking twice.
 *
 * It is a scanner, not an HTML/JS parser. That is a deliberate trade: a real
 * parse would need a dependency, and the failure it has to catch is a renamed
 * or deleted file, which a scanner catches. What it can produce is a FALSE
 * reference (a string in code that looks like a path), so unresolvable
 * references are reported with the file and the text, and script bodies are
 * scanned with JS patterns rather than markup ones — a minified bundle is full
 * of `.src=` and `type:"image/png"`.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export const isHtml = f => /\.html?$/i.test(f);
export const isJs   = f => /\.m?js$/i.test(f);
export const isCss  = f => /\.css$/i.test(f);

/* every file under dir, as posix paths relative to it, sorted */
export function walkFiles(dir, prefix = ''){
  const out = [];
  for(const e of readdirSync(dir, {withFileTypes:true})){
    const p = prefix ? posix.join(prefix, e.name) : e.name;
    if(e.isDirectory()) out.push(...walkFiles(join(dir, e.name), p));
    else out.push(p);
  }
  return prefix ? out : out.sort();
}

export const sizesOf = (dir, files) =>
  Object.fromEntries(files.map(f => [f, statSync(join(dir, f)).size]));

const PAT = {
  attr:   /(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
  css:    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]+))\s*\)/gi,
  cssImp: /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')/gi,
  esm:    /(?:^|[^\w.$])import\s*(?:[\w${},*\s]*?\sfrom\s*)?(?:"([^"]*)"|'([^']*)')/g,
  dyn:    /import\s*\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/g,
  url:    /new\s+URL\(\s*(?:"([^"]*)"|'([^']*)')\s*,\s*import\.meta\.url/g,
  worker: /importScripts\(\s*(?:"([^"]*)"|'([^']*)')/g,
  map:    /\/\/[#@]\s*sourceMappingURL=(\S+)/g
};

const hits = (s, re) => {
  const out = [];
  for(const m of s.matchAll(re)){
    const v = m.slice(1).find(x => x !== undefined);
    if(v !== undefined && v.trim() !== '') out.push(v.trim());
  }
  return out;
};

/* `kind` matters for classification: a remote <link> is a documented cost
   (Google Fonts), a remote or bare IMPORT means the game does not run unless
   somebody else's CDN is up. */
export function extractRefs(file, body){
  const found = [];
  const push = (kind, list) => list.forEach(v => found.push({kind, value:v}));

  if(isHtml(file)){
    const scripts = [];
    /* the OPEN TAG stays in the markup — `<script src="./main.js">` is the one
       reference the entry cannot afford to lose. Only the body is lifted out. */
    const markup = body.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
                                (_, open, s, close) => { scripts.push(s); return open + close; });
    push('attr', hits(markup, PAT.attr));
    push('css',  hits(markup, PAT.css));
    /* an inline <script type="module"> can import. The dev importmap does not
       match these patterns: it is JSON, not an import statement, and it is inert
       as long as no specifier in the shipped code is bare. */
    for(const s of scripts){
      push('esm', hits(s, PAT.esm));
      push('esm', hits(s, PAT.dyn));
      push('url', hits(s, PAT.url));
    }
  } else if(isJs(file)){
    push('esm', hits(body, PAT.esm));
    push('esm', hits(body, PAT.dyn));
    push('url', hits(body, PAT.url));
    push('url', hits(body, PAT.worker));
    push('url', hits(body, PAT.map));
  } else if(isCss(file)){
    push('css', hits(body, PAT.css));
    push('css', hits(body, PAT.cssImp));
  }
  return found;
}

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;   // http:, https:, data:, blob:, //cdn
const SKIP   = /^(?:#|\?)/;

/* what a reference is, relative to the file that made it:
     skip      a fragment or query only
     remote    another origin, or data:/blob:
     absolute  starts with /  — breaks on Pages (/falco-city/) and on itch
               (/html/<id>/), both of which serve the game from a subdirectory
     bare      a module specifier with no path — three resolved from an
               importmap instead of being bundled
     local     resolves to a path inside the output directory */
export function classify(from, {kind, value}){
  if(SKIP.test(value)) return {type:'skip'};
  if(REMOTE.test(value)) return {type:'remote', kind};
  if(value.startsWith('/')) return {type:'absolute'};
  if(kind === 'esm' && !value.startsWith('./') && !value.startsWith('../'))
    return {type:'bare'};
  const target = posix.normalize(posix.join(posix.dirname(from), value.split(/[?#]/)[0]));
  if(target.startsWith('..')) return {type:'escapes', target};
  return {type:'local', target};
}
