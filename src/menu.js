/* MENU — the entrance.
 *
 * Opening the page used to drop you straight into a city with no statement of
 * what you were looking at. This module is the front door: a title screen that
 * says what the game is in one screen, a side pick (defence / offence), and —
 * for defence — the role pick that the campaign's role layer already models.
 *
 * Everything here is self-contained on purpose. The markup, the styles and the
 * wiring are all built from this file, so `index.html` and `ui.js` stay almost
 * untouched and the tutorial / HUD work can land beside this without a merge
 * fight. The only foreign nodes it touches are `#uiModeSeg` (it appends the
 * "back to title" button) and the brandbar wordmark, which it clones rather
 * than duplicating the asset.
 *
 * It brings in no new colour, font or asset: every value below is an existing
 * brand token from `index.html`.
 *
 * It also owns the *empty plot* reading of Campaign — see §plots below. That
 * belongs to the entrance rather than to the HUD: it is the first thing a new
 * player sees, and the first thing they misread.
 *
 * Public API:
 *   initMenu()        build the overlay, wire it, then open or skip per prefs
 *   showTitle()       open at the title screen
 *   showRoles()       open at the role screen (defence already chosen)
 *   hideMenu()        close the overlay, leaving the app as-is
 *   menuPrefs()       read the persisted prefs, or null
 *   forgetMenu()      drop the prefs, so the next load shows the title again
 *   plotTag(node,d,unbuilt)   draw one district label as built / plot / next
 *   plotStyle(id)     'live' | 'next' | 'plot' — for the minimap to agree
 * Also exposed as `window.__menu` for driving from a test harness.
 */
import { SIDES, ROLES, BUILD_ORDER, CHAIN, GAME, canBuild,
         setSide, setRole, setUiMode, onCampaignChange,
         SCENARIOS, startScenario } from './campaign.js';
import { byId } from './layout.js';
import { hasSeen, markSeen, progressSummary, unlockedIds, isCleared,
         storageOk } from './save.js';


/* ---------------------------------------------------------------- prefs
   One key, versioned, and every access guarded: `file://` origins are allowed
   to throw on localStorage and this must not take the page down with it.

   WHAT THIS KEY IS AND IS NOT. It holds the *restore point* — which side, which
   role, which mode you were last in — and nothing else. It used to also hold
   `seen`, "has the title screen been sat through once", and save.js grew a
   `seen.title` for the same fact. Two writers for one fact is a bug waiting for
   a load order: whichever module read second would win, and the title would
   start flickering back on. So that one fact moved OUT of here and into save.js,
   and this file no longer reads or writes it.

   save.js won rather than this key, for three reasons:
     - it is the module built for progress flags: one versioned record, every
       touch guarded, and a documented in-memory fallback so a private-mode
       session still remembers the skip for the rest of the session — where this
       key silently forgets it on the very next read;
     - resetProgress() should bring the title back. With the flag out here,
       wiping your progress left the front door still suppressed;
     - its own header already nominates hasSeen('title') for this lane.
   A legacy `seen` is migrated across once, in initMenu(), and then ignored. */
const LS_KEY = 'falco-city.menu.v1';

function menuPrefs(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    const saved = JSON.parse(raw);
    return (saved && typeof saved === 'object') ? saved : null;
  }catch(err){ return null; }
}
function savePrefs(patch){
  try{
    /* `seen` is save.js's now; drop it on the way past so the old field cannot
       linger and look like it still means something */
    const {seen, ...keep} = (menuPrefs() || {});
    localStorage.setItem(LS_KEY, JSON.stringify({...keep, ...patch}));
  }catch(err){ /* private mode, or a file:// origin that refuses storage */ }
}
function forgetMenu(){
  try{ localStorage.removeItem(LS_KEY); }catch(err){}
  markSeen('title', false);      /* the same forgetting, in the module that owns it */
}

/* the ordered id list save.js takes as an argument — it imports nothing, so the
   order of the ladder is passed in rather than looked up */
const scenarioOrder = () => SCENARIOS.map(s => s.id);
const scenarioTitle = id => (SCENARIOS.find(s => s.id === id) || {}).title || '';

/* a saved role only counts if the role layer still has it */
const knownRole = id => id === null || ROLES.some(r => r.id === id);


/* ---------------------------------------------------------------- styles
   Injected from here so index.html keeps one line of diff. Tokens only. */
