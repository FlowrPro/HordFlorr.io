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
  // By default assume a circular demo map. The server 'welcome' message will override map properties.
  const map = {
    type: 'circle', // 'circle' or 'square'
    center: { x: 0, y: 0 },
    radius: 750,
    half: 750,
    size: 1500,
    walls: []
  };

  // --- Player (local) ---
  const player = {
    id: null, // set after welcome
    x: 0, y: 0,
    radius: 28,
    color: '#ffd54a',
    speed: 380,
    vx: 0, vy: 0,
    facing: -Math.PI / 2,
    name: '',
    // server reconciliation target (set when a snapshot arrives)
    serverX: null,
    serverY: null
  };

  // --- Remote players from server ---
  // store objects: { id, name, targetX, targetY, displayX, displayY, vx, vy, radius, color }
  const remotePlayers = new Map();

  // --- Input state ---
  const keys = {};
  let pointer = { x: 0, y: 0 }; // screen coords
  let mouseWorld = { x: 0, y: 0 }; // world coords
  let clickTarget = null;

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

  function connectToServer() {
    if (!SERVER_URL) return;
    try {
      ws = new WebSocket(SERVER_URL);
    } catch (err) {
      console.warn('Failed to create WebSocket', err);
      ws = null;
      return;
    }

    ws.addEventListener('open', () => {
      console.log('Connected to server', SERVER_URL);
      // send join if player.name available
      const name = player.name || (usernameInput && usernameInput.value.trim() ? usernameInput.value.trim() : 'Player');
      player.name = name;
      ws.send(JSON.stringify({ t: 'join', name }));
      // start sending inputs periodically (match server tick ~20Hz)
      if (!sendInputInterval) sendInputInterval = setInterval(sendInputPacket, 50); // ~20Hz
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleServerMessage(msg);
      } catch (e) {
        // ignore parse
      }
    });

    ws.addEventListener('close', () => {
      console.log('Disconnected from server');
      ws = null;
      if (sendInputInterval) { clearInterval(sendInputInterval); sendInputInterval = null; }
    });

    ws.addEventListener('error', (err) => { console.warn('ws error', err); });
  }

  // Reconciliation & interpolation (frame-rate independent)
  const RECONCILE_SPEED = 6.0; // higher = faster correction toward server
  const REMOTE_INTERP_SPEED = 8.0; // higher = faster interpolation of remote players

  function handleServerMessage(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'welcome') {
      if (msg.id) player.id = String(msg.id);

      // map info (server authoritative)
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

      // place local player at server spawn if provided
      if (typeof msg.spawnX === 'number' && typeof msg.spawnY === 'number') {
        player.x = msg.spawnX; player.y = msg.spawnY;
      }

      console.log('Server welcome. my id =', player.id, 'mapType=', map.type, 'mapHalf/mapRadius=', map.half || map.radius, 'tickRate=', msg.tickRate);
    } else if (msg.t === 'snapshot') {
      const list = msg.players || [];
      const seen = new Set();
      for (const sp of list) {
        const id = String(sp.id);
        seen.add(id);
        if (id === player.id) {
          // server authoritative update for self -> set server target for reconciliation
          player.serverX = sp.x;
          player.serverY = sp.y;
          // if server is very far from client, snap immediately
          const dx = player.serverX - player.x;
          const dy = player.serverY - player.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 140) { // very large divergence => snap
            player.x = player.serverX;
            player.y = player.serverY;
          }
          // update meta
          player.vx = sp.vx || player.vx;
          player.vy = sp.vy || player.vy;
          player.color = sp.color || player.color;
          player.radius = sp.radius || player.radius;
          player.name = sp.name || player.name;
        } else {
          // update/create remote player entry
          let rp = remotePlayers.get(id);
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
              color: sp.color || '#ff7'
            };
            remotePlayers.set(id, rp);
          } else {
            rp.name = sp.name || rp.name;
            rp.targetX = sp.x;
            rp.targetY = sp.y;
            rp.vx = sp.vx || rp.vx;
            rp.vy = sp.vy || rp.vy;
            rp.radius = sp.radius || rp.radius;
            rp.color = sp.color || rp.color;
          }
        }
      }
      // remove remote players not present
      for (const key of Array.from(remotePlayers.keys())) {
        if (!seen.has(key)) remotePlayers.delete(key);
      }
    } else if (msg.t === 'joined') {
      // ack
    } else if (msg.t === 'pong') {
      // ignore for now
    }
  }

  function sendInputPacket() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const input = computeInputVector();
    ws.send(JSON.stringify({ t: 'input', seq: ++seq, input }));
  }

  // --- Input handling (keyboard, mouse, click) ---
  window.addEventListener('keydown', (e) => {
    if (titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true') {
      if (e.key === 'Enter') { e.preventDefault(); startGame(); }
      return;
    }
    if (settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false') return;
    keys[e.key.toLowerCase()] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true') return;
    if (settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false') return;
    keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    mouseWorld.x = player.x + (pointer.x - vw / 2);
    mouseWorld.y = player.y + (pointer.y - vh / 2);
  });

  canvas.addEventListener('click', (e) => {
    if (settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false') return;
    if (titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true') return;
    if (!settings.clickMovement) return;
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    const wx = player.x + (e.clientX - vw / 2);
    const wy = player.y + (e.clientY - vh / 2);
    clickTarget = { x: wx, y: wy };
  });

  function computeInputVector() {
    // Priority: keyboard -> click target -> mouse movement
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

  // Loading guard
  let isLoading = false;
  function startGame() {
    if (isLoading) return;
    isLoading = true;

    const name = usernameInput && usernameInput.value.trim() ? usernameInput.value.trim() : 'Player';
    player.name = name;
    localStorage.setItem('moborr_username', name);

    // hide title screen and show loading screen
    if (titleScreen) titleScreen.setAttribute('aria-hidden', 'true');
    if (loadingScreen) loadingScreen.setAttribute('aria-hidden', 'false');

    // disable inputs in the login box while loading (prevent double clicks)
    if (playButton) playButton.disabled = true;
    if (usernameInput) usernameInput.disabled = true;

    // show loading for 3 seconds, then connect and enter game
    setTimeout(() => {
      if (loadingScreen) loadingScreen.setAttribute('aria-hidden', 'true');
      // connect to server
      connectToServer();
      canvas.focus?.();
    }, 3000);
  }
  if (playButton) playButton.addEventListener('click', startGame);
  if (usernameInput) usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); startGame(); }
  });

  if (settingsBtn) settingsBtn.addEventListener('click', () => {
    const open = settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false';
    if (open) { if (settingsPanel) settingsPanel.setAttribute('aria-hidden','true'); if (settingsBtn) settingsBtn.setAttribute('aria-expanded','false'); }
    else { if (settingsPanel) settingsPanel.setAttribute('aria-hidden','false'); if (settingsBtn) settingsBtn.setAttribute('aria-expanded','true'); }
  });
  if (settingsClose) settingsClose.addEventListener('click', () => { if (settingsPanel) settingsPanel.setAttribute('aria-hidden','true'); });

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

  // --- Drawing & interpolation ---
  function drawWorld(vw, vh, dt) {
    // 1) brown floor (world coords)
    ctx.save();
    ctx.fillStyle = '#8b5a2b';
    const cover = Math.max((map.size || (map.radius*2)) + Math.max(vw, vh) * 2, 8000);
    const rx = map.center.x - cover / 2;
    const ry = map.center.y - cover / 2;
    ctx.fillRect(rx, ry, cover, cover);
    ctx.restore();

    // 2) map (circle or square)
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
    } else { // square
      const half = map.half || (map.size/2);
      const x = map.center.x - half;
      const y = map.center.y - half;
      const size = half * 2;
      // simple gradient for square map
      const g = ctx.createLinearGradient(x, y, x + size, y + size);
      g.addColorStop(0, '#9fe69f');
      g.addColorStop(1, '#5fb35f');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, size, size);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#2a6b2a';
      ctx.strokeRect(x, y, size, size);

      // draw walls from server (AABB world coords)
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

    // grass (world coords) - render inside map bounds (circle or square)
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

        // skip grass if inside any wall
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

    // update & draw remote players (interpolate display positions toward targets)
    ctx.save();
    for (const rp of remotePlayers.values()) {
      // frame-rate independent interpolation
      const interpFactor = 1 - Math.exp(-REMOTE_INTERP_SPEED * dt);
      rp.displayX += (rp.targetX - rp.displayX) * interpFactor;
      rp.displayY += (rp.targetY - rp.displayY) * interpFactor;

      // draw circle at display position
      ctx.beginPath();
      ctx.arc(rp.displayX, rp.displayY, rp.radius, 0, Math.PI * 2);
      ctx.fillStyle = rp.color || '#ff7';
      ctx.fill();

      // name
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

    // eyes
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

    // username
    if (player.name) {
      ctx.font = '14px system-ui, Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(player.name, screenX + 1, screenY - player.radius - 12 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(player.name, screenX, screenY - player.radius - 12);
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

      // draw walls on minimap
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

    const px = cx + (player.x - map.center.x) * scale;
    const py = cy + (player.y - map.center.y) * scale;
    ctx.beginPath();
    ctx.fillStyle = player.color;
    ctx.arc(px, py, Math.max(3, Math.min(8, player.radius * 0.18)), 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    roundRectScreen(ctx, x - 6, y - 6, size + 12, size + 12, cornerRadius + 2, false, true);

    ctx.restore();
  }

  // draw coordinates bottom-right if enabled
  function drawCoordinatesBottomRight() {
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

  function movementAngle() {
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 1e-3) player.facing = Math.atan2(player.vy, player.vx);
    return player.facing;
  }

  // --- Main loop ---
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const titleVisible = titleScreen && titleScreen.getAttribute('aria-hidden') !== 'true';
    const settingsOpen = settingsPanel && settingsPanel.getAttribute('aria-hidden') === 'false';

    // Decide input-based velocity locally for responsiveness
    let vx = 0, vy = 0;
    if (!titleVisible && !settingsOpen) {
      const inputVec = computeInputVector();
      vx = inputVec.x * player.speed;
      vy = inputVec.y * player.speed;
    } else {
      vx = 0; vy = 0;
    }

    // integrate locally
    player.x += vx * dt;
    player.y += vy * dt;
    player.vx = vx; player.vy = vy;

    // reconcile toward server target smoothly (frame-rate independent)
    if (player.serverX !== null && player.serverY !== null) {
      const dx = player.serverX - player.x;
      const dy = player.serverY - player.y;
      // apply exponential lerp
      const factor = 1 - Math.exp(-RECONCILE_SPEED * dt);
      player.x += dx * factor;
      player.y += dy * factor;
    }

    // clamp local to map & resolve walls
    const clamped = clampToMap(player.x, player.y);
    player.x = clamped.x;
    player.y = clamped.y;

    // draw
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, vw, vh);

    // world->screen transform: center on player
    ctx.save();
    ctx.translate(vw / 2 - player.x, vh / 2 - player.y);

    if (!titleVisible) drawWorld(vw, vh, dt);

    ctx.restore();

    // draw local player
    const playerScreenX = vw / 2;
    const playerScreenY = vh / 2;
    const angle = movementAngle();
    if (!titleVisible) drawPlayerScreen(playerScreenX, playerScreenY, angle);

    // HUD
    if (!titleVisible) {
      if (settings.showCoordinates) drawCoordinatesBottomRight();
      drawMinimap();
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // helpers

  // Resolve circle vs AABB like server does (client-side adaptation)
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
    // If circular map: clamp to circle like original code
    if (map.type === 'circle') {
      const dx = px - map.center.x;
      const dy = py - map.center.y;
      const dist = Math.hypot(dx, dy);
      const limit = (map.radius || 750) - player.radius - 1;
      if (dist > limit) {
        const k = limit / dist;
        return { x: map.center.x + dx * k, y: map.center.y + dy * k };
      }
      // also resolve walls if any
      const p = { x: px, y: py, vx: player.vx, vy: player.vy, radius: player.radius };
      if (map.walls && map.walls.length) {
        for (const w of map.walls) resolveCircleAABB(p, w);
      }
      return { x: p.x, y: p.y };
    }

    // square map: clamp to square bounds first
    const half = map.half || (map.size/2);
    const limit = half - player.radius - 1;
    let nx = Math.max(map.center.x - limit, Math.min(map.center.x + limit, px));
    let ny = Math.max(map.center.y - limit, Math.min(map.center.y + limit, py));

    // resolve walls: iterate and push out of walls
    const p = { x: nx, y: ny, vx: player.vx, vy: player.vy, radius: player.radius };
    if (map.walls && map.walls.length) {
      for (const w of map.walls) resolveCircleAABB(p, w);
    }
    // ensure still inside square after wall resolution
    nx = Math.max(map.center.x - limit, Math.min(map.center.x + limit, p.x));
    ny = Math.max(map.center.y - limit, Math.min(map.center.y + limit, p.y));
    return { x: nx, y: ny };
  }

  // Expose for debugging
  window.moborr = { startGame, connectToServer };

})();
