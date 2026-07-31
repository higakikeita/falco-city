/* CAMPAIGN — rules and state for building the pipeline from an empty plot.
 *
 * This module holds no DOM: no element lookups, no rendering, no ui.js import.
 * Enforced by scripts/check-imports.mjs. It owns what is true about the game;
 * ui.js decides
 * how that looks. Changes are announced through onCampaignChange so the two
 * sides can be worked on independently.
 *
 * The teaching is structural: every stage exists because without it the
 * previous stage is useless. Rather than explaining that, the game runs an
 * attack chain against whatever you actually built, and the steps you cannot
 * possibly catch stay uncaught.
 */
import { DISTRICTS, byId, isFlow, setCampaignView } from './layout.js';
import { S, GAME, model } from './state.js';
import { districtObjs } from './city.js';
import { polPoints } from './sim.js';
import { setMode, applyShield } from './controls.js';

/* ---------------------------------------------------------------- build graph */
const DEPS = {
  workloads:[], driver:['workloads'], ring:['driver'], state:['ring'],
  rules:['state'], outputs:['rules'], plugins:['rules'],
  falcoctl:['rules'], sysdig:['outputs']
};
const BUILD_ORDER = ['driver','ring','state','rules','outputs','plugins','falcoctl','sysdig'];

/* what each stage buys you, said in terms of what was impossible before */
const UNLOCK = {
  driver:'カーネルに目がついた。ただし届くのは <b>生の syscall</b> だけ — <code>fd=7 に write した</code> では、まだ何のルールも書けない。',
  ring:  'イベントがユーザ空間に届くようになった。ここが<b>唯一落ちる場所</b>なので、負荷を上げるとドロップする。',
  state: '<b>ここが分水嶺。</b> スレッドテーブルと FD テーブルが載り、はじめて <code>proc.name</code> / <code>fd.name</code> / <code>container.id</code> が使える。ルールが書けるようになった。',
  rules: 'ルールが評価されるようになった。ただしまだ<b>誰にも届いていない</b>。',
  outputs:'アラートが人に届くようになった。ここまでで syscall 由来の検知が成立する。',
  plugins:'syscall 以外の入力が合流した。<b>クラウド側の操作</b>が見えるようになった。',
  falcoctl:'ルールが OCI アーティファクトとして追従するようになった。<b>新しい検知</b>を持てる。',
  sysdig:'相関と<b>止める手</b>が入った。検知して終わり、ではなくなった。'
};

/* ---------------------------------------------------------------- attack chain */
/* Each step names what it needs. `deploy` pins a required topology. */
const CHAIN = [
  { jp:'kubectl exec でコンテナにシェルを取る', rule:'Terminal shell in container',
    needs:['driver','ring','state','rules','outputs'] },
  { jp:'/etc/shadow を読んで資格情報を探す', rule:'Read sensitive file untrusted',
    needs:['driver','ring','state','rules','outputs'] },
  { jp:'/etc/cron.d に書き込んで永続化する', rule:'Write below etc',
    needs:['driver','ring','state','rules','outputs'] },
  { jp:'/tmp に落としたバイナリを実行する', rule:'Drop and execute new binary in container',
    needs:['driver','ring','state','rules','outputs','falcoctl'],
    why:'この検知は既定で同梱されるルールセットには入っていない。falcoctl でルールを追従させていなければ、そもそも持っていない。' },
  { jp:'K8s API サーバに接触して権限を探る', rule:'Contact K8S API Server From Container',
    needs:['driver','ring','state','rules','outputs'], deploy:'k8s',
    why:'Host 構成には Kubernetes の文脈が無いので、この振る舞いを k8s イベントとして扱えない。' },
  { jp:'盗んだ資格情報でクラウドへ（MFA 無しログイン → バケットの暗号化を解除）',
    rule:'Console Login Without MFA / Delete Bucket Encryption',
    needs:['rules','outputs','plugins'],
    why:'クラウド API の操作は syscall には一切現れない。プラグイン入力が無ければ<b>原理的に</b>見えない。' }
];
const RESPONSE = { jp:'侵害されたコンテナを止めて封じ込める', rule:'kill / pause container',
  needs:['sysdig'],
  why:'OSS Falco は目。止める手は別のコンポーネント（Sysdig の応答、または Falco Talon）。' };

/* ---------------------------------------------------------------- sides
   You pick which side of the fight you are on. Only defence is playable;
   offence exists so the shape of the game is visible from the start. */
const SIDES = [
  { id:'defense', jp:'守備側', chip:'守備', enabled:true,
    brief:'パイプラインを建てて攻撃を迎え撃つ。攻撃は <b>Auto</b> で流れる。' },
  { id:'offense', jp:'攻撃側', chip:'攻撃', enabled:false,
    brief:'検知をすり抜ける攻撃を組む。まだ実装されていない。' }
];
const sideById = id => SIDES.find(s => s.id === id);

/* ---------------------------------------------------------------- roles
   One team never builds this pipeline. Four do, and most real detection gaps
   sit on the seams between them rather than inside any one stage. So every
   buildable district and every lever is attributed to a role, and a missed
   step names the role whose decision caused it. */
