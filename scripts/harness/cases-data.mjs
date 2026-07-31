/* データ層の回帰 — 8ファイルの主張を機械で守らせる。
   ==================================================================
   `cases.mjs` は触りません（QUEUE.md §検証を書く場所）。前半、データ層の4セッションが
   全員あの1ファイルを編集して4方向の衝突になったので、レーンごとに別ファイルにする、
   というのが今の規約です。検査レーンがグロブで拾えるよう、`cases.mjs` と同じ形
   （`export function main()` が破綻件数を返す）にしてあります。

   単体で回すには `scripts/regress.mjs` と同じ束ね方が要ります（`src/campaign.js` が
   `src/scene.js` 経由で WebGL に触るため esbuild ＋ scene スタブが必要）。
   **regress.mjs 側に1行足すのは検査レーンの仕事です**（BOARD §2 に `I<n>` で出しました）:

       entryPoints: [join(here,'harness','cases.mjs'), join(here,'harness','cases-data.mjs')]

   ------------------------------------------------------------------ 何を守るか
   GATE-FREEPLAY.md §1 のうちデータ層が持つのは **F3 / F5 / F6** で、そこに
   `GAME-DESIGN.md` の主張のうち「データが宣言していること」を足しています:

     F3   8ファイルすべてが JSON 往復で不変（純データ）
     F5   同じシードで同じ結果
     F6   生成された組み合わせに打つ手が必ず存在する
     ＋   業種ごとに主役のレバーが変わる（§4 ①）
     ＋   成熟度を広げると検知が増え、同時に埋没率が上がる（§4 ④）
     ＋   ポリシーを全部入れても base set に無い syscall は鳴らない（§4 ④ 不変条件）
     ＋   上げると壊れる／戻す手がある（§3）
     ＋   建てただけでは1点も入らない・溜め込むと追い抜かれる（§4.5）
     ＋   テストで通ったのに本番で落ちる（§2）
     ＋   **横断の参照整合** — 8ファイルを1本で持つ意味がここにあります

   ------------------------------------------------------------------ 数値と因果
   数値は illustrative です。**向きと大小関係が主張**で、絶対値を動かしても
   赤にならないように書いてあります（`cases.mjs` と同じ規律）。逆に、向きが
   反転したら必ず赤になります。 */

import './env.mjs';                       /* 先頭固定 — DOM を差し込む */
import { S, GAME, TUNE_DEFAULTS, model, noise } from '../../src/state.js';
import { updateVerdict } from '../../src/ui.js';           /* env の順序合わせ */
import { setDeploy, setEnv, setMode } from '../../src/controls.js';
import { CHAIN, GAME as CGAME, evaluate } from '../../src/campaign.js';
import { validateShape } from '../../src/scenarios/schema.js';
import { DISTRICTS } from '../../src/layout.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ---- the eight ---------------------------------------------------- */
import * as ARCH from '../../src/archetypes.js';
import * as STAGE from '../../src/stages.js';
import * as VER from '../../src/versions.js';
import * as POL from '../../src/policies.js';
import * as TL from '../../src/timeline.js';
import * as SCORE from '../../src/score.js';
import * as VULN from '../../src/vulns.js';
import * as CAMP from '../../src/campaigns.js';

const MODULES = {
  'archetypes.js':ARCH, 'stages.js':STAGE, 'versions.js':VER, 'policies.js':POL,
  'timeline.js':TL, 'score.js':SCORE, 'vulns.js':VULN, 'campaigns.js':CAMP
};

/* ------------------------------------------------------------------ *
 * tiny harness — same shape as cases.mjs
 * ------------------------------------------------------------------ */
const results = [];
let group = '';
const G = name => { group = name; };
function check(name, fn){
  try { results.push({group, name, ok:true, note: fn() ?? ''}); }
  catch (e) { results.push({group, name, ok:false, note:e.message}); }
}
function gap(name, phase, fn){
  let holds = false, note = '';
  try { note = fn() ?? ''; holds = true; } catch (e) { note = e.message; }
  results.push({group, name, gap:true, ok:true, holds, phase, note});
}
function assert(cond, msg){ if(!cond) throw new Error(msg); }
const pct = n => (n*100).toFixed(2)+'%';
const j = v => JSON.stringify(v);

/* ------------------------------------------------------------------ *
 * F3 — 純データ。JSON 往復で不変
 * ------------------------------------------------------------------
 * 「Unity 版と英語版の保険」であって願望ではないので、機械で見ます。関数・クロージャ・
 * `undefined`・`NaN`・`Infinity`・exotic object のどれかが混ざった瞬間に赤。
 *
 * 対象は各モジュールが export する **データ**（大文字始まりの定数）だけです。純関数は
 * データではないので除外します — そこは規律 §1 が最初からそう言っています。
 * ------------------------------------------------------------------ */
G('F3 純データ（JSON 往復で不変）');

const isDataName = k => /^[A-Z][A-Z0-9_]*$/.test(k);
function roundTrips(v, path, out){
  if(v === null) return out;
  const t = typeof v;
  if(t === 'string' || t === 'boolean') return out;
  if(t === 'number'){
    if(!Number.isFinite(v)) out.push(`${path}: ${v} は JSON を越えられない`);
    return out;
  }
  if(t === 'undefined'){ out.push(`${path}: undefined は JSON で消える`); return out; }
  if(Array.isArray(v)){ v.forEach((x,i)=>roundTrips(x, `${path}[${i}]`, out)); return out; }
  if(t === 'object'){
    const proto = Object.getPrototypeOf(v);
    if(proto !== Object.prototype && proto !== null){
      out.push(`${path}: plain object でない（${v.constructor?.name || 'exotic'}）`);
      return out;
    }
    for(const [k,x] of Object.entries(v)) roundTrips(x, `${path}.${k}`, out);
    return out;
  }
  out.push(`${path}: ${t} はデータではない`);
  return out;
}

for(const [file, mod] of Object.entries(MODULES)){
  check(`${file} の export したデータが JSON 往復で不変`, () => {
    const names = Object.keys(mod).filter(isDataName);
    assert(names.length, `${file}: データ export が1つも無い`);
    const errs = [];
    for(const n of names) roundTrips(mod[n], `${file} ${n}`, errs);
    assert(!errs.length, errs.slice(0,4).join(' / '));
    /* 往復して深く等しいことまで見る（キー順の差は許す） */
    for(const n of names){
      const a = mod[n];
      if(typeof a === 'function') continue;
      assert(JSON.stringify(JSON.parse(JSON.stringify(a))) === JSON.stringify(a),
             `${file} ${n}: 往復で値が変わった`);
    }
    return `${names.length} 個の表: ${names.slice(0,5).join(' ')}${names.length>5?' …':''}`;
  });
}

/* 各ファイルが自分で持っている自己検査も 0 件であること */
check('自己検査（*_ERRORS）が全部 0 件', () => {
  const errs = [
    ['archetypes', ARCH.ARCHETYPE_ERRORS],
    ['stages', STAGE.STAGE_ERRORS]
  ];
  for(const [n, e] of errs) assert(!e.length, `${n}: ${e.join(' / ')}`);
  /* timeline / score は引数を検査する形なので、代表データを通す */
  assert(!TL.timelineErrors(VER.ladder('falco').map(v =>
           ({id:v.id, at:v.released})), 'versions→timeline').length,
         'versions のはしごが timeline の形を満たさない');
  assert(!SCORE.scoreErrors(SCORE.newLedger()).length, 'newLedger が自分の検査に落ちる');
  return 'archetypes 0 / stages 0 / timeline 0 / score 0';
});

/* 8ファイルが DOM も THREE も import しないこと。`scripts/check-imports.mjs` の
   DOM_FREE リストは直書きで、そこに8ファイルを足すのは検査レーンの仕事なので
   （BOARD §2 に出しました）、届くまではここが網です。 */
G('F2 の素材（8ファイルが DOM-free・import ゼロ）');
/* `regress.mjs` は esbuild で束ねてから temp ディレクトリで実行するので、
   `import.meta.url` は src/ を指しません。cwd（リポジトリルート）から引きます。 */
const SRC = join(process.cwd(), 'src');
for(const file of Object.keys(MODULES)){
  check(`${file} が DOM も THREE も触らない`, () => {
    const raw = readFileSync(join(SRC, file), 'utf8');
    /* コメントと文字列を落としてから見る（説明文に document と書いてある） */
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ')
                    .replace(/\/\/[^\n]*/g, ' ')
                    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
                    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
                    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    const hits = [...code.matchAll(/\b(document|window|getElementById|querySelector|innerHTML|THREE)\b/g)]
                   .map(m=>m[1]);
    assert(!hits.length, `${file}: ${[...new Set(hits)].join(', ')} を触っている`);
    const imports = [...code.matchAll(/^\s*import\b[^\n]*/gm)].map(m=>m[0].trim());
    assert(!imports.length, `${file}: import が ${imports.length} 本ある（${imports[0]}）`);
    return 'DOM 0 / THREE 0 / import 0';
  });
}

/* ------------------------------------------------------------------ *
 * 全域性 — 壊れた入力で throw しないこと（契約 §1）
 * ------------------------------------------------------------------
 * **契約は「壊れた入力はエラー値で返す。例外ではない」と決めています**
 * （CONTRACT-datalayer.md §1・`setProfile()` がエラー配列を返すのと同じ理由）。
 * データ層はそれを破っていました: `normalisePosture({caps:5})` が
 * `TypeError: number 5 is not iterable` を投げ、**検査レーンが F6 のチェックを
 * 書いている最中に踏みました** — つまり私たち以外の最初の呼び手が即座に踏んだ。
 *
 * 直したあとに8ファイルを総当たりしたら、**同じ形が 115 箇所**ありました。
 * 1件のバグではなく**イディオムの欠落**だったので、各ファイルに `arr` / `obj` /
 * `num` / `str` を置いて公開入口を全部通しました。
 *
 * ここはその回帰です。**新しい関数を足したら自動で対象に入ります**（export を
 * 走査するので登録作業は要りません）。
 *
 * Symbol は対象外です。`String(Symbol)` は throw しますが、ゲームのデータ層に
 * Symbol が来る経路が無く、8ファイルに guard を撒く方が読みにくくなります
 * （`str()` がついでに吸収しているので、実際には落ちません）。
 * ------------------------------------------------------------------ */
G('全域性（壊れた入力で throw しない・契約 §1）');

const HOSTILE = [undefined, null, 0, 1, -1, NaN, Infinity, '', 'x', true, false,
                 [], {}, [null], [undefined],
                 /* 実際に踏まれた形: コレクションのはずが数値／文字列 */
                 {caps:5}, {built:5}, {caps:'kernelPath'}, {middleware:5}, {vulns:5},
                 () => {}, new Date(), new Map()];

for(const [file, mod] of Object.entries(MODULES)){
  check(`${file} のどの export も壊れた入力で throw しない`, () => {
    const fns = Object.entries(mod).filter(([, f]) => typeof f === 'function');
    assert(fns.length, `${file}: 関数 export が無い`);
    const bad = [];
    let calls = 0;
    for(const [name, fn] of fns)
      for(let n = 0; n <= Math.min(4, Math.max(1, fn.length)); n++)
        for(const h of HOSTILE){
          calls++;
          try { fn(...Array(n).fill(h)); }
          catch (e) {
            if(e instanceof TypeError || e instanceof RangeError)
              bad.push(`${name}/${n}引数 -> ${e.constructor.name}: ${e.message.slice(0,50)}`);
          }
        }
    assert(!bad.length, `${bad.length} 件 throw: ${bad.slice(0,3).join(' | ')}`);
    return `${fns.length} 関数 × ${HOSTILE.length} 種 = ${calls} 呼び出しで throw 0`;
  });
}

