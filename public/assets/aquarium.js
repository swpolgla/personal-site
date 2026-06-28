/* Aquarium — a self-contained aquarium scene with a live clock, day-night
   cycle, randomly-generated fish, and interactive set pieces.

   To ADD A FISH: append a config object to the FISH_SPECIES array below.
   Each field is documented above the array. No drawing code required — the
   engine composes body/tail/fin/pattern primitives from your choices.
*/
'use strict';

/* ============================================================
   1. FISH SPECIES REGISTRY  (edit me to add more fish!)
   ------------------------------------------------------------
   Fields:
     name        string id (unused for logic, for your reference)
     body        one of: 'torpedo'|'oval'|'round'|'diamond'|'long'|'teardrop'
     tail        one of: 'forked'|'round'|'crescent'|'whip'
     fins        one of: 'flowing'|'fan'|'forked'|'ribbon'|'spiky'|'none'
     pattern     one of: 'solid'|'stripes'|'spots'|'gradient'|'twotone'|'glow'
     palette     [c1, c2] colours (c2 optional; used by stripes/twotone/glow)
     glow        bool — emits bioluminescent halo (best at night)
     nocturnal  bool — tends to become common/visible only at night
     size        [min, max] body length in px (random per spawn)
     speed       [min, max] base swim speed multiplier
     depth       'top' | 'mid' | 'bottom' preferred depth band
     wobble      {freq, amp} tail-fin sin wave tuning
   ============================================================ */
const FISH_SPECIES = [
  { name: 'comet',     body:'torpedo', tail:'forked', fins:'flowing', pattern:'stripes',  palette:['#f4a259','#e76f51'], size:[20,34], speed:[0.6,1.0], depth:'mid',  wobble:{freq:0.12,amp:0.45} },
  { name: 'goldcap',   body:'oval',    tail:'forked', fins:'fan',     pattern:'gradient', palette:['#ffd86b','#e8843c'], size:[24,40], speed:[0.5,0.9], depth:'top',  wobble:{freq:0.10,amp:0.4}  },
  { name: 'angel',     body:'diamond', tail:'round',  fins:'fan',     pattern:'stripes',  palette:['#fde2c2','#c79a52'], size:[26,42], speed:[0.4,0.7], depth:'mid',  wobble:{freq:0.08,amp:0.5}  },
  { name: 'neon',      body:'torpedo', tail:'forked', fins:'ribbon',  pattern:'twotone',  palette:['#5fe0e0','#163a52'], size:[16,26], speed:[0.9,1.4], depth:'mid',  wobble:{freq:0.15,amp:0.5}, nocturnal:false },
  { name: 'lantern',   body:'teardrop',tail:'round',  fins:'flowing', pattern:'glow',     palette:['#9b8cff','#3a2a6a'], glow:true, size:[20,30], speed:[0.3,0.6], depth:'mid', wobble:{freq:0.09,amp:0.4}, nocturnal:true },
  { name: 'spectre',   body:'long',    tail:'whip',   fins:'ribbon',  pattern:'glow',     palette:['#67f0c0','#104a4a'], glow:true, size:[34,54], speed:[0.3,0.55],depth:'bottom',wobble:{freq:0.06,amp:0.5}, nocturnal:true },
  { name: 'koi',       body:'oval',    tail:'round',  fins:'flowing', pattern:'spots',    palette:['#ffffff','#f56a4a'], size:[28,46], speed:[0.4,0.7], depth:'top',  wobble:{freq:0.09,amp:0.42} },
  { name: 'rusty',     body:'torpedo', tail:'forked', fins:'spiky',   pattern:'twotone',  palette:['#c75b3a','#3a2018'], size:[22,36], speed:[0.6,1.1], depth:'bottom',wobble:{freq:0.13,amp:0.45} },
  { name: 'glasswing', body:'diamond', tail:'crescent',fins:'ribbon',  pattern:'gradient', palette:['#bfe8ff','#5a86b8'], size:[22,38], speed:[0.5,0.95],depth:'top',  wobble:{freq:0.11,amp:0.5}  },
  { name: 'puffer',    body:'round',   tail:'round',  fins:'fan',     pattern:'spots',    palette:['#e8c66a','#9a6b2a'], size:[26,42], speed:[0.3,0.55],depth:'bottom',wobble:{freq:0.07,amp:0.35} },
  { name: 'midnight',  body:'torpedo', tail:'forked', fins:'flowing', pattern:'gradient', palette:['#3a4a8a','#10183a'], size:[20,34], speed:[0.6,1.05],depth:'mid',  wobble:{freq:0.12,amp:0.48}, nocturnal:true },
  { name: 'sunfin',    body:'oval',    tail:'forked', fins:'spiky',   pattern:'stripes',  palette:['#ffd66b','#e0742c'], size:[20,32], speed:[0.7,1.2], depth:'top',  wobble:{freq:0.14,amp:0.5}  },
];

/* ============================================================
   2. UTILITIES
   ============================================================ */
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)];
const rgb = c => `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
const rgba = (c, a) => `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;

/* ============================================================
   3. CANVAS + STAGE SETUP
   ============================================================ */
const canvas = document.getElementById('aq');
const stage = document.querySelector('.aq-stage');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
let surfaceY = 0, sandY = 0; // water region bounds (px)
const TUNING = {
  fishCount: 22,
  avoidRadius: 95,   // px — how far fish feel a disturbance
  avoidStrength: 7,  // heading radians-ish influence
};

// — Whale rarity/size tuning (exposed for easy editing) —
// The whale is a rare, much larger creature that shares the fish[] array but
// uses a bespoke renderer. At most one is present at a time; it reappears at a
// small per-departure roll whenever a creature leaves the screen.
const WHALE_CHANCE = 0.05;          // 5% per respawn roll
const WHALE_LEN = [240, 360];      // body length px range
const WHALE_SPEED = [0.28, 0.45];  // base speed multiplier (×42 px/s)
const WHALE_AVOID_RADIUS = 140;     // gentle, large detection radius
const WHALE_AVOID_STRENGTH = 0.55;  // tiny response — majestic, not startled

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const r = stage.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  surfaceY = H * 0.07;
  sandY = H * 0.86;
  // adapt fish count for small screens
  TUNING.fishCount = (W < 640 || H < 520) ? 12 : 24;

  positionSetPieces();
}

/* ============================================================
   4. DAY-NIGHT PHASE MODEL
   ------------------------------------------------------------
   keyframes by fractional hour h ∈ [0,24). phaseParams(h)
   returns interpolated colours & intensities.
   ============================================================ */
const KEYS = [
  { h:0.0,  top:[6,9,24],    bot:[2,3,10],   amb:0.55, ambC:[4,8,22],   caust:0.00, shaft:0.00, plan:1.0 },
  { h:5.0,  top:[12,18,48],  bot:[5,7,20],   amb:0.45, ambC:[10,14,36], caust:0.10, shaft:0.15, plan:0.85 },
  { h:6.7,  top:[70,110,170],bot:[12,28,70], amb:0.18, ambC:[255,150,90],caust:0.35, shaft:0.50, plan:0.45 },
  { h:9.0,  top:[80,160,205],bot:[16,72,120],amb:0.00, ambC:[0,0,0],    caust:0.80, shaft:0.80, plan:0.15 },
  { h:13.0, top:[95,180,215],bot:[20,96,140],amb:0.00, ambC:[0,0,0],    caust:1.00, shaft:1.00, plan:0.05 },
  { h:17.0, top:[70,150,195],bot:[18,74,118],amb:0.05, ambC:[0,0,0],    caust:0.75, shaft:0.70, plan:0.18 },
  { h:19.0, top:[120,70,120],bot:[34,30,80], amb:0.20, ambC:[255,110,70],caust:0.40, shaft:0.55, plan:0.45 },
  { h:20.6, top:[36,40,86],  bot:[12,14,38], amb:0.40, ambC:[20,24,60], caust:0.15, shaft:0.20, plan:0.75 },
  { h:22.0, top:[12,16,40],  bot:[4,6,18],   amb:0.50, ambC:[8,10,28],  caust:0.02, shaft:0.05, plan:1.0  },
];

function phaseParams(h) {
  let a = KEYS[0], b = KEYS[KEYS.length-1];
  for (let i = 0; i < KEYS.length; i++) {
    if (KEYS[i].h <= h) { a = KEYS[i]; b = KEYS[(i+1) % KEYS.length]; }
  }
  let span = (b.h >= a.h) ? (b.h - a.h) : (b.h + 24 - a.h);
  let into = (h >= a.h) ? (h - a.h) : (h + 24 - a.h);
  let t = span ? clamp(into / span, 0, 1) : 0;
  return {
    top: mix3(a.top, b.top, t),
    bot: mix3(a.bot, b.bot, t),
    amb: lerp(a.amb, b.amb, t),
    ambC: mix3(a.ambC, b.ambC, t),
    caustics: lerp(a.caust, b.caust, t),
    shaft: lerp(a.shaft, b.shaft, t),
    plan: lerp(a.plan, b.plan, t),
    isDay: h >= 6.4 && h <= 19.2,
  };
}

/* ============================================================
   5. TIME MODEL  (real local time, plus helm override)
   ============================================================ */
const Time = {
  hour: 0,            // current scene hour ∈ [0,24)
  helmActive: false,  // when true, sceneClock advances from helmHour at a speed
  helmHour: 0,
  speed: 1,           // 1 / 60 / 2880 (day-in-30s demo when 2880)
  realFractionalHour(d = new Date()) {
    return d.getHours() + d.getMinutes()/60 + d.getSeconds()/3600 + d.getMilliseconds()/3600000;
  },
  sync() {
    if (!this.helmActive) this.hour = this.realFractionalHour();
  },
  advance(dt) {
    if (this.helmActive) this.hour = (this.hour + (dt * this.speed) / 3600) % 24;
    if (this.hour < 0) this.hour += 24;
  },
};

/* ============================================================
   6. INPUT — pointer disturbances + sand ripples
   ============================================================ */
const disturbances = [];
const ripples = [];
let pointer = { x: -999, y: -999, active: false };

function addDisturbance(x, y, r = TUNING.avoidRadius, strength = 1) {
  disturbances.push({ x, y, r, strength, life: 1 });
  if (disturbances.length > 60) disturbances.shift();
}

function stagePos(e) {
  const r = canvas.getBoundingClientRect();
  const p = (e.touches && e.touches[0]) || e;
  return { x: p.clientX - r.left, y: p.clientY - r.top };
}

