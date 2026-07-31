/* POLICIES — the detection layer's levers, and the gates a rule has to pass.
 *
 * `base_syscalls` is the KERNEL layer's trade-off: widen it and the ring buffer
 * drops, narrow it and you get a blind spot nothing can measure. Policy is the
 * SAME SHAPE one layer up — widen it and the real alert drowns in the queue,
 * narrow it and you miss. And the levers have DIFFERENT OWNERS:
 *
 *   base_syscalls   SRE              widen -> drops        narrow -> blind spot
 *   policy          detection eng.   widen -> buried       narrow -> missed
 *
 * The hole is not inside either team. It is on the seam (GAME-DESIGN §4④), and
 * that is what the role layer exists to show.
 *
 * ---------------------------------------------------------------- the invariant
 * WIDENING THE POLICY CANNOT MAKE A RULE FIRE WHOSE SYSCALL IS NOT TRACED.
 * The detection layer and the kernel layer are INDEPENDENT gates (§GATES,
 * INVARIANTS 2.1 / 2.4), so "I enabled every ruleset and it still does not ring"
 * is a state this model can produce. gatesFailed() returns ALL of them rather
 * than the first, because the whole point is that closing one changes nothing
 * while another is shut.
 *
 * SECOND INVARIANT: adding Sysdig adds no detection (INVARIANTS 5.1 / 5.2,
 * pinned by npm test). It is structural here, not asserted: nothing on the
 * detection path reads `ctx.stack`, and §MANAGED_POLICIES carries no rule
 * content at all — only response, retention and correlation. See §sysdig.
 *
 * ---------------------------------------------------------------- purity
 * PURE DATA + PURE FUNCTIONS. No functions in the data, no closures, no THREE,
 * no DOM, no imports. Everything survives JSON round-tripping, and every
 * player-facing sentence lives in the data (`jp`, `why`, `gain`, `cost`) so a
 * Unity port or an English build is a data edit (src/scenarios/schema.js
 * §purity).
 *
 * ---------------------------------------------------------------- one to add one
 * A rule is one entry in RULE_FACTS. A tier is one entry in MATURITY_TIERS. A
 * response action is one entry in RESPONSE_ACTIONS. Nothing counts entries and
 * nothing indexes them positionally.
 *
 * ---------------------------------------------------------------- what is here
 * that was nowhere before: RULE_FACTS is the DOM-free home for the rule
 * maturity / priority facts that src/log.js and src/campaign.js currently each
 * hold a copy of (BOARD #25 asked for exactly this file). Both can read it — it
 * imports nothing, so it closes no import cycle. Until they do, the facts below
 * are the sourced ones and the copies are the derived ones.
 */

/* ---------------------------------------------------------------- totality
   THIS MODULE NEVER THROWS. It returns an answer, or an empty one.
   Contract §1: a bad input is an error VALUE, not an exception. Fuzzing the
   eight files found the same shape in all of them — a collection argument that
   was not a collection. `str()` absorbs Symbol, which `String()` throws on. */
const arr = v => Array.isArray(v) ? v : [];
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const num = (v, d = 0) => Number.isFinite(v) ? v : d;
const str = v => typeof v === 'string' ? v
               : (v == null || typeof v === 'symbol') ? '' : String(v);

/* ---------------------------------------------------------------- maturity
   Three files, and file maps 1:1 to maturity. Only the stable set is loaded by
   default; incubating and sandbox are SEPARATE OCI ARTIFACTS you have to fetch,
   which is what 09 ルール配布 (falcoctl) is for.

     rules     how many rules the file holds. Counted 2026-07-31 against
               falcosecurity/rules main. NOT a fixed claim: the upstream repo
               grows, which is why the artifacts are versioned — treat the
               number as the size of the choice, not as a constant
     artifact  the OCI artifact name, and the tag as the Helm example shows it
     bundled   ships inside the Falco release package                          */
