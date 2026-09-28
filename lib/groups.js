import { NATIVE_COLORS, colorForKey, isNativeHex, nearestNativeColor } from './colors.js';
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

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchRule(host, rules) {
  return rules.find((r) => host === r.domain || host.endsWith(`.${r.domain}`));
}

// Groups the window's ungrouped tabs by domain. Domain rules decide the group
// name and color; without a rule, a domain needs at least two tabs to get a
// group. Tabs join an existing group with the same title if there is one.
export async function autoGroupByDomain(windowId) {
  const [tabs, liveGroups, rules] = await Promise.all([
    chrome.tabs.query({ windowId, pinned: false }),
    chrome.tabGroups.query({ windowId }),
    store.getRules(),
  ]);

  const buckets = new Map();
  for (const tab of tabs) {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
    const host = hostOf(tab.url || tab.pendingUrl);
    if (!host) continue;
    const rule = matchRule(host, rules);
    const title = rule ? rule.name || rule.domain : host;
    if (!buckets.has(title)) buckets.set(title, { title, color: rule?.color, fromRule: !!rule, tabIds: [] });
    buckets.get(title).tabIds.push(tab.id);
  }

  let changed = 0;
  for (const b of buckets.values()) {
    const existing = liveGroups.find((g) => g.title === b.title);
    if (existing) {
      await chrome.tabs.group({ groupId: existing.id, tabIds: b.tabIds });
    } else if (b.fromRule || b.tabIds.length > 1) {
      await createGroup(b.tabIds, { title: b.title, color: b.color ?? colorForKey(b.title), windowId });
    } else {
      continue;
    }
    changed++;
  }
  return changed;
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
  return createGroup(tabIds, { title: entry.title, color: entry.color, windowId });
}
