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
| 1.4 | ⚠️ `cpus_for_each_buffer` は CPU とバッファの対応を決める（modern_ebpf のみ・既定 2 = 1バッファ:2CPU・`1` で CPU ごと・`0` で全 CPU 共有1つ）。**ただし「1 にすると消費能力が上がる」は Docs の推奨と逆向き**: ドロップ対策として Docs は `cpus_for_each_buffer` を **4–6 に上げて** preset 6–7 と組ませることを勧めている（バッファを細かくするより、少なく大きくする） | [falco.yaml `engine.modern_ebpf.cpus_for_each_buffer`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)（対応）／[Dropping events](https://falco.org/docs/troubleshooting/dropping/)（推奨値） | `src/state.js:60` `cap` | cpus_for_each_buffer を 1 にすると消費能力が上がる（**現行モデルの向き。要判断**） |
| 1.5 | ✅ 出力が詰まるとイベントループが止まり、その間にリングバッファが埋まる。**syscall 量が普通でもドロップする**。`outputs_queue.capacity`（既定 0 = 無制限）を設定すると、止まる代わりに**アラート側が捨てられて**ループが続く | [falco.yaml `outputs_queue.capacity`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「the current event would be dropped, and the event loop would continue」／同 `output_timeout`「if an output channel becomes blocked indefinitely, it indicates a potential issue」 | `src/state.js:63` `slowOutput` | slow output は syscall 量が普通でもドロップさせる |
| 1.6 | ✅ `syscall_event_drops.actions` は `ignore` / `log` / `alert` / `exit`。`exit` はエージェントを止める＝検知が本当にゼロになる | [falco.yaml `syscall_event_drops`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)（既定 `[log, alert]`・`rate: .03333`・`max_burst: 1`） | `src/log.js:59` `onDrop` / `die` | exit は検知を本当にゼロにする／ignore は黙って盲目になる |
| 1.7 | ✅ ドライバの選択はドロップの**向き**を変えない（消費能力の係数が違うだけ） | [Falco: kernel drivers](https://falco.org/docs/concepts/event-sources/kernel/) | `src/state.js:61-62` | ドライバの差はドロップの向きを変えない |

## 2. `base_syscalls` — ここは主張を1つ直す必要がある

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 2.1 | ✅ トレースする集合は「**有効なルールが要求する syscall** ∪ base set」。ルール側の要求は常に入る | [falco.yaml `base_syscalls.custom_set`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「Custom set of syscalls to trace **in addition to the ones required by enabled rules**」／[Adaptive Syscalls Selection](https://falco.org/blog/adaptive-syscalls-selection/)「the union of two components: the base set … and the syscalls specified in the loaded rules」 | — | — |
| 2.2 | ✅ 絞ると流入量が減る（＝持続超過に効く唯一のレバー） | [Dropping events](https://falco.org/docs/troubleshooting/dropping/)「limit the syscalls under monitoring」 | `src/state.js:36` `SET_MUL` | base_syscalls を絞ると持続超過が止まる |
| 2.3 | ⚠️ **「`custom_set` に絞ると検知が落ちる」は、そのままでは成立しない。** 既定の `custom_set`（正の記法）はルールが要求する syscall を落とさないので、有効なルールのカバレッジは減らない | 2.1 と同じ | `src/state.js` `syscallCustom`（記録のみ・採点しない） | **正の custom_set は有効なルールのカバレッジを奪えない**（回帰として固定済み）／GAP 6.1 |
| 2.4 | ✅ 検知を落とすのは**負の記法**。`!<syscall>` は「**ルールセットで使われていても**その syscall を無効化する」。Docs は「除外は `custom_set` ではなくルール側で消せ」と推奨している | [Adaptive Syscalls Selection](https://falco.org/blog/adaptive-syscalls-selection/)「to deactivate a syscall even if it is used in the ruleset」 | `TUNE_DEFAULTS.syscallCustom` に `!x` として持てる（採点は未実装） | 盲点を作れるのは負の指定か repair:false — 記法は区別して持たれている／GAP 6.4 |
| 2.5 | ✅ `repair: true` が戻すのは**状態エンジンの整合性だけ**（`close` / `procexit` などの最小追加）。**意図的に外したルールのカバレッジは戻らない** | [falco.yaml `base_syscalls.repair`](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「the minimal set of additional syscalls needed to properly build up (e.g. 'repair') its state engine and life-cycle management」 | `TUNE_DEFAULTS.syscallRepair`（採点は未実装） | 同上／GAP 6.4 |
| 2.6 | ✅ 絞りすぎると**プロセスキャッシュテーブルを GC できない／ログが不完全になる**（＝状態エンジンの劣化。これが `repair` の存在理由） | [falco.yaml](https://github.com/falcosecurity/falco/blob/master/falco.yaml)「misconfiguration may result in incomplete logs or inability to garbage collect the process cache table」 | 未実装 | — |
| 2.7 | ✅ base set から外した syscall は**実行時のカウンタに出ない**（`syscall_event_drops` は上がらない）。ただし**起動時には列挙できる**: `-o log_level=debug -o log_stderr=true --dry-run` が最終集合を出力し、重い syscall を除外すると警告が出る | [Adaptive Syscalls Selection](https://falco.org/blog/adaptive-syscalls-selection/)「(72) syscalls selected in total (final set): …」 | — | — |
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
| 4.1 | ✅ 既定で読み込まれるのは **stable のみ**。incubating / sandbox は別の OCI アーティファクト（`falco-incubating-rules` / `falco-sandbox-rules`）を入れる | [Default Rules](https://falco.org/docs/reference/rules/default-rules/)「By default, only the `stable` rules are loaded by Falco」 | `src/campaign.js` falcoctl 地区 | — |
| 4.2 | ✅ Helm の3キーは別物: `artifact.install.refs`（起動時に取る）/ `artifact.follow.refs`（自動更新する）/ `falco.rules_files`（エンジンに読ませる） | [Default Rules](https://falco.org/docs/reference/rules/default-rules/) | README | — |
| 4.3 | ⚠️ **攻撃チェーン step4「/tmp に落としたバイナリを実行する」の理由が間違っている。** `Drop and execute new binary in container` は `tags: [maturity_stable, …]` なので**既定で入っている**。falcoctl 無しでも検知できる | [falcosecurity/rules `falco_rules.yaml`](https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml) | `src/campaign.js` CHAIN step4 `needs:['…','falcoctl']` | 既定同梱のルールセットに無い検知は falcoctl なしでは持てない（**主張自体は正しいが、例が誤り**） |
| 4.4 | ✅ 現行チェーンの4ルール（Terminal shell in container / Read sensitive file untrusted / Write below etc / Contact K8S API Server From Container）は**すべて stable**＝既定で入っている | 同上 | — | — |
| 4.5 | ✅ falcoctl の例に使えるのは incubating の実物: `Contact EC2 Instance Metadata Service From Container`（IMDS からの資格情報窃取）/ `Exfiltrating Artifacts via Kubernetes Control Plane` / `Backdoored library loaded into SSHD (CVE-2024-3094)` | [falco-incubating_rules.yaml](https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml) | 未実装（4.3 の差し替え候補） | — |

## 5. OSS と Sysdig の境界

| # | 主張 | 出典 | 実装 | テスト |
|---|---|---|---|---|
| 5.1 | ✅ 検知と応答は別の部品。OSS Falco は目で、止める手は別（Sysdig の応答 / Falco Talon） | [Falco Talon](https://github.com/falcosecurity/falco-talon) | `src/campaign.js` RESPONSE | 検知と応答は別の部品（全段検知でも止められない） |
| 5.2 | ✅ Sysdig を足しても**検知が増えない段**が模型の中に残っている（増えるのは相関と応答） | 5.1 | `src/campaign.js` `sysdig` は CHAIN の `needs` に入らない | **Sysdig を足しても検知は1段も増えない**（`sysdig` の有無で検知数が不変・`CHAIN` のどの段も `sysdig` を要求しない・`RESPONSE` だけが要求する、を固定）／全部建てれば全段検知＋封じ込め |
| 5.5 | ✅ 見逃しは**必ず誰かの判断の帰結**として説明できる（基盤 / SRE / 検知 / SOC の4役、または「帰属なし＝検知できた」の5状態）。帰属は結果から導出され、手で注記しない | 模型の設計（README §役割） | `src/campaign.js` `blameOf` / `OWNER` | 見逃しの帰属は5状態（5つ全部に到達できること・未知の帰属が出ないことを固定）／見逃しの理由は原因に紐づく |
| 5.6 | ✅ 登録されているシナリオは**その役割の持ち物と依頼回数の制約の中でクリア可能**でなければならない。クリアできないシナリオは因果の主張ではなく content のバグ | 模型の設計（`src/scenarios/schema.js`） | `src/campaign.js` `goalStatus` / `canUseLever` | 登録済みシナリオがすべてクリア可能（汎用ソルバで実プレイ）／シナリオのクリア条件はその環境で達成可能な段数を超えない／シナリオ検証エラーは 0 |
| 5.3 | ✅ Cluster Shield はクラスタ単位（Deployment）。守るクラスタが無い構成には存在しない | [Install Host Shield from a Package](https://docs.sysdig.com/en/sysdig-secure/install-package-host-shield/) | `src/controls.js` `applyShield` | — |
| 5.4 | ✅ Sysdig の Universal eBPF は Falco の modern eBPF に相当し、ドライバはエージェントに埋め込まれていてカーネルヘッダが要らない | [Understand Agent Drivers](https://docs.sysdig.com/en/sysdig-secure/classic-agent-drivers/) | README | — |

## 6. 実装が主張に追いついていない（GAP）

`npm test` は GAP を**赤にしません**。「まだ実装されていない」ことを記録し、実装された瞬間に
「GAP が閉じた → テストに昇格せよ」と言います。

| # | GAP | いまの挙動 | あるべき因果 | 予定 |
|---|---|---|---|---|
| 6.1 | 🕳 `custom_set` の代償が採点に無い | 過負荷 6/7 → `custom_set` で **7/7**。絞るだけで満点が戻る（ルールに届く量は 60% 減っているのに無償） | 2.3 のとおり「絞る」だけでは検知は落ちない。**落とすなら負の記法（2.4）か `repair:false`（2.6）としてモデル化する** | Phase 1 |
| 6.2 | ✅ **閉じた**（2026-07-31・環境の直交4軸で解消） | 旧: `deploy=plugins` で 6/7。採点が syscall 段を検知扱いにしていた | `needsCaps:['kernelPath']` になり、kernel-less では syscall 段が全部落ちる（3.10）。serverless は 2/7 | 済 — 回帰テストに昇格済み |
| 6.3 | 🕳 HUD のドロップ率が実際より低く出る | モデル 38.72% に対し HUD は **27.91%**。`src/ui.js` が `drop/(ring+drop)` を使っているが、ドロップ済みイベントは `ring` にも数えられているので分母が二重（表示値 = `p/(1+p)`） | 分母は `ring` だけ。README §実測した挙動 の数値もこの式で書かれている | Phase 1 |
| 6.4 | 🕳 負の `custom_set` と `repair:false` に代償が無い | `custom_set: [!openat, !openat2, !execve]` でも `repair: false` でも検知は 7/7 のまま。正の `custom_set` が流入量を増やさないのも同じ穴（`SET_MUL` はプリセット名しか読まない） | 2.4 / 2.5 のとおり、**盲点を作れるのはこの2つだけ**。6.1 の代償はここに置く | Phase 1 |
| 6.5 | 🕳 シナリオの `attack.waves` の境界が使われていない | `stepsOf()` が flatten して1回で流す。波は宣言されているが engine は境界で何もしない | ウェーブごとに区切って提示する（`schema.js` §attack.waves のコメントどおり） | Day 2（別レーン進行中） |

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
