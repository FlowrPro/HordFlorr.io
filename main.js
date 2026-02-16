// Entry point: wires modules, initializes DOM, input, network and rendering loop.

import dom, { loadSettings, saveSettings, setLoadingText, cleanupAfterFailedLoad, appendChatMessage, showTransientMessage } from './dom.js';
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
  console.log('=== selectMode called ===');
  console.log('mode:', mode);
  console.log('state.ws:', state.ws);
  console.log('state.ws?.readyState:', state.ws?.readyState);
  console.log('WebSocket.OPEN:', WebSocket.OPEN);
  console.log('state.welcomeReceived:', state.welcomeReceived);
  
  // Ensure we're ready
  if (!state.welcomeReceived) {
    console.error('Not ready to select mode yet - welcome not received');
    showTransientMessage('Not ready yet - try again', 1500);
    return;
  }
  
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not open!');
    showTransientMessage('WebSocket not connected - try again', 1500);
    return;
  }

  state.gameMode = mode;
  state.gameState = 'queue';
  
  console.log('Hiding mode select screen...');
  dom.hideModeSelectScreen();
  
  console.log('Showing queue screen...');
  dom.showQueueScreen();
  
  showTransientMessage(`Joining ${mode} queue...`, 1500);
  
  console.log('Sending join_queue message...');
  try {
    const msg = { t: 'join_queue', mode: mode };
    console.log('Message to send:', msg);
    state.ws.send(JSON.stringify(msg));
    console.log('✓ Successfully sent join_queue for mode:', mode);
  } catch (e) {
    console.error('✗ Failed to send join_queue:', e);
    showTransientMessage('Failed to join queue: ' + e.message, 2000);
    // Revert state
    dom.showModeSelectScreen();
    dom.hideQueueScreen();
    state.gameState = 'mode_select';
  }
}

// Wire up play button
if (state.dom.playButton) {
  state.dom.playButton.addEventListener('click', startGame);
  console.log('✓ Wired play button');
}

// Wire up username input enter key
if (state.dom.usernameInput) {
  state.dom.usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { 
      e.preventDefault(); 
      startGame(); 
    }
  });
  console.log('✓ Wired username input');
}

// Wire up FFA button - CRITICAL
function wireUpFfaButton() {
  const ffaBtn = document.getElementById('ffaButton');
  if (ffaBtn) {
    console.log('✓ Found FFA button, wiring click handler');
    ffaBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('=== FFA BUTTON CLICKED ===');
      selectMode('ffa');
    });
  } else {
    console.warn('✗ FFA button not found in DOM');
  }
}

// Wire up cancel queue button
function wireUpCancelQueueButton() {
  const cancelBtn = document.getElementById('cancelQueueBtn');
  if (cancelBtn) {
    console.log('✓ Found cancel queue button, wiring click handler');
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('✓ Cancel queue button clicked');
      state.gameState = 'mode_select';
      dom.hideQueueScreen();
      dom.showModeSelectScreen();
      
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        try {
          state.ws.send(JSON.stringify({ t: 'cancel_queue' }));
          console.log('✓ Sent cancel_queue to server');
        } catch (e) {
          console.error('Failed to send cancel_queue:', e);
        }
      }
    });
  } else {
    console.warn('✗ Cancel queue button not found in DOM');
  }
}

// Call these immediately
wireUpFfaButton();
wireUpCancelQueueButton();

// Also try on DOM content loaded to ensure buttons exist
document.addEventListener('DOMContentLoaded', () => {
  console.log('✓ DOMContentLoaded event fired');
  wireUpFfaButton();
  wireUpCancelQueueButton();
});

// Initialize input handlers
input.initInputHandlers();

// Start render loop
render.startLoop();

// Expose for debugging
window.moborr = {
  startGame,
  selectMode,
  connectToServer: network.connectToServer,
  appendChatMessage,
  castSkill: input.castSkill,
  selectTarget: (id, kind) => { state.selectedTarget = { id: String(id), kind }; },
  state,
  dom
};

console.log('✓ Main.js initialized - window.moborr is ready');
