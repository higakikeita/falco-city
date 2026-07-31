/* 持っていないルールは鳴らない。
 *
 * The reference example for a gap that is not a stage of the pipeline. Every
 * district on the flow is standing, the ring buffer is losing nothing, five of
 * six steps ring — and the sixth cannot, because the rule for it was never on
 * the node. Falco's release package carries the Stable rules only; the rest are
 * OCI artifacts that falcoctl has to fetch. The missing piece is a supply line,
 * not a stage, which is why looking at the pipeline harder never finds it.
 *
 * The player is the platform role on purpose. Everything they own — 02 ドライバ,
 * 04 状態エンジン, and the DEPLOY / DRIVER levers — is exactly what the situation
 * invites them to suspect, and none of it changes the result. 09 belongs to the
 * detection engineer, so the fix is an ask, and the budget is one: spending it
 * on 08 Sysdig ("買えば検知が増えるだろう") loses the run. */
export default {
  id:'rules-not-followed',
  title:'持っていないルール',
  order: 40,
  blurb:'流れの全段が建っている。ドロップ 0%、アラートも届いている。それでも '+
        '<code>/tmp</code> のバイナリ実行だけが鳴らない。'+
        '前任のメモには「ルールは最新」とある。',

  env:{ type:'managed-k8s', nodes:3 },

  start:{
    /* the whole flow plus the bypass lane. 09 ルール配布 is the one thing absent,
       and it is absent because nobody ever built it — not because it broke. */
    built:['driver','ring','state','rules','outputs','plugins'],
    tune:{},                       /* nothing to find here, and that is the point */
    load:1.0,                      /* util well under capacity: the HUD stays clean */
    driver:'modern_ebpf',
    stack:'oss'
  },

  /* fixed role: the levers you hold are the ones the symptom points at, and none
     of them is the cause */
  player:{ side:'defense', role:'platform', lockRole:true },

  attack:{
    auto:true, response:false,
    waves:[
      { jp:'侵入と足場づくり',   steps:['exec','shadow','cron'] },
      { jp:'横展開とクラウドへ', steps:['dropbin','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'bundled-rules-are-stable-only',
    wrong:'5段は鳴っていてドロップも 0% → 取りこぼしているのは<b>ドライバか状態エンジン</b>だ。'+
          'ドライバを替える、あるいは <b>Sysdig を入れれば</b>検知が増えるはず',
    truth:'この検知（<code>Drop and execute new binary in container</code>）は'+
          '<b>そもそもノードに無い</b>。リリースパッケージに同梱されるのは成熟度 <b>Stable</b> の'+
          'ルールだけで、Incubating / Sandbox は <b>OCI アーティファクト</b>として別に取得するもの。'+
          'それをやるのが <code>falcoctl</code>（<b>09 ルール配布</b>）。'+
          'パイプラインは1段も欠けていないので、ドライバも状態エンジンもチューニングも無関係。'+
          '実機では <code>artifact.install.refs</code>（取得）・'+
          '<code>artifact.follow.refs</code>（追従）・<code>rules_files</code>（読み込み）の'+
          '<b>3キーが揃って</b>はじめて効く。どれか1つ欠けると「入れたはずなのに鳴らない」になる。'
  },

  /* 6段すべて。依頼は1回だけ — 09 を頼むための1回で、他に回す余裕は無い。
     ドロップ上限は満たされたまま残る: HUD が健康でも検知は落ちる、の対比 */
  goal:{ detect:6, contain:false, maxAsks:1, maxDropPct:1 }
};
