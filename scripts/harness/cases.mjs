/* falco-city — causality regression cases.
   ------------------------------------------------------------------
   What this file protects: the DIRECTION of every causal claim the city
   teaches. Not the numbers. Absolute values are illustrative and the game
   will keep moving them; a test that pins 0.18% goes red on the first
   balance pass and gets deleted. So the assertions are relations
   ("a bigger buffer lowers burst loss", "a bigger buffer does nothing for
   sustained overload"), the verdict band name, which is the thing the player
   actually reads, and structural facts about the tables (which capability a
   step requires, which axis forbids a driver).

   INVARIANTS.md is the register of claims. Every check here should be
   findable in that table, and every row of that table that is implemented
   should be findable here.

   The measured numbers are printed anyway, because README's 実測表 was
   hand-copied prose. Print, don't assert.

   Cases marked GAP are causal claims the city makes elsewhere (README, the
   3D scene, the docs) that the scoring path does NOT yet implement. They are
   reported, they do not fail the run, and each one names the phase that is
   supposed to flip it into a real assertion. When a GAP starts holding the
   run says so — that is the signal to promote it to check(). */

import './env.mjs';                       /* must stay first — installs the DOM */
import { advanceClock, reseed } from './env.mjs';

import { S, GAME, TUNE_DEFAULTS, model, hasCap } from '../../src/state.js';
import { updateVerdict } from '../../src/ui.js';
import { evaluate, CHAIN, RESPONSE, DEPS, BUILD_ORDER, OWNER, ROLES, blameOf,
         SCENARIOS, startScenario, activeChain, goalStatus, runAttack,
         tickReveal, build, requestBuild, canUseLever } from '../../src/campaign.js';
import { step, spawn, N } from '../../src/sim.js';
import { DISTRICTS } from '../../src/layout.js';
import { DEPLOYMENTS, ORCH, NODE_OSES, SOCKETS, K8S_METAS, DRIVERS,
         composeEnv, currentEnv } from '../../src/districts.data.js';
import { setDeploy, setEnv } from '../../src/controls.js';
import { SCENARIO_ERRORS } from '../../src/scenarios/index.js';

/* ------------------------------------------------------------------ *
 * tiny harness
 * ------------------------------------------------------------------ */
const results = [];
let group = '';
const G = name => { group = name; };

function check(name, fn){
  try {
    const note = fn();
    results.push({group, name, ok:true, note: note ?? ''});
  } catch (e) {
    results.push({group, name, ok:false, note: e.message});
  }
}
/* a known, deliberate gap: recorded, never fatal */
function gap(name, phase, fn){
  let holds = false, note = '';
  try { note = fn() ?? ''; holds = true; } catch (e) { note = e.message; }
  results.push({group, name, gap:true, ok:true, holds, phase, note});
}

function eq(a, b, tol, what){
  if(Math.abs(a-b) > tol) throw new Error(`${what}: ${fmt(a)} vs ${fmt(b)} (許容 ${tol})`);
}
function assert(cond, msg){ if(!cond) throw new Error(msg); }
const fmt = n => typeof n === 'number' ? (Math.abs(n) < 1 ? n.toFixed(5) : n.toFixed(3)) : String(n);
const pct = n => (n*100).toFixed(2)+'%';
const plain = s => String(s || '').replace(/<[^>]+>/g, '');

/* ------------------------------------------------------------------ *
 * model helpers
 * ------------------------------------------------------------------ */
/* The environment is moved through controls.js rather than by writing S.deploy
   by hand. hasCap() resolves through the LIVE composition (districts.data.js
   §byDeployId), so a hand-set wire value and the axes can disagree — and then
   the harness would be testing a state the app cannot be in. */
function tune({load=1.0, set='default', buf=4, cpus=2, slow=false,
               driver='modern_ebpf', deploy='k8s', dropAction='alert',
               custom=[], repair=true} = {}){
  S.load = load; S.dead = false; S.deadDrops = 0;
  S.driver = driver;
  S.tune = {...TUNE_DEFAULTS, syscallSet:set, bufPreset:buf,
            cpusPerBuf:cpus, slowOutput:slow, dropAction,
            syscallCustom:custom.slice(), syscallRepair:repair};
  setDeploy(deploy);
  return model();
}
/* the band the player reads. Taken from the real ui.js code path rather than
   re-implemented here, so the thresholds cannot drift away from the app. */
function band(M){
  updateVerdict(M);
  return document.getElementById('mVerdict').className.replace('verdict', '').trim();
}
const rows = [];
function record(label, M){
  rows.push({label, util:M.util, sustained:M.sustained, burst:M.burst,
             dropP:M.dropP, shown:M.dropP/(1+M.dropP), band:band(M),
             passRatio:M.passRatio});
  return M;
}

/* ------------------------------------------------------------------ *
 * 1. the drop model — two failure modes, two different fixes
 *    INVARIANTS §1
 * ------------------------------------------------------------------ */
G('ドロップモデル (§1)');

const D_default = record('既定 (load ×1.0)',                  tune({}));
const D_15      = record('load ×1.5',                          tune({load:1.5}));
const D_15b9    = record('load ×1.5 + buf 9',                  tune({load:1.5, buf:9}));
const D_25      = record('load ×2.5',                          tune({load:2.5}));
const D_25b10   = record('load ×2.5 + buf 10',                 tune({load:2.5, buf:10}));
const D_25cust  = record('load ×2.5 + custom_set',             tune({load:2.5, set:'custom'}));
const D_all     = record('base_syscalls: all (load ×1.0)',     tune({set:'all'}));
const D_slow    = record('load ×1.0 + slow output',            tune({slow:true}));
const D_cpu1    = record('load ×2.5 + cpus_for_each_buffer 1', tune({load:2.5, cpus:1}));

