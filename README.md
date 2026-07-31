# Falco / Sysdig — Runtime Security City

**▸ https://higakikeita.github.io/falco-city/**

`syscall → alert` のパイプラインを、歩ける 3D の「都市」として表現したインタラクティブモデル。
登壇・ウェビナー・顧客説明で「Falco と Sysdig が実際に何をしているか」を1画面で見せるためのもの。

## ファイル構成

`src/` が正。`docs/` は生成物で、**リポジトリには入っていない**（CI が作って Pages に配る）。

| 場所 | 中身 |
|---|---|
| `src/index.html` | HTML シェル（マークアップ＋CSS）。dev では importmap で CDN の three を解決する |
| `src/*.js` | ES モジュール。担当の境界（後述の「開発の分担」） |
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
| 03 | リングバッファ | CPU ごとの共有メモリ（8 MiB/CPU）。**唯一イベントが落ちる場所** |
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
| `Explore` | 完成した街を自由に見る。説明・デモ用 |
| `Campaign` | **空き地から検知パイプラインを建てるゲーム。** 建てたものだけで攻撃チェーンを迎え撃つ |

## Campaign — 一から建てる

空き地から始まる。ワークロードは syscall を出しているが、受け止めるものが何も無い
（イベントは建てた範囲の端で消える。何も建てていなければ即座に消える）。

建設は依存順にしか進めない: ドライバ → リングバッファ → 状態エンジン → ルールエンジン →
出力チャネル。そこから プラグイン入力 / ルール配布 / Sysdig Secure が枝分かれする。
1段建てるたびに「それが無かったら何ができなかったか」が出る。

`攻撃チェーンを流す` で6段の攻撃が走り、**建てたものと、いまのチューニングだけ**で判定される。

| # | 攻撃 | 必要なもの |
|---|---|---|
| 1 | kubectl exec でコンテナにシェルを取る | driver → outputs 一式 |
| 2 | /etc/shadow を読んで資格情報を探す | 同上 |
| 3 | /etc/cron.d に書き込んで永続化する | 同上 |
| 4 | /tmp に落としたバイナリを実行する | ＋ **ルール配布**（既定同梱のルールセットには無い検知） |
| 5 | K8s API サーバに接触して権限を探る | ＋ **K8s 構成**（Host には k8s 文脈が無い） |
| 6 | 盗んだ資格情報でクラウドへ | ＋ **プラグイン入力**（syscall には現れないので原理的に不可） |
| R | 侵害されたコンテナを止める | ＋ **Sysdig**（OSS は目。止める手は別） |

### 実測した進行

| 状態 | 検知 | 見逃した理由 |
|---|---|---|
| 何も建てていない | 0/7 | 全部 |
| syscall 経路一式 | 4/7 | step4・step6・対処 |
| ＋プラグイン入力 | 5/7 | step4・対処 |
| ＋ルール配布 | 6/7 | 対処 |
| ＋Sysdig Secure | **7/7** | — |
| そこから NODE LOAD を ×2.6 | 6/7 | **step1 がリングバッファでドロップして消えた** |
| そこから Host 構成に変更 | 6/7 | **step5 が構成上不可能になった** |

最後の2行が効く。**全部建てても、チューニングと構成を間違えれば検知は落ちる。**
パイプラインを持っていることと、それが機能していることは別。

## 操作

- ドラッグでオービット / スクロールでズーム / 地区をクリックで詳細
- **STACK** — `Falco OSS` ↔ `+ Sysdig`。Sysdig 側にすると上空のプラットフォームが点灯し、Lumin のポリシー粒子が降りてくる
- **DEPLOY** — デプロイ形態（後述）
- **DRIVER** — 3方式の切り替え（消費能力にわずかに反映される。kernel-less では選択不可になる）
- **NODE LOAD** — ノード負荷。上げるとドロップが出る
- **TUNING** — falco.yaml のチューニング（後述）。この教材の本体
- **Console** — Falco の実際のルール名で流れるアラート出力。Sysdig モードでは policy / capture / in-use CVE 相関の行も混ざる

## DEPLOY — デプロイ形態で都市の形が変わる

西側の街並みそのものが作り替わる。

| 選択 | 都市の姿 | 検知できるもの |
|---|---|---|
| `K8s DaemonSet` | **3つのノード台**が並び、各ノードに Pod が建ち、各ノードに1つずつ Host Shield / falco Pod が乗る（＝DaemonSet）。クラスタ境界の枠が引かれ、プラグイン地区に **kube-apiserver** が建つ | container + k8s 両方のガントリーが点灯。アラートに `k8s.ns` / `k8s.pod` が付く |
| `Host (systemd)` | **1台の大きなマシン**に切り替わり、Pod の代わりに名前付きプロセス（systemd / sshd / nginx / postgres …）が高く建つ。Host Shield は1つだけ。**クラスタ境界も kube-apiserver も消える** | k8s メタデータのガントリーが消灯。アラートは `container.id` までしか持たず、**k8saudit ルールは1本も発火しない** |
| `Kernel-less` | **ワークロード・ドライバ・リングバッファの3地区が消灯**。リングバッファ流入が実測 0 | プラグイン入力（k8saudit / cloudtrail / okta / github）だけがルールエンジンに届き、syscall 系ルールは1つも発火しない |

