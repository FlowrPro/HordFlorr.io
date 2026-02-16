// DOM references, UI handlers (chat, settings, skill tooltip), inventory and gear UI.
// Centralized DOM manipulation and drag/drop logic.

import { state } from './state.js';

// Local HTML-escaping helper (exported for potential reuse)
export function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// --- DOM core elements from index.html ---
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

// Small helper: notify server of equipment changes so server-side auto-heal uses authoritative maxHp.
function sendEquipUpdate(slotIndex) {
  try {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      const it = (state.equipment && state.equipment[slotIndex]) ? state.equipment[slotIndex] : null;
      state.ws.send(JSON.stringify({ t: 'equip', slot: Number(slotIndex), item: it }));
    }
  } catch (e) {}
}

// Skill tooltip (DOM element)
const skillTooltip = document.createElement('div');
skillTooltip.id = 'skillTooltip';
skillTooltip.style.position = 'fixed';
skillTooltip.style.pointerEvents = 'none';
skillTooltip.style.display = 'none';
skillTooltip.style.zIndex = '9999';
skillTooltip.style.background = 'rgba(10,10,12,0.95)';
skillTooltip.style.color = '#fff';
skillTooltip.style.padding = '8px';
skillTooltip.style.borderRadius = '8px';
skillTooltip.style.fontSize = '12px';
skillTooltip.style.maxWidth = '220px';
document.body.appendChild(skillTooltip);

// Item tooltip (wider than skill tooltip)
const itemTooltip = document.createElement('div');
itemTooltip.id = 'itemTooltip';
itemTooltip.style.position = 'fixed';
itemTooltip.style.pointerEvents = 'none';
itemTooltip.style.display = 'none';
itemTooltip.style.zIndex = '10000';
itemTooltip.style.background = 'rgba(18,18,20,0.96)';
itemTooltip.style.color = '#fff';
itemTooltip.style.padding = '12px';
itemTooltip.style.borderRadius = '10px';
itemTooltip.style.fontSize = '13px';
itemTooltip.style.boxShadow = '0 10px 30px rgba(0,0,0,0.6)';
itemTooltip.style.width = '320px'; // wider than skill tooltip
itemTooltip.style.maxWidth = 'min(92vw, 360px)';
document.body.appendChild(itemTooltip);

export function showItemTooltip(it, x, y) {
  try {
    if (!it) return;
    const lines = [];
    lines.push(`<div style="font-weight:800;font-size:15px;margin-bottom:6px;">${escapeHtml(it.name || 'Item')}</div>`);
    if (it.stats && typeof it.stats === 'object') {
      lines.push('<div style="font-size:13px;color:#ddd;margin-bottom:6px;"><strong>Stats</strong></div>');
      lines.push('<div style="font-size:13px;color:#fff">');
      for (const k of Object.keys(it.stats)) {
        const v = it.stats[k];
        // pretty key: convert camelCase -> words
        const pretty = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        lines.push(`<div style="margin:2px 0;"><strong>${escapeHtml(pretty)}:</strong> ${escapeHtml(String(v))}</div>`);
      }
      lines.push('</div>');
    } else {
      lines.push('<div style="font-size:13px;color:#ddd">No stats</div>');
    }
    itemTooltip.innerHTML = lines.join('');
    // position (clamp to viewport)
    const w = Math.min(window.innerWidth - 12, 360);
    let left = x + 12;
    let top = y + 12;
    if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 12);
    itemTooltip.style.left = `${Math.max(8, left)}px`;
    itemTooltip.style.top = `${Math.max(8, top)}px`;
    itemTooltip.style.display = 'block';
  } catch (e) {}
}
export function hideItemTooltip() { try { itemTooltip.style.display = 'none'; } catch (e) {} }

// Transient top-center message (for non-chat notifications)
const transientMessage = document.createElement('div');
transientMessage.id = 'transientMessage';
transientMessage.style.position = 'fixed';
transientMessage.style.top = '12px';
transientMessage.style.left = '50%';
transientMessage.style.transform = 'translateX(-50%)';
transientMessage.style.pointerEvents = 'none';
transientMessage.style.display = 'none';
transientMessage.style.zIndex = '10010';
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

