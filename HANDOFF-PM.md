# PM セッション引き継ぎ — falco-city

公開先: https://higakikeita.github.io/falco-city/
リポジトリ: https://github.com/higakikeita/falco-city （public）

## あなたの役割

**開発セッションに仕事を渡し続けること。** 手が空いている開発セッションがある状態を作らない。

- **コードは書かない。** 書きたくなったらタスクにして渡す
- **検査もしない。** レビュー・事実確認・リグレッションは検査セッションの担当。PM が検査を兼ねると、開発を進める側と止める側を同時にやることになる
- 持ち物: バックログ、担当境界、CI とビルド、リリース（main への push）
- 決定は **oss-portfolio** に着地させる。このファイルは日々の運用状態だけを持つ

## いまの状態（2026-07-31 時点）

完成して公開済み。

- **Explore モード** — 9地区の完成した街。`syscall → alert` のパイプライン
- **Campaign モード** — 空き地から建てるゲーム。6段の攻撃チェーン＋対処で採点
- **TUNING** — `base_syscalls` / `buf_size_preset` / `cpus_for_each_syscall_buffer` / slow output / `syscall_event_drops.actions`。持続超過とバーストを別物として扱う
- **DEPLOY** — K8s DaemonSet / Host (systemd) / Kernel-less で街並みごと変わる
- **Sysdig Shield** — Host Shield と Cluster Shield（Docs 準拠）
- **宣言的レイアウト** — 地区は宣言1つ＋ビルダー1つで追加できる
- **CI** — `main` への push で GitHub Actions がビルドして Pages に配る

## 担当境界（衝突しないための唯一のルール）

**自分の持ちファイル以外を編集しない。** 必要なら PM に言って、持ち主のセッションにタスクとして渡す。

| セッション | 持ちファイル |
|---|---|
| **A ゲームプレイ** | `src/campaign.js` |
| **B 都市・ビジュアル** | `src/districts.data.js`, `src/districts.build.js`, `src/layout.js`, `src/mesh.js`, `src/city.js` |
| **C モデル・シミュレーション** | `src/state.js`, `src/sim.js`, `src/log.js` |
| **PM** | `build.mjs`, `scripts/`, `.github/`, `package.json`, `README.md`, このファイル |
| 共有（変更は PM 経由） | `src/index.html`, `src/ui.js`, `src/controls.js`, `src/scene.js`, `src/palette.js`, `src/main.js` |

共有ファイルに手を入れる必要が出たら、PM が順番を決めて1セッションずつ通す。同時に触らせない。

## 運用ルール

1. **`docs/` は絶対にコミットしない。** 生成物。`.gitignore` 済み。CI が作る
2. **`main` に直 push するのは PM だけ。** 開発セッションはブランチを切って PR
3. PR を出す前に `npm run check` を通す（import 検査 → ビルド → 生成物検査）
4. ワークツリーは `.claude/worktrees/` 配下。`.gitignore` 済みなので誤コミットはしない
5. **`feat/roles` ワークツリーは今回の大きなリファクタ前のコミットにいる。** 作業を始める前に `git rebase main` させること。`index.html` が消えて `src/` になっているので、リベースなしで進めると確実に壊れる

## 受け入れ確認の型

**「動いたと思う」を受け取らない。数値を出させる。** ブラウザのコンソールから直接測れる。

```js
__city.S.load = 2.5; __city.onTune()          // 負荷を上げる
__city.model()                                // inflow / cap / util / dropP
__city.pump(600)                              // rAF なしで10秒進める（プレビューでは rAF が止まる）
__city.setUiMode('campaign'); __city.build('driver')
__city.runAttack(); __city.pump(900)          // 判定を出す
__city.evaluate()                             // 純関数なので単体で叩ける
```

リグレッションの基準値（これが動いたら壊れていない）:

