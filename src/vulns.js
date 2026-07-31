/* VULNS — the middleware a business runs, and what time does to it.
 *
 * PURE DATA + PURE FUNCTIONS. No DOM, no THREE, no import of any other module.
 * Every exported table survives JSON.stringify → JSON.parse unchanged (no
 * functions, no closures, no live bindings), because the Unity port and the
 * English build both have to be able to read them as files. Player-facing text
 * lives in the data for the same reason.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The whole game leans on one thing: standing still has to cost something. If
 * the world does not change, "never upgrade, never patch" is the optimum and
 * there is no game (GAME-DESIGN §3, 要点 4). So time does two things, and this
 * file is the first of them:
 *
 *   1. vulnerabilities are disclosed in the middleware the business chose
 *   2. the generated attacks reach for them (src/campaigns.js)
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * Which middleware a business runs is the archetype's call (src/archetypes.js,
 * written in a parallel session). This file is keyed by MIDDLEWARE ID and never
 * imports that module, so the two can land in either order. `vulnsFor()` takes
 * the ids as an argument, resolves the aliases below, and ignores ids it does
 * not know — an archetype naming middleware this catalogue has not covered
 * yet is a content gap, not a crash. `unknownMiddleware()` names them.
 *
 * The ids this catalogue covers, against GAME-DESIGN §4 ① and the components
 * archetypes.js actually declares (cross-checked by
 * scripts/harness/cases-data.mjs — every declared component must resolve here
 * and carry at least one disclosure):
 *
 *   Web サービス   nginx / nodejs / redis                      16 disclosures
 *   金融決済       postgres / java / kafka                     13
 *   ゲーム基盤     redis / gameserver / mysql                  12
 *   製造業         old-kernel / opcua-gateway / modbus-bridge
 *                  / legacy-jvm / legacy-middleware            17 · すべて patch blocked
 *
 * 製造業 carries the LONGEST backlog and the only one where `patch` is blocked on
 * every component. That is not a difficulty multiplier — it is the middleware
 * assignment, exactly as GAME-DESIGN §4 ① asks for it.
 *
 * TIME
 * ----
 * Time is counted in TICKS. One tick = one production campaign has run
 * (DESIGN-freeplay-flow §時間の刻み方). Nothing here knows about dates; mapping
 * ticks onto the real Falco / Sysdig release history is src/timeline.js's job.
 *
 * THE CVE-LIKE CODES ARE FICTIONAL AND SAY SO
 * -------------------------------------------
 * Every `code` below is prefixed `FC-` (falco-city) precisely so it can never be
 * mistaken for a real CVE. The RULE NAMES are real — a detection this model
 * claims you do not have by default has to be a detection that really is not in
 * the default package (INVARIANTS 4.1 / 4.5), or the lesson is a lie.
 */

/* ---------------------------------------------------------------- totality
   THIS MODULE NEVER THROWS. It returns an answer, or an empty one.

   The contract (CONTRACT-datalayer.md §1) requires a bad input to come back as an
   error value rather than an exception. Fuzzing the eight files found 27 sites
   here — `vulnsFor(1)`, `triage(null)`, `patchCostAt()` — all of the same shape:
   a collection argument that was not a collection. These four coercions are the
   idiom, and every public entry runs its arguments through them.

   `str()` absorbs Symbol too, which `String()` throws on. */
const arr = v => Array.isArray(v) ? v : [];
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const num = (v, d = 0) => Number.isFinite(v) ? v : d;
const str = v => typeof v === 'string' ? v
               : (v == null || typeof v === 'symbol') ? '' : String(v);

/* ---------------------------------------------------------------- severity
   Weight is what the game arithmetic uses; jp is what the player reads. The
   absolute numbers are illustrative and free to move. The ORDER is the claim. */
const SEVERITY = {
  crit: { id:'crit', jp:'致命的', weight:1.00, sla:2 },
  high: { id:'high', jp:'高',     weight:0.60, sla:5 },
  med:  { id:'med',  jp:'中',     weight:0.30, sla:12 }
};
const SEV_ORDER = ['crit','high','med'];
const sevWeight = sev => SEVERITY[sev] ? SEVERITY[sev].weight : 0;

/* ---------------------------------------------------------------- middleware
   `patch` is the DEFAULT cost of closing one of this component's holes, and it
   is the whole reason the four industries diverge:

     downtime  ticks during which the estate is not earning (§4.5 支払い)
     asks      other teams whose work this needs (GAME.asks already counts these)
     chain     the version moves the fix drags behind it, as the player reads them
     blocked   there is no patch move at all for this component

   `blocked` is not a difficulty knob. It is what "更新できない" means: an OT
   appliance whose vendor has not shipped a fixed build, and a kernel you cannot
   reboot without stopping the line. Manufacturing is hardest because its
   COMPONENTS are these two — the difficulty comes out of the middleware
   assignment, not out of a multiplier (GAME-DESIGN §4 ①). */
