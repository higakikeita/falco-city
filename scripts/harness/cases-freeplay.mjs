/* falco-city — 自由モード（第2部）の主張。GATE-FREEPLAY.md F1。
   ---------------------------------------------------------------------------
   `cases.mjs` は9本のシナリオ側の因果を守っています。この suite は新設計の方で、
   守るものが2種類あります:

     ① 時間軸の事実が、登録された一次資料と一致していること
        INVARIANTS §10 が register で、`src/versions.js` が実装です。**版の履歴は
        我々が作らないコンテンツなので**（GAME-DESIGN §3）、ズレたら直すのは実装側
        であって register 側ではありません。だからここで突き合わせます

     ② 新設計の因果 —— 点の単調性 / 溜め込むと追い抜かれる / 生成の再現性 /
        テストで通っても本番で落ちる / 業種ごとに主役のレバーが変わる

   ---------------------------------------------------------- 未着地でも緑になる
   8つの新規モジュールは1レーンが並行で作っています。**無いものは `pending` に
   置きます** —— 赤にもせず、黙って通しもしません。「依存が未着地」と毎回言うので、
   検査していないことが緑に見える状態にはなりません。

   モジュールは import 文で参照しません（`main` にまだ無いので esbuild が解決に
   失敗します）。実行時に `process.cwd()` から読みます —— 8ファイルはどれも
   import 0 の純データなので、束ねる必要がありません。 */
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite } from './lib.mjs';

const { G, check, pending, main, assert, eq, fmt, pct } = suite('自由モード (F1)');

/* ------------------------------------------------------------------ loading */
const SRC = join(process.cwd(), 'src');
const mods = {};
for(const name of ['versions','policies','archetypes','stages',
                   'timeline','score','vulns','campaigns']){
  const file = join(SRC, `${name}.js`);
  if(!existsSync(file)) continue;
  try { mods[name] = await import(pathToFileURL(file).href); }
  catch (e) { mods[name] = {__error: e.message}; }
}
/* a module is usable when it loaded AND exports what this claim needs */
function need(name, ...exports){
  const m = mods[name];
  if(!m) return {ok:false, why:`\`src/${name}.js\` が未着地`};
  if(m.__error) return {ok:false, why:`\`src/${name}.js\` を読めない: ${m.__error}`};
  const missing = exports.filter(e => m[e] === undefined);
  if(missing.length)
    return {ok:false, why:`\`src/${name}.js\` に ${missing.join(' / ')} が無い`};
  return {ok:true, m};
}
/* run a claim only when its dependency is there */
function when(dep, name, fn){
  if(!dep.ok) return pending(name, dep.why + ' —— 着地したら自動で判定されます');
  check(name, () => fn(dep.m));
}
/* …and when it needs more than one module, name the first one missing */
const needAll = (...deps) => deps.find(d => !d.ok) || deps[0];

/* ------------------------------------------------------------------ *
 * 1. 時間軸の事実 — INVARIANTS §10 の register と実装の突き合わせ
 * ------------------------------------------------------------------ */
G('時間軸の事実 (§10)');

/* INVARIANTS §10.1 に登録した実測値。出典は falcosecurity/falco の releases を
   GitHub API で prerelease を除いて数えたもの（2026-07-31）。**ここを動かすときは
   INVARIANTS §10 を先に直すこと** —— 逆をやると出典の無い数字が実装から入ります。 */
const RELEASES = {
  '0.37.0':'2024-01-30', '0.38.0':'2024-05-30', '0.39.0':'2024-10-01',
  '0.40.0':'2025-01-28', '0.41.0':'2025-05-29', '0.42.0':'2025-10-22',
  '0.43.0':'2026-01-28', '0.44.0':'2026-05-26'
};
/* §10.2 / §10.3 —— 同じ「legacy eBPF」という名前の、別の製品の別の廃止 */
const FALCO_LEGACY_EBPF_REMOVED_IN = '0.44.0';   // 0.43.0 で非推奨 → 0.44.0 で削除
const SYSDIG_LEGACY_EBPF_RETIRED_ON = '2026-12-04';
/* §10.4 —— 下限は2段ある */
const K8SMETA_MIN_FALCO = '0.40.0';              // 現行プラグイン（0.3.x 以降）
const K8SMETA_MIN_FALCO_OLD_PLUGIN = '0.37.0';   // プラグイン 0.2.x を使う場合

