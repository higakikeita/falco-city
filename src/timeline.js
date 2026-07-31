/* TIMELINE — ゲーム内時間の進行と、その時刻で解決されるイベント。
 *
 * このゲームの進行の軸は時間です（GAME-DESIGN §3）。非常に古いバージョンから
 * 始まり、時間が進むと新しいバージョンが選べるようになり、脆弱性が積み上がり、
 * 使っているものが廃止期限に近づく。**止まることも、進むことも、無料ではない。**
 *
 * ---------------------------------------------------------------- 何を知らないか
 *
 * このファイルは「何のイベントか」を知りません。汎用のスケジューラです。
 * バージョン履歴は src/versions.js が、脆弱性は src/vulns.js が持ちます。ここは
 * **イベント源を引数で受け取り、時刻 T で何が起こっているかを返す純関数**だけを
 * 持ちます。だから:
 *
 *   · 廃止期限は「2026-12-04」という日付としてここには現れません（Legacy eBPF の
 *     期限は INVARIANTS §1.7 / §3.7 が出典で、持ち主は versions.js です）。ここは
 *     `until` というフィールドを解決できる、という機構だけを持ちます
 *   · 業種・ミドルウェア・ルール成熟度も現れません
 *   · 文言も現れません。プレイヤーに見せる語は、渡されたイベントが自分で持ちます
 *     （`jp` などのキーはそのまま返り値に載って通り抜けます）
 *
 * ---------------------------------------------------------------- 純度
 *
 * 純データ＋純関数です。時計もイベントも `JSON.stringify -> JSON.parse` で不変で、
 * 関数・クロージャ・THREE 参照を持ちません（Unity 版と英語版の保険）。返り値も
 * 新しいオブジェクトで、引数は書き換えません。内部で `Date` を使うのは UTC の
 * 日数計算のためだけで、データ側に `Date` は一切載りません。
 *
 * 状態（いまの時刻）は `clock` として外から与えます。`campaign.js` の `GAME` は
 * ルールレーンの持ち物なので、ここからは触りません。
 *
 * ---------------------------------------------------------------- 刻み方
 *
 * リアルタイムにしません（DESIGN-freeplay-flow §ゲーム内時間）。プレイヤーが手を
 * 打つ余裕が消えます。**1 tick = 本番運用のキャンペーンが1つ流れること。** 呼ぶ側
 * （`campaign.js` の `over`）が `advanceClock()` を1回呼ぶ、それだけです。
 *
 * `daysPerTick` は釣り合いの数字で、illustrative です。既定 42 日（6週）は
 * 「開始 2023-05-01 から Legacy eBPF の廃止（2026-12-04）まで約31 tick」＝
 * 本番運用を30回くらい回すと期限が来る、という距離感から決めました。呼ぶ側が
 * 上書きしてよく、因果（順序・飛べないこと・期限が来ること）は日数に依りません。
 *
 * ---------------------------------------------------------------- イベント源の形
 *
 * 呼ぶ側が渡す配列の1要素は、こういう純データです:
 *
 *   { id:'legacy-ebpf', at:'2021-01-01', until:'2026-12-04', ... }
 *
 *     id     安定キー。必須
 *     at     それが起こる／選べるようになる日（ISO の YYYY-MM-DD）。必須
 *     until  廃止期限。無ければ期限が無い。任意
 *     rank   段（ladder のときだけ。無ければ配列の順）
 *
 * それ以外のキーは自由で、そのまま返り値に載ります。ただし返り値には派生した
 * 数値を足すので、次の4つは**予約語**です: `atTick` / `daysUntil` / `daysOver` /
 * `arrived`。
 */

/* ---------------------------------------------------------------- 時計 */

/* start は「非常に古いところから始まる」ための既定で、呼ぶ側（versions.js の
   最古の段）が上書きします。tick は 0 から数え、0 が start そのものです。 */