const MIDDLEWARE = [
  { id:'nginx', jp:'nginx', jpKind:'リバースプロキシ', updatable:true,
    patch:{ downtime:1, asks:1, blocked:false,
            chain:['イメージのベースを上げる'],
            jp:'イメージを差し替えてローリング再起動' },
    blurb:'外から最初に当たる面。露出が大きいぶん、公開された穴はそのまま攻撃面になる。' },
  { id:'nodejs', jp:'Node ランタイム', jpKind:'アプリランタイム', updatable:true,
    patch:{ downtime:1, asks:2, blocked:false,
            chain:['ランタイムのマイナーを上げる','依存を再解決する'],
            jp:'依存を上げてイメージを再ビルドする（アプリチームの仕事）' },
    blurb:'依存が深く、直すのはアプリチーム。パッチは自分の手では終わらない。' },
  { id:'postgres', jp:'PostgreSQL', jpKind:'データストア', updatable:true,
    patch:{ downtime:2, asks:1, blocked:false,
            chain:['マイナーを上げる','クライアントライブラリを揃える'],
            jp:'メンテナンス窓を取って再起動する' },
    blurb:'止められない。パッチは窓待ちで、窓は月に一度しか来ない。' },
  { id:'java', jp:'Java / JVM ライブラリ', jpKind:'アプリランタイム', updatable:true,
    patch:{ downtime:1, asks:2, blocked:false,
            chain:['ライブラリを上げる','JVM のマイナーを上げる','回帰テストを通す'],
            jp:'ライブラリを上げて回帰テストを通す（アプリ＋QA の仕事）' },
    blurb:'依存の連鎖が長い。1件のパッチが他チーム2つの予定を動かす。' },
  { id:'redis', jp:'Redis', jpKind:'インメモリストア', updatable:true,
    patch:{ downtime:1, asks:1, blocked:false,
            chain:['フェイルオーバーしてから上げる'],
            jp:'レプリカに寄せてから上げる' },
    blurb:'フェイルオーバーできるので安い。ただし公開されると踏み台としては強い。' },
  { id:'gameserver', jp:'ゲームサーバ', jpKind:'自社アプリ', updatable:true,
    patch:{ downtime:2, asks:0, blocked:false,
            chain:['自社ビルドを上げる'],
            jp:'自社ビルドなので自分で上げられる' },
    blurb:'自社製。直すのは自分たちなので依頼が要らない —— 唯一そうである場所。' },
  { id:'kafka', jp:'Kafka', jpKind:'メッセージキュー', updatable:true,
    patch:{ downtime:3, asks:2, blocked:false,
            chain:['ブローカーをローリングで上げる','クライアントの互換性を確認する'],
            jp:'ブローカーを1台ずつ上げる。決済が流れている間は窓が取れない' },
    blurb:'止めると決済が止まる。技術的には上げられるのに、'+
          '<b>止める許可が出ないので後回しになる</b> —— blocked とは別の詰まり方。' },
  { id:'mysql', jp:'MySQL', jpKind:'データストア', updatable:true,
    patch:{ downtime:2, asks:1, blocked:false,
            chain:['レプリカを先に上げる','フェイルオーバーする'],
            jp:'レプリカから上げてフェイルオーバーする' },
    blurb:'課金と進行の保存先。レプリカがあるので窓は取れるが、'+
          'イベント中は誰も触らせてくれない。' },
  { id:'legacy-middleware', jp:'レガシー産業ミドルウェア', jpKind:'ベンダ製アプライアンス',
    updatable:false,
    patch:{ downtime:6, asks:3, blocked:true,
            chain:['ベンダのサポート版を待つ','検証環境で再認証する'],
            jp:'ベンダの修正版が出ていない。当てる手が存在しない' },
    blurb:'サポート契約の中でしか動かせない。修正版が出るまで、パッチという手は無い。' },
  /* OT protocol bridges. Separate entries rather than aliases of
     `legacy-middleware`, because 製造業 declares FOUR components and the whole
     point of that archetype is that the BACKLOG grows faster than the moves do
     (archetypes.js §industrial-ot). Aliasing two ids onto one entry would collapse
     them into one set of disclosures and quietly make the hardest archetype the
     lightest one — which is what happened before this file and archetypes.js had
     the same owner. */
  { id:'opcua-gateway', jp:'OPC UA ゲートウェイ', jpKind:'OT プロトコル変換', updatable:false,
    patch:{ downtime:6, asks:3, blocked:true,
            chain:['ベンダのファームウェアを待つ','ライン停止の承認を取る'],
            jp:'ファームウェアはベンダしか出せない。出ていないので手が無い' },
    blurb:'IT 側と OT 側の境界に立っている。<b>境界にあるのに一番更新できない</b>。' },
  { id:'modbus-bridge', jp:'Modbus ブリッジ', jpKind:'OT プロトコル変換', updatable:false,
    patch:{ downtime:8, asks:3, blocked:true,
            chain:['プロトコルごと置き換える'],
            jp:'認証の概念が無い世代のプロトコル。直すのではなく囲うしかない' },
    blurb:'認証が仕様に無いので「脆弱性を塞ぐ」という形の手が存在しない。'+
          '<b>検知でしか受けられない</b>の一番純粋な形。' },
  { id:'legacy-jvm', jp:'古い JVM', jpKind:'アプリランタイム', updatable:false,
    patch:{ downtime:4, asks:3, blocked:true,
            chain:['アプリをその JVM から剥がす','再認証する'],
            jp:'アプリがそのバージョンでしか動かない。上げるとラインが動かない' },
    blurb:'同じ JVM でも、上げられる場所とそうでない場所がある。'+
          '<b>更新できないかどうかは、部品ではなく置かれ方で決まる</b>。' },
  { id:'old-kernel', jp:'古いカーネル', jpKind:'ノード OS', updatable:false,
    patch:{ downtime:8, asks:3, blocked:true,
            chain:['カーネルを上げる','ドライバを作り直す','ライン停止の承認を取る'],
            jp:'ラインを止めないと再起動できない。止める承認が降りない' },
    blurb:'上げるとドライバの前提も変わる。そして止める承認が降りないので、上がらない。' }
];
const MW_IDS = MIDDLEWARE.map(m => m.id);

/* Spelling tolerance, NOT a substitute for coverage.
 *
 * An alias is right when two ids mean the SAME component (`postgresql` and
 * `postgres`). It is wrong when they mean two components that happen to be
 * similar — that was the bug this file shipped with: six of the thirteen ids
 * archetypes.js declares resolved to nothing, `vulnsFor()` silently returned a
 * shorter list, and 製造業 — the archetype whose entire lesson is an unpatchable
 * backlog — reached ONE component out of four. Nothing crashed and nothing said
 * so, which is exactly why scripts/harness/cases-data.mjs now asserts that every
 * declared component resolves and carries at least one disclosure. */
