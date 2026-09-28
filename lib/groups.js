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

export async function saveLiveGroup(groupId, { close = false } = {}) {
  const [group, tabs, custom] = await Promise.all([
    chrome.tabGroups.get(groupId),
    chrome.tabs.query({ groupId }),
    store.getCustomColors(),
  ]);
  const entry = {
    id: crypto.randomUUID(),
    title: group.title || 'Untitled group',
    color: groupHex(group, custom),
    savedAt: Date.now(),
    tabs: tabs.map((t) => ({ url: t.url || t.pendingUrl, title: t.title, favIconUrl: t.favIconUrl })),
  };
  await store.addSavedGroup(entry);

  if (close) {
    // Closing every tab would close the window, so leave a fresh tab behind.
    const windowTabs = await chrome.tabs.query({ windowId: group.windowId });
    if (windowTabs.length === tabs.length) await chrome.tabs.create({ windowId: group.windowId });
    await chrome.tabs.remove(tabs.map((t) => t.id));
  }
  return entry;
}

export async function restoreSavedGroup(entry, windowId) {
  const tabIds = [];
  for (const t of entry.tabs) {
    try {
      const tab = await chrome.tabs.create({ windowId, url: t.url, active: false });
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