const CSS = `
#menu{position:fixed;inset:0;z-index:70;display:flex;align-items:center;
  justify-content:center;padding:20px;
  background:rgba(247,248,248,.93);backdrop-filter:blur(7px);
  opacity:0;visibility:hidden;pointer-events:none;transition:opacity .26s}
#menu.show{opacity:1;visibility:visible;pointer-events:auto}
#menu .card{display:none;width:100%;max-width:912px;max-height:100%;
  overflow-y:auto;scrollbar-width:thin;
  background:var(--white);border:1px solid var(--grey-10);border-radius:18px;
  box-shadow:0 18px 60px rgba(0,0,0,.10);padding:26px 34px 24px}
#menu .card.on{display:block}

/* ---- shared bits ---- */
#menu .brow{display:flex;align-items:center;gap:14px;padding-bottom:16px;
  border-bottom:1px solid var(--grey-10);margin-bottom:20px}
#menu .brow svg{display:block;height:15px;width:auto;color:var(--black)}
#menu .brow .bar{width:1px;height:20px;background:var(--grey-10)}
#menu .brow .kick{font-family:var(--font-mono);font-size:10px;color:var(--grey-30);
  letter-spacing:.19em;text-transform:uppercase}
#menu .brow .step{font-family:var(--font-mono);font-size:9.5px;color:var(--grey-25);
  letter-spacing:.16em;text-transform:uppercase;margin-left:auto}
#menu h1{font-weight:300;font-size:33px;line-height:1.24;letter-spacing:-.005em;
  text-wrap:balance}
#menu h1 em{font-style:normal;font-weight:600;
  background:var(--lumin);padding:0 8px;border-radius:3px}
#menu h2{font-weight:300;font-size:25px;line-height:1.3}
#menu .lede{font-size:13px;line-height:1.8;color:var(--grey-50);margin-top:12px;
  max-width:660px}
#menu .lede b{color:var(--black);font-weight:600}
#menu .lede code{font-family:var(--font-mono);font-size:12px;
  background:var(--grey-10);padding:1px 5px;border-radius:3px}

/* ---- the three beats, so the loop is legible before you click ---- */
#menu .beats{display:flex;align-items:center;gap:9px;margin-top:16px}
#menu .beats span{font-family:var(--font-mono);font-size:10px;letter-spacing:.13em;
  text-transform:uppercase;background:var(--grey-10);color:var(--grey-50);
  padding:6px 12px;border-radius:7px;white-space:nowrap}
#menu .beats i{font-style:normal;color:var(--grey-25);font-size:11px}

/* ---- §continue: the campaign you already have ----------------------------
   It rides on the beats row rather than getting one of its own. The title card
   is already the tallest thing the game draws and at the supported minimum of
   1280x720 it is within ~30px of the viewport — a new row here would push the
   side cards under the fold, which is where the only button a first-time player
   needs happens to live. That row has ~550px spare, so this costs no height. */
#menu .beats .prog{display:flex;align-items:center;gap:10px;margin-left:auto}
#menu .beats .prog[hidden]{display:none}
#menu .beats .dots{display:flex;gap:3px}
#menu .beats .dots i{display:block;width:9px;height:9px;border-radius:50%;
  background:var(--grey-10);border:1px solid var(--grey-20);font-style:normal}
/* three states, because "cleared", "you may play this" and "not open yet" are
   three different answers and the ladder is the whole point of the save */
#menu .beats .dots i.open{background:var(--white);border-color:var(--grey-40)}
#menu .beats .dots i.done{background:var(--lumin);border-color:#5C9A2E}
#menu .beats .ptxt{font-family:var(--font-mono);font-size:9.5px;color:var(--grey-40);
  letter-spacing:.07em;white-space:nowrap}
#menu .beats .resume{font-family:var(--font-mono);font-size:10px;letter-spacing:.12em;
  text-transform:uppercase;border:0;background:var(--black);color:#fff;
  padding:8px 14px;border-radius:8px;cursor:pointer;transition:.16s;white-space:nowrap}
#menu .beats .resume:hover{background:var(--grey-60)}

/* the environments that refuse localStorage. A notice, not an error: save.js
   keeps the record in memory, so the only thing lost is outliving the tab. */
#menu .foot .nosave{font-size:11.5px;line-height:1.7;color:var(--grey-50);
  background:rgba(255,169,64,.13);border-left:2px solid var(--orange);
  border-radius:7px;padding:8px 11px;flex:1 1 300px;min-width:240px}
#menu .foot .nosave[hidden]{display:none}
#menu .foot .nosave b{color:var(--grey-70);font-weight:600}

/* ---- side pick ---- */
#menu .sides{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}
#menu .side{text-align:left;font-family:var(--font-display);
  border:1px solid var(--grey-10);border-radius:14px;padding:16px 18px 15px;
  background:var(--white);display:flex;flex-direction:column;gap:7px}
#menu .side .top{display:flex;align-items:center;gap:9px}
#menu .side .nm{font-size:16px;font-weight:600;color:var(--black)}
#menu .side .en{font-family:var(--font-mono);font-size:9.5px;color:var(--grey-25);
  letter-spacing:.15em;text-transform:uppercase}
/* .flag, not .tag: that class is taken by the 3D-anchored district labels */
#menu .side .flag{font-family:var(--font-mono);font-size:9px;letter-spacing:.12em;
  text-transform:uppercase;padding:3px 8px;border-radius:5px;margin-left:auto;
  background:rgba(255,169,64,.16);color:#8A5A16;border-left:2px solid var(--orange);
  white-space:nowrap}
#menu .side .txt{font-size:12px;line-height:1.7;color:var(--grey-50)}
#menu .side .txt b{color:var(--black);font-weight:600}
#menu .side .meta{font-family:var(--font-mono);font-size:9.5px;color:var(--grey-30);
  letter-spacing:.04em;line-height:1.6}
/* the stages you will build, in the same dashed language the empty plots use */
#menu .plan{display:flex;gap:4px;flex-wrap:wrap;margin-top:-2px}
#menu .plan i{font-family:var(--font-mono);font-size:9px;font-style:normal;
  color:var(--grey-30);border:1px dashed var(--grey-20);border-radius:4px;
  padding:3px 7px}

/* playable side: a real button, and it looks like the primary action */
#menu button.side{cursor:pointer;transition:.16s}
#menu button.side:hover{border-color:var(--grey-25);
  box-shadow:0 10px 30px rgba(0,0,0,.07)}
#menu .side .go{margin-top:auto;font-family:var(--font-mono);font-size:10px;
  letter-spacing:.12em;text-transform:uppercase;background:var(--black);color:#fff;
  padding:9px 12px;border-radius:8px;text-align:center}
#menu button.side:hover .go{background:var(--grey-60)}

/* the side that is not open yet. Not a grey-out: the reason is on the card,
   because "why can I not click this" is the actual question. */
#menu .side.shut{background:var(--grey-10);border-color:var(--grey-20);
  border-style:dashed;cursor:not-allowed}
#menu .side.shut .nm{color:var(--grey-40)}
#menu .side .why{font-size:11.5px;line-height:1.7;color:var(--grey-50);
  background:rgba(255,169,64,.13);border-left:2px solid var(--orange);
  border-radius:7px;padding:9px 11px;margin-top:auto}
#menu .side .why b{color:var(--grey-70);font-weight:600}

/* ---- footer: explore stays reachable ---- */
#menu .foot{display:flex;align-items:center;gap:14px;margin-top:20px;
  padding-top:16px;border-top:1px solid var(--grey-10);flex-wrap:wrap}
#menu .ghost{font-family:var(--font-mono);font-size:10px;letter-spacing:.11em;
  text-transform:uppercase;border:1px solid var(--grey-20);background:var(--white);
  color:var(--grey-40);padding:9px 14px;border-radius:9px;cursor:pointer;
  transition:.16s;white-space:nowrap}
#menu .ghost:hover{color:var(--black);border-color:var(--grey-40)}
#menu .note{font-family:var(--font-mono);font-size:9.5px;color:var(--grey-25);
  letter-spacing:.1em;line-height:1.6;margin-left:auto;text-align:right}

/* ---- role pick ---- */
#menu .roles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
#menu .role{grid-column:span 1;text-align:left;font-family:var(--font-display);
  border:1px solid var(--grey-10);border-radius:11px;padding:11px 13px;
  background:var(--white);cursor:pointer;transition:.16s}
#menu .role.wide{grid-column:span 2}
#menu .role:hover{border-color:var(--grey-25)}
#menu .role.on{border-color:var(--black);box-shadow:inset 0 0 0 1px var(--black)}
#menu .role .rt{display:flex;align-items:center;gap:8px}
#menu .role .rd{width:7px;height:7px;border-radius:50%;flex:none;
  background:var(--grey-20)}
#menu .role .rn{font-size:13px;font-weight:600;color:var(--black)}
#menu .role .rm{font-family:var(--font-mono);font-size:9.5px;color:var(--grey-30);
  letter-spacing:.04em;margin-left:auto;text-align:right;white-space:nowrap}
/* on the four role cards the mission gets its own line: at half width the name
   and the mission were competing for the same row */
#menu .role .rm.solo{margin:4px 0 0;text-align:left;white-space:normal;
  color:var(--grey-40);letter-spacing:.02em}
#menu .role .rb{font-size:11.5px;line-height:1.65;color:var(--grey-50);margin-top:5px}
#menu .role .rb b{color:var(--grey-70);font-weight:600}
#menu .role.on .rb{color:var(--grey-60)}
#menu .start{font-family:var(--font-mono);font-size:11px;letter-spacing:.13em;
  text-transform:uppercase;border:0;background:var(--black);color:#fff;
  padding:12px 26px;border-radius:9px;cursor:pointer;transition:.16s}
#menu .start:hover{background:var(--grey-60)}

/* the back-to-title control lives in the mode segment, so it is always there */
#uiModeSeg button.tohome{color:var(--grey-30)}

/* ---- §plots: an empty plot must not read as a broken city ----------------
   Campaign starts from bare ground, and the designer himself read the first
   frame as "the districts stopped rendering". Nothing was wrong: they are not
   built yet. So an unbuilt stage is no longer absent from the overlay — it is
   drawn as a surveyed plot, dashed and numbered, and the one you can build
   right now is lit. "Not there" and "build this next" now look different. */
/* below the overlay panels (.ui is z-index 10): a plot marker is scenery, and
   it must never sit on top of the controls the way a built label may */
.tag.plot{z-index:9;background:rgba(255,255,255,.74);border:1px dashed var(--grey-30);
  color:var(--grey-50);font-size:10px;letter-spacing:.09em;padding:3px 8px}
.tag.plot .pn{color:var(--grey-40);margin-right:7px}
.tag.plot .cta{margin-left:8px;color:var(--grey-30);font-size:9px;letter-spacing:.13em}
.tag.plot.dim{border-color:var(--grey-20);color:var(--grey-30)}
.tag.next{background:var(--lumin);border:1px solid var(--black);color:var(--black);
  box-shadow:0 0 0 0 rgba(0,0,0,.32);animation:plotnext 2s infinite ease-out}
.tag.next .pn{color:var(--grey-50)}
.tag.next .cta{color:var(--grey-60)}
@keyframes plotnext{
  0%{box-shadow:0 0 0 0 rgba(0,0,0,.30)}
  70%{box-shadow:0 0 0 9px rgba(0,0,0,0)}
  100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}

/* entering Campaign: the plots arrive, so the eye sees ground being surveyed
   rather than buildings vanishing */
body.plotpulse .tag.plot{animation:plotin .85s ease-out both}
body.plotpulse .tag.next{animation:plotin .85s ease-out both}
@keyframes plotin{
  0%{opacity:0;transform:translate(-50%,-50%) scale(.55)}
  60%{opacity:1;transform:translate(-50%,-50%) scale(1.06)}
  100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
`;


