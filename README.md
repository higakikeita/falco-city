# Falco / Sysdig — Runtime Security City

**▸ https://higakikeita.github.io/falco-city/**

複数セッションで並行開発しています。担当境界と運用ルールは [HANDOFF-PM.md](HANDOFF-PM.md) が正。

`syscall → alert` のパイプラインを歩ける 3D の「都市」にした、**ブラウザで遊ぶゲーム**。
空き地から検知パイプラインを建て、攻撃チェーンを迎え撃つ。

**ゲームであることが目的で、Falco / Sysdig の理解が進むのは副産物。**
だから因果は本物にしてあるが、遊びとして成立しないものは入れない。

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
| 5 | K8s API サーバに接触して権限を探る | ＋ **k8s の文脈**（オーケストレータが無い環境には API サーバも Pod も無い） |
| 6 | 盗んだ資格情報でクラウドへ | ＋ **プラグイン入力**（クラウド API は**別のイベントソース**なので syscall ルールには原理的に届かない） |
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

## ルールと描画の分離

`src/campaign.js` が**決める側**、`src/ui.js` が**見せる側**。

- `campaign.js` に DOM は無い（要素参照も描画もしない）。`scripts/check-imports.mjs` が機械的に検査する
- 状態が変わると `onCampaignChange` で通知が飛び、`ui.js` が描き直す
- レバーの所有は `LEVER_OWNER` が**名前**で持ち、どの CSS ノードかを知っているのは `ui.js` だけ

## 操作

- ドラッグでオービット / スクロールでズーム / 地区をクリックで詳細
- **STACK** — `Falco OSS` ↔ `+ Sysdig`。Sysdig 側にすると上空のプラットフォームが点灯し、Lumin のポリシー粒子が降りてくる
- **DEPLOY** — 環境（後述）。`src/districts.data.js` の宣言からボタンが生成される
- **DRIVER** — 3方式の切り替え（消費能力にわずかに反映される。カーネル経路を持たない環境では選択不可になる）
- **NODE LOAD** — ノード負荷。上げるとドロップが出る
- **TUNING** — falco.yaml のチューニング（後述）。SRE 役の持ち物
- **Console** — Falco の実際のルール名で流れるアラート出力。Sysdig モードでは policy / capture / in-use CVE 相関の行も混ざる

## DEPLOY — 環境で都市の形が変わる

西側の街並みそのものが作り替わる。ボタンは `src/districts.data.js` の `DEPLOYMENTS` 宣言から
生成されるので、環境を1つ足すのは宣言を1つ足すこと。

