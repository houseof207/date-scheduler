import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RETENTION_DAYS, Store, deleteOn, isExpired, randomId, verifyToken } from './lib/store.js';
import * as v from './lib/validate.js';

const { HttpError, LIMITS } = v;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const ID = '([A-Za-z0-9_-]{1,64})';
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

// ---------- helpers ----------

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJSON(req, limit = 64 * 1024) {
  if (!(req.headers['content-type'] || '').includes('application/json')) {
    throw new HttpError(415, 'Expected a JSON body.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

/** Rejects date lists that would make the event expire immediately. */
function notExpired(fields) {
  if (isExpired(fields.options)) {
    throw new HttpError(400, `Add at least one date from the last ${RETENTION_DAYS} days or later.`);
  }
  return fields;
}

function must(value, message = 'Not found.') {
  if (!value) throw new HttpError(404, message);
  return value;
}

async function serveFile(req, res, file, extraHeaders = {}) {
  let stat;
  try {
    stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error();
  } catch {
    return sendText(res, 404, 'Not found');
  }
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ETag: etag,
    ...extraHeaders,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  res.end(await fs.readFile(file));
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

// ---------- views ----------

function publicView(ev) {
  return {
    id: ev.id,
    title: ev.title,
    description: ev.description,
    timezone: ev.timezone,
    options: ev.options,
    closed: ev.closed,
    showResponses: ev.showResponses,
    responseCount: ev.responses.length,
    responses: ev.showResponses
      ? ev.responses.map((r) => ({ id: r.id, name: r.name, selections: r.selections }))
      : [],
  };
}

function adminView(ev) {
  const { adminHash, responses, ...rest } = ev;
  return { ...rest, deleteOn: deleteOn(ev.options), responses: responses.map(({ editHash, ...r }) => r) };
}

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // avoid spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(ev) {
  const label = (o) => [o.date, o.start && (o.end ? `${o.start}-${o.end}` : o.start)].filter(Boolean).join(' ');
  const rows = [['Name', ...ev.options.map(label), 'Responded']];
  for (const r of ev.responses) {
    const picked = new Set(r.selections);
    rows.push([r.name, ...ev.options.map((o) => (picked.has(o.id) ? 'yes' : '')), r.updatedAt]);
  }
  rows.push(['Total', ...ev.options.map((o) => ev.responses.filter((r) => r.selections.includes(o.id)).length), '']);
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- API ----------

async function handleApi(req, res, url, store) {
  const p = url.pathname;
  const method = req.method;
  let m;

  // Create an event
  if (p === '/api/events' && method === 'POST') {
    const body = await readJSON(req);
    const fields = notExpired(v.eventFields(body, [], () => randomId(6)));
    const { event, adminToken } = await store.createEvent(fields);
    return sendJSON(res, 201, { id: event.id, adminToken });
  }

  // Public event view (optionally including the caller's own response)
  if ((m = p.match(new RegExp(`^/api/events/${ID}$`))) && method === 'GET') {
    const ev = must(store.getEvent(m[1]), 'Event not found.');
    const view = publicView(ev);
    const rid = url.searchParams.get('response');
    const token = req.headers['x-edit-token'];
    if (rid && token) {
      const r = store.findResponse(ev, rid);
      if (r && verifyToken(token, r.editHash)) view.mine = { id: r.id, name: r.name, selections: r.selections };
    }
    return sendJSON(res, 200, view);
  }

  // Submit availability
  if ((m = p.match(new RegExp(`^/api/events/${ID}/responses$`))) && method === 'POST') {
    const ev = must(store.getEvent(m[1]), 'Event not found.');
    const body = await readJSON(req);
    if (ev.closed) throw new HttpError(409, 'This event is no longer accepting responses.');
    if (ev.responses.length >= LIMITS.responses) throw new HttpError(409, 'This event has reached its response limit.');
    const { response, editToken } = await store.addResponse(ev, v.responseFields(body, ev.options));
    return sendJSON(res, 201, { id: response.id, editToken });
  }

  // Update your own availability
  if ((m = p.match(new RegExp(`^/api/events/${ID}/responses/${ID}$`))) && method === 'PUT') {
    const ev = must(store.getEvent(m[1]), 'Event not found.');
    const body = await readJSON(req);
    const r = must(store.findResponse(ev, m[2]), 'Response not found.');
    if (!verifyToken(body.editToken, r.editHash)) throw new HttpError(403, 'You can only change your own response.');
    if (ev.closed) throw new HttpError(409, 'This event is no longer accepting responses.');
    await store.updateResponse(r, v.responseFields(body, ev.options));
    return sendJSON(res, 200, { id: r.id });
  }

  // ----- admin (secret token) -----
  if ((m = p.match(new RegExp(`^/api/admin/${ID}$`)))) {
    const ev = must(store.getEventByAdminToken(m[1]), 'Setup link not recognized.');
    if (method === 'GET') return sendJSON(res, 200, adminView(ev));
    if (method === 'PUT') {
      const body = await readJSON(req);
      const patch = {
        ...notExpired(v.eventFields(body, ev.options, () => randomId(6))),
        showResponses: v.bool(body.showResponses, 'showResponses'),
        closed: v.bool(body.closed, 'closed'),
      };
      await store.updateEvent(ev, patch);
      return sendJSON(res, 200, adminView(ev));
    }
    if (method === 'DELETE') {
      await store.deleteEvent(ev);
      res.writeHead(204);
      return res.end();
    }
  }

  if ((m = p.match(new RegExp(`^/api/admin/${ID}/responses/${ID}$`))) && method === 'DELETE') {
    const ev = must(store.getEventByAdminToken(m[1]), 'Setup link not recognized.');
    must(await store.deleteResponse(ev, m[2]), 'Response not found.');
    res.writeHead(204);
    return res.end();
  }

  if ((m = p.match(new RegExp(`^/api/admin/${ID}/export\\.csv$`))) && method === 'GET') {
    const ev = must(store.getEventByAdminToken(m[1]), 'Setup link not recognized.');
    const slug = ev.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-responses.csv"`,
      'Cache-Control': 'no-store',
    });
    return res.end(toCSV(ev));
  }

  throw new HttpError(404, 'Not found.');
}

// ---------- pages & static ----------

async function handlePage(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
  const p = url.pathname;
  const noindex = { 'X-Robots-Tag': 'noindex, nofollow' };

  if (p === '/') return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
  if (new RegExp(`^/e/${ID}/?$`).test(p)) return serveFile(req, res, path.join(PUBLIC_DIR, 'event.html'), noindex);
  if (new RegExp(`^/admin/${ID}/?$`).test(p)) {
    return serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'), { ...noindex, 'Cache-Control': 'no-store' });
  }
  if (p.startsWith('/assets/')) {
    const file = path.resolve(ASSETS_DIR, decodeURIComponent(p.slice('/assets/'.length)));
    if (!file.startsWith(ASSETS_DIR + path.sep)) return sendText(res, 404, 'Not found');
    return serveFile(req, res, file);
  }
  if (p === '/favicon.ico') return serveFile(req, res, path.join(ASSETS_DIR, 'favicon.svg'));
  res.writeHead(404, { 'Content-Type': MIME['.html'] });
  res.end(await fs.readFile(path.join(PUBLIC_DIR, '404.html')));
}

export async function createApp({ dataFile } = {}) {
  const store = new Store(dataFile ?? process.env.DATA_FILE ?? path.join(ROOT, 'data', 'db.json'));
  await store.load();

  // Remove events that have passed their retention window.
  const purge = setInterval(() => store.purgeExpired().catch((err) => console.error('Purge failed:', err)), PURGE_INTERVAL_MS);
  purge.unref();

  const server = http.createServer(async (req, res) => {
    for (const [k, val] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, val);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendText(res, 400, 'Bad request');
    }
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url, store);
      else await handlePage(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return sendJSON(res, err.status, { error: err.message });
      if (err instanceof URIError) return sendText(res, 400, 'Bad request');
      console.error(err);
      sendJSON(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  });

  server.on('close', () => clearInterval(purge));
  return { server, store };
}

// Start when run directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const { server, store } = await createApp();
  server.listen(port, host, () => console.log(`Whenever running at http://${host}:${port}`));

  const shutdown = () => {
    server.close();
    store.flush().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
