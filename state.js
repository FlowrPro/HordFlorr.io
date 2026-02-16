// Shared runtime state for the client. This mirrors the single shared globals from the original main.js
export const state = (function(){
  // --- CONFIG: set your server URL here ---
  const SERVER_URL = 'wss://hordflorr-io-backend.onrender.com'; // <-- your Render URL

  // --- World (client-side) ---
  const map = {
    type: 'circle', // 'circle' or 'square'; server welcome will set
    center: { x: 0, y: 0 },
    radius: 750,
    half: 750,
    size: 1500,
    walls: [] // walls may be rectangles ({x,y,w,h}) OR polygons ({points:[{x,y},...]})
  };

  // --- Player (local) ---
  const player = {
    id: null,
    x: 0, y: 0,
    radius: 28,
    color: '#ffd54a',
    baseSpeed: 380,
    vx: 0, vy: 0,
    facing: -Math.PI / 2,
    name: '',
    class: 'warrior',
    level: 1,
    xp: 0,
    maxHp: 200,
    hp: 200,
    nextLevelXp: 100,
    damageMul: 1.0,
    buffDurationMul: 1.0,
    serverX: null,
    serverY: null,
    localBuffs: [],
    stunnedUntil: 0,
    dead: false,
    awaitingRespawn: false,
    _baseMaxHp: 200,
    _baseBaseSpeed: 380,
    _baseBaseDamage: 18,
    kills: 0,
    deaths: 0
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
  const remoteMobs = new Map();

  // --- Remote projectiles (client-side) ---
  const remoteProjectiles = new Map();

  // --- Client-side visual effects ---
  const remoteEffects = [];

  // --- Input state ---
  const keys = {};
  let pointer = { x: 0, y: 0 };
  let mouseWorld = { x: 0, y: 0 };
  let clickTarget = null;

  // selected target for target skills: { id, kind: 'mob'|'player' }
  let selectedTarget = null;

  // --- Hotbar & XP UI config ---
  const HOTBAR_SLOTS = 4;
  const CLASS_SKILLS = {
    warrior: ['Slash', 'Shield Bash', 'Charge', 'Rage'],
    ranger:  ['Shot', 'Rapid Fire', 'Trap', 'Snipe'],
    mage:    ['Spark', 'Fireball', 'Frost Nova', 'Arcane Blast']
  };
  const CLASS_COOLDOWNS = {
    warrior: [3.5, 7.0, 10.0, 25.0],
    ranger:  [2.0, 25.0, 12.0, 4.0],
    mage:    [2.5, 5.0, 25.0, 10.0]
  };
  const cooldowns = new Array(HOTBAR_SLOTS).fill(0);

  // --- Client-side skill meta ---
  const SKILL_META = {
    warrior: [
      { name: 'Slash', type: 'slash', kind: 'melee', damage: 60, range: 48, cooldown: 3.5, color: 'rgba(255,160,80,0.9)' },
      { name: 'Shield Bash', type: 'shieldbash', kind: 'aoe_stun', damage: 40, radius: 48, stunMs: 3000, cooldown: 7.0, color: 'rgba(200,200,255,0.9)' },
      { name: 'Charge', type: 'charge', kind: 'aoe', damage: 10, radius: 80, buff: { type: 'speed', multiplier: 1.5, durationMs: 5000 }, cooldown: 10.0, color: 'rgba(180,240,120,0.9)' },
      { name: 'Rage', type: 'rage', kind: 'buff', buff: { type: 'damage', multiplier: 1.15, durationMs: 10000 }, cooldown: 25.0, color: 'rgba(255,80,60,0.9)' }
    ],
    ranger: [
      { name: 'Shot', type: 'arrow', kind: 'proj_target', damage: 40, radius: 6, speed: 680, cooldown: 2.0, color: 'rgba(255,215,90,0.95)' },
      { name: 'Rapid Fire', type: 'rapid', kind: 'proj_burst', damage: 20, speed: 720, radius: 5, count: 5, cooldown: 25.0, color: 'rgba(255,200,70,0.95)' },
      { name: 'Trap', type: 'trap', kind: 'proj_target_stun', damage: 12, speed: 380, radius: 8, stunMs: 3000, cooldown: 12.0, color: 'rgba(180,180,180,0.95)' },
      { name: 'Snipe', type: 'snipe', kind: 'proj_target', damage: 120, radius: 7, speed: 880, cooldown: 4.0, color: 'rgba(255,240,200,0.98)' }
    ],
    mage: [
      { name: 'Spark', type: 'spark', kind: 'proj_target', damage: 45, radius: 10, speed: 420, cooldown: 2.5, color: 'rgba(160,220,255,0.95)' },
      { name: 'Fireball', type: 'fireball', kind: 'proj_target', damage: 135, radius: 10, speed: 360, cooldown: 5.0, color: 'rgba(255,110,80,0.95)' },
      { name: 'Frost Nova', type: 'frostnova', kind: 'proj_target_stun', damage: 60, stunMs: 3000, cooldown: 25.0, color: 'rgba(140,220,255,0.9)' },
      { name: 'Arcane Blast', type: 'arcane', kind: 'proj_aoe_spread', damage: 45, radius: 12, speed: 520, count: 6, spreadDeg: 45, cooldown: 10.0, color: 'rgba(220,150,255,0.95)' }
    ]
  };

  const SKILL_ICONS = {
    slash: '🗡️',
    shieldbash: '🛡️',
    charge: '⚡',
    rage: '🔥',
    arrow: '➶',
    rapid: '🔁',
    trap: '🪤',
    snipe: '🎯',
    spark: '✨',
    fireball: '💥',
    frostnova: '❄️',
    arcane: '🔮'
  };

  // --- Settings persistence ---
  const defaultSettings = {
    mouseMovement: false,
    keyboardMovement: true,
    clickMovement: false,
    graphicsQuality: 'medium',
    showCoordinates: true
  };
  let settings = null;

  // --- Inventory config and storage ---
  const INV_SLOTS = 16;
  const inventory = new Array(INV_SLOTS).fill(null);

  // --- Equipment (5 slots) ---
  const EQUIP_SLOTS = 5;
  const equipment = new Array(EQUIP_SLOTS).fill(null);

  // --- NETWORK ---
  let ws = null;
  let sendInputInterval = null;
  let seq = 0;

  // loading/connection lifecycle
  let isLoading = false;
  let loadingTimeout = null;
  let welcomeReceived = false;
  let gotFirstSnapshot = false;

  // --- MATCHMAKING STATE ---
  let gameMode = null; // 'ffa', etc.
  let gameState = 'title'; // 'title', 'mode_select', 'queue', 'countdown', 'in_game'
  let matchId = null;
  let matchCountdownMs = 0;
  let matchTimeRemainingMs = 0;
  let matchStartTime = null;
  let matchLeaderboard = [];
  let currentPlayerKills = 0;
  let queuePlayers = [];

  // --- Chat (non-persistent) ---
  const CHAT_MAX = 50;
  const pendingChatIds = new Map();
  let chatFocused = false;

  // --- Equipment helpers ---
  function applyEquipmentBonuses() {
    if (typeof player._baseMaxHp !== 'number') player._baseMaxHp = player.maxHp || 200;
    if (typeof player._baseBaseSpeed !== 'number') player._baseBaseSpeed = player.baseSpeed || 380;
    if (typeof player._baseBaseDamage !== 'number') player._baseBaseDamage = player.baseDamage || 18;

    const bonus = {
      maxHp: 0,
      baseDamage: 0,
      baseSpeed: 0,
      damageMul: 0,
      buffDurationMul: 0
    };
    for (const it of equipment) {
      if (!it || !it.stats) continue;
      const s = it.stats;
      if (typeof s.maxHp === 'number') bonus.maxHp += s.maxHp;
      if (typeof s.baseDamage === 'number') bonus.baseDamage += s.baseDamage;
      if (typeof s.baseSpeed === 'number') bonus.baseSpeed += s.baseSpeed;
      if (typeof s.damageMul === 'number') bonus.damageMul += s.damageMul;
      if (typeof s.buffDurationMul === 'number') bonus.buffDurationMul += s.buffDurationMul;
    }

    const prevMax = player.maxHp || player._baseMaxHp;
    player.maxHp = Math.max(1, Math.round((player._baseMaxHp || 200) + bonus.maxHp));
    const delta = player.maxHp - prevMax;
    if (delta > 0) {
      player.hp = Math.min(player.maxHp, (player.hp || prevMax) + delta);
    } else {
      player.hp = Math.min(player.hp || player.maxHp, player.maxHp);
    }

    player.baseDamage = Math.max(0, (player._baseBaseDamage || 18) + bonus.baseDamage);
    player.baseSpeed = Math.max(1, (player._baseBaseSpeed || 380) + bonus.baseSpeed);
    player.damageMul = Math.max(0, 1 + bonus.damageMul);
    player.buffDurationMul = Math.max(0, 1 + bonus.buffDurationMul);
  }

  function equipItem(slotIndex, item) {
    if (typeof slotIndex !== 'number' || slotIndex < 0 || slotIndex >= equipment.length) return false;
    equipment[slotIndex] = item ? JSON.parse(JSON.stringify(item)) : null;
    applyEquipmentBonuses();
    return true;
  }

  function unequipItem(slotIndex) {
    if (typeof slotIndex !== 'number' || slotIndex < 0 || slotIndex >= equipment.length) return false;
    equipment[slotIndex] = null;
    applyEquipmentBonuses();
    return true;
  }

  return {
    SERVER_URL,
    map,
    player,
    MOVE_ACCEL,
    TURN_SPEED,
    MIN_MOVEMENT_FOR_FACING,
    RECONCILE_SPEED,
    REMOTE_INTERP_SPEED,
    remotePlayers,
    remoteMobs,
    remoteProjectiles,
    remoteEffects,
    keys,
    pointer,
    mouseWorld,
    clickTarget,
    selectedTarget,
    HOTBAR_SLOTS,
    CLASS_SKILLS,
    CLASS_COOLDOWNS,
    cooldowns,
    SKILL_META,
    SKILL_ICONS,
    defaultSettings,
    settings,
    INV_SLOTS,
    inventory,
    EQUIP_SLOTS,
    equipment,
    equipItem,
    unequipItem,
    applyEquipmentBonuses,
    ws,
    sendInputInterval,
    seq,
    isLoading,
    loadingTimeout,
    welcomeReceived,
    gotFirstSnapshot,
    gameMode,
    gameState,
    matchId,
    matchCountdownMs,
    matchTimeRemainingMs,
    matchStartTime,
    matchLeaderboard,
    currentPlayerKills,
    queuePlayers,
    CHAT_MAX,
    pendingChatIds,
    chatFocused,
    dom: {}
  };
})();
