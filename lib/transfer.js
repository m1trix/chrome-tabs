import { NATIVE_COLORS, normalizeHex } from './colors.js';

// Export/import of a single group as JSON. A file looks like:
// { "format": "tab-groups-plus/group", "version": 1, "exportedAt": "…",
//   "group": { "title": "Work", "color": "#1a73e8", "tabs": [{ "url": "…", "title": "…" }] } }
const FORMAT = 'tab-groups-plus/group';

const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

export function exportFilename(entry) {
  const base = entry.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-');
  return `${base || 'tab-group'}.json`;
}

export function toJson(entry) {
  const tabs = entry.tabs.map(({ url, title, favIconUrl }) => ({ url, title, ...(isWebUrl(favIconUrl) && { favIconUrl }) }));
  const data = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    group: { title: entry.title, color: entry.color, tabs },
  };
  return JSON.stringify(data, null, 2);
}

// Downloads through chrome.downloads: a plain <a download> in the popup can be cut
// off when the popup closes (e.g. when the browser asks where to save).
export async function downloadGroup(entry) {
  await chrome.downloads.download({
    url: `data:application/json;charset=utf-8,${encodeURIComponent(toJson(entry))}`,
    filename: exportFilename(entry),
  });
}

// Parses an exported file into a saved-group entry. Throws an Error with a
// user-facing message if the file isn't a usable group.
export function fromJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file');
  }
  // Accept our export format, or a bare { title, color, tabs } object.
  const group = data?.format === FORMAT ? data.group : data;
  if (!group || !Array.isArray(group.tabs)) throw new Error('Not a tab group export');

  const tabs = group.tabs
    .filter((t) => typeof t?.url === 'string' && isOpenable(t.url))
    .map((t) => ({
      url: t.url,
      title: typeof t.title === 'string' && t.title ? t.title : t.url,
      favIconUrl: isWebUrl(t.favIconUrl) ? t.favIconUrl : undefined,
    }));
  if (!tabs.length) throw new Error('The group has no tabs that can be opened');

  return {
    id: crypto.randomUUID(),
    title: typeof group.title === 'string' && group.title.trim() ? group.title.trim() : 'Imported group',
    color: (typeof group.color === 'string' && normalizeHex(group.color)) || NATIVE_COLORS.grey,
    savedAt: Date.now(),
    tabs,
  };
}

// Files come from anywhere, so refuse URLs that would run code instead of loading a page.
function isOpenable(url) {
  try {
    return !['javascript:', 'data:', 'blob:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