let lastMove = 0;
function onMove(e) {
  const p = stagePos(e);
  pointer.x = p.x; pointer.y = p.y; pointer.active = true;
  const now = performance.now();
  if (now - lastMove > 40) { addDisturbance(p.x, p.y, TUNING.avoidRadius * 0.7, 0.5); lastMove = now; }
}
function onDown(e) {
  const p = stagePos(e);
  pointer.x = p.x; pointer.y = p.y; pointer.active = true;
  if (handleSceneryClick(p.x, p.y)) { e.stopPropagation(); return; } // set piece absorbed it
  addDisturbance(p.x, p.y, TUNING.avoidRadius * 1.1, 1);
  if (p.y > sandY - 60) ripples.push({ x: p.x, y: p.y, r: 4, max: rand(80,150), life: 1 });
  spawnBubbleAt(p.x, p.y, 3, true); // little click bubbles
}
function onUp() { pointer.active = false; }
function onLeave() { pointer.active = false; pointer.x = pointer.y = -999; }

/* ============================================================
   7. PARTICLES — bubbles & plankton (object-pooled)
   ============================================================ */
const bubbles = [];
function spawnBubble(x, y, n = 1, big = false) {
  for (let i = 0; i < n; i++) {
    bubbles.push({
      x: x + rand(-6,6), y, r: big ? rand(2.5,6) : rand(1.4,4),
      vy: -rand(28, 62), wob: rand(0,TAU), wobF: rand(1.2,2.4),
      life: 1, ring: big,
    });
  }
  if (bubbles.length > 240) bubbles.splice(0, bubbles.length - 240);
}
function spawnBubbleAt(x,y,n,big){ spawnBubble(x,y,n,big); }

const plankton = [];
function seedPlankton(n) {
  plankton.length = 0;
  for (let i = 0; i < n; i++) plankton.push({
    x: rand(0,W), y: rand(surfaceY, sandY),
    vx: rand(-6,6), vy: rand(-4,4),
    r: rand(0.5,1.8), ph: rand(0,TAU), sp: rand(0.5,2.5),
  });
}

function updateParticles(dt) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.y += b.vy * dt;
    b.x += Math.sin(b.wob) * 10 * dt;
    b.wob += b.wobF * dt;
    if (b.y < surfaceY + 6) { bubbles.splice(i,1); continue; }
  }
  for (const p of plankton) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.ph += p.sp * dt;
    if (p.x < 0) p.x += W; if (p.x > W) p.x -= W;
    if (p.y < surfaceY) p.y = surfaceY + rand(2,8);
    if (p.y > sandY) p.y = sandY - rand(2,8);
  }
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.r += 70 * dt; r.life -= dt * 0.8;
    if (r.life <= 0 || r.r > r.max) ripples.splice(i,1);
  }
  for (let i = disturbances.length - 1; i >= 0; i--) {
    disturbances[i].life -= dt * 1.7;
    if (disturbances[i].life <= 0) disturbances.splice(i,1);
  }
}

/* ============================================================
   8. FISH — drawing primitives + species behaviour
   ============================================================ */
function drawBodyPath(ctx, L, H, shape) {
  const hx = L/2, hh = H/2;
  ctx.beginPath();
  switch (shape) {
    case 'round': {
      const r = Math.max(hx, hh);
      ctx.arc(0, 0, r, 0, TAU);
      return;
    }
    case 'diamond': {
      ctx.moveTo(-hx, 0); ctx.quadraticCurveTo(0, -hh, hx, 0);
      ctx.quadraticCurveTo(0, hh, -hx, 0); ctx.closePath(); return;
    }
    case 'long': {
      ctx.moveTo(-hx, 0);
      ctx.bezierCurveTo(-hx*0.5, -hh*0.7, hx*0.5, -hh*0.7, hx, 0);
      ctx.bezierCurveTo( hx*0.5,  hh*0.7, -hx*0.5,  hh*0.7, -hx, 0);
      return;
    }
    case 'teardrop': {
      ctx.moveTo(-hx*0.7, -hh*0.5);
      ctx.quadraticCurveTo(hx*0.2, -hh*1.1, hx, 0);
      ctx.quadraticCurveTo(hx*0.2, hh*1.1, -hx*0.7, hh*0.5);
      ctx.quadraticCurveTo(-hx*1.1, 0, -hx*0.7, -hh*0.5);
      ctx.closePath(); return;
    }
    default: { // torpedo + oval: ellipse, torpedo a touch pointer at head
      ctx.moveTo(-hx, 0);
      ctx.bezierCurveTo(-hx, -hh, hx, -hh, hx, 0);
      ctx.bezierCurveTo( hx,  hh, -hx, hh, -hx, 0);
      return;
    }
  }
}

function drawTail(ctx, L, H, type, t) {
  const x = L/2;
  ctx.beginPath();
  const wob = Math.sin(t) * H * 0.18;
  switch (type) {
    case 'round':
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x+H*0.6, -H*0.55+wob, x+H*0.95, 0+wob);
      ctx.quadraticCurveTo(x+H*0.6,  H*0.55+wob, x, 0);
      break;
    case 'crescent':
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x+H*0.8, -H*0.7+wob, x+H*1.1, -H*0.1+wob);
      ctx.quadraticCurveTo(x+H*0.7,  0,        x+H*1.1,  H*0.1+wob);
      ctx.quadraticCurveTo(x+H*0.8,  H*0.7+wob, x, 0);
      break;
    case 'whip':
      for (let i=0;i<=6;i++){
        const px = x + i*(H*0.25); const py = Math.sin(t + i*0.6) * H*0.5 * (i/6);
        if (i===0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      for (let i=6;i>=0;i--){
        const px = x + i*(H*0.25); const py = Math.sin(t + i*0.6) * H*0.5 * (i/6) + H*0.04;
        ctx.lineTo(px, py);
      }
      break;
    default: { // forked
      ctx.moveTo(x, 0);
      ctx.lineTo(x + H*0.9, -H*0.7 + wob);
      ctx.lineTo(x + H*0.45, 0);
      ctx.lineTo(x + H*0.9,  H*0.7 + wob);
      ctx.closePath();
    }
  }
  ctx.fill();
}

function drawFin(ctx, L, H, type, t, side) {
  const hx = L/2, hh = H/2, wob = Math.sin(t) * H*0.08;
  ctx.beginPath();
  switch (type) {
    case 'fan':
      ctx.moveTo(0, -hh);
      ctx.quadraticCurveTo(-hx*0.2, -hh*1.6 + wob, hx*0.3, -hh);
      break;
    case 'spiky': {
      const baseY = -hh, top = -hh*1.9 + wob;
      ctx.moveTo(-hx*0.5, baseY);
      for (let i=0;i<=5;i++){ ctx.lineTo(-hx*0.5 + i*(hx*0.2), i%2? baseY: top); }
      ctx.lineTo(hx*0.4, baseY);
      break;
    }
    case 'ribbon': {
      ctx.moveTo(-hx*0.3, 0);
      ctx.bezierCurveTo(-hx*0.2, -hh*2.0+wob, hx*0.4, -hh*1.8+wob, hx*0.5, -hh*0.6);
      break;
    }
    case 'flowing':
      ctx.moveTo(-hx*0.6, -hh);
      ctx.bezierCurveTo(-hx*0.2, -hh*2.2+wob, hx*0.4, -hh*1.4+wob, hx*0.5, -hh*0.5);
      break;
    case 'forked':
      ctx.moveTo(-hx*0.3, -hh);
      ctx.lineTo(-hx*0.1, -hh*1.7+wob);
      ctx.lineTo(hx*0.3, -hh*0.6);
      break;
    default: return;
  }
  if (side === 'bottom') { ctx.closePath(); }
  ctx.fill();
}