/* ---------------------------------------------------------------- markup */
const el = document.createElement('div');
el.id = 'menu';

/* one wordmark asset in the page, cloned rather than copied */
function brandRow(kicker, stepLabel){
  const src = document.querySelector('.brandbar svg');
  return `<div class="brow">`
       + (src ? src.outerHTML : '')
       + `<div class="bar"></div><span class="kick">${kicker}</span>`
       + `<span class="step">${stepLabel}</span></div>`;
}

const sideDefence = SIDES.find(sd => sd.id === 'defense');
const sideOffence = SIDES.find(sd => sd.id === 'offense');

/* the two numbers below come from the model, so the pitch cannot drift from it */
const STAGES = BUILD_ORDER.length;
const STEPS  = CHAIN.length;

function titleHtml(){
  return brandRow('runtime security city', 'step 1 / 2 · 陣営')
  + `<h1>syscall からアラートまで、<em>検知の街</em>を建てる。</h1>
     <p class="lede">空き地に <b>${STAGES} 段</b>のパイプラインを建て、
       <b>${STEPS} 段</b>の攻撃チェーンを迎え撃つゲームです。
       建てていない段の攻撃は、運が悪いのではなく<b>原理として</b>見逃します。
       見逃した行には、必ずその理由が付きます。</p>
     <div class="beats"><span>建てる</span><i>→</i><span>迎え撃つ</span><i>→</i>
       <span>見逃した理由を直す</span>
       <!-- filled by renderProgress(); hidden until there is progress to show -->
       <div class="prog" id="mProg" hidden>
         <div class="dots" id="mDots"></div>
         <div class="ptxt" id="mProgTxt"></div>
         <button class="resume" id="mResume">続きから</button>
       </div></div>

     <div class="sides">
       <button class="side" id="mSideDef">
         <div class="top"><span class="nm">${sideDefence.jp}</span>
           <span class="en">defence</span></div>
         <div class="txt">${sideDefence.brief}</div>
         <div class="meta">役割を選んで開始<br>基盤 / SRE / 検知 / SOC / 全役</div>
         <div class="meta">建てる段（点線は未建設）</div>
         <div class="plan">${BUILD_ORDER.map(id => `<i>${byId(id).n}</i>`).join('')}</div>
         <div class="go">守備側で始める →</div>
       </button>

       <div class="side shut" id="mSideOff" aria-disabled="true">
         <div class="top"><span class="nm">${sideOffence.jp}</span>
           <span class="en">offence</span><span class="flag">準備中</span></div>
         <div class="txt">${sideOffence.brief}</div>
         <div class="why"><b>いま守備側を作り込んでいます。</b>
           攻撃側が開くのは、守備側が「守れる」状態になってからです。
           守れない盤面に攻撃側を足しても、すり抜けたのか、そもそも
           何も建っていなかったのかが区別できません。<br>
           守備側を選ぶと、<b>攻撃は Auto</b> で流れます。</div>
       </div>
     </div>

     <div class="foot">
       <button class="ghost" id="mExplore">Explore — 都市を歩いて仕組みを読む</button>
       <button class="ghost" id="mSkipNext">次回からタイトルを出さない</button>
       <div class="nosave" id="mNoSave" hidden>この環境では<b>進行を保存できません</b>（プライベートモードなど）。クリアと解放はこのタブを開いているあいだ有効なので、<b>遊ぶことはできます</b>。失われるのはタブを閉じたときだけです。</div>
       <span class="note">1280×720 以上 · 日本語 · 攻撃側は未実装</span>
     </div>`;
}

