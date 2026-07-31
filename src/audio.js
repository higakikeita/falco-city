/* AUDIO — the pipeline, heard.
 *
 * Every sound in here is synthesised from oscillators and one generated noise
 * buffer. That is not a purity exercise: the whole product is a single HTML
 * file you double-click (決定21), and any sample worth listening to would be
 * base64 in that file. Code is a few KB, so code it is.
 *
 * This module deliberately imports nothing. No THREE, no state, no DOM — so it
 * loads under Node, survives rAF being stopped, and cannot be the reason
 * anything else breaks. Callers push events in; it decides what to play and,
 * more importantly, what NOT to play.
 *
 * The mapping is meant to be read as the model, not as decoration:
 *
 *   priority   severity climbs → pitch falls, notes multiply, timbre roughens,
 *              consonance turns into a tritone. Four tiers, told apart by four
 *              independent dimensions so the difference survives a low volume
 *              setting and a laptop speaker.
 *   drop       a swallowed blip. NOT smoothed out: sustained drops are meant
 *              to turn into gravel, because that is what a node losing events
 *              deserves to sound like. Bounded, but unpleasant.
 *   build      three slabs landing, and the ladder climbs with each district,
 *              so building the pipeline literally goes up.
 *   detect     rises and is clean. miss falls, is dull, and beats slightly out
 *              of tune. Opposite in direction AND in timbre.
 *   layer      Sysdig arrives from above: a glide down from the top of the
 *              register onto a chord that swells underneath it.
 *
 * Default is muted, and the AudioContext is not created until someone asks for
 * sound — browsers block autoplay, and a suspended-but-alive context is still a
 * thread we have no reason to own.
 */

const LS_KEY = 'falcoCity.audio.v1';

/* ---------------------------------------------------------------- prefs */
let muted = true;
let volume = 0.55;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* resume()/suspend() hand back a promise that browsers reject freely (no user
   activation yet, context already gone). An unhandled rejection would land in
   window.__errs, which the build is checked against, so swallow it here. */
function quiet(p){ if(p && typeof p.catch === 'function') p.catch(() => {}); }

function readPrefs(){
  try {
    if(typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(typeof saved.muted === 'boolean') muted = saved.muted;
    if(typeof saved.volume === 'number') volume = Math.min(1, Math.max(0, saved.volume));
  } catch(e){ /* file:// and private mode can both refuse; defaults are fine */ }
}
function writePrefs(){
  try {
    if(typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_KEY, JSON.stringify({muted, volume}));
  } catch(e){ /* not worth an error for */ }
}
readPrefs();

/* ---------------------------------------------------------------- graph */
let ctx = null;         // created on first user gesture, never before
let master = null;      // volume + mute live here
let noiseBuf = null;
let sleepTimer = null;

/* When each scheduled voice is due to be finished, in wall-clock ms. This used
   to be a counter decremented in onended, which stalls: a suspended context
   never reaches a node's stop time, so the counter stuck high and gated the
   whole layer. A clock the browser cannot pause cannot get stuck. */
const liveUntil = [];
function noteVoice(endsInSec){ liveUntil.push(nowMs() + endsInSec * 1000); }
function liveVoices(){
  const t = nowMs();
  let k = 0;
  for(let i = 0; i < liveUntil.length; i++) if(liveUntil[i] > t) liveUntil[k++] = liveUntil[i];
  liveUntil.length = k;
  return k;
}

function ensureCtx(){
  if(ctx) return true;
  const Ctor = (typeof window !== 'undefined')
    && (window.AudioContext || window.webkitAudioContext);
  if(!Ctor) return false;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : gainTarget();
    /* a limiter, not for loudness: several districts can land on the same
       frame and the sum would clip */
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -9;
    lim.knee.value = 6;
    lim.ratio.value = 12;
    lim.attack.value = 0.004;
    lim.release.value = 0.13;
    master.connect(lim);
    lim.connect(ctx.destination);
  } catch(e){ ctx = null; master = null; return false; }
  return true;
}

/* 0.55 on the slider should be comfortable, not timid */
function gainTarget(){ return 0.9 * volume * volume + 0.05 * volume; }

