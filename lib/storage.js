const SAVED_KEY = 'savedGroups';
// Live group ids only last for the browser session, so their custom colors
// live in session storage: { [groupId]: '#rrggbb' }.
const CUSTOM_KEY = 'customColors';

export async function getSavedGroups() {
  const { [SAVED_KEY]: list = [] } = await chrome.storage.local.get(SAVED_KEY);
  return list;
}

export async function addSavedGroup(entry) {
  const list = await getSavedGroups();
  list.unshift(entry);
  await chrome.storage.local.set({ [SAVED_KEY]: list });
}

export async function deleteSavedGroup(id) {
  const list = await getSavedGroups();
  await chrome.storage.local.set({ [SAVED_KEY]: list.filter((g) => g.id !== id) });
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