function rolesHtml(){
  const cards = ROLES.map(r =>
    `<button class="role" data-role="${r.id}">
       <div class="rt"><i class="rd" style="background:${r.color}"></i>
         <span class="rn">${r.chip} · ${r.jp}</span></div>
       <div class="rm solo">${r.mission}</div>
       <div class="rb">${r.brief}</div>
     </button>`).join('');

  return brandRow('守備側 · defence', 'step 2 / 2 · 役割')
  + `<h2>どの役で入りますか。</h2>
     <p class="lede">このパイプラインを一人で建てている現場はありません。役を選ぶと、
       <b>持ち物のレバーだけ</b>が触れるようになり、他の段は担当への
       <b>依頼</b>になります。見逃しは、その判断をした役の名前で返ってきます。</p>
     <div class="roles">
       <button class="role wide on" data-role="">
         <div class="rt"><i class="rd"></i><span class="rn">全役</span>
           <span class="rm">初回はこれを推奨</span></div>
         <div class="rb">一人で ${STAGES} 段すべてを建て、レバーも全部触る。
           まず模型の全体を通したいときはこれ。</div>
       </button>
       ${cards}
     </div>
     <div class="foot">
       <button class="start" id="mStart">この役で始める</button>
       <button class="ghost" id="mBack">← 陣営選択に戻る</button>
       <span class="note">攻撃は Auto で流れます</span>
     </div>`;
}

