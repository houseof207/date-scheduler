import {
  api,
  browserTimezone,
  checkIcon,
  countVotes,
  el,
  formatDate,
  formatOption,
  formatTimeRange,
  groupByDate,
  plural,
  readLocal,
  renderGrid,
  showError,
  timezoneName,
  writeLocal,
} from './common.js';

const eventId = decodeURIComponent(location.pathname.split('/')[2] || '');
const mineKey = `whenever:response:${eventId}`;

const $ = (id) => document.getElementById(id);
const form = $('response-form');
const nameInput = $('name');
const slotsBox = $('slots');
const toggleAllBtn = $('toggle-all');
const submitBtn = $('submit-btn');
const errorBox = $('form-error');
const savedNote = $('saved-note');

let event = null;
let mine = readLocal(mineKey); // { id, editToken } for this browser's response
let selected = new Set();
let firstLoad = true;

async function load() {
  const headers = mine ? { 'X-Edit-Token': mine.editToken } : {};
  const query = mine ? `?response=${encodeURIComponent(mine.id)}` : '';
  try {
    event = await api('GET', `/api/events/${encodeURIComponent(eventId)}${query}`, null, headers);
  } catch (err) {
    $('loading').hidden = true;
    $('not-found').hidden = false;
    if (err.status !== 404) $('not-found-msg').textContent = err.message;
    return;
  }

  // The stored response was deleted by the organizer (or never matched).
  if (mine && !event.mine) {
    mine = null;
    writeLocal(mineKey, null);
  }

  if (firstLoad) {
    if (event.mine) {
      nameInput.value = event.mine.name;
      selected = new Set(event.mine.selections);
    }
    firstLoad = false;
  }
  render();
}

function render() {
  document.title = `${event.title} · Whenever`;
  $('loading').hidden = true;
  $('event').hidden = false;
  $('ev-title').textContent = event.title;
  $('ev-desc').textContent = event.description;
  $('ev-desc').hidden = !event.description;

  const tz = timezoneName(event.timezone);
  $('tz-note').textContent =
    event.timezone === browserTimezone() ? `Times in ${tz}` : `Times in ${tz}, which may differ from yours`;

  $('closed-banner').hidden = !event.closed;
  for (const node of form.querySelectorAll('input, button')) node.disabled = event.closed;

  renderSlots();
  renderIdentity();

  const section = $('responses-section');
  section.hidden = !event.showResponses;
  if (event.showResponses) {
    $('resp-count').textContent = plural(event.responseCount, 'response');
    $('grid').replaceChildren(renderGrid(event, { highlightId: event.mine?.id }));
  }
}

function renderSlots() {
  const { counts } = event.showResponses ? countVotes(event) : { counts: null };
  slotsBox.replaceChildren(
    ...groupByDate(event.options).map(({ date, items }) =>
      el(
        'div',
        { class: 'slot-group' },
        el('div', { class: 'slot-group-date' }, formatDate(date, { weekday: 'long' })),
        el(
          'div',
          { class: 'slots' },
          items.map((o) => {
            const btn = el(
              'button',
              {
                type: 'button',
                class: 'slot',
                'aria-pressed': String(selected.has(o.id)),
                'aria-label': formatOption(o),
                disabled: event.closed,
              },
              el('span', { class: 'check' }, checkIcon()),
              el('span', { class: 'slot-time' }, formatTimeRange(o)),
              counts && counts.get(o.id) > 0
                ? el('span', { class: 'slot-count', title: 'People available' }, counts.get(o.id))
                : null,
            );
            btn.addEventListener('click', () => {
              if (selected.has(o.id)) selected.delete(o.id);
              else selected.add(o.id);
              btn.setAttribute('aria-pressed', String(selected.has(o.id)));
              updateToggleAll();
              savedNote.hidden = true;
            });
            return btn;
          }),
        ),
      ),
    ),
  );
  updateToggleAll();
}

function updateToggleAll() {
  const all = event.options.length > 0 && event.options.every((o) => selected.has(o.id));
  toggleAllBtn.textContent = all ? 'Clear all' : 'Select all';
}

toggleAllBtn.addEventListener('click', () => {
  const all = event.options.every((o) => selected.has(o.id));
  selected = all ? new Set() : new Set(event.options.map((o) => o.id));
  renderSlots();
  savedNote.hidden = true;
});

function renderIdentity() {
  submitBtn.textContent = mine ? 'Update availability' : 'Submit availability';
  $('not-you').hidden = !mine || event.closed;
  if (mine) $('not-you-name').textContent = event.mine?.name ?? '';
}

$('new-response').addEventListener('click', () => {
  mine = null;
  writeLocal(mineKey, null);
  nameInput.value = '';
  selected = new Set();
  savedNote.hidden = true;
  render();
  nameInput.focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(errorBox, '');
  const name = nameInput.value.trim();
  if (!name) {
    showError(errorBox, 'Please enter your name.');
    nameInput.focus();
    return;
  }

  const body = { name, selections: [...selected] };
  const wasUpdate = Boolean(mine);
  submitBtn.disabled = true;
  try {
    if (mine) {
      await api('PUT', `/api/events/${encodeURIComponent(eventId)}/responses/${encodeURIComponent(mine.id)}`, {
        ...body,
        editToken: mine.editToken,
      });
    } else {
      const { id, editToken } = await api('POST', `/api/events/${encodeURIComponent(eventId)}/responses`, body);
      mine = { id, editToken };
      writeLocal(mineKey, mine);
    }
    await load();
    savedNote.replaceChildren(
      el('strong', {}, wasUpdate ? 'Updated.' : 'Thanks!'),
      ' You can come back to this page in this browser to change your answers.',
    );
    savedNote.hidden = false;
  } catch (err) {
    showError(errorBox, err.message);
    // The organizer may have closed the event or changed the times in the meantime.
    if (err.status === 409 || err.status === 403) load();
  } finally {
    submitBtn.disabled = Boolean(event?.closed);
  }
});

load();
