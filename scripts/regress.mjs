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

   usage: node scripts/regress.mjs [--keep-bundle]
   exit code 0 = every causal claim still holds. */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
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

const dir = await mkdtemp(join(tmpdir(), 'falco-city-regress-'));
const out = join(dir, 'cases.mjs');
const keep = process.argv.includes('--keep-bundle');

try {
  await build({
    entryPoints: [join(here, 'harness', 'cases.mjs')],
    outfile: out,
    bundle: true, format: 'esm', platform: 'node', target: 'node18',
    plugins: [sceneStub],
    logLevel: 'warning'
  });

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
