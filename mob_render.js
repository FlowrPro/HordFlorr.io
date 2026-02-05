// Sprite-based mob renderer for Moborr.io
// - preloadMobSprites(manifest?) loads images into a small cache
// - getMobSprite(type) returns the loaded HTMLImageElement or null
// - drawMob(ctx, rm, opts?) draws a mob using its sprite (fallback to plain shape)
// Place mob images at: assets/mobs/<type>.webp (e.g. assets/mobs/goblin.webp)
//
// Usage:
//   import { preloadMobSprites, drawMob } from './mob_render.js';
//   await preloadMobSprites(); // optional
//   drawMob(ctx, rm);

const spriteCache = Object.create(null);
// spriteCache[type] = { img: HTMLImageElement, status: 'loading'|'loaded'|'error', src: string }

function makeKey(type) { return String(type || '').toLowerCase(); }

// Preload sprites manifest: [{ type:'goblin', src:'assets/mobs/goblin.webp' }, ...]
// If manifest omitted, preloads the default types.
export function preloadMobSprites(manifest = null) {
  const defaults = [
  { type: 'goblin', src: 'assets/mobs/goblin.png' },
  { type: 'wolf',   src: 'assets/mobs/wolf.png' },
  { type: 'golem',  src: 'assets/mobs/golem.png' }
];
  const list = Array.isArray(manifest) && manifest.length ? manifest : defaults;
  const promises = [];
  for (const it of list) {
    if (!it || !it.type || !it.src) continue;
    const key = makeKey(it.type);
    if (spriteCache[key] && spriteCache[key].status === 'loaded') { promises.push(Promise.resolve(spriteCache[key].img)); continue; }
    const img = new Image();
    img.src = it.src;
    img.decoding = 'async';
    spriteCache[key] = { img, status: 'loading', src: it.src };
    const p = new Promise((resolve) => {
      img.onload = () => { spriteCache[key].status = 'loaded'; resolve(img); };
      img.onerror = () => { spriteCache[key].status = 'error'; resolve(null); };
    });
    promises.push(p);
  }
  return Promise.all(promises);
}

// Return the loaded HTMLImageElement for a type or null if not loaded.
export function getMobSprite(type) {
  const key = makeKey(type);
  const entry = spriteCache[key];
  if (entry && entry.status === 'loaded') return entry.img;
  return null;
}

// Helper small shade function (used in fallback drawing)
function shade(hexOrCss, percent) {
  try {
    if (!hexOrCss) return hexOrCss;
    if (hexOrCss[0] === '#') {
      const v = hexOrCss.slice(1);
      const r = parseInt(v.slice(0,2),16), g = parseInt(v.slice(2,4),16), b = parseInt(v.slice(4,6),16);
      const p = percent / 100;
      const nr = Math.min(255, Math.max(0, Math.round(r + (p * 255))));
      const ng = Math.min(255, Math.max(0, Math.round(g + (p * 255))));
      const nb = Math.min(255, Math.max(0, Math.round(b + (p * 255))));
      return `rgb(${nr},${ng},${nb})`;
    }
  } catch (e) {}
  return hexOrCss || '#999';
}

