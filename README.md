<p align="center">
  <img src="icons/icon.svg" width="96" height="96" alt="Tab Groups++ icon">
</p>

<h1 align="center">Tab Groups++</h1>

<p align="center">
  <b>Drag, color, merge and save your tab groups, all from one popup.</b><br>
  A Chrome and Edge extension · Manifest V3 · plain JavaScript, no build step
</p>

---

## Why Tab Groups++?

Browser tab groups are great until you have a dozen of them. Tab Groups++ gives you one popup where you can
see every group in the window and rearrange it by dragging. You can clean up duplicates in one click and save
groups to reopen later, even in the other browser.

| | |
|---|---|
| 🖱️ **Drag and drop everything** | Tabs into groups, tabs within groups, and whole groups along the tab strip |
| 🎨 **Any color you like** | The 9 built-in colors, or any hex color you choose |
| 🧹 **One-click cleanup** | Merge same-named groups and close duplicate tabs |
| 🔗 **Merge on demand** | Tick a few groups and combine them into one |
| 💾 **Save for later** | Save a group, close its tabs, and restore it whenever you need it |
| 📦 **Take it with you** | Export groups as JSON and import them in Chrome or Edge |

---

## Features

### 🖱️ Organize by dragging

- **Create a group:** drag an ungrouped tab onto the "new group" zone that appears while dragging, then name and
  color the group on its card.
- **Add or remove tabs:** drop a tab onto a group to add it, or onto "Ungrouped tabs" to take it out.
- **Move several tabs:** tick ungrouped tabs and drag any one of them to move them all.
- **Reorder tabs:** drop a tab between rows of a group's list to place it at that spot. This works for tabs from
  the same group, another group or the ungrouped list. Dropping anywhere else on a group adds the tab at the end.
- **Reorder groups:** drag a group by its ⠿ handle, and the browser's tab strip follows.

### 📌 Pinned tabs

The window's pinned tabs are shown as a group of their own, always first. It is marked with 📌 and can be collapsed and
merged like any other group. Its title can't be changed, it's always grey, and it can't be saved or exported on its
own: pinned tabs are saved with the group they were pinned from.

- Every tab in a group has a 📌 button that pins it. The browser can't keep a pinned tab in a group, but the
  extension remembers where it came from, so the popup lists the tab both with the pinned tabs and in its group
  (first, marked 📌). Unpinning it, with its 📌 button, **Unpin**, or from the tab strip, moves it back to the end
  of that group.
- Ungrouped tabs have a 📌 button too. The ungrouped tabs work like a special group: a tab pinned from them is
  listed both with the pinned tabs and under "Ungrouped tabs", and unpinning it returns it there. They can't be
  saved or exported.
- If all of a group's tabs are pinned, the browser closes the group, but its card stays (with a dashed border) and
  can still be renamed, recolored, saved and exported. Unpinning one of its tabs, or dropping a tab on it, reopens
  the group with its name and color.
- A group's pinned tabs are saved, exported and closed (**Save & close**) along with it, and restored pinned.
  **Ungroup** leaves them pinned, and they no longer go back to the group.
- Dropping a tab on the pinned tabs pins it the same way. Dropping a pinned tab on a group or on "Ungrouped tabs"
  moves it there instead of back to its group. When the window has no pinned tabs, a "Drop here to pin" zone
  appears while you drag.
- In saved and exported groups, each pinned tab is marked with `"pinned": true` (and with 📌 on the Saved view).
  Restoring the group, from the Saved view or from an imported file, pins those tabs again.
- A group that is only *named* "Pinned tabs" stays an ordinary group: it has no 📌, and Deduplicate never merges
  it with the pinned tabs.

### 🧹 Deduplicate

- **In this window:** groups with the same name (ignoring case) are merged into the leftmost one, and duplicate
  tabs (same URL) are closed. The active, pinned or grouped copy is the one kept.
