/* The scaffolding a cases file needs, so a lane can add claims without touching
 * anybody else's file.
 * ---------------------------------------------------------------------------
 * Four sessions all edited scripts/harness/cases.mjs and INVARIANTS.md on the
 * same afternoon (QUEUE.md §検証を書く場所). The rule that came out of it:
 *
 *     自分の主張を機械で守らせたい -> scripts/harness/cases-<lane>.mjs を自分で作る
 *     INVARIANTS.md に因果を固定したい -> BOARD.md §2 に I<n> 宛で出典付きで書く
 *
 * scripts/regress.mjs picks up `harness/cases*.mjs` by glob, so a new file needs
 * no registration anywhere. This module is what makes writing one cheap.
 *
 * ---------------------------------------------------------------- how to use
 *
 *     import '../harness/env.mjs';          // FIRST — installs the fake DOM
 *     import { suite } from './lib.mjs';
 *     const { G, check, gap, assert, eq, pct, main } = suite('データ層');
 *
 *     G('プロファイル (§CONTRACT §2)');
 *     check('何も注入しなければ今日の数値と一致する', () => {
 *       ...
 *       return '実測値をここに返す';        // 返した文字列がレポートに出る
 *     });
 *
 *     export { main };                      // regress.mjs はこれだけを要求する
 *
 * ---------------------------------------------------------------- the rules
 *
 *   - `main()` は失敗件数を返し、レポートを自分で print する。それが唯一の契約
 *   - **主張の向きを書く。数値を固定しない。** 「赤くなるテストは消される」ので、
 *     許容幅・不等号・バンド名で書く。実測値は print して assert しない
 *   - **状態は自分で用意する。** 複数の cases ファイルが1つのモジュールグラフを
 *     共有するので、S / GAME が手つかずである前提を置かないこと。乱数が要るなら
 *     env.mjs の reseed() を呼ぶ
 *   - 実装がまだ主張に追いついていないものは gap() に置く。**赤にはならず**、
 *     実装された瞬間に「昇格せよ」と言う
 */

/* one report per lane, so the output says who is claiming what */
export function suite(lane){
  const results = [];
  let group = '';

  const G = name => { group = name; };

  const check = (name, fn) => {
    try { results.push({group, name, ok:true, note: fn() ?? ''}); }
    catch (e) { results.push({group, name, ok:false, note: e.message}); }
  };

  /* a known, deliberate gap: recorded, never fatal, and it tells you when it
     has closed. `phase` is who is expected to close it. */
  const gap = (name, phase, fn) => {
    let holds = false, note = '';
    try { note = fn() ?? ''; holds = true; } catch (e) { note = e.message; }
    results.push({group, name, gap:true, ok:true, holds, phase, note});
  };

  /* something that cannot be asserted yet — a module that has not landed, a
     scenario nobody has registered. Neither pass nor fail: SAID OUT LOUD, so a
     suite that is quietly checking nothing cannot look green. */
  const pending = (name, why) => { results.push({group, name, pending:true, ok:true, note:why}); };

  function main(){
    const width = s => [...String(s)].reduce((a,c) => a + (c.charCodeAt(0) > 0x2500 ? 2 : 1), 0);
    const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));
    let fail = 0, gaps = 0, skipped = 0, last = '';
    console.log(`\n── ${lane} ──`);
    for(const r of results){
      if(r.group !== last){ console.log(`  ${r.group}`); last = r.group; }
      if(r.gap){
        gaps++;
        console.log(`    ${r.holds ? '○' : '×'} GAP[${r.phase}] ${r.name}`);
        console.log(`         ${r.note}`);
        if(!r.holds) console.log('         ↑ この GAP は閉じた。gap() を check() に上げること');
      } else if(r.pending){
        skipped++;
        console.log(`    – 未判定 ${r.name}`);
        console.log(`         ${r.note}`);
      } else if(r.ok){
        console.log(`    ✓ ${r.name}${r.note ? '  — ' + r.note : ''}`);
      } else {
        fail++;
        console.log(`    ✗ ${r.name}\n         ${r.note}`);
      }
    }
    const pass = results.filter(r => !r.gap && !r.pending && r.ok).length;
    console.log(`\n  ${lane}: ${pass} 件成立 · ${fail} 件破綻`
              + (gaps ? ` · ${gaps} 件 GAP` : '')
              + (skipped ? ` · ${skipped} 件は未判定（依存が未着地）` : ''));
    void pad; void width;
    return fail;
  }

  return {G, check, gap, pending, main, results,
          assert, eq, fmt, pct, plain, near};
}

/* ---- assertions. Relations and bands, never absolute numbers ---- */
export function assert(cond, msg){ if(!cond) throw new Error(msg); }
export function eq(a, b, tol, what){
  if(Math.abs(a-b) > tol) throw new Error(`${what}: ${fmt(a)} vs ${fmt(b)} (許容 ${tol})`);
}
export const near = (a, b, tol) => Math.abs(a-b) <= tol;
export const fmt = n => typeof n === 'number'
  ? (Math.abs(n) < 1 ? n.toFixed(5) : n.toFixed(3)) : String(n);
export const pct = n => (n*100).toFixed(2) + '%';
export const plain = s => String(s || '').replace(/<[^>]+>/g, '');
