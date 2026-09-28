// Every group has a UUID that stays the same while it moves between open and saved, and in
// exported files. A saved group's UUID is its entry id.
const SAVED_KEY = 'savedGroups';
// Open groups' UUIDs, keyed by the browser's group id (which only lasts for the browser
// session, hence session storage): { [groupId]: uuid }.
const UUID_KEY = 'groupUuids';
// Live group ids only last for the browser session, so their custom colors
// live in session storage: { [groupId]: '#rrggbb' }.
const CUSTOM_KEY = 'customColors';
// The group each tab pinned from a group came from, so unpinning can put it back. Keyed by tab id
// (which only lasts for the browser session): { [tabId]: { uuid, title, color } }.
const HOMES_KEY = 'pinnedHomes';
// Keys of collapsed group cards: "live:<groupId>" in session storage (ids change after a
// restart), "saved:<entryId>" in local storage (saved groups keep their ids).
const COLLAPSED_KEY = 'collapsedCards';
// User preferences from the popup's Settings view, merged over DEFAULT_SETTINGS.
const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS = {
  layout: 'popup', // 'popup' | 'panel': how the toolbar icon opens the extension (see lib/layout.js)
};

export async function getSettings() {
  const { [SETTINGS_KEY]: saved = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...saved };
}

// Merges `changes` into the stored settings. Settings left at their default aren't stored,
// so changing a default later reaches everyone who never touched it.
export async function updateSettings(changes) {
  const { [SETTINGS_KEY]: saved = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  const next = { ...saved, ...changes };
  for (const [key, value] of Object.entries(next)) if (value === DEFAULT_SETTINGS[key]) delete next[key];
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return { ...DEFAULT_SETTINGS, ...next };
}

export async function getSavedGroups() {
  const { [SAVED_KEY]: list = [] } = await chrome.storage.local.get(SAVED_KEY);
  return list;
}

// Adds the entry at the top of the list. A saved copy with the same UUID is the same group,
// so it's replaced. Returns whether one was.
export async function addSavedGroup(entry) {
  const list = await getSavedGroups();
  const rest = list.filter((g) => g.id !== entry.id);
  await chrome.storage.local.set({ [SAVED_KEY]: [entry, ...rest] });
  return rest.length < list.length;
}

export async function setSavedGroups(list) {
  await chrome.storage.local.set({ [SAVED_KEY]: list });
}

export async function deleteSavedGroup(id) {
  const list = await getSavedGroups();
  await chrome.storage.local.set({ [SAVED_KEY]: list.filter((g) => g.id !== id) });
  await setCollapsed(`saved:${id}`, false);
}

export async function getCollapsed() {
  const [{ [COLLAPSED_KEY]: live = [] }, { [COLLAPSED_KEY]: saved = [] }] = await Promise.all([
    chrome.storage.session.get(COLLAPSED_KEY),
    chrome.storage.local.get(COLLAPSED_KEY),
  ]);
  return new Set([...live, ...saved]);
}

// Writes are chained so quick toggles don't overwrite each other's read-modify-write.
let collapsedWrites = Promise.resolve();

export function setCollapsed(key, isCollapsed) {
  const area = key.startsWith('saved:') ? chrome.storage.local : chrome.storage.session;
  collapsedWrites = collapsedWrites.then(async () => {
    const { [COLLAPSED_KEY]: list = [] } = await area.get(COLLAPSED_KEY);
    const keys = new Set(list);
    if (isCollapsed === keys.has(key)) return;
    if (isCollapsed) keys.add(key);
    else keys.delete(key);
    await area.set({ [COLLAPSED_KEY]: [...keys] });
  });
  return collapsedWrites;
}

export async function getCustomColors() {
  const { [CUSTOM_KEY]: map = {} } = await chrome.storage.session.get(CUSTOM_KEY);
  return map;
}

export async function setCustomColor(groupId, hex) {
  const map = await getCustomColors();
  if (hex) map[groupId] = hex;
  else delete map[groupId];
  await chrome.storage.session.set({ [CUSTOM_KEY]: map });
}

export async function getGroupUuids() {
  const { [UUID_KEY]: map = {} } = await chrome.storage.session.get(UUID_KEY);
  return map;
}

// Writes are chained like setCollapsed, so UUIDs handed out at the same time don't get lost.
let uuidWrites = Promise.resolve();

function updateGroupUuids(change) {
  const result = uuidWrites.then(async () => {
    const map = await getGroupUuids();
    const out = change(map);
    await chrome.storage.session.set({ [UUID_KEY]: map });
    return out;
  });
  uuidWrites = result.catch(() => {});
  return result;
}

// Returns the UUID of each open group, giving a new one to groups that don't have one yet.
export function ensureGroupUuids(groupIds) {
  return updateGroupUuids((map) =>
    Object.fromEntries(groupIds.map((id) => [id, (map[id] ??= crypto.randomUUID())])),
  );
}

export function setGroupUuid(groupId, uuid) {
  return updateGroupUuids((map) => {
    if (uuid) map[groupId] = uuid;
    else delete map[groupId];
  });
}

export async function getPinnedHomes() {
  const { [HOMES_KEY]: map = {} } = await chrome.storage.session.get(HOMES_KEY);
  return map;
}

// Writes are chained like setCollapsed. `change` edits the map in place.
let homeWrites = Promise.resolve();

export function updatePinnedHomes(change) {
  const result = homeWrites.then(async () => {
    const map = await getPinnedHomes();
    change(map);
    await chrome.storage.session.set({ [HOMES_KEY]: map });
  });
  homeWrites = result.catch(() => {});
  return result;
}
