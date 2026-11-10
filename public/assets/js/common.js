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

const SVG_NS = 'http://www.w3.org/2000/svg';
export function checkIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M2.5 6.2 5 8.5l4.5-5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
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

const MY_EVENTS = 'whenever:my-events';
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

export function createOptionsEditor(root, initial = [], { onChange } = {}) {
  let options = sortOptions(initial.map((o) => ({ ...o })));

  const date = el('input', { type: 'date', id: 'opt-date' });
  const start = el('input', { type: 'time', id: 'opt-start', step: 300 });
  const end = el('input', { type: 'time', id: 'opt-end', step: 300 });
  const addBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Add');
  const error = el('p', { class: 'form-error', hidden: true, 'aria-live': 'polite' });
  const list = el('div');

  const labelled = (cls, text, input) =>
    el('div', { class: cls }, el('label', { class: 'mini-label', for: input.id }, text), input);

  root.replaceChildren(
    el(
      'div',
      { class: 'option-adder' },
      labelled('adder-date', 'Date', date),
      labelled('', 'Start (optional)', start),
      labelled('', 'End (optional)', end),
      addBtn,
    ),
    error,
    list,
  );

  // Suggest a one-hour slot when a start time is picked.
  start.addEventListener('change', () => {
    if (start.value && !end.value) end.value = fromMinutes(Math.min(toMinutes(start.value) + 60, 23 * 60 + 59));
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
    if (!date.value) return fail('Pick a date first.', date);
    if (end.value && !start.value) return fail('Add a start time, or clear the end time.', start);
    if (end.value && end.value <= start.value) return fail('End time must be after the start time.', end);
    const option = { date: date.value, start: start.value, end: end.value };
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
        o.start ? formatTime(o.start) : 'All day',
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
            : el('span', { class: 'no', 'aria-label': 'Not available' }, '–'),
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
