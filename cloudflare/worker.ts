interface Env {
  DATA: R2Bucket;
  ASSETS: Fetcher;
}

type CalendarConfig = {
  id: string;
  name: string;
  url: string;
  colour: string;
  enabled: boolean;
};

type PlannerIntro = {
  year: number;
  text: string;
  links: Array<{ label: string; url: string }>;
  logoUrl?: string;
};

type ShadeRange = { start: string; end: string };

type ShadeConfig = {
  id: string;
  name: string;
  year: number;
  start?: string;
  end?: string;
  ranges?: ShadeRange[];
  colour: string;
};

type PlannerEvent = {
  uid: string;
  title: string;
  date: string;
  start: string;
  end: string;
  url?: string | null;
  description?: string | null;
  location?: string | null;
  allDay?: boolean;
  calendarId?: string;
  calendarName?: string;
  colour?: string;
  textColour?: string;
};

const CACHE_SECONDS = 900;
const TZ = 'Australia/Brisbane';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function currentYear(): number {
  return Number(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, year: 'numeric' }).format(new Date()));
}

function allowedYears(): number[] {
  const y = currentYear();
  return [y - 1, y, y + 1];
}

function validYear(raw: string | null): number | null {
  const y = raw ? Number(raw) : currentYear();
  return allowedYears().includes(y) ? y : null;
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'calendar';
}

function colour(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function textColour(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 160 ? '#172126' : '#ffffff';
}

async function readJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const object = await env.DATA.get(key);
  if (!object) return fallback;
  try {
    return JSON.parse(await object.text()) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(env: Env, key: string, value: unknown): Promise<void> {
  await env.DATA.put(key, JSON.stringify(value, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' },
  });
}

function unfoldIcs(ics: string): string[] {
  const lines = ics.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseProp(line: string): { name: string; params: Record<string, string>; value: string } {
  const colon = line.indexOf(':');
  if (colon < 0) return { name: '', params: {}, value: '' };
  const head = line.slice(0, colon).split(';');
  const name = (head.shift() || '').toUpperCase();
  const params: Record<string, string> = {};
  for (const part of head) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value: line.slice(colon + 1) };
}

const WINDOWS_TZIDS: Record<string, string> = {
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'W. Australia Standard Time': 'Australia/Perth',
};

function normaliseTzid(value: string | undefined): string {
  if (!value) return TZ;
  return WINDOWS_TZIDS[value] || value;
}

function zonedLocalToUtc(
  year: number, month: number, day: number, hour: number, minute: number, second: number,
  timeZone: string,
): Date {
  // Intl gives us the calendar-local fields for a UTC guess. Iterating the
  // difference converts an ICS TZID wall-clock time to the correct instant,
  // including daylight-saving offsets where the source zone uses them.
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const shown = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    const delta = target - shown;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess);
}

function parseIcsDate(value: string, params: Record<string, string>): Date {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    return zonedLocalToUtc(Number(value.slice(0,4)), Number(value.slice(4,6)), Number(value.slice(6,8)), 0, 0, 0, normaliseTzid(params.TZID));
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (match) {
    const [, y, m, d, hh, mm, ss, z] = match;
    if (z === 'Z') return new Date(Date.UTC(Number(y), Number(m)-1, Number(d), Number(hh), Number(mm), Number(ss)));
    return zonedLocalToUtc(Number(y), Number(m), Number(d), Number(hh), Number(mm), Number(ss), normaliseTzid(params.TZID));
  }
  return new Date(value);
}

function parseIcsDuration(value: string): number | null {
  const match = value.trim().toUpperCase().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const weeks = Number(match[2] || 0);
  const days = Number(match[3] || 0);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);
  return sign * (((weeks * 7 + days) * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds) * 1000);
}

function wallDateFor(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(map.year), Number(map.month)-1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second)));
}

function instantForWallDate(wall: Date, timeZone: string): Date {
  return zonedLocalToUtc(
    wall.getUTCFullYear(), wall.getUTCMonth()+1, wall.getUTCDate(),
    wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), timeZone,
  );
}

function dateInBrisbane(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseRRule(rule: string): Record<string, string> {
  return Object.fromEntries(rule.split(';').map(part => {
    const i = part.indexOf('=');
    return [part.slice(0, i).toUpperCase(), part.slice(i + 1).toUpperCase()];
  }).filter(([key]) => Boolean(key)));
}

const RRULE_WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getMilliseconds()));
}

