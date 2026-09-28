import { NATIVE_COLORS, isNativeHex, nearestNativeColor, normalizeHex } from '../lib/colors.js';
import { el } from '../lib/dom.js';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';
import { downloadGroup } from '../lib/transfer.js';

const $ = (sel) => document.querySelector(sel);
const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
const { id: windowId } = await chrome.windows.getCurrent();

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

function tabRow(tab, { selectable = false } = {}) {
  const label = el('span', { className: 'tab-title', textContent: tab.title || tab.url, title: tab.url });
  const row = selectable
    ? el('label', { className: 'tab-row' }, el('input', { type: 'checkbox', value: tab.id }), favicon(tab.favIconUrl), label)
    : el('button', { className: 'tab-row', onclick: () => chrome.tabs.update(tab.id, { active: true }) }, favicon(tab.favIconUrl), label);
  makeDraggable(row, tab);
  const close = el('button', {
    className: 'tab-close',
    textContent: '×',
    title: 'Close tab',
    ariaLabel: `Close ${tab.title || tab.url}`,
    onclick: () => run(() => chrome.tabs.remove(tab.id)),
  });
  const li = el('li', {}, row, close);
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

let dragged = null; // { tabIds, groupId } while a drag is in progress

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
    const tabIds = tab.groupId === NONE && checked.includes(tab.id) ? checked : [tab.id];
    dragged = { tabIds, groupId: tab.groupId };
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
    const { tabIds } = dragged;
    endDrag();
    run(() => onDrop(tabIds));
  });
}

dropZone($('#ungrouped-zone'), NONE, (tabIds) => chrome.tabs.ungroup(tabIds));
// A new group starts untitled, so its name field gets focus once it's rendered.
let focusGroupId = null;
dropZone($('#new-group-zone'), 'new', async (tabIds) => {
  focusGroupId = await groups.createGroup(tabIds, { windowId });
});

// ---- Drag and drop: drop tabs at a position inside a group's tab list ----

// The group's tab ids after inserting `movingIds` before `beforeId` (null = at the end).
function reorderedIds(currentIds, movingIds, beforeId) {
  const rest = currentIds.filter((id) => !movingIds.includes(id));
  rest.splice(beforeId == null ? rest.length : rest.indexOf(beforeId), 0, ...movingIds);
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
  if (fromGroupId !== groupId) await chrome.tabs.group({ groupId, tabIds });
  const tabs = (await chrome.tabs.query({ groupId })).sort((a, b) => a.index - b.index);
  const first = tabs[0].index;
  // Moving tabs one by one, left to right, into their final slots keeps each move inside the group.
  const order = reorderedIds(tabs.map((t) => t.id), tabIds, beforeId);
  for (const [i, id] of order.entries()) await chrome.tabs.move(id, { index: first + i });
}

function tabDropList(list, groupId) {
  list.addEventListener('dragover', (e) => {
    if (!dragged) return;
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
    if (!dragged) return;
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

const groupCards = () => [...$('#groups').querySelectorAll('.card')];

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

// ---- "This window" view ----

function liveGroupCard(group, tabs, hex) {
  const card = el('article', { className: 'card' });
  card.style.setProperty('--c', hex);
  card.dataset.groupId = group.id;
  dropZone(card, group.id, (tabIds) => chrome.tabs.group({ groupId: group.id, tabIds }));

  const title = el('input', {
    className: 'title',
    value: group.title ?? '',
    placeholder: 'Untitled group',
    onchange: () => chrome.tabGroups.update(group.id, { title: title.value }),
  });
  const grip = el('span', { className: 'grip', textContent: '⠿', title: 'Drag to reorder' });
  const list = el('ul', { className: 'tab-list' }, ...tabs.map((t) => tabRow(t)));
  tabDropList(list, group.id);
  makeGroupDraggable(grip, card, group.id);

  const picker = colorPicker(hex, (color) => run(() => groups.setGroupColor(group.id, color)));
  picker.hidden = !pickerOpen.has(group.id);
  const dot = el('button', {
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
  dot.setAttribute('aria-expanded', !picker.hidden);

  const { toggle, body, expand } = collapsible(
    `live:${group.id}`,
    plural(tabs.length, 'tab'),
    picker,
    list,
    el(
      'div',
      { className: 'actions' },
      el('button', {
        className: 'btn',
        textContent: 'Ungroup',
        onclick: () => run(() => chrome.tabs.ungroup(tabs.map((t) => t.id))),
      }),
      el('button', {
        className: 'btn',
        textContent: 'Export',
        title: 'Download this group as a JSON file',
        onclick: () => run(async () => downloadGroup((await groups.snapshotLiveGroup(group.id)).entry)),
      }),
      el('button', {
        className: 'btn',
        textContent: 'Save',
        title: 'Save this group so you can reopen it later',
        onclick: () => run(async () => flash(`Saved “${(await groups.saveLiveGroup(group.id)).title}”`)),
      }),
      el('button', {
        className: 'btn primary',
        textContent: 'Save & close',
        onclick: () => run(async () => flash(`Saved and closed “${(await groups.saveLiveGroup(group.id, { close: true })).title}”`)),
      }),
    ),
  );

  card.append(el('header', {}, grip, dot, title, toggle), body);
  return card;
}

async function renderCurrent() {
  const [tabs, liveGroups, custom] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
    store.getCustomColors(),
  ]);

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

  $('#groups').replaceChildren(
    ...(liveGroups.length
      ? liveGroups.map((g) => liveGroupCard(g, tabs.filter((t) => t.groupId === g.id), groups.groupHex(g, custom)))
      : [el('p', { className: 'empty', textContent: 'No groups yet. Drag a tab from below to start one.' })]),
  );

  const ungrouped = tabs.filter((t) => t.groupId === NONE && !t.pinned);
  $('#ungrouped').replaceChildren(
    ...(ungrouped.length
      ? ungrouped.map((t) => tabRow(t, { selectable: true }))
      : [el('li', { className: 'empty', textContent: 'Every tab is in a group.' })]),
  );

  if (focusGroupId != null) {
    $(`.card[data-group-id="${focusGroupId}"] .title`)?.focus();
    focusGroupId = null;
  }
}

$('#dedupe').onclick = () =>
  run(async () => {
    const { merged, closed } = await groups.deduplicate(windowId);
    const parts = [merged && `merged ${plural(merged, 'group')}`, closed && `closed ${plural(closed, 'duplicate tab')}`].filter(Boolean);
    flash(parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'No duplicates found');
  });

for (const button of document.querySelectorAll('.import')) {
  button.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('import/import.html') });
}

// ---- "Saved" view ----

function savedCard(entry) {
  const card = el('article', { className: 'card' });
  card.style.setProperty('--c', entry.color);

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

  card.append(el('header', {}, el('span', { className: 'dot' }), el('h3', { textContent: entry.title }), toggle), body);
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
}

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
