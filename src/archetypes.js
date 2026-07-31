/* ARCHETYPES — 業種。どのレバーが主役かを変えるプリセット。
 *
 * 自由モードは「① 業種を選ぶ → ② 環境を設定する → ③ 守り方を決める → ④ テストを流す
 * → ⑤ 本番に出す」で進む（.claude/handoffs/GAME-DESIGN.md §2）。このファイルは ① です。
 *
 * ------------------------------------------------------------------ 何であって、何でないか
 *
 * 業種は **負荷プロファイルと制約の束** です。因果の書き換えではありません
 * （INVARIANTS.md が正）。ここに宣言できるのは「この業種の環境はこういう形をしている」
 * だけで、その形から何が起きるかを決めるのは既存のモデルの側です:
 *
 *   ・`buf_size_preset` はバーストにだけ効く（1.3）        → ゲーム基盤でだけ主役になる
 *   ・正の `custom_set` はカバレッジを奪えない（2.1/2.3）   → 業種で変わらない
 *   ・クラウド API は別ソースで相関しない（3.9）            → 業種で変わらない
 *   ・Sysdig を足しても検知は1段も増えない（5.2）           → 業種で変わらない
 *
 * つまり業種が触れるのは「入力の量」と「選べるものの範囲」と「達成条件」の3つだけです。
 * 4業種で別々の断面が主役になるのは、この3つの置き方だけで出しています:
 *
 *   Web サービス   syscall 量が多い → **持続的な入力超過**。アラートも多いのでノイズの圧が高い
 *   金融決済       **規制**。ドロップは見逃しではなく違反。`ignore` を選べない。対処が要件
 *   ゲーム基盤     負荷が波打つ → **バースト**。`buf_size_preset` が効く唯一の場面
 *   製造業         **更新できない**。古いカーネル・特権制約・分離。使えるレバーが最初から少ない
 *
 * ------------------------------------------------------------------ 規律（schema.js と同じ）
 *
 *   1. **純データ。** 関数・クロージャ・`THREE` 参照・`undefined` を持たない。
 *      `JSON.parse(JSON.stringify(x))` で不変であること（`ARCHETYPE_ERRORS` が機械検査する）。
 *      Unity 版と英語版が後から来るので、これは加算コストゼロの保険です。
 *      **export される純関数はデータではないので対象外** — データ側に関数を持たせないという話。
 *   2. **文言はデータ側。** ロジックに文字列を埋め込まない。下の `jp` / `blurb` / `why` /
 *      `lesson` が player-facing のすべてで、それ以外の場所に文を置ける隙間はありません。
 *   3. **import しない。** このファイルは他のどのモジュールにも依存しません
 *      （`node -e "import('./src/archetypes.js')"` が通ること）。環境や地区の id は
 *      **文字列で参照**します。参照先が実在するかの検査は、その表を持っているレーンの仕事です
 *      （districts.data.js §DEPLOYMENTS / campaign.js §DEPS・§CHAIN）。
 *   4. **業種を1つ足すのに他のファイルを触らずに済むこと。** `DISTRICTS` と `SCENARIOS` で
 *      2回やった規律と同じです。下の配列に1エントリ足すのが全部。
 *
 * ------------------------------------------------------------------ フィールド
 *
 *   id            string    安定キー。`[a-z0-9-]+`
 *   jp            string    ピッカーに出る名前
 *   order         number    ピッカーの並び
 *   blurb         string    1〜2文の導入。選択時に出す
 *   lesson        string    この業種が教えるもの。debrief に出す1文
 *
 *   lever         主役のレバー。**演出ではなく、下の数値から実際にそうなること**
 *     .star       string    falco.yaml 上の名前（表示用）
 *     .key        string    `TUNE_DEFAULTS` のキー、または `env` / `estate`
 *     .owner      string    役割 id（campaign.js §ROLES）。レバーには持ち主がいる
 *     .ineffective string[] **効かないレバー**。ここが飾りを殺す: Web に
 *                           `buf_size_preset` を書くのは「効かない」と宣言するため
 *     .why        string    なぜそれが主役なのか
 *
 *   load          負荷プロファイル
 *     .base       number    本番の `NODE LOAD`。テストはステージ側が倍率で下げる
 *     .burstiness number    0..1。**波打ち具合。** `buf_size_preset` が効くかを決める量
 *     .spike      number    ピーク時に base の何倍まで行くか
 *     .why        string
 *   ※ `burstiness` / `spike` には **まだモデル側の入口がありません**（BOARD §2 `D20`）。
 *     いまの `model()` の burst 項は `util` からの近似で、外から波打ち具合を与えられない。
 *     宣言だけ先に置いてあるのは、入口ができた瞬間に業種側を書き直さずに済ませるため。
 *     **この3つのキー名は固定です**（`load.burstiness` / `load.spike` /
 *     `alerts.perNodeMul`）。ルールレーンが受け入れ側をこの名前に合わせているので、
 *     改名するときは `CONTRACT-datalayer.md` §2 と同時に動かしてください。
 *     GAP は `scripts/harness/cases-data.mjs` が記録しています（赤にはしません —
 *     受け入れ口はルールレーンの持ち物）。
 *
 *   alerts        ノイズ機構（state.js §noise `buried = 1 - 処理能力/流入`）への入力
 *     .perNodeMul number    1ノードが出すアラート量の係数
 *     .why        string
 *   ※ これも **入口がありません**（BOARD §2 `D21`）。いまの `noise()` は
 *     `SOC.perNode * S.nodes * S.load` で、業種ごとの係数を受け取れない。
 *     いまはノード数と負荷でしか表現できないので、下の `estate` がその代役です
 *     （Web を 8 ノードにしてあるのはそのため）。
 *
 *   estate        資産の形。ノード数とノードの大きさは**別の軸**（INVARIANTS 3.6）
 *     .nodes      number    既定のノード数。アラート量に効く
 *     .cpus       number    1ノードの vCPU 数。**バッファ数に効く**
 *     .lockCpus   boolean   true = ノードを大きくできない（製造業）
 *     .why        string
 *
 *   env           環境の制約。②「環境を設定する」で選べる範囲
 *     .named      string    既定の名前付き環境 id（districts.data.js §NAMED_ENVS の `env`）
 *     .namedAllowed string[]  選べる名前付き環境。空 = 制約なし
 *     .axes       object    軸ごとの制約。`{ forced, allowed, forbidden }` のいずれか。
 *                           軸 id は `orch` / `nodeOs` / `socket` / `k8sMeta` / `driver`
 *     .why        object    軸 id -> 理由。**制約には必ず理由を書く**
 *
 *   policy        ④ ポリシー層の制約（DESIGN-freeplay-flow.md §3）
 *     .tune       object    `TUNE_DEFAULTS` のキー -> `{ forced, forbidden, default }`
 *     .districts  object    `{ forbidden:[地区 id] }`。建てられない地区
 *     .unsatisfiable string[]  `"<地区>:<条件>"`。**建てても満たせない条件**
 *                           （campaign.js §REQUIREMENTS の id）。製造業の
 *                           `falcoctl:follow-refs` がこれ — 分離網なので追従できない
 *     .why        object    キー -> 理由
 *
 *   stack         ③ 守り方。**どちらかが常に正解にはしない**
 *     .favoured   string    'oss' | 'sysdig' | 'either'
 *     .ossViable  boolean   OSS 自前で達成条件に届くか
 *     .why        string
 *
 *   middleware    ミドルウェア構成。**脆弱性カタログ（src/vulns.js）が使う**
 *     [].id/.jp/.kind/.patchable/.why
 *
 *   goal          達成条件。schema.js §goal と同じキー・同じ意味（そのまま渡せる）
 *                 detect / contain / maxAsks / maxDropPct / maxBuriedPct /
 *                 minPassRatio / maxRuns / lockLoad
 *
 *   insight       ④→⑤ の誤診に足す1行（stages.js が前半を持つ）
 *     .truth      string
 *
 * ------------------------------------------------------------------ 数値の出どころ
 *
 * 下の `load.base` / `estate` / `goal` は当てずっぽうではなく、**このリポジトリの
 * モデルを回して選んだ実測値**です。各業種のコメントに「既定で何%になり、主役の
 * レバーで何%になり、主役でないレバーでは直らない」を実測で書いてあります。
 * 数値を動かすときは、その関係が壊れていないかだけ見てください（絶対値は自由）。
 */

