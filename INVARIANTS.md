# INVARIANTS — 曲げてはいけない因果

> 初版 2026-07-31 · レビュー（検査）セッション
> 前提: **数値は illustrative で自由に動かしていい。因果は本物でなければならない。**

このファイルは、ゲームバランスの調整で嘘が混入するのを止める網です。1行 = 1つの主張。
各行に **出典**（一次情報）と **実装箇所** と **回帰テスト** を持たせています。

- 数値を動かすとき: この表の主張が成立し続けるかだけを見る。絶対値はどう変えてもよい
- 主張を変えたいとき: **先に出典を差し替える。** 出典が無い主張は入れない
- テスト: `npm test`（`scripts/regress.mjs`・ブラウザ不要）。CI（`.github/workflows/pages.yml`）で毎回走る

`npm test` が守るのは**向き**だけです。許容幅・大小関係・判定バンド名でしか書かないので、
バランス調整で数値を動かしても赤くなりません。逆に、**因果が反転したら必ず赤くなります**。
「本数」も固定しません — 登録シナリオが6本でも8本でも、*登録されている全部がクリア可能*が主張です。

凡例: ✅ 一次出典で裏取り済み · ⚠️ 主張が不正確（要修正） · 🕳 実装が主張に追いついていない（GAP）

---

