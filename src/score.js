/* SCORE — ポイント。スコアと通貨を1つの数字にする（GAME-DESIGN §4.5）。
 *
 * 基礎点があり、時間とともに加算される。対応できないと減算される。手を打つには
 * 払う。数字は1つで、成績と資源を兼ねます（説明が2つ要らないように）。
 *
 * ---------------------------------------------------------------- 絶対に守る原則
 *
 * 1. **建てただけでは1点も入らない。** 加算の入力（§EARN）に建設数は1つも
 *    ありません。読むのは結果だけです — 止めたか、落としていないか、本物が
 *    埋もれていないか、期限切れを使っていないか、脆弱性を放置していないか。
 *    建設で加点すると「全部建てれば勝ち」が復活します。**この設計が否定して
 *    いる唯一のこと**なので、ここに `built` や `districts` を足さないこと。
 *    パイプラインを持っていることと、それが機能していることは別です
 *
 * 2. **点は「行動の量」ではなく「結果」に紐づく。** どれだけ建てたかではなく、
 *    どれだけ守れた時間があったか。だから加算は tick（時間）に紐づき、その量が
 *    守れている度合いで決まります
 *
 * 3. **コストは時間とともに上がる**（§INFLATION）。うまく回している人が無限に
 *    有利にならないため。溜め込んで何も打たないと、進行に追い抜かれます
 *
 * 4. **点が 0 になったら終わり**（3つ目の負け方。見逃す／埋もれる／枯れる）
 *
 * 5. **なぜ減ったかが後から言えること。** 台帳は内訳（`totals`）と履歴（`log`）を
 *    持ちます。履歴は上限で切れますが、`totals` は切れません
 *
 * ---------------------------------------------------------------- 純度と境界
 *
 * 純データ＋純関数です。台帳は `JSON.stringify -> JSON.parse` で不変で、関数・
 * クロージャ・THREE 参照を持ちません（Unity 版と英語版の保険）。すべての関数は
 * **新しい台帳を返し**、引数を書き換えません。
 *
 * 状態を持たないので `campaign.js` の `GAME` を触りません（あれはルールレーンの
 * 持ち物）。`timeline.js` も import しません — 時間は `tick` という数字として
 * 受け取ります。そうしておくと、点だけ／時間だけを単独で移植・検証できます。
 *
 * 文言はデータ側（§REASONS）。ロジックに文字列を埋め込みません。返すのはキーと
 * 数値だけで、日本語は表から引きます。
 *
 * 数字は illustrative で、釣り合いは動かしてよい。**因果（向きと大小関係）が
 * 主張です:**
 *
 *   · 守り続けると積み上がる
 *   · 埋もれた1段は、見逃した1段より重い（検知していたのに見失ったから）
 *   · 脆弱性の放置は期間に比例する（1件×1tick ごとに同額。総額 = 率×期間）
 *   · `exit` で止まっている 1 tick が最大（加算が 0 になり、かつ最大の減算）
 */

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

/* ---------------------------------------------------------------- 台帳 */

/* 開始点。全部建てるには足りない額です（OSS 自前で9地区なら建設だけで
   9 × 90 = 810 で、開始点を越えます）。何を先に建てるかが最初の判断になり、
   足りない分は**守れた時間**で稼ぐしかない。 */
const SCORE_DEFAULTS = { start:800, logMax:240 };

/* 加算。1 tick あたりの基礎点と、その内訳。**どれも結果です。** 建設数・地区数・
   依頼数は1つもありません。

   形は「止められた割合 × 守り方の質」です:

       credit = base × stopped × Σ(重み × 質)

   `stopped`（攻撃を止めた割合＝検知できた段/来た段）が**掛かる側**で、他の4つの
   上限になっています。これは釣り合いの選択ではなく、原則1を機構にしたものです:
   止めていない tick は、他が全部きれいでも **1点も入りません**。1段も検知して
   いないパイプラインは、ドロップが 0 でも脆弱性が 0 でも「守れていた」とは
   言わない。**建てただけ・何もしていないだけでは 0** がここで閉じます。

     stopped   攻撃を止めた割合。上限（掛かる側）
     clean     ドロップが出ていない（リングバッファ）
     surfaced  本物が埋もれていない（SOC のキュー）
     current   廃止期限の切れたものを使っていない
     patched   未対応の脆弱性が積み上がっていない

   質の重みの合計は 1.00。surfaced > clean にしてあるのは、減算側で
   「埋もれた > 見逃した」としているのと同じ理由です — 検知していたのに見失う方が
   重い。 */
