/* 検知は満点。なのに止められない。
 *
 * The reference example for the seam between DETECTION and RESPONSE. Every
 * other scenario in this directory is about a detection that does not land;
 * this one is the opposite, and it is the only shape that can make the point:
 * the syscall path, the plugin input and the rule distribution are ALL standing,
 * the attack is caught 6/6, and the breach still runs to completion.
 *
 * Nothing here is broken. There is no tuning mistake, no missing rule, no
 * environment ceiling. The pipeline is doing exactly what OSS Falco is for —
 * it is an eye — and an eye does not close a door (INVARIANTS 5.1).
 *
 * The misdiagnosis is placed inside the player's own toolbox on purpose. As
 * SOC they own the STACK lever, so `+ Sysdig` is one click away, and clicking
 * it changes the console banner and the policy stream and stops nothing:
 * applyShield() only raises a Shield when 08 is actually standing
 * (src/controls.js). Holding the licence and having the component deployed are
 * different facts, and this scenario is the difference.
 *
 * CAUSALITY, load-bearing (INVARIANTS 5.2): building 08 must not add a single
 * detection. `sysdig` appears in no CHAIN step's `needs` — only in RESPONSE's —
 * so detection is 6/6 before and 6/6 after, and the only cell that flips is
 * containment. A scenario that made Sysdig raise the detection count would be
 * selling the product with a lie the model does not tell. */
export default {
  id:'eyes-but-no-hands',
  title:'見えているのに止まらない',
  order: 50,
  blurb:'このクラスタの検知は<b>完成している</b> — 6段の攻撃を6段とも取れる。'+
        'アラートは SOC に届いており、いま侵害は<b>進行中</b>。'+
        'それでも侵害されたコンテナは動き続けている。',

  /* a shop that runs on EKS/GKE/AKS and has already done the detection work.
     kernelPath と apiServer が揃っているので、6段すべてが成立し得る環境 */
  env:{ type:'managed-k8s', nodes:3 },

  /* everything the OSS side has to offer is already standing: syscall 経路
     (02-06) ＋ プラグイン入力 (07) ＋ ルール配布 (09)。建っていないのは 08 だけ */
  start:{
    built:['driver','ring','state','rules','outputs','plugins','falcoctl'],
    tune:{},                        /* 既定。ドロップは 0% で、症状に負荷は無関係 */
    load:1.0,
    driver:'modern_ebpf',
    stack:'oss'                     /* 目だけの状態。ここが症状そのもの */
  },

  /* you are SOC, and this is the point: the team whose job is to stop it holds
     the only lever that matters, and the lever they will reach for first is the
     wrong one. 検知側の持ち物は既に満点なので、触らせる必要が無い */
  player:{ side:'defense', role:'soc', lockRole:true },

  attack:{
    auto:true, response:true,
    waves:[
      { jp:'侵入と足場づくり',   steps:['exec','shadow','cron'] },
      { jp:'横展開とクラウドへ', steps:['dropbin','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'detection-is-not-response',
    wrong:'全部検知できているのに止まらない → OSS 側のルールを増やす／出力チャネルを足す',
    truth:'<b>検知はもう満点で、足すものが無い。</b> OSS Falco は<b>目</b>で、'+
          '止める手は別のコンポーネント（Sysdig の応答、または Falco Talon）。'+
          '<code>STACK</code> を <b>+ Sysdig</b> に切り替えてもコンソールの名前が変わるだけで、'+
          '<b>08 Sysdig Secure が建っていなければ Shield はどこにも無い</b> — '+
          '買っていることと入っていることは別。'+
          'そして 08 を建てても<b>検知は 6/6 のまま増えない</b>。増えるのは相関と応答だけ。'
  },

  /* 検知は最初から満点、封じ込めだけが落ちている。依頼 0 件 = この失点は
     よそのチームのせいではない（前任者の falco.yaml と対になる条件） */
  goal:{ detect:6, contain:true, maxAsks:0, maxDropPct:null }
};
