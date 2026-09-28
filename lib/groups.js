import { NATIVE_COLORS, isNativeHex, nearestNativeColor } from './colors.js';
import * as store from './storage.js';

// Pinned tabs can't be in a tab group, so each window's pinned tabs are shown as a group of their
// own. PINNED stands in for its group id; its collapsed state is stored under pinnedKey(windowId),
// since there's no browser group id to key it by. Pinned tabs are always grey: they have no color in
// the tab strip to match. They can't be saved or exported as a group of their own.
// A tab pinned from a group remembers that group as its home (see pinTabs), and unpinTabs puts it
// back. It's shown both with the pinned tabs and in its home group, and saved and exported with the
// group, marked `pinned: true`, so it's pinned again when the group is restored.
export const PINNED = 'pinned';
export const PINNED_TITLE = 'Pinned tabs';
export const PINNED_COLOR = NATIVE_COLORS.grey;
export const pinnedKey = (windowId) => `pinned:${windowId}`;

// The ungrouped tabs are a special home: a tab pinned from them is shown with them too, and goes back
// to them when unpinned. It's never a real or closed group, and isn't saved.
export const UNGROUPED_HOME = { uuid: 'ungrouped', title: 'Ungrouped tabs' };

// The browser closes a group once all its tabs are pinned, but they still remember it. homeKey(uuid)
// stands in for the group id of such a closed home group, which reopens when a tab is added to it.
export const homeKey = (uuid) => `home:${uuid}`;
export const homeUuid = (groupId) => (typeof groupId === 'string' && groupId.startsWith('home:') ? groupId.slice(5) : null);

const byIndex = (a, b) => a.index - b.index;

export function groupHex(group, customColors) {
  return customColors[group.id] ?? NATIVE_COLORS[group.color];
}

