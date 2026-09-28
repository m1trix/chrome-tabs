# Tab Groups Plus

A Chrome / Edge extension (Manifest V3, plain JS, no build step) for organizing tabs into groups,
coloring them, and saving groups to reopen later.

## Features

- **Group tabs** – select ungrouped tabs in the popup and group them with a name and color.
- **Drag and drop** – in the popup, drag tabs onto a group to add them, onto “Ungrouped tabs” to remove them,
  or onto the “new group” zone that appears while dragging. Dragging a checked tab moves every checked tab.
- **Reorder tabs** – drag a tab between rows of a group's tab list to put it at that spot (works for tabs
  from the same group, another group, or ungrouped tabs). Dropping elsewhere on a group adds tabs at the end.
- **Reorder groups** – drag a group by its ⠿ handle to move the whole group; the browser's tab strip follows.
- **Deduplicate** – merges groups with the same name (ignoring case) into the leftmost one and closes duplicate
  tabs (same URL) in the window, keeping the active, pinned, or grouped copy. Untitled groups aren't merged.
- **Export / import** – download any group (open or saved) as a JSON file with **Export**; **Import…** on the
  Saved view opens a page where you pick or drop exported files, which are added to the saved groups.
- **Custom colors** – pick any of the 9 built-in colors or enter a custom hex color.
- **Save & reopen** – save a group (optionally closing its tabs) and restore it later as a group in the current window.
  Reopening a saved group removes it from the saved list.

### About custom colors

The `chrome.tabGroups` API only supports nine colors (grey, blue, red, yellow, green, pink, purple, cyan, orange),
in both Chrome and Edge. Custom hex colors are kept by the extension (in the popup and saved groups) and
the tab strip shows the closest built-in color. Changing a group's color from the tab strip clears its custom color.

## Install (unpacked)

**Chrome:** open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this folder.

**Edge:** open `edge://extensions`, enable **Developer mode**, click **Load unpacked**, and select this folder.

After you edit files, click the reload icon on the extension card. To reopen the popup, close it and open it again.

## Layout

```
manifest.json        MV3 manifest (permissions: tabs, tabGroups, storage, downloads)
background.js        Service worker: custom-color cleanup
lib/colors.js        Native palette, nearest-color matching, hex helpers
lib/groups.js        Group, save and restore logic
lib/storage.js       Saved groups and rules (storage.local), live custom colors (storage.session)
lib/transfer.js      Group export/import as JSON
lib/dom.js           Tiny element helper
popup/               Toolbar popup (“This window” and “Saved” views)
import/              Import page (file pickers can't live in the popup)
icons/               Toolbar and store icons
```

## Packaging

Zip the folder contents (without `.git`) to upload to the Chrome Web Store or Edge Add-ons:

```sh
zip -r tab-groups-plus.zip . -x '.git/*' '*.DS_Store'
```