function noiseBuffer(){
  if(noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 1.1);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for(let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/* ---------------------------------------------------------------- voices */
function envGain(t0, dur, peak, attack){
  const g = ctx.createGain();
  const a = attack === undefined ? 0.006 : attack;
  const top = Math.max(0.0004, peak);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(top, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, a + 0.02));
  return g;
}

/* one oscillator, optionally gliding, optionally through a moving lowpass */
function tone(cfg){
  const t0 = cfg.t0, dur = cfg.dur;
  const o = ctx.createOscillator();
  o.type = cfg.type || 'sine';
  o.frequency.setValueAtTime(cfg.f0, t0);
  if(cfg.f1 && cfg.f1 !== cfg.f0)
    o.frequency.exponentialRampToValueAtTime(Math.max(24, cfg.f1), t0 + (cfg.glide || dur));
  if(cfg.detune) o.detune.setValueAtTime(cfg.detune, t0);
  let node = o;
  if(cfg.lp){
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cfg.lp, t0);
    if(cfg.lp1) f.frequency.exponentialRampToValueAtTime(Math.max(60, cfg.lp1), t0 + dur);
    if(cfg.q) f.Q.value = cfg.q;
    o.connect(f); node = f;
  }
  const g = envGain(t0, dur, cfg.peak, cfg.attack);
  node.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
  noteVoice(t0 - ctx.currentTime + dur + 0.05);
  o.onended = () => { try { g.disconnect(); } catch(e){} };
}

/* filtered noise — impacts, cracks, the grit under a drop */
function noise(cfg){
  const buf = noiseBuffer();
  const t0 = cfg.t0, dur = cfg.dur;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = cfg.filter || 'bandpass';
  f.frequency.setValueAtTime(cfg.f0, t0);
  if(cfg.f1 && cfg.f1 !== cfg.f0)
    f.frequency.exponentialRampToValueAtTime(Math.max(40, cfg.f1), t0 + dur);
  f.Q.value = cfg.q === undefined ? 1 : cfg.q;
  const g = envGain(t0, dur, cfg.peak, cfg.attack === undefined ? 0.003 : cfg.attack);
  src.connect(f); f.connect(g); g.connect(master);
  const off = Math.random() * Math.max(0.01, buf.duration - dur - 0.05);
  src.start(t0, off, dur + 0.02);
  noteVoice(t0 - ctx.currentTime + dur + 0.05);
  src.onended = () => { try { g.disconnect(); } catch(e){} };
}

/* ---------------------------------------------------------------- throttle
   Four stages, because one is never enough at 1400 particles a frame:

   1. a per-kind minimum gap
   2. alerts inside a 110 ms window collapse to the most severe one — a burst
      containing a Critical must not be represented by a Notice
   3. a token bucket over every note start, so no combination of events can
      make the graph grow without bound
   4. repeat fatigue: the same priority over and over gets quieter, and
      recovers once it stops
*/
const GAP = { drop:0.045, build:0.06, detect:0.05, miss:0.05, layer:0.35 };
const ALERT_GAP = [0.20, 0.30, 0.42, 0.62];    // tier 0 (worst) is allowed to nag
const VOICE_CAP = 28;

const lastAt = {};
let tokens = 12, refillAt = nowMs();

function budget(cost, urgent){
  const t = nowMs();
  /* clamped both ways on purpose: a backgrounded tab must not bank an hour of
     tokens and spend them all on the frame it wakes up */
  const gapMs = Math.max(0, Math.min(2000, t - refillAt));
  tokens = Math.min(14, Math.max(-2, tokens) + gapMs * 0.010);   // 10 note starts / s
  refillAt = t;
  if(!urgent && liveVoices() > VOICE_CAP) return false;
  if(tokens < cost && !urgent) return false;
  tokens = Math.max(-2, tokens - cost);
  return true;
}
function gate(kind, gapSec){
  const t = nowMs();
  const prev = lastAt[kind] || 0;
  if(t - prev < gapSec * 1000) return false;
  lastAt[kind] = t;
  return true;
}

/* ---------------------------------------------------------------- priority
   sim.js currently ships Critical / Error / Warning / Notice, but Falco itself
   has eight levels and this model may well grow into them, so fold names onto
   the four tiers we actually voice. Unknown input lands on Warning. */
const TIER_BY_NAME = {
  emergency:0, alert:0, critical:0, crit:0,
  error:1, err:1,
  warning:2, warn:2,
  notice:3, informational:3, info:3, debug:3
};
function tierOf(p){
  if(typeof p === 'number' && isFinite(p)) return Math.min(3, Math.max(0, p | 0));
  if(typeof p === 'string'){
    const t = TIER_BY_NAME[p.trim().toLowerCase()];
    if(t !== undefined) return t;
  }
  return 2;
}

