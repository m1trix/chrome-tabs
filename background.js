import { nearestNativeColor } from './lib/colors.js';
import { getCustomColors, setCustomColor } from './lib/storage.js';

chrome.tabGroups.onRemoved.addListener((group) => setCustomColor(group.id, null));

// If the color is changed from the tab strip, the custom color no longer applies.
chrome.tabGroups.onUpdated.addListener(async (group) => {
  const hex = (await getCustomColors())[group.id];
  if (hex && nearestNativeColor(hex) !== group.color) await setCustomColor(group.id, null);
});
