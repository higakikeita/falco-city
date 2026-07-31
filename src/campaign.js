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
import { S, GAME, model, noise, TUNE_DEFAULTS, hasCap, working, unmetOf } from './state.js';
import { DEPLOYMENTS } from './districts.data.js';
import { districtObjs } from './city.js';
import { polPoints } from './sim.js';
import { setMode, setDeploy, applyShield, onTuneChange } from './controls.js';
import { SCENARIOS, DEFAULT_SCENARIO_ID, scenarioById, addScenarioError } from './scenarios/index.js';
import { envOf, deployOf, driverOf, wavesOf, stepsOf } from './scenarios/schema.js';

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

/* ---------------------------------------------------------------- attack chain
   The library of steps an attack can be composed of. A scenario does not invent
   attacks — it names which of these come, and in which wave. `id` is that handle.

   `needsCaps` names what the deployment has to make observable — the attributes
   declared on DEPLOYMENTS (districts.data.js), read through hasCap(). Never the
   name of a topology: pinning `deploy:'k8s'` became wrong the moment `managed`
   was declared, and it would blame the platform role for a miss the model never
   caused. The capability is the actual reason.

   `needsSyscalls` is the same idea one level down: the syscalls the rule's own
   condition is written on. It exists so that a NEGATIVE `base_syscalls.custom_set`
   entry can take a detection away, which is the only way a narrowed base set is
   allowed to cost coverage (INVARIANTS 2.1 / 2.4). It is a DEPENDENCY and never
   an ordering — "which syscall dies first under pressure" is not a claim the
   sources support (INVARIANTS 2.9). */
const SYSCALL_PATH = ['driver','ring','state','rules','outputs'];
const OPEN_FAMILY = ['open','openat','openat2'];        // macro open_read / open_write
const EXEC_FAMILY = ['execve','execveat'];
const CHAIN = [
  { id:'exec', jp:'kubectl exec でコンテナにシェルを取る', rule:'Terminal shell in container',
    needs:SYSCALL_PATH, needsCaps:['kernelPath'], needsSyscalls:EXEC_FAMILY },
  { id:'shadow', jp:'/etc/shadow を読んで資格情報を探す', rule:'Read sensitive file untrusted',
    needs:SYSCALL_PATH, needsCaps:['kernelPath'], needsSyscalls:OPEN_FAMILY },
  { id:'cron', jp:'/etc/cron.d に書き込んで永続化する', rule:'Write below etc',
    needs:SYSCALL_PATH, needsCaps:['kernelPath'], needsSyscalls:OPEN_FAMILY },
  /* `Drop and execute new binary in container` is tagged maturity_stable, so it
     ships in the release package and falcoctl has nothing to do with it. It used
     to be listed as needing 09, which made the example contradict the very claim
     it was there to teach (INVARIANTS 4.3). The claim is right; this was the
     wrong rule to hang it on. So this step is now what it actually is — a stable
     detection that needs nothing but the syscall path — and `imds` below carries
     the falcoctl lesson on a rule that really is a separate OCI artifact. */
  { id:'dropbin', jp:'/tmp に落としたバイナリを実行する', rule:'Drop and execute new binary in container',
    needs:SYSCALL_PATH, needsCaps:['kernelPath'], needsSyscalls:EXEC_FAMILY },
  /* `Contact EC2 Instance Metadata Service From Container` is tagged
     maturity_incubating (falco-incubating_rules.yaml), which means it is NOT in
     the release package: only the stable set is loaded by default and incubating
     / sandbox ship as OCI artifacts you have to fetch (INVARIANTS 4.1 / 4.5). So
     this is a detection you simply do not have until falcoctl brings it — and it
     is where the credentials the cloud step spends actually get taken, which is
     what earns it a place in the chain instead of being an example bolted on. */
  { id:'imds', jp:'IMDS (169.254.169.254) を叩いてインスタンスの資格情報を抜く',
    rule:'Contact EC2 Instance Metadata Service From Container',
    needs:[...SYSCALL_PATH,'falcoctl'], needsCaps:['kernelPath'],
    /* macro `outbound`: connect, or sendto / sendmsg on an unconnected socket */
    needsSyscalls:['connect','sendto','sendmsg'],
    why:'この検知は <b>incubating</b>（<code>maturity_incubating</code>）で、'+
         'リリースパッケージに同梱されるのは <b>stable</b> のルールだけ。'+
         'incubating / sandbox は<b>別の OCI アーティファクト</b>として取得するもので、'+
         'それをやるのが <code>falcoctl</code>（<b>09 ルール配布</b>）。'+
         '<b>持っていないルールは鳴らない。</b>' },
  { id:'k8sapi', jp:'K8s API サーバに接触して権限を探る', rule:'Contact K8S API Server From Container',
    needs:SYSCALL_PATH, needsCaps:['kernelPath','apiServer'], needsSyscalls:['connect'] },
  { id:'cloud', jp:'盗んだ資格情報でクラウドへ（MFA 無しログイン → バケットの暗号化を解除）',
    rule:'Console Login Without MFA / Delete Bucket Encryption',
    needs:['rules','outputs','plugins'],
    /* a plugin source carries no syscalls, so no base_syscalls entry can reach it */
    needsSyscalls:[],
    why:'クラウド API の操作は<b>別のイベントソース</b>（<code>aws_cloudtrail</code>）で、'+
         '<code>ct.*</code> という別のフィールド空間を持つ。<b>Falco はソース間の相関をしない</b>ので、'+
         'syscall ルールには<b>構造的に</b>マッチし得ない。プラグイン入力を足す以外に道が無い。' }
];

