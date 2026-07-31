/* VERSIONS — the version ladder, and what each rung requires, grants and breaks.
 *
 * The backbone of the game is in-game TIME (.claude/handoffs/GAME-DESIGN.md §3).
 * You start on a very old agent and time drags you forward: new versions become
 * selectable, old drivers reach their retirement date, and every rung you climb
 * fixes one thing and breaks another.
 *
 * ---------------------------------------------------------------- we did not write this
 * NONE of the causality below is invented. It is the actual release history of
 * Falco and of the Sysdig agent, and every claim carries its primary source in
 * `src`. That is the whole reason this file is cheap: the content already exists,
 * it is verifiable, and it costs nothing to maintain. Where a source does not
 * exist the claim is not here — see §CLAIMS and §unsourced for what was left out
 * on purpose.
 *
 * ---------------------------------------------------------------- two words that are not the same
 * VERIFIED and REGISTERED are different states, and this file keeps them apart
 * because a screen that shows an unregistered claim to a customer is putting a
 * fact on stage before `npm test` can hold it down:
 *
 *   verified    a primary source says it. Every entry in §CLAIMS has one
 *   registered  INVARIANTS.md carries it, so the regression harness will notice
 *               when the model stops agreeing with it
 *
 * §CLAIMS is the index, `invariant` is the register entry or null, and
 * unregisteredClaims() lists what is verified-but-not-yet-registered. A UI that
 * must not show unfixed facts calls fixedOnly(). Nothing here decides that
 * policy; it only makes the state readable instead of implicit.
 *
 * src/policies.js carries the SAME five names for the same mechanism, on purpose
 * — the two files are parallel and a reader should not have to learn it twice. A
 * module that imports both has to alias one set:
 * `import { CLAIMS as POLICY_CLAIMS, isFixed as policyFactFixed } from './policies.js'`.
 *
 * ---------------------------------------------------------------- purity
 * PURE DATA + PURE FUNCTIONS. No functions inside the data, no closures, no
 * THREE, no DOM, no imports at all. Every table below survives
 * JSON.parse(JSON.stringify(x)) unchanged, which is what lets a Unity port and
 * an English build carry the tables across as-is (same rule as
 * src/scenarios/schema.js §purity).
 *
 * Dates are ISO strings, never Date objects, for the same reason.
 *
 * Player-facing text lives in the data (`jp`, `head`, `why`). The functions
 * assemble and compare; they never hold a sentence. So a Japanese string is a
 * data edit and never a logic edit.
 *
 * ---------------------------------------------------------------- one to add one
 * Adding a version is ONE entry in VERSIONS. Adding a retirement is one entry in
 * DEPRECATIONS. Nothing else in the repo has to be touched, and nothing here
 * knows how many entries there are:
 *
 *   - the ladder is the array order, so `nextStep()` follows from the data
 *   - what a version can do is accumulated UP the ladder by capabilitiesAt(),
 *     so a grant is declared once on the rung that introduced it
 *   - what breaks is declared on the rung that broke it, with `repairedBy`
 *     pointing at what puts it back
 *
 * ---------------------------------------------------------------- what is NOT here
 * The environment axes already own their facts and are not restated:
 *
 *   kmod impossible on COS      districts.data.js §NODE_OSES (INVARIANTS 3.1)
 *   which driver a place allows  districts.data.js §DEPLOYMENTS.drivers
 *   the <NA> field list itself   districts.data.js §K8S_METAS.naFields
 *
 * This file adds the axis those tables have no way to express: WHEN. Before
 * Falco 0.37 the workload names came from the built-in Kubernetes client and
 * needed no plugin at all, so `k8smeta: off` cost nothing. From 0.37 the same
 * selection is a silent hole. Same environment, different year, different answer
 * — and that is the whole game.
 */

