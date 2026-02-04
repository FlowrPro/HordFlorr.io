// DOM references, UI handlers (chat, settings, skill tooltip), and small helpers.
// Logic kept intact from original main.js but moved into dom.js to centralize DOM manipulation.

import { state } from './state.js';

// Local HTML-escaping helper (exported for potential reuse)
export function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// --- DOM ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const titleScreen = document.getElementById('titleScreen');
const usernameInput = document.getElementById('username');
const playButton = document.getElementById('playButton');

const loadingScreen = document.getElementById('loadingScreen');
const loadingPlayerEl = document.getElementById('loadingPlayer');
const loadingPlayerNameEl = document.getElementById('loadingPlayerName');
const loadingTextEl = document.getElementById('loadingText');

const chatPanel = document.getElementById('chatPanel');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');

const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const settingsClose = document.getElementById('settingsClose');
const tabButtons = Array.from(document.querySelectorAll('.tabButton'));
const tabContents = Array.from(document.querySelectorAll('.tabContent'));

const mouseMovementCheckbox = document.getElementById('mouseMovement');
const keyboardMovementCheckbox = document.getElementById('keyboardMovement');
const clickMovementCheckbox = document.getElementById('clickMovement');
const graphicsQuality = document.getElementById('graphicsQuality');
const showCoordinatesCheckbox = document.getElementById('showCoordinates');

// Skill tooltip (DOM element)
const skillTooltip = document.createElement('div');
skillTooltip.id = 'skillTooltip';
skillTooltip.style.position = 'fixed';
skillTooltip.style.pointerEvents = 'none';
skillTooltip.style.display = 'none';
skillTooltip.style.zIndex = 9999;
skillTooltip.style.background = 'rgba(10,10,12,0.95)';
skillTooltip.style.color = '#fff';
skillTooltip.style.padding = '8px';
skillTooltip.style.borderRadius = '8px';
skillTooltip.style.fontSize = '12px';
document.body.appendChild(skillTooltip);

// Transient top-center message (for non-chat notifications)
const transientMessage = document.createElement('div');
transientMessage.id = 'transientMessage';
transientMessage.style.position = 'fixed';
transientMessage.style.top = '12px';
transientMessage.style.left = '50%';
transientMessage.style.transform = 'translateX(-50%)';
transientMessage.style.pointerEvents = 'none';
transientMessage.style.display = 'none';
transientMessage.style.zIndex = 10010;
transientMessage.style.background = 'rgba(0,0,0,0.8)';
transientMessage.style.color = '#fff';
transientMessage.style.padding = '10px 14px';
transientMessage.style.borderRadius = '8px';
transientMessage.style.fontSize = '14px';
transientMessage.style.fontWeight = '700';
transientMessage.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6)';
document.body.appendChild(transientMessage);

let transientTimeout = null;
export function showTransientMessage(text, duration = 1600) {
  try {
    if (!transientMessage) return;
    transientMessage.textContent = String(text || '');
    transientMessage.style.display = 'block';
    if (transientTimeout) { clearTimeout(transientTimeout); transientTimeout = null; }
    transientTimeout = setTimeout(() => {
      transientMessage.style.display = 'none';
      transientTimeout = null;
    }, duration);
  } catch (e) {}
}
export function hideTransientMessage() {
  if (!transientMessage) return;
  transientMessage.style.display = 'none';
  if (transientTimeout) { clearTimeout(transientTimeout); transientTimeout = null; }
}

// --- Death overlay ---
// Full-screen greyed overlay shown when the local player dies.
// Includes centered message and a respawn button. The respawn button will
// clear the client's "awaiting respawn" state and let the next server
// snapshot restore the player (the server may respawn as well).
const deathOverlay = document.createElement('div');
deathOverlay.id = 'deathOverlay';
deathOverlay.style.position = 'fixed';
deathOverlay.style.inset = '0';
// keep it hidden and non-interactive until explicitly shown
deathOverlay.style.display = 'none';
deathOverlay.style.visibility = 'hidden';
deathOverlay.style.zIndex = 10050;
deathOverlay.style.background = 'rgba(20,20,22,0.6)';
deathOverlay.style.backdropFilter = 'grayscale(40%) blur(2px)';
deathOverlay.style.webkitBackdropFilter = 'grayscale(40%) blur(2px)';
deathOverlay.style.alignItems = 'center';
deathOverlay.style.justifyContent = 'center';
deathOverlay.style.pointerEvents = 'auto';
deathOverlay.style.flexDirection = 'column';
deathOverlay.style.gap = '18px';
deathOverlay.style.padding = '20px';
deathOverlay.style.boxSizing = 'border-box';
// NOTE: don't set display:flex here so the element stays fully hidden until showDeathOverlay toggles it

