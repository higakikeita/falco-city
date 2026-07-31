/* 前任者が base_syscalls: all で置いていった。
 *
 * The reference example for an inherited state: the pipeline is already
 * standing, it is already dropping, and the lever that would fix it is not the
 * one the situation points at. You are the SRE, so the rules are not yours to
 * fix — asking is the only way, and the ask count is the bill. */
export default {
  id:'inherited-all-syscalls',
  title:'前任者の falco.yaml',
  /* the first scenario where the HUD says something, and the first drop scenario.
     It used to sit at 20 and it was measured as the most laborious of all of them
     (one tuning change plus three asks), which made the curve run downhill from
     scenario 2 onwards. It belongs here instead: the three asks only make sense
     once the player knows what 07 / 08 / 09 are, which is what 20–40 taught. */
  order:50,
  blurb:'syscall 経路は既に建っている。ただし <code>base_syscalls: all</code> で置いていかれた。'+
        'ドロップが出ているが、ルールは自分では触れない。',

  env:{ type:'self-managed-k8s', nodes:3 },

  start:{
    built:['driver','ring','state','rules','outputs'],
    tune:{ syscallSet:'all' },      /* the whole reason this scenario exists */
    load:1.0,
    driver:'modern_ebpf',
    stack:'oss'
  },

  /* fixed role: the point is that the fix for your problem may not be yours */
  player:{ side:'defense', role:'sre', lockRole:true },

  attack:{
    auto:true, response:true,
    waves:[
      { jp:'侵入と足場づくり',   steps:['exec','shadow','cron'] },
      { jp:'横展開とクラウドへ', steps:['dropbin','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'buffer-does-not-fix-sustained',
    wrong:'ドロップが出ている → <code>buf_size_preset</code> を上げれば直る',
    truth:'これは<b>持続的な入力超過</b>（util &gt; 100%）。失う割合は <code>1 - 消費能力/入力</code> で、'+
          'バッファをいくら大きくしても埋まってから同じ割合を失う。効くのは入力を減らすこと — '+
          '<code>base_syscalls</code> を <code>custom_set</code> に絞る。'
  },

  goal:{ detect:6, contain:true, maxAsks:3, maxDropPct:1 }
};
