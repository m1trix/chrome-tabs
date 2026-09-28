import { nearestNativeColor } from './lib/colors.js';
import { getCustomColors, setCollapsed, setCustomColor } from './lib/storage.js';

chrome.tabGroups.onRemoved.addListener(async (group) => {
  await setCustomColor(group.id, null);
  await setCollapsed(`live:${group.id}`, false);
});

// If the color is changed from the tab strip, the custom color no longer applies.
chrome.tabGroups.onUpdated.addListener(async (group) => {
  const hex = (await getCustomColors())[group.id];
  if (hex && nearestNativeColor(hex) !== group.color) await setCustomColor(group.id, null);
});
