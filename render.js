// Rendering and main loop. All logic preserved and moved from original main.js.

import { state } from './state.js';
import { roundRectScreen, pseudo, clientPointInsideWall, clampToMap } from './utils.js';
import dom from './dom.js';
import { getHotbarSlotUnderPointer } from './input.js'; // use the single implementation exported by input.js
import { preloadTextures, getTexturePattern } from './textures.js';
import { getSkillIcon } from './icons.js'; // <-- imported so we can draw real icons when loaded

// --- Canvas setup (DPR aware) ---
export function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  dom.canvas.width = Math.floor(innerWidth * dpr);
  dom.canvas.height = Math.floor(innerHeight * dpr);
  dom.canvas.style.width = innerWidth + 'px';
  dom.canvas.style.height = innerHeight + 'px';
  dom.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Preload wall textures (non-blocking). Place the chosen albedo file at:
//   assets/textures/walls/Rocks011_1k-PNG_Color.png
// If you prefer to use Rocks011.png, adjust the src below to that filename.
(function preloadWallTextures() {
  try {
    preloadTextures([
      { name: 'rocks011', src: 'assets/textures/walls/Rocks011_1k-PNG_Color.png' }
    ]).catch(() => {});
  } catch (e) {}
})();

// --- Jagged wall params (tweak these to change the 'jaggedness') ---
const JAG_SEGMENT_LENGTH = 20; // pixels per segment along each wall edge
const JAG_DISPLACEMENT = 10;   // max perpendicular offset in pixels

// Cache for jagged walls (rebuild only when walls change)
let jaggedWallCache = [];

// Helper that rebuilds jaggedWallCache from state.map.walls
function rebuildJaggedWallCache() {
  jaggedWallCache = [];
  try {
    const walls = Array.isArray(state.map.walls) ? state.map.walls : [];
    for (const w of walls) {
      if (w && Array.isArray(w.points) && w.points.length >= 3) {
        const jagged = buildJaggedPoints(w.points, JAG_SEGMENT_LENGTH, JAG_DISPLACEMENT);
        jaggedWallCache.push({ id: w.id || null, jagged, texture: w.texture || 'rocks011' });
      } else if (w && typeof w.x === 'number' && typeof w.w === 'number') {
        const rectPts = [
          { x: w.x, y: w.y },
          { x: w.x + w.w, y: w.y },
          { x: w.x + w.w, y: w.y + w.h },
          { x: w.x, y: w.y + w.h }
        ];
        const jagged = buildJaggedPoints(rectPts, JAG_SEGMENT_LENGTH, JAG_DISPLACEMENT);
        jaggedWallCache.push({ id: w.id || null, jagged, texture: w.texture || 'rocks011' });
      }
    }
  } catch (e) {
    jaggedWallCache = [];
  } finally {
    // clear the flag so we don't rebuild until next change
    state.map._jaggedNeedsUpdate = false;
  }
}

// Helper: build jagged points around an input polygon (array of {x,y})
// Returns an array of points that follow the polygon edges but with
// pseudo-noise offsets perpendicular to each edge to create jagged edges.
function buildJaggedPoints(polyPoints, segmentLength = JAG_SEGMENT_LENGTH, jagMag = JAG_DISPLACEMENT) {
  if (!Array.isArray(polyPoints) || polyPoints.length < 2) return polyPoints || [];
  const out = [];
  for (let i = 0; i < polyPoints.length; i++) {
    const a = polyPoints[i];
    const b = polyPoints[(i + 1) % polyPoints.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy) || 1;
    const nx = -dy / segLen; // outward normal direction candidate (perp)
    const ny = dx / segLen;
    const steps = Math.max(1, Math.ceil(segLen / segmentLength));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      // Use pseudo noise to get a stable offset value based on world coords
      // Scale inputs so the noise is smoothly varying
      const noise = pseudo(px * 0.08, py * 0.08);
      // noise runs [0,1) -> shift to [-0.5,0.5], apply jagMag
      const offset = (noise - 0.5) * 2 * jagMag;
      // Alternate sign a bit to avoid uniform bias by sampling a second noise
      const alt = pseudo(px * 0.07 + 37.13, py * 0.11 + 91.7) - 0.5;
      const finalOffset = offset * (0.8 + 0.4 * alt);
      const jx = px + nx * finalOffset;
      const jy = py + ny * finalOffset;
      // For start / end points of polygon edges we avoid duplicating vertices:
      if (i === 0 && s === 0) out.push({ x: jx, y: jy });
      else if (s === 0) {
        // ensure continuity by not duplicating the previous point (skip)
        out.push({ x: jx, y: jy });
      } else {
        out.push({ x: jx, y: jy });
      }
    }
  }
  return out;
}

// A safe draw helper that draws a polygon from points array and fills it
function fillPolygonWithTextureOrColor(points, textureName, fallbackColor) {
  if (!points || points.length < 3) return;
  const ctx = dom.ctx;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  // texture pattern (if loaded)
  const pat = getTexturePattern(textureName, ctx);
  if (pat) ctx.fillStyle = pat;
  else ctx.fillStyle = fallbackColor || '#6b4f3b';
  ctx.fill();
  ctx.stroke();
}

// --- helper: currentClientSpeed (from main.js) ---
export function currentClientSpeed() {
  let mult = 1;
  const now = Date.now();
  state.player.localBuffs = state.player.localBuffs.filter(b => b.until > now);
  for (const b of state.player.localBuffs) mult *= (b.multiplier || 1);
  return state.player.baseSpeed * mult;
}