/* ============================================================
   the four
   ============================================================ */
const ARCHETYPES = [

  /* ---------------------------------------------------------- Web サービス
     実測（nodes 8 / cpus 8 / modern_ebpf / load 2.2）:
       既定             util 1.419 · sustained 29.55% · drop 30.10% · buried 65.87%
       + custom_set     util 0.568 · drop  0.00%  ← **直る**
       + buf_size 10    util 1.419 · drop 29.64%  ← **直らない**（INVARIANTS 1.3）
       + cpusPerBuf 8   util 1.224 · drop 18.67%  ← 足りない
     テスト（load ×0.22 = 0.484 / nodes 1）: drop 0.00% · buried 0.00% · 6/6 */
  {
    id:'web-service',
    jp:'Web サービス',
    order:10,
    blurb:'短命プロセスが大量に立ち、<code>openat</code> と <code>connect</code> が支配的。'+
          'syscall もアラートも多い。<b>入力が消費能力を超え続ける</b>のがこの業種の既定状態。',
    lesson:'持続的な入力超過はリングバッファを大きくしても直らない。'+
           '<b>入力を絞るか、消費能力を上げるか</b>の2つしかない。',
    lever:{
      star:'base_syscalls.custom_set',
      key:'syscallSet',
      owner:'sre',
      ineffective:['buf_size_preset','cpus_for_each_buffer'],
      why:'落ちているのは<b>持続的な入力超過</b>（<code>1 - 消費能力/入力</code>）なので、'+
          'バッファを大きくしても満杯になるまでの時間が伸びるだけで、失う割合は同じ。'+
          '効くのは入力そのものを減らすレバーだけ。'
    },
    load:{ base:2.2, burstiness:0.15, spike:1.3,
      why:'常時高く、波は小さい。イベント時にスパイクするのではなく<b>ずっと多い</b>。' },
    alerts:{ perNodeMul:1.6,
      why:'短命プロセスが多い環境はルールの誤検知率がそのまま量になる。'+
          '<b>ノイズで埋もれる圧が4業種で一番高い。</b>' },
    estate:{ nodes:8, cpus:8, lockCpus:false,
      why:'水平に伸ばして捌く形。<b>ノードを増やすとアラートも増える</b>が、'+
          '溢れているノードのバッファは1つも増えない（INVARIANTS 3.6）。' },
    env:{
      named:'managed-k8s',
      namedAllowed:['self-managed-k8s','managed-k8s','managed-k8s-cos','managed-k8s-aks'],
      axes:{ orch:{ forbidden:['none'] } },
      why:{ orch:'この規模を1台のホストでは運用しないので、スタンドアロンは選べない。'+
                 'それ以外の制約は無い — Web は<b>どこにでも置ける</b>のが特徴。' }
    },
    policy:{
      tune:{},
      districts:{ forbidden:[] },
      unsatisfiable:[],
      why:{}
    },
    stack:{ favoured:'either', ossViable:true,
      why:'アラート量が多いので争点は<b>SOC の処理能力</b>。Sysdig を載せれば相関で捌けるが、'+
          'OSS でも<b>incubating / sandbox を追わない</b>（09 を建てない）と決めれば'+
          '流入は収まる。<b>検知を1本諦めるか、処理能力を買うか</b>の選択になる。' },
    middleware:[
      { id:'nginx', jp:'nginx', kind:'reverse-proxy', patchable:true,
        why:'外向きの入口。ここの脆弱性は最初に突かれる' },
      { id:'nodejs', jp:'Node.js', kind:'runtime', patchable:true,
        why:'依存が多く、供給網側から入る経路がある' },
      { id:'redis-cache', jp:'Redis（キャッシュ）', kind:'cache', patchable:true,
        why:'セッションを持つので、抜かれると横に広がる' }
    ],
    /* detect 5 of 7 is the OSS ceiling, measured: narrowing base_syscalls closes
       the drop side, and what remains is the queue. Keeping the incubating
       artifacts flowing puts the queue at 42% buried, so the OSS answer is to
       NOT follow them — which costs the `imds` detection — and one more step
       still goes to the queue. Sysdig's correlation clears the queue and keeps
       all seven. **Both stacks clear; they pay differently.** */
    /* MEASURED, not asserted — cases-data.mjs re-measures every number here.
       `mode` names which of the two drop failure modes dominates (INVARIANTS 1.3). */
    evidence:{ mode:'sustained', defaultDropPct:30.10, defaultBuriedPct:65.87,
               fixedDropPct:0.00,
               ineffectiveDropPct:{ 'buf_size_preset':29.64, 'cpus_for_each_buffer':18.67 } },
    goal:{ detect:5, contain:false, maxAsks:3, maxDropPct:5, maxBuriedPct:20,
           minPassRatio:null, maxRuns:null, lockLoad:true },
    insight:{
      truth:'この業種の負荷は<b>持続超過</b>なので、テストの低負荷では絶対に出ない。'+
            'そして本番では<b>アラート量も同時に</b>効く。'
    }
  },

  /* ---------------------------------------------------------- 金融決済
     実測（nodes 4 / cpus 8 / modern_ebpf / load 1.6）:
       既定             util 1.032 · sustained 3.13% · drop 3.36% · buried 34.84%
       + buf_size 8     drop 3.20%   ← **直らない**（sustained が主項）
       + cpusPerBuf 8   util 0.890 · drop 0.12%  ← **直る**（INVARIANTS 1.4 の向き）
       + custom_set     drop 0.00% だが passRatio 16.80% → `minPassRatio:40` で**却下**
       + Sysdig         buried 0.00%（cap 40 → 84）
     テスト（load ×0.22 = 0.352 / nodes 1）: drop 0.00% · buried 0.00% · 6/6 */
  {
    id:'fintech-payments',
    jp:'金融決済',
    order:20,
    blurb:'監査ログの保持が要件で、<b>ドロップは見逃しではなくコンプライアンス違反</b>。'+
          '落ちたことを <code>ignore</code> で黙らせる選択肢が最初から無い。',
    lesson:'規制がある環境では「絞って軽くする」も「黙って捨てる」も選べない。'+
           '残るのは<b>消費能力を買う</b>ことだけ。',
    lever:{
      star:'engine.<engine>.cpus_for_each_buffer',
      key:'cpusPerBuf',
      owner:'sre',
      ineffective:['buf_size_preset','syscall_event_drops.actions'],
      why:'ドロップ上限が厳しく、<code>base_syscalls</code> を絞る道は'+
          '<b>監査カバレッジの下限</b>（<code>minPassRatio</code>）で塞がっている。'+
          'Docs の推奨どおり <b>バッファを少なく大きく</b>して消費能力を上げるのが残る手'+
          '（INVARIANTS 1.4）。'
    },
    load:{ base:1.6, burstiness:0.25, spike:1.6,
      why:'決済は時刻で波打つが振幅は小さい。<b>常時そこそこ高い</b>。' },
    alerts:{ perNodeMul:1.0,
      why:'ワークロードの種類が固定されているので誤検知は少ない。'+
          'ただし<b>アラートを捨てられない</b>ので、処理能力を超えたら人が溺れる。' },
    estate:{ nodes:4, cpus:8, lockCpus:false,
      why:'台数は絞って1台を大きく。監査のために全ノードのログが揃っていることが要件。' },
    env:{
      named:'managed-k8s',
      namedAllowed:['self-managed-k8s','managed-k8s','managed-k8s-aks'],
      axes:{
        orch:{ forbidden:['none'] },
        k8sMeta:{ forced:'on' },
        driver:{ forbidden:['nodriver'] }
      },
      why:{
        orch:'<code>k8saudit</code> の入力が無い構成は選べない — '+
             '「誰が API サーバに何をしたか」が監査対象そのもの。',
        k8sMeta:'監査証跡はワークロード名で追えなければ意味がない。'+
                '<code>k8smeta</code> プラグインが無いと <code>k8s.deployment.name</code> は '+
                '<code>&lt;NA&gt;</code>（INVARIANTS 3.7）。',
        driver:'カーネル経路が無いと syscall 由来の証跡が1件も残らない。'
      }
    },
    policy:{
      tune:{
        dropAction:{ forbidden:['ignore','exit'], default:'alert' }
      },
      districts:{ forbidden:[] },
      unsatisfiable:[],
      why:{
        dropAction:'<code>syscall_event_drops.actions</code> に <code>ignore</code> は選べない — '+
                   '<b>落ちたことを記録しないのは違反</b>で、しかも黙って盲目になる。'+
                   '<code>exit</code> も選べない: エージェントが止まれば検知はゼロになり、'+
                   '<b>監査が途切れたことそのもの</b>が事故になる（INVARIANTS 1.6）。'
      }
    },
    stack:{ favoured:'sysdig', ossViable:false,
      why:'保持・遡及・対処が<b>要件</b>なので、自前で建てるなら通知先・保存・検索・'+
          '応答を全部建てることになる。いまのモデルでは<b>止める手</b>（応答）が '+
          '08 にしか無いので、<code>goal.contain</code> がある業種は Sysdig 側になる。'+
          '<b>OSS が届かないのではなく、建てる量が要件に追いつかない。</b>' },
    middleware:[
      { id:'postgresql', jp:'PostgreSQL', kind:'database', patchable:true,
        why:'台帳そのもの。停止時間の交渉が一番重い' },
      { id:'jvm', jp:'Java / JVM', kind:'runtime', patchable:true,
        why:'決済アプリの本体。ライブラリの脆弱性が積み上がる' },
      { id:'kafka', jp:'Kafka', kind:'queue', patchable:true,
        why:'取引の流れ。ここが止まると決済が止まるのでパッチが後回しになる' }
    ],
    evidence:{ mode:'sustained', defaultDropPct:3.36, defaultBuriedPct:34.84,
               fixedDropPct:0.12,
               ineffectiveDropPct:{ 'buf_size_preset':3.17,
                                    'syscall_event_drops.actions':3.36 } },
    goal:{ detect:6, contain:true, maxAsks:4, maxDropPct:0.5, maxBuriedPct:15,
           minPassRatio:40, maxRuns:null, lockLoad:true },
    insight:{
      truth:'テストでは <code>syscall_event_drops</code> が1件も上がらないので'+
            '<b>コンプライアンス上は完璧に見える</b>。本番の実負荷で初めて上がる。'
    }
  },

  /* ---------------------------------------------------------- ゲーム基盤
     実測（nodes 4 / cpus 8 / modern_ebpf / load 1.5）:
       既定 buf 4       util 0.968 · sustained 0.00% · **burst 0.18%** · buried 32.99%
       + buf_size 7     burst 0.08%  ← **直る**（バーストにだけ効く · INVARIANTS 1.3）
       + buf_size 10    burst 0.03%
       + custom_set     drop 0.00% だが passRatio 16.80% → `minPassRatio:40` で**却下**
       + cpusPerBuf 1   util 1.052 · **drop 5.19% と悪化**（バッファを細かくすると負ける）
     util < 1 なので **sustained は 0**。落ちている分はすべてバースト由来 — この業種だけ。
     テスト（load ×0.22 = 0.33 / nodes 1）: drop 0.00% · buried 0.00% · 6/6 */
  {
    id:'game-platform',
    jp:'ゲーム基盤',
    order:30,
    blurb:'平常時は余裕がある。イベントとリリースで<b>負荷が波打つ</b>。'+
          '平均では収まっているのに、山の頂上でだけイベントが落ちる。',
    lesson:'平均が足りていても山で落ちる。<b>バーストはバッファで吸収できる</b> — '+
           'そして<b>持続超過はできない</b>。同じドロップに見えて原因が違う。',
    lever:{
      star:'buf_size_preset',
      key:'bufPreset',
      owner:'sre',
      ineffective:['base_syscalls.custom_set','cpus_for_each_buffer'],
      why:'入力は平均では消費能力に収まっている（<code>util &lt; 1</code>）ので、'+
          '失っているのは<b>山の分だけ</b>。バッファは山を吸収するので、'+
          '<b>ここでだけ <code>buf_size_preset</code> が本当に効く</b>。'+
          '入力を絞る道は監視カバレッジの下限で塞いである — <b>絞って逃げる場面ではない。</b>'
    },
    load:{ base:1.5, burstiness:0.85, spike:2.4,
      why:'ログイン・ランキング更新・マッチメイクが同時に来る瞬間がある。'+
          '<b>4業種で一番波打つ。</b>' },
    alerts:{ perNodeMul:1.15,
      why:'ワークロードは同じものが並ぶので誤検知の種類は少ない。'+
          'ただし台数が多いので総量は増える。' },
    estate:{ nodes:4, cpus:8, lockCpus:false,
      why:'ノードを並べて捌く形。<b>ノードを増やしてもバッファは増えない</b>のが'+
          'この業種で一番効く誤解（INVARIANTS 3.6）。' },
    env:{
      named:'self-managed-k8s',
      namedAllowed:['self-managed-k8s','managed-k8s','managed-k8s-cos','managed-k8s-aks'],
      axes:{ orch:{ forbidden:['none'] } },
      why:{ orch:'クラスタ前提。それ以外の制約は無い。'+
                 'COS ノード（<code>kmod</code> 不可）を選ぶかどうかも自由 — '+
                 'この業種の主役はドライバではない。' }
    },
    policy:{
      tune:{},
      districts:{ forbidden:[] },
      unsatisfiable:[],
      why:{}
    },
    stack:{ favoured:'either', ossViable:true,
      why:'守り方より <code>buf_size_preset</code> の設定が効く。'+
          'OSS なら 09 を建てない選択でノイズを抑え、Sysdig なら相関で捌く。'+
          '<b>どちらでも成立する。</b>' },
    middleware:[
      { id:'redis', jp:'Redis', kind:'cache', patchable:true,
        why:'セッションとランキング。落とせないのでパッチ窓が取りにくい' },
      { id:'game-server', jp:'ゲームサーバ（C++）', kind:'app', patchable:true,
        why:'自社製。メモリ安全性の問題が出ると悪用が直接来る' },
      { id:'mysql', jp:'MySQL', kind:'database', patchable:true,
        why:'課金と進行の保存先' }
    ],
    /* the only archetype whose `sustained` is 0: everything it loses is burst,
       which is the one place buf_size_preset is the answer (INVARIANTS 1.3) */
    evidence:{ mode:'burst', defaultDropPct:0.18, defaultBuriedPct:32.99,
               fixedDropPct:0.08,
               ineffectiveDropPct:{ 'base_syscalls.custom_set':0.00,
                                    'cpus_for_each_buffer':5.19 } },
    goal:{ detect:5, contain:false, maxAsks:3, maxDropPct:0.10, maxBuriedPct:20,
           minPassRatio:40, maxRuns:null, lockLoad:true },
    insight:{
      truth:'テストの負荷では山が消費能力に届かないので<b>バーストが再現しない</b>。'+
            '本番の山でだけ落ちる。'
    }
  },

  /* ---------------------------------------------------------- 製造業
     実測（nodes 2 / cpus 2 / **ebpf(legacy)** / load 1.0）:
       既定             util 1.287 · sustained 22.33% · drop 22.78%
       + buf_size 9     drop 22.43%  ← **直らない**
       + cpusPerBuf 1   util 1.383 · drop 28.21%  ← **悪化**
       + cpusPerBuf 4   drop 22.78%  ← buffers は ceil(2/4)=1 で既に1つ。**動かない**
       + custom_set     util 0.515 · drop 0.00%  ← **直る（唯一の手）**
     ノードを大きくすれば直るが `estate.lockCpus` で禁止（更新できない）。
     構成上の穴が最初から3つ: `orch:none` → API サーバ無し（`k8sapi` 不成立）／
     `plugins` 禁止 → クラウド段が原理的に不成立／`falcoctl:follow-refs` が満たせない
     → incubating の検知を持てない。**成立する上限が 7段中 4段。**
     テスト（load ×0.22 = 0.22 / nodes 1）: drop 0.00% · 4/6 — **穴はテストでも見える** */
  {
    id:'industrial-ot',
    jp:'製造業',
    order:40,
    blurb:'古いカーネル・特権の制約・ネットワーク分離。<b>更新できない</b>。'+
          'パッチという手がほぼ使えないので、<b>検知が唯一の統制</b>になる。',
    lesson:'選べるレバーが最初から少ない環境では、'+
           '<b>「守れる上限」自体が構成で決まっている</b>。'+
           'そこを知らずに全段検知を目標にすると、永久に届かない。',
    lever:{
      star:'環境そのもの',
      key:'env',
      owner:'platform',
      ineffective:['buf_size_preset','cpus_for_each_buffer'],
      /* THE DEADLINE IS NOT 2026-12-04 HERE. An earlier draft of this file put
         that date on the Falco probe; it belongs to the SYSDIG legacy eBPF
         driver (docs.sysdig.com · "This driver will be retired on December 4,
         2026."). Falco's legacy eBPF probe is a VERSION deadline instead:
         deprecated in 0.43.0, removed in 0.44.0 (falco.org/blog/falco-0-44-0 ·
         "The `engine.ebpf` configuration block and the corresponding `ebpf`
         engine kind have been removed."). Both are real, both are sourced, and
         they belong to different clocks — versions.js §DEPRECATIONS holds both
         and §LINES is where the distinction lives. Saying it wrong here would
         teach a date that does not exist. See BOARD §2 D2 / D3. */
      why:'ノードは 2 vCPU で、大きくできない。<code>kmod</code> は特権制約で挿せず、'+
          '<code>modern_ebpf</code> はカーネル 5.8 未満で動かないので'+
          '<b>legacy eBPF しか残っていない</b> — そして Falco はそれを '+
          '<b>0.43.0 で非推奨・0.44.0 で削除</b>した。'+
          'バッファを刻んでも消費能力は上がらない。'+
          '<b>残る手は入力を絞ることだけで、それは盲点を作る側の手</b>。'
    },
    load:{ base:1.0, burstiness:0.10, spike:1.15,
      why:'ラインは一定のリズムで回る。<b>波は小さいが、余裕も無い。</b>' },
    alerts:{ perNodeMul:0.7,
      why:'動いているものが変わらないので誤検知は少ない。'+
          '<b>ノイズはこの業種の負け筋ではない。</b>' },
    estate:{ nodes:2, cpus:2, lockCpus:true,
      why:'ライン制御機の隣に置かれた古い小さなサーバ。'+
          '<b>台数もサイズも増やせない</b> — 買い替えはライン停止を意味する。' },
    env:{
      named:'standalone',
      namedAllowed:['standalone'],
      axes:{
        orch:{ forced:'none' },
        nodeOs:{ forced:'generic' },
        socket:{ allowed:['reachable','unreachable'] },
        k8sMeta:{ forced:'off' },
        /* forced rather than allowed:['ebpf'] on purpose: with two of the three
           kernel drivers impossible here, this axis is not a lever any more, and
           `forcedAxisValue()` is what a caller asks to find that out. */
        driver:{ forced:'ebpf' }
      },
      why:{
        orch:'Kubernetes は無い。<code>systemd</code> の上の1プロセス。'+
             '<b>API サーバが無いので <code>k8saudit</code> の入力そのものが存在しない</b>'+
             '（INVARIANTS 3.8）。',
        nodeOs:'ベンダが検証した古いディストリビューションから動かせない。',
        socket:'コンテナランタイムがある機械とない機械が混ざっている。',
        k8sMeta:'apiserver が無いので <code>k8smeta</code> は繋ぐ相手がいない。',
        driver:'<code>kmod</code> は完全な権限を要求するので挿せない。'+
               '<code>modern_ebpf</code> は kernel ≥ 5.8 ＋ BTF が要るので'+
               'このカーネルでは動かない（INVARIANTS 3.3。'+
               '<b>ただし 5.8 は厳密な線ではなく</b>、厳密なのは BTF と '+
               'BPF リングバッファの有無 — 一次資料が両方そう書いています）。'+
               '<b>残るのは legacy eBPF だけで、Falco はそれを 0.44.0 で削除した。</b>'+
               '「上げないと詰む」がこの業種では最初から立っていて、'+
               'しかも<b>上げた先に乗るドライバが無い</b>のがこの業種の本当の行き止まり。'
      }
    },
    policy:{
      tune:{},
      districts:{ forbidden:['plugins','sysdig'] },
      unsatisfiable:['falcoctl:follow-refs'],
      why:{
        districts:'ネットワークが分離されているので、'+
                  '<b>クラウド API のイベントソースに繋げない</b>（07 プラグイン入力）。'+
                  'SaaS に出せないので 08 も建たない。'+
                  '別ソースの段は<b>構造的に</b>検知できない（INVARIANTS 3.9）。',
        unsatisfiable:'<code>falcoctl</code> は建てられるが、'+
                      '<b><code>artifact.follow.refs</code> の自動更新が通らない</b> — '+
                      'OCI レジストリに出ていく経路が無い。'+
                      '<b>入れた日のルールで止まる</b>ので、'+
                      'incubating / sandbox の新しい検知は増えない。'
      }
    },
    stack:{ favoured:'oss', ossViable:true,
      why:'SaaS に出せない構成なので OSS 自前が事実上の唯一解。'+
          '<b>ただし手数を全部自分で払う</b>ことになり、'+
          '止める手（応答）はこの構成では存在しない。' },
    /* FIVE components, and `patchable:false` on every one. This is where the
       archetype's difficulty comes from — not from a multiplier. src/vulns.js
       discloses 17 holes across these five and `patch.blocked` is true for all of
       them, so the backlog only ever grows and 検知 is the only control left
       (GAME-DESIGN §4 ① / §4 ⑤). The other three archetypes carry 12–16 holes
       and can close them. */
    middleware:[
      { id:'legacy-kernel', jp:'古いカーネル（5.8 未満）', kind:'os', patchable:false,
        why:'ベンダ検証済みの構成から動かせない。<b>パッチが使えない</b>の本体' },
      { id:'opcua-gateway', jp:'OPC UA ゲートウェイ', kind:'ot-protocol', patchable:false,
        why:'ライン停止なしに更新できない。脆弱性が積み上がる一方' },
      { id:'legacy-jvm', jp:'古い JVM', kind:'runtime', patchable:false,
        why:'アプリがそのバージョンでしか動かない。'+
            '<b>金融決済の JVM と同じ部品で、置かれ方だけが違う</b>' },
      { id:'modbus-bridge', jp:'Modbus ブリッジ', kind:'ot-protocol', patchable:false,
        why:'認証の概念が無い世代のプロトコル。検知でしか受けられない' },
      { id:'legacy-middleware', jp:'ベンダ製の生産管理ミドルウェア', kind:'appliance',
        patchable:false,
        why:'サポート契約の中でしか動かせない。'+
            '<b>修正版が出ていないので、依頼を何回積んでも当たらない</b>' }
    ],
    /* `mode:'config'`: the hole is the ENVIRONMENT, not the load — which is why
       this is the one archetype whose test run also fails (insight.truth) */
    evidence:{ mode:'config', defaultDropPct:22.78, defaultBuriedPct:0.00,
               fixedDropPct:0.00,
               ineffectiveDropPct:{ 'buf_size_preset':22.43,
                                    'cpus_for_each_buffer':22.78 } },
    goal:{ detect:4, contain:false, maxAsks:2, maxDropPct:5, maxBuriedPct:20,
           minPassRatio:null, maxRuns:null, lockLoad:true },
    insight:{
      truth:'この業種の穴は<b>負荷ではなく構成</b>なので、'+
            '<b>テストでも同じだけ抜ける</b>。'+
            'テストが全段通らないことに意味がある唯一の業種。'
    }
  }
];