| 条件 | 期待 |
|---|---|
| load 1.5 / buf 4 | ドロップ 0.1%台、判定 burst |
| load 1.5 / buf 9 | ドロップ ほぼ0、判定 ok（**バッファはバーストに効く**） |
| load 2.5 / buf 4 → buf 10 | 27%台のまま（**持続超過には効かない**） |
| load 2.5 / custom_set | 0%（**これが効く**） |
| Campaign 進行 | 0/7 → 4/7 → 5/7 → 6/7 → 7/7 |
| Campaign load 2.6 | 6/7（step1 がドロップ） |
| Campaign host 構成 | 6/7（step5 が構成上不可） |
| kernel-less | リングバッファ流入 0 |

## 初期バックログ

すぐ渡せる粒度にしてある。上から渡す。

### A ゲームプレイ
- **A1 予算制**（大）— 各地区に CPU / メモリコストを付け、上限内で選ばせる。いまは「全部建てれば勝ち」で緊張がない。実務のトレードオフに寄せる本命
- **A2 シナリオ追加**（中）— 攻撃チェーンを複数に。クリプトマイナー / 資格情報窃取 / サプライチェーン。`CHAIN` は配列なので差し替えは容易
- **A3 結果画面に次手の推奨**（小）— 見逃した理由から「次に何を建てるべきか」を出す

### B 都市・ビジュアル
- **B1 キャプチャ / Stratoshark 地区**（中）— `.scap` を撮って事後に再生する話。OSS と Sysdig の差として大きい。`lane:'south'`
- **B2 Admission Control 地区**（中）— デプロイ時のゲート。ランタイム検知との対比（shift left / shield right）。Cluster Shield 配下
- **B3 建設アニメーション**（小）— いま地区は即座に出現する。立ち上がる動きを付けると Campaign の手触りが変わる

### C モデル・シミュレーション
- **C1 出力側バックプレッシャー**（中）— いま slow output は消費能力の係数だけ。`outputs_queue.capacity` としてモデル化する
- **C2 ルール数と評価コスト**（中）— いまルール数は固定。ルールセットの大きさが消費能力に効くようにする
- **C3 Docs 突き合わせの棚卸し**（小・継続）— 各地区の解説文と現行 Docs の差分を洗う

### 検査セッション
- PR ごとに `npm run check` ＋ 上の基準値の再現
- Falco / Sysdig Docs との事実整合（**数値ではなく比率と仕様が正しいか**）
- 新地区の解説文にウソがないか

## 既知の落とし穴

このプロジェクトで実際に踏んだもの。開発セッションに先に渡しておくと時間を節約できる。

1. **TDZ を3回踏んだ。** モジュール順で `S` / `GAME` / `campaignView` が宣言前に読まれた。`typeof X` は const の TDZ では例外を投げるので救いにならない。**モジュール評価時に他モジュールの値を読むな。** 関数の中で読む分には問題ない
2. **`String.replace` の第2引数に文字列を渡すな。** minified バンドルの中の `$&` / `` $` `` / `$'` が展開されて壊れる。`build.mjs` はコールバックを使っている
3. **プレビューペインでは `requestAnimationFrame` が止まる。** タブが hidden 扱いになるため。検証は `__city.pump()` で手回しする
4. **dev サーバはモジュールをキャッシュする。** 直したのに反映されないときは `?v=<epoch>` を付けて読み直す
5. **esbuild は未定義グローバルを黙って通す。** import 漏れは実行時に1件ずつしか出ないので、`npm run check` の import 検査を必ず先に走らせる
6. **CI の run を待つときは commit SHA で絞る。** `--limit 1` は直前の成功した run を拾って「成功した」と誤認する（一度やった）

## 数値の扱い

HUD の絶対値は **illustrative（見せるための代表値）**。パネル見出しにもそう書いてある。
正しくしてあるのは**比率と仕様**:

- カーネル側で通すのは全 syscall の約42%
- 評価されたイベントのうち鳴るのは0.4%程度
- 健全なノードのドロップはほぼ0
- ドライバ既定値・バッファサイズ・優先度の並び・ルール名・プラグイン名・出力チャネル・Shield の構成は実際の仕様に合わせている

**顧客に見せる資料なので、ここを崩す変更は検査セッションで止める。**
