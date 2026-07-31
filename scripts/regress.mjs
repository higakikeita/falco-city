/* Causality regression — runs the city's logic in Node, no browser.
   ------------------------------------------------------------------
   README's 実測表 was verified by hand in a browser and written down as
   prose. Gamifying means touching those numbers repeatedly, so the causal
   claims need to be executable instead: this asserts the DIRECTION of every
   claim (which lever fixes which failure mode, which stage is impossible
   without which district, which axis forbids which driver) and prints the
   current numbers for reference. INVARIANTS.md is the register; the case names
   in scripts/harness/cases.mjs cite its section numbers.

   The app is bundled first because src/* is browser code: it imports three
   and it touches the DOM at import time. scripts/harness/env.mjs supplies a
   fake DOM and scripts/harness/scene-stub.mjs stands in for the one module
   that genuinely needs a GPU (src/scene.js — WebGLRenderer). Everything else
   under test is the real code, including ui.js and controls.js: the harness
   moves the environment through setDeploy() / setEnv() rather than writing
   S.deploy by hand, because hasCap() resolves through the live composition and
   a hand-set wire value could disagree with the axes.

   If ui.js starts using a DOM API the fake does not have, the case that
   touched it fails with a TypeError naming the method — add it to env.mjs.
   That is a harness gap, not a src/ bug.

   ---------------------------------------------------------------- many files
   Every file matching `scripts/harness/cases*.mjs` is run, not just cases.mjs.
   A lane that wants its own claims machine-checked creates
   `cases-<lane>.mjs`, exports a `main()` that prints its report and returns a
   failure count, and that is the whole registration — nothing to add here, and
   nobody has to edit somebody else's file (QUEUE.md §検証を書く場所, after four
   sessions collided on cases.mjs in one afternoon). scripts/harness/lib.mjs has
   the scaffolding.

   They share ONE module graph, deliberately: env.mjs installs the fake DOM and
   pins Math.random once, and src/* is evaluated once, so the suites see the same
   engine rather than N copies of it. The cost is that they also share S and
   GAME, so a cases file must set up the state it needs instead of assuming
   nothing has run — which is what the existing one already does (tune() /
   startScenario() at the top of every case).

   usage: node scripts/regress.mjs [--keep-bundle]
   exit code 0 = every causal claim still holds. */
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const stub = join(here, 'harness', 'scene-stub.mjs');

/* src/scene.js is the only module that needs a real GL context. */
const sceneStub = {
  name: 'scene-stub',
  setup(b){
    b.onResolve({filter:/(^|\/)scene\.js$/}, args => {
      if(!args.importer.includes(join(root, 'src'))) return null;
      return {path: stub};
    });
  }
};

/* cases.mjs first (it owns the drop-model table the others reference), then the
   per-lane files in a stable order so the report reads the same way every run */
const suites = readdirSync(join(here, 'harness'))
  .filter(f => /^cases.*\.mjs$/.test(f))
  .sort((a, b) => (a === 'cases.mjs' ? -1 : b === 'cases.mjs' ? 1 : a.localeCompare(b)));

const dir = await mkdtemp(join(tmpdir(), 'falco-city-regress-'));
const out = join(dir, 'suites.mjs');
const keep = process.argv.includes('--keep-bundle');

try {
  /* one generated entry, so all the suites end up in one module graph.
     env.mjs is imported FIRST here rather than trusting each file to do it:
     src/* touches the DOM at import time, and whichever suite happens to sort
     first would otherwise decide whether that works. */
  const entry = join(dir, 'entry.mjs');
  /* absolute paths, not file:// URLs — esbuild resolves the former and not
     the latter. JSON.stringify handles the escaping. */
  const abs = f => JSON.stringify(join(here, 'harness', f));
  await writeFile(entry,
    `import ${abs('env.mjs')};\n`
    + suites.map((f, i) => `import { main as m${i} } from ${abs(f)};`).join('\n')
    + `\nconst NAMES = ${JSON.stringify(suites)};`
    + `\nconst MAINS = [${suites.map((_, i) => `m${i}`).join(', ')}];`
    + `\nexport function main(){\n`
    + `  let failed = 0;\n`
    + `  MAINS.forEach((m, i) => {\n`
    + `    if(typeof m !== 'function'){\n`
    + `      console.error('  ' + NAMES[i] + ' が main() を export していません');\n`
    + `      failed++; return;\n`
    + `    }\n`
    + `    failed += m() || 0;\n`
    + `  });\n`
    + `  return failed;\n`
    + `}\n`);

  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true, format: 'esm', platform: 'node', target: 'node18',
    plugins: [sceneStub],
    logLevel: 'warning'
  });

  if(suites.length > 1)
    console.log(`\nハーネス ${suites.length} 本: ${suites.join(' · ')}`);

  const { main } = await import(pathToFileURL(out).href);
  const failed = main();
  if(failed > 0){
    console.error(`因果が ${failed} 件壊れています。数値のチューニングではなく、`
                + `どの主張が成立しなくなったかを見てください。`);
    process.exitCode = 1;
  }
} catch (e) {
  console.error('\nハーネスが起動できませんでした:\n');
  console.error(e);
  console.error('\nsrc/ の import が増えて Node から辿れなくなった可能性があります。'
              + '\nDOM / WebGL 依存が新しく入ったなら PM に上げてください（切り方を Dev 側と揃える必要があります）。');
  process.exitCode = 1;
} finally {
  if(keep) console.log(`bundle: ${out}`);
  else await rm(dir, {recursive:true, force:true});
}
