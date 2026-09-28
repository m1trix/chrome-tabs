import { NATIVE_COLORS, isNativeHex, nearestNativeColor, normalizeHex } from '../lib/colors.js';
import { el } from '../lib/dom.js';
import * as groups from '../lib/groups.js';
import * as store from '../lib/storage.js';

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
  if (selectable) {
    const checkbox = el('input', { type: 'checkbox', value: tab.id, onchange: updateNewGroupButton });
    return el('li', {}, el('label', {}, checkbox, favicon(tab.favIconUrl), label));
  }
  return el('li', {}, el('button', { onclick: () => chrome.tabs.update(tab.id, { active: true }) }, favicon(tab.favIconUrl), label));
}

// ---- "This window" view ----

function liveGroupCard(group, tabs, hex) {
  const card = el('article', { className: 'card' });
  card.style.setProperty('--c', hex);

  const title = el('input', {
    className: 'title',
    value: group.title ?? '',
    placeholder: 'Untitled group',
    onchange: () => chrome.tabGroups.update(group.id, { title: title.value }),
  });

  card.append(
    el('header', {}, el('span', { className: 'dot' }), title),
    colorPicker(hex, (color) => run(() => groups.setGroupColor(group.id, color))),
    el('details', {}, el('summary', { textContent: plural(tabs.length, 'tab') }), el('ul', { className: 'tab-list' }, ...tabs.map((t) => tabRow(t)))),
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
  return card;
}

let newGroupColor = null;
$('#new-group-color').replaceWith(colorPicker(null, (hex) => (newGroupColor = hex)));

function updateNewGroupButton() {
  $('#new-group button[type=submit]').disabled = !document.querySelector('#ungrouped input:checked');
}

async function renderCurrent() {
  const [tabs, liveGroups, custom] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
    store.getCustomColors(),
  ]);

  // Show groups in tab-strip order.
  const position = new Map();
  for (const t of tabs) if (t.groupId !== NONE && !position.has(t.groupId)) position.set(t.groupId, t.index);
  liveGroups.sort((a, b) => position.get(a.id) - position.get(b.id));

  $('#groups').replaceChildren(
    ...(liveGroups.length
      ? liveGroups.map((g) => liveGroupCard(g, tabs.filter((t) => t.groupId === g.id), groups.groupHex(g, custom)))
      : [el('p', { className: 'empty', textContent: 'No groups in this window yet.' })]),
  );

  const ungrouped = tabs.filter((t) => t.groupId === NONE && !t.pinned);
  $('#ungrouped').replaceChildren(
    ...(ungrouped.length
      ? ungrouped.map((t) => tabRow(t, { selectable: true }))
      : [el('li', { className: 'empty', textContent: 'Every tab is in a group.' })]),
  );
  $('#new-group').hidden = !ungrouped.length;
  updateNewGroupButton();
}

$('#auto-group').onclick = () =>
  run(async () => {
    const n = await groups.autoGroupByDomain(windowId);
    flash(n ? `Updated ${plural(n, 'group')}` : 'Nothing to group');
  });

$('#new-group').onsubmit = (e) => {
  e.preventDefault();
  const tabIds = [...document.querySelectorAll('#ungrouped input:checked')].map((i) => Number(i.value));
  const title = $('#new-group-title').value.trim();
  run(async () => {
    await groups.createGroup(tabIds, { title, color: newGroupColor, windowId });
    $('#new-group-title').value = '';
  });
};

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
        { onclick: () => chrome.tabs.create({ windowId, url: t.url }) },
        favicon(t.favIconUrl),
        el('span', { className: 'tab-title', textContent: t.title || t.url, title: t.url }),
      ),
    ),
  );

  card.append(
    el('header', {}, el('span', { className: 'dot' }), el('h3', { textContent: entry.title })),
    el('div', {
      className: 'meta',
      textContent: `${plural(entry.tabs.length, 'tab')} · saved ${new Date(entry.savedAt).toLocaleString()}`,
    }),
    el('details', {}, el('summary', { textContent: 'Show tabs' }), el('ul', { className: 'tab-list' }, ...tabs)),
    el(
      'div',
      { className: 'actions' },
      del,
      el('button', {
        className: 'btn primary',
        textContent: 'Open',
        onclick: () =>
          run(async () => {
            await groups.restoreSavedGroup(entry, windowId);
            flash(`Opened “${entry.title}”`);
          }),
      }),
    ),
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

$('#open-options').onclick = () => chrome.runtime.openOptionsPage();

await render();
