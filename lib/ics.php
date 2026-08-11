<?php
declare(strict_types=1);

require_once __DIR__ . '/common.php';

function yp_unfold_ics(string $ics): array {
    $ics = str_replace(["\r\n", "\r"], "\n", $ics);
    $lines = explode("\n", $ics);
    $out = [];
    foreach ($lines as $line) {
        if (($line[0] ?? '') === ' ' || ($line[0] ?? '') === "\t") {
            if ($out) $out[count($out)-1] .= substr($line, 1);
        } else {
            $out[] = $line;
        }
    }
    return $out;
}

function yp_ics_unescape(string $value): string {
    return str_replace(['\\n','\\N','\\,','\\;','\\\\'], ["\n","\n",',',';','\\'], $value);
}

function yp_ics_prop(string $line): array {
    $pos = strpos($line, ':');
    if ($pos === false) return ['', [], ''];
    $head = substr($line, 0, $pos);
    $value = substr($line, $pos + 1);
    $parts = explode(';', $head);
    $name = strtoupper(array_shift($parts) ?: '');
    $params = [];
    foreach ($parts as $part) {
        $eq = strpos($part, '=');
        if ($eq !== false) $params[strtoupper(substr($part,0,$eq))] = trim(substr($part,$eq+1), '"');
    }
    return [$name, $params, $value];
}

function yp_ics_datetime(string $value, array $params): DateTimeImmutable {
    $tz = $params['TZID'] ?? YP_DEFAULT_TIMEZONE;
    try { $zone = new DateTimeZone($tz); } catch (Throwable $e) { $zone = new DateTimeZone(YP_DEFAULT_TIMEZONE); }

    if (($params['VALUE'] ?? '') === 'DATE' || preg_match('/^\d{8}$/', $value)) {
        return DateTimeImmutable::createFromFormat('!Ymd', substr($value,0,8), $zone)
            ?: new DateTimeImmutable('today', $zone);
    }
    if (str_ends_with($value, 'Z')) {
        return DateTimeImmutable::createFromFormat('!Ymd\THis\Z', $value, new DateTimeZone('UTC'))
            ?: new DateTimeImmutable($value, new DateTimeZone('UTC'));
    }
    return DateTimeImmutable::createFromFormat('!Ymd\THis', $value, $zone)
        ?: new DateTimeImmutable($value, $zone);
}

function yp_parse_rrule(string $rule): array {
    $out=[];
    foreach (explode(';',$rule) as $pair) {
        $p=strpos($pair,'=');
        if ($p!==false) $out[strtoupper(substr($pair,0,$p))]=strtoupper(substr($pair,$p+1));
    }
    return $out;
}

function yp_expand_event(array $event, int $year): array {
    $start=$event['start'];
    $end=$event['end'] ?? $start;
    $duration=$end->getTimestamp()-$start->getTimestamp();
    $rule=$event['rrule'] ?? null;
    if (!$rule) return yp_event_if_in_year($event,$start,$end,$year);

    $r=yp_parse_rrule($rule);
    $freq=$r['FREQ'] ?? '';
    $interval=max(1,(int)($r['INTERVAL'] ?? 1));
    $count=isset($r['COUNT']) ? max(1,(int)$r['COUNT']) : 1000;
    $until=null;
    if (!empty($r['UNTIL'])) $until=yp_ics_datetime($r['UNTIL'], []);
    $yearStart=new DateTimeImmutable("$year-01-01 00:00:00", new DateTimeZone(YP_DEFAULT_TIMEZONE));
    $yearEnd=new DateTimeImmutable(($year+1)."-01-01 00:00:00", new DateTimeZone(YP_DEFAULT_TIMEZONE));

    $results=[];
    $current=$start;
    $n=0;
    $limit=2000;
    while ($n < $count && $limit-- > 0) {
        if ($until && $current > $until) break;
        $currentEnd=$current->modify("+{$duration} seconds");
        if ($currentEnd >= $yearStart && $current < $yearEnd) {
            $results=array_merge($results, yp_event_if_in_year($event,$current,$currentEnd,$year));
        }
        if ($current >= $yearEnd && $current > $start) break;

        if ($freq === 'DAILY') $current=$current->modify("+{$interval} day");
        elseif ($freq === 'WEEKLY') $current=$current->modify("+{$interval} week");
        elseif ($freq === 'MONTHLY') $current=$current->modify("+{$interval} month");
        elseif ($freq === 'YEARLY') $current=$current->modify("+{$interval} year");
        else break;
        $n++;
    }
    return $results;
}