const EARN = {
  base: 100,
  parts: { clean:0.30, surfaced:0.36, current:0.17, patched:0.17 },
  /* ドロップ／埋没が何割で、その項がゼロになるか。0.25 = 25% で全部失う */
  dropFloor: 0.25,
  buriedFloor: 0.25
};

/* 減算。単位はすべて「1件 × 1 tick」または「1段」。
   大小関係が主張です: dead > buried > miss > expired > vuln > upkeep。

   `vuln` の高さは釣り合いの要点です。1件を N tick 放置すると 12N、パッチは
   `COSTS.patch` ＋ 停止1 tick（加算が止まる）なので、**残り期間が十数 tick
   あればパッチの方が安い** — つまりパッチが本当のレバーになります。これを
   安くしすぎると「塞がずに放置する」が常に最適解になり、支払いの表から
   `patch` が消えます（最初の釣り合いでそうなり、直しました）。
   逆に、到着が速いので**全部は塞げません**（GAME-DESIGN §4-⑤）。 */
const LOSE = {
  miss:    60,   // 見逃した1段
  buried:  95,   // 本物が埋もれた1段。検知していたのに見失ったので見逃しより重い
  vuln:    12,   // 未対応の脆弱性 1件 × 1 tick。総額が放置期間に比例する
  expired: 35,   // 廃止期限を越えて使い続けているもの 1件 × 1 tick
  dead:   220,   // syscall_event_drops.actions: exit で止まっている 1 tick。最大
  upkeep:   9    // 増設したノード 1台 × 1 tick（継続的な支出）
};

/* 支払い。基準額で、実際の額は tick で上がります（§costAt）。

     district  地区を1つ建てる。**OSS 自前は建てる数が多い**ので、同じ単価を
               何回も払うことで手数の差が出ます（GAME-DESIGN §4-③）
     ask       他チームへの依頼。`GAME.asks` が既に数えているので、その増分を
               そのままここに通します。建設より高い — 組織を動かす方が高い
     upgrade   バージョンを1段上げる。飛べないので段の数だけ払います
               （timeline.js §climbTo の `steps` が回数）
     patch     脆弱性を1件塞ぐ。停止するので、その tick は加算が止まります
               （呼ぶ側が guard.halted を立てる）
     node      ノードを1台増やす。以後 LOSE.upkeep が毎 tick 効きます

   額は満点の加算（EARN.base = 100/tick）を単位に読んでください。地区1つが 1 tick
   弱、依頼が 1.5 tick、1段上げるのが 2 tick、パッチが 0.7 tick 分です。**9地区を
   自前で建てると 810** で、開始点 800 を越えます — 全部建ててから考えることは
   できません。そして 40 tick 走らせても、建設・全段更新・全件パッチ・依頼を
   **全部やる額は稼げる上限を越えます**（実測 6544 対 4800）。だから
   「溜めるか、投じるか」が判断になります。 */
const COSTS = { district:90, ask:150, upgrade:200, patch:70, node:60 };

/* コストは時間とともに上がる。1 tick ごとに基準額の 3%（tick 30 で 1.9倍、
   tick 40 で 2.2倍）。加算の上限は 100/tick で動かないので、**同じ手が時間と
   ともに重くなります。** これが「うまく回している人が無限に有利にならない」項で、
   同時に「溜めて何も打たない」を殺す項です: 放置している間に、直す値段そのものが
   上がっていく。 */
const INFLATION = 0.03;

/* 文言はデータ側。キー -> プレイヤーに見せる語。スコア履歴のページがこれを引き、
   ロジックは1文字も文を持ちません。 */
const REASONS = {
  hold:    { jp:'守れていた時間',           sign:'+' },
  stopped: { jp:'攻撃を止めた',             sign:'+' },
  clean:   { jp:'ドロップが出ていない',     sign:'+' },
  surfaced:{ jp:'本物が埋もれていない',     sign:'+' },
  current: { jp:'廃止されたものを使っていない', sign:'+' },
  patched: { jp:'脆弱性を放置していない',   sign:'+' },
  miss:    { jp:'攻撃を見逃した',           sign:'-' },
  buried:  { jp:'本物が埋もれた',           sign:'-' },
  vuln:    { jp:'脆弱性を放置している',     sign:'-' },
  expired: { jp:'廃止されたものを使い続けている', sign:'-' },
  dead:    { jp:'エージェントが止まっている', sign:'-' },
  upkeep:  { jp:'増設したノードの維持',     sign:'-' },
  halted:  { jp:'停止中（加算が止まっている）', sign:'0' },
  district:{ jp:'地区を建てた',             sign:'=' },
  ask:     { jp:'他チームへ依頼した',       sign:'=' },
  upgrade: { jp:'バージョンを上げた',       sign:'=' },
  patch:   { jp:'脆弱性にパッチを当てた',   sign:'=' },
  node:    { jp:'ノードを増やした',         sign:'=' }
};

