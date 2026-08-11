# Architecture

## Public planner

Both hosting modes use the same browser assets (`assets/app.js` and `assets/style.css`) and the same event data shape. The planner supports the previous year, current year and next year.

### Cloudflare

`cloudflare/worker.ts` renders the public HTML, serves dynamic admin/API routes, reads configuration and calendar caches from R2, and performs scheduled syncs. Static files in `assets/` are served by Cloudflare Workers Static Assets.

### PHP / traditional hosting

`index.php` renders the equivalent public toolbar and planner shell. `lib/ics.php` performs server-side ICS retrieval, recurrence expansion, timezone handling and cache generation. `assets/app.js` then renders the planner in the browser.

The release deliberately does not contain `index.html`, avoiding common Apache/nginx index-precedence problems where a stale HTML file could shadow `index.php`.

## ICS

Both implementations handle public VEVENT data including:

- DTSTART / DTEND and DURATION;
- timezone IDs (including common Windows Australian timezone names);
- recurring rules used by typical public calendar feeds;
- RDATE / EXDATE;
- RECURRENCE-ID overrides and cancellations;
- descriptions, locations and URLs;
- multi-day events.

Calendar caches are per calendar and year and are rebuildable.

## Administration

Authentication is external to the application.

### Cloudflare

Protect `/api/admin/*` with Cloudflare Access. Authorised editors use the inline Calendar Manager and Shading Manager and may switch to Public view without logging out.

### PHP

Protect `/admin/` with Apache/nginx/host authentication. The PHP admin page is intentionally simpler and provides core calendar, basic shading and manual refresh controls.

## Storage

No SQL database, Microsoft Graph, OAuth or private-calendar credentials are used.

Cloudflare persists configuration/cache JSON in R2. PHP hosting persists equivalent JSON under `data/`.

## Scheduled calendar refresh

Both deployment modes default to every three hours.

Cloudflare uses the Cron Trigger in `wrangler.jsonc`:

```text
0 */3 * * *
```

PHP hosting can run `sync.php` from the host's cron scheduler on the same cadence.
