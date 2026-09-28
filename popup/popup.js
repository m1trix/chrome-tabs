import { NATIVE_COLORS, isNativeHex, nearestNativeColor, normalizeHex } from '../lib/colors.js';
import { el } from '../lib/dom.js';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';
import { LAYOUTS, applyLayout, hasSidePanel } from '../lib/layout.js';
import { downloadGroup } from '../lib/transfer.js';

const $ = (sel) => document.querySelector(sel);
const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
const { PINNED } = groups;
const { id: windowId } = await chrome.windows.getCurrent();
// The same page is shown in the toolbar popup and in the side panel (see lib/layout.js).
const IS_PANEL = !chrome.extension.getViews({ type: 'popup' }).includes(window);
document.body.classList.toggle('panel', IS_PANEL);

let statusTimer;
function flash(message) {
  $('#status').textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => ($('#status').textContent = ''), 2500);
}

// Runs an action, then re-renders so the popup reflects the new state.
async function run(action) {
  try {
    await action();
  } catch (err) {
    console.error(err);
    flash(err.message || String(err));
  }
  await render();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Pinned tabs are marked with a pin wherever they're shown, so they can't be mistaken for a group
// that just happens to be named "Pinned tabs".
const PIN_MARK = '📌';
const pinMark = () => el('span', { className: 'pin', textContent: PIN_MARK, title: 'Pinned tabs (not a tab group)' });
const displayTitle = (title, pinned) => (pinned ? `${PIN_MARK} ${title}` : title);

// ---- Color picker: nine native swatches plus a custom hex field ----

function colorPicker(selected, onPick) {
  const swatch = (hex, title) => {
    const b = el('button', { type: 'button', className: 'swatch', title, onclick: () => choose(b.dataset.hex) });
    b.dataset.hex = hex;
    b.style.setProperty('--c', hex);
    return b;
  };
  const custom = swatch('', 'Custom color');
  const hexInput = el('input', {
    className: 'hex',
    placeholder: '#custom',
    maxLength: 7,
    title: 'Custom color (hex). The tab strip shows the closest built-in color.',
    onchange: () => {
      const hex = normalizeHex(hexInput.value);
      if (hex) choose(hex);
      else hexInput.classList.toggle('invalid', hexInput.value !== '');
    },
  });
  const wrap = el(
    'div',
    { className: 'color-picker' },
    ...Object.entries(NATIVE_COLORS).map(([name, hex]) => swatch(hex, name)),
    custom,
    hexInput,
  );

  function mark(hex) {
    const isCustom = !!hex && !isNativeHex(hex);
    custom.hidden = !isCustom;
    if (isCustom) {
      custom.dataset.hex = hex;
      custom.style.setProperty('--c', hex);
      custom.title = `${hex} (shows as ${nearestNativeColor(hex)} in the tab strip)`;
    }
    hexInput.value = isCustom ? hex : '';
    hexInput.classList.remove('invalid');
    for (const s of wrap.querySelectorAll('.swatch')) s.classList.toggle('selected', s.dataset.hex === hex);
  }
  function choose(hex) {
    mark(hex);
    onPick(hex);
  }

  mark(selected?.toLowerCase());
  return wrap;
}

// ---- Tab rows ----

function favicon(url) {
  const img = el('img', { className: 'favicon', alt: '', src: url || '' });
  img.onerror = () => (img.style.visibility = 'hidden');
  if (!url) img.style.visibility = 'hidden';
  return img;
}

// Pins a tab, or unpins it back into the group it was pinned from (`home`, if any).
function pinButton(tab, home) {
  const back = home ? ` and move it back to “${home.title || 'Untitled group'}”` : '';
  const b = el('button', {
    type: 'button',
    className: 'tab-pin',
    textContent: PIN_MARK,
    title: tab.pinned ? `Unpin tab${back}` : 'Pin tab',
    onclick: () => run(() => (tab.pinned ? groups.unpinTabs([tab.id]) : groups.pinTabs([tab.id]))),
  });
  b.setAttribute('aria-pressed', tab.pinned);
  return b;
}

// `pinnable` adds a pin/unpin button; `home` is the group a pinned tab would go back to.
// In its group's card (`inGroup`), a pinned tab's × takes it out of the group instead of closing it.
function tabRow(tab, { selectable = false, pinnable = false, home, inGroup = false } = {}) {
  const label = el('span', { className: 'tab-title', textContent: tab.title || tab.url, title: tab.url });
  const row = selectable
    ? el('label', { className: 'tab-row' }, el('input', { type: 'checkbox', value: tab.id }), favicon(tab.favIconUrl), label)
    : el('button', { className: 'tab-row', onclick: () => chrome.tabs.update(tab.id, { active: true }) }, favicon(tab.favIconUrl), label);
  makeDraggable(row, tab);
  const removes = inGroup && tab.pinned;
  const close = el('button', {
    className: 'tab-close',
    textContent: '×',
    title: removes ? 'Remove from group (stays pinned)' : 'Close tab',
    ariaLabel: `${removes ? 'Remove from group' : 'Close'} ${tab.title || tab.url}`,
    onclick: () => run(() => (removes ? groups.removeFromGroups([tab.id]) : chrome.tabs.remove(tab.id))),
  });
  const li = el('li', {}, row, pinnable && pinButton(tab, home), close);
  li.dataset.tabId = tab.id;
  return li;
}

// Group cards are expanded unless the user collapses one. The choice is stored, so it
// survives re-renders and reopening the popup (see setCollapsed in lib/storage.js).
const collapsed = await store.getCollapsed();

// Wraps everything below a card's header in a body that a header button collapses/expands.
function collapsible(key, label, ...children) {
  const body = el('div', { className: 'card-body', hidden: collapsed.has(key) }, ...children);
  const toggle = el('button', {
    type: 'button',
    className: 'collapse-toggle',
    onclick: () => {
      body.hidden = !body.hidden;
      if (body.hidden) collapsed.add(key);
      else collapsed.delete(key);
      store.setCollapsed(key, body.hidden);
      sync();
    },
  });
  const sync = () => {
    toggle.textContent = `${label} ${body.hidden ? '▸' : '▾'}`;
    toggle.title = body.hidden ? 'Expand group' : 'Collapse group';
    toggle.setAttribute('aria-expanded', !body.hidden);
  };
  sync();
  const expand = () => {
    body.hidden = false;
    collapsed.delete(key);
    store.setCollapsed(key, false);
    sync();
  };
  return { toggle, body, expand };
}

// Group ids whose color picker the user opened; pickers start hidden and stay open across re-renders.
const pickerOpen = new Set();

// ---- Drag and drop: move tabs into, out of, and between groups ----

let dragged = null; // { tabIds, groupId, fromPinnedCard } while a drag is in progress

function endDrag() {
  dragged = null;
  draggedGroup = null;
  document.body.classList.remove('dragging');
  for (const n of document.querySelectorAll('.drop-target')) n.classList.remove('drop-target');
  for (const n of document.querySelectorAll('.dragging-source')) n.classList.remove('dragging-source');
  clearInsertMarkers();
}

function makeDraggable(node, tab) {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    // Dragging a checked ungrouped tab carries every checked tab along with it.
    const checked = [...document.querySelectorAll('#ungrouped input:checked')].map((i) => Number(i.value));
    const groupId = tab.pinned ? PINNED : tab.groupId;
    const tabIds = groupId === NONE && checked.includes(tab.id) ? checked : [tab.id];
    // A pinned tab is listed both in the pinned tabs' card and in its home group's card.
    dragged = { tabIds, groupId, fromPinnedCard: !!node.closest('.card.pinned') };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tab.url ?? '');
    // Changing layout synchronously in dragstart can cancel the drag in Chrome.
    requestAnimationFrame(() => dragged && document.body.classList.add('dragging'));
  });
  // The source row may already be re-rendered away by the time this fires; drop cleans up too.
  node.addEventListener('dragend', endDrag);
}