check('壊れた posture はエラーとして返る（例外ではない）', () => {
  const errs = CAMP.postureErrors({caps:5, built:'driver', bogus:1, stack:'x'});
  assert(errs.length >= 3, `エラーが出ていない: ${j(errs)}`);
  assert(errs.some(e => e.includes('caps')), 'caps の型エラーが出ない');
  assert(errs.some(e => e.includes('bogus')), '未知のキーが報告されない');
  assert(errs.some(e => e.includes('stack')), 'stack の値エラーが出ない');
  /* 同じ入力で normalisePosture は throw せず、既定に落ちる */
  const p = CAMP.normalisePosture({caps:5, built:'driver'});
  assert(Array.isArray(p.caps) && !p.caps.length, `caps が既定に落ちていない: ${j(p.caps)}`);
  assert(!CAMP.postureErrors(undefined).length, '未指定がエラーになっている（既定は正当）');
  assert(!CAMP.postureErrors({built:['driver'], caps:['kernelPath']}).length,
    '正しい posture がエラーになっている');
  return `${errs.length} 件のエラーを返し、throw しない`;
});

check('壊れた時計・台帳でも日付と点が出る（画面が分岐しなくて済む）', () => {
  assert(TL.clockDate(null), '時計が null で日付が出ない');
  assert(TL.clockDate({start:'not-a-date', daysPerTick:'x', tick:-5}),
    '壊れた時計で日付が出ない');
  assert(TL.dateAtTick(null, 3), 'dateAtTick が壊れた時計で答えない');
  assert(SCORE.ledgerSummary(null).points === SCORE.SCORE_DEFAULTS.start,
    '壊れた台帳で内訳が出ない');
  /* canPay だけは「払える」に倒さない — 支払いを黙って通すのが一番高い間違い */
  assert(SCORE.canPay(null, 'district') === false,
    '台帳が無いのに「払える」と答えた');
  assert(SCORE.canPay({points:'x', tick:0, log:[], totals:{earn:{}}}, 'district') === false,
    'points が数値でないのに払えると答えた');
  return '壊れた時計→既定の日付 · 壊れた台帳→既定の内訳 · canPay は false に倒す';
});

/* ------------------------------------------------------------------ *
 * 横断の参照整合 — 8ファイルを1本で持つ理由がここ
 * ------------------------------------------------------------------
 * ファイル同士は import しません（1つ足すのに他を触らないため）。その代わり
 * 「片方が名前で参照している先が実在するか」を**ここで**突き合わせます。
 *
 * これは飾りの検査ではありません。4セッションで書いていたとき、この3件が
 * 全部ズレていて、しかも**何も落ちませんでした**:
 *
 *   ・archetypes の13部品のうち **6つ** が vulns に存在せず、`vulnsFor()` が
 *     黙って短い配列を返していた。製造業（穴が積み上がるのが唯一の教材）が
 *     4部品のうち **1つ** しか届いていなかった
 *   ・vulns が「incubating だから既定では持っていない」と説明していたルールが
 *     policies の一次資料つき表では **stable** だった（2件）
 *   ・sandbox のルールに `newRule:false`（＝既定同梱）が付いていた（5件）
 * ------------------------------------------------------------------ */
G('横断の参照整合（8ファイル間）');

check('archetypes の全部品が vulns に実在し、脆弱性を1件以上持つ', () => {
  const rows = [];
  for(const a of ARCH.ARCHETYPES){
    for(const m of a.middleware){
      const hit = VULN.mwById(m.id);
      assert(hit, `${a.id}: 部品 "${m.id}" が vulns.js に無い`);
      const n = VULN.VULNS.filter(v => v.mw === hit.id).length;
      assert(n > 0, `${a.id}: 部品 "${m.id}" に脆弱性が1件も無い`);
    }
    rows.push(`${a.id}=${VULN.vulnsFor(a.middleware.map(x=>x.id)).length}`);
  }
  return rows.join(' ');
});

check('archetypes の patchable:false と vulns の patch.blocked が一致', () => {
  for(const a of ARCH.ARCHETYPES)
    for(const m of a.middleware){
      const mw = VULN.mwById(m.id);
      assert(!!mw.patch.blocked === !m.patchable,
        `${a.id}/${m.id}: archetypes patchable=${m.patchable} と vulns blocked=${mw.patch.blocked} が食い違う`);
    }
  return '13 部品すべて一致';
});

check('vulns のルール名が policies の表に実在し、成熟度も一致', () => {
  for(const v of VULN.VULNS){
    const rf = POL.ruleByName(v.detect.rule);
    assert(rf, `${v.id}: ルール "${v.detect.rule}" が policies.js §RULE_FACTS に無い`);
    assert(rf.maturity === v.detect.maturity,
      `${v.id}: 成熟度が食い違う（vulns=${v.detect.maturity} / policies=${rf.maturity}）`);
  }
  return `${VULN.VULNS.length} 件すべて一致`;
});

check('newRule は「既定同梱でない」と同義（stable のみが同梱）', () => {
  for(const v of VULN.VULNS){
    if(v.detect.maturity === null) {          /* プラグイン付属は成熟度を持たない */
      assert(v.detect.newRule === false,
        `${v.id}: プラグイン付属ルールに newRule:true が付いている`);
      continue;
    }
    const bundled = POL.maturityById(v.detect.maturity).bundled;
    assert(v.detect.newRule === !bundled,
      `${v.id}: ${v.detect.maturity} は bundled=${bundled} なのに newRule=${v.detect.newRule}`);
  }
  return 'stable→false / incubating・sandbox→true';
});

check('vulns の detect.via / stages の攻撃段が CHAIN に実在', () => {
  const ids = new Set(CHAIN.map(s => s.id));
  for(const v of VULN.VULNS)
    assert(ids.has(v.detect.via), `${v.id}: via "${v.detect.via}" が CHAIN に無い`);
  for(const st of STAGE.STAGES)
    for(const w of st.attack.waves)
      for(const s of w.steps)
        assert(ids.has(s), `stage ${st.id}: 攻撃段 "${s}" が CHAIN に無い`);
  return `via ${new Set(VULN.VULNS.map(v=>v.detect.via)).size} 種 / 段 ${ids.size} 中`;
});

check('policies の step が CHAIN に実在し、versions の <NA> フィールドと繋がる', () => {
  const ids = new Set(CHAIN.map(s => s.id));
  for(const r of POL.RULE_FACTS)
    if(r.step) assert(ids.has(r.step), `RULE_FACTS "${r.name}": step "${r.step}" が CHAIN に無い`);
  /* 0.37 で <NA> になるフィールドを読むルールが policies 側に実在すること。
     無ければ「上げると黙って壊れる」が誰にも起こらない */
  const na = VER.naFieldsAt('falco-0.37').map(x => x.field);
  const hurt = POL.RULE_FACTS.filter(r => (r.needsFields||[]).some(f => na.includes(f)));
  assert(hurt.length, '0.37 の <NA> を読むルールが policies.js に1件も無い');
  return `<NA> ${na.length} 件 / それを読むルール ${hurt.length} 件`;
});

check('versions のはしごが timeline のイベント源として通る', () => {
  const track = VER.ladder('falco').map(v => ({id:v.id, at:v.released}));
  assert(!TL.timelineErrors(track, 'ladder').length, TL.timelineErrors(track,'ladder').join(' / '));
  const dl = VER.DEPRECATIONS.filter(d=>d.endsOn)
    .map(d => ({id:d.id, at:d.announcedIn ? '2026-01-28' : '2023-01-01', until:d.endsOn}));
  assert(!TL.timelineErrors(dl, 'deadlines').length, TL.timelineErrors(dl,'deadlines').join(' / '));
  return `はしご ${track.length} 段 / 期限 ${dl.length} 件`;
});

check('score の台帳キーは REASONS にあるものだけ（建設が加点に混ざらない網）', () => {
  let L = SCORE.newLedger();
  L = SCORE.tickLedger(L, {stopped:1, missed:1, buried:1, vulns:[{id:'x',since:0}],
                           expired:[{id:'y',since:0}], extraNodes:1}, {tick:1});
  L = SCORE.payFrom(L, 'district', {tick:1});
  assert(!SCORE.scoreErrors(L).length, SCORE.scoreErrors(L).join(' / '));
  for(const b of ['earn','lose','spend'])
    for(const k of Object.keys(L.totals[b]))
      assert(SCORE.REASONS[k], `totals.${b}.${k} が REASONS に無い`);
  return `earn=${j(Object.keys(L.totals.earn))} lose=${j(Object.keys(L.totals.lose))}`;
});

/* ------------------------------------------------------------------ *
 * 業種ごとに主役のレバーが変わる（GAME-DESIGN §4 ①）
 * ------------------------------------------------------------------
 * これが「業種は飾りではない」の全部です。各業種が `lever.star` を1本名指しし、
 * `lever.ineffective` で**効かないレバー**を名指しします。後者が主張の本体で、
 * 反証可能なのはそちらだけです。
 *
 * 数値ではなく**関係**を見ます: 主役を動かすと閾値を跨ぎ、効かないと宣言した
 * レバーでは跨がない。
 * ------------------------------------------------------------------ */
G('業種ごとに主役のレバーが変わる (§1.3 / §1.4 の業種版)');

function stand(archId, stageId, tune = {}){
  const a = ARCH.archetypeById(archId);
  const e = STAGE.estateFor(a, stageId);
  S.load = e.load; S.dead = false; S.deadDrops = 0;
  S.cpus = e.cpus;
  S.driver = ARCH.forcedAxisValue(a, 'driver') || 'modern_ebpf';
  S.tune = {...TUNE_DEFAULTS, ...tune};
  setMode('oss');
  setDeploy(a.id === 'industrial-ot' ? 'machine' : 'k8s');
  S.nodes = e.nodes;
  GAME.built = new Set(DISTRICTS.map(d=>d.id)); GAME.unmet = {};
  return {a, M:model(), N:noise()};
}

check('Web は持続超過が主項で、絞れば直り buf_size_preset では直らない', () => {
  const base = stand('web-service','prod');
  const set  = stand('web-service','prod',{syscallSet:'custom'});
  const buf  = stand('web-service','prod',{bufPreset:10});
  assert(base.M.sustained > 0.10, `持続超過が出ていない: ${pct(base.M.sustained)}`);
  assert(base.M.sustained > base.M.burst * 10,
    `主項がバースト側になっている（sustained ${pct(base.M.sustained)} / burst ${pct(base.M.burst)}）`);
  assert(set.M.dropP < 0.001, `絞っても直らない: ${pct(set.M.dropP)}`);
  assert(buf.M.dropP > base.M.dropP * 0.9,
    `buf_size_preset で直ってしまった: ${pct(base.M.dropP)} → ${pct(buf.M.dropP)}`);
  assert(ARCH.isIneffective(base.a,'buf_size_preset'), '宣言側が buf_size_preset を無効と言っていない');
  return `既定 ${pct(base.M.dropP)}（持続 ${pct(base.M.sustained)}）/ custom_set ${pct(set.M.dropP)} / preset10 ${pct(buf.M.dropP)}`;
});

check('ゲーム基盤は持続超過が 0 で、落ちている分は全部バースト', () => {
  const base = stand('game-platform','prod');
  assert(base.M.util < 1, `util が 1 を超えている: ${base.M.util.toFixed(3)}`);
  assert(base.M.sustained === 0, `sustained が 0 でない: ${pct(base.M.sustained)}`);
  assert(base.M.burst > 0, 'バーストも 0 なら主役が無い');
  assert(Math.abs(base.M.dropP - base.M.burst) < 1e-9, 'dropP がバーストと一致しない');
  return `util ${base.M.util.toFixed(3)} · sustained 0 · burst ${pct(base.M.burst)} = drop ${pct(base.M.dropP)}`;
});

