/* k8s のルールが1本も鳴らない、スタンドアロンのホスト。
 *
 * The reference example for an environment that makes a detection impossible
 * rather than merely missing. Nothing here is broken, nothing is misconfigured,
 * and the step still cannot be caught — the environment has no Kubernetes in
 * it. Recognising that the ceiling is 5 and not 6 is the win condition. */
export default {
  id:'standalone-k8s-rules',
  title:'鳴らない k8s ルール',
  order:30,
  blurb:'ルールは最新まで追従している。それでも k8s 系のルールが1本も鳴らない。'+
        'この街は <b>1台のホスト</b>。',

  env:{ type:'standalone', nodes:1 },

  start:{
    built:['driver','ring','state','rules','outputs','falcoctl'],
    tune:{},
    load:1.0,
    driver:'kmod',                  /* an older kernel, so the module it is */
    stack:'oss'
  },

  player:{ side:'defense', role:'platform', lockRole:true },

  attack:{
    auto:true, response:false,
    waves:[
      { jp:'侵入と足場づくり',     steps:['exec','shadow','cron'] },
      { jp:'横展開とクラウドへ',   steps:['dropbin','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'no-k8s-context-on-a-host',
    wrong:'k8s のルールが鳴らないのは、ルールが古いか壊れているからだ',
    truth:'この環境に Kubernetes が無い。<code>k8saudit</code> 系のルールは監査すべき '+
          'API サーバが存在しないので1本も発火せず、アラートは <code>container.id</code> '+
          'までしか持たない。<b>ルール側では直らない</b>。5段が上限で、それが正解。'
  },

  goal:{ detect:5, contain:false, maxAsks:1, maxDropPct:null }
};