const MW_ALIASES = {
  'node':'nodejs', 'node.js':'nodejs', 'nodejs-runtime':'nodejs',
  'postgresql':'postgres', 'pg':'postgres',
  'jvm':'java', 'java-app':'java',
  /* Web's Redis is a cache and ゲーム基盤's is a session store. Same component,
     same disclosures — the difference is in what it costs to fail over, and that
     lives on the archetype, not here. */
  'redis-cache':'redis', 'redis-session':'redis',
  'game-server':'gameserver', 'gamesrv':'gameserver',
  'legacy':'legacy-middleware', 'legacy-mw':'legacy-middleware',
  'legacy_middleware':'legacy-middleware', 'appliance':'legacy-middleware',
  'opcua':'opcua-gateway', 'modbus':'modbus-bridge',
  'kernel':'old-kernel', 'oldkernel':'old-kernel', 'legacy-kernel':'old-kernel'
};
const mwId = id => {
  const k = str(id).toLowerCase();
  return MW_ALIASES[k] || k;
};
const mwById = id => MIDDLEWARE.find(m => m.id === mwId(id)) || null;
const unknownMiddleware = ids =>
  arr(ids).filter(x => !mwById(x)).map(str);

/* ---------------------------------------------------------------- exploit route
   `detect` is what src/campaigns.js needs and it says two things:

     via       WHICH EXISTING CHAIN STEP this exploitation looks like on the
               wire. campaigns.js copies that step's needs / needsCaps /
               needsSyscalls, so a generated attack is made out of the same
               material the hand-written chain is made of and is scored by the
               same evaluate(). It never invents a requirement.
     newRule   whether the detection for it ships in the default package.
               false  the exploitation shows up as behaviour the STABLE set
                      already catches (a shell, a write below /etc, a dropped
                      binary). Nothing to fetch. THIS IS THE COMMON CASE and it
                      is why runtime detection can hold a line that patching
                      cannot (DESIGN-freeplay-flow §脆弱性).
               true   the detection is a separate OCI artifact — incubating or
                      sandbox — so you do not have it until falcoctl fetches it
                      AND follows it (INVARIANTS 4.1 / 4.5). This is what makes
                      the attacks get NEWER with time.

   `rule` on a newRule entry is a REAL non-stable rule name. Only stable vs
   not-stable is load bearing; the maturity tag is recorded so the claim can be
   checked against falcosecurity/rules. */

/* ---------------------------------------------------------------- catalogue
   `discloseIn` is the disclosure DISTRIBUTION: the vulnerability becomes public
   somewhere in [a, b] ticks, picked deterministically from the seed
   (disclosureTick). Windows are spread across the horizon on purpose — the
   backlog has to grow, not arrive all at once.
   (Named `discloseIn` and not `window`: this module is DOM-free, and a field
   that shadows a browser global in a file whose whole point is that it never
   touches one is a trap for the next reader — and for the DOM-free check in
   scripts/harness/cases-data.mjs, which flagged it.)

   `inUse` is whether the vulnerable code is actually loaded at runtime. It is
   TRUE OF THE WORLD either way; what changes is whether the player can see it
   (triage). That is the whole OSS / Sysdig difference here, and it is a
   PRIORITISATION difference, not a detection one (INVARIANTS 5.2). */
