import { NATIVE_COLORS, isNativeHex, nearestNativeColor } from './colors.js';
import * as store from './storage.js';

// Pinned tabs can't be in a tab group, so each window's pinned tabs are shown as a group of their
// own. PINNED stands in for its group id; its UUID and collapsed state are stored under
// pinnedKey(windowId), since there's no browser group id to key them by. Saved and exported copies
// have `pinned: true`, which is what tells them apart from a group that happens to be named the same.
// Pinned tabs are always grey: they have no color in the tab strip to match.
// A tab pinned from a group remembers that group as its home (see pinTabs), and unpinTabs puts it
// back. It's only shown with the pinned tabs, but it's saved and exported with its home group,
// marked `pinned: true`.
export const PINNED = 'pinned';
export const PINNED_TITLE = 'Pinned tabs';
export const PINNED_COLOR = NATIVE_COLORS.grey;
export const pinnedKey = (windowId) => `pinned:${windowId}`;

const byIndex = (a, b) => a.index - b.index;

export function groupHex(group, customColors) {
  return customColors[group.id] ?? NATIVE_COLORS[group.color];
}

// The tabs of a group, or of the window's pinned tabs, in tab-strip order.
export async function groupTabs(groupId, windowId) {
  const tabs = await chrome.tabs.query(groupId === PINNED ? { windowId, pinned: true } : { groupId });
  return tabs.sort(byIndex);
}

// Pinned tabs can't join a group. An unpinned tab lands just after the remaining pinned tabs,
// so unpinning right to left keeps them in their order. The tabs are being moved somewhere
// else, so they forget their home group first (which also tells background.js not to put them back).
async function unpin(tabIds) {
  await store.updatePinnedHomes((homes) => {
    for (const id of tabIds) delete homes[id];
  });
  const tabs = await Promise.all(tabIds.map((id) => chrome.tabs.get(id)));
  for (const t of tabs.filter((t) => t.pinned).sort(byIndex).reverse()) await chrome.tabs.update(t.id, { pinned: false });
}

// What a pinned tab remembers about the group it came from, enough to recreate it if it has closed.
async function homeOf(groupId) {
  const [group, custom, uuid] = await Promise.all([chrome.tabGroups.get(groupId), store.getCustomColors(), groupUuid(groupId)]);
  return { uuid, title: group.title ?? '', color: groupHex(group, custom) };
}

// Pins tabs, and has each grouped one remember its group so unpinTabs can put it back.
// Each newly pinned tab goes after the other pinned tabs, so pinning in order keeps the order.
export async function pinTabs(tabIds) {
  const tabs = await Promise.all(tabIds.map((id) => chrome.tabs.get(id)));
  const groupIds = new Set(tabs.map((t) => t.groupId).filter((id) => id !== chrome.tabGroups.TAB_GROUP_ID_NONE));
  const homes = new Map(await Promise.all([...groupIds].map(async (id) => [id, await homeOf(id)])));
  await store.updatePinnedHomes((map) => {
    for (const t of tabs) if (homes.has(t.groupId)) map[t.id] = homes.get(t.groupId);
  });
  for (const id of tabIds) await chrome.tabs.update(id, { pinned: true });
}

// Unpins tabs. A tab pinned from a group goes back to the end of it, and the group is recreated if
// it has closed since; other tabs stay ungrouped. Tabs already unpinned (from the tab strip, see
// background.js) are just put back.
export async function unpinTabs(tabIds) {
  const homes = await store.getPinnedHomes();
  const tabs = (await Promise.all(tabIds.map((id) => chrome.tabs.get(id)))).sort(byIndex);
  await unpin(tabIds);

  const byHome = new Map(); // uuid -> { home, windowId, ids }
  for (const t of tabs) {
    const home = homes[t.id];
    if (!home) continue;
    if (!byHome.has(home.uuid)) byHome.set(home.uuid, { home, windowId: t.windowId, ids: [] });
    byHome.get(home.uuid).ids.push(t.id);
  }
  if (!byHome.size) return;
  const [open, uuids] = await Promise.all([chrome.tabGroups.query({}), store.getGroupUuids()]);
  for (const { home, windowId, ids } of byHome.values()) {
    const live = open.find((g) => uuids[g.id] === home.uuid);
    if (live) {
      await chrome.tabs.group({ groupId: live.id, tabIds: ids });
    } else {
      const groupId = await createGroup(ids, { title: home.title, color: home.color, windowId });
      await store.setGroupUuid(groupId, home.uuid);
    }
  }
}

// Keeps the title and color that a group's pinned tabs remember up to date, for recreating it.
export async function refreshPinnedHomes(groupId) {
  const [uuids, homes] = await Promise.all([store.getGroupUuids(), store.getPinnedHomes()]);
  const uuid = uuids[groupId];
  if (!uuid || !Object.values(homes).some((h) => h.uuid === uuid)) return;
  const home = await homeOf(groupId);
  await store.updatePinnedHomes((map) => {
    for (const [id, h] of Object.entries(map)) if (h.uuid === uuid) map[id] = home;
  });
}

