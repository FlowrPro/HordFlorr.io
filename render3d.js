// 3D renderer using Three.js (loaded via import map). Uses existing <canvas id="game"> for WebGL
// and the HUD <canvas id="hud"> (available as dom.ctx) for overlay drawing.
//
// - No npm required: Three.js is loaded from the CDN via an import map in index.html.
// - Provides basic camera (orbit-like) controls, ground plane hit-testing (raycast -> screenToWorld),
//   and simple mesh syncing for players, mobs, projectiles, and walls.
//
// This is an initial implementation focusing on functionality: camera drag/rotate/pan/zoom,
// mapping server (x,y) => client (x, 0, z), and keeping meshes in sync with `state`.
// HUD and fancy visuals can be built incrementally after this foundation.

import { state } from './state.js';
import dom from './dom.js';

// Use bare imports; the browser will resolve them through the import map in index.html
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let raycaster = null;
let groundPlane = null;

const meshes = {
  players: new Map(),       // id -> mesh
  mobs: new Map(),
  projectiles: new Map(),
  walls: new Map()
};

let wallsBuilt = false;

function ensureRenderer() {
  if (renderer) return;
  const canvas = dom.canvas;
  // Create WebGL renderer using existing canvas
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7fbfdf); // light sky

  // Camera: top-ish perspective like Hordes.io: pitched down, orbitable around player
  const fov = 50;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera = new THREE.PerspectiveCamera(fov, aspect, 10, 100000);
  camera.position.set(0, 1200, 1200);
  camera.lookAt(0, 0, 0);

  // Controls (OrbitControls) - map left drag -> rotate, right drag -> pan
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 200;
  controls.maxDistance = 3000;
  controls.maxPolarAngle = Math.PI / 2.15; // limit pitch (no flip)
  controls.minPolarAngle = Math.PI / 6;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  controls.screenSpacePanning = false;

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(300, 800, 400);
  dir.castShadow = false;
  scene.add(dir);

  // Ground (large plane)
  const groundGeo = new THREE.PlaneGeometry(100000, 100000);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x6fbf6f });
  groundPlane = new THREE.Mesh(groundGeo, groundMat);
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.receiveShadow = true;
  groundPlane.position.y = 0;
  scene.add(groundPlane);

  // helper grid lightly
  const grid = new THREE.GridHelper(5000, 50, 0x2a6b2a, 0x2a6b2a);
  grid.material.opacity = 0.12;
  grid.material.transparent = true;
  grid.position.y = 0.1;
  scene.add(grid);

  // Raycaster for screen->world mapping
  raycaster = new THREE.Raycaster();

  // Resize handling
  window.addEventListener('resize', onWindowResize);
  onWindowResize();
}