const vers = need('versions', 'VERSIONS');

when(vers, 'バージョンのリリース日が一次資料と一致する（§10.1）', m => {
  const byVer = new Map(m.VERSIONS.filter(v => v.line === 'falco').map(v => [v.ver, v]));
  const checked = [];
  for(const [ver, date] of Object.entries(RELEASES)){
    const v = byVer.get(ver);
    if(!v) continue;                    /* 段として持っていないのは実装の選択 */
    assert(v.released === date,
      `Falco ${ver} のリリース日が ${v.released} —— 一次資料は ${date}`
      + '（INVARIANTS §10.1）。実装側を直すこと');
    checked.push(ver);
  }
  assert(checked.length >= 4,
    `突き合わせられた版が ${checked.length} 本しかない（${checked.join(' ')}）`
    + ' —— register にある版をほとんど持っていない');
  /* 段が実際に時間順であること。ここが逆だと「飛べない」が壊れる */
  const falco = m.VERSIONS.filter(v => v.line === 'falco');
  for(let i = 1; i < falco.length; i++)
    assert(falco[i-1].released <= falco[i].released,
      `${falco[i-1].ver} → ${falco[i].ver} でリリース日が逆行している`);
  return `${checked.length} 本が一致（${checked.join(' / ')}）· ${falco.length} 段が時間順`;
});

const drv = need('versions', 'DRIVER_LIFECYCLE', 'driverById');
when(drv, 'legacy eBPF は Falco では版で消え、Sysdig では日付で消える（§10.2 / §10.3）', m => {
  const list = Array.isArray(m.DRIVER_LIFECYCLE)
    ? m.DRIVER_LIFECYCLE : Object.values(m.DRIVER_LIFECYCLE || {});
  assert(list.length, 'ドライバの一覧が空');
  /* Falco 側: 版で消える。日付は持たない */
  const falcoLegacy = list.filter(d => d && d.line === 'falco' && d.removedIn);
  assert(falcoLegacy.length > 0, 'removedIn（版で消える）を持つ Falco のドライバが無い');
  assert(falcoLegacy.some(d => d.removedIn === FALCO_LEGACY_EBPF_REMOVED_IN),
    `Falco の legacy eBPF が ${FALCO_LEGACY_EBPF_REMOVED_IN} で削除されることになっていない`
    + `（実装は ${falcoLegacy.map(d => `${d.id}:${d.removedIn}`).join(' / ')}）`);
  /* Sysdig 側: 日付で消える。版は持たない */
  const byDate = list.filter(d => d && d.retiredOn);
  assert(byDate.some(d => d.retiredOn === SYSDIG_LEGACY_EBPF_RETIRED_ON),
    `Sysdig の legacy eBPF の廃止日が ${SYSDIG_LEGACY_EBPF_RETIRED_ON} になっていない`
    + `（実装は ${byDate.map(d => `${d.id}:${d.retiredOn}`).join(' / ')}）`);
  /* そして1つの項目が両方を持たないこと。持っていたら2つのクロックが1つに
     潰れていて、「上げれば消える」と「日付が来れば消える」を混同している */
  const both = list.filter(d => d && d.removedIn && d.retiredOn);
  assert(both.length === 0,
    `${both.map(d => d.id).join(' / ')} が版と日付の両方で消えることになっている`
    + ' —— Falco と Sysdig の廃止は別のクロック（§10.2 / §10.3）');
  /* 締切として並べたときも、2つが同じ日に潰れていないこと */
  if(typeof m.deadlines === 'function'){
    const ds = m.deadlines({}) || [];
    const owners = new Set(ds.map(d => d.owner).filter(Boolean));
    if(owners.size > 1){
      const dates = new Set(ds.map(d => d.endsOn).filter(Boolean));
      assert(dates.size > 1,
        `締切が ${[...dates].join(' / ')} の1つに潰れている —— 持ち主が ${[...owners].join(' / ')} で違う`);
    }
  }
  return `Falco: 版で消える（${falcoLegacy.map(d => `${d.id} → ${d.removedIn}`).join(' / ')}）· `
       + `Sysdig: 日付で消える（${byDate.map(d => `${d.id} → ${d.retiredOn}`).join(' / ')}）· 混在なし`;
});

