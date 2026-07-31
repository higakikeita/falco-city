/* クラウド側の侵害だけが1段も鳴らない。syscall 側は健康。
 *
 * The reference example for a miss that is STRUCTURAL rather than quantitative.
 * Everything on the syscall path is standing, the ring buffer is losing nothing,
 * and the rules are followed with falcoctl — so every lever the situation points
 * at (a wider base_syscalls, a different driver, a bigger buffer, more syscall
 * rules) is a lever on a stream the event never travelled in.
 *
 * The ground for that is not "cloud API calls do not appear in syscalls". It is
 * sharper: RULES ARE SPLIT BY EVENT SOURCE, AND FALCO DOES NOT CORRELATE ACROSS
 * SOURCES. `aws_cloudtrail` is a separate source with its own field space
 * (`ct.*`), so a syscall rule's condition cannot even name the fields the event
 * carries. The miss is a partition, not a shortage — which is exactly why the
 * amount of syscall work done on this side is irrelevant, and why the only move
 * is to stand up the source (07 プラグイン入力) and let it join the same engine.
 *
 * The misdiagnosis is made to cost something rather than merely fail:
 * base_syscalls: all raises inflow past drain capacity, so it buys 0 cloud
 * detections and loses one syscall detection it already had, plus the 1% drop
 * ceiling. Making the wrong lever visibly negative is the teaching. */
export default {
  id:'a-different-source',
  title:'syscall を増やしても見えない',
  order: 60,
  blurb:'syscall 経路は全段建っていて、ドロップは <b>0%</b>。ルールも falcoctl で追従している。'+
        'それでも <b>クラウド側の侵害だけ</b>が1段も鳴らない。',

  env:{ type:'managed-k8s', nodes:3 },

  /* a healthy, complete syscall pipeline — 07 プラグイン入力 is the only gap */
  start:{
    built:['driver','ring','state','rules','outputs','falcoctl'],
    tune:{},
    load:1.0,
    driver:'modern_ebpf',
    stack:'oss'
  },

  /* 全役: every wrong lever has to be within reach, or the misdiagnosis cannot
     be walked into. DRIVER is the platform role's and TUNING is the SRE's, so a
     locked role would quietly hide two of the three things to try. */
  player:{ side:'defense', role:null, lockRole:false },

  attack:{
    auto:true, response:false,
    waves:[
      { jp:'侵入と足場づくり',           steps:['exec','shadow','cron'] },
      { jp:'盗んだ資格情報でクラウドへ', steps:['dropbin','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'rules-are-split-by-event-source',
    wrong:'クラウドが鳴らないのは syscall 側が弱いからだ → syscall ルールを足す・'+
          '<code>base_syscalls: all</code>・ドライバ変更・バッファ増',
    truth:'<b>ルールはイベントソースで分割され、Falco はソース間の相関をしない。</b>'+
          '<code>aws_cloudtrail</code> は <code>ct.*</code> という<b>別のフィールド空間</b>を'+
          '持つ別ソースなので、クラウド API の操作は syscall ルールに<b>構造的に</b>'+
          'マッチし得ない。<b>量ではなく分割の問題</b>で、syscall 側をどれだけ強くしても '+
          '0 段のまま — <b>07 プラグイン入力</b>でそのソースを同じルールエンジンに'+
          '合流させる以外に道が無い（<code>all</code> は入力を増やして、'+
          '見えていた段までドロップで消す）。'
  },

  /* 6 = every step that comes, so the cloud step cannot be written off as the
     acceptable ceiling (it is one in 標準k8s ルール, and that is the contrast).
     The drop ceiling is what makes 「syscall を増やす」 cost something. */
  goal:{ detect:6, contain:false, maxAsks:null, maxDropPct:1 }
};
