// Procedural mob renderer for Moborr.io (top-down / rear view).
// Exports drawMob(ctx, rm, options).
// Sprites are cached in an offscreen canvas keyed by (type, radius, color).

const spriteCache = new Map();

function cacheKey(type, radius, color) {
  return `${type}::r${Math.round(radius)}::c${color || ''}`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Helper: small color adjust for basic shading
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

// Render a single sprite to offscreen canvas for a given type & radius.
// This version focuses on a top-down (rear) perspective: body/shoulders/tail/pack, no face.
function renderSpriteToCanvas(type, radius, color) {
  const size = Math.max(64, Math.ceil(radius * 3.0));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const cx = size / 2;
  const cy = size / 2;

  // scale factor (used for small detail sizes)
  const s = Math.max(0.6, radius / 24);

  // soft shadow under creature
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + radius * 0.35, Math.max(8, radius * 0.7), Math.max(4, radius * 0.36), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (type === 'wolf') {
    // Top-down rear wolf: rounded back, a visible collar/shoulder, curled tail to the right.
    const bodyW = radius * 1.5;
    const bodyH = radius * 1.05;
    // body gradient (darker along edges)
    const grad = ctx.createLinearGradient(cx - bodyW/2, cy - bodyH/2, cx + bodyW/2, cy + bodyH/2);
    const base = color || '#7b5f41';
    grad.addColorStop(0, shade(base, -6));
    grad.addColorStop(1, shade(base, -22));
    ctx.fillStyle = grad;
    roundRectPath(ctx, cx - bodyW/2, cy - bodyH/2, bodyW, bodyH, Math.max(6, radius * 0.12));
    ctx.fill();

    // dorsal fur stripe (subtle darker patch along top)
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx - bodyW * 0.08, cy - bodyH * 0.06, bodyW * 0.55, bodyH * 0.45, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // shoulders / neck seen from back (small hump)
    ctx.fillStyle = shade(base, -14);
    ctx.beginPath();
    ctx.ellipse(cx - bodyW * 0.18, cy - bodyH * 0.45, bodyW * 0.36, bodyH * 0.32, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // ears (viewed from rear: triangular shapes pointing slightly out/back)
    ctx.fillStyle = shade(base, -10);
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.95, cy - radius * 0.95);
    ctx.lineTo(cx - radius * 0.85, cy - radius * 1.24);
    ctx.lineTo(cx - radius * 0.68, cy - radius * 0.86);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.62, cy - radius * 0.95);
    ctx.lineTo(cx - radius * 0.52, cy - radius * 1.18);
    ctx.lineTo(cx - radius * 0.38, cy - radius * 0.86);
    ctx.closePath();
    ctx.fill();

    // tail from back (curled to right)
    ctx.save();
    ctx.translate(cx + bodyW * 0.45, cy - bodyH * 0.05);
    ctx.rotate(0.55);
    const tailW = Math.max(8, radius * 0.42);
    const tailH = Math.max(4, radius * 0.18);
    const tailGrad = ctx.createLinearGradient(-tailW, -tailH, tailW, tailH);
    tailGrad.addColorStop(0, shade(base, -8));
    tailGrad.addColorStop(1, shade(base, -30));
    ctx.fillStyle = tailGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, tailW * 1.1, tailW * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // small back highlights
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx - bodyW*0.2, cy - bodyH*0.18, bodyW*0.18, bodyH*0.12, -0.12, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // outline
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = Math.max(1, radius * 0.08);
    roundRectPath(ctx, cx - bodyW/2, cy - bodyH/2, bodyW, bodyH, Math.max(6, radius * 0.12));
    ctx.stroke();

  } else if (type === 'goblin') {
    // Top-down rear goblin: round hood/back, small shoulders, backpack/pack detail.
    const bodyW = radius * 1.4;
    const bodyH = radius * 1.0;
    const base = color || '#6fb64b';

    // cloak / back
    const g = ctx.createLinearGradient(cx - bodyW/2, cy - bodyH/2, cx + bodyW/2, cy + bodyH/2);
    g.addColorStop(0, shade(base, -6));
    g.addColorStop(1, shade(base, -22));
    ctx.fillStyle = g;
    roundRectPath(ctx, cx - bodyW/2, cy - bodyH/2, bodyW, bodyH, Math.max(8, radius * 0.2));
    ctx.fill();

    // hood seam near top (rear of head)
    ctx.fillStyle = shade(base, -16);
    ctx.beginPath();
    ctx.ellipse(cx, cy - bodyH*0.45, bodyW*0.38, bodyH*0.36, 0, 0, Math.PI*2);
    ctx.fill();

    // small backpack / pack on the lower back
    ctx.fillStyle = '#5b3f2e';
    roundRectPath(ctx, cx - bodyW*0.22, cy + bodyH*0.05, bodyW*0.44, bodyH*0.28, Math.max(4, radius * 0.08));
    ctx.fill();

    // shoulder patches
    ctx.fillStyle = shade('#5b402e', -8);
    ctx.beginPath();
    ctx.ellipse(cx - bodyW*0.36, cy - bodyH*0.08, bodyW*0.16, bodyH*0.14, -0.08, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + bodyW*0.36, cy - bodyH*0.08, bodyW*0.16, bodyH*0.14, 0.08, 0, Math.PI*2);
    ctx.fill();

    // subtle back crease highlight
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, bodyW*0.22, bodyH*0.12, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // ears (small triangular behind hood)
    ctx.fillStyle = shade(base, -18);
    ctx.beginPath();
    ctx.moveTo(cx - bodyW*0.46, cy - bodyH*0.5);
    ctx.lineTo(cx - bodyW*0.58, cy - bodyH*0.66);
    ctx.lineTo(cx - bodyW*0.34, cy - bodyH*0.6);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + bodyW*0.46, cy - bodyH*0.5);
    ctx.lineTo(cx + bodyW*0.58, cy - bodyH*0.66);
    ctx.lineTo(cx + bodyW*0.34, cy - bodyH*0.6);
    ctx.closePath();
    ctx.fill();

    // outline
    ctx.strokeStyle = 'rgba(0,0,0,0.26)';
    ctx.lineWidth = Math.max(1, radius * 0.06);
    roundRectPath(ctx, cx - bodyW/2, cy - bodyH/2, bodyW, bodyH, Math.max(6, radius * 0.14));
    ctx.stroke();

  } else if (type === 'golem') {
    // Top-down rear golem: broad back plates and visible plating layers.
    const bodyW = radius * 1.9;
    const bodyH = radius * 1.4;
    const bx = cx - bodyW / 2;
    const by = cy - bodyH / 2;

    // main back plate
    const stoneA = '#9e9e9e';
    const stoneB = '#6e6e6e';
    const grad = ctx.createLinearGradient(bx, by, bx + bodyW, by + bodyH);
    grad.addColorStop(0, stoneA);
    grad.addColorStop(1, stoneB);
    ctx.fillStyle = grad;
    roundRectPath(ctx, bx, by, bodyW, bodyH, Math.max(8, radius * 0.12));
    ctx.fill();

    // layered plates (horizontal bands across the back)
    ctx.fillStyle = shade('#bdbdbd', -8);
    const plateCount = 3;
    for (let i = 0; i < plateCount; i++) {
      const h = bodyH * 0.18;
      const y = by + i * (h + 4) + bodyH * 0.06;
      roundRectPath(ctx, bx + bodyW * 0.06, y, bodyW * 0.88, h, Math.max(4, radius * 0.06));
      ctx.fill();
    }

    // rear vents / cracks
    ctx.strokeStyle = 'rgba(40,40,40,0.7)';
    ctx.lineWidth = Math.max(1, radius * 0.06);
    ctx.beginPath();
    ctx.moveTo(bx + bodyW * 0.32, by + bodyH * 0.35);
    ctx.lineTo(bx + bodyW * 0.32, by + bodyH * 0.7);
    ctx.moveTo(bx + bodyW * 0.6, by + bodyH * 0.3);
    ctx.lineTo(bx + bodyW * 0.6, by + bodyH * 0.65);
    ctx.stroke();

    // small back-core glow seen from rear (faint)
    const coreX = cx;
    const coreY = by + bodyH * 0.55;
    const coreR = Math.max(6, radius * 0.5);
    const coreG = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreR * 1.5);
    coreG.addColorStop(0, 'rgba(255,140,50,0.85)');
    coreG.addColorStop(1, 'rgba(255,140,50,0.03)');
    ctx.fillStyle = coreG;
    ctx.beginPath();
    ctx.arc(coreX, coreY, coreR, 0, Math.PI * 2);
    ctx.fill();

    // outline
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = Math.max(1.4, radius * 0.08);
    roundRectPath(ctx, bx, by, bodyW, bodyH, Math.max(8, radius * 0.12));
    ctx.stroke();

  } else {
    // fallback: top-down circle/back
    const bodyR = radius;
    ctx.fillStyle = color || '#9c9c9c';
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyR, bodyR * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(1, radius * 0.06);
    ctx.stroke();
  }

  return canvas;
}

// Public API: draw mob at its interpolated display position.
// rm: { displayX, displayY, radius, type, color, alpha, stunnedUntil }
export function drawMob(mainCtx, rm, opts = {}) {
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
  const spriteW = sprite.width;
  const spriteH = sprite.height;
  mainCtx.drawImage(sprite, cx - spriteW / 2, cy - spriteH / 2, spriteW, spriteH);

  // stun indicator (above)
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