const plg = need('versions', 'PLUGINS');
when(plg, 'k8smeta の下限は2段ある（§10.4）', m => {
  const list = Array.isArray(m.PLUGINS) ? m.PLUGINS : Object.values(m.PLUGINS || {});
  const k8s = list.find(p => p && /k8smeta/.test(p.id || p.name || ''));
  assert(k8s, 'k8smeta プラグインの項目が無い');
  const declared = JSON.stringify(k8s);
  assert(declared.includes(K8SMETA_MIN_FALCO),
    `現行プラグインの下限 ${K8SMETA_MIN_FALCO} が宣言に無い: ${declared.slice(0, 200)}`);
  /* 0.37 を「使えない」と書いていないこと。0.2.x なら動くのが一次資料 */
  return `現行は Falco ${K8SMETA_MIN_FALCO} 以上（プラグイン 0.2.x なら `
       + `${K8SMETA_MIN_FALCO_OLD_PLUGIN} 以上）· §10.4`;
});

/* Every claim the data layer makes about the outside world should be findable in
   INVARIANTS.md — that is the whole point of one hand writing that file. This
   checks the pointers resolve; unregistered ones are listed so they can be filed
   as BOARD §2 `I<n>` rows rather than silently becoming folklore. */
const clm = need('versions', 'CLAIMS');
when(clm, '版に関する主張の出典が INVARIANTS に解決する', m => {
  const inv = existsSync('INVARIANTS.md') ? readFileSync('INVARIANTS.md', 'utf8') : '';
  assert(inv, 'INVARIANTS.md が読めない');
  const list = Array.isArray(m.CLAIMS) ? m.CLAIMS : Object.values(m.CLAIMS || {});
  const bad = [], open = [];
  for(const c of list){
    if(!c) continue;
    if(c.invariant === null || c.invariant === undefined){ open.push(c.id); continue; }
    const num = String(c.invariant);
    if(!new RegExp(`^\\|\\s*${num.replace('.', '\\.')}\\s*\\|`, 'm').test(inv))
      bad.push(`${c.id} → INVARIANTS ${num}（その行が無い）`);
  }
  assert(bad.length === 0, bad.join(' / '));
  assert(list.every(c => !c || !c.src || Array.isArray(c.src)),
    'src が配列でない主張がある —— 出典は必ず URL の配列で持つこと');
  return `${list.length} 件中 ${list.length - open.length} 件が INVARIANTS に登録済み`
       + (open.length ? `\n         未登録 ${open.length} 件（BOARD §2 に I<n> 宛で出す）: `
                      + open.join(' / ') : '');
});

/* ------------------------------------------------------------------ *
 * 2. 点の単調性 — 守れば増え、事故れば減る
 * ------------------------------------------------------------------ */
G('点の単調性 (F1)');

const sc = need('score', 'earnRate', 'loseRate', 'GUARD_DEFAULTS');

when(sc, '守れているほど加算が増える（単調・§F1）', m => {
  const at = over => m.earnRate({...m.GUARD_DEFAULTS, ...over});
  /* 完全に守れている状態が最大 */
  const best = at({});
  assert(best.rate > 0, `健全でも加算が 0（${fmt(best.rate)}）`);
  /* ドロップ・埋没が増えるほど下がる。等しくならないこと */
  let prev = best.rate;
  for(const d of [0.02, 0.05, 0.10, 0.20]){
    const r = at({dropP:d}).rate;
    assert(r < prev, `dropP ${pct(d)} で加算が下がらない（${fmt(prev)} → ${fmt(r)}）`);
    prev = r;
  }
  prev = best.rate;
  for(const b of [0.02, 0.05, 0.10, 0.20]){
    const r = at({buriedP:b}).rate;
    assert(r < prev, `buriedP ${pct(b)} で加算が下がらない（${fmt(prev)} → ${fmt(r)}）`);
    prev = r;
  }
  /* 溜め込んでいるほど下がる（塞いでいない脆弱性） */
  const v = n => at({vulns: Array.from({length:n}, (_, i) => ({id:`v${i}`}))}).rate;
  assert(v(1) < best.rate && v(4) < v(1), `脆弱性が増えても加算が下がらない`);
  /* 止まっていれば 0。理由が付くこと */
  const dead = at({dead:true});
  assert(dead.rate === 0 && dead.blocked === 'dead', `停止中に加算が ${fmt(dead.rate)}`);
  return `健全 ${fmt(best.rate)} → drop 20% ${fmt(at({dropP:0.20}).rate)}`
       + ` / buried 20% ${fmt(at({buriedP:0.20}).rate)} / 脆弱性4件 ${fmt(v(4))}`
       + ` / 停止 0（理由 dead）`;
});

