# Architecture

## Public side

`index.php`
- accepts only the current or next year;
- reads `data/calendars.json` and `data/shading.json`;
- fetches cached public ICS events;
- renders a twelve-month public planner.

## ICS

`lib/ics.php`
- server-side HTTPS fetch, avoiding browser CORS restrictions;
- lightweight VEVENT parser;
- per-calendar/per-year JSON cache;
- no persistent history.

## Admin

`admin/index.php`
- CRUD for public ICS calendar definitions;
- CRUD for shading ranges;
- manual feed refresh;
- file writes only.

Authentication is intentionally external to the application. Protect the `/admin/` directory with the web server or host control panel.

## Storage

No SQL, D1, KV, Microsoft Graph or OAuth.

Persistent files:
- `data/calendars.json`
- `data/shading.json`

Ephemeral/rebuildable files:
- `data/cache/*.json`


## Scheduled calendar refresh

Both deployment modes support automatic refresh.

### Cloudflare

`wrangler.jsonc` defines a Cron Trigger:

```text
0 */3 * * *
```

`cloudflare/worker.ts` implements `scheduled()` and refreshes enabled calendars for the current and next year.

### PHP

`sync.php` is a CLI-only script intended to be called by the hosting provider's cron scheduler.

Recommended default:

```text
0 */3 * * *
```