/* ---------------------------------------------------------------- totality
   THIS MODULE NEVER THROWS. It returns an answer, or an empty one.
   Contract §1: a bad input is an error VALUE, not an exception. Fuzzing the
   eight files found the same shape in all of them — a collection argument that
   was not a collection. `str()` absorbs Symbol, which `String()` throws on. */
const arr = v => Array.isArray(v) ? v : [];
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const num = (v, d = 0) => Number.isFinite(v) ? v : d;
const str = v => typeof v === 'string' ? v
               : (v == null || typeof v === 'symbol') ? '' : String(v);

/* ============================================================
   lookups
   ============================================================ */
const ARCHETYPE_IDS = ARCHETYPES.map(a => a.id);
const archetypeById = id => ARCHETYPES.find(a => a.id === id) || null;
/* the picker order lives in the data, ties fall back to id — same as SCENARIOS */
const archetypesInOrder = () =>
  ARCHETYPES.slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));


/* ============================================================
   constraints, as predicates
   ------------------------------------------------------------
   Every question the environment editor and the tuning panel need to ask is a
   function of the declaration above, so no id of any archetype ever has to
   appear in a caller. That is the same property that keeps environment ids out
   of controls.js (districts.data.js §composeEnv): callers ask what is true.

   `axisRule` is the shape all three constraint kinds share:

     { forced:'x' }        the only value. The axis is not a lever here
     { allowed:['a','b'] } a whitelist
     { forbidden:['c'] }   a blacklist

   Absent means unconstrained, which is the common case — a constraint without a
   reason in `why` is a difficulty knob, and those are what make an archetype
   decoration instead of causality.
   ============================================================ */