// --- Death overlay (same as before) ---
const deathOverlay = document.createElement('div');
deathOverlay.id = 'deathOverlay';
deathOverlay.style.position = 'fixed';
deathOverlay.style.inset = '0';
deathOverlay.style.display = 'none';
deathOverlay.style.visibility = 'hidden';
deathOverlay.style.zIndex = '10050';
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
    if (state.player) {
      state.player.awaitingRespawn = false;
      state.player.dead = false;
      if (state.player._radiusBackup !== undefined) {
        state.player.radius = state.player._radiusBackup;
        delete state.player._radiusBackup;
      }
    }
    hideDeathOverlay();
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
  if (!state.player) return;
  if (!state.player.id || (!state.welcomeReceived && !state.player.awaitingRespawn)) return;
  hideTransientMessage();
  if (state.dom && state.dom.skillTooltip) state.dom.skillTooltip.style.display = 'none';
  try {
    if (state.player && state.player._radiusBackup === undefined) {
      state.player._radiusBackup = state.player.radius;
      state.player.radius = 0;
    }
  } catch (e) {}
  deathOverlay.style.visibility = 'visible';
  deathOverlay.style.display = 'flex';
  try { state.dom.canvas.tabIndex = -1; } catch (e) {}
}

export function hideDeathOverlay() {
  if (!deathOverlay) return;
  deathOverlay.style.display = 'none';
  deathOverlay.style.visibility = 'hidden';
  try { state.dom.canvas.tabIndex = 0; } catch (e) {}
}

// --- Reconnect overlay ---
const reconnectOverlay = document.createElement('div');
reconnectOverlay.id = 'reconnectOverlay';
reconnectOverlay.style.position = 'fixed';
reconnectOverlay.style.inset = '0';
reconnectOverlay.style.display = 'none';
reconnectOverlay.style.zIndex = '10020';
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

// --- Expose core DOM refs early for main.js usage ---
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
  reconnectOverlay
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
  if (state.dom.loadingScreen) state.dom.loadingScreen.style.display = 'none';
  if (state.dom.titleScreen) state.dom.titleScreen.style.display = 'flex';
  if (state.dom.playButton) state.dom.playButton.disabled = false;
  if (state.dom.usernameInput) state.dom.usernameInput.disabled = false;
  if (state.dom.chatPanel) state.dom.chatPanel.style.display = 'none';
  if (state.dom.chatInput) state.dom.chatInput.disabled = true;
  // hide inventory as well
  try { if (state.dom.inventoryContainer) state.dom.inventoryContainer.style.display = 'none'; } catch (e) {}
  state.isLoading = false;
  state.welcomeReceived = false;
  state.gotFirstSnapshot = false;
  if (state.dom.skillTooltip) state.dom.skillTooltip.style.display = 'none';
  hideTransientMessage();
}

// Skill tooltip helpers
export function showSkillTooltip(meta, x, y) {
  const lines = [];
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
      const copied = JSON.parse(JSON.stringify(meta.buff));
      if (copied.durationMs) copied.durationMs = Math.round(copied.durationMs * buffDurationMul);
      lines.push(`<div style="font-size:12px;"><strong>Buff:</strong> ${escapeHtml(JSON.stringify(copied))}</div>`);
    }
  }
  if (meta.stunMs) lines.push(`<div style="font-size:12px;"><strong>Stun:</strong> ${Math.round(meta.stunMs/1000)}s</div>`);
  skillTooltip.innerHTML = lines.join('');
  const left = Math.max(6, Math.min(window.innerWidth - 220, x));
  const top = Math.max(6, Math.min(window.innerHeight - 120, y));
  skillTooltip.style.left = `${left}px`;
  skillTooltip.style.top = `${top}px`;
  skillTooltip.style.display = 'block';
}
export function hideSkillTooltip() {
  skillTooltip.style.display = 'none';
}

// Helper to create an <img> element for an item with no "@2x" derivation.
function createItemImageElement(it, cssFit = 'contain') {
  const img = new Image();
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = cssFit;
  img.alt = it.name || 'item';
  img.src = it.img;
  img.onerror = () => {};
  return img;
}