function daysBetween(a: Date, b: Date): number {
  const aa = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bb = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((bb - aa) / 86400000);
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function ordinalWeekdayMatch(date: Date, token: string): boolean {
  const match = token.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
  if (!match) return false;
  const weekday = RRULE_WEEKDAYS[match[2]];
  if (date.getUTCDay() !== weekday) return false;
  if (!match[1]) return true;

  const ordinal = Number(match[1]);
  if (ordinal > 0) {
    return Math.floor((date.getUTCDate() - 1) / 7) + 1 === ordinal;
  }

  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return -(Math.floor((lastDay - date.getUTCDate()) / 7) + 1) === ordinal;
}

function matchesRRuleDate(date: Date, start: Date, rule: Record<string, string>): boolean {
  if (date < startOfDay(start)) return false;

  const freq = rule.FREQ || '';
  const interval = Math.max(1, Number(rule.INTERVAL || 1));
  const byMonth = rule.BYMONTH?.split(',').map(Number).filter(Boolean) || [];
  const byMonthDay = rule.BYMONTHDAY?.split(',').map(Number).filter(Number.isFinite) || [];
  const byDay = rule.BYDAY?.split(',').filter(Boolean) || [];
  const bySetPos = rule.BYSETPOS?.split(',').map(Number).filter(Number.isFinite) || [];

  if (byMonth.length && !byMonth.includes(date.getUTCMonth() + 1)) return false;

  if (freq === 'DAILY') {
    if (daysBetween(start, date) % interval !== 0) return false;
  } else if (freq === 'WEEKLY') {
    const elapsedDays = daysBetween(start, date);
    const weekIndex = Math.floor((elapsedDays + start.getUTCDay()) / 7);
    if (weekIndex % interval !== 0) return false;
    const allowedDays = byDay.length ? byDay : [Object.keys(RRULE_WEEKDAYS).find(key => RRULE_WEEKDAYS[key] === start.getUTCDay()) || 'SU'];
    if (!allowedDays.some(token => ordinalWeekdayMatch(date, token.replace(/^[+-]?\d+/, '')))) return false;
  } else if (freq === 'MONTHLY') {
    if (monthsBetween(start, date) % interval !== 0) return false;
    if (!byMonthDay.length && !byDay.length && date.getUTCDate() !== start.getUTCDate()) return false;
  } else if (freq === 'YEARLY') {
    if ((date.getUTCFullYear() - start.getUTCFullYear()) % interval !== 0) return false;
    if (!byMonth.length && date.getUTCMonth() !== start.getUTCMonth()) return false;
    if (!byMonthDay.length && !byDay.length && date.getUTCDate() !== start.getUTCDate()) return false;
  } else {
    return false;
  }

  if (byMonthDay.length) {
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    if (!byMonthDay.some(day => day > 0 ? date.getUTCDate() === day : date.getUTCDate() === lastDay + day + 1)) return false;
  }

  if (byDay.length && freq !== 'WEEKLY' && !byDay.some(token => ordinalWeekdayMatch(date, token))) return false;

  if (bySetPos.length && byDay.length && freq === 'MONTHLY') {
    const matchingDays: number[] = [];
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    for (let day = 1; day <= lastDay; day++) {
      const candidate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
      if (byDay.some(token => ordinalWeekdayMatch(candidate, token.replace(/^[+-]?\d+/, '')))) matchingDays.push(day);
    }
    const selectedDays = bySetPos
      .map(pos => pos > 0 ? matchingDays[pos - 1] : matchingDays[matchingDays.length + pos])
      .filter((day): day is number => Number.isInteger(day));
    if (!selectedDays.includes(date.getUTCDate())) return false;
  }

  return true;
}

function occurrence(event: any, start: Date, end: Date, year: number): PlannerEvent[] {
  // Calendar DTEND is exclusive. Using one millisecond before the end gives
  // the final day actually occupied by both all-day and timed multi-day events
  // (and avoids drawing an event on a day where it merely ends at midnight).
  const occupiedEnd = end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start;
  const firstDay = dateInBrisbane(start);
  const lastDay = dateInBrisbane(occupiedEnd);

  const [firstYear, firstMonth, firstDate] = firstDay.split('-').map(Number);
  const [lastYear, lastMonth, lastDate] = lastDay.split('-').map(Number);
  const cursor = new Date(Date.UTC(firstYear, firstMonth - 1, firstDate));
  const last = new Date(Date.UTC(lastYear, lastMonth - 1, lastDate));
  const results: PlannerEvent[] = [];

  while (cursor <= last) {
    const day = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`;
    if (day.startsWith(`${year}-`)) {
      results.push({
        uid: event.uid || `${event.summary || ''}:${start.toISOString()}`,
        title: event.summary || 'Untitled event',
        date: day,
        start: start.toISOString(),
        end: end.toISOString(),
        url: event.url || null,
        description: event.description || null,
        location: event.location || null,
        allDay: Boolean(event.allDay),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return results;
}

function expandEvent(event: any, year: number): PlannerEvent[] {
  const start: Date = event.start;
  const end: Date = event.end || (Number.isFinite(event.durationMs) ? new Date(start.getTime() + event.durationMs) : event.start);
  const duration = end.getTime() - start.getTime();
  const timeZone = normaliseTzid(event.tzid);
  const exclusions = new Set<number>((event.exdates || []).map((date: Date) => date.getTime()));
  const results: PlannerEvent[] = [];

  const addInstant = (current: Date): void => {
    if (exclusions.has(current.getTime())) return;
    results.push(...occurrence(event, current, new Date(current.getTime() + duration), year));
  };

  if (event.rrule) {
    const rule = parseRRule(event.rrule);
    const count = rule.COUNT ? Math.max(1, Number(rule.COUNT)) : Number.POSITIVE_INFINITY;
    const until = rule.UNTIL ? parseIcsDate(rule.UNTIL, rule.UNTIL.endsWith('Z') ? {} : { TZID: event.tzid || TZ }) : null;
    const wallStart = wallDateFor(start, timeZone);
    const targetEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    let currentWall = new Date(wallStart);
    let generated = 0;
    let safety = 30000;

    while (currentWall <= targetEnd && generated < count && safety-- > 0) {
      if (matchesRRuleDate(currentWall, wallStart, rule)) {
        const current = instantForWallDate(currentWall, timeZone);
        if (until && current > until) break;
        generated++;
        addInstant(current);
      }
      currentWall = new Date(currentWall.getTime() + 86400000);
    }
  } else {
    addInstant(start);
  }

  for (const rdate of (event.rdates || []) as Date[]) addInstant(rdate);

  const seen = new Set<string>();
  return results.filter(item => {
    const key = `${item.start}|${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseIcs(ics: string, year: number): PlannerEvent[] {
  const sourceEvents: any[] = [];
  let current: any | null = null;
  for (const line of unfoldIcs(ics)) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current?.start) sourceEvents.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const { name, params, value } = parseProp(line);
    if (name === 'UID') current.uid = value;
    else if (name === 'SUMMARY') current.summary = unescapeIcs(value);
    else if (name === 'URL') current.url = value;
    else if (name === 'DESCRIPTION') current.description = unescapeIcs(value);
    else if (name === 'LOCATION') current.location = unescapeIcs(value);
    else if (name === 'STATUS') current.status = value.toUpperCase();
    else if (name === 'RRULE') current.rrule = value;
    else if (name === 'RDATE') current.rdates = [...(current.rdates || []), ...value.split(',').filter(Boolean).map(item => parseIcsDate(item, params))];
    else if (name === 'EXDATE') current.exdates = [...(current.exdates || []), ...value.split(',').filter(Boolean).map(item => parseIcsDate(item, params))];
    else if (name === 'RECURRENCE-ID') current.recurrenceId = parseIcsDate(value, params);
    else if (name === 'DTSTART') {
      current.tzid = params.TZID || current.tzid || TZ;
      current.start = parseIcsDate(value, params);
      current.allDay = params.VALUE === 'DATE' || /^\d{8}$/.test(value);
    }
    else if (name === 'DTEND') current.end = parseIcsDate(value, params);
    else if (name === 'DURATION') current.durationMs = parseIcsDuration(value);
  }

  let events = sourceEvents
    .filter(event => !event.recurrenceId && event.status !== 'CANCELLED')
    .flatMap(event => expandEvent(event, year));

  // A RECURRENCE-ID VEVENT replaces (or cancels) one generated instance of
  // the master series. Treating it as an unrelated event produces duplicate
  // or stale occurrences, which was another source of bad series plotting.
  for (const override of sourceEvents.filter(event => event.recurrenceId)) {
    const recurrenceTime = override.recurrenceId.getTime();
    events = events.filter(event => !(event.uid === override.uid && Math.abs(new Date(event.start).getTime() - recurrenceTime) < 1000));
    if (override.status !== 'CANCELLED' && override.start) {
      const overrideEnd = override.end || (Number.isFinite(override.durationMs) ? new Date(override.start.getTime() + override.durationMs) : override.start);
      events.push(...occurrence(override, override.start, overrideEnd, year));
    }
  }

  return events.sort((a, b) => `${a.date}${a.start}${a.title}`.localeCompare(`${b.date}${b.start}${b.title}`));
}

async function fetchIcs(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Simple Year Planner/1.0', accept: 'text/calendar,*/*' },
  });
  const body = await response.text();
  if (!response.ok || !body.includes('BEGIN:VCALENDAR')) {
    throw new Error(`Unable to download a valid ICS calendar (${response.status}).`);
  }
  return body;
}

async function calendars(env: Env): Promise<CalendarConfig[]> {
  return readJson<CalendarConfig[]>(env, 'calendars.json', []);
}

async function shading(env: Env): Promise<ShadeConfig[]> {
  return readJson<ShadeConfig[]>(env, 'shading.json', []);
}

async function plannerIntros(env: Env): Promise<PlannerIntro[]> {
  return readJson<PlannerIntro[]>(env, 'planner-intros.json', []);
}

async function calendarLastSynced(env: Env, id: string): Promise<string | null> {
  const meta = await readJson<{lastSynced?: string}>(env, `cache/${id}-sync.json`, {});
  return meta.lastSynced || null;
}

async function markCalendarSynced(env: Env, id: string): Promise<void> {
  await writeJson(env, `cache/${id}-sync.json`, { lastSynced: new Date().toISOString() });
}


function shadeRanges(shade: ShadeConfig): ShadeRange[] {
  if (Array.isArray(shade.ranges) && shade.ranges.length) return shade.ranges;
  if (shade.start && shade.end) return [{ start: shade.start, end: shade.end }];
  return [];
}

async function eventsForYear(env: Env, year: number, force = false): Promise<PlannerEvent[]> {
  const all: PlannerEvent[] = [];
  for (const calendar of await calendars(env)) {
    if (!calendar.enabled || !calendar.url) continue;
    const key = `cache/${calendar.id}-${year}.json`;
    let events: PlannerEvent[] | null = null;
    if (!force) {
      const cached = await env.DATA.get(key);
      const uploaded = cached?.uploaded?.getTime() || 0;
      if (cached && Date.now() - uploaded < CACHE_SECONDS * 1000) {
        try { events = JSON.parse(await cached.text()) as PlannerEvent[]; } catch {}
      }
    }
    if (events === null) {
      try {
        events = parseIcs(await fetchIcs(calendar.url), year);
        await writeJson(env, key, events);
        await markCalendarSynced(env, calendar.id);
      } catch {
        events = await readJson<PlannerEvent[]>(env, key, []);
      }
    }
    const c = colour(calendar.colour, '#356a8a');
    for (const event of events) {
      all.push({
        ...event,
        calendarId: calendar.id,
        calendarName: calendar.name,
        colour: c,
        textColour: textColour(c),
      });
    }
  }
  all.sort((a, b) => `${a.date}${a.title}`.localeCompare(`${b.date}${b.title}`));
  return all;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
}

async function publicPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const year = validYear(url.searchParams.get('year'));
  if (!year) return html('Only the current year and next year are available.', 404);

  const years = allowedYears();
  const cals = await Promise.all(
    (await calendars(env))
      .filter(c => c.enabled)
      .map(async c => ({ ...c, lastSynced: await calendarLastSynced(env, c.id) }))
  );
  const shades = (await shading(env))
    .filter(s => s.year === year)
    .map(s => ({ ...s, ranges: shadeRanges(s) }));
  const intro = (await plannerIntros(env)).find(item => item.year === year) || {
    year, text: '', links: [], logoUrl: ''
  };
  const events = await eventsForYear(env, year);

  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Year Planner ${year}</title><link rel="stylesheet" href="/style.css"></head><body>
<div class="sticky-shell">
<header class="site-header"><div><h1>Year Planner ${year}</h1><p>Public calendars and planning overview</p></div>
<nav class="year-nav">
  <a class="year-arrow ${year===years[0]?'disabled':''}" href="${year===years[0]?'#':`?year=${year-1}`}" aria-label="Previous year">←</a>
  <span class="year-current">${year}</span>
  <a class="year-arrow ${year===years[years.length-1]?'disabled':''}" href="${year===years[years.length-1]?'#':`?year=${year+1}`}" aria-label="Next year">→</a>
  <button id="today-button" class="today-button" type="button">Today</button>
</nav></header>

<section id="planner-intro" class="planner-intro ${intro.text || intro.logoUrl || intro.links.length ? '' : 'planner-intro--empty'}">
  <div class="planner-intro-content">
    ${intro.logoUrl ? `<img class="planner-intro-logo" src="${esc(intro.logoUrl)}" alt="">` : ''}
    <div class="planner-intro-copy">
      ${intro.text ? `<p>${esc(intro.text).replace(/\n/g,'<br>')}</p>` : '<p class="planner-intro-admin-note admin-only" hidden>Add an explanation for this year’s planner.</p>'}
      ${intro.links.length ? `<div class="planner-intro-links">${intro.links.map(link => `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label || link.url)}</a>`).join('')}</div>` : ''}
    </div>
  </div>
  <button id="planner-intro-edit" class="planner-intro-edit admin-only" type="button" hidden title="Edit planner introduction" aria-label="Edit planner introduction">✎</button>
</section>

<section class="toolbar">
<div class="toolbar-flow">
  <details class="toolbar-control" data-manager="calendar">
    <summary><span class="public-manager-label">Calendar</span><span class="admin-manager-label" hidden>Calendar Manager</span></summary>
    <div class="filter-panel">
      <div class="filter-list">${cals.length
        ? cals.map(c => `<div class="filter-item-row"><div class="calendar-filter-info"><label><input type="checkbox" class="calendar-toggle" data-calendar="${esc(c.id)}" checked><span class="swatch" style="background:${esc(c.colour)}"></span>${esc(c.name)}</label><span class="calendar-last-synced" data-last-synced="${esc(c.lastSynced || '')}">${c.lastSynced ? `Last synced ${esc(c.lastSynced)}` : 'Not synced yet'}</span></div><div class="filter-item-actions admin-only" hidden><button type="button" class="calendar-sync-button" data-calendar-sync="${esc(c.id)}">Sync</button><button type="button" class="calendar-edit-button" data-calendar-edit="${esc(c.id)}">Edit</button></div></div>`).join('')
        : '<div class="filter-empty">No public calendars have been added yet.</div>'
      }</div>
      <div class="filter-action-row">
        <button id="add-calendar-button" class="admin-only toolbar-admin-action" type="button" hidden>+ Add calendar</button>
      </div>
    </div>
  </details>

  <div id="calendar-legend" class="toolbar-legend calendar-legend ${cals.length ? '' : 'toolbar-legend--empty'}">
    ${cals.length
      ? cals.map(c => `<div class="toolbar-legend-item" data-legend-calendar="${esc(c.id)}"><span class="toolbar-legend-swatch" style="background:${esc(c.colour)}"></span><span>${esc(c.name)}</span></div>`).join('')
      : '<span class="toolbar-legend-empty">No calendars</span>'
    }
  </div>

  <details class="toolbar-control" data-manager="shading">
    <summary><span class="public-manager-label">Shading</span><span class="admin-manager-label" hidden>Shading Manager</span></summary>
    <div class="filter-panel">
      <div class="filter-list">${shades.length
        ? shades.map(s => `<div class="filter-item-row"><label><input type="checkbox" class="shade-toggle" data-shade="${esc(s.id)}" checked><span class="swatch" style="background:${esc(s.colour)}"></span>${esc(s.name)}</label><button type="button" class="admin-only shade-edit-button" data-shade-edit="${esc(s.id)}" hidden>Edit</button></div>`).join('')
        : '<div class="filter-empty">No shading has been added for this year.</div>'
      }</div>
      <div class="filter-action-row">
        <button id="add-shading-button" class="admin-only toolbar-admin-action" type="button" hidden>+ Add shading</button>
      </div>
    </div>
  </details>

  <div id="shading-legend" class="toolbar-legend shading-legend ${shades.length ? '' : 'toolbar-legend--empty'}">
    ${shades.length
      ? shades.map(s => `<div class="toolbar-legend-item" data-legend-shade="${esc(s.id)}"><span class="toolbar-legend-swatch" style="background:${esc(s.colour)}"></span><span>${esc(s.name)}</span></div>`).join('')
      : '<span class="toolbar-legend-empty">No shading</span>'
    }
  </div>
</div>

<div class="toolbar-right">
  <button id="visitor-view-toggle" class="visitor-view-toggle" type="button" hidden aria-pressed="false">Visitor view</button>
  <button id="planner-help-button" class="planner-help-button ${(cals.length===0 || shades.length===0) ? 'planner-help-button--attention' : ''}" type="button" title="Help">?</button>
</div>

<div id="planner-help-panel" class="planner-help-panel" hidden>
  <div class="planner-help-panel__header">
    <strong>Year Planner help</strong>
    <button id="planner-help-close" type="button" aria-label="Close help">×</button>
  </div>
  <p>Use <strong>Calendar</strong> to show or hide public calendars.</p>
  <p>Use <strong>Shading</strong> to show or hide planning overlays.</p>
  <p>For authorised editors, these controls become <strong>Calendar Manager</strong> and <strong>Shading Manager</strong>.</p>
  <p>The calendar and shading legends stay visible while you scroll.</p>
  <p>The previous year, current year and next year are available.</p>
  <p>Calendars are refreshed automatically on the schedule configured for the host. This repository defaults to every 3 hours. Administrators can also use <strong>Sync</strong> beside a calendar for an immediate refresh.</p>
  <p>If you have administrator access, editing controls appear automatically.</p>
  <p><strong>Administrators:</strong> <a href="/admin">Log in to edit the planner</a>.</p>
  ${(cals.length===0 || shades.length===0) ? `<div class="planner-help-alert"><strong>Setup is incomplete.</strong><p>${cals.length===0 ? 'No public calendars have been added. ' : ''}${shades.length===0 ? 'No shading has been added for this year. ' : ''}</p></div>` : ''}
</div>
</section>
<div class="small-screen-notice">This planner works on a small screen, but a larger screen gives a much better whole-year view.</div>
</div>

<main id="planner" class="planner"></main>

<div id="planner-intro-editor" class="floating-editor planner-intro-editor" hidden>
  <div class="floating-editor-header">
    <h2>Edit planner introduction</h2>
    <div class="floating-editor-tools">
      <div id="planner-intro-drag-handle" class="dialog-grab" title="Drag to move" aria-label="Drag to move">⋮⋮</div>
      <button id="planner-intro-close" type="button" aria-label="Close">×</button>
    </div>
  </div>

  <form id="planner-intro-form" class="planner-intro-form">
    <label>
      <span>Explanation</span>
      <textarea name="text" rows="4" placeholder="What is this year’s planner for?"></textarea>
    </label>

    <label>
      <span>Logo image URL</span>
      <input name="logoUrl" type="url" placeholder="https://example.org/logo.png">
    </label>

    <div class="planner-intro-link-grid">
      <label><span>Link 1 label</span><input name="link1Label" placeholder="More information"></label>
      <label><span>Link 1 URL</span><input name="link1Url" type="url" placeholder="https://…"></label>
      <label><span>Link 2 label</span><input name="link2Label" placeholder="Related page"></label>
      <label><span>Link 2 URL</span><input name="link2Url" type="url" placeholder="https://…"></label>
    </div>

    <input name="year" type="hidden" value="${year}">

    <div class="planner-intro-actions">
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</div>

<div id="calendar-editor-panel" class="floating-editor calendar-editor-panel" hidden>
  <div class="floating-editor-header">
    <h2 id="calendar-editor-heading">Add calendar</h2>
    <div class="floating-editor-tools">
      <div id="calendar-dialog-drag-handle" class="dialog-grab" title="Drag to move" aria-label="Drag to move">⋮⋮</div>
      <button id="calendar-editor-close" type="button" aria-label="Close">×</button>
    </div>
  </div>

  <form id="calendar-editor-form" class="calendar-editor-form">
    <div class="calendar-label-colour-row">
      <label class="calendar-label-field">
        <span>Label</span>
        <input name="name" required placeholder="e.g. Public events">
      </label>
      <label class="calendar-colour-field">
        <span>Colour</span>
        <input id="calendar-colour-input" name="colour" type="color" value="#356a8a" aria-label="Calendar colour">
      </label>
    </div>

    <label class="calendar-url-field">
      <span>Public ICS URL</span>
      <input name="url" type="url" required placeholder="https://…/calendar.ics">
    </label>

    <label class="calendar-enabled-row">
      <input name="enabled" type="checkbox" checked>
      <span>Enabled</span>
    </label>

    <input name="id" type="hidden">

    <div class="calendar-editor-actions">
      <div class="calendar-delete-group">
        <button type="button" id="calendar-delete-button" class="calendar-delete-button" hidden>Delete calendar</button>
        <div id="calendar-delete-confirm-group" class="calendar-delete-confirm-group" hidden>
          <button type="button" id="calendar-delete-confirm" class="calendar-delete-confirm">Confirm delete</button>
          <button type="button" id="calendar-delete-cancel">Cancel</button>
        </div>
      </div>
      <button type="button" id="calendar-sync-current" hidden>Sync</button>
      <button type="submit" class="primary">Save calendar</button>
    </div>
  </form>
</div>

<div id="shade-editor-panel" class="floating-editor shade-editor-panel" hidden>
  <div class="floating-editor-header">
    <h2 id="shade-editor-heading">Add shading</h2>
    <div class="floating-editor-tools">
      <div id="shade-dialog-drag-handle" class="dialog-grab" title="Drag to move" aria-label="Drag to move">⋮⋮</div>
      <button id="shade-editor-close" type="button" aria-label="Close">×</button>
    </div>
  </div>

  <p class="muted">Drag across the planner to choose a range.</p>
  <div id="shade-selection-status" class="shade-selection-status">Drag across the planner to select dates.</div>

  <form id="shade-editor-form" class="shade-form">
    <div class="shade-label-colour-row">
      <label class="shade-label-field">
        <span>Label</span>
        <input name="name" required placeholder="e.g. School holidays">
      </label>

      <label class="shade-colour-field">
        <span>Colour</span>
        <input id="shade-colour-input" name="colour" type="color" value="#e5e7eb" aria-label="Shading colour">
      </label>
    </div>

    <input name="id" type="hidden">
    <input name="year" type="hidden" value="${year}">

    <div class="shade-ranges-block">
      <div class="shade-ranges-title">Selected ranges</div>
      <div id="shade-ranges-list" class="shade-ranges-list"></div>
      <div class="shade-ranges-help">Drag on the planner to add another range. Hold Shift while dragging to extend the current range instead.</div>
    </div>

    <div class="shade-form-actions">
      <div class="shade-delete-group">
        <button type="button" id="shade-delete-button" class="shade-delete-button" hidden>Delete layer</button>
        <div id="shade-delete-confirm-group" class="shade-delete-confirm-group" hidden>
          <button type="button" id="shade-delete-confirm" class="shade-delete-confirm">Confirm delete</button>
          <button type="button" id="shade-delete-cancel">Cancel</button>
        </div>
      </div>
      <button type="button" id="shade-selection-clear">Clear all ranges</button>
      <button type="submit" class="primary">Save shading</button>
    </div>
  </form>
</div>

<div id="event-detail-backdrop" class="event-detail-backdrop" hidden>
  <section id="event-detail-panel" class="event-detail-panel" role="dialog" aria-modal="true" aria-labelledby="event-detail-title">
    <div class="event-detail-header">
      <div>
        <div id="event-detail-calendar" class="event-detail-calendar"></div>
        <h2 id="event-detail-title"></h2>
      </div>
      <button id="event-detail-close" type="button" aria-label="Close event details">×</button>
    </div>
    <div id="event-detail-when" class="event-detail-row"></div>
    <div id="event-detail-location" class="event-detail-row" hidden></div>
    <div id="event-detail-description" class="event-detail-description" hidden></div>
    <div class="event-detail-actions">
      <a id="event-detail-link" href="#" target="_blank" rel="noopener" hidden>Open event ↗</a>
      <button id="event-detail-done" type="button">Close</button>
    </div>
  </section>
</div>

<script>window.YEAR_PLANNER_DATA=${JSON.stringify({year, events, shading: shades, calendars: cals, intro}).replace(/</g,'\\u003c')};</script>
<script src="/app.js"></script></body></html>`);
}

function adminPage(): Response {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Year Planner Admin</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/admin.css"></head>
<body><div class="admin"><div class="row"><h1>Year Planner Admin</h1><a href="/">Public planner</a></div>
<p class="muted">Cloudflare mode stores configuration and cache as JSON objects in R2. Protect <code>/admin/*</code> and <code>/api/admin/*</code> with Cloudflare Access.</p>
<p id="notice" class="notice" hidden></p>
<section class="card"><div class="row"><h2>Public ICS calendars</h2><button id="refresh">Refresh all calendars</button></div><div id="calendars"></div><button id="add-calendar">+ Add calendar</button></section>
<section class="card"><h2>Shading</h2><p class="muted">Only the current year and next year are available.</p><div id="shading"></div><button id="add-shade">+ Add shading</button></section>
</div><script src="/admin.js"></script></body></html>`);
}

async function apiConfig(env: Env): Promise<Response> {
  return json({ ok: true, calendars: await calendars(env), shading: await shading(env), years: allowedYears() });
}

async function parseBody(request: Request): Promise<any> {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('JSON request required.');
  return request.json();
}

async function handleAdminApi(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === 'GET' && path === '/api/admin/login') {
    return Response.redirect(new URL('/', request.url).toString(), 302);
  }

  if (request.method === 'GET' && path === '/api/admin/config') return apiConfig(env);

  if (request.method === 'POST' && path === '/api/admin/calendar') {
    const body = await parseBody(request);
    const items = await calendars(env);
    const id = String(body.id || `${slug(body.name || 'calendar')}-${crypto.randomUUID().slice(0,6)}`);
    const row: CalendarConfig = {
      id,
      name: String(body.name || 'Calendar').trim(),
      url: String(body.url || '').trim(),
      colour: colour(String(body.colour || ''), '#356a8a'),
      enabled: body.enabled !== false,
    };
    if (!/^https?:\/\//i.test(row.url)) return json({ok:false,error:'Enter a public HTTP(S) ICS URL.'},400);
    const index = items.findIndex(c => c.id === id);
    if (index >= 0) items[index] = row; else items.push(row);
    await writeJson(env, 'calendars.json', items);
    return json({ok:true});
  }

  if (request.method === 'DELETE' && path.startsWith('/api/admin/calendar/')) {
    const id = decodeURIComponent(path.split('/').pop() || '');
    await writeJson(env, 'calendars.json', (await calendars(env)).filter(c => c.id !== id));
    for (const year of allowedYears()) await env.DATA.delete(`cache/${id}-${year}.json`);
    return json({ok:true});
  }

  if (request.method === 'POST' && path === '/api/admin/planner-intro') {
    const body = await parseBody(request);
    const year = Number(body.year);
    if (!allowedYears().includes(year)) return json({ok:false,error:'Invalid year.'},400);

    const links = Array.isArray(body.links)
      ? body.links
          .map((link: any) => ({
            label: String(link?.label || '').trim(),
            url: String(link?.url || '').trim(),
          }))
          .filter((link: any) => link.url)
          .slice(0, 2)
      : [];

    for (const link of links) {
      if (!/^https?:\/\//i.test(link.url)) {
        return json({ok:false,error:'Links must use http:// or https://.'},400);
      }
    }

    const logoUrl = String(body.logoUrl || '').trim();
    if (logoUrl && !/^https?:\/\//i.test(logoUrl)) {
      return json({ok:false,error:'Logo URL must use http:// or https://.'},400);
    }

    const items = await plannerIntros(env);
    const row: PlannerIntro = {
      year,
      text: String(body.text || '').trim(),
      links,
      logoUrl,
    };

    const index = items.findIndex(item => item.year === year);
    if (row.text || row.links.length || row.logoUrl) {
      if (index >= 0) items[index] = row; else items.push(row);
    } else if (index >= 0) {
      items.splice(index, 1);
    }

    await writeJson(env, 'planner-intros.json', items);
    return json({ok:true});
  }

  if (request.method === 'POST' && path === '/api/admin/shading') {
    const body = await parseBody(request);
    const year = Number(body.year);
    if (!allowedYears().includes(year)) return json({ok:false,error:'Invalid year.'},400);
    const incomingRanges = Array.isArray(body.ranges)
      ? body.ranges
          .map((range: any) => ({
            start: String(range?.start || ''),
            end: String(range?.end || ''),
          }))
          .filter((range: ShadeRange) => range.start && range.end && range.start <= range.end)
      : [];

    const fallbackStart = String(body.start || '');
    const fallbackEnd = String(body.end || '');
    const ranges: ShadeRange[] = incomingRanges.length
      ? incomingRanges
      : (fallbackStart && fallbackEnd && fallbackStart <= fallbackEnd
          ? [{ start: fallbackStart, end: fallbackEnd }]
          : []);

    if (!ranges.length) return json({ok:false,error:'Add at least one shading range.'},400);

    const items = await shading(env);
    const id = String(body.id || `shade-${crypto.randomUUID().slice(0,8)}`);
    const row: ShadeConfig = {
      id,
      name: String(body.name || 'Shading').trim(),
      year,
      ranges,
      colour: colour(String(body.colour || ''), '#e5e7eb'),
    };
    const index = items.findIndex(s => s.id === id);
    if (index >= 0) items[index] = row; else items.push(row);
    await writeJson(env, 'shading.json', items);
    return json({ok:true});
  }

  if (request.method === 'DELETE' && path.startsWith('/api/admin/shading/')) {
    const id = decodeURIComponent(path.split('/').pop() || '');
    await writeJson(env, 'shading.json', (await shading(env)).filter(s => s.id !== id));
    return json({ok:true});
  }

  if (request.method === 'POST' && path.startsWith('/api/admin/sync/')) {
    const id = decodeURIComponent(path.split('/').pop() || '');
    const calendar = (await calendars(env)).find(item => item.id === id);
    if (!calendar) return json({ok:false,error:'Calendar not found.'},404);

    for (const year of allowedYears()) {
      const key = `cache/${calendar.id}-${year}.json`;
      try {
        const events = parseIcs(await fetchIcs(calendar.url), year);
        await writeJson(env, key, events);
      } catch (error) {
        return json({
          ok:false,
          error:error instanceof Error ? error.message : 'Calendar sync failed.',
        }, 400);
      }
    }

    await markCalendarSynced(env, calendar.id);
    return json({ok:true});
  }

  if (request.method === 'POST' && path === '/api/admin/sync') {
    for (const year of allowedYears()) await eventsForYear(env, year, true);
    return json({ok:true});
  }

  return json({ok:false,error:'Not found.'},404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/admin' || path === '/admin/') {
      return Response.redirect(new URL('/api/admin/login', request.url).toString(), 302);
    }
    if (path.startsWith('/api/admin/')) {
      try { return await handleAdminApi(request, env, path); }
      catch (error) { return json({ok:false,error:error instanceof Error ? error.message : 'Request failed.'},400); }
    }
    if (path === '/' || path === '/index.html') return publicPage(request, env);
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    for (const year of allowedYears()) {
      await eventsForYear(env, year, true);
    }
  },
} satisfies ExportedHandler<Env>;
