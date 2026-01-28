// Large circular map with a player (circle with eyes and smile).
// Controls: WASD or arrow keys. Player clamped inside the map.
// Camera centers on the player.

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Resize canvas to window device pixel ratio aware
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // keep drawing units in CSS pixels
  }
  window.addEventListener('resize', resize);
  resize();

  // World / map settings
  const map = {
    radius: 3000, // pretty big circular map
    center: { x: 0, y: 0 }
  };

  // Player
  const player = {
    x: 0,
    y: 0,
    radius: 28,
    color: '#1e90ff',
    speed: 380, // px per second
    vx: 0,
    vy: 0,
  };

  // Input
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    // prevent scroll with arrows
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  // Utility
  function clampToCircle(px, py) {
    const dx = px - map.center.x;
    const dy = py - map.center.y;
    const dist = Math.hypot(dx, dy);
    const limit = map.radius - player.radius - 1; // keep player inside boundary
    if (dist > limit) {
      const k = limit / dist;
      return { x: map.center.x + dx * k, y: map.center.y + dy * k };
    }
    return { x: px, y: py };
  }

  // Determine facing angle from movement vector for eyes/smile orientation
  function movementAngle() {
    const speed = Math.hypot(player.vx, player.vy);
    if (speed < 1e-3) return -Math.PI / 2; // default up
    return Math.atan2(player.vy, player.vx);
  }

  // Draw background "terrain" and decorations visible in the viewport
  function drawBackground(screenCenterX, screenCenterY) {
    // Draw the main circular map
    ctx.save();
    ctx.beginPath();
    ctx.arc(screenCenterX, screenCenterY, map.radius, 0, Math.PI * 2);
    // inner gradient for map
    const g = ctx.createRadialGradient(
      screenCenterX - map.radius * 0.2, screenCenterY - map.radius * 0.2, map.radius * 0.05,
      screenCenterX, screenCenterY, map.radius
    );
    g.addColorStop(0, '#9fe69f');
    g.addColorStop(1, '#5fb35f');
    ctx.fillStyle = g;
    ctx.fill();
    // boundary
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#2a6b2a';
    ctx.stroke();
    ctx.restore();

    // Draw subtle concentric rings for scale
    ctx.save();
    ctx.translate(screenCenterX, screenCenterY);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    const rings = 8;
    for (let i = 1; i <= rings; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, (map.radius / rings) * i, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Draw some "landmarks" (trees/rocks) using a deterministic pseudo-random generator
    // so they appear consistent while moving.
    const seed = 1337;
    function pseudo(x, y) {
      // simple hash -> 0..1
      const s = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453;
      return s - Math.floor(s);
    }
    // compute viewport bounds in world coords
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    const left = player.x - vw / 2;
    const top = player.y - vh / 2;
    const cols = Math.ceil(vw / 200) + 4;
    const rows = Math.ceil(vh / 200) + 4;
    for (let gx = 0; gx < cols; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        const wx = Math.floor((left + gx * 200) / 200) * 200 + 100;
        const wy = Math.floor((top + gy * 200) / 200) * 200 + 100;
        const p = pseudo(wx, wy);
        if (p > 0.85) {
          // draw tree/rock at (wx, wy) if inside circular map
          const distToCenter = Math.hypot(wx - map.center.x, wy - map.center.y);
          if (distToCenter < map.radius - 20) {
            const sx = vw / 2 + (wx - player.x);
            const sy = vh / 2 + (wy - player.y);
            // small dark shadow
            ctx.beginPath();
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.ellipse(sx + 6, sy + 12, 12, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            // trunk / rock
            if (p > 0.92) {
              // rock
              ctx.beginPath();
              ctx.fillStyle = '#6a5f4a';
              ctx.ellipse(sx, sy, 10 + (p - 0.92) * 80, 7, 0, 0, Math.PI * 2);
              ctx.fill();
            } else {
              // tree
              ctx.beginPath();
              ctx.fillStyle = '#6a3';
              ctx.ellipse(sx, sy - 8, 16, 12, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.beginPath();
              ctx.fillStyle = '#7b4a2a';
              ctx.fillRect(sx - 2, sy - 2, 4, 8);
            }
          }
        }
      }
    }
  }

  // Draw the player as a circle with eyes and smile
  function drawPlayer(screenX, screenY, angle) {
    // body
    ctx.save();
    ctx.beginPath();
    ctx.arc(screenX, screenY, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();

    // subtle rim shine
    const shine = ctx.createLinearGradient(screenX - player.radius, screenY - player.radius, screenX + player.radius, screenY + player.radius);
    shine.addColorStop(0, 'rgba(255,255,255,0.12)');
    shine.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(screenX, screenY, player.radius, 0, Math.PI * 2);
    ctx.fill();

    // eyes (relative to facing direction)
    const eyeOffsetAngle = Math.PI / 6; // angle between facing and each eye offset
    const eyeDistance = player.radius * 0.5;
    const eyeRadius = Math.max(3, Math.floor(player.radius * 0.15));
    const leftEyeAngle = angle - eyeOffsetAngle;
    const rightEyeAngle = angle + eyeOffsetAngle;
    const leftEyeX = screenX + Math.cos(leftEyeAngle) * eyeDistance;
    const leftEyeY = screenY + Math.sin(leftEyeAngle) * eyeDistance;
    const rightEyeX = screenX + Math.cos(rightEyeAngle) * eyeDistance;
    const rightEyeY = screenY + Math.sin(rightEyeAngle) * eyeDistance;

    // eye whites
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(leftEyeX, leftEyeY, eyeRadius, 0, Math.PI * 2);
    ctx.arc(rightEyeX, rightEyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    // pupils (slightly toward facing direction)
    const pupilOffset = eyeRadius * 0.35;
    ctx.beginPath();
    ctx.fillStyle = '#000';
    ctx.arc(leftEyeX + Math.cos(angle) * pupilOffset, leftEyeY + Math.sin(angle) * pupilOffset, Math.max(1.5, eyeRadius * 0.45), 0, Math.PI * 2);
    ctx.arc(rightEyeX + Math.cos(angle) * pupilOffset, rightEyeY + Math.sin(angle) * pupilOffset, Math.max(1.5, eyeRadius * 0.45), 0, Math.PI * 2);
    ctx.fill();

    // smile (arc)
    const smileRadius = player.radius * 0.6;
    const smileAngleWidth = Math.PI * 0.6;
    // tilt smile consistent with facing (slight rotation)
    const smileAngle = angle + Math.PI / 2; // below center relative to facing
    const start = smileAngle - smileAngleWidth / 2;
    const end = smileAngle + smileAngleWidth / 2;
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, player.radius * 0.12);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.arc(screenX, screenY, smileRadius, start, end);
    ctx.stroke();

    ctx.restore();
  }

  // Main loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // input -> velocity
    let ax = 0, ay = 0;
    if (keys['arrowup'] || keys['w']) ay -= 1;
    if (keys['arrowdown'] || keys['s']) ay += 1;
    if (keys['arrowleft'] || keys['a']) ax -= 1;
    if (keys['arrowright'] || keys['d']) ax += 1;

    // Normalize input direction to keep diagonal speed consistent
    if (ax !== 0 || ay !== 0) {
      const len = Math.hypot(ax, ay);
      ax /= len; ay /= len;
      player.vx = ax * player.speed;
      player.vy = ay * player.speed;
    } else {
      // gradual stop (friction)
      player.vx *= 0.82;
      player.vy *= 0.82;
      if (Math.abs(player.vx) < 0.5) player.vx = 0;
      if (Math.abs(player.vy) < 0.5) player.vy = 0;
    }

    // integrate
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // clamp to circular map
    const clamped = clampToCircle(player.x, player.y);
    player.x = clamped.x;
    player.y = clamped.y;

    // clear
    const vw = canvas.width / (window.devicePixelRatio || 1);
    const vh = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, vw, vh);

    // screen coordinates of world center relative to player (so player is centered)
    const screenCenterX = vw / 2 - map.center.x + (0); // map.center.x usually 0
    const screenCenterY = vh / 2 - map.center.y + (0);

    // draw background & decorations
    drawBackground(screenCenterX, screenCenterY);

    // draw boundary marker (optional direction marker on outer edge near player)
    // (not necessary - commented out)
    // drawPlayer center
    const playerScreenX = vw / 2;
    const playerScreenY = vh / 2;
    const angle = movementAngle();
    drawPlayer(playerScreenX, playerScreenY, angle);

    // HUD: show coords
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(12, 12, 190, 36);
    ctx.fillStyle = '#fff';
    ctx.font = '14px system-ui, Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText(`x: ${Math.round(player.x)}, y: ${Math.round(player.y)}`, 20, 30);
    ctx.restore();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