// Makes the pinned tabs of one group remember another instead (or nothing, when `to` is null).
async function rehome(fromUuid, to) {
  await store.updatePinnedHomes((map) => {
    for (const [id, h] of Object.entries(map)) {
      if (h.uuid !== fromUuid) continue;
      if (to) map[id] = to;
      else delete map[id];
    }
  });
}

// The pinned tabs whose home is the group with this UUID, in tab-strip order.
export async function pinnedFrom(uuid) {
  const [pinned, homes] = await Promise.all([chrome.tabs.query({ pinned: true }), store.getPinnedHomes()]);
  return pinned.filter((t) => homes[t.id]?.uuid === uuid).sort(byIndex);
}

// Moves tabs into a group, into the pinned tabs (PINNED), or out of both (TAB_GROUP_ID_NONE).
export async function moveTabs(tabIds, target) {
  if (target === PINNED) return pinTabs(tabIds);
  await unpin(tabIds);
  if (target === chrome.tabGroups.TAB_GROUP_ID_NONE) await chrome.tabs.ungroup(tabIds);
  else await chrome.tabs.group({ groupId: target, tabIds });
}

export async function setGroupColor(groupId, hex) {
  await chrome.tabGroups.update(groupId, { color: nearestNativeColor(hex) });
  await store.setCustomColor(groupId, isNativeHex(hex) ? null : hex);
  await refreshPinnedHomes(groupId);
}

// Ungroups a group's tabs. The tabs pinned from it stay pinned, but no longer go back to it.
export async function ungroupGroup(groupId) {
  await rehome(await groupUuid(groupId), null);
  const tabs = await groupTabs(groupId);
  if (tabs.length) await chrome.tabs.ungroup(tabs.map((t) => t.id));
}

export async function createGroup(tabIds, { title = '', color, windowId }) {
  await unpin(tabIds);
  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { title });
  if (color) await setGroupColor(groupId, color);
  return groupId;
}

// Moves every tab of each source group, in order, to the end of the target group. Either side can
// be PINNED: merging into it pins the tabs, merging it into a group unpins them. Tabs pinned from a
// source group now go back to the target group instead. Emptied source groups disappear on their own.
export async function mergeGroups(targetId, sourceIds, windowId) {
  for (const id of sourceIds) {
    if (id !== PINNED && targetId !== PINNED) await rehome(await groupUuid(id), await homeOf(targetId));
    const tabs = await groupTabs(id, windowId);
    if (tabs.length) await moveTabs(tabs.map((t) => t.id), targetId);
  }
}