const VULN_HORIZON = 24;
const VULNS = [
  /* ---- nginx ------------------------------------------------------------- */
  { id:'nginx-smuggling', mw:'nginx', code:'FC-2026-0101', sev:'high', inUse:true,
    discloseIn:[1,4], jp:'リクエストスマグリングで背後のアプリに素の要求を通す',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'踏み台としては強いが、成功したあとに起きることは普通のシェルなので、既定のルールで見える。' },
  { id:'nginx-path-traversal', mw:'nginx', code:'FC-2026-0114', sev:'high', inUse:true,
    discloseIn:[3,7], jp:'パス正規化の穴で公開範囲外のファイルを読み出す',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'読み出しは open 系に出る。base_syscalls から open 系を落としていれば、そこで消える。' },
  { id:'nginx-module-rce', mw:'nginx', code:'FC-2026-0132', sev:'crit', inUse:true,
    discloseIn:[8,12], jp:'サードパーティモジュールの境界外書き込みから任意コード実行',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'落としたものを実行する段は既定同梱。パッチが当たっていなくても、ここで止められる。' },
  { id:'nginx-header-leak', mw:'nginx', code:'FC-2026-0148', sev:'med', inUse:false,
    discloseIn:[10,16], jp:'エラー応答に内部ヘッダが混ざる（該当モジュールは無効）',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'このビルドでは該当モジュールを読み込んでいない。in-use が見えていれば後回しにできる。' },
  { id:'nginx-tls-downgrade', mw:'nginx', code:'FC-2026-0161', sev:'crit', inUse:false,
    discloseIn:[14,20], jp:'TLS 再交渉のダウングレード（該当設定を使っていない）',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'設定として無効なので実際には踏めない。優先度が見えなければ、ここに時間を使う。' },
  { id:'nginx-cache-poison', mw:'nginx', code:'FC-2026-0177', sev:'crit', inUse:true,
    discloseIn:[18,23], jp:'キャッシュ汚染で他ユーザに細工した応答を配る',
    detect:{ via:'cron', newRule:true, rule:'Write below etc', maturity:'sandbox' },
    why:'書き込みの痕跡で見えるが、そのルールは既定同梱ではない（sandbox）。' },

  /* ---- Node ランタイム ---------------------------------------------------- */
  { id:'node-proto-pollution', mw:'nodejs', code:'FC-2026-0203', sev:'high', inUse:true,
    discloseIn:[2,5], jp:'プロトタイプ汚染から任意プロパティを注入する',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'注入の先で結局シェルを取るので、既定のルールに出る。' },
  { id:'node-dep-confusion', mw:'nodejs', code:'FC-2026-0216', sev:'crit', inUse:true,
    discloseIn:[5,9], jp:'依存の取り違えで悪意あるパッケージが混ざる',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'ビルド時に入るが、動くのは実行時。落として実行する段で捕まる。' },
  { id:'node-ssrf-imds', mw:'nodejs', code:'FC-2026-0229', sev:'crit', inUse:true,
    discloseIn:[7,11], jp:'SSRF で IMDS を叩かせ、インスタンスの資格情報を抜く',
    detect:{ via:'imds', newRule:true,
             rule:'Contact EC2 Instance Metadata Service From Container', maturity:'incubating' },
    why:'この検知は incubating で、既定パッケージに入っていない。falcoctl で取って追従していなければ持っていない。' },
  { id:'node-log-lib', mw:'nodejs', code:'FC-2026-0241', sev:'crit', inUse:false,
    discloseIn:[12,18], jp:'ログ整形ライブラリの ReDoS（該当バージョンは未使用）',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'ロックファイル上には居るが実行時には読み込まれない。in-use が見えない側は、これを一級品として扱う。' },
  { id:'node-worker-escape', mw:'nodejs', code:'FC-2026-0258', sev:'crit', inUse:true,
    discloseIn:[16,22], jp:'ワーカースレッドの分離を破ってホスト名前空間へ出る',
    detect:{ via:'exec', newRule:true, rule:'Change thread namespace', maturity:'incubating' },
    why:'名前空間の切り替えを見るルールは既定同梱ではない。新しい攻撃には新しいルールが要る。' },

  /* ---- PostgreSQL -------------------------------------------------------- */
  { id:'pg-auth-bypass', mw:'postgres', code:'FC-2026-0302', sev:'crit', inUse:true,
    discloseIn:[2,6], jp:'認証応答の取り違えでパスワード無しに接続できる',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'接続後に資格情報ファイルを漁るので、既定のルールで見える。' },
  { id:'pg-extension-rce', mw:'postgres', code:'FC-2026-0318', sev:'crit', inUse:true,
    discloseIn:[6,11], jp:'拡張のロード経路から任意コードを実行する',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'DB プロセスから新しいバイナリが動く。窓が来るまでの間、検知が唯一の統制になる。' },
  { id:'pg-logical-repl', mw:'postgres', code:'FC-2026-0331', sev:'crit', inUse:false,
    discloseIn:[10,16], jp:'論理レプリケーションの権限確認漏れ（未使用機能）',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'この構成では論理レプリケーションを使っていない。' },
  { id:'pg-backup-exfil', mw:'postgres', code:'FC-2026-0349', sev:'high', inUse:true,
    discloseIn:[15,21], jp:'バックアップ経路を使って中身を外へ出す',
    /* a plugin ruleset carries no maturity: it is distributed WITH the plugin,
       not by falcoctl artifact, so `newRule` is false and the gate is 07 プラグイン
       入力 instead (policies.js §RULE_FACTS maturity:null · INVARIANTS 3.9). */
    detect:{ via:'cloud', newRule:false,
             rule:'Delete Bucket Encryption', maturity:null },
    why:'出口はクラウド API 側。syscall には現れないので、プラグイン入力が無ければ原理的に見えない。' },
  { id:'pg-audit-tamper', mw:'postgres', code:'FC-2026-0362', sev:'crit', inUse:true,
    discloseIn:[19,24], jp:'監査ログの出力先を書き換えて痕跡を消す',
    /* `Clear Log Activities` is STABLE / WARNING in falco_rules.yaml — verified
       against falcosecurity/rules and registered in policies.js §RULE_FACTS.
       An earlier draft called it incubating to make a point about following
       artifacts; the source does not support that, so the point is dropped
       rather than the fact bent (BOARD §2 D7 is the same correction for log.js). */
    detect:{ via:'cron', newRule:false, rule:'Clear Log Activities', maturity:'stable' },
    why:'監査保持が要件の業種では、これは見逃しではなく違反。'+
        '<b>検知そのものは既定同梱で持っている</b>ので、'+
        'ここで負けるとしたら理由はドロップか埋没のどちらかになる。' },

  /* ---- Java / JVM -------------------------------------------------------- */
  { id:'java-deser', mw:'java', code:'FC-2026-0404', sev:'crit', inUse:true,
    discloseIn:[1,5], jp:'デシリアライズの穴からガジェット連鎖で任意コード実行',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'古典。踏まれたあとに起きることは既定のルールで見える。' },
  { id:'java-jndi', mw:'java', code:'FC-2026-0417', sev:'crit', inUse:true,
    discloseIn:[4,9], jp:'ログ文字列の展開から外部クラスを読み込ませる',
    detect:{ via:'imds', newRule:true,
             rule:'Contact EC2 Instance Metadata Service From Container', maturity:'incubating' },
    why:'外向きの接触で見えるが、その検知は incubating。取ってきて追従していなければ無い。' },
  { id:'java-xml-xxe', mw:'java', code:'FC-2026-0433', sev:'crit', inUse:false,
    discloseIn:[9,15], jp:'XML パーサの外部実体参照（このアプリは無効化済み）',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'無効化済みなので踏めない。それが分かるのは in-use が見えるときだけ。' },
  { id:'java-agent-inject', mw:'java', code:'FC-2026-0451', sev:'crit', inUse:true,
    discloseIn:[13,19], jp:'JVM エージェントを後付けで差し込み、常駐する',
    detect:{ via:'cron', newRule:true, rule:'Write below etc', maturity:'sandbox' },
    why:'常駐のために書き込む。ただし書き込み系のこのルールは sandbox なので既定では持っていない。' },
  { id:'java-supply-lib', mw:'java', code:'FC-2026-0468', sev:'crit', inUse:true,
    discloseIn:[17,23], jp:'署名を通った依存ライブラリに裏口が入っている',
    detect:{ via:'exec', newRule:true,
             rule:'Backdoored library loaded into SSHD (CVE-2024-3094)', maturity:'incubating' },
    why:'ライブラリの裏口を見るルールは incubating。パッチも間に合わないので、追従の有無がそのまま結果になる。' },

  /* ---- Redis ------------------------------------------------------------- */
  { id:'redis-unauth-cmd', mw:'redis', code:'FC-2026-0502', sev:'crit', inUse:true,
    discloseIn:[1,4], jp:'認証無しのコマンド実行で設定を書き換えられる',
    detect:{ via:'cron', newRule:true, rule:'Write below etc', maturity:'sandbox' },
    why:'書き換え先が /etc なら見えるが、そのルールは sandbox。既定では持っていない。' },
  { id:'redis-lua-escape', mw:'redis', code:'FC-2026-0519', sev:'high', inUse:true,
    discloseIn:[5,10], jp:'スクリプトのサンドボックスを抜けてホスト側で実行する',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'抜けた先はシェル。既定のルールで見える。' },
  { id:'redis-replica-hijack', mw:'redis', code:'FC-2026-0534', sev:'crit', inUse:true,
    discloseIn:[9,15], jp:'レプリケーションを乗っ取ってモジュールを配る',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'配られたモジュールが動く瞬間に出る。フェイルオーバーで上げられるので、ここは安く塞げる。' },
  { id:'redis-keyspace-leak', mw:'redis', code:'FC-2026-0547', sev:'crit', inUse:false,
    discloseIn:[13,20], jp:'キースペース通知の情報漏れ（通知は無効）',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'通知を切っているので踏めない。' },
  { id:'redis-cluster-bus', mw:'redis', code:'FC-2026-0563', sev:'high', inUse:true,
    discloseIn:[17,23], jp:'クラスタバスの認証不備で偽ノードを混ぜる',
    detect:{ via:'k8sapi', newRule:false, rule:'Contact K8S API Server From Container', maturity:'stable' },
    why:'偽ノードは API サーバを触りに来る。オーケストレータが居ない構成ではこの振る舞い自体が起こり得ない。' },

  /* ---- ゲームサーバ（自社） ------------------------------------------------ */
  { id:'gs-packet-overflow', mw:'gameserver', code:'FC-2026-0602', sev:'crit', inUse:true,
    discloseIn:[3,8], jp:'自作プロトコルの長さ検査漏れでリモートから書き潰す',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'自社製なので自分で直せる。この業種で唯一、依頼が要らないパッチ。' },
  { id:'gs-anticheat-driver', mw:'gameserver', code:'FC-2026-0621', sev:'high', inUse:true,
    discloseIn:[8,14], jp:'アンチチート補助の特権プロセスを踏み台にする',
    detect:{ via:'exec', newRule:true, rule:'Non sudo setuid', maturity:'incubating' },
    why:'特権の取り方を見るルールは既定同梱ではない。' },
  { id:'gs-matchmaking-ssrf', mw:'gameserver', code:'FC-2026-0638', sev:'high', inUse:true,
    discloseIn:[12,19], jp:'マッチメイキングの外部呼び出しを内側に向けさせる',
    detect:{ via:'imds', newRule:true,
             rule:'Contact EC2 Instance Metadata Service From Container', maturity:'incubating' },
    why:'向き先が IMDS。検知は incubating。' },
  { id:'gs-replay-store', mw:'gameserver', code:'FC-2026-0655', sev:'crit', inUse:false,
    discloseIn:[16,23], jp:'リプレイ保存の署名検証漏れ（保存機能は停止中）',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'機能を止めているので踏めない。' },

  /* ---- Kafka（技術的には上げられる。止める許可が出ない） -------------------- */
  { id:'kafka-acl-bypass', mw:'kafka', code:'FC-2026-0902', sev:'crit', inUse:true,
    discloseIn:[2,6], jp:'ACL の評価順の誤りで他テナントのトピックを読める',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'読み出しに落ちるので既定のルールで見える。パッチは技術的には簡単で、窓が取れない。' },
  { id:'kafka-connect-rce', mw:'kafka', code:'FC-2026-0918', sev:'crit', inUse:true,
    discloseIn:[7,13], jp:'コネクタ設定の経路から任意クラスを読み込ませる',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'読み込まれたものが動く段は既定同梱。窓を待つ間、検知が受ける。' },
  { id:'kafka-quota-oracle', mw:'kafka', code:'FC-2026-0934', sev:'med', inUse:false,
    discloseIn:[14,21], jp:'クォータ応答の差から他テナントの流量を推定できる（クォータ未設定）',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'クォータを設定していないので踏めない。in-use が見えない側はこれを一級品として扱う。' },

  /* ---- MySQL ------------------------------------------------------------- */
  { id:'mysql-udf-rce', mw:'mysql', code:'FC-2026-1002', sev:'crit', inUse:true,
    discloseIn:[3,8], jp:'ユーザ定義関数のロード経路から任意コードを実行する',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'DB プロセスから新しいバイナリが動く。既定同梱で見える。' },
  { id:'mysql-auth-plugin', mw:'mysql', code:'FC-2026-1017', sev:'high', inUse:true,
    discloseIn:[9,15], jp:'認証プラグインの取り違えで検証を飛ばせる',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'入られたあとに資格情報を漁るので、そこで見える。' },
  { id:'mysql-replica-drift', mw:'mysql', code:'FC-2026-1033', sev:'crit', inUse:true,
    discloseIn:[16,22], jp:'レプリカ経由で設定ファイルを書き換えられる',
    detect:{ via:'cron', newRule:true, rule:'Write below etc', maturity:'sandbox' },
    why:'書き込みで見えるが、そのルールは sandbox。追従していなければ持っていない。' },

  /* ---- OPC UA ゲートウェイ（パッチ不可） ------------------------------------ */
  { id:'opcua-anon-session', mw:'opcua-gateway', code:'FC-2026-1101', sev:'crit', inUse:true,
    discloseIn:[0,4], jp:'匿名セッションが既定で有効なまま出荷されている',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'ファームウェアが出ていないので塞げない。入られたあとの振る舞いは既定のルールで見える。' },
  { id:'opcua-cert-skip', mw:'opcua-gateway', code:'FC-2026-1116', sev:'crit', inUse:true,
    discloseIn:[4,9], jp:'証明書検証を省略する経路が残っている',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'なりすまして資格情報を読みに来るところで見える。<b>ここも検知が唯一の統制</b>。' },
  { id:'opcua-firmware-write', mw:'opcua-gateway', code:'FC-2026-1132', sev:'high', inUse:true,
    discloseIn:[11,18], jp:'ファームウェア更新経路から任意パスへ書き込める',
    detect:{ via:'cron', newRule:true, rule:'Write below etc', maturity:'sandbox' },
    why:'書き込みは見えるが sandbox。追従できないこの業種では<b>持てない検知</b>になる。' },

  /* ---- Modbus ブリッジ（パッチという形の手が存在しない） --------------------- */
  { id:'modbus-no-auth', mw:'modbus-bridge', code:'FC-2026-1201', sev:'crit', inUse:true,
    discloseIn:[1,5], jp:'仕様に認証が無いので、届く相手なら誰でも書き込める',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'<b>これは「脆弱性」ではなく仕様</b>なので、塞ぐという手がそもそも無い。'+
        'それでも踏み台にされた先の振る舞いは既定のルールで見える。' },
  { id:'modbus-replay', mw:'modbus-bridge', code:'FC-2026-1218', sev:'high', inUse:true,
    discloseIn:[6,12], jp:'コマンドをそのまま再送して装置を再操作できる',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'再送そのものは見えないが、そのために置かれた道具が動くところで見える。' },

  /* ---- 古い JVM（上げるとラインが止まる） ----------------------------------- */
  { id:'legacy-jvm-deser', mw:'legacy-jvm', code:'FC-2026-1301', sev:'crit', inUse:true,
    discloseIn:[2,7], jp:'サポートの切れた版のデシリアライズの穴',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'同じ穴が金融側では塞げて、ここでは塞げない。<b>差は部品ではなく置かれ方</b>。' },
  { id:'legacy-jvm-classpath', mw:'legacy-jvm', code:'FC-2026-1317', sev:'high', inUse:true,
    discloseIn:[8,15], jp:'クラスパスの先頭に細工した jar を置かれる',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'置かれたものが読み込まれて動く段で見える。' },
  { id:'legacy-jvm-agent', mw:'legacy-jvm', code:'FC-2026-1334', sev:'crit', inUse:true,
    discloseIn:[14,21], jp:'エージェントを後付けで差し込んで常駐する',
    detect:{ via:'exec', newRule:true, rule:'Change thread namespace', maturity:'incubating' },
    why:'名前空間の切り替えを見るルールは incubating。'+
        '<b>追従できず、パッチもできない</b>ので、この1件は本当に受け止めるしかない。' },

  /* ---- レガシーミドルウェア（ベンダ製・パッチ不可） ------------------------- */
  { id:'legacy-default-cred', mw:'legacy-middleware', code:'FC-2026-0701', sev:'crit', inUse:true,
    discloseIn:[0,3], jp:'出荷時の既定資格情報がそのまま生きている',
    detect:{ via:'exec', newRule:false, rule:'Terminal shell in container', maturity:'stable' },
    why:'ベンダ修正版が無いので当てる手が無い。入られたあとの振る舞いは既定のルールで見える —— これが唯一の統制。' },
  { id:'legacy-proto-rce', mw:'legacy-middleware', code:'FC-2026-0716', sev:'crit', inUse:true,
    discloseIn:[3,7], jp:'独自プロトコルの検査漏れからリモートコード実行',
    detect:{ via:'dropbin', newRule:false, rule:'Drop and execute new binary in container', maturity:'stable' },
    why:'落としたものが動く段は既定同梱。パッチ不可でも、ここは見える。' },
  { id:'legacy-file-write', mw:'legacy-middleware', code:'FC-2026-0729', sev:'high', inUse:true,
    discloseIn:[6,12], jp:'設定取り込みの経路で任意パスへ書き込める',
    detect:{ via:'cron', newRule:true, rule:'Write below etc', maturity:'sandbox' },
    why:'書き込みは見えるが、そのルールは sandbox。追従していなければ持っていない。' },
  { id:'legacy-cred-store', mw:'legacy-middleware', code:'FC-2026-0744', sev:'high', inUse:true,
    discloseIn:[10,17], jp:'資格情報を平文で置いているファイルを読み出される',
    detect:{ via:'shadow', newRule:false, rule:'Read sensitive file untrusted', maturity:'stable' },
    why:'既定のルールで見える。ただし open 系を base_syscalls から落としていれば、静かに消える。' },
  { id:'legacy-vendor-tunnel', mw:'legacy-middleware', code:'FC-2026-0758', sev:'crit', inUse:true,
    discloseIn:[14,20], jp:'ベンダ保守トンネルを踏んで内側から外へ出る',
    detect:{ via:'imds', newRule:true,
             rule:'Contact EC2 Instance Metadata Service From Container', maturity:'incubating' },
    why:'外向きの接触を見るこの検知は incubating。パッチは無く、追従もできないなら、打つ手が本当に無くなる。' },

  /* ---- 古いカーネル（パッチ不可） ------------------------------------------ */
  { id:'kern-priv-esc', mw:'old-kernel', code:'FC-2026-0801', sev:'crit', inUse:true,
    discloseIn:[1,5], jp:'カーネルの参照数の穴からローカル権限昇格',
    detect:{ via:'exec', newRule:true, rule:'Non sudo setuid', maturity:'incubating' },
    why:'昇格そのものを見るルールは既定同梱ではない。カーネルは上げられない。' },
  { id:'kern-container-escape', mw:'old-kernel', code:'FC-2026-0817', sev:'crit', inUse:true,
    discloseIn:[5,10], jp:'名前空間の扱いの穴でコンテナから抜け出す',
    detect:{ via:'exec', newRule:true, rule:'Change thread namespace', maturity:'incubating' },
    why:'抜け出す瞬間を見るルールは incubating。ここが製造業の一番痛い点。' },
  /* `Packet socket created in container` is STABLE / NOTICE in falco_rules.yaml
     (policies.js §RULE_FACTS). It is deliberately the one hole in this component
     that 製造業 CAN answer: with follow-refs unreachable and the kernel unpatchable,
     an archetype whose every disclosure needed a fetched artifact would have no
     move at all, and that is a generated dead end rather than difficulty
     (campaigns.js §auditCampaign.unanswerable · GATE-FREEPLAY F6). */
  { id:'kern-netfilter', mw:'old-kernel', code:'FC-2026-0833', sev:'high', inUse:true,
    discloseIn:[9,16], jp:'パケット処理の境界外読み出しでノードを落とす',
    detect:{ via:'exec', newRule:false, rule:'Packet socket created in container', maturity:'stable' },
    why:'生ソケットの作成は<b>既定同梱のルールで見える</b>。'+
        'カーネルは上げられないので、<b>ここは検知が唯一の統制になる</b>典型例。' },
  { id:'kern-oldfs', mw:'old-kernel', code:'FC-2026-0849', sev:'high', inUse:true,
    discloseIn:[13,21], jp:'古いファイルシステム実装の穴で任意ファイルを書く',
    detect:{ via:'cron', newRule:true, rule:'Write below etc', maturity:'sandbox' },
    why:'書き込みで見える。ここは検知が届く側。' }
];