const cardTitle = document.createElement('div');
cardTitle.className = 'card';
cardTitle.id = 'menuTitle';

const cardRoles = document.createElement('div');
cardRoles.className = 'card';
cardRoles.id = 'menuRoles';

/* '' means 全役 — GAME.role is null there, and dataset values are strings */
let picked = '';


/* ---------------------------------------------------------------- screens */
function openCard(which){
  cardTitle.classList.toggle('on', which === 'title');
  cardRoles.classList.toggle('on', which === 'roles');
  el.classList.add('show');
  /* the title is reachable at any time from ↩ タイトル, so the progress on it is
     redrawn on every open rather than once at build time */
  if(which === 'title') renderProgress();
}
function showTitle(){ openCard('title'); }
function showRoles(){ openCard('roles'); }
function hideMenu(){ el.classList.remove('show'); }

function markRoles(){
  cardRoles.querySelectorAll('.role').forEach(btn =>
    btn.classList.toggle('on', btn.dataset.role === picked));
}

/* ---------------------------------------------------------------- §continue
   Which scenario "continue" means is not stored anywhere: it is derived from the
   progress by save.js, so it cannot disagree with what the picker will let you
   choose. `next` is the first unlocked scenario you have not cleared. */
function resumeId(){
  const ids = scenarioOrder();
  if(!ids.length) return null;
  const p = progressSummary(ids);
  /* nothing left to continue into — offer the first one again */
  return (p.complete ? ids[0] : p.next) || ids[0];
}

