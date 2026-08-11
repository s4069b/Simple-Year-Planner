<?php
declare(strict_types=1);
require_once __DIR__ . '/lib/ics.php';

$year=yp_validate_year($_GET['year'] ?? null);
$years=yp_allowed_years();
$currentYear=yp_current_year();
$yearPresent=yp_planner_year_present($year);
$yearFrozen=$year<$currentYear;
$calendars=array_values(array_filter(yp_calendars($year), fn($c)=>!empty($c['enabled'])));
foreach ($calendars as &$calendar) $calendar['lastSynced']=yp_calendar_last_synced((string)($calendar['id'] ?? ''));
unset($calendar);
$events=yp_events_for_year($year);
$shading=array_values(array_filter(yp_shading(), fn($s)=>(int)($s['year']??0)===$year));
$intro=yp_planner_intro_for_year($year);
function h(mixed $v): string { return htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function shade_ranges_php(array $s): array {
    if (!empty($s['ranges']) && is_array($s['ranges'])) return $s['ranges'];
    if (!empty($s['start']) && !empty($s['end'])) return [['start'=>$s['start'],'end'=>$s['end']]];
    return [];
}
$shading=array_map(function($s){$s['ranges']=shade_ranges_php($s);return $s;},$shading);
?><!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Year Planner <?=h($year)?></title><link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="assets/style.css"></head><body>
<div class="sticky-shell">
<header class="site-header"><div><h1>Year Planner <?=h($year)?></h1></div>
<nav class="year-nav">
  <a class="year-arrow <?=$year===$years[0]?'disabled':''?>" href="<?=$year===$years[0]?'#':'?year='.($year-1)?>" aria-label="Previous year">←</a>
  <span class="year-current"><?=h($year)?></span>
  <a class="year-arrow <?=$year===$years[count($years)-1]?'disabled':''?>" href="<?=$year===$years[count($years)-1]?'#':'?year='.($year+1)?>" aria-label="Next year">→</a>
  <button id="today-button" class="today-button" type="button">Today</button>
</nav></header>

<?php if(!$yearPresent):?><div id="year-lifecycle-banner" class="year-lifecycle-banner"><strong><?=h($year)?> has not been prepared yet.</strong> <a href="admin/?year=<?=h($year)?>">Administrators can prepare it here.</a></div><?php endif;?>

<section id="planner-intro" class="planner-intro <?=(!empty($intro['text'])||!empty($intro['logoUrl'])||!empty($intro['links']))?'':'planner-intro--empty'?>">
  <div class="planner-intro-content">
    <?php if(!empty($intro['logoUrl'])):?><img class="planner-intro-logo" src="<?=h($intro['logoUrl'])?>" alt=""><?php endif;?>
    <div class="planner-intro-copy">
      <?php if(!empty($intro['text'])):?><p><?=nl2br(h($intro['text']))?></p><?php endif;?>
      <?php if(!empty($intro['links'])):?><div class="planner-intro-links"><?php foreach(array_slice($intro['links'],0,2) as $link):?><a href="<?=h($link['url']??'')?>" target="_blank" rel="noopener"><?=h($link['label']??$link['url']??'Link')?></a><?php endforeach;?></div><?php endif;?>
    </div>
  </div>
</section>

<section class="toolbar">
<div class="toolbar-flow">
  <div class="toolbar-control" data-manager="calendar">
    <button class="toolbar-control-button" type="button" data-manager-toggle="calendar" aria-expanded="false"><span class="public-manager-label">Calendar Toggle</span><span class="admin-manager-label" hidden>Calendar Manager</span><span class="toolbar-control-caret" aria-hidden="true">▾</span></button>
    <div class="filter-panel">
      <div class="filter-list"><?php if($calendars): foreach($calendars as $c):?><div class="filter-item-row"><div class="calendar-filter-info"><label><input type="checkbox" class="calendar-toggle" data-calendar="<?=h($c['id'])?>" checked><span class="swatch" style="background:<?=h($c['colour']??'#356a8a')?>"></span><?=h($c['name']??'Calendar')?></label><span class="calendar-last-synced" data-last-synced="<?=h($c['lastSynced']??'')?>"><?=empty($c['lastSynced'])?'Not synced yet':'Last synced '.h($c['lastSynced'])?></span></div></div><?php endforeach; else:?><div class="filter-empty">No public calendars have been added yet.</div><?php endif;?></div>
    </div>
  </div>
  <div id="calendar-legend" class="toolbar-legend calendar-legend <?=$calendars?'':'toolbar-legend--empty'?>"><?php if($calendars):foreach($calendars as $c):?><div class="toolbar-legend-item" data-legend-calendar="<?=h($c['id'])?>"><span class="toolbar-legend-swatch" style="background:<?=h($c['colour']??'#356a8a')?>"></span><span><?=h($c['name']??'Calendar')?></span></div><?php endforeach;else:?><span class="toolbar-legend-empty">No calendars</span><?php endif;?></div>
  <div class="toolbar-control" data-manager="shading">
    <button class="toolbar-control-button" type="button" data-manager-toggle="shading" aria-expanded="false"><span class="public-manager-label">Shading Toggle</span><span class="admin-manager-label" hidden>Shading Manager</span><span class="toolbar-control-caret" aria-hidden="true">▾</span></button>
    <div class="filter-panel"><div class="filter-list"><?php if($shading):foreach($shading as $s):?><div class="filter-item-row"><label><input type="checkbox" class="shade-toggle" data-shade="<?=h($s['id'])?>" checked><span class="swatch" style="background:<?=h($s['colour']??'#e5e7eb')?>"></span><?=h($s['name']??'Shading')?></label></div><?php endforeach;else:?><div class="filter-empty">No shading has been added for this year.</div><?php endif;?></div></div>
  </div>
  <div id="shading-legend" class="toolbar-legend shading-legend <?=$shading?'':'toolbar-legend--empty'?>"><?php if($shading):foreach($shading as $s):?><div class="toolbar-legend-item" data-legend-shade="<?=h($s['id'])?>"><span class="toolbar-legend-swatch" style="background:<?=h($s['colour']??'#e5e7eb')?>"></span><span><?=h($s['name']??'Shading')?></span></div><?php endforeach;else:?><span class="toolbar-legend-empty">No shading</span><?php endif;?></div>
</div>
<div class="toolbar-view-switch" aria-label="View mode"><button id="visitor-view-toggle" class="visitor-view-toggle" type="button" aria-pressed="false">Public</button></div>
<div class="toolbar-right"><button id="planner-help-button" class="planner-help-button <?=(!$calendars||!$shading)?'planner-help-button--attention':''?>" type="button" title="Help">?</button></div>
<div id="planner-help-panel" class="planner-help-panel" hidden>
  <div class="planner-help-panel__header"><strong>Year Planner help</strong><button id="planner-help-close" type="button" aria-label="Close help">×</button></div>
  <p>Use <strong>Calendar Toggle</strong> to show or hide public calendars.</p><p>Use <strong>Shading Toggle</strong> to show or hide planning overlays.</p>
  <p>The calendar and shading legends stay visible while you scroll.</p><p>The previous year, current year and next year are available.</p>
  <p>Calendars are refreshed automatically on the schedule configured for the host. This repository defaults to every 3 hours.</p>
  <p><strong>Administrators:</strong> <a href="admin/">Open planner administration</a>.</p>
  <p><a href="https://github.com/s4069b/Simple-Year-Planner" target="_blank" rel="noopener">Simple Year Planner on GitHub ↗</a></p>
  <?php if(!$calendars||!$shading):?><div class="planner-help-alert"><strong>Setup is incomplete.</strong><p><?=$calendars?'':'No public calendars have been added. '?><?=$shading?'':'No shading has been added for this year. '?></p></div><?php endif;?>
</div></section>
<div class="small-screen-notice">This planner works on a small screen, but a larger screen gives a much better whole-year view.</div>
</div>
<main id="planner" class="planner"></main>
<script>window.YEAR_PLANNER_DATA = <?=json_encode(['year'=>$year,'currentYear'=>$currentYear,'yearPresent'=>$yearPresent,'yearFrozen'=>$yearFrozen,'events'=>$events,'shading'=>$shading,'calendars'=>$calendars,'intro'=>$intro], JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE)?>;</script>
<script src="assets/app.js"></script></body></html>