/* ---------------------------------------------------------------- versions

   Rung shape:

     id         stable key. `<line>-<major.minor>`
     line       which agent this is a version of (§LINES)
     ver        the version string. `x.y.z`, compared numerically
     released   ISO date. THE TIME GATE: a rung you cannot see yet is not a
                choice you can make (timeline.js decides what "now" is)
     jp / head  what the player reads. `head` is the one line that says why this
                rung matters at all
     grants     capability ids this rung introduces (§CAPABILITIES). Accumulated
                upward, so a rung inherits everything below it
     breaks     what stops working when you arrive here (§break shape)
     cost       what climbing onto this rung costs while it happens (§COST)
     src        primary sources for everything on this rung

   Break shape — the load-bearing part of this file:

     id         stable key
     kind       'fields'    named fields start reading a placeholder
                'rules'     detections you had stop being loaded
                'config'    a setting you were using no longer exists
                'abi'       something else has to be re-deployed to match
                'driver'    a driver is gone
     jp         what the player sees
     why        the causal sentence. Why it broke, in terms of the model
     fields     for kind:'fields' — which fields, and what they now read
     repairedBy how to put it back, as data:
                  { needs:[capability ids], plugin, minVer, district, ask }
                null = there is no way back. That is a real state and the model
                has to be able to say it
     silent     true = nothing counts it. No drop counter moves, the HUD stays
                healthy, the rule simply never fires. These are the expensive
                ones, and most of the real ones are silent
*/
const VERSIONS = [
  {
    id:'falco-0.34', line:'falco', ver:'0.34.0', released:'2023-02-07',
    jp:'Falco 0.34', head:'modern eBPF プローブが載った。まだ実験的',
    grants:['modern_ebpf','falcoctl'],
    breaks:[],
    cost:{ rolling:true, redeployDriver:false, asks:[], blind:1 },
    src:['https://falco.org/blog/falco-0-34-0/'],
    notes:'CO-RE なのでカーネルヘッダが要らない（「NO MORE MISSING DRIVERS」）。'+
          'falcoctl がこのリリースで公式プロジェクトに昇格し、同梱された'
  },
  {
    id:'falco-0.35', line:'falco', ver:'0.35.0', released:'2023-06-07',
    jp:'Falco 0.35', head:'`base_syscalls` が生まれる。SRE のレバーはここから',
    grants:['base_syscalls','modern_ebpf_stable','metrics'],
    breaks:[
      { id:'plugin-abi-0.35', kind:'abi', silent:false,
        jp:'プラグイン ABI が両方向に非互換になる',
        why:'0.35 以降に出たプラグインは 0.34.1 以下で動かず、0.35 より前のプラグインは '+
            '0.35 以降で動かない。<b>片方だけ上げるという選択肢が無い</b> — '+
            'エージェントとプラグインを同時に入れ替えることになる。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:'plugins', ask:'detect' } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:['detect'], blind:1 },
    src:['https://falco.org/blog/falco-0-35-0/',
         'https://falco.org/blog/adaptive-syscalls-selection/'],
    notes:'`base_syscalls.custom_set` は正の記法と負の記法（`!syscall`）を持ち、'+
          '最終集合は「base set ∪ 有効なルールが要求する syscall」（INVARIANTS 2.1）。'+
          'つまり 0.35 より前には、流入を絞るレバーがそもそも存在しない'
  },
  {
    id:'falco-0.36', line:'falco', ver:'0.36.0', released:'2023-09-26',
    jp:'Falco 0.36', head:'ルールが成熟度で3つに割れ、同梱は stable だけになる',
    grants:['rule_maturity','rules_artifacts'],
    breaks:[
      { id:'default-ruleset-shrinks', kind:'rules', silent:true,
        jp:'既定で読まれるルールが減る',
        why:'ノイズを減らすため既定のルールファイルが縮み、'+
            '<b>いままで鳴っていた検知が incubating / sandbox 側に移った</b>。'+
            'アップグレードしただけで、持っていたはずの検知が手元から消える — '+
            '取り戻すには別の OCI アーティファクトを取得する（<b>09 ルール配布</b>）。',
        repairedBy:{ needs:['rules_artifacts'], plugin:null, minVer:null,
                     district:'falcoctl', ask:'detect' } },
      { id:'driver-loader-legacy', kind:'config', silent:false,
        jp:'kernel 4.x 系のドライバ取得が別イメージに分かれる',
        why:'古いカーネル向けのドライバ取得は <code>falco-driver-loader-legacy</code> に'+
            '分離された。<b>更新できないノードほど、上げたときの手順が増える</b>。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:'driver', ask:'platform' } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:['detect'], blind:1 },
    src:['https://falco.org/blog/falco-0-36-0/',
         'https://falco.org/docs/reference/rules/default-rules/'],
    notes:'これが src/policies.js §MATURITY_TIERS の下限。0.36 より前に「成熟度を選ぶ」は無い'
  },
  {
    id:'falco-0.37', line:'falco', ver:'0.37.0', released:'2024-01-30',
    jp:'Falco 0.37', head:'本体の Kubernetes クライアントが消える。ここが要石',
    grants:['k8smeta_arch'],
    breaks:[
      { id:'k8s-workload-fields-na', kind:'fields', silent:true,
        jp:'ワークロード名のフィールドが <NA> になる',
        why:'内蔵の Kubernetes クライアントが廃止され、'+
            '<code>k8s.deployment.name</code> 系は<b>非推奨になってルール中で <NA> を返す</b>。'+
            '生き残るのは <code>k8s.pod.*</code> と <code>k8s.ns.name</code> — '+
            '<b>出どころがコンテナランタイムだから</b>で、API サーバに聞いていたものだけが落ちる。'+
            'ルールは読み込まれていて、条件が <NA> と比較されるだけなので'+
            '<b>エラーもドロップも出ない</b>。',
        fields:['k8s.deployment.name','k8s.rs.name','k8s.svc.name','k8s.rc.name'],
        survives:['k8s.pod.name','k8s.pod.id','k8s.pod.uid','k8s.pod.sandbox_id',
                  'k8s.pod.label','k8s.pod.ip','k8s.pod.cni.json','k8s.ns.name'],
        reads:'<NA>',
        repairedBy:{ needs:['k8smeta_arch'], plugin:'k8smeta', minVer:'0.40.0',
                     district:'plugins', ask:'detect' } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:['detect'], blind:1 },
    src:['https://falco.org/blog/falco-0-37-0/',
         'https://github.com/falcosecurity/plugins/tree/main/plugins/k8smeta'],
    notes:'新しい経路は k8smeta プラグイン ＋ k8s-metacollector（別に建てるもの）。'+
          '<b>0.37〜0.39 は谷になる</b>: 本体クライアントは無く、'+
          'いま配られている k8smeta プラグインは 0.40.0 以上を要求する（repairedBy.minVer）'
  },
  {
    id:'falco-0.38', line:'falco', ver:'0.38.0', released:'2024-05-30',
    jp:'Falco 0.38', head:'falcoctl が環境を見てドライバを選ぶようになる',
    grants:['driver_autoselect'],
    breaks:[
      { id:'config-keys-0.38', kind:'config', silent:false,
        jp:'設定キーに破壊的変更が入る',
        why:'設定オプションに破壊的変更があるので、'+
            '<b>持ち込んだ falco.yaml がそのままでは通らない</b>。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:null, ask:'platform' } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:['platform'], blind:1 },
    src:['https://falco.org/blog/falco-0-38-0/'],
    notes:'0.38 のリリースノート自身の言い方は「falcoctl がシステムを判定して'+
          '最も互換なドライバを自動選択する（新しいカーネルなら modern eBPF）」。'+
          '「0.38 以降 modern_ebpf が既定」は INVARIANTS 3.1 の登録どおりに扱い、'+
          '現行ドキュメントは版を書かずに Modern eBPF を (default) と書いている'
  },
  {
    id:'falco-0.39', line:'falco', ver:'0.39.0', released:'2024-10-01',
    jp:'Falco 0.39', head:'ランタイムソケットの指定が CLI から設定ファイルへ移り始める',
    grants:['append_output','driver_autoselect_k8s'],
    breaks:[
      { id:'cri-flags-deprecated', kind:'config', silent:false,
        jp:'<code>--cri</code> / <code>--disable-cri-async</code> が非推奨になる',
        why:'コンテナランタイムの指定は <code>falco.yaml</code> 側でやるものになった'+
            '（非推奨は 0.39、削除は 0.40）。<b>放置して 0.40 に上がると'+
            'ランタイムソケットの指定が消え、container.* が付かなくなる</b>。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:null, ask:'platform' } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:[], blind:1 },
    src:['https://falco.org/blog/falco-0-39-0/']
  },
  {
    id:'falco-0.40', line:'falco', ver:'0.40.0', released:'2025-01-28',
    jp:'Falco 0.40', head:'いま配られている k8smeta プラグインの下限。ここで <NA> を戻せる',
    grants:['k8smeta_plugin','container_engines_config'],
    breaks:[
      { id:'cri-flags-removed', kind:'config', silent:false,
        jp:'<code>--cri</code> が削除される',
        why:'0.39 で非推奨になった CLI フラグがここで消える。'+
            '設定を移していなければ<b>上げた瞬間に指定が無効になる</b>。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:null, ask:'platform' } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:[], blind:1 },
    src:['https://falco.org/blog/falco-0-40-0/',
         'https://github.com/falcosecurity/plugins/tree/main/plugins/k8smeta'],
    notes:'k8smeta プラグインの README が要求するのは Falco >= 0.40.0。'+
          '0.37 で導入された当初の世代とは別で、<b>いま取得できるものはこの下限を持つ</b> — '+
          'つまり古いまま運用していると、直す部品の側が先に自分を置いていく'
  },
  {
    id:'falco-0.41', line:'falco', ver:'0.41.0', released:'2025-05-29',
    jp:'Falco 0.41', head:'コンテナ metadata もプラグインになる。k8smeta と同じ形が2度目',
    grants:['container_plugin'],
    breaks:[
      { id:'container-engines-config-dropped', kind:'config', silent:false,
        jp:'0.40 で入れた <code>container_engines</code> 設定が丸ごと消える',
        why:'コンテナサポートがプラグイン化され、'+
            '<b>0.40 で書いた設定はプラグインの init 設定に置き換わった</b>。'+
            '1つ前の版で正しかった書き方が、次の版で存在しない。',
        repairedBy:{ needs:['container_plugin'], plugin:'container', minVer:null,
                     district:null, ask:'platform' } },
      { id:'musl-loses-container-meta', kind:'fields', silent:true,
        jp:'静的（musl）ビルドでコンテナ metadata が付かなくなる',
        why:'musl ビルドはプラグインをロードできないので、'+
            '<b>コンテナ metadata のサポートを失う</b>。'+
            'container.* が空になるだけで、ルールは黙って評価され続ける。',
        fields:['container.name','container.image.repository','container.image.tag'],
        survives:['container.id','container.type'],
        reads:'<NA>',
        repairedBy:null },
      { id:'output-field-renames', kind:'config', silent:false,
        jp:'出力フィールド名が変わる',
        why:'<code>container_image</code> → <code>container_image_repository</code>、'+
            '<code>k8s_ns</code> → <code>k8s_ns_name</code>。'+
            '<b>下流の集計とダッシュボードが黙って空になる</b>。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:'outputs', ask:'soc' } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:['platform'], blind:1 },
    src:['https://falco.org/blog/falco-0-41-0/'],
    notes:'いまは Falco に同梱されているが、将来は falcoctl 経由で取得するものになると'+
          'リリースノートが明言している'
  },
  {
    id:'falco-0.42', line:'falco', ver:'0.42.0', released:'2025-10-22',
    jp:'Falco 0.42', head:'enter イベントを捨てて軽くなる。代わりに <code>evt.dir</code> が死ぬ',
    grants:['capture_on_detect','drop_enter'],
    breaks:[
      { id:'evt-dir-enter-dead', kind:'rules', silent:true,
        jp:'<code>evt.dir=\'&gt;\'</code> が何にもマッチしなくなる',
        why:'ユーザ空間が処理するイベントがほぼ半分になった代わりに、'+
            '<code>evt.dir=\'&gt;\'</code>（enter）は<b>何にもマッチしない</b>ようになった'+
            '（<code>\'&lt;\'</code> は警告つきで全部にマッチする）。'+
            'enter 方向で書いた自前ルールは<b>そのまま静かになる</b>。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:'rules', ask:'detect' } },
      { id:'plugin-schema-version', kind:'abi', silent:false,
        jp:'イベントスキーマ版を宣言していない古いプラグインが動かなくなる',
        why:'syscall イベントを読む古いプラグインのうち、'+
            '要求するイベントスキーマ版を宣言していないものは 0.42 以降と非互換。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:'plugins', ask:'detect' } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:['detect'], blind:1 },
    src:['https://falco.org/blog/falco-0-42-0/'],
    notes:'処理量が減るので、リングバッファ側の余裕は増える方向に効く'+
          '（この模型では消費能力ではなく流入側の話として扱う）'
  },
  {
    id:'falco-0.43', line:'falco', ver:'0.43.0', released:'2026-01-28',
    jp:'Falco 0.43', head:'legacy eBPF・gRPC 出力・gVisor エンジンに廃止予告が出る',
    grants:[],
    breaks:[
      { id:'deprecation-warnings-0.43', kind:'config', silent:false,
        jp:'廃止予告の警告が出るようになる',
        why:'legacy eBPF プローブ・gRPC 出力・gVisor libscap エンジンが'+
            '<b>このリリースで非推奨になった</b>。使い続けると警告が出る。'+
            '最短の廃止猶予は1リリースなので、<b>0.44.0 より前に消えることはない</b> — '+
            'つまり猶予は1回ぶんだけある。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:null, ask:null } }
    ],
    cost:{ rolling:true, redeployDriver:false, asks:[], blind:1 },
    src:['https://falco.org/blog/falco-0-44-0/',
         'https://github.com/falcosecurity/falco/blob/master/proposals/'+
         '20251215-legacy-bpf-grpc-output-gvisor-engine-deprecation.md']
  },
  {
    id:'falco-0.44', line:'falco', ver:'0.44.0', released:'2026-05-26',
    jp:'Falco 0.44', head:'legacy eBPF が本当に消える。ドライバも入れ直しになる',
    grants:[],
    breaks:[
      { id:'legacy-ebpf-removed', kind:'driver', silent:false,
        jp:'<code>engine.ebpf</code> と <code>ebpf</code> エンジン種別が削除される',
        why:'legacy eBPF プローブが Falco・libs・drivers・falcoctl から'+
            '<b>完全に削除された</b>。残る選択肢は Modern eBPF か kernel module の2つだけ。'+
            '<b>ここで詰む構成が実在する</b>: カーネルが古くて modern eBPF が動かず、'+
            'ノード OS が kmod を許さない場所には、もう乗るドライバが無い。',
        driver:'ebpf',
        repairedBy:{ needs:['modern_ebpf'], plugin:null, minVer:null,
                     district:'driver', ask:'platform' } },
      { id:'driver-api-bump-0.44', kind:'abi', silent:false,
        jp:'0.43 のドライバは 0.44 のユーザ空間と非互換',
        why:'ドライバ API が上がったので、'+
            '<b>kernel module も modern eBPF プローブも入れ直しになる</b>。'+
            'ノードごとのローリングで、その間そのノードの検知は落ちる。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:'driver', ask:'platform' } },
      { id:'grpc-output-removed', kind:'config', silent:false,
        jp:'gRPC 出力が削除される',
        why:'<code>grpc_output</code> / <code>grpc</code> 設定ブロックと gRPC 経路が'+
            '丸ごと消えた。<b>通知先をそこに向けていたなら、届く先が無くなる</b> — '+
            'HTTP 出力か falcosidekick に移す。',
        repairedBy:{ needs:[], plugin:null, minVer:null, district:'outputs', ask:'soc' } },
      { id:'gvisor-engine-removed', kind:'config', silent:false,
        jp:'gVisor エンジンが削除される',
        why:'<code>gvisor</code> エンジン種別と <code>engine.gvisor</code> 設定、'+
            '<code>--gvisor-generate-config</code> が削除された。',
        repairedBy:null }
    ],
    cost:{ rolling:true, redeployDriver:true, asks:['platform'], blind:2 },
    src:['https://falco.org/blog/falco-0-44-0/']
  }
];

/* ---------------------------------------------------------------- lines
   Which agent you are running versions OF. The choice itself is ③ 守り方
   (GAME-DESIGN §4③) and lives elsewhere; what belongs here is that the two
   lines have DIFFERENT CLOCKS, and that is the interesting part:

     Falco OSS    legacy eBPF stopped existing at 0.44.0 (2026-05-26). The
                  deadline is a VERSION, and you meet it by not upgrading —
                  until something else forces you up
     Sysdig       the legacy eBPF driver is retired on a DATE (2026-12-04),
                  announced in the docs. Standing still does not help

   `ladder:false` says this model has no sourced version history for that line,
   so it has no rungs — see §unsourced. It is not an empty ladder, it is the
   absence of one, and the difference matters when a UI asks what to show. */
const LINES = [
  { id:'falco', jp:'Falco OSS', ladder:true, start:'falco-0.34',
    why:'自分で建てる側。バージョンは自分で選び、廃止は<b>版で来る</b>' },
  { id:'sysdig-agent', jp:'Sysdig agent', ladder:false, start:null,
    why:'載せる側。ドライバの廃止は<b>日付で来る</b>（§DEPRECATIONS）ので、'+
        '止まっていることが答えにならない' }
];

/* ---------------------------------------------------------------- capabilities
   What a rung can DO, as ids, so that a requirement elsewhere can be written
   against a capability and never against a version number. Same discipline as
   districts.data.js: a name is not a reason.

   Accumulated upward by capabilitiesAt(): declared once on the rung that
   introduced it, and true on every rung above. */
const CAPABILITIES = [
  { id:'modern_ebpf',       jp:'modern eBPF プローブ',
    why:'CO-RE。カーネルヘッダ不要で BTF から動く' },
  { id:'modern_ebpf_stable',jp:'modern eBPF が実験的でなくなる', why:'' },
  { id:'falcoctl',          jp:'falcoctl 同梱',
    why:'ルールとプラグインを OCI アーティファクトとして取得・追従できる' },
  { id:'base_syscalls',     jp:'`base_syscalls`（適応的 syscall 選択）',
    why:'流入を絞るレバー。これが無い版では、SRE に打てる手が1つ少ない' },
  { id:'metrics',           jp:'内部メトリクス', why:'' },
  { id:'rule_maturity',     jp:'ルールの成熟度（stable / incubating / sandbox）',
    why:'同梱は stable だけ。残りは別のアーティファクト。src/policies.js の下限' },
  { id:'rules_artifacts',   jp:'ルールの OCI アーティファクト配布', why:'' },
  { id:'k8smeta_arch',      jp:'k8smeta プラグイン ＋ metacollector という構成',
    why:'内蔵クライアントの置き換え。建てるものが1つ増える' },
  { id:'k8smeta_plugin',    jp:'いま配られている k8smeta プラグインが動く',
    why:'プラグイン側が Falco >= 0.40.0 を要求する' },
  { id:'driver_autoselect', jp:'falcoctl がドライバを自動選択する', why:'' },
  { id:'driver_autoselect_k8s', jp:'k8s でドライバ設定を自動生成する', why:'' },
  { id:'append_output',     jp:'出力にフィールドを足せる', why:'' },
  { id:'container_engines_config', jp:'`container_engines` 設定ブロック',
    why:'0.41 で消える。1版だけ正しかった書き方' },
  { id:'container_plugin',  jp:'container プラグイン',
    why:'コンテナ metadata がプラグインになった。k8smeta と同じ形' },
  { id:'capture_on_detect',jp:'検知時のキャプチャ（.scap）',
    why:'OSS 側でも遡って見られるものが増える' },
  { id:'drop_enter',        jp:'enter イベントを処理しない',
    why:'ユーザ空間の処理量がほぼ半分になる。代償は evt.dir' }
];

/* ---------------------------------------------------------------- drivers
   The driver ids are the SAME ids districts.data.js §DRIVERS uses, on purpose:
   this table says when each one exists and what it needs, and that one says
   what the place allows. Neither restates the other.

     kernelMin   the version the docs name
     strict      false = the docs explicitly say it is NOT a hard cutoff. Sysdig
                 writes it out: the features can be backported, so a 5.4 kernel
                 may well run Universal eBPF. A model that hard-fails at 5.8
                 would be teaching something the source denies
     fromVer     the Falco version from which this driver exists
     removedIn   the Falco version that deleted it. null = still there
     retiredOn   a DATE, for the Sysdig line (§DEPRECATIONS carries the same
                 fact as a deadline object; this is the lookup side)             */
const DRIVER_LIFECYCLE = [
  { id:'modern_ebpf', jp:'Modern eBPF', line:'falco',
    kernelMin:'5.8', strict:false, needsBtf:true, needsRingbuf:true,
    fromVer:'0.34.0', removedIn:null, retiredOn:null,
    why:'カーネルヘッダもビルドも要らない。要るのは BTF と BPF リングバッファ。'+
        '<b>「5.8 以上なら普通は足りる」という書き方</b>で、厳密な線ではない',
    src:['https://falco.org/docs/concepts/event-sources/kernel/'] },
  { id:'ebpf', jp:'Legacy eBPF プローブ', line:'falco',
    kernelMin:'4.14', strict:true, needsBtf:false, needsRingbuf:false,
    fromVer:null, removedIn:'0.44.0', retiredOn:null,
    why:'0.43.0 で非推奨、<b>0.44.0 で削除</b>。Falco のドキュメントからも消えていて、'+
        '現行の選択肢は Modern eBPF と kernel module の2つだけ',
    src:['https://falco.org/blog/falco-0-44-0/',
         'https://falco.org/docs/concepts/event-sources/kernel/'] },
  { id:'kmod', jp:'Kernel module', line:'falco',
    kernelMin:'3.10', strict:true, needsBtf:false, needsRingbuf:false,
    fromVer:null, removedIn:null, retiredOn:null,
    why:'完全な権限が必要。<b>挿せない場所がある</b>のは node OS 軸の話'+
        '（districts.data.js §NODE_OSES · COS）',
    src:['https://falco.org/docs/concepts/event-sources/kernel/'] },
  { id:'universal_ebpf', jp:'Universal eBPF', line:'sysdig-agent',
    kernelMin:'5.8', strict:false, needsBtf:true, needsRingbuf:true,
    fromVer:null, removedIn:null, retiredOn:null,
    why:'Falco の modern eBPF に相当し、ドライバはエージェントに埋め込まれている'+
        '（INVARIANTS 5.4）。<b>5.8 を厳密には要求しない</b>と Sysdig の文書が明記していて、'+
        '必要な機能はより古いカーネルにバックポートできる',
    src:['https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/'] },
  { id:'sysdig_kmod', jp:'Sysdig kernel module', line:'sysdig-agent',
    kernelMin:'3.10', strict:true, needsBtf:false, needsRingbuf:false,
    fromVer:null, removedIn:null, retiredOn:null,
    why:'',
    src:['https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/'] },
  { id:'sysdig_legacy_ebpf', jp:'Sysdig legacy eBPF', line:'sysdig-agent',
    kernelMin:'4.14', kernelMax:'5.7', strict:true, needsBtf:false, needsRingbuf:false,
    fromVer:null, removedIn:null, retiredOn:'2026-12-04',
    why:'x86・カーネル 4.14〜5.7 向け。<b>2026-12-04 に廃止</b>される',
    src:['https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/'] }
];

/* ---------------------------------------------------------------- deadlines
   WHY THE PLAYER CANNOT JUST STAY PUT (GAME-DESIGN §3-3).

   Two retirements, two owners, two different shapes, and the model must not
   merge them — that is the correction this file carries:

     Falco     the legacy eBPF probe was deprecated in 0.43.0 and REMOVED in
               0.44.0 (2026-05-26). It is a version boundary. Sitting on 0.43
               keeps it working
     Sysdig    the legacy eBPF DRIVER "will be retired on December 4, 2026" —
               a date, in the agent docs, independent of any version you pick

   `endsOn` is the date the thing is gone. `by` is what you have to be on
   instead. `owner` is which line's clock this is. */
const DEPRECATIONS = [
  { id:'falco-legacy-ebpf', owner:'falco', kind:'driver', what:'ebpf',
    jp:'Falco の legacy eBPF プローブ',
    announcedIn:'0.43.0', removedIn:'0.44.0', endsOn:'2026-05-26',
    by:['modern_ebpf','kmod'],
    why:'非推奨は 0.43.0、削除は 0.44.0。<code>engine.ebpf</code> と '+
        '<code>ebpf</code> エンジン種別が消え、Modern eBPF か kernel module に移る以外に無い。',
    src:['https://falco.org/blog/falco-0-44-0/',
         'https://github.com/falcosecurity/falco/blob/master/proposals/'+
         '20251215-legacy-bpf-grpc-output-gvisor-engine-deprecation.md'] },
  { id:'sysdig-legacy-ebpf', owner:'sysdig-agent', kind:'driver',
    what:'sysdig_legacy_ebpf',
    jp:'Sysdig の legacy eBPF ドライバ',
    announcedIn:null, removedIn:null, endsOn:'2026-12-04',
    by:['universal_ebpf'],
    why:'ドキュメントが日付で廃止を告知している（2026-12-04）。'+
        '<b>Universal eBPF への移行が推奨</b>。バージョンを選ばない側の締切なので、'+
        '「上げない」では逃げられない。',
    src:['https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/'] },
  { id:'falco-grpc-output', owner:'falco', kind:'output', what:'grpc',
    jp:'Falco の gRPC 出力',
    announcedIn:'0.43.0', removedIn:'0.44.0', endsOn:'2026-05-26',
    by:['http','falcosidekick'],
    why:'0.44.0 で <code>grpc_output</code> ごと削除。<b>通知先の付け替えは SOC の仕事</b>。',
    src:['https://falco.org/blog/falco-0-44-0/'] },
  { id:'falco-gvisor-engine', owner:'falco', kind:'engine', what:'gvisor',
    jp:'Falco の gVisor libscap エンジン',
    announcedIn:'0.43.0', removedIn:'0.44.0', endsOn:'2026-05-26',
    by:[],
    why:'0.44.0 で削除。置き換えは別のソースプラグインとして扱う話になる。',
    src:['https://falco.org/blog/falco-0-44-0/'] }
];

/* ---------------------------------------------------------------- plugins
   The parts a break points at. `requiresVer` is the reason a repair can be out
   of reach on the very rung that broke the thing. */
const PLUGINS = [
  { id:'k8smeta', jp:'k8smeta プラグイン', requiresVer:'0.40.0',
    alsoNeeds:['k8s-metacollector'], needsCap:'apiServer',
    provides:['k8smeta.pod.name','k8smeta.ns.name','k8smeta.deployment.name',
              'k8smeta.rs.name','k8smeta.svc.name'],
    restores:'k8s-workload-fields-na',
    why:'apiserver 由来のフィールドを付け直す。<b>k8s-metacollector を別に建てる</b>のが条件で、'+
        'いま配られているものは Falco 0.40.0 以上を要求する',
    src:['https://github.com/falcosecurity/plugins/tree/main/plugins/k8smeta'] },
  { id:'container', jp:'container プラグイン', requiresVer:'0.41.0',
    alsoNeeds:[], needsCap:null,
    provides:['container.name','container.image.repository','container.image.tag'],
    restores:'container-engines-config-dropped',
    why:'コンテナ metadata の出どころ。0.41 の時点では Falco に同梱されているが、'+
        '将来は falcoctl 経由になるとリリースノートが書いている',
    src:['https://falco.org/blog/falco-0-41-0/'] }
];

/* ---------------------------------------------------------------- §CLAIMS
   THE REGISTER INDEX. One entry per causal claim this file rests on.

     id            stable key
     invariant     the INVARIANTS.md section that holds this claim down, or NULL
                   if the register does not carry it yet. `npm test` only guards
                   what is in the register, so null means "true, sourced, and
                   nothing will notice if the model drifts away from it"
     status        'registered'  in the register, and the register's wording is
                                 what the source says
                   'weak'        in the register, but the register says MORE than
                                 its cited source does. Treated as unfixed here
                   'verified'    a primary source says it; not in the register
     covers        the data ids in this file that depend on the claim
     src           the primary source. Every entry has one. A claim with no
                   source does not go in this file at all

   isFixed(id) answers "may a customer-facing screen state this as fact?" and
   fixedOnly() filters a list for a caller that must not show unfixed facts. Both
   are here rather than in the UI because the answer is a property of the claim.

   Everything below was checked against its primary source on 2026-07-31. The
   register lines to add are on BOARD §2 as D1–D6; when the inspection lane pins
   them, the only edit here is `invariant` and `status`. */
const CLAIMS = [
  { id:'release-dates', invariant:null, status:'verified',
    jp:'各バージョンのリリース日',
    covers:VERSIONS.map(v => v.id),
    src:['https://falco.org/blog/',
         'https://api.github.com/repos/falcosecurity/falco/releases'] },

  { id:'falco-0.37-k8s-client', invariant:'3.7', status:'registered',
    jp:'0.37 で本体の k8s クライアントが廃止され、旧 k8s.* が <NA> になる',
    covers:['k8s-workload-fields-na','k8smeta_arch'],
    src:['https://falco.org/blog/falco-0-37-0/'] },

  /* PM が確定として渡した2件のうち1件目。INVARIANTS に無い。
     一次資料は取れた: k8smeta の README が "This plugin requires Falco with
     version >= 0.40.0." と書いている。0.37 で導入された当初の世代の話ではなく、
     いま配られているものの下限。BOARD §2 D1。 */
  { id:'k8smeta-plugin-min-version', invariant:null, status:'verified',
    jp:'いま配られている k8smeta プラグインは Falco 0.40.0 以上を要求する',
    covers:['k8smeta','k8smeta_plugin'],
    src:['https://github.com/falcosecurity/plugins/tree/main/plugins/k8smeta'] },

  /* 2件目。INVARIANTS に無い。一次資料は取れたが、**持ち主が違っていた**:
     2026-12-04 は Sysdig の legacy eBPF ドライバの廃止日で、Falco の legacy
     eBPF プローブの話ではない。Falco 側は 0.43.0 で非推奨・0.44.0（2026-05-26）
     で削除。districts.data.js §DRIVERS の注記はこの日付を Falco のプローブに
     付けている（BOARD §2 D3）。BOARD §2 D2。 */
  { id:'sysdig-legacy-ebpf-retirement', invariant:null, status:'verified',
    jp:'Sysdig の legacy eBPF ドライバは 2026-12-04 に廃止される（日付の締切）',
    covers:['sysdig-legacy-ebpf','sysdig_legacy_ebpf'],
    src:['https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/'] },

  { id:'falco-legacy-ebpf-removal', invariant:null, status:'verified',
    jp:'Falco の legacy eBPF プローブは 0.43.0 で非推奨・0.44.0 で削除（版の締切）',
    covers:['falco-legacy-ebpf','legacy-ebpf-removed','deprecation-warnings-0.43','ebpf'],
    src:['https://falco.org/blog/falco-0-44-0/',
         'https://github.com/falcosecurity/falco/blob/master/proposals/'+
         '20251215-legacy-bpf-grpc-output-gvisor-engine-deprecation.md'] },

  { id:'driver-kernel-requirements', invariant:'3.3', status:'registered',
    jp:'kmod は kernel >= 3.10、modern eBPF は kernel >= 5.8 ＋ BTF ＋ BPF リングバッファ',
    covers:['modern_ebpf','kmod'],
    src:['https://falco.org/docs/concepts/event-sources/kernel/'] },

  /* PM が確定として渡した「5.8 で厳密に切れるわけではない」。INVARIANTS 3.3 は
     下限を登録しているが、厳密でないことは書いていない。一次資料は両方にある:
     Falco は「usually, all versions >=5.8 are enough」、Sysdig は
     "the probe does not strictly require kernel version 5.8" と明記。
     これが driverBlockers の soft/hard の分け方の根拠。BOARD §2 D4。 */
  { id:'kernel-minimum-not-strict', invariant:null, status:'verified',
    jp:'カーネル下限は厳密な線ではない（バックポート可）。'+
       '厳密なのは BTF と BPF リングバッファの有無',
    covers:['modern_ebpf.strict','universal_ebpf.strict'],
    src:['https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/',
         'https://falco.org/docs/concepts/event-sources/kernel/'] },

  { id:'universal-ebpf-equivalence', invariant:'5.4', status:'registered',
    jp:'Sysdig の Universal eBPF は Falco の modern eBPF に相当する',
    covers:['universal_ebpf'],
    src:['https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/'] },

  /* PM が確定として渡した「0.38 以降 modern_ebpf が既定」。INVARIANTS 3.1 は
     括弧書きで持っているが、**その行が引いている出典は GKE と kmod の話**で、
     版を名指ししていない。0.38 のリリースノート自身の言い方は「falcoctl が
     システムを判定して最も互換なドライバを自動選択する」で、現行の
     kernel drivers ページは版を書かずに Modern eBPF を (default) と書いている。
     よって status:'weak' — 登録はされているが、出典より強い。BOARD §2 D5。 */
  { id:'modern-ebpf-default-since-0.38', invariant:'3.1', status:'weak',
    jp:'0.38 以降 modern_ebpf が既定',
    covers:['driver_autoselect'],
    src:['https://falco.org/blog/falco-0-38-0/',
         'https://falco.org/docs/concepts/event-sources/kernel/'] },

  { id:'base-syscalls-union', invariant:'2.1', status:'registered',
    jp:'トレースする集合は base set ∪ 有効なルールが要求する syscall',
    covers:['base_syscalls'],
    src:['https://falco.org/blog/adaptive-syscalls-selection/'] },

  { id:'rule-maturity-tiers', invariant:'4.1', status:'registered',
    jp:'成熟度は3ファイルと 1:1、同梱は stable だけ',
    covers:['rule_maturity','rules_artifacts'],
    src:['https://falco.org/docs/reference/rules/default-rules/'] },

  /* 4.1 が登録しているのは「同梱は stable だけ」という**状態**で、
     「0.36 でそうなった（＝それまで鳴っていたものが手元から消えた）」という
     **遷移**は登録されていない。この時間軸の主張がこのゲームの進行そのものなので、
     別の claim として分けて未固定にしてある。BOARD §2 D8。 */
  { id:'default-ruleset-shrank-at-0.36', invariant:null, status:'verified',
    jp:'0.36 で既定のルールファイルが縮み、検知が incubating / sandbox 側に移った',
    covers:['default-ruleset-shrinks'],
    src:['https://falco.org/blog/falco-0-36-0/'] },

  { id:'plugin-abi-0.35', invariant:null, status:'verified',
    jp:'0.35 のプラグイン ABI は前後どちらとも非互換',
    covers:['plugin-abi-0.35'],
    src:['https://falco.org/blog/falco-0-35-0/'] },

  { id:'cri-config-move', invariant:null, status:'verified',
    jp:'ランタイム指定は CLI から falco.yaml へ（0.39 非推奨 → 0.40 削除）',
    covers:['cri-flags-deprecated','cri-flags-removed','container_engines_config',
            'config-keys-0.38','driver-loader-legacy'],
    src:['https://falco.org/blog/falco-0-39-0/','https://falco.org/blog/falco-0-40-0/',
         'https://falco.org/blog/falco-0-36-0/','https://falco.org/blog/falco-0-38-0/'] },

  { id:'container-plugin-0.41', invariant:null, status:'verified',
    jp:'0.41 でコンテナサポートがプラグイン化。設定は消え、musl はメタデータを失う',
    covers:['container_plugin','container','container-engines-config-dropped',
            'musl-loses-container-meta','output-field-renames'],
    src:['https://falco.org/blog/falco-0-41-0/'] },

  { id:'evt-dir-0.42', invariant:null, status:'verified',
    jp:'0.42 で enter イベントを処理しなくなり、evt.dir=\'>\' が何にもマッチしない',
    covers:['evt-dir-enter-dead','plugin-schema-version','drop_enter','capture_on_detect'],
    src:['https://falco.org/blog/falco-0-42-0/'] },

  { id:'driver-api-bump-0.44', invariant:null, status:'verified',
    jp:'0.44 でドライバ API が上がり、0.43 のドライバは入れ直しになる',
    covers:['driver-api-bump-0.44'],
    src:['https://falco.org/blog/falco-0-44-0/'] },

  { id:'grpc-gvisor-removal-0.44', invariant:null, status:'verified',
    jp:'0.44 で gRPC 出力と gVisor エンジンが削除される',
    covers:['grpc-output-removed','gvisor-engine-removed',
            'falco-grpc-output','falco-gvisor-engine'],
    src:['https://falco.org/blog/falco-0-44-0/'] }
];

/* the rung the game opens on. Very old on purpose: from here, `base_syscalls`
   does not exist yet, the ruleset is the big pre-0.36 one, and the built-in
   Kubernetes client is still handing you workload names for free. Every one of
   those three is taken away by climbing. */
const LADDER_START = { line:'falco', version:'0.34.0', id:'falco-0.34',
                       date:'2023-02-07' };

/* what climbing costs, before a rung's own `cost` overrides it. Illustrative
   numbers; the CLAIM is that it is never zero (GAME-DESIGN §3-2). */
const UPGRADE_COST = { rolling:true, redeployDriver:false, asks:[], blind:1 };


/* ================================================================ functions
   Pure. Nothing below reads a global, mutates an argument, or holds a sentence.
   `ctx` is always a plain object the caller assembles; this module never
   imports state.
   ================================================================ */

/* 'x.y.z' compared numerically. Returns <0, 0, >0. Missing parts are 0, so
   '0.40' and '0.40.0' compare equal. */
function compareVer(a, b){
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for(let i = 0; i < len; i++){
    const d = (pa[i] || 0) - (pb[i] || 0);
    if(d) return d < 0 ? -1 : 1;
  }
  return 0;
}
const verAtLeast = (a, b) => compareVer(a, b) >= 0;

/* ISO dates as strings compare correctly with < and >, which is the reason they
   are strings. Wrapped anyway so a caller never has to know that. */
const dateAtLeast = (a, b) => String(a) >= String(b);
const DAY_MS = 86400000;
const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const byVersionId = id => VERSIONS.find(v => v.id === id) || null;
const lineById    = id => LINES.find(l => l.id === id) || null;
const capabilityById = id => CAPABILITIES.find(c => c.id === id) || null;
const driverById  = id => DRIVER_LIFECYCLE.find(d => d.id === id) || null;
const pluginById  = id => PLUGINS.find(p => p.id === id) || null;
const deprecationById = id => DEPRECATIONS.find(d => d.id === id) || null;

/* the ladder for a line, in release order. This IS the array order — declaring
   a rung in the wrong place is the only way to get it wrong, and the sort makes
   even that harmless. */
const ladder = (line = 'falco') =>
  VERSIONS.filter(v => v.line === line)
          .slice()
          .sort((a, b) => compareVer(a.ver, b.ver));

const byVersion = (ver, line = 'falco') =>
  ladder(line).find(v => compareVer(v.ver, ver) === 0) || null;

const rungIndex = id => {
  const v = byVersionId(id);
  return v ? ladder(v.line).findIndex(x => x.id === id) : -1;
};

/* TIME IS THE GATE. A rung whose release date has not arrived is not a choice
   the player has — that is the whole progression (GAME-DESIGN §3). */
const releasedAt = (date, line = 'falco') =>
  ladder(line).filter(v => dateAtLeast(date, v.released));

const latestAt = (date, line = 'falco') => {
  const list = releasedAt(date, line);
  return list.length ? list[list.length - 1] : null;
};

/* YOU CANNOT JUMP. The next rung is the next rung; there is no such thing as
   two at once, which is what makes the cost of climbing a series of decisions
   rather than one. */
function nextStep(fromId, date = null){
  const i = rungIndex(fromId);
  if(i < 0) return null;
  const list = ladder(byVersionId(fromId).line);
  const next = list[i + 1] || null;
  if(!next) return null;
  if(date && !dateAtLeast(date, next.released)) return null;
  return next;
}

/* every rung you have to stand on to get from here to there, in order, EXCLUDING
   where you are. null if `toId` is not above `fromId` on the same ladder —
   downgrades are not modelled, because in the field they are not a move. */
function upgradePath(fromId, toId){
  const a = byVersionId(fromId), b = byVersionId(toId);
  if(!a || !b || a.line !== b.line) return null;
  const list = ladder(a.line);
  const i = list.findIndex(x => x.id === fromId);
  const j = list.findIndex(x => x.id === toId);
  if(i < 0 || j < 0 || j <= i) return null;
  return list.slice(i + 1, j + 1);
}

/* why this move is not available. Data, not prose: `code` is the reason and the
   caller decides the sentence.

     same        you are already there
     downgrade   not a move this model has
     unreleased  it exists in the table and not yet in the world
     other-line  a different agent entirely                                   */
function stepBlockers(fromId, toId, date = null){
  const out = [];
  const a = byVersionId(fromId), b = byVersionId(toId);
  if(!a) out.push({ code:'unknown-from', id:fromId });
  if(!b) out.push({ code:'unknown-to', id:toId });
  if(out.length) return out;
  if(a.line !== b.line) return [{ code:'other-line', from:a.line, to:b.line }];
  if(a.id === b.id) return [{ code:'same', id:a.id }];
  const path = upgradePath(fromId, toId);
  if(!path) return [{ code:'downgrade', from:a.ver, to:b.ver }];
  if(date)
    for(const rung of path)
      if(!dateAtLeast(date, rung.released))
        out.push({ code:'unreleased', id:rung.id, released:rung.released });
  if(path.length > 1)
    out.push({ code:'multi-step', steps:path.length, ids:path.map(r => r.id) });
  return out;
}

/* everything a rung can do, accumulated from the bottom of the ladder. Ids, so
   a requirement is written against a capability and never against a number. */
function capabilitiesAt(id){
  const v = byVersionId(id);
  if(!v) return [];
  const list = ladder(v.line);
  const upto = list.slice(0, list.findIndex(x => x.id === id) + 1);
  const seen = [];
  for(const rung of upto)
    for(const cap of rung.grants) if(!seen.includes(cap)) seen.push(cap);
  return seen;
}
const hasCapabilityAt = (id, cap) => capabilitiesAt(id).includes(cap);

/* WHAT UPGRADING BREAKS. The question the whole file exists to answer.
   Aggregated over the path, so "0.36 → 0.41" tells you about all of it at once
   and in order. Each entry carries the rung it came from, because "which
   version did this to me" is the first thing anybody asks. */
function upgradeEffects(fromId, toId){
  const path = upgradePath(fromId, toId);
  if(!path) return null;
  const gains = [], losses = [];
  const cost = { rolling:false, redeployDriver:false, asks:[], blind:0, steps:path.length };
  for(const rung of path){
    for(const cap of rung.grants)
      gains.push({ version:rung.id, ver:rung.ver, cap, info:capabilityById(cap) });
    for(const b of rung.breaks)
      losses.push({ version:rung.id, ver:rung.ver, ...b });
    const c = rung.cost || UPGRADE_COST;
    cost.rolling = cost.rolling || !!c.rolling;
    cost.redeployDriver = cost.redeployDriver || !!c.redeployDriver;
    cost.blind += c.blind || 0;
    for(const a of (c.asks || [])) if(!cost.asks.includes(a)) cost.asks.push(a);
  }
  return { path:path.map(r => r.id), gains, losses, cost,
           silent:losses.filter(l => l.silent).length };
}

/* every break that is in force on this rung and not repaired by `ctx`.
 *
 * ctx (all optional):
 *   plugins   plugin ids that are installed AND working
 *   caps      extra capability ids the situation supplies
 *   env       { apiServer, k8sMeta, ... } — the composed environment's flags
 *
 * A break is repaired when its `repairedBy` is satisfiable AND satisfied. When
 * `repairedBy.minVer` is above where you are standing, the repair is not
 * available at all: `reachable:false`. That is the 0.37–0.39 valley, and it is
 * the honest answer rather than a hidden one.
 */
function activeBreaks(id, ctx = {}){
  const v = byVersionId(id);
  if(!v) return [];
  const list = ladder(v.line);
  const upto = list.slice(0, list.findIndex(x => x.id === id) + 1);
  const have = ctx.plugins || [];
  const caps = capabilitiesAt(id).concat(ctx.caps || []);
  const out = [];
  for(const rung of upto)
    for(const b of rung.breaks){
      const rep = b.repairedBy;
      let repaired = false, reachable = true, needs = null;
      if(rep){
        const okVer = !rep.minVer || verAtLeast(v.ver, rep.minVer);
        const okCap = (rep.needs || []).every(c => caps.includes(c));
        reachable = okVer && okCap;
        repaired = reachable && !!rep.plugin && have.includes(rep.plugin);
        /* a repair with no plugin to install is a配線 job (config, an ask): the
           model cannot see it done, so it reports it as outstanding and lets
           the rules layer decide when it is satisfied */
        needs = { plugin:rep.plugin || null, minVer:rep.minVer || null,
                  district:rep.district || null, ask:rep.ask || null,
                  caps:(rep.needs || []).slice() };
      }
      if(!repaired)
        out.push({ version:rung.id, ver:rung.ver, ...b,
                   repaired, reachable, needs });
    }
  return out;
}

/* Which named fields read a placeholder instead of a value, on this rung, in
   this situation. THE thing a rule can go silent on without anything counting
   it (INVARIANTS 3.7 / GAME-DESIGN §5).
 *
 * Returns [{ field, reads, because, version }]. Empty is the healthy answer,
 * and on an OLD ENOUGH RUNG it is empty for free — the built-in client was
 * still there. Same environment, earlier year, no hole. */
function naFieldsAt(id, ctx = {}){
  const out = [];
  for(const b of activeBreaks(id, ctx)){
    if(b.kind !== 'fields' || !b.fields) continue;
    for(const f of b.fields)
      out.push({ field:f, reads:b.reads || '<NA>', because:b.id,
                 version:b.version, silent:!!b.silent });
  }
  return out;
}

/* does a rule that reads these fields still have anything to match on?
   `fields` is what the rule's condition names. */
function fieldsUsable(id, fields, ctx = {}){
  const dead = naFieldsAt(id, ctx).map(x => x.field);
  const lost = (fields || []).filter(f => dead.includes(f));
  return { usable:lost.length === 0, lost };
}

/* how to put a break back, as data. `available:false` means the repair exists
   in the world and not from where you are standing — which is a reason to climb
   further, not a reason to give up. */
function repairFor(breakId, id, ctx = {}){
  const found = activeBreaks(id, ctx).find(b => b.id === breakId);
  if(!found) return null;
  const v = byVersionId(id);
  const rep = found.repairedBy;
  if(!rep) return { breakId, available:false, none:true, plugin:null,
                    minVer:null, district:null, ask:null, upgradeTo:null };
  const plugin = rep.plugin ? pluginById(rep.plugin) : null;
  const minVer = rep.minVer || (plugin ? plugin.requiresVer : null);
  const available = !minVer || (v && verAtLeast(v.ver, minVer));
  const upgradeTo = available || !v ? null
    : (ladder(v.line).find(r => verAtLeast(r.ver, minVer)) || null);
  return { breakId, available, none:false,
           plugin:rep.plugin || null, minVer:minVer || null,
           district:rep.district || null, ask:rep.ask || null,
           alsoNeeds:plugin ? plugin.alsoNeeds.slice() : [],
           upgradeTo:upgradeTo ? upgradeTo.id : null };
}

/* ---------------------------------------------------------------- drivers */

/* is this driver a thing you can pick, here and now.
 *
 * ctx:
 *   version   rung id (for the line whose driver this is)
 *   date      ISO date — the Sysdig side retires on a date, not on a version
 *   kernel    kernel version string, e.g. '5.4'
 *   blocked   driver ids the place forbids (districts.data.js
 *             §composeEnv.blockedDrivers — node OS, and nothing else)
 *
 *   btf       does the kernel expose BTF. null / undefined = unknown
 *   ringbuf   does it have the BPF ring buffer. null / undefined = unknown
 *
 * `soft` is the honest part: a kernel below the documented minimum is a WARNING
 * and not a verdict, because both sources say so in as many words — Falco writes
 * "usually, all versions >= 5.8 are enough" and Sysdig writes that the probe
 * "does not strictly require kernel version 5.8" because the features can be
 * backported. A model that hard-fails at 5.8 would be teaching something its own
 * source denies.
 *
 * What IS hard is the capability itself: the two real requirements are BPF ring
 * buffer support and BTF exposure. So a caller that knows those answers gets a
 * verdict, and a caller that only knows the version number gets a warning. That
 * is also what makes 製造業 genuinely stuck rather than merely discouraged —
 * an old kernel with no BTF, on a node OS that forbids kmod, after 0.44.0
 * removed the legacy probe, has nothing left to load. */
function driverBlockers(driverId, ctx = {}){
  const d = driverById(driverId);
  if(!d) return [{ code:'unknown-driver', id:driverId, soft:false }];
  const out = [];
  if((ctx.blocked || []).includes(driverId))
    out.push({ code:'blocked-by-node-os', soft:false });
  if(d.fromVer && ctx.version){
    const v = byVersionId(ctx.version);
    if(v && !verAtLeast(v.ver, d.fromVer))
      out.push({ code:'not-yet', since:d.fromVer, soft:false });
  }
  if(d.removedIn && ctx.version){
    const v = byVersionId(ctx.version);
    if(v && verAtLeast(v.ver, d.removedIn))
      out.push({ code:'removed', removedIn:d.removedIn, soft:false });
  }
  if(d.retiredOn && ctx.date && dateAtLeast(ctx.date, d.retiredOn))
    out.push({ code:'retired', on:d.retiredOn, soft:false });
  if(d.needsBtf && ctx.btf === false)
    out.push({ code:'no-btf', soft:false });
  if(d.needsRingbuf && ctx.ringbuf === false)
    out.push({ code:'no-bpf-ringbuf', soft:false });
  if(d.kernelMin && ctx.kernel && compareVer(ctx.kernel, d.kernelMin) < 0)
    out.push({ code:'kernel-too-old', min:d.kernelMin, have:ctx.kernel,
               soft:!d.strict });
  if(d.kernelMax && ctx.kernel && compareVer(ctx.kernel, d.kernelMax) > 0)
    out.push({ code:'kernel-too-new', max:d.kernelMax, have:ctx.kernel,
               soft:!d.strict });
  return out;
}

/* the drivers that are actually available, and the ones that are only
   discouraged. `soft` blockers do not remove a driver — they annotate it. */
function driversAt(ctx = {}){
  const line = ctx.line || (ctx.version ? (byVersionId(ctx.version)?.line) : 'falco');
  const out = [];
  for(const d of DRIVER_LIFECYCLE){
    if(d.line !== line) continue;
    const bl = driverBlockers(d.id, ctx);
    const hard = bl.filter(b => !b.soft);
    out.push({ id:d.id, jp:d.jp, ok:hard.length === 0,
               blockers:bl, warnings:bl.filter(b => b.soft) });
  }
  return out;
}

/* NOTHING LEFT TO STAND ON. The state GAME-DESIGN §3-3 is about: an old kernel
   on a node OS that forbids kmod, after the legacy probe is gone. Returns the
   surviving driver ids; empty means this place can no longer be watched from
   the kernel at all, and only plugin sources deliver (INVARIANTS 3.10). */
const workingDrivers = ctx => driversAt(ctx).filter(d => d.ok).map(d => d.id);

/* ---------------------------------------------------------------- deadlines */

/* retirements that have already happened, for this line, at this date/version */
function retiredAt(ctx = {}){
  return DEPRECATIONS.filter(d => {
    if(ctx.line && d.owner !== ctx.line) return false;
    if(d.endsOn && ctx.date && dateAtLeast(ctx.date, d.endsOn)) return true;
    if(d.removedIn && ctx.version){
      const v = byVersionId(ctx.version);
      if(v && verAtLeast(v.ver, d.removedIn)) return true;
    }
    return false;
  });
}

/* what is coming, and how long there is. `days` is negative once it has passed,
   which is deliberate: "you are 40 days late" is a sentence the game needs. */
function deadlines(date, ctx = {}){
  return DEPRECATIONS
    .filter(d => !ctx.line || d.owner === ctx.line)
    .filter(d => !!d.endsOn)
    .map(d => ({ id:d.id, jp:d.jp, owner:d.owner, kind:d.kind, what:d.what,
                 endsOn:d.endsOn, days:daysBetween(date, d.endsOn),
                 by:d.by.slice(), why:d.why, src:d.src.slice() }))
    .sort((a, b) => a.endsOn < b.endsOn ? -1 : a.endsOn > b.endsOn ? 1 : 0);
}

/* is the thing you are standing on going away, and by when. `using` is a
   driver / output / engine id, whichever kind the deadline is about. */
function deadlineFor(using, date, ctx = {}){
  return deadlines(date, ctx).find(d => d.what === using) || null;
}


/* ---------------------------------------------------------------- claims

   Which claim a piece of data rests on, and whether the register holds it. A
   caller asks about the data id it already has — `k8s-workload-fields-na`,
   `sysdig-legacy-ebpf`, `modern_ebpf` — and never has to know the claim ids. */
const claimById = id => CLAIMS.find(c => c.id === id) || null;
const claimFor  = id => CLAIMS.find(c => c.covers.includes(id)) || null;

/* MAY A CUSTOMER-FACING SCREEN STATE THIS AS FACT?
   Only if the register holds it, and holds it no wider than its source does.
   `weak` counts as unfixed on purpose: a register entry that says more than its
   citation is exactly the thing that got this file interrupted. Unknown ids
   answer false — a claim nobody wrote down is not fixed. */
function isFixed(id){
  const c = claimFor(id);
  return !!c && !!c.invariant && c.status === 'registered';
}

/* everything true, sourced, and not yet held down by INVARIANTS.md + npm test.
   The list the inspection lane needs, and the list a screen has to hide. */
const unregisteredClaims = () =>
  CLAIMS.filter(c => !c.invariant || c.status !== 'registered');

/* filter any list of objects to the ones whose claim is registered. `key` is the
   property that carries the data id, so this works on breaks, deadlines,
   drivers — anything in this file. */
const fixedOnly = (items, key = 'id') =>
  (items || []).filter(x => isFixed(x && x[key]));

/* ---------------------------------------------------------------- §unsourced
 * Left out on purpose, because there is no primary source for it. Written down
 * so the next session does not have to rediscover the hole:
 *
 *   - A VERSION LADDER FOR THE SYSDIG AGENT. The drivers are documented
 *     (§DRIVER_LIFECYCLE, docs.sysdig.com) and the agent release history is
 *     not, from a public primary source. So LINES.sysdig-agent has
 *     `ladder:false` and the Sysdig side's only clock is the 2026-12-04
 *     retirement. That is not a placeholder for a table somebody should invent.
 *   - MINIMUM AGENT VERSIONS for Universal eBPF / kernel module / legacy eBPF.
 *     The drivers page states kernel versions and not agent versions.
 *   - "0.38 以降 modern_ebpf が既定" as a version claim. The 0.38 release note
 *     says falcoctl picks the most compatible driver; the current kernel-drivers
 *     page marks Modern eBPF `(default)` with no version attached. Carried as
 *     `driver_autoselect`, and as §CLAIMS `modern-ebpf-default-since-0.38` with
 *     status `weak` — INVARIANTS 3.1 registers the stronger wording and its
 *     citation does not support it, so isFixed() answers false for it.
 *   - RULES-ARTIFACT ↔ ENGINE VERSION compatibility (`required_engine_version`).
 *     Real, and not verified for the specific artifact versions in
 *     src/policies.js §MATURITIES, so it is not modelled as a requirement.
 *   - Bottlerocket / Secure Boot as kmod constraints. Deliberately absent, as
 *     INVARIANTS 3.2 decided: the only documented kmod restriction is COS, and
 *     that fact belongs to districts.data.js §NODE_OSES.
 */

export {
  VERSIONS,
  LINES,
  CAPABILITIES,
  DRIVER_LIFECYCLE,
  DEPRECATIONS,
  PLUGINS,
  CLAIMS,
  LADDER_START,
  UPGRADE_COST,
  claimById,
  claimFor,
  isFixed,
  unregisteredClaims,
  fixedOnly,
  compareVer,
  verAtLeast,
  dateAtLeast,
  daysBetween,
  byVersionId,
  byVersion,
  lineById,
  capabilityById,
  driverById,
  pluginById,
  deprecationById,
  ladder,
  rungIndex,
  releasedAt,
  latestAt,
  nextStep,
  upgradePath,
  stepBlockers,
  capabilitiesAt,
  hasCapabilityAt,
  upgradeEffects,
  activeBreaks,
  naFieldsAt,
  fieldsUsable,
  repairFor,
  driverBlockers,
  driversAt,
  workingDrivers,
  retiredAt,
  deadlines,
  deadlineFor
};
