// Helper utilities (geometry, collision helpers, drawing helpers) preserved from original main.js
import { state } from './state.js';

// --- Polygon helpers (client) ----------------
// Ray-casting point-in-polygon
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Distance from point to segment and closest point
export function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const dv = vx*vx + vy*vy;
  let t = dv > 0 ? (wx * vx + wy * vy) / dv : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + vx * t, cy = ay + vy * t;
  const dx = px - cx, dy = py - cy;
  return { dist: Math.hypot(dx, dy), closest: { x: cx, y: cy }, t };
}

// Resolve a circle against a polygon: push circle outside if overlap
export function resolveCirclePolygon(p, poly) {
  // p: { x,y, radius, vx, vy }
  // poly: array of {x,y}
  const inside = pointInPolygon(p.x, p.y, poly);
  let minOverlap = Infinity;
  let pushVec = null;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i+1) % poly.length];
    const res = pointToSegmentDistance(p.x, p.y, a.x, a.y, b.x, b.y);
    const d = res.dist;
    const overlap = p.radius - d;
    if (overlap > 0 && overlap < minOverlap) {
      // compute outward normal from edge
      const ex = b.x - a.x, ey = b.y - a.y;
      let nx = -ey, ny = ex;
      const nlen = Math.hypot(nx, ny) || 1;
      nx /= nlen; ny /= nlen;
      // determine sign of normal by sampling slightly along normal from closest point
      const sampleX = res.closest.x + nx * 2;
      const sampleY = res.closest.y + ny * 2;
      const sampleInside = pointInPolygon(sampleX, sampleY, poly);
      if (sampleInside) { nx = -nx; ny = -ny; }
      minOverlap = overlap;
      pushVec = { nx, ny, overlap };
    }
  }

  if (inside && !pushVec) {
    // fallback: push outward from centroid
    let cx = 0, cy = 0;
    for (const q of poly) { cx += q.x; cy += q.y; }
    cx /= poly.length; cy /= poly.length;
    let nx = p.x - cx, ny = p.y - cy;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const overlap = p.radius + 1;
    p.x += nx * overlap; p.y += ny * overlap;
    p.vx = 0; p.vy = 0;
    return;
  }

  if (pushVec && pushVec.overlap > 0) {
    p.x += pushVec.nx * pushVec.overlap;
    p.y += pushVec.ny * pushVec.overlap;
    // damp velocity along normal
    const vn = p.vx * pushVec.nx + p.vy * pushVec.ny;
    if (vn > 0) { p.vx -= vn * pushVec.nx; p.vy -= vn * pushVec.ny; }
  }
}

// Backwards-compatible pointInsideWall for client usage
export function clientPointInsideWall(x, y, margin = 6) {
  for (const w of state.map.walls || []) {
    if (w.points && Array.isArray(w.points)) {
      if (pointInPolygon(x, y, w.points)) return true;
    } else if (typeof w.x === 'number' && typeof w.w === 'number') {
      if (x >= w.x - margin && x <= w.x + w.w + margin && y >= w.y - margin && y <= w.y + w.h + margin) return true;
    }
  }
  return false;
}

// --- Collision helpers (existing AABB) ---
export function resolveCircleAABB(p, rect) {
  const rx1 = rect.x, ry1 = rect.y, rx2 = rect.x + rect.w, ry2 = rect.y + rect.h;
  const closestX = Math.max(rx1, Math.min(p.x, rx2)); const closestY = Math.max(ry1, Math.min(p.y, ry2));
  let dx = p.x - closestX, dy = p.y - closestY; const distSq = dx*dx + dy*dy;
  if (distSq === 0) {
    const leftDist = Math.abs(p.x - rx1), rightDist = Math.abs(rx2 - p.x), topDist = Math.abs(p.y - ry1), bottomDist = Math.abs(ry2 - p.y);
    const minHoriz = Math.min(leftDist, rightDist), minVert = Math.min(topDist, bottomDist);
    if (minHoriz < minVert) { if (leftDist < rightDist) p.x = rx1 - p.radius - 0.1; else p.x = rx2 + p.radius + 0.1; } else { if (topDist < bottomDist) p.y = ry1 - p.radius - 0.1; else p.y = ry2 + p.radius + 0.1; }
    p.vx = 0; p.vy = 0; return;
  }
  const dist = Math.sqrt(distSq); const overlap = p.radius - dist;
  if (overlap > 0) { dx /= dist; dy /= dist; p.x += dx * overlap; p.y += dy * overlap; const vn = p.vx * dx + p.vy * dy; if (vn > 0) { p.vx -= vn * dx; p.vy -= vn * dy; } }
}

// --- clampToMap now supports polygon walls as well as AABB walls ---
export function clampToMap(px, py) {
  const player = state.player;
  if (state.map.type === 'circle') {
    const dx = px - state.map.center.x; const dy = py - state.map.center.y; const dist = Math.hypot(dx, dy);
    const limit = (state.map.radius || 750) - player.radius - 1;
    if (dist > limit) { const k = limit / dist; px = state.map.center.x + dx * k; py = state.map.center.y + dy * k; }
    const p = { x: px, y: py, vx: player.vx, vy: player.vy, radius: player.radius };
    if (state.map.walls && state.map.walls.length) for (const w of state.map.walls) {
      if (w.points && Array.isArray(w.points)) resolveCirclePolygon(p, w.points);
      else resolveCircleAABB(p, w);
    }
    return { x: p.x, y: p.y };
  }
  const half = state.map.half || (state.map.size/2); const limit = half - player.radius - 1;
  let nx = Math.max(state.map.center.x - limit, Math.min(state.map.center.x + limit, px));
  let ny = Math.max(state.map.center.y - limit, Math.min(state.map.center.y + limit, py));
  const p = { x: nx, y: ny, vx: player.vx, vy: player.vy, radius: player.radius };
  if (state.map.walls && state.map.walls.length) for (const w of state.map.walls) {
    if (w.points && Array.isArray(w.points)) resolveCirclePolygon(p, w.points);
    else resolveCircleAABB(p, w);
  }
  nx = Math.max(state.map.center.x - limit, Math.min(state.map.center.x + limit, p.x)); ny = Math.max(state.map.center.y - limit, Math.min(state.map.center.y + limit, p.y));
  return { x: nx, y: ny };
}

// Misc drawing & noise helpers
export function roundRectScreen(ctx, x, y, width, height, radius, fill, stroke) {
  if (typeof radius === 'undefined') radius = 5;
  if (typeof radius === 'number') radius = { tl: radius, tr: radius, br: radius, bl: radius };
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

export function pseudo(x, y, seed = 1337) {
  return (Math.abs(Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453) % 1);
}