// `groupId` is the group the zone represents; dropping tabs back where they came from is ignored.
function dropZone(node, groupId, onDrop) {
  node.addEventListener('dragover', (e) => {
    if (!dragged || dragged.groupId === groupId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget)) node.classList.remove('drop-target');
  });
  node.addEventListener('drop', (e) => {
    if (!dragged) return; // a group drag, handled by #groups
    e.preventDefault();
    const drag = dragged;
    endDrag();
    run(() => onDrop(drag.tabIds, drag));
  });
}

// Pinned tabs dragged out of their group stay pinned, and will go to the ungrouped tabs when unpinned.
// Dragged out of the pinned tabs' card, they're unpinned.
dropZone($('#ungrouped-zone'), NONE, (tabIds, { fromPinnedCard }) =>
  fromPinnedCard ? groups.moveTabs(tabIds, NONE) : groups.removeFromGroups(tabIds),
);
// A new group starts untitled, so its name field gets focus once it's rendered.
let focusGroupId = null;
dropZone($('#new-group-zone'), 'new', async (tabIds) => {
  focusGroupId = await groups.createGroup(tabIds, { windowId });
});

// ---- Drag and drop: drop tabs at a position inside a group's tab list ----

// The group's tab ids after inserting `movingIds` before `beforeId` (null = at the end). A group's
// pinned tabs are listed first but aren't in the group, so landing before one means the group's start.
function reorderedIds(currentIds, movingIds, beforeId) {
  const rest = currentIds.filter((id) => !movingIds.includes(id));
  rest.splice(beforeId == null ? rest.length : Math.max(0, rest.indexOf(beforeId)), 0, ...movingIds);
  return rest;
}

