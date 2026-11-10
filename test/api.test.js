import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../server.js';
import { Store } from '../lib/store.js';

let server, store, baseUrl, dir, dataFile;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whenever-test-'));
  dataFile = path.join(dir, 'db.json');
  ({ server, store } = await createApp({ dataFile }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await store.flush();
  await fs.rm(dir, { recursive: true, force: true });
});

async function call(method, url, body, headers = {}) {
  const res = await fetch(baseUrl + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, data, headers: res.headers };
}

const sampleEvent = {
  title: '  Team   dinner ',
  description: 'Somewhere nice',
  timezone: 'America/New_York',
  options: [
    { date: '2026-12-03', start: '19:00', end: '21:00' },
    { date: '2026-12-01', start: '18:00', end: '20:00' },
    { date: '2026-12-02', start: '', end: '' },
    { date: '2026-12-01', start: '18:00', end: '20:00' }, // duplicate, dropped
  ],
};

describe('events', () => {
  let id, adminToken, event;

  test('creates an event and returns a public id and a secret admin token', async () => {
    const res = await call('POST', '/api/events', sampleEvent);
    assert.equal(res.status, 201);
    ({ id, adminToken } = res.data);
    assert.ok(id && adminToken && id !== adminToken);
  });

  test('public view is sorted, normalized, and has no secrets', async () => {
    const res = await call('GET', `/api/events/${id}`);
    assert.equal(res.status, 200);
    event = res.data;
    assert.equal(event.title, 'Team dinner');
    assert.equal(event.options.length, 3);
    assert.deepEqual(event.options.map((o) => o.date), ['2026-12-01', '2026-12-02', '2026-12-03']);
    assert.equal(event.showResponses, true);
    assert.ok(!JSON.stringify(event).includes('adminHash'));
  });

  test('rejects invalid events', async () => {
    for (const body of [
      { ...sampleEvent, title: '' },
      { ...sampleEvent, options: [] },
      { ...sampleEvent, options: [{ date: '2026-02-30' }] },
      { ...sampleEvent, options: [{ date: '2026-12-01', start: '10:00', end: '09:00' }] },
      { ...sampleEvent, options: [{ date: '2026-12-01', end: '09:00' }] },
      { ...sampleEvent, timezone: 'Mars/Olympus' },
    ]) {
      const res = await call('POST', '/api/events', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(res.data.error);
    }
  });

  test('requires a JSON content type', async () => {
    const res = await fetch(`${baseUrl}/api/events`, { method: 'POST', body: 'title=x' });
    assert.equal(res.status, 415);
  });

  let alice, bob;

  test('people can respond, and responses show publicly', async () => {
    const a = await call('POST', `/api/events/${id}/responses`, {
      name: 'Alice',
      selections: [event.options[2].id, event.options[0].id, 'bogus', event.options[0].id],
    });
    assert.equal(a.status, 201);
    alice = a.data;
    const b = await call('POST', `/api/events/${id}/responses`, { name: 'Bob', selections: [event.options[0].id] });
    bob = b.data;

    const res = await call('GET', `/api/events/${id}`);
    assert.equal(res.data.responseCount, 2);
    const aliceRow = res.data.responses.find((r) => r.name === 'Alice');
    // Unknown and duplicate ids dropped, chronological order kept.
    assert.deepEqual(aliceRow.selections, [event.options[0].id, event.options[2].id]);
    assert.ok(!JSON.stringify(res.data).includes('editHash'));
  });

  test('a person can load and update only their own response', async () => {
    const mine = await call('GET', `/api/events/${id}?response=${alice.id}`, null, { 'X-Edit-Token': alice.editToken });
    assert.equal(mine.data.mine.name, 'Alice');

    const wrong = await call('GET', `/api/events/${id}?response=${alice.id}`, null, { 'X-Edit-Token': bob.editToken });
    assert.equal(wrong.data.mine, undefined);

    const forbidden = await call('PUT', `/api/events/${id}/responses/${alice.id}`, {
      name: 'Hacked',
      selections: [],
      editToken: bob.editToken,
    });
    assert.equal(forbidden.status, 403);

    const ok = await call('PUT', `/api/events/${id}/responses/${alice.id}`, {
      name: 'Alice B.',
      selections: [event.options[1].id],
      editToken: alice.editToken,
    });
    assert.equal(ok.status, 200);
  });

  test('admin view requires the secret token', async () => {
    assert.equal((await call('GET', `/api/admin/${id}`)).status, 404);
    assert.equal((await call('GET', '/api/admin/nope')).status, 404);
    const res = await call('GET', `/api/admin/${adminToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.responses.length, 2);
    assert.ok(res.data.responses[0].createdAt);
    assert.ok(!JSON.stringify(res.data).includes('Hash'));
  });

  test('admin can edit times; votes on removed times are dropped', async () => {
    const kept = event.options.filter((o) => o.id !== event.options[0].id);
    const res = await call('PUT', `/api/admin/${adminToken}`, {
      title: 'Team dinner v2',
      description: '',
      timezone: 'Europe/London',
      options: [...kept, { date: '2026-12-10', start: '12:00', end: '' }],
      showResponses: false,
      closed: false,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.options.length, 3);
    // Existing ids are preserved.
    assert.ok(kept.every((o) => res.data.options.some((n) => n.id === o.id)));
    const bobRow = res.data.responses.find((r) => r.name === 'Bob');
    assert.deepEqual(bobRow.selections, []);
  });

  test('hidden responses are not exposed publicly', async () => {
    const res = await call('GET', `/api/events/${id}`);
    assert.deepEqual(res.data.responses, []);
    assert.equal(res.data.responseCount, 2);
  });

  test('closed events reject responses', async () => {
    const admin = (await call('GET', `/api/admin/${adminToken}`)).data;
    await call('PUT', `/api/admin/${adminToken}`, { ...admin, showResponses: true, closed: true });
    const res = await call('POST', `/api/events/${id}/responses`, { name: 'Late', selections: [] });
    assert.equal(res.status, 409);
    const upd = await call('PUT', `/api/events/${id}/responses/${bob.id}`, {
      name: 'Bob',
      selections: [],
      editToken: bob.editToken,
    });
    assert.equal(upd.status, 409);
  });

  test('exports CSV safely', async () => {
    await call('PUT', `/api/admin/${adminToken}`, {
      ...(await call('GET', `/api/admin/${adminToken}`)).data,
      closed: false,
    });
    await call('POST', `/api/events/${id}/responses`, { name: '=cmd()', selections: [] });
    const res = await call('GET', `/api/admin/${adminToken}/export.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /team-dinner-v2-responses\.csv/);
    assert.match(res.data, /^\uFEFF?Name,2026-12-02,/);
    assert.match(res.data, /'=cmd\(\)/);
    assert.match(res.data, /\r\nTotal,/);
  });

  test('data persists to disk', async () => {
    await store.flush();
    const reloaded = new Store(dataFile);
    await reloaded.load();
    const ev = reloaded.getEvent(id);
    assert.equal(ev.title, 'Team dinner v2');
    assert.equal(ev.responses.length, 3);
    assert.ok(reloaded.getEventByAdminToken(adminToken));
    const raw = await fs.readFile(dataFile, 'utf8');
    assert.ok(!raw.includes(adminToken), 'admin token stored only as a hash');
  });

  test('admin can delete a response and the event', async () => {
    assert.equal((await call('DELETE', `/api/admin/${adminToken}/responses/${bob.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/admin/${adminToken}/responses/${bob.id}`)).status, 404);
    assert.equal((await call('DELETE', `/api/admin/${adminToken}`)).status, 204);
    assert.equal((await call('GET', `/api/events/${id}`)).status, 404);
    assert.equal((await call('GET', `/api/admin/${adminToken}`)).status, 404);
  });
});

describe('pages', () => {
  test('serves pages with security headers', async () => {
    for (const [url, marker] of [
      ['/', 'create.js'],
      ['/e/abc123', 'event.js'],
      ['/admin/xyz', 'admin.js'],
    ]) {
      const res = await call('GET', url);
      assert.equal(res.status, 200, url);
      assert.ok(res.data.includes(marker), url);
      assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    }
    const admin = await call('GET', '/admin/xyz');
    assert.match(admin.headers.get('x-robots-tag'), /noindex/);
  });

  test('serves assets and blocks path traversal', async () => {
    assert.equal((await call('GET', '/assets/styles.css')).status, 200);
    assert.equal((await call('GET', '/assets/js/common.js')).status, 200);
    assert.equal((await call('GET', '/assets/..%2F..%2Fserver.js')).status, 404);
    assert.equal((await call('GET', '/assets/%2e%2e/index.html')).status, 404);
    assert.equal((await call('GET', '/nope')).status, 404);
  });
});
