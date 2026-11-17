import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const randomId = (bytes) => crypto.randomBytes(bytes).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function verifyToken(token, hash) {
  if (typeof token !== 'string' || typeof hash !== 'string') return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const now = () => new Date().toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Events are deleted this many days after their last date option. */
export const RETENTION_DAYS = 14;

/**
 * The last day an event is kept (YYYY-MM-DD): its latest date option plus
 * RETENTION_DAYS. It's deleted once that day has ended (in UTC).
 */
export function deleteOn(options) {
  const last = options.reduce((max, o) => (o.date > max ? o.date : max), '');
  if (!last) return null;
  return new Date(Date.parse(`${last}T00:00:00Z`) + RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
}

export function isExpired(options, at = Date.now()) {
  const day = deleteOn(options);
  return day !== null && at >= Date.parse(`${day}T00:00:00Z`) + DAY_MS;
}

/**
 * All events live in memory and are written to a single JSON file after every
 * change. Writes are serialized and atomic (write temp file, then rename).
 * Secret tokens are never stored, only their SHA-256 hashes. Events expire
 * RETENTION_DAYS after their last date; expired events are treated as gone
 * right away and removed from disk by purgeExpired().
 */
export class Store {
  #file;
  #events = new Map();
  #byAdminHash = new Map();
  #queue = Promise.resolve();

  constructor(file) {
    this.#file = file;
  }

  async load() {
    let raw;
    try {
      raw = await fs.readFile(this.#file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    const data = JSON.parse(raw);
    for (const ev of Object.values(data.events ?? {})) {
      this.#events.set(ev.id, ev);
      this.#byAdminHash.set(ev.adminHash, ev.id);
    }
    await this.purgeExpired();
  }

  /** Deletes every expired event. Returns how many were removed. */
  async purgeExpired(at = Date.now()) {
    let removed = 0;
    for (const ev of this.#events.values()) {
      if (!isExpired(ev.options, at)) continue;
      this.#events.delete(ev.id);
      this.#byAdminHash.delete(ev.adminHash);
      removed++;
    }
    if (removed) await this.#persist();
    return removed;
  }

  /** Resolves once every pending write has hit the disk. */
  flush() {
    return this.#queue;
  }

  #persist() {
    const snapshot = JSON.stringify({ version: 1, events: Object.fromEntries(this.#events) }, null, 2);
    const write = this.#queue.then(async () => {
      await fs.mkdir(path.dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, snapshot);
      await fs.rename(tmp, this.#file);
    });
    this.#queue = write.catch((err) => console.error('Failed to save data:', err));
    return write;
  }

  getEvent(id) {
    const ev = this.#events.get(id);
    return ev && !isExpired(ev.options) ? ev : null;
  }

  getEventByAdminToken(token) {
    const id = this.#byAdminHash.get(hashToken(token));
    return id ? this.getEvent(id) : null;
  }

  async createEvent(fields) {
    let id;
    do id = randomId(6);
    while (this.#events.has(id));
    const adminToken = randomId(24);
    const event = {
      id,
      adminHash: hashToken(adminToken),
      ...fields,
      showResponses: true,
      closed: false,
      createdAt: now(),
      updatedAt: now(),
      responses: [],
    };
    this.#events.set(id, event);
    this.#byAdminHash.set(event.adminHash, id);
    await this.#persist();
    return { event, adminToken };
  }

  async updateEvent(event, patch) {
    Object.assign(event, patch, { updatedAt: now() });
    // Drop votes for any times that were removed.
    const ids = new Set(event.options.map((o) => o.id));
    for (const r of event.responses) r.selections = r.selections.filter((id) => ids.has(id));
    await this.#persist();
    return event;
  }

  async deleteEvent(event) {
    this.#events.delete(event.id);
    this.#byAdminHash.delete(event.adminHash);
    await this.#persist();
  }

  findResponse(event, responseId) {
    return event.responses.find((r) => r.id === responseId) ?? null;
  }

  async addResponse(event, fields) {
    let id;
    do id = randomId(6);
    while (this.findResponse(event, id));
    const editToken = randomId(18);
    const response = { id, ...fields, editHash: hashToken(editToken), createdAt: now(), updatedAt: now() };
    event.responses.push(response);
    await this.#persist();
    return { response, editToken };
  }

  async updateResponse(response, fields) {
    Object.assign(response, fields, { updatedAt: now() });
    await this.#persist();
    return response;
  }

  async deleteResponse(event, responseId) {
    const before = event.responses.length;
    event.responses = event.responses.filter((r) => r.id !== responseId);
    if (event.responses.length === before) return false;
    await this.#persist();
    return true;
  }
}