const axisRule = (arch, axis) => (arch && arch.env && arch.env.axes && arch.env.axes[axis]) || null;

function ruleAllows(rule, valueId){
  if(!rule) return true;
  if(typeof rule.forced === 'string') return rule.forced === valueId;
  if(Array.isArray(rule.allowed))   return rule.allowed.includes(valueId);
  if(Array.isArray(rule.forbidden)) return !rule.forbidden.includes(valueId);
  return true;
}

/* may this archetype stand on this value of this environment axis */
const allowsAxisValue = (arch, axis, valueId) => ruleAllows(axisRule(arch, axis), valueId);
/* The value the archetype pins this axis to, or null when it is a free lever.
   A one-element allow-list is a pin too — a caller that has to know the
   difference is a caller that will read `forced` and quietly get the
   environment's default instead. */
const forcedAxisValue = (arch, axis) => {
  const rule = axisRule(arch, axis);
  if(!rule) return null;
  if(typeof rule.forced === 'string') return rule.forced;
  if(Array.isArray(rule.allowed) && rule.allowed.length === 1) return rule.allowed[0];
  return null;
};
/* narrow a list of axis values down to the ones this archetype can stand on.
   Takes the ids rather than the axis table, so districts.data.js does not have
   to be imported here (§規律 3). */