// The tabs of a group, or of the window's pinned tabs, in tab-strip order.
export async function groupTabs(groupId, windowId) {
  if (homeUuid(groupId)) return []; // a closed home group has only pinned tabs
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

// Pins tabs, and has each one remember its group, or the ungrouped tabs, so unpinTabs can put it
// back. Each newly pinned tab goes after the other pinned tabs, so pinning in order keeps the order.
export async function pinTabs(tabIds) {
  const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
  const tabs = (await Promise.all(tabIds.map((id) => chrome.tabs.get(id)))).filter((t) => !t.pinned);
  const groupIds = new Set(tabs.map((t) => t.groupId).filter((id) => id !== NONE));
  const homes = new Map(await Promise.all([...groupIds].map(async (id) => [id, await homeOf(id)])));
  homes.set(NONE, UNGROUPED_HOME);
  await store.updatePinnedHomes((map) => {
    for (const t of tabs) map[t.id] = homes.get(t.groupId);
  });
  for (const id of tabIds) await chrome.tabs.update(id, { pinned: true });
}

// Unpins tabs. A tab pinned from a group goes back to the end of it, and the group is recreated if
// it has closed since; other tabs stay ungrouped, just after the pinned tabs. Tabs already unpinned (from the tab strip, see
// background.js) are just put back.
export async function unpinTabs(tabIds) {
  const homes = await store.getPinnedHomes();
  const tabs = (await Promise.all(tabIds.map((id) => chrome.tabs.get(id)))).sort(byIndex);
  await unpin(tabIds);

  const byHome = new Map(); // uuid -> { home, windowId, ids }
  for (const t of tabs) {
    const home = homes[t.id];
    if (!home || home.uuid === UNGROUPED_HOME.uuid) continue;
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
  const uuid = homeUuid(target);
  if (uuid) return reopenHome(uuid, tabIds);
  await unpin(tabIds);
  if (target === chrome.tabGroups.TAB_GROUP_ID_NONE) await chrome.tabs.ungroup(tabIds);
  else await chrome.tabs.group({ groupId: target, tabIds });
}

// Reopens a closed home group with these tabs; its pinned tabs belong to it again.
async function reopenHome(uuid, tabIds) {
  const home = Object.values(await store.getPinnedHomes()).find((h) => h.uuid === uuid);
  const tabs = await Promise.all(tabIds.map((id) => chrome.tabs.get(id)));
  const groupId = await createGroup(tabIds, { title: home?.title, color: home?.color, windowId: tabs[0].windowId });
  await store.setGroupUuid(groupId, uuid);
  return groupId;
}

// Updates what a closed home group's pinned tabs remember about it.
async function updateHome(uuid, props) {
  await store.updatePinnedHomes((map) => {
    for (const [id, h] of Object.entries(map)) if (h.uuid === uuid) map[id] = { ...h, ...props };
  });
}

export async function setGroupTitle(groupId, title) {
  const uuid = homeUuid(groupId);
  if (uuid) await updateHome(uuid, { title });
  else await chrome.tabGroups.update(groupId, { title }); // background.js refreshes the pinned tabs' homes
}

export async function setGroupColor(groupId, hex) {
  const uuid = homeUuid(groupId);
  if (uuid) return updateHome(uuid, { color: hex });
  await chrome.tabGroups.update(groupId, { color: nearestNativeColor(hex) });
  await store.setCustomColor(groupId, isNativeHex(hex) ? null : hex);
  await refreshPinnedHomes(groupId);
}

// Ungroups a group's tabs. The tabs pinned from it stay pinned, but no longer go back to it.
export async function ungroupGroup(groupId) {
  await rehome(homeUuid(groupId) ?? (await groupUuid(groupId)), null);
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
export async function deduplicateSaved() {
  const list = await store.getSavedGroups();
  const byName = new Map();
  const kept = [];
  let merged = 0;
  for (const entry of list) {
    const name = entry.title.trim().toLowerCase();
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

// Whether an open group, or a closed home group (see homeKey), has this UUID.
export async function isGroupOpen(uuid) {
  const [open, uuids, homes] = await Promise.all([chrome.tabGroups.query({}), store.getGroupUuids(), store.getPinnedHomes()]);
  return open.some((g) => uuids[g.id] === uuid) || Object.values(homes).some((h) => h.uuid === uuid);
}

// A closed home group (see homeKey) as a stand-in for chrome.tabGroups.get.
async function closedHome(uuid, windowId) {
  const home = Object.values(await store.getPinnedHomes()).find((h) => h.uuid === uuid);
  return { windowId, title: home?.title ?? '', color: home?.color ?? NATIVE_COLORS.grey };
}

// A live group, or a closed home group (see homeKey), in the same shape as a saved group entry.
// Its tabs include the ones pinned from it, first, as they are in the tab strip.
export async function snapshotLiveGroup(groupId, windowId) {
  const closedUuid = homeUuid(groupId);
  const [group, own, custom, id] = await Promise.all([
    closedUuid ? closedHome(closedUuid, windowId) : chrome.tabGroups.get(groupId),
    groupTabs(groupId, windowId),
    store.getCustomColors(),
    closedUuid ?? groupUuid(groupId),
  ]);
  const tabs = [...(await pinnedFrom(id)), ...own];
  const entry = {
    id,
    title: group.title || 'Untitled group',
    color: closedUuid ? group.color : groupHex(group, custom),
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
    // background.js would forget the closed tabs' home too, but not before a quick restore checks it.
    await store.updatePinnedHomes((map) => {
      for (const t of tabs) delete map[t.id];
    });
  }
  return { entry, replaced };
}

// Edge names its internal pages edge://…, Chrome chrome://…. Groups can move between the two
// browsers via export/import, so internal URLs are switched to this browser's scheme on restore.
const IS_EDGE = /\bEdg\//.test(navigator.userAgent);

export function urlForThisBrowser(url) {
  return IS_EDGE ? url.replace(/^chrome:\/\//i, 'edge://') : url.replace(/^edge:\/\//i, 'chrome://');
}

// Tabs saved as pinned are pinned again, joining the window's pinned tabs, and remember the
// restored group as their home.
export async function restoreSavedGroup(entry, windowId) {
  // Checked before any tab is reopened. If the group is still open (it was saved without
  // closing), the restored copy is a different group and gets a new UUID.
  const alreadyOpen = await isGroupOpen(entry.id);
  const uuid = alreadyOpen ? crypto.randomUUID() : entry.id;

  const tabIds = [];
  const pinnedIds = [];
  for (const t of entry.tabs) {
    try {
      const pinned = !!t.pinned;
      const tab = await chrome.tabs.create({ windowId, url: urlForThisBrowser(t.url), active: false, pinned });
      (pinned ? pinnedIds : tabIds).push(tab.id);
    } catch (err) {
      // Some internal pages (e.g. chrome://crash) can't be opened by extensions.
      console.warn('Could not reopen', t.url, err);
    }
  }
  if (!tabIds.length && !pinnedIds.length) return null;
  // A group whose tabs are all pinned stays closed until one of them is unpinned.
  let groupId = homeKey(uuid);
  if (tabIds.length) {
    groupId = await createGroup(tabIds, { title: entry.title, color: entry.color, windowId });
    await store.setGroupUuid(groupId, uuid);
  }
  const home = { uuid, title: entry.title, color: entry.color };
  await store.updatePinnedHomes((map) => {
    for (const id of pinnedIds) map[id] = home;
  });
  // A reopened group is live again, so it no longer belongs in the saved list.
  await store.deleteSavedGroup(entry.id);
  return groupId;
}