const ROLES = [
  { id:'platform', chip:'基盤', jp:'プラットフォーム', short:'plat', color:'#00A8BC',
    owns:['driver','state'],
    mission:'Falco をどこに載せ、何が見えるかを決める',
    brief:'持ち物は <b>02 ドライバ</b>・<b>04 状態エンジン</b> と <b>DEPLOY</b> / <b>DRIVER</b>。'+
          'ここの構成を間違えると、下流が何をしても検知は成立しない。' },
  { id:'sre', chip:'SRE', jp:'SRE / ノード運用', short:'sre', color:'#E08A2E',
    owns:['ring'],
    mission:'落とさずに回す',
    brief:'持ち物は <b>03 リングバッファ</b> と <b>TUNING</b> 一式。ここが<b>唯一イベントが落ちる場所</b>。'+
          '検知条件を満たした攻撃でも、ここで消える。' },
  { id:'detect', chip:'検知', jp:'検知エンジニア', short:'det', color:'#B15FC4',
    owns:['rules','plugins','falcoctl'],
    mission:'何を検知できるかを決める',
    brief:'持ち物は <b>05 ルールエンジン</b>・<b>07 プラグイン入力</b>・<b>09 ルール配布</b>。'+
          'パイプラインが完璧でも、ルールを持っていなければ1本も鳴らない。' },
  { id:'soc', chip:'SOC', jp:'SOC / 対応', short:'soc', color:'#01353E',
    owns:['outputs','sysdig'],
    mission:'受け取って、止める',
    brief:'持ち物は <b>06 出力チャネル</b>・<b>08 Sysdig Secure</b> と <b>STACK</b>。'+
          '検知は届いて初めて検知で、止める手は目とは別の部品。' }
];
const roleById = id => ROLES.find(r => r.id === id);

/* district -> role. 01 workloads has no owner: it is what the app teams ship. */
const OWNER = {};
ROLES.forEach(r => r.owns.forEach(d => OWNER[d] = r.id));

/* lever group -> role, by name rather than by selector: which CSS node a lever
   lives in is ui.js's business. NODE LOAD is deliberately ownerless — load is
   not a decision anybody makes, it is what the workload happens to be doing. */
const LEVER_OWNER = { deploy:'platform', driver:'platform', tuning:'sre', stack:'soc' };

/* you may touch a lever if you are playing everyone, or you own it */
const canUseLever = group =>
  !(GAME.on && GAME.role && GAME.role !== LEVER_OWNER[group]);

GAME.role = null;    // null = 全役（one player doing every job）
GAME.side = 'defense';
GAME.asks = 0;

/* ---------------------------------------------------------------- change feed */
const listeners = new Set();
export function onCampaignChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function notify(ev){ for(const fn of listeners) fn(ev); }

/* ---------------------------------------------------------------- world state */
const canBuild = id => DEPS[id].every(k => GAME.built.has(k));

/* particles evaporate at the edge of what has actually been built */
function frontier(){
  if(!GAME.on) return Infinity;
  let x = byId('workloads').x1;
  for(const d of DISTRICTS)
    if(isFlow(d) && GAME.built.has(d.id)) x = Math.max(x, d.x1);
  return x + 4;
}

/* 3D only — the district labels are DOM and belong to ui.js */
function applyGameVisibility(){
  for(const d of DISTRICTS)
    districtObjs[d.id].group.visible = !GAME.on || GAME.built.has(d.id);
  polPoints.visible = !GAME.on || GAME.built.has('falcoctl') || GAME.built.has('sysdig');
  GAME.frontier = frontier();
}

/* ---------------------------------------------------------------- evaluation
   A pure function of what you built, how you tuned it, and where you deployed. */
function evaluate(){
  const M = model();
  const out = [];
  /* a real overload steals one otherwise-detected syscall step */
  let stolen = M.util > 1 && M.dropP > 0.05;

  for(const s of CHAIN){
    const missing = s.needs.filter(k => !GAME.built.has(k));
    let caught = missing.length === 0, why = null;
    if(!caught){
      why = s.why || `まだ建っていない: ${missing.map(m=>byId(m).jp).join(' / ')}`;
    } else if(s.deploy && S.deploy !== s.deploy){
      caught = false;
      why = s.why || `この構成（${S.deploy}）では検知できない。`;
    } else if(stolen && s.needs.includes('ring')){
      caught = false; stolen = false;
      why = `検知条件は満たしていたのに、<b>リングバッファでドロップした</b>（drain utilisation ${Math.round(M.util*100)}%）。`;
    }
    out.push({...s, caught, why});
  }
  const rMissing = RESPONSE.needs.filter(k => !GAME.built.has(k));
  out.push({...RESPONSE, response:true, caught:rMissing.length===0,
            why: rMissing.length ? RESPONSE.why : null});
  return out;
}

/* Whose decision caused this miss. Derived from the result, never annotated
   by hand, so it cannot drift away from what the model actually did. */
