/* STAGES — テストと本番の差。
 *
 * 自由モードの ④ と ⑤（.claude/handoffs/DESIGN-freeplay-flow.md §2 / §3）。
 *
 * ------------------------------------------------------------------ これが何のためにあるか
 *
 * この模型の元々の主張は **「パイプラインを持っていることと、それが機能していることは別」**
 * でした。**テスト→本番はそれをフェーズにしたもの**です。
 *
 *              テスト                          本番
 *   負荷       低い（検証環境）                 実負荷（業種のプロファイル）
 *   攻撃       既知の1波（自分で流す）           多波・自動・未知
 *   ノイズ     出ない（量が少なく埋もれない）     出る
 *   意味       設定が動くことの確認              それで守れるかの答え
 *
 * **作りたい状態は「テストで 6/6 だったのに本番で 5/6」。** そしてそれは
 * **新しい機構をひとつも足さずに**作れます。テストと本番で変えているのは4つだけで、
 * 残りは全部既存の因果がやります:
 *
 *   1. `load` を下げる       → `util = 入力/消費能力` が 1 を割るのでドロップが消える
 *   2. `nodes` を 1 にする   → `noise()` の流入がSOCの処理能力を下回るので埋もれない
 *   3. 波を1つにする         → 手番（`between`）が無い。設定が動くかを見るだけ
 *   4. 別ソースの段を外す     → 検証環境にクラウドの資格情報は無い
 *
 * **設定は1つも変えません。** だから「テストで通ったこと」が「本番で守れること」を
 * 保証しないことが、同じ構成の数値の差として出ます。ここが逆になると（テスト用に
 * チューニングを変えてしまうと）「テストは環境が違ったから」で説明が終わってしまい、
 * 教えたいものが消えます。
 *
 * ------------------------------------------------------------------ 規律（archetypes.js と同じ）
 *
 *   1. **純データ。** JSON 往復で不変（`STAGE_ERRORS` が機械検査する）
 *   2. **文言はデータ側**
 *   3. **import しない。** 業種は**引数で受け取る** — そうしておくと業種を1つ足すのに
 *      このファイルを触らずに済みます（`DISTRICTS` / `SCENARIOS` と同じ規律）
 *   4. 攻撃段の id（`exec` / `shadow` / …）は campaign.js §CHAIN のもの。
 *      **実在するかの検査はそちらのレーン**（campaign.js §referentialErrors が
 *      既に `unknown attack step` を出します）
 *
 * ------------------------------------------------------------------ フィールド
 *
 *   id          string   'test' | 'prod'
 *   jp/label    string   表示名
 *   order       number   進む順
 *   blurb       string   入場時の1〜2文
 *   meaning     string   このステージが答える問い
 *   promise     string   **このステージが保証しないもの。** テスト側が本体
 *
 *   load.mul    number   業種の `load.base` に掛ける倍率
 *   estate.nodes number|null  ノード数。null = 業種の既定
 *   estate.cpus  number|null  1ノードの vCPU 数。**null = 業種と同じ**。
 *                        検証環境でノードを小さくしないのは意図です:
 *                        大きさを変えるとバッファ数が変わってしまい（INVARIANTS 3.6）、
 *                        「同じ構成なのに結果が違う」が言えなくなります
 *   noise.expected boolean  ここでアラートが埋もれるか。**導出される予測**であって
 *                        スイッチではない — 実際に埋もれるかは `noise()` が決めます
 *   attack.known   boolean  既知の攻撃を自分で流すのか、来続けるのか
 *   attack.auto    boolean
 *   attack.response boolean 封じ込め段を含むか
 *   attack.waves   array    `[{ jp, steps:[CHAIN の段 id] }]`
 *   goal           object   業種の `goal` に**重ねる**差分。null は「見ない」
 *   insight        object   `{ wrong, truth }` — このステージの誤診
 */

/* ============================================================
   the two stages
   ============================================================ */