/* 1 tick に呼ぶ側が渡す「守れている度合い」。**すべて結果で、建設数はありません。**

     stopped    検知できた段 / 来た段。campaign.js の passResults() から
     dropP      model().dropP
     buriedP    noise().buriedP
     missed     この tick に見逃した段数（cause が 'unbuilt'/'unmet'/'cap'/
                'blind'/'drop' のもの）
     buried     この tick に埋もれた段数（cause === 'noise' のもの）。
                **見逃しと別に数えるので、重さを別にできます**
     vulns      未対応の脆弱性 [{id, since}]。since は公開された tick で、
                放置期間の表示に使います（金額は1件1tickあたり一定なので、
                総額が期間に比例します）
     expired    期限を越えて使い続けているもの [{id, since}]。timeline.js の
                deadlinesAt().expired と、いまの構成の積
     dead       S.dead（syscall_event_drops.actions: exit）。検知ゼロ
     halted     パッチ／更新で止めている。加算は 0 だが dead の減算は無い
                （計画停止と落ちているのは別）
     extraNodes 既定から増やしたノード台数 */
const GUARD_DEFAULTS = {
  stopped:1, dropP:0, buriedP:0,
  missed:0, buried:0,
  vulns:[], expired:[],
  dead:false, halted:false, extraNodes:0
};

function newLedger(over){
  const src = obj(over);
  const start = Number.isFinite(src.start) ? Math.max(0, Math.round(src.start))
                                           : SCORE_DEFAULTS.start;
  return {
    points: start,
    start,
    tick: Math.max(0, Math.round(num(src.tick))),
    earned: 0, lost: 0, spent: 0,
    bust: false,
    totals: { earn:{}, lose:{}, spend:{} },
    log: [],
    last: null
  };
}

/* 壊れた台帳は**既定の台帳として**扱います。`null` を返すと呼ぶ側が全部分岐し、
   画面が点を出せなくなるので（`canPay` だけは例外で false に振ります）。 */
function safeLedger(l){
  const o = obj(l);
  return Number.isFinite(o.points) && Number.isFinite(o.tick) && Array.isArray(o.log)
      && obj(o.totals).earn ? o : newLedger(o);
}

/* ---------------------------------------------------------------- 値段 */

const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const whole = v => Math.round(Number.isFinite(v) ? v : 0);

/* いまの値段。tick で上がります。 */
function costAt(key, tick, opts){
  const base = COSTS[str(key)];
  if(!Number.isFinite(base)) return 0;
  const n = Math.max(1, Math.round(num(obj(opts).count, 1)));
  const t = Math.max(0, Math.round(num(tick)));
  return Math.round(base * (1 + INFLATION * t)) * n;
}

/* 全部の値段を1枚で。画面（値札）と、詰みの判定に使えます。 */
function priceList(tick){
  return Object.keys(COSTS)
    .map(key => ({key, jp:REASONS[key].jp, cost:costAt(key, num(tick))}));
}

/* 台帳が無い／壊れているときは「払えない」。**払えることにしない** —
   支払いを黙って通すのが一番高い間違いです。 */
const canPay = (ledgerIn, key, opts) => {
  const ledger = obj(ledgerIn);
  if(!Number.isFinite(ledger.points)) return false;
  return ledger.points >= costAt(key, num(obj(opts).tick, num(ledger.tick)), opts);
};

/* ---------------------------------------------------------------- 台帳の更新 */

function pushEntry(ledger, entry){
  const log = arr(ledger.log).concat([entry]);
  const max = Math.max(1, SCORE_DEFAULTS.logMax);
  return log.length > max ? log.slice(log.length - max) : log;
}

function addTotal(totals, bucket, key, amount){
  const inner = {...obj(obj(totals)[bucket])};
  inner[key] = (inner[key] || 0) + amount;
  return {...totals, [bucket]:inner};
}

/* 払う。足りなければ払いません（`last.ok === false` にその理由が載ります）。
   点は 0 を下回りません — 0 で終わりなので、負の残高に意味がありません。 */
