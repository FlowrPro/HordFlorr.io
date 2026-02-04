// Simple image preloader for skill icons.
// Usage:
//   import { preloadIcons, getSkillIcon } from './icons.js';
//   await preloadIcons(); // optional await - function returns a Promise
//   const img = getSkillIcon('warrior','slash'); // may be an HTMLImageElement or null

const ICON_BASE = 'assets/icons'; // adjust if you place icons elsewhere

// cache: map[className][type] -> { img, status:'loading'|'loaded'|'error' }
const cache = Object.create(null);

function makeKey(cls, type) {
  if (!cls || !type) return null;
  return `${cls}::${type}`;
}

export function preloadIcons(manifest = null) {
  // manifest: optional array of { class:'warrior', type:'slash' }
  // If omitted, we lazily preload on-get when asked.
  const toLoad = [];
  if (Array.isArray(manifest)) {
    for (const m of manifest) {
      if (!m || !m.class || !m.type) continue;
      const key = makeKey(m.class, m.type);
      if (!cache[key] || cache[key].status === 'error') toLoad.push({ cls: m.class, type: m.type });
    }
  }
  // If nothing to load (no manifest) return resolved Promise
  if (!toLoad.length) return Promise.resolve();

  const promises = toLoad.map(({ cls, type }) => {
    const key = makeKey(cls, type);
    if (cache[key] && cache[key].status === 'loaded') return Promise.resolve(cache[key].img);
    const img = new Image();
    img.src = `${ICON_BASE}/${encodeURIComponent(cls)}/${encodeURIComponent(type)}.png`;
    cache[key] = { img, status: 'loading' };
    return new Promise((resolve) => {
      img.onload = () => { cache[key].status = 'loaded'; resolve(img); };
      img.onerror = () => { cache[key].status = 'error'; resolve(null); };
    });
  });
  return Promise.all(promises);
}

export function getSkillIcon(cls, type) {
  const key = makeKey(cls, type);
  if (!key) return null;
  const entry = cache[key];
  if (entry && entry.status === 'loaded') return entry.img;
  // lazily start load if not started
  if (!entry) {
    const img = new Image();
    img.src = `${ICON_BASE}/${encodeURIComponent(cls)}/${encodeURIComponent(type)}.png`;
    cache[key] = { img, status: 'loading' };
    img.onload = () => { cache[key].status = 'loaded'; };
    img.onerror = () => { cache[key].status = 'error'; };
    return null;
  }
  return null;
}