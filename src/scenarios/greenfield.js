/* 空き地から建てる — the tutorial, and nothing more special than that.
 *
 * This used to be hardcoded as "campaign mode". It is now one scenario like any
 * other: the case where the person before you left nothing behind. Real
 * handovers are the other scenarios in this directory. See schema.js.
 *
 * Two things this file deliberately does NOT do:
 *
 *   - it does not teach a misdiagnosis. Its job is the SHAPE of the pipeline —
 *     what has to be built, in what order, and that three of the pieces are not
 *     on the flow at all. The insight below used to name the specific mistakes
 *     the later scenarios exist to make you walk into (a bigger buffer will not
 *     fix sustained overage / a blocked output drops events / a cloud step needs
 *     another source), which meant scenario 1 answered scenarios 2, 3 and 6
 *     before the player ever saw them. Diagnosis you have been told the answer to
 *     is not diagnosis.
 *   - it does not narrow the chain. Every step in the library arrives here,
 *     because this is the one place the whole picture is the lesson.
 *
 * The wave-2 step is `imds`, not `dropbin`. Both are in the library; the one that
 * belongs in the tutorial is the one that is NOT in the release package, because
 * "build the whole flow and you still miss a step" is the entire point of the
 * insight — and `Drop and execute new binary in container` is maturity_stable, so
 * it rings the moment the syscall path is standing (INVARIANTS 4.3). With `imds`
 * the progression the README records is exactly what happens: syscall path 4/7,
 * plus 07 プラグイン入力 5/7, plus 09 ルール配布 6/7, plus 08 Sysdig 7/7. */
export default {
  id:'greenfield',
  title:'空き地から建てる',
  /* first, and the only one that is construction rather than diagnosis */
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
      { jp:'資格情報とクラウド', steps:['imds','k8sapi','cloud'] }
    ]
  },

  /* the structure, and only the structure. Which lever fixes which failure is
     what the other eight scenarios are for — see the note at the top. */
  insight:{
    id:'the-flow-is-not-the-whole-pipeline',
    wrong:'syscall の流れを端まで建て終えれば、検知は完成している',
    truth:'流れ（02 ドライバ → 03 リングバッファ → 04 状態エンジン → 05 ルール → '+
          '06 出力）は<b>パイプラインの一部</b>でしかない。'+
          '流れの外に <b>07 プラグイン入力</b>・<b>09 ルール配布</b>・<b>08 Sysdig</b> の'+
          '3つがあり、これは順番に建てていけば通りかかるものではなく、'+
          '<b>別に足すと決めないと永久に無い</b>。'+
          '全段建ててから残る見逃しが、その3つがある理由。'
  },

  goal:{ detect:6, contain:true, maxAsks:null, maxDropPct:null }
};
