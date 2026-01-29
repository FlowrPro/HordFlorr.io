// Moborr.io — frontend with Google Sign-In + WebSocket auth + procedural texture + HUD.
// Updated: stronger ID-token handling (force refresh), redirect handling, and extra logging for WS/auth debugging.

// ---------------- CONFIG ----------------
const SERVER_URL = 'wss://hordflorr-io-backend.onrender.com'; // <-- your Render URL

// Firebase config (you provided)
const firebaseConfig = {
  apiKey: "AIzaSyCWcP8DP7PRXzTLw5y2OX90KTrJRk_Q3XY",
  authDomain: "moborrio.firebaseapp.com",
  projectId: "moborrio",
  storageBucket: "moborrio.firebasestorage.app",
  messagingSenderId: "931063224197",
  appId: "1:931063224197:web:92cb801291e87d5ebb56ec",
  measurementId: "G-BGZVQ865WW"
};

// ---------------- Firebase init ----------------
firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const fbDb = firebase.firestore?.(); // optional if you want later

// If the page is loaded after a redirect sign-in, handle the result and obtain a fresh ID token
fbAuth.getRedirectResult()
  .then(async (result) => {
    if (result && result.user) {
      const user = result.user;
      try {
        // force refresh so we get a fresh, valid ID token
        const idToken = await user.getIdToken(true);
        console.log('[Auth] redirect result - obtained ID token (len=', idToken.length, ')');
        localStorage.setItem('moborr_idtoken', idToken);
        // set display name into username field so UI reflects signed-in user
        if (user.displayName) {
          const nameInput = document.getElementById('username');
          if (nameInput) nameInput.value = user.displayName;
        }
        // hide title and auto-connect with fresh token
        const titleScreen = document.getElementById('titleScreen');
        if (titleScreen) titleScreen.setAttribute('aria-hidden', 'true');
        connectToServer(idToken);
      } catch (e) {
        console.warn('[Auth] Failed to obtain idToken from redirect result', e);
      }
    }
  })
  .catch((err) => {
    // log redirect errors for debugging
    console.warn('[Auth] getRedirectResult error', err && err.code, err && err.message);
  });