function payFrom(ledgerIn, key, opts){
  const ledger = safeLedger(ledgerIn);
  const o = obj(opts);
  const tick = Math.max(0, Math.round(num(o.tick, ledger.tick)));
  const count = Math.max(1, Math.round(num(o.count, 1)));
  const cost = costAt(key, tick, {count});
  if(!COSTS[str(key)])
    return {...ledger, last:{ok:false, kind:'spend', key, reason:'unknown', cost:0}};
  if(ledger.points < cost)
    return {...ledger, last:{ok:false, kind:'spend', key, reason:'short',
                             cost, short:cost - ledger.points}};
  const entry = {tick, kind:'spend', key, amount:-cost, count};
  if(o.ref) entry.ref = String(o.ref);
  if(o.date) entry.date = String(o.date);
  const points = ledger.points - cost;
  return {
    ...ledger,
    points,
    spent: ledger.spent + cost,
    bust: points <= 0,
    totals: addTotal(ledger.totals, 'spend', key, cost),
    log: pushEntry(ledger, entry),
    last: {...entry, ok:true}
  };
}

/* この tick の加算率。**建設を1つも読まないこと**が、この関数の仕様です。
   `guard` に `built` / `districts` のようなキーが混ざっていても、ここは見ません。 */
function earnRate(guard){
  const g = {...GUARD_DEFAULTS, ...obj(guard)};
  if(g.dead || g.halted)
    return {rate:0, credit:0, held:0, quality:0, parts:{}, factors:{},
            blocked: g.dead ? 'dead' : 'halted'};
  const f = {
    clean:    1 - clamp01(clamp01(g.dropP) / EARN.dropFloor),
    surfaced: 1 - clamp01(clamp01(g.buriedP) / EARN.buriedFloor),
    current:  arr(g.expired).length ? 0 : 1,
    patched:  1 / (1 + Math.max(0, arr(g.vulns).length))
  };
  const held = clamp01(g.stopped);
  const parts = {};
  let quality = 0;
  for(const [key, w] of Object.entries(EARN.parts)){
    quality += w * f[key];
    parts[key] = w * f[key] * held;      /* 内訳も上限を掛けた後の値で持つ */
  }
  const rate = held * quality;
  return {rate, credit:whole(EARN.base * rate), held, quality, parts, factors:f, blocked:null};
}

/* この tick の減算の内訳。 */
function loseRate(guard){
  const g = {...GUARD_DEFAULTS, ...obj(guard)};
  const items = [];
  const add = (key, count, amount, extra) => {
    if(count <= 0 || amount <= 0) return;
    items.push({key, count, amount, ...(extra || {})});
  };
  add('miss',   Math.max(0, whole(g.missed)), LOSE.miss * Math.max(0, whole(g.missed)));
  add('buried', Math.max(0, whole(g.buried)), LOSE.buried * Math.max(0, whole(g.buried)));
  /* 期間に比例: 1件 × 1 tick ごとに同額なので、総額 = LOSE.vuln × 件数 × tick数。
     `ages` は「なぜ減ったか」を後から言うためだけの記録で、金額には効きません
     （効かせると比例でなくなり、主張が言えなくなります）。 */
  const vulns = arr(g.vulns).filter(Boolean).map(obj);
  add('vuln', vulns.length, LOSE.vuln * vulns.length,
      {ages: vulns.map(v => ({id: v.id ?? null, since: v.since ?? null}))});
  const exp = arr(g.expired).filter(Boolean).map(obj);
  add('expired', exp.length, LOSE.expired * exp.length,
      {ids: exp.map(v => v.id ?? null)});
  if(g.dead) add('dead', 1, LOSE.dead);
  const extra = Math.max(0, whole(g.extraNodes));
  add('upkeep', extra, LOSE.upkeep * extra);
  return {items, total: items.reduce((s, x) => s + x.amount, 0)};
}

/* 時間が1つ進んだ。**ここだけが加算の入口です。**

   順序は「入ってから出ていく」: 加算を載せ、それから減算を引きます。逆にすると
   同じ tick で 0 を割ってから回復する挙動になり、「0 で終わり」が揺れます。 */