## 1. ドロップは2種類ある

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 1.1 | ✅ ドロップはリングバッファでだけ起きる（唯一落ちる場所） | [Falco: Dropping events](https://falco.org/docs/troubleshooting/dropping/) | `src/sim.js` ring 区間 | 既定構成は syscall → ring → rules → alert が流れる |
| 1.2 | ✅ 持続的な入力超過で失う割合は `1 - 消費能力/入力` | 定義（待ち行列の飽和） | `src/state.js:66` `sustained` | 持続超過で失う割合は 1 - 消費能力/入力 |
| 1.3 | ✅ `buf_size_preset` はバーストにだけ効く。持続超過には効かない | [falco.yaml `buf_size_preset`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)（1–10 = 1MB–512MB・既定 4 = 8MB）／[Dropping events](https://falco.org/docs/troubleshooting/dropping/)「Increasing the size helps, but keep in mind that the benefits may not increase proportionally」 | `src/state.js:68` `burst` のみ `bufPreset` に依存 | buf_size_preset はバーストに効く／持続超過に効かない（1–10 全段で `sustained` 同一） |
| 1.4 | ✅ `cpus_for_each_buffer` は CPU とバッファの対応を決める（modern_ebpf のみ・既定 2 = 1バッファ:2CPU・`1` で CPU ごと・`0` で全 CPU 共有1つ）。**上げる（＝バッファを少なく大きくする）方向で消費能力が上がる。** ドロップ対策として Docs は `cpus_for_each_buffer` を **4–6 に上げて** preset 6–7 と組ませることを勧めている。細かく割るほど単一のコンシューマがポーリングする対象が増えるので、バッファ数が減る方向に能力が上がる（`BUF_CAP`・polling オーバーヘッドの項なので効き幅は控えめ） | [falco.yaml `engine.modern_ebpf.cpus_for_each_buffer`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)（対応）／[Dropping events](https://falco.org/docs/troubleshooting/dropping/)（推奨値） | `src/state.js` `BUF_CAP` → `drainCap()` | cpus_for_each_buffer を上げる（バッファを減らす）と消費能力が上がる（1–8 で単調・入力は不変） |
| 1.5 | ✅ 出力が詰まるとイベントループが止まり、その間にリングバッファが埋まる。**syscall 量が普通でもドロップする**。`outputs_queue.capacity`（既定 0 = 無制限）を設定すると、止まる代わりに**アラート側が捨てられて**ループが続く | [falco.yaml `outputs_queue.capacity`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「the current event would be dropped, and the event loop would continue」／同 `output_timeout`「if an output channel becomes blocked indefinitely, it indicates a potential issue」 | `src/state.js:63` `slowOutput` | slow output は syscall 量が普通でもドロップさせる |
| 1.6 | ✅ `syscall_event_drops.actions` は `ignore` / `log` / `alert` / `exit`。`exit` はエージェントを止める＝検知が本当にゼロになる | [falco.yaml `syscall_event_drops`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)（既定 `[log, alert]`・`rate: .03333`・`max_burst: 1`） | `src/log.js:59` `onDrop` / `die` | exit は検知を本当にゼロにする／ignore は黙って盲目になる |
| 1.7 | ✅ ドライバの選択はドロップの**向き**を変えない（消費能力の係数が違うだけ） | [Falco: kernel drivers](https://falco.org/docs/concepts/event-sources/kernel/) | `src/state.js:61-62` | ドライバの差はドロップの向きを変えない |

> **【2026-07-31 · 1.4 の向きを反転】** モデルは `1` にすると消費能力が上がる（バッファを細かく
> 割るほど良い）と言っていました。これは Docs の推奨と逆向きで、⚠️ として記録されていたものです。
> 「因果は本物でなければならない」が上位なので、**モデルを Docs に合わせて反転**しました
> （L1 実装済み・ハーネスの主張も反転済み）。**README の実測表8行はバイト単位で不変**です
> （既定ノードは `cpus_for_each_buffer = 2` ＝ `cap 1.55` のままで、動いたのは既定から外した
> ときの向きだけ）。ハーネスは `cpus 1 < 既定 2 < cpus 6` を両方向に固定しています。

## 2. `base_syscalls` — ここは主張を1つ直す必要がある

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 2.1 | ✅ トレースする集合は「**有効なルールが要求する syscall** ∪ base set」。ルール側の要求は常に入る | [falco.yaml `base_syscalls.custom_set`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「Custom set of syscalls to trace **in addition to the ones required by enabled rules**」／[Adaptive Syscalls Selection](https://falco.org/blog/adaptive-syscalls-selection/)「the union of two components: the base set … and the syscalls specified in the loaded rules」 | — | — |
| 2.2 | ✅ 絞ると流入量が減る（＝持続超過に効く唯一のレバー） | [Dropping events](https://falco.org/docs/troubleshooting/dropping/)「limit the syscalls under monitoring」 | `src/state.js:36` `SET_MUL` | base_syscalls を絞ると持続超過が止まる |
| 2.3 | ⚠️ **「`custom_set` に絞ると検知が落ちる」は、そのままでは成立しない。** 既定の `custom_set`（正の記法）はルールが要求する syscall を落とさないので、有効なルールのカバレッジは減らない | 2.1 と同じ | `src/state.js` `syscallCustom`（記録のみ・採点しない） | **正の custom_set は有効なルールのカバレッジを奪えない**（回帰として固定済み）／GAP 6.1 |
| 2.4 | ✅ 検知を落とすのは**負の記法**。`!<syscall>` は「**ルールセットで使われていても**その syscall を無効化する」。Docs は「除外は `custom_set` ではなくルール側で消せ」と推奨している | [Adaptive Syscalls Selection](https://falco.org/blog/adaptive-syscalls-selection/)「to deactivate a syscall even if it is used in the ruleset」 | **採点済み**（2026-07-31）: `blindSyscalls()` → `evaluate()` の `blind` 原因。ルールが要求する syscall が**全部**無効化されたときだけ盲点になる（1つ残れば鳴る） | 負の指定は盲点を作り、それはドロップとして計測されない／記法は区別して持たれている |
| 2.5 | ✅ `repair: true` が戻すのは**状態エンジンの整合性だけ**（`close` / `procexit` などの最小追加）。**意図的に外したルールのカバレッジは戻らない** | [falco.yaml `base_syscalls.repair`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「the minimal set of additional syscalls needed to properly build up (e.g. 'repair') its state engine and life-cycle management」 | `TUNE_DEFAULTS.syscallRepair`（**意図的に未採点** — 検知の枚数として表現するものではない。GAP 6.4） | 記法は区別して持たれている／GAP 6.4 |
| 2.6 | ✅ 絞りすぎると**プロセスキャッシュテーブルを GC できない／ログが不完全になる**（＝状態エンジンの劣化。これが `repair` の存在理由） | [falco.yaml](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「misconfiguration may result in incomplete logs or inability to garbage collect the process cache table」 | 未実装 | — |
| 2.7 | ✅ base set から外した syscall は**実行時のカウンタに出ない**（`syscall_event_drops` は上がらない）。ただし**起動時には列挙できる**: `-o log_level=debug -o log_stderr=true --dry-run` が最終集合を出力し、重い syscall を除外すると警告が出る | [Adaptive Syscalls Selection](https://falco.org/blog/adaptive-syscalls-selection/)「(72) syscalls selected in total (final set): …」 | `evaluate()` の `blind` は `dropP` / `util` を一切動かさない | 負の指定は盲点を作り、それはドロップとして計測されない（盲点があっても drop 0% · util 健全であることを固定） |
| 2.8 | ✅ ファイル読み取り系の検知は `open` / `openat` / `openat2` に依存する（マクロ `open_read`）。ここを外すと「Read sensitive file untrusted」は鳴らない | [falcosecurity/rules `falco_rules.yaml`](https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml) マクロ `open_read`／[Dropping events](https://falco.org/docs/troubleshooting/dropping/) Test 5 が `open,openat,openat2,close` を「file operations」として括っている | `src/campaign.js` step2 | — |
| 2.9 | ⚠️ 「高頻度 syscall を絞ると**最初に**死ぬのは openat 系」という**順序の主張は Docs に無い**。Docs にあるのは「どのルールがどの syscall を要求するか」だけ。順序ではなく依存で語ること | 同上 | — | — |

## 3. 環境と構成の因果

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 3.1 | ✅ GKE（Container-Optimized OS）では**カーネルモジュールを挿入できない** → modern eBPF（Falco 0.38+ の既定） | [Falco: Specific Environments](https://falco.org/docs/setup/enviroments/)「Falco cannot insert its Kernel Module to process events for system calls」 | `src/districts.data.js` §NODE_OSES `cos.blocks:['kmod']` | kmod が不可なのは COS のときだけ／COS を選ぶと生きているレバーからも kmod が落ちる |
| 3.2 | ✅ **「managed k8s では kmod が使えない」は言い過ぎだった（実装で解消）。** 決めているのは *managed かどうか* ではなく **ノード OS がモジュール挿入を許すか**（COS 不可・Secure Boot は未署名モジュールを拒否・Bottlerocket は kmod kit があり Sysdig は kmod / eBPF の両方を選べると書いている）。環境は直交4軸（orchestrator / node OS / runtime socket / k8smeta）になり、`kmod` を落とすのは node OS 軸だけ | [Specific Environments](https://falco.org/docs/setup/enviroments/)（GKE のみが一次出典）／[Sysdig: Bottlerocket](https://www.sysdig.com/blog/secure-monitor-aws-bottlerocket)（kmod と eBPF の両方）／[Understand Agent Drivers](https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/) | `src/districts.data.js` §ENV_AXES / `composeEnv` / `DEPLOYMENTS.kmodOk` | kmod が不可なのは COS のときだけ（orchestrator 5値と独立に検査）／4軸は直交 |
| 3.3 | ✅ kmod は full privileges 必須（kernel ≥ 3.10）。modern eBPF は kernel ≥ 5.8 ＋ BTF ＋ BPF ring buffer で、capabilities（`CAP_BPF` / `CAP_PERFMON` / `CAP_SYS_RESOURCE` / `CAP_SYS_PTRACE`）で動く | [Falco: kernel drivers](https://falco.org/docs/concepts/event-sources/kernel/) | 未実装 | — |
| 3.4 | ✅ **managed クラスタでは webhook 方式の `k8saudit` が使えない。** cloud provider が audit log を自分のログサービスに出すため、provider 別プラグインで**取りに行く**（`k8saudit-eks` は CloudWatch Logs から pull） | [Monitoring your EKS clusters audit logs](https://falco.org/blog/k8saudit-eks-plugin/)／[k8saudit README](https://github.com/falcosecurity/plugins/blob/main/plugins/k8saudit/README.md)（webhook backend or file） | 未実装（地区07 は入力元を区別していない） | — |
| 3.5 | ✅ その結果 **audit 経路のデプロイ形が変わる**: syscall は DaemonSet（ノードごと）だが、`k8saudit-eks` は**クラスタに1インスタンスだけ**（重複アラートを避けるため単一 Deployment・syscall 収集は無効） | [k8saudit-eks plugin](https://falco.org/blog/k8saudit-eks-plugin/)「we MUST install Falco with the k8saudit-eks plugin only once」 | 未実装 | — |
| 3.6 | ✅ リングバッファは**ノードの CPU 数**で決まる（`ceil(CPU数 / cpus_for_each_buffer)` 個 × `buf_size_preset`）。**ノードを増やして増えるのはエージェントの数**で、1ノード内のバッファ数ではない | [falco.yaml `engine.modern_ebpf`](https://github.com/falcosecurity/falco/blob/master/falco.yaml) | 未実装（ノード数が固定） | — |
| 3.7 | ✅ Falco 0.37 で内蔵 Kubernetes クライアントは廃止され、k8s メタデータは `k8smeta` プラグイン ＋ `k8s-metacollector` 経由になった。旧 `k8s.*` フィールド（`k8s.pod.*` / `k8s.ns.name` を除く）は非推奨で `<NA>` を返す | [Introducing Falco 0.37.0](https://falco.org/blog/falco-0-37-0/)／[k8smeta plugin](https://github.com/falcosecurity/plugins/tree/main/plugins/k8smeta) | 未実装（地区の解説は内蔵クライアント時代の書き方） | — |
| 3.8 | ✅ スタンドアロン（systemd）構成に Kubernetes の文脈は無い（API サーバも audit も metacollector も無い）ので `k8saudit` ルールは1本も鳴らない。**要求はトポロジ名ではなく capability（`apiServer`）で書く** — 名前は理由ではないし、`managed` なクラスタにも API サーバはある | 3.4 / 3.7 | `src/campaign.js` `needsCaps:['kernelPath','apiServer']` ＋ `CAP_WHY` | 段が要求するのは capability だけ／構成による見逃しは負荷とは独立／見逃しの理由は原因に紐づく |
| 3.9 | ✅ クラウド API の操作は **`syscall` とは別のイベントソース**（`aws_cloudtrail` / `gcpaudit` / `okta`）から来て、**`ct.*` という別のフィールド空間**を持つ。そして **Falco はソース間の相関をしない**（1つのルールは1つのソースにしか属さない）。だから syscall ルールには**構造的に**マッチし得ず、プラグイン入力を足す以外に道が無い。**逆に、別ソースなのでカーネル経路の有無とは独立に成立する** — nodriver でもクラウド段は取れる | [Falco plugins](https://github.com/falcosecurity/plugins)（`cloudtrail` / `gcpaudit` / `okta` は独立した event source）／[Falco: Rules — basic elements](https://falco.org/docs/concepts/rules/basic-elements/)（`source` = 「The event source for which this rule should be evaluated」・単数・既定 `syscall`）／[Falco: Plugins](https://falco.org/docs/concepts/plugins/)（プラグインは「new event sources」と独自のフィールドを足す） | `src/campaign.js` `cloud` 段は `needs:['rules','outputs','plugins']`・`needsCaps` 無し | クラウド段は syscall 経路を一切要求しない／ソース間を相関しない／別ソースなのでカーネル経路の有無と独立に成立する |
| 3.10 | ✅ kernel-less（ドライバ無し）ではリングバッファ流入が 0 になり、プラグイン入力だけがルールエンジンに届く。**採点も同じ結論になる**（syscall 由来の段は `needsCaps:['kernelPath']` で落ちる。旧 GAP 6.2 は閉じた） | 3.9 と同じ（プラグインは driver / ring を通らない） | `src/sim.js` plugin バイパス車線 ＋ `src/campaign.js` `needsCaps` | kernel-less はリングバッファ流入 0・プラグイン入力だけがルールに届く／kernel-less では syscall 由来の段は原理的に検知できない／serverless では 2/7 しか成立しない |
| 3.11 | ✅ 環境は**直交した4軸**。orchestrator が `apiServer` / `cluster` と audit の取得経路を決め、node OS が挿せるドライバを決め、runtime socket が `container.*` / `k8s.pod.*` を決め、k8smeta プラグインが apiserver 由来のフィールドを決める。**どれも他の軸の帰結を動かさない** | [falco.yaml](https://github.com/falcosecurity/falco/blob/master/falco.yaml)（container プラグインはランタイムソケットを読む）／[k8saudit-eks](https://falco.org/blog/k8saudit-eks-plugin/)／3.1 / 3.7 | `src/districts.data.js` `composeEnv` | 4軸は直交（5×2×2×2 の組合せで検査）／managed k8s では全段成立する（7/7） |
| 3.12 | ✅ 名前付き環境（`DEPLOYMENTS`）は軸上の**位置**にすぎず、属性はすべて `composeEnv` から導出される。だから名前付き環境が軸と食い違うことは構造的に起こり得ない | 3.11 と同じ | `src/districts.data.js` `NAMED_ENVS.map(composeEnv)` | kmod が不可なのは COS のときだけ（`managed` かつ `kmodOk` の環境が存在することを固定） |

## 4. ルールと配布

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 4.1 | ✅ 既定で読み込まれるのは **stable のみ**。incubating / sandbox は別の OCI アーティファクト（`falco-incubating-rules` / `falco-sandbox-rules`）を入れる。**ファイル構成そのものが裏付け**: `falcosecurity/rules` は成熟度とファイルが 1:1 で、`rules/falco_rules.yaml`（stable 25本）/ `rules/falco-incubating_rules.yaml`（incubating 31本）/ `rules/falco-sandbox_rules.yaml`（sandbox 37本）に分かれている。**incubating / sandbox は `falco_rules.yaml` に1本も無い** — つまり「既定で入っているか」はフラグではなく**どのファイルを取得したか** | [Default Rules](https://falco.org/docs/reference/rules/default-rules/)「By default, only the `stable` rules are loaded by Falco」／[falcosecurity/rules `rules/`](https://github.com/falcosecurity/rules/tree/main/rules)（3ファイル構成） | `src/campaign.js` falcoctl 地区 ＋ `scripts/harness/cases.mjs` §RULE_MATURITY | チェーンの各段のルールは成熟度が分かっている／同梱されないルールだけが 09 ルール配布を要求する |
| 4.2 | ✅ Helm の3キーは別物: `artifact.install.refs`（起動時に取る）/ `artifact.follow.refs`（自動更新する）/ `falco.rules_files`（エンジンに読ませる） | [Default Rules](https://falco.org/docs/reference/rules/default-rules/) | README | — |
| 4.3 | ⚠️ **成熟度の取り違えは1件ではなく2件で、向きが逆だった。** ①step4「/tmp に落としたバイナリを実行する」＝`Drop and execute new binary in container` は `maturity_stable` ＝**同梱されている**のに falcoctl を要求していた（**修正済み** — `imds` 段が falcoctl の主張を引き受け、step4 は素の stable 検知になった）。②step3「/etc/cron.d に書き込む」＝`Write below etc` は `maturity_sandbox` ＝**同梱されていない**のに、既定で鳴る扱いになっている（**未修正** — コンテナレーンが step3 ↔ step4 の入れ替えで両方同時に直す。id `cron` / `dropbin` は6シナリオが `attack.waves` から参照しているので据え置き） | [falcosecurity/rules `falco_rules.yaml`](https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml)（stable にあるもの）／[falco-sandbox_rules.yaml](https://github.com/falcosecurity/rules/blob/main/rules/falco-sandbox_rules.yaml)（`Write below etc`） | `src/campaign.js` CHAIN `cron`（falcoctl を要求していない）／`imds`（要求する） | 同梱されないルールだけが 09 ルール配布を要求する（`cron` は `MATURITY_PENDING` で保留）／GAP 6.6 |
| 4.4 | ⚠️ **訂正**: 「現行チェーンの4ルールはすべて stable」は**誤り**。`Write below etc` は **`maturity_sandbox`**（`falco-sandbox_rules.yaml`）。stable なのは `Terminal shell in container` / `Read sensitive file untrusted` / `Contact K8S API Server From Container` の3本と、4.3 で入れ替わった `Drop and execute new binary in container` | 同上 | `scripts/harness/cases.mjs` §RULE_MATURITY が段ごとの成熟度を持つ | チェーンの各段のルールは成熟度が分かっている（未登録のルールを増やすと赤くなる） |
| 4.5 | ✅ falcoctl の例に使えるのは incubating の実物: `Contact EC2 Instance Metadata Service From Container`（IMDS からの資格情報窃取）/ `Exfiltrating Artifacts via Kubernetes Control Plane` / `Backdoored library loaded into SSHD (CVE-2024-3094)` | [falco-incubating_rules.yaml](https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml) | **実装済み**: `CHAIN` の `imds` 段が `Contact EC2 Instance Metadata Service From Container` で `needs` に `falcoctl` を含む | 既定同梱のルールセットに無い検知は falcoctl なしでは持てない（`imds`=incubating）／同梱されないルールだけが 09 ルール配布を要求する |
| 4.6 | ✅ **個々のルールの成熟度は、そのルールが `falcosecurity/rules` のどのファイルに居るかで決まる**（4.1）。**2026-07-31 に3本を実物で確認**: `Clear Log Activities` は **`maturity_stable`**（`rules/falco_rules.yaml`）／`Change thread namespace` は **`maturity_incubating`**（`rules/falco-incubating_rules.yaml`）／`Packet socket created in container` は **`maturity_stable`**（`rules/falco_rules.yaml`）。**`Clear Log Activities` を incubating とした判断は誤り**（画面レーンの自己判断・出典なし）。ファイルと `maturity_*` タグの 1:1 も同時に実測（stable 25本 / incubating 31本 / sandbox 37本・**タグの混在は1本も無い**） | [falco_rules.yaml](https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml)（`Clear Log Activities` / `Packet socket created in container`）／[falco-incubating_rules.yaml](https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml)（`Change thread namespace`・`tags: [maturity_incubating, host, container, process, mitre_privilege_escalation, T1611]`） | `scripts/harness/cases.mjs` §RULE_MATURITY | チェーンの各段のルールは成熟度が分かっている／同梱されないルールだけが 09 ルール配布を要求する |

## 5. OSS と Sysdig の境界

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 5.1 | ✅ 検知と応答は別の部品。OSS Falco は目で、止める手は別（Sysdig の応答 / Falco Talon） | [Falco Talon](https://github.com/falcosecurity/falco-talon) | `src/campaign.js` RESPONSE | 検知と応答は別の部品（全段検知でも止められない） |
| 5.2 | ✅ Sysdig を足しても**検知が増えない段**が模型の中に残っている（増えるのは相関と応答） | 5.1 | `src/campaign.js` `sysdig` は CHAIN の `needs` に入らない | **Sysdig を足しても検知は1段も増えない**（`sysdig` の有無で検知数が不変・`CHAIN` のどの段も `sysdig` を要求しない・`RESPONSE` だけが要求する、を固定）／全部建てれば全段検知＋封じ込め |
| 5.5 | ✅ 見逃しは**必ず誰かの判断の帰結**として説明できる（基盤 / SRE / 検知 / SOC の4役、または「帰属なし＝検知できた」の5状態）。帰属は結果から導出され、手で注記しない | 模型の設計（README §役割） | `src/campaign.js` `blameOf` / `OWNER` | 見逃しの帰属は5状態（5つ全部に到達できること・未知の帰属が出ないことを固定）／見逃しの理由は原因に紐づく |
| 5.6 | ✅ 登録されているシナリオは**その役割の持ち物と依頼回数の制約の中でクリア可能**でなければならない。クリアできないシナリオは因果の主張ではなく content のバグ | 模型の設計（`src/scenarios/schema.js`） | `src/campaign.js` `goalStatus` / `canUseLever` | 登録済みシナリオがすべてクリア可能（汎用ソルバで実プレイ）／シナリオのクリア条件はその環境で達成可能な段数を超えない／シナリオ検証エラーは 0 |
| 5.7 | ✅ 登録されているシナリオは**意図したレバー以外ではクリアできない**（SHIP GATE G4）。意図しない手で目標が緑になるなら、そのシナリオは誤診を1件も教えていない。**この主張は content の契約であって因果ではない**が、破れ方が「静かに教材でなくなる」なので機械で押さえる。塞ぐのはシナリオ側の宣言（`goal.lockLoad` / `goal.minPassRatio` / 役割の固定）で足り、engine を変える必要は無い | 模型の設計（`scenarios/schema.js` §goal.lockLoad / §goal.minPassRatio） | `src/campaign.js` `canUseLever()` ＋ 各シナリオの `goal` | 意図したレバー以外ではクリアできない（G4・全シナリオ × 15手を実プレイ）／正解のレバーでは実際にクリアできる／GAP: 意図しないレバーでクリアできるシナリオが残っている |
| 5.3 | ✅ Cluster Shield はクラスタ単位（Deployment）。守るクラスタが無い構成には存在しない | [Install Host Shield from a Package](https://docs.sysdig.com/en/sysdig-secure/install-package-host-shield/) | `src/controls.js` `applyShield` | — |
| 5.4 | ✅ Sysdig の Universal eBPF は Falco の modern eBPF に相当し、ドライバはエージェントに埋め込まれていてカーネルヘッダが要らない | [Understand Agent Drivers](https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/) | README | — |

## 6. 実装が主張に追いついていない（GAP）

`npm test` は GAP を**赤にしません**。「まだ実装されていない」ことを記録し、実装された瞬間に
「GAP が閉じた → テストに昇格せよ」と言います。

| # | GAP | いまの挙動 | あるべき因果 | 予定 |
|---|---|---|---|---|
| 6.1 | 🕳 `custom_set` の代償が採点に無い | 過負荷 6/8 → `custom_set` で **8/8**。絞るだけで満点が戻る（ルールに届く量は 60% 減っているのに無償）。**ノイズ（§9）が入って「絞る」は SOC のキューにも効くようになったので、絞る手はいま二重に得** | 2.3 のとおり「絞る」だけでは検知は落ちない。**落とすなら負の記法（2.4・実装済み）としてモデル化する**。量の側は 6.7 | Phase 1 |
| 6.2 | ✅ **閉じた**（2026-07-31・環境の直交4軸で解消） | 旧: `deploy=plugins` で 6/7。採点が syscall 段を検知扱いにしていた | `needsCaps:['kernelPath']` になり、kernel-less では syscall 段が全部落ちる（3.10）。serverless は 2/7 | 済 — 回帰テストに昇格済み |
| 6.3 | 🕳 HUD のドロップ率が実際より低く出る | モデル 38.72% に対し HUD は **27.91%**。`src/ui.js` が `drop/(ring+drop)` を使っているが、ドロップ済みイベントは `ring` にも数えられているので分母が二重（表示値 = `p/(1+p)`） | 分母は `ring` だけ。README §実測した挙動 の数値もこの式で書かれている | Phase 1 |
| 6.4 | 🕳 `repair:false` に代償が無い（**意図的**） | `repair: false` でも検知は変わらない。**負の `custom_set` は 2026-07-31 に採点された**（2.4・回帰に昇格済み）ので、この GAP は `repair` だけになった | 2.5 のとおり `repair` が戻すのは状態エンジンの整合性だけで、**検知の枚数として表現するものではない**。入れるなら 2.6（プロセスキャッシュの GC 失敗・ログの欠損）として。`silent-blind-spot` の症状を1段に保つ意味もあるので、当面このまま | 保留（意図的） |
| 6.5 | ✅ **閉じた**（2026-07-31・ウェーブ機構） | 旧: `stepsOf()` が flatten して1回で流し、engine は波の境界で何もしなかった | `runWave()` / `GAME.phase` が波ごとに区切り、`between` が手番になった（§9.7） | 済 — 回帰テストに昇格済み |
| 6.6 | 🕳 `Write below etc`（step3）が sandbox なのに同梱扱い | `cron` 段が falcoctl を要求しないので、同梱されていないルールが既定で鳴る（4.3 ②・4.4） | 成熟度と `needs.falcoctl` が一致すること。step3 ↔ step4 の入れ替えで解消する | コンテナレーン |
| 6.7 | 🕳 `custom_set` の中身が流入量に効かない | `SET_MUL` はプリセット名（`all` / `default` / `custom`）だけを読むので、`custom_set` に何個並べても流入量は同じ | 絞った実際の集合が流入量を決める（2.2 の量的な側） | Phase 1 |

## 7. README の実測表について

`README.md` の「実測した挙動」は HUD を目で読んで書いた prose です。`npm test` が毎回この表を
出力するので、数値を動かしたらそこからコピーし直してください（**この表の数値は回帰テストが
固定していません** — 固定すべきものではないので）。

| 条件 | README | モデル（真値） | HUD 表示値 | 状態 |
|---|---|---|---|---|
| load ×1.0 + slow output | 19.8% / util 124% | 19.81% / util 124% | 16.53% | ✅ 修正済み（PM が README 側を訂正） |
| load ×1.5 | 0.38% | **0.18%** | 0.18% | ⚠️ 未修正（README 側の1行） |

残り6行は HUD 表示値としては一致しています（`既定 0%` / `buf 9 → 0.03%` / `all → 14%` /
`load 2.5 → 28.7%` / `buf 10 → 27.4%` / `custom_set → 0%`）。

**単位が1行だけ混ざっています。** 上記のとおり、他の7行は HUD 表示値（`p/(1+p)`）で書かれていますが、
slow output の行だけモデルの真値（19.8%）になりました。6.3 を直せば両者は一致するので、
**README の統一は 6.3 の修正と同時にやるのが正しい**（今どちらかに寄せると、もう一度書き直しになります）。

## 8. 登録されていないシナリオファイル

`src/scenarios/` にファイルがあるだけでは遊べません。`index.js` の `RAW` に入って初めて
`SCENARIOS` に載ります。`node scripts/check-imports.mjs` が未登録ファイルを `note` として毎回
列挙します（**失敗にはしません** — 意図的に外すのは正当な状態）。

2026-07-31 時点の未登録:

| ファイル | id | shape 検証 | 意図的か |
|---|---|---|---|
| `rules-not-followed.js` | `rules-not-followed` | ✅ 通る | **意図的**（2d9ca9b: 例に使ったルールが既定同梱だったため。4.3 と同じ話） |
| `silent-blind-spot.js` | `silent-blind-spot` | ✅ 通る | **不明 — 要確認。** c997c98 でファイルは入ったが `index.js` に import が無い |
| `nodes-are-not-buffers.js` | `nodes-are-not-buffers` | ✅ 通る | **不明 — 要確認。** 60ee832 でファイルは入ったが `index.js` に import が無い |

下2本はどちらも `validateShape` を通るので、`index.js` に1行足すだけで遊べます。
登録した瞬間に「登録済みシナリオがすべてクリア可能」の対象に入るので、
クリアできない設計ならそこで赤くなります。

**`silent-blind-spot` は登録できる状態になりました**（2026-07-31）。症状の機構である
**負の `custom_set`（2.4）が採点されるようになった**ので、「HUD は健全なのに1段だけ鳴らない」が
実際に起こります。`repair:false` の側は意図的に未採点のまま（GAP 6.4）なので、
このシナリオの症状は**負の指定1本で作る**のが正になります。

---

## 9. ウェーブとノイズ（2026-07-31 · Day 2 の機構）

**過検知でも負ける**、が入りました。リングバッファは**カウンタが付いている**唯一のキューですが、
唯一のキューではありません。アラートは人間のキュー（SOC）に入り、そこにもレートがあります。

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 9.1 | ✅ アラート流入が SOC の処理能力を超えると**本物が誤検知に埋もれる**。`buried = 1 - 処理能力/アラート流入` で、**`sustained`（1.2）と同じ式を1段後ろに置いたもの**。ドロップと違って**何のカウンタも上がらない** | 定義（待ち行列の飽和）＝1.2 と同じ | `src/state.js` `noise()` ＋ `src/campaign.js` `evaluate()` の `noise` 原因 | アラートが処理能力を超えると本物が埋もれる（ドロップ 0% のまま1段落ちることを固定） |
| 9.2 | ✅ **バースト項は無い。** リングバッファには `buf_size_preset` があってスパイクを吸収できるが、人間のキューにその摘みは無いので、手は「**入力を減らす**」か「**処理能力を上げる**」の2つだけ | 1.3 の対偶（`buf_size_preset` は SOC に存在しない） | `noise()` に `burst` 項が無い | 埋没は 1 - 処理能力/流入。バースト項が無い（buf 1–10 すべてで埋没が同一・解析解と5条件で一致） |
| 9.3 | ✅ `base_syscalls` を絞ると**埋没が止まり、しかもカバレッジは落ちない**（2.1）。有効なルールが要求しないイベントを送らなくなるだけなので、ノイズだけが減る | 2.1 / 2.2 | `noise()` の `breadth` 項 | 入力を絞ると埋没が止まる（検知は落ちない） |
| 9.4 | ✅ 08 Sysdig は**処理能力を上げる**（相関とグルーピングで、同じアラートが見るべきものとしては少なくなる）。**検知は1段も増えない**（5.2）。そして**建てただけでは効かない** — `STACK` が `sysdig` でなければ相関は働かない。さらに**相関は倍率であって免罪符ではない**（資産が大きくなれば相関しても足りない） | 5.1 / 5.2 | `noise()` の `corr` / `SOC.sysdig` | 08 Sysdig は処理能力を上げるが検知は増やさない（STACK=oss では埋もれたまま・12ノードでは相関しても超過） |
| 9.5 | ✅ **過負荷なノードは静かなノード。** リングバッファが食べたものは鳴らないので、ドロップは埋没を減らす（`inflow × (1 - dropP)`）。正直で、最悪 | 1.1（落ちたイベントは下流に届かない） | `noise()` の `survive` 項 | 過負荷なノードは静かなノード（slow output で入力不変・ドロップだけ作った条件で厳密一致） |
| 9.6 | ✅ 埋没の帰属は**入力を増やした側**に付き、算術から導出される（手で注記しない・5.5 と同じ規律）。既定より広げた分が原因なら **SRE**、ルールを増やした分（09 / 07）が超えさせたなら **検知**、資産の規模そのものが能力を超えているなら **SOC**（買っていない能力の話で、誰の設定ミスでもない） | 模型の設計（5.5 の延長） | `src/campaign.js` `noiseBlame()` | 埋没の帰属は入力を増やした側に付く（3つ全部に到達できることを固定） |
| 9.7 | ✅ 攻撃は**波で来て、境界で止まる**（`build → running → between → over`）。`between` は**手番**で、建設・再チューニング・依頼がそこで効き、次の波がそれを迎える。**ただし失った波は戻らない** — 解決済みの波の結果は書き換わらない | 模型の設計（旧 GAP 6.5） | `src/campaign.js` `runWave()` / `bankWave()` / `afterMove()` | 波は境界で止まり、間に打った手が次の波に効く |
| 9.8 | ✅ 採点は「**来たもの全部**」に対して1回。`goalStatus()` は**パスが終わるまで判定を返さない**ので、1波目だけを見て勝敗は決まらない | 模型の設計 | `goalStatus()` が `GAME.phase !== 'over'` で `null` | 判定はパスが終わるまで出ない |
| 9.9 | ✅ 過負荷が盗めるのは**パスにつき1段**（波ごとではない）。波を歩いても、チェーン全体を一度に評価していた頃と**同じ枚数**しか落ちない — これが README §実測した進行 / §実測した帰属 を真に保つ | 模型の設計 | `GAME.budget` = `freshBudget()`（`runAttack()` がパスの頭で1つ作る） | ドロップの予算はパス単位（波ごとには盗まれない・ring を通る波が2本以上ある状態で固定） |

---

## 10. バージョンと時間軸（第2部の背骨・2026-07-31 固定）

`GAME-DESIGN.md` §3 の「**上げないと詰む**」を支える事実です。**発注書には確定として書かれていましたが
出典が固定されていなかった2件**を含みます。**片方は「日付」ではなく「版」でした。**

> **要点: クロックが2本あります。** Falco（**版**で消える）と Sysdig（**日付**で消える）。
> 同じ「legacy eBPF」という名前ですが、別の製品の別の廃止です。混ぜると進行の設計が狂います。

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 10.1 | ✅ **Falco の版と実リリース日は実在する**（我々が作るものではない・維持コスト0のコンテンツ）。0.37.0 = 2024-01-30 / 0.38.0 = 2024-05-30 / 0.39.0 = 2024-10-01 / **0.40.0 = 2025-01-28** / 0.41.0 = 2025-05-29 / 0.42.0 = 2025-10-22 / **0.43.0 = 2026-01-28** / 0.43.1 = 2026-04-09 / **0.44.0 = 2026-05-26** / **0.44.1 = 2026-06-11（現時点の最新安定版）**。パッチ版は 0.37.1 / 0.38.1 / 0.38.2 / 0.39.1 / 0.39.2 / 0.41.1 / 0.41.2 / 0.41.3 / 0.42.1 も実在 | [falcosecurity/falco releases](https://github.com/falcosecurity/falco/releases)（GitHub API で prerelease を除いて実測） | 未実装（データ層 `versions.js` 待ち） | バージョン表は一次資料と一致する（`versions.js` が入り次第） |
| 10.2 | ✅ **Falco の legacy eBPF プローブは「廃止予定」ではなく、もう無い。** 0.43.0 で**非推奨**（`chore(userspace): deprecate legacy eBPF probe, gVisor engine and gRPC` #3763）→ **0.44.0 で削除**（`chore!: drop legacy BPF probe` #3796・`!` = breaking）。現行 `falco.yaml` の engine は **`kmod` / `modern_ebpf` / `replay` / `nodriver` の4つだけ**で、`ebpf` は選択肢として存在しない。**つまり Falco 側は「日付で詰む」のではなく「版を上げた瞬間に選択肢が消える」** | [Falco CHANGELOG](https://github.com/falcosecurity/falco/blob/master/CHANGELOG.md)（v0.43.0 / v0.44.0 の項）／[falco.yaml `engine`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「Available engines: `kmod` / `modern_ebpf` / `replay` / `nodriver`」 | `src/districts.data.js` の `DRIVERS` に `ebpf` が残っている（版と結びついていない） | 未実装（`versions.js` 待ち。**版を 0.44 に上げたら `ebpf` が選べないこと**が主張になる） |
| 10.3 | ✅ **Sysdig の Legacy eBPF ドライバには日付がある。** Docs の Deprecation Notice が「This driver will be retired on **December 4, 2026**. We recommend migrating to Universal eBPF.」。カーネル下限も同じ表にある: **Universal eBPF ≥ 5.8**（ヘッダ不要）/ **kmod ≥ 3.10**（ヘッダ必要）/ **Legacy eBPF ≥ 4.14**（ヘッダ必要）。**発注書の「2026-12-04 廃止」はこれで正しい** — ただし **Sysdig の話**で、Falco の 10.2 とは別物 | [Sysdig: Understand Agent Drivers](https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/) | 未実装 | 未実装（`versions.js` 待ち） |
| 10.4 | ⚠️ **「`k8smeta` は Falco 0.40+ を要求」は現行プラグインについては正しく、「0.40 未満では `k8smeta` が使えない」は誤り。** README が「This plugin requires Falco with version >= **0.40.0**. For older Falco version (>= **0.37.0**) please use plugin version **0.2.x**」と両方書いています。**下限は2段**: どの `k8smeta` でも 0.37.0 以上、**現行（0.3.x 以降・最新 v0.4.1）**なら 0.40.0 以上 | [k8smeta plugin README §Running](https://github.com/falcosecurity/plugins/blob/main/plugins/k8smeta/README.md)／[k8smeta CHANGELOG](https://github.com/falcosecurity/plugins/blob/main/plugins/k8smeta/CHANGELOG.md)（v0.4.1） | 未実装 | 未実装（`versions.js` 待ち） |
| 10.5 | ✅ **「上げると壊れる」の実体は 0.37.0（2024-01-30）**: 内蔵 Kubernetes クライアントが廃止され、旧 `k8s.*` フィールド（`k8s.pod.*` / `k8s.ns.name` を除く）が `<NA>` を返すようになった（§3.7）。**戻す手は `k8smeta` プラグイン ＋ `k8s-metacollector` を建てること**で、その下限が 10.4。**V6（バージョンを上げて何かが壊れ、戻す手がある）はこの1件だけで成立します** | §3.7 と同じ（[Introducing Falco 0.37.0](https://falco.org/blog/falco-0-37-0/)） | `src/districts.data.js` の k8smeta 軸（版と結びついていない） | 4軸は直交（現行）／版との連動は `versions.js` 待ち |
| 10.6 | ✅ **0.44.0 で消えたのは legacy eBPF だけではない。** 同じ版で **gRPC 出力とサーバ**も落ちています（`chore!: drop gRPC output and server support` #3798・こちらも `!`）。0.43.0 の非推奨は3点セット（legacy eBPF プローブ / gVisor エンジン / gRPC）で、**0.44.0 がその回収**。**「上げると何かが無くなる」は1件の事故ではなく、この版の性格です** | [Falco CHANGELOG v0.44.0](https://github.com/falcosecurity/falco/blob/master/CHANGELOG.md)（#3798）／同 v0.43.0（#3763） | `src/versions.js` §CLAIMS `grpc-gvisor-removal-0.44`（データ層が独立に到達・出典一致） | 版に関する主張の出典が INVARIANTS に解決する |

### データ層の主張との対応（`src/versions.js` §CLAIMS の `invariant` に入れる番号）

`versions.js` は主張ごとに `invariant:` を持っていて、**登録済みのものはその番号を指します**。
2026-07-31 時点で登録できたのは次の5件です（`cases-freeplay.mjs` が毎回突き合わせます）:

| `CLAIMS.id` | INVARIANTS |
|---|---|
| `release-dates` | **10.1** |
| `falco-legacy-ebpf-removal` | **10.2** |
| `sysdig-legacy-ebpf-retirement` | **10.3** |
| `k8smeta-plugin-min-version` | **10.4** |
| `grpc-gvisor-removal-0.44` | **10.6** |
| `falco-0.37-k8s-client` | 3.7（既登録）|
| `driver-kernel-requirements` | 3.3（既登録）|

**まだ登録していないもの**（データ層が出典を持っているが、このレーンが一次資料で確認していない）:
`kernel-minimum-not-strict` / `default-ruleset-shrank-at-0.36` / `plugin-abi-0.35` / `cri-config-move` /
`container-plugin-0.41` / `evt-dir-0.42` / `driver-api-bump-0.44`。
**`npm test` が毎回この未登録一覧を出します。** 確認したものから順に §10 に足します
（`BOARD.md` §2 の `I<n>` 行が受け口）。

### 進行の設計に対する含意（**設計はこのレーンの持ち物ではないので、事実だけ**）

1. **「Legacy eBPF が廃止されるから上げろ」は Sysdig を選んだプレイヤーにしか効きません。** Falco 自前運用では、`ebpf` は**上げたら消える**もので、上げない理由の側に立ちます（10.2）。**この2つは逆向きの圧です。** 「上げないと詰む」を Falco 側で作るなら、根拠は legacy eBPF ではなく **新しいルール／プラグインが要求する下限**（10.4）と**新しい攻撃**の方です
2. **0.37 → 0.40 の間に「壊れる」と「直す手の下限」が両方ある**（10.4 / 10.5）。0.37 で `k8s.*` が `<NA>` になり、現行 `k8smeta` で戻すには 0.40 が要る。**古い版で始めるなら 0.37 未満から始めるのが正しい**（そこなら内蔵クライアントが生きている）
3. **版の間隔は実在します**（10.1）。0.39.0 → 0.40.0 は約4か月、0.42.0 → 0.43.0 は3か月、0.41.3 → 0.42.0 は3.7か月。**ゲーム内時間の刻みを実際の間隔に合わせられます**（作らなくてよい）