function yp_event_if_in_year(array $event, DateTimeImmutable $start, DateTimeImmutable $end, int $year): array {
    $local=$start->setTimezone(new DateTimeZone(YP_DEFAULT_TIMEZONE));
    if ((int)$local->format('Y') !== $year) return [];
    return [[
        'uid'=>$event['uid'] ?? sha1(($event['summary'] ?? '').$start->format(DATE_ATOM)),
        'title'=>$event['summary'] ?? 'Untitled event',
        'date'=>$local->format('Y-m-d'),
        'start'=>$start->format(DATE_ATOM),
        'end'=>$end->format(DATE_ATOM),
        'url'=>$event['url'] ?? null,
    ]];
}

function yp_parse_ics_events(string $ics, int $year): array {
    $lines=yp_unfold_ics($ics);
    $events=[]; $current=null;
    foreach ($lines as $line) {
        if ($line === 'BEGIN:VEVENT') { $current=[]; continue; }
        if ($line === 'END:VEVENT') {
            if ($current && isset($current['start'])) {
                $events=array_merge($events, yp_expand_event($current,$year));
            }
            $current=null; continue;
        }
        if ($current === null) continue;
        [$name,$params,$value]=yp_ics_prop($line);
        if ($name === 'UID') $current['uid']=$value;
        elseif ($name === 'SUMMARY') $current['summary']=yp_ics_unescape($value);
        elseif ($name === 'URL') $current['url']=$value;
        elseif ($name === 'RRULE') $current['rrule']=$value;
        elseif ($name === 'DTSTART') $current['start']=yp_ics_datetime($value,$params);
        elseif ($name === 'DTEND') $current['end']=yp_ics_datetime($value,$params);
    }
    return $events;
}

function yp_fetch_ics(string $url): string {
    $ctx=stream_context_create(['http'=>[
        'timeout'=>12,
        'user_agent'=>'Simple Year Planner/1.0',
        'follow_location'=>1,
    ]]);
    $raw=@file_get_contents($url,false,$ctx);
    if ($raw===false || !str_contains($raw,'BEGIN:VCALENDAR')) {
        throw new RuntimeException('Unable to download a valid ICS calendar.');
    }
    return $raw;
}

function yp_calendar_sync_meta_path(string $id): string {
    return YP_CACHE_DIR . '/' . $id . '-sync.json';
}

function yp_mark_calendar_synced(string $id): void {
    yp_write_json(yp_calendar_sync_meta_path($id), [
        'lastSynced' => gmdate('c'),
    ]);
}

function yp_calendar_last_synced(string $id): ?string {
    $meta=yp_read_json(yp_calendar_sync_meta_path($id), []);
    return !empty($meta['lastSynced']) ? (string)$meta['lastSynced'] : null;
}

function yp_planner_intros_path(): string {
    return dirname(__DIR__) . '/data/planner-intros.json';
}

function yp_planner_intros(): array {
    return yp_read_json(yp_planner_intros_path(), []);
}

function yp_planner_intro_for_year(int $year): array {
    foreach (yp_planner_intros() as $intro) {
        if ((int)($intro['year'] ?? 0) === $year) {
            return [
                'year' => $year,
                'text' => (string)($intro['text'] ?? ''),
                'links' => is_array($intro['links'] ?? null) ? $intro['links'] : [],
                'logoUrl' => (string)($intro['logoUrl'] ?? ''),
            ];
        }
    }
    return ['year'=>$year,'text'=>'','links'=>[],'logoUrl'=>''];
}

function yp_events_for_year(int $year, bool $force=false): array {
    $all=[];
    foreach (yp_calendars() as $calendar) {
        if (empty($calendar['enabled']) || empty($calendar['url'])) continue;
        $id=$calendar['id'] ?? yp_slug($calendar['name'] ?? 'calendar');
        $cache=YP_CACHE_DIR . '/' . $id . '-' . $year . '.json';
        $events=null;
        if (!$force && is_file($cache) && (time()-filemtime($cache) < YP_CACHE_SECONDS)) {
            $events=yp_read_json($cache, []);
        }
        if ($events===null) {
            try {
                $events=yp_parse_ics_events(yp_fetch_ics($calendar['url']), $year);
                yp_write_json($cache,$events);
                yp_mark_calendar_synced($id);
            } catch (Throwable $e) {
                $events=yp_read_json($cache, []);
            }
        }
        foreach ($events as &$event) {
            $event['calendarId']=$id;
            $event['calendarName']=$calendar['name'] ?? $id;
            $event['colour']=yp_calendar_colour($calendar['colour'] ?? '#356a8a');
            $event['textColour']=yp_text_colour_for($event['colour']);
        }
        unset($event);
        $all=array_merge($all,$events);
    }
    usort($all, fn($a,$b)=>strcmp(($a['date']??'').($a['title']??''),($b['date']??'').($b['title']??'')));
    return $all;
}
