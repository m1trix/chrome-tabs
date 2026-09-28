// Chrome/Edge tab groups only support these nine colors. Everywhere else in the
// extension a color is a hex string; custom hex colors are shown in our UI and
// snapped to the nearest native color for the browser's tab strip.
export const NATIVE_COLORS = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#188038',
  pink: '#d01884',
  purple: '#9334e6',
  cyan: '#007b83',
  orange: '#e8710a',
};

const NATIVE_HEXES = new Set(Object.values(NATIVE_COLORS));

export function isNativeHex(hex) {
  return NATIVE_HEXES.has(hex);
}

// Accepts "abc", "#abc" or "#aabbcc" and returns "#aabbcc", or null if invalid.
export function normalizeHex(value) {
  const m = String(value).trim().toLowerCase().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h}`;
}

function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function nearestNativeColor(hex) {
  const [r1, g1, b1] = toRgb(hex);
  let best = 'grey';
  let bestDist = Infinity;
  for (const [name, native] of Object.entries(NATIVE_COLORS)) {
    const [r2, g2, b2] = toRgb(native);
    // "Redmean" weighted distance: a cheap approximation of perceived difference.
    const rm = (r1 + r2) / 2;
    const d = (2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2;
    if (d < bestDist) {
      best = name;
      bestDist = d;
    }
  }
  return best;
}

// Stable color per key so the same domain always gets the same color.
export function colorForKey(key) {
  const hexes = Object.values(NATIVE_COLORS);
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return hexes[h % hexes.length];
}