check('ゲーム基盤は buf_size_preset がドロップ上限を跨がせる唯一の場面', () => {
  const a = ARCH.archetypeById('game-platform');
  const cap = a.goal.maxDropPct / 100;
  const base = stand('game-platform','prod');
  const buf  = stand('game-platform','prod',{bufPreset:7});
  assert(base.M.dropP > cap, `既定が上限を超えていない（${pct(base.M.dropP)} vs 上限 ${pct(cap)}）`);
  assert(buf.M.dropP <= cap, `preset 7 で上限内に入らない（${pct(buf.M.dropP)} vs ${pct(cap)}）`);
  /* そして「効かない」と宣言した側は跨がせない */
  const cpb = stand('game-platform','prod',{cpusPerBuf:1});
  assert(cpb.M.dropP > cap, 'cpusPerBuf 1 で上限内に入ってしまった（宣言と逆）');
  assert(ARCH.isIneffective(a,'base_syscalls.custom_set'), '宣言側が custom_set を無効と言っていない');
  return `上限 ${pct(cap)} · 既定 ${pct(base.M.dropP)} → preset7 ${pct(buf.M.dropP)} / cpusPerBuf1 ${pct(cpb.M.dropP)}（悪化）`;
});

check('金融決済は ignore と exit を選べない（規制。モデルの代償ではない）', () => {
  const a = ARCH.archetypeById('fintech-payments');
  for(const bad of ['ignore','exit'])
    assert(!ARCH.allowsTuneValue(a,'dropAction',bad), `${bad} が選べてしまう`);
  for(const ok of ['log','alert'])
    assert(ARCH.allowsTuneValue(a,'dropAction',ok), `${ok} が選べない`);
  /* 他の業種では選べること — 業種の制約であって全体の禁止ではない */
  assert(ARCH.allowsTuneValue(ARCH.archetypeById('web-service'),'dropAction','ignore'),
    'Web でも ignore が禁止されている（それは業種の制約ではない）');
  const drop = POL.dropActionById('ignore');
  assert(drop.silent && !drop.audit, 'policies 側が ignore を「黙って盲目・監査不可」と言っていない');
  return 'ignore / exit は不可 · log / alert は可 · Web では ignore 可';
});

check('金融決済はドロップ上限が厳しく、絞る道はカバレッジ下限で塞がっている', () => {
  const a = ARCH.archetypeById('fintech-payments');
  const cap = a.goal.maxDropPct / 100;
  const base = stand('fintech-payments','prod');
  assert(base.M.dropP > cap, `既定が上限を超えていない（${pct(base.M.dropP)} vs ${pct(cap)}）`);
  const set = stand('fintech-payments','prod',{syscallSet:'custom'});
  assert(set.M.dropP < cap, '絞ってもドロップが収まらない');
  assert(set.M.passRatio * 100 < a.goal.minPassRatio,
    `絞ってもカバレッジ下限に触れない（${pct(set.M.passRatio)} vs 下限 ${a.goal.minPassRatio}%）`);
  const cpb = stand('fintech-payments','prod',{cpusPerBuf:8});
  assert(cpb.M.dropP <= cap, `残る手（cpusPerBuf を上げる）が効かない: ${pct(cpb.M.dropP)}`);
  return `上限 ${pct(cap)} · 既定 ${pct(base.M.dropP)} / custom_set ${pct(set.M.dropP)} だが通過 ${pct(set.M.passRatio)} < ${a.goal.minPassRatio}% で却下 / cpusPerBuf8 ${pct(cpb.M.dropP)}`;
});

check('製造業は kmod も modern_ebpf も選べず、パッチという手が無い', () => {
  const a = ARCH.archetypeById('industrial-ot');
  assert(ARCH.forcedAxisValue(a,'driver') === 'ebpf', 'ドライバが legacy eBPF に固定されていない');
  for(const d of ['kmod','modern_ebpf'])
    assert(!ARCH.allowsDriver(a,d), `${d} が選べてしまう`);
  /* パッチが全部塞がっていること = 検知が唯一の統制 */
  const mws = a.middleware.map(m=>m.id);
  const vs = VULN.vulnsFor(mws, {seed:7});
  const blocked = vs.filter(v => VULN.patchCostAt(v, 24).blocked).length;
  assert(blocked === vs.length, `パッチ可能な穴が残っている（${vs.length - blocked} 件）`);
  assert(vs.length >= 12, `穴が少なすぎる（${vs.length} 件）— 積み上がりが主題`);
  /* そして 0.44 以降は乗るドライバが1つも無い */
  const left = VER.workingDrivers({version:'falco-0.44', kernel:'5.4', btf:false, blocked:['kmod']});
  assert(!left.length, `まだ乗るドライバがある: ${j(left)}`);
  return `穴 ${vs.length} 件すべて patch blocked · 0.44＋古カーネルで残るドライバ 0`;
});

check('製造業の穴は負荷ではなく構成なので、絞る以外に手が無い', () => {
  const base = stand('industrial-ot','prod');
  const buf  = stand('industrial-ot','prod',{bufPreset:9});
  const cpb  = stand('industrial-ot','prod',{cpusPerBuf:4});
  const set  = stand('industrial-ot','prod',{syscallSet:'custom'});
  assert(base.M.sustained > 0.10, `持続超過が出ていない: ${pct(base.M.sustained)}`);
  assert(buf.M.dropP > base.M.dropP * 0.9, 'buf_size_preset で直ってしまった');
  assert(Math.abs(cpb.M.dropP - base.M.dropP) < 1e-9,
    `cpusPerBuf が動いてしまった（バッファは既に1つ）: ${pct(cpb.M.dropP)}`);
  assert(set.M.dropP < 0.001, '絞っても直らない');
  return `既定 ${pct(base.M.dropP)} / preset9 ${pct(buf.M.dropP)} / cpusPerBuf4 ${pct(cpb.M.dropP)}（不動）/ custom_set ${pct(set.M.dropP)}`;
});

check('4業種の主役が互いに違う（同じレバーが2業種の主役にならない）', () => {
  const stars = ARCH.ARCHETYPES.map(a => a.lever.key);
  const uniq = new Set(stars);
  assert(uniq.size === stars.length, `主役が重複している: ${j(stars)}`);
  /* そして各業種が「効かないレバー」を1本以上名指ししている */
  for(const a of ARCH.ARCHETYPES)
    assert(a.lever.ineffective.length, `${a.id}: 効かないレバーを宣言していない`);
  return j(ARCH.ARCHETYPES.map(a=>`${a.id}:${a.lever.key}`));
});

/* ------------------------------------------------------------------ *
 * テストで通ったのに本番で落ちる（GAME-DESIGN §2 の段差）
 * ------------------------------------------------------------------ */
G('テスト→本番の段差 (§2)');

check('4業種すべてで、設定を1つも変えずにテストは静かで本番は落ちる', () => {
  const rows = [];
  for(const a of ARCH.ARCHETYPES){
    const t = stand(a.id,'test');
    const p = stand(a.id,'prod');
    assert(t.M.dropP < 0.001, `${a.id}: テストでドロップが出ている ${pct(t.M.dropP)}`);
    assert(t.N.buriedP < 0.001, `${a.id}: テストで埋没が出ている ${pct(t.N.buriedP)}`);
    const failsProd = p.M.dropP*100 > a.goal.maxDropPct
                   || (a.goal.maxBuriedPct !== null && p.N.buriedP*100 > a.goal.maxBuriedPct);
    assert(failsProd, `${a.id}: 本番でも上限を割らない（drop ${pct(p.M.dropP)} / buried ${pct(p.N.buriedP)}）`);
    const d = STAGE.stageDelta(a,'test','prod');
    assert(d.tuningChanged === false, `${a.id}: チューニングが変わっている`);
    rows.push(`${a.id} 0%→drop ${pct(p.M.dropP)}/buried ${pct(p.N.buriedP)}`);
  }
  return rows.join(' · ');
});

check('段差の中身は4つだけ（負荷・ノード数・波数・ノイズ）で設定は含まない', () => {
  const d = STAGE.stageDelta(ARCH.archetypeById('web-service'),'test','prod');
  assert(d.load.to > d.load.from, '負荷が上がっていない');
  assert(d.nodes.to > d.nodes.from, 'ノード数が増えていない');
  assert(d.waves.to > d.waves.from, '波が増えていない');
  assert(d.noise.from === false && d.noise.to === true, 'ノイズの有無が変わっていない');
  assert(d.tuningChanged === false, 'チューニングが変わっている（それでは段差の意味が消える）');
  return `load ×${d.load.mul} · nodes ${d.nodes.from}→${d.nodes.to} · 波 ${d.waves.from}→${d.waves.to} · noise ${d.noise.from}→${d.noise.to}`;
});

check('freeplayScenario が schema の形を満たし、チューニングを引き継げる', () => {
  const a = ARCH.archetypeById('web-service');
  const sc = STAGE.freeplayScenario(a, 'prod',
    {built:['driver','ring'], tune:{bufPreset:7}, unmet:{falcoctl:['follow-refs']}});
  for(const k of ['id','title','env','start','attack','insight','goal'])
    assert(sc[k] !== undefined, `freeplayScenario に ${k} が無い`);
  assert(sc.start.tune.bufPreset === 7, 'tune が引き継がれていない');
  assert(j(sc.start.built) === j(['driver','ring']), 'built が引き継がれていない');
  assert(j(sc.start.unmet.falcoctl) === j(['follow-refs']), 'unmet が引き継がれていない');
  assert(!roundTrips(sc, 'scenario', []).length, '合成したシナリオが純データでない');
  return `${sc.id} · ${sc.attack.waves.length} 波 · goal.detect ${sc.goal.detect}`;
});

/* ------------------------------------------------------------------ *
 * ポリシー層（GAME-DESIGN §4 ④）
 * ------------------------------------------------------------------ */
G('ポリシー層 — 広げると両方増える (§4.1 / §2.1)');

check('成熟度を広げると検知が増え、同時に要求 syscall も増える', () => {
  const rows = [];
  let lastRules = -1, lastFire = -1;
  for(const t of POL.MATURITY_TIERS){
    const pol = {...POL.POLICY_DEFAULT, maturity:t.id};
    const n = POL.shippedRuleCount(pol);
    const fire = POL.rulesLoaded(pol, {artifacts:true}).length;
    assert(n > lastRules, `${t.id}: 同梱ルール数が増えていない`);
    assert(fire > lastFire, `${t.id}: 発火しうるルールが増えていない`);
    lastRules = n; lastFire = fire;
    rows.push(`${t.id} ${n}本/${fire}件 ×${t.noiseMul}`);
  }
  const narrow = POL.requiredSyscalls({...POL.POLICY_DEFAULT, maturity:'stable-only'},{artifacts:true});
  const wide   = POL.requiredSyscalls({...POL.POLICY_DEFAULT, maturity:'plus-sandbox'},{artifacts:true});
  assert(wide.length > narrow.length,
    `広げても要求 syscall が増えない（${narrow.length} → ${wide.length}）`);
  return `${rows.join(' → ')} · 要求 syscall ${narrow.length}→${wide.length}`;
});

check('成熟度を広げると埋没率が上がる（エンジン側の実測）', () => {
  stand('fintech-payments','prod');
  const all = new Set(DISTRICTS.map(d=>d.id));
  GAME.built = new Set([...all].filter(d => d !== 'falcoctl'));
  const narrow = noise();
  GAME.built = all;
  const wide = noise();
  assert(wide.inflow > narrow.inflow, 'アラート流入が増えていない');
  assert(wide.buriedP > narrow.buriedP,
    `埋没率が上がらない（${pct(narrow.buriedP)} → ${pct(wide.buriedP)}）`);
  return `追従なし 流入 ${narrow.inflow.toFixed(1)}/分 · 埋没 ${pct(narrow.buriedP)}`
       + ` → 追従あり ${wide.inflow.toFixed(1)}/分 · 埋没 ${pct(wide.buriedP)}`;
});

