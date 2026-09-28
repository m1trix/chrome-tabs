const SAVED_KEY = 'savedGroups';
// Live group ids only last for the browser session, so their custom colors
// live in session storage: { [groupId]: '#rrggbb' }.
const CUSTOM_KEY = 'customColors';
// Keys of collapsed group cards: "live:<groupId>" in session storage (ids change after a
// restart), "saved:<entryId>" in local storage (saved groups keep their ids).
const COLLAPSED_KEY = 'collapsedCards';

export async function getSavedGroups() {
  const { [SAVED_KEY]: list = [] } = await chrome.storage.local.get(SAVED_KEY);
  return list;
}

export async function addSavedGroup(entry) {
  const list = await getSavedGroups();
  list.unshift(entry);
  await chrome.storage.local.set({ [SAVED_KEY]: list });
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
