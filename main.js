// Entry point: wires modules, initializes DOM, input, network and rendering loop.

import dom, { loadSettings, saveSettings, setLoadingText, cleanupAfterFailedLoad, appendChatMessage } from './dom.js';
import { state } from './state.js';
import * as utils from './utils.js';
import * as network from './network.js';
import * as input from './input.js';
import * as render from './render.js';
import { preloadIcons } from './icons.js';

const canvas = state.dom.canvas;
const ctx = state.dom.ctx;

loadSettings();
if (state.dom.mouseMovementCheckbox) state.dom.mouseMovementCheckbox.checked = state.settings.mouseMovement;
if (state.dom.keyboardMovementCheckbox) state.dom.keyboardMovementCheckbox.checked = state.settings.keyboardMovement;
if (state.dom.clickMovementCheckbox) state.dom.clickMovementCheckbox.checked = state.settings.clickMovement;
if (state.dom.graphicsQuality) state.dom.graphicsQuality.value = state.settings.graphicsQuality;
if (state.dom.showCoordinatesCheckbox) state.dom.showCoordinatesCheckbox.checked = state.settings.showCoordinates;

try {
  const iconManifest = [];
  for (const cls in state.SKILL_META) {
    const arr = state.SKILL_META[cls] || [];
    for (const m of arr) if (m && m.type) iconManifest.push({ class: cls, type: m.type });
  }
  preloadIcons(iconManifest).catch(() => {});
} catch (e) {}

const savedName = localStorage.getItem('moborr_username');
if (savedName && state.dom.usernameInput) state.dom.usernameInput.value = savedName;

export function startGame() {
  if (state.isLoading) return;
  state.isLoading = true;
  try {
    const sel = document.querySelector('input[name="class"]:checked');
    if (sel && sel.value) state.player.class = sel.value;
  } catch (e) {}
  const name = state.dom.usernameInput && state.dom.usernameInput.value.trim() ? state.dom.usernameInput.value.trim() : 'Player';
  state.player.name = name;
  state.player.level = state.player.level || 1;
  state.player.xp = state.player.xp || 0;
  localStorage.setItem('moborr_username', name);
  if (state.dom.loadingPlayerEl) state.dom.loadingPlayerEl.style.background = state.player.color || '#ffd54a';
  if (state.dom.loadingPlayerNameEl) state.dom.loadingPlayerNameEl.textContent = state.player.name || '';
  setLoadingText('Connecting…');
  if (state.dom.titleScreen) state.dom.titleScreen.style.display = 'none';
  if (state.dom.loadingScreen) state.dom.loadingScreen.style.display = 'flex';
  if (state.dom.playButton) state.dom.playButton.disabled = true;
  if (state.dom.usernameInput) state.dom.usernameInput.disabled = true;
  if (state.dom.chatInput) state.dom.chatInput.disabled = true;
  network.connectToServer();
  state.loadingTimeout = setTimeout(() => {
    if (state.isLoading) {
      console.warn('LOADING TIMEOUT fired');
      cleanupAfterFailedLoad('timeout');
      setLoadingText('Connection timeout');
    }
  }, 12000);
}

export function selectMode(mode) {
  state.gameMode = mode;
  state.gameState = 'queue';
  
  dom.hideModeSelectScreen();
  dom.showQueueScreen();
  
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try {
      state.ws.send(JSON.stringify({ t: 'join_queue', mode: mode }));
      console.log('Sent join_queue for mode:', mode);
    } catch (e) {
      console.error('Failed to send join_queue:', e);
    }
  }
}

if (state.dom.playButton) state.dom.playButton.addEventListener('click', startGame);
if (state.dom.usernameInput) state.dom.usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); startGame(); }
});

if (document.getElementById('ffaButton')) {
  document.getElementById('ffaButton').addEventListener('click', () => {
    console.log('FFA button clicked');
    selectMode('ffa');
  });
}

if (document.getElementById('cancelQueueBtn')) {
  document.getElementById('cancelQueueBtn').addEventListener('click', () => {
    console.log('Cancel queue clicked');
    state.gameState = 'mode_select';
    dom.hideQueueScreen();
    dom.showModeSelectScreen();
    
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      try {
        state.ws.send(JSON.stringify({ t: 'cancel_queue' }));
      } catch (e) {}
    }
  });
}

input.initInputHandlers();
render.startLoop();

window.moborr = {
  startGame,
  selectMode,
  connectToServer: network.connectToServer,
  appendChatMessage,
  castSkill: input.castSkill,
  selectTarget: (id, kind) => { state.selectedTarget = { id: String(id), kind }; }
};