function renderProgress(){
  const nosave = cardTitle.querySelector('#mNoSave');
  if(nosave) nosave.hidden = storageOk();

  const prog = cardTitle.querySelector('#mProg');
  if(!prog) return;
  const ids = scenarioOrder();
  const p = progressSummary(ids);
  /* A first-time player has no campaign to continue, and "0/6 クリア" on the
     front door is noise on the one screen whose job is to get them to press one
     button. So this whole strip only exists once there is something in it. */
  prog.hidden = p.cleared === 0;
  if(prog.hidden) return;

  const open = unlockedIds(ids);
  prog.querySelector('#mDots').innerHTML = ids.map(id =>
    `<i class="${isCleared(id) ? 'done' : open.includes(id) ? 'open' : ''}"`
    + ` title="${scenarioTitle(id)}"></i>`).join('');

  const nx = resumeId();
  prog.querySelector('#mProgTxt').textContent = p.complete
    ? `${p.total} 本すべてクリア`
    : `${p.total} 本中 ${p.cleared} 本クリア · 次は「${scenarioTitle(nx)}」`;
  prog.querySelector('#mResume').textContent =
    p.complete ? '最初から遊ぶ' : '続きから';
}

/* ---- entering the game ---------------------------------------------------
   Order matters: the mode switch rebuilds the panel and resets the plot, so
   the role goes on after it. ui.js then shows that role's brief as the hint. */
function startDefence(){
  const id = picked === '' ? null : picked;
  setSide('defense');
  setUiMode('campaign');
  setRole(id);
  markSeen('title');
  savePrefs({side:'defense', role:id, mode:'campaign'});
  hideMenu();
}
function startExplore(){
  setUiMode('explore');
  markSeen('title');
  savePrefs({mode:'explore'});
  hideMenu();
}

/* One click back into the campaign, at the scenario the ladder says you are on.
   The role is not taken from the saved pick here: a scenario declares its own
   player.role (and may lock it), and startScenario() is what applies that — the
   same path the in-panel picker takes, so continuing cannot land you in a state
   choosing the scenario by hand would not. */
function resumeCampaign(){
  const id = resumeId();
  if(!id) return;
  setSide('defense');
  setUiMode('campaign');
  startScenario(id);
  markSeen('title');
  savePrefs({side:'defense', mode:'campaign'});
  hideMenu();
}


/* ---------------------------------------------------------------- §plots
   ui.js calls plotTag() for every district label each frame; this decides what
   an unbuilt stage looks like. Rendering is only touched when the state name
   changes, so per-frame cost stays at two class toggles. */
function plotStyle(id){
  if(!GAME.on || GAME.built.has(id)) return 'live';
  if(!canBuild(id)) return 'plot';
  /* the very first move deserves a different word: there is exactly one */
  return GAME.built.size <= 1 ? 'next1' : 'next';
}

function plotTag(node, d, unbuilt){
  const want = unbuilt ? plotStyle(d.id) : 'live';
  if(node.dataset.plot !== want){
    node.dataset.plot = want;
    node.classList.toggle('plot', want !== 'live');
    node.classList.toggle('next', want === 'next' || want === 'next1');
    const cta = want === 'next1' ? '最初の1手' : want === 'next' ? '建設できる' : '未建設';
    node.innerHTML = want === 'live'
      ? `${d.tag}<span class="cnt">${d.n}</span>`
      : `<span class="pn">${d.n}</span>${d.jp}<span class="cta">${cta}</span>`;
  }
  /* a plot has to be legible from the home view, where a built tag would have
     faded out on distance — you are being shown the whole site at once */
  if(unbuilt){ node.style.display = ''; node.style.opacity = 1; }
}

