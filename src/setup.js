/* SETUP — the four choices that come before the game starts.
 *
 *     業種  ->  環境  ->  守り方  ->  ポリシー  ->  盤面
 *
 * GAME-DESIGN §2 ①〜④, on the §5.5 page shell. GATE-FREEPLAY V2 is the whole
 * point of this file: **each choice must be readable before you make it.** So
 * every option carries the consequence of picking it, in the option itself —
 * never in a tooltip, never on the next screen, never only in the debrief.
 *
 * WHERE THE WORDS COME FROM. Almost none of them are written here. archetypes.js
 * already declares `blurb` / `lesson` / `lever.why` / `load.why` / `alerts.why`
 * / `estate.why` / `env.why` / `stack.why`, policies.js declares `gain` and
 * `cost` on every maturity tier and `why` on every response action, and
 * districts.data.js declares `why` on every value of all four environment axes.
 * This file arranges them. The one table it does own is the OSS-vs-Sysdig
 * contrast on the 守り方 page: GAME-DESIGN §4 ③ has it, no module carries it,
 * and it is a comparison of two products rather than a property of the model.
 *
 * WHAT IS APPLIED TODAY, AND WHAT IS ONLY RECORDED. The rules lane has not built
 * the acceptance side yet (campaign.js has no setArchetype / setPolicy / stage
 * entry point). Rather than wait, this applies what the existing API can already
 * take —
 *
 *     環境      setEnv() per axis, and the archetype's estate through setDeploy
 *     守り方    setMode('oss' | 'sysdig')
 *
 * — and records the rest on SETUP, which is a plain serialisable object the rules
 * lane can read in one call. The requests are on BOARD as #S8. Nothing here
 * pretends a choice took effect when it did not.
 */
import { ARCHETYPES, archetypesInOrder, archetypeById,
         allowsAxisValue, forcedAxisValue, allowsDriver } from './archetypes.js';
import { MATURITY_TIERS, PRIORITIES, RESPONSE_ACTIONS, DROP_ACTIONS,
         POLICY_DEFAULT, priorityRank } from './policies.js';
import { ENV_AXES, ENV_SEL, DRIVERS, CLUSTER_NODES, NODE_CPUS } from './districts.data.js';
import { setEnv, setMode } from './controls.js';
import { openPage, closePage } from './page.js';


/* ---------------------------------------------------------------- the choice
   One plain object, no live references, so it survives JSON and so the rules
   lane can accept it without importing anything from the screen. */
const SETUP = {
  archetype: null,          // 'web-service' | ...
  env: {},                  // axis id -> value id
  nodes: CLUSTER_NODES,
  cpus: NODE_CPUS,
  driver: null,
  stack: null,              // 'oss' | 'sysdig'
  policy: {...POLICY_DEFAULT}
};
const setupChoice = () => JSON.parse(JSON.stringify(SETUP));

let onDone = null;          // where to go when the last page is finished

/* ---------------------------------------------------------------- helpers */
const esc = v => String(v == null ? '' : v);

/* an option the player can pick, with the consequence ON it. `pick` is the
   whole reason this file exists: V2 is not satisfied by a label. */
function optCard(o){
  return `<button class="opt${o.on ? ' on' : ''}${o.shut ? ' shut' : ''}"`
    + ` data-pick="${esc(o.value)}"${o.shut ? ' disabled' : ''}>`
    + `<div class="ot"><span class="on-t">${o.title}</span>`
    + (o.tag ? `<span class="otag">${o.tag}</span>` : '')
    + '</div>'
    + (o.body ? `<div class="ob">${o.body}</div>` : '')
    + (o.gain ? `<div class="og"><span class="lbl">選ぶと</span>${o.gain}</div>` : '')
    + (o.cost ? `<div class="oc"><span class="lbl">代わりに</span>${o.cost}</div>` : '')
    + (o.shutWhy ? `<div class="ow">${o.shutWhy}</div>` : '')
    + '</button>';
}

/* wire every .opt in the page body to a setter, then redraw the page */
function wirePicks(fn){
  const body = document.getElementById('pgBody');
  if(!body) return;
  body.querySelectorAll('.opt[data-pick]').forEach(b => b.onclick = () => fn(b.dataset.pick));
}

/* which values of one axis this archetype permits. Asked per value on purpose:
   axisValuesFor() takes the candidate ids as a third argument and returns [] if
   you forget it, which reads as "the archetype forbids everything". */