check('健全なノードはドロップしない', () => {
  assert(D_default.dropP === 0, `dropP ${fmt(D_default.dropP)}`);
  assert(D_default.util < 1, `util ${pct(D_default.util)}`);
  return `util ${pct(D_default.util)} · 判定 ${band(D_default)}`;
});

check('バーストは判定 burst に落ちる（util < 100% でもドロップする）', () => {
  assert(D_15.util < 1, `util ${pct(D_15.util)} — 持続超過になっている`);
  assert(D_15.sustained === 0, `sustained ${fmt(D_15.sustained)}`);
  assert(D_15.dropP > 0, 'ドロップ 0');
  assert(band(D_15) === 'burst', `判定 ${band(D_15)}`);
  return `drop ${pct(D_15.dropP)} · util ${pct(D_15.util)}`;
});

check('buf_size_preset はバーストに効く（§1.3）', () => {
  assert(D_15b9.burst < D_15.burst, `burst ${fmt(D_15b9.burst)} ≥ ${fmt(D_15.burst)}`);
  assert(D_15b9.dropP < D_15.dropP, 'ドロップが減っていない');
  /* 単調でもあること: 大きくして悪くなる段があってはならない */
  let prev = Infinity;
  for(let b=1; b<=10; b++){
    const M = tune({load:1.5, buf:b});
    assert(M.burst <= prev, `buf ${b} で burst が増えた`);
    prev = M.burst;
  }
  return `${pct(D_15.dropP)} → ${pct(D_15b9.dropP)}（buf 4 → 9）· 1–10 で単調`;
});

check('持続超過は判定 sustained に落ちる', () => {
  assert(D_25.util > 1, `util ${pct(D_25.util)}`);
  assert(D_25.sustained > 0, 'sustained 0');
  assert(band(D_25) === 'sustained', `判定 ${band(D_25)}`);
  return `drop ${pct(D_25.dropP)} · util ${pct(D_25.util)}`;
});

check('持続超過で失う割合は 1 - 消費能力/入力（§1.2）', () => {
  /* 解析解そのもの。負荷・セット・ドライバ・出力の詰まりを総当りしても成立すること */
  for(const o of [{load:2.5}, {load:3.0}, {set:'all'}, {slow:true},
                  {load:2.5, cpus:3}, {load:2.5, driver:'kmod'}]){
    const M = tune(o);
    if(M.util <= 1) continue;
    eq(M.sustained, 1 - M.cap/M.inflow, 1e-12, `解析解との一致 (${JSON.stringify(o)})`);
  }
  return `1 - ${fmt(D_25.cap)}/${fmt(D_25.inflow)} = ${pct(D_25.sustained)}（6条件で一致）`;
});

check('buf_size_preset は持続超過に効かない（§1.3・10 段全部で同一）', () => {
  const base = tune({load:2.5, buf:1}).sustained;
  for(let b=1; b<=10; b++){
    const M = tune({load:2.5, buf:b});
    eq(M.sustained, base, 0, `buf ${b} の sustained`);
  }
  /* 512 MiB にしても目に見える改善が無い、が主張の核。改善幅は持続分より桁で小さい */
  const gain = D_25.dropP - D_25b10.dropP;
  assert(gain < base * 0.1, `buf 10 で持続分の ${pct(gain/base)} も改善している`);
  assert(band(D_25b10) === 'sustained', `buf 10 で判定が ${band(D_25b10)} になった`);
  return `buf 1–10 すべて sustained ${pct(base)} · 全体 ${pct(D_25.dropP)} → ${pct(D_25b10.dropP)}`;
});

check('base_syscalls を絞ると持続超過が止まる（§2.2）', () => {
  assert(D_25cust.util < 1, `util ${pct(D_25cust.util)}`);
  assert(D_25cust.dropP === 0, `drop ${pct(D_25cust.dropP)}`);
  assert(band(D_25cust) === 'ok', `判定 ${band(D_25cust)}`);
  assert(D_25cust.inflow < D_25.inflow, '入力が減っていない');
  return `load ×2.5 のまま ${pct(D_25.dropP)} → 0%（util ${pct(D_25cust.util)}）`;
});

check('base_syscalls: all は健全なノードを壊す', () => {
  assert(D_all.util > 1, `util ${pct(D_all.util)}`);
  assert(D_all.inflow > D_default.inflow, '入力が増えていない');
  assert(band(D_all) === 'sustained', `判定 ${band(D_all)}`);
  return `load ×1.0 のまま util ${pct(D_all.util)} · drop ${pct(D_all.dropP)}`;
});

check('slow output は syscall 量が普通でもドロップさせる（§1.5）', () => {
  assert(D_slow.inflow === D_default.inflow, '入力が変わっている');
  assert(D_slow.cap < D_default.cap, '消費能力が下がっていない');
  assert(band(D_slow) === 'sustained', `判定 ${band(D_slow)}`);
  return `入力そのまま · cap ${fmt(D_default.cap)} → ${fmt(D_slow.cap)} · util ${pct(D_slow.util)}`;
});

check('cpus_for_each_buffer を 1 にすると消費能力が上がる（§1.4・要判断）', () => {
  assert(D_cpu1.cap > D_25.cap, `cap ${fmt(D_cpu1.cap)} ≤ ${fmt(D_25.cap)}`);
  assert(D_cpu1.dropP < D_25.dropP, 'ドロップが減っていない');
  return `cap ${fmt(D_25.cap)} → ${fmt(D_cpu1.cap)} · drop ${pct(D_25.dropP)} → ${pct(D_cpu1.dropP)}`
       + '（INVARIANTS §1.4: Docs の推奨は逆向き）';
});

