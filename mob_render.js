// Procedural mob renderer for Moborr.io
// Exports drawMob(ctx, rm, options) which draws the mob at rm.displayX, rm.displayY
// without requiring external image assets. Uses a small offscreen cache keyed by
// (type, radius, color) to avoid re-drawing complex shapes every frame.

const spriteCache = new Map();

// Helper: make cache key
function cacheKey(type, radius, color) {
  return `${type}::r${Math.round(radius)}::c${color || ''}`;
}

// Utility: rounded rectangle path
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Create an offscreen canvas sprite for a single mob instance
function renderSpriteToCanvas(type, radius, color) {
  // Choose canvas size based on radius (give margin for ears/tails/shadows)
  const size = Math.max(64, Math.ceil(radius * 2.8));
  const canvas = document.createElement('canvas');
  const dpr = 1; // keep 1 for cache simplicity
  canvas.width = canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');

  // Center point
  const cx = size / 2;
  const cy = size / 2;

  // scale factor relative to radius
  const s = (radius * 2) / (size * 0.6); // adjust so radius ~ body size

  // small helpers
  function radialGradFill(x, y, rInner, rOuter, colorInner, colorOuter) {
    const g = ctx.createRadialGradient(x, y, rInner, x, y, rOuter);
    g.addColorStop(0, colorInner);
    g.addColorStop(1, colorOuter);
    ctx.fillStyle = g;
  }

  // background drop shadow
  ctx.save();
  ctx.globalAlpha = 0.14;
  const shadowR = Math.max(6, radius * 0.6);
  ctx.beginPath();
  ctx.ellipse(cx, cy + radius * 0.3, shadowR, shadowR * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  // draw type-specific body shapes
  if (type === 'wolf') {
    const bodyR = radius * 0.95;
    // body oval
    radialGradFill(cx - radius * 0.12, cy - radius * 0.05, bodyR * 0.45, bodyR * 1.05, color || '#8b6b4b', shade(color || '#8b6b4b', -18));
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyR, bodyR * 0.8, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // soft fur shadow
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx - bodyR * 0.1, cy - bodyR * 0.15, bodyR * 0.55, bodyR * 0.4, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // head (top-left)
    const headR = bodyR * 0.6;
    radialGradFill(cx - bodyR * 0.8, cy - bodyR * 0.6, headR * 0.25, headR * 0.85, color || '#8b6b4b', shade(color || '#8b6b4b', -26));
    ctx.beginPath();
    ctx.ellipse(cx - bodyR * 0.8, cy - bodyR * 0.6, headR, headR * 0.85, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // ears
    ctx.save();
    ctx.translate(cx - bodyR * 0.95, cy - bodyR * 0.95);
    ctx.rotate(-0.35);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(12 * s, -8 * s);
    ctx.lineTo(6 * s, 16 * s);
    ctx.closePath();
    ctx.fillStyle = shade(color || '#8b6b4b', -20);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx - bodyR * 0.6, cy - bodyR * 0.95);
    ctx.rotate(0.05);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-10 * s, -8 * s);
    ctx.lineTo(-4 * s, 14 * s);
    ctx.closePath();
    ctx.fillStyle = shade(color || '#8b6b4b', -26);
    ctx.fill();
    ctx.restore();

    // snout / nose
    ctx.beginPath();
    ctx.ellipse(cx - bodyR * 1.05, cy - bodyR * 0.58, 8 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2116';
    ctx.fill();

    // eyes (top-down white circles)
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.ellipse(cx - bodyR * 0.95, cy - bodyR * 0.65, 6 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - bodyR * 0.75, cy - bodyR * 0.65, 6 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // pupils
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(cx - bodyR * 0.95, cy - bodyR * 0.65, 2.8 * s, 2.8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - bodyR * 0.75, cy - bodyR * 0.65, 2.8 * s, 2.8 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // tail (curled right)
    ctx.save();
    ctx.translate(cx + bodyR * 0.6, cy - bodyR * 0.05);
    ctx.rotate(0.6);
    radialGradFill(0, 0, bodyR * 0.12, bodyR * 0.5, shade(color || '#8b6b4b', -6), shade(color || '#8b6b4b', -28));
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyR * 0.35, bodyR * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // outline
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.ellipse(cx, cy, bodyR, bodyR * 0.8, -0.3, 0, Math.PI * 2);
    ctx.stroke();

  } else if (type === 'goblin') {
    const bodyR = radius * 0.85;
    // body
    radialGradFill(cx, cy + bodyR * 0.1, bodyR * 0.3, bodyR * 0.9, color || '#84c053', shade(color || '#84c053', -18));
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyR * 0.9, bodyR * 1.0, 0, 0, Math.PI * 2);
    ctx.fill();

    // head (big, top)
    const headR = bodyR * 0.7;
    radialGradFill(cx, cy - headR * 0.6, headR * 0.3, headR * 0.95, color || '#8cd06a', shade(color || '#8cd06a', -20));
    ctx.beginPath();
    ctx.ellipse(cx, cy - bodyR * 0.6, headR, headR * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();

    // ears (pointy)
    ctx.save();
    ctx.translate(cx - headR * 0.9, cy - bodyR * 0.7);
    ctx.rotate(-0.25);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-10 * s, -18 * s); ctx.lineTo(8 * s, -4 * s); ctx.fillStyle = shade(color || '#8cd06a', -24); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx + headR * 0.9, cy - bodyR * 0.7);
    ctx.rotate(0.25);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(10 * s, -18 * s); ctx.lineTo(-8 * s, -4 * s); ctx.fillStyle = shade(color || '#8cd06a', -24); ctx.fill();
    ctx.restore();

    // eyes (dark slits)
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(cx - 8 * s, cy - bodyR * 0.6, 4 * s, 6 * s, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 8 * s, cy - bodyR * 0.6, 4 * s, 6 * s, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // teeth (simple triangles)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx - 6 * s, cy - bodyR * 0.45); ctx.lineTo(cx - 2 * s, cy - bodyR * 0.35); ctx.lineTo(cx - 10 * s, cy - bodyR * 0.38); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 6 * s, cy - bodyR * 0.45); ctx.lineTo(cx + 2 * s, cy - bodyR * 0.35); ctx.lineTo(cx + 10 * s, cy - bodyR * 0.38); ctx.closePath(); ctx.fill();

    // small belt/armor line
    ctx.fillStyle = '#5b402e';
    ctx.fillRect(cx - bodyR * 0.6, cy + bodyR * 0.25, bodyR * 1.2, 6 * s);

    // outline
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(cx, cy, bodyR * 0.9, bodyR * 1.0, 0, 0, Math.PI * 2); ctx.stroke();

  } else if (type === 'golem') {
    // blocky stone golem: stacked rectangle + core
    const bodyW = radius * 1.6;
    const bodyH = radius * 1.8;
    const bx = cx - bodyW / 2;
    const by = cy - bodyH / 2;

    // stone gradient
    const stoneA = '#9e9e9e';
    const stoneB = '#6e6e6e';
    const g = ctx.createLinearGradient(bx, by, bx + bodyW, by + bodyH);
    g.addColorStop(0, stoneA);
    g.addColorStop(1, stoneB);
    ctx.fillStyle = g;
    roundRectPath(ctx, bx, by, bodyW, bodyH, Math.max(6, radius * 0.12));
    ctx.fill();

    // shoulder plate
    ctx.fillStyle = shade('#bdbdbd', -6);
    roundRectPath(ctx, bx + bodyW * 0.06, by - bodyH * 0.18, bodyW * 0.88, bodyH * 0.24, Math.max(4, radius * 0.08));
    ctx.fill();

    // cracks
    ctx.strokeStyle = 'rgba(40,40,40,0.75)';
    ctx.lineWidth = Math.max(1, radius * 0.04);
    ctx.beginPath();
    ctx.moveTo(bx + bodyW * 0.25, by + bodyH * 0.1);
    ctx.lineTo(bx + bodyW * 0.28, by + bodyH * 0.45);
    ctx.lineTo(bx + bodyW * 0.2, by + bodyH * 0.6);
    ctx.stroke();

    // glowing core circle
    const coreX = cx;
    const coreY = cy + bodyH * 0.1;
    const coreR = Math.max(6, radius * 0.45);
    const coreG = ctx.createRadialGradient(coreX, coreY, coreR * 0.1, coreX, coreY, coreR);
    coreG.addColorStop(0, '#ffd86b');
    coreG.addColorStop(1, 'rgba(255,120,20,0.05)');
    ctx.fillStyle = coreG;
    ctx.beginPath();
    ctx.arc(coreX, coreY, coreR, 0, Math.PI * 2);
    ctx.fill();

    // eyes (glow slits)
    ctx.fillStyle = '#ffd86b';
    ctx.fillRect(cx - 6 * s, by + bodyH * 0.02, 4 * s, 8 * s);
    ctx.fillRect(cx + 2 * s, by + bodyH * 0.02, 4 * s, 8 * s);

    // outline
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.4;
    roundRectPath(ctx, bx, by, bodyW, bodyH, Math.max(6, radius * 0.12));
    ctx.stroke();
  } else {
    // fallback: simple circle
    ctx.beginPath();
    radialGradFill(cx, cy, radius * 0.4, radius * 1.1, color || '#9c9c9c', shade(color || '#9c9c9c', -24));
    ctx.ellipse(cx, cy, radius, radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
  }

  return canvas;
}

// small helper to darken/lighten a hex or CSS color (very small function)
function shade(hexOrCss, percent) {
  try {
    if (hexOrCss && hexOrCss[0] === '#') {
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

// Public API: draw mob at its display position
export function drawMob(mainCtx, rm, opts = {}) {
  // opts: scale (1), showStun (true), alpha override
  const alpha = (typeof opts.alpha === 'number') ? opts.alpha : (rm.alpha != null ? rm.alpha : 1.0);
  const scale = opts.scale || 1.0;
  const typ = (rm.type || '').toLowerCase();
  const cx = rm.displayX || rm.targetX || 0;
  const cy = rm.displayY || rm.targetY || 0;
  const radius = Math.max(8, (rm.radius || 16) * scale);

  const key = cacheKey(typ, Math.round(radius), rm.color || '');
  let sprite = spriteCache.get(key);
  if (!sprite) {
    sprite = renderSpriteToCanvas(typ, radius, rm.color || '');
    spriteCache.set(key, sprite);
  }

  mainCtx.save();
  mainCtx.globalAlpha = alpha != null ? alpha : 1.0;
  // draw sprite centered at mob world coordinates
  const spriteW = sprite.width;
  const spriteH = sprite.height;
  mainCtx.drawImage(sprite, cx - spriteW / 2, cy - spriteH / 2, spriteW, spriteH);

  // Optional stun indicator
  if (rm.stunnedUntil && rm.stunnedUntil > Date.now()) {
    mainCtx.save();
    mainCtx.globalAlpha = 0.95;
    mainCtx.font = `${Math.max(12, radius * 0.45)}px system-ui, Arial`;
    mainCtx.textAlign = 'center';
    mainCtx.textBaseline = 'bottom';
    mainCtx.fillStyle = 'rgba(255,255,255,0.95)';
    mainCtx.fillText('❌', cx, cy - radius - 6);
    mainCtx.restore();
  }
  mainCtx.restore();
}