/* ドロップ 0%・util も健全。それでも検知が1段落ちている街。
 *
 * The one scenario in the catalogue about the difference between a blind spot
 * you can measure and a blind spot you cannot.
 *
 * Every other drop scenario is visible: `syscall_event_drops` counts what the
 * ring buffer threw away, the HUD goes red, and the player has a number to
 * chase. This one has no number, because nothing is being dropped. The previous
 * SRE fought a load spike by hand-writing `base_syscalls.custom_set`, and to cut
 * volume in a mesh-heavy cluster they excluded the network syscalls with NEGATIVE
 * entries and turned `repair` off:
 *
 *   base_syscalls:
 *     custom_set: [execve, execveat, clone, clone3, fork, vfork,
 *                  open, openat, openat2,
 *                  !connect, !accept, !accept4]
 *     repair: false
 *
 * The spike is long gone. The entries stayed. Nothing drops, utilisation is
 * comfortable, every district is standing, the file-read rules still fire — they
 * were careful about the famous ones — and `Contact K8S API Server From
 * Container` can never fire again, because its condition is written on
 * `evt.type=connect` and `connect` is not being traced at all.
 *
 * That is the whole lesson, and it is a lesson about instruments rather than
 * about levers: a syscall that was never collected is not a dropped event. No
 * counter moves. There is nothing on the HUD that can point at it, so the
 * player reads a green dashboard and concludes the detection stack is fine.
 *
 * Three things this file is careful NOT to say, because the sources do not say
 * them (INVARIANTS.md §2):
 *
 *   - A POSITIVE custom_set does not do this. It is traced *in addition to the
 *     syscalls the enabled rules require*, so narrowing the set reduces inflow
 *     without taking coverage away (§2.1 / §2.3). That is why the openat family
 *     is listed positively here and costs nothing: only a `!syscall` entry
 *     deactivates a syscall that the ruleset uses (§2.4).
 *   - `repair: true` restores the minimal syscalls the state engine needs to stay
 *     consistent, and nothing more. It does NOT undo a deliberate exclusion, so
 *     turning it back on is a real fix for a real problem (§2.6) and still leaves
 *     the rule silent (§2.5). It is on purpose that the player can try it.
 *   - Which rule goes quiet is stated as a DEPENDENCY, never as an ordering:
 *     `Contact K8S API Server From Container` is `evt.type=connect and evt.dir=<
 *     and (fd.typechar=4 or fd.typechar=6) and container and k8s_api_server`, and
 *     it is a stable rule, so it is already loaded (§4.4). "which syscall dies
 *     first under pressure" is not a claim the docs support (§2.9).
 *
 * `!connect` is also the one exclusion that takes EXACTLY ONE step out of this
 * chain, which is what makes the symptom "検知が1段落ちている" rather than a
 * general collapse. exec and dropbin hang off execve, shadow and cron off the
 * open family, and cloud comes in through the plugin source — none of them go
 * through connect. Excluding the open family instead would take shadow AND cron,
 * because `open_read` and `open_write` are built on the same three syscalls
 * (§2.8), and the symptom would stop being one step.
 *
 * The way out on a real cluster is in the same blog post as the mechanism:
 * `-o log_level=debug -o log_stderr=true --dry-run` prints the final syscall set
 * at startup and warns when a heavy syscall has been excluded (§2.7). The blind
 * spot is not measurable at runtime, but it is enumerable before runtime — which
 * is the lesson said as an operational habit.
 */
export default {
  id:'silent-blind-spot',
  title:'測れない盲点',
  /* last, and it has to be last: every other scenario hands the player a number
     to chase. This one hands them a green dashboard. Measured: of the 13 single
     moves available in this seat, 11 are inert and exactly one clears it. */
  order:90,
  blurb:'ドロップ <b>0%</b>、util も健全、地区は全部建っている。'+
        'それでも検知が1段足りない。前任者が <code>base_syscalls</code> を手書きしている。',

  env:{ type:'self-managed-k8s', nodes:3 },

  start:{
    /* everything on the OSS detection side is already standing, on purpose: the
       symptom must not be attributable to a district that was never built */
    built:['driver','ring','state','rules','outputs','plugins','falcoctl'],

    /* the whole reason this scenario exists. The preset reads 'custom' because
       that is what the panel calls a hand-written base_syscalls; the negative
       entries are the part that costs coverage, and the positive ones cost
       nothing. `close` / `procexit` are deliberately absent so that
       repair:false is a real second problem and not decoration. */
    tune:{
      syscallSet:'custom',
      syscallCustom:['execve','execveat','clone','clone3','fork','vfork',
                     'open','openat','openat2',
                     '!connect','!accept','!accept4'],
      syscallRepair:false
    },

    load:1.0,                       /* the spike this was written for is over */
    driver:'modern_ebpf',
    stack:'oss'
  },

  /* the SRE is the right seat for this: the levers that made the blind spot are
     theirs, the HUD that hides it is theirs, and the rule that went quiet is
     somebody else's. Nothing here needs another team — this is not a
     coordination problem, it is a measurement problem. */
  player:{ side:'defense', role:'sre', lockRole:true },

  attack:{
    auto:true, response:false,
    waves:[
      { jp:'侵入と足場づくり',   steps:['exec','shadow','cron'] },
      { jp:'横展開とクラウドへ', steps:['dropbin','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'unmeasurable-blind-spot',
    wrong:'ドロップは 0%、util も健全 → 取りこぼしは起きていない。'+
          '鳴らないのは負荷かバッファのせいなので、<code>buf_size_preset</code> を上げてみる',
    truth:'<b>ドロップは計測できる。集めていない syscall は計測できない。</b>'+
          '<code>base_syscalls.custom_set</code> に <code>!connect</code> という'+
          '<b>負の指定</b>が残っていて、<code>evt.type=connect</code> で書かれたルールが'+
          '要求する syscall が<b>そもそもトレースされていない</b>。'+
          '落ちていないので <code>syscall_event_drops</code> のカウンタは1つも上がらず、'+
          'ドロップ率も util も健全なまま、ルールだけが一生鳴らない。'+
          '（正の <code>custom_set</code> は「有効なルールが要求する syscall に'+
          '<b>加えて</b>」トレースする集合なのでカバレッジを奪わない。盲点を作るのは'+
          '負の指定と <code>repair: false</code> の方。しかも <code>repair</code> が'+
          '戻すのは<b>状態エンジンの整合性だけ</b>で、意図して外したカバレッジは戻らない。）'+
          '実機では <code>--dry-run</code> ＋ <code>log_level=debug</code> で起動時に'+
          '最終集合を出して突き合わせる。<b>実行時に測れない盲点は、起動時に数える。</b>'
  },

  /* 6段すべて。黙っている1段を取り戻して、なおドロップを出さないこと。
     この負荷では負の指定を消してもドロップは 0% のままなので、「盲点を消すと
     ドロップが出る」というトレードオフはこの街には無い。ただし `all` まで
     広げると util 119% で 16% 落ちるので、上限は残しておく。 */
  goal:{ detect:6, contain:false, maxAsks:1, maxDropPct:1 }
};
