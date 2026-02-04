// Entry point: wires modules, initializes DOM, input, network and rendering loop.
// All original behavior preserved.

import dom, { loadSettings, saveSettings, setLoadingText, cleanupAfterFailedLoad, appendChatMessage } from './dom.js';
import { state } from './state.js';
import * as utils from './utils.js';
import * as network from './network.js';
import * as input from './input.js';
import * as render from './render.js';
import { preloadIcons } from './icons.js'; // preload hotbar icons

// Attach canvas/context to local variables for ease of use
const canvas = state.dom.canvas;
const ctx = state.dom.ctx;

// Initialize settings
loadSettings();
if (state.dom.mouseMovementCheckbox) state.dom.mouseMovementCheckbox.checked = state.settings.mouseMovement;
if (state.dom.keyboardMovementCheckbox) state.dom.keyboardMovementCheckbox.checked = state.settings.keyboardMovement;
if (state.dom.clickMovementCheckbox) state.dom.clickMovementCheckbox.checked = state.settings.clickMovement;
if (state.dom.graphicsQuality) state.dom.graphicsQuality.value = state.settings.graphicsQuality;
if (state.dom.showCoordinatesCheckbox) state.dom.showCoordinatesCheckbox.checked = state.settings.showCoordinates;

function saveSettingsWrapper() {
  saveSettings();
}

// Preload skill icons (non-blocking) to improve hotbar visuals.
// Build a manifest from SKILL_META so we preload the icon files you're most likely to use.
try {
  const iconManifest = [];
  for (const cls in state.SKILL_META) {
    const arr = state.SKILL_META[cls] || [];
    for (const m of arr) if (m && m.type) iconManifest.push({ class: cls, type: m.type });
  }
  // call preloadIcons with manifest (returns a Promise)
  preloadIcons(iconManifest).catch(() => {});
} catch (e) { /* ignore */ }

// --- Title / login / settings UI wiring ---
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

// Wire play button and username enter to startGame
if (state.dom.playButton) state.dom.playButton.addEventListener('click', startGame);
if (state.dom.usernameInput) state.dom.usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); startGame(); }
});

// Initialize input handlers and expose computeInputVector to network
input.initInputHandlers();

// Start the render loop
render.startLoop();

// Expose for debugging and compatibility with existing code
window.moborr = {
  startGame,
  connectToServer: network.connectToServer,
  appendChatMessage,
  castSkill: input.castSkill,
  selectTarget: (id, kind) => { state.selectedTarget = { id: String(id), kind }; }
};