const deathBox = document.createElement('div');
deathBox.style.background = 'linear-gradient(180deg, rgba(30,30,30,0.98), rgba(18,18,20,0.98))';
deathBox.style.color = '#fff';
deathBox.style.padding = '28px';
deathBox.style.borderRadius = '12px';
deathBox.style.boxShadow = '0 16px 60px rgba(0,0,0,0.6)';
deathBox.style.maxWidth = 'min(90vw, 520px)';
deathBox.style.textAlign = 'center';
deathBox.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
deathBox.style.pointerEvents = 'auto';

const deathTitle = document.createElement('div');
deathTitle.textContent = 'You have died';
deathTitle.style.fontSize = '28px';
deathTitle.style.fontWeight = '800';
deathTitle.style.color = '#ffd54a';
deathTitle.style.marginBottom = '8px';

const deathMsg = document.createElement('div');
deathMsg.textContent = 'Take a breath. Press respawn to return to the world.';
deathMsg.style.fontSize = '14px';
deathMsg.style.opacity = '0.95';
deathMsg.style.marginBottom = '16px';

const respawnBtn = document.createElement('button');
respawnBtn.id = 'respawnBtn';
respawnBtn.type = 'button';
respawnBtn.textContent = 'Respawn';
respawnBtn.style.fontSize = '16px';
respawnBtn.style.padding = '10px 16px';
respawnBtn.style.borderRadius = '8px';
respawnBtn.style.border = 'none';
respawnBtn.style.background = '#1e90ff';
respawnBtn.style.color = '#fff';
respawnBtn.style.cursor = 'pointer';
respawnBtn.style.boxShadow = '0 8px 24px rgba(30,144,255,0.18)';

respawnBtn.addEventListener('click', () => {
  try {
    // Clear awaitingRespawn on client so snapshot updates will be applied again.
    if (state.player) {
      state.player.awaitingRespawn = false;
      state.player.dead = false;
      // restore radius if we temporarily set it to zero
      if (state.player._radiusBackup !== undefined) {
        state.player.radius = state.player._radiusBackup;
        delete state.player._radiusBackup;
      }
    }
    hideDeathOverlay();
    // Ask server for an updated snapshot if possible (not required but helps reduce latency)
    try { if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch (e) {}
  } catch (e) {}
});

deathBox.appendChild(deathTitle);
deathBox.appendChild(deathMsg);
deathBox.appendChild(respawnBtn);
deathOverlay.appendChild(deathBox);
document.body.appendChild(deathOverlay);

export function showDeathOverlay() {
  if (!deathOverlay) return;
  // Safety guard: only show overlay if we have a player and either we've completed welcome or we are already in awaitingRespawn.
  // This prevents the overlay appearing immediately on a fresh page load (before joining).
  if (!state.player) return;
  if (!state.player.id || (!state.welcomeReceived && !state.player.awaitingRespawn)) return;

  // hide transient tooltip/popups
  hideTransientMessage();
  if (state.dom && state.dom.skillTooltip) state.dom.skillTooltip.style.display = 'none';
  // backup radius and hide player visually by setting radius to 0 (renderers that draw by radius
  // will not show the player). We keep the backup on state.player._radiusBackup to restore later.
  try {
    if (state.player && state.player._radiusBackup === undefined) {
      state.player._radiusBackup = state.player.radius;
      state.player.radius = 0;
    }
  } catch (e) {}
  deathOverlay.style.visibility = 'visible';
  deathOverlay.style.display = 'flex';
  // ensure canvas doesn't receive input while dead unless overlay is dismissed
  try { state.dom.canvas.tabIndex = -1; } catch (e) {}
}

export function hideDeathOverlay() {
  if (!deathOverlay) return;
  deathOverlay.style.display = 'none';
  deathOverlay.style.visibility = 'hidden';
  try { state.dom.canvas.tabIndex = 0; } catch (e) {}
}

// --- Reconnect overlay (auto-reconnect UI) ---
const reconnectOverlay = document.createElement('div');
reconnectOverlay.id = 'reconnectOverlay';
reconnectOverlay.style.position = 'fixed';
reconnectOverlay.style.inset = '0';
reconnectOverlay.style.display = 'none';
reconnectOverlay.style.zIndex = 10020;
reconnectOverlay.style.background = 'rgba(10,10,12,0.6)';
reconnectOverlay.style.backdropFilter = 'blur(3px)';
reconnectOverlay.style.webkitBackdropFilter = 'blur(3px)';
reconnectOverlay.style.alignItems = 'center';
reconnectOverlay.style.justifyContent = 'center';
reconnectOverlay.style.pointerEvents = 'auto';
reconnectOverlay.style.flexDirection = 'column';
reconnectOverlay.style.gap = '12px';
reconnectOverlay.style.padding = '20px';
reconnectOverlay.style.boxSizing = 'border-box';

const reconnectBox = document.createElement('div');
reconnectBox.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))';
reconnectBox.style.color = '#fff';
reconnectBox.style.padding = '18px';
reconnectBox.style.borderRadius = '10px';
reconnectBox.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)';
reconnectBox.style.maxWidth = 'min(92vw, 420px)';
reconnectBox.style.textAlign = 'center';
reconnectBox.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
reconnectBox.style.pointerEvents = 'auto';

