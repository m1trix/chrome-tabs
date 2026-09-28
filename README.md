<p align="center">
  <img src="icons/icon.svg" width="96" height="96" alt="Tab Groups++ icon">
</p>

<h1 align="center">Tab Groups++</h1>

<p align="center">
  <b>Drag, color, merge and save your tab groups, all from one popup.</b><br>
  A Chrome and Edge extension · Manifest V3 · plain JavaScript, no build step
</p>

> [!NOTE]
> **Disclaimer:** this extension is entirely vibe-coded. Its code was written by an AI coding assistant from
> natural-language instructions, and it hasn't been reviewed line by line. Use it at your own risk.

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
| 📌 **Pinned tabs as a group** | Pin a tab from its card and unpin it back into the group it came from |
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

The window's pinned tabs are shown as a group of their own, always first and marked with 📌. It can be collapsed
and merged like any other group, but its title can't be changed, it's always grey, and it can't be saved or exported
on its own: pinned tabs are saved with the group they were pinned from.

- **Pin and unpin:** every tab in a group, and every ungrouped tab, has a 📌 button. Tabs are only pinned this way,
  not by dragging.
- **Pinned tabs remember their group:** the browser can't keep a pinned tab in a group, but the extension remembers
  where it came from. The popup lists the tab both with the pinned tabs and in its group (first, marked 📌).
- **Unpinning puts it back:** unpinning a tab with its 📌 button, with **Unpin** on the pinned tabs, or from the
  browser's tab strip moves it back to the end of its group.
- **Ungrouped tabs** work like a special group: a tab pinned from them is also listed under "Ungrouped tabs", and
  unpinning returns it there. They can't be saved or exported.
- **Closed groups:** if all of a group's tabs are pinned, the browser closes the group, but its card stays, with a
  dashed border, after the other groups. It can still be renamed, recolored, saved, exported and ungrouped, but not
  reordered or merged. Unpinning one of its tabs, or dropping a tab on it, reopens the group with its name, color
  and UUID.
- **Dragging pinned tabs:** drag them within the pinned tabs to reorder them, or onto a group or "Ungrouped tabs"
  to unpin them there instead of back to their own group. Dragging a pinned tab from its group's card to
  "Ungrouped tabs" removes it from the group but keeps it pinned; unpinning it later puts it in "Ungrouped tabs". Its × in the group's card does the same, instead
  of closing it.
- **Saving:** a group's pinned tabs are saved, exported and closed (**Save & close**) along with it. They're marked
  with 📌 on the Saved view and `"pinned": true` in exported JSON, and restoring the group, from the Saved view or
  an imported file, pins them again. **Ungroup** leaves them pinned, and unpinning them puts them in "Ungrouped tabs".
- A group that is only *named* "Pinned tabs" stays an ordinary group: it has no 📌, and Deduplicate never merges
  it with the pinned tabs.

### 🧹 Deduplicate

- **In this window:** groups with the same name (ignoring case) are merged into the leftmost one, and duplicate
  tabs (same URL) are closed. The active, pinned or grouped copy is the one kept, and pinned tabs are never
  closed.
- **In your saved groups:** same-named saved groups are merged into the most recently saved one, and repeated
  URLs within each saved group are removed.
- Untitled groups are never merged.

### 🔗 Merge

1. Click **Merge**.
2. Tick the groups you want to combine. The first one you tick becomes the **target**.
3. Click **Merge** in the bar at the bottom, or **Cancel** to back out.

Every ticked group's tabs move into the target. This works the same way on the Saved view, where the other
saved groups are removed once their tabs are added to the target.

The pinned tabs can be merged too. Merging a group into them pins its tabs, which still remember the group, and
merging them into a group unpins them into it. Closed groups (whose tabs are all pinned) can't be merged.

### 💾 Save and restore

- **Save** a group to keep it for later, or use **Save & close** to also close its tabs.
- **Restore** brings it back as a group in the current window, with its pinned tabs pinned again, and removes it
  from the saved list.
- Collapsed cards stay collapsed the next time you open the popup.

### 📦 Export and import

- **Export** downloads any group, open or saved, as a JSON file named `<group-name>.group.json`. The pinned tabs
  are exported with their groups, not on their own.
- **Import…** on the Saved view opens a page where you pick or drop exported files, which are added to your
  saved groups.

### ⚙️ Settings

- **Layout:** choose whether the toolbar icon opens the extension as a **Pop-Up** (the default) or in the
  browser's **Side-Panel**. Switching to the side panel opens it right away, and switching back to the
  popup closes it. The side panel stays open while you browse and follows changes to your tabs and groups as
  they happen.

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

Then click the extension's toolbar icon to open the popup, which has a **This window** view, a **Saved** view
and a **Settings** view.

## Browser support

Chrome or Edge **116 or later**. The extension uses only the Chromium extension APIs that both browsers share
(`tabs`, `tabGroups`, `storage`, `windows`, `downloads`, `sidePanel`), so the same folder or zip works in either.

Groups exported from one browser can be imported into the other. Internal pages (`chrome://…` / `edge://…`) are
switched to the current browser's scheme when a group is restored. Internal pages that exist in only one browser
(e.g. `edge://collections`) will not open in the other.

---

## For developers

### Project layout

```
manifest.json        MV3 manifest (permissions: tabs, tabGroups, storage, downloads, sidePanel)
background.js        Service worker: applies the layout setting, cleans up after closed groups, tracks pinned tabs' groups, returns tabs
                     unpinned from the tab strip to their group
lib/colors.js        Native palette, nearest-color matching, hex helpers
lib/groups.js        Group, pinning, merge, deduplicate, save and restore logic
lib/storage.js       Saved groups and settings (storage.local); live custom colors, UUIDs and pinned tabs'
                     groups (storage.session); collapsed cards (both)
lib/transfer.js      Group export/import as JSON
lib/layout.js        Opens the extension as the toolbar popup or in the side panel
lib/dom.js           Tiny element helper
popup/               Toolbar popup and side panel (“This window”, “Saved” and “Settings” views)
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
