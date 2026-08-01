/* PAGE — the full-page shell, and nothing else.
 *
 * GAME-DESIGN §5.5 says pages may be as many and as large as they need, with the
 * operations view as the only one-screen exception. This module owns the frame
 * they all share: `#page` in index.html, who is currently in it, and the one
 * Escape handler. It owns no content.
 *
 * It exists so the pages do not have to import each other. The debrief lives in
 * ui.js (it reads campaign state) and the setup flow lives in setup.js (it reads
 * the data layer); both drive the same frame, and neither can import the other
 * without closing a cycle. A shell with no content has no cycle to close.
 *
 * The API is declarative on purpose. Every page states its header, its title,
 * its body and its buttons in one call, so a page cannot half-render — which is
 * how the old overlay ended up with a stale title under fresh content.
 *
 *   openPage(name, spec)   spec: {kick, step, title, stamp, stampKind, body, foot, note}
 *                          foot: [{label, kind:'go'|'ghost', hidden, onClick}]
 *   closePage()            leaves whatever is behind it untouched
 *   currentPage()          the name, or null
 *   onPageClose(fn)        so a page can put the world back
 */
const el      = document.getElementById('page');
const elKick  = document.getElementById('pgKick');
const elStep  = document.getElementById('pgStep');
const elTitle = document.getElementById('pgTitle');
const elStamp = document.getElementById('pgStamp');
const elBody  = document.getElementById('pgBody');
const elFoot  = el && el.querySelector('.pgfoot');
const elNote  = document.getElementById('pgNote');

let open = null;
const closers = new Set();

/* one wordmark asset in the document, cloned rather than duplicated — the same
   discipline menu.js uses for the entrance cards */
if(el){
  const mark = document.querySelector('.brandbar svg');
  const head = el.querySelector('.pghead');
  if(mark && head && !head.querySelector('svg'))
    head.insertBefore(mark.cloneNode(true), head.firstChild);
}

const currentPage = () => open;
function onPageClose(fn){ closers.add(fn); return () => closers.delete(fn); }

function closePage(){
  if(!open) return;
  open = null;
  if(el) el.classList.remove('show');
  for(const fn of closers) fn();
}

/* Buttons are rebuilt from the spec every time. The alternative — reusing fixed
   nodes and toggling `hidden` — is what made the debrief's footer carry the
   previous page's handler, and a stale onClick on a visible button is the worst
   kind of bug to find. */
function renderFoot(foot, note){
  if(!elFoot) return;
  [...elFoot.querySelectorAll('button')].forEach(b => b.remove());
  const ref = elNote || null;
  for(const b of (foot || [])){
    if(!b || b.hidden) continue;
    const btn = document.createElement('button');
    btn.className = b.kind === 'go' ? 'pggo' : 'pgghost';
    btn.textContent = b.label;
    if(b.onClick) btn.onclick = b.onClick;
    elFoot.insertBefore(btn, ref);
  }
  if(elNote) elNote.innerHTML = note || '';
}

function openPage(name, spec){
  if(!el) return;
  const s = spec || {};
  open = name;
  if(elKick)  elKick.textContent  = s.kick || '';
  if(elStep)  elStep.textContent  = s.step || '';
  if(elTitle) elTitle.innerHTML   = s.title || '';
  if(elStamp){
    elStamp.className = 'pgstamp' + (s.stampKind ? ' ' + s.stampKind : '');
    elStamp.textContent = s.stamp || '';
    elStamp.hidden = !s.stamp;
  }
  if(elBody)  elBody.innerHTML    = s.body || '';
  renderFoot(s.foot, s.note);
  el.classList.add('show');
  el.scrollTop = 0;            /* a page always opens at its top */
}

if(el){
  addEventListener('keydown', ev => {
    if(ev.key === 'Escape' && open){ ev.stopPropagation(); closePage(); }
  }, true);
}

export { openPage, closePage, currentPage, onPageClose };
