# Tab Groups Plus

A Chrome / Edge extension (Manifest V3, plain JS, no build step) for organizing tabs into groups,
coloring them, and saving groups to reopen later.

## Features

- **Group tabs** – select ungrouped tabs in the popup and group them with a name and color.
- **Drag and drop** – in the popup, drag tabs onto a group to add them, onto “Ungrouped tabs” to remove them,
  or onto the “new group” zone that appears while dragging. Dragging a checked tab moves every checked tab.
- **Reorder groups** – drag a group by its ⠿ handle to move the whole group; the browser's tab strip follows.
- **Group by domain** – one click (or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>) groups ungrouped tabs by site.
  Domains with 2+ tabs get their own group; tabs join an existing group with the same name.
- **Domain rules** (options page) – map domains to a group name and color, e.g. `github.com` → “Code”, green.
  Several domains can share a group name.
- **Custom colors** – pick any of the 9 built-in colors or enter a custom hex color.
- **Save & reopen** – save a group (optionally closing its tabs) and restore it later as a group in the current window.

### About custom colors

The `chrome.tabGroups` API only supports nine colors (grey, blue, red, yellow, green, pink, purple, cyan, orange),
in both Chrome and Edge. Custom hex colors are kept by the extension (in the popup, saved groups, and rules) and
the tab strip shows the closest built-in color. Changing a group's color from the tab strip clears its custom color.

## Install (unpacked)

**Chrome:** open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this folder.

**Edge:** open `edge://extensions`, enable **Developer mode**, click **Load unpacked**, and select this folder.

After you edit files, click the reload icon on the extension card. To reopen the popup, close it and open it again.

## Layout

```
manifest.json        MV3 manifest (permissions: tabs, tabGroups, storage)
background.js        Service worker: keyboard command and custom-color cleanup
lib/colors.js        Native palette, nearest-color matching, hex helpers
lib/groups.js        Group, auto-group, save and restore logic
lib/storage.js       Saved groups and rules (storage.local), live custom colors (storage.session)
lib/dom.js           Tiny element helper
popup/               Toolbar popup (“This window” and “Saved” views)
options/             Domain rules editor
icons/               Toolbar and store icons
```

## Packaging

Zip the folder contents (without `.git`) to upload to the Chrome Web Store or Edge Add-ons:

```sh
zip -r tab-groups-plus.zip . -x '.git/*' '*.DS_Store'
```