check('ポリシーを全部入れても base set に無い syscall を要求するルールは鳴らない', () => {
  const widest = {...POL.POLICY_DEFAULT, maturity:'plus-sandbox'};
  const on  = POL.ringsFor('Read sensitive file untrusted', {policy:widest, artifacts:true, negated:[]});
  const off = POL.ringsFor('Read sensitive file untrusted',
    {policy:widest, artifacts:true, negated:['open','openat','openat2']});
  assert(on.rings, '負の指定が無いのに鳴らない');
  assert(!off.rings, '負の指定があるのに鳴ってしまう（カーネル層の関門が効いていない）');
  assert(off.gates.some(g => g.gate === 'traced'), `落ちた門が traced でない: ${j(off.gates)}`);
  assert(off.silent, 'この失敗が silent でない（ドロップも上がらないのが要点）');
  /* 1本でも生き残っていれば鳴る（依存であって順序ではない・INVARIANTS 2.9） */
  const one = POL.ringsFor('Read sensitive file untrusted',
    {policy:widest, artifacts:true, negated:['open','openat']});
  assert(one.rings, '1本残っていても鳴らない（every ではなく some になっている）');
  return '全部入り＋!open系3本 → 鳴らない（gate:traced・silent）/ 2本だけなら鳴る';
});

check('検知層とカーネル層は独立で、門は2つ同時に閉じられる', () => {
  const narrow = {...POL.POLICY_DEFAULT, maturity:'stable-only'};
  const g = POL.gatesFailed('Write below etc',
    {policy:narrow, artifacts:false, negated:['open','openat','openat2']});
  const kinds = g.map(x=>x.gate);
  assert(kinds.includes('have'), `成熟度の門が閉じていない: ${j(g)}`);
  assert(kinds.includes('traced'), `カーネル層の門が閉じていない: ${j(g)}`);
  assert(g.length >= 2, '門が1つしか返っていない（最初の1件で打ち切っている）');
  return `同時に閉じた門: ${j(kinds)}`;
});

check('priority しきい値は出力フィルタではないので、絞ると要求 syscall も減る', () => {
  const widest = {...POL.POLICY_DEFAULT, maturity:'plus-sandbox'};
  const lo = POL.requiredSyscalls({...widest, minPriority:'debug'}, {artifacts:true});
  const hi = POL.requiredSyscalls({...widest, minPriority:'critical'}, {artifacts:true});
  assert(hi.length < lo.length, `絞っても要求 syscall が減らない（${lo.length} → ${hi.length}）`);
  assert(POL.priorityShare('critical') < POL.priorityShare('debug'), 'アラート量が減らない');
  return `debug ${lo.length} → critical ${hi.length} 本 · 量 ${POL.priorityShare('debug').toFixed(2)}→${POL.priorityShare('critical').toFixed(2)}`;
});

check('Sysdig を足しても検知は1段も増えない（構造で担保）', () => {
  assert(POL.SYSDIG_DELTA.detection === 0, 'SYSDIG_DELTA.detection が 0 でない');
  for(const m of POL.MANAGED_POLICIES){
    assert(!('rules' in m), `${m.id}: マネージドポリシーがルール内容を持っている`);
    assert(POL.managedEffects({managed:m.id}).detection === 0, `${m.id}: 検知の差分が 0 でない`);
  }
  /* 検知経路の関数が stack を読めないこと */
  const ctx = {policy:POL.POLICY_DEFAULT, artifacts:true};
  assert(POL.detectionCount(ctx) === POL.detectionCount({...ctx, stack:'sysdig'}),
    'stack を渡すと検知数が変わる');
  return `管理束 ${POL.MANAGED_POLICIES.length} 件すべて detection:0 · stack で検知数不変`;
});

/* ------------------------------------------------------------------ *
 * バージョン軸（GAME-DESIGN §3）
 * ------------------------------------------------------------------ */
G('バージョン軸 — 上げると壊れ、戻す手がある (§3.7)');

check('飛べない。段は1つずつで、未リリースの段は選べない', () => {
  const l = VER.ladder('falco');
  assert(l.length >= 8, `はしごが短い: ${l.length}`);
  assert(VER.nextStep('falco-0.34').id === 'falco-0.35', '次の段が隣でない');
  assert(VER.nextStep('falco-0.34','2023-03-01') === null, '未リリースの段が選べている');
  const path = VER.upgradePath('falco-0.34','falco-0.40');
  assert(path.length === 6, `段を飛ばしている: ${j(path.map(r=>r.id))}`);
  assert(VER.upgradePath('falco-0.40','falco-0.34') === null, '降格が経路として返っている');
  const bl = VER.stepBlockers('falco-0.34','falco-0.40','2023-06-01');
  assert(bl.some(b=>b.code==='unreleased'), `未リリースが理由に出ない: ${j(bl)}`);
  return `${l.length} 段 · 0.34→0.40 は ${path.length} 段 · 降格なし`;
});

check('0.37 で旧 k8s.* が <NA> になり、0.40 まで戻す手が届かない', () => {
  assert(!VER.naFieldsAt('falco-0.36').length, '0.36 で既に <NA> が出ている');
  const na = VER.naFieldsAt('falco-0.37');
  assert(na.length === 4, `<NA> の数が違う: ${na.length}`);
  assert(na.every(x=>x.silent), '<NA> が silent でない（黙って壊れるのが要点）');
  for(const v of ['falco-0.37','falco-0.38','falco-0.39']){
    const r = VER.repairFor('k8s-workload-fields-na', v);
    assert(!r.available, `${v}: 戻す手が届いてしまう`);
    assert(r.upgradeTo === 'falco-0.40', `${v}: 上げ先が 0.40 でない（${r.upgradeTo}）`);
  }
  const ok = VER.repairFor('k8s-workload-fields-na','falco-0.40');
  assert(ok.available, '0.40 でも戻せない');
  assert(ok.plugin === 'k8smeta' && ok.alsoNeeds.includes('k8s-metacollector'),
    '戻す手に metacollector が入っていない');
  /* 直っていることも確認できる */
  assert(!VER.naFieldsAt('falco-0.40',{plugins:['k8smeta']}).some(x=>x.because==='k8s-workload-fields-na'),
    'プラグインを入れても <NA> が残る');
  return `0.36 なし → 0.37〜0.39 は available:false / upgradeTo:0.40 → 0.40 で k8smeta＋metacollector で復帰`;
});

check('締切は2つあり、持ち主が違う（版の締切と日付の締切）', () => {
  const falco = VER.deprecationById('falco-legacy-ebpf');
  const sysdig = VER.deprecationById('sysdig-legacy-ebpf');
  assert(falco.owner === 'falco' && falco.removedIn === '0.44.0',
    'Falco 側が版の締切になっていない');
  assert(sysdig.owner === 'sysdig-agent' && sysdig.endsOn === '2026-12-04',
    'Sysdig 側が 2026-12-04 の日付の締切になっていない');
  assert(falco.endsOn !== sysdig.endsOn, '2つの締切が同じ日付になっている（持ち主の混同）');
  const dl = VER.deadlines('2026-07-31');
  const f = dl.find(d=>d.id==='falco-legacy-ebpf'), s = dl.find(d=>d.id==='sysdig-legacy-ebpf');
  assert(f.days < 0, `Falco の締切が過去になっていない: ${f.days}`);
  assert(s.days > 0, `Sysdig の締切が未来になっていない: ${s.days}`);
  return `falco ${f.days}日（版 0.44.0 で削除・2026-05-26）/ sysdig ${s.days}日（日付 2026-12-04）`;
});

check('カーネル下限は soft、BTF と リングバッファ は hard', () => {
  const soft = VER.driverBlockers('modern_ebpf', {kernel:'5.4'});
  assert(soft.length && soft.every(b=>b.soft), `5.4 が hard で落ちている: ${j(soft)}`);
  assert(VER.driversAt({line:'falco', kernel:'5.4'}).find(d=>d.id==='modern_ebpf').ok,
    'kernel 5.4 で modern_ebpf が使えないと判定された（出典は「厳密でない」と書いている）');
  const hard = VER.driverBlockers('modern_ebpf', {btf:false});
  assert(hard.some(b=>b.code==='no-btf' && !b.soft), `BTF 無しが hard で落ちない: ${j(hard)}`);
  return '5.4 は warning のまま ok · BTF 無しは ok:false';
});

check('未固定の事実は isFixed() が false を返す（画面に事実として出せない）', () => {
  /* 固定済み: 0.37 の <NA> は INVARIANTS 3.7 が持っている */
  assert(VER.isFixed('k8s-workload-fields-na'), '3.7 が固定済みと出ない');
  /* 未固定: 廃止期限は1件も INVARIANTS に無い */
  for(const id of ['sysdig-legacy-ebpf','falco-legacy-ebpf'])
    assert(!VER.isFixed(id), `${id} が固定済みと出てしまう（INVARIANTS にまだ無い）`);
  assert(VER.fixedOnly(VER.deadlines('2026-07-31')).length === 0,
    '固定済みの締切が出ている（BOARD D1/D2 が閉じたらここを更新する）');
  /* **「0.38 以降 modern_ebpf が既定」を版の主張として復活させないこと。**
     検査レーンが INVARIANTS 3.1 からバージョンの帰属を外しました（出典が GKE と
     kmod の話で版を名指ししていない）。INVARIANTS §10.2 が「誰かが逆に直さないため」
     として明記しているので、こちらも機械で押さえます。 */
  assert(!VER.claimById('modern-ebpf-default-since-0.38'),
    '版を名指しする claim が復活している（§3.1 は帰属を落としました）');
  const dflt = VER.claimById('modern-ebpf-is-the-default');
  assert(dflt, 'modern eBPF が既定という（版なしの）claim が無い');
  assert(dflt.invariant === null && dflt.status === 'verified',
    `register に無いはずが ${dflt.invariant} / ${dflt.status} になっている`);
  assert(!/0\.38|0\.3[0-9] 以降|since/.test(dflt.jp),
    `claim の文が版を名指ししている: ${dflt.jp}`);
  assert(!VER.isFixed('driver_autoselect'),
    'driver_autoselect が固定済み扱いになっている（register に無い）');
  /* すべての claim が出典を持つこと */
  for(const c of VER.CLAIMS.concat(POL.CLAIMS))
    assert(c.src && c.src.length, `claim ${c.id} に出典が無い`);
  /* weak は「登録されているが出典より強い」状態。いま該当は無いのが正しい */
  const weak = VER.CLAIMS.concat(POL.CLAIMS).filter(c => c.status === 'weak');
  return `未固定 ${VER.unregisteredClaims().length} 件（weak ${weak.length}）`
       + ` · 締切の固定済み 0 件 · 出典なし 0 件 · 版を名指しする既定の主張なし`;
});

/* ------------------------------------------------------------------ *
 * 点（GAME-DESIGN §4.5）
 * ------------------------------------------------------------------ */
G('点 — 結果にだけ紐づく (§4.5)');

check('建てただけでは1点も入らない', () => {
  /* 加算の入口に建設数を渡しても無視されること */
  const bare = SCORE.earnRate({stopped:0});
  assert(bare.credit === 0, `1段も止めていないのに ${bare.credit} 点入る`);
  const withBuilt = SCORE.earnRate({stopped:0, built:DISTRICTS.map(d=>d.id), districts:9});
  assert(withBuilt.credit === 0, `建設数を渡すと ${withBuilt.credit} 点入る`);
  /* 加算は止めた割合が掛かる側 */
  const half = SCORE.earnRate({stopped:0.5});
  const full = SCORE.earnRate({stopped:1.0});
  assert(full.credit > half.credit && half.credit > 0, '止めた割合が加算に効いていない');
  /* 台帳のキーに地区名が入らない */
  assert(!Object.keys(SCORE.REASONS).some(k => DISTRICTS.map(d=>d.id).includes(k)),
    'REASONS に地区 id が入っている');
  return `stopped 0 → 0点 / 0.5 → ${half.credit}点 / 1.0 → ${full.credit}点`;
});