| 選択 | 都市の姿 | 見えるもの / 見えないもの |
|---|---|---|
| `スタンドアロンサーバ` | **1台の大きなマシン**に切り替わり、Pod の代わりに名前付きプロセス（systemd / sshd / nginx / postgres …）が高く建つ。Host Shield は1つだけ。**クラスタ境界も kube-apiserver も消える** | k8s メタデータのガントリーが消灯する。理由は**オーケストレータが無いこと**（`k8s.pod.*` を付ける相手の Pod が存在しない）。**systemd で入れたからではない** —— コンテナが動いていてランタイムのソケットに届けば `container.*` は付く |
| `self-managed k8s` | **3つのノード台**が並び、各ノードに Pod が建ち、各ノードに1つずつ Host Shield / falco Pod が乗る（＝DaemonSet）。クラスタ境界の枠が引かれ、プラグイン地区に **kube-apiserver** が建つ | container + k8s 両方のガントリーが点灯。アラートに `k8s.ns.name` / `k8s.pod.name` が付く |
| `managed k8s (EKS/GKE/AKS)` | いまは self-managed と**同じ形**を描く。違うのは形ではなく**監査ログの取得経路**（次節） | 同上。ただし**攻撃チェーンの step5 の判定だけは self-managed に固定されたまま**（下記「実装が追いついていないところ」） |
| `サーバレス／特権なし` | **ワークロード・ドライバ・リングバッファの3地区が消灯**。リングバッファ流入が実測 0 | プラグイン入力（k8saudit / cloudtrail / okta / github）だけがルールエンジンに届き、syscall 系ルールは1つも発火しない |

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
- **`サーバレス／特権なし` で無くなるのは、正確にはカーネル→ユーザ空間のリングバッファ**。
  falco.yaml の `nodriver` は「プラグインを `syscall` ソースで動かすのに使える」と書いてあるとおりで、
  ソースそのものが消えるわけではない。そして**クラウド API の操作が syscall ルールに絶対マッチしない
  根拠は「syscall に現れないから」ではなく、ルールがイベントソースごとに分かれていて Falco が
  ソース間の相関をしないから**。`aws_cloudtrail` は `ct.*` を持つ別ソースで、同名のフィールドさえ
  別物として扱われる（[プラグインのアーキテクチャ](https://falco.org/docs/concepts/plugins/architecture/)）

### 環境は1軸4値ではなく、直交する4軸（実装中）

上の1軸4値が**いま動いているもの**。因果として正しいのは次の**4軸**で、ここへの置き換えは
別セッションで進行中 —— **この表はまだ動かない**（レバーは1本しか無い）。

| 軸 | 値 | 何が変わるか | 出典 |
|---|---|---|---|
| **オーケストレータ** | なし / self-managed k8s / managed k8s | `k8saudit` の**取得経路**。managed では API サーバの webhook が使えず、プロバイダ別プラグインが **pull** する（EKS=CloudWatch Logs / GKE=Pub/Sub / AKS=Event Hub） | [k8saudit-eks](https://github.com/falcosecurity/plugins/blob/main/plugins/k8saudit-eks/README.md) / [k8saudit-gke](https://github.com/falcosecurity/plugins/blob/main/plugins/k8saudit-gke/README.md) |
| **ノード OS** | 汎用 / COS | **COS は kernel module をロードできない**ので eBPF になる。**kmod 不可が文書化されている環境はこれだけ** | [Falco / Environments](https://falco.org/docs/setup/enviroments/) |
| **ランタイムソケット** | 到達可 / 不可 | `container.*` と `k8s.pod.*` / `k8s.ns.name` が付くか。**Kubernetes かどうかと直交** | [container プラグイン](https://github.com/falcosecurity/plugins/blob/main/plugins/container/README.md) |
| **k8smeta プラグイン** | 有 / 無 | `k8s.deployment.name` 系（＝API サーバ由来の情報）が付くか | 次の節 |

**「managed k8s では kmod が選べない」は誤り。** kmod をロードできないと文書化されているのは
**GKE の Container-Optimized OS だけ**で、EKS / AKS はそのページに登場しない。制約は
**ノード OS の属性**であって、managed かどうかではない。Bottlerocket が kmod をロードできない、
Secure Boot で署名なしモジュールが弾かれる、といった話は falco.org / docs.sysdig.com には
無いので、この模型では**扱わない**（AWS の issue 由来のものを混ぜない）。

4軸にすると**都市の形が変わる新しい素材**が入る: `k8saudit-eks` は CloudWatch Logs から
**pull** するので**同時に1インスタンスしか置けない**（複数だと同じログを二重に取ってアラートが
重複する）。公式 Helm 値も `kind: deployment` / `replicas: 1` / ドライバとコレクタは無効。
**DaemonSet ではない形**が1つ増える。GKE は Pub/Sub なので複数インスタンスを明示的に許しており、
**ここは一般化してはいけない**。

実装が追いついていないところ（README を信じて読むと違って見える点）:

- `src/districts.data.js` の `managed` の注記が、kmod 不可を**managed であること**の帰結として
  書いている。ノード OS 軸へ移すのは L3 レーンの担当
- 攻撃チェーンの step5 は必要条件を self-managed k8s の id に**固定**しているので、
  `managed k8s` を選ぶと k8s の文脈があるのに見逃しになる。宣言された能力で判定するよう直すのは
  L1 レーンの担当
- 3D の地面テキスト・地区パネル・TUNING の `8 MiB/CPU` 表記は「CPU ごと」のままで、
  `modern_ebpf` 既定の「CPU ペアごと」に直す作業は別レーン（下の TUNING 節も参照）

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
- **この模型では k8s メタデータのガントリーを電球1つで描いている。2系統に分けるのは未実装**

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
| `cpus_for_each_syscall_buffer` | 1 / 2 / 4 | 1つのバッファを共有する CPU 数（**既定 2**）。1 にすると消費能力が上がる |
| `slow output` | 同期 program / http 出力 | オンにすると消費能力が半減し、**syscall 量が普通でもドロップする** |
| `syscall_event_drops.actions` | ignore / log / alert / exit | ドロップを検知したときの振る舞い |

HUD の `drain utilisation` と判定バンドが、いまどちらの状態かを名指しする:

- **持続的な入力超過**（util > 100%）— 失う割合は `1 - 消費能力/入力`。バッファをいくら増やしても直らない
- **バースト起因** — 平均は足りている。`buf_size_preset` を上げれば直る
- **ドロップなし**

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

**まだ直っていない表示**: 3D の地面テキスト・03 の地区パネル・TUNING の HUD が
`8 MiB / CPU` と書いたままになっている（`src/` は別レーンが保持中なので、この修正は README だけ）。

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
ただし**バッファと CPU の対応だけは追随できていない** — 画面はまだ「8 MiB / CPU」と書いているが、
既定の `modern_ebpf` は CPU ペアごと（上の TUNING 節）。

## コンソールから操作する

`window.__city` から素で叩ける。`evaluate()` / `blameOf()` は純関数なので、
README の表はそのまま検証コードとして回せる。

```js
__city.S.load = 2.5; __city.onTune()          // 負荷を上げてドロップを見せる
__city.S.tune.syscallSet='custom'; __city.onTune()  // 絞って直す
__city.setDeploy('plugins')                   // サーバレス／特権なし（カーネル経路なし）に切り替え
__city.setDeploy('managed')                   // managed k8s（EKS/GKE/AKS）
__city.setMode('sysdig')                      // Sysdig レイヤを点灯
__city.select('ring')                         // 地区へ飛ぶ
__city.model()                                // inflow / cap / util / dropP を見る
__city.pump(600)                              // rAF なしでシミュレーションを進める（検証用）
```

陣営・役割まわり:

```js
__city.setUiMode('campaign')                  // キャンペーンに入る（空き地に戻る）
__city.setRole('sre')                         // 役割を選ぶ（null で全役）
__city.setSide('defense')                     // 陣営（攻撃側は未実装なので false が返る）
['driver','ring','state','rules','outputs'].forEach(__city.build)
__city.evaluate().map(r => [r.jp, r.caught, __city.blameOf(r)])
__city.roleReport()                           // スコアカードの素データ
__city.OWNER                                  // 地区 → 役割
```

`window.__errs` に未捕捉エラーが溜まる。

## 既知の制約

- `docs/index.html` は Three.js を同梱しているのでオフラインで動く。ただし Poppins / Share Tech Mono は Google Fonts から読むので、完全オフラインだとシステムフォントに落ちる（レイアウトは崩れない）
- 背景タブでは `requestAnimationFrame` が止まるので、見せる前にタブを前面にしておく（0×0 ビューポートからの復帰は ResizeObserver で対応済み）
- WebGL が要る。リモートデスクトップ／VDI 経由だと重い場合がある
- 初期カメラは都市の AABB に対する厳密フィットなので、1920×1080 から縦長 820×1200 まで8地区すべてが収まることを確認済み