// Merges same-named groups into the leftmost one, then closes duplicate tabs (same URL)
// across the window. Returns how many groups were merged away and tabs were closed.
export async function deduplicate(windowId) {
  const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;

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
    await mergeGroups(target, [g.id], windowId);
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

// Appends each source saved group's tabs, in order, to the target saved group and removes the sources.
export async function mergeSavedGroups(targetId, sourceIds) {
  const list = await store.getSavedGroups();
  const target = list.find((e) => e.id === targetId);
  for (const id of sourceIds) target.tabs.push(...(list.find((e) => e.id === id)?.tabs ?? []));
  await store.setSavedGroups(list.filter((e) => !sourceIds.includes(e.id)));
  for (const id of sourceIds) await store.setCollapsed(`saved:${id}`, false);
}

// The saved-groups counterpart of deduplicate: merges same-named saved groups into the topmost
// (most recently saved) one, then drops repeated URLs within each group. Tabs are only compared
// inside a group, since saved groups are separate collections rather than one window.
// Saved pinned tabs only merge with other saved pinned tabs, never with a group of the same name.
export async function deduplicateSaved() {
  const list = await store.getSavedGroups();
  const byName = new Map();
  const kept = [];
  let merged = 0;
  for (const entry of list) {
    const title = entry.title.trim().toLowerCase();
    const name = title && `${entry.pinned ? 'pinned' : 'group'}:${title}`;
    const target = name && byName.get(name);
    if (target) {
      target.tabs.push(...entry.tabs);
      await store.setCollapsed(`saved:${entry.id}`, false);
      merged++;
      continue;
    }
    const copy = { ...entry, tabs: [...entry.tabs] };
    if (name) byName.set(name, copy);
    kept.push(copy);
  }

  let removed = 0;
  for (const entry of kept) {
    const seen = new Set();
    const unique = entry.tabs.filter((t) => !seen.has(t.url) && seen.add(t.url));
    removed += entry.tabs.length - unique.length;
    entry.tabs = unique;
  }

  if (merged || removed) await store.setSavedGroups(kept);
  return { merged, removed };
}

export async function groupUuid(groupId) {
  return (await store.ensureGroupUuids([groupId]))[groupId];
}

// Whether an open group, or a window's pinned tabs, has this UUID.
export async function isGroupOpen(uuid) {
  const [open, pinned, uuids] = await Promise.all([
    chrome.tabGroups.query({}),
    chrome.tabs.query({ pinned: true }),
    store.getGroupUuids(),
  ]);
  return open.some((g) => uuids[g.id] === uuid) || pinned.some((t) => uuids[pinnedKey(t.windowId)] === uuid);
}

// A live group, or the window's pinned tabs (groupId PINNED), in the same shape as a saved group entry.
// A group's tabs include the ones pinned from it, first, as they are in the tab strip.
export async function snapshotLiveGroup(groupId, windowId) {
  const isPinned = groupId === PINNED;
  const [group, own, custom, id] = await Promise.all([
    isPinned ? { windowId, title: PINNED_TITLE } : chrome.tabGroups.get(groupId),
    groupTabs(groupId, windowId),
    store.getCustomColors(),
    groupUuid(isPinned ? pinnedKey(windowId) : groupId),
  ]);
  const tabs = isPinned ? own : [...(await pinnedFrom(id)), ...own];
  const entry = {
    id,
    title: group.title || 'Untitled group',
    color: isPinned ? PINNED_COLOR : groupHex(group, custom),
    ...(isPinned && { pinned: true }),
    savedAt: Date.now(),
    tabs: tabs.map((t) => ({
      url: t.url || t.pendingUrl,
      title: t.title,
      favIconUrl: t.favIconUrl,
      ...(t.pinned && { pinned: true }),
    })),
  };
  return { group, tabs, entry };
}

// Returns the saved entry, and whether it replaced an earlier saved copy of the same group.
export async function saveLiveGroup(groupId, windowId, { close = false } = {}) {
  const { group, tabs, entry } = await snapshotLiveGroup(groupId, windowId);
  const replaced = await store.addSavedGroup(entry);

  if (close) {
    // Closing every tab would close the window, so leave a fresh tab behind.
    const windowTabs = await chrome.tabs.query({ windowId: group.windowId });
    if (windowTabs.length === tabs.filter((t) => t.windowId === group.windowId).length) {
      await chrome.tabs.create({ windowId: group.windowId });
    }
    await chrome.tabs.remove(tabs.map((t) => t.id));
    // A closed group's UUID goes with it (see background.js). Pinned tabs pinned later are a new group.
    if (groupId === PINNED) await store.setGroupUuid(pinnedKey(windowId), null);
  }
  return { entry, replaced };
}

// Edge names its internal pages edge://…, Chrome chrome://…. Groups can move between the two
// browsers via export/import, so internal URLs are switched to this browser's scheme on restore.
const IS_EDGE = /\bEdg\//.test(navigator.userAgent);

export function urlForThisBrowser(url) {
  return IS_EDGE ? url.replace(/^chrome:\/\//i, 'edge://') : url.replace(/^edge:\/\//i, 'chrome://');
}

// Saved pinned tabs come back as pinned tabs, joining any the window already has. A group's tabs
// that were pinned are pinned again, and remember the restored group as their home.
export async function restoreSavedGroup(entry, windowId) {
  // Checked before any tab is reopened. If the group is still open (it was saved without
  // closing), the restored copy is a different group and gets a new UUID.
  const alreadyOpen = await isGroupOpen(entry.id);
  const uuid = alreadyOpen ? crypto.randomUUID() : entry.id;
  const hadPinned = entry.pinned && (await chrome.tabs.query({ windowId, pinned: true })).length > 0;

  const tabIds = [];
  const pinnedIds = [];
  for (const t of entry.tabs) {
    try {
      const pinned = !!(entry.pinned || t.pinned);
      const tab = await chrome.tabs.create({ windowId, url: urlForThisBrowser(t.url), active: false, pinned });
      (pinned ? pinnedIds : tabIds).push(tab.id);
    } catch (err) {
      // Some internal pages (e.g. chrome://crash) can't be opened by extensions.
      console.warn('Could not reopen', t.url, err);
    }
  }
  if (!tabIds.length && !pinnedIds.length) return null;
  let groupId = PINNED;
  if (!entry.pinned) {
    // A group whose tabs are all pinned stays closed until one of them is unpinned.
    if (tabIds.length) {
      groupId = await createGroup(tabIds, { title: entry.title, color: entry.color, windowId });
      await store.setGroupUuid(groupId, uuid);
    }
    const home = { uuid, title: entry.title, color: entry.color };
    await store.updatePinnedHomes((map) => {
      for (const id of pinnedIds) map[id] = home;
    });
  } else if (!hadPinned) {
    // Joining existing pinned tabs keeps their UUID; otherwise the restored ones set it.
    await store.setGroupUuid(pinnedKey(windowId), uuid);
  }
  // A reopened group is live again, so it no longer belongs in the saved list.
  await store.deleteSavedGroup(entry.id);
  return groupId;
}