const axisValuesFor = (arch, axis, valueIds) =>
  arr(valueIds).filter(v => allowsAxisValue(arch, axis, v));

/* the driver is not one of the four environment axes but it is constrained the
   same way, and the node OS axis can forbid values underneath us too — so a
   caller has to intersect this with `composeEnv().blockedDrivers`. */
const allowsDriver = (arch, driverId) => allowsAxisValue(arch, 'driver', driverId);

/* named environments (districts.data.js §NAMED_ENVS `env`). An empty allow-list
   means "any", because that is a weaker claim than listing all of them and it
   does not go stale when a sixth environment lands. */
function allowsNamedEnv(arch, envId){
  const list = arch && arch.env ? arch.env.namedAllowed : null;
  if(!Array.isArray(list) || !list.length) return true;
  return list.includes(envId);
}

/* ---- policy levers -------------------------------------------------------
   The tuning panel asks this before offering a value. 金融決済 is the case
   that matters: `syscall_event_drops.actions: ignore` is not a hard mode, it
   is a compliance violation, and `exit` stops the agent (INVARIANTS 1.6). */
const tuneRule = (arch, key) => (arch && arch.policy && arch.policy.tune && arch.policy.tune[key]) || null;
const allowsTuneValue = (arch, key, value) => ruleAllows(tuneRule(arch, key), value);
const forcedTuneValue = (arch, key) => {
  const rule = tuneRule(arch, key);
  if(!rule) return null;
  if(typeof rule.forced === 'string') return rule.forced;
  if(Array.isArray(rule.allowed) && rule.allowed.length === 1) return rule.allowed[0];
  return null;
};
/* the levers this archetype hands over already set. Merged over TUNE_DEFAULTS
   by the caller, so an archetype only says what it changes. */