const MATURITIES = [
  { id:'stable', jp:'stable', file:'falco_rules.yaml',
    artifact:'falco-rules', tag:'3', rules:25, bundled:true,
    why:'リリースパッケージに同梱されるのはこれだけ。'+
        '「Falco の既定ルールは思ったより少ない」と感じるのはこれが理由',
    src:['https://falco.org/docs/reference/rules/default-rules/',
         'https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  { id:'incubating', jp:'incubating', file:'falco-incubating_rules.yaml',
    artifact:'falco-incubating-rules', tag:'4', rules:31, bundled:false,
    why:'一定の堅牢性はあるが用途がより限定的。別のアーティファクトとして取得する',
    src:['https://falco.org/docs/reference/rules/default-rules/',
         'https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml'] },
  { id:'sandbox', jp:'sandbox', file:'falco-sandbox_rules.yaml',
    artifact:'falco-sandbox-rules', tag:'4', rules:37, bundled:false,
    why:'より実験的。誤検知をどこまで引き受けるかの判断になる',
    src:['https://falco.org/docs/reference/rules/default-rules/',
         'https://github.com/falcosecurity/rules/blob/main/rules/falco-sandbox_rules.yaml'] },
  /* documented as a maturity level and deliberately not a tier below: nobody
     chooses to load deprecated rules, so it is a fact and not a lever */
  { id:'deprecated', jp:'deprecated', file:null,
    artifact:null, tag:null, rules:null, bundled:false,
    why:'非推奨。成熟度としては文書化されているが、選ぶものではない',
    src:['https://falco.org/docs/reference/rules/default-rules/'] }
];

/* ---------------------------------------------------------------- tier lever
   THE HEADLINE POLICY LEVER. Three positions, and each one moves detection and
   noise IN THE SAME DIRECTION — that is the trade-off, and it is why "load
   everything" is not the answer.

     includes    which maturities are loaded
     rules       how many rules that is, summed from MATURITIES
     noiseMul    multiplier on the alert volume reaching the SOC queue.
                 ILLUSTRATIVE numbers, anchored so that the widest position
                 equals the engine's existing SOC.follow (state.js §SOC = 1.55)
                 — following both artifacts is what that constant already meant,
                 so this lever refines it instead of contradicting it
     needsArtifact  true = falcoctl has to be standing AND working, or the rules
                 are simply not on the node. Having a policy is not having a rule
     lower       the Falco version this position first exists on
                 (versions.js §CAPABILITIES rule_maturity = 0.36.0)             */
const MATURITY_TIERS = [
  { id:'stable-only', jp:'stable のみ', includes:['stable'],
    noiseMul:1.00, needsArtifact:false, lower:'0.36.0',
    gain:'既定のまま。誤検知は最小',
    cost:'incubating / sandbox にしか無い検知は<b>持っていない</b>。'+
         '持っていないルールは鳴らない' },
  { id:'plus-incubating', jp:'＋ incubating', includes:['stable','incubating'],
    noiseMul:1.30, needsArtifact:true, lower:'0.36.0',
    gain:'IMDS からの資格情報窃取など、'+
         '<b>incubating にしか無い検知</b>が手に入る',
    cost:'アラート量が増える。<b>本物が埋もれる圧が上がる</b>' },
  { id:'plus-sandbox', jp:'＋ sandbox', includes:['stable','incubating','sandbox'],
    noiseMul:1.55, needsArtifact:true, lower:'0.36.0',
    gain:'<code>Write below etc</code> やクリプトマイナー検知まで全部載る',
    cost:'<b>実験的なルールの誤検知を全部引き受ける。</b>'+
         'SOC のキューが溢れれば、増やした検知そのものが埋もれる' }
];

/* ---------------------------------------------------------------- priority
   The threshold is not an output filter. falco.yaml: "Any rule with a priority
   level more severe than or equal to the specified minimum level will be LOADED
   AND RUN by Falco" — so narrowing it stops the rule being loaded at all, and
   therefore also removes what that rule was asking base_syscalls for
   (INVARIANTS 2.1: the traced set is the union of the base set and what the
   LOADED rules require). That is the one place the two layers touch, and the
   direction is the harmless one: narrowing the policy narrows the traced set.
   It never makes an untraced syscall appear.

     rank    0 = most severe. The threshold keeps rank <= its own
     share   ILLUSTRATIVE share of alert VOLUME this band contributes. The claim
             is the shape — the low bands are the bulk, which is why cutting at
             `critical` quietens almost everything and loses almost everything
     yaml    the spelling falco.yaml accepts                                   */
const PRIORITIES = [
  { id:'emergency', yaml:'emergency', jp:'Emergency', rank:0, share:0.00 },
  { id:'alert',     yaml:'alert',     jp:'Alert',     rank:1, share:0.00 },
  { id:'critical',  yaml:'critical',  jp:'Critical',  rank:2, share:0.04 },
  { id:'error',     yaml:'error',     jp:'Error',     rank:3, share:0.08 },
  { id:'warning',   yaml:'warning',   jp:'Warning',   rank:4, share:0.18 },
  { id:'notice',    yaml:'notice',    jp:'Notice',    rank:5, share:0.40 },
  { id:'info',      yaml:'info',      jp:'Informational', rank:6, share:0.22 },
  { id:'debug',     yaml:'debug',     jp:'Debug',     rank:7, share:0.08 }
];
const PRIORITY_DEFAULT = 'debug';     // falco.yaml default: everything loads
const PRIORITY_SRC = ['https://github.com/falcosecurity/falco/blob/master/falco.yaml'];

/* ---------------------------------------------------------------- rules
   THE FACTS, ONCE. Which file a rule ships in (= its maturity), what priority
   it carries, which event source it belongs to, and which syscalls its condition
   can match on.

     maturity   'stable' | 'incubating' | 'sandbox' | null for plugin rulesets,
                which are distributed with their plugin and not by maturity
     priority   as written in the rules file
     source     'syscall' | 'k8saudit' | 'cloudtrail' | 'okta' | 'github'.
                A plugin source carries no syscalls, so no base_syscalls entry
                can reach it (INVARIANTS 3.9)
     needsSyscalls  the syscalls the condition is written on. The rule goes
                silent only when EVERY one of them is negated — `evt.type in
                (open, openat, openat2)` still fires while one survives. null =
                not declared here, so the syscall gate cannot judge it, and this
                model will not guess (INVARIANTS 2.9: dependency, never ordering)
     needsFields  named fields the condition reads. When a version turns one of
                these into `<NA>` the rule is loaded, evaluated, and silent
                (versions.js §naFieldsAt)
     step       the CHAIN step id in campaign.js this rule is the detection for,
                where there is one
     src        the primary source for the maturity and priority. EMPTY MEANS
                UNSOURCED — taken from this repo's own console table, illustrative
                only. unsourcedRules() lists them so they can never hide         */
const RULE_FACTS = [
  /* ---- stable: falco_rules.yaml (verified 2026-07-31) ---- */
  { name:'Terminal shell in container', maturity:'stable', priority:'notice',
    source:'syscall', needsSyscalls:['execve','execveat'], needsFields:[],
    step:'exec', src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  { name:'Read sensitive file untrusted', maturity:'stable', priority:'warning',
    source:'syscall', needsSyscalls:['open','openat','openat2'], needsFields:[],
    step:'shadow', src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  { name:'Drop and execute new binary in container', maturity:'stable', priority:'critical',
    source:'syscall', needsSyscalls:['execve','execveat'], needsFields:[],
    step:'dropbin', src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  { name:'Contact K8S API Server From Container', maturity:'stable', priority:'notice',
    source:'syscall', needsSyscalls:['connect'], needsFields:[],
    step:'k8sapi', src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  { name:'Packet socket created in container', maturity:'stable', priority:'notice',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  { name:'Redirect STDOUT/STDIN to Network Connection in Container',
    maturity:'stable', priority:'notice',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  { name:'Search Private Keys or Passwords', maturity:'stable', priority:'warning',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  /* src/log.js tags this one `incubating`, self-declared with no source (BOARD
     #6 asked for it to be pinned). falco_rules.yaml has it: STABLE, WARNING. */
  { name:'Clear Log Activities', maturity:'stable', priority:'warning',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },
  { name:'Fileless execution via memfd_create', maturity:'stable', priority:'critical',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml'] },

  /* ---- incubating: falco-incubating_rules.yaml (verified 2026-07-31) ---- */
  { name:'Contact EC2 Instance Metadata Service From Container',
    maturity:'incubating', priority:'notice',
    source:'syscall', needsSyscalls:['connect','sendto','sendmsg'], needsFields:[],
    step:'imds',
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml'] },
  { name:'Change thread namespace', maturity:'incubating', priority:'notice',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml'] },
  { name:'Non sudo setuid', maturity:'incubating', priority:'notice',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml'] },
  /* src/log.js prints this with no maturity tag, i.e. as stable. It is
     INCUBATING, and INFO — so it is also the first rule a priority threshold
     silences. Two gates on one rule, which makes it a useful teaching case. */
  { name:'Launch Privileged Container', maturity:'incubating', priority:'info',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml'] },
  { name:'Exfiltrating Artifacts via Kubernetes Control Plane',
    maturity:'incubating', priority:'notice',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml'] },
  { name:'Backdoored library loaded into SSHD (CVE-2024-3094)',
    maturity:'incubating', priority:'warning',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml'] },

  /* ---- sandbox: falco-sandbox_rules.yaml (verified 2026-07-31) ---- */
  { name:'Write below etc', maturity:'sandbox', priority:'error',
    source:'syscall', needsSyscalls:['open','openat','openat2'], needsFields:[],
    step:'cron',
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-sandbox_rules.yaml'] },
  { name:'Detect crypto miners using the Stratum protocol',
    maturity:'sandbox', priority:'critical',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-sandbox_rules.yaml'] },
  /* src/log.js prints this with no tag as well. It is SANDBOX, CRITICAL. */
  { name:'Sudo Potential Privilege Escalation', maturity:'sandbox', priority:'critical',
    source:'syscall', needsSyscalls:null, needsFields:[], step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-sandbox_rules.yaml'] },
  { name:'Container Drift Detected (open+create)', maturity:'sandbox', priority:'error',
    source:'syscall', needsSyscalls:['open','openat','openat2'], needsFields:[],
    step:null,
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco-sandbox_rules.yaml'] },

  /* ---- plugin rulesets: distributed with the plugin, not by maturity ----
     Priorities here are this repo's own (src/log.js), NOT upstream-verified:
     `src` is empty and unsourcedRules() reports them. */
  { name:'Console Login Without MFA', maturity:null, priority:'warning',
    source:'cloudtrail', needsSyscalls:[], needsFields:[], step:'cloud', src:[] },
  { name:'Delete Bucket Encryption', maturity:null, priority:'critical',
    source:'cloudtrail', needsSyscalls:[], needsFields:[], step:'cloud', src:[] },
  { name:'K8s Secret Get Successfully', maturity:null, priority:'warning',
    source:'k8saudit', needsSyscalls:[], needsFields:[], step:null, src:[] },
  { name:'Create Privileged Pod', maturity:null, priority:'critical',
    source:'k8saudit', needsSyscalls:[], needsFields:[], step:null, src:[] },

  /* ---- rules people write themselves ----
     The deprecated k8s.* workload-name family never appears in the official
     rulesets — it appears in the exceptions and scoping people write for their
     own estate ("allow this for that deployment"). Which is exactly why Falco
     0.37 hurts quietly: no upstream rule broke, YOUR rules did
     (versions.js §k8s-workload-fields-na). */
  { name:'Allowed writer for this deployment (custom)', custom:true,
    maturity:'stable', priority:'warning',
    source:'syscall', needsSyscalls:['open','openat','openat2'],
    needsFields:['k8s.deployment.name'], step:null, src:[],
    why:'ワークロード名で例外を書いたルール。'+
        '<b>0.37 以降はフィールドが <NA> になるので、例外が外れて誤検知になる</b>か、'+
        '条件そのものが成立しなくなる' },
  { name:'Service-scoped detection (custom)', custom:true,
    maturity:'stable', priority:'notice',
    source:'syscall', needsSyscalls:['connect'],
    needsFields:['k8s.svc.name'], step:null, src:[],
    why:'サービス名でスコープした自前ルール。<b>黙って鳴らなくなる</b>' }
];

/* ---------------------------------------------------------------- response
   Detection and response are different components (INVARIANTS 5.1). OSS Falco is
   the eye; the hand is somewhere else, and if you did not build it, it does not
   exist. That is the §1 手数 of DESIGN-freeplay-flow made into a lever.

     stops     does this actually interrupt the attack
     oss       what the OSS side has to stand up to have it. null = nothing can
     sysdig    comes with the platform
     needs     district ids that must be built AND working (campaign.js
               §working) for this action to be real                            */
const RESPONSE_ACTIONS = [
  { id:'notify', jp:'通知のみ', stops:false,
    oss:'falcosidekick', sysdig:true, needs:['outputs'],
    why:'アラートが人に届くだけ。<b>攻撃は続いている</b>',
    src:['https://github.com/falcosecurity/falco-talon'] },
  { id:'capture', jp:'キャプチャを取る', stops:false,
    oss:'自分で仕込む', sysdig:true, needs:['outputs'],
    why:'イベント周辺を保存して後から見られる。'+
        'Falco 0.42 以降は検知時のキャプチャが本体にある（versions.js '+
        '§capture_on_detect）。Sysdig 側はイベント前後の秒数を指定できる',
    src:['https://falco.org/blog/falco-0-42-0/',
         'https://docs.sysdig.com/en/sysdig-secure/response-actions/'] },
  { id:'pause', jp:'コンテナを一時停止する', stops:true,
    oss:'Falco Talon', sysdig:true, needs:['outputs','sysdig'],
    why:'指定したコンテナの全プロセスを止める。'+
        '<b>OSS 自前なら Talon 相当を自分で建てないと存在しない</b>',
    src:['https://docs.sysdig.com/en/sysdig-secure/response-actions/',
         'https://github.com/falcosecurity/falco-talon'] },
  { id:'stop', jp:'コンテナを止める（猶予あり）', stops:true,
    oss:'Falco Talon', sysdig:true, needs:['outputs','sysdig'],
    why:'10秒の猶予を与えてから落とす',
    src:['https://docs.sysdig.com/en/sysdig-secure/response-actions/'] },
  { id:'kill', jp:'コンテナを即座に kill する', stops:true,
    oss:'Falco Talon', sysdig:true, needs:['outputs','sysdig'],
    why:'即座に落とす。<b>止める手は目とは別の部品</b>',
    src:['https://docs.sysdig.com/en/sysdig-secure/response-actions/'] }
];

/* ---------------------------------------------------------------- §sysdig
   Sysdig's managed policies. THE INVARIANT IS STRUCTURAL: there is no `rules`
   field on any entry below, and no function in this file reads `ctx.stack` when
   deciding whether something rings. Adding Sysdig cannot add a detection
   because there is nothing here that could (INVARIANTS 5.2, pinned by npm test).

   What it does change is the operating burden and what happens after the alert:

     ops       how much of the ruleset upkeep is carried for you, 0..1
     retain    history / search / activity audit exists
     correlate cross-source correlation. Falco does not do it (INVARIANTS 3.9)
     inUse     which published vulnerabilities are actually loaded at runtime.
               Not more detection — a different ORDER to fix things in
     response  which RESPONSE_ACTIONS ids come with it

   Managed policies are created by Sysdig, exist in every account, and their
   names cannot be changed or deleted — so they are a bundle you switch on, not
   content you author. */
const MANAGED_POLICIES = [
  { id:'none', jp:'マネージドポリシーを使わない',
    ops:0.0, retain:false, correlate:false, inUse:false, response:[],
    why:'自分で書いたポリシーだけ。OSS 自前と同じ手数',
    src:[] },
  { id:'runtime-threat-detection', jp:'Sysdig Runtime Threat Detection',
    ops:0.8, retain:true, correlate:true, inUse:false, response:['notify','capture'],
    why:'Sysdig が保守するポリシー束が降りてくる。'+
        '<b>検知は1段も増えない</b> — 増えるのは維持を代わりにやってもらう度合いと、'+
        '鳴ったあとに見えるもの',
    src:['https://docs.sysdig.com/en/sysdig-secure/manage-threat-detection-policies/'] },
  { id:'runtime-threat-detection-response',
    jp:'Sysdig Runtime Threat Detection ＋ 応答アクション',
    ops:0.8, retain:true, correlate:true, inUse:true,
    response:['notify','capture','pause','stop','kill'],
    why:'上に応答アクションが付く。<b>ここで初めて「止まる」</b>。'+
        'in-use 脆弱性相関も入るので、塞ぐ順が決まる',
    src:['https://docs.sysdig.com/en/sysdig-secure/response-actions/'] }
];
/* what adding Sysdig changes, as data. `detection: 0` is not a tuning value; it
   is the invariant, written where a reader will trip over it. */
const SYSDIG_DELTA = { detection:0, response:true, retain:true, correlate:true,
                       inUse:true, ops:0.8,
                       why:'検知は同じ libs・同じルールエンジン。'+
                           '<b>差がつくのは鳴ったあと</b>' };

/* ---------------------------------------------------------------- drops
   syscall_event_drops.actions. Already a tuning lever (state.js §TUNE_DEFAULTS
   .dropAction) — declared here because it is a POLICY about what to do when the
   kernel layer fails, and the two ends of it are the two ways to lose:

     exit     detection really goes to zero. Loud, and total
     ignore   you go blind and nothing says so

   `audit` is whether an estate that has to prove it was watching can pick this.
   The archetype layer (src/archetypes.js) decides who is forbidden what; this
   only says which options are honest about themselves. */
const DROP_ACTIONS = [
  { id:'ignore', jp:'ignore', stopsAgent:false, silent:true, audit:false,
    why:'<b>黙って盲目になる。</b>落ちていることが記録にも残らない' },
  { id:'log', jp:'log', stopsAgent:false, silent:false, audit:true,
    why:'落ちた件数がログに出る' },
  { id:'alert', jp:'alert', stopsAgent:false, silent:false, audit:true,
    why:'Falco 自身のアラートとして上がる。既定は log と alert の両方' },
  { id:'exit', jp:'exit', stopsAgent:true, silent:false, audit:true,
    why:'<b>エージェントが止まる = 検知がゼロになる。</b>'+
        '落ちていることを隠さない代わりに、何も見なくなる' }
];
const DROP_ACTIONS_SRC = ['https://github.com/falcosecurity/falco/blob/master/falco.yaml'];

/* ---------------------------------------------------------------- gates
   FIVE INDEPENDENT GATES, in the order an event meets them. All five have to
   pass. Any one of them, alone, produces silence — and the silence looks the
   same from the HUD, which is the whole lesson.

     layer    which team's decision this gate belongs to
     silent   true = nothing counts it. No counter moves                        */
const GATES = [
  { id:'have', layer:'detect', silent:true,
    jp:'そのルールを持っているか',
    why:'成熟度で選んでいない、あるいは falcoctl が取得していない。'+
        '<b>持っていないルールは鳴らない</b>' },
  { id:'loaded', layer:'detect', silent:true,
    jp:'priority のしきい値を超えているか',
    why:'しきい値未満のルールは<b>読み込まれない</b>（出力が絞られるのではない）' },
  { id:'traced', layer:'sre', silent:true,
    jp:'そのルールが要求する syscall を集めているか',
    why:'<b>カーネル層の関門。</b> <code>base_syscalls</code> に負の指定があれば、'+
        'ポリシーを全部入れても鳴らない。落ちていないのでドロップ率も健全なまま' },
  { id:'field', layer:'platform', silent:true,
    jp:'条件が読むフィールドが値を返すか',
    why:'<b>バージョン層の関門。</b> 0.37 以降 <code>k8s.deployment.name</code> 系は '+
        '<NA> を返すので、ルールは評価されて成立しない（versions.js §naFieldsAt）' },
  { id:'path', layer:'platform', silent:false,
    jp:'イベントの経路と届け先があるか',
    why:'ドライバ・リングバッファ・ルールエンジン・出力、そのソースの入力。'+
        '建っていない段は campaign.js が採点する' }
];

/* ---------------------------------------------------------------- §CLAIMS
   Same register index as versions.js §CLAIMS, and the same three states:

     registered  INVARIANTS.md holds it, so npm test notices when the model drifts
     weak        the register says more than its citation does. Unfixed here
     verified    a primary source says it; the register does not carry it yet

   The tier lever itself rests on a REGISTERED claim (INVARIANTS 4.1: the three
   files, 1:1 with maturity, stable-only bundled), which is why this file was not
   affected by the interruption that hit versions.js. What is NOT registered is
   the per-rule detail underneath it — priorities, and which file three specific
   rules actually live in. Those are on BOARD §2 as D6 / D7.

   src/versions.js exports the same five names for this mechanism. A module that
   imports both must alias one set:
   `import { CLAIMS as VERSION_CLAIMS, isFixed as versionFactFixed } from './versions.js'`. */
const CLAIMS = [
  { id:'maturity-files-1to1', invariant:'4.1', status:'registered',
    jp:'成熟度は3ファイルと 1:1、同梱は stable のみ（stable 25 / incubating 31 / sandbox 37）',
    covers:['stable','incubating','sandbox',
            'stable-only','plus-incubating','plus-sandbox'],
    src:['https://falco.org/docs/reference/rules/default-rules/'] },
  { id:'sysdig-adds-no-detection', invariant:'5.2', status:'registered',
    jp:'Sysdig を足しても検知は1段も増えない',
    covers:['none','runtime-threat-detection','runtime-threat-detection-response'],
    src:['https://github.com/falcosecurity/falco-talon'] },
  { id:'detection-and-response-are-separate', invariant:'5.1', status:'registered',
    jp:'検知と応答は別の部品。OSS は目で、止める手は別',
    covers:['notify','capture','pause','stop','kill'],
    src:['https://github.com/falcosecurity/falco-talon',
         'https://docs.sysdig.com/en/sysdig-secure/response-actions/'] },
  { id:'drop-actions', invariant:'1.6', status:'registered',
    jp:'syscall_event_drops.actions は ignore / log / alert / exit。exit は検知をゼロにする',
    covers:['ignore','log','alert','exit'],
    src:['https://github.com/falcosecurity/falco/blob/master/falco.yaml'] },
  { id:'kernel-and-detection-gates-are-independent', invariant:'2.1 / 2.4',
    status:'registered',
    jp:'ポリシーを広げても、負の指定で無効化された syscall は戻らない',
    covers:['have','traced'],
    src:['https://falco.org/blog/adaptive-syscalls-selection/'] },
  /* falco.yaml の priority コメントは「読み込んで実行する（loaded and run）」と
     書いている。出力を絞るのではなく**ルールが読み込まれない**ので、絞ると
     base_syscalls の union 側の入力も減る。INVARIANTS に無い。BOARD §2 D6。 */
  { id:'priority-threshold-loads', invariant:null, status:'verified',
    jp:'priority しきい値は出力フィルタではなく、ルールを読み込むかどうかを決める',
    covers:['loaded'],
    src:['https://github.com/falcosecurity/falco/blob/master/falco.yaml'] },
  /* 個々のルールの priority と、log.js が付けている成熟度タグの3件の誤り。
     一次資料は3つの rules ファイルそのもの。BOARD §2 D7。 */
  { id:'per-rule-priority-and-maturity', invariant:null, status:'verified',
    jp:'各ルールの priority と、どのファイルに入っているか',
    covers:RULE_FACTS.filter(r => r.src && r.src.length).map(r => r.name),
    src:['https://github.com/falcosecurity/rules/blob/main/rules/falco_rules.yaml',
         'https://github.com/falcosecurity/rules/blob/main/rules/falco-incubating_rules.yaml',
         'https://github.com/falcosecurity/rules/blob/main/rules/falco-sandbox_rules.yaml'] },
  { id:'field-gate-is-a-version-fact', invariant:'3.7', status:'registered',
    jp:'0.37 以降 旧 k8s.* は <NA> を返すので、それを読むルールは黙って成立しない',
    covers:['field'],
    src:['https://falco.org/blog/falco-0-37-0/'] }
];

/* the policy you are handed if nothing says otherwise: the Falco default. Only
   stable is loaded, every priority is loaded, notification exists and nothing
   stops the attack. `dropAction` matches state.js §TUNE_DEFAULTS. */
const POLICY_DEFAULT = { maturity:'stable-only', minPriority:'debug',
                         response:'notify', managed:'none', dropAction:'alert' };

/* ---------------------------------------------------------------- §LEVERS
   WIDEN → / NARROW →, FOR EVERY POLICY LEVER.

   GATE-FREEPLAY V2 wants the consequence of a choice readable BEFORE it is made,
   and the screen lane asked for exactly this shape (BOARD §2 #S7): each lever
   with its two directions and what each one costs. It is GAME-DESIGN §4 ④'s table
   turned into data.

   THE POINT OF THE TABLE IS THAT BOTH DIRECTIONS LOSE. If one direction were
   simply better the lever would not be a decision, and 「全部入れて全部鳴らす」
   would be the answer — which is the one thing this design denies. So every
   entry below has a real cost on both sides.

     owner     whose decision this is (campaign.js §ROLES). The hole shows up on
               the SEAM between owners, which is why the owner is on the lever
     wider     what widening buys, and what it costs
     narrower  what narrowing buys, and what it costs
     measured  the numbers behind it, re-measured by cases-data.mjs

   `base_syscalls` is in this table even though it is the SRE's lever and lives in
   state.js §TUNE_DEFAULTS, because the whole lesson is that it is the SAME SHAPE
   one layer down with a DIFFERENT OWNER. Leaving it out would hide the seam. */
const LEVERS = [
  { id:'maturity', jp:'ルールセットの成熟度', owner:'detect',
    key:'maturity', values:MATURITY_TIERS.map(t => t.id),
    wider:{ jp:'incubating / sandbox も追従する',
            gain:'<b>その集合にしか無い検知が手に入る</b>（IMDS からの資格情報窃取など）',
            cost:'<b>アラート量が増え、本物が埋もれる圧が上がる</b>。'+
                 '実験的なルールの誤検知を全部引き受けることになる' },
    narrower:{ jp:'stable だけにする',
            gain:'誤検知が最小。SOC のキューが空く',
            cost:'<b>持っていないルールは鳴らない。</b>'+
                 'incubating / sandbox にしか無い検知は最初から無い' },
    measured:{ rules:{ 'stable-only':25, 'plus-incubating':56, 'plus-sandbox':93 },
               buriedPct:{ following:34.84, notFollowing:2.38 },
               alertsPerMin:{ following:61.4, notFollowing:41.0 } },
    why:'広げると検知が増え、**同時に**埋没率が上がります。'+
        'どちらも増えるので、これは損得ではなく<b>どちらで負けるかの選択</b>です。' },

  { id:'minPriority', jp:'priority のしきい値', owner:'detect',
    key:'minPriority', values:PRIORITIES.map(p => p.id),
    wider:{ jp:'debug まで読み込む（既定）',
            gain:'低い深刻度のルールも動く',
            cost:'アラート量の大半は下の帯にあるので、<b>キューが最も重くなる</b>' },
    narrower:{ jp:'critical 以上だけ読み込む',
            gain:'アラート量がほぼ消える（量のシェア 1.00 → 0.04）',
            cost:'<b>出力が絞られるのではなく、ルードが読み込まれません。</b>'+
                 'だから<code>base_syscalls</code> の union の入力側も減り、'+
                 '<b>要求 syscall が 8 → 2 本</b>になります — 集めなくなった分は'+
                 '<b>後から遡れません</b>' },
    measured:{ requiredSyscalls:{ debug:8, critical:2 },
               volumeShare:{ debug:1.00, critical:0.04 } },
    why:'falco.yaml が「しきい値以上のルールは <b>loaded and run</b> される」と'+
        '書いているので、これは出力フィルタではありません。'+
        '<b>検知層とカーネル層が触れる唯一の場所</b>で、向きは無害な方（絞ると'+
        'traced が減る。逆は起きない）。出典は §CLAIMS `priority-threshold-loads`。' },

  { id:'response', jp:'応答アクション', owner:'soc',
    key:'response', values:RESPONSE_ACTIONS.map(a => a.id),
    wider:{ jp:'止める（pause / stop / kill）',
            gain:'<b>攻撃が実際に止まる</b>',
            cost:'<b>止める手は目とは別の部品です。</b>OSS 自前なら Talon 相当を'+
                 '建てないと存在せず、選んでも何も起きません' },
    narrower:{ jp:'通知だけ',
            gain:'建てるものが少ない',
            cost:'<b>攻撃は続いています。</b>検知したことと止めたことは別' },
    measured:{ stopsAttack:RESPONSE_ACTIONS.filter(a=>a.stops).map(a=>a.id),
               needsBuilding:RESPONSE_ACTIONS.filter(a=>a.stops).map(a=>a.oss) },
    why:'検知と応答は別の部品（INVARIANTS 5.1）。'+
        '<b>選んだだけでは実在しない</b>ので `responseFor().real` を見てください。' },

  { id:'dropAction', jp:'ドロップ時の挙動', owner:'sre',
    key:'dropAction', values:DROP_ACTIONS.map(a => a.id),
    wider:{ jp:'exit（止める）',
            gain:'落ちていることを隠さない',
            cost:'<b>エージェントが止まる = 検知がゼロになる。</b>'+
                 '検知ゼロの時間が最大の減算です' },
    narrower:{ jp:'ignore（黙る）',
            gain:'アラートが増えない',
            cost:'<b>黙って盲目になります。</b>落ちていることが記録にも残らない' },
    measured:{ silent:DROP_ACTIONS.filter(a=>a.silent).map(a=>a.id),
               stopsAgent:DROP_ACTIONS.filter(a=>a.stopsAgent).map(a=>a.id),
               auditable:DROP_ACTIONS.filter(a=>a.audit).map(a=>a.id) },
    why:'両端が2つの負け方そのものです。'+
        '<b>規制のある業種は両端を選べません</b>（archetypes.js §fintech-payments）。' },

  /* NOT this file's lever — state.js §TUNE_DEFAULTS owns it. It is here because
     the seam is the lesson (GAME-DESIGN §4 ④): same shape, one layer down,
     different owner. A screen showing the policy page without this row would
     teach that noise is the detection engineer's whole problem. */
  { id:'base_syscalls', jp:'base_syscalls.custom_set', owner:'sre',
    key:'syscallSet', values:['all','default','custom'], foreign:'state.js',
    wider:{ jp:'広く集める（all）',
            gain:'計測できる範囲が広がる',
            cost:'<b>リングバッファが落ちる。</b>そして落ちた分は遡れない' },
    narrower:{ jp:'絞る（custom_set）',
            gain:'流入が減り、ドロップが止まる',
            cost:'<b>負の指定は計測できない盲点を作ります。</b>'+
                 'ポリシーを全部入れても、そのルールが要求する syscall が'+
                 '無ければ鳴りません（門は独立・§GATES `traced`）' },
    measured:{ gateWhenNegated:'traced', silent:true },
    why:'<b>穴はどちらのチームの中でもなく、境目に出ます。</b>'+
        'これが役割層の狙いで、この行がその片側です。' }
];

const leverById = id => LEVERS.find(l => l.id === id) || null;
/* the levers a given role actually owns, so the role-locked UI can grey the rest */
const leversFor = owner => LEVERS.filter(l => l.owner === owner);


/* ================================================================ functions
   Pure. `pol` is a POLICY_DEFAULT-shaped object, `ctx` is a plain object the
   caller assembles. Nothing here reads a module global or mutates an argument.
   ================================================================ */

const maturityById = id => MATURITIES.find(m => m.id === id) || null;
const tierById     = id => MATURITY_TIERS.find(t => t.id === id) || null;
const priorityById = id => PRIORITIES.find(p => p.id === id) || null;
const actionById   = id => RESPONSE_ACTIONS.find(a => a.id === id) || null;
const managedById  = id => MANAGED_POLICIES.find(m => m.id === id) || null;
const dropActionById = id => DROP_ACTIONS.find(a => a.id === id) || null;
const gateById     = id => GATES.find(g => g.id === id) || null;
const ruleByName   = name => RULE_FACTS.find(r => r.name === name) || null;
const maturityOf   = name => (ruleByName(name) || {}).maturity ?? null;

const withDefaults = pol => ({ ...POLICY_DEFAULT, ...obj(pol) });

/* which maturities this policy loads */
function maturitiesIn(pol){
  const t = tierById(withDefaults(pol).maturity);
  return t ? t.includes.slice() : ['stable'];
}

/* how many rules that is in the real world, summed off the three files. The
   priority threshold is NOT applied: the per-rule priority of all 93 is not
   declared here, and pretending otherwise would be inventing a number. */
function shippedRuleCount(pol){
  return maturitiesIn(pol)
    .map(id => maturityById(id))
    .reduce((n, m) => n + ((m && m.rules) || 0), 0);
}

const priorityRank = id => { const p = priorityById(id); return p ? p.rank : 99; };
/* "more severe than or equal to" — the falco.yaml wording, one place */
const severeEnough = (rulePriority, minPriority) =>
  priorityRank(rulePriority) <= priorityRank(minPriority);

/* the share of alert VOLUME a threshold still lets through */
function priorityShare(minPriority){
  const min = priorityRank(minPriority);
  return PRIORITIES.filter(p => p.rank <= min)
                   .reduce((s, p) => s + p.share, 0);
}

/* WHAT THE POLICY DOES TO THE SOC QUEUE.
 *
 * The multiplier the noise model wants as an input (state.js §noise currently
 * folds this into the single constant SOC.follow, which equals the widest tier
 * here by construction). Two factors, in opposite directions:
 *
 *   widening the maturity   more rules, more alerts
 *   narrowing the priority  fewer bands, fewer alerts — and fewer detections
 *
 * `needsArtifact` is honoured: a tier whose artifacts were never fetched adds
 * nothing to the queue, because those rules are not on the node. Having a
 * policy is not having a rule.
 */
function policyNoiseMul(pol, ctxIn = {}){
  const ctx = obj(ctxIn);
  const p = withDefaults(pol);
  const t = tierById(p.maturity);
  const artifacts = ctx.artifacts !== undefined ? !!ctx.artifacts : true;
  const wide = t && (!t.needsArtifact || artifacts) ? t.noiseMul : 1.00;
  const narrow = priorityShare(p.minPriority) / priorityShare(PRIORITY_DEFAULT);
  return wide * narrow;
}

/* the rules this policy LOADS, off the declared table. Maturity gate and
   priority gate only — no environment, no syscalls, no districts: this is the
   detection layer's own answer, and keeping it separate is what lets the other
   gates be independent.
 *
 * ctx.artifacts  false = falcoctl is missing or not working, so anything that
 *                needs a separate OCI artifact is not on the node
 * ctx.sources    which event sources deliver here. undefined = all of them     */
function rulesLoaded(pol, ctxIn = {}){
  const ctx = obj(ctxIn);
  const p = withDefaults(pol);
  const want = maturitiesIn(p);
  const t = tierById(p.maturity);
  const artifacts = ctx.artifacts !== undefined ? !!ctx.artifacts : true;
  const sources = arr(ctx.sources).length ? arr(ctx.sources) : null;
  return RULE_FACTS.filter(r => {
    if(sources && !sources.includes(r.source)) return false;
    if(r.maturity !== null){
      if(!want.includes(r.maturity)) return false;
      /* stable ships in the package; the other two are artifacts you fetch */
      const bundled = (maturityById(r.maturity) || {}).bundled;
      if(!bundled && t && t.needsArtifact && !artifacts) return false;
    }
    return severeEnough(r.priority, p.minPriority);
  });
}

/* THE UNION, AND THE ONLY PLACE THE TWO LAYERS TOUCH.
   The traced set is "base set ∪ what the LOADED rules require" (INVARIANTS 2.1),
   so a wider policy asks the kernel for MORE — which is the SRE's problem, from
   the detection engineer's decision. Exactly the seam the role layer is for. */
function requiredSyscalls(pol, ctx = {}){
  const out = [];
  for(const r of rulesLoaded(pol, obj(ctx)))
    for(const s of arr(r.needsSyscalls))
      if(!out.includes(s)) out.push(s);
  return out.sort();
}

/* EVERY gate this rule fails, not the first.
 *
 * ctx:
 *   policy      the policy object
 *   artifacts   falcoctl standing AND working
 *   negated     base_syscalls.custom_set negative entries, WITHOUT the `!`
 *               (campaign.js §negatedSyscalls already produces this shape)
 *   naFields    fields that read <NA> here (versions.js §naFieldsAt gives
 *               [{field,...}]; either shape is accepted)
 *   sources     event sources that deliver
 *   districts   { id: true } for districts that are built AND working
 *
 * Returned in GATES order. Deliberately NOT short-circuited: "I turned on every
 * ruleset and it still does not ring" has to be showable as two gates shut at
 * once, and a first-failure answer would hide the second one — which is the
 * mistake people actually make in the field.
 */
function gatesFailed(rule, ctxIn = {}){
  const ctx = obj(ctxIn);
  const r = typeof rule === 'string' ? ruleByName(rule) : (obj(rule).name ? rule : null);
  if(!r) return [{ gate:'have', why:'unknown-rule' }];
  const p = withDefaults(ctx.policy);
  const out = [];

  /* have — maturity selection, plus the artifact actually being on the node */
  if(r.maturity !== null){
    const want = maturitiesIn(p);
    const t = tierById(p.maturity);
    const artifacts = ctx.artifacts !== undefined ? !!ctx.artifacts : true;
    const bundled = (maturityById(r.maturity) || {}).bundled;
    if(!want.includes(r.maturity))
      out.push({ gate:'have', why:'maturity-not-selected', maturity:r.maturity });
    else if(!bundled && t && t.needsArtifact && !artifacts)
      out.push({ gate:'have', why:'artifact-not-fetched', maturity:r.maturity,
                 artifact:(maturityById(r.maturity) || {}).artifact });
  }

  /* loaded — the priority threshold */
  if(!severeEnough(r.priority, p.minPriority))
    out.push({ gate:'loaded', why:'below-threshold',
               priority:r.priority, minPriority:p.minPriority });

  /* traced — THE KERNEL LAYER. Independent of everything above it. A rule goes
     blind only when every syscall it can match on is negated (campaign.js
     §blindSyscalls), and a null declaration is not a claim either way. */
  const need = r.needsSyscalls;
  const off = arr(ctx.negated);
  if(need && need.length && off.length && need.every(n => off.includes(n)))
    out.push({ gate:'traced', why:'syscalls-negated', syscalls:need.slice() });

  /* field — THE VERSION LAYER */
  const na = arr(ctx.naFields).map(f => (typeof f === 'string' ? f : obj(f).field));
  const lost = arr(r.needsFields).filter(f => na.includes(f));
  if(lost.length)
    out.push({ gate:'field', why:'reads-na', fields:lost });

  /* path — the source has to deliver, and the pipeline has to be standing.
     `districts` is optional: campaign.js scores this properly, and this is here
     so a caller with only a policy in hand still gets an honest answer. */
  const sources = arr(ctx.sources).length ? arr(ctx.sources) : null;
  if(sources && !sources.includes(r.source))
    out.push({ gate:'path', why:'source-absent', source:r.source });
  const districts = obj(ctx.districts);
  if(Object.keys(districts).length){
    const chain = r.source === 'syscall'
      ? ['driver','ring','state','rules','outputs']
      : ['plugins','rules','outputs'];
    const missing = chain.filter(k => !districts[k]);
    if(missing.length) out.push({ gate:'path', why:'not-built', missing });
  }
  return out;
}

/* does it ring. `gates` is why not, in order, and it is the interesting half */
function ringsFor(rule, ctx = {}){
  const failed = gatesFailed(rule, obj(ctx));
  return { rings:failed.length === 0, gates:failed,
           silent:failed.every(f => (gateById(f.gate) || {}).silent) };
}

/* every declared rule that actually rings in this situation.
   READ THE PARAMETERS: there is no `stack` and no `sysdig` here. Detection does
   not depend on which side of ③ 守り方 you chose, and the way to keep that true
   is for the function that answers it to have no way of knowing. */
function firingRules(ctx = {}){
  return RULE_FACTS.filter(r => ringsFor(r, obj(ctx)).rings);
}
const detectionCount = ctx => firingRules(obj(ctx)).length;

/* ---------------------------------------------------------------- response */

/* the response action this policy actually has. `real` is the whole question:
   choosing `kill` on the OSS side without building the hand is a choice with no
   consequence, and the model has to say so rather than quietly obeying. */
function responseFor(pol, ctxIn = {}){
  const ctx = obj(ctxIn);
  const p = withDefaults(pol);
  const a = actionById(p.response) || actionById('notify');
  const districts = obj(ctx.districts);
  const bundle = managedById(p.managed);
  const fromBundle = !!(bundle && bundle.response.includes(a.id));
  const missing = a.needs.filter(k => !districts[k]);
  return { id:a.id, jp:a.jp, stops:a.stops,
           real:missing.length === 0,
           missing,
           via:fromBundle ? 'sysdig' : (a.oss || null),
           needsBuilding:!fromBundle && a.stops,
           why:a.why };
}
const stopsAttack = (pol, ctx = {}) => {
  const r = responseFor(pol, ctx);
  return r.stops && r.real;
};

/* what the managed bundle changes. NOTE WHAT IS NOT IN THE RETURN VALUE: there
   is no detection figure, because there is no detection delta. */
function managedEffects(pol){
  const m = managedById(withDefaults(pol).managed) || managedById('none');
  return { id:m.id, jp:m.jp, ops:m.ops, retain:m.retain, correlate:m.correlate,
           inUse:m.inUse, response:m.response.slice(), detection:0, why:m.why };
}

/* ---------------------------------------------------------------- honesty */

/* the register index, same shape and same three states as versions.js §CLAIMS.
   isFixed() answers "may a customer-facing screen state this as fact?" */
const claimById = id => CLAIMS.find(c => c.id === id) || null;
const claimFor  = id => CLAIMS.find(c => c.covers.includes(id)) || null;
function isFixed(id){
  const c = claimFor(id);
  return !!c && !!c.invariant && c.status === 'registered';
}
const unregisteredClaims = () =>
  CLAIMS.filter(c => !c.invariant || c.status !== 'registered');
const fixedOnly = (items, key = 'id') =>
  arr(items).filter(x => isFixed(x && x[key]));

/* rules whose maturity / priority is NOT upstream-verified. A reviewer should be
   able to get this list without reading the table. */
const unsourcedRules = () => RULE_FACTS.filter(r => !r.src || !r.src.length)
                                       .map(r => r.name);

/* every rule this model declares for a maturity, so a count here can be checked
   against MATURITIES[].rules without hand-counting */
const declaredByMaturity = id => RULE_FACTS.filter(r => r.maturity === id);


export {
  MATURITIES,
  MATURITY_TIERS,
  PRIORITIES,
  PRIORITY_DEFAULT,
  PRIORITY_SRC,
  RULE_FACTS,
  RESPONSE_ACTIONS,
  MANAGED_POLICIES,
  SYSDIG_DELTA,
  DROP_ACTIONS,
  DROP_ACTIONS_SRC,
  GATES,
  CLAIMS,
  POLICY_DEFAULT,
  LEVERS,
  leverById,
  leversFor,
  claimById,
  claimFor,
  isFixed,
  unregisteredClaims,
  fixedOnly,
  maturityById,
  tierById,
  priorityById,
  actionById,
  managedById,
  dropActionById,
  gateById,
  ruleByName,
  maturityOf,
  withDefaults,
  maturitiesIn,
  shippedRuleCount,
  priorityRank,
  severeEnough,
  priorityShare,
  policyNoiseMul,
  rulesLoaded,
  requiredSyscalls,
  gatesFailed,
  ringsFor,
  firingRules,
  detectionCount,
  responseFor,
  stopsAttack,
  managedEffects,
  unsourcedRules,
  declaredByMaturity
};
