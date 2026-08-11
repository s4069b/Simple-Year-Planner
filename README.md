# Simple Year Planner

**Version 1.0.0**

A small, self-hostable year planner for displaying **public ICS calendars** alongside optional **shading layers** such as school terms, holidays, ministry periods, shutdowns, or other planning blocks.

The project is deliberately simple:

- public ICS calendars only;
- no SQL database;
- no Microsoft Graph or OAuth integration;
- no private-calendar access;
- previous year, current year and next year only;
- calendar and shading configuration stored as JSON/files;
- inline administration for authorised users;
- automatic calendar refresh, with manual per-calendar sync available.

The same repository supports two hosting modes:

1. **Cloudflare Worker + R2**
2. **PHP-friendly web hosting**

---

## Features

Public users can:

- view a full-year planner;
- move between the previous year, current year and next year;
- show or hide individual calendars;
- show or hide shading layers;
- use the sticky calendar and shading legends while scrolling.

Administrators can additionally:

- add and edit public ICS calendars;
- choose calendar colours;
- manually sync an individual calendar;
- see when each calendar was last successfully synced;
- add and edit shading layers;
- select multiple shading ranges by dragging across dates;
- remove individual dates or ranges;
- delete shading layers;
- use movable calendar and shading editor panels;
- add a year-specific planner introduction with explanation text, up to two links, and an optional logo image URL.

Administration is intentionally protected **outside the application** by the hosting platform.

---

# Cloudflare installation

Cloudflare mode uses:

- **Workers** for the application;
- **R2** for JSON configuration and ICS cache files;
- **Cloudflare Access** for administrator protection;
- a **Cron Trigger** for automatic syncing.

No D1 database is required.

## 1. Fork or clone the repository

Create your own copy of this repository in GitHub.

## 2. Create an R2 bucket

In the Cloudflare Dashboard:

**Storage & Databases → R2 → Create bucket**

Create:

```text
simple-year-planner-data
```

The included `wrangler.jsonc` expects this bucket name.

If you change the bucket name, update the `bucket_name` value in `wrangler.jsonc`.

## 3. Import the GitHub repository into Cloudflare

In Cloudflare:

**Workers & Pages → Create application → Import a repository**

Choose the GitHub repository and the `main` branch.

Use:

```text
Build command: leave blank
Deploy command: npx wrangler deploy
Root directory: /
```

The repository already contains the Worker and Wrangler configuration.

## 4. Confirm bindings

After deployment, the Worker should show:

```text
DATA    R2 bucket    simple-year-planner-data
ASSETS  Static assets
```

## 5. Protect the admin API

The public planner at `/` should remain public.

Use Cloudflare Zero Trust / Access to protect:

```text
/api/admin/*
```

Allow only the users who should be able to edit calendars and shading.

The browser detects administrator access by attempting to read the protected admin API. If Access permits the request, editing controls automatically appear on the public planner page.

`/admin/` redirects back to the main planner.

## 6. Automatic syncing

Cloudflare mode includes this Cron Trigger in `wrangler.jsonc`:

```text
0 */3 * * *
```

This refreshes all enabled calendars every **3 hours** for:

- the previous year;
- the current year;
- the next year.

Cloudflare Cron schedules use UTC, but this particular schedule simply means every three hours, so timezone does not materially affect it.

Administrators can still click **Sync** beside an individual calendar for an immediate refresh.

To change the interval, edit the `triggers.crons` setting in `wrangler.jsonc`.

Examples:

```text
0 */6 * * *    every 6 hours
0 */12 * * *   every 12 hours
0 2 * * *      once daily at 02:00 UTC
```

Commit and push the change; Cloudflare will redeploy from GitHub.

---

# PHP-friendly hosting installation

Requirements:

- PHP 8.1 or later;
- HTTPS access from the server to the public ICS URLs;
- writable `data/` and `data/cache/` directories;
- a host that supports password-protected directories or equivalent access control;
- optional cron support for automatic syncing.

## 1. Upload the repository

Upload the project to a PHP-capable web directory.

The public entry point is:

```text
/index.php
```

## 2. Make data directories writable

PHP must be able to write to:

```text
data/
data/cache/
```

