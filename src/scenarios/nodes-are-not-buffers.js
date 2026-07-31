/* ノードを3台から6台に増やしたら、ドロップが出るようになった。
 *
 * Misdiagnosis catalogue #7. The mistake is a units error: "ring buffer" gets
 * read as a cluster-wide resource, so scaling the cluster looks like scaling
 * the buffers. It is not. The buffer count is
 *
 *     ceil(nCPU / cpus_for_each_syscall_buffer)          modern_ebpf, default 2
 *
 * and nCPU is a property of ONE node. Adding nodes adds DaemonSet pods; the
 * node that is overflowing gets no new buffer out of it (falco.yaml
 * §engine.modern_ebpf + the DaemonSet install — INVARIANTS 3.6, two sources).
 *
 * The scale-out went to the cheaper 2-vCPU instance type, so on the new nodes
 * the default `cpus_for_each_syscall_buffer: 2` yields ceil(2/2) = 1 buffer
 * where the original 8-vCPU nodes had ceil(8/2) = 4. The node count went up and
 * the buffer count that decides whether this node keeps up went down. You are
 * standing on one of the new nodes.
 *
 * Both invited moves are inert, and for two different reasons:
 *
 *   buf_size_preset   this is sustained overage (util > 100%), so a bigger
 *                     buffer fills and then loses the same share. INVARIANTS 1.3
 *   more nodes        per-node inflow and per-node drain are what the drop model
 *                     is made of, and neither of them is a function of how many
 *                     nodes there are. Declaring 6 or 8 changes nothing.
 *
 * Distinct from inherited-all-syscalls (#1) on purpose: there the inherited
 * mistake is `base_syscalls: all`, so the lever is already visibly wrong. Here
 * base_syscalls is at its default and nothing in falco.yaml looks touched — the
 * only thing that changed is the shape of the cluster.
 */
export default {
  id:'nodes-are-not-buffers',
  title:'ノードを増やしたのに',
  order:70,
  /* the blurb has a 104px ceiling at the supported 1280×720 floor (ui.js §hint),
     so this says only what the player needs before touching anything */
  blurb:'ドロップを止めるためにノードを3台から6台に増やした。増設したのは安い 2 vCPU で、'+
        'Pod の詰め方は変えていない。<b>増やしたあとにドロップが出るようになった</b>。'+
        'falco.yaml は無変更。',

  /* 6 nodes, and the count is the whole red herring */
  env:{ type:'self-managed-k8s', nodes:6 },

  start:{
    built:['driver','ring','state','rules','outputs'],
    /* nothing is misconfigured. base_syscalls is at its default and
       cpus_for_each_syscall_buffer is at its default 2 — which on a 2-vCPU node
       means exactly one buffer. The defaults are the trap. */
    tune:{ syscallSet:'default', bufPreset:4, cpusPerBuf:2 },
    /* what one of the new, smaller nodes is actually carrying */
    load:1.72,
    driver:'modern_ebpf',
    stack:'oss'
  },

  /* the SRE owns TUNING, and TUNING is where both working levers are. DEPLOY is
     not yours — which is the point: the move the situation invites is on someone
     else's console, and it would not have helped. */
  player:{ side:'defense', role:'sre', lockRole:true },

  attack:{
    auto:true, response:false,
    waves:[
      { jp:'侵入と足場づくり', steps:['exec','shadow','cron'] },
      { jp:'権限の探索',       steps:['k8sapi'] }
    ]
  },

  insight:{
    id:'buffers-come-from-cpus-not-nodes',
    wrong:'ノードを増やしてもドロップが出る → バッファが足りない → '+
          '<code>buf_size_preset</code> を上げる、それでも駄目ならノードをもっと足す',
    truth:'リングバッファの本数は<b>ノード数ではなく、そのノードの CPU 数</b>で決まる — '+
          '<code>ceil(CPU数 ÷ cpus_for_each_syscall_buffer)</code>。既定は 2 なので '+
          '8 vCPU なら4本だが、<b>2 vCPU なら1本</b>。ノードを足して増えるのは DaemonSet の '+
          'Pod の数で、溢れているノードのバッファは1本も増えない。しかもこれは'+
          '<b>持続的な入力超過</b>（util &gt; 100%）なので、<code>buf_size_preset</code> は'+
          'バーストにしか効かない — 大きくしても埋まってから同じ割合を失う。'+
          '動くのは1ノードあたりの<b>入力</b>（<code>base_syscalls</code> を '+
          '<code>custom_set</code> に絞る）と、<code>cpus_for_each_syscall_buffer</code> が'+
          '決める<b>消費側</b>の2つだけ。'
  },

  /* 4段すべて検知（過負荷が1段さらっていく）＋ドロップを 1% 以下に戻す。
     ノードを足しても buf を上げても、この2つはどちらも動かない。 */
  goal:{ detect:4, contain:false, maxAsks:null, maxDropPct:1 }
};