// ----------------- Gear UI -----------------
const gearButton = document.createElement('button');
gearButton.id = 'gearButton';
gearButton.title = 'Character / Gear';
gearButton.type = 'button';
gearButton.style.position = 'fixed';
gearButton.style.width = '44px';
gearButton.style.height = '44px';
gearButton.style.borderRadius = '6px';
gearButton.style.border = 'none';
gearButton.style.background = '#bdbdbd';
gearButton.style.color = '#1e90ff';
gearButton.style.zIndex = '10005';
gearButton.style.cursor = 'pointer';
gearButton.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6)';
gearButton.style.padding = '6px';
gearButton.style.display = 'flex';
gearButton.style.alignItems = 'center';
gearButton.style.justifyContent = 'center';
gearButton.setAttribute('aria-label', 'Open character and gear panel');
gearButton.style.backgroundImage = "url('assets/ui/gearpanel.png')";
gearButton.style.backgroundRepeat = 'no-repeat';
gearButton.style.backgroundPosition = 'center';
gearButton.style.backgroundSize = '60%';
gearButton.textContent = '';
document.body.appendChild(gearButton);

// Gear panel
const gearPanel = document.createElement('div');
gearPanel.id = 'gearPanel';
gearPanel.style.position = 'fixed';
gearPanel.style.top = '80px';
gearPanel.style.right = '16px';
gearPanel.style.width = '340px';
gearPanel.style.maxWidth = '92vw';
gearPanel.style.background = 'linear-gradient(180deg,#141414,#0b0b0b)';
gearPanel.style.color = '#fff';
gearPanel.style.borderRadius = '10px';
gearPanel.style.padding = '12px';
gearPanel.style.boxShadow = '0 14px 60px rgba(0,0,0,0.6)';
gearPanel.style.zIndex = '10006';
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
gearClose.style.zIndex = '10010';
gearClose.style.padding = '0';
gearClose.style.width = '24px';
gearClose.style.height = '24px';
gearClose.addEventListener('click', () => { gearPanel.style.display = 'none'; gearOverlay.style.display = 'none'; });
gearTitleRow.appendChild(gearClose);
gearPanel.appendChild(gearTitleRow);

const slotsContainer = document.createElement('div');
slotsContainer.style.display = 'flex';
slotsContainer.style.gap = '8px';
slotsContainer.style.justifyContent = 'center';
slotsContainer.style.marginBottom = '12px';

let gearSlots = [];

const statsBox = document.createElement('div');
statsBox.style.display = 'flex';
statsBox.style.flexDirection = 'column';
statsBox.style.gap = '6px';
statsBox.style.fontSize = '13px';

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
document.body.appendChild(gearPanel);

// CREATE OVERLAY AS FIXED ELEMENT THAT MATCHES PANEL POSITION
const gearOverlay = document.createElement('div');
gearOverlay.id = 'gearOverlay';
gearOverlay.style.position = 'fixed';
gearOverlay.style.top = '80px';
gearOverlay.style.right = '16px';
gearOverlay.style.width = '340px';
gearOverlay.style.maxWidth = '92vw';
gearOverlay.style.borderRadius = '10px';
gearOverlay.style.background = 'rgba(0,0,0,0.7)';
gearOverlay.style.display = 'none';
gearOverlay.style.alignItems = 'center';
gearOverlay.style.justifyContent = 'center';
gearOverlay.style.zIndex = '10008';
gearOverlay.style.pointerEvents = 'auto';
gearOverlay.style.flexDirection = 'column';
gearOverlay.style.paddingTop = '50px';
gearOverlay.style.paddingBottom = '12px';
gearOverlay.style.boxSizing = 'border-box';
gearOverlay.style.minHeight = '250px';

const overlayText = document.createElement('div');
overlayText.textContent = 'Coming soon';
overlayText.style.fontSize = '28px';
overlayText.style.fontWeight = '800';
overlayText.style.color = '#fff';
overlayText.style.textAlign = 'center';
overlayText.style.textShadow = '0 2px 8px rgba(0,0,0,0.9)';

gearOverlay.appendChild(overlayText);
document.body.appendChild(gearOverlay);