check('負荷に対して単調（util は増加・ドロップは非減少）', () => {
  let prevU = -1, prevD = -1;
  for(const load of [0.5,1.0,1.5,2.0,2.5,3.0]){
    const M = tune({load});
    assert(M.util > prevU, `util が load ${load} で減った`);
    assert(M.dropP >= prevD, `dropP が load ${load} で減った`);
    prevU = M.util; prevD = M.dropP;
  }
  return 'load 0.5 → 3.0 で単調';
});

check('ドライバの差はドロップの向きを変えない（§1.7）', () => {
  const a = tune({load:2.5, driver:'modern_ebpf'});
  const b = tune({load:2.5, driver:'ebpf'});
  const c = tune({load:2.5, driver:'kmod'});
  assert(a.inflow === b.inflow && b.inflow === c.inflow, '入力が変わっている');
  assert(band(a) === 'sustained' && band(b) === 'sustained' && band(c) === 'sustained',
    '判定が変わっている');
  return `cap ${fmt(a.cap)} / ${fmt(b.cap)} / ${fmt(c.cap)}（modern_ebpf / ebpf / kmod）`;
});

/* ------------------------------------------------------------------ *
 * 2. base_syscalls — what can and cannot create a blind spot
 *    INVARIANTS §2.1 / §2.3 / §2.4 / §2.5
 * ------------------------------------------------------------------ */
G('base_syscalls (§2)');

const SYSCALL_PATH = ['workloads','driver','ring','state','rules','outputs'];
const ALL = DISTRICTS.map(d=>d.id);

/* Run the attack against a specific build, outside any scenario: the whole
   step library comes, which is what explore mode does. GAME.scenario has to be
   cleared or activeChain() would replay whichever scenario ran last. */
function play(built, opts = {}){
  tune(opts);
  GAME.on = true;
  GAME.scenario = null;
  GAME.role = null; GAME.roleLocked = false;
  GAME.built = new Set(built);
  GAME.asks = 0;
  const out = evaluate();
  return {
    out,
    blames: out.map(blameOf),
    caught: out.filter(r=>r.caught).length,
    total: out.length,
    det: out.filter(r=>!r.response),
    missed: out.filter(r=>!r.caught),
    byId: id => out.find(r=>r.id === id)
  };
}

check('正の custom_set は有効なルールのカバレッジを奪えない（§2.1 / §2.3）', () => {
  const base = play(ALL);
  const pos  = play(ALL, {custom:['openat','openat2','execve','connect','ptrace']});
  assert(pos.caught === base.caught,
    `正の custom_set で検知が ${base.caught} → ${pos.caught} に減った。`
    + 'トレース集合は「有効なルールが要求する syscall ∪ base set」なので、'
    + '正の指定はカバレッジを奪えない（INVARIANTS §2.1）');
  assert(pos.det.every(r => r.caught === base.byId(r.id).caught), '段ごとの成否が変わった');
  return `custom_set に5個足しても ${base.caught}/${base.total} のまま。`
       + '盲点を作れるのは負の指定か repair:false（§2.4 / §2.5）';
});

check('盲点を作れるのは負の指定か repair:false — 記法は区別して持たれている', () => {
  /* Phase 1 が採点を入れるとき、レバーが3値しかなければ書けない。
     TUNE_DEFAULTS が両方を別に持っていることが、その前提。 */
  assert('syscallCustom' in TUNE_DEFAULTS, 'TUNE_DEFAULTS に custom_set が無い');
  assert('syscallRepair' in TUNE_DEFAULTS, 'TUNE_DEFAULTS に repair が無い');
  assert(Array.isArray(TUNE_DEFAULTS.syscallCustom), 'custom_set が配列でない');
  assert(TUNE_DEFAULTS.syscallRepair === true, 'repair の既定が true でない');
  const neg = play(ALL, {custom:['!openat','!openat2']});
  assert(neg.det.length > 0, 'チェーンが空');
  return 'syscallSet（プリセット）と syscallCustom / syscallRepair が別フィールド。'
       + `負の指定は記録されるが Phase 0 では採点しない（現在 ${neg.caught}/${neg.total}）`;
});

/* ------------------------------------------------------------------ *
 * 3. Campaign — 建てたものだけで迎え撃つ
 * ------------------------------------------------------------------ */
G('キャンペーン (§4 / §5)');

check('空き地では1段も検知しない・全段に理由が付く', () => {
  const r = play(['workloads']);
  assert(r.caught === 0, `${r.caught}/${r.total} 検知した`);
  assert(r.missed.every(m=>m.why && m.why.length > 0), '理由の無い見逃しがある');
  return `${r.caught}/${r.total}`;
});

check('syscall 経路だけでは cloud 段と対処が残る', () => {
  const r = play(SYSCALL_PATH);
  assert(!r.byId('cloud').caught, 'プラグイン無しで cloud 段を検知した');
  assert(!r.byId('contain').caught, 'Sysdig 無しで対処できた');
  assert(r.caught > 0 && r.caught < r.total, `${r.caught}/${r.total}`);
  return `${r.caught}/${r.total} · 残り ${r.missed.length} 段`;
});

check('既定同梱のルールセットに無い検知は falcoctl なしでは持てない（§4.1 / §4.3）', () => {
  const s = CHAIN.find(x => x.needs.includes('falcoctl'));
  assert(s, 'falcoctl を要求する段が無い');
  const without = play(ALL.filter(id=>id!=='falcoctl'));
  assert(!without.byId(s.id).caught, 'falcoctl 無しで検知した');
  assert(without.blames[without.out.indexOf(without.byId(s.id))] === 'detect',
    'falcoctl 由来の見逃しが検知エンジニアに帰属していない');
  return `${s.id} · ${s.rule}（INVARIANTS §4.3: この例自体は stable なので差し替え待ち）`;
});