/* ---------------------------------------------------------------- alerts */
let pendTier = -1, pendCount = 0, pendTimer = null;
let lastTier = -1, sameRun = 0, lastAlertAt = 0;

function queueAlert(tier){
  if(pendTier < 0 || tier < pendTier) pendTier = tier;
  pendCount++;
  /* setTimeout, not the frame loop: the sound layer must still work when rAF
     is stopped (headless checks, background tab, a WebGL failure) */
  if(pendTimer === null && typeof setTimeout === 'function')
    pendTimer = setTimeout(flushAlert, 110);
}

function flushAlert(){
  pendTimer = null;
  const tier = pendTier, count = pendCount;
  pendTier = -1; pendCount = 0;
  if(tier < 0 || muted || !ctx) return;
  if(!gate('alert' + tier, ALERT_GAP[tier])) return;
  if(!budget(tier === 0 ? 3 : 2, tier === 0)) return;

  const t = nowMs();
  if(t - lastAlertAt > 2500 || tier !== lastTier) sameRun = 0; else sameRun++;
  lastAlertAt = t; lastTier = tier;

  /* the same rule firing forever should recede; a burst should not */
  const fatigue = Math.max(0.42, 1 / (1 + sameRun * 0.38));
  const density = Math.min(1.25, 1 + (count - 1) * 0.06);
  alertVoice(tier, fatigue * density);
}

function alertVoice(tier, mul){
  const t0 = ctx.currentTime + 0.012;
  if(tier === 3){
    /* Notice — one soft high tick. Present, ignorable, which is the point. */
    tone({t0, dur:0.13, f0:1244.5, type:'sine', peak:0.15 * mul});
  } else if(tier === 2){
    /* Warning — two notes down. You notice a shape, not just an event. */
    tone({t0,         dur:0.11, f0:932.3, type:'triangle', peak:0.19 * mul});
    tone({t0:t0+0.085, dur:0.17, f0:698.5, type:'triangle', peak:0.17 * mul});
  } else if(tier === 1){
    /* Error — three notes down with an edge on them. */
    tone({t0,          dur:0.10, f0:622.3, type:'square', lp:2400, lp1:1500, peak:0.13 * mul});
    tone({t0:t0+0.075, dur:0.10, f0:523.3, type:'square', lp:2200, lp1:1400, peak:0.13 * mul});
    tone({t0:t0+0.150, dur:0.24, f0:415.3, type:'square', lp:2000, lp1:900,  peak:0.14 * mul});
    noise({t0, dur:0.05, f0:2600, f1:1400, q:1.4, peak:0.06 * mul});
  } else {
    /* Critical — low, long, and a tritone against itself. Nothing else in the
       model is dissonant, so this cannot be mistaken for anything. */
    tone({t0, dur:0.62, f0:155.6, type:'sawtooth', lp:900, lp1:380, q:0.9, peak:0.20 * mul});
    tone({t0:t0+0.012, dur:0.55, f0:220.0, type:'sawtooth', lp:800, lp1:340, q:0.9,
          detune:-14, peak:0.13 * mul});
    tone({t0:t0+0.02, dur:0.46, f0:880, f1:330, type:'triangle', glide:0.42, peak:0.11 * mul});
    noise({t0, dur:0.09, f0:1900, f1:700, q:0.9, peak:0.13 * mul});
  }
}

/* ---------------------------------------------------------------- drops
   Drops are the one sound allowed to get worse. `grit` is a decaying count of
   recent drops: as it climbs the blip sinks and the noise under it opens up, so
   a node that is losing events sounds like one. The gap and the token bucket
   keep it from being unbounded — ugly is the goal, broken is not. */
let grit = 0, gritAt = 0;

function queueDrop(){
  if(muted || !ctx) return;
  const t = nowMs();
  grit = grit * Math.exp(-Math.max(0, t - gritAt) / 600) + 1;
  gritAt = t;
  if(!gate('drop', GAP.drop)) return;
  if(!budget(1)) return;
  const g = Math.min(1, grit / 10);
  const t0 = ctx.currentTime + 0.012;
  const f0 = (430 - 150 * g) * (0.94 + Math.random() * 0.12);   // jitter kills the comb
  tone({t0, dur:0.11, f0, f1:f0 * 0.34, type:'triangle', glide:0.09, peak:0.115});
  noise({t0, dur:0.085, f0:900 - 420 * g, f1:260, q:1.1 + g, peak:0.055 + 0.075 * g});
}

