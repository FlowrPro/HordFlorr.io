// WebSocket connection, server message handling, and network lifecycle.
// Phase 2: Full matchmaking support

import { state } from './state.js';
import dom, { appendChatMessage, setLoadingText, cleanupAfterFailedLoad, showDeathOverlay, showReconnectOverlay, hideReconnectOverlay, setReconnectCancelCallback, showTransientMessage, showModeSelectScreen, showQueueScreen, hideQueueScreen, updateQueueDisplay, updateCountdownDisplay } from './dom.js';

const VERBOSE_NETWORK = false;

let ws = null;
let sendInputInterval = null;
let seq = 0;

let reconnectAttempts = 0;
let reconnectTimer = null;
let reconnectCountdownTimer = null;
let reconnectCancelled = false;
let nextReconnectDelay = 1000;
const RECONNECT_BASE = 1000;
const RECONNECT_MULT = 2;
const RECONNECT_MAX = 30000;

export function connectToServer() {
  stopReconnect();

  if (!state.SERVER_URL) {
    console.warn('CONNECTING -> no SERVER_URL configured');
    setLoadingText('No server URL set');
    cleanupAfterFailedLoad('no_server_url');
    return;
  }
  state.welcomeReceived = false;
  state.gotFirstSnapshot = false;
  setLoadingText('Connecting…');
  if (VERBOSE_NETWORK) console.log('CONNECTING ->', state.SERVER_URL);
  try {
    ws = new WebSocket(state.SERVER_URL);
  } catch (err) {
    console.warn('Failed to create WebSocket', err);
    setLoadingText('Connection failed (exception creating WebSocket)');
    cleanupAfterFailedLoad('ws_create_exception');
    startReconnect();
    return;
  }
  state.ws = ws;

  ws.addEventListener('open', () => {
    if (VERBOSE_NETWORK) console.log('WS OPEN');
    stopReconnect();

    setLoadingText('Connected — joining…');
    const name = state.player.name || (state.dom.usernameInput && state.dom.usernameInput.value.trim() ? state.dom.usernameInput.value.trim() : 'Player');
    state.player.name = name;
    try {
      ws.send(JSON.stringify({ t: 'join', name, class: state.player.class }));
      if (VERBOSE_NETWORK) console.log('WS SENT: join', { name: state.player.name, class: state.player.class });
      setLoadingText('Joining…');
    } catch (e) {
      console.warn('WS send(join) failed', e);
      setLoadingText('Failed to send join');
      cleanupAfterFailedLoad('send_join_failed');
      return;
    }
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (VERBOSE_NETWORK) {
        if (msg && msg.t) console.log('WS MESSAGE t=', msg.t, msg);
        else console.log('WS MESSAGE (raw)', msg);
      }
      handleServerMessage(msg);
    } catch (e) {
      console.log('WS message parse error', e);
    }
  });

  ws.addEventListener('close', (ev) => {
    if (VERBOSE_NETWORK) console.log('WS CLOSE code=', ev.code, 'reason=', ev.reason);
    if (state.isLoading) {
      setLoadingText('Disconnected: ' + (ev.reason || ('code ' + ev.code)));
      cleanupAfterFailedLoad('ws_close_during_load:' + (ev.reason || ev.code));
      return;
    }
    if (state.dom.chatInput) state.dom.chatInput.disabled = true;
    if (state.dom.chatPanel) state.dom.chatPanel.style.display = 'none';
    if (state.sendInputInterval) { clearInterval(state.sendInputInterval); state.sendInputInterval = null; }
    state.ws = null;
    ws = null;
    if (sendInputInterval) { clearInterval(sendInputInterval); sendInputInterval = null; }

    if (!reconnectCancelled) {
      startReconnect();
    } else {
      hideReconnectOverlay();
    }
  });

  ws.addEventListener('error', (err) => {
    console.warn('WS ERROR', err);
    if (state.isLoading) {
      setLoadingText('Connection error');
      cleanupAfterFailedLoad('ws_error');
    } else {
      setLoadingText('Connection error');
    }
  });
}

export function sendInputPacket() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  if (!state.welcomeReceived) return;
  const input = computeInputVector();
  try { state.ws.send(JSON.stringify({ t: 'input', seq: ++seq, input })); } catch (e) {}
}

