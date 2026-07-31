/* 持っていないルールは鳴らない。
 *
 * The reference example for a gap that is not a stage of the pipeline. Every
 * district on the flow is standing, the ring buffer is losing nothing, five of
 * six steps ring — and the sixth cannot, because the rule for it was never on
 * the node. Falco's release package carries the Stable rules only; the rest are
 * OCI artifacts that falcoctl has to fetch. The missing piece is a supply line,
 * not a stage, which is why looking at the pipeline harder never finds it.
 *
 * WHICH step is the missing one matters, and this file used to get it wrong. It
 * hung the lesson on `dropbin` / `Drop and execute new binary in container`,
 * which is tagged `maturity_stable` — it ships in the release package, so it is
 * the one rule in the chain that falcoctl demonstrably has nothing to do with
 * (INVARIANTS 4.3). That is why this scenario was written and then left
 * unregistered. The step it hangs on now is `imds` /
 * `Contact EC2 Instance Metadata Service From Container`, which really is
 * `maturity_incubating` and really does arrive as a separate OCI artifact
 * (INVARIANTS 4.1 / 4.5).
 *
 * The replacement is better content as well as truer content, for two reasons:
 *
 *   - it is where the credentials come from. step6 already says 「盗んだ資格情報で
 *     クラウドへ」 and until now nothing in the chain stole any. IMDS is the actual
 *     route from a container foothold to cloud credentials, so the missing rule is
 *     the one that would have seen the bridge being crossed — and the cloud step
 *     that follows is the consequence of not having it.
 *   - `Find AWS Credentials` is stable while this one is incubating. Same
 *     objective, same attacker, one bundled and one not. Maturity is a statement
 *     about the rule's false-positive history, NOT about how much the threat
 *     matters, and nothing says that as flatly as those two sitting side by side.
 *
 * The player is the platform role on purpose. Everything they own — 02 ドライバ,
 * 04 状態エンジン, and the DEPLOY / DRIVER levers — is exactly what the situation
 * invites them to suspect, and none of it changes the result. 09 belongs to the
 * detection engineer, so the fix is an ask, and the budget is one: spending it
 * on 08 Sysdig ("買えば検知が増えるだろう") loses the run. */
export default {
  id:'rules-not-followed',
  title:'持っていないルール',
  /* last of the three "not on the flow" districts, and the hardest of them: 08
     and 07 are components you can see are absent, while 09 is a SUPPLY LINE, so
     the build list looks complete. The single ask is what makes it bite — the
     invited move (buy Sysdig) spends it and then the real fix is unaffordable. */
  order: 40,
  blurb:'流れの全段が建っている。ドロップ 0%、アラートも届いている。それでも '+
        '<b>IMDS への接触だけ</b>が鳴らない — そこで抜かれた資格情報が'+
        'クラウド側で使われている。前任のメモには「ルールは最新」とある。',

  env:{ type:'managed-k8s', nodes:3 },

  start:{
    /* the whole flow plus the bypass lane. 09 ルール配布 is the one thing absent,
       and it is absent because nobody ever built it — not because it broke. */
    built:['driver','ring','state','rules','outputs','plugins'],
    tune:{},                       /* nothing to find here, and that is the point */
    load:1.0,                      /* util well under capacity: the HUD stays clean */
    driver:'modern_ebpf',
    stack:'oss'
  },

  /* fixed role: the levers you hold are the ones the symptom points at, and none
     of them is the cause */
  player:{ side:'defense', role:'platform', lockRole:true },

  attack:{
    auto:true, response:false,
    waves:[
      { jp:'侵入と足場づくり',   steps:['exec','shadow','cron'] },
      { jp:'資格情報とクラウド', steps:['imds','k8sapi','cloud'] }
    ]
  },

  insight:{
    id:'bundled-rules-are-stable-only',
    wrong:'5段は鳴っていてドロップも 0% → 取りこぼしているのは<b>ドライバか状態エンジン</b>だ。'+
          'ドライバを替える、あるいは <b>Sysdig を入れれば</b>検知が増えるはず',
    truth:'この検知（<code>Contact EC2 Instance Metadata Service From Container</code>）は'+
          '<b>そもそもノードに無い</b>。これは <code>maturity_incubating</code> で、'+
          'リリースパッケージに同梱されるのは成熟度 <b>stable</b> のルールだけ。'+
          'incubating / sandbox は <b>別の OCI アーティファクト</b>として取得するもので、'+
          'それをやるのが <code>falcoctl</code>（<b>09 ルール配布</b>）。'+
          'パイプラインは1段も欠けていないので、ドライバも状態エンジンもチューニングも無関係。'+
          '<b>成熟度は脅威の重要度ではない</b> — 同じ「AWS の資格情報を盗む」目的でも '+
          '<code>Find AWS Credentials</code> は stable で同梱、こちらは incubating で別取得。'+
          '違うのは誤検知の実績であって、危険度ではない。'+
          '実機では <code>artifact.install.refs</code>（取得）・'+
          '<code>artifact.follow.refs</code>（追従）・<code>rules_files</code>（読み込み）の'+
          '<b>3キーが揃って</b>はじめて効く。どれか1つ欠けると「入れたはずなのに鳴らない」になる。'
  },

  /* 6段すべて。依頼は1回だけ — 09 を頼むための1回で、他に回す余裕は無い。
     ドロップ上限は満たされたまま残る: HUD が健康でも検知は落ちる、の対比 */
  goal:{ detect:6, contain:false, maxAsks:1, maxDropPct:1 }
};
