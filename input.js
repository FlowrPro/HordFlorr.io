// Input handling (keyboard, mouse, click-to-move), hotbar interactions, and casting wrapper.
// Preserves original main.js logic; uses shared state and network send.

import { state } from './state.js';
import dom, { showSkillTooltip, hideSkillTooltip, appendChatMessage, saveSettings, showTransientMessage } from './dom.js';
import { clampToMap } from './utils.js';
import { sendChat } from './network.js';
import { setComputeInputFunc } from './network.js';

export function initInputHandlers() {
  // Setup keyboard events (preserve original)
  window.addEventListener('keydown', (e) => {
    if (state.dom.titleScreen && state.dom.titleScreen.style.display !== 'none') {
      if (e.key === 'Enter') { e.preventDefault(); 
        if (state.dom.playButton) state.dom.playButton.click();
      }
      return;
    }
    if (state.dom.settingsPanel && state.dom.settingsPanel.style.display !== 'none' && state.dom.settingsPanel.getAttribute('aria-hidden') === 'false') return;
    if ((e.key === 't' || e.key === 'T') && state.dom.chatInput && !state.dom.chatInput.disabled) { state.dom.chatInput.focus(); e.preventDefault(); return; }
    // number keys 1-4 cast skills
    if (['1','2','3','4'].includes(e.key)) {
      const idx = Number(e.key) - 1;
      if (castSkill(idx)) { e.preventDefault(); return; }
    }
    state.keys[e.key.toLowerCase()] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (state.dom.titleScreen && state.dom.titleScreen.style.display !== 'none') return;
    if (state.dom.settingsPanel && state.dom.settingsPanel.style.display !== 'none' && state.dom.settingsPanel.getAttribute('aria-hidden') === 'false') return;
    state.keys[e.key.toLowerCase()] = false;
  });

  // prevent right-click helper / context menu on the canvas
  state.dom.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });

  state.dom.canvas.addEventListener('mousemove', (e) => {
    const vw = state.dom.canvas.width / (window.devicePixelRatio || 1);
    const vh = state.dom.canvas.height / (window.devicePixelRatio || 1);
    state.pointer.x = e.clientX; state.pointer.y = e.clientY;
    // guard: if player is awaiting respawn, don't update mouseWorld (avoid NaN issues)
    if (state.player && state.player.awaitingRespawn) {
      // still update pointer so UI tooltips can work, but mouseWorld remains the last known or zero
      try {
        // keep previous mouseWorld if present
      } catch (e) {}
    } else {
      state.mouseWorld.x = state.player.x + (state.pointer.x - vw / 2);
      state.mouseWorld.y = state.player.y + (state.pointer.y - vh / 2);
    }

    // detect hotbar hover and show tooltip
    const hovered = getHotbarSlotUnderPointer(e.clientX, e.clientY, vw, vh);
    if (hovered !== null) {
      const meta = (state.SKILL_META[state.player.class] && state.SKILL_META[state.player.class][hovered]) || null;
      if (meta) {
        showSkillTooltip(meta, e.clientX + 12, e.clientY + 12);
      } else {
        hideSkillTooltip();
      }
    } else {
      hideSkillTooltip();
    }
  });

  // hotbar click handling (screen coords) — returns true if handled
  state.dom.canvas.addEventListener('click', (e) => {
    if (state.dom.titleScreen && state.dom.titleScreen.style.display !== 'none') return;
    if (state.dom.settingsPanel && state.dom.settingsPanel.style.display !== 'none' && state.dom.settingsPanel.getAttribute('aria-hidden') === 'false') return;

    const vw = state.dom.canvas.width / (window.devicePixelRatio || 1);
    const vh = state.dom.canvas.height / (window.devicePixelRatio || 1);

    // hotbar click has priority
    if (handleHotbarClick(e.clientX, e.clientY, vw, vh)) return;

    // If the user clicked an entity, select it as target
    const wx = state.player.x + (e.clientX - vw / 2);
    const wy = state.player.y + (e.clientY - vh / 2);
    const ent = findEntityUnderPoint(wx, wy);
    if (ent) {
      state.selectedTarget = { id: ent.id, kind: ent.kind };
      // show a small visual feedback
      state.remoteEffects.push({ type: 'aoe', x: ent.x, y: ent.y, radius: 18, color: 'rgba(240,240,100,0.95)', start: Date.now(), duration: 350 });
      return;
    }

    if (!state.settings.clickMovement) return;
    const wx2 = state.player.x + (e.clientX - vw / 2);
    const wy2 = state.player.y + (e.clientY - vh / 2);
    state.clickTarget = { x: wx2, y: wy2 };
  });

  // Chat button + enter key wiring
  if (state.dom.chatSend) state.dom.chatSend.addEventListener('click', () => { sendChat(); });
  if (state.dom.chatInput) state.dom.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });

  // Tab buttons for settings
  state.dom.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.dom.tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      state.dom.tabContents.forEach(tc => {
        if (tc.dataset.name === target) tc.classList.remove('hidden');
        else tc.classList.add('hidden');
      });
    });
  });

  // Keyboard/mouse settings toggles wired to save settings
  if (state.dom.mouseMovementCheckbox) state.dom.mouseMovementCheckbox.addEventListener('change', () => { state.settings.mouseMovement = state.dom.mouseMovementCheckbox.checked; saveSettings(); });
  if (state.dom.keyboardMovementCheckbox) state.dom.keyboardMovementCheckbox.addEventListener('change', () => { state.settings.keyboardMovement = state.dom.keyboardMovementCheckbox.checked; saveSettings(); });
  if (state.dom.clickMovementCheckbox) state.dom.clickMovementCheckbox.addEventListener('change', () => { state.settings.clickMovement = state.dom.clickMovementCheckbox.checked; saveSettings(); });
  if (state.dom.graphicsQuality) state.dom.graphicsQuality.addEventListener('change', () => { state.settings.graphicsQuality = state.dom.graphicsQuality.value; saveSettings(); });
  if (state.dom.showCoordinatesCheckbox) state.dom.showCoordinatesCheckbox.addEventListener('change', () => { state.settings.showCoordinates = state.dom.showCoordinatesCheckbox.checked; saveSettings(); });

  // settings button open/close
  if (state.dom.settingsBtn) state.dom.settingsBtn.addEventListener('click', () => {
    const open = state.dom.settingsPanel && state.dom.settingsPanel.getAttribute('aria-hidden') === 'false';
    if (open) { if (state.dom.settingsPanel) state.dom.settingsPanel.setAttribute('aria-hidden','true'); if (state.dom.settingsPanel) state.dom.settingsPanel.style.display = 'none'; if (state.dom.settingsBtn) state.dom.settingsBtn.setAttribute('aria-expanded','false'); }
    else { if (state.dom.settingsPanel) state.dom.settingsPanel.setAttribute('aria-hidden','false'); if (state.dom.settingsPanel) state.dom.settingsPanel.style.display = 'block'; if (state.dom.settingsBtn) state.dom.settingsBtn.setAttribute('aria-expanded','true'); }
  });
  if (state.dom.settingsClose) state.dom.settingsClose.addEventListener('click', () => { if (state.dom.settingsPanel) { state.dom.settingsPanel.setAttribute('aria-hidden','true'); state.dom.settingsPanel.style.display = 'none'; } });

  // username enter wiring is set up in main
}