export function setComputeInputFunc(fn) {
  state.computeInputVector = fn;
}
function computeInputVector() {
  return (typeof state.computeInputVector === 'function') ? state.computeInputVector() : { x: 0, y: 0 };
}

function startReconnect() {
  if (reconnectTimer || reconnectCancelled) return;
  reconnectAttempts = Math.max(1, reconnectAttempts + 1);
  const delay = Math.min(RECONNECT_BASE * Math.pow(RECONNECT_MULT, reconnectAttempts - 1), RECONNECT_MAX);
  nextReconnectDelay = delay;

  let remaining = Math.ceil(delay / 1000);
  const attemptNumber = reconnectAttempts;
  showReconnectOverlay(`Disconnected — attempting to reconnect in ${remaining}s (attempt ${attemptNumber})`);
  reconnectCountdownTimer = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    showReconnectOverlay(`Disconnected — attempting to reconnect in ${remaining}s (attempt ${attemptNumber})`);
  }, 1000);

  reconnectTimer = setTimeout(() => {
    if (reconnectCountdownTimer) { clearInterval(reconnectCountdownTimer); reconnectCountdownTimer = null; }
    reconnectTimer = null;
    if (reconnectCancelled) {
      hideReconnectOverlay();
      return;
    }
    try {
      connectToServer();
    } catch (e) {
      startReconnect();
    }
  }, delay);
}

function stopReconnect() {
  reconnectAttempts = 0;
  reconnectCancelled = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (reconnectCountdownTimer) { clearInterval(reconnectCountdownTimer); reconnectCountdownTimer = null; }
  hideReconnectOverlay();
}

function cancelReconnect() {
  reconnectCancelled = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (reconnectCountdownTimer) { clearInterval(reconnectCountdownTimer); reconnectCountdownTimer = null; }
  hideReconnectOverlay();
}

try { setReconnectCancelCallback(cancelReconnect); } catch (e) {}

