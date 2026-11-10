# Whenever

A small, account-free scheduling app. Set up an event with a handful of dates and times, share a link, and let people mark which times work for them. Every response is saved so you can review it later.

## Run it

Requires Node.js 20+. There are no dependencies to install.

```sh
npm start          # http://127.0.0.1:3000
npm run dev        # same, restarts on file changes
npm test           # API + page tests
```

Environment variables:

| Variable    | Default         | Purpose                                   |
|-------------|-----------------|-------------------------------------------|
| `PORT`      | `3000`          | Port to listen on                         |
| `HOST`      | `127.0.0.1`     | Use `0.0.0.0` to accept outside traffic   |
| `DATA_FILE` | `data/db.json`  | Where events and responses are stored     |

## How it works

1. **Create** (`/`): name the event, add dates (optionally with start/end times), pick a time zone.
2. **Secret setup page** (`/admin/<token>`): you land here after creating. It holds the share links, the results (ranked best times plus a full grid), CSV export, settings, and delete. The long random token in the URL is the only key, so bookmark it.
3. **Public page** (`/e/<id>`): participants enter their name and tap the times that work. Their browser remembers their response, so they can come back and change it.

Setup-page options:
- **Show responses publicly**: whether participants can see each other's answers (on by default).
- **Close responses**: stop accepting new or changed answers.
- Editing times keeps existing votes. Removing a time deletes its votes, and you're asked to confirm first.

## Data & security notes

- All data is in one JSON file (`data/db.json`), written atomically after every change. Back that file up to keep your history.
- Setup tokens and per-response edit tokens are random, and only their SHA-256 hashes are stored.
- Pages send a strict Content-Security-Policy and `Referrer-Policy: no-referrer`, so setup links don't leak through the `Referer` header. Event and setup pages are marked `noindex`.
- The API only accepts `application/json` bodies, which blocks plain cross-site form posts.
- Anyone who can reach the home page can create events. If you host this publicly, put it behind HTTPS (e.g. Caddy or nginx), and add rate limiting or a password on `POST /api/events` if abuse is a concern.

## Layout

```
server.js            HTTP server, routing, API handlers, CSV export
lib/store.js         In-memory store persisted to a JSON file
lib/validate.js      Input validation and limits
public/              index.html (create), event.html (public), admin.html (setup)
public/assets/       styles.css, favicon, js/ (common.js shared by all pages)
test/api.test.js     node:test suite
```

## Credits

Background snow is [DHTML Snowstorm](http://schillmania.com/projects/snowstorm/) by Scott Schiller (BSD license), in `public/assets/vendor/snowstorm.js`. Its header lists two small local changes. Site settings (color, fixed positioning, reduced-motion opt-out) are in `public/assets/js/snow.js`. To turn the snow off, remove the two `<script>` tags at the end of each page.