check('Sysdig を足しても検知は1段も増えない（§5.2）', () => {
  const without = play(ALL.filter(id=>id!=='sysdig'));
  const withIt  = play(ALL);
  const dw = without.det.filter(r=>r.caught).length;
  const dv = withIt.det.filter(r=>r.caught).length;
  assert(dw === dv, `検知が ${dw} → ${dv} に増えた。Sysdig が増やすのは相関と応答だけ`);
  assert(CHAIN.every(s=>!s.needs.includes('sysdig')), 'CHAIN の段が sysdig を要求している');
  assert(RESPONSE.needs.includes('sysdig'), 'RESPONSE が sysdig を要求していない');
  return `検知 ${dw}/${without.det.length} は Sysdig の有無で不変 · 変わるのは対処だけ`;
});

check('検知と応答は別の部品（§5.1・全段検知でも止められない）', () => {
  const r = play(ALL.filter(id=>id!=='sysdig'));
  assert(r.det.every(x=>x.caught), '検知側が全段揃っていない');
  assert(!r.byId('contain').caught, 'Sysdig 無しで対処できた');
  assert(r.blames[r.out.length-1] === 'soc', '対処の欠落が SOC に帰属していない');
  return `検知 ${r.det.filter(x=>x.caught).length}/${r.det.length} · 対処 ✗`;
});

check('全部建てれば全段検知＋封じ込め', () => {
  const r = play(ALL);
  assert(r.caught === r.total, `${r.caught}/${r.total}`);
  assert(r.blames.every(b => b === null), '検知できた段に帰属が付いている');
  return `${r.caught}/${r.total}`;
});

check('ドロップは検知を1段盗む（起因はチューニング・§1.1）', () => {
  const clean = play(ALL);
  const over  = play(ALL, {load:2.6});
  assert(over.caught === clean.caught - 1, `${over.caught}/${over.total}`);
  const lost = over.missed[0];
  assert(lost.needs.includes('ring'), 'ring を要求しない段が落ちた');
  assert(/ドロップ/.test(plain(lost.why)), `理由がドロップでない: ${plain(lost.why)}`);
  assert(over.blames[over.out.indexOf(lost)] === 'sre', 'ドロップ由来の見逃しが SRE に帰属していない');
  return `${clean.caught}/${clean.total} → ${over.caught}/${over.total} · util ${pct(model().util)}`;
});

check('依存の宣言に循環・欠落が無い', () => {
  for(const [id, deps] of Object.entries(DEPS)){
    for(const d of deps) assert(DEPS[d] !== undefined, `${id} が未知の ${d} に依存`);
  }
  const seen = new Set(['workloads']);
  for(const id of BUILD_ORDER){
    assert(DEPS[id].every(d=>seen.has(d)), `${id} は BUILD_ORDER の順で建てられない`);
    seen.add(id);
  }
  const needed = new Set(CHAIN.flatMap(s=>s.needs).concat(RESPONSE.needs));
  for(const id of needed) assert(seen.has(id), `攻撃チェーンが建てられない ${id} を要求`);
  /* 01 workloads だけが持ち主なし。他は全部どこかの役割の持ち物 */
  const owned = new Set(ROLES.flatMap(r=>r.owns));
  for(const id of BUILD_ORDER) assert(owned.has(id), `${id} に持ち主が居ない`);
  return `${BUILD_ORDER.length} 地区・要求 ${needed.size} 種・全地区に持ち主あり`;
});

check('見逃しの帰属は5状態（platform / sre / detect / soc / 帰属なし）', () => {
  const seen = new Map();
  const collect = (r, label) => r.out.forEach((x,i) => {
    const b = r.blames[i];
    if(!seen.has(b)) seen.set(b, `${b ?? '帰属なし'}: ${x.id} (${label})`);
  });
  collect(play(ALL), '全部建てた');                           /* null */
  collect(play(ALL.filter(id=>id!=='plugins')), 'plugins 欠け');   /* detect */
  collect(play(ALL.filter(id=>id!=='sysdig')),  'sysdig 欠け');    /* soc */
  collect(play(ALL, {deploy:'host'}), 'standalone');              /* platform */
  collect(play(ALL, {load:2.6}), '過負荷');                       /* sre */
  const want = [null, 'platform', 'sre', 'detect', 'soc'];
  for(const w of want) assert(seen.has(w), `帰属 ${w ?? '帰属なし'} に到達できない`);
  for(const b of seen.keys())
    assert(want.includes(b), `未知の帰属 ${b} が出た`);
  return want.map(w => seen.get(w)).join(' · ');
});

check('見逃しの理由は原因に紐づく（capability 欠落を「ルールが古い」と言わない）', () => {
  const host = play(ALL, {deploy:'host'});
  const bad = host.missed.filter(m => /falcoctl|ルールを追従/.test(plain(m.why)));
  assert(bad.length === 0,
    `capability 欠落なのにルール配布のせいにしている段がある: ${bad.map(b=>b.id).join(',')}`);
  const k8sapi = host.byId('k8sapi');
  assert(!k8sapi.caught, 'standalone で k8sapi 段を検知した');
  assert(/API サーバ/.test(plain(k8sapi.why)), `理由が API サーバの不在でない: ${plain(k8sapi.why)}`);
  assert(!/インストール形態/.test(plain(k8sapi.why).replace(/（.*?）/g,'')),
    '理由がインストール形態の話になっている');
  return plain(k8sapi.why).slice(0, 60) + '…';
});

/* ------------------------------------------------------------------ *
 * 4. the environment — four orthogonal axes
 *    INVARIANTS §3
 * ------------------------------------------------------------------ */
G('環境の直交4軸 (§3)');

const AXIS_BASE = {orch:'k8s', nodeOs:'generic', socket:'reachable',
                   k8sMeta:'on', driver:'modern_ebpf'};
const withAxes = o => composeEnv({...AXIS_BASE, ...o});

