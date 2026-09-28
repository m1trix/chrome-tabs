import { nearestNativeColor } from './lib/colors.js';
import { pinnedKey, refreshPinnedHomes, unpinTabs } from './lib/groups.js';
import { getCustomColors, getPinnedHomes, setCollapsed, setCustomColor, setGroupUuid, updatePinnedHomes } from './lib/storage.js';

chrome.tabGroups.onRemoved.addListener(async (group) => {
  await setCustomColor(group.id, null);
  await setGroupUuid(group.id, null);
  await setCollapsed(`live:${group.id}`, false);
});

// A window's pinned tabs are shown like a group keyed by the window (see PINNED in lib/groups.js).
// Like a group that loses its last tab, they're forgotten once the window has no pinned tabs left.
async function forgetPinned(windowId) {
  await setCollapsed(`live:${pinnedKey(windowId)}`, false);
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

// A tab pinned from a group remembers it (see pinTabs in lib/groups.js). Unpinning it from the tab
// strip puts it back too; the extension's own unpinning has already forgotten the group by then.
chrome.tabs.onUpdated.addListener(async (tabId, { pinned }) => {
  if (pinned === false && (await getPinnedHomes())[tabId]) await unpinTabs([tabId]);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getPinnedHomes())[tabId]) {
    await updatePinnedHomes((homes) => {
      delete homes[tabId];
    });
  }
});

// If the color is changed from the tab strip, the custom color no longer applies.
chrome.tabGroups.onUpdated.addListener(async (group) => {
  const hex = (await getCustomColors())[group.id];
  if (hex && nearestNativeColor(hex) !== group.color) await setCustomColor(group.id, null);
  await refreshPinnedHomes(group.id);
});