const reconnectMsg = document.createElement('div');
reconnectMsg.textContent = 'Disconnected — attempting to reconnect…';
reconnectMsg.style.fontSize = '16px';
reconnectMsg.style.fontWeight = '700';
reconnectMsg.style.marginBottom = '8px';

const reconnectSub = document.createElement('div');
reconnectSub.textContent = 'Trying to restore connection automatically.';
reconnectSub.style.fontSize = '13px';
reconnectSub.style.opacity = '0.95';
reconnectSub.style.marginBottom = '12px';

const reconnectCancelBtn = document.createElement('button');
reconnectCancelBtn.type = 'button';
reconnectCancelBtn.textContent = 'Cancel';
reconnectCancelBtn.style.fontSize = '14px';
reconnectCancelBtn.style.padding = '8px 12px';
reconnectCancelBtn.style.borderRadius = '8px';
reconnectCancelBtn.style.border = 'none';
reconnectCancelBtn.style.background = '#c04';
reconnectCancelBtn.style.color = '#fff';
reconnectCancelBtn.style.cursor = 'pointer';
reconnectCancelBtn.style.boxShadow = '0 8px 24px rgba(192,4,4,0.18)';

let reconnectCancelCallback = null;
reconnectCancelBtn.addEventListener('click', () => {
  try {
    if (typeof reconnectCancelCallback === 'function') reconnectCancelCallback();
  } catch (e) {}
});

reconnectBox.appendChild(reconnectMsg);
reconnectBox.appendChild(reconnectSub);
reconnectBox.appendChild(reconnectCancelBtn);
reconnectOverlay.appendChild(reconnectBox);
document.body.appendChild(reconnectOverlay);

export function setReconnectCancelCallback(fn) { reconnectCancelCallback = fn; }
export function showReconnectOverlay(msg, sub = 'Trying to restore connection automatically.') {
  try {
    reconnectMsg.textContent = String(msg || 'Disconnected — attempting to reconnect…');
    reconnectSub.textContent = String(sub || reconnectSub.textContent);
    reconnectOverlay.style.display = 'flex';
    reconnectOverlay.setAttribute('aria-hidden', 'false');
  } catch (e) {}
}
export function hideReconnectOverlay() {
  try {
    reconnectOverlay.style.display = 'none';
    reconnectOverlay.setAttribute('aria-hidden', 'true');
  } catch (e) {}
}

