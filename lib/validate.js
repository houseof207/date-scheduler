export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const LIMITS = {
  title: 120,
  description: 1000,
  name: 60,
  options: 60,
  responses: 500,
};

const bad = (message) => new HttpError(400, message);
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function text(value, field, { min = 0, max, multiline = false }) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw bad(`${field} must be text.`);
  let s = value.replace(CONTROL_CHARS, '');
  s = multiline
    ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : s.replace(/\s+/g, ' ').trim();
  if (s.length < min) throw bad(min === 1 ? `${field} is required.` : `${field} is too short.`);
  if (s.length > max) throw bad(`${field} must be ${max} characters or fewer.`);
  return s;
}

export function timezone(value) {
  if (value == null || value === '') return 'UTC';
  if (typeof value !== 'string' || value.length > 64) throw bad('Invalid time zone.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw bad('Invalid time zone.');
  }
  return value;
}

export function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export function isTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

/**
 * Validates a list of date/time options. Options that carry the id of an
 * existing option keep it (so responses stay attached); others get a new id.
 */
export function options(list, existing = [], makeId) {
  if (!Array.isArray(list) || list.length === 0) throw bad('Add at least one date.');
  if (list.length > LIMITS.options) throw bad(`You can add up to ${LIMITS.options} times.`);

  const existingIds = new Set(existing.map((o) => o.id));
  const usedIds = new Set();
  const seen = new Set();
  const out = [];

  for (const o of list) {
    if (!o || typeof o !== 'object') throw bad('Invalid date option.');
    const { date } = o;
    const start = o.start || '';
    const end = o.end || '';
    if (!isDate(date)) throw bad('One of the dates is invalid.');
    if (start && !isTime(start)) throw bad('One of the start times is invalid.');
    if (end && !isTime(end)) throw bad('One of the end times is invalid.');
    if (end && !start) throw bad('An end time needs a start time.');
    if (end && end <= start) throw bad('End times must be after start times.');

    const key = `${date}|${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let id = typeof o.id === 'string' && existingIds.has(o.id) && !usedIds.has(o.id) ? o.id : null;
    if (!id) {
      do id = makeId();
      while (existingIds.has(id) || usedIds.has(id));
    }
    usedIds.add(id);
    out.push({ id, date, start, end });
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return out;
}

export function selections(list, eventOptions) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw bad('Invalid selections.');
  const valid = new Set(eventOptions.map((o) => o.id));
  // Keep chronological order and drop unknown or duplicate ids.
  const picked = new Set(list.filter((id) => typeof id === 'string' && valid.has(id)));
  return eventOptions.map((o) => o.id).filter((id) => picked.has(id));
}

export function bool(value, field) {
  if (typeof value !== 'boolean') throw bad(`${field} must be true or false.`);
  return value;
}

export function eventFields(body, existingOptions, makeId) {
  return {
    title: text(body.title, 'Event name', { min: 1, max: LIMITS.title }),
    description: text(body.description, 'Details', { max: LIMITS.description, multiline: true }),
    timezone: timezone(body.timezone),
    options: options(body.options, existingOptions, makeId),
  };
}

export function responseFields(body, eventOptions) {
  return {
    name: text(body.name, 'Name', { min: 1, max: LIMITS.name }),
    selections: selections(body.selections, eventOptions),
  };
}