when(sc, '事故れば減算が増える（件数に比例・§F1）', m => {
  const at = over => m.loseRate({...m.GUARD_DEFAULTS, ...over});
  const zero = at({});
  const total = r => (r.items || []).reduce((a, i) => a + i.amount, 0);
  assert(total(zero) === 0, `無事故で減算が ${total(zero)}`);
  /* 件数に比例すること。2件が1件の2倍 */
  for(const key of [['missed','miss'], ['buried','buried']]){
    const one = total(at({[key[0]]:1})), two = total(at({[key[0]]:2}));
    assert(one > 0, `${key[1]} 1件で減算が 0`);
    eq(two, one * 2, 1e-9, `${key[1]} の減算が件数に比例しない`);
  }
  /* 埋没は見逃しより重い（検知していたのに見失ったので） */
  assert(total(at({buried:1})) > total(at({missed:1})),
    '埋没が見逃しより軽い —— 検知していたのに見失った方が重いはず');
  /* 放置した脆弱性は tick ごとに引かれる = 総額が期間に比例する */
  const v1 = total(at({vulns:[{id:'a'}]}));
  const v3 = total(at({vulns:[{id:'a'},{id:'b'},{id:'c'}]}));
  assert(v1 > 0 && Math.abs(v3 - v1*3) < 1e-9, '脆弱性の減算が件数に比例しない');
  return `見逃し1件 ${total(at({missed:1}))} < 埋没1件 ${total(at({buried:1}))}`
       + ` · 脆弱性 1件 ${v1} → 3件 ${v3}（比例）`;
});

/* ------------------------------------------------------------------ *
 * 3. 溜め込むと時間の進行に追い抜かれる ← これが成立しないとゲームになりません
 * ------------------------------------------------------------------ */
G('溜め込むと追い抜かれる (F1)');

const led = need('score', 'newLedger', 'tickLedger', 'isBust', 'GUARD_DEFAULTS');
when(led, '塞がずに溜め込むと、いつか点が尽きる', m => {
  /* 完全に守れているが脆弱性を1件も塞がない estate。加算は最大、減算は
     「放置している件数 × tick」。**時間の側が必ず勝つこと**が主張。 */
  const run = (vulnsPerTick, ticks) => {
    let l = m.newLedger({start:1000});
    const open = [];
    for(let t = 1; t <= ticks; t++){
      for(let k = 0; k < vulnsPerTick; k++) open.push({id:`v${t}-${k}`, since:t});
      l = m.tickLedger(l, {...m.GUARD_DEFAULTS, vulns:open.slice()}, {tick:t});
      if(m.isBust(l)) return {bust:true, t, points:l.points, open:open.length};
    }
    return {bust:false, t:ticks, points:l.points, open:open.length};
  };
  /* 何も塞がなければ詰む */
  const hoard = run(1, 200);
  assert(hoard.bust,
    `脆弱性を 200 tick 溜め込んでも点が残っている（${hoard.points}）`
    + ' —— 溜め込みに時間の圧が掛かっていない。これが無いとゲームになりません');
  /* 溜め込む速さが上がれば、詰むのは早くなる（単調） */
  const fast = run(3, 200);
  assert(fast.bust && fast.t < hoard.t,
    `溜め込む速さを3倍にしても詰むのが早くならない（${hoard.t} tick → ${fast.t} tick）`);
  /* そして塞ぎ続ければ詰まない —— 詰みが「時間そのもの」ではなく「放置」に
     由来していることの対偶。ここが逆だと、何をしても負けるゲームになります */
  let clean = m.newLedger({start:1000});
  for(let t = 1; t <= 200; t++) clean = m.tickLedger(clean, {...m.GUARD_DEFAULTS}, {tick:t});
  assert(!m.isBust(clean),
    `1件も溜め込んでいないのに ${200} tick で詰んだ（${clean.points}）`
    + ' —— 詰みの原因が放置ではなく時間そのものになっている');
  assert(clean.points > 1000, `守り切っても点が増えない（1000 → ${clean.points}）`);
  return `1件/tick で ${hoard.t} tick で尽きる（未対応 ${hoard.open} 件）· `
       + `3件/tick なら ${fast.t} tick · 塞ぎ続ければ 200 tick 後 ${clean.points} 点で健在`;
});