// ---- gear button (replace existing gearButton creation) ----
const gearButton = document.createElement('button');
gearButton.id = 'gearButton';
gearButton.title = 'Character / Gear';
gearButton.type = 'button';
// match settings button size & style (44x44)
gearButton.style.position = 'fixed';
gearButton.style.width = '44px';
gearButton.style.height = '44px';
gearButton.style.borderRadius = '6px';
gearButton.style.border = 'none';
gearButton.style.background = '#bdbdbd';           // same grey background as settings button
gearButton.style.color = '#1e90ff';
gearButton.style.zIndex = 10005;
gearButton.style.cursor = 'pointer';
gearButton.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6)';
gearButton.style.padding = '6px';
gearButton.style.display = 'flex';
gearButton.style.alignItems = 'center';
gearButton.style.justifyContent = 'center';
gearButton.setAttribute('aria-label', 'Open character and gear panel');

// use your provided PNG as background image (place file at assets/ui/gearpanel.png)
gearButton.style.backgroundImage = "url('assets/ui/gearpanel.png')";
gearButton.style.backgroundRepeat = 'no-repeat';
gearButton.style.backgroundPosition = 'center';
gearButton.style.backgroundSize = '60%'; // scale icon inside button

// ensure there's no text inside the button
gearButton.textContent = '';
document.body.appendChild(gearButton);

// Gear panel (hidden by default)
const gearPanel = document.createElement('div');
gearPanel.id = 'gearPanel';
gearPanel.style.position = 'fixed';
gearPanel.style.top = '80px';
gearPanel.style.right = 'calc(16vw - 220px)'; // fallback; render will reposition gear button dynamically anyway
gearPanel.style.width = '340px';
gearPanel.style.maxWidth = '92vw';
gearPanel.style.background = 'linear-gradient(180deg,#141414,#0b0b0b)';
gearPanel.style.color = '#fff';
gearPanel.style.borderRadius = '10px';
gearPanel.style.padding = '12px';
gearPanel.style.boxShadow = '0 14px 60px rgba(0,0,0,0.6)';
gearPanel.style.zIndex = 10006;
gearPanel.style.display = 'none';
gearPanel.style.pointerEvents = 'auto';
gearPanel.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial';

const gearTitleRow = document.createElement('div');
gearTitleRow.style.display = 'flex';
gearTitleRow.style.justifyContent = 'space-between';
gearTitleRow.style.alignItems = 'center';
gearTitleRow.style.marginBottom = '8px';

const gearTitle = document.createElement('div');
gearTitle.textContent = 'Character';
gearTitle.style.fontWeight = '800';
gearTitle.style.fontSize = '16px';
gearTitleRow.appendChild(gearTitle);

const gearClose = document.createElement('button');
gearClose.type = 'button';
gearClose.textContent = '✕';
gearClose.style.background = 'transparent';
gearClose.style.border = 'none';
gearClose.style.color = '#ddd';
gearClose.style.cursor = 'pointer';
gearClose.style.fontSize = '16px';
gearClose.addEventListener('click', () => { gearPanel.style.display = 'none'; });
gearTitleRow.appendChild(gearClose);
gearPanel.appendChild(gearTitleRow);

// slots container
const slotsContainer = document.createElement('div');
slotsContainer.style.display = 'flex';
slotsContainer.style.gap = '8px';
slotsContainer.style.justifyContent = 'center';
slotsContainer.style.marginBottom = '12px';

// create 5 slot elements
const gearSlots = [];
for (let i = 0; i < state.EQUIP_SLOTS; i++) {
  const slot = document.createElement('div');
  slot.className = 'gearSlot';
  slot.dataset.slot = String(i);
  slot.style.width = '56px';
  slot.style.height = '56px';
  slot.style.borderRadius = '8px';
  slot.style.background = 'rgba(255,255,255,0.03)';
  slot.style.border = '1px solid rgba(255,255,255,0.06)';
  slot.style.display = 'flex';
  slot.style.alignItems = 'center';
  slot.style.justifyContent = 'center';
  slot.style.fontSize = '12px';
  slot.style.color = '#fff';
  slot.style.position = 'relative';
  slot.style.cursor = 'pointer';
  slot.style.userSelect = 'none';

  // label placeholder
  const lbl = document.createElement('div');
  lbl.textContent = '+';
  lbl.style.opacity = '0.8';
  slot.appendChild(lbl);

  // drop handlers
  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.style.outline = '2px dashed rgba(255,255,255,0.18)'; });
  slot.addEventListener('dragleave', (e) => { slot.style.outline = ''; });
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    slot.style.outline = '';
    try {
      let data = null;
      if (e.dataTransfer) {
        // prefer structured data application/json
        const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain') || '';
        if (raw) data = JSON.parse(raw);
      }
      if (data && data.id) {
        // equip item into slot
        const idx = Number(slot.dataset.slot);
        state.equipItem(idx, data);
        updateSlotVisual(idx);
        showTransientMessage(`Equipped ${data.name} (slot ${idx+1})`, 1400);
      } else {
        showTransientMessage('Invalid item dropped', 1200);
      }
    } catch (err) {
      console.warn('drop parse error', err);
      showTransientMessage('Invalid item dropped', 1200);
    }
  });

  // click to unequip
  slot.addEventListener('click', (e) => {
    const idx = Number(slot.dataset.slot);
    if (state.equipment[idx]) {
      state.unequipItem(idx);
      updateSlotVisual(idx);
      showTransientMessage('Unequipped', 900);
    }
  });

  gearSlots.push(slot);
  slotsContainer.appendChild(slot);
}
gearPanel.appendChild(slotsContainer);