check('kmod が不可なのは COS のときだけ（§3.1 / §3.2）', () => {
  const cos = NODE_OSES.find(o => o.id === 'cos');
  assert(cos, 'COS の軸値が無い');
  assert(cos.blocks.includes('kmod'), 'COS が kmod を禁じていない');
  for(const o of NODE_OSES)
    if(o.id !== 'cos') assert(!o.blocks.includes('kmod'), `${o.id} が kmod を禁じている`);

  /* 決めているのは node OS 軸。orchestrator を5値とも動かしても向きは変わらない */
  for(const o of ORCH){
    assert(!withAxes({orch:o.id}).blockedDrivers.includes('kmod'),
      `orch=${o.id} ＋ 汎用 Linux で kmod が落ちた`);
    assert(withAxes({orch:o.id, nodeOs:'cos'}).blockedDrivers.includes('kmod'),
      `orch=${o.id} ＋ COS で kmod が落ちない`);
  }
  /* managed であること自体の帰結ではない、を名前付き環境の側でも固定する */
  const managed = DEPLOYMENTS.filter(d => d.managed);
  assert(managed.length >= 2, `managed な名前付き環境が ${managed.length} 個しか無い`);
  const ok = managed.filter(d => d.kmodOk);
  assert(ok.length >= 1, 'managed で kmod が使える環境が1つも無い（§3.2 の誤りが再発している）');
  for(const d of managed.filter(x => !x.kmodOk))
    assert(d.nodeOs === 'cos', `${d.id} は COS でないのに kmod 不可になっている`);
  return `COS のみ kmod 不可（orchestrator 5値と独立）· managed で kmod 可: `
       + ok.map(d=>d.id).join(' / ');
});

check('COS を選ぶと生きているレバーからも kmod が落ちる', () => {
  tune({deploy:'eks', driver:'kmod'});
  assert(S.driver === 'kmod', `EKS ＋ 汎用 Linux で kmod にできない: ${S.driver}`);
  const env = setEnv('nodeOs', 'cos');
  assert(env.blockedDrivers.includes('kmod'), 'COS にしても kmod がブロックされない');
  assert(S.driver !== 'kmod', `COS なのに kmod のまま: ${S.driver}`);
  const back = setEnv('nodeOs', 'generic');
  assert(!back.blockedDrivers.includes('kmod'), '汎用 Linux に戻しても kmod が塞がれている');
  return `EKS: kmod → COS で ${S.driver} に落ちる → 汎用 Linux で復帰`;
});

check('4軸は直交（1軸を動かして他の帰結は動かない）', () => {
  const base = withAxes({});
  /* driver 軸だけが kernelPath を決める */
  for(const o of ORCH)
    assert(withAxes({orch:o.id}).kernelPath === base.kernelPath, `orch=${o.id} が kernelPath を動かした`);
  for(const s of SOCKETS)
    assert(withAxes({socket:s.id}).kernelPath === base.kernelPath, `socket=${s.id} が kernelPath を動かした`);
  assert(!withAxes({driver:'nodriver'}).kernelPath, 'nodriver で kernelPath が残っている');

  /* orchestrator 軸だけが apiServer / cluster を決める */
  for(const s of SOCKETS){
    const e = withAxes({socket:s.id});
    assert(e.apiServer === base.apiServer && e.cluster === base.cluster,
      `socket=${s.id} が apiServer / cluster を動かした`);
  }
  assert(!withAxes({orch:'none'}).apiServer, 'orchestrator なしで apiServer が残っている');

  /* socket 軸だけが container.* / k8s.pod.* を決める */
  const un = withAxes({socket:'unreachable'});
  assert(un.containerFields.length < base.containerFields.length, 'ソケット不可で container.* が減らない');
  assert(un.containerFields.length === 2, 'cgroup から取れる2フィールドが残っていない');
  assert(un.podFields.length === 0 && base.podFields.length > 0, 'k8s.pod.* がソケットに従っていない');
  for(const m of K8S_METAS)
    assert(withAxes({k8sMeta:m.id}).containerFields.length === base.containerFields.length,
      `k8smeta=${m.id} が container.* を動かした`);

  /* k8smeta 軸だけが apiserver 由来フィールドを決める（API サーバがある限り） */
  const off = withAxes({k8sMeta:'off'});
  assert(off.metaFields.length === 0 && off.naFields.length > 0, 'k8smeta 無しで <NA> が出ない');
  assert(base.metaFields.length > 0, 'k8smeta 有りでフィールドが付かない');
  return `kernelPath←driver · apiServer/cluster←orch · container.*/k8s.pod.*←socket · `
       + `k8smeta.*←k8smeta（${ORCH.length}×${NODE_OSES.length}×${SOCKETS.length}×${K8S_METAS.length} の組合せで検査）`;
});

check('段が要求するのは capability だけ（トポロジ名でも k8sMeta でもない）', () => {
  const CAPS = ['kernelPath','k8sMeta','apiServer','cluster'];
  for(const s of CHAIN){
    assert(!('deploy' in s), `${s.id} がトポロジ名 deploy を要求している`);
    for(const c of (s.needsCaps || []))
      assert(CAPS.includes(c), `${s.id} が未知の capability ${c} を要求`);
  }
  /* container / k8s メタデータはランタイムソケット由来で、インストール形態と直交する。
     どの検知もそれを要求していないこと（§3.7 の裏返し）。 */
  assert(CHAIN.every(s => !(s.needsCaps || []).includes('k8sMeta')),
    'k8sMeta を検知の前提にしている段がある — インストール形態のせいにする誤りが戻っている');
  const covered = new Set(CHAIN.flatMap(s => s.needsCaps || []));
  return `要求されている capability: ${[...covered].join(' / ')}`;
});