const TIME_DEFAULTS = { start:'2023-05-01', daysPerTick:42, tick:0 };

/* 期限が「近づいている」と言い始める既定の窓。呼ぶ側が opts で上書きできます。 */
const HORIZON_DAYS = 180;

const MS_DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------------------------------------------------------- 全域性
   **このモジュールは throw しません。** 答えか、空の答えを返します。
 *
 * 契約（CONTRACT-datalayer.md §1）が「壊れた入力は**エラー値**で返す。例外ではない」
 * と決めているので、そうします。ここで危ないのは日付で、`new Date(NaN).toISOString()`
 * は **RangeError** を投げます。`dateAtTick(null)` や `addDays()` がそれを踏んでいました
 * （8ファイルを fuzz して 29 箇所）。
 *
 * `str()` は Symbol も吸収します（`String(Symbol)` は throw する）。 */
const arr = v => Array.isArray(v) ? v : [];
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const num = (v, d = 0) => Number.isFinite(v) ? v : d;
const str = v => typeof v === 'string' ? v
               : (v == null || typeof v === 'symbol') ? '' : String(v);

const isoOf = v => str(v).slice(0, 10);
const isIso = v => ISO_RE.test(isoOf(v)) && Number.isFinite(Date.parse(isoOf(v)+'T00:00:00Z'));
/* UTC の日数に落とす。ここだけが Date を触る場所で、データには出ていきません。 */
/* 解析できない日付は NaN を返し、**下流がそれを見て空を返します**。
   ここで既定値に化けさせると、間違った日付が正しい日付として通ってしまいます。 */
const dayNo = v => {
  const t = Date.parse(isoOf(v)+'T00:00:00Z');
  return Number.isFinite(t) ? Math.floor(t / MS_DAY) : NaN;
};
/* NaN と範囲外は `null`。`new Date(NaN).toISOString()` は RangeError を投げるので、
   ここが全域性の要です（fuzz が踏んだのはここ）。 */