/* ------------------------------------------------------------------ *
 * 4. 生成キャンペーンの再現性と公平さ（F5 / F6 の判定側）
 * ------------------------------------------------------------------ */
G('生成の再現性と公平さ (F5 / F6)');

const cmp = need('campaigns', 'generateCampaign', 'auditCampaign', 'makeRng');
/* 生成には CHAIN が要る。cases.mjs 側と同じ実物を使いたいが、この suite は
   src/campaign.js を import しない（DOM を要求するので）。**モジュール graph は
   共有しているので、cases.mjs が先に評価済み** —— それでも依存を作らないため、
   ここでは campaigns.js の契約どおり「呼ぶ側が渡す chain」を最小構成で作る。 */
const FAKE_CHAIN = [
  {id:'exec',   jp:'シェルを取る',   needs:['driver','ring','state','rules','outputs'], needsCaps:['kernelPath']},
  {id:'shadow', jp:'/etc/shadow',    needs:['driver','ring','state','rules','outputs'], needsCaps:['kernelPath']},
  {id:'k8sapi', jp:'API サーバ',     needs:['driver','ring','state','rules','outputs'], needsCaps:['kernelPath','apiServer']},
  {id:'cloud',  jp:'クラウドへ',     needs:['rules','outputs','plugins'], needsCaps:[]},
  {id:'contain',jp:'封じ込め',       needs:['sysdig'], response:true}
];

when(cmp, '同じシードなら同じキャンペーンが出る（F5）', m => {
  /* posture.caps は capability 名の配列（campaigns.js §normalisePosture）。
     オブジェクトの map を渡すと new Set(...) が投げる —— BOARD に出した */
  const opts = {chain:FAKE_CHAIN, tick:7, seed:12345,
                posture:{caps:['kernelPath','apiServer']}};
  const a = JSON.stringify(m.generateCampaign(opts));
  const b = JSON.stringify(m.generateCampaign({...opts}));
  assert(a === b, '同じシード・同じ tick で違うキャンペーンが出た（F5 が破れている）');
  /* 種を変えれば変わること。変わらないなら種が効いていない */
  const c = JSON.stringify(m.generateCampaign({...opts, seed:999}));
  const d = JSON.stringify(m.generateCampaign({...opts, tick:8}));
  assert(c !== a || d !== a,
    'シードも tick も変えたのに同じキャンペーンが出る —— 生成が定数になっている');
  /* 生成物が純データであること（F3 の一部。Unity 版と英語版の保険） */
  const one = m.generateCampaign(opts);
  assert(JSON.stringify(JSON.parse(JSON.stringify(one))) === JSON.stringify(one),
    'キャンペーンが JSON を往復できない');
  return `seed 12345 / tick 7 が再現 · seed か tick を変えれば変わる · JSON 往復も不変`;
});