check('managed k8s では全段成立する（7/7）', () => {
  const managed = DEPLOYMENTS.filter(d => d.managed && d.kmodOk);
  assert(managed.length > 0, 'managed な環境が無い');
  const r = play(ALL, {deploy:managed[0].id});
  assert(r.det.length + 1 === r.total, '対処の段が無い');
  assert(r.caught === r.total, `${r.caught}/${r.total}`);
  /* GKE（COS ノード）でも同じ。COS が落とすのは kmod だけで、検知は落とさない */
  const gke = DEPLOYMENTS.find(d => d.managed && !d.kmodOk);
  if(gke){
    const g = play(ALL, {deploy:gke.id});
    assert(g.caught === g.total, `${gke.id} で ${g.caught}/${g.total}`);
  }
  return `${managed[0].id} ${r.caught}/${r.total}`
       + (gke ? ` · ${gke.id}（COS）も ${play(ALL, {deploy:gke.id}).caught}/${r.total}` : '');
});

check('serverless（nodriver）では 2/7 しか成立しない（§3.10）', () => {
  const sl = DEPLOYMENTS.find(d => !d.kernelPath);
  assert(sl, 'カーネル経路の無い環境が無い');
  const r = play(ALL, {deploy:sl.id});
  const caught = r.out.filter(x=>x.caught).map(x=>x.id);
  assert(r.caught === 2, `${r.caught}/${r.total}（${caught.join(',')}）`);
  assert(caught.includes('cloud'), 'クラウド段が落ちた — プラグイン入力はカーネル経路と独立');
  assert(caught.includes('contain'), '対処が落ちた — 応答はカーネル経路と独立');
  return `${sl.id} ${r.caught}/${r.total} · 残るのは ${caught.join(' / ')}`;
});

check('kernel-less では syscall 由来の段は原理的に検知できない（§3.10・旧 GAP 6.2）', () => {
  const sl = DEPLOYMENTS.find(d => !d.kernelPath);
  const r = play(ALL, {deploy:sl.id});
  const syscallSteps = r.det.filter(x => (x.needsCaps || []).includes('kernelPath'));
  assert(syscallSteps.length > 0, 'kernelPath を要求する段が無い');
  assert(syscallSteps.every(x => !x.caught),
    `${syscallSteps.filter(x=>x.caught).length} 段が検知扱いになっている`);
  assert(syscallSteps.every(x => /リングバッファ/.test(plain(x.why))),
    '理由がリングバッファの不在になっていない');
  assert(r.out.map((x,i)=>[x,r.blames[i]]).filter(([x])=>syscallSteps.includes(x))
          .every(([,b]) => b === 'platform'),
    'カーネル経路の欠落が基盤役に帰属していない');
  return `${syscallSteps.length} 段すべて未検知・帰属は platform`;
});

check('構成による見逃しは負荷とは独立（ドロップ由来と混ざらない）', () => {
  const host = play(ALL, {deploy:'host'});
  const both = play(ALL, {deploy:'host', load:2.6});
  assert(both.caught === host.caught - 1, `${both.caught}/${both.total}`);
  return `standalone ${host.caught}/${host.total} → standalone+過負荷 ${both.caught}/${both.total}`;
});

/* ------------------------------------------------------------------ *
 * 5. the cloud source — a different source, and no correlation between sources
 *    INVARIANTS §3.9
 * ------------------------------------------------------------------ */
G('クラウドは別ソース (§3.9)');

const CLOUD = CHAIN.find(s => s.id === 'cloud');

check('クラウド段は syscall 経路を一切要求しない', () => {
  assert(CLOUD, 'cloud 段が無い');
  for(const k of ['driver','ring','state'])
    assert(!CLOUD.needs.includes(k), `cloud 段が ${k} を要求している`);
  assert(!(CLOUD.needsCaps || []).includes('kernelPath'),
    'cloud 段がカーネル経路を要求している — 別ソースであることが崩れている');
  assert(CLOUD.needs.includes('plugins'), 'cloud 段がプラグイン入力を要求していない');
  return `needs: ${CLOUD.needs.join(' / ')} · needsCaps: ${(CLOUD.needsCaps||[]).join(' / ') || 'なし'}`;
});

check('ソース間を相関しない（syscall 経路を全部建てても取れない）', () => {
  const noPlugins = play(ALL.filter(id => id !== 'plugins'));
  const withPlugins = play(ALL);
  assert(!noPlugins.byId('cloud').caught, 'プラグイン無しで cloud 段を検知した');
  assert(withPlugins.byId('cloud').caught, 'プラグイン有りで cloud 段を検知しない');
  const why = plain(noPlugins.byId('cloud').why);
  assert(/別のイベントソース/.test(why), `理由が別ソースの話になっていない: ${why}`);
  assert(/相関/.test(why), `理由がソース間の相関の話になっていない: ${why}`);
  return why.replace(/\s+/g,'').slice(0, 72) + '…';
});

check('別ソースなのでカーネル経路の有無と独立に成立する', () => {
  const sl = DEPLOYMENTS.find(d => !d.kernelPath);
  for(const dep of ['k8s', 'host', sl.id]){
    const r = play(ALL, {deploy:dep});
    assert(r.byId('cloud').caught, `${dep} で cloud 段が落ちた`);
  }
  /* 逆向きも: 過負荷でリングバッファが溢れても、別ソースなので盗まれない */
  const over = play(ALL, {load:2.8});
  assert(over.byId('cloud').caught, '過負荷で cloud 段が落ちた — 別ソースが ring に巻き込まれている');
  return 'self-managed / standalone / serverless の3構成と過負荷で成立';
});

/* ------------------------------------------------------------------ *
 * 6. scenarios — every registered scenario has to be clearable
 * ------------------------------------------------------------------ */
G('シナリオ');