const dayIso = n => {
  if(!Number.isFinite(n)) return null;
  const ms = Math.round(n) * MS_DAY;
  if(!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  try { return new Date(ms).toISOString().slice(0, 10); } catch { return null; }
};
const addDays = (v, n) => dayIso(dayNo(v) + Math.round(num(n)));
/* from から to までの日数。負なら to が過去。解析できなければ 0（距離が無い）。 */
const daysBetween = (from, to) => {
  const d = dayNo(to) - dayNo(from);
  return Number.isFinite(d) ? d : 0;
};

function newClock(over){
  const src = {...TIME_DEFAULTS, ...obj(over)};
  const start = isIso(src.start) ? isoOf(src.start) : TIME_DEFAULTS.start;
  return {
    start,
    daysPerTick: Math.max(1, Math.round(num(src.daysPerTick)) || TIME_DEFAULTS.daysPerTick),
    tick: Math.max(0, Math.round(num(src.tick)) || 0)
  };
}

/* 時計が壊れていても既定の時計として答えます（`null` を返すと呼ぶ側が全部
   分岐することになり、画面が日付を出せなくなる）。 */
const safeClock = c => {
  const o = obj(c);
  return isIso(o.start) && Number.isFinite(o.daysPerTick) && Number.isFinite(o.tick)
    ? o : newClock(o);
};
const dateAtTick = (clockIn, tick) => {
  const clock = safeClock(clockIn);
  return addDays(clock.start, clock.daysPerTick * Math.max(0, Math.round(num(tick))));
};
const clockDate = clockIn => {
  const clock = safeClock(clockIn);
  return dateAtTick(clock, clock.tick);
};

/* 進む単位。既定は1 tick = キャンペーン1本。戻れません（時間の流れに逆らって
   守るゲームで、時間が戻れたら守る意味が消えます）。 */
const advanceClock = (clockIn, ticks) => {
  const clock = safeClock(clockIn);
  return {...clock, tick: clock.tick + Math.max(0, Math.round(num(ticks, 1)))};
};

/* その日付を含む最初の tick。ceil なので、期限の当日はもう「越えた」側の tick に
   入ります — 期限は猶予ではありません。 */
const tickForDate = (clockIn, iso) => {
  const clock = safeClock(clockIn);
  return Math.max(0, Math.ceil(daysBetween(clock.start, iso) / clock.daysPerTick));
};

/* ---------------------------------------------------------------- 解決
   時刻 T で何が起こっているか。イベント源を引数で受ける純関数です。

     arrived   その時刻までに起きた（at <= 今日）
     fresh     opts.since の tick より後に起きた分だけ。「この tick で新しく
               来たもの」を、呼ぶ側が差分を持たずに取れるようにするため
     pending   まだ来ていない
     expired   `until` を越えた。**使い続けているかどうかは知りません** —
               それは呼ぶ側（構成）の情報で、ここは期限だけを見ます
     expiring  `until` が horizon 以内に来る

   `expired` / `expiring` は arrived の中からしか出ません。来ていないものを
   「期限切れで使っている」とは言えないからです。 */
function resolveTimeline(clockIn, sources, opts){
  const clock = safeClock(clockIn);
  const o = obj(opts);
  const tick = Math.max(0, Math.round(num(o.tick, clock.tick)));
  const today = dateAtTick(clock, tick);
  const horizon = Math.max(0, num(o.horizonDays, HORIZON_DAYS));
  const sinceDate = o.since == null ? null : dateAtTick(clock, o.since);

  const arrived = [], fresh = [], pending = [], expired = [], expiring = [];
  for(const raw of arr(sources)){
    if(!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    if(!isIso(raw.at)) continue;
    const at = isoOf(raw.at);
    const view = {...raw, at,
      atTick: tickForDate(clock, at),
      daysUntil: daysBetween(today, at),
      daysOver: daysBetween(at, today),
      arrived: daysBetween(at, today) >= 0};
    if(!view.arrived){ pending.push(view); continue; }
    arrived.push(view);
    if(sinceDate !== null && daysBetween(sinceDate, at) > 0) fresh.push(view);
    if(!isIso(raw.until)) continue;
    const until = isoOf(raw.until);
    const over = daysBetween(until, today);
    const dl = {...view, until, daysUntil:-over, daysOver:over};
    if(over >= 0) expired.push(dl);
    else if(-over <= horizon) expiring.push(dl);
  }
  const byDate = (a, b) => daysBetween(b.at, a.at) || String(a.id).localeCompare(String(b.id));
  const byDeadline = (a, b) =>
    daysBetween(b.until, a.until) || String(a.id).localeCompare(String(b.id));
  arrived.sort(byDate); fresh.sort(byDate); pending.sort(byDate);
  expired.sort(byDeadline); expiring.sort(byDeadline);
  return {tick, date:today, arrived, fresh, pending, expired, expiring};
}

/* 2つの時刻の間に来たものだけ。`resolveTimeline(..., {since})` の別の入口で、
   キャンペーンが1本流れたあとに「今回の分」を出すのがこれです。 */
function arrivalsBetween(clock, fromTick, toTick, sources){
  return resolveTimeline(clock, sources, {tick:num(toTick), since:num(fromTick)}).fresh;
}

/* 期限だけの視界。バージョン管理ページと、点の減算の入力になります。
   `daysOver >= 0` のものが「越えている」。 */
function deadlinesAt(clock, sources, opts){
  const r = resolveTimeline(clock, sources, opts);
  return {date:r.date, tick:r.tick, expired:r.expired, expiring:r.expiring};
}

/* 越えてからの日数。越えていなければ 0。減算が「越えている間ずっと」効くために
   呼ぶ側が使います。 */
function overdueDays(clockIn, entry, opts){
  const e = obj(entry);
  if(!isIso(e.until)) return 0;
  const clock = safeClock(clockIn);
  const today = dateAtTick(clock, num(obj(opts).tick, clock.tick));
  return Math.max(0, daysBetween(isoOf(e.until), today));
}

/* ---------------------------------------------------------------- 段（飛べない）
   バージョンは飛べません。段を踏んで上げます（GAME-DESIGN §3-1）。

   track は昇順の段の配列で、`rank` があればそれが段、無ければ配列の順です。
   ここが持つのは「順序」と「その段がもう出ているか」だけで、上げると何が壊れる
   かは versions.js の持ち物です。 */
function orderedTrack(track){
  return arr(track)
    .filter(r => r && typeof r === 'object' && !Array.isArray(r) && isIso(r.at))
    .map((r, i) => ({...r, at:isoOf(r.at), rank: typeof r.rank === 'number' ? r.rank : i}))
    .sort((a, b) => (a.rank - b.rank) || String(a.id).localeCompare(String(b.id)));
}

/* いまどの段に居て、次にどこへ行けるか。

     next     **1つ上の段だけ。** もう出ていれば entry、出ていなければ null。
              飛び先の一覧は返しません — 飛べないことが機構です
     ahead    上にあってもう出ている段（次に行くには順に踏む必要があります）
     locked   上にあってまだ出ていない段
     behind   最新の出ている段から何段遅れているか
     expired  いま居る段が自分の `until` を越えている（＝廃止されたものを
              使い続けている）。減算の入力です */
function ladderAt(clockIn, track, currentId, opts){
  const clock = safeClock(clockIn);
  const rungs = orderedTrack(track);
  const today = dateAtTick(clock, num(obj(opts).tick, clock.tick));
  const view = rungs.map(r => ({...r,
    atTick: tickForDate(clock, r.at),
    daysUntil: daysBetween(today, r.at),
    daysOver: daysBetween(r.at, today),
    arrived: daysBetween(r.at, today) >= 0}));

  let at = -1;
  for(let i = 0; i < view.length; i++) if(view[i].id === currentId) at = i;
  const current = at < 0 ? null : view[at];
  const above = view.slice(at + 1);
  const nextRung = above.length ? above[0] : null;

  let newestIdx = -1;
  for(let i = 0; i < view.length; i++) if(view[i].arrived) newestIdx = i;
  const newest = newestIdx < 0 ? null : view[newestIdx];

  const hasUntil = !!(current && isIso(current.until));
  const over = hasUntil ? daysBetween(isoOf(current.until), today) : null;
  return {
    date: today,
    rungs: view,
    current, currentIndex: at,
    next: nextRung && nextRung.arrived ? nextRung : null,
    blockedNext: nextRung && !nextRung.arrived ? nextRung : null,
    ahead: above.filter(r => r.arrived),
    locked: above.filter(r => !r.arrived),
    behind: newestIdx < 0 ? 0 : Math.max(0, newestIdx - at),
    newest,
    expired: hasUntil && over >= 0,
    daysOver: hasUntil ? Math.max(0, over) : 0,
    daysToExpiry: hasUntil ? -over : null
  };
}

/* fromId から toId まで、踏まなければならない段。`rungs.length` が払う回数で、
   1つでも未リリースの段が挟まっていれば `ok:false`（そこで止まる）。

   `reason` はキーです。文言はデータ側（呼ぶ側が語を持ちます）。 */
function climbTo(clockIn, track, fromId, toId, opts){
  const clock = safeClock(clockIn);
  const rungs = orderedTrack(track);
  const today = dateAtTick(clock, num(obj(opts).tick, clock.tick));
  let i = -1, j = -1;
  for(let k = 0; k < rungs.length; k++){
    if(rungs[k].id === fromId) i = k;
    if(rungs[k].id === toId) j = k;
  }
  if(j < 0) return {ok:false, reason:'unknown', rungs:[], steps:0, blocked:null};
  if(j === i) return {ok:true, reason:'here', rungs:[], steps:0, blocked:null};
  if(j < i)   return {ok:false, reason:'backwards', rungs:[], steps:0, blocked:null};
  const path = rungs.slice(i + 1, j + 1)
    .map(r => ({...r, arrived: daysBetween(r.at, today) >= 0}));
  const blocked = path.find(r => !r.arrived) || null;
  return {
    ok: !blocked,
    reason: blocked ? 'unreleased' : null,
    rungs: path,
    steps: path.length,
    blocked
  };
}

/* ---------------------------------------------------------------- 検証
   イベント源も純データでなければなりません（JSON 往復で不変）。呼ぶ側の
   versions.js / vulns.js / campaign.js が自分のテーブルを通せるように、
   形の検査をここに置きます。パスを返すのは schema.js と同じ理由 —
   複数セッションが同時に書くとき、メッセージが価値の全部です。 */
const RESERVED_KEYS = ['atTick','daysUntil','daysOver','arrived'];

function plainErrorsIn(v, path, out){
  if(v === null) return out;
  const t = typeof v;
  if(t === 'string' || t === 'boolean') return out;
  if(t === 'number'){
    if(!Number.isFinite(v)) out.push(`${path}: ${v} does not survive JSON`);
    return out;
  }
  if(Array.isArray(v)){ v.forEach((x, i) => plainErrorsIn(x, `${path}[${i}]`, out)); return out; }
  if(t === 'object'){
    const proto = Object.getPrototypeOf(v);
    if(proto !== Object.prototype && proto !== null){
      out.push(`${path}: must be a plain object, got ${v.constructor?.name || 'exotic object'}`);
      return out;
    }
    for(const [k, x] of Object.entries(v)) plainErrorsIn(x, `${path}.${k}`, out);
    return out;
  }
  out.push(`${path}: ${t} is not data — the timeline has to stay portable to JSON`);
  return out;
}

function timelineErrors(sources, label){
  const out = [];
  const name = label || 'sources';
  if(!Array.isArray(sources)) return [`${name}: must be an array of events`];
  plainErrorsIn(sources, name, out);
  if(out.length) return out;
  const seen = new Set();
  sources.forEach((e, i) => {
    const at = `${name}[${i}]`;
    if(!e || typeof e !== 'object' || Array.isArray(e)) return out.push(`${at}: must be an object`);
    if(typeof e.id !== 'string' || !e.id) return out.push(`${at}.id is required`);
    if(seen.has(e.id)) out.push(`${at}.id "${e.id}" appears more than once`);
    seen.add(e.id);
    if(!isIso(e.at)) out.push(`${at}.at must be a YYYY-MM-DD date, got ${JSON.stringify(e.at)}`);
    if(e.until != null && !isIso(e.until))
      out.push(`${at}.until must be a YYYY-MM-DD date or absent, got ${JSON.stringify(e.until)}`);
    if(isIso(e.at) && isIso(e.until) && daysBetween(e.at, e.until) < 0)
      out.push(`${at}.until ${isoOf(e.until)} is before .at ${isoOf(e.at)}`);
    if(e.rank != null && typeof e.rank !== 'number')
      out.push(`${at}.rank must be a number or absent`);
    for(const k of RESERVED_KEYS)
      if(k in e) out.push(`${at}.${k} is reserved — the timeline derives it`);
  });
  return out;
}

export {
  TIME_DEFAULTS,
  HORIZON_DAYS,
  RESERVED_KEYS,
  isIso,
  addDays,
  daysBetween,
  newClock,
  advanceClock,
  clockDate,
  dateAtTick,
  tickForDate,
  resolveTimeline,
  arrivalsBetween,
  deadlinesAt,
  overdueDays,
  orderedTrack,
  ladderAt,
  climbTo,
  timelineErrors
};