// Helper: hotbar hit testing / hovering
export function handleHotbarClick(clientX, clientY, vw, vh) {
  const slotSize = 64;
  const gap = 10;
  const totalW = state.HOTBAR_SLOTS * slotSize + (state.HOTBAR_SLOTS - 1) * gap;
  const x0 = Math.round((vw - totalW) / 2);
  const y0 = Math.round(vh - 28 - slotSize); // matches draw placement
  if (clientY < y0 || clientY > y0 + slotSize) return false;
  for (let i = 0; i < state.HOTBAR_SLOTS; i++) {
    const sx = x0 + i * (slotSize + gap);
    if (clientX >= sx && clientX <= sx + slotSize) {
      castSkill(i);
      return true;
    }
  }
  return false;
}
export function getHotbarSlotUnderPointer(clientX, clientY, vw, vh) {
  const slotSize = 64;
  const gap = 10;
  const totalW = state.HOTBAR_SLOTS * slotSize + (state.HOTBAR_SLOTS - 1) * gap;
  const x0 = Math.round((vw - totalW) / 2);
  const y0 = Math.round(vh - 28 - slotSize);
  if (clientY < y0 || clientY > y0 + slotSize) return null;
  for (let i = 0; i < state.HOTBAR_SLOTS; i++) {
    const sx = x0 + i * (slotSize + gap);
    if (clientX >= sx && clientX <= sx + slotSize) return i;
  }
  return null;
}

export function findEntityUnderPoint(wx, wy) {
  // first check remote mobs
  for (const rm of state.remoteMobs.values()) {
    if (rm.dead) continue;
    const dx = (rm.targetX !== undefined ? rm.targetX : rm.displayX) - wx;
    const dy = (rm.targetY !== undefined ? rm.targetY : rm.displayY) - wy;
    const d = Math.hypot(dx, dy);
    if (d <= (rm.radius || 18) + 8) return { id: rm.id, kind: 'mob', x: rm.displayX || rm.targetX, y: rm.displayY || rm.targetY };
  }
  // then remote players
  for (const rp of state.remotePlayers.values()) {
    const dx = (rp.targetX !== undefined ? rp.targetX : rp.displayX) - wx;
    const dy = (rp.targetY !== undefined ? rp.targetY : rp.displayY) - wy;
    const d = Math.hypot(dx, dy);
    if (d <= (rp.radius || 28) + 8) return { id: rp.id, kind: 'player', x: rp.displayX || rp.targetX, y: rp.displayY || rp.targetY };
  }
  return null;
}

