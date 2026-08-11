<?php
declare(strict_types=1);
require_once __DIR__ . '/lib/ics.php';

$year=yp_validate_year($_GET['year'] ?? null);
$years=yp_allowed_years();
$calendars=array_values(array_filter(yp_calendars(), fn($c)=>!empty($c['enabled'])));
foreach ($calendars as &$calendar) {
    $calendar['lastSynced']=yp_calendar_last_synced((string)($calendar['id'] ?? ''));
}
unset($calendar);
$events=yp_events_for_year($year);
$shading=array_values(array_filter(yp_shading(), fn($s)=>(int)($s['year']??0)===$year));
$intro=yp_planner_intro_for_year($year);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Year Planner <?=htmlspecialchars((string)$year)?></title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div class="sticky-shell">
<header class="site-header">
  <div>
    <h1>Year Planner <?=htmlspecialchars((string)$year)?></h1>
    <p>Public calendars and planning overview</p>
  </div>
  <nav class="year-nav">
    <a class="year-arrow <?=$year===$years[0]?'disabled':''?>" href="<?=$year===$years[0]?'#':'?year='.($year-1)?>" aria-label="Previous year">←</a>
    <span class="year-current"><?=$year?></span>
    <a class="year-arrow <?=$year===$years[count($years)-1]?'disabled':''?>" href="<?=$year===$years[count($years)-1]?'#':'?year='.($year+1)?>" aria-label="Next year">→</a>
    <button id="today-button" class="today-button" type="button">Today</button>
  </nav>
</header>

<?php if (!empty($intro['text']) || !empty($intro['links']) || !empty($intro['logoUrl'])): ?>
<section class="planner-intro">
  <div class="planner-intro-content">
    <?php if (!empty($intro['logoUrl'])): ?>
      <img class="planner-intro-logo" src="<?=htmlspecialchars($intro['logoUrl'])?>" alt="">
    <?php endif; ?>
    <div class="planner-intro-copy">
      <?php if (!empty($intro['text'])): ?>
        <p><?=nl2br(htmlspecialchars($intro['text']))?></p>
      <?php endif; ?>
      <?php if (!empty($intro['links'])): ?>
        <div class="planner-intro-links">
          <?php foreach(array_slice($intro['links'],0,2) as $link): ?>
            <a href="<?=htmlspecialchars($link['url']??'')?>" target="_blank" rel="noopener"><?=htmlspecialchars($link['label']??$link['url']??'Link')?></a>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </div>
  </div>
</section>
<?php endif; ?>

<section class="toolbar">
  <details>
    <summary>Calendars</summary>
    <div class="filter-panel">
      <?php foreach($calendars as $c): ?>
      <div class="calendar-filter-info">
        <label><input type="checkbox" class="calendar-toggle" data-calendar="<?=htmlspecialchars($c['id'])?>" checked>
        <span class="swatch" style="background:<?=htmlspecialchars($c['colour']??'#356a8a')?>"></span>
        <?=htmlspecialchars($c['name']??'Calendar')?></label>
        <span class="calendar-last-synced" data-last-synced="<?=htmlspecialchars($c['lastSynced']??'')?>"><?=empty($c['lastSynced']) ? 'Not synced yet' : 'Last synced '.htmlspecialchars($c['lastSynced'])?></span>
      </div>
      <?php endforeach; ?>
    </div>
  </details>
  <details>
    <summary>Shading</summary>
    <div class="filter-panel">
      <?php foreach($shading as $s): ?>
      <label><input type="checkbox" class="shade-toggle" data-shade="<?=htmlspecialchars($s['id'])?>" checked>
      <span class="swatch" style="background:<?=htmlspecialchars($s['colour']??'#e5e7eb')?>"></span>
      <?=htmlspecialchars($s['name']??'Shading')?></label>
      <?php endforeach; ?>
    </div>
  </details>
</section>
</div>

<main id="planner" class="planner"></main>

<script>
window.YEAR_PLANNER_DATA = <?=json_encode([
    'year'=>$year,'events'=>$events,'shading'=>$shading,'calendars'=>$calendars,'intro'=>$intro
], JSON_UNESCAPED_SLASHES)?>;
</script>
<script src="assets/app.js"></script>
</body>
</html>