// small stats display
const statsBox = document.createElement('div');
statsBox.style.display = 'flex';
statsBox.style.flexDirection = 'column';
statsBox.style.gap = '6px';
statsBox.style.fontSize = '13px';
gearPanel.appendChild(statsBox);

function updateStatsBox() {
  statsBox.innerHTML = '';
  const hp = Math.round(state.player.hp || 0);
  const maxHp = Math.round(state.player.maxHp || 0);
  const xp = Math.round(state.player.xp || 0);
  const nextXp = Math.round(state.player.nextLevelXp || 0);
  const lvl = state.player.level || 1;

  const row1 = document.createElement('div');
  row1.innerHTML = `<strong>${escapeHtml(state.player.name || 'Player')}</strong> — Lv ${lvl}`;
  statsBox.appendChild(row1);

  const row2 = document.createElement('div');
  row2.textContent = `HP: ${hp} / ${maxHp}`;
  statsBox.appendChild(row2);

  const row3 = document.createElement('div');
  row3.textContent = `XP: ${xp} / ${nextXp}`;
  statsBox.appendChild(row3);
}

gearPanel.appendChild(statsBox);

// append to body but keep hidden
document.body.appendChild(gearPanel);
// --- make the gear panel draggable (mouse + touch) and persist position ---
(function makeGearPanelDraggable() {
  if (!gearPanel) return;

  const STORAGE_KEY = 'moborr_gear_panel_pos';

  // Restore saved position (if any)
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const pos = JSON.parse(raw);
      if (typeof pos.left === 'number' && typeof pos.top === 'number') {
        // clear right property if set and apply left/top
        gearPanel.style.right = '';
        gearPanel.style.left = pos.left + 'px';
        gearPanel.style.top = pos.top + 'px';
      }
    }
  } catch (e) { /* ignore */ }

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  // Use the title row as the drag handle so clicking content won't start a drag
  const dragHandle = gearTitleRow || gearPanel; // fallback to whole panel if title row missing
  dragHandle.style.cursor = 'grab'; // visual affordance

  function clampPosition(left, top, panelW, panelH) {
    const vw = Math.max(200, window.innerWidth);
    const vh = Math.max(200, window.innerHeight);
    const minLeft = 8;
    const minTop = 8;
    const maxLeft = Math.max(minLeft, vw - panelW - 8);
    const maxTop = Math.max(minTop, vh - panelH - 8);
    return {
      left: Math.min(maxLeft, Math.max(minLeft, left)),
      top: Math.min(maxTop, Math.max(minTop, top))
    };
  }

  function startDrag(clientX, clientY) {
    const rect = gearPanel.getBoundingClientRect();
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;
    dragging = true;
    // ensure left/top are set so we can move by modifying them
    gearPanel.style.right = '';
    gearPanel.style.left = rect.left + 'px';
    gearPanel.style.top = rect.top + 'px';
    // disable selection while dragging
    document.body.style.userSelect = 'none';
    dragHandle.style.cursor = 'grabbing';
  }

  function moveDrag(clientX, clientY) {
    if (!dragging) return;
    const panelW = gearPanel.offsetWidth;
    const panelH = gearPanel.offsetHeight;
    let left = clientX - dragOffsetX;
    let top = clientY - dragOffsetY;
    const clamped = clampPosition(left, top, panelW, panelH);
    gearPanel.style.left = clamped.left + 'px';
    gearPanel.style.top = clamped.top + 'px';
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    // restore selection behavior
    document.body.style.userSelect = '';
    dragHandle.style.cursor = 'grab';
    // persist position
    try {
      const rect = gearPanel.getBoundingClientRect();
      const pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch (e) {}
  }

  // Mouse events
  dragHandle.addEventListener('mousedown', (ev) => {
    // only left button
    if (ev.button !== 0) return;
    ev.preventDefault();
    startDrag(ev.clientX, ev.clientY);
  });
  window.addEventListener('mousemove', (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    moveDrag(ev.clientX, ev.clientY);
  });
  window.addEventListener('mouseup', () => { endDrag(); });

  // Touch events
  dragHandle.addEventListener('touchstart', (ev) => {
    if (!ev.touches || !ev.touches[0]) return;
    const t = ev.touches[0];
    ev.preventDefault();
    startDrag(t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchmove', (ev) => {
    if (!dragging || !ev.touches || !ev.touches[0]) return;
    const t = ev.touches[0];
    ev.preventDefault();
    moveDrag(t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchend', () => { endDrag(); });
})();
// wire gearButton to toggle panel
gearButton.addEventListener('click', () => {
  if (gearPanel.style.display === 'none' || gearPanel.style.display === '') {
    updateAllSlotVisuals();
    updateStatsBox();
    gearPanel.style.display = 'block';
  } else {
    gearPanel.style.display = 'none';
  }
});

// helpers to update slot visuals
export function updateSlotVisual(slotIndex) {
  const slotEl = gearSlots[slotIndex];
  if (!slotEl) return;
  slotEl.innerHTML = '';
  const it = state.equipment[slotIndex];
  if (!it) {
    const plus = document.createElement('div');
    plus.textContent = '+';
    plus.style.opacity = '0.8';
    slotEl.appendChild(plus);
    slotEl.title = `Empty slot ${slotIndex+1}`;
  } else {
    const icon = document.createElement('div');
    icon.textContent = it.icon || it.name.charAt(0) || '?';
    icon.style.fontSize = '14px';
    icon.style.pointerEvents = 'none';
    slotEl.appendChild(icon);
    const nameBadge = document.createElement('div');
    nameBadge.textContent = it.name || 'Item';
    nameBadge.style.position = 'absolute';
    nameBadge.style.bottom = '-18px';
    nameBadge.style.left = '50%';
    nameBadge.style.transform = 'translateX(-50%)';
    nameBadge.style.fontSize = '11px';
    nameBadge.style.opacity = '0.85';
    slotEl.appendChild(nameBadge);
    slotEl.title = `${it.name}\n${JSON.stringify(it.stats || {})}`;
  }
}

export function updateAllSlotVisuals() {
  for (let i = 0; i < gearSlots.length; i++) updateSlotVisual(i);
  updateStatsBox();
}

// Expose gear show/hide
export function showGearPanel() {
  updateAllSlotVisuals();
  updateStatsBox();
  gearPanel.style.display = 'block';
}
export function hideGearPanel() { gearPanel.style.display = 'none'; }

// Expose DOM items on state.dom for other modules to use
state.dom = {
  canvas, ctx,
  titleScreen, usernameInput, playButton,
  loadingScreen, loadingPlayerEl, loadingPlayerNameEl, loadingTextEl,
  chatPanel, chatLog, chatInput, chatSend,
  settingsBtn, settingsPanel, settingsClose, tabButtons, tabContents,
  mouseMovementCheckbox, keyboardMovementCheckbox, clickMovementCheckbox, graphicsQuality, showCoordinatesCheckbox,
  skillTooltip,
  transientMessage,
  // death overlay
  deathOverlay,
  respawnBtn,
  // reconnect overlay
  reconnectOverlay,
  // gear UI
  gearButton,
  gearPanel,
  gearSlots,
  updateSlotVisual,
  updateAllSlotVisuals,
  showGearPanel,
  hideGearPanel
};

// Hide chat panel until game is ready
if (chatPanel) chatPanel.style.display = 'none';
// Disable chat input until ready
if (chatInput) chatInput.disabled = true;

// Settings persistence (load/save)
export function loadSettings() {
  try {
    const raw = localStorage.getItem('moborr_settings');
    if (!raw) {
      state.settings = Object.assign({}, state.defaultSettings);
      return state.settings;
    }
    state.settings = Object.assign({}, state.defaultSettings, JSON.parse(raw));
    return state.settings;
  } catch (e) {
    state.settings = Object.assign({}, state.defaultSettings);
    return state.settings;
  }
}
export function saveSettings() {
  localStorage.setItem('moborr_settings', JSON.stringify(state.settings));
}

// --- Chat (non-persistent) ---
export function appendChatMessage({ name, text, ts, chatId, system = false, local = false }) {
  if (!state.dom.chatLog) return;
  const el = document.createElement('div');
  el.className = 'chatMessage';
  if (system) el.classList.add('chatSystem');
  if (local) el.classList.add('chatLocal');
  const time = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  if (system) {
    el.innerText = `[${time}] ${text}`;
  } else {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chatName';
    nameSpan.textContent = name ? `${name}: ` : '';
    const textSpan = document.createElement('span');
    textSpan.className = 'chatText';
    textSpan.textContent = text;
    const tsSpan = document.createElement('span');
    tsSpan.className = 'chatTs';
    tsSpan.textContent = time ? ` ${time}` : '';
    el.appendChild(nameSpan);
    el.appendChild(textSpan);
    el.appendChild(tsSpan);
  }

  if (chatId && local) state.pendingChatIds.set(chatId, el);
  state.dom.chatLog.appendChild(el);
  while (state.dom.chatLog.children.length > state.CHAT_MAX) state.dom.chatLog.removeChild(state.dom.chatLog.firstChild);
  state.dom.chatLog.scrollTop = state.dom.chatLog.scrollHeight;
}

export function focusChat() {
  if (!state.dom.chatPanel || !state.dom.chatInput) return;
  if (state.dom.chatInput.disabled) return;
  state.dom.chatInput.focus();
  state.dom.chatInput.select();
  state.chatFocused = true;
}
export function unfocusChat() {
  if (!state.dom.chatInput) return;
  state.dom.chatInput.blur();
  state.chatFocused = false;
  // return focus to canvas so keyboard works for game again
  state.dom.canvas.focus?.();
}

export function setLoadingText(text) {
  if (state.dom.loadingTextEl) state.dom.loadingTextEl.textContent = text;
}

export function cleanupAfterFailedLoad(reason) {
  console.warn('cleanupAfterFailedLoad:', reason);
  if (state.loadingTimeout) { clearTimeout(state.loadingTimeout); state.loadingTimeout = null; }
  if (state.sendInputInterval) { clearInterval(state.sendInputInterval); state.sendInputInterval = null; }
  try { if (state.ws) { state.ws.close(); state.ws = null; } } catch (e) {}
  // hide loading overlay, show title, re-enable login controls
  if (state.dom.loadingScreen) state.dom.loadingScreen.style.display = 'none';
  if (state.dom.titleScreen) state.dom.titleScreen.style.display = 'flex';
  if (state.dom.playButton) state.dom.playButton.disabled = false;
  if (state.dom.usernameInput) state.dom.usernameInput.disabled = false;
  // hide chat (should not be visible until fully ready)
  if (state.dom.chatPanel) state.dom.chatPanel.style.display = 'none';
  if (state.dom.chatInput) state.dom.chatInput.disabled = true;
  state.isLoading = false;
  state.welcomeReceived = false;
  state.gotFirstSnapshot = false;
  // hide skill tooltip
  state.dom.skillTooltip.style.display = 'none';
  hideTransientMessage();
}

// Skill tooltip helpers (kept original rendering/formatting)
export function showSkillTooltip(meta, x, y) {
  const lines = [];
  // Show adjusted damage/duration based on player's permanent multipliers
  const playerDamageMul = (state.player && state.player.damageMul) ? state.player.damageMul : 1;
  const buffDurationMul = (state.player && state.player.buffDurationMul) ? state.player.buffDurationMul : 1;

  lines.push(`<div style="font-weight:700;margin-bottom:6px;">${escapeHtml(meta.name)}</div>`);
  if (meta.kind === 'melee' && typeof meta.range === 'number') lines.push(`<div style="font-size:12px;"><strong>Range:</strong> ${meta.range}</div>`);
  else if (typeof meta.radius === 'number') lines.push(`<div style="font-size:12px;"><strong>Radius:</strong> ${meta.radius}</div>`);

  if (typeof meta.damage === 'number') {
    const adjustedDamage = Math.round(meta.damage * playerDamageMul);
    if (playerDamageMul !== 1) lines.push(`<div style="font-size:12px;"><strong>Damage:</strong> ${adjustedDamage} <small style="opacity:0.7">(base ${meta.damage})</small></div>`);
    else lines.push(`<div style="font-size:12px;"><strong>Damage:</strong> ${adjustedDamage}</div>`);
  }
  if (typeof meta.count === 'number') lines.push(`<div style="font-size:12px;"><strong>Count:</strong> ${meta.count}</div>`);
  if (typeof meta.cooldown === 'number') lines.push(`<div style="font-size:12px;"><strong>Cooldown:</strong> ${meta.cooldown}s</div>`);
  if (meta.buff) {
    if (meta.buff.type === 'speed') {
      const dur = Math.round(((meta.buff.durationMs||0) * buffDurationMul)/1000);
      lines.push(`<div style="font-size:12px;"><strong>Buff:</strong> Speed x${meta.buff.multiplier} for ${dur}s</div>`);
    } else if (meta.buff.type === 'damage') {
      const dur = Math.round(((meta.buff.durationMs||0) * buffDurationMul)/1000);
      lines.push(`<div style="font-size:12px;"><strong>Buff:</strong> Damage x${meta.buff.multiplier} for ${dur}s</div>`);
    } else {
      // generic representation, adjust duration if present
      const copied = JSON.parse(JSON.stringify(meta.buff));
      if (copied.durationMs) copied.durationMs = Math.round(copied.durationMs * buffDurationMul);
      lines.push(`<div style="font-size:12px;"><strong>Buff:</strong> ${escapeHtml(JSON.stringify(copied))}</div>`);
    }
  }
  if (meta.stunMs) lines.push(`<div style="font-size:12px;"><strong>Stun:</strong> ${Math.round(meta.stunMs/1000)}s</div>`);
  skillTooltip.innerHTML = lines.join('');
  // clamp to viewport to avoid going offscreen
  const left = Math.max(6, Math.min(window.innerWidth - 220, x));
  const top = Math.max(6, Math.min(window.innerHeight - 120, y));
  skillTooltip.style.left = `${left}px`;
  skillTooltip.style.top = `${top}px`;
  skillTooltip.style.display = 'block';
}
export function hideSkillTooltip() {
  skillTooltip.style.display = 'none';
}

// Export DOM elements/refs for other modules
export function getCanvasContext() {
  return { canvas, ctx };
}

// Expose DOM object for other modules (already assigned to state.dom)
export default {
  canvas,
  ctx,
  titleScreen,
  usernameInput,
  playButton,
  loadingScreen,
  loadingPlayerEl,
  loadingPlayerNameEl,
  loadingTextEl,
  chatPanel,
  chatLog,
  chatInput,
  chatSend,
  settingsBtn,
  settingsPanel,
  settingsClose,
  tabButtons,
  tabContents,
  mouseMovementCheckbox,
  keyboardMovementCheckbox,
  clickMovementCheckbox,
  graphicsQuality,
  showCoordinatesCheckbox,
  skillTooltip,
  transientMessage,
  showTransientMessage,
  hideTransientMessage,
  appendChatMessage,
  focusChat,
  unfocusChat,
  loadSettings,
  saveSettings,
  setLoadingText,
  cleanupAfterFailedLoad,
  showSkillTooltip,
  hideSkillTooltip,
  // death overlay exports
  showDeathOverlay,
  hideDeathOverlay,
  // reconnect overlay exports
  setReconnectCancelCallback,
  showReconnectOverlay,
  hideReconnectOverlay,
  // gear exports
  gearButton,
  gearPanel,
  gearSlots,
  updateSlotVisual,
  updateAllSlotVisuals,
  showGearPanel,
  hideGearPanel
};