// --- Drawing helpers: HP/XP placement & Hotbar with icons ---
function drawXpBarAt(x, y, barW, barH) {
  const padding = 3;
  // Use server-provided nextLevelXp if available; fallback to old formula
  const nextNeeded = Math.max(50, (typeof state.player.nextLevelXp === 'number' ? state.player.nextLevelXp : (state.player.level * 100)));
  const pct = nextNeeded > 0 ? Math.min(1, (state.player.xp || 0) / nextNeeded) : 0;
  dom.ctx.save();
  dom.ctx.globalAlpha = 0.95;
  dom.ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRectScreen(dom.ctx, x - 2, y - 2, barW + 4, barH + 4, 6, true, false);
  dom.ctx.fillStyle = '#222';
  roundRectScreen(dom.ctx, x, y, barW, barH, 6, true, false);
  dom.ctx.fillStyle = '#4fbfef';
  roundRectScreen(dom.ctx, x + padding, y + padding, Math.max(6, (barW - padding*2) * pct), barH - padding*2, 6, true, false);
  dom.ctx.font = '12px system-ui, Arial';
  dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'middle'; dom.ctx.fillStyle = '#fff';
  const txt = `Lv ${state.player.level} — XP ${state.player.xp || 0} / ${nextNeeded}`;
  dom.ctx.fillText(txt, x + barW / 2, y + barH / 2);
  dom.ctx.restore();
}

function drawHpBarAt(x, y, barW, barH) {
  const padding = 3;
  const currentHp = Math.max(0, Math.round(state.player.hp || 0));
  const maxHp = Math.max(1, Math.round(state.player.maxHp || 200));
  const pct = Math.max(0, Math.min(1, currentHp / maxHp));
  dom.ctx.save();
  dom.ctx.globalAlpha = 0.95;
  dom.ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRectScreen(dom.ctx, x - 2, y - 2, barW + 4, barH + 4, 6, true, false);
  dom.ctx.fillStyle = '#222';
  roundRectScreen(dom.ctx, x, y, barW, barH, 6, true, false);
  dom.ctx.fillStyle = '#e74c3c';
  roundRectScreen(dom.ctx, x + padding, y + padding, Math.max(6, (barW - padding*2) * pct), barH - padding*2, 6, true, false);
  dom.ctx.font = '12px system-ui, Arial';
  dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'middle'; dom.ctx.fillStyle = '#fff';
  const txt = `HP ${currentHp} / ${maxHp}`;
  dom.ctx.fillText(txt, x + barW / 2, y + barH / 2);
  dom.ctx.restore();
}

function drawActiveEffectsAt(startX, startY, barH) {
  // Draw local buffs (state.player.localBuffs) as icons with timer to the right of HP bar
  const now = Date.now();
  const effects = (state.player.localBuffs || []).filter(b => b.until > now);
  if (!effects.length) return;
  const iconW = Math.max(22, barH);
  const gap = 6;
  dom.ctx.save();
  dom.ctx.font = '12px system-ui, Arial';
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    const ix = startX;
    const iy = startY + i * (iconW + gap);
    // background circle
    dom.ctx.globalAlpha = 0.95;
    dom.ctx.fillStyle = e.type === 'speed' ? 'rgba(255,220,120,0.95)' : e.type === 'damage' ? 'rgba(255,150,120,0.95)' : e.type === 'stuck' ? 'rgba(220,120,120,0.95)' : 'rgba(200,200,200,0.95)';
    roundRectScreen(dom.ctx, ix, iy, iconW, iconW, 6, true, false);
    // icon glyph
    dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'middle';
    dom.ctx.fillStyle = '#111';
    const glyph = e.type === 'speed' ? '⚡' : e.type === 'damage' ? '🔥' : e.type === 'stuck' ? '❌' : '●';
    dom.ctx.fillText(glyph, ix + iconW / 2, iy + iconW / 2 + 1);
    // timer overlay
    const remaining = Math.max(0, Math.round((e.until - now) / 1000));
    dom.ctx.fillStyle = 'rgba(255,255,255,0.9)';
    dom.ctx.font = '11px system-ui, Arial';
    dom.ctx.fillText(`${remaining}s`, ix + iconW / 2, iy + iconW - 8);
  }
  dom.ctx.restore();
}