function tickLedger(ledgerIn, guard, opts){
  const ledger = safeLedger(ledgerIn);
  const o = obj(opts);
  const tick = Math.max(0, Math.round(num(o.tick, ledger.tick + 1)));
  const date = o.date ? String(o.date) : null;
  const earn = earnRate(guard);
  const lose = loseRate(guard);

  let points = ledger.points;
  let earned = ledger.earned, lost = ledger.lost;
  let totals = ledger.totals;
  let log = ledger.log;
  const stamp = e => date ? {...e, date} : e;

  if(earn.credit > 0){
    points += earn.credit;
    earned += earn.credit;
    totals = addTotal(totals, 'earn', 'hold', earn.credit);
    log = pushEntry({...ledger, log}, stamp({tick, kind:'earn', key:'hold',
      amount: earn.credit, rate: Math.round(earn.rate * 1000) / 1000,
      parts: Object.fromEntries(Object.entries(earn.parts)
        .map(([k, v]) => [k, whole(EARN.base * v)]))}));
  } else {
    log = pushEntry({...ledger, log}, stamp({tick, kind:'earn',
      key: earn.blocked === 'dead' ? 'dead' : earn.blocked === 'halted' ? 'halted' : 'hold',
      amount:0, rate:0, parts:{}}));
  }

  for(const item of lose.items){
    points -= item.amount;
    lost += item.amount;
    totals = addTotal(totals, 'lose', item.key, item.amount);
    log = pushEntry({...ledger, log}, stamp({tick, kind:'lose', ...item, amount:-item.amount}));
  }

  const floored = Math.max(0, points);
  return {
    ...ledger,
    points: floored,
    tick,
    earned, lost,
    bust: floored <= 0,
    totals,
    log,
    last: {ok:true, kind:'tick', tick, credit:earn.credit, debit:lose.total,
           net: earn.credit - lose.total, blocked:earn.blocked}
  };
}

const isBust = ledger => !!ledger && num(obj(ledger).points, 1) <= 0;

/* ---------------------------------------------------------------- 内訳
   **なぜ減ったかが後から言えること。** スコアと履歴のページがこれを読みます。
   返すのはキー・数値・データ側の語だけで、文はここにありません。 */
function ledgerSummary(ledgerIn, opts){
  const ledger = safeLedger(ledgerIn);
  const rows = (bucket, sign) =>
    Object.entries(obj(obj(ledger.totals)[bucket]))
      .map(([key, amount]) => ({key, jp:(REASONS[key] || {}).jp || key,
                                amount: sign * amount}))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const tail = Math.max(0, num(obj(opts).recent, 24));
  return {
    points: ledger.points,
    start: ledger.start,
    tick: ledger.tick,
    bust: isBust(ledger),
    earned: ledger.earned, lost: ledger.lost, spent: ledger.spent,
    net: ledger.points - ledger.start,
    earn: rows('earn', 1),
    lose: rows('lose', -1),
    spend: rows('spend', -1),
    prices: priceList(ledger.tick),
    recent: ledger.log.slice(Math.max(0, ledger.log.length - tail))
      .map(e => ({...e, jp:(REASONS[e.key] || {}).jp || e.key})),
    truncated: Math.max(0, ledger.log.length - tail),
    /* 1件ずつの内訳が要るなら `ledgerBreakdown()`。ここで再導出しないこと */
    breakdown: ledgerBreakdown(ledger)
  };
}

/* ---------------------------------------------------------------- 内訳（画面向け）
 * 画面レーンが指定した形（BOARD §2 #S5 · GATE-FREEPLAY V5）。
 *
 *   [{ kind:'gain' | 'loss' | 'spend', key, delta, why? }] ＋ 期首残高 / 期末残高
 *
 * `ledgerSummary()` は **集計**（キーごとの合計）を返しますが、こちらは
 * **1件ずつ**返します。「なぜ減ったか」を時系列で言うにはそちらが要る、という
 * 画面側の指摘は正しく、集計では「同じ理由で3回減った」が1行に潰れます。
 *
 * ------------------------------------------------------------------ 文言について
 * **`key` が機械可読な正で、画面はそれだけで描けます。** `jp` も付けてありますが
 * **省略可能な便宜**です。BOARD #47（「文言は `REASONS` が持つので `ui.js` に
 * 日本語を書かない」）と #S5（「文言は画面側が持つので `key` だけ返せ」）が
 * 逆のことを言っていたので、**両方満たせる形にしました** — 使う側が選べます。
 *
 * `delta` は**符号付き**です: `gain` が正、`loss` と `spend` が負。呼ぶ側が
 * `kind` を見て符号を決め直す必要はありません（それをさせると2か所で決まります）。
 */
const KIND_OF = { earn:'gain', lose:'loss', spend:'spend' };