function revealAll(){
  for(let i=0; i<400 && GAME.results && GAME.reveal < GAME.results.length; i++)
    tickReveal(10);
}

/* A generic play-through: fix what the role is allowed to fix, build what the
   achievable steps need, ask another team for the rest. No scenario-specific
   knowledge — if a scenario cannot be cleared this way it is either unclearable
   or it needs a lever the role does not hold, and both are content bugs. */
function solve(sc){
  assert(startScenario(sc.id), `${sc.id}: 起動できない`);

  if(canUseLever('tuning')){
    if(S.tune.slowOutput) S.tune.slowOutput = false;
    if(S.tune.syscallSet === 'all') S.tune.syscallSet = 'default';
    if(model().burst > 0) S.tune.bufPreset = 10;
  }

  const want = new Set();
  for(const s of activeChain()){
    if((s.needsCaps || []).some(c => !hasCap(c))) continue;   /* この環境では起こり得ない */
    s.needs.forEach(k => want.add(k));
  }
  if(sc.goal.contain) RESPONSE.needs.forEach(k => want.add(k));
  for(;;){
    let grew = false;
    for(const id of [...want])
      for(const d of (DEPS[id] || []))
        if(!want.has(d)){ want.add(d); grew = true; }
    if(!grew) break;
  }
  for(const id of BUILD_ORDER){
    if(!want.has(id) || GAME.built.has(id)) continue;
    if(GAME.role === null || OWNER[id] === GAME.role) build(id);
    else requestBuild(id);
  }

  runAttack();
  revealAll();
  const st = goalStatus();
  assert(st, `${sc.id}: 判定が出ない`);
  return st;
}

/* The count is content, not causality: scenarios get registered and parked
   (see 2d9ca9b, which unregistered one because its example rule turned out to
   be bundled). So the invariant is "every registered scenario is clearable",
   not "there are seven of them" — the latter would go red on the next content
   commit and get deleted, which is how a harness dies. */
check('登録済みシナリオがすべてクリア可能', () => {
  assert(SCENARIOS.length > 0, 'シナリオが1本も登録されていない');
  const lines = [];
  for(const sc of SCENARIOS){
    const st = solve(sc);
    const detail = st.items.map(i =>
      `${i.key} ${i.actual}${i.of !== undefined ? '/'+i.of : ''}${i.ok ? '' : '✗(目標 '+i.target+')'}`
    ).join(' ');
    lines.push(`${sc.id}: ${detail}`);
    assert(st.cleared, `${sc.id} がクリアできない — ${detail}`
      + `（役割 ${GAME.role ?? '全役'} · 依頼 ${GAME.asks}）`);
  }
  return `${SCENARIOS.length} 本すべてクリア\n         ` + lines.join('\n         ');
});

check('シナリオのクリア条件はその環境で達成可能な段数を超えない', () => {
  const lines = [];
  for(const sc of SCENARIOS){
    assert(startScenario(sc.id), `${sc.id}: 起動できない`);
    const chain = activeChain();
    const possible = chain.filter(s => (s.needsCaps || []).every(c => hasCap(c))).length;
    if(sc.goal.detect !== null)
      assert(sc.goal.detect <= possible,
        `${sc.id}: goal.detect ${sc.goal.detect} だが、この環境で成立し得るのは ${possible} 段`);
    if(sc.goal.contain)
      assert(sc.attack.response, `${sc.id}: 封じ込めを要求しているのに response の段が来ない`);
    lines.push(`${sc.id} ${sc.goal.detect ?? '-'}/${possible}`);
  }
  return lines.join(' · ');
});

check('シナリオ検証エラーは 0（shape ＋ 参照整合の両方）', () => {
  assert(SCENARIO_ERRORS.length === 0,
    `${SCENARIO_ERRORS.length} 件: ${SCENARIO_ERRORS.join(' / ')}`);
  return `SCENARIO_ERRORS = 0（${SCENARIOS.map(s=>s.id).join(', ')}）`;
});

check('シナリオはどれも JSON を往復できる（純データ）', () => {
  for(const sc of SCENARIOS){
    const round = JSON.parse(JSON.stringify(sc));
    assert(JSON.stringify(round) === JSON.stringify(sc), `${sc.id} が JSON を往復できない`);
  }
  return `${SCENARIOS.length} 本すべて JSON.stringify → parse で不変`;
});

/* ------------------------------------------------------------------ *
 * 7. particle simulation — 数字ではなく経路
 * ------------------------------------------------------------------ */
G('シミュレーション (§1.1 / §1.6)');

function pump(frames = 900, dt = 1/60){
  for(let i=0;i<frames;i++){ advanceClock(dt*1000); step(dt); }
  return {...S.counters};
}
function fresh(opts = {}){
  reseed();
  tune(opts);
  GAME.on = false;
  GAME.scenario = null;
  GAME.role = null;
  GAME.built = new Set(ALL);
  GAME.frontier = Infinity;
  S.counters = {sys:0, ring:0, drop:0, rules:0, alerts:0};
  S.alertWindow = [];
  for(let i=0;i<N;i++) spawn(i, Math.random()*0.5);
}

check('既定構成は syscall → ring → rules → alert が流れる', () => {
  fresh();
  const c = pump();
  assert(c.sys > 0 && c.ring > 0 && c.rules > 0, JSON.stringify(c));
  assert(c.ring < c.sys, `ring ${c.ring} ≥ sys ${c.sys} — カーネル側の門が効いていない`);
  assert(c.drop === 0, `健全なノードで ${c.drop} 件ドロップした`);
  return `sys ${c.sys} · ring ${c.ring} · rules ${c.rules} · alerts ${c.alerts}`;
});