/* ---------------------------------------------------------------- the rest */
const LADDER = [130.8, 146.8, 164.8, 196.0, 220.0, 246.9, 293.7, 329.6, 392.0];

/* a district appears: three slabs land, and the ladder rises with each one */
function buildVoice(stepIdx){
  const root = LADDER[Math.min(LADDER.length - 1, Math.max(0, stepIdx | 0))];
  const t0 = ctx.currentTime + 0.012;
  const steps = [[0, root, 0.16], [0.075, root * 1.5, 0.16], [0.155, root * 2, 0.34]];
  for(const s of steps){
    tone({t0:t0 + s[0], dur:s[2], f0:s[1], type:'triangle', lp:1500, lp1:700, peak:0.17});
    noise({t0:t0 + s[0], dur:0.055, f0:420, f1:150, filter:'lowpass', q:0.7, peak:0.10});
  }
}

/* the attack chain, judged one row at a time. Rising and clean, or falling and
   sour — the two verdicts must not need a caption. */
function detectVoice(isResponse){
  const t0 = ctx.currentTime + 0.012;
  if(isResponse){
    /* containment is a different organ from detection: lower and firmer */
    tone({t0,          dur:0.13, f0:392.0, type:'square', lp:1300, lp1:800, peak:0.15});
    tone({t0:t0+0.10,  dur:0.28, f0:587.3, type:'square', lp:1600, lp1:900, peak:0.15});
    noise({t0:t0+0.10, dur:0.07, f0:520, f1:180, filter:'lowpass', peak:0.09});
    return;
  }
  tone({t0,          dur:0.12, f0:587.3, type:'triangle', peak:0.18});
  tone({t0:t0+0.09,  dur:0.24, f0:880.0, type:'triangle', peak:0.18});
  tone({t0:t0+0.115, dur:0.16, f0:1760.0, type:'sine', peak:0.06});
}
function missVoice(){
  const t0 = ctx.currentTime + 0.012;
  tone({t0, dur:0.34, f0:415.3, f1:349.2, type:'sawtooth', glide:0.30, lp:760, lp1:340, peak:0.17});
  tone({t0:t0+0.01, dur:0.30, f0:415.3, f1:349.2, type:'sawtooth', glide:0.30,
        lp:700, lp1:320, detune:-22, peak:0.11});      // the beat is the sourness
  noise({t0, dur:0.10, f0:300, f1:120, filter:'lowpass', peak:0.10});
}

/* the Sysdig platform lights up overhead: it descends onto you */
function layerVoice(){
  const t0 = ctx.currentTime + 0.012;
  tone({t0, dur:0.72, f0:1568.0, f1:392.0, type:'sine', glide:0.66, peak:0.10});
  for(const f of [523.3, 659.3, 784.0])
    tone({t0:t0 + 0.16, dur:0.95, f0:f, type:'sine', peak:0.055, attack:0.34});
  noise({t0:t0 + 0.10, dur:0.55, f0:5200, f1:2600, filter:'highpass', q:0.6,
         peak:0.035, attack:0.26});
}

/* ---------------------------------------------------------------- public */
/* Must be called from a user gesture (click / keydown). Safe to call again.
 * While muted this does nothing on purpose: an idle-but-running AudioContext is
 * a thread we would be paying for with nothing to play, so the context only
 * ever exists while sound is on. Its real use is the returning visitor whose
 * saved preference is "on" — the context still cannot be created until they
 * touch something, so hang this on the first gesture. */
function initAudio(){
  if(muted) return false;
  if(!ensureCtx()) return false;
  if(ctx.state !== 'running') { try { quiet(ctx.resume()); } catch(e){} }
  return true;
}

/* kind: 'alert' | 'drop' | 'build' | 'detect' | 'miss' | 'layer'
   opts: {priority} for alert, {step} for build, {response} for detect */
