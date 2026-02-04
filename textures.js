// Simple texture preloader that returns CanvasPattern objects (repeat).
// Usage:
//   import { preloadTextures, getTexturePattern } from './textures.js';
//   await preloadTextures([{ name:'rocks011', src:'assets/textures/walls/Rocks011_1k-PNG_Color.png' }]);
//   const pat = getTexturePattern('rocks011', ctx); // CanvasPattern or null

const cache = Object.create(null);
const patternCache = Object.create(null);

// manifest srcs should be relative to the web root (index.html)
export function preloadTextures(manifest = []) {
  // manifest: [{ name:'rocks011', src:'assets/textures/walls/Rocks011_1k-PNG_Color.png' }, ...]
  const promises = [];
  for (const item of manifest || []) {
    if (!item || !item.name || !item.src) continue;
    if (cache[item.name] && cache[item.name].status === 'loaded') continue;
    const img = new Image();
    img.src = item.src;
    cache[item.name] = { img, status: 'loading', src: item.src };
    promises.push(new Promise((resolve) => {
      img.onload = () => { cache[item.name].status = 'loaded'; resolve(img); };
      img.onerror = () => {
        cache[item.name].status = 'error';
        console.warn('texture load error:', item.src);
        resolve(null);
      };
    }));
  }
  return Promise.all(promises);
}

export function getTexturePattern(name, ctx) {
  // Returns a CanvasPattern for the given texture name, or null if not available.
  // ctx must be a 2D canvas context (we use the game's dom.ctx).
  if (!name || !ctx) return null;
  if (patternCache[name]) return patternCache[name];
  const entry = cache[name];
  if (!entry || entry.status !== 'loaded') return null;
  try {
    const pat = ctx.createPattern(entry.img, 'repeat');
    patternCache[name] = pat;
    return pat;
  } catch (e) {
    console.warn('createPattern failed for', name, e);
    return null;
  }
}