// The row the dragged tabs would land before, skipping the dragged rows themselves; null = at the end.
function tabInsertionPoint(list, y) {
  const rows = [...list.children];
  let i = rows.findIndex((r) => {
    const rect = r.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  if (i === -1) return null;
  while (i < rows.length && dragged.tabIds.includes(Number(rows[i].dataset.tabId))) i++;
  return rows[i] ?? null;
}

function tabDropPlan(list, groupId, y) {
  const before = tabInsertionPoint(list, y);
  const beforeId = before ? Number(before.dataset.tabId) : null;
  const currentIds = [...list.children].map((r) => Number(r.dataset.tabId));
  const order = reorderedIds(currentIds, dragged.tabIds, beforeId);
  const noop = dragged.groupId === groupId && order.every((id, i) => id === currentIds[i]);
  return { before, beforeId, noop };
}

async function placeTabsInGroup(groupId, tabIds, fromGroupId, beforeId) {
  if (fromGroupId !== groupId) await groups.moveTabs(tabIds, groupId);
  if (groups.homeUuid(groupId)) return; // a closed group reopens with just these tabs
  const tabs = await groups.groupTabs(groupId, windowId);
  const first = tabs[0].index;
  // Moving tabs one by one, left to right, into their final slots keeps each move inside the group.
  const order = reorderedIds(tabs.map((t) => t.id), tabIds, beforeId);
  for (const [i, id] of order.entries()) await chrome.tabs.move(id, { index: first + i });
}

// Tabs are only pinned with their 📌 button, so the pinned tabs' list only takes its own tabs back
// (to reorder them).
const accepts = (groupId) => dragged && (groupId !== PINNED || dragged.groupId === PINNED);

function tabDropList(list, groupId) {
  list.addEventListener('dragover', (e) => {
    if (!accepts(groupId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearInsertMarkers();
    const { before, noop } = tabDropPlan(list, groupId, e.clientY);
    if (noop) return;
    if (before) before.classList.add('insert-before');
    else list.lastElementChild?.classList.add('insert-after');
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) clearInsertMarkers();
  });
  list.addEventListener('drop', (e) => {
    if (!accepts(groupId)) return;
    e.preventDefault();
    e.stopPropagation(); // the card would otherwise append the tabs at the end
    const { beforeId, noop } = tabDropPlan(list, groupId, e.clientY);
    const { tabIds, groupId: fromGroupId } = dragged;
    endDrag();
    if (!noop) run(() => placeTabsInGroup(groupId, tabIds, fromGroupId, beforeId));
  });
}

// ---- Drag and drop: reorder whole groups by their grip ----

let draggedGroup = null; // group id while a group card is being dragged
let groupSpans = new Map(); // group id -> { first, count }: its tabs' place in the tab strip

// The pinned tabs' card always comes first and closed groups' cards come last. Neither has a place
// in the tab strip to reorder, so they're left out.
const groupCards = () => [...$('#groups').querySelectorAll('.card:not(.pinned, .closed-group)')];

function makeGroupDraggable(handle, card, groupId) {
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => {
    draggedGroup = groupId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    const rect = card.getBoundingClientRect();
    e.dataTransfer.setDragImage(card, e.clientX - rect.left, e.clientY - rect.top);
    requestAnimationFrame(() => draggedGroup != null && card.classList.add('dragging-source'));
  });
  handle.addEventListener('dragend', endDrag);
}

// The card the dragged group would land before; null means after the last card.
function insertionPoint(y) {
  return groupCards().find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  }) ?? null;
}

