// ---------- DOM ----------

/** Tiny element builder. Children are added as text nodes, so user content is never parsed as HTML. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

let toastTimer;
export function toast(message) {
  let node = document.querySelector('.toast');
  if (!node) {
    node = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Press ⌘C / Ctrl+C to copy');
  }
}

export function showError(node, message) {
  node.textContent = message || '';
  node.hidden = !message;
}

// ---------- API ----------

export async function api(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- local storage (per browser, best effort) ----------

export function readLocal(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: features degrade gracefully */
  }
}

// One-time move of data saved under the app's previous name. Safe to delete
// once events created before the rename have expired.
try {
  const OLD_PREFIX = 'whenever:';
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(OLD_PREFIX)) continue;
    const newKey = `nownownow:${key.slice(OLD_PREFIX.length)}`;
    if (localStorage.getItem(newKey) == null) localStorage.setItem(newKey, localStorage.getItem(key));
    localStorage.removeItem(key);
  }
} catch {
  /* storage unavailable */
}

const MY_EVENTS = 'nownownow:my-events';
export const myEvents = {
  list: () => readLocal(MY_EVENTS, []),
  save(entry) {
    const list = myEvents.list().filter((e) => e.id !== entry.id);
    writeLocal(MY_EVENTS, [entry, ...list].slice(0, 50));
  },
  remove(id) {
    writeLocal(MY_EVENTS, myEvents.list().filter((e) => e.id !== id));
  },
};

// ---------- formatting ----------
// Dates and times are stored as wall-clock values in the event's time zone,
// so we format them as UTC to show exactly what the organizer entered.

function utcDate(date, time = '12:00') {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min));
}

export function formatDate(date, { weekday = 'short', year } = {}) {
  const d = utcDate(date);
  const showYear = year ?? d.getUTCFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday,
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  });
}

export function formatTime(time) {
  return utcDate('2000-01-01', time).toLocaleTimeString(undefined, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTimeRange(option) {
  if (!option.start) return 'All day';
  return option.end ? `${formatTime(option.start)} – ${formatTime(option.end)}` : formatTime(option.start);
}

export function formatOption(option) {
  return `${formatDate(option.date)}, ${formatTimeRange(option)}`;
}

export function groupByDate(options) {
  const groups = new Map();
  for (const o of options) {
    if (!groups.has(o.date)) groups.set(o.date, []);
    groups.get(o.date).push(o);
  }
  return [...groups].map(([date, items]) => ({ date, items }));
}

export function timezoneName(tz) {
  let abbr = '';
  try {
    abbr = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    /* ignore */
  }
  const name = tz.replace(/_/g, ' ').replace(/\//g, ' / ');
  return abbr && abbr !== tz ? `${name} (${abbr})` : name;
}

export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function fillTimezoneSelect(select, value) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    /* older browsers */
  }
  if (!zones.includes('UTC')) zones.push('UTC');
  if (value && !zones.includes(value)) zones.push(value);
  select.replaceChildren(...zones.sort().map((z) => el('option', { value: z }, timezoneName(z))));
  select.value = value || browserTimezone();
}

export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

// ---------- options editor (create + setup pages) ----------

const toMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const optionKey = (o) => `${o.date}|${o.start || ''}|${o.end || ''}`;
const sortOptions = (list) =>
  list.sort((a, b) => optionKey(a).localeCompare(optionKey(b)));

function plusIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M10 3v14M3 10h14');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}

function strokeIcon(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}
const calendarIcon = () =>
  strokeIcon('M4.5 4.5h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1ZM3.5 8.5h13M7 2.5v4M13 2.5v4');
const clockIcon = () => strokeIcon('M10 3a7 7 0 1 1 0 14a7 7 0 1 1 0-14ZM10 6.5V10l2.5 1.5');

/** Icon button placed in front of a field; opens that field's native picker. */
function pickerButton(label, icon) {
  return el('button', { type: 'button', class: 'picker-btn', title: label, 'aria-label': label }, icon);
}

/** Wraps a time input with a clock button in front (the browser's own icon, which sits after the text, is hidden). */
function createTimeField(input, label) {
  const btn = pickerButton(label, clockIcon());
  input.classList.add('picker-input');
  btn.addEventListener('click', () => {
    try {
      input.showPicker();
    } catch {
      input.focus(); // no programmatic picker for time fields in this browser
    }
  });
  return el('div', { class: 'picker-field' }, btn, input);
}

// ---------- short date field (two-digit year) ----------
// Native date inputs always show the locale's full year and can't be reformatted,
// so the visible field is text ("02/16/27", in the visitor's day/month/year order)
// and a hidden native input supplies the calendar picker.

const SHORT_DATE = (() => {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(2027, 1, 16));
    const order = parts.filter((p) => ['year', 'month', 'day'].includes(p.type)).map((p) => p.type);
    const sep = parts.find((p) => p.type === 'literal')?.value.trim() || '/';
    if (order.length === 3) return { order, sep };
  } catch {
    /* fall through */
  }
  return { order: ['month', 'day', 'year'], sep: '/' };
})();
const SHORT_DATE_HINT = SHORT_DATE.order.map((t) => ({ month: 'mm', day: 'dd', year: 'yy' })[t]).join(SHORT_DATE.sep);
const pad2 = (n) => String(n).padStart(2, '0');