function tuneDefaultsFor(arch){
  const out = {};
  const table = obj(obj(obj(arch).policy).tune);
  for(const [key, rule] of Object.entries(table)){
    if(typeof rule.forced === 'string') out[key] = rule.forced;
    else if(rule.default !== undefined && rule.default !== null) out[key] = rule.default;
  }
  return out;
}

/* ---- districts ----------------------------------------------------------- */
const forbiddenDistricts = arch =>
  arr(obj(obj(obj(arch).policy).districts).forbidden).slice();
const allowsDistrict = (arch, id) => !forbiddenDistricts(arch).includes(id);

/* Conditions that stay unsatisfied no matter how many asks you spend
   (campaign.js §REQUIREMENTS). Declared as "<district>:<condition>" because the
   pair is the unit — `follow-refs` on falcoctl is the isolated network, and the
   same condition on a connected estate is just a to-do. Returned parsed so no
   caller has to know the encoding. */
function unsatisfiableRequirements(arch){
  const list = arr(obj(obj(arch).policy).unsatisfiable);
  return list.map(x => {
    const t = str(x);
    const cut = t.indexOf(':');
    return cut < 0 ? { district:t, req:null }
                   : { district:t.slice(0, cut), req:t.slice(cut+1) };
  });
}
/* the shape GAME.unmet / scenario start.unmet want: districtId -> [condition] */
function unmetFor(arch){
  const out = {};
  for(const u of unsatisfiableRequirements(arch)){
    if(!u.req) continue;
    (out[u.district] = out[u.district] || []).push(u.req);
  }
  return out;
}

