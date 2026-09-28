import { nearestNativeColor } from './lib/colors.js';
import { pinnedKey } from './lib/groups.js';
import { getCustomColors, setCollapsed, setCustomColor, setGroupUuid } from './lib/storage.js';

chrome.tabGroups.onRemoved.addListener(async (group) => {
  await setCustomColor(group.id, null);
  await setGroupUuid(group.id, null);
  await setCollapsed(`live:${group.id}`, false);
});

// A window's pinned tabs are stored like a group keyed by the window (see PINNED in lib/groups.js).
// Like a group that loses its last tab, they're forgotten once the window has no pinned tabs left.
async function forgetPinned(windowId) {
  const key = pinnedKey(windowId);
  await setGroupUuid(key, null);
  await setCollapsed(`live:${key}`, false);
}

async function forgetPinnedIfNone(windowId) {
  const pinned = await chrome.tabs.query({ windowId, pinned: true }).catch(() => []);
  if (!pinned.length) await forgetPinned(windowId);
}

chrome.windows.onRemoved.addListener(forgetPinned);
chrome.tabs.onRemoved.addListener((tabId, { windowId, isWindowClosing }) => {
  if (!isWindowClosing) forgetPinnedIfNone(windowId);
});
chrome.tabs.onDetached.addListener((tabId, { oldWindowId }) => forgetPinnedIfNone(oldWindowId));
chrome.tabs.onUpdated.addListener((tabId, { pinned }, tab) => {
  if (pinned === false) forgetPinnedIfNone(tab.windowId);
});

// If the color is changed from the tab strip, the custom color no longer applies.
chrome.tabGroups.onUpdated.addListener(async (group) => {
  const hex = (await getCustomColors())[group.id];
  if (hex && nearestNativeColor(hex) !== group.color) await setCustomColor(group.id, null);
});
