# Falco / Sysdig — Runtime Security City

**▸ https://higakikeita.github.io/falco-city/**

`syscall → alert` のパイプラインを、歩ける 3D の「都市」として表現したインタラクティブモデル。
登壇・ウェビナー・顧客説明で「Falco と Sysdig が実際に何をしているか」を1画面で見せるためのもの。

## 2種類の index.html があるので注意

| ファイル | 用途 |
|---|---|
| `index.html`（ルート） | **編集するのはこっち。** Three.js を CDN から ES モジュールで読む開発版。HTTP サーバが必要 |
| `docs/index.html` | **公開・配布されるのはこっち。** ビルド生成物。単一ファイル・約0.7MB・Three.js 同梱。ダブルクリックで開く（`file://` で動く） |

ルートの `index.html` が正。直したら必ず `npm run build` して `docs/` を更新する。
`docs/index.html` を直接編集しても次のビルドで上書きされる。

GitHub Pages は `main` ブランチの `/docs` から配信する設定。

## ビルド

```bash
npm install && npm run build
```

`build.mjs` が `index.html` から importmap を外し、バンドル済み Three.js を埋め込み、
アプリのスクリプトを `type="module"` から通常スクリプトに落とす（`file://` はモジュールを拒否するため）。

これがないと「ファイルを渡してダブルクリック」が成立しない。Slack にアップロードした HTML の
リンクを直接開かせるのも不可（署名付き URL に期限があり、HTML をページとして配信し続ける保証がない）。
渡すときは Pages の URL か、ダウンロードしてから開くよう案内する。

## 開発版の起動

```bash
python3 -m http.server 8722
```

→ http://localhost:8722

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

地区をクリックすると詳細パネル（日本語の解説＋要点バンド）が開く。キーボード `1`–`8` でも移動、`0` で全体、`Esc` で閉じる。

## 操作

- ドラッグでオービット / スクロールでズーム / 地区をクリックで詳細
- **STACK** — `Falco OSS` ↔ `+ Sysdig`。Sysdig 側にすると上空のプラットフォームが点灯し、Lumin のポリシー粒子が降りてくる
- **DEPLOY** — デプロイ形態（後述）
- **DRIVER** — 3方式の切り替え（消費能力にわずかに反映される。kernel-less では選択不可になる）
- **NODE LOAD** — ノード負荷。上げるとドロップが出る
- **TUNING** — falco.yaml のチューニング（後述）。この教材の本体
- **Console** — Falco の実際のルール名で流れるアラート出力。Sysdig モードでは policy / capture / in-use CVE 相関の行も混ざる

## DEPLOY — デプロイ形態で都市の形が変わる

| 選択 | 何が変わるか |
|---|---|
| `K8s DaemonSet` | 既定。container と k8s の両方のメタデータ用ガントリーが点灯し、アラートに `k8s.ns` / `k8s.pod` が付く |
| `Host (systemd)` | ノードにパッケージ導入した構成。**k8s メタデータのガントリーが消え**、アラートは `container.id` までしか持たない |
| `Kernel-less` | ドライバもリングバッファも使わない構成。**ワークロード・ドライバ・リングバッファの3地区が消灯し、リングバッファ流入が実測 0 になる**。プラグイン入力（k8saudit / cloudtrail / okta / github）だけがルールエンジンに届き、syscall 系ルールは1つも発火しない |

「カーネルに触れない環境でも Falco は使えるが、そのとき何を見られて何を見られないか」が形で分かる。

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

## パーティクルの色

| 色 | 意味 |
|---|---|
| グレー | 生の syscall（まだ意味を持たない） |
| Falco Blue | エンリッチ済みイベント |
| オレンジ | プラグイン入力（k8s audit / cloudtrail …） |
| 赤 | ドロップ（バッファ溢れ） |
| 紫・赤・橙・青 | ルールマッチ → priority 別のアラート |
| Lumin | Sysdig からのポリシー／応答 |

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

- `dist/falco-city.html` は Three.js を同梱しているのでオフラインで動く。ただし Poppins / Share Tech Mono は Google Fonts から読むので、完全オフラインだとシステムフォントに落ちる（レイアウトは崩れない）
- 背景タブでは `requestAnimationFrame` が止まるので、見せる前にタブを前面にしておく（0×0 ビューポートからの復帰は ResizeObserver で対応済み）
- WebGL が要る。リモートデスクトップ／VDI 経由だと重い場合がある
- 初期カメラは都市の AABB に対する厳密フィットなので、1920×1080 から縦長 820×1200 まで8地区すべてが収まることを確認済み