/* ---- the estate --------------------------------------------------------- */
/* Node COUNT and node SIZE are different axes and neither stands in for the
   other (INVARIANTS 3.6), so they are returned together and never merged. */
const estateOf = arch => {
  const e = obj(obj(arch).estate);
  return { nodes:num(e.nodes, 1), cpus:num(e.cpus, 1), lockCpus:!!e.lockCpus };
};
/* 製造業 cannot buy a bigger node. Asking here rather than reading the flag
   keeps the reason in one place. */
const canResizeNode = arch => !(arch && arch.estate && arch.estate.lockCpus);

/* ---- what the archetype claims about its own levers ---------------------- */
/* `lever.ineffective` is the load-bearing half: a claim that a lever does NOT
   fix this archetype's failure mode is falsifiable, and that is what stops the
   four from being flavour text. The verification in the PR description walks
   exactly this list. */
const starLever = arch => (arch && arch.lever) || null;
const isIneffective = (arch, leverName) =>
  !!(arch && arch.lever && (arch.lever.ineffective || []).includes(leverName));

/* ------------------------------------------------------------------
   WHAT CHOOSING THIS COSTS YOU, BEFORE YOU CHOOSE IT.
   ------------------------------------------------------------------
   GATE-FREEPLAY V2: 「①〜④ の選択が、それぞれ何を変えるのか選ぶ前に読める」.
   The screen lane asked for the CONSEQUENCE of the choice rather than a
   description of it (BOARD §2 #S7), and it was right to: `blurb` and `lesson`
   tell you what the industry is like, not what happens when you pick it.

   Every number below is `evidence`, and every number in `evidence` was MEASURED
   against this repository's own model — the same values the comment block above
   each archetype carries, promoted out of comments so a screen can print them.
   `scripts/harness/cases-data.mjs` re-measures all of them, so a screen showing
   `evidence` cannot show a stale number: the harness goes red first.

   This returns data only. No sentence is assembled here — the screen decides how
   to lay `failureMode` / `fixedBy` / `notFixedBy` out, and the words come from
   the archetype's own `why` fields.
   ------------------------------------------------------------------ */
function leverBriefing(arch){
  if(!arch || !arch.lever) return null;
  const ev = arch.evidence || {};
  return {
    id:arch.id,
    /* ① what breaks by default, and how much */
    failureMode:{
      kind:ev.mode || null,                /* 'sustained' | 'burst' | 'config' */
      dropPct:ev.defaultDropPct ?? null,
      buriedPct:ev.defaultBuriedPct ?? null,
      why:arch.lesson
    },
    /* ② the lever that answers it, and who owns it */
    fixedBy:{
      star:arch.lever.star, key:arch.lever.key, owner:arch.lever.owner,
      dropPct:ev.fixedDropPct ?? null,
      why:arch.lever.why
    },
    /* ③ THE FALSIFIABLE HALF: levers that do NOT answer it, with the numbers.
       This is what stops an archetype being a difficulty slider — a player can
       try them and watch nothing happen. */
    notFixedBy:(arch.lever.ineffective || []).map(name => ({
      lever:name,
      dropPct:(ev.ineffectiveDropPct || {})[name] ?? null
    })),
    /* ④ what the industry forbids, so the picker can grey things out with a reason */
    constraints:{
      axes:Object.keys((arch.env && arch.env.axes) || {}).map(axis => ({
        axis, forced:forcedAxisValue(arch, axis),
        rule:arch.env.axes[axis], why:(arch.env.why || {})[axis] || null
      })),
      tune:Object.keys((arch.policy && arch.policy.tune) || {}).map(key => ({
        key, forced:forcedTuneValue(arch, key),
        rule:arch.policy.tune[key], why:(arch.policy.why || {})[key] || null
      })),
      districts:forbiddenDistricts(arch),
      unsatisfiable:unsatisfiableRequirements(arch),
      lockCpus:!canResizeNode(arch),
      why:{ districts:(arch.policy.why || {}).districts || null,
            unsatisfiable:(arch.policy.why || {}).unsatisfiable || null }
    },
    /* ⑤ what winning looks like here */
    goal:{...arch.goal},
    stack:{...arch.stack}
  };
}