function ledgerBreakdown(ledgerIn, opts){
  const ledger = safeLedger(ledgerIn);
  const o = obj(opts);
  const from = Number.isFinite(o.sinceTick) ? Math.max(0, Math.round(o.sinceTick)) : null;
  const entries = [];
  for(const e of arr(ledger.log).map(obj)){
    if(from !== null && e.tick < from) continue;
    /* 0 点の加算行も残します。**「守れていたのに 0 点だった」は情報**で、
       落とすと停止中の tick が履歴から消えます（`key:'dead'` / `'halted'`）。 */
    const row = {
      kind: KIND_OF[e.kind] || e.kind,
      key: e.key,
      delta: e.kind === 'earn' ? (e.amount || 0) : -Math.abs(e.amount || 0),
      tick: e.tick
    };
    if(e.date) row.date = e.date;
    if(e.count !== undefined && e.count !== 1) row.count = e.count;
    if(e.ref) row.ref = e.ref;
    /* `why` は省略可能な補足。`REASONS` の語と、加算の内訳（どの項が効いたか）。 */
    const jp = (REASONS[e.key] || {}).jp;
    if(jp) row.jp = jp;
    if(e.parts && Object.keys(e.parts).length) row.parts = {...e.parts};
    entries.push(row);
  }
  return {
    opening: ledger.start,
    closing: ledger.points,
    net: ledger.points - ledger.start,
    entries,
    /* 期首と期末が entries で説明できること。ズレたらどこかが台帳を直接触っています */
    reconciles: ledger.start + entries.reduce((s, e) => s + e.delta, 0) === ledger.points,
    truncated: Math.max(0, arr(ledger.log).length - entries.length)
  };
}

/* ---------------------------------------------------------------- 検証
   台帳も JSON 往復で不変であること。保存（save.js）に載る日のための網です。 */
function plainErrorsOn(v, path, out){
  if(v === null) return out;
  const t = typeof v;
  if(t === 'string' || t === 'boolean') return out;
  if(t === 'number'){
    if(!Number.isFinite(v)) out.push(`${path}: ${v} does not survive JSON`);
    return out;
  }
  if(Array.isArray(v)){ v.forEach((x, i) => plainErrorsOn(x, `${path}[${i}]`, out)); return out; }
  if(t === 'object'){
    const proto = Object.getPrototypeOf(v);
    if(proto !== Object.prototype && proto !== null){
      out.push(`${path}: must be a plain object, got ${v.constructor?.name || 'exotic object'}`);
      return out;
    }
    for(const [k, x] of Object.entries(v)) plainErrorsOn(x, `${path}.${k}`, out);
    return out;
  }
  out.push(`${path}: ${t} is not data — the ledger has to stay portable to JSON`);
  return out;
}

function scoreErrors(ledger, label){
  const name = label || 'ledger';
  const out = [];
  if(!ledger || typeof ledger !== 'object' || Array.isArray(ledger))
    return [`${name}: must be an object`];
  plainErrorsOn(ledger, name, out);
  if(out.length) return out;
  for(const k of ['points','start','tick','earned','lost','spent'])
    if(!Number.isFinite(ledger[k])) out.push(`${name}.${k} must be a finite number`);
  if(typeof ledger.bust !== 'boolean') out.push(`${name}.bust must be a boolean`);
  if(!Array.isArray(ledger.log)) out.push(`${name}.log must be an array`);
  if(!ledger.totals || typeof ledger.totals !== 'object')
    out.push(`${name}.totals must be an object`);
  else for(const b of ['earn','lose','spend'])
    if(!ledger.totals[b] || typeof ledger.totals[b] !== 'object')
      out.push(`${name}.totals.${b} must be an object`);
  /* 見つけたいのは「加点の入口に建設が混ざった」こと。台帳の内訳キーは
     REASONS にあるものだけで、地区名が入ってきたらここで落ちます。 */
  for(const b of ['earn','lose','spend'])
    for(const key of Object.keys(ledger.totals?.[b] || {}))
      if(!REASONS[key]) out.push(`${name}.totals.${b}.${key} is not a known reason`);
  return out;
}

export {
  SCORE_DEFAULTS,
  EARN,
  LOSE,
  COSTS,
  INFLATION,
  REASONS,
  GUARD_DEFAULTS,
  newLedger,
  costAt,
  priceList,
  canPay,
  payFrom,
  earnRate,
  loseRate,
  tickLedger,
  isBust,
  ledgerSummary,
  ledgerBreakdown,
  scoreErrors
};