const STAGES = [

  /* ---------------------------------------------------------- ④ テスト
     検証クラスタ1ノード・低負荷・既知の1波。**設定が動くことの確認**。
     実測（4業種すべて）: `util < 0.4` · drop 0.00% · buried 0.00%。
     Web / 金融 / ゲーム基盤は 6/6 で通り、製造業だけ 4/6 になります —
     製造業の穴は負荷ではなく構成なので、テストでも同じだけ抜けます。 */
  {
    id:'test',
    jp:'テスト',
    label:'④ テストを流す',
    order:1,
    blurb:'検証クラスタに1ノード。<b>既知の攻撃を1波だけ自分で流す</b>。'+
          '設定が動いているかを見る段。',
    meaning:'建てた構成と設定が<b>意図どおり動くか</b>の確認。',
    promise:'<b>ここで通ることは、本番で守れることを意味しません。</b>'+
            '負荷が低く、ノードが1台で、来る攻撃が既知だから通っています。',
    load:{ mul:0.22,
      why:'検証環境の負荷。<code>util</code> が 1 を大きく下回るので'+
          '<b>リングバッファは溢れません</b> — 溢れないのは設定が正しいからではなく、'+
          '負荷が低いからです。' },
    estate:{ nodes:1, cpus:null,
      why:'検証クラスタは1ノード。<b>ノードの大きさは本番と同じ</b>にしてあります — '+
          'サイズを変えるとバッファ数が変わり（INVARIANTS 3.6）、'+
          '「同じ構成」と言えなくなるからです。' },
    noise:{ expected:false,
      why:'1ノードぶんのアラートは SOC の処理能力を下回るので<b>埋もれません</b>。'+
          'ノイズという機構が消えるのではなく、<b>入力が足りないので発火しない</b>だけ。' },
    attack:{
      known:true, auto:false, response:false,
      waves:[
        { jp:'既知の攻撃を1波流す',
          steps:['exec','shadow','cron','dropbin','imds','k8sapi'] }
      ]
    },
    /* containment is not part of a config smoke test, and the noise ceiling is
       not a claim you can make on one node — leaving them in would be scoring
       the test run on things it structurally cannot exercise. */
    goal:{ contain:false, maxBuriedPct:null, maxRuns:null },
    insight:{
      wrong:'テストで全段止まったのだから、この構成で守れている。',
      truth:'テストが保証したのは<b>設定が動くこと</b>だけ。'+
            '負荷・アラート量・攻撃の既知性という3つを同時に下げた条件で通っています。'
    }
  },

  /* ---------------------------------------------------------- ⑤ 本番
     業種の実負荷・実ノード数・多波・封じ込めあり。ここで初めて業種の
     負荷プロファイルとノイズ機構が効きます。
     実測（既定の構成のまま出した場合）:
       Web        drop 30.10% / buried 65.87% → **2段抜ける**
       金融決済    drop  3.36% / buried 34.84% → 上限 0.5% / 15% をどちらも超える
       ゲーム基盤  drop  0.18%（**バーストだけ**）/ buried 32.99%
       製造業      drop 22.78% → 成立する4段のうち1段をドロップが盗む */
  {
    id:'prod',
    jp:'本番',
    label:'⑤ 本番に出す',
    order:2,
    blurb:'実負荷・実ノード数。<b>攻撃は自動で来続ける</b>。'+
          'ここで初めて業種の負荷プロファイルとノイズが効く。',
    meaning:'<b>その設定で本当に守れるか</b>の答え。',
    promise:'ここで抜けた理由が、そのまま次に打つ手です。'+
            '<b>波の間は手番</b> — 建てる・チューニングを変える・依頼する。',
    load:{ mul:1.0,
      why:'業種の <code>load.base</code> そのまま。'+
          'Web は持続超過に、ゲーム基盤はバーストに、'+
          '金融決済はドロップ上限に、製造業は消費能力の不足に当たります。' },
    estate:{ nodes:null, cpus:null,
      why:'業種の既定のノード数。<b>ノードが増えるとアラートが増える</b>のに'+
          '溢れているノードのバッファは1つも増えません（INVARIANTS 3.6）。' },
    noise:{ expected:true,
      why:'実ノード数 × 実負荷のアラートが SOC のキューに入るので、'+
          '<b>本物が埋もれ始めます</b>。ここには <code>buf_size_preset</code> が無く、'+
          '入力を絞るか処理能力を上げるかの2つだけ（state.js §noise）。' },
    attack:{
      known:false, auto:true, response:true,
      waves:[
        { jp:'第1波 — 侵入と探索',        steps:['exec','shadow'] },
        { jp:'第2波 — 永続化と実行',      steps:['cron','dropbin'] },
        { jp:'第3波 — 資格情報とクラウド', steps:['imds','k8sapi','cloud'] }
      ]
    },
    goal:{},
    insight:{
      wrong:'テストで通ったのに本番で抜けた。設定が壊れたのか。',
      truth:'設定は1つも変わっていません。変わったのは<b>負荷とアラート量と攻撃</b>で、'+
            'そのどれもテストには無かったものです。'
    }
  }
];