function onWindowResize() {
  if (!renderer || !camera) return;
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  camera.aspect = W / Math.max(1, H);
  camera.updateProjectionMatrix();

  // HUD canvas sizing & transform (dom.ctx)
  if (dom.hudCanvas && dom.ctx) {
    dom.hudCanvas.width = Math.floor(W * dpr);
    dom.hudCanvas.height = Math.floor(H * dpr);
    dom.hudCanvas.style.width = `${W}px`;
    dom.hudCanvas.style.height = `${H}px`;
    // set transform so drawing can use CSS pixel coordinates
    dom.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

// Map server (x,y) coordinates to three.js world position (Vector3)
// Server uses (x, y) as flat coordinates. We'll map: world.x = x, world.y = 0, world.z = y
function worldPosFromServer(x, y) {
  return new THREE.Vector3(x, 0, y);
}

function ensurePlayerMesh(id, color = '#ffd54a', radius = 28) {
  if (meshes.players.has(id)) return meshes.players.get(id);
  const geo = new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, radius * 1.4, 12);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = false;
  // slightly raise above ground
  m.position.y = radius * 0.7;
  scene.add(m);
  meshes.players.set(id, m);
  return m;
}

function ensureMobMesh(id, color = '#9c9c9c', radius = 18) {
  if (meshes.mobs.has(id)) return meshes.mobs.get(id);
  const geo = new THREE.SphereGeometry(radius * 0.9, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.02 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.position.y = radius * 0.6;
  scene.add(m);
  meshes.mobs.set(id, m);
  return m;
}

function ensureProjectileMesh(id, color = '#ff9f4d', radius = 6) {
  if (meshes.projectiles.has(id)) return meshes.projectiles.get(id);
  const geo = new THREE.SphereGeometry(Math.max(2, radius * 0.6), 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 6;
  scene.add(m);
  meshes.projectiles.set(id, m);
  return m;
}

function buildWallsIfNeeded() {
  if (wallsBuilt) return;
  const walls = state.map.walls || [];
  if (!walls || !walls.length) return;
  // remove leftovers
  for (const wm of meshes.walls.values()) {
    scene.remove(wm);
  }
  meshes.walls.clear();

  for (const w of walls) {
    if (w.points && Array.isArray(w.points) && w.points.length >= 3) {
      // create an extruded polygon
      const shape = new THREE.Shape();
      for (let i = 0; i < w.points.length; i++) {
        const p = w.points[i];
        if (i === 0) shape.moveTo(p.x, p.y);
        else shape.lineTo(p.x, p.y);
      }
      shape.closePath();
      const extrudeSettings = { depth: 120, bevelEnabled: false, steps: 1 };
      const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      // rotate so polygon X/Z correspond to server X/Y
      geom.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b4f3b, roughness: 0.8 });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = 0; // sits on ground
      mesh.receiveShadow = true;
      scene.add(mesh);
      meshes.walls.set(w.id || ('wall_poly_' + Math.random().toString(36).slice(2,6)), mesh);
    } else if (typeof w.x === 'number' && typeof w.w === 'number') {
      const box = new THREE.BoxGeometry(w.w, 120, w.h);
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b4f3b });
      const m = new THREE.Mesh(box, mat);
      m.position.set(w.x + w.w / 2, 60, w.y + w.h / 2);
      m.receiveShadow = true;
      scene.add(m);
      meshes.walls.set(w.id || ('wall_box_' + Math.random().toString(36).slice(2,6)), m);
    }
  }
  wallsBuilt = true;
}

// Update or remove meshes based on state maps
function syncEntities(dt) {
  // Players
  for (const [id, data] of state.remotePlayers.entries()) {
    const mesh = ensurePlayerMesh(id, data.color || '#ff7', data.radius || 28);
    // simple linear interpolation displayed via position lerp
    const target = worldPosFromServer(data.targetX != null ? data.targetX : data.x, data.targetY != null ? data.targetY : data.y);
    mesh.position.x += (target.x - mesh.position.x) * Math.min(1, dt * 12);
    mesh.position.z += (target.z - mesh.position.z) * Math.min(1, dt * 12);
  }
  // local player (ensure presence)
  if (state.player && state.player.id != null) {
    const id = state.player.id;
    const mesh = ensurePlayerMesh(id, state.player.color || '#ffd54a', state.player.radius || 28);
    const target = worldPosFromServer(state.player.x, state.player.y);
    mesh.position.x += (target.x - mesh.position.x) * Math.min(1, dt * 18);
    mesh.position.z += (target.z - mesh.position.z) * Math.min(1, dt * 18);
  }

  // Mobs
  for (const [id, m] of state.remoteMobs.entries()) {
    if (m.dead && (!m.displayX && !m.targetX)) {
      // keep until server prunes
    }
    const mesh = ensureMobMesh(id, m.color || '#9c9c9c', m.radius || 18);
    const tx = (m.targetX != null ? m.targetX : m.x);
    const tz = (m.targetY != null ? m.targetY : m.y);
    mesh.position.x += (tx - mesh.position.x) * Math.min(1, dt * 12);
    mesh.position.z += (tz - mesh.position.z) * Math.min(1, dt * 12);
    // fade out dead mobs by scaling down and then remove when very small
    if (m.dead) {
      mesh.scale.x = mesh.scale.y = mesh.scale.z = Math.max(0.001, (m.alpha || 1.0));
    } else {
      mesh.scale.x = mesh.scale.y = mesh.scale.z = 1.0;
    }
  }

  // Projectiles
  for (const [id, p] of state.remoteProjectiles.entries()) {
    const mesh = ensureProjectileMesh(id, (p.type === 'fireball' ? 0xff6b6b : p.type === 'frost' ? 0x8fe3ff : 0xff9f4d), p.radius || 6);
    const tx = (p.targetX != null ? p.targetX : p.x);
    const tz = (p.targetY != null ? p.targetY : p.y);
    mesh.position.x += (tx - mesh.position.x) * Math.min(1, dt * 20);
    mesh.position.z += (tz - mesh.position.z) * Math.min(1, dt * 20);
  }

  // clean up removed players/mobs/projectiles
  // players
  for (const key of Array.from(meshes.players.keys())) {
    if (key === state.player.id) continue;
    if (!state.remotePlayers.has(key)) {
      const m = meshes.players.get(key);
      scene.remove(m);
      meshes.players.delete(key);
    }
  }
  // mobs
  for (const key of Array.from(meshes.mobs.keys())) {
    if (!state.remoteMobs.has(key)) {
      const m = meshes.mobs.get(key);
      scene.remove(m);
      meshes.mobs.delete(key);
    }
  }
  // projectiles
  for (const key of Array.from(meshes.projectiles.keys())) {
    if (!state.remoteProjectiles.has(key)) {
      const m = meshes.projectiles.get(key);
      scene.remove(m);
      meshes.projectiles.delete(key);
    }
  }
}