const allowedIn = (arch, ax) =>
  ax.values.filter(v => allowsAxisValue(arch, ax.id, v.id)).map(v => v.id);

const STEPS = ['業種', '環境', '守り方', 'ポリシー'];
const stepLabel = n => `step ${n} / ${STEPS.length} · ${STEPS[n-1]}`;


/* ================================================================ ① 業種
   Each archetype changes WHICH LEVER IS THE PROTAGONIST, and says so. The
   ineffective levers are named too — that is the half players get wrong, and it
   is the difference between four difficulty settings and four different
   problems. */
function pageArchetype(){
  const list = archetypesInOrder();
  const body = '<div class="opts2">' + list.map(a => optCard({
    value:a.id, on:SETUP.archetype === a.id,
    title:a.jp,
    tag:a.stack.favoured === 'oss' ? 'OSS 向き'
      : a.stack.favoured === 'sysdig' ? 'Sysdig 向き' : 'どちらでも',
    body:a.blurb,
    gain:`主役のレバーは <code>${a.lever.star}</code>。${a.lever.why}`,
    cost:`効かないのは <code>${a.lever.ineffective.join('</code> / <code>')}</code>。`
       + `既定の規模は ${a.estate.nodes} ノード × ${a.estate.cpus} CPU`
  })).join('') + '</div>'
  + '<div class="pgsec">この業種で最初に効く読み</div>'
  + '<div class="pggrid">' + list.map(a =>
      `<div class="pgmini${SETUP.archetype === a.id ? ' on' : ''}">`
      + `<b>${a.jp}</b>${a.lesson}</div>`).join('') + '</div>';

  openPage('setup-archetype', {
    kick:'setup', step:stepLabel(1),
    title:'どの<b>業種</b>を預かりますか。',
    body,
    foot:[
      { label:'次へ — 環境 →', kind:'go', hidden:!SETUP.archetype,
        onClick:()=> pageEnv() },
      { label:'← 説明に戻る', kind:'ghost', onClick:()=> closePage() }
    ],
    note:SETUP.archetype
      ? `選択中 · ${archetypeById(SETUP.archetype).jp}`
      : '業種が負荷・アラート量・規模・使えるレバーを決めます'
  });
  wirePicks(id => { applyArchetype(id); pageArchetype(); });
}

/* picking a業種 seeds everything downstream, because that is what a業種 IS */
function applyArchetype(id){
  const a = archetypeById(id);
  if(!a) return;
  SETUP.archetype = id;
  SETUP.nodes = a.estate.nodes;
  SETUP.cpus  = a.estate.cpus;
  SETUP.stack = a.stack.favoured === 'either' ? null : a.stack.favoured;
  SETUP.policy = {...POLICY_DEFAULT, ...(a.policy && a.policy.policy || {})};
  /* seed the axes from the archetype's named environment, then let the player
     move any axis the archetype does not forbid */
  SETUP.env = {};
  for(const ax of ENV_AXES){
    const forced  = forcedAxisValue(a, ax.id);
    const allowed = allowedIn(a, ax);
    SETUP.env[ax.id] = forced
      || (allowed.includes(ENV_SEL[ax.id]) ? ENV_SEL[ax.id] : allowed[0])
      || ax.values[0].id;
  }
  SETUP.driver = (DRIVERS.find(d => allowsDriver(a, d.id)) || DRIVERS[0]).id;
}


/* ================================================================ ② 環境
   The four orthogonal axes, each value carrying the `why` districts.data.js
   already declares. An axis the archetype fixes is shown fixed WITH ITS REASON
   rather than hidden — "why can I not choose this" is the actual question. */
