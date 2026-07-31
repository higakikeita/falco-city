# Falco / Sysdig — Runtime Security City

**▸ https://higakikeita.github.io/falco-city/**

複数セッションで並行開発しています。担当境界と運用ルールは [HANDOFF-PM.md](HANDOFF-PM.md)、
方針とレーンは `.claude/handoffs/ROADMAP-3DAY.md`（リポジトリには入っていないローカル資料）、
**曲げてはいけない因果は [INVARIANTS.md](INVARIANTS.md)** が正（数値は illustrative で自由・因果は本物）。

`syscall → alert` のパイプラインを歩ける 3D の「都市」にした、**ブラウザで遊ぶゲーム**。
検知パイプラインを建て、攻撃チェーンを迎え撃つ。

**ゲームであることが目的で、Falco / Sysdig の理解が進むのは副産物。**
だから因果は本物にしてあるが、遊びとして成立しないものは入れない。

遊ぶ単位は**シナリオ**（[後述](#シナリオ--プレイ時間はシナリオの本数で作る)）。
1シナリオ = 現場で実際に起きる**誤診1件**で、「空き地から建てる」もその1本。

## ファイル構成

`src/` が正。`docs/` は生成物で、**リポジトリには入っていない**（CI が作って Pages に配る）。

| 場所 | 中身 |
|---|---|
| `src/index.html` | HTML シェル（マークアップ＋CSS）。dev では importmap で CDN の three を解決する |
| `src/*.js` | ES モジュール。担当の境界は[開発の分担](#開発の分担)を参照 |
| `src/scenarios/schema.js` | シナリオの契約。環境表・既定値・検証器。**冒頭コメントが仕様** |
| `src/scenarios/index.js` | 登録簿。1シナリオ = import 1行 ＋ 配列に1行 |
| `src/scenarios/*.js` | シナリオ本体。1ファイル1本・純データ |
| `build.mjs` | esbuild で `src/main.js` を1つの通常スクリプトにまとめ、シェルに埋め込んで `docs/index.html` を作る |
| `scripts/check-imports.mjs` | 各モジュールが使っている共有シンボルを import し忘れていないか検査 |
| `scripts/check-build.mjs` | 生成物の健全性検査（モジュール化されていない・three が埋まっている・タグが閉じている等） |
| `docs/index.html` | **配布物**。単一ファイル・約0.6MB・three 同梱。ダブルクリックで開く（`file://` で動く） |

なぜ生成物を通常スクリプトにするか: `file://` は ES モジュールを拒否するので、
これをやらないと「ファイルを渡してダブルクリック」が成立しない。Slack にアップロードした
HTML のリンクを直接開かせるのも不可（署名付き URL に期限がある）。渡すときは Pages の URL か、
ダウンロードしてから開くよう案内する。

## 開発

```bash
npm install
npm run dev      # http://localhost:8722 で src/ をそのまま配信
npm run check    # import 検査 → ビルド → 生成物検査
```

`docs/` はコミットしない（`.gitignore` 済み）。公開物は `main` への push で
GitHub Actions が作ってデプロイする。

## 都市の地区 = パイプラインの段

流れは画面の左（西）から右（東）へ。

| # | 地区 | 実体 |
|---|---|---|
| 01 | ワークロード | コンテナ・Pod・ホストのプロセスが発行する syscall |
| 02 | ドライバ（カーネル空間） | `modern_ebpf` / `ebpf` / `kmod`。tracepoint で関心のある syscall だけ通す門 |
| 03 | リングバッファ | ドライバとユーザ空間の共有メモリ（既定 8 MiB × バッファ数）。既定の `modern_ebpf` では **2 CPU に1つ**。**唯一イベントが落ちる場所** |
| 04 | 状態エンジン | libscap / libsinsp。スレッドテーブル・FD テーブル・container / k8s メタデータ |
| 05 | ルールエンジン | condition + output + priority。イベント型ごとに評価対象を絞る |
| 06 | 出力チャネル | stdout / gRPC / Falcosidekick → Falco Talon |
| 07 | プラグイン入力 | `k8saudit` / `cloudtrail` / `okta` 等。ドライバもバッファも通らないバイパス車線 |
| 08 | Sysdig Secure | 同じ libs・同じ Falco エンジン。ポリシーが降り、イベント・キャプチャが上がる |
| 09 | ルール配布 | `falcoctl`。ルールとプラグインは OCI アーティファクトとして配られる |

地区をクリックすると詳細パネル（日本語の解説＋要点バンド）が開く。キーボード `1`–`9` でも移動、`0` で全体、`Esc` で閉じる。

## 2つのモード

| MODE | 中身 |
|---|---|
| `Explore` | 完成した街を自由に見る。全部建った状態の見取り図 |
| `Campaign` | **シナリオを1本選んで遊ぶ。** 渡された街と渡されたチューニングだけで攻撃チェーンを迎え撃つ |

## シナリオ — プレイ時間はシナリオの本数で作る

**プレイ時間はシナリオの本数で作る。** これが唯一、並行セッション数が線形に効く場所なので、
コンテンツのレーンだけは本数の上限を置いていない（`.claude/handoffs/ROADMAP-3DAY.md` §2）。

**1シナリオ = 現場で実際に起きる誤診1件。** 中身はこの5つで、それ以上のものは持たせない。

| | シナリオ側のフィールド |
|---|---|
| **症状** | `title` / `blurb` — 何が起きているように見えるか |
| **真因** | `env` / `start`（`built` / `tune` / `load` / `driver` / `stack`）— 何が実際に起きているか。**引き継いだ状態として渡す** |
| **踏ませたい誤診** | `insight.wrong` — 状況が誘う結論。**1シナリオに1つだけ**。これがコンテンツの単位 |
| **正解の手** | `insight.truth` — 実際に効く手と、なぜ効くか |
| **クリア条件** | `goal`（`detect` / `contain` / `maxAsks` / `maxDropPct`）— 何段検知して、封じ込めて、他チームに何回まで頼って、ドロップを何%以下に抑えるか |

`start` は「**前任者が置いていったもの**」です。引き継ぎはたいていこの形をしていて、
**「空き地から建てる」は特別扱いではなく、前任者が何も置いていかなかった場合**——
つまり `start.built: []` のシナリオ1本（`greenfield`）です。以前はモードとしてハードコード
されていましたが、いまはスキーマで書かれた他の6本とまったく同じ資格しか持っていません。

### 登録済み — 7本

`src/scenarios/index.js` に登録済み。`order` 順で、これがピッカーの並び順です。

| order | id | 症状 | **踏ませたい誤診** | 効く手 |
|---|---|---|---|---|
| 10 | `greenfield` | 空き地。受け止めるものが何も無い | **依存順に全部建て終えれば検知は完成している** | ルール配布・プラグイン入力・止める手の3つは「建て終えた」の外側にある |
| 20 | `inherited-all-syscalls` | 経路は建っているが `base_syscalls: all` で置いていかれ、ドロップしている | **ドロップが出た → `buf_size_preset` を上げれば直る** | 持続超過なのでバッファは効かない。`custom_set` に絞って入力を減らす |
| 25 | `slow-output` | 負荷 ×1.0・`default` なのに落ちて、1段見逃す | **ドロップ = 負荷が高いかバッファが小さい** | 動いたのは分母（消費能力）。同期出力がイベントループを止めている |
| 30 | `standalone-k8s-rules` | ルールは最新なのに k8s 系が1本も鳴らない | **ルールが古いか壊れている** | この街に Kubernetes が無い。**5段が上限で、それが正解** |
| 40 | `rules-not-followed` | 全段建ってドロップ 0%、なのに `/tmp` のバイナリ実行だけ鳴らない | **ドライバか状態エンジンの取りこぼし。Sysdig を入れれば増える** | そのルールがノードに無い。取得するのは 09 ルール配布（`falcoctl`） |
| 50 | `eyes-but-no-hands` | 6段とも検知できている。それでも侵害が止まらない | **OSS のルールを増やす／出力チャネルを足す** | 検知は満点。目と手は別の部品。しかも 08 を建てても**検知は増えない** |
| 60 | `a-different-source` | syscall 側は健康。クラウド側の侵害だけ1段も鳴らない | **syscall 側が弱い → ルール追加・`all`・ドライバ変更・バッファ増** | ルールはイベントソースで分割され、Falco はソース間の相関をしない。**量ではなく分割** |

**表の「踏ませたい誤診」の列が、この教材の本体です。** 残りは全部、そこへ連れて行くための足場。

誤診は結果画面で明かされます（`insight.wrong` / `insight.truth` を `ui.js` が「踏みがちな読み /
実際は」として出す）。だから**先に踏ませて、それから理由を見せる**順序が守られます。

### 実装待ち — 2本

ファイルは `src/scenarios/` にありますが、**`index.js` に登録されていません**。
登録すると成立しない条件があるので、意図的に外してあります。

| id | 誤診 | 登録できない理由 |
|---|---|---|
| `silent-blind-spot` | **ドロップ 0% なら取りこぼしは起きていない** → 実際は `base_syscalls.custom_set` の**負の指定**（`!connect`）でルールが要求する syscall がトレースされておらず、カウンタが1つも上がらない | **負の指定の採点が未実装。** `S.tune.syscallCustom` / `syscallRepair` は運ばれるが、ドロップモデルはプリセット名しか読まない（`src/state.js` §TUNE_DEFAULTS · Phase 1 予定） |
| `nodes-are-not-buffers` | **ドロップが出る → ノードを増やす** → 実際にはバッファ本数は `ceil(そのノードの CPU 数 ÷ cpus_for_each_buffer)` で、ノードを足して増えるのは DaemonSet の Pod の数 | **環境に CPU 数の軸が無い。** リングバッファ地区は `RING_CPUS = 8` 固定（`src/controls.js`）で、「2 vCPU なら1本」を画面で成立させられない |

どちらも `schema.js` の検証は通ります。落ちているのは**採点と表示**の側です。

### スキーマの2つの制約

`src/scenarios/schema.js` の冒頭コメントが仕様で、制約は2つだけ。どちらも
**いま守るのは安く、後から直すのは高い**種類のものです。

**① シナリオは純データ。** 関数もクロージャも `THREE` も `undefined` も入れない。
`JSON.stringify` → `JSON.parse` を通して不変であること。
理由は**移植**です。Unity 版を作るときにシナリオ資産をそのまま持っていける状態を保ちたい。
1本のシナリオに関数を1つ入れた瞬間、その保証は全部のシナリオで消えて、**全部書き直しになる**。
`isPlainData()` 相当（`plainDataErrors()`）が機械的に落とすので、レビュー任せにはしていません。

**② 文言はシナリオ側、UI の文言は表示側。** ロジックはどちらも持たない。
`schema.js` のフィールド一覧は**文字列フィールドが全部プレイヤー向け**になるように並べてあり、
「プレイヤー向けでない文」を置ける場所がありません。
これは差し替える層を1つに閉じるための境界です——言語を差し替えるときに触るのは
シナリオと `ui.js` だけで、ルール層には1文字も無い。
（英語版そのものは3日の範囲外です。`.claude/handoffs/ROADMAP-3DAY.md` §1 で切られています。）

同じ理由で、シナリオは**座標もスコアも特別扱いも宣言しません**。状況について何が真かを
宣言するだけで、そこから何が follow するかはエンジンが決める。`DISTRICTS` と同じ規律です
（[§地区を足す](#地区を足す)）。

### 検証は2段。壊れた1本は外れる

| 段 | 場所 | 見るもの |
|---|---|---|
| **形** | `scenarios/schema.js` `validateShape()` | 純データか・必須フィールドがあるか・型が合っているか・**知らないフィールドが無いか**（エンジンが読まないフィールドは黙って何もしないので拒否する）・`env.type` が実在するか・`start.driver` がその環境で選べるか |
| **参照** | `campaign.js` `referentialErrors()` | 攻撃ステップ id が実在するか・ウェーブ間で重複していないか・役割 id が実在するか・`start.built` の**依存が集合内で満たされているか**・`goal.detect` が来る段数を超えていないか |

参照の検査を `schema.js` に置かないのは、ステップ表と役割表を持っているのが `campaign.js` の
側だからです（import 循環を避け、`schema.js` が知らないことを知っているふりをしないため）。

検証に落ちた1本は **`SCENARIOS` から外れ、理由が `SCENARIO_ERRORS` に積まれます**
（フィールドパス付き・`console.error` にも出る）。だから**1本のコンテンツ不良でゲームは落ちず、
黙って見逃されることもない。** コンソールから `__city.SCENARIO_ERRORS` で読めます。

### シナリオを足す

`DISTRICTS` を足すのと同じ形式です。**1ファイル書いて、`index.js` に1行。**

1. `src/scenarios/<id>.js` を `schema.js` の契約どおりに書く（`export default { ... }`）
2. `src/scenarios/index.js` に import を1行足して、`RAW` 配列に1行足す

それだけです。ピッカーは `SCENARIOS` から生成され、並び順は `order`（同値なら id）で決まります。
環境・建っているもの・チューニング・役割ロック・攻撃の構成・クリア条件は**全部そのファイルの中**で、
エンジン側に特別扱いを足す必要はありません。

```js
export default {
  id:'my-scenario',            // 小文字とハイフンだけ。ファイル名と同じにする
  title:'症状を1行で',          // ピッカーに出る
  order:70,                    // 並び順
  blurb:'触る前に必要な情報だけ。1280×720 で 104px 上限',

  env:{ type:'self-managed-k8s', nodes:3 },
  start:{ built:['driver','ring','state','rules','outputs'],
          tune:{ syscallSet:'all' }, load:1.0, driver:'modern_ebpf', stack:'oss' },
  player:{ side:'defense', role:'sre', lockRole:true },   // lockRole = 役割固定
  attack:{ auto:true, response:false,
           waves:[{ jp:'侵入と足場づくり', steps:['exec','shadow','cron'] }] },

  insight:{ id:'stable-key', wrong:'状況が誘う結論', truth:'実際に起きていること' },
  goal:{ detect:3, contain:false, maxAsks:0, maxDropPct:1 }
};
```

`attack.waves` の**境界はいま宣言だけ**です。Phase 0 は平坦化した1本として流し、
ウェーブとして刻むのは Day 2 の作業——**その日にシナリオファイルを1本も触らないため**に
先に境界を書かせています。

## 建てる順と攻撃チェーン

`greenfield` を例に。空き地から始まり、ワークロードは syscall を出しているが受け止めるものが
何も無い（イベントは建てた範囲の端で消える）。他のシナリオは**途中まで建った街**を渡してきます。

建設は依存順にしか進めない: ドライバ → リングバッファ → 状態エンジン → ルールエンジン →
出力チャネル。そこから プラグイン入力 / ルール配布 / Sysdig Secure が枝分かれする。
1段建てるたびに「それが無かったら何ができなかったか」が出る。

`攻撃チェーンを流す` で攻撃が走り、**建てたものと、いまのチューニングと、いまの環境だけ**で
判定される。どの段が来るかはシナリオの `attack.waves` が選び、`CHAIN`（`campaign.js`）が
ステップの図書館です。

| id | 攻撃 | 必要なもの |
|---|---|---|
| `exec` | kubectl exec でコンテナにシェルを取る | driver → outputs 一式 ＋ `kernelPath` |
| `shadow` | /etc/shadow を読んで資格情報を探す | 同上 |
| `cron` | /etc/cron.d に書き込んで永続化する | 同上 |
| `dropbin` | /tmp に落としたバイナリを実行する | ＋ **ルール配布**（模型では「既定同梱のルールセットには無い検知」として扱う。下の注記） |
| `k8sapi` | K8s API サーバに接触して権限を探る | ＋ `apiServer`（オーケストレータが無い環境には API サーバも Pod も無い） |
| `cloud` | 盗んだ資格情報でクラウドへ | ＋ **プラグイン入力**（クラウド API は**別のイベントソース**で、Falco はソース間の相関をしない） |
| `contain` | 侵害されたコンテナを止める | ＋ **Sysdig**（OSS は目。止める手は別） |

必要な**能力**（`kernelPath` / `apiServer`）は環境が宣言した属性を読みます
（`needsCaps` → `hasCap()`）。環境 id を直接見ないのが要点で、`k8sapi` を
`deploy:'k8s'` に固定していた頃は managed k8s を選ぶと k8s の文脈があるのに見逃しになり、
その失点が基盤役に付いていました。

> **`dropbin` の理由づけは INVARIANTS で ⚠️ が付いています。** 実物の
> `Drop and execute new binary in container` は `maturity_stable` なので**既定で同梱されており**、
> `falcoctl` 無しでも検知できます（[INVARIANTS.md](INVARIANTS.md) §4.3）。
> 「持っていないルールは鳴らない」という**主張自体は正しく**、間違っているのは例です。
> 差し替え候補（`Contact EC2 Instance Metadata Service From Container` など incubating の実物）は
> §4.5 に挙がっていますが、**まだ実装されていません**。

### 実測した進行

`greenfield`（6段＋対処）で測ったもの。`step1`–`step6` は上の表の
`exec` / `shadow` / `cron` / `dropbin` / `k8sapi` / `cloud` に対応します。

| 状態 | 検知 | 見逃した理由 |
|---|---|---|
| 何も建てていない | 0/7 | 全部 |
| syscall 経路一式 | 4/7 | step4・step6・対処 |
| ＋プラグイン入力 | 5/7 | step4・対処 |
| ＋ルール配布 | 6/7 | 対処 |
| ＋Sysdig Secure | **7/7** | — |
| そこから NODE LOAD を ×2.6 | 6/7 | **step1 がリングバッファでドロップして消えた** |
| そこから `スタンドアロンサーバ` に変更 | 6/7 | **step5 が構成上成立しない（Kubernetes が無いので API サーバも Pod も無い）** |

最後の2行が効く。**全部建てても、チューニングと構成を間違えれば検知は落ちる。**
パイプラインを持っていることと、それが機能していることは別。

## 陣営と役割 — このパイプラインは1チームでは建たない

Campaign に入ると、まず**陣営**を選ぶ。

| 陣営 | 状態 |
|---|---|
| **守備側** | 遊べる。パイプラインを建てて攻撃を迎え撃つ。攻撃は `Auto` で流れる |
| **攻撃側** | **未実装**（disabled で置いてある）。検知をすり抜ける攻撃を組む側 |

守備側はさらに**役割**を選ぶ。既定は `全役`（1人で全部やる＝従来どおりの挙動）。

| 役割 | 建てる地区 | 触れるレバー |
|---|---|---|
| **基盤**（プラットフォーム） | 02 ドライバ・04 状態エンジン | `DEPLOY` / `DRIVER` |
| **SRE**（ノード運用） | 03 リングバッファ | `TUNING` 一式 |
| **検知**（検知エンジニア） | 05 ルールエンジン・07 プラグイン入力・09 ルール配布 | — |
| **SOC**（対応） | 06 出力チャネル・08 Sysdig Secure | `STACK` |

`NODE LOAD` はどの役割にも属さない。負荷は誰かが決めるものではなく、ワークロードがそう
振る舞っているだけなので。01 ワークロードにも所有者はいない（アプリチームが出しているもの）。

役割を選ぶと**他チームのレバーが触れなくなる**。`base_syscalls` が `all` になっているのが
見えていて、自分では直せない、という状態が作れる。他チームの地区も建つが、**依頼**を
経由するしかなく、その回数が数えられる。

### 見逃しには持ち主がいる

`攻撃チェーンを流す` の各行に「起因 · <役割>」が付き、最後に役割別スコアカードが出る。
帰属は `blameOf()` が結果から導出する（手書きの注釈ではない）:

| 見逃しの原因 | 起因 |
|---|---|
| 建っていない地区がある | **その地区の所有者**（依存の最上流にある欠落を選ぶ） |
| 構成が合っていない（Kubernetes が無い環境で k8s ルール） | 基盤 |
| 条件は満たしたがリングバッファでドロップした | SRE |
| 検知はしたが止められない | SOC |

### 実測した帰属

| 状態 | 検知 | 起因の割り当て |
|---|---|---|
| 空き地 | 0/7 | step1–5 → **基盤**（ドライバが無い）/ step6 → **検知** / 対処 → **SOC** |
| syscall 経路一式 | 4/7 | step4・step6 → **検知** / 対処 → **SOC** |
| 全部建てた | **7/7** | — |
| そこから `NODE LOAD ×2.6` | 6/7 | step1 → **SRE**（util 168% · ドロップ 41%） |
| そこから `スタンドアロンサーバ` | 6/7 | step5 → **基盤** |

4役すべてが、それぞれの落とし方で名指しされる。

### この模型が採点しないこと

`base_syscalls` を `custom_set` に絞るとドロップは止まるが、**その絞り込みが検知
エンジニアのルールに必要な syscall まで落としていないか**は判定していない。SRE と検知
エンジニアの一番きつい境目がここなので、スコアカードに注記として出す。実機では必ず突き合わせる。

## 開発の分担

複数セッションが並行して触るので、**ファイル単位で持ち主が分かれています**。境界は
「**決める側**（ルール層）」と「**見せる側**（世界・画面層）」の1本です。

| 層 | ファイル | 役割 |
|---|---|---|
| **決める側**（ルール） | `campaign.js` `state.js` `sim.js` `scenarios/` | 何が起きるか。**DOM を触らない。** 純関数とデータだけを export する |
| **見せる側**（世界） | `districts.data.js` `districts.build.js` `layout.js` `mesh.js` `scene.js` `city.js` | 都市の形 |
| **見せる側**（画面） | `ui.js` `controls.js` `log.js` `index.html` | 見え方と操作 |
| **検査** | `scripts/` `INVARIANTS.md` | 事実と受け入れ |
| **共有** | `main.js` `palette.js` `package.json` `README.md` | PM が調停 |

`src/audio.js` は**何も import しません**（`THREE` も state も DOM も）。だから Node でも読めて、
rAF が止まっても生き、**他の何かが壊れる原因になり得ません**。

### 決める側は DOM を触らない

これが2本以上の並列の前提条件です。

- `campaign.js` / `state.js` / `layout.js` に DOM は無い（要素参照も描画もしない）。
  **`scripts/check-imports.mjs` が機械的に検査します**（`... is DOM-free` の行が出る）
- 状態が変わると `onCampaignChange` で通知が飛び、`ui.js` が描き直す
- レバーの所有は `LEVER_OWNER` が**名前**で持ち、どの CSS ノードかを知っているのは `ui.js` だけ
- `goalStatus()` は**キーと数値だけ**を返す。ラベルは `ui.js` の `GOAL_LBL` にある
  —— プレイヤー向けの文がルール層に1つも無い状態を保つため

### `docs/` はビルドしない

**`docs/` を作らないでください。** `.gitignore` 済みで、`main` への push で GitHub Actions が
作って Pages に配ります。`git add docs` は `a06bfd1` で**廃止された手順**です。
`npm run check` はビルドを走らせるので `docs/` が生えますが、**コミットには含めない**
（gitignore されているので通常は勝手に入りません）。

### 並行するなら worktree で隔離する

```bash
git worktree add .claude/worktrees/<name> -b <branch> origin/main
```

**同じ `index.html` を2セッションが同時に触って、未完成の CSS が別のコミットに巻き込まれた事故が
実際に起きています。** ファイルの持ち主が分かれていても、同じ作業ツリーを共有していれば
`git add` は境界を知りません。隔離は worktree で行ってください。

### `check-imports.mjs` は唯一の網

**esbuild は未定義グローバルを黙って通します。** `foo is not defined` はブラウザで実行時に
初めて出るので、ビルドは緑・生成物も緑・画面だけ真っ暗という壊れ方をします。
`scripts/check-imports.mjs` が「各モジュールが使っている共有シンボルを import し忘れていないか」を
静的に見るのが、**この壊れ方に対する唯一の網**です。毎 PR で `npm run check` を通してください。

## 操作

- ドラッグでオービット / スクロールでズーム / 地区をクリックで詳細
- **STACK** — `Falco OSS` ↔ `+ Sysdig`。Sysdig 側にすると上空のプラットフォームが点灯し、Lumin のポリシー粒子が降りてくる
- **DEPLOY** — 環境。**4軸ぶんの4行**（後述）。`src/districts.data.js` の `ENV_AXES` 宣言からボタンが生成される
- **DRIVER** — `modern_ebpf` / `ebpf` / `kmod` / `nodriver` の4択（消費能力にわずかに反映される。ノード OS がロードできないものは取り消し線で無効になる）
- **NODE LOAD** — ノード負荷。上げるとドロップが出る
- **TUNING** — falco.yaml のチューニング（後述）。SRE 役の持ち物
- **Console** — Falco の実際のルール名で流れるアラート出力。Sysdig モードでは policy / capture / in-use CVE 相関の行も混ざる
- **シナリオピッカー** — Campaign の陣営行に同居する `<select>`（`SCENARIOS` から生成）。選ぶと街とチューニングと役割が入れ替わる

## DEPLOY — 環境は直交する4軸

**PR #18 で実装済み。** 以前は「環境」が1本のレバーの4値でしたが、いまは**独立した4軸**です。
1軸4値では表せない因果（managed かどうかと kmod の可否が別のこと、Kubernetes かどうかと
`container.*` が付くかが別のこと）が、それで表せなくなっていたからです。

| 軸 | 実体 | 値 | 何が変わるか | 出典 |
|---|---|---|---|---|
| **オーケストレータ** | `ORCH` | なし / self-managed / EKS / GKE / AKS | `k8saudit` の**取得経路**と、そのために建つ**デプロイの形**。managed では API サーバの webhook を向けられないので、プロバイダ別プラグインが **pull** する（EKS=CloudWatch Logs / GKE=Pub/Sub / AKS=Event Hub） | [k8saudit-eks](https://github.com/falcosecurity/plugins/blob/main/plugins/k8saudit-eks/README.md) / [k8saudit-gke](https://github.com/falcosecurity/plugins/blob/main/plugins/k8saudit-gke/README.md) / [公式ブログ](https://falco.org/blog/k8saudit-eks-plugin/) |
| **ノード OS** | `NODE_OSES` | 汎用 Linux / COS | **COS は kernel module を挿入できない**ので `kmod` のボタンが落ちる。**kmod 不可が文書化されている環境はこれだけ** | [Falco / Environments](https://falco.org/docs/setup/enviroments/) |
| **ランタイムソケット** | `SOCKETS` | 到達可 / 不可 | `container.*`（約28フィールド）と `k8s.pod.*` / `k8s.ns.name` が付くか。**Kubernetes かどうかと直交** | [container プラグイン](https://github.com/falcosecurity/plugins/blob/main/plugins/container/README.md) |
| **k8smeta プラグイン** | `K8S_METAS` | 有 / 無 | `k8s.deployment.name` 系（＝API サーバ由来の情報）が付くか。無いと `<NA>` になる | 後述「k8s メタデータは2系統ある」 |

DEPLOY パネルは `ENV_AXES` から**1軸1行**で生成されます（`controls.js` §renderEnvSegs）。
値を1つ足せばボタンが1つ増える。以前この行が `index.html` に手書きされていて、
4つあるうち3つしか列挙されていなかったのが、managed k8s に入り口が無かった原因です。

### 合成は純関数、下流は属性だけを読む

```
composeEnv(選択) → { kernelPath, cluster, apiServer, managed,
                     containerFields, podFields, metaFields, naFields,
                     blockedDrivers, audit, topology, shield, wire, … }
```

`composeEnv()` は**選択の純関数**で、`currentEnv()` がいまの合成結果を返します。
下流は**返ってきた属性だけを読み、環境が何という名前かは訊きません**。

- **`src/controls.js` と `src/log.js` に環境 id のリテラルは1つもありません。** 文字列比較が
  ゼロです（`log.js` の `PLUGIN_PATH` は地区 id の配列で、環境 id ではない）
- 判定は `env.kernelPath`（ドライバが注入されたか）/ `env.cluster`（DaemonSet か1台のサービスか）
  / `env.podFields.length`（Pod のフィールドが付くか）/ `env.blockedDrivers`（このノード OS が
  ロードできないドライバ）/ `env.shield`（どちらの Shield に守る対象があるか）を読む
- 攻撃チェーンも同じで、必要な能力は `needsCaps` → `hasCap()` 経由（[前述](#建てる順と攻撃チェーン)）

環境 id を直接見ていた頃に実際に起きた壊れ方が2つあって、どちらもこの形で消えました:
Shield の可否を環境 id の一覧に固定していたので4つ目の環境が見えなかった、
`k8sapi` の必要条件を self-managed の id に固定していたので managed k8s が理由もなく見逃しになった。

### 名前つき環境 — 軸の上の「位置」

シナリオはプレイヤーに**場所**を渡す必要があります（「self-managed のクラスタを引き継いだ」）。
4つのドロップダウンを渡すわけにはいかないので、軸の上の名前つきの位置を用意してあります。
属性は全部 `composeEnv()` の**導出**なので、**名前つき環境が軸と食い違うことは構造上できません**。

| `DEPLOYMENTS` の id | シナリオの `env.type` | 都市の姿 |
|---|---|---|
| `host` | `standalone` | **1台の大きなマシン**。Pod の代わりに名前付きプロセス（systemd / sshd / nginx / postgres …）が高く建つ。Host Shield は1つだけ。**クラスタ境界も kube-apiserver も消える** |
| `k8s` | `self-managed-k8s` | **ノード台**が並び、各ノードに Pod と Host Shield / falco Pod が乗る（＝DaemonSet）。クラスタ境界の枠が引かれ、プラグイン地区に **kube-apiserver** ＋ **webhook で西向きの矢印**が建つ（監査用の別インスタンスは要らない） |
| `eks` | `managed-k8s` | DaemonSet ＋ **監査経路だけ別の Deployment**。下記 |
| `gke` | `managed-k8s-cos` | 同じ形だが、**ノード OS が COS** なので `kmod` が落ちる。監査は Pub/Sub で**3 Pod** |
| `aks` | `managed-k8s-aks` | Event Hub から pull。**単一インスタンス必須だとは主張しない**（資料に無いので） |
| `plugins` | `serverless` | `nodriver` ＋ ソケット到達不可。**ワークロード・ドライバ・リングバッファの3地区が消灯**し、リングバッファ流入が実測 0。プラグイン入力（k8saudit / cloudtrail / okta / github / gcpaudit）だけがルールエンジンに届く。**クラスタと API サーバは残る**（`k8saudit` はドライバの有無と独立に動く） |

`setDeploy(id)` は**プリセット（軸の位置の組）を当てるだけ**です。`setDeploy('managed')` は
互換のため `eks` に解決されます。

### EKS の監査経路は Pod 1つの Deployment

4軸にして入った**都市の形が変わる新しい素材**がこれです。`k8saudit-eks` は CloudWatch Logs から
**pull** するので、**同時に1インスタンスしか置けない**（2つ動かすと同じログを二重に取って
アラートが重複する）。公式 Helm 値が `controller.kind: deployment` / `replicas: 1` /
`driver.enabled: false` / `collectors.enabled: false` を指定します。

都市ではこれが、DaemonSet の隣に建つ**デッキ1枚と Pod 1つ**として描かれ、無効化された2つは
**空のケージ**（赤い枠だけの空きスロット）として建ちます。**無いことをラベルではなく建物で描く**
ためです。`単一インスタンス必須 — 2つ動かすとアラートが重複する` の地面テキストが付くのも
**EKS だけ**です。

- **GKE は Pub/Sub の exactly-once 配信**なので、単一リージョン内での複数インスタンスが
  明示的に許されています。都市でも **3 Pod** が建ち、空のケージは建ちません
- **AKS は単一必須の注意書きが資料に無い**ので、この模型は単一必須だと**主張しません**。
  ドライバ／コレクタの可否も「資料に記述が無い」として `null` で持ち、**推測しません**

**EKS の制約をここに一般化すると、存在しない制約を教えることになります。**

「カーネルに触れない環境でも Falco は使えるが、そのとき何を見られて何を見られないか」が形で分かる。

3つの注意 —— どれも**出荷済みの README が間違えていた**ところなので明示する。

- **コンテナ／k8s メタデータの出どころはコンテナランタイムのソケット**で、インストール形態とは
  直交する。`container` プラグイン（Falco 0.41 以降は本体同梱）が、カーネル内で cgroup から取った
  `container.id` を鍵にしてソケットを引き、`container.*`（29フィールド）と `k8s.pod.*` /
  `k8s.ns.name` を付ける。`container.id` と `container.type` だけになるのは**ソケットに届かないとき**か、
  エンジンが `bpm` / `lxc` / `libvirt_lxc` のとき。**DaemonSet か systemd かの話ではない**
  （[container プラグイン README](https://github.com/falcosecurity/plugins/blob/main/plugins/container/README.md) /
  [falco.yaml](https://github.com/falcosecurity/falco/blob/master/falco.yaml)）
- **`k8saudit` は host インストールでも動く**（[公式ブログ](https://falco.org/blog/k8saudit-eks-plugin/)が
  `k8saudit-eks` をローカルホストに入れる手順を載せている）。`スタンドアロンサーバ` で監査ルールが
  鳴らないのは**監査ログを出す API サーバが無いから**で、systemd だからではない
- **`nodriver` で無くなるのは、正確にはカーネル→ユーザ空間のリングバッファ**。
  falco.yaml の `nodriver` は「プラグインを `syscall` ソースで動かすのに使える」と書いてあるとおりで、
  ソースそのものが消えるわけではない。そして**クラウド API の操作が syscall ルールに絶対マッチしない
  根拠は「syscall に現れないから」ではなく、ルールがイベントソースごとに分かれていて Falco が
  ソース間の相関をしないから**。`aws_cloudtrail` は `ct.*` を持つ別ソースで、同名のフィールドさえ
  別物として扱われる（[プラグインのアーキテクチャ](https://falco.org/docs/concepts/plugins/architecture/)）

### kmod を塞ぐのはノード OS 軸

**「managed k8s では kmod が選べない」は誤りでした。** kmod をロードできないと文書化されているのは
**GKE の Container-Optimized OS だけ**で、EKS / AKS はそのページに登場しません。制約は
**ノード OS の属性**であって、**managed であること自体の帰結ではありません**。

実装もそうなっています。`NODE_OSES` の `cos` だけが `blocks:['kmod']` を持ち、
`composeEnv()` がそれを `blockedDrivers` として返し、`syncDriverSeg()` が**そこだけを見て**
ボタンを落とします（`ORCH` を動かしても DRIVER のボタンは落ちない）。
`ENV_DRIVERS`（環境ごとのドライバ制約）は `schema.js` に**空で置かれています** ——
根拠のある例外が1つも無いからです。

Bottlerocket の kmod 可否や Secure Boot での未署名モジュール拒否は、falco.org の
Environments ページには**無い**主張なので、**この模型は扱いません**。
（[INVARIANTS.md](INVARIANTS.md) §3.2 は Sysdig のブログを引いて Bottlerocket に触れていますが、
それは Sysdig エージェント側の話で、`ORCH` / `NODE_OSES` の値としては入れていません。
入れるなら軸に値を1つ足して、**出典を先に**差し替えることになります。）

### `nodriver` が DRIVER の選択肢になった

DRIVER レバーは `DRIVERS` 宣言から生成されるので、いまは4択です。

| | |
|---|---|
| `modern_ebpf` | CO-RE eBPF。kernel ≥ 5.8、ビルド不要。0.38 以降の既定 |
| `ebpf` | legacy eBPF プローブ。2026-12-04 に廃止予定 |
| `kmod` | カーネルモジュール。完全な権限が必要。**COS では挿入できない** |
| `nodriver` | ドライバを注入しない。**kernel-less の受け皿がここに来た** |

`nodriver` を選ぶと `kernelPath` が false になり、そこから
「西端に描くものが無い（`topology:'bare'`）」「リングバッファ流入 0」「Host Shield が無い
（Cluster Shield はクラスタがある限り残る）」「コンソールのタイトルが
`falco --engine nodriver · plugin sources only` になる」が**全部導出されます**。
以前 `サーバレス／特権なし` という環境の名前が背負っていた帰結が、ドライバの属性1つに落ちました。

**`nodriver` で無くなるのは、正確にはカーネル→ユーザ空間のリングバッファ**です。
falco.yaml が書いているとおり、`syscall` ソースそのものが消えるわけではありません。
そして**監査ログの存在はドライバの有無と独立**なので、`nodriver` でも `k8saudit` は動きます。

## k8s メタデータは2系統ある —— ランタイム由来と API サーバ由来

Falco 0.37 で**本体の Kubernetes クライアントが外され**、API サーバから取る分は
`k8smeta` プラグイン ＋ `k8s-metacollector` に分離された。ここで大事なのは、
**残った `k8s.pod.*` / `k8s.ns.name` は API サーバ由来ではない**こと。出どころは
コンテナランタイムのソケットで、だから metacollector が無くても付く。

| 系統 | 出どころ | 代表的なフィールド |
|---|---|---|
| **ランタイム由来** | コンテナランタイムのソケット（`container` プラグイン。0.41 以降は本体同梱） | `k8s.pod.name` / `k8s.pod.uid` / `k8s.pod.sandbox_id` / `k8s.pod.full_sandbox_id` / `k8s.pod.label(s)` / `k8s.pod.ip` / `k8s.pod.cni.json` / `k8s.ns.name` ＋ `container.*` |
| **API サーバ由来** | `k8s-metacollector`（クラスタに1つ）→ `k8smeta` プラグイン（ノードごとに1つ） | `k8smeta.deployment.name` / `k8smeta.rs.name` / `k8smeta.svc.name` / `k8smeta.ns.*` … |

- `k8s.deployment.name` / `k8s.rc.name` / `k8s.svc.name` / `k8s.rs.name` は**非推奨**。
  Falco のフィールド表が「`k8smeta` プラグインを使え」と書いている
- `k8s.pod.name`（ランタイム由来）と `k8smeta.pod.name`（API サーバ由来）は**併用できる**。
  置き換えではなく追加
- `k8smeta` は `syscall` ソースを補強する field-extraction プラグイン。collector はクラスタに1つ、
  プラグインはノードごとで、`nodeName` を Pod から動的に渡さないと自ノード以外のメタデータが付かない
- **2系統は実際に分かれました**（PR #18）。04 状態エンジンのエンリッチのガントリーは**3本**あり、
  3つの別々の問いに対応します: `container`（ソケットに届いたか。**カーネル経路がある間は消灯しない** ——
  `container.id` と `container.type` は cgroup から取れるのでソケットを必要としない。
  2フィールドしか運んでいないことは減光で示す）/ `k8sRuntime`（`env.podFields.length > 0`）/
  `k8sApi`（`env.k8sMeta`）。コンソールの行も分かれて、`k8smeta` が無い場合は
  `k8s.deployment.name=<NA>` と印字されます（**無いより悪い ——「効いているように見える」ので**）
- **k8smeta 軸は API サーバが無いと「効果を失うが、選択は残る」。** k8s-metacollector が
  話す相手がいないからです。ボタンは取り消し線になり、理由がツールチップに出ます。
  **軸の独立性は保ったまま、因果だけが無くなる**という形にしてあります

出典: [Introducing Falco 0.37.0](https://falco.org/blog/falco-0-37-0/) /
[k8smeta プラグイン README](https://github.com/falcosecurity/plugins/blob/main/plugins/k8smeta/README.md) /
[Supported Fields](https://falco.org/docs/reference/rules/supported-fields/) /
[How to Deploy Falco with k8s-metacollector](https://falco.org/blog/falco-k8smeta-plugin/)

## Sysdig Shield（STACK を `+ Sysdig` にしたとき）

[Sysdig Docs](https://docs.sysdig.com/en/docs/installation/sysdig-secure/install-agent-components/) の現行構成に合わせている。Classic Agent 方式を置き換える2コンポーネント。

| コンポーネント | スコープ | 都市での表現 |
|---|---|---|
| **Host Shield** | ノード単位。K8s では DaemonSet、単体ホストでは Linux バイナリ（パッケージ）やコンテナ | 02〜06 の地区を囲む Deep See の境界として描かれる |
| **Cluster Shield** | **クラスタスコープの Deployment**。`admission_control` / `audit` / `container_vulnerability_management` / `posture` | クラスタの脇に建つ Deep See ＋ Lumin のデッキ |

**`スタンドアロンサーバ` に切り替えると Cluster Shield は消える** — 守るクラスタが無いので存在しない。この対応関係が一番伝えたいところ。（レプリカ数を書いた資料は無いので、この模型は「クラスタに対して1つのスコープ」までしか言わない。）

Host Shield のパッケージ導入時のドライバは Universal eBPF（Linux 5.8+ 推奨）/ kmod（旧カーネル）/ Legacy eBPF（非推奨）の3択（[Install Host Shield from a Package](https://docs.sysdig.com/en/sysdig-secure/install-package-host-shield/)）。**Legacy eBPF は 2026-12-04 に廃止予定**（[Understand Agent Drivers](https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/)）。Falco 側も現行の falco.yaml が挙げる engine は `kmod` / `modern_ebpf` / `replay` / `nodriver` で、legacy な `ebpf` は一覧から落ちている。

Sysdig の Universal eBPF と Falco の `modern_ebpf` は、要件（BPF ring buffer ＋ BTF）が一致するので**この模型では並行するものとして扱っている**。ただしこれは**こちらが引いている並行で、どちらの文書も「同じもの」とは言っていない**。

## TUNING — ドロップは2種類ある、というのが一番の学び

ドロップが出たときに触れるレバーを載せてある。要点は **効くレバーと効かないレバーがある**こと。

| レバー | 対応する設定 | 効果 |
|---|---|---|
| `base_syscalls` | all / default / custom_set | ドライバが転送する量そのもの。**持続超過に効く唯一のレバー** |
| `buf_size_preset` | 1–10（4 = **1バッファ 8 MiB** が既定） | リングバッファ1つのサイズ。**バーストにだけ効く** |
| `cpus_for_each_syscall_buffer` | 1 / 2 / 4 | 1つのバッファを共有する CPU 数（**既定 2**）。この模型では 1 にすると消費能力が上がる（下の注記） |
| `slow output` | 同期 program / http 出力 | オンにすると消費能力が半減し、**syscall 量が普通でもドロップする** |
| `syscall_event_drops.actions` | ignore / log / alert / exit | ドロップを検知したときの振る舞い |

HUD の `drain utilisation` と判定バンドが、いまどちらの状態かを名指しする:

- **持続的な入力超過**（util > 100%）— 失う割合は `1 - 消費能力/入力`。バッファをいくら増やしても直らない
- **バースト起因** — 平均は足りている。`buf_size_preset` を上げれば直る
- **ドロップなし**

> **`cpus_for_each_syscall_buffer` の向きは INVARIANTS で ⚠️ が付いています。**
> CPU とバッファの**対応**（`modern_ebpf` 専用・既定 2・`1` で CPU ごと・`0` で全 CPU 共有1つ）は
> falco.yaml が出典ですが、**ドロップ対策としての推奨は逆向き**です —— Docs は
> `cpus_for_each_buffer` を **4–6 に上げて** `buf_size_preset` 6–7 と組ませることを勧めています
> （バッファを細かくするより、少なく大きくする）。いまのモデルは「1 にすると消費能力が上がる」
> という向きで動いており、[INVARIANTS.md](INVARIANTS.md) §1.4 が**要判断**として記録しています。

### バッファは「CPU ごと」ではない（既定では）

ここは出荷済みの README が間違えていた。**`kmod` では CPU ごとだが、既定の `modern_ebpf` では CPU ペアごと**。

- `cpus_for_each_buffer` は **`modern_ebpf` 専用**で**既定 2** = 1つのバッファを 2 CPU で共有する
  （`1` にすると CPU ごと ＝ `ebpf` ドライバの既定、`0` で全オンライン CPU で1つ）
- バッファ数は **`ceil(オンライン CPU 数 ÷ この値)`**。falco.yaml のコメントが
  「CPU 7個・既定 2 → **バッファ4個**」（最後の1つだけ CPU 1個ぶん）を図で実演している
- `buf_size_preset` の 8 MiB は**1バッファのサイズ**。しかもバッファはプロセスの仮想メモリに
  **二重にマップ**されるので、8 MiB のバッファは仮想メモリ上 **16 MiB** を占める
- 現行の設定キーは `engine.modern_ebpf.cpus_for_each_buffer` と
  `engine.<engine>.buf_size_preset`（HUD のラベルは旧名の `cpus_for_each_syscall_buffer` のまま）
- falco.yaml 自身の書き方が2つに分かれている: `buf_size_preset` の節は「各 CPU が専用の
  バッファを持つ」と書き、`cpus_for_each_buffer`（`modern_ebpf` 専用）の節がそれを上書きしている。
  **既定のドライバは `modern_ebpf` なので、既定の挙動としては後者が正**

出典: [falco.yaml](https://github.com/falcosecurity/falco/blob/master/falco.yaml)（`cpus_for_each_buffer` と `buf_size_preset` のコメント）

**表示も追随済み**: 3D の地面テキストは `1 buffer = 8 MiB (preset 4) · ceil(nCPU ÷ 2) buffers`、
03 の地区パネルは `既定 8 MiB × ceil(nCPU ÷ 2) 本`、TUNING の HUD は
`<preset> · <N> MiB/buffer` と `<n> CPU/buffer → <m> buffers` を出します
（`onTuneChange()` が起動時に上書きするので、`index.html` に残っている静的な文字列は表示されません）。

### 実測した挙動

| 条件 | ドロップ | util | 判定 |
|---|---|---|---|
| 既定 (load ×1.0) | 0% | 65% | ドロップなし |
| load ×1.5 | 0.38% | 97% | バースト |
| load ×1.5 + `buf_size_preset 9` | 0.03% | 97% | **バッファが効いた** |
| `base_syscalls: all` (load ×1.0) | 14% | 119% | 持続超過 |
| load ×2.5 | 28.7% | 161% | 持続超過 |
| load ×2.5 + `buf_size_preset 10` (512 MiB) | 27.4% | 161% | **まったく効かない** |
| load ×2.5 + `custom_set` | 0% | 65% | **これが効く** |
| load ×1.0 + slow output | 19.8% | 124% | 持続超過 |

「バッファを増やしたのに直らない → Falco は速度に追いつけない」という誤診を潰すのが狙い。

`load ×1.0 + slow output` の行は `19.8% / 124%` に訂正済み。
**`load ×1.5` の行は据え置き**です —— [INVARIANTS.md](INVARIANTS.md) §7 はモデルの真値を
`0.18%` と記録しており（HUD 表示値も 0.18%）、この表の `0.38%` と合っていません。
訂正の判断はこの表の持ち主（PM）と検査レーンに委ねます。

### syscall_event_drops.actions を `exit` にすると

ドロップが続くとエージェントが停止する。停止中は**リングバッファ流入 0・アラート 0** で、検知が本当にゼロになる（`ignore` は「黙って盲目になる」ことを選ぶのと同じ、という対比）。負荷か設定を変えると再起動する。

## 音 — パイプラインを聴く

**外部の音声ファイルを持てない**という制約があります。製品は**単一 HTML を `file://` で開くもの**
なので、聴くに値するサンプルはその中で base64 になります。そこで `src/audio.js` は
**オシレータと生成したノイズバッファ1つから WebAudio で合成**しています。コードなら数 KB です。
生成物の増分は **+8.3 KB（minified）/ +3.0 KB（gzip）**。

**既定はミュート**で、**誰かが音を求めるまで `AudioContext` を作りません**（ブラウザは autoplay を
止めるし、suspend されたまま生きているコンテキストは持つ理由の無いスレッドなので）。設定は
`localStorage` に残ります。いま HUD にトグルはなく、[コンソール](#コンソールから操作する)から
`__city.setMuted(false)` → `__city.initAudio()` で開けます（HUD のトグルは画面レーンの持ち物）。

対応は**装飾ではなく模型として**読めるようにしてあります。

| | |
|---|---|
| **priority** | 深刻度が上がると**音程が下がり・音数が増え・音色が荒れ・協和が三全音になる**。**音量ではなく4つの独立した次元**で分けているので、ノートパソコンのスピーカーで音量を下げていても4段が混ざらない |
| **drop** | 飲み込まれるような短い音。**唯一「悪くなっていい」音**で、ドロップが続くと砂利になる（イベントを落としているノードはそう聞こえるべきなので）。上限は付けてある —— 不快なのは狙い、壊れているのは違う |
| **build** | スラブ3枚が着地する音。地区ごとに梯子が1段上がるので、**建てると文字どおり上がっていく** |
| **detect / miss** | 検知は**上がって澄んでいる**。見逃しは**下がって鈍く、わずかに音程がうなる**。方向も音色も逆 |
| **layer** | Sysdig は上から来る。音域の上端からのグライドダウンが、下で膨らむ和音に着地する |

priority の4段は `emergency` / `alert` / `critical` → 0、`error` → 1、`warning` → 2、
`notice` / `info` / `debug` → 3 に畳んであります（Falco は8段あるので、名前でも数値でも受ける）。

アラートは毎フレーム鳴り得るので、**実際の作業は抑制**です: 種類ごとの最小間隔、
トークンバケット（毎秒10ノートまで）、同時発音数の上限、**同じ priority が続くと減衰する
「疲労」**（バースト自体は減衰させない）。`build` / `detect` / `miss` / `layer` は
**プレイヤーが待っている単発の音**なので、アラートとドロップの嵐に飢えさせられることはありません。

## 地区を足す

座標を手で決める必要はない。`DISTRICTS` に1つ宣言して、ビルダー関数を1つ書くだけ。
レイアウトエンジン（`layout()`）が位置を割り当て、そこから下流が全部追随する
— カメラのフィット、ミニマップの枠と色、ツアーのボタン、キーボードショートカット、
パーティクルの通過座標、Shield オーバーレイの範囲。**他の数字を触る必要はない。**

`src/districts.data.js` に宣言を1つ:

```js
{
  id:'falcoctl', n:'09', tag:'RULE DISTRIBUTION',
  jp:'ルール配布', en:'falcoctl — oci artifacts',
  w:20, d:16, top:14,                   // 必要な広さ（x × z）と高さ
  lane:'north', after:'rules', dx:-4,   // どこに置くか
  color:0xC9AEDA,                       // ミニマップの色もここから引かれる
  hoverT:'...', hoverS:'...', hoverM:['...'],
  metrics:[['見出し','値']],
  body:`<h3>...</h3>`                   // 詳細パネルの中身
}
```

| フィールド | 意味 |
|---|---|
| `lane` | `'flow'`（既定）= syscall→alert の軸上に西から東へ順に並ぶ / `'north'` = 流れの背後（−z）/ `'south'` = 手前（+z） |
| `after` | `north` / `south` のとき、どの地区に横位置を合わせるか |
| `dx` | `after` からの x のずれ |
| `y` | 高さ。上空に浮かせるデッキ用（Sysdig Secure が `y:31`） |
| `w` / `d` / `top` | x 幅 / z 奥行き / 高さ。当たり判定とカメラの導出に使われる |
| `cam` | 省略可。省略すると `w` / `d` / `top` から妥当な3/4ビューが導出される |

`src/districts.build.js` に `BUILD_falcoctl` を書き、同ファイル末尾の `BUILDERS` に登録する
（登録を忘れると `src/city.js` が地区名つきで例外を投げるので、黙って壊れることはない）。

ビルダーは `(group, d, cx, cz)` を受け取る。`d.x0` / `d.x1` / `d.z0` / `d.z1` は
レイアウト後の実座標なので、**中身は必ず相対で書く**（絶対座標を書くと地区を挿入した
ときに崩れる）。使えるヘルパー: `box()` / `edged()` / `put()` / `groundText()` /
`chevron()`（ブランド正式形状）。

流れの軸（`lane:'flow'`）に新しい段を挿入した場合だけ、パーティクルの振る舞いを
`ST`（`index.html` の 1b 節）に足す必要がある。annex（`north` / `south`）なら不要。

### 09 ルール配布 について

追加の実例として入れてある。「Falco の既定ルールは思ったより少ない」の答えがここ。

- ルールとプラグインは **OCI アーティファクト**としてレジストリから配られ、`falcoctl` が取得・更新する
- 成熟度は **Stable / Incubating / Sandbox**（＋Deprecated）。**リリースパッケージに同梱されるのは Stable のみ**で、他は別途インストールが必要
- Helm の3キーは別物 — `falcoctl.config.artifact.install.refs`（取得）/ `falcoctl.config.artifact.follow.refs`（自動更新）/ `falco.rules_files`（読み込み）。揃っていないと「入れたはずのルールが効かない」が起きる

STACK を `+ Sysdig` に切り替えると、ルールの流れの出どころがこの地区から上空の
プラットフォームに移る（マネージドルールが降りてくる）。同じ流れで出どころだけが違う、
という対比になっている。

出典: [Falco Default Rules](https://falco.org/docs/reference/rules/default-rules/) /
[Adoption of Falco Rules in Production](https://falco.org/docs/concepts/rules/adoption-rules/) /
[falcosecurity/rules](https://github.com/falcosecurity/rules)

## パーティクルの色

| 色 | 意味 |
|---|---|
| グレー | 生の syscall（まだ意味を持たない） |
| Falco Blue | エンリッチ済みイベント |
| オレンジ | プラグイン入力（k8s audit / cloudtrail …） |
| 赤 | ドロップ（バッファ溢れ） |
| 紫・赤・橙・青 | ルールマッチ → priority 別のアラート |
| 薄紫（降下） | falcoctl が配るルール（OSS） |
| Lumin（降下） | Sysdig から降りるポリシー／応答 |

## 数値について

HUD の数字は **illustrative（見せるための代表値）**。パネル見出しにもそう書いてある。
比率のほうが本質で、そこは意図して設計してある:

- カーネル側で通すのは全 syscall の約 42%（安いフィルタを一番手前に置く）
- 評価されたイベントのうち鳴るのは 0.4% 程度（検知はごく一部）
- 健全なノードのドロップはほぼ 0。落ちるのは負荷をかけたときだけ

ドライバ既定値・バッファサイズ・優先度の並び・ルール名・プラグイン名・出力チャネルは実際の Falco の仕様に合わせている。
バッファと CPU の対応（既定の `modern_ebpf` は **CPU ペアごと**）も画面に反映済み（上の TUNING 節）。

ただし**リングバッファ地区の CPU 数は 8 固定**です（`RING_CPUS`）。
だから「2 vCPU のノードでは既定でバッファが1本」を画面で成立させられず、
`nodes-are-not-buffers` シナリオが登録できていません（[前述](#実装待ち--2本)）。

## コンソールから操作する

`window.__city` から素で叩ける。`evaluate()` / `blameOf()` は純関数なので、
README の表はそのまま検証コードとして回せる。

世界とチューニング:

```js
__city.S.load = 2.5; __city.onTune()          // 負荷を上げてドロップを見せる
__city.S.tune.syscallSet='custom'; __city.onTune()  // 絞って直す
__city.setDeploy('host')                      // スタンドアロンサーバ
__city.setDeploy('plugins')                   // nodriver（カーネル経路なし）
__city.setDeploy('eks')                       // managed k8s · EKS（'managed' でも同じ）
__city.setDeploy('gke')                       // managed k8s · GKE（COS なので kmod が落ちる）
__city.setMode('sysdig')                      // Sysdig レイヤを点灯
__city.select('ring')                         // 地区へ飛ぶ
__city.model()                                // inflow / cap / util / dropP を見る
__city.pump(600)                              // rAF なしでシミュレーションを進める（検証用）
```

`setDeploy()` はプリセット（軸の位置の組）を当てます。**軸を1本ずつ動かす `setEnv()` は
`controls.js` から export されていますが、`__city` には出ていません** —— 画面のボタンで動かしてください。

シナリオ:

```js
__city.SCENARIOS                              // 登録済み（order 順）
__city.SCENARIO_ERRORS                        // 検証で落ちた1本とその理由（フィールドパス付き）
__city.startScenario('slow-output')            // 街・チューニング・役割ごと入れ替える
__city.activeScenario()                       // いまのシナリオ（正規化済み・既定値が埋まった形）
__city.activeChain()                          // このシナリオで来る攻撃ステップ（ウェーブを平坦化した順）
__city.runAttack(); __city.goalStatus()        // クリア条件の達成状況（items / cleared）
```

陣営・役割:

```js
__city.setUiMode('campaign')                  // キャンペーンに入る（既定シナリオ = greenfield）
__city.setRole('sre')                         // 役割を選ぶ（null で全役）
__city.setSide('defense')                     // 陣営（攻撃側は未実装なので false が返る）
['driver','ring','state','rules','outputs'].forEach(__city.build)
__city.evaluate().map(r => [r.jp, r.caught, __city.blameOf(r)])
__city.roleReport()                           // スコアカードの素データ
__city.OWNER                                  // 地区 → 役割
```

音（既定はミュート。`initAudio()` は**ユーザ操作の中から**呼ぶこと）:

```js
__city.setMuted(false); __city.initAudio()    // 鳴らす（この順で）
__city.setVolume(0.4)                         // 0..1
__city.audioState()                           // {muted, volume, ready, running}
__city.play('alert', {priority:'critical'})   // 1発鳴らして確かめる
__city.toggleMuted()
```

`window.__errs` に未捕捉エラーが溜まる。

## 既知の制約

- `docs/index.html` は Three.js を同梱しているのでオフラインで動く。ただし Poppins / Share Tech Mono は Google Fonts から読むので、完全オフラインだとシステムフォントに落ちる（レイアウトは崩れない）
- 背景タブでは `requestAnimationFrame` が止まるので、見せる前にタブを前面にしておく（0×0 ビューポートからの復帰は ResizeObserver で対応済み）
- WebGL が要る。リモートデスクトップ／VDI 経由だと重い場合がある
- 初期カメラは都市の AABB に対する厳密フィットなので、1920×1080 から縦長 820×1200 まで8地区すべてが収まることを確認済み