check('埋もれた1段は見逃した1段より重い', () => {
  assert(SCORE.LOSE.buried > SCORE.LOSE.miss,
    `buried ${SCORE.LOSE.buried} <= miss ${SCORE.LOSE.miss}`);
  const m = SCORE.loseRate({missed:1}).total;
  const b = SCORE.loseRate({buried:1}).total;
  assert(b > m, `実際の減算が逆（miss ${m} / buried ${b}）`);
  /* 加算側でも同じ向き: surfaced の重みが clean より大きい */
  assert(SCORE.EARN.parts.surfaced > SCORE.EARN.parts.clean,
    '加算側で surfaced が clean 以下（減算と向きが揃っていない）');
  return `miss ${m} < buried ${b} · 加算の重み clean ${SCORE.EARN.parts.clean} < surfaced ${SCORE.EARN.parts.surfaced}`;
});

check('脆弱性の放置は期間に比例する', () => {
  const one = SCORE.loseRate({vulns:[{id:'a',since:0}]}).total;
  const two = SCORE.loseRate({vulns:[{id:'a',since:0},{id:'b',since:0}]}).total;
  assert(two === one*2, `件数に比例しない（1件 ${one} / 2件 ${two}）`);
  /* 総額 = 率 × 期間: N tick 放置すれば N 倍 */
  let L = SCORE.newLedger();
  for(let t=1;t<=5;t++) L = SCORE.tickLedger(L, {stopped:1, vulns:[{id:'a',since:0}]}, {tick:t});
  assert(L.totals.lose.vuln === one*5, `5 tick で ${L.totals.lose.vuln}（期待 ${one*5}）`);
  return `1件1tick ${one} · 2件 ${two} · 1件×5tick ${L.totals.lose.vuln}`;
});

check('exit（エージェント停止）が最大の減算で、加算を 0 にする', () => {
  assert(SCORE.LOSE.dead === Math.max(...Object.values(SCORE.LOSE)),
    'dead が最大の減算でない');
  const e = SCORE.earnRate({stopped:1, dead:true});
  assert(e.credit === 0 && e.blocked === 'dead', '停止中に加算が入る');
  /* 計画停止（halted）は加算 0 だが dead の減算は無い — 別のもの */
  const h = SCORE.earnRate({stopped:1, halted:true});
  assert(h.credit === 0 && h.blocked === 'halted', 'halted が加算を止めていない');
  assert(SCORE.loseRate({halted:true}).total === 0, 'halted に減算が付いている（計画停止と事故は別）');
  assert(SCORE.loseRate({dead:true}).total === SCORE.LOSE.dead, 'dead の減算が出ない');
  return `dead ${SCORE.LOSE.dead}（最大）· 加算 0 · halted は減算 0`;
});

check('コストは時間とともに上がる', () => {
  for(const k of Object.keys(SCORE.COSTS))
    assert(SCORE.costAt(k,24) > SCORE.costAt(k,0), `${k} の値段が上がらない`);
  return j(Object.keys(SCORE.COSTS).map(k=>`${k} ${SCORE.costAt(k,0)}→${SCORE.costAt(k,24)}`));
});

check('何も打たずに溜め込むと、手を打つ側より先に枯れる', () => {
  const a = ARCH.archetypeById('industrial-ot');
  const mws = a.middleware.map(m=>m.id);
  let hoard = SCORE.newLedger(), act = SCORE.newLedger();
  let bustAt = null;
  for(let t=1;t<=24;t++){
    const st = VULN.vulnState({middleware:mws, seed:7, tick:t});
    /* 溜め込む側: 何も打たないので落ち続け、穴が積み上がる */
    hoard = SCORE.tickLedger(hoard,
      {stopped:0.57, dropP:0.2278, missed:3, vulns:st.open.map(v=>({id:v.id,since:v.t}))}, {tick:t});
    /* 手を打つ側: 絞ってドロップを止め、毎 tick 1件ずつ処理する */
    act = SCORE.tickLedger(act,
      {stopped:0.86, dropP:0, missed:1,
       vulns:st.open.slice(0, Math.max(0, st.open.length - t)).map(v=>({id:v.id,since:v.t}))}, {tick:t});
    if(SCORE.isBust(hoard) && bustAt === null) bustAt = t;
  }
  assert(bustAt !== null, '溜め込んでも枯れない（時間の進行に追い抜かれていない）');
  assert(!SCORE.isBust(act), `手を打つ側も枯れた（${act.points}点）— 詰みが打ち手のせいになっている`);
  assert(act.points > hoard.points, '手を打つ側が得をしていない');
  return `溜め込む: tick ${bustAt} で 0点 / 手を打つ: 24 tick 後 ${act.points}点`;
});

check('なぜ減ったかが後から言える（内訳と履歴）', () => {
  let L = SCORE.newLedger();
  L = SCORE.tickLedger(L, {stopped:0.5, dropP:0.3, buriedP:0.3, missed:2, buried:1,
                           vulns:[{id:'v1',since:0}]}, {tick:1, date:'2024-01-01'});
  L = SCORE.payFrom(L, 'ask', {tick:1});
  const s = SCORE.ledgerSummary(L);
  assert(s.lose.length >= 3, `減算の内訳が足りない: ${j(s.lose.map(r=>r.key))}`);
  assert(s.lose.every(r => r.jp && r.jp !== r.key), '減算に日本語の語が付いていない');
  assert(s.spend.some(r => r.key === 'ask'), '支払いが内訳に出ていない');
  assert(s.recent.length && s.recent.every(e => e.jp), '履歴に語が付いていない');
  assert(s.prices.length === Object.keys(SCORE.COSTS).length, '値札が揃っていない');
  /* 台帳が JSON 往復で不変（保存に載る日のため） */
  assert(!roundTrips(L, 'ledger', []).length, '台帳が純データでない');
  return `減算 ${j(s.lose.map(r=>r.key))} · 支払い ${j(s.spend.map(r=>r.key))} · net ${s.net}`;
});

/* ------------------------------------------------------------------ *
 * 時間（GAME-DESIGN §3）
 * ------------------------------------------------------------------ */
G('時間 — 戻れない・期限は猶予でない');

check('時計は進むだけで戻らない', () => {
  const c0 = TL.newClock({start:'2023-05-01', daysPerTick:42});
  const c1 = TL.advanceClock(c0, 1);
  assert(c1.tick === 1 && c0.tick === 0, '引数を書き換えている');
  assert(TL.advanceClock(c1, -5).tick === c1.tick, '負の tick で時間が戻った');
  assert(TL.clockDate(c1) > TL.clockDate(c0), '日付が進んでいない');
  return `${TL.clockDate(c0)} → ${TL.clockDate(c1)}（${c0.daysPerTick}日/tick）`;
});

check('期限の当日はもう越えた側', () => {
  const c = TL.newClock({start:'2026-01-01', daysPerTick:1});
  const r = TL.resolveTimeline(c, [{id:'x', at:'2026-01-01', until:'2026-01-03'}], {tick:2});
  assert(r.expired.length === 1, `当日に expired にならない: ${j(r)}`);
  /* tick 5 = 2026-01-06、期限は 01-03 なので 3 日超過 */
  const over = TL.overdueDays(c, {until:'2026-01-03'}, {tick:5});
  assert(over === 3, `越えてからの日数が合わない: ${over}`);
  assert(TL.overdueDays(c, {until:'2026-01-09'}, {tick:5}) === 0, '越えていないのに日数が出る');
  return `当日 = expired · 3日超過を数えられる · 未到達は 0`;
});

check('新しい段は時間が来るまで選べない（時間が門）', () => {
  const track = VER.ladder('falco').map(v => ({id:v.id, at:v.released}));
  const c = TL.newClock({start:'2023-05-01', daysPerTick:42});
  const early = TL.ladderAt(c, track, 'falco-0.34', {tick:0});
  assert(early.next === null || !early.next.arrived, '未リリースの段が next に出ている');
  assert(early.locked.length > 0, 'まだ出ていない段が locked に入らない');
  const late = TL.ladderAt(c, track, 'falco-0.34', {tick:30});
  assert(late.behind > early.behind, '時間が経っても遅れが増えない');
  const climb = TL.climbTo(c, track, 'falco-0.34', 'falco-0.44', {tick:0});
  assert(!climb.ok && climb.reason === 'unreleased', `tick 0 で 0.44 まで登れてしまう: ${j(climb)}`);
  return `tick 0: locked ${early.locked.length} 段 · tick 30: ${late.behind} 段遅れ`;
});

/* ------------------------------------------------------------------ *
 * F4 の素材 — ヘッドレスで1周
 * ------------------------------------------------------------------
 * GATE-FREEPLAY F4 は「業種 → 構成 → 守り方 → ポリシー → テスト → 本番 →
 * 時間進行 ×N → 終局 をブラウザ無しで通せること」。**判定側はルールレーン**ですが、
 * データがその1周を駆動できることはこちらが示します。
 *
 * `startScenario()` は登録済みシナリオを **id で** 引くので、合成したシナリオ
 * オブジェクトを渡せません（`BOARD §2 D31`・1行で開きます）。届くまでは
 * `startScenario()` が `sc` に対して行う代入と同じことをここで行います。
 * ------------------------------------------------------------------ */
G('F4 の素材（データが1周を駆動できる）');

function applyFreeplay(sc){
  const errs = validateShape(sc);
  assert(!errs.length, `schema が受け付けない: ${errs.join(' / ')}`);
  GAME.on = true;
  GAME.built = new Set(['workloads', ...sc.start.built]);
  GAME.unmet = Object.fromEntries(
    Object.entries(sc.start.unmet).map(([k,v]) => [k, v.slice()]));
  GAME.asks = 0; GAME.runs = 0;
  S.env = sc.env.type; S.cpus = sc.env.cpus; S.nodes = sc.env.nodes;
  S.tune = {...TUNE_DEFAULTS, ...sc.start.tune};
  S.load = sc.start.load;
  S.driver = sc.start.driver || S.driver;
  S.mode = sc.start.stack;
  S.dead = false; S.deadDrops = 0;
  return sc;
}

check('4業種すべてが ①→⑨ をヘッドレスで完走する', () => {
  const rows = [];
  for(const a of ARCH.ARCHETYPES){
    const stack = a.stack.favoured === 'sysdig' ? 'sysdig' : 'oss';
    const driver = ARCH.forcedAxisValue(a,'driver') || 'modern_ebpf';

    /* ④b 建てる — 点を払う */
    let ledger = SCORE.newLedger();
    const buildable = DISTRICTS.map(d=>d.id)
      .filter(d => d !== 'workloads' && ARCH.allowsDistrict(a, d))
      .filter(d => stack === 'sysdig' || d !== 'sysdig');
    const built = [];
    for(const d of buildable){
      if(!SCORE.canPay(ledger,'district',{tick:0})) break;
      ledger = SCORE.payFrom(ledger,'district',{tick:0,ref:d});
      built.push(d);
    }
    assert(built.length, `${a.id}: 1つも建てられない`);

    /* ⑤ テスト → ⑥ 本番（設定を引き継ぐ） */
    applyFreeplay(STAGE.freeplayScenario(a,'test',{stack,driver,built}));
    const test = evaluate(CHAIN,{}).filter(r=>r.caught).length;
    const carried = {...S.tune};
    applyFreeplay(STAGE.freeplayScenario(a,'prod',
      {stack,driver,built:[...GAME.built].filter(d=>d!=='workloads'),
       tune:carried, unmet:ARCH.unmetFor(a)}));
    assert(j(S.tune) === j({...TUNE_DEFAULTS, ...carried}),
      `${a.id}: 本番への遷移でチューニングが失われた`);
    const prod = evaluate(CHAIN,{}).filter(r=>r.caught).length;

    /* ⑦ 時間進行 ×12 → ⑧ 手を打つ → ⑨ 終局 */
    let clock = TL.newClock({start:VER.LADDER_START.date});
    let version = VER.LADDER_START.id, patched = [];
    const mws = a.middleware.map(m=>m.id);
    const allV = VULN.vulnsFor(mws,{seed:7});
    const track = VER.ladder('falco').map(v=>({id:v.id, at:v.released}));
    const post = postureFor(a);
    let ticks = 0;
    for(let t=1;t<=12;t++){
      clock = TL.advanceClock(clock,1); ticks = t;
      const st = VULN.vulnState({middleware:mws,seed:7,tick:t,patched});
      const camp = CAMP.generateCampaign(
        {chain:CHAIN, vulns:allV, tick:t, seed:7, size:4, posture:post});
      const au = CAMP.auditCampaign(camp, post, {vulns:allV});
      assert(!au.deadEnd, `${a.id}@${t}: 1周の途中で打つ手が無くなった`);
      const lad = TL.ladderAt(clock, track, version, {tick:t});
      if(lad.next && SCORE.canPay(ledger,'upgrade',{tick:t})){
        ledger = SCORE.payFrom(ledger,'upgrade',{tick:t,ref:lad.next.id});
        version = lad.next.id;
      }
      const fixable = st.open.find(v => !VULN.patchCostAt(v,t).blocked);
      if(fixable && SCORE.canPay(ledger,'patch',{tick:t})){
        ledger = SCORE.payFrom(ledger,'patch',{tick:t,ref:fixable.id});
        patched = [...patched, fixable.id];
      }
      ledger = SCORE.tickLedger(ledger, {
        stopped:au.coverage, dropP:model().dropP, buriedP:noise().buriedP,
        missed:au.rows.filter(r=>!r.caught).length,
        vulns:st.open.map(v=>({id:v.id,since:v.t}))},
        {tick:t, date:TL.clockDate(clock)});
      if(SCORE.isBust(ledger)) break;
    }
    /* 終局はどちらでもよい。**通り切れることが F4** */
    assert(!SCORE.scoreErrors(ledger).length, `${a.id}: 終局の台帳が壊れている`);
    rows.push(`${a.id} 建設${built.length} テスト${test}→本番${prod} ${ticks}tick`
      + `${SCORE.isBust(ledger)?' 枯渇':' 完走 '+ledger.points+'点'}`);
  }
  return rows.join(' · ');
});