export function handleServerMessage(msg) {
  if (!msg || !msg.t) return;

  // --- MATCHMAKING MESSAGES ---
  if (msg.t === 'queue_update') {
    console.log('📊 QUEUE UPDATE:', msg);
    const queuePlayers = msg.players || [];
    state.queuePlayers = queuePlayers.map(p => p.name);
    const currentCount = queuePlayers.length;
    const maxCount = 10;
    try {
      updateQueueDisplay(state.queuePlayers, currentCount, maxCount);
      console.log(`✓ Queue updated: ${currentCount}/${maxCount} players`);
    } catch (e) { console.error('Error updating queue display:', e); }
    return;
    
  } else if (msg.t === 'match_created') {
    console.log('🎮 MATCH CREATED:', msg);
    state.matchId = msg.matchId;
    state.matchCountdownMs = msg.countdownMs || 120000;
    state.gameState = 'countdown';
    state.matchCountdownStartedAt = Date.now();
    console.log('✓ Match created, countdown starting for:', state.matchCountdownMs, 'ms');
    return;
    
  } else if (msg.t === 'match_countdown') {
    console.log('⏱️ MATCH COUNTDOWN:', msg);
    const remaining = msg.remainingMs || 0;
    const countdownPlayers = msg.players || [];
    state.matchCountdownMs = remaining;
    const currentCount = countdownPlayers.length;
    const maxCount = 10;
    
    // If less than MIN_PLAYERS and countdown still going, show message
    if (currentCount < 4 && remaining > 0) {
      console.warn('⚠️ Not enough players:', currentCount, '- need 4, countdown still going');
    }
    
    try {
      updateCountdownDisplay(remaining, countdownPlayers.map(p => p.name), currentCount, maxCount);
    } catch (e) { console.error('Error updating countdown display:', e); }
    
    // If countdown reached zero with not enough players, return to mode select
    if (remaining <= 0 && currentCount < 4) {
      console.warn('❌ Match cancelled: insufficient players');
      state.gameState = 'mode_select';
      try { hideQueueScreen(); } catch (e) {}
      try { showModeSelectScreen(); } catch (e) {}
      try { showTransientMessage('Match cancelled: not enough players', 2500); } catch (e) {}
      return;
    }
    
    // If countdown reached zero with enough players, wait for match_start
    if (remaining <= 0) {
      console.log('⏱️ Countdown ended - waiting for match_start...');
    }
    return;
    
  } else if (msg.t === 'match_start') {
    console.log('🚀 MATCH START received');
    state.gameState = 'in_game';
    state.matchId = msg.matchId;
    state.matchTimeRemainingMs = msg.matchDurationMs || 1800000;
    state.matchStartTime = Date.now();
    
    try { hideQueueScreen(); } catch (e) {}
    
    if (msg.id) state.player.id = String(msg.id);
    if (msg.player) {
      if (typeof msg.player.level === 'number') state.player.level = msg.player.level;
      if (typeof msg.player.xp === 'number') state.player.xp = msg.player.xp;
      if (msg.player.class) state.player.class = msg.player.class;
      if (typeof msg.player.maxHp === 'number') {
        let equipBonus = 0;
        try {
          if (Array.isArray(state.equipment)) {
            for (const it of state.equipment) {
              if (it && it.stats && typeof it.stats.maxHp === 'number') equipBonus += Number(it.stats.maxHp);
            }
          }
        } catch (e) { equipBonus = 0; }
        state.player._baseMaxHp = Math.max(1, Math.round(Number(msg.player.maxHp) - equipBonus));
        state.player.maxHp = Number(msg.player.maxHp);
        state.player.hp = Math.min(state.player.hp || state.player.maxHp, state.player.maxHp);
      }
    }
    
    if (msg.mapType === 'square' || msg.mapSize || msg.mapHalf || msg.mapRadius) {
      state.map.type = 'square';
      state.map.half = (msg.mapHalf || msg.mapRadius || (msg.mapSize ? msg.mapSize / 2 : state.map.half));
      state.map.size = msg.mapSize || (state.map.half * 2);
      state.map.center = { x: 0, y: 0 };
      state.map.walls = Array.isArray(msg.walls) ? msg.walls : [];
      state.map._jaggedNeedsUpdate = true;
    } else if (msg.mapType === 'circle' || msg.mapRadius) {
      state.map.type = 'circle';
      state.map.radius = (msg.mapRadius || msg.mapHalf || state.map.radius);
      state.map.center = { x: 0, y: 0 };
      state.map.walls = Array.isArray(msg.walls) ? msg.walls : [];
      state.map._jaggedNeedsUpdate = true;
    }
    
    if (typeof msg.spawnX === 'number' && typeof msg.spawnY === 'number') {
      state.player.x = msg.spawnX;
      state.player.y = msg.spawnY;
    }
    
    state.gotFirstSnapshot = false;
    
    try {
      if (typeof state.applyEquipmentBonuses === 'function') state.applyEquipmentBonuses();
      if (state.dom && typeof state.dom.updateAllSlotVisuals === 'function') state.dom.updateAllSlotVisuals();
    } catch (e) {}

    if (!state.sendInputInterval) state.sendInputInterval = setInterval(sendInputPacket, 50);
    if (state.dom.chatPanel) state.dom.chatPanel.style.display = 'flex';
    if (state.dom.chatInput) state.dom.chatInput.disabled = false;
    try { state.dom.canvas.focus(); } catch (e) {}

    try {
      if (state.dom && typeof state.dom.showInventory === 'function') state.dom.showInventory();
      else if (state.dom && state.dom.inventoryContainer) state.dom.inventoryContainer.style.display = 'grid';
    } catch (e) {}
    
    console.log('✓ Match started - entering game');
    return;
  }
  
  // --- CORE WELCOME ---
  else if (msg.t === 'welcome') {
    if (VERBOSE_NETWORK) console.log('GOT welcome from server');
    if (msg.id) state.player.id = String(msg.id);
    if (msg.player) {
      if (typeof msg.player.level === 'number') state.player.level = msg.player.level;
      if (typeof msg.player.xp === 'number') state.player.xp = msg.player.xp;
      if (msg.player.class) state.player.class = msg.player.class;
      if (typeof msg.player.maxHp === 'number') {
        let equipBonus = 0;
        try {
          if (Array.isArray(state.equipment)) {
            for (const it of state.equipment) {
              if (it && it.stats && typeof it.stats.maxHp === 'number') equipBonus += Number(it.stats.maxHp);
            }
          }
        } catch (e) { equipBonus = 0; }
        state.player._baseMaxHp = Math.max(1, Math.round(Number(msg.player.maxHp) - equipBonus));
        state.player.maxHp = Number(msg.player.maxHp);
        state.player.hp = Math.min(state.player.hp || state.player.maxHp, state.player.maxHp);
      }
    }
    
    if (msg.mapType === 'square' || msg.mapSize || msg.mapHalf || msg.mapRadius) {
      state.map.type = 'square';
      state.map.half = (msg.mapHalf || msg.mapRadius || (msg.mapSize ? msg.mapSize / 2 : state.map.half));
      state.map.size = msg.mapSize || (state.map.half * 2);
      state.map.center = { x: 0, y: 0 };
      state.map.walls = Array.isArray(msg.walls) ? msg.walls : [];
      state.map._jaggedNeedsUpdate = true;
    } else if (msg.mapType === 'circle' || msg.mapRadius) {
      state.map.type = 'circle';
      state.map.radius = (msg.mapRadius || msg.mapHalf || state.map.radius);
      state.map.center = { x: 0, y: 0 };
      state.map.walls = Array.isArray(msg.walls) ? msg.walls : [];
      state.map._jaggedNeedsUpdate = true;
    }
    
    if (VERBOSE_NETWORK) console.log('Server welcome. my id =', state.player.id);
    state.welcomeReceived = true;
    state.isLoading = false;
    state.gameState = 'mode_select';
    
    if (state.dom.loadingScreen) state.dom.loadingScreen.style.display = 'none';
    if (state.dom.titleScreen) state.dom.titleScreen.style.display = 'none';
    
    try {
      showModeSelectScreen();
    } catch (e) {
      console.error('Error showing mode select screen:', e);
    }
    return;
  }
  
  // --- SNAPSHOT ---
  else if (msg.t === 'snapshot') {
    const list = msg.players || [];
    const seen = new Set();
    for (const sp of list) {
      const id = String(sp.id);
      seen.add(id);
      if (id === state.player.id) {
        if (state.player && state.player.awaitingRespawn) {
          continue;
        }

        state.player.serverX = sp.x; 
        state.player.serverY = sp.y;
        const dx = state.player.serverX - state.player.x; 
        const dy = state.player.serverY - state.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 140) { 
          state.player.x = state.player.serverX; 
          state.player.y = state.player.serverY; 
        }
        state.player.vx = sp.vx || state.player.vx; 
        state.player.vy = sp.vy || state.player.vy;
        state.player.color = sp.color || state.player.color; 
        state.player.radius = sp.radius || state.player.radius;
        state.player.name = sp.name || state.player.name;
        if (typeof sp.level === 'number') state.player.level = sp.level;
        if (typeof sp.xp === 'number') state.player.xp = sp.xp;
        if (typeof sp.nextLevelXp === 'number') state.player.nextLevelXp = sp.nextLevelXp;
        if (typeof sp.kills === 'number') state.player.kills = sp.kills;

        if (typeof sp.maxHp === 'number') {
          let equipBonus = 0;
          try {
            if (Array.isArray(state.equipment)) {
              for (const it of state.equipment) {
                if (it && it.stats && typeof it.stats.maxHp === 'number') equipBonus += Number(it.stats.maxHp);
              }
            }
          } catch (e) { equipBonus = 0; }
          state.player._baseMaxHp = Math.max(1, Math.round(Number(sp.maxHp) - equipBonus));
          state.player.maxHp = Number(sp.maxHp);
        }

        if (typeof sp.hp === 'number') {
          const prevHp = Number.isFinite(state.player.hp) ? state.player.hp : 0;
          const newHp = sp.hp;
          if (newHp > prevHp) {
            state.remoteEffects.push({
              type: 'heal',
              x: state.player.x,
              y: state.player.y - (state.player.radius + 12),
              color: 'rgba(120,255,140,0.95)',
              text: `+${newHp - prevHp} HP`,
              start: Date.now(),
              duration: 1200
            });
          } else if (newHp < prevHp) {
            state.remoteEffects.push({
              type: 'damage',
              x: state.player.x,
              y: state.player.y - (state.player.radius + 6),
              color: 'rgba(255,80,80,0.95)',
              text: `${prevHp - newHp}`,
              start: Date.now(),
              duration: 1100
            });
            state.remoteEffects.push({ 
              type: 'aoe', 
              x: state.player.x, 
              y: state.player.y, 
              radius: 24, 
              color: 'rgba(255,80,80,0.9)', 
              start: Date.now(), 
              duration: 350 
            });
          }
          state.player.hp = newHp;
        }

        try {
          if (typeof state.applyEquipmentBonuses === 'function') state.applyEquipmentBonuses();
          if (state.dom && typeof state.dom.updateAllSlotVisuals === 'function') state.dom.updateAllSlotVisuals();
        } catch (e) {}

       } else {
        let rp = state.remotePlayers.get(id);
        if (!rp) {
          rp = { 
            id, 
            name: sp.name, 
            targetX: sp.x, 
            targetY: sp.y, 
            displayX: sp.x, 
            displayY: sp.y, 
            vx: sp.vx || 0, 
            vy: sp.vy || 0, 
            radius: sp.radius, 
            color: sp.color || '#ff7', 
            level: sp.level || 1, 
            kills: sp.kills || 0,
            hp: sp.hp || 100,           // ✅ ADD THIS
            maxHp: sp.maxHp || 100      // ✅ ADD THIS
          };
          state.remotePlayers.set(id, rp);
        } else {
          rp.name = sp.name || rp.name; 
          rp.targetX = sp.x; 
          rp.targetY = sp.y; 
          rp.vx = sp.vx || rp.vx; 
          rp.vy = sp.vy || rp.vy; 
          rp.radius = sp.radius || rp.radius; 
          rp.color = sp.color || rp.color; 
          rp.level = sp.level || rp.level; 
          rp.kills = sp.kills || 0;
          rp.hp = sp.hp || rp.hp;       
          rp.maxHp = sp.maxHp || rp.maxHp; 
        }
      }
    }
    for (const key of Array.from(state.remotePlayers.keys())) { 
      if (!seen.has(key)) state.remotePlayers.delete(key); 
    }

    const mobList = msg.mobs || [];
    const seenMobs = new Set();
    for (const m of mobList) {
      const id = String(m.id);
      seenMobs.add(id);
      let rm = state.remoteMobs.get(id);
      if (!rm) {
        rm = {
          id,
          type: m.type || 'mob',
          targetX: m.x, 
          targetY: m.y,
          displayX: m.x, 
          displayY: m.y,
          vx: m.vx || 0, 
          vy: m.vy || 0,
          hp: (typeof m.hp === 'number') ? m.hp : (m.maxHp || 0),
          maxHp: m.maxHp || m.hp || 100,
          radius: m.radius || 18,
          color: '#9c9c9c',
          alpha: 0.0,
          dead: (m.hp <= 0),
          stunnedUntil: m.stunnedUntil || 0
        };
        state.remoteMobs.set(id, rm);
      } else {
        rm.type = m.type || rm.type;
        rm.targetX = m.x;
        rm.targetY = m.y;
        rm.vx = m.vx || rm.vx;
        rm.vy = m.vy || rm.vy;
        const prevHp = rm.hp;
        rm.hp = (typeof m.hp === 'number') ? m.hp : rm.hp;
        rm.maxHp = m.maxHp || rm.maxHp;
        rm.radius = m.radius || rm.radius;
        rm.stunnedUntil = m.stunnedUntil || rm.stunnedUntil || 0;
        if (rm.dead && rm.hp > 0) rm.dead = false;
        if (rm.hp <= 0 && !rm.dead) { rm.dead = true; rm.alpha = 1.0; }
        if (typeof prevHp === 'number' && typeof rm.hp === 'number' && rm.hp < prevHp) {
          state.remoteEffects.push({
            type: 'damage',
            x: rm.targetX || rm.displayX,
            y: (rm.targetY || rm.displayY) - ((rm.radius || 18) + 6),
            color: 'rgba(255,80,80,0.95)',
            text: `${Math.round(prevHp - rm.hp)}`,
            start: Date.now(),
            duration: 1100
          });
        }
      }
    }
    for (const key of Array.from(state.remoteMobs.keys())) {
      if (!seenMobs.has(key)) {
        const rm = state.remoteMobs.get(key);
        if (rm) {
          rm.dead = true;
          rm.hp = 0;
        }
      }
    }

    const projList = msg.projectiles || [];
    const seenProjs = new Set();
    for (const p of projList) {
      const id = String(p.id);
      seenProjs.add(id);
      let rp = state.remoteProjectiles.get(id);
      if (!rp) {
        rp = {
          id,
          type: p.type || 'proj',
          targetX: p.x, 
          targetY: p.y,
          displayX: p.x, 
          displayY: p.y,
          vx: p.vx || 0, 
          vy: p.vy || 0,
          radius: p.radius || 6,
          owner: p.owner || null,
          alpha: 1.0
        };
        state.remoteProjectiles.set(id, rp);
      } else {
        rp.type = p.type || rp.type;
        rp.targetX = p.x;
        rp.targetY = p.y;
        rp.vx = p.vx || rp.vx;
        rp.vy = p.vy || rp.vy;
        rp.radius = p.radius || rp.radius;
        rp.owner = p.owner || rp.owner;
      }
    }
    for (const key of Array.from(state.remoteProjectiles.keys())) {
      if (!seenProjs.has(key)) {
        state.remoteProjectiles.delete(key);
      }
    }

    if (Array.isArray(msg.walls)) {
      state.map.walls = msg.walls;
      state.map._jaggedNeedsUpdate = true;
    }

    if (Array.isArray(msg.leaderboard)) {
      state.matchLeaderboard = msg.leaderboard;
    }

    if (!state.gotFirstSnapshot) {
      if (VERBOSE_NETWORK) console.log('GOT FIRST SNAPSHOT -> marking ready');
      state.gotFirstSnapshot = true;
      if (state.loadingTimeout) { clearTimeout(state.loadingTimeout); state.loadingTimeout = null; }
      setLoadingText('Ready');
      if (state.isLoading) {
        state.isLoading = false;
        if (state.dom.loadingScreen) state.dom.loadingScreen.style.display = 'none';
        if (state.dom.titleScreen) state.dom.titleScreen.style.display = 'none';
      }
      if (state.dom.chatPanel) state.dom.chatPanel.style.display = 'flex';
      if (state.dom.chatInput) state.dom.chatInput.disabled = false;
      try { state.dom.canvas.focus(); } catch (e) {}

      try {
        if (state.dom && typeof state.dom.showInventory === 'function') state.dom.showInventory();
        else if (state.dom && state.dom.inventoryContainer) state.dom.inventoryContainer.style.display = 'grid';
      } catch (e) {}
    }
    return;
  }
  
  // --- CHAT ---
  else if (msg.t === 'chat') {
    const name = msg.name || '??';
    const text = msg.text || '';
    const ts = msg.ts || Date.now();
    const chatId = msg.chatId || null;
    if (chatId && state.pendingChatIds.has(chatId)) {
      const pendingEl = state.pendingChatIds.get(chatId);
      if (pendingEl) {
        pendingEl.classList.remove('chatLocal');
        pendingEl.innerHTML = `<span class="chatName">${name}: </span><span class="chatText"></span><span class="chatTs"> ${new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>`;
        pendingEl.querySelector('.chatText').textContent = text;
      }
      state.pendingChatIds.delete(chatId);
    } else {
      appendChatMessage({ name, text, ts, chatId });
    }
  } 
  else if (msg.t === 'chat_blocked') {
    const reason = msg.reason || 'rate_limit';
    appendChatMessage({ text: `Chat blocked: ${reason}`, ts: Date.now(), system: true });
  } 
  else if (msg.t === 'player_levelup') {
    appendChatMessage({ text: `${msg.playerName || 'Player'} leveled up to ${msg.level}! (+${msg.hpGain} HP)`, ts: Date.now(), system: true });
  } 
  else if (msg.t === 'mob_died') {
    const mid = msg.mobId;
    const killerId = msg.killerId;
    const xp = msg.xp || 0;
    if (mid && state.remoteMobs.has(mid)) {
      const rm = state.remoteMobs.get(mid);
      if (rm) {
        rm.dead = true;
        rm.hp = 0;
        rm.alpha = 1.0;
      }
    }
    if (String(killerId) === String(state.player.id) && xp > 0) {
      state.player.xp = (state.player.xp || 0) + xp;
      state.remoteEffects.push({ 
        type: 'xp', 
        x: state.player.x, 
        y: state.player.y - (state.player.radius + 8), 
        color: 'rgba(180,220,255,1)', 
        start: Date.now(), 
        duration: 1200, 
        text: `+${xp} XP` 
      });
    } else {
      if (mid && state.remoteMobs.has(mid)) {
        const rm = state.remoteMobs.get(mid);
        state.remoteEffects.push({ 
          type: 'aoe', 
          x: rm.targetX || rm.displayX, 
          y: rm.targetY || rm.displayY, 
          radius: 28, 
          color: 'rgba(200,200,200,0.9)', 
          start: Date.now(), 
          duration: 700 
        });
      }
    }
  } 
  else if (msg.t === 'cast_effect') {
    const skill = msg.skill || msg.type || '';
    if (msg.type === 'melee' || msg.skill === 'slash') {
      const ef = { 
        type: 'melee', 
        x: msg.x || state.player.x, 
        y: msg.y || state.player.y, 
        radius: msg.range || 48, 
        color: 'rgba(255,180,120,0.95)', 
        start: Date.now(), 
        duration: 300 
      };
      state.remoteEffects.push(ef);
    } else if (msg.type === 'aoe' || msg.skill) {
      let color = 'rgba(255,255,255,0.9)';
      if (skill === 'frostnova') color = 'rgba(140,220,255,0.9)';
      else if (skill === 'fireball') color = 'rgba(255,110,80,0.9)';
      else if (skill === 'rage') color = 'rgba(255,80,60,0.9)';
      else if (skill === 'charge') color = 'rgba(180,240,120,0.9)';
      else if (skill === 'shieldbash') color = 'rgba(200,200,255,0.9)';
      const ef = {
        type: 'aoe',
        x: msg.x || 0,
        y: msg.y || 0,
        radius: msg.radius || (msg.explodeRadius || 60),
        color,
        start: Date.now(),
        duration: 900
      };
      if (skill === 'frostnova') ef.duration = 1100;
      if (skill === 'rage') ef.duration = 1200;
      if (skill === 'charge') ef.duration = 900;
      state.remoteEffects.push(ef);

      if (msg.buff && state.player.id && String(msg.casterId) === String(state.player.id)) {
        const b = msg.buff;
        state.player.localBuffs = state.player.localBuffs || [];
        state.player.localBuffs.push({ type: b.type, multiplier: b.multiplier || 1, until: Date.now() + (b.durationMs || 0) });
      }
    }
  } 
  else if (msg.t === 'stun') {
    const id = msg.id;
    const kind = msg.kind;
    const until = msg.until || 0;
    if (kind === 'player' && String(id) === String(state.player.id)) {
      state.player.stunnedUntil = until;
      state.player.localBuffs.push({ type: 'stuck', multiplier: 1.0, until });
    } else if (kind === 'mob' && state.remoteMobs.has(id)) {
      const rm = state.remoteMobs.get(id);
      if (rm) rm.stunnedUntil = until;
    } else if (kind === 'player' && state.remotePlayers.has(id)) {
      const rp = state.remotePlayers.get(id);
      if (rp) rp.stunnedUntil = until;
    }
  } 
  else if (msg.t === 'player_hurt') {
    const id = msg.id;
    const dmg = msg.damage || 0;
    if (String(id) === String(state.player.id)) {
      const prev = Number.isFinite(state.player.hp) ? state.player.hp : 0;
      const newHp = (typeof msg.hp === 'number') ? msg.hp : prev;
      if (dmg > 0) {
        state.remoteEffects.push({
          type: 'damage',
          x: state.player.x,
          y: state.player.y - (state.player.radius + 6),
          color: 'rgba(255,80,80,0.95)',
          text: `${Math.round(dmg)}`,
          start: Date.now(),
          duration: 1100
        });
      } else {
        state.remoteEffects.push({ 
          type: 'aoe', 
          x: state.player.x, 
          y: state.player.y - (state.player.radius + 6), 
          radius: 24, 
          color: 'rgba(255,80,80,0.9)', 
          start: Date.now(), 
          duration: 350 
        });
      }
      if (typeof msg.hp === 'number') state.player.hp = msg.hp;
    } else {
      const rp = state.remotePlayers.get(String(id));
      if (rp) {
        state.remoteEffects.push({
          type: 'damage',
          x: rp.displayX || rp.targetX,
          y: (rp.displayY || rp.targetY) - ((rp.radius || 28) + 6),
          color: 'rgba(255,80,80,0.95)',
          text: `${Math.round(dmg)}`,
          start: Date.now(),
          duration: 1100
        });
      } else {
        state.remoteEffects.push({ 
          type: 'damage', 
          x: state.player.x, 
          y: state.player.y - (state.player.radius + 6), 
          color: 'rgba(255,80,80,0.95)', 
          text: `${Math.round(dmg)}`, 
          start: Date.now(), 
          duration: 1100 
        });
      }
    }
  } 
  else if (msg.t === 'player_healed') {
    const pid = msg.id;
    const amount = msg.amount || 0;
    if (String(pid) === String(state.player.id)) {
      const prev = Number.isFinite(state.player.hp) ? state.player.hp : 0;
      const newHp = (typeof msg.hp === 'number') ? msg.hp : prev;
      if (newHp > prev) {
        state.remoteEffects.push({
          type: 'heal',
          x: state.player.x,
          y: state.player.y - (state.player.radius + 12),
          color: 'rgba(120,255,140,0.95)',
          text: `+${amount} HP`,
          start: Date.now(),
          duration: 1200
        });
      }
      if (typeof msg.hp === 'number') state.player.hp = msg.hp;
    } else {
      const rp = state.remotePlayers.get(String(pid));
      if (rp) {
        state.remoteEffects.push({
          type: 'heal',
          x: rp.displayX || rp.targetX,
          y: (rp.displayY || rp.targetY) - ((rp.radius || 28) + 12),
          color: 'rgba(120,255,140,0.95)',
          text: `+${amount} HP`,
          start: Date.now(),
          duration: 1200
        });
      }
    }
  } 
  else if (msg.t === 'cast_rejected') {
    const reason = msg.reason || 'rejected';
    showTransientMessage(`Cast rejected: ${reason}`, 1500);

    if (typeof msg.slot === 'number') {
      const slot = Number(msg.slot) - 1;
      const shouldClear = (reason === 'no_target' || reason === 'invalid_target');
      if (shouldClear && slot >= 0 && slot < state.cooldowns.length) {
        state.cooldowns[slot] = 0;
        const now = Date.now();
        for (let i = state.remoteEffects.length - 1; i >= 0; i--) {
          const ef = state.remoteEffects[i];
          if (!ef || !ef.start) continue;
          const age = now - ef.start;
          if (age < 2000 && (ef.type === 'aoe' || ef.type === 'melee')) {
            const dx = (ef.x || 0) - (state.player.x || 0);
            const dy = (ef.y || 0) - (state.player.y || 0);
            if (Math.hypot(dx, dy) < 120) {
              state.remoteEffects.splice(i, 1);
            }
          }
        }
      }
    }
  } 
  else if (msg.t === 'player_died') {
    const pid = msg.id || null;
    if (String(pid) === String(state.player.id)) {
      state.player.awaitingRespawn = true;
      state.player.dead = true;
      state.player.hp = 0;
      showDeathOverlay();
    } else {
      const rp = state.remotePlayers.get(String(pid));
      if (rp) {
        rp.dead = true;
      }
    }
  }
}

export function sendChat() {
  if (!state.dom.chatInput || !state.dom.chatInput.value) return;
  const txt = state.dom.chatInput.value.trim();
  if (!txt) { dom.unfocusChat(); return; }
  const chatId = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  const ts = Date.now();
  appendChatMessage({ name: state.player.name || 'You', text: txt, ts, chatId, local: true });
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try {
      state.ws.send(JSON.stringify({ t: 'chat', text: txt, chatId }));
    } catch (e) {}
  } else {
    appendChatMessage({ text: 'Not connected — message not sent', ts: Date.now(), system: true });
    state.pendingChatIds.delete(chatId);
  }
  state.dom.chatInput.value = '';
  dom.unfocusChat();
}

export function setSendInputIntervalHandle(handle) {
  state.sendInputInterval = handle;
}

export function getWs() { return state.ws; }
export function setWs(w) { state.ws = w; ws = w; }

export function cancelReconnectAndHideUI() {
  cancelReconnect();
  hideReconnectOverlay();
}
