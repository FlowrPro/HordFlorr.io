// DOM references, UI handlers (chat, settings, skill tooltip), and small helpers.
// Logic kept intact from original main.js but moved into dom.js to centralize DOM manipulation.

import { state } from './state.js';
import { escapeHtml } from './dom_helpers_internal.js'; // a tiny internal helper below

// We put a very small local helper file content below (since we can't have circular import).
// The file dom_helpers_internal.js content is included inline here to keep everything together in one file
// (in your filesystem you may split it to a separate module if you prefer).
// For clarity in this split, escapeHtml is implemented here:

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

// expose some DOM items on state.dom for other modules to use
state.dom = {
  canvas, ctx,
  titleScreen, usernameInput, playButton,
  loadingScreen, loadingPlayerEl, loadingPlayerNameEl, loadingTextEl,
  chatPanel, chatLog, chatInput, chatSend,
  settingsBtn, settingsPanel, settingsClose, tabButtons, tabContents,
  mouseMovementCheckbox, keyboardMovementCheckbox, clickMovementCheckbox, graphicsQuality, showCoordinatesCheckbox,
  skillTooltip
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
}

// Skill tooltip helpers (kept original rendering/formatting)
export function showSkillTooltip(meta, x, y) {
  const lines = [];
  lines.push(`<div style="font-weight:700;margin-bottom:6px;">${escapeHtml(meta.name)}</div>`);
  if (meta.kind === 'melee' && typeof meta.range === 'number') lines.push(`<div style="font-size:12px;"><strong>Range:</strong> ${meta.range}</div>`);
  else if (typeof meta.radius === 'number') lines.push(`<div style="font-size:12px;"><strong>Radius:</strong> ${meta.radius}</div>`);
  if (typeof meta.damage === 'number') lines.push(`<div style="font-size:12px;"><strong>Damage:</strong> ${meta.damage}</div>`);
  if (typeof meta.count === 'number') lines.push(`<div style="font-size:12px;"><strong>Count:</strong> ${meta.count}</div>`);
  if (typeof meta.cooldown === 'number') lines.push(`<div style="font-size:12px;"><strong>Cooldown:</strong> ${meta.cooldown}s</div>`);
  if (meta.buff) {
    if (meta.buff.type === 'speed') lines.push(`<div style="font-size:12px;"><strong>Buff:</strong> Speed x${meta.buff.multiplier} for ${Math.round((meta.buff.durationMs||0)/1000)}s</div>`);
    else if (meta.buff.type === 'damage') lines.push(`<div style="font-size:12px;"><strong>Buff:</strong> Damage x${meta.buff.multiplier} for ${Math.round((meta.buff.durationMs||0)/1000)}s</div>`);
    else lines.push(`<div style="font-size:12px;"><strong>Buff:</strong> ${escapeHtml(JSON.stringify(meta.buff))}</div>`);
  }
  if (meta.stunMs) lines.push(`<div style="font-size:12px;"><strong>Stun:</strong> ${Math.round(meta.stunMs/1000)}s</div>`);
  skillTooltip.innerHTML = lines.join('');
  skillTooltip.style.left = `${Math.min(window.innerWidth - 220, x)}px`;
  skillTooltip.style.top = `${Math.min(window.innerHeight - 120, y)}px`;
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
  appendChatMessage,
  focusChat,
  unfocusChat,
  loadSettings,
  saveSettings,
  setLoadingText,
  cleanupAfterFailedLoad,
  showSkillTooltip,
  hideSkillTooltip
};