const STAGE_IDS = STAGES.map(s => s.id);
const stageById = id => STAGES.find(s => s.id === id) || null;
const stagesInOrder = () => STAGES.slice().sort((a, b) => a.order - b.order);
const nextStageId = id => {
  const list = stagesInOrder();
  const at = list.findIndex(s => s.id === id);
  return at >= 0 && list[at+1] ? list[at+1].id : null;
};


/* ============================================================
   (archetype × stage) -> the numbers the engine actually reads
   ------------------------------------------------------------
   Pure functions of two declarations. `arch` comes in as an argument rather than
   by importing archetypes.js, so that adding a fifth archetype touches neither
   file (§規律 3).

   Everything below returns PLAIN DATA. The rules lane applies it; nothing here
   writes to S or GAME, because a data layer that mutates state cannot be tested
   without the engine and cannot be ported.
   ============================================================ */

/* The load and the estate. This is the whole of what makes test and production
   different on the drop / noise side — four numbers, and not one of them is a
   setting the player chose. */
function estateFor(arch, stageId){
  const stage = stageById(stageId);
  if(!arch || !stage) return null;
  return {
    load:  round4(arch.load.base * stage.load.mul),
    nodes: stage.estate.nodes ?? arch.estate.nodes,
    cpus:  stage.estate.cpus  ?? arch.estate.cpus,
    /* carried so the UI can say WHY it is not a lever here */
    lockCpus: !!arch.estate.lockCpus
  };
}
/* two decimals is what the panel shows; keeping the stored value at the same
   precision means the number the player reads is the number the model got */
const round4 = n => Math.round(n * 10000) / 10000;

/* The attack, in the shape scenarios/schema.js §attack wants, so the existing
   wave machine can walk it unchanged (campaign.js §activeWaves). */
function attackFor(arch, stageId){
  const stage = stageById(stageId);
  if(!stage) return null;
  return {
    auto:!!stage.attack.auto,
    response:!!stage.attack.response,
    waves:stage.attack.waves.map(w => ({ jp:w.jp, steps:w.steps.slice() }))
  };
}
/* every step that comes, flattened. The denominator of "6/6" and "5/6". */
const stepsFor = (arch, stageId) => {
  const stage = stageById(stageId);
  return stage ? stage.attack.waves.flatMap(w => w.steps.slice()) : [];
};

/* The goal: the archetype's thresholds with the stage's overrides on top.
   The archetype owns what winning looks like for that industry; the stage only
   removes the conditions it cannot exercise (a one-node smoke test cannot be
   scored on the SOC queue, and containment is not what it is checking). */
function goalFor(arch, stageId){
  const stage = stageById(stageId);
  if(!arch || !stage) return null;
  return { ...arch.goal, ...stage.goal };
}

/* The misdiagnosis this pair walks into: the stage's framing plus the
   archetype's own sentence about why its failure mode is invisible in test. */
