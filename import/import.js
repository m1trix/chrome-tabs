import { el } from '../lib/dom.js';
import { restoreSavedGroup } from '../lib/groups.js';
import { addSavedGroup } from '../lib/storage.js';
import { fromJson } from '../lib/transfer.js';

const drop = document.getElementById('drop');
const input = document.getElementById('file');
const results = document.getElementById('results');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function resultRow(file, entry, error) {
  if (error) {
    return el(
      'li',
      { className: 'error' },
      el('div', { className: 'info' }, el('div', { className: 'name', textContent: file.name }), el('div', { className: 'meta', textContent: error })),
    );
  }
  const meta = el('div', { className: 'meta', textContent: `${plural(entry.tabs.length, 'tab')} · added to Saved` });
  const open = el('button', {
    className: 'btn',
    textContent: 'Open now',
    onclick: async () => {
      open.disabled = true;
      const { id: windowId } = await chrome.windows.getCurrent();
      const groupId = await restoreSavedGroup(entry, windowId); // also removes it from Saved
      meta.textContent = groupId ? `${plural(entry.tabs.length, 'tab')} · opened` : "Couldn't open any of its tabs";
      open.remove();
    },
  });
  const row = el(
    'li',
    {},
    el('div', { className: 'info' }, el('div', { className: 'name', textContent: entry.title }), meta),
    open,
  );
  row.style.setProperty('--c', entry.color);
  return row;
}

async function importFiles(files) {
  for (const file of files) {
    let row;
    try {
      const entry = fromJson(await file.text());
      await addSavedGroup(entry);
      row = resultRow(file, entry);
    } catch (err) {
      row = resultRow(file, null, err.message);
    }
    results.prepend(row);
  }
}

input.onchange = () => {
  importFiles([...input.files]);
  input.value = ''; // allow picking the same file again
};

// Dropping a file anywhere on the page imports it instead of opening it in the tab.
addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) drop.classList.remove('over');
});
addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  importFiles([...e.dataTransfer.files]);
});