/* ============================================================
   self-check — purity and shape
   ------------------------------------------------------------
   Same reasoning as scenarios/index.js: a broken entry must be visible without
   taking the game down. This runs at import time, costs nothing, and gives the
   registering lane a list to print. It checks only what this file can know —
   whether a named environment or a district id exists is the business of the
   lane that owns that table.
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
  out.push(`${path}: ${t} is not data — archetypes must stay portable to JSON`);
  return out;
}

const AXIS_IDS = ['orch','nodeOs','socket','k8sMeta','driver'];
const GOAL_KEYS = ['detect','contain','maxAsks','maxDropPct','maxBuriedPct',
                   'minPassRatio','maxRuns','lockLoad'];

function archetypeErrors(){
  const out = [];
  const seen = new Set();
  for(const arch of ARCHETYPES){
    const tag = arch && arch.id ? arch.id : '(missing id)';
    dataErrors(arch, tag, out);
    if(typeof arch.id !== 'string' || !/^[a-z0-9-]+$/.test(arch.id))
      out.push(`${tag}: id must be a lowercase-hyphen string`);
    if(seen.has(arch.id)) out.push(`${tag}: duplicate archetype id`);
    seen.add(arch.id);
    for(const k of ['jp','blurb','lesson']) if(!arch[k]) out.push(`${tag}: ${k} is required`);
    if(typeof arch.order !== 'number') out.push(`${tag}: order must be a number`);

    if(!arch.lever || !arch.lever.star || !arch.lever.key || !arch.lever.owner)
      out.push(`${tag}: lever needs star / key / owner`);
    if(!arch.lever || !Array.isArray(arch.lever.ineffective) || !arch.lever.ineffective.length)
      out.push(`${tag}: lever.ineffective must name at least one lever that does NOT fix this`);
    if(!arch.lever || !arch.lever.why) out.push(`${tag}: lever.why is required — a lever with no reason is a difficulty knob`);

    if(!arch.load || !(arch.load.base > 0)) out.push(`${tag}: load.base must be positive`);
    const burst = arch.load ? arch.load.burstiness : null;
    if(typeof burst !== 'number' || burst < 0 || burst > 1)
      out.push(`${tag}: load.burstiness must be 0..1`);
    if(!arch.alerts || !(arch.alerts.perNodeMul > 0))
      out.push(`${tag}: alerts.perNodeMul must be positive`);

    if(!arch.estate || !Number.isInteger(arch.estate.nodes) || arch.estate.nodes < 1)
      out.push(`${tag}: estate.nodes must be a positive integer`);
    if(!arch.estate || !Number.isInteger(arch.estate.cpus) || arch.estate.cpus < 1)
      out.push(`${tag}: estate.cpus must be a positive integer`);

    if(!arch.env || typeof arch.env.named !== 'string' || !arch.env.named)
      out.push(`${tag}: env.named is required`);
    if(arch.env && !allowsNamedEnv(arch, arch.env.named))
      out.push(`${tag}: env.named "${arch.env.named}" is not in env.namedAllowed`);
    const axes = (arch.env && arch.env.axes) || {};
    for(const axis of Object.keys(axes)){
      if(!AXIS_IDS.includes(axis)) out.push(`${tag}: unknown environment axis: ${axis}`);
      const rule = axes[axis];
      const kinds = ['forced','allowed','forbidden'].filter(k => rule[k] !== undefined);
      if(kinds.length !== 1)
        out.push(`${tag}: env.axes.${axis} needs exactly one of forced / allowed / forbidden`);
      if(Array.isArray(rule.allowed) && !rule.allowed.length)
        out.push(`${tag}: env.axes.${axis}.allowed is empty — nothing could be selected`);
      /* a constraint the player cannot explain is the definition of a fake
         difficulty setting, so the reason is mandatory */
      if(!arch.env.why || !arch.env.why[axis])
        out.push(`${tag}: env.why.${axis} is required — a constraint needs a reason`);
    }
    const tuneTable = (arch.policy && arch.policy.tune) || {};
    for(const key of Object.keys(tuneTable)){
      const rule = tuneTable[key];
      if(rule.forced === undefined && rule.forbidden === undefined && rule.allowed === undefined)
        out.push(`${tag}: policy.tune.${key} constrains nothing`);
      if(!arch.policy.why || !arch.policy.why[key])
        out.push(`${tag}: policy.why.${key} is required`);
    }
    if(forbiddenDistricts(arch).length && !(arch.policy.why && arch.policy.why.districts))
      out.push(`${tag}: policy.why.districts is required`);
    for(const u of unsatisfiableRequirements(arch)){
      if(!u.req) out.push(`${tag}: policy.unsatisfiable entries must read "<district>:<condition>"`);
      if(!(arch.policy.why && arch.policy.why.unsatisfiable))
        out.push(`${tag}: policy.why.unsatisfiable is required`);
    }

    if(!arch.stack || !['oss','sysdig','either'].includes(arch.stack.favoured))
      out.push(`${tag}: stack.favoured must be oss / sysdig / either`);
    if(!Array.isArray(arch.middleware) || !arch.middleware.length)
      out.push(`${tag}: middleware must list at least one component — the vulnerability catalogue reads it`);
    for(const m of arch.middleware || [])
      if(!m.id || !m.jp || typeof m.patchable !== 'boolean')
        out.push(`${tag}: middleware entries need id / jp / patchable`);

    const g = arch.goal || {};
    for(const k of Object.keys(g))
      if(!GOAL_KEYS.includes(k)) out.push(`${tag}: unknown goal field: ${k}`);
    if(g.detect === null || g.detect === undefined)
      out.push(`${tag}: goal.detect is required — an archetype has to say what winning looks like`);
    /* a containment goal is only reachable where the response component can be
       built at all (campaign.js §RESPONSE needs 08), so an archetype that
       forbids 08 and asks for containment is unwinnable by construction */
    if(g.contain && !allowsDistrict(arch, 'sysdig'))
      out.push(`${tag}: goal.contain is unreachable — policy.districts.forbidden excludes sysdig`);
    if(!arch.insight || !arch.insight.truth) out.push(`${tag}: insight.truth is required`);
  }
  return out;
}

const ARCHETYPE_ERRORS = archetypeErrors();
if(ARCHETYPE_ERRORS.length)
  console.error('archetypes: %d problem(s)\n  %s', ARCHETYPE_ERRORS.length,
                ARCHETYPE_ERRORS.join('\n  '));


export {
  ARCHETYPES,
  ARCHETYPE_IDS,
  ARCHETYPE_ERRORS,
  archetypeById,
  archetypesInOrder,
  allowsAxisValue,
  forcedAxisValue,
  axisValuesFor,
  allowsDriver,
  allowsNamedEnv,
  allowsTuneValue,
  forcedTuneValue,
  tuneDefaultsFor,
  allowsDistrict,
  forbiddenDistricts,
  unsatisfiableRequirements,
  unmetFor,
  estateOf,
  canResizeNode,
  starLever,
  isIneffective,
  leverBriefing
};