function isNoopMove(before) {
  const cards = groupCards();
  const own = cards.find((c) => Number(c.dataset.groupId) === draggedGroup);
  return before === own || before === (cards[cards.indexOf(own) + 1] ?? null);
}

// Final tab index for the dragged group so it sits right before `before` (or after the last group).
function targetIndex(before) {
  const moving = groupSpans.get(draggedGroup);
  const anchor = groupSpans.get(Number((before ?? groupCards().at(-1)).dataset.groupId));
  const edge = before ? anchor.first : anchor.first + anchor.count;
  return moving.first < edge ? edge - moving.count : edge;
}

function clearInsertMarkers() {
  for (const n of document.querySelectorAll('.insert-before, .insert-after')) n.classList.remove('insert-before', 'insert-after');
}

$('#groups').addEventListener('dragover', (e) => {
  if (draggedGroup == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearInsertMarkers();
  const before = insertionPoint(e.clientY);
  if (isNoopMove(before)) return;
  if (before) before.classList.add('insert-before');
  else groupCards().at(-1).classList.add('insert-after');
});
$('#groups').addEventListener('dragleave', (e) => {
  if (!$('#groups').contains(e.relatedTarget)) clearInsertMarkers();
});
$('#groups').addEventListener('drop', (e) => {
  if (draggedGroup == null) return;
  e.preventDefault();
  const groupId = draggedGroup;
  const before = insertionPoint(e.clientY);
  const index = isNoopMove(before) ? null : targetIndex(before);
  endDrag();
  if (index != null) run(() => chrome.tabGroups.move(groupId, { index }));
});

// ---- Merge mode: tick groups, then merge them into the first one ticked ----

// Each view has its own merge mode, driven by the .merge button and .merge-bar inside it.
// `onMerge(targetId, sourceIds, targetTitle)` does the merge; cards carry their id in data-merge-id.
function mergeMode(view, onMerge) {
  const q = (sel) => view.querySelector(sel);
  const m = {
    on: false,
    selection: [], // ids in the order they were ticked; the first is the target
    titles: new Map(), // id -> display title, refreshed on render

    set(on) {
      m.on = on;
      m.selection = [];
      view.classList.toggle('merging', on);
      q('.merge').setAttribute('aria-pressed', on);
      q('.merge-bar').hidden = !on;
    },

    sync() {
      const [target] = m.selection;
      const n = m.selection.length;
      q('.merge-summary').textContent =
        n < 2 ? 'Select at least two groups to merge' : `Merge ${n} groups into “${m.titles.get(target)}”`;
      q('.merge-confirm').disabled = n < 2;
      for (const card of view.querySelectorAll('.card[data-merge-id]')) {
        card.classList.toggle('merge-target', n > 0 && card.dataset.mergeId === String(target));
      }
    },

    // Called on render. Groups that went away while in merge mode drop out of the selection.
    update(titles) {
      m.titles = titles;
      m.selection = m.selection.filter((id) => titles.has(id));
      q('.merge').disabled = titles.size < 2 && !m.on;
      if (m.on) m.sync();
    },

    checkbox(id) {
      const box = el('input', {
        type: 'checkbox',
        className: 'merge-pick',
        title: 'Select for merging',
        checked: m.selection.includes(id),
        onchange: () => {
          if (box.checked) m.selection.push(id);
          else m.selection = m.selection.filter((x) => x !== id);
          m.sync();
        },
      });
      return box;
    },
  };

  q('.merge').onclick = () => {
    m.set(!m.on);
    render();
  };
  q('.merge-cancel').onclick = () => {
    m.set(false);
    render();
  };
  q('.merge-confirm').onclick = () => {
    const [target, ...sources] = m.selection;
    const title = m.titles.get(target);
    m.set(false);
    run(async () => {
      await onMerge(target, sources);
      flash(`Merged ${plural(sources.length + 1, 'group')} into “${title}”`);
    });
  };
  return m;
}

const liveMerge = mergeMode($('#view-current'), (targetId, sourceIds) => groups.mergeGroups(targetId, sourceIds, windowId));
const savedMerge = mergeMode($('#view-saved'), groups.mergeSavedGroups);

// ---- "This window" view ----

// A card for a tab group, for the window's pinned tabs when `group.id` is PINNED, or for a group
// the browser closed because all its tabs are pinned (group.id from groups.homeKey). The pinned
// tabs' card works like a group's, except that its title and color are fixed and it stays first.
// A tab pinned from a group is listed both there and in its group, first. `homes` maps tab ids to
// their home group.
function liveGroupCard(group, tabs, hex, { homes = {} } = {}) {
  const isPinned = group.id === PINNED;
  const isClosed = !!groups.homeUuid(group.id);
  const card = el('article', { className: isPinned ? 'card pinned' : isClosed ? 'card closed-group' : 'card' });
  card.style.setProperty('--c', hex);
  card.dataset.groupId = group.id;
  card.dataset.mergeId = group.id;
  if (!isPinned) dropZone(card, group.id, (tabIds) => groups.moveTabs(tabIds, group.id));

  const title = isPinned
    ? el('h3', { className: 'title', textContent: groups.PINNED_TITLE })
    : el('input', {
        className: 'title',
        value: group.title ?? '',
        placeholder: 'Untitled group',
        onchange: () => run(() => groups.setGroupTitle(group.id, title.value)),
      });
  const grip = isPinned
    ? pinMark()
    : !isClosed && el('span', { className: 'grip', textContent: '⠿', title: 'Drag to reorder' });
  const list = el('ul', { className: 'tab-list' }, ...tabs.map((t) => tabRow(t, { pinnable: true, home: homes[t.id], inGroup: !isPinned })));
  tabDropList(list, group.id);
  if (grip && !isPinned) makeGroupDraggable(grip, card, group.id);

  // Pinned tabs have no color picker: the pin takes the dot's place.
  const picker = !isPinned && colorPicker(hex, (color) => run(() => groups.setGroupColor(group.id, color)));
  if (picker) picker.hidden = !pickerOpen.has(group.id);
  const dot = !isPinned && el('button', {
    type: 'button',
    className: 'dot',
    title: 'Change color',
    onclick: () => {
      // On a collapsed card, open the card along with the picker.
      if (body.hidden) {
        expand();
        picker.hidden = false;
      } else {
        picker.hidden = !picker.hidden;
      }
      if (picker.hidden) pickerOpen.delete(group.id);
      else pickerOpen.add(group.id);
      dot.setAttribute('aria-expanded', !picker.hidden);
    },
  });
  if (dot) dot.setAttribute('aria-expanded', !picker.hidden);

  const { toggle, body, expand } = collapsible(
    `live:${isPinned ? groups.pinnedKey(windowId) : group.id}`,
    plural(tabs.length, 'tab'),
    picker,
    isClosed && el('p', { className: 'meta', textContent: 'All its tabs are pinned. Unpin one, or drop a tab here, to reopen the group.' }),
    list,
    el(
      'div',
      { className: 'actions' },
      el('button', {
        className: 'btn',
        textContent: isPinned ? 'Unpin' : 'Ungroup',
        title: isPinned
          ? 'Unpin these tabs, moving tabs pinned from a group back to it'
          : 'Ungroup these tabs. Pinned ones stay pinned and go to the ungrouped tabs when unpinned.',
        onclick: () => run(() => (isPinned ? groups.unpinTabs(tabs.map((t) => t.id)) : groups.ungroupGroup(group.id))),
      }),
      // Pinned tabs are saved and exported with the groups they were pinned from, not on their own.
      !isPinned && el('button', {
        className: 'btn',
        textContent: 'Export',
        title: 'Download this group as a JSON file',
        onclick: () => run(async () => downloadGroup((await groups.snapshotLiveGroup(group.id, windowId)).entry)),
      }),
      !isPinned && el('button', {
        className: 'btn',
        textContent: 'Save',
        title: 'Save this group so you can reopen it later',
        onclick: () =>
          run(async () => {
            const { entry, replaced } = await groups.saveLiveGroup(group.id, windowId);
            flash(`Saved “${entry.title}”${replaced ? ', replacing its saved copy' : ''}`);
          }),
      }),
      !isPinned && el('button', {
        className: 'btn primary',
        textContent: 'Save & close',
        onclick: () =>
          run(async () => {
            const { entry, replaced } = await groups.saveLiveGroup(group.id, windowId, { close: true });
            flash(`Saved and closed “${entry.title}”${replaced ? ', replacing its saved copy' : ''}`);
          }),
      }),
    ),
  );

  card.append(el('header', {}, liveMerge.on && !isClosed && liveMerge.checkbox(group.id), grip, dot, title, toggle), body);
  return card;
}

async function renderCurrent() {
  const [tabs, allGroups, custom, uuids, homes] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({}),
    store.getCustomColors(),
    store.getGroupUuids(),
    store.getPinnedHomes(),
  ]);
  const liveGroups = allGroups.filter((g) => g.windowId === windowId);

  // Show groups in tab-strip order.
  tabs.sort((a, b) => a.index - b.index);
  groupSpans = new Map();
  for (const t of tabs) {
    if (t.groupId === NONE) continue;
    const span = groupSpans.get(t.groupId);
    if (span) span.count++;
    else groupSpans.set(t.groupId, { first: t.index, count: 1 });
  }
  liveGroups.sort((a, b) => groupSpans.get(a.id).first - groupSpans.get(b.id).first);
  // Pinned tabs always sit at the start of the tab strip, so their card comes first.
  const pinned = tabs.filter((t) => t.pinned);
  const pinnedCard = pinned.length > 0 && liveGroupCard({ id: PINNED, windowId }, pinned, groups.PINNED_COLOR, { homes });
  // Each group's pinned tabs, by group UUID. Groups that aren't open anywhere get a card of their own.
  const pinnedByHome = new Map();
  for (const t of pinned) {
    const home = homes[t.id];
    if (!home) continue;
    if (!pinnedByHome.has(home.uuid)) pinnedByHome.set(home.uuid, { home, tabs: [] });
    pinnedByHome.get(home.uuid).tabs.push(t);
  }
  const openUuids = new Set(allGroups.map((g) => uuids[g.id]));
  const closedHomes = [...pinnedByHome.values()].filter(
    ({ home }) => home.uuid !== groups.UNGROUPED_HOME.uuid && !openUuids.has(home.uuid),
  );
  const groupCardsNow = [
    ...liveGroups.map((g) =>
      liveGroupCard(
        g,
        [...(pinnedByHome.get(uuids[g.id])?.tabs ?? []), ...tabs.filter((t) => t.groupId === g.id)],
        groups.groupHex(g, custom),
        { homes },
      ),
    ),
    ...closedHomes.map(({ home, tabs: own }) =>
      liveGroupCard({ id: groups.homeKey(home.uuid), title: home.title }, own, home.color, { homes }),
    ),
  ];
  $('#groups').replaceChildren(
    ...[pinnedCard].filter(Boolean),
    ...(groupCardsNow.length
      ? groupCardsNow
      : [el('p', { className: 'empty', textContent: 'No groups yet. Drag a tab from below to start one.' })]),
  );
  liveMerge.update(
    new Map([
      ...(pinnedCard ? [[PINNED, displayTitle(groups.PINNED_TITLE, true)]] : []),
      ...liveGroups.map((g) => [g.id, g.title || 'Untitled group']),
    ]),
  );

  // Tabs pinned from the ungrouped tabs are listed with them too, first (see UNGROUPED_HOME).
  const ungrouped = [
    ...(pinnedByHome.get(groups.UNGROUPED_HOME.uuid)?.tabs ?? []),
    ...tabs.filter((t) => t.groupId === NONE && !t.pinned),
  ];
  $('#ungrouped').replaceChildren(
    ...(ungrouped.length
      ? ungrouped.map((t) => tabRow(t, { selectable: !t.pinned, pinnable: true, home: homes[t.id] }))
      : [el('li', { className: 'empty', textContent: 'Every tab is in a group.' })]),
  );

  if (focusGroupId != null) {
    $(`.card[data-group-id="${focusGroupId}"] .title`)?.focus();
    focusGroupId = null;
  }
}