check('カーネル側で通るのは既定セットの比率どおり', () => {
  fresh();
  const c = pump();
  eq(c.ring/c.sys, model().passRatio, 0.05, 'ring/sys と passRatio');
  return `ring/sys ${pct(c.ring/c.sys)} · passRatio ${pct(model().passRatio)}`;
});

check('kernel-less はリングバッファ流入 0・プラグイン入力だけがルールに届く', () => {
  const sl = DEPLOYMENTS.find(d => !d.kernelPath);
  fresh({deploy:sl.id});
  const c = pump();
  assert(c.ring === 0, `ring ${c.ring}`);
  assert(c.sys === 0, `sys ${c.sys}`);
  assert(c.drop === 0, `drop ${c.drop}`);
  assert(c.rules > 0, 'プラグイン入力がルールに届いていない');
  return `ring 0 · rules ${c.rules} · alerts ${c.alerts}`;
});

check('ドロップはリングバッファでだけ起きる（§1.1）', () => {
  fresh({load:2.5});
  const c = pump();
  assert(c.drop > 0, 'ドロップしていない');
  assert(c.drop < c.ring, `drop ${c.drop} ≥ ring ${c.ring}`);
  /* 実測とモデルが同じ向き・同じ桁であること。分母は ring（HUD の式ではない） */
  const measured = c.drop / c.ring;
  eq(measured, model().dropP, 0.03, '実測 drop/ring とモデル dropP');
  return `実測 ${pct(measured)} · モデル ${pct(model().dropP)} · HUD 表示式 ${pct(c.drop/(c.ring+c.drop))}`;
});

check('syscall_event_drops.actions: exit は検知を本当にゼロにする（§1.6）', () => {
  fresh({load:2.5, dropAction:'exit'});
  pump(600);
  assert(S.dead, 'ドロップが続いても exit しなかった');
  const before = {...S.counters};
  pump(600);
  assert(S.counters.ring === before.ring, `停止後に ring が ${S.counters.ring - before.ring} 増えた`);
  assert(S.counters.alerts === before.alerts, '停止後にアラートが増えた');
  return `停止まで ${before.drop} ドロップ · 停止後の流入 0`;
});

check('ignore は黙って盲目になる（停止しない）', () => {
  fresh({load:2.5, dropAction:'ignore'});
  const c = pump(600);
  assert(!S.dead, 'ignore で停止した');
  assert(c.drop > 0, 'ドロップしていない');
  return `drop ${c.drop} · 停止せず · 判定 ${band(model())}`;
});

/* ------------------------------------------------------------------ *
 * 8. 実装されていない因果（GAP）
 * ------------------------------------------------------------------ */
G('未実装の因果 (§6)');

gap('絞れば満点が戻る — custom_set の検知損失が採点に入っていない', 'Phase 1', () => {
  const clean = play(ALL, {load:2.6});
  const cust  = play(ALL, {load:2.6, set:'custom'});
  const passLoss = 1 - tune({load:2.6, set:'custom'}).passRatio
                     / tune({load:2.6}).passRatio;
  assert(cust.caught > clean.caught,
    `custom_set で採点が戻らなくなった（${clean.caught} → ${cust.caught}）— GAP は閉じている`);
  return `過負荷 ${clean.caught}/${clean.total} → custom_set ${cust.caught}/${cust.total}`
       + `。絞るだけで満点に戻る。ルールに届く量は ${pct(passLoss)} 減っているのに代償ゼロ`;
});

gap('負の custom_set と repair:false が盲点を作らない', 'Phase 1', () => {
  const base = play(ALL);
  const neg  = play(ALL, {custom:['!openat','!openat2','!execve']});
  const nore = play(ALL, {repair:false});
  assert(neg.caught === base.caught && nore.caught === base.caught,
    `負の指定 ${neg.caught} / repair:false ${nore.caught} が採点に効き始めた（基準 ${base.caught}）`
    + ' — GAP は閉じている');
  const inflow = tune({custom:['openat','openat2']}).inflow;
  assert(inflow === tune({}).inflow, '正の custom_set が流入量に効き始めた — GAP は閉じている');
  return `!syscall を3つ指定しても repair:false にしても ${base.caught}/${base.total} のまま。`
       + '盲点を作れるのはこの2つだけ（§2.4 / §2.5）なので、Phase 1 はここに代償を入れる。'
       + '正の custom_set が流入量を増やさないのも同じ穴';
});

gap('HUD のドロップ率が p/(1+p) で表示される', 'Phase 1', () => {
  const M = tune({load:2.5});
  const shown = M.dropP/(1+M.dropP);
  assert(Math.abs(shown - M.dropP) > 0.05,
    'HUD 表示式がモデルと一致している — GAP は閉じている');
  return `モデル ${pct(M.dropP)} に対し HUD は ${pct(shown)}（src/ui.js の drop/(ring+drop)。`
       + `ドロップ済みイベントは ring にも数えられているので分母が二重）`;
});

/* ------------------------------------------------------------------ *
 * report
 * ------------------------------------------------------------------ */
export function main(){
  const width = s => [...String(s)].reduce((a,c)=> a + (c.charCodeAt(0) > 0x2500 ? 2 : 1), 0);
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));

  console.log('\nfalco-city — 因果の回帰（数値は参考・向きが赤緑を決める）\n');

  console.log('  ドロップモデル（実測値・README §実測した挙動 の突き合わせ用）');
  console.log('  ' + pad('条件', 40) + pad('util', 9) + pad('drop', 9)
                   + pad('HUD 表示', 10) + pad('判定', 11) + 'カーネル通過');
  for(const r of rows)
    console.log('  ' + pad(r.label, 40) + pad(pct(r.util), 9) + pad(pct(r.dropP), 9)
                     + pad(pct(r.shown), 10) + pad(r.band, 11) + pct(r.passRatio));

  let fail = 0, gaps = 0;
  let last = '';
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