function pageEnv(){
  const a = archetypeById(SETUP.archetype);
  const parts = [];
  for(const ax of ENV_AXES){
    const allowed = allowedIn(a, ax);
    const forced  = forcedAxisValue(a, ax.id);
    parts.push(`<div class="pgsec">${ax.lbl}</div>`);
    parts.push('<div class="opts2">' + ax.values.map(v => optCard({
      value:`${ax.id}:${v.id}`, on:SETUP.env[ax.id] === v.id,
      shut:!allowed.includes(v.id),
      title:v.jp || v.lbl,
      tag:forced === v.id ? '業種が固定' : '',
      body:v.why || '',
      shutWhy:allowed.includes(v.id) ? ''
        : `この業種では選べません。${(a && a.env && a.env.why && a.env.why[ax.id]) || ''}`
    })).join('') + '</div>');
  }
  parts.push('<div class="pgsec">規模</div>');
  parts.push(`<div class="pgline">ノード <b>${SETUP.nodes}</b> · CPU/ノード <b>${SETUP.cpus}</b>`
    + `${a ? ` — ${a.estate.why}` : ''}</div>`);

  openPage('setup-env', {
    kick:'setup', step:stepLabel(2),
    title:'どんな<b>環境</b>に載っていますか。',
    body:parts.join(''),
    foot:[
      { label:'次へ — 守り方 →', kind:'go', onClick:()=> pageStack() },
      { label:'← 業種に戻る', kind:'ghost', onClick:()=> pageArchetype() }
    ],
    note:'4つの軸は互いに独立です（INVARIANTS 3.11）'
  });
  wirePicks(k => {
    const [ax, v] = k.split(':');
    SETUP.env[ax] = v;
    pageEnv();
  });
}


/* ================================================================ ③ 守り方
   THE table. GAME-DESIGN §4 ③: detection does not differ — visibility, response
   and operations do. This is the one thing in this file the screen owns outright,
   because it compares two products rather than describing the model. */
const STACK_ROWS = [
  ['検知そのもの',        '同じ',                      '同じ'],
  ['止める手',            '<b>建てないと無い</b>',      '付いてくる'],
  ['ソース間の相関',      '<b>できない</b>',            'する'],
  ['保持・遡及・キャプチャ','自分で建てる',              'ある'],
  ['in-use 脆弱性の相関', '<b>分からない</b>',          '<b>in-use だけ浮く</b>'],
  ['予防（posture / admission）','別に建てる',           'ある'],
  ['依存',                '無い',                       'ある']
];

function pageStack(){
  const a = archetypeById(SETUP.archetype);
  const rows = STACK_ROWS.map(([k, oss, sd]) =>
    `<div class="cmprow"><span class="ck">${k}</span>`
    + `<span class="cv">${oss}</span><span class="cv sd">${sd}</span></div>`).join('');

  const body =
    '<div class="cmp">'
    + '<div class="cmprow head"><span class="ck"></span>'
    + '<span class="cv">Falco OSS 自前</span><span class="cv sd">Sysdig SaaS</span></div>'
    + rows + '</div>'
    + '<div class="pgline">OSS でも<b>同じところまで届きます</b>。建てる側が払うのは'
    + '<b>地区と依頼と運用</b>で、「Sysdig が優れている」ではなく'
    + '<b>あなたはどちらを払うか</b>です。</div>'
    + (a ? `<div class="pgsec">${a.jp} の場合</div><div class="pgline">${a.stack.why}</div>` : '')
    + '<div class="pgsec">選ぶ</div>'
    + '<div class="opts2">' + [
        { value:'oss', title:'Falco OSS を自分で建てる',
          body:'地区を建て、依頼を払い、運用を持つ。',
          gain:'依存が無い。全部自分で決められる',
          cost:'止める手・相関・保持は<b>建てないと存在しない</b>' },
        { value:'sysdig', title:'Sysdig の SaaS に載せる',
          body:'対処・相関・保持・in-use 相関が付いてくる。',
          gain:'建てる数が少なく、SOC の処理能力が上がる（相関）',
          cost:'依存が増えます。<b>検知そのものは増えません</b>' }
      ].map(o => optCard({...o, on:SETUP.stack === o.value,
            tag:a && a.stack.favoured === o.value ? `${a.jp} 向き` : ''})).join('')
    + '</div>';

  openPage('setup-stack', {
    kick:'setup', step:stepLabel(3),
    title:'<b>買う</b>か、<b>建てる</b>か。',
    body,
    foot:[
      { label:'次へ — ポリシー →', kind:'go', hidden:!SETUP.stack,
        onClick:()=> pagePolicy() },
      { label:'← 環境に戻る', kind:'ghost', onClick:()=> pageEnv() }
    ],
    note:SETUP.stack ? `選択中 · ${SETUP.stack === 'oss' ? 'Falco OSS 自前' : 'Sysdig SaaS'}`
                     : '検知は差がつきません。可視性と対処と運用が差になります'
  });
  wirePicks(v => { SETUP.stack = v; pageStack(); });
}