/* ---------------------------------------------------------------- disclosure
   Deterministic from (vulnerability, seed). Same seed, same world — which is
   what makes a run reproducible and a bug reportable. */
function hash32(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function disclosureTick(vuln, seedIn = 1){
  const v = obj(vuln);
  const w = arr(v.discloseIn);
  /* 窓が無い／壊れているものは tick 0 に落とします。**捨てません** —
     カタログの記述漏れが「その脆弱性は存在しない」に化けるのが一番まずい */
  const a = num(w[0]), b = num(w[1], a);
  const span = Math.max(1, (b - a) + 1);
  return a + (hash32(`${str(v.id)}#${num(seedIn, 1)}`) % span);
}

/* every vulnerability that exists for this middleware set, with its disclosure
   tick resolved. Sorted by when it lands, because that is the order the player
   meets them in. */
function vulnsFor(mwIds, optsIn = {}){
  const opts = obj(optsIn);
  const seedIn = num(opts.seed, 1);
  const want = new Set(arr(mwIds).map(mwId));
  return VULNS
    .filter(v => want.has(v.mw))
    /* `blocked` is resolved here rather than left to the caller, because
       src/campaigns.js reads it (a hole with no patch move is a hole the
       generated attack may only be answered by DETECTION) and that module
       imports nothing. */
    .map(v => ({ ...v, t: disclosureTick(v, seedIn),
                 blocked: !!(v.fix || (mwById(v.mw) || {}).patch || {}).blocked }))
    .sort((x, y) => x.t - y.t || (x.id < y.id ? -1 : 1));
}
/* what is public by tick `tickNo` */
const disclosedBy = (list, tickNo) =>
  arr(list).map(obj).filter(v => num(v.t) <= num(tickNo));

/* ---------------------------------------------------------------- cost
   COST RISES WITH TIME (GAME-DESIGN §4.5 指針). The longer a hole stays open the
   further the fix version has drifted from what is running, so the version chain
   the patch drags behind it gets longer. Running a tight ship stays cheap;
   letting the backlog age is what compounds.

   `blocked` never becomes unblocked by waiting. It is not expensive, it is
   absent — and that is the point of the manufacturing case. */
const COST = {
  driftEvery: 6,        // ticks per extra step of version drift
  driftAdd: 1,          // cost added per drift step
  /* One move per turn. Not a patching allowance — it is THE turn, the same one
     that has to pay for building a district, upgrading the agent and buying
     capacity (GAME-DESIGN §4.5 支払い). Measured: closing every hole this
     catalogue discloses costs 36–60% of every turn in the horizon, and the two
     industries that cannot afford it are the two the design says should suffer. */
  budgetPerTick: 1
};
function patchCostAt(vuln, tickNo = 0){
  const v = obj(vuln);
  const mw = mwById(v.mw);
  const base = obj(v.fix).downtime !== undefined ? obj(v.fix)
             : (mw && mw.patch) || {downtime:1, asks:0, blocked:false};
  const age = Math.max(0, Math.round(num(tickNo)) - num(v.t));
  const drift = Math.floor(age / COST.driftEvery) * COST.driftAdd;
  return {
    downtime: num(base.downtime, 1) + drift,
    asks: num(base.asks),
    blocked: !!base.blocked,
    drift,
    chain: arr(base.chain).slice(),
    jp: base.jp || '',
    /* one number the score lane can spend: 停止時間 ＋ 依頼 */
    total: num(base.downtime, 1) + drift + num(base.asks)
  };
}

/* ---------------------------------------------------------------- triage
   THE ONLY PLACE OSS AND SYSDIG DIFFER HERE, AND IT IS NOT DETECTION.

   Sysdig knows which vulnerable package is actually loaded at runtime, so the
   in-use ones float. Falco OSS on its own does not know, so every entry looks
   the same weight and the list can only be sorted by severity — which puts
   not-in-use criticals above in-use highs and spends the patch budget on holes
   nobody can reach.

   INVARIANTS 5.2 is untouched: no detection is added or removed by either
   branch. What changes is the ORDER of the queue. */
const TRIAGE_TEXT = {
  oss:'in-use が分からないので、この一覧は<b>重さの順にしか並べられない</b>。'+
      '実際に読み込まれているかどうかは、ここからは見えない。',
  sysdig:'<b>in-use のものだけが浮いている。</b>実行時に読み込まれていないものは下に落ちる —— '+
         '検知は1段も増えていない。<b>塞ぐ順が決まっただけ</b>。'
};
function triage(list, optsIn = {}){
  const opts = obj(optsIn);
  const knows = opts.stack === 'sysdig';
  const tickNo = num(opts.tick);
  const rows = arr(list).map(obj).map(v => ({
    id:v.id, mw:v.mw, code:v.code, jp:v.jp, sev:v.sev, t:v.t,
    /* the model still knows; the PLAYER only does on Sysdig */
    inUse: knows ? !!v.inUse : null,
    cost: patchCostAt(v, tickNo)
  }));
  const bySev = (x, y) => SEV_ORDER.indexOf(x.sev) - SEV_ORDER.indexOf(y.sev)
                       || x.t - y.t || (x.id < y.id ? -1 : 1);
  const order = knows
    ? rows.slice().sort((x, y) => (y.inUse ? 1 : 0) - (x.inUse ? 1 : 0) || bySev(x, y))
    : rows.slice().sort(bySev);
  /* how many entries the player cannot tell apart: on OSS the whole top
     severity band is one undifferentiated block */
  const top = order.length ? order[0].sev : null;
  const ties = knows ? 0 : order.filter(r => r.sev === top).length;
  return { knowsInUse:knows, order, ties, note: knows ? TRIAGE_TEXT.sysdig : TRIAGE_TEXT.oss };
}

/* Spend the budget in the order triage gave you. This is the function that
   turns "you cannot see in-use" into a number: `wasted` is budget spent on
   holes that were never reachable. */
function patchPlan(list, optsIn = {}){
  const opts = obj(optsIn);
  const tickNo = num(opts.tick);
  const budget = num(opts.budget, COST.budgetPerTick);
  const { order, knowsInUse, ties } = triage(list, opts);
  let left = budget;
  const patch = [], skip = [];
  for(const row of order){
    if(row.cost.blocked){ skip.push({ id:row.id, why:'blocked' }); continue; }
    if(row.cost.total > left){ skip.push({ id:row.id, why:'budget' }); continue; }
    left -= row.cost.total;
    patch.push(row.id);
  }
  const lookup = new Map(arr(list).map(obj).map(v => [v.id, v]));
  const wasted = patch.filter(id => !obj(lookup.get(id)).inUse).length;
  return { patch, skip, spent: budget - left, left, wasted,
           inUsePatched: patch.filter(id => !!obj(lookup.get(id)).inUse).length,
           knowsInUse, ties };
}

/* ---------------------------------------------------------------- pressure
   What an OPEN hole costs while it is open, as inputs the rules lane can add to
   what it already computes. Two separate effects, both additive:

     alertsPerMin  a known-exposed service gets probed, and probing rings. This
                   lands in the SOC queue, which is the queue with no
                   buf_size_preset (state.js §noise) — so a backlog of unpatched
                   holes eventually BURIES the real alerts. That is the second
                   way to lose, reached without anybody misconfiguring anything.
     loadMul       more attempted traffic on the same estate. Small: this is not
                   the main term of the drop model and pretending otherwise
                   would be a lie about the arithmetic.

   Only in-use holes push, because only in-use code can actually be reached.
   Note what that means: on OSS the player cannot see which ones those are, but
   they push anyway. The world does not care what you can see. */
const PRESSURE = {
  alertsPerVuln: 1.25,   // alerts/min a known-exposed in-use hole generates
  loadPerWeight: 0.03,   // added inflow multiplier per severity weight
  maxLoadMul: 1.35,
  riskPerWeight: 1.0     // score lane: 減算 is proportional to 期間 × 深刻度
};
function vulnPressure(open, optsIn = {}){
  const opts = obj(optsIn);
  const tickNo = num(opts.tick);
  const rows = arr(open).map(obj);
  const live = rows.filter(v => v.inUse);
  const weight = live.reduce((a, v) => a + sevWeight(v.sev), 0);
  /* 放置は期間に比例して痛む (GAME-DESIGN §4.5 減算) */
  const aged = rows.reduce(
    (a, v) => a + sevWeight(v.sev) * Math.max(0, tickNo - num(v.t)), 0);
  return {
    open: rows.length,
    inUseOpen: live.length,
    weight,
    alertsPerMin: +(PRESSURE.alertsPerVuln * live.length).toFixed(3),
    loadMul: Math.min(PRESSURE.maxLoadMul, 1 + PRESSURE.loadPerWeight * weight),
    riskPoints: +(PRESSURE.riskPerWeight * aged).toFixed(2)
  };
}

/* ---------------------------------------------------------------- rollup
   One call the UI page (§5.5 脆弱性一覧) and the score lane can both read. */
function vulnState(optsIn = {}){
  const opts = obj(optsIn);
  const tickNo = num(opts.tick);
  const all = vulnsFor(arr(opts.middleware), opts);
  const patched = new Set(arr(opts.patched).map(str));
  const known = disclosedBy(all, tickNo);
  const open = known.filter(v => !patched.has(v.id));
  return {
    tick: tickNo,
    middleware: arr(opts.middleware).map(mwId),
    unknownMiddleware: unknownMiddleware(arr(opts.middleware)),
    total: all.length,
    disclosed: known.length,
    patched: known.length - open.length,
    open,
    blocked: open.filter(v => patchCostAt(v, tickNo).blocked).length,
    triage: triage(open, { ...opts, tick: tickNo }),
    pressure: vulnPressure(open, { tick: tickNo })
  };
}

export {
  SEVERITY,
  SEV_ORDER,
  sevWeight,
  MIDDLEWARE,
  MW_IDS,
  MW_ALIASES,
  mwId,
  mwById,
  unknownMiddleware,
  VULNS,
  VULN_HORIZON,
  COST,
  PRESSURE,
  TRIAGE_TEXT,
  disclosureTick,
  vulnsFor,
  disclosedBy,
  patchCostAt,
  triage,
  patchPlan,
  vulnPressure,
  vulnState
};