function play(kind, opts){
  if(muted || !ctx) return false;
  const o = opts || {};
  try {
    switch(kind){
      case 'alert': queueAlert(tierOf(o.priority === undefined ? o.prio : o.priority)); return true;
      case 'drop':  queueDrop(); return true;
      /* build / detect / miss / layer are one-per-click events the player is
         waiting for, so they are never starved by a storm of alerts and drops.
         Their per-kind gap is the only limit they need. */
      case 'build':
        if(!gate('build', GAP.build) || !budget(3, true)) return false;
        buildVoice(o.step === undefined ? 0 : o.step);
        return true;
      case 'detect':
        if(!gate('detect', GAP.detect) || !budget(2, true)) return false;
        detectVoice(!!o.response);
        return true;
      case 'miss':
        if(!gate('miss', GAP.miss) || !budget(2, true)) return false;
        missVoice();
        return true;
      case 'layer':
        if(!gate('layer', GAP.layer) || !budget(3, true)) return false;
        layerVoice();
        return true;
    }
  } catch(e){ /* never let a sound reach window.__errs */ }
  return false;
}

/* Per-frame hook. `parts` is sim.js's particle array; a particle entering
   state 2 is a rule match (with its priority) and state 1 is a ring-buffer
   drop, so the sound comes from the same transition the pixels come from
   rather than from a second, drifting source. Costs nothing while muted. */
let prevSt = null, needResync = true;

function tickAudio(parts){
  if(muted || !ctx || !parts) return;
  const n = parts.length;
  if(!prevSt || prevSt.length !== n){ prevSt = new Uint8Array(n); needResync = true; }
  if(needResync){
    /* the scan is skipped while muted, so on the way back in every particle
       looks like it just changed. Record, play nothing. */
    needResync = false;
    for(let i = 0; i < n; i++){ const p = parts[i]; prevSt[i] = p ? (p.st | 0) + 1 : 0; }
    return;
  }
  for(let i = 0; i < n; i++){
    const p = parts[i];
    if(!p) continue;
    const st = (p.st | 0) + 1;
    if(st === prevSt[i]) continue;
    prevSt[i] = st;
    if(st === 3) queueAlert(tierOf(p.prio | 0));
    else if(st === 2) queueDrop();
  }
}

/* campaign.js's change feed, translated. Pass GAME so this module keeps its
   zero imports: campaignAudio(ev, GAME). */
function campaignAudio(ev, game){
  if(muted || !ctx || !ev) return;
  const built = game && game.built;
  switch(ev.type){
    case 'build':
      play('build', {step: built ? built.size - 2 : 0});
      /* the platform overhead is a second event from the same click */
      if(ev.id === 'sysdig' && typeof setTimeout === 'function')
        setTimeout(() => play('layer'), 230);
      break;
    case 'reveal': {
      const rows = game && game.results;
      const row = rows && rows[(game.reveal | 0) - 1];
      if(!row) return;
      if(row.caught) play('detect', {response: !!row.response});
      else play('miss');
      break;
    }
    case 'mode':
      needResync = true;      // the world was rebuilt; do not replay it
      break;
  }
}

function setMuted(m){
  const next = !!m;
  muted = next;
  writePrefs();
  if(next){
    pendTier = -1; pendCount = 0;
    if(pendTimer !== null){ clearTimeout(pendTimer); pendTimer = null; }
    if(ctx && master){
      const t = ctx.currentTime;
      try {
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0, t + 0.08);
      } catch(e){}
      /* let the tails finish, then stop the context outright — muted must not
         mean "an audio thread still running for nothing" */
      if(sleepTimer !== null) clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        if(muted && ctx && ctx.state === 'running'){ try { quiet(ctx.suspend()); } catch(e){} }
      }, 450);
    }
    return true;
  }
  /* unmuting is the gesture that is allowed to create the context */
  if(sleepTimer !== null){ clearTimeout(sleepTimer); sleepTimer = null; }
  if(!ensureCtx()){ muted = true; return false; }
  needResync = true;
  try { if(ctx.state !== 'running') quiet(ctx.resume()); } catch(e){}
  try {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(gainTarget(), t + 0.10);
  } catch(e){}
  return true;
}
function toggleMuted(){ return setMuted(!muted); }

function setVolume(v){
  volume = Math.min(1, Math.max(0, +v || 0));
  writePrefs();
  if(ctx && master && !muted){
    try {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(gainTarget(), t + 0.08);
    } catch(e){}
  }
  return volume;
}

/* everything the UI needs to draw itself, in one call */
function audioState(){
  return {muted, volume, ready: !!ctx, running: !!ctx && ctx.state === 'running'};
}

export {
  initAudio,
  play,
  tickAudio,
  campaignAudio,
  setMuted,
  toggleMuted,
  setVolume,
  audioState
};