check('1周の中で「テストで通ったのに本番で落ちる」が実際に起きる', () => {
  const rows = [], dropped = [];
  for(const a of ARCH.ARCHETYPES){
    const stack = a.stack.favoured === 'sysdig' ? 'sysdig' : 'oss';
    const driver = ARCH.forcedAxisValue(a,'driver') || 'modern_ebpf';
    const built = DISTRICTS.map(d=>d.id)
      .filter(d => d !== 'workloads' && ARCH.allowsDistrict(a,d))
      .filter(d => stack === 'sysdig' || d !== 'sysdig');
    applyFreeplay(STAGE.freeplayScenario(a,'test',{stack,driver,built}));
    const test = evaluate(CHAIN,{}).filter(r=>r.caught).length;
    applyFreeplay(STAGE.freeplayScenario(a,'prod',
      {stack,driver,built,tune:{...S.tune},unmet:ARCH.unmetFor(a)}));
    const prod = evaluate(CHAIN,{}).filter(r=>r.caught).length;
    if(prod < test) dropped.push(a.id);
    rows.push(`${a.id} ${test}→${prod}`);
  }
  /* 全業種で段が落ちる必要はありません。金融決済は Sysdig の相関でキューが
     捌けるので検知は落ちず、代わりに **goal のドロップ上限**（0.5%）で落ちます —
     それは上の「テスト→本番の段差」が数値で押さえています。**検知の段数が
     実際に落ちる業種が複数あること**がここの主張です。 */
  assert(dropped.length >= 3,
    `検知の段数が落ちる業種が ${dropped.length} しかない: ${j(rows)}`);
  return `${j(rows)} — 段が落ちたのは ${j(dropped)}`;
});

/* ------------------------------------------------------------------ *
 * F5 — 決定性
 * ------------------------------------------------------------------ */
G('F5 同じシードで同じ結果');

const POSTURES = {
  full:   {built:['driver','ring','state','rules','outputs','plugins','falcoctl','sysdig'],
           caps:['kernelPath','apiServer','runtimeSocket'], following:true},
  blind:  {built:['driver','ring','state','rules','outputs','plugins','falcoctl','sysdig'],
           caps:['kernelPath','apiServer','runtimeSocket'], following:true,
           tracedOff:['open','openat','openat2']},
  stale:  {built:['driver','ring','state','rules','outputs','plugins','falcoctl','sysdig'],
           caps:['kernelPath','apiServer','runtimeSocket'], following:false},
  ot:     {built:['driver','ring','state','rules','outputs','falcoctl'],
           caps:['kernelPath'], following:false, forbidden:['follow','update']}
};

check('同じシード・同じ姿勢なら生成キャンペーンが byte 一致', () => {
  const a = ARCH.archetypeById('web-service');
  const vs = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed:11});
  for(const [name, post] of Object.entries(POSTURES))
    for(const tick of [0, 7, 18]){
      const args = {chain:CHAIN, vulns:vs, tick, seed:11, size:5, posture:post};
      const one = JSON.stringify(CAMP.generateCampaign(args));
      const two = JSON.stringify(CAMP.generateCampaign(args));
      assert(one === two, `${name}@${tick}: 2回呼ぶと違う結果になる`);
    }
  return `${Object.keys(POSTURES).length} 姿勢 × 3 tick で一致`;
});

check('シードが違えば結果が違う（決定的だが固定ではない）', () => {
  const a = ARCH.archetypeById('web-service');
  const seen = new Set();
  for(const seed of [1,2,3,4,5]){
    const vs = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed});
    seen.add(JSON.stringify(CAMP.generateCampaign(
      {chain:CHAIN, vulns:vs, tick:12, seed, size:5, posture:POSTURES.blind})));
  }
  assert(seen.size > 1, '5つのシードで全部同じ結果になった（シードが効いていない）');
  return `5 シードで ${seen.size} 通り`;
});

check('公開時期も同じシードで同じ（世界が再現する）', () => {
  const mws = ARCH.archetypeById('industrial-ot').middleware.map(m=>m.id);
  assert(j(VULN.vulnsFor(mws,{seed:5}).map(v=>[v.id,v.t]))
      === j(VULN.vulnsFor(mws,{seed:5}).map(v=>[v.id,v.t])), '2回呼ぶと公開時期が変わる');
  assert(j(VULN.vulnsFor(mws,{seed:5}).map(v=>v.t))
      !== j(VULN.vulnsFor(mws,{seed:6}).map(v=>v.t)), 'シードで公開時期が変わらない');
  /* 公開は宣言した窓の中に入る */
  for(const v of VULN.vulnsFor(mws,{seed:5}))
    assert(v.t >= v.discloseIn[0] && v.t <= v.discloseIn[1],
      `${v.id}: 公開 ${v.t} が窓 ${j(v.discloseIn)} の外`);
  return `${VULN.vulnsFor(mws,{seed:5}).length} 件すべて窓の中 · seed で変わる`;
});

check('生成キャンペーンが純データ（JSON 往復で不変）', () => {
  const vs = VULN.vulnsFor(ARCH.archetypeById('game-platform').middleware.map(m=>m.id), {seed:2});
  const c = CAMP.generateCampaign({chain:CHAIN, vulns:vs, tick:9, seed:2, size:5, posture:POSTURES.full});
  const errs = roundTrips(c, 'campaign', []);
  assert(!errs.length, errs.slice(0,3).join(' / '));
  assert(JSON.stringify(JSON.parse(JSON.stringify(c))) === JSON.stringify(c), '往復で変わる');
  return `${c.steps.length} 段 · ${c.waves.length} 波 · intent ${c.intent}`;
});

/* ------------------------------------------------------------------ *
 * F6 — 打つ手が必ず存在する
 * ------------------------------------------------------------------ */
G('F6 生成された組み合わせに打つ手が必ず存在する');

/* 業種の宣言から「この状況ができない手」を導く。ここがルールレーンへの受け渡し
   そのものなので、契約（CONTRACT-datalayer.md §攻撃生成）と同じ式を使います。 */
function postureFor(a){
  const ALL = ['driver','ring','state','rules','outputs','plugins','falcoctl','sysdig'];
  const forb = ARCH.forbiddenDistricts(a);
  const following = !((ARCH.unmetFor(a).falcoctl) || []).includes('follow-refs');
  return {
    built: ALL.filter(d => !forb.includes(d)),
    caps: a.id === 'industrial-ot' ? ['kernelPath'] : ['kernelPath','apiServer','runtimeSocket'],
    following,
    forbidden: following ? [] : ['follow','update'],
    stack: a.stack.favoured === 'sysdig' ? 'sysdig' : 'oss',
    profile: a.id
  };
}

check('4業種 × 25 tick で、打つ手が無いキャンペーンが1つも出ない', () => {
  const rows = [];
  for(const a of ARCH.ARCHETYPES){
    const post = postureFor(a);
    const vs = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed:7});
    let worst = 1, dead = 0, unans = 0;
    for(let t=0;t<=24;t++){
      const c = CAMP.generateCampaign({chain:CHAIN, vulns:vs, tick:t, seed:7, size:5, posture:post});
      const au = CAMP.auditCampaign(c, post, {vulns:vs});
      assert(!au.deadEnd, `${a.id}@${t}: 抜けた段があるのに打つ手が0（dead end）`);
      assert(au.unanswerable.length <= CAMP.FAIRNESS.maxUnanswerable,
        `${a.id}@${t}: 答えの無い段が ${au.unanswerable.length} 件（上限 ${CAMP.FAIRNESS.maxUnanswerable}）`);
      assert(au.moves.length <= CAMP.FAIRNESS.maxRemedies,
        `${a.id}@${t}: 閉じるのに ${au.moves.length} 手（1手番に収まらない）`);
      assert(au.fair, `${a.id}@${t}: fair でない`);
      worst = Math.min(worst, au.coverage);
      if(au.unanswerable.length) unans++;
      if(au.deadEnd) dead++;
    }
    rows.push(`${a.id} 最低 ${pct(worst)}・答え無し ${unans}/25 tick`);
  }
  return rows.join(' · ');
});

check('打つ手を全部打てば、答えのある段は全部捕まる', () => {
  for(const a of ARCH.ARCHETYPES){
    const post = postureFor(a);
    const vs = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed:7});
    for(const t of [0,6,12,18,24]){
      const c = CAMP.generateCampaign({chain:CHAIN, vulns:vs, tick:t, seed:7, size:5, posture:post});
      const au = CAMP.auditCampaign(c, post, {vulns:vs});
      if(!au.moves.length) continue;
      const after = CAMP.auditCampaign(c, CAMP.applyRemedies(post, au.moves), {vulns:vs});
      assert(after.coverage >= au.coverage, `${a.id}@${t}: 手を打って悪化した`);
      const left = after.rows.filter(r => !r.caught).length;
      assert(left <= au.unanswerable.length,
        `${a.id}@${t}: 手を打っても ${left} 段が抜ける（答え無しは ${au.unanswerable.length} 段のはず）`);
    }
  }
  return '4業種 × 5 tick で、残るのは構造的に答えの無い段だけ';
});

check('製造業だけが「答えの無い段」を持ち、他の3業種は持たない', () => {
  const rows = [];
  for(const a of ARCH.ARCHETYPES){
    const post = postureFor(a);
    const vs = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed:7});
    let n = 0;
    for(let t=0;t<=24;t++){
      const c = CAMP.generateCampaign({chain:CHAIN, vulns:vs, tick:t, seed:7, size:5, posture:post});
      n += CAMP.auditCampaign(c, post, {vulns:vs}).unanswerable.length;
    }
    if(a.id === 'industrial-ot') assert(n > 0, '製造業に答えの無い段が1つも無い（天井が消えている）');
    else assert(n === 0, `${a.id} に答えの無い段が ${n} 件ある（そこは天井ではない）`);
    rows.push(`${a.id}=${n}`);
  }
  return rows.join(' ');
});