(() => {
  // ----- DOM -----
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const titleScreen = document.getElementById('titleScreen');
  const usernameInput = document.getElementById('username');
  const playButton = document.getElementById('playButton');
  const googleSignInBtn = document.getElementById('googleSignIn');

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

  const chatRoot = document.getElementById('chat');
  const chatMessagesEl = document.getElementById('chatMessages');
  const chatInputWrap = document.getElementById('chatInputWrap');
  const chatInput = document.getElementById('chatInput');

  // ----- Canvas setup -----
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

  // ----- World / Player -----
  const map = { halfSize: 6000, center: { x: 0, y: 0 } };

  const player = {
    id: null,
    x: 0, y: 0,
    radius: 28, color: '#ffd54a',
    speed: 380, vx: 0, vy: 0,
    facing: -Math.PI/2, displayFacing: -Math.PI/2,
    name: '', serverX: null, serverY: null,
    maxHp: 200, hp: 200, xp: 0, gold: 0, level: 1
  };

  const remotePlayers = new Map();
  let walls = [];
  let mobs = new Map();

  const keys = {};
  let pointer = { x: 0, y: 0 };
  let mouseWorld = { x: 0, y: 0 };
  let clickTarget = null;

  // ----- Procedural rock pattern -----
  function pseudo(x, y, seed = 1337) {
    return (Math.abs(Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453) % 1);
  }
  function createProceduralRockTile(tileSize = 256) {
    const oc = document.createElement('canvas');
    oc.width = oc.height = tileSize;
    const octx = oc.getContext('2d');
    octx.fillStyle = '#bfb8a8';
    octx.fillRect(0,0,tileSize,tileSize);
    for (let i=0;i<40;i++){
      const sx = Math.floor(pseudo(i*13,i*17,91)*tileSize);
      const sy = Math.floor(pseudo(i*19,i*23,97)*tileSize);
      const rw = 18 + Math.floor(pseudo(i*7,i*11,53)*70);
      const rh = 10 + Math.floor(pseudo(i*5,i*9,61)*50);
      const hueShift = Math.floor(pseudo(i,i*3,19)*40)-20;
      const light = 190 + Math.floor(pseudo(i*2,i*4,71)*50);
      const dark = Math.max(80, light - 70 + Math.floor(pseudo(i*4,i*2,83)*30));
      const g = octx.createLinearGradient(sx-rw, sy-rh, sx+rw, sy+rh);
      g.addColorStop(0, `rgba(${light + hueShift}, ${light - 20 + hueShift}, ${light - 60 + hueShift}, 0.98)`);
      g.addColorStop(1, `rgba(${dark + hueShift}, ${dark - 30 + hueShift}, ${dark - 80 + hueShift}, 0.95)`);
      octx.fillStyle = g;
      octx.beginPath();
      octx.ellipse(sx, sy, rw, rh, (pseudo(i,i*2,7)-0.5)*1.2,0,Math.PI*2);
      octx.fill();
      octx.beginPath();
      octx.ellipse(sx - rw * 0.25, sy - rh * 0.25, rw * 0.6, rh * 0.6, 0, 0, Math.PI * 2);
      octx.fillStyle = `rgba(255,255,255,${0.04 + (pseudo(i,i*3,17) * 0.06)})`;
      octx.fill();
    }
    for (let x=0;x<tileSize;x+=6){
      for (let y=0;y<tileSize;y+=6){
        const p = pseudo(x*1.3,y*0.7,42);
        const c = Math.floor(200 - p * 80);
        octx.fillStyle = `rgba(${c}, ${c - 10}, ${c - 40}, ${0.03 + p * 0.06})`;
        octx.fillRect(x + (p - 0.5) * 2, y + (p - 0.5) * 2, 3, 3);
      }
    }
    const vg = octx.createRadialGradient(tileSize/2,tileSize/2,tileSize/4,tileSize/2,tileSize/2,tileSize*0.9);
    vg.addColorStop(0,'rgba(0,0,0,0)');
    vg.addColorStop(1,'rgba(0,0,0,0.06)');
    octx.fillStyle = vg;
    octx.fillRect(0,0,tileSize,tileSize);
    return oc;
  }
  let wallPattern = null;
  try {
    const tile = createProceduralRockTile(256);
    wallPattern = ctx.createPattern(tile, 'repeat');
  } catch(e) { console.warn(e); wallPattern = null; }

  // ----- Settings load/save -----
  const defaultSettings = { mouseMovement:false, keyboardMovement:true, clickMovement:false, graphicsQuality:'medium', showCoordinates:true };
  let settings = loadSettings();
  if (mouseMovementCheckbox) mouseMovementCheckbox.checked = settings.mouseMovement;
  if (keyboardMovementCheckbox) keyboardMovementCheckbox.checked = settings.keyboardMovement;
  if (clickMovementCheckbox) clickMovementCheckbox.checked = settings.clickMovement;
  if (graphicsQuality) graphicsQuality.value = settings.graphicsQuality;
  if (showCoordinatesCheckbox) showCoordinatesCheckbox.checked = settings.showCoordinates;
  if (mouseMovementCheckbox) mouseMovementCheckbox.addEventListener('change', ()=>{ settings.mouseMovement = mouseMovementCheckbox.checked; saveSettings(); });
  if (keyboardMovementCheckbox) keyboardMovementCheckbox.addEventListener('change', ()=>{ settings.keyboardMovement = keyboardMovementCheckbox.checked; saveSettings(); });
  if (clickMovementCheckbox) clickMovementCheckbox.addEventListener('change', ()=>{ settings.clickMovement = clickMovementCheckbox.checked; saveSettings(); });
  if (graphicsQuality) graphicsQuality.addEventListener('change', ()=>{ settings.graphicsQuality = graphicsQuality.value; saveSettings(); });
  if (showCoordinatesCheckbox) showCoordinatesCheckbox.addEventListener('change', ()=>{ settings.showCoordinates = showCoordinatesCheckbox.checked; saveSettings(); });
  function loadSettings(){ try{ const raw = localStorage.getItem('moborr_settings'); if(!raw) return {...defaultSettings}; return Object.assign({}, defaultSettings, JSON.parse(raw)); }catch(e){return {...defaultSettings};} }
  function saveSettings(){ localStorage.setItem('moborr_settings', JSON.stringify(settings)); }

  // ----- Networking -----
  let ws = null;
  let sendInputInterval = null;
  let seq = 0;

  // get Firebase id token for current user (optional helper)
  async function getFirebaseIdToken(forceRefresh = false) {
    const user = fbAuth.currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken(forceRefresh);
    } catch (e) {
      console.warn('[Auth] getIdToken failed', e);
      return null;
    }
  }

  async function connectToServer(idToken = null) {
    if (!SERVER_URL) return;
    try {
      ws = new WebSocket(SERVER_URL);
    } catch (err) {
      console.warn('Failed to create WebSocket', err);
      ws = null;
      return;
    }

    ws.addEventListener('open', async () => {
      console.log('Connected to server', SERVER_URL);

      // If idToken not provided, try to obtain a fresh one from Firebase current user.
      if (!idToken) {
        // try to refresh token if user is signed in
        if (fbAuth && fbAuth.currentUser) {
          try {
            const fresh = await fbAuth.currentUser.getIdToken(true);
            if (fresh) {
              idToken = fresh;
              localStorage.setItem('moborr_idtoken', idToken);
              console.log('[Auth] refreshed idToken (len=', idToken.length, ')');
            }
          } catch (e) {
            console.warn('[Auth] failed to refresh idToken on open', e);
          }
        } else {
          // try localStorage token as last resort
          idToken = localStorage.getItem('moborr_idtoken') || null;
          if (idToken) console.log('[Auth] using idToken from localStorage (len=', idToken.length, ')');
        }
      }

      if (idToken) {
        try {
          console.log('[Auth] sending idToken to server (len=', idToken.length, ')');
          ws.send(JSON.stringify({ t: 'auth', provider: 'google', idToken }));
        } catch (e) {
          console.warn('Failed to send auth token', e);
        }
      } else {
        // fallback anonymous join
        const name = player.name || (usernameInput && usernameInput.value.trim() ? usernameInput.value.trim() : 'Player');
        player.name = name;
        ws.send(JSON.stringify({ t: 'join', name }));
      }
      if (!sendInputInterval) sendInputInterval = setInterval(sendInputPacket, 50);
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleServerMessage(msg);
      } catch (e) {
        console.warn('ws message parse error', e);
      }
    });

    ws.addEventListener('close', (ev) => {
      console.warn('Disconnected from server', ev && ev.code, ev && ev.reason);
      ws = null;
      if (sendInputInterval) { clearInterval(sendInputInterval); sendInputInterval = null; }
    });
    ws.addEventListener('error', (err) => { console.warn('ws error', err); });
  }

  // ----- Chat queue -----
  const chatMessages = [];
  const CHAT_MAX = 200;
  const pendingChatIds = new Set();

  function handleServerMessage(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'welcome') {
      if (msg.id) player.id = String(msg.id);
      if (typeof msg.mapHalf === 'number') { map.halfSize = Number(msg.mapHalf); }
      if (typeof msg.spawnX === 'number' && typeof msg.spawnY === 'number') {
        player.x = Number(msg.spawnX); player.y = Number(msg.spawnY);
        player.serverX = player.x; player.serverY = player.y;
      }
      if (Array.isArray(msg.walls)) { walls = msg.walls.map(w => ({ ...w })); }
      console.log('[Server] welcome', msg.id);
    } else if (msg.t === 'snapshot') {
      const list = msg.players || [];
      const seen = new Set();
      for (const sp of list) {
        const id = String(sp.id);
        seen.add(id);
        if (id === player.id) {
          player.serverX = sp.x; player.serverY = sp.y;
          if (Math.hypot(player.serverX - player.x, player.serverY - player.y) > 140) { player.x = player.serverX; player.y = player.serverY; }
          player.vx = sp.vx || player.vx; player.vy = sp.vy || player.vy;
          player.color = sp.color || player.color; player.radius = sp.radius || player.radius;
          player.name = sp.name || player.name;
          player.hp = sp.hp ?? player.hp; player.maxHp = sp.maxHp ?? player.maxHp;
          if (Math.hypot(player.vx, player.vy) > 0.01) player.facing = Math.atan2(player.vy, player.vx);
        } else {
          let rp = remotePlayers.get(id);
          if (!rp) {
            rp = { id, name: sp.name, targetX: sp.x, targetY: sp.y, displayX: sp.x, displayY: sp.y, vx: sp.vx||0, vy: sp.vy||0, radius: sp.radius, color: sp.color||'#ff7', facing:0, displayFacing:0, hp: sp.hp||0, maxHp: sp.maxHp||0 };
            if (Math.hypot(rp.vx, rp.vy) > 0.01) rp.facing = Math.atan2(rp.vy, rp.vx);
            rp.displayFacing = rp.facing;
            remotePlayers.set(id, rp);
          } else {
            rp.name = sp.name || rp.name;
            rp.targetX = sp.x; rp.targetY = sp.y;
            rp.vx = sp.vx || rp.vx; rp.vy = sp.vy || rp.vy;
            rp.radius = sp.radius || rp.radius; rp.color = sp.color || rp.color;
            rp.hp = sp.hp || rp.hp; rp.maxHp = sp.maxHp || rp.maxHp;
            if (Math.hypot(rp.vx, rp.vy) > 0.05) rp.facing = Math.atan2(rp.vy, rp.vx);
          }
        }
      }
      for (const key of Array.from(remotePlayers.keys())) if (!seen.has(key)) remotePlayers.delete(key);

      const mobList = msg.mobs || [];
      mobs.clear();
      for (const m of mobList) mobs.set(m.id, { ...m });
    } else if (msg.t === 'mob_died') {
      const killerId = msg.killerId;
      const gold = msg.gold || 0;
      const xp = msg.xp || 0;
      if (String(killerId) === String(player.id)) {
        player.gold = (player.gold || 0) + gold;
        player.xp = (player.xp || 0) + xp;
        pushChatMessage({ name: 'System', text: `You killed a ${msg.mobType} and gained ${gold} gold, ${xp} XP.`, ts: Date.now() });
      } else if (killerId) {
        pushChatMessage({ name: 'System', text: `${msg.killerId} killed a ${msg.mobType} (+${gold}g ${xp}xp)`, ts: Date.now() });
      } else {
        pushChatMessage({ name: 'System', text: `A ${msg.mobType} died.`, ts: Date.now() });
      }
      mobs.delete(msg.mobId);
    } else if (msg.t === 'chat') {
      const from = msg.name || 'Player'; const text = String(msg.text || '').slice(0,240); const ts = msg.ts || Date.now(); const cid = msg.chatId;
      if (cid && pendingChatIds.has(cid)) {
        const idx = chatMessages.findIndex(m => m.id === cid);
        if (idx !== -1) { chatMessages[idx].name = from; chatMessages[idx].text = text; chatMessages[idx].ts = ts; pendingChatIds.delete(cid); renderChatMessages(); return; } else { pendingChatIds.delete(cid); }
      }
      pushChatMessage({ name: from, text, ts, id: cid });
    } else if (msg.t === 'chat_blocked') {
      pushChatMessage({ name: 'System', text: 'Your message was blocked by server (rate limit).', ts: msg.ts || Date.now() });
    } else if (msg.t === 'auth_failed') {
      console.warn('[Server] auth_failed', msg.reason);
      alert('Server rejected authentication: ' + (msg.reason || 'unknown'));
    }
  }

  function sendInputPacket() { if (!ws || ws.readyState !== WebSocket.OPEN) return; const input = computeInputVector(); ws.send(JSON.stringify({ t: 'input', seq: ++seq, input })); }

  function sendChatMessage(text) {
    const trimmed = String(text || '').trim().slice(0,240); if (!trimmed) return;
    const chatId = `${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
    const msg = { t:'chat', text: trimmed, chatId };
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(msg)); } catch(e){} }
    pushChatMessage({ id: chatId, name: player.name || 'Player', text: trimmed, ts: Date.now() });
    pendingChatIds.add(chatId);
  }

  function pushChatMessage(m) { chatMessages.push(m); if (chatMessages.length > CHAT_MAX) chatMessages.shift(); renderChatMessages(); }

  // ----- Chat UI behavior -----
  let chatOpen = false;
  function openChat(){ if (!chatRoot) return; if (titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true') return; chatRoot.setAttribute('aria-hidden','false'); chatInputWrap.classList.remove('hidden'); chatInput.focus(); chatOpen = true; }
  function closeChat(){ if (!chatRoot) return; chatInput.value=''; chatInput.blur(); chatInputWrap.classList.add('hidden'); chatOpen = false; }
  function toggleChatOpen(){ if (chatOpen) closeChat(); else openChat(); }
  function renderChatMessages(){ if (!chatMessagesEl) return; chatMessagesEl.innerHTML = ''; const start = Math.max(0, chatMessages.length - 25); for (let i = start; i < chatMessages.length; i++) { const m = chatMessages[i]; const row = document.createElement('div'); row.className = 'chatMessage'; const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = m.name; row.appendChild(meta); const text = document.createElement('span'); text.className = 'text'; text.textContent = `: ${m.text}`; row.appendChild(text); const time = document.createElement('span'); time.className = 'time'; const d = new Date(m.ts || Date.now()); const hh = String(d.getHours()).padStart(2,'0'); const mm = String(d.getMinutes()).padStart(2,'0'); time.textContent = ` ${hh}:${mm}`; row.appendChild(time); chatMessagesEl.appendChild(row); } chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight; }

  // ----- Input handling -----
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true') { return; }
      if (settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false') return;
      if (!chatOpen) { e.preventDefault(); openChat(); }
    } else if (e.key === 'Escape') { if (chatOpen) { e.preventDefault(); closeChat(); } }
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const txt = chatInput.value.trim(); if (txt.length > 0) sendChatMessage(txt); chatInput.value = ''; closeChat(); } else if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
  });

  window.addEventListener('keydown', (e) => {
    if (titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true') { if (e.key === 'Enter') { e.preventDefault(); startGame(); } return; }
    if (settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false') return;
    if (chatOpen) return;
    keys[e.key.toLowerCase()] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true') return;
    if (settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false') return;
    if (chatOpen) return;
    keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener('mousemove', (e)=> {
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    pointer.x = e.clientX; pointer.y = e.clientY; mouseWorld.x = player.x + (pointer.x - vw / 2); mouseWorld.y = player.y + (pointer.y - vh / 2);
  });

  canvas.addEventListener('click', (e) => {
    if (settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false') return;
    if (titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true') return;
    if (chatOpen) return;
    if (!settings.clickMovement) return;
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    const wx = player.x + (e.clientX - vw / 2); const wy = player.y + (e.clientY - vh / 2); clickTarget = { x: wx, y: wy };
  });

  function computeInputVector() {
    if (settings.keyboardMovement) {
      let ax=0, ay=0; if (keys['arrowup']||keys['w']) ay -=1; if (keys['arrowdown']||keys['s']) ay +=1; if (keys['arrowleft']||keys['a']) ax -=1; if (keys['arrowright']||keys['d']) ax +=1;
      if (ax !== 0 || ay !== 0) { const len = Math.hypot(ax,ay); return { x: ax/len, y: ay/len }; }
    }
    if (settings.clickMovement && clickTarget) { const dx = clickTarget.x - player.x; const dy = clickTarget.y - player.y; const len = Math.hypot(dx,dy); if (len < 6) { clickTarget=null; return { x:0,y:0 }; } return { x: dx/len, y: dy/len }; }
    if (settings.mouseMovement) { const dx = mouseWorld.x - player.x; const dy = mouseWorld.y - player.y; const len = Math.hypot(dx,dy); if (len>4) return { x: dx/len, y: dy/len }; }
    return { x:0, y:0 };
  }

  // ----- Local collision helper (unchanged) -----
  function resolveCircleAABB_Local(px, py, radius, rect) {
    const rx1 = rect.x, ry1 = rect.y, rx2 = rect.x + rect.w, ry2 = rect.y + rect.h;
    const closestX = Math.max(rx1, Math.min(px, rx2)), closestY = Math.max(ry1, Math.min(py, ry2));
    let dx = px - closestX, dy = py - closestY;
    const distSq = dx*dx + dy*dy;
    if (distSq === 0) {
      const leftDist = Math.abs(px - rx1), rightDist = Math.abs(rx2 - px), topDist = Math.abs(py - ry1), bottomDist = Math.abs(ry2 - py);
      const minHoriz = Math.min(leftDist, rightDist), minVert = Math.min(topDist, bottomDist);
      if (minHoriz < minVert) { if (leftDist < rightDist) px = rx1 - radius - 0.1; else px = rx2 + radius + 0.1; } else { if (topDist < bottomDist) py = ry1 - radius - 0.1; else py = ry2 + radius + 0.1; }
      return { x: px, y: py };
    }
    const dist = Math.sqrt(distSq), overlap = radius - dist;
    if (overlap > 0) { dx /= dist; dy /= dist; px += dx * overlap; py += dy * overlap; }
    return { x: px, y: py };
  }

  // ----- Drawing & HUD (gold bottom-left; level/XP bottom-center) -----
  const RECONCILE_SPEED = 6.0, REMOTE_INTERP_SPEED = 8.0, FACING_SMOOTH_SPEED = 10.0;

  function drawWorld(vw, vh, dt) {
    ctx.save(); ctx.fillStyle = '#8b5a2b'; const cover = Math.max(map.halfSize * 2 + Math.max(vw, vh) * 2, 16000); const rx = map.center.x - cover/2; const ry = map.center.y - cover/2; ctx.fillRect(rx, ry, cover, cover); ctx.restore();
    const size = map.halfSize * 2;
    ctx.save();
    const left = map.center.x - map.halfSize, top = map.center.y - map.halfSize;
    const grad = ctx.createLinearGradient(left, top, left + size, top + size); grad.addColorStop(0, '#9fe69f'); grad.addColorStop(1, '#5fb35f');
    ctx.fillStyle = grad; ctx.fillRect(left, top, size, size); ctx.lineWidth = 6; ctx.strokeStyle = '#2a6b2a'; ctx.strokeRect(left, top, size, size); ctx.restore();

  // ... rest of file unchanged ...