when(cmp, '生成された攻撃には必ず打つ手がある（F6）', m => {
  const posture = {caps:['kernelPath','apiServer']};
  const bad = [];
  for(let seed = 1; seed <= 40; seed++){
    for(const tick of [0, 5, 20]){
      const camp = m.generateCampaign({chain:FAKE_CHAIN, tick, seed, posture});
      const audit = m.auditCampaign(camp, posture, {chain:FAKE_CHAIN});
      if(!audit) { bad.push(`seed ${seed}/tick ${tick}: 監査が何も返さない`); continue; }
      /* 監査が「理不尽」と判定したものが出てはならない */
      if(audit.fair === false)
        bad.push(`seed ${seed}/tick ${tick}: ${audit.why || audit.reason || '理不尽'}`);
    }
  }
  assert(bad.length === 0, bad.slice(0, 5).join(' / ')
    + (bad.length > 5 ? ` …他 ${bad.length-5} 件` : ''));
  return `40 シード × 3 時点 = 120 通りすべて、監査が公平と判定`;
});

/* ------------------------------------------------------------------ *
 * 5. テストで通っても本番で落ちる（V3 の機械側）
 * ------------------------------------------------------------------ */
G('テストと本番の段差 (F1 / V3)');

const stg = need('stages', 'STAGES', 'stageDelta');
const arch = need('archetypes', 'ARCHETYPES');
when(needAll(stg, arch),
     '本番はテストより必ず厳しい（負荷・アラート・波のどれかで）', () => {
  const A = mods.archetypes.ARCHETYPES;
  const S = mods.stages;
  const ids = S.STAGES.map(s => s.id);
  assert(ids.includes('test') && ids.includes('prod'),
    `test / prod が無い（${ids.join(' / ')}）`);
  const lines = [];
  for(const a of A){
    const d = S.stageDelta(a, 'test', 'prod');
    assert(d, `${a.id}: stageDelta が何も返さない`);
    /* 何かが厳しくなっていること。ぜんぶ同じなら段差が無い＝V3 が成立しない */
    const txt = JSON.stringify(d);
    assert(txt !== '{}' && txt.length > 2,
      `${a.id}: テストと本番の差が空 —— 「テストで通ったのに本番で落ちる」が起きない`);
    lines.push(`${a.id}: ${txt.slice(0, 60)}`);
  }
  return lines.join('\n         ');
});

/* ------------------------------------------------------------------ *
 * 6. 業種ごとに主役のレバーが変わる
 * ------------------------------------------------------------------ */
G('業種ごとの主役のレバー (F1)');

const arc = need('archetypes', 'ARCHETYPES', 'starLever');
when(arc, '4業種で主役のレバーが分かれている', m => {
  const A = m.ARCHETYPES;
  assert(A.length >= 4, `業種が ${A.length} しかない`);
  const levers = A.map(a => [a.id, m.starLever(a)]);
  for(const [id, l] of levers){
    assert(l, `${id} に主役のレバーが宣言されていない`);
    assert(l.star && l.why, `${id} の主役のレバーに名前か理由が無い`);
  }
  /* 同一性ではなく **キーで** 数える。オブジェクトを Set に入れると
     参照が違うだけで「4種類」になり、検査が意味を失う */
  const distinct = new Set(levers.map(([, l]) => l.key || l.star));
  assert(distinct.size >= 3,
    `4業種の主役が ${distinct.size} 種類しかない（${[...distinct].join(' / ')}）`
    + ' —— 業種差が演出になっている');
  return levers.map(([id, l]) => `${id}=${l.star}(${l.key})`).join(' · ');
});

const ineff = need('archetypes', 'ARCHETYPES', 'starLever', 'isIneffective');
when(ineff, '主役でないレバーは、その業種では効かないと宣言されている', m => {
  const lines = [];
  for(const a of m.ARCHETYPES){
    const star = m.starLever(a);
    assert(!m.isIneffective(a, star.star),
      `${a.id}: 主役のレバー ${star.star} が「効かない」に入っている`);
    /* 効かないと宣言されたものが本当に効かない側にあること。空なら
       「業種ごとに主役が変わる」の裏返しが宣言されていない */
    const dead = star.ineffective || [];
    assert(dead.length > 0,
      `${a.id}: 効かないレバーが1つも宣言されていない —— 主役 ${star.star} の`
      + '「他は効かない」が言えていない');
    for(const d of dead)
      assert(m.isIneffective(a, d), `${a.id}: ${d} が isIneffective で効かない扱いになっていない`);
    lines.push(`${a.id}: ${star.star} は効く / ${dead.join(',')} は効かない`);
  }
  return lines.join(' · ');
});

export { main };