// computeInputVector (copied with minimal changes, using state.settings)
export function computeInputVector() {
  // If chat focused or player is dead/awaiting respawn, do not move
  if (state.chatFocused) return { x: 0, y: 0 };
  if (state.player && (state.player.awaitingRespawn || (typeof state.player.hp === 'number' && state.player.hp <= 0))) return { x: 0, y: 0 };

  if (state.settings.keyboardMovement) {
    let ax = 0, ay = 0;
    if (state.keys['arrowup'] || state.keys['w']) ay -= 1;
    if (state.keys['arrowdown'] || state.keys['s']) ay += 1;
    if (state.keys['arrowleft'] || state.keys['a']) ax -= 1;
    if (state.keys['arrowright'] || state.keys['d']) ax += 1;
    if (ax !== 0 || ay !== 0) {
      const len = Math.hypot(ax, ay);
      return { x: ax / len, y: ay / len };
    }
  }
  if (state.settings.clickMovement && state.clickTarget) {
    const dx = state.clickTarget.x - state.player.x;
    const dy = state.clickTarget.y - state.player.y;
    const len = Math.hypot(dx, dy);
    if (len < 6) { state.clickTarget = null; return { x: 0, y: 0 }; }
    return { x: dx / len, y: dy / len };
  }
  if (state.settings.mouseMovement) {
    const dx = state.mouseWorld.x - state.player.x;
    const dy = state.mouseWorld.y - state.player.y;
    const len = Math.hypot(dx, dy);
    if (len > 4) return { x: dx / len, y: dy / len };
  }
  return { x: 0, y: 0 };
}

// expose computeInputVector to network module
setComputeInputFunc(computeInputVector);

// --- Casting (client-side) ---
export function castSkill(slotIndex) {
  if (slotIndex < 0 || slotIndex >= state.HOTBAR_SLOTS) return false;
  // Prevent casting while dead/awaiting respawn
  if (state.player && (state.player.awaitingRespawn || (typeof state.player.hp === 'number' && state.player.hp <= 0))) {
    try { showTransientMessage('Cannot act while dead', 1100); } catch (e) {}
    return false;
  }

  if (state.cooldowns[slotIndex] > 0) {
    // show transient message instead of chat
    const name = (state.CLASS_SKILLS[state.player.class] && state.CLASS_SKILLS[state.player.class][slotIndex]) || `Slot ${slotIndex+1}`;
    showTransientMessage(`${name} is on cooldown (${Math.ceil(state.cooldowns[slotIndex])}s)`, 1400);
    return false;
  }

  const cd = (state.CLASS_COOLDOWNS[state.player.class] && state.CLASS_COOLDOWNS[state.player.class][slotIndex]) || 6.0;

  // compute aim angle (prefer mouse position, fallback to facing)
  let aimAngle = state.player.facing;
  try {
    const dx = state.mouseWorld.x - state.player.x;
    const dy = state.mouseWorld.y - state.player.y;
    const len = Math.hypot(dx, dy);
    if (len > 2) aimAngle = Math.atan2(dy, dx);
  } catch (e) {}

  const meta = (state.SKILL_META[state.player.class] && state.SKILL_META[state.player.class][slotIndex]) || null;

  // For target required kinds, ensure selectedTarget exists — do this BEFORE applying cooldown
  const needsTarget = meta && (meta.kind === 'proj_target' || meta.kind === 'proj_target_stun');
  if (needsTarget && (!state.selectedTarget || !state.selectedTarget.id)) {
    showTransientMessage(`No target selected for ${meta ? meta.name : 'skill'}`, 1400);
    return false;
  }

  const castMsg = { t: 'cast', slot: slotIndex + 1, class: state.player.class, ts: Date.now(), angle: aimAngle };
  if (state.selectedTarget && state.selectedTarget.id) castMsg.targetId = state.selectedTarget.id;
  if (meta && meta.kind === 'proj_aoe_spread') {
    castMsg.aimX = state.mouseWorld.x;
    castMsg.aimY = state.mouseWorld.y;
  }

  // Try to send cast to server. Only set cooldown and show local visual feedback if send succeeds.
  let sent = false;
  try {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(castMsg));
      sent = true;
    }
  } catch (e) {
    sent = false;
  }

  if (!sent) {
    // show transient error
    showTransientMessage('Not connected — message not sent', 1400);
    return false;
  }

  // On successful send, set cooldown and show local visual feedback & optimistic buff
  state.cooldowns[slotIndex] = cd;

  if (meta) {
    state.remoteEffects.push({
      type: meta.kind === 'melee' ? 'melee' : 'aoe',
      x: state.player.x,
      y: state.player.y,
      radius: meta.radius || (meta.range || (meta.explodeRadius || 48)),
      color: meta.color || 'rgba(255,255,255,0.9)',
      start: Date.now(),
      duration: meta.kind === 'melee' ? 300 : 800
    });

    // optimistic local buff
    if (meta.type === 'charge' && meta.buff) {
      state.player.localBuffs.push({ type: meta.buff.type, multiplier: meta.buff.multiplier || 1.0, until: Date.now() + (meta.buff.durationMs || 0) });
    }
    if (meta.type === 'rage' && meta.buff) {
      state.player.localBuffs.push({ type: meta.buff.type, multiplier: meta.buff.multiplier || 1.0, until: Date.now() + (meta.buff.durationMs || 0) });
    }
  }

  return true;
}
