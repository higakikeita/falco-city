/* syscall 量は普通なのにドロップしている。詰まっているのは出口。
 *
 * The reference example for a drop that is NOT an input problem. Every other
 * dropping scenario hands you a swollen numerator — base_syscalls: all, or a
 * load spike — and the fix is upstream. This one hands you a pristine input
 * side (load ×1.0, base_syscalls: default, buf_size_preset at the 8 MiB
 * default) and a halved denominator, because the output channel is a
 * synchronous program/HTTP write and the event loop stops while it blocks.
 *
 * So the diagnosis the player has to reach is a division, not a lever:
 * utilisation is above 100% at NORMAL input, therefore the term that moved is
 * capacity. INVARIANTS 1.5 is the causality (a blocked output stalls the loop
 * and the ring fills behind it); INVARIANTS 1.3 is why the obvious lever is a
 * dead end (buf_size_preset absorbs bursts and does nothing for a sustained
 * overrun — the `sustained` term does not read bufPreset at all).
 *
 * The player is the SRE on purpose. The drop is unambiguously on their desk,
 * nothing is missing from the city, and the lever that fixes it is already in
 * their own panel — one row below the one they will reach for first. There is
 * nobody to ask, which is why goal.maxAsks is 0. */
export default {
  id:'slow-output',
  title:'負荷は普通なのに落ちる',
  order: 25,
  blurb:'街は全部建っている。負荷は <b>×1.0</b>、<code>base_syscalls</code> も <code>default</code>。'+
        'それでもドロップが出て、1段見逃している。',

  env:{ type:'self-managed-k8s', nodes:3 },

  start:{
    /* everything except 08 Sysdig is standing: nothing is missing, so the
       pipeline cannot be what is wrong. 09 falcoctl and 07 plugins are here
       so that all six steps are detectable and the drop is the only thing
       that can take one away. */
    built:['driver','ring','state','rules','outputs','plugins','falcoctl'],
    tune:{ slowOutput:true },       /* the whole reason this scenario exists */
    load:1.0,                       /* normal. This is the evidence, not the cause */
    driver:'modern_ebpf',           /* the best one, so the driver is not a suspect */
    stack:'oss'
  },

  /* fixed role: the ring buffer and every falco.yaml lever are the SRE's, so
     this one is theirs end to end — including the part that is not the buffer */
  player:{ side:'defense', role:'sre', lockRole:true },

  attack:{
    auto:true, response:false,
    waves:[
      { jp:'侵入と足場づくり',   steps:['exec','shadow','cron'] },
      { jp:'横展開とクラウドへ', steps:['dropbin','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'slow-output-halves-drain',
    wrong:'ドロップが出ている → 負荷が高いか、バッファが小さい。'+
          '<code>buf_size_preset</code> を上げれば直る',
    truth:'入力は普通のままで util が 100% を超えている。<b>動いたのは分母（消費能力）の側</b>。'+
          '出力が<b>同期の program / http</b> で、書き込みでブロックしている間イベントループが止まり、'+
          'その裏でリングバッファが埋まる。<code>buf_size_preset</code> は<b>バースト</b>にしか効かない。'+
          '効くのは<b>出力を非同期にすること</b>（実機では <code>outputs_queue.capacity</code>）。'
  },

  /* 6/6 with the output fixed, 5/6 while it is blocked. maxAsks 0 because
     nothing is missing — if you are asking another team, you have misread it. */
  goal:{ detect:6, contain:false, maxAsks:0, maxDropPct:1 }
};