function insightFor(arch, stageId){
  const stage = stageById(stageId);
  if(!arch || !stage) return null;
  return {
    id:`freeplay-${arch.id}-${stage.id}`,
    wrong:stage.insight.wrong,
    truth:[stage.insight.truth, arch.insight && arch.insight.truth]
            .filter(Boolean).join(' ')
  };
}

/* ------------------------------------------------------------------
   THE WHOLE THING, AS A SCENARIO.
   ------------------------------------------------------------------
   The engine already knows how to run a declaration of "this is the situation,
   this is what comes, this is what winning means" — that is scenarios/schema.js,
   and the wave machine, the scoring, the role locks and the debrief all hang off
   it. Free play does not need a second one of those. It needs to PRODUCE one.

   So this returns exactly the shape schema.js validates, and the rules lane can
   hand it to the same code path a hand-written scenario goes through. Two
   consequences worth stating:

     ・`validateShape()` and `referentialErrors()` check free play for free.
       An archetype that declares a goal its environment cannot reach fails the
       same way a broken content file does
     ・the nine hand-written scenarios stay untouched. This is a third entry
       point, not a change to theirs (DESIGN-freeplay-flow.md §4)

   `start.built` is empty on purpose: 自由モード is "you build it yourself", so
   the empty plot IS the situation. The one thing handed over is what the
   archetype cannot fix — 製造業's `falcoctl` follow that no ask will satisfy —
   and that only lands once the district is standing, so it is passed through
   `unmet` by the caller when it builds. See BOARD §2 #49.
   ------------------------------------------------------------------ */
function freeplayScenario(arch, stageId, opts = {}){
  const stage = stageById(stageId);
  if(!arch || !stage) return null;
  const shape = estateFor(arch, stageId);
  return {
    id:`freeplay-${arch.id}-${stage.id}`,
    title:`${arch.jp} · ${stage.jp}`,
    order:900 + arch.order + stage.order,
    blurb:`${arch.blurb} ${stage.blurb}`,
    env:{ type:opts.env || arch.env.named, nodes:shape.nodes, cpus:shape.cpus },
    start:{
      built:(opts.built || []).slice(),
      tune:{ ...(opts.tune || {}) },
      unmet:{ ...(opts.unmet || {}) },
      load:shape.load,
      driver:opts.driver ?? null,
      stack:opts.stack || (arch.stack.favoured === 'sysdig' ? 'sysdig' : 'oss')
    },
    player:{ side:'defense', role:opts.role ?? null, lockRole:!!opts.lockRole },
    attack:attackFor(arch, stageId),
    insight:insightFor(arch, stageId),
    goal:goalFor(arch, stageId)
  };
}

/* What changed between two stages, as data, so the debrief can say it without
   any layer re-deriving it. This is the sentence the whole feature exists for:
   the configuration is identical and these four things are not. */
function stageDelta(arch, fromId, toId){
  const a = estateFor(arch, fromId), b = estateFor(arch, toId);
  const from = stageById(fromId), to = stageById(toId);
  if(!a || !b || !from || !to) return null;
  return {
    from:from.id, to:to.id,
    load:{ from:a.load, to:b.load, mul:round4(b.load / a.load) },
    nodes:{ from:a.nodes, to:b.nodes },
    waves:{ from:from.attack.waves.length, to:to.attack.waves.length },
    steps:{ from:stepsFor(arch, fromId).length, to:stepsFor(arch, toId).length },
    noise:{ from:from.noise.expected, to:to.noise.expected },
    response:{ from:!!from.attack.response, to:!!to.attack.response },
    tuningChanged:false      /* by construction. THAT is the point */
  };
}


/* ============================================================
   self-check — purity and shape
   ============================================================ */
function dataErrors(v, path, out){
  if(v === null) return out;
  const t = typeof v;
  if(t === 'string' || t === 'boolean') return out;
  if(t === 'number'){
    if(!Number.isFinite(v)) out.push(`${path}: ${v} does not survive JSON`);
    return out;
  }
  if(Array.isArray(v)){
    v.forEach((x, i) => dataErrors(x, `${path}[${i}]`, out));
    return out;
  }
  if(t === 'object'){
    const proto = Object.getPrototypeOf(v);
    if(proto !== Object.prototype && proto !== null){
      out.push(`${path}: must be a plain object`);
      return out;
    }
    for(const [k, x] of Object.entries(v)) dataErrors(x, `${path}.${k}`, out);
    return out;
  }
  out.push(`${path}: ${t} is not data — stages must stay portable to JSON`);
  return out;
}