function flashDedupe(...parts) {
  parts = parts.filter(Boolean);
  flash(parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'No duplicates found');
}

$('#dedupe').onclick = () =>
  run(async () => {
    const { merged, closed } = await groups.deduplicate(windowId);
    flashDedupe(merged && `merged ${plural(merged, 'group')}`, closed && `closed ${plural(closed, 'duplicate tab')}`);
  });

$('#dedupe-saved').onclick = () =>
  run(async () => {
    const { merged, removed } = await groups.deduplicateSaved();
    flashDedupe(merged && `merged ${plural(merged, 'group')}`, removed && `removed ${plural(removed, 'duplicate tab')}`);
  });

for (const button of document.querySelectorAll('.import')) {
  button.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('import/import.html') });
}

// ---- "Saved" view ----

function savedCard(entry) {
  const card = el('article', { className: 'card' });
  card.style.setProperty('--c', entry.color);
  card.dataset.mergeId = entry.id;

  let confirmTimer;
  const del = el('button', {
    className: 'btn danger',
    textContent: 'Delete',
    onclick: () => {
      if (del.dataset.confirm) return run(() => store.deleteSavedGroup(entry.id));
      del.dataset.confirm = '1';
      del.textContent = 'Really delete?';
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        delete del.dataset.confirm;
        del.textContent = 'Delete';
      }, 3000);
    },
  });

  const tabs = entry.tabs.map((t) =>
    el(
      'li',
      {},
      el(
        'button',
        { className: 'tab-row', onclick: () => chrome.tabs.create({ windowId, url: groups.urlForThisBrowser(t.url) }) },
        favicon(t.favIconUrl),
        el('span', { className: 'tab-title', textContent: t.title || t.url, title: t.url }),
        t.pinned && el('span', { className: 'pin', textContent: PIN_MARK, title: 'Restored as a pinned tab' }),
      ),
    ),
  );

  const { toggle, body } = collapsible(
    `saved:${entry.id}`,
    plural(entry.tabs.length, 'tab'),
    el('div', { className: 'meta', textContent: `Saved ${new Date(entry.savedAt).toLocaleString()}` }),
    el('ul', { className: 'tab-list' }, ...tabs),
    el(
      'div',
      { className: 'actions' },
      del,
      el('button', {
        className: 'btn',
        textContent: 'Export',
        title: 'Download this group as a JSON file',
        onclick: () => run(() => downloadGroup(entry)),
      }),
      el('button', {
        className: 'btn primary',
        textContent: 'Restore',
        onclick: () =>
          run(async () => {
            const groupId = await groups.restoreSavedGroup(entry, windowId);
            flash(groupId ? `Restored “${entry.title}”` : `Couldn't restore any tabs from “${entry.title}”`);
          }),
      }),
    ),
  );

  card.append(
    el(
      'header',
      {},
      savedMerge.on && savedMerge.checkbox(entry.id),
      el('span', { className: 'dot' }),
      el('h3', { textContent: entry.title }),
      toggle,
    ),
    body,
  );
  return card;
}