function drawHotbar(vw, vh) {
  const slotSize = 64;
  const gap = 10;
  const totalW = state.HOTBAR_SLOTS * slotSize + (state.HOTBAR_SLOTS - 1) * gap;
  const x0 = Math.round((vw - totalW) / 2);
  const y0 = Math.round(vh - 28 - slotSize);
  dom.ctx.save();
  dom.ctx.globalAlpha = 0.92;
  roundRectScreen(dom.ctx, x0 - 10, y0 - 10, totalW + 20, slotSize + 20, 12, true, false);
  dom.ctx.globalAlpha = 1.0;
  for (let i = 0; i < state.HOTBAR_SLOTS; i++) {
    const sx = x0 + i * (slotSize + gap);
    const sy = y0;
    dom.ctx.fillStyle = 'rgba(40,40,42,0.95)';
    roundRectScreen(dom.ctx, sx, sy, slotSize, slotSize, 8, true, false);

    // highlight hovered slot
    const hovered = getHotbarSlotUnderPointer(state.pointer.x, state.pointer.y, vw, vh);
    if (hovered === i) {
      dom.ctx.lineWidth = 3;
      dom.ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      roundRectScreen(dom.ctx, sx, sy, slotSize, slotSize, 8, false, true);
    }

    // draw icon background using skill color and icon glyph or image
    const meta = (state.SKILL_META[state.player.class] && state.SKILL_META[state.player.class][i]) || null;
    if (meta) {
      dom.ctx.fillStyle = meta.color || 'rgba(255,255,255,0.06)';
      roundRectScreen(dom.ctx, sx + 8, sy + 8, slotSize - 16, slotSize - 16, 6, true, false);

      // Try to draw image icon if available
      let drawn = false;
      try {
        const img = (typeof getSkillIcon === 'function') ? getSkillIcon(state.player.class, meta.type) : null;
        if (img && img.complete && img.naturalWidth > 0) {
          const inset = 8;
          const iw = slotSize - 16;
          const ih = slotSize - 16;
          dom.ctx.drawImage(img, sx + inset, sy + inset, iw, ih);
          drawn = true;
        }
      } catch (e) { drawn = false; }

      if (!drawn) {
        const glyph = state.SKILL_ICONS[meta.type] || meta.name.charAt(0);
        dom.ctx.font = '22px system-ui, Arial';
        dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'middle';
        dom.ctx.fillStyle = '#111';
        dom.ctx.fillText(glyph, sx + slotSize/2, sy + slotSize/2 + 2);
      }
    } else {
      dom.ctx.font = '12px system-ui, Arial';
      dom.ctx.textAlign = 'center';
      dom.ctx.textBaseline = 'middle';
      dom.ctx.fillStyle = '#fff';
      dom.ctx.fillText(`Slot ${i+1}`, sx + slotSize/2, sy + slotSize/2);
    }

    const cd = state.cooldowns[i] || 0;
    if (cd > 0) {
      const cdPct = Math.min(1, cd / ((state.CLASS_COOLDOWNS[state.player.class] && state.CLASS_COOLDOWNS[state.player.class][i]) || 6.0));
      dom.ctx.fillStyle = 'rgba(0,0,0,0.6)';
      dom.ctx.beginPath();
      dom.ctx.rect(sx, sy + slotSize * (1 - cdPct), slotSize, slotSize * cdPct);
      dom.ctx.fill();
      dom.ctx.font = '14px system-ui, Arial'; dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'middle'; dom.ctx.fillStyle = '#fff';
      dom.ctx.fillText(String(Math.ceil(cd)), sx + slotSize/2, sy + slotSize/2);
    }
  }
  dom.ctx.restore();
}