function applyPattern(ctx, L, H, type, palette, glow, nightBoost, spots) {
  const hx = L/2, hh = H/2;
  ctx.save();
  drawBodyPath(ctx, L, H, 'oval'); ctx.clip();
  switch (type) {
    case 'stripes': {
      ctx.fillStyle = palette[0]; ctx.fillRect(-hx, -hh, L, H);
      ctx.fillStyle = palette[1] || '#000';
      const n = 5;
      for (let i=0;i<n;i++){
        ctx.globalAlpha = 0.7;
        ctx.fillRect(-hx + i*(L/n), -hh, L/n*0.35, H);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'spots': {
      ctx.fillStyle = palette[0]; ctx.fillRect(-hx,-hh,L,H);
      ctx.fillStyle = palette[1] || '#000';
      const pts = spots || [];
      for (let i = 0; i < Math.min(6, pts.length); i++) {
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(pts[i][0] * hx, pts[i][1] * hh, H * 0.12, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1; break;
    }
    case 'gradient': {
      const g = ctx.createLinearGradient(0,-hh,0,hh);
      g.addColorStop(0, palette[0]); g.addColorStop(1, palette[1] || palette[0]);
      ctx.fillStyle = g; ctx.fillRect(-hx,-hh,L,H); break;
    }
    case 'twotone': {
      ctx.fillStyle = palette[0]; ctx.fillRect(-hx,-hh,L,H);
      ctx.fillStyle = palette[1] || '#000'; ctx.fillRect(-hx, 0, L, hh); break;
    }
    case 'glow': {
      const g = ctx.createRadialGradient(0,0,0,0,0,Math.max(hx,hh));
      g.addColorStop(0, palette[0]); g.addColorStop(1, palette[1] || palette[0]);
      ctx.fillStyle = g; ctx.fillRect(-hx,-hh,L,H); break;
    }
    default: { ctx.fillStyle = palette[0]; ctx.fillRect(-hx,-hh,L,H); }
  }
  ctx.restore();
}

class Fish {
  constructor(spec) {
    this.spec = spec;
    this.L = rand(spec.size[0], spec.size[1]);
    this.H = this.L * rand(0.42, 0.62);
    this.baseSpeed = rand(spec.speed[0], spec.speed[1]) * 42;
    this.depth = spec.depth;
    this.depthBand();
    this.x = rand(0, W); this.y = rand(this.bandTop, this.bandBot);
    this.heading = rand(0, TAU);
    this.speed = this.baseSpeed;
    this.swimPhase = rand(0, TAU);
    this.wander = rand(0, TAU);
    this.wanderTimer = rand(0.4, 1.6);
    this.startled = 0;
    this.palette = spec.palette.slice();
    // Cached spot coordinates (fractions of body half-size) so spots don't
    // re-randomise every frame and shimmer. Stable per fish for its lifetime.
    this.spots = Array.from({ length: 7 }, () => [rand(-0.6, 0.6), rand(-0.55, 0.5)]);
  }
  depthBand() {
    const span = sandY - surfaceY;
    if (this.depth === 'top')    { this.bandTop = surfaceY + span*0.05; this.bandBot = surfaceY + span*0.42; }
    else if (this.depth === 'bottom'){ this.bandTop = surfaceY + span*0.58; this.bandBot = sandY - 12; }
    else                        { this.bandTop = surfaceY + span*0.30; this.bandBot = surfaceY + span*0.78; }
  }
  update(dt, phase) {
    // nocturnal fish only swim while it is dark
    let visible = true;
    if (this.spec.nocturnal) visible = !phase.isDay;
    // wander steering
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) { this.wander += rand(-0.9,0.9); this.wanderTimer = rand(0.6,2.2); }
    let desired = this.wander;
    // avoidance from disturbances
    let run = 0, ay = 0;
    const R = TUNING.avoidRadius;
    for (const d of disturbances) {
      const dx = this.x - d.x, dy = this.y - d.y;
      const dist = Math.hypot(dx, dy);
      const reach = R * d.life;
      if (dist < reach) {
        const f = (1 - dist / reach) * d.strength;
        run += f;
        if (dist > 0.01) { desired = Math.atan2(dy, dx); ay += f; }
      }
    }
    if (pointer.active) {
      const dx = this.x - pointer.x, dy = this.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      if (dist < R) {
        const f = (1 - dist/R);
        run += f;
        if (dist > 0.01) desired = Math.atan2(dy, dx);
      }
    }
    // blend heading
    this.heading = this.turnToward(this.heading, desired, dt * (3 + run*6));
    this.speed = this.baseSpeed * (1 + Math.min(run,2)*0.9) + (this.startled>0?40:0);
    this.startled = Math.max(0, this.startled - dt);
    if (run > 0.6) this.startled = 0.5;
    // move
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;
    // when fully off-screen, signal respawn (re-roll spawn weight when replaced)
    const m = Math.max(40, this.L);
    if (this.x < -m || this.x > W + m) return 'respawn';
    // depth soft bounds
    if (this.y < this.bandTop) { this.y += (this.bandTop - this.y) * 2 * dt; this.heading = this.heading < 0 ? this.heading : Math.atan2(Math.abs(Math.sin(this.heading)), Math.cos(this.heading)); }
    if (this.y > this.bandBot) { this.y -= (this.y - this.bandBot) * 2 * dt; }
    this.swimPhase += dt * (4 + this.speed*0.04) * this.spec.wobble.freq * 12;
    this._vis = visible;
  }
  turnToward(cur, target, maxStep) {
    let d = ((target - cur + Math.PI*3) % TAU) - Math.PI;
    d = clamp(d, -maxStep, maxStep);
    return cur + d;
  }
  draw(ctx, phase) {
    if (this._vis === false) return;
    const right = Math.cos(this.heading) >= 0;
    const wob = Math.sin(this.swimPhase) * this.spec.wobble.amp;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.sin(this.heading) * 0.25 * 0); // keep upright; sx flip for direction
    ctx.scale(right ? -1 : 1, 1);
    // glow halo
    if (this.spec.glow) {
      const ga = 0.35 + (phase.isDay?0:0.4);
      const g = ctx.createRadialGradient(0,0,0,0,0,this.L*0.9);
      g.addColorStop(0, rgba(hexToRgb(this.palette[0]), ga));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(-this.L, -this.L, this.L*2, this.L*2);
    }
    // body fill base (used by fin/tail)
    ctx.fillStyle = this.palette[1] ? this.palette[1] : this.palette[0];
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.8;
    // tail
    drawTail(ctx, this.L, this.H, this.spec.tail, this.swimPhase);
    // fins
    if (this.spec.fins !== 'none') {
      ctx.fillStyle = rgba(hexToRgb(this.palette[1]||this.palette[0]), 0.7);
      drawFin(ctx, this.L, this.H, this.spec.fins, this.swimPhase, 'top');
      ctx.save(); ctx.scale(1,-1); drawFin(ctx, this.L*0.7, this.H*0.7, this.spec.fins, this.swimPhase, 'bottom'); ctx.restore();
    }
    // body + pattern
    applyPattern(ctx, this.L, this.H, this.spec.pattern, this.palette, this.spec.glow, !phase.isDay, this.spots);
    drawBodyPath(ctx, this.L, this.H, this.spec.body);
    ctx.stroke();
    // eye
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-this.L*0.34, -this.H*0.12, this.H*0.12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#10131a'; ctx.beginPath(); ctx.arc(-this.L*0.36, -this.H*0.12, this.H*0.06, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ============================================================
   8b. WHALE — a rare, much larger blue whale with bespoke rendering.
   Shares the fish[] array and motion plumbing but draws its own silhouette
   (tapered body, horizontal flukes, pectoral fins, grooved belly) and reacts
   to disturbances only gently. Periodically emits a blowhole spout when near
   the surface.
   ============================================================ */
class Whale {
  constructor() {
    this.L = rand(WHALE_LEN[0], WHALE_LEN[1]);
    this.H = this.L * 0.22;                  // long & slim, unlike the chunky fish
    this.baseSpeed = rand(WHALE_SPEED[0], WHALE_SPEED[1]) * 42;
    // depth band — cruise the lower-mid water column
    const span = sandY - surfaceY;
    this.bandTop = surfaceY + span * 0.30;
    this.bandBot = sandY - this.H - 8;
    this.x = rand(0, W); this.y = rand(this.bandTop, this.bandBot);
    this.heading = rand(0, TAU);
    this.speed = this.baseSpeed;
    this.swimPhase = rand(0, TAU);
    this.wander = rand(0, TAU);
    this.wanderTimer = rand(2, 5);
    this._vis = true;
    this.spoutTimer = rand(4, 9);             // until next spout attempt (s)
    this.spouts = [];                        // active spout particles
  }
  update(dt, phase) {
    // wander steering — slow, dignified
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) { this.wander += rand(-0.18, 0.18); this.wanderTimer = rand(2.5, 6); }
    let desired = this.wander;
    // gentle disturbance response — large radius, tiny strength (no startled darting)
    let run = 0;
    for (const d of disturbances) {
      const dx = this.x - d.x, dy = this.y - d.y;
      const dist = Math.hypot(dx, dy);
      const reach = WHALE_AVOID_RADIUS * d.life;
      if (dist < reach) { const f = (1 - dist / reach) * d.strength; run += f; if (dist > 0.01) desired = Math.atan2(dy, dx); }
    }
    if (pointer.active) {
      const dx = this.x - pointer.x, dy = this.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      if (dist < WHALE_AVOID_RADIUS) { const f = (1 - dist / WHALE_AVOID_RADIUS); run += f; if (dist > 0.01) desired = Math.atan2(dy, dx); }
    }
    // gentle heading correction (much slower turn than fish)
    this.heading = this.turnToward(this.heading, desired, dt * (0.8 + run * WHALE_AVOID_STRENGTH));
    this.speed = this.baseSpeed * (1 + Math.min(run, 1) * 0.25);
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;
    // depth soft bounds
    if (this.y < this.bandTop) { this.y += (this.bandTop - this.y) * 1.5 * dt; }
    if (this.y > this.bandBot) { this.y -= (this.y - this.bandBot) * 1.5 * dt; }
    this.swimPhase += dt * (1.6 + this.speed * 0.012) * 6;
    // — blowhole spout — when cruising near the surface, periodically emit one
    this.spoutTimer -= dt;
    if (this.spoutTimer <= 0) {
      this.spoutTimer = rand(6, 12);
      if (this.y < surfaceY + 110) {
        // emit ~3 mist/droplet particles rising from the top of the head
        const hx = this.x + (this.headingIsRight() ? this.L * 0.36 : -this.L * 0.36);
        for (let i = 0; i < 4; i++) {
          this.spouts.push({
            x: hx + rand(-3, 3), y: this.y - this.H * 0.55,
            vx: rand(-6, 6), vy: -rand(40, 70),
            r: rand(3, 6), life: rand(0.6, 1.1),
          });
        }
      }
    }
    // tick spout particles
    for (let i = this.spouts.length - 1; i >= 0; i--) {
      const s = this.spouts[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy *= (1 + dt * 1.2); s.life -= dt;
      if (s.life <= 0) this.spouts.splice(i, 1);
    }
    // respawn when fully off-screen (wide margin so the long body clears)
    const margin = this.L * 0.7;
    if (this.x < -margin || this.x > W + margin) return 'respawn';
  }
  headingIsRight() { return Math.cos(this.heading) >= 0; }
  turnToward(cur, target, maxStep) {
    let d = ((target - cur + Math.PI * 3) % TAU) - Math.PI;
    d = clamp(d, -maxStep, maxStep);
    return cur + d;
  }
  draw(ctx, phase) {
    const right = this.headingIsRight();
    const lit = phase.isDay;
    // spout mist (drawn behind the body so the whale appears to be exhaling)
    for (const s of this.spouts) {
      const a = clamp(s.life, 0, 1) * 0.5;
      ctx.fillStyle = `rgba(220,235,245,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(clamp(Math.sin(this.heading) * 0.18, -0.16, 0.16));
    ctx.scale(right ? 1 : -1, 1);
    const L = this.L, Hb = this.H;
    // colour palette shifts subtly with phase
    const backTop = lit ? '#2f587a' : '#1f334a';
    const backMid = lit ? '#416f94' : '#2a4760';
    const belly = lit ? '#bfd0dc' : '#6e8392';

    // — body: tapered whale silhouette via beziers —
    const bg = ctx.createLinearGradient(0, -Hb, 0, Hb);
    bg.addColorStop(0, backTop);
    bg.addColorStop(0.44, backMid);
    bg.addColorStop(0.62, backMid);
    bg.addColorStop(1, belly);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, -Hb * 0.05);                              // blunt upper snout
    ctx.bezierCurveTo(L * 0.42, -Hb * 0.72, L * 0.08, -Hb * 0.98, -L * 0.24, -Hb * 0.82);
    ctx.bezierCurveTo(-L * 0.38, -Hb * 0.74, -L * 0.46, -Hb * 0.35, -L * 0.5, -Hb * 0.1);
    ctx.bezierCurveTo(-L * 0.52, -Hb * 0.04, -L * 0.52, Hb * 0.04, -L * 0.49, Hb * 0.11);
    ctx.bezierCurveTo(-L * 0.34, Hb * 0.55, -L * 0.02, Hb * 0.9, L * 0.3, Hb * 0.78);
    ctx.bezierCurveTo(L * 0.53, Hb * 0.7, L * 0.58, Hb * 0.22, L * 0.5, -Hb * 0.05);
    ctx.closePath(); ctx.fill();

    // — subtle rostrum and back mottling —
    ctx.strokeStyle = lit ? 'rgba(24,44,58,0.36)' : 'rgba(10,18,26,0.46)';
    ctx.lineWidth = 1.2;
    for (let m = 0; m < 5; m++) {
      const mx = L * 0.28 - m * L * 0.12;
      ctx.beginPath();
      ctx.moveTo(mx, -Hb * 0.78);
      ctx.quadraticCurveTo(mx - L * 0.02, -Hb * 0.2, mx - L * 0.06, Hb * 0.2);
      ctx.stroke();
    }
    ctx.strokeStyle = lit ? 'rgba(12,28,42,0.42)' : 'rgba(4,10,16,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, Hb * 0.02);
    ctx.bezierCurveTo(L * 0.34, Hb * 0.22, L * 0.12, Hb * 0.24, -L * 0.12, Hb * 0.18);
    ctx.stroke();

    // — flattened flukes with a central notch, attached by a narrow tail stock —
    const wob = Math.sin(this.swimPhase) * Hb * 0.22;
    ctx.fillStyle = lit ? '#355f82' : '#243b52';
    ctx.beginPath();
    ctx.ellipse(-L * 0.51, 0, L * 0.04, Hb * 0.16, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = backMid;
    ctx.beginPath();
    ctx.moveTo(-L * 0.52, 0);
    ctx.quadraticCurveTo(-L * 0.6, -Hb * 0.45 + wob, -L * 0.69, -Hb * 0.54 + wob);
    ctx.quadraticCurveTo(-L * 0.64, -Hb * 0.12 + wob * 0.3, -L * 0.55, -Hb * 0.03);
    ctx.quadraticCurveTo(-L * 0.64, Hb * 0.12 - wob * 0.3, -L * 0.69, Hb * 0.54 - wob);
    ctx.quadraticCurveTo(-L * 0.6, Hb * 0.45 - wob, -L * 0.52, 0);
    ctx.closePath(); ctx.fill();

    // — long pectoral paddle —
    ctx.fillStyle = lit ? '#345e80' : '#243c52';
    ctx.beginPath();
    ctx.moveTo(L * 0.14, Hb * 0.32);
    ctx.quadraticCurveTo(L * 0.01, Hb * 1.34, -L * 0.14, Hb * 1.02);
    ctx.quadraticCurveTo(-L * 0.04, Hb * 0.58, L * 0.14, Hb * 0.32);
    ctx.closePath(); ctx.fill();

    // — grooved belly lines (throat pleats) —
    ctx.strokeStyle = lit ? 'rgba(55,84,102,0.45)' : 'rgba(24,36,46,0.55)'; ctx.lineWidth = 1;
    for (let g = -3; g <= 3; g += 1) {
      ctx.beginPath();
      ctx.moveTo(L * 0.47, Hb * (0.22 + g * 0.04));
      ctx.bezierCurveTo(L * 0.24, Hb * (0.4 + g * 0.07), L * 0.02, Hb * (0.52 + g * 0.07), -L * 0.2, Hb * (0.44 + g * 0.05));
      ctx.stroke();
    }

    // blowhole mark on the top of the broad head.
    ctx.strokeStyle = 'rgba(8,18,28,0.45)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(L * 0.31, -Hb * 0.56); ctx.lineTo(L * 0.36, -Hb * 0.58); ctx.stroke();

    // — friendly but small eye —
    ctx.fillStyle = '#10131a';
    ctx.beginPath(); ctx.arc(L * 0.39, -Hb * 0.12, Hb * 0.055, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.arc(L * 0.405, -Hb * 0.14, Hb * 0.02, 0, TAU); ctx.fill();

    ctx.restore();
  }
}

function hexToRgb(h) {
  if (Array.isArray(h)) return h;
  const s = h.replace('#','');
  const n = parseInt(s.length===3 ? s.split('').map(c=>c+c).join('') : s, 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}

let fish = [];

// Returns true if a whale is currently in the school (at most one at a time).
function whalePresent() {
  for (const c of fish) if (c instanceof Whale) return true;
  return false;
}

// Spawn-weighted creature factory. Called for the initial seed and on each
// respawn. ~WHALE_CHANCE to spawn a whale, but never more than one at once.
function spawnCreature() {
  if (!whalePresent() && Math.random() < WHALE_CHANCE) return new Whale();
  return new Fish(pick(FISH_SPECIES));
}

function seedFish() {
  fish = [];
  for (let i = 0; i < TUNING.fishCount; i++) fish.push(spawnCreature());
}

/* ============================================================
   9. SET PIECES
   ============================================================ */
const scene = {
  kelp: [], ribbons: [], corals: [], anemones: [], jellies: [], starfish: [],
  vents: [], chest: null, anchor: null, wreck: null, wreckX: 0,
};

function positionSetPieces() {
  // wreck vignette is anchored in the BOTTOM-RIGHT corner
  scene.wreckX = clamp(W * 0.82, 160, W - 140);
  const sx = scene.wreckX, sy = sandY;
  // Wreck definition
  scene.wreck = {
    x: sx, y: sy,
    hullW: 220, hullH: 78, tilt: -0.22,        // stern-post leaning into the sand
    wheel: { ox: 60, oy: -82, r: 30, rot: 0 }, // offset relative to wreck origin
  };
  // Chest sits beside the hull (left of the wreck), resting on the sand surface
  scene.chest = { x: sx - 190, y: sy + 6, w: 74, h: 38, lidOpen: 0, target: 0, timer: rand(2,5), bubbleT: 0,
    // coin pile: [x, y] in body-local coords (y negative = up). Bottom row wide, top narrow.
    _coins: [
      [-24,-3],[-14,-3],[-4,-3],[6,-3],[16,-3],[24,-3],
      [-18,-9],[-8,-9],[2,-9],[12,-9],[20,-9],
      [-12,-15],[-2,-15],[8,-15],[16,-15],
      [-6,-21],[4,-21],[12,-21],
      [-2,-27],[8,-27],
      [3,-32]
    ] };
  // Anchor lies chained off the bow (far side, lower)
  scene.anchor = { x: sx - 40, y: sy + 8, rot: 0.18, spin: 0 };

  // Kelp clusters (not single sticks): clusters across the width, each with several blades
  scene.kelp = [];
  const clusters = Math.max(4, Math.floor(W / 180));
  for (let c = 0; c < clusters; c++) {
    const cx = (c + 0.5) * (W / clusters) + rand(-25, 25);
    if (Math.abs(cx - sx) < 120) continue; // keep clear of the wreck
    const blades = randInt(3, 6);
    for (let b = 0; b < blades; b++) {
      scene.kelp.push({
        x: cx + rand(-14, 14), h: rand(90, 170), w: rand(8, 13),
        ph: rand(0, TAU), sway: rand(14, 24), hue: rand(95, 140), bulbs: randInt(4, 7),
      });
    }
  }
  // Tape-grass translucent accents between clusters
  scene.ribbons = [];
  for (let i = 0; i < clusters * 2; i++) {
    scene.ribbons.push({ x: rand(20, W - 20), h: rand(70, 130), w: rand(20, 34), ph: rand(0, TAU) });
  }

  scene.corals = [];
  // Corals cradled around / onto the wreck
  const coralTypes = ['fan', 'tube', 'brain', 'fan', 'tube'];
  for (let i = 0; i < 5; i++) {
    scene.corals.push({
      x: rand(Math.max(40, sx - 170), Math.min(W - 40, sx + 170)),
      y: sy - 2, type: coralTypes[i], arms: randInt(3, 5), h: rand(34, 64),
      ph: rand(0, TAU), hue: pick([320, 12, 34, 280, 200]),
    });
  }
  scene.anemones = [];
  for (let i = 0; i < 3; i++) scene.anemones.push({ x: rand(60, W-60), y: sy-2, tent: 16, retract: 0, ph: rand(0,TAU), hue: pick([10,300,330,50]) });
  scene.starfish = [];
  for (let i = 0; i < 3; i++) scene.starfish.push({ x: rand(40,W-40), y: sy-2, dir: pick([-1,1]), star: 0, ph: rand(0,TAU), hue: rand(15,55) });
  scene.vents = [];
  for (let i = 0; i < 2; i++) scene.vents.push({ x: rand(80, W-80) , y: sy-2, on: Math.random()<0.5, t: 0 });

  scene.jellies = [];
  for (let i = 0; i < 4; i++) scene.jellies.push({
    x: rand(0, W), y: rand(surfaceY+40, sandY-120),
    vy: rand(4, 10), ph: rand(0,TAU), r: rand(16,26), retract: 0, hue: pick([280,200,320,160]),
  });
  seedPlankton(60);
}

/* ----- scenery click handling (returns true if absorbed) ----- */
function wreck() { return scene.wreck; }
function wheelScreenPos() {
  const w = wreck();
  const wx = w.x + w.wheel.ox * Math.cos(w.tilt) - w.wheel.oy * Math.sin(w.tilt);
  const wy = w.y + w.wheel.ox * Math.sin(w.tilt) + w.wheel.oy * Math.cos(w.tilt);
  return { x: wx, y: wy, r: w.wheel.r };
}
function anchorScreenPos() {
  const a = scene.anchor;
  return { x: a.x, y: a.y };
}
function handleSceneryClick(x, y) {
  const chest = scene.chest;
  if (x > chest.x - chest.w * 0.65 && x < chest.x + chest.w * 0.65 && y > chest.y - chest.h * 2.4 && y < chest.y + 10) {
    chest.target = chest.target > 0.4 ? 0 : 1;
    chest.timer = rand(chest.target ? 2.2 : 3.5, chest.target ? 4.2 : 6.2);
    ripples.push({ x: chest.x, y: chest.y, r: 4, max: 52, life: 1 });
    spawnBubble(chest.x + rand(-12, 12), chest.y - chest.h, 5, true);
    return true;
  }
  const wp = wheelScreenPos();
  if (Math.hypot(x - wp.x, y - wp.y) < wp.r + 8) {
    if (!Time.helmActive) openHelm();
    return true;
  }
  const ap = anchorScreenPos();
  if (Math.hypot(x - ap.x, y - ap.y) < 36) { scene.anchor.spin = 6; return true; } // click → flourish
  for (const v of scene.vents) {
    if (Math.abs(x - v.x) < 20 && Math.abs(y - v.y) < 18) { v.on = !v.on; ripples.push({x:v.x,y:v.y,r:4,max:60,life:1}); return true; }
  }
  for (const s of scene.starfish) {
    if (Math.abs(x - s.x) < 22 && Math.abs(y - s.y) < 18) { s.dir *= -1; s.star = 1; return true; }
  }
  return false;
}

/* ----- update set pieces ----- */
function updateSetPieces(dt, phase) {
  const t = Time.hour;
  // chest
  const c = scene.chest;
  c.timer -= dt;
  if (c.timer <= 0) { c.target = c.target > 0.4 ? 0 : 1; c.timer = rand(c.target?1.5:3, c.target?2.6:5); }
  c.lidOpen += (c.target - c.lidOpen) * dt * 3;
  if (c.lidOpen > 0.6 && Math.random() < dt * 3) spawnBubble(c.x + rand(-10,10), c.y - c.h, 2);
  // anchor spin decay (impulse on click then ease back to rest)
  scene.anchor.spin *= (1 - dt * 2.0);
  scene.anchor.rot += scene.anchor.spin * dt;
  // wheel ambient rotation
  if (!Time.helmActive) scene.wreck.wheel.rot += dt * 0.18;
  // kelp / corals / anemones handled in draw; anemone retract decays here
  for (const a of scene.anemones) a.retract = Math.max(0, a.retract - dt);
  // jellies drift
  for (const j of scene.jellies) {
    j.ph += dt * 1.2;
    j.y -= j.vy * dt; j.x += Math.sin(j.ph*0.5)*4*dt;
    if (j.y < surfaceY + 30) j.y = sandY - 30;
    if (j.x<0) j.x+=W; if(j.x>W) j.x-=W;
    j.retract = Math.max(0, j.retract - dt);
  }
  // starfish crawl
  for (const s of scene.starfish) { s.x += s.dir * 5 * dt; s.star = Math.max(0, s.star - dt*2); if (s.x<-10) s.x=W+10; if(s.x>W+10) s.x=-10; }
  // vents bubbles
  for (const v of scene.vents) {
    v.t += dt;
    if (v.on && v.t > 0.25) { spawnBubble(v.x + rand(-4,4), v.y, 1); v.t = 0; }
  }
}

function hoverScenery(x, y) {
  // anemone + jelly retract on hover
  for (const a of scene.anemones) if (Math.abs(x-a.x) < 26) a.retract = 1;
  for (const j of scene.jellies) if (Math.hypot(x-j.x, y-j.y) < j.r+10) j.retract = 1;
}

/* ----- draw set pieces ----- */
function drawBackground(ctx, phase) {
  // water gradient fills the ENTIRE stage so sand waves can never reveal black gaps
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(phase.top));
  g.addColorStop(0.5, rgb(mix3(phase.top, phase.bot, 0.55)));
  g.addColorStop(1, rgb(phase.bot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // above-surface sky tint
  ctx.fillStyle = rgba(phase.top, 0.5);
  ctx.fillRect(0, 0, W, surfaceY);

  // light shafts (day)
  if (phase.shaft > 0.02) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const beams = 5;
    for (let i = 0; i < beams; i++) {
      const x = (i+0.5)/beams * W + Math.sin(Time.hour*0.7 + i)*30;
      const w = 50 + i*18;
      const grd = ctx.createLinearGradient(x, surfaceY, x + w*0.4, sandY);
      grd.addColorStop(0, rgba(phase.ambC[0]===0?[255,250,210]:phase.ambC, 0.14*phase.shaft));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(x, surfaceY); ctx.lineTo(x+w, surfaceY); ctx.lineTo(x+w*1.6, sandY); ctx.lineTo(x+w*0.4, sandY); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // sun or moon on surface arc
  drawSunMoon(ctx, phase);
}

function drawSunMoon(ctx, phase) {
  const h = Time.hour;
  const isDay = h >= 6.4 && h <= 19.2;
  // position along arc
  let frac;
  if (isDay) frac = clamp((h - 6.4) / (19.2 - 6.4), 0, 1);
  else { const hn = h < 6.4 ? h + 24 : h; frac = clamp((hn - 19.2) / ((6.4+24) - 19.2), 0, 1); }
  const x = frac * W;
  const y = surfaceY * 0.45 - Math.sin(frac*Math.PI) * (H*0.05);
  ctx.save();
  if (isDay) {
    const gg = ctx.createRadialGradient(x,y,0,x,y,46);
    gg.addColorStop(0,'rgba(255,240,180,0.95)'); gg.addColorStop(0.4,'rgba(255,210,120,0.6)'); gg.addColorStop(1,'rgba(255,210,120,0)');
    ctx.fillStyle=gg; ctx.beginPath(); ctx.arc(x,y,46,0,TAU); ctx.fill();
    ctx.fillStyle='#fff3c8'; ctx.beginPath(); ctx.arc(x,y,13,0,TAU); ctx.fill();
  } else {
    const gg = ctx.createRadialGradient(x,y,0,x,y,38);
    gg.addColorStop(0,'rgba(220,230,255,0.85)'); gg.addColorStop(1,'rgba(220,230,255,0)');
    ctx.fillStyle=gg; ctx.beginPath(); ctx.arc(x,y,38,0,TAU); ctx.fill();
    ctx.fillStyle='#dfe7ff'; ctx.beginPath(); ctx.arc(x,y,11,0,TAU); ctx.fill();
    ctx.fillStyle = rgba(rgb(phase.top),0.7); ctx.beginPath(); ctx.arc(x+4,y-2,9,0,TAU); ctx.fill();
  }
  ctx.restore();
}

function drawSurface(ctx, phase) {
  // animated wavy top
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, surfaceY);
  for (let x = 0; x <= W; x += 8) {
    const y = surfaceY + Math.sin(x*0.02 + Time.hour*1.5) * 3 + Math.sin(x*0.05) * 1.5;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, 0); ctx.lineTo(0,0); ctx.closePath();
  ctx.fillStyle = rgba(phase.top, 0.55);
  ctx.fill();
  // highlight line
  ctx.strokeStyle = rgba([255,255,255], 0.18 * (1-phase.amb)); ctx.lineWidth=1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 8) {
    const y = surfaceY + Math.sin(x*0.02 + Time.hour*1.5) * 3;
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.restore();
}

// Sand-surface height at a given x (matches the wavy top drawn in drawSand).
// Kelp and other set pieces anchor to this so no gap opens at ripple troughs.
function sandTopY(x) {
  return sandY + Math.sin(x * 0.018) * 5 + Math.sin(x * 0.05 + 1.3) * 2 + 3;
}

function drawSand(ctx, phase) {
  ctx.save();
  const g = ctx.createLinearGradient(0, sandY - 4, 0, H);
  const lit = phase.isDay;
  g.addColorStop(0, lit ? 'rgb(206,176,118)' : 'rgb(64,56,42)');
  g.addColorStop(0.45, lit ? 'rgb(176,142,92)' : 'rgb(50,44,34)');
  g.addColorStop(1, lit ? 'rgb(132,104,68)' : 'rgb(32,26,22)');
  ctx.fillStyle = g;
  // wavy sand top; drawn deep enough to always overlap the water filling
  ctx.beginPath();
  ctx.moveTo(0, sandTopY(0));
  for (let x = 0; x <= W; x += 14) {
    ctx.lineTo(x, sandTopY(x));
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  // ripples in the sand (tap feedback)
  for (const r of ripples) {
    ctx.strokeStyle = `rgba(255,255,255,${0.3 * r.life})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.4, 0, 0, TAU); ctx.stroke();
  }
  // scattered pebbles
  ctx.fillStyle = lit ? 'rgba(120,96,64,0.5)' : 'rgba(60,52,42,0.6)';
  for (let i = 0; i < 22; i++) {
    const px = (i * 137.5) % W, py = sandY + 14 + ((i * 53) % 36);
    ctx.beginPath(); ctx.ellipse(px, py, 3 + (i % 4), 2, (i % 3), 0, TAU); ctx.fill();
  }
  // soft contact shadow under the wreck
  const w = scene.wreck;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(w.x, w.y + 4, w.hullW * 0.62, 14, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawForegroundSandDetails(ctx, phase) {
  const lit = phase.isDay;
  const sand = lit ? 'rgba(210,180,122,0.92)' : 'rgba(66,58,44,0.92)';
  const shadow = 'rgba(0,0,0,0.22)';
  const c = scene.chest;
  const w = scene.wreck;
  const a = scene.anchor;

  ctx.save();
  // Chest half-buried lip.
  ctx.fillStyle = shadow;
  ctx.beginPath(); ctx.ellipse(c.x, c.y + 2, c.w * 0.58, 5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = sand;
  ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, c.w * 0.52, 4.4, 0, Math.PI, TAU); ctx.fill();

  // Wreck and anchor have smaller local mounds so they sit in the substrate.
  ctx.fillStyle = sand;
  ctx.beginPath(); ctx.ellipse(w.x - 8, w.y + 1, w.hullW * 0.46, 8, 0, Math.PI, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(a.x, a.y + 4, 30, 5, 0, Math.PI, TAU); ctx.fill();

  ctx.fillStyle = lit ? 'rgba(120,96,64,0.42)' : 'rgba(42,36,28,0.55)';
  for (const [px, py, r] of [[c.x - 22, c.y + 4, 2.4], [c.x + 28, c.y + 3, 1.8], [a.x + 18, a.y + 5, 2.2], [w.x - 72, w.y + 5, 2]]) {
    ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.62, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/* ----- Kelp forest (tapered bezier blades, clustered, two-tone, serrated) ----- */
function drawKelp(ctx, phase) {
  const t = sceneT;
  const lit = phase.isDay;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const k of scene.kelp) {
    const baseX = k.x, baseY = sandTopY(k.x) + 2; // seat the base just inside the wavy sand surface
    // build a tapered blade from base to tip
    const sway = k.sway;
    ctx.beginPath();
    ctx.moveTo(baseX - k.w/2, baseY);
    const current = Math.sin(t * 0.8 + k.ph) * sway * 0.22 + Math.sin(t * 1.35 + k.ph * 0.7) * sway * 0.08;
    const tipX = baseX + current;
    const tipY = baseY - k.h;
    const midX = baseX + Math.sin(t * 0.7 + k.ph + 0.5) * sway * 0.12;
    const midY = baseY - k.h * 0.5;
    ctx.bezierCurveTo(baseX - k.w/3, baseY - k.h*0.3, midX - k.w/4, midY, tipX - 1, tipY);
    ctx.bezierCurveTo(midX + k.w/4, midY, baseX + k.w/3, baseY - k.h*0.3, baseX + k.w/2, baseY);
    ctx.closePath();
    const grd = ctx.createLinearGradient(baseX, baseY, baseX, baseY - k.h);
    const sat = lit ? 55 : 35, topL = lit ? 42 : 26, botL = lit ? 18 : 12;
    grd.addColorStop(0, `hsl(${k.hue},${sat}%,${botL}%)`);
    grd.addColorStop(0.6, `hsl(${k.hue},${sat}%,${topL}%)`);
    grd.addColorStop(1, `hsl(${k.hue},${sat+10}%,${Math.min(70, topL+24)}%)`);
    ctx.fillStyle = grd; ctx.fill();
    // serrated leaflets along the edges
    ctx.strokeStyle = `hsla(${k.hue},${sat}%,${topL-6}%,0.7)`; ctx.lineWidth = 1.2;
    for (let b = 1; b < k.bulbs; b++) {
      const f = b / k.bulbs;
      const lx = baseX + Math.sin(t * 0.8 + k.ph + f * 1.5) * sway * 0.22 * f;
      const ly = baseY - k.h * f;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx - 5*f - 2, ly - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 5*f + 2, ly - 4); ctx.stroke();
    }
  }
  // translucent ribbon-grass accents
  for (const r of scene.ribbons) {
    const tipX = r.x + Math.sin(sceneT * 0.65 + r.ph) * r.w * 0.24;
    ctx.fillStyle = `rgba(${phase.isDay?'120,160,90':'40,70,50'},0.25)`;
    ctx.beginPath();
    const rBaseY = sandTopY(r.x) + 2;
    ctx.moveTo(r.x - r.w/2, rBaseY);
    ctx.quadraticCurveTo(r.x + r.w/3, rBaseY - r.h*0.5, tipX, rBaseY - r.h);
    ctx.quadraticCurveTo(r.x - r.w/3, rBaseY - r.h*0.5, r.x + r.w/2, rBaseY);
    ctx.closePath(); ctx.fill();
  }
}

/* ----- Corals: fan / tube / brain branching ----- */
function drawCorals(ctx, ph) {
  const lit = ph.isDay;
  const tone = (h, l) => `hsl(${h},${lit?65:50}%,${lit?l:l-12}%)`;
  for (const c of scene.corals) {
    const pulse = 1 + Math.sin(c.ph) * 0.05;
    ctx.save(); ctx.translate(c.x, sandTopY(c.x));
    if (c.type === 'fan') {
      ctx.strokeStyle = tone(c.hue, 55); ctx.lineWidth = 4; ctx.lineCap = 'round';
      drawFan(ctx, 0, 0, -Math.PI/2, c.h*0.55*pulse, 4, c.hue, lit);
    } else if (c.type === 'tube') {
      ctx.fillStyle = tone(c.hue, 50);
      for (let i = 0; i < c.arms; i++) {
        const dx = (i - (c.arms-1)/2) * 6;
        const th = c.h * (0.7 + (i % 3) * 0.12) * pulse;
        ctx.beginPath();
        ctx.moveTo(dx - 4, 0); ctx.quadraticCurveTo(dx - 4, -th, dx, -th);
        ctx.quadraticCurveTo(dx + 4, -th, dx + 4, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = tone(c.hue, 35); ctx.beginPath(); ctx.ellipse(dx, -th, 3.5, 2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = tone(c.hue, 50);
      }
    } else { // brain coral — meandering mound
      ctx.fillStyle = tone(c.hue, 48);
      ctx.beginPath(); ctx.ellipse(0, -c.h*0.25, c.h*0.55, c.h*0.45, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = tone(c.hue, 30); ctx.lineWidth = 2;
      for (let r = 0; r < 4; r++) {
        ctx.beginPath();
        for (let a = 0; a <= TAU; a += 0.3) {
          const rr = c.h*0.45 * (0.6 + r*0.1);
          const wob = Math.sin(a*5 + r) * 3;
          const px = Math.cos(a)*(rr + wob), py = -c.h*0.25 + Math.sin(a)*(rr*0.55 + wob);
          a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
function drawFan(ctx, x, y, ang, len, depth, hue, lit) {
  if (len < 3 || depth <= 0) {
    ctx.fillStyle = `hsl(${hue},${lit?70:55}%,${lit?72:60}%)`;
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill();
    return;
  }
  const nx = x + Math.cos(ang) * len * 0.5;
  const ny = y + Math.sin(ang) * len * 0.5;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
  drawFan(ctx, nx, ny, ang - 0.4, len * 0.7, depth - 1, hue, lit);
  drawFan(ctx, nx, ny, ang + 0.4, len * 0.7, depth - 1, hue, lit);
}

function drawAnemones(ctx, phase) {
  const lit = phase.isDay;
  for (const a of scene.anemones) {
    const ay = sandTopY(a.x);
    const retract = a.retract;
    // bulbous base
    ctx.fillStyle = `hsla(${a.hue}, ${lit?60:45}%, ${lit?55:38}%, 0.85)`;
    ctx.beginPath(); ctx.ellipse(a.x, ay, 16, 11, 0, 0, TAU); ctx.fill();
    // tentacles (use ay as the anchor)
    for (let i = 0; i < a.tent; i++) {
      const ang = (i/a.tent) * TAU;
      const phO = i * 0.4;
      const len = (26 + Math.sin(a.ph + phO) * 6) * (1 - retract*0.85);
      const grd = ctx.createLinearGradient(a.x, ay, a.x + Math.cos(ang)*len, ay - len);
      grd.addColorStop(0, `hsla(${a.hue},70%,${lit?58:42}%,0.9)`);
      grd.addColorStop(1, `hsla(${a.hue},85%,${lit?72:55}%,0.6)`);
      ctx.strokeStyle = grd; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x + Math.cos(ang)*6, ay - 3);
      const wob = Math.sin(a.ph*1.3 + phO) * 4;
      ctx.quadraticCurveTo(a.x + Math.cos(ang)*len*0.6 + wob, ay - len*0.55, a.x + Math.cos(ang)*len + wob*0.5, ay - len);
      ctx.stroke();
    }
    // mouth disk
    ctx.fillStyle = `hsla(${a.hue}, 60%, 30%, 1)`; ctx.beginPath(); ctx.arc(a.x, ay-3, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = `hsla(${a.hue}, 70%, 50%, 1)`; ctx.beginPath(); ctx.arc(a.x, ay-3, 2.4, 0, TAU); ctx.fill();
  }
}

function drawStarfish(ctx, phase) {
  for (const s of scene.starfish) {
    const lift = s.star * 6;
    const sy = sandTopY(s.x);
    // soft shadow on the sand
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(s.x, sy + 2, 10, 3, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(s.x, sy - lift); ctx.rotate(s.star * Math.PI); ctx.scale(s.dir, 1);
    ctx.fillStyle = `hsl(${s.hue}, 70%, ${phase.isDay ? 58 : 42}%)`;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const ang = i/5*TAU - Math.PI/2;
      ctx.lineTo(Math.cos(ang)*9, Math.sin(ang)*9);
      ctx.lineTo(Math.cos(ang + Math.PI/5) * 4, Math.sin(ang + Math.PI/5) * 4);
    }
    ctx.closePath(); ctx.fill();
    // texture dots
    ctx.fillStyle = `hsla(${s.hue}, 70%, ${phase.isDay ? 44 : 30}%, 0.85)`;
    for (let i = 0; i < 5; i++) {
      const ang = i/5*TAU - Math.PI/2;
      ctx.beginPath(); ctx.arc(Math.cos(ang)*4, Math.sin(ang)*4, 1.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

/* ----- Treasure chest — stylized pirate chest; lid tilts BACK about its rear edge ----- */
// Geometric model (front elevation): the body is a rounded wood box with iron
// bands. The lid is a domed cap that sits on top. To open, the lid pivots
// about its BACK edge (the top-back of the body). In this 2D front view the
// hinge line remains fixed while the front lip rises and the dome foreshortens.
// A dark underside connects the two so the lid reads as attached, not floating.
function drawChest(ctx, phase) {
  const c = scene.chest;
  ctx.save(); ctx.translate(c.x, c.y);
  const W = c.w, H = c.h;
  const eased = 1 - Math.pow(1 - c.lidOpen, 3);
  const theta = eased * (Math.PI / 2.25);   // up to ~80°
  const sinT = Math.sin(theta);
  const lit = phase.isDay;
  const lidW = W + 8;
  const lidH = H * 0.52;
  const hingeY = -H;

  // — ground shadow —
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(0, 2, W * 0.6, 6, 0, 0, TAU); ctx.fill();

  const reveal = clamp(eased * 1.5, 0, 1);

  // — BODY: rounded wooden box with iron bands + rivets + corner brackets —
  const bodyGrad = ctx.createLinearGradient(0, -H, 0, 0);
  bodyGrad.addColorStop(0, lit ? '#6b4a26' : '#50361c');
  bodyGrad.addColorStop(1, lit ? '#4a2f17' : '#3a2410');
  ctx.fillStyle = bodyGrad;
  roundRectH(ctx, -W/2, -H, W, H, 5);
  ctx.strokeStyle = 'rgba(40,24,10,0.5)'; ctx.lineWidth = 1;
  for (let g = -1; g <= 1; g += 1) {
    ctx.beginPath(); ctx.moveTo(-W/2 + 4, g * 10); ctx.lineTo(W/2 - 4, g * 10 + 1.5); ctx.stroke();
  }
  ctx.fillStyle = lit ? '#2a2330' : '#1c1822';
  ctx.fillRect(-W/2, -H * 0.78, W, 4);
  ctx.fillRect(-W/2, -H * 0.22, W, 4);
  ctx.fillStyle = lit ? '#7a7588' : '#4a4658';
  for (let i = 0; i < 5; i++) {
    const rx = -W/2 + 8 + i * (W - 16) / 4;
    ctx.beginPath(); ctx.arc(rx, -H * 0.74, 1.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(rx, -H * 0.18, 1.3, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = lit ? '#2a2330' : '#1c1822';
  [[-W/2, -H], [W/2 - 6, -H], [-W/2, -6], [W/2 - 6, -6]].forEach(([bx, by]) => { ctx.fillRect(bx, by, 6, 6); });

  // Re-draw the visible cavity after the wooden front, then cover its lower edge with the lip.
  if (reveal > 0.02) {
    ctx.save();
    ctx.beginPath(); ctx.rect(-W/2 + 8, -H + 7, W - 16, H * 0.54); ctx.clip();
    const inner = ctx.createLinearGradient(0, -H, 0, -H * 0.25);
    inner.addColorStop(0, `rgba(5,2,0,${0.82 * reveal})`);
    inner.addColorStop(1, `rgba(54,28,8,${0.82 * reveal})`);
    ctx.fillStyle = inner;
    ctx.fillRect(-W/2 + 6, -H + 5, W - 12, H * 0.62);
    const ca = clamp((eased - 0.08) / 0.82, 0, 1);
    if (ca > 0) {
      for (let i = 0; i < c._coins.length; i++) {
        const [px, py] = c._coins[i];
        const warm = i % 3 === 0 ? [255, 229, 118] : i % 3 === 1 ? [230, 160, 45] : [255, 198, 68];
        ctx.fillStyle = rgba(warm, ca);
        ctx.beginPath(); ctx.ellipse(px, py + 5 + Math.sin(i) * 0.8, 5.4, 2.3, (i % 5) * 0.12, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(255,248,190,${ca * 0.8})`;
        ctx.beginPath(); ctx.ellipse(px - 1.3, py + 4.1, 2.7, 0.75, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = `rgba(70,220,255,${ca * 0.9})`;
      ctx.beginPath(); ctx.moveTo(-13, -14); ctx.lineTo(-8, -18); ctx.lineTo(-4, -13); ctx.lineTo(-9, -10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(255,90,140,${ca * 0.85})`;
      ctx.beginPath(); ctx.moveTo(14, -20); ctx.lineTo(18, -16); ctx.lineTo(15, -12); ctx.lineTo(11, -15); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // front lip hides the bottom of the treasure pile and makes the cavity feel inset.
  ctx.fillStyle = lit ? '#3f2814' : '#2d1a0c';
  ctx.fillRect(-W/2 + 4, -H + 3, W - 8, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-W/2 + 5, -H + 8, W - 10, 3);

  // — LID: fixed hinge with the front edge lifting toward the viewer —
  const lidLift = sinT * H * 0.62;
  const lidBaseY = hingeY - lidLift;
  const domeH = Math.max(10, lidH * (1 - eased * 0.18));
  // dark underside visibly bridges the body hinge and raised lid front.
  if (eased > 0.05) {
    const under = ctx.createLinearGradient(0, hingeY, 0, lidBaseY);
    under.addColorStop(0, 'rgba(18,9,3,0.95)');
    under.addColorStop(1, 'rgba(72,38,12,0.9)');
    ctx.fillStyle = under;
    ctx.beginPath();
    ctx.moveTo(-lidW/2 + 4, hingeY + 1);
    ctx.lineTo(lidW/2 - 4, hingeY + 1);
    ctx.lineTo(lidW/2 - 8, lidBaseY + domeH * 0.28);
    ctx.quadraticCurveTo(0, lidBaseY + domeH * 0.45, -lidW/2 + 8, lidBaseY + domeH * 0.28);
    ctx.closePath(); ctx.fill();
  }
  // dome top sits on the raised front edge when open, or on the body when closed.
  const lidGrad = ctx.createLinearGradient(0, lidBaseY - domeH, 0, lidBaseY + domeH * 0.18);
  lidGrad.addColorStop(0, lit ? '#7a5530' : '#5a3c20');
  lidGrad.addColorStop(1, lit ? '#5a3c20' : '#432c18');
  ctx.fillStyle = lidGrad;
  ctx.beginPath();
  ctx.moveTo(-lidW/2, lidBaseY + domeH * 0.1);
  ctx.quadraticCurveTo(-lidW/2, lidBaseY - domeH, 0, lidBaseY - domeH);
  ctx.quadraticCurveTo(lidW/2, lidBaseY - domeH, lidW/2, lidBaseY + domeH * 0.1);
  ctx.closePath(); ctx.fill();
  // iron band across the dome base
  ctx.strokeStyle = lit ? '#2a2330' : '#1c1822'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-lidW/2, lidBaseY + domeH * 0.08); ctx.quadraticCurveTo(0, lidBaseY - domeH * 1.03, lidW/2, lidBaseY + domeH * 0.08); ctx.stroke();
  // plank seams
  ctx.strokeStyle = 'rgba(40,24,10,0.55)'; ctx.lineWidth = 1.1;
  for (let p = -1; p <= 1; p += 1) {
    const fx = p * lidW * 0.28;
    ctx.beginPath(); ctx.moveTo(fx, lidBaseY + domeH * 0.08);
    ctx.quadraticCurveTo(fx, lidBaseY - domeH * 0.9, fx * 0.6, lidBaseY - domeH * 0.99);
    ctx.stroke();
  }
  // lock clasp — rides on the front of the lifted lid
  ctx.fillStyle = '#d9a534'; ctx.fillRect(-5, lidBaseY + domeH * 0.02, 10, 6);
  ctx.fillStyle = '#b88a2c'; ctx.fillRect(-5, lidBaseY + domeH * 0.02, 10, 1.5);

  // hinge pins stay attached to the body even while the lid moves.
  ctx.fillStyle = lit ? '#80798a' : '#4c4658';
  for (const hx of [-W * 0.32, W * 0.32]) {
    ctx.beginPath(); ctx.ellipse(hx, -H - 1.5, 4, 2.2, 0, 0, TAU); ctx.fill();
  }

  // lock keeper on the body top (clasp seats here when closed)
  ctx.fillStyle = '#3a2a14'; ctx.fillRect(-5, -H - 2, 10, 4);
  ctx.fillStyle = '#b88a2c'; ctx.beginPath(); ctx.arc(0, -H, 1.5, 0, TAU); ctx.fill();

  ctx.restore();
}

// horizontal-axis rounded rect (helper for the chest body)
function roundRectH(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r); ctx.closePath(); ctx.fill();
}



/* ----- Wreck vignette: broken hull + wheel mounted on the stern-post ----- */
function drawWreck(ctx, phase) {
  const w = scene.wreck;
  const lit = phase.isDay;
  ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.tilt);
  // hull: a broken half-buried stern fragment — wide plank body with a torn hole
  ctx.fillStyle = lit ? '#3a2c1c' : '#241913';
  ctx.beginPath();
  ctx.moveTo(-w.hullW/2, 0);
  ctx.lineTo(-w.hullW/2, -w.hullH*0.7);
  ctx.quadraticCurveTo(-w.hullW*0.18, -w.hullH, w.hullW*0.1, -w.hullH*0.85);
  ctx.quadraticCurveTo(w.hullW*0.3, -w.hullH*0.7, w.hullW*0.5, -w.hullH*0.2);
  ctx.lineTo(w.hullW/2, 0); ctx.closePath(); ctx.fill();
  // plank lines
  ctx.strokeStyle = lit ? 'rgba(20,14,8,0.6)' : 'rgba(10,7,5,0.7)'; ctx.lineWidth = 1.2;
  for (let p = -3; p <= 3; p++) {
    ctx.beginPath(); ctx.moveTo(-w.hullW/2 + 4, -w.hullH*0.1 - p*12);
    ctx.quadraticCurveTo(0, -w.hullH*0.45 - p*10, w.hullW/2 - 6, -w.hullH*0.08 - p*7);
    ctx.stroke();
  }
  // torn hole on the side
  ctx.fillStyle = lit ? 'rgba(10,7,5,0.9)' : 'rgba(4,3,2,0.95)';
  ctx.beginPath();
  ctx.moveTo(-w.hullW*0.1, -w.hullH*0.7);
  ctx.quadraticCurveTo(w.hullW*0.12, -w.hullH*0.45, -w.hullW*0.05, -w.hullH*0.3);
  ctx.quadraticCurveTo(-w.hullW*0.18, -w.hullH*0.5, -w.hullW*0.1, -w.hullH*0.7);
  ctx.closePath(); ctx.fill();
  // barnacle encrustations along the rim
  ctx.fillStyle = lit ? 'rgba(220,220,205,0.7)' : 'rgba(120,120,110,0.5)';
  for (let b = 0; b < 14; b++) {
    const fx = -w.hullW/2 + (b/14) * w.hullW;
    const fy = -w.hullH * (0.05 + (b % 2) * 0.55);
    ctx.beginPath(); ctx.arc(fx, fy, 2.4 + (b % 3), 0, TAU); ctx.fill();
  }
  // stern-post (vertical post where the wheel is mounted)
  ctx.strokeStyle = lit ? '#3a2c1c' : '#241913'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(w.wheel.ox, 0); ctx.lineTo(w.wheel.ox, w.wheel.oy + 8); ctx.stroke();
  ctx.restore();

  // chain from bow stub to anchor (catenary of links resting on the sand)
  const a = scene.anchor;
  ctx.strokeStyle = lit ? 'rgba(60,56,64,0.7)' : 'rgba(30,28,34,0.7)'; ctx.lineWidth = 2;
  const chainStart = { x: w.x - w.hullW/2 + 6, y: w.y - 6 };
  const chainEnd = { x: a.x, y: a.y - 6 };
  ctx.beginPath();
  ctx.moveTo(chainStart.x, chainStart.y);
  ctx.quadraticCurveTo((chainStart.x+chainEnd.x)/2, (chainStart.y+chainEnd.y)/2 + 18, chainEnd.x, chainEnd.y);
  ctx.stroke();
  // link ellipses along the catenary
  ctx.fillStyle = lit ? 'rgba(80,76,84,0.85)' : 'rgba(36,34,40,0.85)';
  for (let i = 1; i < 7; i++) {
    const t = i / 8;
    const lx = lerp(chainStart.x, chainEnd.x, t);
    const ly = lerp(chainStart.y, chainEnd.y, t) + Math.sin(t * Math.PI) * 14;
    ctx.save(); ctx.translate(lx, ly); ctx.rotate((i % 2) * Math.PI/2);
    ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 1.8, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // anchor lying at angle on the sand
  ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot);
  ctx.strokeStyle = lit ? '#5a5060' : '#2a2630'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, 6);
  ctx.moveTo(-11, -32); ctx.lineTo(11, -32);
  ctx.moveTo(0, -6); ctx.lineTo(-16, 8); ctx.lineTo(-11, 2);
  ctx.moveTo(0, -6); ctx.lineTo(16, 8); ctx.lineTo(11, 2);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -42, 6, 0, TAU); ctx.stroke();
  ctx.restore();

  // wheel mounted on the stern-post
  const wp = wheelScreenPos();
  ctx.save(); ctx.translate(wp.x, wp.y); ctx.rotate(w.wheel.rot);
  ctx.strokeStyle = lit ? '#6b5238' : '#3a2c1c'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(0, 0, wp.r, 0, TAU); ctx.stroke();
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const ang = i/8 * TAU;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * wp.r, Math.sin(ang) * wp.r); ctx.stroke();
  }
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i += 2) {
    const ang = i/8 * TAU;
    ctx.beginPath(); ctx.arc(Math.cos(ang) * wp.r, Math.sin(ang) * wp.r, 3.4, 0, TAU); ctx.stroke();
  }
  // hub hint (clickable) — pulses to invite interaction, stays lit while helm open
  const pulse = 0.25 + 0.18 * Math.sin(Time.hour * 2);
  ctx.fillStyle = Time.helmActive ? 'rgba(255,208,112,0.95)' : `rgba(255,208,112,${pulse})`;
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawJellies(ctx, phase) {
  for (const j of scene.jellies) {
    const glow = phase.isDay ? 0.25 : 0.7;
    ctx.save(); ctx.translate(j.x, j.y);
    const g = ctx.createRadialGradient(0,0,0,0,0,j.r*1.8);
    g.addColorStop(0, `hsla(${j.hue},80%,70%,${glow*0.8})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.fillRect(-j.r*2,-j.r*2,j.r*4,j.r*4);
    // bell
    ctx.fillStyle = `hsla(${j.hue},70%,72%,${0.5 + glow*0.3})`;
    ctx.beginPath(); ctx.arc(0,0,j.r,Math.PI,0); ctx.closePath(); ctx.fill();
    // tentacles
    ctx.strokeStyle = `hsla(${j.hue},70%,70%,${0.5})`; ctx.lineWidth=1.5;
    for (let i=0;i<6;i++){
      const xx = -j.r*0.7 + i*(j.r*1.4/5);
      const r = j.retract;
      ctx.beginPath(); ctx.moveTo(xx, 0);
      for (let k=1;k<=4;k++){ ctx.lineTo(xx + Math.sin(j.ph+k)*3, k*j.r*0.5*(1-r)); }
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawParticles(ctx, phase) {
  // plankton
  for (const p of plankton) {
    const a = (0.25 + 0.4*Math.sin(p.ph)) * (0.4 + phase.plan*0.6);
    ctx.fillStyle = phase.isDay ? `rgba(200,230,255,${a*0.4})` : `rgba(150,255,210,${a})`;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,TAU); ctx.fill();
  }
  // bubbles
  for (const b of bubbles) {
    ctx.strokeStyle = `rgba(255,255,255,0.5)`; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,TAU); ctx.stroke();
    // specular highlight
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(b.x - b.r*0.34, b.y - b.r*0.34, b.r*0.22, 0, TAU); ctx.fill();
    if (b.ring){ ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(b.x,b.y,b.r+2,0,TAU); ctx.stroke(); }
  }
}

function drawCaustics(ctx, phase) {
  if (phase.caustics < 0.05) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const t = Time.hour;
  // flowing caustic mesh: a few overlapping sine-modulated light ribbons that
  // drift slowly across the mid-water, so they read as moving light rather than flicker.
  const ribbons = 4;
  for (let i = 0; i < ribbons; i++) {
    const yBase = surfaceY + (sandY - surfaceY) * (0.15 + i * 0.18);
    const drift = (t * 18 + i * 50) % (W + 200) - 100;
    ctx.beginPath();
    for (let x = -120; x <= W + 120; x += 18) {
      const y = yBase + Math.sin((x - drift) * 0.012 + t * 0.8 + i) * 22 + Math.sin(x * 0.05 + i) * 6;
      x === -120 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let x = W + 120; x >= -120; x -= 18) {
      const y = yBase + Math.sin((x - drift) * 0.012 + t * 0.8 + i) * 22 + Math.sin(x * 0.05 + i) * 6 + 26;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    const a = 0.05 * phase.caustics;
    const grd = ctx.createLinearGradient(0, yBase - 30, 0, yBase + 50);
    grd.addColorStop(0, `rgba(200,230,255,0)`);
    grd.addColorStop(0.5, `rgba(200,230,255,${a})`);
    grd.addColorStop(1, `rgba(200,230,255,0)`);
    ctx.fillStyle = grd; ctx.fill();
  }
  ctx.restore();
}

function drawAmbient(ctx, phase) {
  if (phase.amb > 0.01) {
    ctx.fillStyle = rgba(phase.ambC, phase.amb * 0.5);
    ctx.fillRect(0, surfaceY, W, sandY-surfaceY);
  }
}

/* ============================================================
   10. RENDER LOOP
   ============================================================ */
let lastT = performance.now();
let sceneT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  sceneT += dt;
  Time.sync(); Time.advance(dt);
  const phase = phaseParams(Time.hour);

  ctx.clearRect(0,0,W,H);
  drawBackground(ctx, phase);
  drawSurface(ctx, phase);

  // kelp forest sits behind the fish
  drawKelp(ctx, phase);

  ctx.save();
  // update all creatures; if one signals respawn (off-screen), re-roll its slot
  for (let i = 0; i < fish.length; i++) {
    if (fish[i].update(dt, phase) === 'respawn') fish[i] = spawnCreature();
  }
  // whale pass first (behind small fish for depth)
  for (const c of fish) if (c instanceof Whale) c.draw(ctx, phase);
  // small fish on top
  for (const c of fish) if (!(c instanceof Whale)) c.draw(ctx, phase);
  ctx.restore();

  // sand (with contact shadow under the wreck) sits on top, half-burying set pieces
  updateSetPieces(dt, phase);
  drawSand(ctx, phase);
  drawCorals(ctx, phase);
  drawAnemones(ctx, phase);
  drawStarfish(ctx, phase);
  drawWreck(ctx, phase);
  drawChest(ctx, phase);
  drawForegroundSandDetails(ctx, phase);
  drawJellies(ctx, phase);

  drawCaustics(ctx, phase);
  drawAmbient(ctx, phase);

  updateParticles(dt);
  drawParticles(ctx, phase);

  updateClock(phase);
  requestAnimationFrame(frame);
}

/* ============================================================
   11. CLOCK UI (HTML overlay)
   ============================================================ */
const elTime = document.getElementById('aq-time');
const elDate = document.getElementById('aq-date');
const elFill = document.getElementById('aq-fill');
const elGlyphRing = document.getElementById('aq-glyph-ring');
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function updateClock(phase) {
  const h = Time.hour;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = Math.floor(((h - hh) * 60 - mm) * 60);
  elTime.textContent = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  const now = new Date();
  elDate.textContent = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  const fracIntoHour = (h - hh);
  elFill.style.width = (fracIntoHour*100) + '%';
  // ring glyph: sun during day, moon at night — sits at the leading edge of the fill
  elGlyphRing.style.left = (fracIntoHour * 100) + '%';
  if (phase.isDay) {
    elGlyphRing.style.background = 'radial-gradient(circle, #ffe6a0, #f2a83c)';
    elGlyphRing.style.boxShadow = '0 0 12px rgba(255,210,120,0.7)';
  } else {
    elGlyphRing.style.background = 'radial-gradient(circle, #dfe7ff, #6a86c8)';
    elGlyphRing.style.boxShadow = '0 0 12px rgba(200,220,255,0.6)';
  }
  // auto-contrast the clock text against the phase
  const ink = phase.isDay ? '#06283a' : '#eaf6ff';
  const sub = phase.isDay ? '#3d7baa' : '#cfecff';
  document.documentElement.style.setProperty('--aq-clock-ink', ink);
  document.documentElement.style.setProperty('--aq-clock-sub', sub);
}

/* ============================================================
   12. HELM OF TIDES — ship's-wheel time control
   ============================================================ */
const helm = document.getElementById('aq-helm');
const dial = document.getElementById('aq-dial');
const knob = document.getElementById('aq-knob');
const glyph = document.getElementById('aq-glyph');
const releaseBtn = document.getElementById('aq-release');

function openHelm() {
  Time.helmActive = true;
  Time.helmHour = Time.hour;
  Time.hour = Time.helmHour;
  Time.speed = 1;
  // The wheel is in the bottom-right; open the helm card up-left of it so it stays fully on-screen.
  const wp = wheelScreenPos();
  // Position the card so its bottom-right corner sits just up-left of the wheel.
  // The CSS card uses transform: translate(-50%,-50%); we set origin then nudge.
  const cardW = 230, cardH = 360;
  let px = wp.x - 40 - cardW / 2;
  let py = wp.y - 30 - cardH / 2;
  px = clamp(px, cardW/2 + 8, W - cardW/2 - 8);
  py = clamp(py, cardH/2 + 8, H - cardH/2 - 8);
  helm.style.left = px + 'px';
  helm.style.top = py + 'px';
  helm.hidden = false;
  setSpeed(1);
  setDialToHour(Time.hour);
  fadeHint(true);
}
function closeHelm() {
  helm.hidden = true;
  Time.helmActive = false;
  Time.sync();
}

function setDialToHour(h) {
  // 12 at top (0deg), clockwise; angle = h/24*360, mapped to trig position on the dial ring
  const ang = (h/24)*360;
  const rad = (ang - 90) * Math.PI/180;
  const R = 58;
  knob.style.transform = `translate(${Math.cos(rad)*R}px, ${Math.sin(rad)*R}px)`;
  const phase = phaseParams(h);
  glyph.style.background = phase.isDay ? 'radial-gradient(circle,#ffe6a0,#f2a83c)' : 'radial-gradient(circle,#dfe7ff,#6a86c8)';
  glyph.style.boxShadow = phase.isDay ? '0 0 18px rgba(255,210,120,0.7)' : '0 0 18px rgba(200,220,255,0.6)';
}

let dragging = false;
function dialPointer(e) {
  const r = dial.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  const p = (e.touches && e.touches[0]) || e;
  let ang = Math.atan2(p.clientY - cy, p.clientX - cx) * 180/Math.PI + 90;
  if (ang < 0) ang += 360;
  const h = (ang/360)*24;
  Time.hour = h; Time.helmHour = h; Time.helmActive = true;
  setDialToHour(h);
}
dial.addEventListener('pointerdown', e => { dragging = true; dial.classList.add('is-grabbing'); dial.setPointerCapture(e.pointerId); dialPointer(e); });
dial.addEventListener('pointermove', e => { if (dragging) dialPointer(e); });
dial.addEventListener('pointerup', e => { dragging = false; dial.classList.remove('is-grabbing'); });

document.querySelectorAll('.aq-helm__speed').forEach(btn => {
  btn.addEventListener('click', () => setSpeed(parseFloat(btn.dataset.speed)));
});
function setSpeed(s) {
  Time.speed = s;
  document.querySelectorAll('.aq-helm__speed').forEach(b => {
    b.classList.toggle('is-on', parseFloat(b.dataset.speed) === s);
  });
}
releaseBtn.addEventListener('click', closeHelm);
window.addEventListener('keydown', e => { if (e.key === 'Escape' && Time.helmActive) closeHelm(); });
stage.addEventListener('pointerdown', e => {
  // click empty water (not on helm card) closes helm
  if (!Time.helmActive) return;
  if (helm.contains(e.target)) return;
  closeHelm();
});

/* ============================================================
   13. HINT fade
   ============================================================ */
const hint = document.getElementById('aq-hint');
let hintFaded = false;
function fadeHint(force){ if(!hintFaded || force){ hint.classList.add('is-faded'); hintFaded = true; } }
stage.addEventListener('pointerdown', () => fadeHint(), { once: true });

/* ============================================================
   14. WIRING + START
   ============================================================ */
window.addEventListener('resize', resize);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerdown', onDown);
window.addEventListener('pointerup', onUp);
canvas.addEventListener('pointerleave', onLeave);
canvas.addEventListener('pointermove', e => { const p = stagePos(e); hoverScenery(p.x, p.y); });

resize();
seedFish();
Time.sync();
requestAnimationFrame(frame);
