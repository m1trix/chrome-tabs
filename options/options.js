import { NATIVE_COLORS, colorForKey, nearestNativeColor, normalizeHex } from '../lib/colors.js';
import { el } from '../lib/dom.js';
import { getRules, setRules } from '../lib/storage.js';

const tbody = document.getElementById('rules');
const status = document.getElementById('status');

function normalizeDomain(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '');
}

function rowFor(rule = { domain: '', name: '', color: NATIVE_COLORS.blue }) {
  const color = el('input', { type: 'color', value: rule.color, className: 'color' });
  const hint = el('span', { className: 'hint' });
  const updateHint = () => (hint.textContent = `→ ${nearestNativeColor(color.value)}`);
  color.oninput = updateHint;
  updateHint();

  const row = el(
    'tr',
    {},
    el('td', {}, el('input', { type: 'text', className: 'domain', value: rule.domain, placeholder: 'github.com' })),
    el('td', {}, el('input', { type: 'text', className: 'name', value: rule.name, placeholder: 'Code' })),
    el('td', {}, el('div', { className: 'color-cell' }, color, hint)),
    el('td', {}, el('button', { className: 'remove', title: 'Remove rule', textContent: '×', onclick: () => row.remove() })),
  );
  return row;
}

async function load() {
  const rules = await getRules();
  tbody.replaceChildren(...rules.map(rowFor));
  if (!rules.length) tbody.append(rowFor());
}

document.getElementById('add').onclick = () => {
  const row = rowFor();
  tbody.append(row);
  row.querySelector('.domain').focus();
};

document.getElementById('save').onclick = async () => {
  const rules = [...tbody.querySelectorAll('tr')]
    .map((row) => {
      const domain = normalizeDomain(row.querySelector('.domain').value);
      return {
        domain,
        name: row.querySelector('.name').value.trim(),
        color: normalizeHex(row.querySelector('.color').value) ?? colorForKey(domain),
      };
    })
    .filter((r) => r.domain);
  await setRules(rules);
  await load();
  status.textContent = `Saved ${rules.length} rule${rules.length === 1 ? '' : 's'}`;
  setTimeout(() => (status.textContent = ''), 2500);
};

await load();
