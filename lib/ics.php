<?php
declare(strict_types=1);

require_once __DIR__ . '/common.php';

function yp_unfold_ics(string $ics): array {
    $ics = str_replace(["\r\n", "\r"], "\n", $ics);
    $out = [];
    foreach (explode("\n", $ics) as $line) {
        if ((($line[0] ?? '') === ' ' || ($line[0] ?? '') === "\t") && $out) $out[count($out)-1] .= substr($line, 1);
        else $out[] = $line;
    }
    return $out;
}

function yp_ics_unescape(string $value): string {
    return str_replace(['\\n','\\N','\\,','\\;','\\\\'], ["\n","\n",',',';','\\'], $value);
}

function yp_ics_prop(string $line): array {
    $pos = strpos($line, ':');
    if ($pos === false) return ['', [], ''];
    $parts = explode(';', substr($line, 0, $pos));
    $name = strtoupper(array_shift($parts) ?: '');
    $params = [];
    foreach ($parts as $part) {
        $eq = strpos($part, '=');
        if ($eq !== false) $params[strtoupper(substr($part,0,$eq))] = trim(substr($part,$eq+1), '"');
    }
    return [$name, $params, substr($line, $pos+1)];
}

function yp_normalise_tzid(?string $tzid): string {
    $map = [
        'E. Australia Standard Time'=>'Australia/Brisbane',
        'AUS Eastern Standard Time'=>'Australia/Sydney',
        'Tasmania Standard Time'=>'Australia/Hobart',
        'Cen. Australia Standard Time'=>'Australia/Adelaide',
        'W. Australia Standard Time'=>'Australia/Perth',
    ];
    return $map[$tzid ?? ''] ?? ($tzid ?: YP_DEFAULT_TIMEZONE);
}

function yp_zone(string $tzid): DateTimeZone {
    try { return new DateTimeZone(yp_normalise_tzid($tzid)); }
    catch (Throwable) { return new DateTimeZone(YP_DEFAULT_TIMEZONE); }
}

function yp_ics_datetime(string $value, array $params): DateTimeImmutable {
    $zone = yp_zone((string)($params['TZID'] ?? YP_DEFAULT_TIMEZONE));
    if (($params['VALUE'] ?? '') === 'DATE' || preg_match('/^\d{8}$/', $value)) {
        return DateTimeImmutable::createFromFormat('!Ymd', substr($value,0,8), $zone) ?: new DateTimeImmutable('today', $zone);
    }
    if (str_ends_with($value, 'Z')) {
        return DateTimeImmutable::createFromFormat('!Ymd\THis\Z', $value, new DateTimeZone('UTC')) ?: new DateTimeImmutable($value, new DateTimeZone('UTC'));
    }
    return DateTimeImmutable::createFromFormat('!Ymd\THis', $value, $zone) ?: new DateTimeImmutable($value, $zone);
}

function yp_ics_duration_seconds(string $value): ?int {
    if (!preg_match('/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i', trim($value), $m)) return null;
    $sign = ($m[1] ?? '') === '-' ? -1 : 1;
    return $sign * (((int)($m[2]??0)*7 + (int)($m[3]??0))*86400 + (int)($m[4]??0)*3600 + (int)($m[5]??0)*60 + (int)($m[6]??0));
}

function yp_parse_rrule(string $rule): array {
    $out=[];
    foreach (explode(';',$rule) as $pair) {
        $p=strpos($pair,'=');
        if ($p!==false) $out[strtoupper(substr($pair,0,$p))]=strtoupper(substr($pair,$p+1));
    }
    return $out;
}

function yp_rrule_weekday(string $token): ?int {
    $map=['SU'=>0,'MO'=>1,'TU'=>2,'WE'=>3,'TH'=>4,'FR'=>5,'SA'=>6];
    $key=substr($token,-2);
    return $map[$key] ?? null;
}

function yp_ordinal_weekday_match(DateTimeImmutable $date, string $token): bool {
    if (!preg_match('/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/', $token, $m)) return false;
    $weekday=yp_rrule_weekday($m[2]);
    if ((int)$date->format('w') !== $weekday) return false;
    if (($m[1]??'') === '') return true;
    $ordinal=(int)$m[1];
    $day=(int)$date->format('j');
    if ($ordinal>0) return intdiv($day-1,7)+1 === $ordinal;
    $last=(int)$date->format('t');
    return -(intdiv($last-$day,7)+1) === $ordinal;
}