// --- Drawing & interpolation (including mobs & projectiles) ---
function drawWorld(vw, vh, dt) {
  dom.ctx.save();
  dom.ctx.fillStyle = '#8b5a2b';
  const cover = Math.max((state.map.size || (state.map.radius*2)) + Math.max(vw, vh) * 2, 8000);
  const rx = state.map.center.x - cover / 2;
  const ry = state.map.center.y - cover / 2;
  dom.ctx.fillRect(rx, ry, cover, cover);
  dom.ctx.restore();

  dom.ctx.save();

  // Rebuild jagged wall cache only when needed
  if (state.map._jaggedNeedsUpdate || !jaggedWallCache || !jaggedWallCache.length) {
    rebuildJaggedWallCache();
  }

  if (state.map.type === 'circle') {
    dom.ctx.beginPath();
    dom.ctx.arc(state.map.center.x, state.map.center.y, state.map.radius, 0, Math.PI * 2);
    const g = dom.ctx.createRadialGradient(
      state.map.center.x - state.map.radius * 0.2, state.map.center.y - state.map.radius * 0.2, state.map.radius * 0.05,
      state.map.center.x, state.map.center.y, state.map.radius
    );
    g.addColorStop(0, '#9fe69f');
    g.addColorStop(1, '#5fb35f');
    dom.ctx.fillStyle = g;
    dom.ctx.fill();
    dom.ctx.lineWidth = 6;
    dom.ctx.strokeStyle = '#2a6b2a';
    dom.ctx.stroke();
  } else {
    const half = state.map.half || (state.map.size/2);
    const x = state.map.center.x - half;
    const y = state.map.center.y - half;
    const size = half * 2;
    const g = dom.ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, '#9fe69f');
    g.addColorStop(1, '#5fb35f');
    dom.ctx.fillStyle = g;
    dom.ctx.fillRect(x, y, size, size);
    dom.ctx.lineWidth = 6;
    dom.ctx.strokeStyle = '#2a6b2a';
    dom.ctx.strokeRect(x, y, size, size);

    // draw walls (use cached jagged polygons)
    dom.ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    dom.ctx.lineWidth = 2;
    for (const w of (jaggedWallCache || [])) {
      if (w && Array.isArray(w.jagged) && w.jagged.length >= 3) {
        const texName = (w && w.texture) ? w.texture : 'rocks011';
        fillPolygonWithTextureOrColor(w.jagged, texName, '#6b4f3b');
      }
    }
  }
  dom.ctx.restore();

  // grass/grid
  dom.ctx.save();
  dom.ctx.lineWidth = 1;
  dom.ctx.strokeStyle = 'rgba(34,80,30,0.55)';
  const spacing = 22;
  const left = state.player.x - vw / 2;
  const top = state.player.y - vh / 2;
  const cols = Math.ceil(vw / spacing) + 4;
  const rows = Math.ceil(vh / spacing) + 4;
  for (let gx = 0; gx < cols; gx++) {
    for (let gy = 0; gy < rows; gy++) {
      const wx = Math.floor((left + gx * spacing) / spacing) * spacing + spacing / 2;
      const wy = Math.floor((top + gy * spacing) / spacing) * spacing + spacing / 2;
      let allowed = false;
      if (state.map.type === 'circle') {
        const distToCenter = Math.hypot(wx - state.map.center.x, wy - state.map.center.y);
        if (distToCenter < state.map.radius - 8) allowed = true;
      } else {
        const half = state.map.half || (state.map.size/2);
        if (wx > state.map.center.x - half + 8 && wx < state.map.center.x + half - 8 && wy > state.map.center.y - half + 8 && wy < state.map.center.y + half - 8) {
          allowed = true;
        }
      }
      if (!allowed) continue;
      let insideWall = false;
      // Use clientPointInsideWall for both rects and polygons
      if (clientPointInsideWall(wx, wy)) insideWall = true;
      if (insideWall) continue;
      const p = pseudo(wx, wy);
      if (p > 0.35) {
        const blades = 1 + Math.floor(p * 2);
        for (let b = 0; b < blades; b++) {
          const subp = pseudo(wx + b * 13.7, wy + b * 7.3);
          const len = 5 + subp * 7;
          const angle = (subp - 0.5) * 0.9;
          const x1 = wx + (subp - 0.5) * 6;
          const y1 = wy + (subp - 0.2) * 2;
          const x2 = x1 + Math.cos(angle) * len;
          const y2 = y1 + Math.sin(angle) * len;
          dom.ctx.beginPath();
          dom.ctx.moveTo(x1, y1);
          dom.ctx.lineTo(x2, y2);
          dom.ctx.stroke();
        }
      }
    }
  }
  dom.ctx.restore();

  // draw remote players
  dom.ctx.save();
  for (const rp of state.remotePlayers.values()) {
    const interpFactor = 1 - Math.exp(-state.REMOTE_INTERP_SPEED * dt);
    rp.displayX += (rp.targetX - rp.displayX) * interpFactor;
    rp.displayY += (rp.targetY - rp.displayY) * interpFactor;
    dom.ctx.beginPath();
    dom.ctx.arc(rp.displayX, rp.displayY, rp.radius, 0, Math.PI * 2);
    dom.ctx.fillStyle = rp.color || '#ff7';
    dom.ctx.fill();
    if (rp.name) {
      dom.ctx.font = '12px system-ui, Arial';
      dom.ctx.textAlign = 'center';
      dom.ctx.textBaseline = 'bottom';
      dom.ctx.fillStyle = 'rgba(0,0,0,0.6)';
      dom.ctx.fillText(rp.name, rp.displayX + 1, rp.displayY - rp.radius - 12 + 1);
      dom.ctx.fillStyle = '#fff';
      dom.ctx.fillText(rp.name, rp.displayX, rp.displayY - rp.radius - 12);
    }
    // show stun marker if present
    if (rp.stunnedUntil && rp.stunnedUntil > Date.now()) {
      dom.ctx.font = '14px system-ui, Arial'; dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'bottom'; dom.ctx.fillStyle = 'rgba(255,255,255,0.9)';
      dom.ctx.fillText('❌', rp.displayX, rp.displayY - rp.radius - 6);
    }
  }
  dom.ctx.restore();

  // draw projectiles (interpolated)
  dom.ctx.save();
  for (const pr of state.remoteProjectiles.values()) {
    const interpFactor = 1 - Math.exp(-state.REMOTE_INTERP_SPEED * dt);
    pr.displayX += (pr.targetX - pr.displayX) * interpFactor;
    pr.displayY += (pr.targetY - pr.displayY) * interpFactor;
    dom.ctx.beginPath();
    // color based on type
    let col = '#ff9f4d';
    if (pr.type === 'arrow') col = '#ffd54a';
    else if (pr.type === 'fireball') col = '#ff6b6b';
    else if (pr.type === 'frost') col = '#8fe3ff';
    else if (pr.type === 'spark') col = 'rgba(160,220,255,0.95)';
    else if (pr.type === 'arcane') col = 'rgba(220,150,255,0.95)';
    dom.ctx.fillStyle = col;
    dom.ctx.globalAlpha = pr.alpha != null ? pr.alpha : 1.0;
    dom.ctx.arc(pr.displayX, pr.displayY, Math.max(3, pr.radius || 6), 0, Math.PI * 2);
    dom.ctx.fill();
    // slight trail
    dom.ctx.globalAlpha = 0.5 * (pr.alpha != null ? pr.alpha : 1.0);
    dom.ctx.beginPath();
    dom.ctx.arc(pr.displayX - (pr.vx||0)*0.02, pr.displayY - (pr.vy||0)*0.02, Math.max(2, (pr.radius||6)*0.8), 0, Math.PI*2);
    dom.ctx.fill();
    dom.ctx.globalAlpha = 1.0;
  }
  dom.ctx.restore();

  // draw mobs (interpolated + simple spawn/fade + hp bar)
  dom.ctx.save();
  for (const rm of state.remoteMobs.values()) {
    // interpolate
    const interpFactor = 1 - Math.exp(-state.REMOTE_INTERP_SPEED * dt);
    rm.displayX += (rm.targetX - rm.displayX) * interpFactor;
    rm.displayY += (rm.targetY - rm.displayY) * interpFactor;
    // alpha spawn/fade
    if (!rm.dead) {
      rm.alpha = Math.min(1, (rm.alpha || 0) + dt * 4.0); // fast fade-in
    } else {
      rm.alpha = Math.max(0, (rm.alpha || 1) - dt * 2.5); // fade out when dead/removed
    }
    // if fully faded out and dead, remove from map
    if (rm.dead && rm.alpha <= 0.001) { state.remoteMobs.delete(rm.id); continue; }

    dom.ctx.globalAlpha = rm.alpha != null ? rm.alpha : 1.0;
    // mob body
    dom.ctx.beginPath();
    dom.ctx.arc(rm.displayX, rm.displayY, rm.radius || 14, 0, Math.PI * 2);
    dom.ctx.fillStyle = rm.color || '#9c9c9c';
    dom.ctx.fill();
    // outline
    dom.ctx.lineWidth = 1;
    dom.ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    dom.ctx.stroke();
    // hp bar
    if (typeof rm.hp === 'number' && typeof rm.maxHp === 'number' && rm.maxHp > 0) {
      const pct = Math.max(0, Math.min(1, rm.hp / rm.maxHp));
      const barW = Math.max(20, (rm.radius || 14) * 1.8);
      const barH = 6;
      const bx = rm.displayX - barW / 2;
      const by = rm.displayY - (rm.radius || 14) - 10;
      dom.ctx.globalAlpha = 0.9;
      dom.ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRectScreen(dom.ctx, bx - 1, by - 1, barW + 2, barH + 2, 3, true, false);
      dom.ctx.fillStyle = '#6b6b6b';
      roundRectScreen(dom.ctx, bx, by, barW, barH, 3, true, false);
      dom.ctx.fillStyle = '#e74c3c';
      roundRectScreen(dom.ctx, bx, by, Math.max(2, barW * pct), barH, 3, true, false);
      dom.ctx.globalAlpha = 1.0;
    }

    // stun visual
    if (rm.stunnedUntil && rm.stunnedUntil > Date.now()) {
      dom.ctx.font = '14px system-ui, Arial'; dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'bottom'; dom.ctx.fillStyle = 'rgba(255,255,255,0.95)'; dom.ctx.fillText('❌', rm.displayX, rm.displayY - rm.radius - 12);
    }
  }

  // draw any remoteEffects that are world-space (aoe, xp, heal, melee, damage)
  const now = Date.now();
  for (let i = state.remoteEffects.length - 1; i >= 0; i--) {
    const ef = state.remoteEffects[i];
    const age = now - (ef.start || 0);
    if (!ef || !ef.duration || age >= ef.duration) { state.remoteEffects.splice(i, 1); continue; }
    const t = Math.max(0, Math.min(1, age / ef.duration));
    dom.ctx.save();
    if (ef.type === 'aoe') {
      const r = (ef.radius || 40) * (0.9 + 0.4 * (1 - t));
      dom.ctx.beginPath();
      dom.ctx.lineWidth = Math.max(2, 4 * (1 - t));
      dom.ctx.strokeStyle = ef.color || `rgba(255,255,255,${1 - t})`;
      dom.ctx.arc(ef.x || 0, ef.y || 0, r, 0, Math.PI * 2);
      dom.ctx.stroke();
    } else if (ef.type === 'xp') {
      const sy = (ef.y || 0) - t * 40;
      dom.ctx.globalAlpha = 1 - t;
      dom.ctx.font = '14px system-ui, Arial';
      dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'middle';
      dom.ctx.fillStyle = ef.color || 'rgba(180,220,255,1)';
      dom.ctx.fillText(ef.text || '+XP', ef.x || 0, sy);
    } else if (ef.type === 'heal') {
      const syh = (ef.y || 0) - t * 36;
      dom.ctx.globalAlpha = 1 - t;
      dom.ctx.font = '14px system-ui, Arial';
      dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'middle';
      dom.ctx.fillStyle = ef.color || 'rgba(120,255,140,0.95)';
      dom.ctx.fillText(ef.text || '+HP', ef.x || 0, syh);
    } else if (ef.type === 'damage') {
      // red damage numbers float up and fade
      const syd = (ef.y || 0) - t * 28;
      dom.ctx.globalAlpha = 1 - Math.pow(t, 0.9);
      dom.ctx.font = 'bold 16px system-ui, Arial';
      dom.ctx.textAlign = 'center'; dom.ctx.textBaseline = 'middle';
      dom.ctx.fillStyle = ef.color || 'rgba(255,80,80,0.95)';
      dom.ctx.fillText(ef.text || '0', ef.x || 0, syd);
      // slight outline
      dom.ctx.lineWidth = 2;
      dom.ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      dom.ctx.strokeText(ef.text || '0', ef.x || 0, syd);
    } else if (ef.type === 'melee') {
      const r = (ef.radius || 40) * (0.6 + 0.8 * (1 - t));
      dom.ctx.globalAlpha = 1 - t;
      dom.ctx.beginPath();
      dom.ctx.fillStyle = ef.color || 'rgba(255,200,120,0.9)';
      dom.ctx.arc(ef.x || 0, ef.y || 0, r, 0, Math.PI * 2);
      dom.ctx.fill();
    } else {
      // generic fallback: small dot
      dom.ctx.globalAlpha = 1 - t;
      dom.ctx.fillStyle = ef.color || 'rgba(255,255,255,0.9)';
      dom.ctx.beginPath();
      dom.ctx.arc(ef.x || 0, ef.y || 0, 4 + 6 * (1 - t), 0, Math.PI * 2);
      dom.ctx.fill();
    }
    dom.ctx.restore();
  }

  dom.ctx.restore();
}

