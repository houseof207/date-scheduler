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

/**
 * All events live in memory and are written to a single JSON file after every
 * change. Writes are serialized and atomic (write temp file, then rename).
 * Secret tokens are never stored, only their SHA-256 hashes.
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
    return this.#events.get(id) ?? null;
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