function blameOf(r){
  if(!r || r.caught) return null;
  const missing = r.needs.filter(k => !GAME.built.has(k));
  if(missing.length){
    /* the most upstream gap is the one that actually stopped the event */
    const first = BUILD_ORDER.find(k => missing.includes(k)) || missing[0];
    return OWNER[first] || null;
  }
  if(r.deploy && S.deploy !== r.deploy) return 'platform';
  return 'sre';   /* everything was built and matched — the ring buffer ate it */
}

/* what each role's decisions cost, as data */
function roleReport(){
  const results = GAME.results || [];
  const notes = [];
  /* the sharpest seam in the whole model, and the one it does not score */
  if(S.tune.syscallSet === 'custom')
    notes.push('<b>役割の境目:</b> SRE が <code>base_syscalls</code> を絞ってドロップを止めている。'+
      'その絞り込みが検知エンジニアのルールに必要な syscall まで落としていないかは、'+
      'この模型では判定していない。実機では必ず突き合わせる。');
  if(GAME.asks)
    notes.push(`<b>他チームへの依頼 ${GAME.asks}件。</b>自分の担当だけでは検知は完成しない — `+
      'この回数が、組織側で払っているコストそのもの。');
  return {
    roles: ROLES.map(r => ({
      id:r.id, jp:r.jp, color:r.color, mine: GAME.role === r.id,
      built: r.owns.filter(k => GAME.built.has(k)).length,
      owns: r.owns.length,
      misses: results.filter(x => x.blame === r.id).length
    })),
    notes
  };
}

/* the headline sentence for the current results */
function verdictText(){
  if(!GAME.results || GAME.reveal < GAME.results.length) return null;
  const det = GAME.results.filter(r => !r.response);
  const hit = det.filter(r => r.caught).length;
  const resp = GAME.results.find(r => r.response);
  if(hit === det.length)
    return { good:true, html: resp.caught
      ? '<b>全段検知＋封じ込め。</b>目と手が揃った状態がこれ。'
      : '<b>全段検知。ただし止められていない。</b>検知と応答は別の部品。' };
  return { good:false,
    html:`<b>${det.length-hit} 段を見逃した。</b>各行の理由が、その部品が存在する理由。` };
}
const score = () => (GAME.results && GAME.reveal)
  ? GAME.results.filter(r => !r.response && r.caught).length : 0;

/* ---------------------------------------------------------------- actions */
function build(id){
  if(!canBuild(id) || GAME.built.has(id)) return false;
  GAME.built.add(id);
  applyGameVisibility();
  GAME.results = null; GAME.reveal = 0;
  if(id === 'sysdig') setMode('sysdig');
  notify({type:'build', id, unlock:UNLOCK[id] || ''});
  return true;
}

/* another team's stage still has to exist, but you can only ask for it.
   The count is the point: it is the coordination cost, made visible. */
function requestBuild(id){
  if(!build(id)) return false;
  GAME.asks++;
  notify({type:'asks'});
  return true;
}

function runAttack(){
  GAME.results = evaluate();
  /* blame is snapshotted at run time so it cannot drift if the tuning is
     changed while the results are still on screen */
  GAME.results.forEach(r => r.blame = blameOf(r));
  GAME.reveal = 0; GAME.revealT = 0;
  notify({type:'run'});
}

/* reveal one step at a time, driven from the frame loop */
function tickReveal(dt){
  if(!GAME.results || GAME.reveal >= GAME.results.length) return;
  GAME.revealT -= dt;
  if(GAME.revealT > 0) return;
  GAME.revealT = 0.62;
  GAME.reveal++;
  notify({type:'reveal', done: GAME.reveal >= GAME.results.length});
}

function setRole(id){
  GAME.role = id;
  notify({type:'role', id});
}

function setSide(id){
  const s = sideById(id);
  if(!s || !s.enabled) return false;
  GAME.side = id;
  notify({type:'side', id});
  return true;
}

function setUiMode(m){
  GAME.on = m === 'campaign';
  setCampaignView(GAME.on);
  if(GAME.on){
    GAME.built = new Set(['workloads']);
    GAME.results = null; GAME.reveal = 0; GAME.asks = 0;
    S.counters = {sys:0, ring:0, drop:0, rules:0, alerts:0};
    S.shown    = {sys:0, ring:0, drop:0, rules:0, alerts:0};
    S.alertWindow = [];
    setMode('oss');
  } else {
    GAME.built = new Set(DISTRICTS.map(d => d.id));
  }
  applyGameVisibility();
  applyShield();
  notify({type:'mode', mode:m});
}

export {
  GAME,
  DEPS,
  BUILD_ORDER,
  UNLOCK,
  CHAIN,
  RESPONSE,
  SIDES,
  sideById,
  ROLES,
  roleById,
  OWNER,
  LEVER_OWNER,
  canUseLever,
  canBuild,
  evaluate,
  blameOf,
  roleReport,
  verdictText,
  score,
  build,
  requestBuild,
  runAttack,
  tickReveal,
  setRole,
  setSide,
  setUiMode,
  applyGameVisibility,
  frontier
};