/* Which syscalls a hand-written base_syscalls has switched off.
 *
 * Only while base_syscalls is hand-written: `syscallSet` IS base_syscalls, so
 * `default` / `all` mean there is no custom_set for a negative entry to live in.
 * That is also the way out for the player — stop hand-writing it — and it is the
 * way out the Docs recommend (drop the exclusion from custom_set, not from the
 * ruleset).
 *
 * A positive entry never appears here. It is traced *in addition to* what the
 * enabled rules require, so it cannot take coverage away (INVARIANTS 2.1). */
const negatedSyscalls = () =>
  S.tune.syscallSet === 'custom'
    ? (S.tune.syscallCustom || []).filter(x => x.startsWith('!')).map(x => x.slice(1))
    : [];

/* A rule goes silent when there is nothing left for its condition to match on:
   `evt.type in (open, openat, openat2)` still fires while any one of the three is
   traced. So the test is "all of them", which is also why excluding one member of
   the open family costs nothing and excluding `connect` silences the one rule in
   this chain written on it. */
function blindSyscalls(chainStep){
  const need = chainStep.needsSyscalls;
  if(!need || !need.length) return [];
  const off = negatedSyscalls();
  return need.every(n => off.includes(n)) ? need : [];
}

/* ---------------------------------------------------------------- requirements
   BUILT IS NOT WORKING.

   A district on the build list is a component you have. It is not a component
   that works. What makes it work is a set of conditions, and on a real cluster
   they are the majority of "we installed it and it never fired": the artifact is
   fetched but the engine was never told to read it, the plugin is loaded but its
   rules file is not in the list, the output is configured but nothing is
   listening at the other end.

   So the district declares its conditions here, and a scenario declares which of
   them its situation does not satisfy (schema.js §start.unmet). Nothing about
   falcoctl is special and nothing about it leaks into the tuning namespace: a
   condition is a condition, and the mechanism works for the next district that
   needs one.

     jp     what the condition is, as the player reads it in the list
     miss   why the detection did not happen, shown on the missed step
     fix    what doing something about it is called

   The player fixes them one at a time. A condition on a district somebody else
   owns costs an ask, exactly like building one does. */
const REQUIREMENTS = {
  falcoctl: [
    { id:'install-refs', jp:'<code>artifact.install.refs</code> に取得するルールが並んでいる',
      fix:'取得対象のアーティファクトを追加する',
      miss:'<b>09 ルール配布は建っているが、取ってくるものが指定されていない。</b>'+
           'falcoctl は動いていて、<code>artifact.install.refs</code> が空なので'+
           '<b>アーティファクトを1つも取得していない</b>。既定で読まれるのは stable だけなので、'+
           'incubating / sandbox の検知は手元に無い。' },
    { id:'follow-refs', jp:'<code>artifact.follow.refs</code> が自動更新している',
      fix:'追従対象に入れて自動更新させる',
      miss:'<b>取得はしたが、追従していない。</b> <code>artifact.follow.refs</code> に入っていないので、'+
           '入れた日のルールで止まっている。<b>新しい検知は増えない</b> — '+
           '「ルールは最新」というメモが最も裏切るのがここ。' },
    { id:'rules-files', jp:'<code>falco.rules_files</code> が取得したファイルを読んでいる',
      fix:'取得したルールファイルを読み込ませる',
      miss:'<b>ルールはノードの上にあるが、エンジンが読んでいない。</b>'+
           '取得先のファイルが <code>falco.rules_files</code> に入っていないので、'+
           '<b>ディスク上に存在するだけ</b>で1本も評価されていない。'+
           '取得（<code>install.refs</code>）・追従（<code>follow.refs</code>）・'+
           '読み込み（<code>rules_files</code>）は<b>別のキー</b>で、揃って初めて効く。' }
  ],
  plugins: [
    { id:'plugin-rules-files', jp:'プラグインのルールファイルが読み込まれている',
      fix:'プラグインのルールファイルを読み込ませる',
      miss:'<b>プラグインは読み込まれているが、そのルールが読まれていない。</b>'+
           'イベントソースは合流しているのに、<code>falco.rules_files</code> に'+
           'そのソース向けのルールファイルが無いので、<b>評価する条件が1本も無い</b>。'+
           'ソースを足すこととルールを持つことは別。' },
    { id:'source-credentials', jp:'イベントソースの資格情報が有効',
      fix:'ソース側の資格情報を通す',
      miss:'<b>プラグインは起動しているが、ソースから1件も読めていない。</b>'+
           '資格情報か権限が通っていないので、<b>入力が空のまま正常に動いている</b>。' }
  ],
  outputs: [
    { id:'reachable-sink', jp:'出力先に実際に届いている',
      fix:'出力先を復旧させる',
      miss:'<b>アラートは生成されているが、誰にも届いていない。</b>'+
           '出力チャネルは設定されているのに受け手に到達していないので、'+
           '<b>Falco のログには出ていて、人は見ていない</b>。' }
  ],
  sysdig: [
    { id:'response-enabled', jp:'応答アクションが有効になっている',
      fix:'応答アクションを有効にする',
      miss:'<b>08 は建っているが、止める手が有効になっていない。</b>'+
           '相関はしていて、応答アクションが無効なので<b>検知して終わり</b>のまま。'+
           '入れていることと、動くように設定されていることは別。' }
  ]
};
const requirementsOf = id => REQUIREMENTS[id] || [];
const requirementById = (id, req) => requirementsOf(id).find(r => r.id === req) || null;
/* the conditions this district declares that the situation has NOT satisfied */
const openRequirements = id =>
  unmetOf(id).map(r => requirementById(id, r)).filter(Boolean);
