import { getSettings } from './storage.js';

// The extension opens either as the toolbar popup or in the browser's side panel. Both show
// popup/popup.html. The toolbar icon opens the side panel only while the action has no popup.
export const LAYOUTS = { popup: 'Pop-Up', panel: 'Side-Panel' };

// chrome.sidePanel only exists in browsers that support side panels, and only once the extension
// has the "sidePanel" permission: after an update that adds it, the extension has to be reloaded.
// Without it, the extension always opens as the popup.
export const hasSidePanel = () => !!chrome.sidePanel;

export async function applyLayout(layout) {
  const panel = layout === 'panel' && hasSidePanel();
  await chrome.action.setPopup({ popup: panel ? '' : 'popup/popup.html' });
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: panel });
}

export async function applySavedLayout() {
  await applyLayout((await getSettings()).layout);
}
