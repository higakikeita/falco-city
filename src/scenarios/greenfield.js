/* 空き地から建てる — the tutorial, and nothing more special than that.
 *
 * This used to be hardcoded as "campaign mode". It is now one scenario like any
 * other: the case where the person before you left nothing behind. Real
 * handovers are the other scenarios in this directory. See schema.js. */
export default {
  id:'greenfield',
  title:'空き地から建てる',
  order:10,
  blurb:'いまは空き地。ワークロードは syscall を出しているが、受け止めるものが何も無い。'+
        '依存順に建てて、6段の攻撃を迎え撃つ。',

  env:{ type:'self-managed-k8s', nodes:3 },

  /* nothing inherited: no districts, default tuning, healthy load */
  start:{ built:[], tune:{}, load:1.0, driver:'modern_ebpf', stack:'oss' },

  /* one player doing every job, which is the only way to see the whole shape */
  player:{ side:'defense', role:null, lockRole:false },

  attack:{
    auto:true, response:true,
    waves:[
      { jp:'侵入と足場づくり',   steps:['exec','shadow','cron'] },
      { jp:'横展開とクラウドへ', steps:['dropbin','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'built-is-not-working',
    wrong:'依存順に全部建て終えれば、検知は完成している',
    truth:'建て終えても、<b>持っていないルール</b>（09 ルール配布）・<b>syscall に現れない操作</b>'+
          '（07 プラグイン入力）・<b>止める手</b>（08 Sysdig）の3つは別に足すもの。'+
          'パイプラインを持っていることと、それが機能していることは別。'
  },

  goal:{ detect:6, contain:true, maxAsks:null, maxDropPct:null }
};