- **In your saved groups:** same-named saved groups are merged into the most recently saved one, and repeated
  URLs within each saved group are removed.
- Untitled groups are never merged.

### 🔗 Merge

1. Click **Merge**.
2. Tick the groups you want to combine. The first one you tick becomes the **target**.
3. Click **Merge** in the bar at the bottom, or **Cancel** to back out.

Every ticked group's tabs move into the target. This works the same way on the Saved view, where the other
saved groups are removed once their tabs are added to the target.

### 💾 Save and restore

- **Save** a group to keep it for later, or use **Save & close** to also close its tabs.
- **Restore** brings it back as a group in the current window and removes it from the saved list.
- Collapsed cards stay collapsed the next time you open the popup.

### 📦 Export and import

- **Export** downloads any group, open or saved, as a JSON file.
- **Import…** on the Saved view opens a page where you pick or drop exported files, which are added to your
  saved groups.

### 🪪 Every group has an identity

Each group has a UUID that stays the same when it's saved, restored, exported and imported. It's the `id` field in
exported JSON.

- Saving a group again, or importing a file of a group that's already saved, **replaces** the saved copy instead of
  adding a duplicate.
- Restoring or importing a group that's still open gives the new copy a fresh UUID, so the two stay separate.
- Open groups' UUIDs last for the browser session, so after a browser restart the reopened groups get new ones.

### 🎨 About custom colors

The `chrome.tabGroups` API only supports nine colors (grey, blue, red, yellow, green, pink, purple, cyan, orange),
in both Chrome and Edge. The extension keeps your exact hex color in the popup and in saved groups, and the tab
strip shows the closest built-in color. Changing a group's color from the tab strip clears its custom color.

---

## Get started

**Chrome:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select this folder.

**Edge:** open `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, and select this folder.

Then click the extension's toolbar icon to open the popup, which has a **This window** view and a **Saved** view.

## Browser support

Chrome or Edge **108 or later**. The extension uses only the Chromium extension APIs that both browsers share
(`tabs`, `tabGroups`, `storage`, `windows`, `downloads`), so the same folder or zip works in either.

Groups exported from one browser can be imported into the other. Internal pages (`chrome://…` / `edge://…`) are
switched to the current browser's scheme when a group is restored. Internal pages that exist in only one browser
(e.g. `edge://collections`) will not open in the other.

---

## For developers

### Project layout

```
manifest.json        MV3 manifest (permissions: tabs, tabGroups, storage, downloads)
background.js        Service worker: cleans up custom colors, UUIDs and collapsed state of closed groups
lib/colors.js        Native palette, nearest-color matching, hex helpers
lib/groups.js        Group, save and restore logic
lib/storage.js       Saved groups and rules (storage.local), live custom colors and UUIDs (storage.session)
lib/transfer.js      Group export/import as JSON
lib/dom.js           Tiny element helper
popup/               Toolbar popup (“This window” and “Saved” views)
import/              Import page (file pickers can't live in the popup)
icons/               icon.svg (source) and the PNGs generated from it
scripts/             build-icons.mjs: regenerates the PNG icons from icon.svg
```

### Reloading after changes

After you edit files, click the reload icon on the extension card. To reopen the popup, close it and open it again.

### Icons

The icon is drawn in `icons/icon.svg`. Chrome and Edge only accept raster manifest icons, so the PNGs next to it
are generated from the SVG with headless Chrome or Edge. After editing the SVG, run:

```sh
node scripts/build-icons.mjs
```

### Packaging

Zip the folder contents (without `.git`) to upload to the Chrome Web Store or
[Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge/) (same zip for both):

```sh
zip -r tab-groups-plus.zip . -x '.git/*' '.claude/*' 'scripts/*' '*.DS_Store'
```

---

## License

Tab Groups++ is free software, released under the [GNU General Public License v3.0](LICENSE).
You can redistribute and modify it under the terms of that license.