function drawPlayerScreen(screenX, screenY, angle) {
  dom.ctx.save();
  dom.ctx.beginPath();
  dom.ctx.arc(screenX, screenY, state.player.radius, 0, Math.PI * 2);
  dom.ctx.fillStyle = state.player.color;
  dom.ctx.fill();

  const shine = dom.ctx.createLinearGradient(screenX - state.player.radius, screenY - state.player.radius, screenX + state.player.radius, screenY + state.player.radius);
  shine.addColorStop(0, 'rgba(255,255,255,0.12)');
  shine.addColorStop(1, 'rgba(255,255,255,0.02)');
  dom.ctx.fillStyle = shine;
  dom.ctx.beginPath();
  dom.ctx.arc(screenX, screenY, state.player.radius, 0, Math.PI * 2);
  dom.ctx.fill();

  const eyeOffsetAngle = Math.PI / 6;
  const eyeDistance = state.player.radius * 0.45;
  const eyeRadius = Math.max(3, Math.floor(state.player.radius * 0.15));
  const leftEyeAngle = angle - eyeOffsetAngle;
  const rightEyeAngle = angle + eyeOffsetAngle;
  const leftEyeX = screenX + Math.cos(leftEyeAngle) * eyeDistance;
  const leftEyeY = screenY + Math.sin(leftEyeAngle) * eyeDistance;
  const rightEyeX = screenX + Math.cos(rightEyeAngle) * eyeDistance;
  const rightEyeY = screenY + Math.sin(rightEyeAngle) * eyeDistance;

  dom.ctx.beginPath();
  dom.ctx.fillStyle = '#fff';
  dom.ctx.arc(leftEyeX, leftEyeY, eyeRadius, 0, Math.PI * 2);
  dom.ctx.arc(rightEyeX, rightEyeY, eyeRadius, 0, Math.PI * 2);
  dom.ctx.fill();

  const pupilOffset = eyeRadius * 0.35;
  dom.ctx.beginPath();
  dom.ctx.fillStyle = '#000';
  dom.ctx.arc(leftEyeX + Math.cos(angle) * pupilOffset, leftEyeY + Math.sin(angle) * pupilOffset, Math.max(1.5, eyeRadius * 0.45), 0, Math.PI * 2);
  dom.ctx.arc(rightEyeX + Math.cos(angle) * pupilOffset, rightEyeY + Math.sin(angle) * pupilOffset, Math.max(1.5, eyeRadius * 0.45), 0, Math.PI * 2);
  dom.ctx.fill();

  if (state.player.name) {
    dom.ctx.font = '14px system-ui, Arial';
    dom.ctx.textAlign = 'center';
    dom.ctx.textBaseline = 'bottom';
    dom.ctx.fillStyle = 'rgba(0,0,0,0.6)';
    dom.ctx.fillText(state.player.name + (state.player.level ? ` (Lv ${state.player.level})` : ''), screenX + 1, screenY - state.player.radius - 12 + 1);
    dom.ctx.fillStyle = '#fff';
    dom.ctx.fillText(state.player.name + (state.player.level ? ` (Lv ${state.player.level})` : ''), screenX, screenY - state.player.radius - 12);
  }

  // draw local buff glow
  const now = Date.now();
  state.player.localBuffs = state.player.localBuffs.filter(b => b.until > now);
  if (state.player.localBuffs.length) {
    dom.ctx.save();
    const glowRadius = state.player.radius * 1.6;
    const g = dom.ctx.createRadialGradient(screenX, screenY, state.player.radius * 0.6, screenX, screenY, glowRadius);
    g.addColorStop(0, 'rgba(255,220,120,0.25)');
    g.addColorStop(1, 'rgba(255,220,120,0)');
    dom.ctx.fillStyle = g;
    dom.ctx.beginPath();
    dom.ctx.arc(screenX, screenY, glowRadius, 0, Math.PI*2);
    dom.ctx.fill();
    dom.ctx.restore();
  }

  // Stunned indicator on player
  if (state.player.stunnedUntil && state.player.stunnedUntil > Date.now()) {
    dom.ctx.font = '16px system-ui, Arial';
    dom.ctx.fillStyle = 'rgba(255,255,255,0.95)';
    dom.ctx.textAlign = 'center';
    dom.ctx.fillText('❌', screenX, screenY - state.player.radius - 26);
  }

  dom.ctx.restore();
}

