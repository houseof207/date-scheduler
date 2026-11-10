import {
  api,
  copyText,
  countVotes,
  createOptionsEditor,
  el,
  fillTimezoneSelect,
  formatDate,
  formatTimeRange,
  myEvents,
  plural,
  renderGrid,
  showError,
  timezoneName,
  toast,
} from './common.js';

const token = decodeURIComponent(location.pathname.split('/')[2] || '');
const base = `/api/admin/${encodeURIComponent(token)}`;
const $ = (id) => document.getElementById(id);

let event = null;
let editor = null;

async function load({ resultsOnly = false } = {}) {
  try {
    event = await api('GET', base);
  } catch (err) {
    if (resultsOnly) return toast(err.message);
    $('loading').hidden = true;
    $('not-found').hidden = false;
    if (err.status !== 404) $('not-found-msg').textContent = err.message;
    return;
  }
  // Remember this event on this device so it shows up on the home page.
  const known = myEvents.list().find((e) => e.id === event.id);
  myEvents.save({ id: event.id, adminToken: token, title: event.title, createdAt: known?.createdAt ?? event.createdAt });

  renderHeader();
  renderResults();
  if (!resultsOnly) renderSettings();
  $('loading').hidden = true;
  $('admin').hidden = false;
}

function renderHeader() {
  document.title = `Setup: ${event.title} · Whenever`;
  $('ev-title').textContent = event.title;
  const status = event.closed ? 'Closed' : 'Open for responses';
  $('ev-meta').textContent = `${status} · ${timezoneName(event.timezone)}`;

  const publicUrl = `${location.origin}/e/${event.id}`;
  $('public-link').value = publicUrl;
  $('open-public').href = publicUrl;
  $('admin-link').value = `${location.origin}/admin/${token}`;
  $('export').href = `${base}/export.csv`;
}

function renderResults() {
  $('resp-count').textContent = plural(event.responses.length, 'response');
  $('grid').replaceChildren(renderGrid(event, { onDelete: deleteResponse }));

  const ranking = $('ranking');
  if (!event.responses.length) {
    ranking.hidden = true;
    return;
  }
  ranking.hidden = false;
  const { counts, max } = countVotes(event);
  const total = event.responses.length;
  const ranked = [...event.options].sort((a, b) => counts.get(b.id) - counts.get(a.id)); // stable: ties stay chronological

  ranking.replaceChildren(
    el(
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
          { class: `rank-row${top ? ' top' : ''}` },
          el(
            'div',
            { class: 'rank-label' },
            formatDate(o.date),
            el('span', { class: 'muted' }, ` · ${formatTimeRange(o)}`),
            top ? el('span', { class: 'badge' }, count === total ? 'Everyone' : 'Best') : null,
          ),
          el('div', { class: 'rank-count' }, `${count}/${total}`),
          el('div', { class: 'rank-bar' }, fill),
          names.length ? el('div', { class: 'rank-names' }, names.join(', ')) : null,
        );
      }),
    ),
  );
}

function renderSettings() {
  $('title').value = event.title;
  $('description').value = event.description;
  fillTimezoneSelect($('timezone'), event.timezone);
  $('show-responses').checked = event.showResponses;
  $('closed').checked = event.closed;
  const onChange = () => ($('save-status').hidden = true);
  if (editor) editor.setOptions(event.options);
  else editor = createOptionsEditor($('options-editor'), event.options, { onChange });
}

async function deleteResponse(response) {
  if (!confirm(`Delete ${response.name}'s response? This can't be undone.`)) return;
  try {
    await api('DELETE', `${base}/responses/${encodeURIComponent(response.id)}`);
    toast('Response deleted');
    await load({ resultsOnly: true });
  } catch (err) {
    toast(err.message);
  }
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = $('settings-error');
  const status = $('save-status');
  showError(errorBox, '');
  status.hidden = true;

  editor.commitPending();
  const options = editor.getOptions();
  if (!$('title').value.trim()) return showError(errorBox, 'Give your event a name.');
  if (!options.length) return showError(errorBox, 'Add at least one date.');

  // Warn if removing times that people already picked.
  const keptIds = new Set(options.map((o) => o.id).filter(Boolean));
  const { counts } = countVotes(event);
  const lostVotes = event.options.filter((o) => !keptIds.has(o.id) && counts.get(o.id) > 0);
  if (lostVotes.length) {
    const votes = lostVotes.reduce((n, o) => n + counts.get(o.id), 0);
    const msg = `You removed ${plural(lostVotes.length, 'time')} that ${lostVotes.length === 1 ? 'has' : 'have'} ${plural(votes, 'vote')}. Those votes will be deleted. Continue?`;
    if (!confirm(msg)) return;
  }

  const btn = $('save-btn');
  btn.disabled = true;
  try {
    event = await api('PUT', base, {
      title: $('title').value,
      description: $('description').value,
      timezone: $('timezone').value,
      options,
      showResponses: $('show-responses').checked,
      closed: $('closed').checked,
    });
    renderHeader();
    renderResults();
    renderSettings();
    myEvents.save({ ...myEvents.list().find((x) => x.id === event.id), id: event.id, adminToken: token, title: event.title });
    status.replaceChildren(el('strong', {}, 'Saved.'));
    status.hidden = false;
  } catch (err) {
    showError(errorBox, err.message);
  } finally {
    btn.disabled = false;
  }
});

$('delete-event').addEventListener('click', async () => {
  const answer = prompt(`This permanently deletes "${event.title}" and all ${plural(event.responses.length, 'response')}.\n\nType DELETE to confirm.`);
  if (answer?.trim().toUpperCase() !== 'DELETE') return;
  try {
    await api('DELETE', base);
    myEvents.remove(event.id);
    location.href = '/';
  } catch (err) {
    toast(err.message);
  }
});

for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', () => copyText($(btn.dataset.copy).value));
}
$('refresh').addEventListener('click', async () => {
  await load({ resultsOnly: true });
  toast('Results updated');
});

// Pick up new responses when the organizer comes back to this tab.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && event) load({ resultsOnly: true });
});

if (location.hash === '#new') {
  $('welcome').hidden = false;
  history.replaceState(null, '', location.pathname);
}

load();