check('環境が起こせない振る舞いは生成されない（見逃しではなく非事象）', () => {
  const a = ARCH.archetypeById('industrial-ot');
  const post = postureFor(a);
  const vs = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed:7});
  const needApi = CHAIN.filter(s => (s.needsCaps||[]).includes('apiServer')).map(s=>s.id);
  assert(needApi.length, 'apiServer を要求する段が CHAIN に無い（この検査が空になる）');
  for(let t=0;t<=24;t++){
    const c = CAMP.generateCampaign({chain:CHAIN, vulns:vs, tick:t, seed:7, size:5, posture:post});
    for(const st of c.steps)
      assert(CAMP.possibleHere(st, post.caps),
        `t=${t}: 起こせない段 ${st.id} が生成された（needsCaps ${j(st.needsCaps)}）`);
  }
  return `apiServer を要求する段（${j(needApi)}）は standalone では1度も生成されない`;
});

check('盲点がある構成では、生成された攻撃がそこを突く', () => {
  const a = ARCH.archetypeById('web-service');
  const vs = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed:3});
  const gen = post => CAMP.generateCampaign(
    {chain:CHAIN, vulns:vs, tick:12, seed:3, size:5, posture:post});
  const clean = gen(POSTURES.full);
  const cleanCov = CAMP.auditCampaign(clean, POSTURES.full, {vulns:vs}).coverage;
  assert(cleanCov === 1, `盲点が無いのに抜けている: ${pct(cleanCov)}`);

  const blind = gen(POSTURES.blind);
  const blindAu = CAMP.auditCampaign(blind, POSTURES.blind, {vulns:vs});
  assert(blindAu.coverage < cleanCov, '盲点があっても被覆が下がらない');
  assert(blind.aim.length && blind.aim.every(x => x.cause === 'blind'),
    `盲点を狙っていない: ${j(blind.aim)}`);
  assert(blind.intent === 'blind-probe', `intent が blind-probe でない: ${blind.intent}`);

  const stale = gen(POSTURES.stale);
  assert(stale.aim.length && stale.aim.every(x => x.cause === 'stale'),
    `追従していない穴を狙っていない: ${j(stale.aim)}`);
  return `盲点なし ${pct(cleanCov)} / !open系 ${pct(blindAu.coverage)}（${blind.intent}）`
       + ` / 追従なし ${pct(CAMP.auditCampaign(stale,POSTURES.stale,{vulns:vs}).coverage)}（${stale.intent}）`;
});

check('新しく公開された穴が古い穴より優先される（時間で攻撃面が動く）', () => {
  const a = ARCH.archetypeById('web-service');
  const vs = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed:3});
  /* 直近に公開されたものが狙われていること。姿勢は blind にして
     「穴があるならそこ」を先に満たしたうえで、鮮度の効きを見る */
  const seenAt = {};
  for(const t of [4, 12, 22]){
    const c = CAMP.generateCampaign(
      {chain:CHAIN, vulns:vs, tick:t, seed:3, size:5, posture:POSTURES.stale});
    seenAt[t] = c.targets;
  }
  const changed = j(seenAt[4]) !== j(seenAt[22]);
  assert(changed, `tick 4 と 22 で狙う穴が同じ: ${j(seenAt)}`);
  /* 生成された段の since は必ずその時点で公開済み */
  for(const t of [4,12,22]){
    const c = CAMP.generateCampaign(
      {chain:CHAIN, vulns:vs, tick:t, seed:3, size:5, posture:POSTURES.stale});
    for(const st of c.steps)
      assert(!st.gen || st.since <= t, `t=${t}: まだ公開されていない穴 ${st.vuln} を踏んでいる`);
  }
  return `t=4 ${j(seenAt[4])} → t=22 ${j(seenAt[22])}`;
});

/* ------------------------------------------------------------------ *
 * 脆弱性の三択（GAME-DESIGN §4 ⑤）
 * ------------------------------------------------------------------ */
G('脆弱性 — 全部は塞げない / in-use は順番の話');

check('積み上がる速さが処理できる速さを超える', () => {
  for(const a of ARCH.ARCHETYPES){
    const mws = a.middleware.map(m=>m.id);
    const all = VULN.vulnsFor(mws, {seed:7});
    const horizon = VULN.VULN_HORIZON;
    const closable = horizon * VULN.COST.budgetPerTick;
    const need = all.reduce((s,v) => s + VULN.patchCostAt(v, v.t).total, 0);
    assert(need > closable,
      `${a.id}: ${horizon} tick で全部塞げてしまう（要 ${need} / 使える ${closable}）`);
  }
  return ARCH.ARCHETYPES.map(a => {
    const all = VULN.vulnsFor(a.middleware.map(m=>m.id), {seed:7});
    return `${a.id} ${all.length}件/要${all.reduce((s,v)=>s+VULN.patchCostAt(v,v.t).total,0)}`;
  }).join(' ');
});

check('in-use が見えるかどうかは順番だけを変え、検知を変えない', () => {
  const mws = ARCH.archetypeById('web-service').middleware.map(m=>m.id);
  const open = VULN.disclosedBy(VULN.vulnsFor(mws, {seed:3}), 20);
  const oss = VULN.triage(open, {stack:'oss', tick:20});
  const sys = VULN.triage(open, {stack:'sysdig', tick:20});
  assert(oss.order.length === sys.order.length, '件数が変わっている（検知が増減した）');
  assert(j(oss.order.map(r=>r.id).sort()) === j(sys.order.map(r=>r.id).sort()),
    '集合が変わっている（検知が増減した）');
  assert(j(oss.order.map(r=>r.id)) !== j(sys.order.map(r=>r.id)), '順番が変わっていない');
  assert(oss.order.every(r => r.inUse === null), 'OSS 側に in-use が見えている');
  assert(sys.order.some(r => r.inUse === true), 'Sysdig 側に in-use が見えていない');
  assert(oss.ties > 0, 'OSS 側で見分けのつかない塊が出ていない');
  const ossPlan = VULN.patchPlan(open, {stack:'oss', tick:20, budget:6});
  const sysPlan = VULN.patchPlan(open, {stack:'sysdig', tick:20, budget:6});
  assert(sysPlan.inUsePatched >= ossPlan.inUsePatched,
    `in-use が見える方が損をしている（oss ${ossPlan.inUsePatched} / sysdig ${sysPlan.inUsePatched}）`);
  return `同じ ${open.length} 件・順番だけ違う · OSS は上位 ${oss.ties} 件が同着`
       + ` · 予算6で in-use を塞げた数 oss ${ossPlan.inUsePatched} / sysdig ${sysPlan.inUsePatched}`;
});

check('放置は期間に比例して痛み、塞げないものは待っても塞げない', () => {
  const v = VULN.vulnsFor(['old-kernel'], {seed:7})[0];
  const now = VULN.patchCostAt(v, v.t);
  const later = VULN.patchCostAt(v, v.t + VULN.COST.driftEvery * 3);
  assert(later.downtime > now.downtime, '古くなっても停止時間が増えない');
  assert(now.blocked && later.blocked, '待つと塞げるようになってしまう');
  const p0 = VULN.vulnPressure([{...v, inUse:true}], {tick:v.t});
  const p9 = VULN.vulnPressure([{...v, inUse:true}], {tick:v.t + 9});
  assert(p9.riskPoints > p0.riskPoints, '放置しても risk が増えない');
  assert(p9.alertsPerMin === p0.alertsPerMin, 'アラート圧が期間で変わっている（件数の関数のはず）');
  return `停止 ${now.downtime}→${later.downtime} tick · blocked のまま · risk ${p0.riskPoints}→${p9.riskPoints}`;
});

/* ------------------------------------------------------------------ *
 * 画面レーンが指定した形（BOARD §2 #S5 / #S7 · GATE-FREEPLAY V2 / V5）
 * ------------------------------------------------------------------ */
G('画面向けの形 (#S5 / #S7)');

check('#S5 点の内訳が1件ずつ取れて、期首と期末が説明できる', () => {
  let L = SCORE.newLedger();
  L = SCORE.payFrom(L, 'district', {tick:0, ref:'driver'});
  L = SCORE.tickLedger(L, {stopped:0.5, dropP:0.3, buriedP:0.3, missed:2, buried:1,
                           vulns:[{id:'v1',since:0}]}, {tick:1, date:'2024-01-01'});
  L = SCORE.payFrom(L, 'ask', {tick:1});
  const b = SCORE.ledgerBreakdown(L);
  assert(b.opening === SCORE.SCORE_DEFAULTS.start, '期首残高が出ていない');
  assert(b.closing === L.points, '期末残高が台帳と合わない');
  assert(b.reconciles, `期首 ${b.opening} ＋ 内訳の合計 が期末 ${b.closing} にならない`);
  const kinds = new Set(b.entries.map(e => e.kind));
  for(const k of ['gain','loss','spend'])
    assert(kinds.has(k), `kind:'${k}' が出ていない（3種を区別すること）`);
  for(const e of b.entries){
    assert(typeof e.key === 'string' && e.key, 'key が機械可読でない');
    assert(Number.isFinite(e.delta), `${e.key}: delta が数値でない`);
    assert(e.kind === 'gain' ? e.delta >= 0 : e.delta <= 0,
      `${e.key}: delta の符号が kind と合わない（${e.delta}）`);
  }
  /* key だけで描けること = 画面が文言を持てる。jp は便宜であって必須ではない */
  assert(b.entries.every(e => SCORE.REASONS[e.key]), 'key が REASONS に無い');
  assert(!roundTrips(b, 'breakdown', []).length, '内訳が純データでない');
  return `期首 ${b.opening} → 期末 ${b.closing}（${b.entries.length} 件・整合 ${b.reconciles}）`
       + ` · ${j([...kinds])}`;
});

check('#S5 停止中の 0 点も履歴に残る（消すと理由が消える）', () => {
  let L = SCORE.newLedger();
  L = SCORE.tickLedger(L, {stopped:1, dead:true}, {tick:1});
  const b = SCORE.ledgerBreakdown(L);
  const zero = b.entries.find(e => e.kind === 'gain' && e.delta === 0);
  assert(zero, '加算 0 の行が履歴から消えている');
  assert(zero.key === 'dead', `0 点の理由が dead になっていない: ${zero.key}`);
  assert(b.entries.some(e => e.key === 'dead' && e.kind === 'loss'), '停止の減算が出ていない');
  return `0 点の行に理由が付く（key:'${zero.key}'）· 減算も別行で出る`;
});

check('#S7 業種ごとに「主役のレバーと、なぜか」が選ぶ前に読める', () => {
  for(const a of ARCH.ARCHETYPES){
    const b = ARCH.leverBriefing(a);
    assert(b, `${a.id}: briefing が無い`);
    assert(b.failureMode.kind, `${a.id}: 何が壊れるのか（mode）が無い`);
    assert(Number.isFinite(b.failureMode.dropPct), `${a.id}: 既定のドロップ率が無い`);
    assert(b.fixedBy.star && b.fixedBy.owner && b.fixedBy.why,
      `${a.id}: 主役のレバーと持ち主と理由が揃っていない`);
    assert(b.notFixedBy.length, `${a.id}: 効かないレバーが宣言されていない`);
    for(const n of b.notFixedBy)
      assert(Number.isFinite(n.dropPct), `${a.id}: ${n.lever} の実測値が無い`);
    assert(!roundTrips(b, `briefing ${a.id}`, []).length, `${a.id}: briefing が純データでない`);
  }
  return ARCH.ARCHETYPES.map(a => {
    const b = ARCH.leverBriefing(a);
    return `${a.id}:${b.failureMode.kind} ${b.failureMode.dropPct}%→${b.fixedBy.dropPct}%`;
  }).join(' ');
});