function stageErrors(){
  const out = [];
  const seen = new Set();
  for(const stage of STAGES){
    const tag = stage && stage.id ? stage.id : '(missing id)';
    dataErrors(stage, tag, out);
    if(typeof stage.id !== 'string' || !/^[a-z0-9-]+$/.test(stage.id))
      out.push(`${tag}: id must be a lowercase-hyphen string`);
    if(seen.has(stage.id)) out.push(`${tag}: duplicate stage id`);
    seen.add(stage.id);
    for(const k of ['jp','label','blurb','meaning','promise'])
      if(!stage[k]) out.push(`${tag}: ${k} is required`);
    if(typeof stage.order !== 'number') out.push(`${tag}: order must be a number`);
    if(!(stage.load && stage.load.mul > 0)) out.push(`${tag}: load.mul must be positive`);
    if(!stage.load.why) out.push(`${tag}: load.why is required`);
    if(!stage.estate) out.push(`${tag}: estate is required`);
    else {
      const n = stage.estate.nodes;
      if(!(n === null || (Number.isInteger(n) && n >= 1)))
        out.push(`${tag}: estate.nodes must be a positive integer or null`);
      const c = stage.estate.cpus;
      if(!(c === null || (Number.isInteger(c) && c >= 1)))
        out.push(`${tag}: estate.cpus must be a positive integer or null`);
    }
    if(!stage.noise || typeof stage.noise.expected !== 'boolean')
      out.push(`${tag}: noise.expected must be a boolean`);
    const at = stage.attack;
    if(!at || !Array.isArray(at.waves) || !at.waves.length)
      out.push(`${tag}: attack.waves needs at least one wave`);
    else {
      const flat = [];
      at.waves.forEach((w, i) => {
        if(!w.jp) out.push(`${tag}: attack.waves[${i}].jp is required`);
        if(!Array.isArray(w.steps) || !w.steps.length)
          out.push(`${tag}: attack.waves[${i}].steps must be a non-empty array`);
        else flat.push(...w.steps);
      });
      /* the same referential rule campaign.js enforces: a step cannot arrive
         twice in one pass, or the detection count stops meaning anything */
      if(new Set(flat).size !== flat.length)
        out.push(`${tag}: an attack step appears in more than one wave`);
    }
    if(!stage.insight || !stage.insight.wrong || !stage.insight.truth)
      out.push(`${tag}: insight.wrong / insight.truth are required`);
  }
  /* the whole point is a difference, so assert there IS one */
  const test = stageById('test'), prod = stageById('prod');
  if(!test || !prod) out.push('both a test and a prod stage have to exist');
  else {
    if(!(test.load.mul < prod.load.mul))
      out.push('test must run at a lower load than prod — otherwise the gap is not there');
    if(test.noise.expected)
      out.push('test must not expect noise — a validation cluster has too few alerts to bury one');
    if(!prod.noise.expected)
      out.push('prod must expect noise — that is the second way to lose');
    if(!(prod.attack.waves.length > test.attack.waves.length))
      out.push('prod must come in more waves than test — the gap between waves is the turn');
  }
  return out;
}

const STAGE_ERRORS = stageErrors();
if(STAGE_ERRORS.length)
  console.error('stages: %d problem(s)\n  %s', STAGE_ERRORS.length, STAGE_ERRORS.join('\n  '));


export {
  STAGES,
  STAGE_IDS,
  STAGE_ERRORS,
  stageById,
  stagesInOrder,
  nextStageId,
  estateFor,
  attackFor,
  stepsFor,
  goalFor,
  insightFor,
  freeplayScenario,
  stageDelta
};