/* Why a missing capability stops a step. Keyed by the capability, so a reason can
   never drift onto the wrong cause — the bug that told a kernel-less environment
   its rules were out of date.

   `k8sMeta` is deliberately absent: no detection here requires it, because
   container and k8s metadata come from the container runtime socket and are
   orthogonal to how Falco was installed (README §環境の因果). Attributing a miss
   to the install form would be restating an error the docs disprove. */
const CAP_WHY = {
  kernelPath:'この環境にはカーネルからユーザ空間へのリングバッファが無い。'+
             '<code>syscall</code> ソース自体が消えるわけではないが、'+
             '<b>カーネル由来のイベントが1件も上がってこない</b>ので、'+
             'ルールエンジンに届くのはプラグイン入力だけ。',
  apiServer:'この環境に <b>Kubernetes の API サーバが無い</b>。'+
            'オーケストレータが居ないので接触する相手が存在せず、この振る舞い自体が起こり得ない。'+
            '（インストール形態の話ではない — <code>k8saudit</code> は host 導入でも動く）'
};

const stepById = id => CHAIN.find(s => s.id === id) || null;
const RESPONSE = { id:'contain', jp:'侵害されたコンテナを止めて封じ込める', rule:'kill / pause container',
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

/* you may touch a lever if you are playing everyone, or you own it.
   NODE LOAD has no owner and is still not always yours: a scenario can declare
   that the load is the situation rather than a treatment (goal.lockLoad), and
   then turning it down is not one of the moves. */
function canUseLever(group){
  if(group === 'load') return !loadLocked();
  return !(GAME.on && GAME.role && GAME.role !== LEVER_OWNER[group]);
}

GAME.role = null;      // null = 全役（one player doing every job）
GAME.roleLocked = false;
GAME.side = 'defense';
GAME.asks = 0;
GAME.scenario = null;  // set on entry; there is no play outside a scenario

/* ---- the wave machine -----------------------------------------------------
   Building and then running once is not defending: there is no moment where you
   see a hole and close it. So the attack arrives in waves and the game stops
   between them.

     build     nothing has come yet. Build, tune, ask, as long as you like
     running   a wave is resolving, one step at a time (tickReveal)
     between   that wave is over and the next one has not come. THIS is the
               phase the whole feature exists for: everything you can do in
               `build` you can still do here, and the next wave meets it
     over      every wave has been resolved. The pass is scored

   One pass is one attempt at the whole attack. Detections accumulate across the
   waves of a pass, so goal.detect keeps meaning "of everything that came", and a
   wave you have already lost stays lost — which is what makes the gap between
   wave 1 and wave 2 worth anything. Running again starts a fresh pass and
   increments GAME.runs, which is what goal.maxRuns is counted against. */
GAME.phase = 'build';
GAME.wave = -1;        // index of the wave that has most recently arrived
GAME.waveLog = [];     // one entry per resolved wave of the current pass
GAME.runs = 0;         // passes started. goal.maxRuns is a ceiling on this
GAME.budget = null;    // what overload is still allowed to steal, this pass
GAME.load0 = 1.0;      // the load you were handed, for goal.lockLoad

const loadLocked = () => {
  const sc = activeScenario();
  return !!(GAME.on && sc && sc.goal.lockLoad);
};

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

/* ---------------------------------------------------------------- scenarios
   Playtime is made of scenarios, so the engine reads them and holds no case for
   any particular one — 空き地から建てる is src/scenarios/greenfield.js and gets
   no more from this file than any other. schema.js is the contract.

   Referential checks live here because this is where the tables are. They run
   once per scenario, the first time it is started, and land in the same error
   list the shape check uses. */
const checked = new Set();

function referentialErrors(sc){
  const e = [];
  const ids = stepsOf(sc);
  ids.forEach(id => { if(!stepById(id)) e.push(`unknown attack step: ${id}`); });
  if(new Set(ids).size !== ids.length) e.push('an attack step appears in more than one wave');

  if(sc.player.role !== null && !roleById(sc.player.role))
    e.push(`unknown role: ${sc.player.role}`);

  const built = new Set(['workloads', ...sc.start.built]);
  for(const id of sc.start.built){
    if(!DEPS[id]) e.push(`start.built names a district that cannot be built: ${id}`);
    else for(const dep of DEPS[id])
      if(!built.has(dep))
        e.push(`start.built has ${id} without ${dep} — the dependency has to be met`);
  }
  /* start.stack = sysdig with 08 not built is DELIBERATELY allowed: the licence
     is bought and the component is not installed, which is the most common
     version of this situation there is, and a scenario has to be able to hand it
     over already-walked-into rather than make the player press STACK themselves.
     The behaviour was always right — applyShield() reads GAME.built — so the only
     thing that had to change was this check. The reverse (oss with 08 standing)
     is a component you own and have not switched to, which is also legal. */

  for(const [id, reqs] of Object.entries(sc.start.unmet)){
    if(!built.has(id))
      e.push(`start.unmet names ${id}, which is not in start.built — a condition can only be unmet on something you were handed`);
    if(!requirementsOf(id).length)
      e.push(`start.unmet names ${id}, which declares no conditions`);
    else for(const r of reqs)
      if(!requirementById(id, r))
        e.push(`unknown condition on ${id}: ${r}`);
  }

  if(sc.goal.detect !== null && sc.goal.detect > ids.length)
    e.push(`goal.detect ${sc.goal.detect} is above the ${ids.length} step(s) that come`);
  return e;
}

function validated(sc){
  if(checked.has(sc.id)) return true;
  const errs = referentialErrors(sc);
  errs.forEach(m => addScenarioError(`${sc.id}: ${m}`));
  checked.add(sc.id);
  return errs.length === 0;
}

const activeScenario = () => GAME.scenario ? scenarioById(GAME.scenario) : null;

/* the resolved environment: the table entry with the scenario's node count
   applied. Carries its own player-facing name, so no layer above has to keep a
   second copy of it. */
function activeEnv(){
  const sc = activeScenario();
  return sc ? envOf(sc) : null;
}

/* the steps that come, in order. Outside a scenario (explore mode, console
   poking) the whole library comes, which is what it did before scenarios. */
function activeChain(){
  const sc = activeScenario();
  if(!sc) return CHAIN.slice();
  return stepsOf(sc).map(stepById).filter(Boolean);
}

/* the waves, resolved to steps. The environment composes them: a scenario names
   which of the library's steps come and in which wave, and outside a scenario
   the whole library arrives as one wave — which is exactly what running the
   attack did before there were waves. */
function activeWaves(){
  const sc = activeScenario();
  if(!sc) return [{ jp:'全段', steps:CHAIN.slice() }];
  return wavesOf(sc).map(w => ({
    jp:w.jp, steps:w.steps.map(stepById).filter(Boolean)
  }));
}
const waveCount = () => activeWaves().length;
const hasResponse = () => { const sc = activeScenario(); return sc ? sc.attack.response : true; };

/* the topology the current environment is. In a scenario there is exactly one —
   the environment is not a lever, it is the place you were given — so the DEPLOY
   buttons for the others are not available while it runs. */
function allowedDeploys(){
  const sc = activeScenario();
  const env = sc && envOf(sc);
  return env ? [env.deploy] : DEPLOYMENTS.map(d => d.id);
}
function allowedDrivers(){
  const sc = activeScenario();
  const env = sc && envOf(sc);
  return env ? env.drivers.slice() : ['modern_ebpf','ebpf','kmod'];
}

/* Enter a scenario. Everything the player is handed comes from the file: the
   environment, what is already standing, what was already tuned, which role
   they are. An empty plot is the case where the file hands over nothing. */
function startScenario(id){
  const sc = scenarioById(id);
  if(!sc){ addScenarioError(`cannot start unknown scenario: ${id}`); return false; }
  if(!validated(sc)) return false;

  const env = envOf(sc);
  GAME.scenario = sc.id;
  GAME.on = true;
  GAME.built = new Set(['workloads', ...sc.start.built]);
  /* the conditions this situation leaves unsatisfied. Copied, because the player
     is about to fix them and the scenario file is not theirs to change. */
  GAME.unmet = Object.fromEntries(
    Object.entries(sc.start.unmet).map(([k,v]) => [k, v.slice()]));
  GAME.asks = 0;
  GAME.runs = 0;
  GAME.load0 = sc.start.load;
  resetPass();
  GAME.side = sc.player.side;
  GAME.role = sc.player.role;
  GAME.roleLocked = sc.player.lockRole;

  S.env = sc.env.type;
  /* BEFORE setDeploy: controls.applyEnv() reads S.cpus and pushes it into the
     ring district's lanes and the TUNING label, so the node has to be the right
     size by the time the environment is applied. */
  S.cpus = env.cpus;
  S.tune = {...TUNE_DEFAULTS, ...sc.start.tune};
  S.load = sc.start.load;
  S.driver = driverOf(sc) || S.driver;
  S.dead = false; S.deadDrops = 0;
  S.counters = {sys:0, ring:0, drop:0, rules:0, alerts:0};
  S.shown    = {sys:0, ring:0, drop:0, rules:0, alerts:0};
  S.alertWindow = [];

  setMode(sc.start.stack);
  setDeploy(deployOf(sc));        /* reroutes the particles and calls onTuneChange */
  /* AFTER setDeploy, because applyEnv() derives S.nodes from the topology and
     would overwrite the scenario's count. The topology says how many pads the
     city draws; the scenario says how big the estate actually is, and the alert
     volume the SOC has to keep up with is a function of the latter. */
  S.nodes = env.nodes;
  applyGameVisibility();
  applyShield();
  notify({type:'scenario', id:sc.id});
  return true;
}

/* ---------------------------------------------------------------- evaluation
   A pure function of what you built, how you tuned it, and where you deployed.
   Five ways a step can fail, and they are checked in the order the event would
   have met them:

     unbuilt   the stage is not there, or it is there and not working
     cap       the environment cannot observe this at all
     blind     the syscall the rule is written on is not being traced
     drop      it was collected and the ring buffer ate it
     noise     it rang, and the SOC queue never got to it

   The last two are the same arithmetic in two different places, and each of them
   may steal ONE otherwise-detected step per pass. Per pass, not per wave: the
   budget lives on the caller so that walking the waves of one attack costs the
   same as evaluating the whole chain at once did, which is what keeps README
   §実測した進行 and §実測した帰属 true. */
function freshBudget(M = model(), Nz = noise()){
  return {
    drop:  (M.util > 1 && M.dropP > 0.05) ? 1 : 0,
    noise: (Nz.util > 1 && Nz.buriedP > 0.05) ? 1 : 0
  };
}

function evaluate(chain = activeChain(), opts = {}){
  const M = model(), Nz = noise();
  const budget = opts.budget || freshBudget(M, Nz);
  const out = [];

  for(const s of chain){
    /* built is not the same question as working: a district that is standing but
       has an unsatisfied condition stops the event exactly the same way */
    const missing = s.needs.filter(k => !working(k));
    const missingCaps = (s.needsCaps || []).filter(c => !hasCap(c));
    const blind = blindSyscalls(s);
    let caught = missing.length === 0, why = null, cause = null;
    if(!caught){
      cause = 'unbuilt';
      /* the most upstream gap is the one that actually stopped the event, and if
         it is standing-but-broken then that is the sentence to show */
      const first = BUILD_ORDER.find(k => missing.includes(k)) || missing[0];
      const req = openRequirements(first)[0];
      why = req ? req.miss
          : s.why || `まだ建っていない: ${missing.map(m=>byId(m).jp).join(' / ')}`;
      if(req) cause = 'unmet';
    } else if(missingCaps.length){
      caught = false; cause = 'cap';
      /* the reason belongs to the capability that is missing, not to the step —
         otherwise a kernel-less environment gets told its rules are out of date */
      why = CAP_WHY[missingCaps[0]] || `この構成（${S.deploy}）では検知できない。`;
    } else if(blind.length){
      caught = false; cause = 'blind';
      why = `ルールは読み込まれていて、<b>要求する syscall がトレースされていない</b> — `+
            `<code>base_syscalls.custom_set</code> に `+
            `${blind.map(n=>`<code>!${n}</code>`).join(' / ')} という<b>負の指定</b>がある。`+
            `落ちていないので <code>syscall_event_drops</code> は1つも上がらず、`+
            `ドロップ率も util も健全なまま鳴らない。<b>集めていない syscall は計測できない。</b>`;
    } else if(budget.drop && s.needs.includes('ring')){
      caught = false; cause = 'drop'; budget.drop--;
      why = `検知条件は満たしていたのに、<b>リングバッファでドロップした</b>（drain utilisation ${Math.round(M.util*100)}%）。`;
    } else if(budget.noise && s.needs.includes('outputs')){
      caught = false; cause = 'noise'; budget.noise--;
      why = `<b>鳴った。誰も見ていない。</b> アラート量が SOC の処理能力を超えている`+
            `（${Math.round(Nz.inflow)} 件/分 vs ${Math.round(Nz.cap)} 件/分 · `+
            `queue utilisation ${Math.round(Nz.util*100)}%）ので、`+
            `本物が ${Math.round(Nz.buriedP*100)}% の誤検知の中に埋もれた。`+
            `<b>ここには buf_size_preset が無い</b> — 入力を絞るか、処理能力を上げるかの2つだけ。`;
    }
    out.push({...s, caught, why, cause});
  }
  const wantResponse = opts.response ?? hasResponse();
  if(wantResponse){
    const rMissing = RESPONSE.needs.filter(k => !working(k));
    const req = rMissing.length ? openRequirements(rMissing[0])[0] : null;
    out.push({...RESPONSE, response:true, caught:rMissing.length===0,
              cause: rMissing.length ? (req ? 'unmet' : 'unbuilt') : null,
              why: rMissing.length ? (req ? req.miss : RESPONSE.why) : null});
  }
  return out;
}

/* Whose decision made the queue overflow. Derived from the arithmetic, and it
   has to distinguish two different things a role can have done:

     a DEVIATION   base_syscalls widened past the default. `breadth` is zero at
                   the default by construction, so anything above zero is a
                   choice somebody made to send more
     a LOAD-BEARING contribution
                   following the rule artifacts and standing up a second source
                   are things you are supposed to do. They are not a mistake
                   until they are the thing that crossed the line

   Node count and NODE LOAD are the largest terms and belong to nobody — they are
   the estate and what it is doing — so an estate whose baseline alone is over
   capacity is not anyone's misconfiguration. It is capacity that was never
   bought, and buying it is the SOC's call. */
function noiseBlame(Nz = noise()){
  const p = Nz.parts;
  if(p.breadth > 0 && Nz.inflow - p.breadth <= Nz.cap) return 'sre';
  if(p.base <= Nz.cap && p.base + p.ruleset > Nz.cap)  return 'detect';
  return 'soc';
}

/* Whose decision caused this miss. Derived from the result, never annotated
   by hand, so it cannot drift away from what the model actually did. */
function blameOf(r){
  if(!r || r.caught) return null;
  if(r.cause === 'noise') return noiseBlame();
  const missing = r.needs.filter(k => !working(k));
  if(missing.length){
    /* the most upstream gap is the one that actually stopped the event — whether
       it was never built or is standing and not doing its job */
    const first = BUILD_ORDER.find(k => missing.includes(k)) || missing[0];
    return OWNER[first] || null;
  }
  /* the topology is the platform role's call, so a capability the deployment
     does not have is their miss */
  if((r.needsCaps || []).some(c => !hasCap(c))) return 'platform';
  /* base_syscalls is the SRE's, and so is the ring buffer */
  return 'sre';
}

/* what each role's decisions cost, as data */
function roleReport(){
  const results = passResults();
  const notes = [];
  const Nz = noise();
  /* narrowing base_syscalls is not free of consequence, it is free of THIS
     consequence, and saying which is the whole teaching */
  if(S.tune.syscallSet === 'custom'){
    const off = negatedSyscalls();
    notes.push(off.length
      ? '<b>役割の境目:</b> <code>base_syscalls.custom_set</code> に負の指定 '+
        off.map(n=>`<code>!${n}</code>`).join(' / ')+
        ' がある。<b>これはルールが要求していてもその syscall を無効化する</b> — '+
        'ドロップとして計測されないので、HUD は最後まで健全に見える。'
      : '<b>役割の境目:</b> SRE が <code>base_syscalls</code> を絞って入力を下げている。'+
        '正の指定は<b>有効なルールが要求する syscall に加えて</b>トレースする集合なので'+
        'カバレッジは奪わないが、実機では最終集合を <code>--dry-run</code> で'+
        '突き合わせるまで「加えて」で済んでいる保証は無い。');
  }
  if(Nz.util > 1)
    notes.push(`<b>役割の境目:</b> アラートが SOC の処理能力を超えている`+
      `（${Math.round(Nz.inflow)} / ${Math.round(Nz.cap)} 件/分）。`+
      '検知を増やした側と、受け取る側の能力は<b>別の予算</b>で、'+
      'ここが溢れると増やした検知そのものが埋もれる。');
  if(GAME.asks)
    notes.push(`<b>他チームへの依頼 ${GAME.asks}件。</b>自分の担当だけでは検知は完成しない — `+
      'この回数が、組織側で払っているコストそのもの。');
  return {
    roles: ROLES.map(r => ({
      id:r.id, jp:r.jp, color:r.color, mine: GAME.role === r.id,
      built: r.owns.filter(k => GAME.built.has(k)).length,
      working: r.owns.filter(k => working(k)).length,
      owns: r.owns.length,
      misses: results.filter(x => x.blame === r.id).length
    })),
    notes
  };
}

/* every step this pass has resolved so far, across the waves that have run.
   The score is cumulative because the attack is one attack. */
function passResults(){
  const done = GAME.waveLog.flatMap(w => w.results);
  /* the wave on screen is in waveLog only once it has finished revealing */
  return GAME.results && GAME.phase === 'running'
    ? [...done, ...GAME.results.slice(0, GAME.reveal)]
    : done.length ? done : (GAME.results || []);
}

/* the headline sentence for the current results */
function verdictText(){
  if(!GAME.results || GAME.reveal < GAME.results.length) return null;
  const last = GAME.phase !== 'between';
  const all = passResults();
  const det = all.filter(r => !r.response);
  const hit = det.filter(r => r.caught).length;
  const resp = all.find(r => r.response);

  if(!last){
    /* the whole point of the gap: name what is still coming and that the holes
       you can see are the ones you can still close */
    const wave = GAME.waveLog[GAME.waveLog.length-1];
    const miss = wave ? wave.results.filter(r => !r.caught).length : 0;
    const left = waveCount() - GAME.waveLog.length;
    return { good: miss === 0,
      html: (miss === 0
        ? `<b>${wave ? wave.jp : ''} は全段止めた。</b>`
        : `<b>${wave ? wave.jp : ''} で ${miss} 段抜けた。</b>各行の理由が、次の波までに直せるもの。`)
        + `次の波まであと ${left} 波 — <b>建てる・チューニングを変える・依頼する</b>、`
        + 'いま打った手が次の波に効く。' };
  }
  if(hit === det.length)
    return { good:true, html: !resp
      ? '<b>この環境で成立する全段を検知した。</b>'
      : resp.caught
      ? '<b>全段検知＋封じ込め。</b>目と手が揃った状態がこれ。'
      : '<b>全段検知。ただし止められていない。</b>検知と応答は別の部品。' };
  return { good:false,
    html:`<b>${det.length-hit} 段を見逃した。</b>各行の理由が、その部品が存在する理由。` };
}

/* Did you clear the scenario. The thresholds are the scenario's, the arithmetic
   is here, and the labels are ui.js's — this returns keys and numbers so that
   no player-facing sentence has to live in the rules layer.
   `results` is passed in so the same scoring serves the finished pass and the
   pre-run projection, which must agree or the projection is a lie. */
function scoreGoal(g, results, ctx){
  const det = results.filter(r => !r.response);
  const hit = det.filter(r => r.caught).length;
  const resp = results.find(r => r.response);
  const items = [];
  const r2 = v => Math.round(v*100)/100;

  if(g.detect !== null)
    items.push({key:'detect', target:g.detect, actual:hit, of:det.length, ok:hit >= g.detect});
  if(g.contain)
    items.push({key:'contain', target:1, actual:resp && resp.caught ? 1 : 0,
                ok:!!(resp && resp.caught)});
  if(g.maxAsks !== null)
    items.push({key:'asks', target:g.maxAsks, actual:ctx.asks, ok:ctx.asks <= g.maxAsks});
  if(g.maxRuns !== null)
    items.push({key:'runs', target:g.maxRuns, actual:ctx.runs, ok:ctx.runs <= g.maxRuns});
  if(g.maxDropPct !== null)
    items.push({key:'drop', target:g.maxDropPct, actual:r2(ctx.dropPct),
                ok:ctx.dropPct <= g.maxDropPct});
  if(g.maxBuriedPct !== null)
    items.push({key:'buried', target:g.maxBuriedPct, actual:r2(ctx.buriedPct),
                ok:ctx.buriedPct <= g.maxBuriedPct});
  if(g.minPassRatio !== null)
    items.push({key:'pass', target:g.minPassRatio, actual:r2(ctx.passPct),
                ok:ctx.passPct >= g.minPassRatio});
  if(g.lockLoad)
    items.push({key:'load', target:r2(ctx.load0), actual:r2(ctx.load),
                ok:ctx.load >= ctx.load0});

  return { items, cleared: items.every(i => i.ok) };
}

/* the measured side of the scoring. The drop and pass figures are live, because
   they are properties of the configuration you are standing in. The buried share
   is the worst any wave of this pass actually met, because a flood you have since
   quietened still buried the alert while it was happening. */
function goalContext(runs){
  const M = model(), Nz = noise();
  const buried = GAME.waveLog.length
    ? Math.max(...GAME.waveLog.map(w => w.buriedP))
    : Nz.buriedP;
  return { asks:GAME.asks, runs, dropPct:M.dropP*100, buriedPct:buried*100,
           passPct:M.passRatio*100, load:S.load, load0:GAME.load0 };
}

function goalStatus(){
  const sc = activeScenario();
  if(!sc || GAME.phase !== 'over') return null;
  return scoreGoal(sc.goal, passResults(), goalContext(GAME.runs));
}

/* WHAT YOU CAN ALREADY SEE, before anything arrives.
 *
 * "検知 6/6・対処 ✗" is not a result, it is a property of what is standing —
 * evaluate() is a pure function, so it can be asked without running anything.
 * A scenario whose symptom is "we detect it and it does not stop" should open on
 * that sentence rather than on prose about it.
 *
 * Same shape as goalStatus() plus `projected:true`, and scored through the same
 * scoreGoal() so the two cannot disagree. It is a pull API: nothing pushes it,
 * because tuning happens in controls.js and never comes through this feed —
 * call it whenever you redraw (ui.js already polls model() every HUD tick).
 */
function projection(){
  const sc = activeScenario();
  if(!sc) return null;
  const results = evaluate(activeChain(), {response:hasResponse()});
  results.forEach(r => r.blame = blameOf(r));
  const st = scoreGoal(sc.goal, results, goalContext(Math.max(1, GAME.runs)));
  return { projected:true, results, ...st };
}

const score = () => passResults().filter(r => !r.response && r.caught).length;

/* ---------------------------------------------------------------- actions
   Everything here is available in the `between` phase as well as in `build`, and
   that is the feature: the gap between two waves is a real turn. The one thing
   the gap does NOT do is give you back a wave you have already lost. */

/* a move made between waves must not wipe the wave that just resolved, and a
   move made after the pass is over starts a fresh one */
function afterMove(){
  if(GAME.phase === 'over') resetPass();
  else if(GAME.phase === 'build'){ GAME.results = null; GAME.reveal = 0; }
}

function build(id){
  if(!canBuild(id) || GAME.built.has(id)) return false;
  GAME.built.add(id);
  applyGameVisibility();
  afterMove();
  if(id === 'sysdig') setMode('sysdig');
  notify({type:'build', id, unlock:UNLOCK[id] || ''});
  notifyNoise();
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

/* Satisfy one of the conditions a district declared and this situation did not
   meet. The district was already standing; this is the part that makes it work. */
function satisfy(id, req){
  const open = unmetOf(id);
  if(!open.includes(req)) return false;
  GAME.unmet[id] = open.filter(x => x !== req);
  afterMove();
  notify({type:'requirement', id, req, fixed:requirementById(id, req),
          remaining:unmetOf(id).length, unlock:working(id)});
  notifyNoise();
  return true;
}

/* the condition is on somebody else's district, so it costs what asking costs */
function requestSatisfy(id, req){
  if(!satisfy(id, req)) return false;
  GAME.asks++;
  notify({type:'asks'});
  return true;
}

/* what you may do about a district: build it, or fix what is unsatisfied on it.
   Whether it is yours decides whether doing so costs an ask, and that decision
   is one place rather than in every caller. */
const ownsDistrict = id => !GAME.on || !GAME.role || GAME.role === OWNER[id] || !OWNER[id];
const buildOrAsk   = id => ownsDistrict(id) ? build(id) : requestBuild(id);
const fixOrAsk     = (id, req) => ownsDistrict(id) ? satisfy(id, req) : requestSatisfy(id, req);

/* ---- the wave machine ---- */
function resetPass(){
  GAME.phase = 'build';
  GAME.wave = -1;
  GAME.waveLog = [];
  GAME.budget = null;
  GAME.results = null; GAME.reveal = 0; GAME.revealT = 0;
}

/* one wave arrives against whatever is standing right now */
function runWave(i){
  const waves = activeWaves();
  const w = waves[i];
  if(!w) return false;
  const last = i === waves.length - 1;
  GAME.wave = i;
  GAME.phase = 'running';
  GAME.results = evaluate(w.steps, {budget:GAME.budget, response: last && hasResponse()});
  /* blame is snapshotted at run time so it cannot drift if the tuning is
     changed while the results are still on screen */
  GAME.results.forEach(r => r.blame = blameOf(r));
  GAME.reveal = 0; GAME.revealT = 0;
  const Nz = noise();
  notify({type:'wave', index:i, of:waves.length, jp:w.jp, steps:w.steps.length,
          last, run:GAME.runs, noiseUtil:Nz.util, buriedP:Nz.buriedP});
  notify({type:'run'});          /* the panel redraws off this one */
  return true;
}

/* RUN means "let the next wave come". With the pass over it means "again", and
   that is what goal.maxRuns counts — brute force is a cost like any other. */
function runAttack(){
  if(GAME.phase === 'running') return false;
  if(GAME.phase !== 'between'){
    resetPass();
    GAME.runs++;
    GAME.budget = freshBudget();
    notify({type:'attack', run:GAME.runs, waves:waveCount()});
  }
  return runWave(GAME.wave + 1);
}

/* reveal one step at a time, driven from the frame loop */
function tickReveal(dt){
  if(!GAME.results || GAME.reveal >= GAME.results.length) return;
  GAME.revealT -= dt;
  if(GAME.revealT > 0) return;
  GAME.revealT = 0.62;
  GAME.reveal++;
  const done = GAME.reveal >= GAME.results.length;
  /* the state settles BEFORE anything is announced, so a listener that reads
     GAME.phase / goalStatus() on the last `reveal` sees the finished pass rather
     than one that is still running. Then the events go out in the order they
     happened: reveal(done) -> waveEnd -> over. */
  if(done) bankWave();
  notify({type:'reveal', done});
  if(done) announceWave();
}

/* the wave is resolved: bank it, and decide whether the estate gets a gap to
   repair itself in or the pass is finished and scored */
function bankWave(){
  const waves = activeWaves();
  const Nz = noise();
  GAME.waveLog.push({
    index:GAME.wave, jp:waves[GAME.wave] ? waves[GAME.wave].jp : '',
    results:GAME.results.slice(),
    hit:GAME.results.filter(r => !r.response && r.caught).length,
    of:GAME.results.filter(r => !r.response).length,
    dropP:model().dropP, buriedP:Nz.buriedP
  });
  GAME.phase = GAME.wave >= waves.length - 1 ? 'over' : 'between';
}

function announceWave(){
  const waves = activeWaves();
  const w = GAME.waveLog[GAME.waveLog.length-1];
  if(!w) return;
  const last = GAME.phase === 'over';
  notify({type:'waveEnd', index:w.index, of:waves.length, jp:w.jp,
          hit:w.hit, steps:w.of, last, phase:GAME.phase,
          dropP:w.dropP, buriedP:w.buriedP});
  if(last){
    const st = goalStatus();
    notify({type:'over', run:GAME.runs, score:score(), cleared:!!(st && st.cleared)});
  }
}

/* the SOC queue moved because of something the player did in the campaign. Tuning
   does not come through here (controls.js owns those widgets), so anything that
   wants the live figure polls noise() — this is only for the discrete moves. */
function notifyNoise(){
  const Nz = noise();
  notify({type:'noise', util:Nz.util, inflow:Nz.inflow, cap:Nz.cap,
          buriedP:Nz.buriedP, over:Nz.util > 1});
}

/* a scenario may fix the role, and then this is not yours to change */
function setRole(id){
  if(GAME.roleLocked) return false;
  GAME.role = id;
  notify({type:'role', id});
  return true;
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
    /* whatever the situation is, it comes from a scenario file */
    startScenario(GAME.scenario || DEFAULT_SCENARIO_ID);
  } else {
    GAME.built = new Set(DISTRICTS.map(d => d.id));
    GAME.unmet = {};             /* explore mode shows the finished city working */
    resetPass();
    applyGameVisibility();
    applyShield();
  }
  notify({type:'mode', mode:m});
}

export {
  GAME,
  DEPS,
  BUILD_ORDER,
  UNLOCK,
  CHAIN,
  stepById,
  RESPONSE,
  REQUIREMENTS,
  requirementsOf,
  requirementById,
  openRequirements,
  negatedSyscalls,
  blindSyscalls,
  SCENARIOS,
  DEFAULT_SCENARIO_ID,
  scenarioById,
  activeScenario,
  activeEnv,
  activeChain,
  activeWaves,
  waveCount,
  hasResponse,
  startScenario,
  allowedDeploys,
  allowedDrivers,
  goalStatus,
  projection,
  passResults,
  SIDES,
  sideById,
  ROLES,
  roleById,
  OWNER,
  LEVER_OWNER,
  canUseLever,
  loadLocked,
  canBuild,
  ownsDistrict,
  evaluate,
  freshBudget,
  blameOf,
  noiseBlame,
  roleReport,
  verdictText,
  score,
  build,
  requestBuild,
  buildOrAsk,
  satisfy,
  requestSatisfy,
  fixOrAsk,
  runAttack,
  runWave,
  resetPass,
  tickReveal,
  setRole,
  setSide,
  setUiMode,
  applyGameVisibility,
  frontier
};