function drawMinimap() {
  const vw = dom.canvas.width / (window.devicePixelRatio || 1);
  const vh = dom.canvas.height / (window.devicePixelRatio || 1);
  const padding = 12;
  const size = Math.min(200, Math.max(120, Math.floor(Math.min(vw, vh) * 0.16)));
  const x = vw - padding - size;
  const y = padding;
  const cornerRadius = 8;

  dom.ctx.save();
  dom.ctx.globalAlpha = 0.95;
  dom.ctx.fillStyle = 'rgba(20,20,22,0.95)';
  roundRectScreen(dom.ctx, x - 6, y - 6, size + 12, size + 12, cornerRadius + 2, true, false);

  const cx = x + size / 2;
  const cy = y + size / 2;

  // Determine world width (diameter) used for minimap scaling
  const worldDiameter = state.map.size || (state.map.radius * 2);
  const scale = size / worldDiameter;

  // Draw grid overlay for coordinate system (20 squares across diameter)
  const SQUARES = 20;
  const halfSquares = SQUARES / 2; // 10
  const squareWorld = worldDiameter / SQUARES; // world units per square
  const squarePx = squareWorld * scale; // pixels per square on minimap

  // Background for map area
  if (state.map.type === 'circle') {
    dom.ctx.beginPath();
    dom.ctx.arc(cx, cy, (state.map.radius * scale), 0, Math.PI * 2);
    dom.ctx.fillStyle = '#6fbf6f';
    dom.ctx.fill();

    dom.ctx.beginPath();
    dom.ctx.arc(cx, cy, (state.map.radius * scale), 0, Math.PI * 2);
    dom.ctx.lineWidth = 2;
    dom.ctx.strokeStyle = '#2a6b2a';
    dom.ctx.stroke();
  } else {
    const ms = worldDiameter * scale;
    dom.ctx.fillStyle = '#6fbf6f';
    dom.ctx.fillRect(cx - ms/2, cy - ms/2, ms, ms);
    dom.ctx.beginPath();
    dom.ctx.lineWidth = 2;
    dom.ctx.strokeStyle = '#2a6b2a';
    dom.ctx.strokeRect(cx - ms/2, cy - ms/2, ms, ms);
  }

  // Grid lines
  dom.ctx.save();
  dom.ctx.lineWidth = 1;
  for (let i = -halfSquares; i <= halfSquares; i++) {
    const px = cx + i * squarePx;
    // vertical line: only draw within minimap square bounds
    dom.ctx.beginPath();
    // Axis line (x=0) thicker
    if (i === 0) {
      dom.ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      dom.ctx.lineWidth = 1.8;
    } else {
      dom.ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      dom.ctx.lineWidth = 1;
    }
    dom.ctx.moveTo(px, cy - size/2);
    dom.ctx.lineTo(px, cy + size/2);
    dom.ctx.stroke();

    // X labels every 2 squares to reduce clutter
    if (i % 2 === 0) {
      dom.ctx.font = '10px system-ui, Arial';
      dom.ctx.textAlign = 'center';
      dom.ctx.textBaseline = 'top';
      dom.ctx.fillStyle = 'rgba(255,255,255,0.85)';
      dom.ctx.fillText(String(i), px, y + size + 2);
    }
  }
  for (let j = -halfSquares; j <= halfSquares; j++) {
    const py = cy - j * squarePx; // note: j positive is up -> subtract in pixel space
    dom.ctx.beginPath();
    if (j === 0) {
      dom.ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      dom.ctx.lineWidth = 1.8;
    } else {
      dom.ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      dom.ctx.lineWidth = 1;
    }
    dom.ctx.moveTo(cx - size/2, py);
    dom.ctx.lineTo(cx + size/2, py);
    dom.ctx.stroke();

    // Y labels every 2 squares (label to left)
    if (j % 2 === 0) {
      dom.ctx.font = '10px system-ui, Arial';
      dom.ctx.textAlign = 'right';
      dom.ctx.textBaseline = 'middle';
      dom.ctx.fillStyle = 'rgba(255,255,255,0.85)';
      dom.ctx.fillText(String(j), x - 6, py);
    }
  }
  dom.ctx.restore();

  // draw walls in minimap (rects or polygons) - keep existing behavior
  dom.ctx.fillStyle = '#6b4f3b';
  dom.ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  for (const w of (state.map.walls || [])) {
    if (w && Array.isArray(w.points)) {
      dom.ctx.beginPath();
      for (let i = 0; i < w.points.length; i++) {
        const pt = w.points[i];
        const wx = cx + (pt.x - state.map.center.x) * scale;
        const wy = cy + (pt.y - state.map.center.y) * scale;
        if (i === 0) dom.ctx.moveTo(wx, wy);
        else dom.ctx.lineTo(wx, wy);
      }
      dom.ctx.closePath();
      dom.ctx.fill();
      dom.ctx.stroke();
    } else if (typeof w.x === 'number' && typeof w.w === 'number') {
      const wx = cx + (w.x - state.map.center.x) * scale;
      const wy = cy + (w.y - state.map.center.y) * scale;
      const ww = w.w * scale;
      const wh = w.h * scale;
      dom.ctx.fillRect(wx, wy, ww, wh);
      dom.ctx.strokeRect(wx, wy, ww, wh);
    }
  }

  // player dot
  const px = cx + (state.player.x - state.map.center.x) * scale;
  const py = cy + (state.player.y - state.map.center.y) * scale;
  dom.ctx.beginPath();
  dom.ctx.fillStyle = state.player.color;
  dom.ctx.arc(px, py, Math.max(3, Math.min(8, state.player.radius * 0.18)), 0, Math.PI * 2);
  dom.ctx.fill();

  // mobs on minimap (small red dots)
  for (const rm of state.remoteMobs.values()) {
    if (typeof rm.targetX !== 'number' || typeof rm.targetY !== 'number') continue;
    const mx = cx + (rm.targetX - state.map.center.x) * scale;
    const my = cy + (rm.targetY - state.map.center.y) * scale;
    dom.ctx.beginPath();
    // changed from grey to red for better visibility / threat indication
    dom.ctx.fillStyle = 'rgba(220,80,80,0.95)';
    dom.ctx.arc(mx, my, Math.max(1.5, Math.min(4, (rm.radius || 12) * 0.08)), 0, Math.PI * 2);
    dom.ctx.fill();
  }

  dom.ctx.beginPath();
  dom.ctx.lineWidth = 1;
  dom.ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  roundRectScreen(dom.ctx, x - 6, y - 6, size + 12, size + 12, cornerRadius + 2, false, true);

  dom.ctx.restore();

  // Position the DOM gear button to the left of the minimap
 try {
  if (dom.gearButton) {
    const dpr = window.devicePixelRatio || 1;
    // convert minimap x,y in CSS pixels
    const cssX = x; const cssY = y;
    const btnSize = 44; // match settings button & dom.js size
    // position left of minimap with a small gap
    dom.gearButton.style.left = `${Math.max(8, cssX - btnSize - 12)}px`;
    dom.gearButton.style.top = `${cssY + 6}px`;
  }
  // Also keep gear panel stats updated if it's visible
  if (dom.gearPanel && dom.gearPanel.style.display && dom.gearPanel.style.display !== 'none') {
    if (typeof dom.updateAllSlotVisuals === 'function') dom.updateAllSlotVisuals();
  }
} catch (e) {}
}