// Fallback renderer (simple stylized back/top-down shapes) used when sprite missing.
function drawMobFallback(ctx, rm, opts = {}) {
  const cx = rm.displayX || rm.targetX || 0;
  const cy = rm.displayY || rm.targetY || 0;
  const radius = Math.max(8, (rm.radius || 16) * (opts.scale || 1));
  const type = (rm.type || '').toLowerCase();
  ctx.save();
  ctx.globalAlpha = (typeof opts.alpha === 'number') ? opts.alpha : (rm.alpha != null ? rm.alpha : 1.0);

  if (type === 'wolf') {
    // rear-view ellipse with tail to right
    ctx.fillStyle = rm.color || '#7b5f41';
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 1.2, radius * 0.9, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // tail
    ctx.beginPath();
    ctx.ellipse(cx + radius * 0.9, cy - radius * 0.05, radius * 0.5, radius * 0.22, 0.5, 0, Math.PI * 2);
    ctx.fillStyle = shade(rm.color || '#7b5f41', -12);
    ctx.fill();
  } else if (type === 'goblin') {
    // hood/backpack shape
    ctx.fillStyle = rm.color || '#6fb64b';
    ctx.beginPath();
    ctx.ellipse(cx, cy - radius * 0.15, radius * 1.05, radius * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    // pack
    ctx.fillStyle = '#5b402e';
    ctx.fillRect(cx - radius*0.28, cy + radius*0.1, radius*0.56, radius*0.36);
  } else if (type === 'golem') {
    // blocky rectangle with core glow
    const w = radius * 1.7, h = radius * 1.2;
    ctx.fillStyle = '#8f8f8f';
    ctx.fillRect(cx - w/2, cy - h/2, w, h);
    // core glow
    ctx.globalAlpha = 0.9;
    const g = ctx.createRadialGradient(cx, cy + h*0.15, 2, cx, cy + h*0.15, radius * 0.8);
    g.addColorStop(0, 'rgba(255,160,40,0.95)');
    g.addColorStop(1, 'rgba(255,160,40,0.06)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy + h*0.15, radius*0.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // generic
    ctx.fillStyle = rm.color || '#9c9c9c';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI*2);
    ctx.fill();
  }

  // hp bar (small)
  if (typeof rm.hp === 'number' && typeof rm.maxHp === 'number' && rm.maxHp > 0) {
    const pct = Math.max(0, Math.min(1, rm.hp / rm.maxHp));
    const bw = Math.max(20, radius * 1.6);
    const bh = 6;
    const bx = cx - bw/2;
    const by = cy - radius - 10;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(bx, by, Math.max(2, bw * pct), bh);
  }

  // stunned indicator
  if (rm.stunnedUntil && rm.stunnedUntil > Date.now()) {
    ctx.font = `${Math.max(12, radius * 0.45)}px system-ui, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText('❌', cx, cy - radius - 6);
  }

  ctx.restore();
}

// Public: drawMob(ctx, rm, opts?).
// - ctx: canvas 2d context (in world-space, as used in render.js)
// - rm: remote mob object (displayX, displayY, radius, type, color, alpha, hp, maxHp, stunnedUntil)
// - opts: { scale?, alpha?, spriteScale? }
export function drawMob(ctx, rm, opts = {}) {
  const key = makeKey(rm.type);
  const entry = spriteCache[key];
  const alpha = (typeof opts.alpha === 'number') ? opts.alpha : (rm.alpha != null ? rm.alpha : 1.0);

  // If sprite loaded -> draw image centered and scaled to mob radius.
  if (entry && entry.status === 'loaded' && entry.img && entry.img.naturalWidth > 0) {
    const img = entry.img;
    const cx = rm.displayX || rm.targetX || 0;
    const cy = rm.displayY || rm.targetY || 0;
    // scale image to fit mob radius:
    const spriteScale = (opts.spriteScale || 1.6);
    const diameter = Math.max(8, (rm.radius || 16) * 2 * (opts.scale || 1));
    const w = diameter * spriteScale;
    const aspect = img.naturalWidth / img.naturalHeight || 1;
    const h = w / aspect;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();

    // Draw HP bar and stun indicator on top
    if (typeof rm.hp === 'number' && typeof rm.maxHp === 'number' && rm.maxHp > 0) {
      const pct = Math.max(0, Math.min(1, rm.hp / rm.maxHp));
      const bw = Math.max(20, (rm.radius || 16) * 1.6);
      const bh = 6;
      const bx = cx - bw/2;
      const by = cy - (rm.radius || 16) - 10;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = '#6b6b6b';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(bx, by, Math.max(2, bw * pct), bh);
      ctx.restore();
    }

    if (rm.stunnedUntil && rm.stunnedUntil > Date.now()) {
      const cx = rm.displayX || rm.targetX || 0;
      const cy = rm.displayY || rm.targetY || 0;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.font = `${Math.max(12, (rm.radius||16) * 0.45)}px system-ui, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText('❌', cx, cy - (rm.radius || 16) - 6);
      ctx.restore();
    }

    return;
  }

  // Otherwise fallback to simple procedural back/top-down shape to keep visuals consistent.
  drawMobFallback(ctx, rm, opts);
}