/* ================================================================ ④ ポリシー
   The detection-layer gate, and the other half of the trade `base_syscalls` makes
   in the kernel layer. Every tier states gain AND cost because that is the whole
   lesson: widening buries, narrowing misses, and the two belong to different
   teams (GAME-DESIGN §4 ④). */
function pagePolicy(){
  const P = SETUP.policy;
  const sec = (label, opts, key) =>
    `<div class="pgsec">${label}</div><div class="opts2">`
    + opts.map(o => optCard({...o, value:`${key}:${o.value}`,
                             on:P[key] === o.value})).join('') + '</div>';

  const body =
      sec('ルールセットの成熟度 — 検知エンジニアの持ち物', MATURITY_TIERS.map(t => ({
        value:t.id, title:t.jp,
        tag:t.needsArtifact ? '09 ルール配布が必要' : '既定で入っている',
        gain:t.gain, cost:t.cost
      })), 'maturity')
    + sec('priority しきい値 — これ未満は出さない', PRIORITIES.map(pr => ({
        value:pr.id, title:pr.jp,
        body:`これ以上の priority だけを出します`,
        cost:priorityRank(pr.id) < priorityRank('notice')
          ? '低い priority の検知は<b>出さない</b>ので、その分は見逃しになります'
          : '<b>量が増えます。</b>本物が埋もれる圧が上がります'
      })), 'minPriority')
    + sec('応答アクション', RESPONSE_ACTIONS.map(r => ({
        value:r.id, title:r.jp,
        tag:r.stops ? '攻撃を止める' : '止めない',
        body:r.why,
        cost:SETUP.stack === 'oss' && r.oss ? `OSS では <code>${r.oss}</code>` : ''
      })), 'response')
    + sec('ドロップ時の挙動 — syscall_event_drops.actions', DROP_ACTIONS.map(d => ({
        value:d.id, title:`<code>${d.id}</code>`,
        body:d.why || '',
        cost:d.id === 'ignore' ? '<b>黙って盲目になります</b>'
           : d.id === 'exit' ? '<b>検知が本当にゼロになります</b>' : ''
      })), 'dropAction');

  openPage('setup-policy', {
    kick:'setup', step:stepLabel(4),
    title:'どこまで<b>鳴らす</b>か。',
    body,
    foot:[
      { label:'この構成で始める →', kind:'go', onClick:finish },
      { label:'← 守り方に戻る', kind:'ghost', onClick:()=> pageStack() }
    ],
    note:'広げれば埋もれ、絞れば見逃す。<br>カーネル層（base_syscalls）とは<b>独立した関門</b>です'
  });
  wirePicks(k => {
    const i = k.indexOf(':');
    P[k.slice(0, i)] = k.slice(i + 1);
    pagePolicy();
  });
}


/* ---------------------------------------------------------------- finish
   Apply what the existing model can take, record the rest, and get out of the
   way. `onDone` is where the entrance wanted to go. */
function finish(){
  closePage();
  /* ORDER MATTERS, and it cost a round of testing to find out why. onDone()
     enters the board, which today means startScenario() — and that sets the
     environment from the scenario's own `env` and the stack from its
     `start.stack`. Applying the player's choices first meant watching them get
     overwritten one tick later: the setup said Sysdig and the board came up OSS.
     A choice silently discarded is worse than a choice not offered, so the
     choices go on AFTER the board exists and win.
     This is the seam where the rules lane's acceptance belongs (BOARD #S8):
     once a freeplay stage sets the estate from SETUP, this ordering hack goes. */
  if(typeof onDone === 'function') onDone();
  for(const ax of ENV_AXES){
    const v = SETUP.env[ax.id];
    if(v) setEnv(ax.id, v);
  }
  if(SETUP.driver) setEnv('driver', SETUP.driver);
  if(SETUP.stack) setMode(SETUP.stack === 'sysdig' ? 'sysdig' : 'oss');
}

/* entry point for the entrance: menu.js calls this instead of dropping the
   player straight onto the board */
function startSetup(done){
  onDone = done || null;
  if(!SETUP.archetype && ARCHETYPES.length) applyArchetype(archetypesInOrder()[0].id);
  pageArchetype();
}

window.__setup = { startSetup, setupChoice, SETUP,
                   pages:{ pageArchetype, pageEnv, pageStack, pagePolicy }, finish };

export { startSetup, setupChoice, SETUP };