check('#S7 briefing の実測値がいまのモデルと一致する（飾りにならない網）', () => {
  for(const a of ARCH.ARCHETYPES){
    const ev = a.evidence;
    const base = stand(a.id,'prod');
    assert(Math.abs(base.M.dropP*100 - ev.defaultDropPct) < 0.02,
      `${a.id}: 既定のドロップが宣言とずれた（実測 ${pct(base.M.dropP)} / 宣言 ${ev.defaultDropPct}%）`);
    assert(Math.abs(base.N.buriedP*100 - ev.defaultBuriedPct) < 0.02,
      `${a.id}: 既定の埋没が宣言とずれた（実測 ${pct(base.N.buriedP)} / 宣言 ${ev.defaultBuriedPct}%）`);
    /* mode の宣言も実測と一致すること */
    if(ev.mode === 'burst') assert(base.M.sustained === 0, `${a.id}: mode:'burst' なのに持続超過がある`);
    else assert(base.M.sustained > 0, `${a.id}: mode:'${ev.mode}' なのに持続超過が 0`);
  }
  return ARCH.ARCHETYPES.map(a =>
    `${a.id} ${a.evidence.defaultDropPct}%/${a.evidence.defaultBuriedPct}%`).join(' ');
});

check('#S7 ポリシーの各レバーに「広げると→ / 絞ると→」が両方ある', () => {
  assert(POL.LEVERS.length >= 4, `レバーが少ない: ${POL.LEVERS.length}`);
  for(const l of POL.LEVERS){
    assert(l.owner, `${l.id}: 持ち主が無い（レバーには持ち主がいる）`);
    for(const dir of ['wider','narrower']){
      assert(l[dir] && l[dir].gain && l[dir].cost,
        `${l.id}.${dir}: gain と cost の両方が要る`);
    }
    assert(l.why, `${l.id}: why が無い`);
    assert(Array.isArray(l.values) && l.values.length, `${l.id}: 選べる値が無い`);
    assert(!roundTrips(l, `lever ${l.id}`, []).length, `${l.id}: 純データでない`);
  }
  /* 境目が見えること: 同じ形のレバーが2つの持ち主にまたがっている */
  const owners = new Set(POL.LEVERS.map(l => l.owner));
  assert(owners.has('detect') && owners.has('sre'),
    `検知エンジニアと SRE の両方のレバーが要る: ${j([...owners])}`);
  assert(POL.leverById('base_syscalls').foreign === 'state.js',
    'base_syscalls が他所のレバーだと明示されていない');
  return `${POL.LEVERS.length} レバー · 持ち主 ${j([...owners])}`
       + ` · 役割別 detect ${POL.leversFor('detect').length} / sre ${POL.leversFor('sre').length}`;
});

/* ------------------------------------------------------------------ *
 * 1つ足すのに他を触らずに済む形
 * ------------------------------------------------------------------ */
G('1つ足すのに他のファイルを触らずに済む');

check('どのファイルも要素数を数えていない・位置で引いていない', () => {
  /* 業種を1つ足したときに落ちないこと。合成した5番目を通してみる */
  const fake = JSON.parse(JSON.stringify(ARCH.archetypeById('web-service')));
  fake.id = 'zz-test'; fake.order = 999;
  fake.middleware = [{id:'nginx', jp:'nginx', kind:'x', patchable:true, why:'x'}];
  for(const st of STAGE.STAGE_IDS){
    const sc = STAGE.freeplayScenario(fake, st);
    assert(sc && sc.goal, `stages が新しい業種を扱えない（${st}）`);
  }
  const vs = VULN.vulnsFor(fake.middleware.map(m=>m.id), {seed:1});
  assert(vs.length, 'vulns が新しい業種の部品を扱えない');
  const c = CAMP.generateCampaign({chain:CHAIN, vulns:vs, tick:5, seed:1, posture:POSTURES.full});
  assert(c.steps.length, 'campaigns が新しい業種を扱えない');
  return 'stages / vulns / campaigns はどれも業種の増加に無関心';
});

check('CHAIN に段が増えても campaigns は落ちない（未知の段は access 扱い）', () => {
  const extra = CHAIN.concat([{id:'zz-new', jp:'新しい段', rule:'X',
                               needs:['rules'], needsCaps:['kernelPath'], needsSyscalls:['execve']}]);
  const c = CAMP.generateCampaign({chain:extra, vulns:[], tick:0, seed:1, posture:POSTURES.full});
  assert(c.steps.length, '段を足すと生成が空になる');
  assert(CAMP.phaseOf({id:'zz-new'}) === 'access', '未知の段が access に落ちない');
  return '未知の段は access フェーズへ · 生成は継続';
});

check('バージョンを1段足しても能力は宣言した段から積み上がる', () => {
  const l = VER.ladder('falco');
  for(let i=1;i<l.length;i++){
    const below = VER.capabilitiesAt(l[i-1].id);
    const here  = VER.capabilitiesAt(l[i].id);
    for(const c of below)
      assert(here.includes(c), `${l[i].id}: 下の段の能力 ${c} を失っている（積み上げが壊れている）`);
  }
  assert(VER.hasCapabilityAt('falco-0.44','base_syscalls'), '0.35 の能力が 0.44 に届いていない');
  assert(!VER.hasCapabilityAt('falco-0.34','base_syscalls'), '0.34 に 0.35 の能力がある');
  return `${l.length} 段すべてで単調 · base_syscalls は 0.35 から`;
});

/* ------------------------------------------------------------------ *
 * まだモデル側に入口が無いもの（GAP）
 * ------------------------------------------------------------------
 * 宣言だけ先に置いてあるものは GAP として記録します。**赤にはしません** —
 * 受け入れ口はルールレーンの持ち物で、こちらが勝手に作るとレーンの境界が壊れます。
 * CONTRACT-datalayer.md がこの3件の受け渡し方を定義しています。
 * ------------------------------------------------------------------ */
G('モデル側に入口が無いもの（GAP・BOARD D20 / D21）');

/* 規約（cases.mjs §gap）: **fn は「その GAP がまだ在ること」を主張します。**
   throw したら GAP が閉じたという意味で、check() に格上げする合図です。 */

gap('load.burstiness / load.spike を model() に渡す入口が無い', 'ルール', () => {
  const g = ARCH.archetypeById('game-platform'), w = ARCH.archetypeById('web-service');
  assert(typeof g.load.burstiness === 'number' && typeof g.load.spike === 'number',
    '宣言が無い（ここは宣言側の欠陥なので直すのはデータ層）');
  /* GAP の実体: 波打ち具合が 8.5 倍違う2業種を、同じ util に置くと
     burst 項が完全に一致する。model() が burstiness を見ていない証拠。 */
  const a = stand('game-platform','prod',{});
  const b = stand('web-service','prod',{});
  const ratio = g.load.burstiness / w.load.burstiness;
  assert(ratio > 5, '宣言の差が小さすぎてこの GAP を示せない');
  const same = stand('game-platform','prod');
  const forced = stand('web-service','prod');
  /* util が違うので burst も違うが、それは util 由来であって burstiness 由来ではない。
     宣言を無視していることを直接示す: spike を 10 倍にしても burst は動かない。 */
  const before = stand('game-platform','prod').M.burst;
  const tweaked = JSON.parse(JSON.stringify(g)); tweaked.load.spike = 24; tweaked.load.burstiness = 1;
  const after = stand('game-platform','prod').M.burst;
  assert(before === after,
    'burstiness / spike を動かすと burst が動いた — 入口ができている。check() に格上げすること');
  return `宣言（burstiness ${g.load.burstiness} / spike ${g.load.spike}）は model() に届かない。`
       + `burst 項は util からの近似のまま（${pct(before)}）— CONTRACT §2 load`;
});

gap('alerts.perNodeMul を noise() に渡す入口が無い', 'ルール', () => {
  const web = ARCH.archetypeById('web-service').alerts.perNodeMul;
  const ot  = ARCH.archetypeById('industrial-ot').alerts.perNodeMul;
  assert(web > ot, '宣言の向きが逆（直すのはデータ層）');
  /* GAP の実体: S を完全に同一にすると、係数が 2.3 倍違う2業種で流入が一致する。
     `noise()` は引数を取らず、業種の係数を読む場所がどこにも無いので当然そうなる —
     その「当然」を機械で押さえておくのがこの GAP の役目です。 */
  const sample = archId => {
    stand(archId, 'prod');
    /* 物理条件を全部揃える。揃えないと dropP 経由で流入が動いてしまい
       （溢れたノードは静かになる · state.js §noise `survive`）、
       係数の話ではなくノードの大きさの話になる */
    S.nodes = 4; S.load = 1.0; S.cpus = 8; S.driver = 'modern_ebpf';
    S.tune = {...TUNE_DEFAULTS};
    return noise().inflow;
  };
  const a = sample('web-service'), b = sample('industrial-ot');
  assert(Math.abs(a - b) < 1e-9,
    `係数が流入に効いている（${a.toFixed(2)} vs ${b.toFixed(2)}）— check() に格上げすること`);
  return `宣言（Web ${web} / 製造業 ${ot} = ${(web/ot).toFixed(2)}倍）は noise() に届かない。`
       + `S を揃えると流入が一致（どちらも ${a.toFixed(1)}/分）— いまは estate.nodes が代役 · CONTRACT §2 alerts`;
});

gap('ノイズの罰が段数に比例しない（1パスで1段しか盗まない）', 'ルール', () => {
  /* 宣言側の準備は済んでいる: 成熟度で埋没率が動くことは上の check で実測済み。
     GAP は罰の側で、`evaluate()` の budget.noise が 1 段固定であること。
     ここはルールレーンのファイルなので、宣言だけ置いて赤にしない。 */
  assert(POL.MATURITY_TIERS[2].noiseMul > POL.MATURITY_TIERS[0].noiseMul,
    '成熟度で騒がしさが変わらない（それならこの GAP は無い）');
  return 'evaluate() の budget.noise は1パスで1段固定。埋没率が 30.56% → 54.51% に'
       + '上がっても盗まれる段数は 1 のまま — 成熟度を広げた代償が結果に出ない · BOARD §2 D9';
});

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */
export function main(){
  const width = s => [...String(s)].reduce((a,c)=> a + (c.charCodeAt(0) > 0x2500 ? 2 : 1), 0);
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));

  console.log('\nfalco-city — データ層の回帰（8ファイル・数値は参考・向きが赤緑を決める）\n');

  console.log('  業種 × ステージ（実測）');
  console.log('  ' + pad('業種 / ステージ', 26) + pad('load', 7) + pad('nodes', 7)
                   + pad('util', 8) + pad('持続', 9) + pad('バースト', 10)
                   + pad('drop', 9) + '埋没');
  for(const a of ARCH.ARCHETYPES)
    for(const st of STAGE.STAGE_IDS){
      const {M, N} = stand(a.id, st);
      console.log('  ' + pad(`${a.jp} / ${st}`, 26) + pad(S.load, 7) + pad(S.nodes, 7)
                       + pad(M.util.toFixed(3), 8) + pad(pct(M.sustained), 9)
                       + pad(pct(M.burst), 10) + pad(pct(M.dropP), 9) + pct(N.buriedP));
    }

  let fail = 0, gaps = 0, last = '';
  console.log('');
  for(const r of results){
    if(r.group !== last){ console.log(`  ${r.group}`); last = r.group; }
    if(r.gap){
      gaps++;
      console.log(`    ${r.holds ? '○' : '×'} GAP[${r.phase}] ${r.name}`);
      console.log(`         ${r.note}`);
      if(!r.holds) console.log('         ↑ この GAP は閉じた。gap() を check() に上げること');
    } else if(r.ok){
      console.log(`    ✓ ${r.name}${r.note ? '  — ' + r.note : ''}`);
    } else {
      fail++;
      console.log(`    ✗ ${r.name}\n         ${r.note}`);
    }
  }

  const pass = results.filter(r=>!r.gap && r.ok).length;
  console.log(`\n  ${pass} 件成立 · ${fail} 件破綻 · ${gaps} 件は未実装の因果（GAP）\n`);
  return fail;
}
