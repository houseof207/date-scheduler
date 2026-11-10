import {
  api,
  browserTimezone,
  createOptionsEditor,
  el,
  fillTimezoneSelect,
  myEvents,
  showError,
} from './common.js';

const form = document.getElementById('create-form');
const titleInput = document.getElementById('title');
const descInput = document.getElementById('description');
const tzSelect = document.getElementById('timezone');
const errorBox = document.getElementById('create-error');
const submitBtn = document.getElementById('create-btn');

const editor = createOptionsEditor(document.getElementById('options-editor'));
fillTimezoneSelect(tzSelect, browserTimezone());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(errorBox, '');

  const title = titleInput.value.trim();
  if (!title) {
    showError(errorBox, 'Give your event a name.');
    titleInput.focus();
    return;
  }
  editor.commitPending();
  const options = editor.getOptions();
  if (!options.length) {
    showError(errorBox, 'Add at least one date.');
    document.getElementById('opt-date').focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';
  try {
    const { id, adminToken } = await api('POST', '/api/events', {
      title,
      description: descInput.value,
      timezone: tzSelect.value,
      options,
    });
    myEvents.save({ id, adminToken, title, createdAt: new Date().toISOString() });
    location.href = `/admin/${adminToken}#new`;
  } catch (err) {
    showError(errorBox, err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create event';
  }
});

function renderMyEvents() {
  const section = document.getElementById('my-events');
  const list = document.getElementById('my-events-list');
  const events = myEvents.list();
  section.hidden = events.length === 0;
  list.replaceChildren(
    ...events.map((ev) =>
      el(
        'li',
        {},
        el(
          'div',
          { class: 'ev-main' },
          el('div', { class: 'ev-title' }, ev.title),
          el('div', { class: 'ev-meta' }, `Created ${new Date(ev.createdAt).toLocaleDateString()}`),
        ),
        el(
          'div',
          { class: 'ev-links' },
          el('a', { class: 'btn btn-ghost btn-sm', href: `/e/${ev.id}` }, 'Public page'),
          el('a', { class: 'btn btn-secondary btn-sm', href: `/admin/${ev.adminToken}` }, 'Setup'),
          el(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              title: 'Forget on this device',
              'aria-label': `Forget ${ev.title} on this device`,
              onclick: () => {
                if (confirm('Remove this event from your list? The event itself is not deleted, but make sure you have the setup link saved somewhere.')) {
                  myEvents.remove(ev.id);
                  renderMyEvents();
                }
              },
            },
            '×',
          ),
        ),
      ),
    ),
  );
}

renderMyEvents();