「カーネルに触れない環境でも Falco は使えるが、そのとき何を見られて何を見られないか」が形で分かる。

## Sysdig Shield（STACK を `+ Sysdig` にしたとき）

[Sysdig Docs](https://docs.sysdig.com/en/docs/installation/sysdig-secure/install-agent-components/) の現行構成に合わせている。Classic Agent 方式を置き換える2コンポーネント。

| コンポーネント | スコープ | 都市での表現 |
|---|---|---|
| **Host Shield** | ノード単位。K8s では DaemonSet、単体ホストでは Linux バイナリ（パッケージ）やコンテナ | 02〜06 の地区を囲む Deep See の境界として描かれる |
| **Cluster Shield** | クラスタ単位で1つ（Deployment）。`admission_control` / `audit` / `container_vulnerability_management` / `posture` | クラスタの脇に建つ Deep See ＋ Lumin のデッキ |

**`Host (systemd)` に切り替えると Cluster Shield は消える** — 守るクラスタが無いので存在しない。この対応関係が一番伝えたいところ。

Host Shield のパッケージ導入時のドライバは Universal eBPF（Linux 5.8+ 推奨）/ kmod（旧カーネル）/ Legacy eBPF（非推奨）の3択（[Install Host Shield from a Package](https://docs.sysdig.com/en/sysdig-secure/install-package-host-shield/)）。Falco 側の `modern_ebpf` に相当するものを Sysdig は Universal eBPF と呼ぶ。

## TUNING — ドロップは2種類ある、というのが一番の学び

ドロップが出たときに触れるレバーを載せてある。要点は **効くレバーと効かないレバーがある**こと。

| レバー | 対応する設定 | 効果 |
|---|---|---|
| `base_syscalls` | all / default / custom_set | ドライバが転送する量そのもの。**持続超過に効く唯一のレバー** |
| `buf_size_preset` | 1–10（4 = 8 MiB/CPU が既定） | リングバッファのサイズ。**バーストにだけ効く** |
| `cpus_for_each_syscall_buffer` | 1 / 2 / 4 | バッファを共有する CPU 数。1 にすると消費能力が上がる |
| `slow output` | 同期 program / http 出力 | オンにすると消費能力が半減し、**syscall 量が普通でもドロップする** |
| `syscall_event_drops.actions` | ignore / log / alert / exit | ドロップを検知したときの振る舞い |

HUD の `drain utilisation` と判定バンドが、いまどちらの状態かを名指しする:

- **持続的な入力超過**（util > 100%）— 失う割合は `1 - 消費能力/入力`。バッファをいくら増やしても直らない
- **バースト起因** — 平均は足りている。`buf_size_preset` を上げれば直る
- **ドロップなし**

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
| load ×1.0 + slow output | 28.5% | 166% | 持続超過 |

「バッファを増やしたのに直らない → Falco は速度に追いつけない」という誤診を潰すのが狙い。

### syscall_event_drops.actions を `exit` にすると

ドロップが続くとエージェントが停止する。停止中は**リングバッファ流入 0・アラート 0** で、検知が本当にゼロになる（`ignore` は「黙って盲目になる」ことを選ぶのと同じ、という対比）。負荷か設定を変えると再起動する。

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

## デバッグ / 登壇中の操作

コンソールから直接いじれる:

```js
__city.S.load = 2.5; __city.onTune()          // 負荷を上げてドロップを見せる
__city.S.tune.syscallSet='custom'; __city.onTune()  // 絞って直す
__city.setDeploy('plugins')                   // kernel-less に切り替え
__city.setMode('sysdig')                      // Sysdig レイヤを点灯
__city.select('ring')                         // 地区へ飛ぶ
__city.model()                                // inflow / cap / util / dropP を見る
__city.pump(600)                              // rAF なしでシミュレーションを進める（検証用）
```

`window.__errs` に未捕捉エラーが溜まる。

## 既知の制約

- `docs/index.html` は Three.js を同梱しているのでオフラインで動く。ただし Poppins / Share Tech Mono は Google Fonts から読むので、完全オフラインだとシステムフォントに落ちる（レイアウトは崩れない）
- 背景タブでは `requestAnimationFrame` が止まるので、見せる前にタブを前面にしておく（0×0 ビューポートからの復帰は ResizeObserver で対応済み）
- WebGL が要る。リモートデスクトップ／VDI 経由だと重い場合がある
- 初期カメラは都市の AABB に対する厳密フィットなので、1920×1080 から縦長 820×1200 まで8地区すべてが収まることを確認済み