function yp_days_between(DateTimeImmutable $a, DateTimeImmutable $b): int {
    $aa=new DateTimeImmutable($a->format('Y-m-d').' 00:00:00',$a->getTimezone());
    $bb=new DateTimeImmutable($b->format('Y-m-d').' 00:00:00',$b->getTimezone());
    return (int)$aa->diff($bb)->format('%r%a');
}

function yp_months_between(DateTimeImmutable $a, DateTimeImmutable $b): int {
    return ((int)$b->format('Y')-(int)$a->format('Y'))*12 + ((int)$b->format('n')-(int)$a->format('n'));
}

function yp_matches_rrule_date(DateTimeImmutable $date, DateTimeImmutable $start, array $rule): bool {
    if ($date < new DateTimeImmutable($start->format('Y-m-d H:i:s'),$start->getTimezone())) return false;
    $freq=$rule['FREQ']??''; $interval=max(1,(int)($rule['INTERVAL']??1));
    $byMonth=array_values(array_filter(array_map('intval',explode(',',$rule['BYMONTH']??''))));
    $byMonthDay=array_values(array_filter(array_map('intval',explode(',',$rule['BYMONTHDAY']??'')),fn($v)=>$v!==0));
    $byDay=array_values(array_filter(explode(',',$rule['BYDAY']??'')));
    $bySetPos=array_values(array_filter(array_map('intval',explode(',',$rule['BYSETPOS']??'')),fn($v)=>$v!==0));
    if ($byMonth && !in_array((int)$date->format('n'),$byMonth,true)) return false;
    if ($freq==='DAILY') { if (yp_days_between($start,$date)%$interval!==0) return false; }
    elseif ($freq==='WEEKLY') {
        $elapsed=yp_days_between($start,$date); $weekIndex=intdiv($elapsed+(int)$start->format('w'),7);
        if ($weekIndex%$interval!==0) return false;
        $allowed=$byDay ?: [array_search((int)$start->format('w'),['SU'=>0,'MO'=>1,'TU'=>2,'WE'=>3,'TH'=>4,'FR'=>5,'SA'=>6],true) ?: 'SU'];
        $ok=false; foreach($allowed as $token){$plain=preg_replace('/^[+-]?\d+/','',$token);if(yp_ordinal_weekday_match($date,$plain)){$ok=true;break;}} if(!$ok)return false;
    } elseif ($freq==='MONTHLY') {
        if (yp_months_between($start,$date)%$interval!==0) return false;
        if (!$byMonthDay && !$byDay && (int)$date->format('j')!==(int)$start->format('j')) return false;
    } elseif ($freq==='YEARLY') {
        if (((int)$date->format('Y')-(int)$start->format('Y'))%$interval!==0) return false;
        if (!$byMonth && (int)$date->format('n')!==(int)$start->format('n')) return false;
        if (!$byMonthDay && !$byDay && (int)$date->format('j')!==(int)$start->format('j')) return false;
    } else return false;

    if ($byMonthDay) {
        $day=(int)$date->format('j');$last=(int)$date->format('t');$ok=false;
        foreach($byMonthDay as $wanted){if(($wanted>0&&$day===$wanted)||($wanted<0&&$day===$last+$wanted+1)){$ok=true;break;}} if(!$ok)return false;
    }
    if ($byDay && $freq!=='WEEKLY') { $ok=false;foreach($byDay as $token){if(yp_ordinal_weekday_match($date,$token)){$ok=true;break;}}if(!$ok)return false; }
    if ($bySetPos && $byDay && $freq==='MONTHLY') {
        $matching=[];$last=(int)$date->format('t');
        for($day=1;$day<=$last;$day++){$candidate=$date->setDate((int)$date->format('Y'),(int)$date->format('n'),$day);foreach($byDay as $token){$plain=preg_replace('/^[+-]?\d+/','',$token);if(yp_ordinal_weekday_match($candidate,$plain)){$matching[]=$day;break;}}}
        $selected=[];foreach($bySetPos as $pos){$idx=$pos>0?$pos-1:count($matching)+$pos;if(isset($matching[$idx]))$selected[]=$matching[$idx];}
        if(!in_array((int)$date->format('j'),$selected,true))return false;
    }
    return true;
}

