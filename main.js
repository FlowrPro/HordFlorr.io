// Moborr.io — frontend with networking (WebSocket) to authoritative server.
// IMPORTANT: set SERVER_URL to your deployed Render service (wss://...).
// For local testing use ws://localhost:8080

(() => {
  // --- CONFIG: set your server URL here ---
  const SERVER_URL = 'wss://hordflorr-io-backend.onrender.com'; // <-- your Render URL

  // --- DOM ---
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Title/login/settings DOM must exist in the page
  const titleScreen = document.getElementById('titleScreen');
  const usernameInput = document.getElementById('username');
  const playButton = document.getElementById('playButton');

  const loadingScreen = document.getElementById('loadingScreen');
  const loadingPlayerEl = document.getElementById('loadingPlayer');
  const loadingPlayerNameEl = document.getElementById('loadingPlayerName');
  const loadingTextEl = document.getElementById('loadingText');

  // Chat DOM
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

  // Hide chat panel until game is ready
  if (chatPanel) chatPanel.style.display = 'none';
  // Disable chat input until ready
  if (chatInput) chatInput.disabled = true;

  // --- Canvas setup (DPR aware) ---
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- World (client-side) ---
  const map = {
    type: 'circle', // 'circle' or 'square'; server welcome will set
    center: { x: 0, y: 0 },
    radius: 750,
    half: 750,
    size: 1500,
    walls: []
  };

  // --- Player (local) ---
  const player = {
    id: null,
    x: 0, y: 0,
    radius: 28,
    color: '#ffd54a',
    speed: 380,
    vx: 0, vy: 0,           // smoothed velocity used locally
    facing: -Math.PI / 2,
    name: '',
    class: 'warrior',      // default chosen class until user picks one
    level: 1,
    xp: 0,
    serverX: null,
    serverY: null
  };

  // --- Movement smoothing / interp params ---
  const MOVE_ACCEL = 18.0;
  const TURN_SPEED = 10.0;
  const MIN_MOVEMENT_FOR_FACING = 1e-2;
  const RECONCILE_SPEED = 6.0;
  const REMOTE_INTERP_SPEED = 8.0;

  // --- Remote players ---
  const remotePlayers = new Map();

  // --- Remote mobs (client-side) ---
  const remoteMobs = new Map(); // id -> { id, type, targetX,targetY, displayX,displayY, vx,vy, hp, maxHp, radius, color, alpha }

  // --- Remote projectiles (client-side) ---
  const remoteProjectiles = new Map(); // id -> { id, type, targetX, targetY, displayX, displayY, vx, vy, radius, owner, alpha }

  // --- Input state ---
  const keys = {};
  let pointer = { x: 0, y: 0 };
  let mouseWorld = { x: 0, y: 0 };
  let clickTarget = null;

  // --- Hotbar & XP UI config ---
  const HOTBAR_SLOTS = 4;
  const CLASS_SKILLS = {
    warrior: ['Slash', 'Shield Bash', 'Charge', 'Rage'],
    ranger:  ['Shot', 'Rapid Fire', 'Trap', 'Snipe'],
    mage:    ['Spark', 'Fireball', 'Frost Nova', 'Arcane Blast']
  };
  const CLASS_COOLDOWNS = {
    warrior: [3.5, 7.0, 10.0, 25.0],
    ranger:  [2.0, 6.0, 12.0, 18.0],
    mage:    [2.5, 6.5, 9.0, 22.0]
  };
  const cooldowns = new Array(HOTBAR_SLOTS).fill(0);

  // --- Settings persistence ---
  const defaultSettings = {
    mouseMovement: false,
    keyboardMovement: true,
    clickMovement: false,
    graphicsQuality: 'medium',
    showCoordinates: true
  };
  let settings = loadSettings();
  if (mouseMovementCheckbox) mouseMovementCheckbox.checked = settings.mouseMovement;
  if (keyboardMovementCheckbox) keyboardMovementCheckbox.checked = settings.keyboardMovement;
  if (clickMovementCheckbox) clickMovementCheckbox.checked = settings.clickMovement;
  if (graphicsQuality) graphicsQuality.value = settings.graphicsQuality;
  if (showCoordinatesCheckbox) showCoordinatesCheckbox.checked = settings.showCoordinates;

  if (mouseMovementCheckbox) mouseMovementCheckbox.addEventListener('change', () => { settings.mouseMovement = mouseMovementCheckbox.checked; saveSettings(); });
  if (keyboardMovementCheckbox) keyboardMovementCheckbox.addEventListener('change', () => { settings.keyboardMovement = keyboardMovementCheckbox.checked; saveSettings(); });
  if (clickMovementCheckbox) clickMovementCheckbox.addEventListener('change', () => { settings.clickMovement = clickMovementCheckbox.checked; saveSettings(); });
  if (graphicsQuality) graphicsQuality.addEventListener('change', () => { settings.graphicsQuality = graphicsQuality.value; saveSettings(); });
  if (showCoordinatesCheckbox) showCoordinatesCheckbox.addEventListener('change', () => { settings.showCoordinates = showCoordinatesCheckbox.checked; saveSettings(); });

  function loadSettings() {
    try {
      const raw = localStorage.getItem('moborr_settings');
      if (!raw) return { ...defaultSettings };
      return Object.assign({}, defaultSettings, JSON.parse(raw));
    } catch (e) {
      return { ...defaultSettings };
    }
  }
  function saveSettings() {
    localStorage.setItem('moborr_settings', JSON.stringify(settings));
  }

  // --- NETWORK ---
  let ws = null;
  let sendInputInterval = null;
  let seq = 0;

  // loading/connection lifecycle
  let isLoading = false;
  let loadingTimeout = null;
  let welcomeReceived = false;
  let gotFirstSnapshot = false;

  // --- Chat (non-persistent) ---
  const CHAT_MAX = 50;
  const pendingChatIds = new Map(); // chatId -> DOM element for optimistic messages
  let chatFocused = false;

  function appendChatMessage({ name, text, ts, chatId, system = false, local = false }) {
    if (!chatLog) return;
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

    if (chatId && local) pendingChatIds.set(chatId, el);
    chatLog.appendChild(el);
    while (chatLog.children.length > CHAT_MAX) chatLog.removeChild(chatLog.firstChild);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function focusChat() {
    if (!chatPanel || !chatInput) return;
    if (chatInput.disabled) return;
    chatInput.focus();
    chatInput.select();
    chatFocused = true;
  }
  function unfocusChat() {
    if (!chatInput) return;
    chatInput.blur();
    chatFocused = false;
    // return focus to canvas so keyboard works for game again
    canvas.focus?.();
  }

  function sendChat() {
    if (!chatInput || !chatInput.value) return;
    const txt = chatInput.value.trim();
    if (!txt) { unfocusChat(); return; }
    const chatId = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    const ts = Date.now();
    appendChatMessage({ name: player.name || 'You', text: txt, ts, chatId, local: true });
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ t: 'chat', text: txt, chatId }));
      } catch (e) {}
    } else {
      appendChatMessage({ text: 'Not connected — message not sent', ts: Date.now(), system: true });
      pendingChatIds.delete(chatId);
    }
    chatInput.value = '';
    // unfocus after sending (as requested)
    unfocusChat();
  }

  if (chatSend) chatSend.addEventListener('click', sendChat);
  if (chatInput) chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });

  // --- Connection / loading helpers ---
  function setLoadingText(text) { if (loadingTextEl) loadingTextEl.textContent = text; }

  function cleanupAfterFailedLoad(reason) {
    console.warn('cleanupAfterFailedLoad:', reason);
    if (loadingTimeout) { clearTimeout(loadingTimeout); loadingTimeout = null; }
    if (sendInputInterval) { clearInterval(sendInputInterval); sendInputInterval = null; }
    try { if (ws) { ws.close(); ws = null; } } catch (e) {}
    // hide loading overlay, show title, re-enable login controls
    if (loadingScreen) loadingScreen.style.display = 'none';
    if (titleScreen) titleScreen.style.display = 'flex';
    if (playButton) playButton.disabled = false;
    if (usernameInput) usernameInput.disabled = false;
    // hide chat (should not be visible until fully ready)
    if (chatPanel) chatPanel.style.display = 'none';
    if (chatInput) chatInput.disabled = true;
    isLoading = false;
    welcomeReceived = false;
    gotFirstSnapshot = false;
  }

  function connectToServer() {
    if (!SERVER_URL) {
      console.warn('CONNECTING -> no SERVER_URL configured');
      setLoadingText('No server URL set');
      cleanupAfterFailedLoad('no_server_url');
      return;
    }
    welcomeReceived = false;
    gotFirstSnapshot = false;
    setLoadingText('Connecting…');
    console.log('CONNECTING ->', SERVER_URL);
    try {
      ws = new WebSocket(SERVER_URL);
    } catch (err) {
      console.warn('Failed to create WebSocket', err);
      setLoadingText('Connection failed (exception creating WebSocket)');
      cleanupAfterFailedLoad('ws_create_exception');
      return;
    }

    ws.addEventListener('open', () => {
      console.log('WS OPEN');
      setLoadingText('Connected — joining…');
      const name = player.name || (usernameInput && usernameInput.value.trim() ? usernameInput.value.trim() : 'Player');
      player.name = name;
      try {
        ws.send(JSON.stringify({ t: 'join', name, class: player.class }));
        console.log('WS SENT: join', { name: player.name, class: player.class });
        setLoadingText('Joining…');
      } catch (e) {
        console.warn('WS send(join) failed', e);
        setLoadingText('Failed to send join');
        cleanupAfterFailedLoad('send_join_failed');
        return;
      }
      if (!sendInputInterval) sendInputInterval = setInterval(sendInputPacket, 50);
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.t) console.log('WS MESSAGE t=', msg.t, msg);
        else console.log('WS MESSAGE (raw)', msg);
        handleServerMessage(msg);
      } catch (e) {
        console.log('WS message parse error', e);
      }
    });

    ws.addEventListener('close', (ev) => {
      console.log('WS CLOSE code=', ev.code, 'reason=', ev.reason);
      if (isLoading) {
        setLoadingText('Disconnected: ' + (ev.reason || ('code ' + ev.code)));
        cleanupAfterFailedLoad('ws_close_during_load:' + (ev.reason || ev.code));
        return;
      }
      if (chatInput) chatInput.disabled = true;
      if (chatPanel) chatPanel.style.display = 'none';
      ws = null;
      if (sendInputInterval) { clearInterval(sendInputInterval); sendInputInterval = null; }
    });

    ws.addEventListener('error', (err) => {
      console.warn('WS ERROR', err);
      if (isLoading) {
        setLoadingText('Connection error');
        cleanupAfterFailedLoad('ws_error');
      } else {
        setLoadingText('Connection error');
      }
    });
  }

  function handleServerMessage(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'welcome') {
      console.log('GOT welcome from server');
      if (msg.id) player.id = String(msg.id);
      if (msg.player) {
        if (typeof msg.player.level === 'number') player.level = msg.player.level;
        if (typeof msg.player.xp === 'number') player.xp = msg.player.xp;
        if (msg.player.class) player.class = msg.player.class;
      }
      if (msg.mapType === 'square' || msg.mapSize || msg.mapHalf || msg.mapRadius) {
        map.type = 'square';
        map.half = (msg.mapHalf || msg.mapRadius || (msg.mapSize ? msg.mapSize / 2 : map.half));
        map.size = msg.mapSize || (map.half * 2);
        map.center = { x: 0, y: 0 };
        map.walls = Array.isArray(msg.walls) ? msg.walls : [];
      } else if (msg.mapType === 'circle' || msg.mapRadius) {
        map.type = 'circle';
        map.radius = (msg.mapRadius || msg.mapHalf || map.radius);
        map.center = { x: 0, y: 0 };
        map.walls = Array.isArray(msg.walls) ? msg.walls : [];
      }
      if (typeof msg.spawnX === 'number' && typeof msg.spawnY === 'number') {
        player.x = msg.spawnX; player.y = msg.spawnY;
      }
      console.log('Server welcome. my id =', player.id, 'mapType=', map.type, 'mapHalf/mapRadius=', map.half || map.radius, 'tickRate=', msg.tickRate);
      welcomeReceived = true;
      setLoadingText('Welcome received — loading world…');
    } else if (msg.t === 'snapshot') {
      const list = msg.players || [];
      const seen = new Set();
      for (const sp of list) {
        const id = String(sp.id);
        seen.add(id);
        if (id === player.id) {
          player.serverX = sp.x; player.serverY = sp.y;
          const dx = player.serverX - player.x; const dy = player.serverY - player.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 140) { player.x = player.serverX; player.y = player.serverY; }
          player.vx = sp.vx || player.vx; player.vy = sp.vy || player.vy;
          player.color = sp.color || player.color; player.radius = sp.radius || player.radius;
          player.name = sp.name || player.name;
          if (typeof sp.level === 'number') player.level = sp.level;
          if (typeof sp.xp === 'number') player.xp = sp.xp;
        } else {
          let rp = remotePlayers.get(id);
          if (!rp) {
            rp = { id, name: sp.name, targetX: sp.x, targetY: sp.y, displayX: sp.x, displayY: sp.y, vx: sp.vx || 0, vy: sp.vy || 0, radius: sp.radius, color: sp.color || '#ff7', level: sp.level || 1 };
            remotePlayers.set(id, rp);
          } else {
            rp.name = sp.name || rp.name; rp.targetX = sp.x; rp.targetY = sp.y; rp.vx = sp.vx || rp.vx; rp.vy = sp.vy || rp.vy; rp.radius = sp.radius || rp.radius; rp.color = sp.color || rp.color; rp.level = sp.level || rp.level;
          }
        }
      }
      for (const key of Array.from(remotePlayers.keys())) { if (!seen.has(key)) remotePlayers.delete(key); }

      // --- Mob handling: process msg.mobs (if present) ---
      const mobList = msg.mobs || [];
      const seenMobs = new Set();
      for (const m of mobList) {
        const id = String(m.id);
        seenMobs.add(id);
        let rm = remoteMobs.get(id);
        if (!rm) {
          rm = {
            id,
            type: m.type || 'mob',
            targetX: m.x, targetY: m.y,
            displayX: m.x, displayY: m.y,
            vx: m.vx || 0, vy: m.vy || 0,
            hp: (typeof m.hp === 'number') ? m.hp : (m.maxHp || 0),
            maxHp: m.maxHp || m.hp || 100,
            radius: m.radius || 18,
            color: '#9c9c9c',
            alpha: 0.0, // spawn fade
            dead: (m.hp <= 0)
          };
          remoteMobs.set(id, rm);
        } else {
          rm.type = m.type || rm.type;
          rm.targetX = m.x;
          rm.targetY = m.y;
          rm.vx = m.vx || rm.vx;
          rm.vy = m.vy || rm.vy;
          rm.hp = (typeof m.hp === 'number') ? m.hp : rm.hp;
          rm.maxHp = m.maxHp || rm.maxHp;
          rm.radius = m.radius || rm.radius;
          if (rm.dead && rm.hp > 0) rm.dead = false;
        }
      }
      // remove mobs not present
      for (const key of Array.from(remoteMobs.keys())) {
        if (!seenMobs.has(key)) {
          const rm = remoteMobs.get(key);
          if (rm) {
            rm.dead = true;
            rm.hp = 0;
          }
        }
      }

      // --- Projectiles handling: process msg.projectiles (if present) ---
      const projList = msg.projectiles || [];
      const seenProjs = new Set();
      for (const p of projList) {
        const id = String(p.id);
        seenProjs.add(id);
        let rp = remoteProjectiles.get(id);
        if (!rp) {
          rp = {
            id,
            type: p.type || 'proj',
            targetX: p.x, targetY: p.y,
            displayX: p.x, displayY: p.y,
            vx: p.vx || 0, vy: p.vy || 0,
            radius: p.radius || 6,
            owner: p.owner || null,
            alpha: 1.0
          };
          remoteProjectiles.set(id, rp);
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
      // remove projectiles not present
      for (const key of Array.from(remoteProjectiles.keys())) {
        if (!seenProjs.has(key)) {
          remoteProjectiles.delete(key);
        }
      }

      if (!gotFirstSnapshot) {
        console.log('GOT FIRST SNAPSHOT -> marking ready');
        gotFirstSnapshot = true;
        if (loadingTimeout) { clearTimeout(loadingTimeout); loadingTimeout = null; }
        setLoadingText('Ready');
        if (isLoading) {
          isLoading = false;
          if (loadingScreen) loadingScreen.style.display = 'none';
          if (titleScreen) titleScreen.style.display = 'none';
        }
        if (chatPanel) chatPanel.style.display = 'flex';
        if (chatInput) chatInput.disabled = false;
        try { canvas.focus(); } catch (e) {}
      }
    } else if (msg.t === 'chat') {
      const name = msg.name || '??';
      const text = msg.text || '';
      const ts = msg.ts || Date.now();
      const chatId = msg.chatId || null;
      if (chatId && pendingChatIds.has(chatId)) {
        const pendingEl = pendingChatIds.get(chatId);
        if (pendingEl) {
          pendingEl.classList.remove('chatLocal');
          pendingEl.innerHTML = `<span class="chatName">${name}: </span><span class="chatText"></span><span class="chatTs"> ${new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>`;
          pendingEl.querySelector('.chatText').textContent = text;
        }
        pendingChatIds.delete(chatId);
      } else {
        appendChatMessage({ name, text, ts, chatId });
      }
    } else if (msg.t === 'chat_blocked') {
      const reason = msg.reason || 'rate_limit';
      appendChatMessage({ text: `Chat blocked: ${reason}`, ts: Date.now(), system: true });
    } else if (msg.t === 'player_levelup') {
      appendChatMessage({ text: `${msg.playerName || 'Player'} leveled up to ${msg.level}! (+${msg.hpGain} HP)`, ts: Date.now(), system: true });
    } else if (msg.t === 'cast_effect') {
      // optional short system message or effect trigger - for now show system chat so players see skill usage
      if (msg.type === 'aoe') {
        appendChatMessage({ text: `${msg.casterName || 'Someone'} used ${msg.skill || 'an ability'}`, ts: Date.now(), system: true });
      }
    }
  }

  function sendInputPacket() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const input = computeInputVector();
    try { ws.send(JSON.stringify({ t: 'input', seq: ++seq, input })); } catch (e) {}
  }

  // --- Ability casting (client-side) ---
  function castSkill(slotIndex) {
    if (slotIndex < 0 || slotIndex >= HOTBAR_SLOTS) return false;
    if (cooldowns[slotIndex] > 0) {
      appendChatMessage({ text: `${CLASS_SKILLS[player.class][slotIndex]} is on cooldown (${Math.ceil(cooldowns[slotIndex])}s)`, ts: Date.now(), system: true });
      return false;
    }
    const cd = (CLASS_COOLDOWNS[player.class] && CLASS_COOLDOWNS[player.class][slotIndex]) || 6.0;
    cooldowns[slotIndex] = cd;

    // compute aim angle (prefer mouse position, fallback to facing)
    let aimAngle = player.facing;
    try {
      const dx = mouseWorld.x - player.x;
      const dy = mouseWorld.y - player.y;
      const len = Math.hypot(dx, dy);
      if (len > 2) aimAngle = Math.atan2(dy, dx);
    } catch (e) {}

    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'cast', slot: slotIndex + 1, class: player.class, ts: Date.now(), angle: aimAngle }));
      }
    } catch (e) {}
    appendChatMessage({ text: `${player.name || 'You'} used ${CLASS_SKILLS[player.class][slotIndex]} (slot ${slotIndex+1})`, ts: Date.now(), system: true });
    return true;
  }

  // --- Input handling (keyboard / mouse / click) ---
  window.addEventListener('keydown', (e) => {
    if (titleScreen && titleScreen.style.display !== 'none') {
      if (e.key === 'Enter') { e.preventDefault(); startGame(); }
      return;
    }
    if (settingsPanel && settingsPanel.style.display !== 'none' && settingsPanel.getAttribute('aria-hidden') === 'false') return;
    if ((e.key === 't' || e.key === 'T') && chatInput && !chatInput.disabled) { chatInput.focus(); e.preventDefault(); return; }
    // number keys 1-4 cast skills
    if (['1','2','3','4'].includes(e.key)) {
      const idx = Number(e.key) - 1;
      if (castSkill(idx)) { e.preventDefault(); return; }
    }
    keys[e.key.toLowerCase()] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (titleScreen && titleScreen.style.display !== 'none') return;
    if (settingsPanel && settingsPanel.style.display !== 'none' && settingsPanel.getAttribute('aria-hidden') === 'false') return;
    keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    pointer.x = e.clientX; pointer.y = e.clientY;
    mouseWorld.x = player.x + (pointer.x - vw / 2);
    mouseWorld.y = player.y + (pointer.y - vh / 2);
  });

  // hotbar click handling (screen coords) — returns true if handled
  function handleHotbarClick(clientX, clientY, vw, vh) {
    const slotSize = 64;
    const gap = 10;
    const totalW = HOTBAR_SLOTS * slotSize + (HOTBAR_SLOTS - 1) * gap;
    const x0 = Math.round((vw - totalW) / 2);
    const y0 = Math.round(vh - 28 - slotSize); // matches draw placement
    if (clientY < y0 || clientY > y0 + slotSize) return false;
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const sx = x0 + i * (slotSize + gap);
      if (clientX >= sx && clientX <= sx + slotSize) {
        castSkill(i);
        return true;
      }
    }
    return false;
  }

  canvas.addEventListener('click', (e) => {
    if (titleScreen && titleScreen.style.display !== 'none') return;
    if (settingsPanel && settingsPanel.style.display !== 'none' && settingsPanel.getAttribute('aria-hidden') === 'false') return;

    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);

    // hotbar click has priority
    if (handleHotbarClick(e.clientX, e.clientY, vw, vh)) return;

    if (!settings.clickMovement) return;
    const wx = player.x + (e.clientX - vw / 2);
    const wy = player.y + (e.clientY - vh / 2);
    clickTarget = { x: wx, y: wy };
  });

  function computeInputVector() {
    if (chatFocused) return { x: 0, y: 0 };
    if (settings.keyboardMovement) {
      let ax = 0, ay = 0;
      if (keys['arrowup'] || keys['w']) ay -= 1;
      if (keys['arrowdown'] || keys['s']) ay += 1;
      if (keys['arrowleft'] || keys['a']) ax -= 1;
      if (keys['arrowright'] || keys['d']) ax += 1;
      if (ax !== 0 || ay !== 0) {
        const len = Math.hypot(ax, ay);
        return { x: ax / len, y: ay / len };
      }
    }
    if (settings.clickMovement && clickTarget) {
      const dx = clickTarget.x - player.x;
      const dy = clickTarget.y - player.y;
      const len = Math.hypot(dx, dy);
      if (len < 6) { clickTarget = null; return { x: 0, y: 0 }; }
      return { x: dx / len, y: dy / len };
    }
    if (settings.mouseMovement) {
      const dx = mouseWorld.x - player.x;
      const dy = mouseWorld.y - player.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) return { x: dx / len, y: dy / len };
    }
    return { x: 0, y: 0 };
  }

  // --- Title / login / settings UI ---
  const savedName = localStorage.getItem('moborr_username');
  if (savedName && usernameInput) usernameInput.value = savedName;

  function startGame() {
    if (isLoading) return;
    isLoading = true;
    try {
      const sel = document.querySelector('input[name="class"]:checked');
      if (sel && sel.value) player.class = sel.value;
    } catch (e) {}
    const name = usernameInput && usernameInput.value.trim() ? usernameInput.value.trim() : 'Player';
    player.name = name;
    player.level = player.level || 1;
    player.xp = player.xp || 0;
    localStorage.setItem('moborr_username', name);
    if (loadingPlayerEl) loadingPlayerEl.style.background = player.color || '#ffd54a';
    if (loadingPlayerNameEl) loadingPlayerNameEl.textContent = player.name || '';
    setLoadingText('Connecting…');
    if (titleScreen) titleScreen.style.display = 'none';
    if (loadingScreen) loadingScreen.style.display = 'flex';
    if (playButton) playButton.disabled = true;
    if (usernameInput) usernameInput.disabled = true;
    if (chatInput) chatInput.disabled = true;
    connectToServer();
    loadingTimeout = setTimeout(() => {
      if (isLoading) {
        console.warn('LOADING TIMEOUT fired');
        cleanupAfterFailedLoad('timeout');
        setLoadingText('Connection timeout');
      }
    }, 12000);
  }
  if (playButton) playButton.addEventListener('click', startGame);
  if (usernameInput) usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); startGame(); }
  });

  if (settingsBtn) settingsBtn.addEventListener('click', () => {
    const open = settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false';
    if (open) { if (settingsPanel) settingsPanel.setAttribute('aria-hidden','true'); if (settingsPanel) settingsPanel.style.display = 'none'; if (settingsBtn) settingsBtn.setAttribute('aria-expanded','false'); }
    else { if (settingsPanel) settingsPanel.setAttribute('aria-hidden','false'); if (settingsPanel) settingsPanel.style.display = 'block'; if (settingsBtn) settingsBtn.setAttribute('aria-expanded','true'); }
  });
  if (settingsClose) settingsClose.addEventListener('click', () => { if (settingsPanel) { settingsPanel.setAttribute('aria-hidden','true'); settingsPanel.style.display = 'none'; } });

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      tabContents.forEach(tc => {
        if (tc.dataset.name === target) tc.classList.remove('hidden');
        else tc.classList.add('hidden');
      });
    });
  });

  // --- Drawing helpers: XP bar & Hotbar ---
  function drawXpBar(vw, vh) {
    const barW = Math.min(520, Math.floor(vw * 0.6));
    const barH = 14;
    const x = Math.round((vw - barW) / 2);
    const y = Math.round(vh - 28 - 64 - 10 - barH);
    const padding = 3;
    const nextNeeded = Math.max(50, player.level * 100);
    const pct = nextNeeded > 0 ? Math.min(1, (player.xp || 0) / nextNeeded) : 0;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRectScreen(ctx, x - 2, y - 2, barW + 4, barH + 4, 6, true, false);
    ctx.fillStyle = '#222';
    roundRectScreen(ctx, x, y, barW, barH, 6, true, false);
    ctx.fillStyle = '#4fbfef';
    roundRectScreen(ctx, x + padding, y + padding, Math.max(6, (barW - padding*2) * pct), barH - padding*2, 6, true, false);
    ctx.font = '12px system-ui, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    const txt = `Lv ${player.level} — XP ${player.xp || 0} / ${nextNeeded}`;
    ctx.fillText(txt, x + barW / 2, y + barH / 2);
    ctx.restore();
  }

  function drawHotbar(vw, vh) {
    const slotSize = 64;
    const gap = 10;
    const totalW = HOTBAR_SLOTS * slotSize + (HOTBAR_SLOTS - 1) * gap;
    const x0 = Math.round((vw - totalW) / 2);
    const y0 = Math.round(vh - 28 - slotSize);
    ctx.save();
    ctx.globalAlpha = 0.92;
    roundRectScreen(ctx, x0 - 10, y0 - 10, totalW + 20, slotSize + 20, 12, true, false);
    ctx.globalAlpha = 1.0;
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const sx = x0 + i * (slotSize + gap);
      const sy = y0;
      ctx.fillStyle = 'rgba(40,40,42,0.95)';
      roundRectScreen(ctx, sx, sy, slotSize, slotSize, 8, true, false);
      const skillName = (CLASS_SKILLS[player.class] && CLASS_SKILLS[player.class][i]) || `Skill ${i+1}`;
      ctx.font = '12px system-ui, Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
      ctx.fillText(skillName, sx + slotSize/2, sy + 6);
      ctx.font = '11px system-ui, Arial'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(`${i+1}`, sx + 6, sy + slotSize - 18);
      const cd = cooldowns[i] || 0;
      if (cd > 0) {
        const cdPct = Math.min(1, cd / ((CLASS_COOLDOWNS[player.class] && CLASS_COOLDOWNS[player.class][i]) || 6.0));
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.rect(sx, sy + slotSize * (1 - cdPct), slotSize, slotSize * cdPct);
        ctx.fill();
        ctx.font = '14px system-ui, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        ctx.fillText(String(Math.ceil(cd)), sx + slotSize/2, sy + slotSize/2);
      }
    }
    ctx.restore();
  }

  // --- Drawing & interpolation (including mobs & projectiles) ---
  function drawWorld(vw, vh, dt) {
    ctx.save();
    ctx.fillStyle = '#8b5a2b';
    const cover = Math.max((map.size || (map.radius*2)) + Math.max(vw, vh) * 2, 8000);
    const rx = map.center.x - cover / 2;
    const ry = map.center.y - cover / 2;
    ctx.fillRect(rx, ry, cover, cover);
    ctx.restore();

    ctx.save();
    if (map.type === 'circle') {
      ctx.beginPath();
      ctx.arc(map.center.x, map.center.y, map.radius, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(
        map.center.x - map.radius * 0.2, map.center.y - map.radius * 0.2, map.radius * 0.05,
        map.center.x, map.center.y, map.radius
      );
      g.addColorStop(0, '#9fe69f');
      g.addColorStop(1, '#5fb35f');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#2a6b2a';
      ctx.stroke();
    } else {
      const half = map.half || (map.size/2);
      const x = map.center.x - half;
      const y = map.center.y - half;
      const size = half * 2;
      const g = ctx.createLinearGradient(x, y, x + size, y + size);
      g.addColorStop(0, '#9fe69f');
      g.addColorStop(1, '#5fb35f');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, size, size);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#2a6b2a';
      ctx.strokeRect(x, y, size, size);

      ctx.fillStyle = '#6b4f3b';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      for (const w of (map.walls || [])) {
        ctx.beginPath();
        ctx.rect(w.x, w.y, w.w, w.h);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();

    // grass/grid
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(34,80,30,0.55)';
    const spacing = 22;
    const left = player.x - vw / 2;
    const top = player.y - vh / 2;
    const cols = Math.ceil(vw / spacing) + 4;
    const rows = Math.ceil(vh / spacing) + 4;
    for (let gx = 0; gx < cols; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        const wx = Math.floor((left + gx * spacing) / spacing) * spacing + spacing / 2;
        const wy = Math.floor((top + gy * spacing) / spacing) * spacing + spacing / 2;
        let allowed = false;
        if (map.type === 'circle') {
          const distToCenter = Math.hypot(wx - map.center.x, wy - map.center.y);
          if (distToCenter < map.radius - 8) allowed = true;
        } else {
          const half = map.half || (map.size/2);
          if (wx > map.center.x - half + 8 && wx < map.center.x + half - 8 && wy > map.center.y - half + 8 && wy < map.center.y + half - 8) {
            allowed = true;
          }
        }
        if (!allowed) continue;
        let insideWall = false;
        for (const w of (map.walls || [])) {
          if (wx >= w.x && wx <= w.x + w.w && wy >= w.y && wy <= w.y + w.h) { insideWall = true; break; }
        }
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
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();

    // draw remote players
    ctx.save();
    for (const rp of remotePlayers.values()) {
      const interpFactor = 1 - Math.exp(-REMOTE_INTERP_SPEED * dt);
      rp.displayX += (rp.targetX - rp.displayX) * interpFactor;
      rp.displayY += (rp.targetY - rp.displayY) * interpFactor;
      ctx.beginPath();
      ctx.arc(rp.displayX, rp.displayY, rp.radius, 0, Math.PI * 2);
      ctx.fillStyle = rp.color || '#ff7';
      ctx.fill();
      if (rp.name) {
        ctx.font = '12px system-ui, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(rp.name, rp.displayX + 1, rp.displayY - rp.radius - 12 + 1);
        ctx.fillStyle = '#fff';
        ctx.fillText(rp.name, rp.displayX, rp.displayY - rp.radius - 12);
      }
    }
    ctx.restore();

    // draw projectiles (interpolated)
    ctx.save();
    for (const pr of remoteProjectiles.values()) {
      const interpFactor = 1 - Math.exp(-REMOTE_INTERP_SPEED * dt);
      pr.displayX += (pr.targetX - pr.displayX) * interpFactor;
      pr.displayY += (pr.targetY - pr.displayY) * interpFactor;
      ctx.beginPath();
      // color based on type
      let col = '#ff9f4d';
      if (pr.type === 'arrow') col = '#ffd54a';
      else if (pr.type === 'fireball') col = '#ff6b6b';
      else if (pr.type === 'frost') col = '#8fe3ff';
      ctx.fillStyle = col;
      ctx.globalAlpha = pr.alpha != null ? pr.alpha : 1.0;
      ctx.arc(pr.displayX, pr.displayY, Math.max(3, pr.radius || 6), 0, Math.PI * 2);
      ctx.fill();
      // slight trail
      ctx.globalAlpha = 0.5 * (pr.alpha != null ? pr.alpha : 1.0);
      ctx.beginPath();
      ctx.arc(pr.displayX - (pr.vx||0)*0.02, pr.displayY - (pr.vy||0)*0.02, Math.max(2, (pr.radius||6)*0.8), 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
    ctx.restore();

    // draw mobs (interpolated + simple spawn/fade + hp bar)
    ctx.save();
    for (const rm of remoteMobs.values()) {
      // interpolate
      const interpFactor = 1 - Math.exp(-REMOTE_INTERP_SPEED * dt);
      rm.displayX += (rm.targetX - rm.displayX) * interpFactor;
      rm.displayY += (rm.targetY - rm.displayY) * interpFactor;
      // alpha spawn/fade
      if (!rm.dead) {
        rm.alpha = Math.min(1, (rm.alpha || 0) + dt * 4.0); // fast fade-in
      } else {
        rm.alpha = Math.max(0, (rm.alpha || 1) - dt * 2.5); // fade out when dead/removed
      }
      // if fully faded out and dead, remove from map
      if (rm.dead && rm.alpha <= 0.001) { remoteMobs.delete(rm.id); continue; }

      ctx.globalAlpha = rm.alpha != null ? rm.alpha : 1.0;
      // mob body
      ctx.beginPath();
      ctx.arc(rm.displayX, rm.displayY, rm.radius || 14, 0, Math.PI * 2);
      ctx.fillStyle = rm.color || '#9c9c9c';
      ctx.fill();
      // outline
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      // hp bar
      if (typeof rm.hp === 'number' && typeof rm.maxHp === 'number' && rm.maxHp > 0) {
        const pct = Math.max(0, Math.min(1, rm.hp / rm.maxHp));
        const barW = Math.max(20, (rm.radius || 14) * 1.8);
        const barH = 6;
        const bx = rm.displayX - barW / 2;
        const by = rm.displayY - (rm.radius || 14) - 10;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRectScreen(ctx, bx - 1, by - 1, barW + 2, barH + 2, 3, true, false);
        ctx.fillStyle = '#6b6b6b';
        roundRectScreen(ctx, bx, by, barW, barH, 3, true, false);
        ctx.fillStyle = '#e74c3c';
        roundRectScreen(ctx, bx, by, Math.max(2, barW * pct), barH, 3, true, false);
        ctx.globalAlpha = 1.0;
      }
    }
    ctx.restore();
  }

  function drawPlayerScreen(screenX, screenY, angle) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(screenX, screenY, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();

    const shine = ctx.createLinearGradient(screenX - player.radius, screenY - player.radius, screenX + player.radius, screenY + player.radius);
    shine.addColorStop(0, 'rgba(255,255,255,0.12)');
    shine.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(screenX, screenY, player.radius, 0, Math.PI * 2);
    ctx.fill();

    const eyeOffsetAngle = Math.PI / 6;
    const eyeDistance = player.radius * 0.45;
    const eyeRadius = Math.max(3, Math.floor(player.radius * 0.15));
    const leftEyeAngle = angle - eyeOffsetAngle;
    const rightEyeAngle = angle + eyeOffsetAngle;
    const leftEyeX = screenX + Math.cos(leftEyeAngle) * eyeDistance;
    const leftEyeY = screenY + Math.sin(leftEyeAngle) * eyeDistance;
    const rightEyeX = screenX + Math.cos(rightEyeAngle) * eyeDistance;
    const rightEyeY = screenY + Math.sin(rightEyeAngle) * eyeDistance;

    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(leftEyeX, leftEyeY, eyeRadius, 0, Math.PI * 2);
    ctx.arc(rightEyeX, rightEyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    const pupilOffset = eyeRadius * 0.35;
    ctx.beginPath();
    ctx.fillStyle = '#000';
    ctx.arc(leftEyeX + Math.cos(angle) * pupilOffset, leftEyeY + Math.sin(angle) * pupilOffset, Math.max(1.5, eyeRadius * 0.45), 0, Math.PI * 2);
    ctx.arc(rightEyeX + Math.cos(angle) * pupilOffset, rightEyeY + Math.sin(angle) * pupilOffset, Math.max(1.5, eyeRadius * 0.45), 0, Math.PI * 2);
    ctx.fill();

    if (player.name) {
      ctx.font = '14px system-ui, Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(player.name + (player.level ? ` (Lv ${player.level})` : ''), screenX + 1, screenY - player.radius - 12 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(player.name + (player.level ? ` (Lv ${player.level})` : ''), screenX, screenY - player.radius - 12);
    }

    ctx.restore();
  }

  function drawMinimap() {
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    const padding = 12;
    const size = Math.min(200, Math.max(120, Math.floor(Math.min(vw, vh) * 0.16)));
    const x = vw - padding - size;
    const y = padding;
    const cornerRadius = 8;

    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(20,20,22,0.95)';
    roundRectScreen(ctx, x - 6, y - 6, size + 12, size + 12, cornerRadius + 2, true, false);

    const cx = x + size / 2;
    const cy = y + size / 2;
    const scale = size / (map.size || (map.radius * 2));

    if (map.type === 'circle') {
      ctx.beginPath();
      ctx.arc(cx, cy, map.radius * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#6fbf6f';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, map.radius * scale, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2a6b2a';
      ctx.stroke();
    } else {
      const half = map.half || (map.size/2);
      const ms = half * 2 * scale;
      ctx.fillStyle = '#6fbf6f';
      ctx.fillRect(cx - ms/2, cy - ms/2, ms, ms);
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2a6b2a';
      ctx.strokeRect(cx - ms/2, cy - ms/2, ms, ms);

      ctx.fillStyle = '#6b4f3b';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      for (const w of (map.walls || [])) {
        const wx = cx + (w.x - map.center.x) * scale;
        const wy = cy + (w.y - map.center.y) * scale;
        const ww = w.w * scale;
        const wh = w.h * scale;
        ctx.fillRect(wx, wy, ww, wh);
        ctx.strokeRect(wx, wy, ww, wh);
      }
    }

    // player dot
    const px = cx + (player.x - map.center.x) * scale;
    const py = cy + (player.y - map.center.y) * scale;
    ctx.beginPath();
    ctx.fillStyle = player.color;
    ctx.arc(px, py, Math.max(3, Math.min(8, player.radius * 0.18)), 0, Math.PI * 2);
    ctx.fill();

    // mobs on minimap (small grey dots)
    for (const rm of remoteMobs.values()) {
      if (typeof rm.targetX !== 'number' || typeof rm.targetY !== 'number') continue;
      const mx = cx + (rm.targetX - map.center.x) * scale;
      const my = cy + (rm.targetY - map.center.y) * scale;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(150,150,150,0.95)';
      ctx.arc(mx, my, Math.max(1.5, Math.min(4, (rm.radius || 12) * 0.08)), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    roundRectScreen(ctx, x - 6, y - 6, size + 12, size + 12, cornerRadius + 2, false, true);

    ctx.restore();
  }

  function drawCoordinatesBottomRight() {
    if (!settings.showCoordinates) return;
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    const padding = 12;
    const text = `x: ${Math.round(player.x)}, y: ${Math.round(player.y)}`;
    ctx.save();
    ctx.font = '14px system-ui, Arial';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    const metrics = ctx.measureText(text);
    const tw = metrics.width;
    const rectW = tw + 12;
    const rectH = 22;
    const rx = vw - padding - rectW;
    const ry = vh - padding - rectH;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRectScreen(ctx, rx, ry, rectW, rectH, 6, true, false);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, vw - padding - 6, vh - padding - 6);
    ctx.restore();
  }

  function roundRectScreen(ctx, x, y, width, height, radius, fill, stroke) {
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

  function pseudo(x, y, seed = 1337) {
    return (Math.abs(Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453) % 1);
  }

  // --- Main loop ---
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // update cooldown timers
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (cooldowns[i] > 0) {
        cooldowns[i] = Math.max(0, cooldowns[i] - dt);
      }
    }

    if (isLoading) { requestAnimationFrame(loop); return; }
    const titleVisible = titleScreen && titleScreen.style.display !== 'none';
    const settingsOpen = settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false';
    const inputVec = (!titleVisible && !settingsOpen) ? computeInputVector() : { x: 0, y: 0 };
    const targetVx = inputVec.x * player.speed;
    const targetVy = inputVec.y * player.speed;
    const velLerp = 1 - Math.exp(-MOVE_ACCEL * dt);
    player.vx += (targetVx - player.vx) * velLerp;
    player.vy += (targetVy - player.vy) * velLerp;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    if (player.serverX !== null && player.serverY !== null) {
      const dx = player.serverX - player.x;
      const dy = player.serverY - player.y;
      const factor = 1 - Math.exp(-RECONCILE_SPEED * dt);
      player.x += dx * factor;
      player.y += dy * factor;
    }
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > MIN_MOVEMENT_FOR_FACING) {
      const desired = Math.atan2(player.vy, player.vx);
      let diff = desired - player.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const angLerp = 1 - Math.exp(-TURN_SPEED * dt);
      player.facing += diff * angLerp;
    }
    const clamped = clampToMap(player.x, player.y);
    player.x = clamped.x;
    player.y = clamped.y;
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(vw / 2 - player.x, vh / 2 - player.y);
    if (!titleVisible) drawWorld(vw, vh, dt);
    ctx.restore();
    const playerScreenX = vw / 2;
    const playerScreenY = vh / 2;
    const angle = player.facing;
    if (!titleVisible) drawPlayerScreen(playerScreenX, playerScreenY, angle);
    if (!titleVisible) {
      if (settings.showCoordinates) drawCoordinatesBottomRight();
      drawMinimap();
      // draw XP bar & hotbar
      drawXpBar(vw, vh);
      drawHotbar(vw, vh);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // --- Collision helpers ---
  function resolveCircleAABB(p, rect) {
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

  function clampToMap(px, py) {
    if (map.type === 'circle') {
      const dx = px - map.center.x; const dy = py - map.center.y; const dist = Math.hypot(dx, dy);
      const limit = (map.radius || 750) - player.radius - 1;
      if (dist > limit) { const k = limit / dist; return { x: map.center.x + dx * k, y: map.center.y + dy * k }; }
      const p = { x: px, y: py, vx: player.vx, vy: player.vy, radius: player.radius };
      if (map.walls && map.walls.length) for (const w of map.walls) resolveCircleAABB(p, w);
      return { x: p.x, y: p.y };
    }
    const half = map.half || (map.size/2); const limit = half - player.radius - 1;
    let nx = Math.max(map.center.x - limit, Math.min(map.center.x + limit, px));
    let ny = Math.max(map.center.y - limit, Math.min(map.center.y + limit, py));
    const p = { x: nx, y: ny, vx: player.vx, vy: player.vy, radius: player.radius };
    if (map.walls && map.walls.length) for (const w of map.walls) resolveCircleAABB(p, w);
    nx = Math.max(map.center.x - limit, Math.min(map.center.x + limit, p.x)); ny = Math.max(map.center.y - limit, Math.min(map.center.y + limit, p.y));
    return { x: nx, y: ny };
  }

  // Expose for debugging
  window.moborr = { startGame, connectToServer, appendChatMessage, castSkill };

})();