/* the arrival animation, once per entry into Campaign */
let pulseT = 0;
onCampaignChange(ev => {
  if(ev.type !== 'mode' || ev.mode !== 'campaign') return;
  document.body.classList.remove('plotpulse');
  clearTimeout(pulseT);
  /* one frame off, so removing and re-adding the class restarts the animation */
  requestAnimationFrame(()=>{
    document.body.classList.add('plotpulse');
    pulseT = setTimeout(()=> document.body.classList.remove('plotpulse'), 1000);
  });
});


/* ---------------------------------------------------------------- init */
function initMenu(){
  if(document.getElementById('menu')) return;

  const style = document.createElement('style');
  style.id = 'menuCss';
  style.textContent = CSS;
  document.head.appendChild(style);

  cardTitle.innerHTML = titleHtml();
  cardRoles.innerHTML = rolesHtml();
  el.appendChild(cardTitle);
  el.appendChild(cardRoles);
  document.body.appendChild(el);

  cardTitle.querySelector('#mSideDef').onclick = showRoles;
  cardTitle.querySelector('#mExplore').onclick = startExplore;
  cardTitle.querySelector('#mResume').onclick = resumeCampaign;
  cardTitle.querySelector('#mSkipNext').onclick = ev => {
    markSeen('title');
    ev.currentTarget.textContent = '次回はスキップします';
    ev.currentTarget.disabled = true;
  };
  cardRoles.querySelector('#mBack').onclick = showTitle;
  cardRoles.querySelector('#mStart').onclick = startDefence;
  cardRoles.querySelectorAll('.role').forEach(btn => btn.onclick = () => {
    picked = btn.dataset.role;
    markRoles();
  });

  /* Always a way back. It goes in the mode segment because that is where the
     other two entrances already live, and it inherits `.seg button`. This runs
     after ui.js has wired that segment, so nothing overwrites the handler. */
  const seg = document.getElementById('uiModeSeg');
  if(seg){
    const home = document.createElement('button');
    home.className = 'tohome';
    home.textContent = '↩ タイトル';
    home.title = 'タイトル画面に戻る';
    home.onclick = showTitle;
    seg.appendChild(home);
  }

  /* Escape closes it, but only once the title has been seen at least once —
     on a first visit there is nothing behind it to go back to. */
  addEventListener('keydown', ev => {
    if(ev.key !== 'Escape' || !el.classList.contains('show')) return;
    if(hasSeen('title')) hideMenu();
  });

  /* Deciding what to open is deferred one turn so main.js finishes its own
     init first: restoring campaign mode has to land on a built city. */
  setTimeout(()=>{
    const saved = menuPrefs();

    /* One-way migration, once: builds before the save layer kept "has the title
       been seen" in this key. Hand it to save.js and never read it again — the
       point of moving it was to stop having two writers, and a fallback that
       keeps reading the old field would leave the second one in place. */
    if(saved && saved.seen && !hasSeen('title')) markSeen('title');

    if(!hasSeen('title')){ showTitle(); return; }
    if(saved && saved.role !== undefined && knownRole(saved.role))
      picked = saved.role === null ? '' : saved.role;
    markRoles();
    if(saved && saved.mode === 'campaign'){
      setSide('defense');
      setUiMode('campaign');
      setRole(picked === '' ? null : picked);
      /* land where the ladder says you left off, not on scenario 1: setUiMode
         restarts GAME.scenario, which on a fresh load is the default one. */
      const id = resumeId();
      if(id && id !== GAME.scenario) startScenario(id);
    }
  }, 0);
}

window.__menu = {initMenu, showTitle, showRoles, hideMenu, menuPrefs, forgetMenu,
                 pick(id){ picked = id === null ? '' : id; markRoles(); },
                 startDefence, startExplore, resumeCampaign, resumeId,
                 renderProgress, plotStyle};

export {
  initMenu,
  showTitle,
  showRoles,
  hideMenu,
  menuPrefs,
  forgetMenu,
  plotTag,
  plotStyle
};