async function renderSaved() {
  const saved = await store.getSavedGroups();
  $('#saved-count').textContent = saved.length || '';
  $('#saved').replaceChildren(
    ...(saved.length
      ? saved.map(savedCard)
      : [el('p', { className: 'empty', textContent: 'No saved groups yet. Use “Save” on a group to keep it for later.' })]),
  );
  savedMerge.update(new Map(saved.map((e) => [e.id, e.title])));
}

// ---- "Settings" view ----

// A toggle between the layouts. Switching to the side panel opens it right away and closes the
// popup; switching to the popup closes the side panels (see the end of this file). If switching
// fails, the toggle goes back.
function layoutToggle(current) {
  const buttons = Object.entries(LAYOUTS).map(([layout, label]) => {
    const b = el('button', { type: 'button', textContent: label, onclick: () => choose(layout) });
    b.setAttribute('role', 'radio');
    b.dataset.layout = layout;
    return b;
  });
  const panelButton = buttons.find((b) => b.dataset.layout === 'panel');
  if (!hasSidePanel()) {
    current = 'popup';
    panelButton.disabled = true;
    panelButton.title = 'Side panels aren’t available. If you just updated the extension, reload it.';
  }
  const mark = () => {
    for (const b of buttons) b.setAttribute('aria-checked', b.dataset.layout === current);
  };
  function choose(layout) {
    if (layout === current) return;
    const previous = current;
    current = layout;
    mark();
    // run() starts this synchronously, so the side panel is opened during the click, as it must be.
    run(async () => {
      try {
        const opening = layout === 'panel' && !IS_PANEL ? chrome.sidePanel.open({ windowId }) : null;
        await applyLayout(layout);
        await store.updateSettings({ layout });
        if (opening) {
          await opening;
          window.close();
        } else {
          flash(`The toolbar icon now opens the ${LAYOUTS[layout]}`);
        }
      } catch (err) {
        current = previous;
        mark();
        await applyLayout(previous).catch(() => {});
        throw err;
      }
    });
  }
  mark();
  $('#layout').replaceChildren(...buttons);
}

layoutToggle((await store.getSettings()).layout);

// ---- Shell ----

async function render() {
  await Promise.all([renderCurrent(), renderSaved()]);
}

for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('[role=tab]')) {
      const selected = t === tab;
      t.setAttribute('aria-selected', selected);
      $(`#view-${t.dataset.view}`).hidden = !selected;
    }
  };
}

await render();

// The side panel stays open while tabs change, so it follows the browser. Renders wait until the
// user is done dragging or typing in a field, which a render would otherwise interrupt.
if (IS_PANEL) {
  let renderTimer;
  const busy = () => dragged || draggedGroup != null || document.activeElement?.matches('#groups input');
  const scheduleRender = () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => (busy() ? scheduleRender() : render()), 150);
  };
  for (const event of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onDetached', 'onActivated']) {
    chrome.tabs[event].addListener(scheduleRender);
  }
  for (const event of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved']) chrome.tabGroups[event].addListener(scheduleRender);
  chrome.storage.onChanged.addListener(scheduleRender);

  // Switching to the popup, from this panel or another window's, closes every open side panel.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.settings && (await store.getSettings()).layout !== 'panel') window.close();
  });
}
