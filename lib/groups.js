import { NATIVE_COLORS, isNativeHex, nearestNativeColor } from './colors.js';
import * as store from './storage.js';

export function groupHex(group, customColors) {
  return customColors[group.id] ?? NATIVE_COLORS[group.color];
}

export async function setGroupColor(groupId, hex) {
  await chrome.tabGroups.update(groupId, { color: nearestNativeColor(hex) });
  await store.setCustomColor(groupId, isNativeHex(hex) ? null : hex);
}

export async function createGroup(tabIds, { title = '', color, windowId }) {
  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { title });
  if (color) await setGroupColor(groupId, color);
  return groupId;
}

// Merges same-named groups into the leftmost one, then closes duplicate tabs (same URL)
// across the window. Returns how many groups were merged away and tabs were closed.
export async function deduplicate(windowId) {
  const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
  const byIndex = (a, b) => a.index - b.index;

  let tabs = (await chrome.tabs.query({ windowId })).sort(byIndex);
  const liveGroups = await chrome.tabGroups.query({ windowId });
  const firstIndex = new Map();
  for (const t of tabs) if (t.groupId !== NONE && !firstIndex.has(t.groupId)) firstIndex.set(t.groupId, t.index);
  liveGroups.sort((a, b) => firstIndex.get(a.id) - firstIndex.get(b.id));

  const byName = new Map();
  let merged = 0;
  for (const g of liveGroups) {
    const name = (g.title ?? '').trim().toLowerCase();
    if (!name) continue; // untitled groups have no name to match on
    const target = byName.get(name);
    if (!target) {
      byName.set(name, g.id);
      continue;
    }
    await chrome.tabs.group({ groupId: target, tabIds: tabs.filter((t) => t.groupId === g.id).map((t) => t.id) });
    merged++;
  }

  // Keep the best copy of each URL: active, then pinned, then grouped, then leftmost.
  if (merged) tabs = (await chrome.tabs.query({ windowId })).sort(byIndex);
  const rank = (t) => (t.active ? 4 : 0) + (t.pinned ? 2 : 0) + (t.groupId !== NONE ? 1 : 0);
  const keepers = new Map();
  for (const t of tabs) {
    const url = t.url || t.pendingUrl;
    const kept = keepers.get(url);
    if (!kept || rank(t) > rank(kept)) keepers.set(url, t);
  }
  const keep = new Set([...keepers.values()].map((t) => t.id));
  const duplicates = tabs.filter((t) => !keep.has(t.id) && !t.pinned).map((t) => t.id);
  if (duplicates.length) await chrome.tabs.remove(duplicates);

  return { merged, closed: duplicates.length };
}

// A live group in the same shape as a saved group entry.
export async function snapshotLiveGroup(groupId) {
  const [group, tabs, custom] = await Promise.all([
    chrome.tabGroups.get(groupId),
    chrome.tabs.query({ groupId }),
    store.getCustomColors(),
  ]);
  tabs.sort((a, b) => a.index - b.index);
  const entry = {
    id: crypto.randomUUID(),
    title: group.title || 'Untitled group',
    color: groupHex(group, custom),
    savedAt: Date.now(),
    tabs: tabs.map((t) => ({ url: t.url || t.pendingUrl, title: t.title, favIconUrl: t.favIconUrl })),
  };
  return { group, tabs, entry };
}

export async function saveLiveGroup(groupId, { close = false } = {}) {
  const { group, tabs, entry } = await snapshotLiveGroup(groupId);
  await store.addSavedGroup(entry);

  if (close) {
    // Closing every tab would close the window, so leave a fresh tab behind.
    const windowTabs = await chrome.tabs.query({ windowId: group.windowId });
    if (windowTabs.length === tabs.length) await chrome.tabs.create({ windowId: group.windowId });
    await chrome.tabs.remove(tabs.map((t) => t.id));
  }
  return entry;
}

// Edge names its internal pages edge://…, Chrome chrome://…. Groups can move between the two
// browsers via export/import, so internal URLs are switched to this browser's scheme on restore.
const IS_EDGE = /\bEdg\//.test(navigator.userAgent);

export function urlForThisBrowser(url) {
  return IS_EDGE ? url.replace(/^chrome:\/\//i, 'edge://') : url.replace(/^edge:\/\//i, 'chrome://');
}

export async function restoreSavedGroup(entry, windowId) {
  const tabIds = [];
  for (const t of entry.tabs) {
    try {
      const tab = await chrome.tabs.create({ windowId, url: urlForThisBrowser(t.url), active: false });
      tabIds.push(tab.id);
    } catch (err) {
      // Some internal pages (e.g. chrome://crash) can't be opened by extensions.
      console.warn('Could not reopen', t.url, err);
    }
  }
  if (!tabIds.length) return null;
  const groupId = await createGroup(tabIds, { title: entry.title, color: entry.color, windowId });
  // A reopened group is live again, so it no longer belongs in the saved list.
  await store.deleteSavedGroup(entry.id);
  return groupId;
}