// The rest of file unchanged (draw player, hotbar and main loop)
function drawCoordinatesBottomRight() {
  if (!state.settings.showCoordinates) return;
  const vw = dom.canvas.width / (window.devicePixelRatio || 1);
  const vh = dom.canvas.height / (window.devicePixelRatio || 1);
  const padding = 12;

  // Map to integer grid where center is (0,0) and diameter == 20 squares
  const worldDiameter = state.map.size || (state.map.radius * 2);
  const SQUARES = 20;
  const squareWorld = worldDiameter / SQUARES;

  // Compute grid coordinates. We want +X to the right, +Y upward.
  const dx = state.player.x - state.map.center.x;
  const dy = state.player.y - state.map.center.y;
  const gridX = Math.round(dx / squareWorld);
  const gridY = Math.round(-dy / squareWorld); // invert so up = positive

  const text = `x: ${gridX}, y: ${gridY}`;
  dom.ctx.save();
  dom.ctx.font = '14px system-ui, Arial';
  dom.ctx.textBaseline = 'bottom';
  dom.ctx.textAlign = 'right';
  const metrics = dom.ctx.measureText(text);
  const tw = metrics.width;
  const rectW = tw + 12;
  const rectH = 22;
  const rx = vw - padding - rectW;
  const ry = vh - padding - rectH;
  dom.ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRectScreen(dom.ctx, rx, ry, rectW, rectH, 6, true, false);
  dom.ctx.fillStyle = '#fff';
  dom.ctx.fillText(text, vw - padding - 6, vh - padding - 6);
  dom.ctx.restore();
}