Exact permissions depend on your hosting provider.

## 3. Protect administration

Protect the administrative area or write/API endpoints using your hosting provider's directory/password protection or reverse-proxy authentication.

Do not commit password files into Git.

The project intentionally does not maintain its own user accounts.

## 4. Add calendars and shading

Open the planner as an authorised administrator.

Add one or more **public ICS URLs**, assign colours, then add optional shading layers directly on the planner.

## 5. Configure automatic syncing

The repository includes:

```text
sync.php
```

Run it every 3 hours using your hosting provider's Cron Jobs feature.

Typical cron command:

```bash
0 */3 * * * php /absolute/path/to/simple-year-planner/sync.php
```

Some shared hosts ask for the schedule and command in separate fields. In that case use:

```text
Minute: 0
Hour: */3
Day: *
Month: *
Weekday: *
```

and command:

```bash
php /absolute/path/to/simple-year-planner/sync.php
```

If your provider requires a full PHP binary path, it may look like:

```bash
/usr/local/bin/php /home/account/public_html/simple-year-planner/sync.php
```

The script is CLI-only and cannot be triggered through the browser.

Administrators can still use **Sync** beside a calendar for an immediate refresh.

---

# Calendar storage and caching

Persistent configuration:

```text
data/calendars.json
data/shading.json
```

In Cloudflare mode these are stored as equivalent R2 objects.

Calendar event caches are rebuildable and are stored per calendar and year.

Only the **previous year, current year and next year** are maintained. Older planner data is intentionally not retained by the application.

If a public ICS feed is temporarily unavailable, the last successful cached copy can continue to be used.

---

# Public ICS feeds

This application expects calendar URLs that are already publicly accessible.

Examples include public/exported ICS feeds from calendar systems that permit unauthenticated subscription.

The project does **not** attempt to:

- authenticate to Microsoft 365;
- access private Outlook calendars;
- access Microsoft 365 Group calendars;
- store OAuth tokens;
- modify remote calendar events.

Anyone viewing the planner should be assumed able to see the calendar information being displayed.

---

# Shading

Shading is intended for broad planning information rather than calendar events.

Examples:

- school terms;
- holidays;
- conference periods;
- ministry terms;
- shutdowns;
- leave periods.

A shading layer can contain multiple separate date ranges.

Administrators can:

- drag to select a range;
- drag again elsewhere to add another range;
- click a selected date to remove it;
- remove individual saved ranges;
- change the label and colour;
- delete the whole layer.

---

# Local development

## PHP mode

From the repository root:

```bash
php -S localhost:8080
```

Then open:

```text
http://localhost:8080/
```

The PHP development server does not enforce `.htaccess` authentication.

## Cloudflare mode

Install dependencies:

```bash
npm install
```

Run:

```bash
npm run cf:dev
```

Type-check:

```bash
npm run check
```

Deploy manually if required:

```bash
npm run cf:deploy
```

---

# Security

This project deliberately keeps authentication outside the application.

Recommended approaches:

### Cloudflare

Protect:

```text
/api/admin/*
```

with Cloudflare Access.

### PHP / traditional hosting

Use:

- password-protected directories;
- Apache Basic Auth;
- nginx auth;
- reverse-proxy authentication;
- another hosting-provider access-control feature.

Do not expose editing endpoints publicly.

---

# Repository structure

```text
assets/                 Shared browser CSS and JavaScript
cloudflare/worker.ts    Cloudflare Worker implementation
admin/                  PHP admin compatibility files
data/                   PHP-mode JSON data and cache
lib/                    PHP helpers and ICS parsing
index.php               PHP public planner
sync.php                PHP CLI calendar sync
wrangler.jsonc          Cloudflare Worker/R2/Cron configuration
```

---

# Licence and contributions

If publishing this repository publicly, add the licence you want contributors and users to follow.

Issues and pull requests are welcome for improvements that preserve the project's lightweight, public-calendar focus.

## Planner introduction

Each year can optionally include a short explanatory block above the planner. It may contain explanatory text, up to two links, and an optional logo image URL. If no content is configured, public viewers see nothing. Authorised Cloudflare editors see a subtle prompt and pencil button for editing the introduction.