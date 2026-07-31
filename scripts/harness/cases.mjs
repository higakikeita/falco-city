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

import { S, GAME, TUNE_DEFAULTS, model, noise, hasCap, working } from '../../src/state.js';
import { updateVerdict } from '../../src/ui.js';
import { evaluate, CHAIN, RESPONSE, DEPS, BUILD_ORDER, OWNER, ROLES, blameOf,
         SCENARIOS, startScenario, activeChain, activeWaves, waveCount,
         goalStatus, passResults, runAttack, tickReveal, build, requestBuild,
         buildOrAsk, fixOrAsk, canUseLever, allowedDrivers,
         negatedSyscalls } from '../../src/campaign.js';
import { step, spawn, N } from '../../src/sim.js';
import { DISTRICTS } from '../../src/layout.js';
import { DEPLOYMENTS, ORCH, NODE_OSES, SOCKETS, K8S_METAS, DRIVERS,
         composeEnv, currentEnv } from '../../src/districts.data.js';
import { setDeploy, setEnv, setMode } from '../../src/controls.js';
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
               custom=[], repair=true, mode='oss', nodeCpus=8, nodes=null} = {}){
  S.load = load; S.dead = false; S.deadDrops = 0;
  S.driver = driver;
  /* the node the whole README 実測表 was measured on. Pinned rather than
     inherited: startScenario() writes S.cpus from the scenario's environment, so
     a 2-vCPU scenario would otherwise leak its node size into every later case */
  S.cpus = nodeCpus;
  S.tune = {...TUNE_DEFAULTS, syscallSet:set, bufPreset:buf,
            cpusPerBuf:cpus, slowOutput:slow, dropAction,
            syscallCustom:custom.slice(), syscallRepair:repair};
  /* STACK is pinned too: it moves the SOC's triage capacity (state.js §noise),
     so a scenario that handed over `sysdig` must not silently widen the queue
     for the cases that run after it */
  setMode(mode);
  setDeploy(deploy);
  /* AFTER setDeploy, for the reason startScenario() gives: applyEnv() derives the
     node count from the topology, and the estate size is the scenario's to say */
  if(nodes !== null) S.nodes = nodes;
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
const D_cpu6    = record('load ×2.5 + cpus_for_each_buffer 6', tune({load:2.5, cpus:6}));

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

check('cpus_for_each_buffer を上げる（バッファを減らす）と消費能力が上がる（§1.4）', () => {
  /* Docs の推奨と同じ向き: ドロップ対策は cpus_for_each_buffer を 4–6 に上げ、
     preset を 6–7 と組ませること。細かく割るほど単一のコンシューマが polling する
     対象が増えるので、バッファ数が減る方向に消費能力が上がる。
     この主張は 2026-07-31 に反転した（モデルを Docs に合わせた・INVARIANTS §1.4）。
     反転を見落とさないために、両方向に assert する。 */
  assert(D_cpu1.buffers > D_25.buffers, `cpus 1 でバッファが増えていない（${D_cpu1.buffers}）`);
  assert(D_cpu6.buffers < D_25.buffers, `cpus 6 でバッファが減っていない（${D_cpu6.buffers}）`);
  assert(D_cpu1.cap < D_25.cap, `cpus 1（${D_cpu1.buffers}本）で cap ${fmt(D_cpu1.cap)} ≥ 既定 ${fmt(D_25.cap)}`);
  assert(D_cpu1.dropP > D_25.dropP, 'cpus 1 でドロップが増えていない');
  assert(D_cpu6.cap > D_25.cap, `cpus 6（${D_cpu6.buffers}本）で cap ${fmt(D_cpu6.cap)} ≤ 既定 ${fmt(D_25.cap)}`);
  assert(D_cpu6.dropP < D_25.dropP, 'cpus 6 でドロップが減っていない');
  /* 単調でもあること: 途中に良くなる段があってはならない */
  let prev = -Infinity;
  for(let c=1; c<=8; c++){
    const M = tune({load:2.5, cpus:c});
    assert(M.cap >= prev - 1e-12, `cpus ${c} で cap が下がった`);
    prev = M.cap;
  }
  /* 入力側は動かない。これは消費能力だけの話 */
  assert(D_cpu1.inflow === D_25.inflow && D_cpu6.inflow === D_25.inflow, '入力が変わっている');
  return `cap ${fmt(D_cpu1.cap)}（1 → ${D_cpu1.buffers}本） < ${fmt(D_25.cap)}（既定 2 → ${D_25.buffers}本）`
       + ` < ${fmt(D_cpu6.cap)}（6 → ${D_cpu6.buffers}本）· drop ${pct(D_cpu1.dropP)} / ${pct(D_25.dropP)}`
       + ` / ${pct(D_cpu6.dropP)} · 1–8 で単調`;
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
  /* a scenario hands over districts that are standing and NOT working; that is
     its state, not this one's, so drop it or a case that runs after a scenario
     sees unmet conditions it never asked for */
  GAME.unmet = {};
  GAME.asks = 0;
  const out = evaluate();
  return {
    out,
    blames: out.map(blameOf),
    caught: out.filter(r=>r.caught).length,
    total: out.length,
    det: out.filter(r=>!r.response),
    missed: out.filter(r=>!r.caught),
    byId: id => out.find(r=>r.id === id),
    /* 見逃しの内訳。ドロップと埋没は同じ算術の別の段なので（state.js §noise）、
       「1段盗まれた」を数える主張は原因で数えないと互いに混ざる */
    by: cause => out.filter(r => r.cause === cause)
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

check('記法は区別して持たれている（プリセット / custom_set / repair）', () => {
  /* 3値のプリセットしか無ければ負の指定は書けない。
     TUNE_DEFAULTS が別フィールドで持っていることが、盲点の前提。 */
  assert('syscallSet' in TUNE_DEFAULTS, 'TUNE_DEFAULTS にプリセットが無い');
  assert('syscallCustom' in TUNE_DEFAULTS, 'TUNE_DEFAULTS に custom_set が無い');
  assert('syscallRepair' in TUNE_DEFAULTS, 'TUNE_DEFAULTS に repair が無い');
  assert(Array.isArray(TUNE_DEFAULTS.syscallCustom), 'custom_set が配列でない');
  assert(TUNE_DEFAULTS.syscallRepair === true, 'repair の既定が true でない');
  return 'syscallSet（プリセット）と syscallCustom / syscallRepair が別フィールド';
});

check('負の指定は盲点を作り、それはドロップとして計測されない（§2.4 / §2.7）', () => {
  /* 「集めていない syscall は計測できない」— 落ちていないので
     syscall_event_drops は1つも上がらず、HUD は最後まで健全に見える。 */
  const open = CHAIN.find(s => (s.needsSyscalls || []).includes('openat'));
  assert(open, 'openat 系を要求する段が無い');
  const neg = play(ALL, {set:'custom', custom:open.needsSyscalls.map(n => '!'+n)});
  const blind = neg.by('blind');
  assert(blind.length >= 1, `負の指定で盲点ができない（${neg.caught}/${neg.total}）`);
  assert(blind.some(r => r.id === open.id), `${open.id} が盲点になっていない`);
  assert(/負の指定/.test(plain(blind[0].why)), `理由が負の指定を名指ししていない`);
  /* ここが主張の核: 計測に出ない */
  const M = model();
  assert(M.dropP === 0 && M.util < 1,
    `盲点なのにドロップ ${pct(M.dropP)} / util ${pct(M.util)} が動いている`);
  assert(neg.by('drop').length === 0, 'ドロップ由来の見逃しが混ざっている');
  assert(neg.blames[neg.out.indexOf(blind[0])] === 'sre', '負の指定の帰属が SRE でない');
  /* 一部だけ無効にしても、ルールが要求する別の syscall が残れば鳴る */
  const partial = play(ALL, {set:'custom', custom:['!'+open.needsSyscalls[0]]});
  assert(partial.by('blind').length === 0,
    `${open.needsSyscalls[0]} だけを無効にして盲点になった`
    + `（ルールは ${open.needsSyscalls.join(' / ')} のどれでも鳴る）`);
  return `${open.needsSyscalls.map(n=>'!'+n).join(' ')} で ${blind.length} 段が盲点 `
       + `· ドロップ ${pct(M.dropP)} · util ${pct(M.util)}（健全に見える）`
       + ` · 1つだけ無効では盲点にならない`;
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
  /* 数えるのは「見逃しの総数」ではなく「ドロップ由来の見逃し」。過負荷はアラート量も
     動かすので（落ちた分は鳴らない → 逆に絞られる）、総数で数えると §9.1 の埋没と
     混ざる。ここの主張はリングバッファのぶんだけ。 */
  const clean = play(ALL);
  const over  = play(ALL, {load:2.6});
  assert(clean.by('drop').length === 0, '健全なノードでドロップ由来の見逃しが出た');
  assert(over.by('drop').length === 1,
    `ドロップ由来の見逃しが ${over.by('drop').length} 段（1パスにつき1段であること）`);
  assert(over.caught < clean.caught, `検知が減っていない（${over.caught}/${over.total}）`);
  const lost = over.by('drop')[0];
  assert(lost.needs.includes('ring'), 'ring を要求しない段が落ちた');
  assert(/ドロップ/.test(plain(lost.why)), `理由がドロップでない: ${plain(lost.why)}`);
  assert(over.blames[over.out.indexOf(lost)] === 'sre', 'ドロップ由来の見逃しが SRE に帰属していない');
  const other = over.missed.filter(r => r !== lost).map(r => r.cause);
  return `${clean.caught}/${clean.total} → ${over.caught}/${over.total} · util ${pct(model().util)}`
       + ` · ドロップ由来 1段` + (other.length ? ` ＋ ${other.join(' / ')} 由来 ${other.length}段（§9.1）` : '');
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
 * 3b. rule maturity — which detections you actually have by default
 *     INVARIANTS §4.1 / §4.3 / §4.4 / §4.5
 * ------------------------------------------------------------------ *
 * Two errors of this exact kind have already shipped, in OPPOSITE directions
 * (INVARIANTS 4.3): a sandbox rule modelled as bundled, and a stable rule
 * modelled as needing falcoctl. Neither is visible from inside the code — the
 * fact lives in falcosecurity/rules — so the maturity of every rule the chain
 * names is written down HERE, with the file it lives in, and the model is
 * checked against it. File and maturity are 1:1 in that repo:
 *
 *   rules/falco_rules.yaml             stable      25 rules   ← the release package
 *   rules/falco-incubating_rules.yaml  incubating  31 rules   ← separate OCI artifact
 *   rules/falco-sandbox_rules.yaml     sandbox     37 rules   ← separate OCI artifact
 *
 * which is what backs INVARIANTS 4.1 ("only the stable rules are loaded by
 * default"): it is not a flag, it is which file you fetched.
 *
 * `plugin` is not a maturity: the cloud step's rules come with the plugin's own
 * ruleset, so they need 07 プラグイン入力 rather than 09 ルール配布. */
const RULE_MATURITY = {
  'Terminal shell in container':                            'stable',
  'Read sensitive file untrusted':                          'stable',
  'Write below etc':                                        'sandbox',
  'Drop and execute new binary in container':               'stable',
  'Contact EC2 Instance Metadata Service From Container':   'incubating',
  'Contact K8S API Server From Container':                  'stable',
  'Console Login Without MFA / Delete Bucket Encryption':   'plugin'
};
/* Steps whose model is known to disagree with the table, with the lane that owns
   the fix. Anything NOT listed here is asserted. Empty is the goal. */
/* Empty: cron's maturity and its falcoctl requirement agree since PR #33
   (Write below etc = maturity_sandbox, so it needs 09). Every chain rule's
   maturity is asserted by the check below rather than waived here. */
const MATURITY_PENDING = {};

G('ルールの成熟度 (§4)');

check('チェーンの各段のルールは成熟度が分かっている', () => {
  const unknown = CHAIN.filter(s => !RULE_MATURITY[s.rule]);
  assert(unknown.length === 0,
    `成熟度が未登録のルールがある: ${unknown.map(s=>`${s.id} (${s.rule})`).join(' / ')}`
    + '。falcosecurity/rules のどのファイルに居るかを調べて '
    + 'scripts/harness/cases.mjs の RULE_MATURITY に足すこと（stable / incubating / '
    + 'sandbox / plugin）。ここを空欄のまま増やせると、同梱されないルールを'
    + '「既定で鳴る」と書く事故（INVARIANTS 4.3）がまた通る');
  const n = c => CHAIN.filter(s => RULE_MATURITY[s.rule] === c).length;
  return `${CHAIN.length} 段 — stable ${n('stable')} / incubating ${n('incubating')}`
       + ` / sandbox ${n('sandbox')} / plugin 由来 ${n('plugin')}`;
});

check('同梱されないルールだけが 09 ルール配布を要求する（§4.1 / §4.4）', () => {
  const wrong = [];
  for(const s of CHAIN){
    if(MATURITY_PENDING[s.id]) continue;
    const m = RULE_MATURITY[s.rule];
    const gated = s.needs.includes('falcoctl');
    if(m === 'stable' && gated)
      wrong.push(`${s.id}: ${s.rule} は stable（同梱）なのに falcoctl を要求している`);
    if((m === 'incubating' || m === 'sandbox') && !gated)
      wrong.push(`${s.id}: ${s.rule} は ${m}（同梱なし）なのに falcoctl を要求していない`);
    if(m === 'plugin'){
      if(gated) wrong.push(`${s.id}: プラグインのルールセットに falcoctl を要求している`);
      if(!s.needs.includes('plugins'))
        wrong.push(`${s.id}: プラグイン由来なのに 07 プラグイン入力を要求していない`);
    }
  }
  assert(wrong.length === 0, wrong.join(' / '));
  const gated = CHAIN.filter(s => s.needs.includes('falcoctl'));
  return `falcoctl を要求するのは ${gated.length} 段（`
       + gated.map(s=>`${s.id}=${RULE_MATURITY[s.rule]}`).join(' / ') + `）· 保留 `
       + `${Object.keys(MATURITY_PENDING).length} 段`;
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
  /* 独立とは「capability 由来の見逃しが負荷で増えも減りもしない」こと。
     総数の差で書くと、同時に動くもう1つの queue（§9.1）に引きずられる */
  assert(both.by('cap').length === host.by('cap').length,
    `capability 由来の見逃しが ${host.by('cap').length} → ${both.by('cap').length}`);
  assert(host.by('drop').length === 0, 'load ×1.0 の standalone でドロップした');
  assert(both.by('drop').length === 1, `ドロップ由来が ${both.by('drop').length} 段`);
  assert(both.by('cap').every(r => !/ドロップ/.test(plain(r.why))),
    'capability 由来の見逃しの理由がドロップの話になっている');
  return `standalone ${host.caught}/${host.total}（cap 由来 ${host.by('cap').length}段）`
       + ` → standalone+過負荷 ${both.caught}/${both.total}（cap 由来 ${both.by('cap').length}段 ＋ drop 1段）`;
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

/* Walk a whole pass, wave by wave.
   ------------------------------------------------------------------
   `runAttack()` means "let the next wave come" (campaign.js §the wave machine),
   so one call resolves ONE wave and leaves the game in `between`, which is a
   turn and not an end. A play-through has to keep going until `over`:

     - goalStatus() returns null until the pass is over, by design
     - detections accumulate across the waves of one pass, so scoring after the
       first wave scores a fraction of the attack
     - GAME.budget is per PASS, so what overload steals is counted once here

   Calling this with the pass already over would start a second one and put
   GAME.runs up, which is what goal.maxRuns counts — so it asserts instead. */
function walkPass(){
  assert(GAME.phase !== 'over', 'パスが終わった状態で walkPass() を呼んだ（runs が増える）');
  for(let guard=0; guard<64; guard++){
    if(GAME.phase === 'over') return;
    assert(runAttack(),
      `波が進まなかった（phase ${GAME.phase} · wave ${GAME.wave+1}/${waveCount()}）`);
    revealAll();
    assert(GAME.phase !== 'running',
      `波 ${GAME.wave} が解決しきらなかった（reveal ${GAME.reveal}/${GAME.results.length}）`);
  }
  throw new Error(`パスが ${waveCount()} 波で終わらない（phase ${GAME.phase}）`);
}

/* What this scenario needs standing: the districts every achievable step
   requires, plus containment if the goal asks for it, closed over dependencies.
   NOT everything — building 08 Sysdig when the goal does not ask for
   containment costs an ask the SRE cannot afford (`slow-output` allows zero),
   and a play-through that overspends the ask budget is not a play-through. */
function neededBuilds(sc){
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
  return want;
}

/* Do the build work and nothing else: build what is needed, and satisfy the
   conditions this situation left unsatisfied on districts that are standing.
   Uses the real moves (buildOrAsk / fixOrAsk), so ownership and the ask count
   come out the way they would for a player, and `between` is exercised the way
   a player would exercise it. */
function buildWork(sc){
  const want = neededBuilds(sc);
  for(const id of BUILD_ORDER)
    if(want.has(id) && !GAME.built.has(id)) buildOrAsk(id);
  for(const [id, reqs] of Object.entries(GAME.unmet))
    if(GAME.built.has(id))
      for(const req of reqs.slice()) fixOrAsk(id, req);
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
    /* a negative entry deactivates a syscall the enabled rules ask for
       (INVARIANTS 2.4), and nothing downstream can win that back — no amount of
       building makes an event that was never collected exist */
    if(negatedSyscalls().length) S.tune.syscallCustom = [];
    /* Still over capacity with the obvious things put back? Then the remaining
       lever is the input side (INVARIANTS 2.2) — which is the answer on a node
       too small for the consumer knob to have anywhere to go. Skipped when the
       scenario declares goal.minPassRatio, because that is a scenario saying in
       so many words that narrowing is NOT its answer. */
    if(model().util > 1 && sc.goal.minPassRatio === null) S.tune.syscallSet = 'custom';
  }

  buildWork(sc);

  assert(goalStatus() === null, `${sc.id}: 走る前から判定が出ている`);
  walkPass();
  const st = goalStatus();
  assert(st, `${sc.id}: パスが終わったのに判定が出ない（phase ${GAME.phase}）`);
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
    lines.push(`${sc.id}: ${detail}（${GAME.waveLog.length}波 · ${GAME.runs}パス）`);
    assert(st.cleared, `${sc.id} がクリアできない — ${detail}`
      + `（役割 ${GAME.role ?? '全役'} · 依頼 ${GAME.asks} · ${GAME.waveLog.length}波`
      + ` · ${GAME.runs}パス目）`);
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
 * 6a. lever exclusivity — SHIP GATE G4
 * ------------------------------------------------------------------ *
 * "Every registered scenario is clearable" (above) only checks one direction.
 * A scenario that can ALSO be cleared by a lever with nothing to do with its
 * symptom teaches nothing: the player turns knobs, the goal goes green, and the
 * misdiagnosis the file exists to walk them into never happens. Playtesting
 * found `slow-output` clears with `base_syscalls: custom` and with NODE LOAD
 * ×0.5 while `slowOutput` is still true — the exact opposite of its claim.
 *
 * So the other direction gets pinned too: for each scenario, every single move
 * the player could make is tried, and CLEARING is only allowed for moves the
 * scenario declares as its answer.
 *
 * Three things make this cheap to keep true as content grows:
 *
 *   - permission comes from the game. A move is only tried when
 *     canUseLever(group) says the player holds it, so `goal.lockLoad` and a
 *     locked role remove moves from the test automatically — closing a loophole
 *     in the CONTENT closes it here with no edit
 *   - the answer is read from the scenario if it declares one (`insight.lever`),
 *     and from the table below if it does not. A scenario nobody has classified
 *     fails with instructions rather than passing quietly
 *   - building what is missing is always legitimate, so it is never a violation.
 *     What is a violation is a scenario whose declared cause turns out not to
 *     matter: if the answer includes a lever, then building everything and
 *     touching nothing must NOT clear it
 */
G('レバー排他性 — 意図したレバー以外でクリアできない (GATE G4)');

/* Which lever each scenario's answer actually is, by TUNE key (or `load` /
   `stack` / `driver`). An empty list means "the answer is to build what is
   missing" — including 08 Sysdig, because build('sysdig') flips STACK itself.
   The permanent home for this is the scenario file (BOARD §2: `insight.lever`
   in scenarios/schema.js, owned by the rules lane); until it exists this table
   is the register, and it is read only as a fallback. */
const INTENDED_LEVER = {
  'greenfield':              [],                 /* 依存順に建てる */
  'inherited-all-syscalls':  ['syscallSet'],     /* 引き継いだ all を戻す */
  'slow-output':             ['slowOutput'],     /* 出力を非同期にする */
  'standalone-k8s-rules':    [],                 /* 建てる／依頼する。環境は動かせない */
  'eyes-but-no-hands':       [],                 /* 08 を建てる（STACK は build が倒す）*/
  'a-different-source':      [],                 /* 07 プラグイン入力を建てる */
  /* 未登録の3本。登録された瞬間にこの検査の対象になる（INVARIANTS §8）*/
  /* 負の指定を外す。プリセットを default に戻すのも同じ手 — 負の指定は
     base_syscalls を手書きしている間だけ効く（campaign.js §negatedSyscalls）ので、
     「custom_set をやめる」と「!entry を消す」は falco.yaml では同じ操作 */
  'silent-blind-spot':       ['syscallCustom','syscallSet'],
  /* 2 vCPU ではバッファ本数が既に下限の1本で、cpus_for_each_buffer を上げても
     ceil(2/4) は 1 のまま = レバーが死んでいる。生きているのは入力側だけ。
     「既定に戻す」ではなく「一度も間違っていなかった既定を絞る」が答えなので、
     正解のレバーは逸脱の有無では決まらない */
  'nodes-are-not-buffers':   ['syscallSet'],
  'rules-not-followed':      []                  /* 09 ルール配布を建てる */
};
const intendedOf = sc => Array.isArray(sc.insight && sc.insight.lever)
  ? sc.insight.lever : INTENDED_LEVER[sc.id];

/* Single moves, as a player makes them. Every one of these is a real widget:
   TUNING rows, NODE LOAD, STACK, DRIVER. */
const MOVES = [
  {key:'syscallSet',   group:'tuning', jp:'base_syscalls=custom（絞る）', run(){ S.tune.syscallSet='custom'; }},
  {key:'syscallSet',   group:'tuning', jp:'base_syscalls=default',        run(){ S.tune.syscallSet='default'; }},
  {key:'syscallSet',   group:'tuning', jp:'base_syscalls=all（広げる）',  run(){ S.tune.syscallSet='all'; }},
  {key:'syscallCustom',group:'tuning', jp:'custom_set を空にする',        run(){ S.tune.syscallCustom=[]; }},
  {key:'bufPreset',    group:'tuning', jp:'buf_size_preset=10',           run(){ S.tune.bufPreset=10; }},
  {key:'cpusPerBuf',   group:'tuning', jp:'cpus_for_each_buffer=6',       run(){ S.tune.cpusPerBuf=6; }},
  {key:'cpusPerBuf',   group:'tuning', jp:'cpus_for_each_buffer=1',       run(){ S.tune.cpusPerBuf=1; }},
  {key:'slowOutput',   group:'tuning', jp:'出力を非同期にする',            run(){ S.tune.slowOutput=false; }},
  {key:'dropAction',   group:'tuning', jp:'syscall_event_drops=ignore',   run(){ S.tune.dropAction='ignore'; }},
  {key:'syscallRepair',group:'tuning', jp:'repair=false',                 run(){ S.tune.syscallRepair=false; }},
  {key:'load',         group:'load',   jp:'NODE LOAD ×0.5',               run(){ S.load=Math.max(0.1, S.load*0.5); }},
  {key:'load',         group:'load',   jp:'NODE LOAD 最小',               run(){ S.load=0.1; }},
  {key:'stack',        group:'stack',  jp:'STACK=sysdig',                 run(){ setMode('sysdig'); }},
  {key:'driver',       group:'driver', jp:'DRIVER=modern_ebpf',           run(){ S.driver='modern_ebpf'; },
   ok:() => allowedDrivers().includes('modern_ebpf')},
  {key:'driver',       group:'driver', jp:'DRIVER=kmod',                  run(){ S.driver='kmod'; },
   ok:() => allowedDrivers().includes('kmod')}
];

/* one attempt: enter the scenario, optionally do the build work, optionally make
   one move, then walk the pass. null = that move is not available to this
   player, which is not a loophole. */
function attempt(sc, {build:doBuild = false, move = null} = {}){
  assert(startScenario(sc.id), `${sc.id}: 起動できない`);
  if(doBuild) buildWork(sc);
  if(move){
    if(!canUseLever(move.group)) return null;
    if(move.ok && !move.ok()) return null;
    move.run();
  }
  walkPass();
  const st = goalStatus();
  return !!(st && st.cleared);
}

/* Known violations, with the lane that owns the fix. Everything NOT listed here
   is asserted; the gap() below fails as soon as a listed one is fixed, so the
   list can only shrink. */
/* Empty, and it is meant to stay that way: G4 now asserts every registered
   scenario. Both entries were closed by declaring the locks the schema already
   had — slow-output got goal.lockLoad + goal.minPassRatio:40 (40% keeps
   `default` at 42% and refuses custom_set at 17%), inherited-all-syscalls got
   goal.lockLoad alone because narrowing IS the answer there. BOARD #10 / #36. */
const LEVER_PENDING = {};

/* every scenario has to be classified, or this check is quietly not running */
check('シナリオの「正解のレバー」が全部宣言されている', () => {
  const missing = SCENARIOS.filter(sc => intendedOf(sc) === undefined);
  assert(missing.length === 0,
    `正解のレバーが未宣言: ${missing.map(s=>s.id).join(' / ')}`
    + '。scenarios/schema.js に insight.lever が入るまでは '
    + 'scripts/harness/cases.mjs の INTENDED_LEVER に足すこと（建てるだけが答えなら空配列）。'
    + 'これが空欄のまま増やせると G4 は新しいシナリオを検査しない');
  const byLever = SCENARIOS.filter(sc => intendedOf(sc).length);
  return `${SCENARIOS.length} 本すべて宣言済み — レバーが答えなのは ${byLever.length} 本`
       + `（${byLever.map(s=>`${s.id}: ${intendedOf(s).join('+')}`).join(' · ')}）·`
       + ` 残りは建てるのが答え`;
});

check('意図したレバー以外ではクリアできない（G4）', () => {
  const violations = [], lines = [];
  for(const sc of SCENARIOS){
    const intended = intendedOf(sc);
    const tried = [], clears = [];
    /* 手を打たずに、あるいは建てるだけでクリアできてはならない
       —— レバーが答えのシナリオに限る（建てるのが答えなら建てて当然クリアする）*/
    if(intended.length){
      const buildOnly = attempt(sc, {build:true});
      if(buildOnly) violations.push(`${sc.id}: 建てるだけでクリアできる`
        + `（宣言された原因 ${intended.join('+')} が採点に効いていない）`);
    }
    for(const m of MOVES){
      if(intended.includes(m.key)) continue;         /* 正解のレバーは対象外 */
      /* 2通り試す: 引き継いだ状態からその1手だけ、と、建てた上でその1手だけ。
         後者は「建てる必要もあるシナリオ」で抜け道が隠れるのを防ぐ */
      for(const build of intended.length ? [false, true] : [false]){
        const got = attempt(sc, {build, move:m});
        if(got === null) continue;                   /* この役割には無い手 */
        tried.push(m.jp);
        if(got) clears.push(`${m.jp}${build ? '（建てた上で）' : ''}`);
      }
    }
    if(clears.length){
      const known = LEVER_PENDING[sc.id];
      const line = `${sc.id}: ${[...new Set(clears)].join(' / ')} でクリアできる`
                 + `（正解は ${intended.length ? intended.join('+') : '建てること'}）`;
      if(known) lines.push(`保留 ${line}`);
      else violations.push(line);
    } else {
      lines.push(`${sc.id}: ${new Set(tried).size} 手すべて不成立（正解 `
               + `${intended.length ? intended.join('+') : '建てること'}）`);
    }
  }
  assert(violations.length === 0, violations.join(' ／ '));
  return `${SCENARIOS.length} 本 · ${MOVES.length} 手\n         ` + lines.join('\n         ');
});

check('正解のレバーでは実際にクリアできる', () => {
  /* 同じ MOVES から引く。「宣言された逸脱を既定に戻す」ではないのが要点で、
     nodes-are-not-buffers の答えは *一度も間違っていなかった既定を絞ること* —
     逸脱を戻す形の答えしか書けない検査は、その手のシナリオを不当に赤にする。 */
  const lines = [];
  for(const sc of SCENARIOS){
    const intended = intendedOf(sc);
    if(!intended.length) continue;                  /* 建てるだけが答え = G3 が見ている */
    const candidates = MOVES.filter(m => intended.includes(m.key));
    assert(candidates.length > 0,
      `${sc.id}: 正解として宣言された ${intended.join('+')} に対応する手が MOVES に無い`
      + ' — 手を足すか、宣言を直すこと');
    const wins = candidates.filter(m => attempt(sc, {build:true, move:m}) === true);
    assert(wins.length > 0,
      `${sc.id}: 正解のレバー（${intended.join('+')}）を動かしてもクリアできない — `
      + candidates.map(m => m.jp).join(' / ') + ' を全部試して不成立。'
      + 'シナリオがクリア不能か、正解の宣言が間違っている');
    lines.push(`${sc.id}: ${wins.map(m=>m.jp).join(' / ')} → クリア`);
  }
  return lines.join(' · ') || '（レバーが答えのシナリオが無い）';
});

/* ------------------------------------------------------------------ *
 * 6b. noise — the second queue, and why over-detection loses too
 *     INVARIANTS §9
 * ------------------------------------------------------------------ *
 * The ring buffer is not the only queue: alerts land in a human one, and it has
 * a rate too. Same expression as `sustained`, one stage later, and deliberately
 * no burst term — a SOC has no buf_size_preset. The point of the whole mechanism
 * is that "build everything and let everything ring" stops being the optimum, so
 * what has to be pinned is that BOTH directions lose.
 *
 * An estate of 9 nodes at ×1.0 on the default set floods the queue while the
 * kernel side stays completely healthy (drops 0.000%), which is what makes it a
 * clean isolation: nothing here is an overload of the ring buffer. */
G('ノイズ — 過検知でも負ける (§9)');

const FLOOD = {nodes:9, load:1.0};
const nzOf = (built, opts) => { const r = play(built, opts); return {r, Nz:noise(), M:model()}; };

check('アラートが処理能力を超えると本物が埋もれる（ドロップ 0 でも負ける・§9.1）', () => {
  const {r, Nz, M} = nzOf(ALL, FLOOD);
  assert(M.dropP === 0, `リングバッファ側でも落ちている（drop ${pct(M.dropP)}）— 分離できていない`);
  assert(Nz.util > 1, `queue utilisation ${pct(Nz.util)}`);
  assert(Nz.buriedP > 0.05, `埋没率 ${pct(Nz.buriedP)}`);
  assert(r.by('drop').length === 0, 'ドロップ由来の見逃しが混ざっている');
  assert(r.by('noise').length === 1, `埋没由来の見逃しが ${r.by('noise').length} 段（1段であること）`);
  const lost = r.by('noise')[0];
  assert(lost.needs.includes('outputs'), '出力チャネルを要求しない段が埋もれた');
  assert(/埋も/.test(plain(lost.why)), `理由が埋没の話でない: ${plain(lost.why).slice(0,40)}`);
  assert(r.caught === r.total - 1,
    `全段建てて過負荷も無いのに ${r.total - r.caught} 段落ちている（${r.caught}/${r.total}）`);
  return `${S.nodes}ノード・全建設・drop ${pct(M.dropP)} で ${r.caught}/${r.total} — `
       + `アラート ${Nz.inflow.toFixed(1)} 件/分 vs 処理能力 ${Nz.cap.toFixed(0)}`
       + `（queue ${pct(Nz.util)} · 埋没 ${pct(Nz.buriedP)}）`;
});

check('埋没は 1 - 処理能力/流入。バースト項が無い（§9.2）', () => {
  /* 解析解そのもの。ドロップ側と同じ式を1段後ろに置いたもの（§1.2） */
  for(const o of [FLOOD, {...FLOOD, load:1.5}, {...FLOOD, nodes:20},
                  {nodes:3, set:'all'}, {...FLOOD, mode:'sysdig'}]){
    const {Nz} = nzOf(ALL, o);
    eq(Nz.buriedP, Math.max(0, 1 - 1/Nz.util), 1e-12, `解析解との一致 (${JSON.stringify(o)})`);
  }
  /* SOC に buf_size_preset は無い: 10 段動かしても埋没は動かない */
  const base = nzOf(ALL, {...FLOOD, buf:1}).Nz.buriedP;
  for(let b=1; b<=10; b++){
    const {Nz} = nzOf(ALL, {...FLOOD, buf:b});
    eq(Nz.buriedP, base, 0, `buf ${b} の埋没率`);
  }
  return `5条件で解析解と一致 · buf 1–10 すべて 埋没 ${pct(base)}（手は「入力を減らす」か「能力を上げる」の2つだけ）`;
});

check('入力を絞ると埋没が止まる（検知は落ちない・§9.3 / §2.1）', () => {
  const flood  = nzOf(ALL, FLOOD);
  const narrow = nzOf(ALL, {...FLOOD, set:'custom'});
  assert(narrow.Nz.inflow < flood.Nz.inflow, '流入が減っていない');
  assert(narrow.Nz.util < 1, `queue utilisation ${pct(narrow.Nz.util)}`);
  assert(narrow.Nz.buriedP === 0, `埋没 ${pct(narrow.Nz.buriedP)}`);
  assert(narrow.r.by('noise').length === 0, '絞っても埋もれている');
  /* 正の指定はカバレッジを奪わない（§2.1）ので、埋没が止まった分だけ満点に戻る */
  assert(narrow.r.caught === narrow.r.total, `${narrow.r.caught}/${narrow.r.total}`);
  return `アラート ${flood.Nz.inflow.toFixed(1)} → ${narrow.Nz.inflow.toFixed(1)} 件/分`
       + `（queue ${pct(flood.Nz.util)} → ${pct(narrow.Nz.util)}）· `
       + `${flood.r.caught}/${flood.r.total} → ${narrow.r.caught}/${narrow.r.total}`;
});

check('08 Sysdig は処理能力を上げるが検知は増やさない（§9.4 / §5.2）', () => {
  /* 相関で足りる規模。08 は両方で建っていて、違うのは STACK だけ —
     「建てただけでは効かない」がこの主張の後半 */
  const EST    = {nodes:8, load:1.0};
  const oss    = nzOf(ALL, EST);
  const sysdig = nzOf(ALL, {...EST, mode:'sysdig'});
  assert(oss.Nz.corr === false, 'STACK=oss で相関が効いている');
  assert(sysdig.Nz.corr === true, '08 が建っていて STACK=sysdig なのに相関が効かない');
  assert(sysdig.Nz.cap > oss.Nz.cap, `処理能力 ${fmt(oss.Nz.cap)} → ${fmt(sysdig.Nz.cap)}`);
  assert(sysdig.Nz.inflow === oss.Nz.inflow, 'アラートの量が変わっている — 相関は流入を減らさない');
  assert(sysdig.Nz.util < 1 && sysdig.r.by('noise').length === 0,
    `queue ${pct(sysdig.Nz.util)} · 埋没由来 ${sysdig.r.by('noise').length} 段`);
  /* 検知そのものは1段も増えていない（§5.2）。増えたのは受け取れる量だけ */
  const det = x => x.r.det.filter(s => s.caught && s.cause === null).length;
  assert(CHAIN.every(s => !s.needs.includes('sysdig')), 'CHAIN の段が sysdig を要求している');
  assert(det(sysdig) === det(oss) + 1,
    `埋もれていた1段が戻る以外の変化がある（${det(oss)} → ${det(sysdig)}）`);
  /* 建っているだけでは足りない、が §9.4 の後半 */
  assert(oss.r.by('noise').length === 1, 'STACK=oss なのに埋没が止まっている');
  /* そして相関は倍率であって免罪符ではない: 資産が大きくなれば相関しても足りない */
  const BIG = {nodes:12, load:1.0};
  const big = nzOf(ALL, {...BIG, mode:'sysdig'});
  assert(big.Nz.util > 1 && big.r.by('noise').length === 1,
    `${BIG.nodes}ノードでも相関だけで足りてしまう（queue ${pct(big.Nz.util)}）`
    + ' — 処理能力が有限であることが模型から消えている');
  return `${EST.nodes}ノード: 処理能力 ${fmt(oss.Nz.cap)} → ${fmt(sysdig.Nz.cap)} 件/分（相関 ×2.1）· `
       + `${oss.r.caught}/${oss.r.total}（STACK=oss）→ ${sysdig.r.caught}/${sysdig.r.total}`
       + ` · ただし ${BIG.nodes}ノードでは相関しても queue ${pct(big.Nz.util)} で足りない`;
});

check('過負荷なノードは静かなノード（ドロップは埋没を減らす・§9.5）', () => {
  /* slow output は syscall の入力量を変えずにドロップだけ作る（§1.5）ので、
     アラート側の差はまるごと「落ちたものは鳴らない」の効果 */
  const clean = nzOf(ALL, FLOOD);
  const slow  = nzOf(ALL, {...FLOOD, slow:true});
  assert(slow.M.inflow === clean.M.inflow, 'syscall の入力が変わっている');
  assert(slow.M.dropP > 0 && clean.M.dropP === 0, `drop ${pct(clean.M.dropP)} → ${pct(slow.M.dropP)}`);
  assert(slow.Nz.inflow < clean.Nz.inflow, 'ドロップしてもアラート量が減っていない');
  eq(slow.Nz.inflow, clean.Nz.inflow * (1 - slow.M.dropP), 1e-9, '落ちた分だけ鳴らない');
  return `drop ${pct(slow.M.dropP)} で アラート ${clean.Nz.inflow.toFixed(1)} → `
       + `${slow.Nz.inflow.toFixed(1)} 件/分（正直で、最悪）`;
});

check('埋没の帰属は入力を増やした側に付く（§9.6）', () => {
  /* 誰の判断が溢れさせたか。3つに分かれ、どれも算術から導出される（noiseBlame） */
  const seen = new Map();
  const at = (label, opts) => {
    const {r, Nz} = nzOf(ALL, opts);
    const noiseMiss = r.by('noise')[0];
    if(!noiseMiss) return null;
    const b = r.blames[r.out.indexOf(noiseMiss)];
    if(!seen.has(b)) seen.set(b, `${b}: ${label}`);
    return {b, Nz};
  };
  /* base_syscalls を既定より広げた = SRE が増やした分だけが超過の原因 */
  const sre = at('base_syscalls: all（3ノード）', {nodes:3, set:'all'});
  assert(sre && sre.b === 'sre', `既定より広げた場合の帰属が ${sre ? sre.b : 'なし'}`);
  assert(sre.Nz.inflow - sre.Nz.parts.breadth <= sre.Nz.cap,
    '広げた分を戻しても能力を超えている — この条件は SRE のものではない');
  /* ルールを増やした側（09 / 07）が超えさせた */
  const det = at('6ノード・falcoctl ＋ plugins', {nodes:6});
  assert(det && det.b === 'detect', `ルールを増やした場合の帰属が ${det ? det.b : 'なし'}`);
  assert(det.Nz.parts.base <= det.Nz.cap, 'ベースだけで能力を超えている条件を detect に帰属させた');
  /* 資産の規模そのものが能力を超えている = 買っていない能力の話 */
  const soc = at('9ノード（ベースだけで超過）', FLOOD);
  assert(soc && soc.b === 'soc', `規模が原因の場合の帰属が ${soc ? soc.b : 'なし'}`);
  assert(soc.Nz.parts.base > soc.Nz.cap, 'ベースだけでは超えていないのに soc に帰属した');
  return [...seen.values()].join(' · ');
});

/* ------------------------------------------------------------------ *
 * 6c. waves — the gap between two waves is a real turn
 *     INVARIANTS §9.7 / §9.8（旧 GAP 6.5）
 * ------------------------------------------------------------------ */
G('ウェーブ (§9)');

/* the scenarios that actually declare more than one wave */
const multiWave = SCENARIOS.filter(s => startScenario(s.id) && waveCount() > 1);

check('波は境界で止まり、間に打った手が次の波に効く（旧 GAP 6.5）', () => {
  assert(multiWave.length > 0, '2波以上を宣言しているシナリオが1本も無い');
  const sc = multiWave[0];
  assert(startScenario(sc.id), `${sc.id}: 起動できない`);
  const waves = waveCount();

  /* 何も足さずに1波目を迎える */
  assert(runAttack(), '1波目が来ない');
  revealAll();
  assert(GAME.phase === 'between', `1波目のあと phase が ${GAME.phase}（between のはず）`);
  assert(GAME.wave === 0, `wave ${GAME.wave}`);
  const w1 = GAME.waveLog[0];
  const before = w1.results.map(r => `${r.id}:${r.caught}`).join(' ');
  assert(w1.hit < w1.of, `手を打つ前から1波目を全段止めた（${w1.hit}/${w1.of}）`);
  assert(goalStatus() === null, 'パスが終わる前に判定が出た');

  /* between が手番。ここで打った手は次の波に効くが、失った波は戻らない */
  const runsBefore = GAME.runs;
  buildWork(sc);
  assert(GAME.phase === 'between', `手を打ったら phase が ${GAME.phase} に戻った`);
  assert(GAME.waveLog.length === 1, '手を打ったら解決済みの波が消えた');
  assert(GAME.waveLog[0].results.map(r => `${r.id}:${r.caught}`).join() === before.split(' ').join(),
    '1波目の結果が書き換わった — 失った波が戻っている');

  walkPass();
  assert(GAME.runs === runsBefore, `波を進めただけで runs が ${runsBefore} → ${GAME.runs}`);
  assert(GAME.waveLog.length === waves, `${waves} 波のうち ${GAME.waveLog.length} 波しか解決していない`);
  const w2 = GAME.waveLog[1];
  assert(w2.hit > w1.hit || w2.of !== w1.of,
    `2波目が1波目と同じ結果（${w2.hit}/${w2.of}）— between で打った手が効いていない`);
  assert(goalStatus(), 'パスが終わったのに判定が出ない');
  return `${sc.id}: ${waves}波 · 1波目 ${w1.hit}/${w1.of}（空き地）→ 間に建てる → `
       + `2波目 ${w2.hit}/${w2.of} · 1パスのまま（runs ${GAME.runs}）`;
});

check('判定はパスが終わるまで出ない（§9.8）', () => {
  const sc = multiWave[0];
  assert(startScenario(sc.id), `${sc.id}: 起動できない`);
  buildWork(sc);
  assert(goalStatus() === null, `build 中に判定が出た（phase ${GAME.phase}）`);
  const seen = [];
  for(let i=0; i<waveCount(); i++){
    runAttack();
    seen.push(`${GAME.phase}:${goalStatus() ? '判定' : 'なし'}`);
    assert(goalStatus() === null, `波の途中で判定が出た（phase ${GAME.phase}）`);
    revealAll();
    const last = i === waveCount() - 1;
    assert(!!goalStatus() === last,
      `${i+1}波目のあと phase ${GAME.phase} で判定が ${goalStatus() ? '出た' : '出ない'}`);
  }
  assert(GAME.phase === 'over', `全波のあと phase が ${GAME.phase}`);
  return `${sc.id}: ${seen.join(' → ')} → over:判定（採点は「来たもの全部」に対して1回）`;
});

check('ドロップの予算はパス単位（波ごとには盗まれない・§9.9）', () => {
  const sc = multiWave[0];
  assert(startScenario(sc.id), `${sc.id}: 起動できない`);
  buildWork(sc);
  /* 過負荷にする。レバーではなく状況として置くので S.load を直接動かす
     （lockLoad なシナリオでも「そういう estate だった」は表現できる） */
  S.load = 3.0;
  const M = model();
  assert(M.util > 1 && M.dropP > 0.05,
    `この構成では過負荷にならない（util ${pct(M.util)} · drop ${pct(M.dropP)}）`);
  const ringWaves = activeWaves()
    .filter(w => w.steps.some(s => s.needs.includes('ring'))).length;
  assert(ringWaves >= 2,
    `ring を要求する段を含む波が ${ringWaves} 本しかない — 「波ごとではない」を主張できない`);
  walkPass();
  const all = passResults();
  const stolen = all.filter(r => r.cause === 'drop');
  assert(stolen.length === 1,
    `${waveCount()} 波のパス全体でドロップ由来の見逃しが ${stolen.length} 段`
    + `（波ごとに盗まれると ${ringWaves} 段になる）`);
  assert(GAME.waveLog.length === waveCount(), '全波が解決していない');
  return `${sc.id}: ${waveCount()}波（うち ring を通る波 ${ringWaves} 本）· `
       + `util ${pct(M.util)} · ドロップ由来の見逃しはパス全体で 1段`;
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

gap('custom_set の中身が流入量に効かない（プリセット名しか読まない）', 'Phase 1', () => {
  const base = tune({}).inflow;
  assert(tune({set:'custom', custom:['openat','openat2']}).inflow
       === tune({set:'custom', custom:['openat','openat2','execve','connect','ptrace']}).inflow,
    'custom_set の要素数が流入量に効き始めた — GAP は閉じている');
  return `SET_MUL はプリセット名（all / default / custom）だけを読むので、`
       + `custom_set に何個並べても流入量は同じ（既定 ${fmt(base)}）。`
       + '負の指定は採点に効く（§2.4・回帰済み）が、量には効かない';
});

gap('repair:false に代償が無い（意図的・§2.5）', 'Phase 1', () => {
  const base = play(ALL);
  const nore = play(ALL, {repair:false});
  assert(nore.caught === base.caught,
    `repair:false が採点に効き始めた（${base.caught} → ${nore.caught}）— GAP は閉じている`);
  return `repair:false でも ${base.caught}/${base.total} のまま。`
       + '§2.5 のとおり repair が戻すのは状態エンジンの整合性だけなので、'
       + '検知の枚数として表現するものではない — 現時点では意図的に未採点。'
       + '入れるなら §2.6（プロセスキャッシュの GC 失敗・ログの欠損）として';
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