let lastTime = performance.now();
export function startLoop() {
  ensureRenderer();
  // ensure HUD canvas transform sized properly on start
  onWindowResize();

  function animate(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // Build walls once we have snapshot walls
    if (!wallsBuilt && Array.isArray(state.map.walls) && state.map.walls.length) buildWallsIfNeeded();

    // Camera target: follow player position smoothly
    if (state.player && state.player.x != null) {
      const playerPos = worldPosFromServer(state.player.x, state.player.y);
      // set controls target to player's position on ground
      controls.target.lerp(playerPos, Math.min(1, dt * 8));
    }

    controls.update();

    // sync meshes positions to state
    syncEntities(dt);

    // render 3D scene
    renderer.render(scene, camera);

    // (Optional) draw minimal HUD placeholder on top using dom.ctx (2D)
    // We'll clear the HUD canvas here — more advanced HUD rendering can be migrated from the old 2D renderer.
    if (dom.ctx) {
      const vw = dom.hudCanvas ? dom.hudCanvas.width / (window.devicePixelRatio || 1) : window.innerWidth;
      const vh = dom.hudCanvas ? dom.hudCanvas.height / (window.devicePixelRatio || 1) : window.innerHeight;
      dom.ctx.clearRect(0, 0, vw, vh);
      // minimal UI: show player name & simple crosshair at center
      dom.ctx.save();
      dom.ctx.font = 'bold 14px system-ui, Arial';
      dom.ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const name = (state.player && state.player.name) ? state.player.name : '';
      dom.ctx.fillText(name, 10, 22);
      dom.ctx.fillStyle = '#fff';
      dom.ctx.fillText(name, 9, 21);

      // center crosshair
      dom.ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      dom.ctx.lineWidth = 2;
      dom.ctx.beginPath();
      dom.ctx.moveTo(vw/2 - 8, vh/2);
      dom.ctx.lineTo(vw/2 + 8, vh/2);
      dom.ctx.moveTo(vw/2, vh/2 - 8);
      dom.ctx.lineTo(vw/2, vh/2 + 8);
      dom.ctx.stroke();
      dom.ctx.restore();
    }

    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// Convert screen coordinates (clientX, clientY) to server-world flat coordinates { x, y }
// Returns null if no intersection found.
export function screenToWorld(clientX, clientY) {
  ensureRenderer();
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x, y }, camera);
  const intersects = raycaster.intersectObject(groundPlane, true);
  if (intersects && intersects.length) {
    const p = intersects[0].point;
    return { x: p.x, y: p.z }; // map three.js z -> server y
  }
  return null;
}

// Expose helpers for other modules (input uses screenToWorld)
export default {
  startLoop,
  screenToWorld
};