function blockSlotInteractionWhileOverlayActive(slot) {
  slot.addEventListener('click', (e) => {
    if (gearOverlay.style.display !== 'none') {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  slot.addEventListener('dragstart', (e) => {
    if (gearOverlay.style.display !== 'none') {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  slot.addEventListener('dragover', (e) => {
    if (gearOverlay.style.display !== 'none') {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  slot.addEventListener('drop', (e) => {
    if (gearOverlay.style.display !== 'none') {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

gearButton.addEventListener('click', () => {
  if (gearPanel.style.display === 'none' || gearPanel.style.display === '') {
    updateAllSlotVisuals();
    updateStatsBox();
    gearPanel.style.display = 'block';
    gearOverlay.style.display = 'flex';
  } else {
    gearPanel.style.display = 'none';
    gearOverlay.style.display = 'none';
  }
});

// --- Inventory UI (bottom-right) ---
const inventoryContainer = document.createElement('div');
inventoryContainer.id = 'inventoryContainer';
inventoryContainer.style.position = 'fixed';
inventoryContainer.style.bottom = '12px';
inventoryContainer.style.right = '12px';
inventoryContainer.style.zIndex = '10005';
inventoryContainer.style.padding = '10px';
inventoryContainer.style.borderRadius = '10px';
inventoryContainer.style.background = 'rgba(20,20,22,0.55)';
inventoryContainer.style.boxShadow = '0 10px 30px rgba(0,0,0,0.6)';
inventoryContainer.style.pointerEvents = 'auto';
inventoryContainer.style.display = 'none';
inventoryContainer.style.gridTemplateColumns = 'repeat(4, 64px)';
inventoryContainer.style.gridAutoRows = '64px';
inventoryContainer.style.gap = '10px';
inventoryContainer.style.alignItems = 'center';
inventoryContainer.style.justifyItems = 'center';

const inventorySlots = [];
for (let i = 0; i < state.INV_SLOTS; i++) {
  const slot = document.createElement('div');
  slot.className = 'inventorySlot';
  slot.dataset.index = String(i);

  slot.style.width = '64px';
  slot.style.height = '64px';
  slot.style.borderRadius = '8px';
  slot.style.background = 'rgba(255,255,255,0.03)';
  slot.style.border = '1px solid rgba(255,255,255,0.06)';
  slot.style.display = 'flex';
  slot.style.alignItems = 'center';
  slot.style.justifyContent = 'center';
  slot.style.fontSize = '14px';
  slot.style.color = '#fff';
  slot.style.position = 'relative';
  slot.style.cursor = 'default';
  slot.style.userSelect = 'none';
  slot.draggable = false;

  const inner = document.createElement('div');
  inner.style.pointerEvents = 'none';
  inner.style.width = '100%';
  inner.style.height = '100%';
  inner.style.display = 'flex';
  inner.style.alignItems = 'center';
  inner.style.justifyContent = 'center';
  slot.appendChild(inner);

  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.style.outline = '2px dashed rgba(255,255,255,0.14)'; });
  slot.addEventListener('dragleave', (e) => { slot.style.outline = ''; });
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    slot.style.outline = '';
    const raw = (e.dataTransfer && (e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain'))) || '';
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch (err) { return; }

    const destIdx = Number(slot.dataset.index);

    if (data.source === 'inventory') {
      const srcIdx = Number(data.index);
      if (srcIdx === destIdx) return;
      const srcItem = state.inventory[srcIdx];
      const dstItem = state.inventory[destIdx];
      state.inventory[destIdx] = srcItem;
      state.inventory[srcIdx] = dstItem;
      updateInventorySlotVisual(srcIdx);
      updateInventorySlotVisual(destIdx);
      showTransientMessage('Moved item', 800);
    } else if (data.source === 'gear') {
      const srcSlot = Number(data.index);
      const item = state.equipment[srcSlot];
      if (!item) { showTransientMessage('No item to move', 900); return; }
      if (state.inventory[destIdx]) {
        const dstItem = state.inventory[destIdx];
        state.inventory[destIdx] = item;
        state.equipment[srcSlot] = dstItem;
        state.applyEquipmentBonuses();
        updateInventorySlotVisual(destIdx);
        updateSlotVisual(srcSlot);
        updateAllSlotVisuals();
        updateStatsBox();
        showTransientMessage('Swapped gear and inventory item', 1000);
        sendEquipUpdate(srcSlot);
      } else {
        state.inventory[destIdx] = item;
        state.unequipItem(srcSlot);
        updateInventorySlotVisual(destIdx);
        updateSlotVisual(srcSlot);
        updateAllSlotVisuals();
        updateStatsBox();
        showTransientMessage('Moved to inventory', 900);
        sendEquipUpdate(srcSlot);
      }
    } else if (data.source === 'external') {
      const it = data.item;
      if (!it) return;
      if (state.inventory[destIdx]) {
        const old = state.inventory[destIdx];
        state.inventory[destIdx] = it;
        let free = state.inventory.findIndex(s => !s);
        if (free < 0) {
          showTransientMessage('Inventory full', 1200);
          state.inventory[destIdx] = old;
          return;
        } else {
          state.inventory[free] = old;
        }
      } else {
        state.inventory[destIdx] = it;
      }
      updateInventorySlotVisual(destIdx);
      showTransientMessage('Picked up item', 900);
    }
  });

  inventorySlots.push(slot);
  inventoryContainer.appendChild(slot);
}
document.body.appendChild(inventoryContainer);

// --- Gear slots creation ---
gearSlots = [];
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

  const lbl = document.createElement('div');
  lbl.textContent = '+';
  lbl.style.opacity = '0.8';
  slot.appendChild(lbl);

  slot.draggable = false;
  slot.addEventListener('dragstart', function (e) {
    const idx = Number(this.dataset.slot);
    const it = state.equipment[idx];
    if (!it || !e.dataTransfer) { e.preventDefault(); return; }
    const payload = { item: JSON.parse(JSON.stringify(it)), source: 'gear', index: idx };
    try { e.dataTransfer.setData('application/json', JSON.stringify(payload)); } catch (err) {}
    try { e.dataTransfer.setData('text/plain', JSON.stringify(payload)); } catch (err) {}
    try { e.dataTransfer.effectAllowed = 'move'; } catch (err) {}

    try {
      const dragCanvas = document.createElement('canvas');
      dragCanvas.width = 64; dragCanvas.height = 64;
      const c = dragCanvas.getContext('2d');
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(0,0,64,64);

      if (it.img) {
        const img = new Image();
        img.src = it.img;
        if (img.complete && img.naturalWidth > 0) {
          const pad = 6;
          c.drawImage(img, pad, pad, 64 - pad*2, 64 - pad*2);
          try { e.dataTransfer.setDragImage(dragCanvas, 32, 32); } catch (err) {}
          return;
        }
      }

      c.fillStyle = '#fff';
      c.font = '32px system-ui, Arial';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(it.icon || (it.name ? it.name.charAt(0) : '?'), 32, 34);
      try { e.dataTransfer.setDragImage(dragCanvas, 32, 32); } catch (err) {}
    } catch (err) {}
  });

  slot.addEventListener('dragover', (e) => { 
    if (gearOverlay.style.display !== 'none') { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault(); 
    slot.style.outline = '2px dashed rgba(255,255,255,0.18)'; 
  });
  
  slot.addEventListener('dragleave', (e) => { 
    if (gearOverlay.style.display !== 'none') { e.preventDefault(); e.stopPropagation(); return; }
    slot.style.outline = ''; 
  });

  slot.addEventListener('drop', (e) => {
    if (gearOverlay.style.display !== 'none') {
      e.preventDefault();
      e.stopPropagation();
      slot.style.outline = '';
      return;
    }
    
    e.preventDefault();
    slot.style.outline = '';
    const raw = (e.dataTransfer && (e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain'))) || '';
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch (err) { return; }
    const dst = Number(slot.dataset.slot);

    if (data.source === 'inventory') {
      const srcInv = Number(data.index);
      const item = state.inventory[srcInv];
      if (!item) { showTransientMessage('Invalid item', 900); return; }
      const existing = state.equipment[dst];
      if (!existing) {
        state.equipItem(dst, item);
        state.inventory[srcInv] = null;
        updateInventorySlotVisual(srcInv);
        updateSlotVisual(dst);
        updateAllSlotVisuals();
        updateStatsBox();
        showTransientMessage(`Equipped ${item.name}`, 1000);
        sendEquipUpdate(dst);
      } else {
        state.equipment[dst] = item;
        state.inventory[srcInv] = existing;
        state.applyEquipmentBonuses();
        updateSlotVisual(dst);
        updateInventorySlotVisual(srcInv);
        updateAllSlotVisuals();
        updateStatsBox();
        showTransientMessage('Swapped with inventory item', 1000);
        sendEquipUpdate(dst);
      }
    } else if (data.source === 'gear') {
      const srcGear = Number(data.index);
      if (srcGear === dst) return;
      const a = state.equipment[srcGear];
      const b = state.equipment[dst];
      state.equipment[dst] = a || null;
      state.equipment[srcGear] = b || null;
      state.applyEquipmentBonuses();
      updateSlotVisual(dst);
      updateSlotVisual(srcGear);
      updateStatsBox();
      showTransientMessage('Swapped gear slots', 900);
      sendEquipUpdate(dst);
      sendEquipUpdate(srcGear);
    } else if (data.source === 'external') {
      const it = data.item;
      if (!it) return;
      const existing = state.equipment[dst];
      if (!existing) {
        state.equipItem(dst, it);
        state.applyEquipmentBonuses();
        updateSlotVisual(dst);
        updateStatsBox();
        showTransientMessage(`Equipped ${it.name}`, 900);
        sendEquipUpdate(dst);
      } else {
        const free = state.inventory.findIndex(s => !s);
        if (free >= 0) {
          state.inventory[free] = existing;
          state.equipItem(dst, it);
          state.applyEquipmentBonuses();
          updateInventorySlotVisual(free);
          updateSlotVisual(dst);
          updateStatsBox();
          showTransientMessage(`Equipped ${it.name} and moved old item to inventory`, 1200);
          sendEquipUpdate(dst);
        } else {
          showTransientMessage('Inventory full — cannot equip', 1200);
        }
      }
    }
  });

  slot.addEventListener('click', (e) => {
    if (gearOverlay.style.display !== 'none') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    const idx = Number(slot.dataset.slot);
    const it = state.equipment[idx];
    if (!it) return;
    const added = addItemToInventory(it);
    if (added >= 0) {
      state.unequipItem(idx);
      state.applyEquipmentBonuses();
      updateSlotVisual(idx);
      updateStatsBox();
      showTransientMessage('Unequipped to inventory', 1000);
      sendEquipUpdate(idx);
    } else {
      showTransientMessage('Inventory full — cannot unequip', 1200);
    }
  });

  blockSlotInteractionWhileOverlayActive(slot);
  gearSlots.push(slot);
  slotsContainer.appendChild(slot);
}
gearPanel.insertBefore(slotsContainer, statsBox);

export function updateSlotVisual(slotIndex) {
  const slotEl = gearSlots[slotIndex];
  if (!slotEl) return;
  slotEl.innerHTML = '';
  slotEl.style.backgroundImage = '';
  slotEl.style.backgroundRepeat = '';
  slotEl.style.backgroundPosition = '';
  slotEl.style.backgroundSize = '';

  const it = state.equipment[slotIndex];
  if (!it) {
    const plus = document.createElement('div');
    plus.textContent = '+';
    plus.style.opacity = '0.8';
    slotEl.appendChild(plus);
    slotEl.title = `Empty slot ${slotIndex + 1}`;
    slotEl.draggable = false;
    slotEl.onmouseenter = null;
    slotEl.onmouseleave = null;
    return;
  }

  if (it.img && typeof it.img === 'string') {
    const imgEl = createItemImageElement(it, 'contain');
    imgEl.addEventListener('error', () => {
      slotEl.innerHTML = '';
      const icon = document.createElement('div');
      icon.textContent = it.icon || (it.name ? it.name.charAt(0) : '?');
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
    });
    slotEl.appendChild(imgEl);

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
    slotEl.draggable = true;

    slotEl.onmouseenter = (ev) => { showItemTooltip(it, ev.clientX, ev.clientY); };
    slotEl.onmousemove = (ev) => { showItemTooltip(it, ev.clientX, ev.clientY); };
    slotEl.onmouseleave = () => { hideItemTooltip(); };
    return;
  }

  const icon = document.createElement('div');
  icon.textContent = it.icon || (it.name ? it.name.charAt(0) : '?');
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
  slotEl.draggable = true;

  slotEl.onmouseenter = (ev) => { showItemTooltip(it, ev.clientX, ev.clientY); };
  slotEl.onmousemove = (ev) => { showItemTooltip(it, ev.clientX, ev.clientY); };
  slotEl.onmouseleave = () => { hideItemTooltip(); };
}

export function updateAllSlotVisuals() {
  for (let i = 0; i < gearSlots.length; i++) updateSlotVisual(i);
  updateStatsBox();
}

function inventoryDragStartHandler(e) {
  const srcSlot = Number(this.dataset.index != null ? this.dataset.index : (this.parentElement && this.parentElement.dataset.index) || -1);
  const item = state.inventory[srcSlot];
  if (!item || !e.dataTransfer) { e.preventDefault(); return; }
  const payload = { item: JSON.parse(JSON.stringify(item)), source: 'inventory', index: srcSlot };
  try { e.dataTransfer.setData('application/json', JSON.stringify(payload)); } catch (err) {}
  try { e.dataTransfer.setData('text/plain', JSON.stringify(payload)); } catch (err) {}
  try { e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
  try {
    const dragCanvas = document.createElement('canvas');
    dragCanvas.width = 64; dragCanvas.height = 64;
    const c = dragCanvas.getContext('2d');
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(0,0,64,64);
    if (item.img) {
      const img = new Image();
      img.src = item.img;
      if (img.complete && img.naturalWidth > 0) {
        const pad = 6;
        c.drawImage(img, pad, pad, 64 - pad*2, 64 - pad*2);
        try { e.dataTransfer.setDragImage(dragCanvas, 32, 32); } catch (err) {}
        return;
      }
    }
    c.fillStyle = '#fff';
    c.font = '28px system-ui, Arial';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(item.icon || (item.name ? item.name.charAt(0) : '?'), 32, 34);
    try { e.dataTransfer.setDragImage(dragCanvas, 32, 32); } catch (err) {}
  } catch (err) {}
}

function updateInventorySlotVisual(slotIndex) {
  const slotEl = inventorySlots[slotIndex];
  const inner = slotEl && slotEl.firstElementChild;
  if (!slotEl || !inner) return;
  inner.innerHTML = '';
  slotEl.draggable = false;
  slotEl.title = `Empty`;

  const it = state.inventory[slotIndex];
  if (!it) {
    const plus = document.createElement('div');
    plus.textContent = '';
    plus.style.opacity = '0.0';
    inner.appendChild(plus);
    slotEl.draggable = false;
    slotEl.removeEventListener('dragstart', inventoryDragStartHandler);
    slotEl.onmouseenter = null;
    slotEl.onmouseleave = null;
    slotEl.onmousemove = null;
    return;
  }

  if (it.img && typeof it.img === 'string') {
    const img = createItemImageElement(it, 'contain');
    img.addEventListener('error', () => {
      inner.innerHTML = '';
      const icon = document.createElement('div');
      icon.textContent = it.icon || (it.name ? it.name.charAt(0) : '?');
      icon.style.fontSize = '20px';
      icon.style.pointerEvents = 'none';
      inner.appendChild(icon);
    });
    inner.appendChild(img);
    slotEl.title = `${it.name || 'Item'}`;
    slotEl.draggable = true;
    slotEl.removeEventListener('dragstart', inventoryDragStartHandler);
    slotEl.addEventListener('dragstart', inventoryDragStartHandler);
    slotEl.onmouseenter = (ev) => { showItemTooltip(it, ev.clientX, ev.clientY); };
    slotEl.onmousemove = (ev) => { showItemTooltip(it, ev.clientX, ev.clientY); };
    slotEl.onmouseleave = () => { hideItemTooltip(); };
    return;
  }

  const icon = document.createElement('div');
  icon.textContent = it.icon || (it.name ? it.name.charAt(0) : '?');
  icon.style.fontSize = '20px';
  icon.style.pointerEvents = 'none';
  inner.appendChild(icon);
  slotEl.title = `${it.name || 'Item'}`;
  slotEl.draggable = true;
  slotEl.removeEventListener('dragstart', inventoryDragStartHandler);
  slotEl.addEventListener('dragstart', inventoryDragStartHandler);
  slotEl.onmouseenter = (ev) => { showItemTooltip(it, ev.clientX, ev.clientY); };
  slotEl.onmousemove = (ev) => { showItemTooltip(it, ev.clientX, ev.clientY); };
  slotEl.onmouseleave = () => { hideItemTooltip(); };
}

function updateInventoryVisuals() {
  for (let i = 0; i < inventorySlots.length; i++) updateInventorySlotVisual(i);
}

export function addItemToInventory(item, preferredIndex = -1) {
  if (!item) return -1;
  if (typeof preferredIndex === 'number' && preferredIndex >= 0 && preferredIndex < state.INV_SLOTS && !state.inventory[preferredIndex]) {
    state.inventory[preferredIndex] = JSON.parse(JSON.stringify(item));
    updateInventorySlotVisual(preferredIndex);
    return preferredIndex;
  }
  const free = state.inventory.findIndex(s => !s);
  if (free < 0) return -1;
  state.inventory[free] = JSON.parse(JSON.stringify(item));
  updateInventorySlotVisual(free);
  return free;
}

export function removeItemFromInventory(slotIndex) {
  if (typeof slotIndex !== 'number' || slotIndex < 0 || slotIndex >= state.INV_SLOTS) return null;
  const it = state.inventory[slotIndex];
  state.inventory[slotIndex] = null;
  updateInventorySlotVisual(slotIndex);
  return it;
}

updateInventoryVisuals();
updateAllSlotVisuals();

(function makeGearPanelDraggable() {
  if (!gearPanel) return;

  const STORAGE_KEY = 'moborr_gear_panel_pos';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const pos = JSON.parse(raw);
      if (typeof pos.left === 'number' && typeof pos.top === 'number') {
        gearPanel.style.right = '';
        gearPanel.style.left = pos.left + 'px';
        gearPanel.style.top = pos.top + 'px';
        gearOverlay.style.right = '';
        gearOverlay.style.left = pos.left + 'px';
        gearOverlay.style.top = pos.top + 'px';
      }
    }
  } catch (e) {}

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const dragHandle = gearTitleRow || gearPanel;
  dragHandle.style.cursor = 'grab';

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
    gearPanel.style.right = '';
    gearPanel.style.left = rect.left + 'px';
    gearPanel.style.top = rect.top + 'px';
    gearOverlay.style.right = '';
    gearOverlay.style.left = rect.left + 'px';
    gearOverlay.style.top = rect.top + 'px';
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
    gearOverlay.style.left = clamped.left + 'px';
    gearOverlay.style.top = clamped.top + 'px';
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    dragHandle.style.cursor = 'grab';
    try {
      const rect = gearPanel.getBoundingClientRect();
      const pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch (e) {}
  }

  dragHandle.addEventListener('mousedown', (ev) => {
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

export function showInventory() {
  try {
    inventoryContainer.style.display = 'grid';
    updateInventoryVisuals();
  } catch (e) {}
}
export function hideInventory() {
  try {
    inventoryContainer.style.display = 'none';
  } catch (e) {}
}

state.dom.gearButton = gearButton;
state.dom.gearPanel = gearPanel;
state.dom.gearOverlay = gearOverlay;
state.dom.gearSlots = gearSlots;
state.dom.updateSlotVisual = updateSlotVisual;
state.dom.updateAllSlotVisuals = updateAllSlotVisuals;
state.dom.showGearPanel = () => { updateAllSlotVisuals(); updateStatsBox(); gearPanel.style.display = 'block'; gearOverlay.style.display = 'flex'; };
state.dom.hideGearPanel = () => { gearPanel.style.display = 'none'; gearOverlay.style.display = 'none'; };

state.dom.inventoryContainer = inventoryContainer;
state.dom.inventorySlots = inventorySlots;
state.dom.addItemToInventory = addItemToInventory;
state.dom.removeItemFromInventory = removeItemFromInventory;
state.dom.updateInventoryVisuals = updateInventoryVisuals;
state.dom.showInventory = showInventory;
state.dom.hideInventory = hideInventory;

export default {
  canvas, ctx, titleScreen, usernameInput, playButton,
  loadingScreen, loadingPlayerEl, loadingPlayerNameEl, loadingTextEl,
  chatPanel, chatLog, chatInput, chatSend,
  settingsBtn, settingsPanel, settingsClose, tabButtons, tabContents,
  mouseMovementCheckbox, keyboardMovementCheckbox, clickMovementCheckbox, graphicsQuality, showCoordinatesCheckbox,
  skillTooltip, transientMessage, showTransientMessage, hideTransientMessage,
  appendChatMessage, focusChat, unfocusChat, loadSettings, saveSettings,
  setLoadingText, cleanupAfterFailedLoad, showSkillTooltip, hideSkillTooltip,
  showDeathOverlay, hideDeathOverlay, setReconnectCancelCallback, showReconnectOverlay, hideReconnectOverlay,
  gearButton, gearPanel, gearOverlay, gearSlots, updateSlotVisual, updateAllSlotVisuals,
  showGearPanel: state.dom.showGearPanel, hideGearPanel: state.dom.hideGearPanel,
  inventoryContainer, inventorySlots, addItemToInventory, removeItemFromInventory,
  updateInventoryVisuals, showInventory, hideInventory
};