function yp_occurrence(array $event, DateTimeImmutable $start, DateTimeImmutable $end, int $year): array {
    $brisbane=new DateTimeZone(YP_DEFAULT_TIMEZONE);
    $occupiedEnd=$end>$start?$end->modify('-1 microsecond'):$start;
    $first=$start->setTimezone($brisbane)->format('Y-m-d'); $last=$occupiedEnd->setTimezone($brisbane)->format('Y-m-d');
    $cursor=new DateTimeImmutable($first.' 00:00:00',$brisbane);$finish=new DateTimeImmutable($last.' 00:00:00',$brisbane);$out=[];
    while($cursor<=$finish){$day=$cursor->format('Y-m-d');if((int)$cursor->format('Y')===$year)$out[]=[
        'uid'=>$event['uid']??sha1(($event['summary']??'').$start->format(DATE_ATOM)), 'title'=>$event['summary']??'Untitled event','date'=>$day,
        'start'=>$start->format(DATE_ATOM),'end'=>$end->format(DATE_ATOM),'url'=>$event['url']??null,'description'=>$event['description']??null,'location'=>$event['location']??null,'allDay'=>!empty($event['allDay'])
    ];$cursor=$cursor->modify('+1 day');}
    return $out;
}

function yp_expand_event(array $event, int $year): array {
    $start=$event['start'];$duration=isset($event['end'])?$event['end']->getTimestamp()-$start->getTimestamp():(int)($event['durationSeconds']??0);
    $end=$event['end']??$start->modify(($duration>=0?'+':'').$duration.' seconds');
    $tz=yp_zone((string)($event['tzid']??YP_DEFAULT_TIMEZONE));
    $exclusions=[];foreach($event['exdates']??[] as $d)$exclusions[$d->getTimestamp()]=true;$results=[];
    $add=function(DateTimeImmutable $current)use(&$results,$event,$duration,$year,$exclusions){if(isset($exclusions[$current->getTimestamp()]))return;$results=array_merge($results,yp_occurrence($event,$current,$current->modify(($duration>=0?'+':'').$duration.' seconds'),$year));};
    if(!empty($event['rrule'])){
        $rule=yp_parse_rrule($event['rrule']);$count=isset($rule['COUNT'])?max(1,(int)$rule['COUNT']):PHP_INT_MAX;
        $until=!empty($rule['UNTIL'])?yp_ics_datetime($rule['UNTIL'],str_ends_with($rule['UNTIL'],'Z')?[]:['TZID'=>$event['tzid']??YP_DEFAULT_TIMEZONE]):null;
        $current=$start->setTimezone($tz);$targetEnd=new DateTimeImmutable($year.'-12-31 23:59:59',$tz);$generated=0;$safety=30000;
        while($current<=$targetEnd&&$generated<$count&&$safety-->0){if(yp_matches_rrule_date($current,$start->setTimezone($tz),$rule)){if($until&&$current>$until)break;$generated++;$add($current);} $current=$current->modify('+1 day');}
    } else $add($start);
    foreach($event['rdates']??[] as $rdate)$add($rdate);
    $seen=[];$filtered=[];foreach($results as $item){$key=($item['start']??'').'|'.($item['title']??'');if(isset($seen[$key]))continue;$seen[$key]=true;$filtered[]=$item;}return $filtered;
}