// --- Main loop ---
let last = performance.now();
export function startLoop() {
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // update cooldown timers
    for (let i = 0; i < state.HOTBAR_SLOTS; i++) {
      if (state.cooldowns[i] > 0) {
        state.cooldowns[i] = Math.max(0, state.cooldowns[i] - dt);
      }
    }

    if (state.isLoading) { requestAnimationFrame(loop); return; }
    const titleVisible = state.dom.titleScreen && state.dom.titleScreen.style.display !== 'none';
    const settingsOpen = state.dom.settingsPanel && state.dom.settingsPanel.getAttribute('aria-hidden') === 'false';
    const inputVec = (!titleVisible && !settingsOpen) ? state.computeInputVector() : { x: 0, y: 0 };

    // compute client-side speed (considers local buffs)
    const clientSpeed = currentClientSpeed();

    const targetVx = inputVec.x * clientSpeed;
    const targetVy = inputVec.y * clientSpeed;
    const velLerp = 1 - Math.exp(-state.MOVE_ACCEL * dt);
    state.player.vx += (targetVx - state.player.vx) * velLerp;
    state.player.vy += (targetVy - state.player.vy) * velLerp;
    state.player.x += state.player.vx * dt;
    state.player.y += state.player.vy * dt;
    if (state.player.serverX !== null && state.player.serverY !== null) {
      const dx = state.player.serverX - state.player.x; const dy = state.player.serverY - state.player.y;
      const factor = 1 - Math.exp(-state.RECONCILE_SPEED * dt);
      state.player.x += dx * factor;
      state.player.y += dy * factor;
    }
    const speed = Math.hypot(state.player.vx, state.player.vy);
    if (speed > state.MIN_MOVEMENT_FOR_FACING) {
      const desired = Math.atan2(state.player.vy, state.player.vx);
      let diff = desired - state.player.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const angLerp = 1 - Math.exp(-state.TURN_SPEED * dt);
      state.player.facing += diff * angLerp;
    }
    const clamped = clampToMap(state.player.x, state.player.y);
    state.player.x = clamped.x;
    state.player.y = clamped.y;
    const vw = dom.canvas.width / (window.devicePixelRatio || 1);
    const vh = dom.canvas.height / (window.devicePixelRatio || 1);
    dom.ctx.clearRect(0, 0, vw, vh);
    dom.ctx.save();
    dom.ctx.translate(vw / 2 - state.player.x, vh / 2 - state.player.y);
    if (!titleVisible) drawWorld(vw, vh, dt);
    dom.ctx.restore();
    const playerScreenX = vw / 2;
    const playerScreenY = vh / 2;
    const angle = state.player.facing;
    if (!titleVisible) drawPlayerScreen(playerScreenX, playerScreenY, angle);

    // Draw HUD: hotbar centered bottom; HP above hotbar; effects to right of HP; XP under hotbar
    if (!titleVisible) {
      drawHotbar(vw, vh);
      // compute positions for HP/XP aligned with hotbar (same logic used in drawHotbar)
      const slotSize = 64;
      const gap = 10;
      const totalW = state.HOTBAR_SLOTS * slotSize + (state.HOTBAR_SLOTS - 1) * gap;
      const hotbarY = Math.round(vh - 28 - slotSize);
      const barW = Math.min(520, Math.floor(vw * 0.6));
      const barH = 14;
      const barX = Math.round((vw - barW) / 2);
      const hpY = hotbarY - 10 - barH;
      drawHpBarAt(barX, hpY, barW, barH);
      drawActiveEffectsAt(barX + barW + 10, hpY, barH);
      const xpY = hotbarY + slotSize + 8;
      drawXpBarAt(barX, xpY, barW, barH);

      // Additional numeric HP / XP display under the hotbar (centered)
      dom.ctx.save();
      dom.ctx.font = '13px system-ui, Arial';
      dom.ctx.textAlign = 'center';
      dom.ctx.textBaseline = 'top';
      dom.ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const hpText = `HP: ${Math.round(state.player.hp || 0)} / ${Math.round(state.player.maxHp || 0)}`;
      const xpText = `XP: ${Math.round(state.player.xp || 0)} / ${Math.round(state.player.nextLevelXp || 0)}`;
      dom.ctx.fillText(hpText, barX + barW / 2, xpY + barH + 6);
      dom.ctx.fillText(xpText, barX + barW / 2, xpY + barH + 24);
      dom.ctx.restore();
    }

    if (!titleVisible) {
      if (state.settings.showCoordinates) drawCoordinatesBottomRight();
      drawMinimap();

      // draw target ring if selectedTarget exists
      if (state.selectedTarget && (state.remoteMobs.has(state.selectedTarget.id) || state.remotePlayers.has(state.selectedTarget.id))) {
        let ent = null;
        if (state.remoteMobs.has(state.selectedTarget.id)) ent = state.remoteMobs.get(state.selectedTarget.id);
        else ent = state.remotePlayers.get(state.selectedTarget.id);
        if (ent) {
          const sx = ent.displayX || ent.targetX;
          const sy = ent.displayY || ent.targetY;
          dom.ctx.save();
          dom.ctx.beginPath();
          dom.ctx.lineWidth = 3;
          dom.ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          dom.ctx.arc((vw / 2 - state.player.x) + sx, (vh / 2 - state.player.y) + sy, (ent.radius || 18) + 6, 0, Math.PI * 2);
          dom.ctx.stroke();
          dom.ctx.restore();
        }
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
