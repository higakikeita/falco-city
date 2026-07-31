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
 * And the third move — the one an operator who HAS read the troubleshooting page
 * would reach for — is inert too, which is the point this file is really for.
 * The Docs fight drops by raising `cpus_for_each_buffer` to 4–6: fewer, larger
 * buffers, less for the single consumer to poll (INVARIANTS 1.4, and note the
 * direction — lowering it to 1 makes things WORSE, not better). On a 2-vCPU node
 * that advice has nowhere to go. The buffer count is already 1, which is the
 * floor, so raising the knob from 2 to 4 changes ceil(2/2)=1 into ceil(2/4)=1 and
 * the drain side does not move at all. Lowering it to 1 gives ceil(2/1)=2 buffers
 * and costs capacity. The consumer knob is pinned before the player touches it,
 * so the only live lever left is the INPUT side: base_syscalls.
 *
 * Distinct from inherited-all-syscalls (#1) on purpose: there the inherited
 * mistake is `base_syscalls: all`, so the lever is already visibly wrong. Here
 * base_syscalls is at its default and nothing in falco.yaml looks touched — the
 * only thing that changed is the shape of the cluster. The fix is therefore one
 * step further along than #1's: not "put a wrong value back to default" but
 * "narrow a default that was never wrong until the node got smaller".
 */
export default {
  id:'nodes-are-not-buffers',
  title:'ノードを増やしたのに',
  /* second-to-last: this is the synthesis of the two drop scenarios before it.
     inherited-all-syscalls teaches the INFLOW half of util, slow-output teaches
     the CAPACITY half, and this one needs both plus the fact that the capacity
     knob can be pinned before you arrive. */
  order:80,
  /* the blurb has a 104px ceiling at the supported 1280×720 floor (ui.js §hint),
     so this says only what the player needs before touching anything */
  blurb:'ドロップを止めるためにノードを3台から6台に増やした。増設したのは安い 2 vCPU で、'+
        'Pod の詰め方は変えていない。<b>増やしたあとにドロップが出るようになった</b>。'+
        'falco.yaml は無変更。',

  /* 6 nodes, and the count is the whole red herring. `cpus` is the axis that
     actually decides anything here: 2 vCPUs at the default cpus_for_each_buffer
     of 2 is ceil(2/2) = ONE buffer, where the 8-vCPU nodes had four. */
  env:{ type:'self-managed-k8s', nodes:6, cpus:2 },

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
          '<code>buf_size_preset</code> を上げる、それでも駄目ならノードをもっと足す。'+
          'Docs に「<code>cpus_for_each_buffer</code> を上げろ」とあるので、それも上げてみる',
    truth:'リングバッファの本数は<b>ノード数ではなく、そのノードの CPU 数</b>で決まる — '+
          '<code>ceil(CPU数 ÷ cpus_for_each_buffer)</code>。既定は 2 なので '+
          '8 vCPU なら4本だが、<b>2 vCPU なら1本</b>。ノードを足して増えるのは DaemonSet の '+
          'Pod の数で、溢れているノードのバッファは1本も増えない。しかもこれは'+
          '<b>持続的な入力超過</b>（util &gt; 100%）なので、<code>buf_size_preset</code> は'+
          'バーストにしか効かない — 大きくしても埋まってから同じ割合を失う。'+
          'そして<b>消費側のつまみは、この 2 vCPU ノードでは既に振り切っている</b>: '+
          'ドロップ対策として Docs が勧めるのは <code>cpus_for_each_buffer</code> を'+
          '<b>4–6 に上げる</b>（バッファを少なく大きくする）方向だが、'+
          '<code>ceil(2÷2)</code> も <code>ceil(2÷4)</code> も<b>同じ1本</b>で、'+
          'これ以上減らせない。逆に 1 に下げると2本に増えて<b>悪化する</b>。'+
          'だから<b>効くレバーは入力側だけ</b> — '+
          '1ノードあたりの流入を <code>base_syscalls</code> の '+
          '<code>custom_set</code> で絞る、これ1つ。'
  },

  /* 4段すべて検知（過負荷が1段さらっていく）＋ドロップを 1% 以下に戻す。
     ノードを足しても buf を上げても cpus_for_each_buffer を動かしても、
     この2つはどちらも動かない。

     lockLoad は必須で、無いと成立しない: ×1.72 を ×0.5 に落とせば util は 1 を
     切ってドロップは消えるので、それが2つ目の正解になってしまう。だが NODE LOAD
     は治療ではなく、この安いノードが実際に背負っている量そのもの（schema.js
     §goal.lockLoad）。閉じると1手で解ける道は base_syscalls を絞る1つだけになり、
     insight.truth が「効くレバーは入力側だけ」と言っているとおりになる。 */
  goal:{ detect:4, contain:false, maxAsks:null, maxDropPct:1, lockLoad:true }
};