function yp_parse_ics_events(string $ics, int $year): array {
    $source=[];$current=null;
    foreach(yp_unfold_ics($ics) as $line){
        if($line==='BEGIN:VEVENT'){$current=[];continue;} if($line==='END:VEVENT'){if($current&&isset($current['start']))$source[]=$current;$current=null;continue;} if($current===null)continue;
        [$name,$params,$value]=yp_ics_prop($line);
        if($name==='UID')$current['uid']=$value; elseif($name==='SUMMARY')$current['summary']=yp_ics_unescape($value); elseif($name==='URL')$current['url']=$value;
        elseif($name==='DESCRIPTION')$current['description']=yp_ics_unescape($value); elseif($name==='LOCATION')$current['location']=yp_ics_unescape($value); elseif($name==='STATUS')$current['status']=strtoupper($value);
        elseif($name==='RRULE')$current['rrule']=$value; elseif($name==='RDATE'){foreach(array_filter(explode(',',$value))as$v)$current['rdates'][]=yp_ics_datetime($v,$params);} elseif($name==='EXDATE'){foreach(array_filter(explode(',',$value))as$v)$current['exdates'][]=yp_ics_datetime($v,$params);}
        elseif($name==='RECURRENCE-ID')$current['recurrenceId']=yp_ics_datetime($value,$params); elseif($name==='DTSTART'){$current['tzid']=$params['TZID']??($current['tzid']??YP_DEFAULT_TIMEZONE);$current['start']=yp_ics_datetime($value,$params);$current['allDay']=(($params['VALUE']??'')==='DATE'||preg_match('/^\d{8}$/',$value));}
        elseif($name==='DTEND')$current['end']=yp_ics_datetime($value,$params); elseif($name==='DURATION')$current['durationSeconds']=yp_ics_duration_seconds($value);
    }
    $events=[];foreach($source as $event){if(!isset($event['recurrenceId'])&&($event['status']??'')!=='CANCELLED')$events=array_merge($events,yp_expand_event($event,$year));}
    foreach($source as $override){if(!isset($override['recurrenceId']))continue;$rt=$override['recurrenceId']->getTimestamp();$events=array_values(array_filter($events,fn($e)=>!(($e['uid']??null)===($override['uid']??null)&&abs(strtotime($e['start']??'')-$rt)<1)));if(($override['status']??'')!=='CANCELLED'&&isset($override['start'])){$end=$override['end']??$override['start']->modify('+'.(int)($override['durationSeconds']??0).' seconds');$events=array_merge($events,yp_occurrence($override,$override['start'],$end,$year));}}
    usort($events,fn($a,$b)=>strcmp(($a['date']??'').($a['start']??'').($a['title']??''),($b['date']??'').($b['start']??'').($b['title']??'')));return $events;
}

function yp_fetch_ics(string $url): string {
    $ctx=stream_context_create(['http'=>['timeout'=>12,'user_agent'=>'Simple Year Planner/1.0','follow_location'=>1,'header'=>"Accept: text/calendar,*/*\r\n"]]);
    $raw=@file_get_contents($url,false,$ctx);if($raw===false||!str_contains($raw,'BEGIN:VCALENDAR'))throw new RuntimeException('Unable to download a valid ICS calendar.');return $raw;
}

function yp_calendar_sync_meta_path(string $id): string { return YP_CACHE_DIR.'/'.$id.'-sync.json'; }
function yp_mark_calendar_synced(string $id): void { yp_write_json(yp_calendar_sync_meta_path($id),['lastSynced'=>gmdate('c')]); }
function yp_calendar_last_synced(string $id): ?string { $meta=yp_read_json(yp_calendar_sync_meta_path($id),[]);return !empty($meta['lastSynced'])?(string)$meta['lastSynced']:null; }
function yp_planner_intros_path(): string { return dirname(__DIR__).'/data/planner-intros.json'; }
function yp_planner_intros(): array { return yp_read_json(yp_planner_intros_path(),[]); }
function yp_planner_intro_for_year(int $year): array { foreach(yp_planner_intros() as $intro){if((int)($intro['year']??0)===$year)return ['year'=>$year,'text'=>(string)($intro['text']??''),'links'=>is_array($intro['links']??null)?$intro['links']:[],'logoUrl'=>(string)($intro['logoUrl']??'')];}return ['year'=>$year,'text'=>'','links'=>[],'logoUrl'=>'']; }

function yp_events_for_year(int $year, bool $force=false): array {
    $all=[];foreach(yp_calendars($year) as $calendar){if(empty($calendar['enabled'])||empty($calendar['url']))continue;$id=$calendar['id']??yp_slug($calendar['name']??'calendar');$cache=YP_CACHE_DIR.'/'.$id.'-'.$year.'.json';$events=null;
        if(!$force&&is_file($cache)&&($year<yp_current_year() || time()-filemtime($cache)<YP_CACHE_SECONDS))$events=yp_read_json($cache,[]);
        if($events===null){try{$events=yp_parse_ics_events(yp_fetch_ics($calendar['url']),$year);yp_write_json($cache,$events);yp_mark_calendar_synced($id);}catch(Throwable){$events=yp_read_json($cache,[]);}}
        foreach($events as &$event){$event['calendarId']=$id;$event['calendarName']=$calendar['name']??$id;$event['colour']=yp_calendar_colour($calendar['colour']??'#356a8a');$event['textColour']=yp_text_colour_for($event['colour']);}unset($event);$all=array_merge($all,$events);
    }usort($all,fn($a,$b)=>strcmp(($a['date']??'').($a['title']??''),($b['date']??'').($b['title']??'')));return $all;
}