/** "2027-02-16" → "02/16/27" (in the visitor's order). */
function formatShortDate(iso) {
  const [y, m, d] = iso.split('-');
  const values = { year: y.slice(-2), month: m, day: d };
  return SHORT_DATE.order.map((t) => values[t]).join(SHORT_DATE.sep);
}

/** "2/16/27", "02/16/2027" or "021627" → "2027-02-16"; null if it isn't a real date. Two-digit years are 20xx. */
function parseShortDate(text) {
  const nums = text.trim().split(/\D+/).filter(Boolean);
  let parts;
  if (nums.length === 3) parts = nums;
  else if (nums.length === 1 && /^\d{6}$/.test(nums[0])) parts = nums[0].match(/\d{2}/g);
  else return null;
  const v = {};
  SHORT_DATE.order.forEach((t, i) => (v[t] = parts[i]));
  if (v.year.length !== 2 && v.year.length !== 4) return null;
  const y = Number(v.year) + (v.year.length === 2 ? 2000 : 0);
  const m = Number(v.month);
  const d = Number(v.day);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function createShortDateField({ id, onPick }) {
  const text = el('input', {
    type: 'text',
    id,
    class: 'date-text picker-input',
    inputmode: 'numeric',
    autocomplete: 'off',
    maxlength: 10,
    placeholder: SHORT_DATE_HINT,
    'aria-label': `Date (${SHORT_DATE_HINT})`,
  });
  const native = el('input', { type: 'date', class: 'date-native', tabindex: '-1', 'aria-hidden': 'true' });
  const pick = pickerButton('Pick a date from a calendar', calendarIcon());
  const wrap = el('div', { class: 'picker-field opt-date' }, pick, text, native);

  // Add the separator after the first two parts as they're typed, so "021627" reads "02/16/27".
  const sepAfter = new RegExp(`^\\d{2}(${SHORT_DATE.sep.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')}\\d{2})?$`);
  text.addEventListener('input', (e) => {
    if (e.inputType === 'insertText' && text.selectionStart === text.value.length && sepAfter.test(text.value)) {
      text.value += SHORT_DATE.sep;
    }
  });
  // Tidy what was typed ("2/16/27" → "02/16/27") once the field loses focus.
  text.addEventListener('change', () => {
    const iso = parseShortDate(text.value);
    if (iso) text.value = formatShortDate(iso);
  });

  if (typeof native.showPicker === 'function') {
    pick.addEventListener('click', () => {
      native.value = parseShortDate(text.value) || '';
      try {
        native.showPicker();
      } catch {
        text.focus();
      }
    });
    native.addEventListener('change', () => {
      if (!native.value) return;
      text.value = formatShortDate(native.value);
      onPick?.();
    });
  } else {
    pick.hidden = true; // no programmatic picker in this browser: typing still works
  }

  return { wrap, text, getISO: () => parseShortDate(text.value) };
}

/**
 * Date + time picker with a list of added times.
 * `plusButton`: the Add button is a "+" icon, styled as ready (solid) once a date has been entered.
 */
export function createOptionsEditor(root, initial = [], { onChange, plusButton = false } = {}) {
  let options = sortOptions(initial.map((o) => ({ ...o })));

  const dateField = createShortDateField({
    id: 'opt-date',
    onPick: () => {
      showError(error, '');
      syncReady();
    },
  });
  const date = dateField.text;
  const start = el('input', { type: 'time', id: 'opt-start', step: 300, 'aria-label': 'Start time (optional)' });
  const end = el('input', { type: 'time', id: 'opt-end', step: 300, 'aria-label': 'End time (optional)' });
  const addBtn = plusButton
    ? el('button', { type: 'button', class: 'btn btn-primary btn-icon btn-add', 'aria-label': 'Add this time' }, plusIcon())
    : el('button', { type: 'button', class: 'btn btn-primary' }, 'Add');
  // Solid once there's a date to add, outlined before that. It stays clickable so it can explain what's missing.
  const syncReady = () => addBtn.classList.toggle('is-ready', Boolean(date.value.trim()));
  date.addEventListener('input', syncReady);
  date.addEventListener('change', syncReady);

  // Time inputs have no placeholder, so mark empty ones to mute their "--:--" text.
  const syncEmpty = () => {
    for (const input of [start, end]) input.classList.toggle('is-empty', !input.value);
  };
  for (const input of [start, end]) {
    input.addEventListener('input', syncEmpty);
    input.addEventListener('change', syncEmpty);
  }
  const error = el('p', { class: 'form-error', hidden: true, 'aria-live': 'polite' });
  const list = el('div');

  root.replaceChildren(
    el(
      'div',
      { class: 'option-adder' },
      dateField.wrap,
      el(
        'div',
        { class: 'time-range' },
        createTimeField(start, 'Pick a start time'),
        el('span', { class: 'adder-to', 'aria-hidden': 'true' }, 'to'),
        createTimeField(end, 'Pick an end time'),
      ),
      addBtn,
    ),
    error,
    list,
  );
  syncEmpty();

  // Suggest a one-hour slot when a start time is picked.
  start.addEventListener('change', () => {
    if (start.value && !end.value) end.value = fromMinutes(Math.min(toMinutes(start.value) + 60, 23 * 60 + 59));
    syncEmpty();
  });
  for (const input of [date, start, end]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
  }
  addBtn.addEventListener('click', () => add());

  function add({ quiet = false } = {}) {
    showError(error, '');
    const fail = (msg, focus) => {
      if (!quiet) {
        showError(error, msg);
        focus?.focus();
      }
      return false;
    };
    if (!date.value.trim()) return fail('Pick a date first.', date);
    const isoDate = dateField.getISO();
    if (!isoDate) return fail(`Enter the date as ${SHORT_DATE_HINT}.`, date);
    if (end.value && !start.value) return fail('Add a start time, or clear the end time.', start);
    if (end.value && end.value <= start.value) return fail('End time must be after the start time.', end);
    const option = { date: isoDate, start: start.value, end: end.value };
    if (options.some((o) => optionKey(o) === optionKey(option))) return fail('That time is already on the list.');
    options.push(option);
    sortOptions(options);
    render();
    onChange?.();
    // Keep the inputs filled so adding the same time on another day (or another
    // time on the same day) only needs one field changed.
    return true;
  }

  function remove(option) {
    options = options.filter((o) => o !== option);
    render();
    onChange?.();
  }

  function render() {
    syncReady();
    if (!options.length) {
      list.replaceChildren(el('div', { class: 'empty-note' }, 'No times yet. Pick a date and add it above.'));
      return;
    }
    list.replaceChildren(
      el(
        'div',
        { class: 'option-groups' },
        groupByDate(options).map(({ date: d, items }) =>
          el(
            'div',
            { class: 'option-group' },
            el('div', { class: 'option-group-date' }, formatDate(d)),
            el(
              'div',
              { class: 'chips' },
              items.map((o) =>
                el(
                  'span',
                  { class: 'chip' },
                  formatTimeRange(o),
                  el(
                    'button',
                    {
                      type: 'button',
                      class: 'icon-btn',
                      'aria-label': `Remove ${formatOption(o)}`,
                      title: 'Remove',
                      onclick: () => remove(o),
                    },
                    '×',
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  render();

  return {
    getOptions: () => options.map(({ id, date: d, start: s, end: e }) => ({ id, date: d, start: s, end: e })),
    /** Adds whatever is typed in the adder if the user forgot to press "Add". */
    commitPending: () => (date.value ? add({ quiet: true }) : false),
    setOptions(next) {
      options = sortOptions(next.map((o) => ({ ...o })));
      render();
    },
  };
}

// ---------- results grid (public + setup pages) ----------

export function countVotes(event) {
  const counts = new Map(event.options.map((o) => [o.id, 0]));
  for (const r of event.responses) for (const id of r.selections) counts.set(id, (counts.get(id) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  return { counts, max, best: new Set(max > 0 ? [...counts].filter(([, c]) => c === max).map(([id]) => id) : []) };
}

export function renderGrid(event, { highlightId, onDelete } = {}) {
  if (!event.responses.length) {
    return el('div', { class: 'grid-empty' }, 'No responses yet. Share the link to get started.');
  }
  const { counts, best } = countVotes(event);
  const bestCls = (o) => (best.has(o.id) ? 'best' : null);

  const head = el(
    'tr',
    {},
    el('th', { scope: 'col' }, 'Name'),
    event.options.map((o) =>
      el(
        'th',
        { scope: 'col', class: bestCls(o) },
        el('span', { class: 'col-date' }, formatDate(o.date)),
        formatTimeRange(o),
      ),
    ),
    onDelete ? el('th', { class: 'actions-col' }, el('span', { class: 'sr-only' })) : null,
  );

  const rows = event.responses.map((r) => {
    const picked = new Set(r.selections);
    const isYou = r.id === highlightId;
    return el(
      'tr',
      {},
      el(
        'th',
        { scope: 'row', class: isYou ? 'you' : null, title: r.name },
        r.name,
        isYou ? el('span', { class: 'you-tag' }, 'You') : null,
      ),
      event.options.map((o) =>
        el(
          'td',
          { class: bestCls(o) },
          picked.has(o.id)
            ? el('span', { class: 'dot', role: 'img', 'aria-label': 'Available' })
            : el('span', { class: 'no', role: 'img', 'aria-label': 'Not available' }),
        ),
      ),
      onDelete
        ? el(
            'td',
            { class: 'actions-col' },
            el(
              'button',
              {
                type: 'button',
                class: 'icon-btn',
                title: `Delete ${r.name}'s response`,
                'aria-label': `Delete ${r.name}'s response`,
                onclick: () => onDelete(r),
              },
              '×',
            ),
          )
        : null,
    );
  });

  const foot = el(
    'tr',
    {},
    el('td', {}, 'Available'),
    event.options.map((o) => el('td', { class: bestCls(o) }, counts.get(o.id))),
    onDelete ? el('td', { class: 'actions-col' }) : null,
  );

  return el('table', { class: 'grid' }, el('thead', {}, head), el('tbody', {}, rows), el('tfoot', {}, foot));
}

/** Times ranked by how many people picked them, with a bar per time. Returns null when nobody has responded. */
export function renderRanking(event) {
  if (!event.responses.length) return null;
  const { counts, max } = countVotes(event);
  const total = event.responses.length;
  const ranked = [...event.options].sort((a, b) => counts.get(b.id) - counts.get(a.id)); // stable: ties stay chronological

  return el(
    'div',
    { class: 'ranking' },
    ranked.map((o) => {
      const count = counts.get(o.id);
      const names = event.responses.filter((r) => r.selections.includes(o.id)).map((r) => r.name);
      const top = count > 0 && count === max;
      const fill = el('span');
      fill.style.width = `${(count / total) * 100}%`; // CSSOM, so it isn't blocked by the CSP
      return el(
        'div',
        { class: 'rank-row' },
        el('div', { class: 'rank-date' }, formatDate(o.date)),
        el('div', { class: 'rank-time' }, formatTimeRange(o)),
        el('div', { class: 'rank-badge' }, top ? el('span', { class: 'badge' }, count === total ? 'Everyone' : 'Best') : null),
        el('div', { class: 'rank-count', 'aria-label': `${count} of ${total} available` }, `${count}/${total}`),
        el('div', { class: 'rank-bar', 'aria-hidden': 'true' }, fill),
        names.length ? el('div', { class: 'rank-names' }, names.map((n) => el('span', {}, n))) : null,
      );
    }),
  );
}

/** Fills the "Open"/"Closed" pill and time zone note at the top of the event and setup pages. */
export function renderEyebrow(event, { pill, tz }) {
  pill.textContent = event.closed ? 'Closed' : 'Open';
  pill.classList.toggle('is-outline', event.closed);
  const name = timezoneName(event.timezone);
  tz.textContent = event.timezone === browserTimezone() ? name : `${name} · may differ from yours`;
}
