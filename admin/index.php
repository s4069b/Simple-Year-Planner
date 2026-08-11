<?php
declare(strict_types=1);
session_start();
require_once __DIR__ . '/../lib/ics.php';

if (empty($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(16));
$message='';
$selectedYear=(int)($_POST['year'] ?? $_GET['year'] ?? yp_current_year());
if (!in_array($selectedYear, yp_allowed_years(), true)) $selectedYear=yp_current_year();

function admin_redirect(string $message, ?int $year=null): never {
    $year ??= yp_current_year();
    header('Location: ./?year=' . $year . '&message=' . urlencode($message));
    exit;
}
function check_csrf(): void {
    if (!hash_equals($_SESSION['csrf'] ?? '', $_POST['csrf'] ?? '')) {
        http_response_code(403); exit('Invalid form token.');
    }
}

if ($_SERVER['REQUEST_METHOD']==='POST') {
    check_csrf();
    $action=$_POST['action'] ?? '';
    try {
        if ($action==='save-calendar') {
            $year=(int)($_POST['year'] ?? yp_current_year());
            yp_assert_editable_year($year);
            if ($year>yp_current_year() && !yp_planner_year_present($year)) throw new RuntimeException('Create the next-year planner first.');
            $items=yp_calendars($year);
            $id=trim($_POST['id'] ?? '') ?: yp_slug($_POST['name'] ?? 'calendar') . '-' . substr(bin2hex(random_bytes(3)),0,6);
            $row=[
                'id'=>$id,
                'name'=>trim($_POST['name'] ?? '') ?: 'Calendar',
                'url'=>trim($_POST['url'] ?? ''),
                'colour'=>yp_calendar_colour($_POST['colour'] ?? '#356a8a'),
                'enabled'=>isset($_POST['enabled']),
            ];
            $found=false;
            foreach($items as &$item){ if(($item['id']??'')===$id){$item=$row;$found=true;break;} } unset($item);
            if(!$found)$items[]=$row;
            yp_write_json(yp_calendar_year_path($year),$items);
            admin_redirect('Calendar saved.',$year);
        }
        if ($action==='delete-calendar') {
            $year=(int)($_POST['year'] ?? yp_current_year());
            yp_assert_editable_year($year);
            $id=$_POST['id'] ?? '';
            yp_write_json(yp_calendar_year_path($year), array_values(array_filter(yp_calendars($year),fn($c)=>($c['id']??'')!==$id)));
            @unlink(YP_CACHE_DIR.'/'.$id.'-'.$year.'.json');
            admin_redirect('Calendar removed.',$year);
        }
        if ($action==='save-shading') {
            $year=(int)($_POST['year']??0);
            yp_assert_editable_year($year);
            $items=yp_shading();
            $id=trim($_POST['id'] ?? '') ?: 'shade-' . substr(bin2hex(random_bytes(4)),0,8);
            $row=[
                'id'=>$id,'name'=>trim($_POST['name']??'')?:'Shading',
                'year'=>$year,'start'=>$_POST['start']??'','end'=>$_POST['end']??'',
                'colour'=>yp_calendar_colour($_POST['colour']??'#e5e7eb')
            ];
            if($row['start']===''||$row['end']===''||$row['start']>$row['end']) throw new RuntimeException('Enter a valid date range.');
            $found=false;
            foreach($items as &$item){if(($item['id']??'')===$id){$item=$row;$found=true;break;}} unset($item);
            if(!$found)$items[]=$row;
            yp_write_json(YP_DATA_DIR.'/shading.json',$items);
            admin_redirect('Shading saved.',$year);
        }
        if ($action==='delete-shading') {
            $id=$_POST['id']??'';
            $items=yp_shading();
            $item=null; foreach($items as $candidate){if(($candidate['id']??'')===$id){$item=$candidate;break;}}
            if($item) yp_assert_editable_year((int)($item['year']??0));
            yp_write_json(YP_DATA_DIR.'/shading.json',array_values(array_filter($items,fn($s)=>($s['id']??'')!==$id)));
            admin_redirect('Shading removed.',(int)($item['year']??yp_current_year()));
        }
        if ($action==='sync') {
            $year=(int)($_POST['year'] ?? yp_current_year());
            yp_assert_editable_year($year);
            yp_events_for_year($year,true);
            admin_redirect('Calendars refreshed.',$year);
        }
        if ($action==='copy-next-year') {
            if (!empty($_POST['confirm_copy'])) { yp_copy_current_to_next(false); admin_redirect('Next year created.',yp_current_year()+1); }
            throw new RuntimeException('Confirmation was not supplied.');
        }
        if ($action==='reset-next-year') {
            if (!empty($_POST['confirm_reset'])) { yp_copy_current_to_next(true); admin_redirect('Next year reset from current year.',yp_current_year()+1); }
            throw new RuntimeException('Confirmation was not supplied.');
        }
    } catch(Throwable $e) {$message=$e->getMessage();}
}
if(isset($_GET['message']))$message=$_GET['message'];
$years=yp_allowed_years();
$selectedYear=(int)($_GET['year'] ?? $selectedYear);
if (!in_array($selectedYear,$years,true)) $selectedYear=yp_current_year();
$calendars=yp_calendars($selectedYear);
$shading=array_values(array_filter(yp_shading(),fn($s)=>(int)($s['year']??0)===$selectedYear));
$yearFrozen=$selectedYear<yp_current_year();
$yearPresent=yp_planner_year_present($selectedYear);
$settings=yp_settings();
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Year Planner Admin</title><link rel="icon" href="../favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css">
<style>
.admin{max-width:1000px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid #d8dee5;border-radius:10px;padding:16px;margin:14px 0}.card h2,.card h3{margin-top:0}.form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.form-grid label{display:flex;flex-direction:column;gap:4px}.form-grid .wide{grid-column:1/-1}input,select,button{font:inherit;padding:8px;border:1px solid #cbd3dc;border-radius:6px}button{cursor:pointer;background:#fff}button:disabled{opacity:.45;cursor:not-allowed}.primary{background:#172126;color:#fff}.danger{color:#a11}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.notice{padding:10px;background:#eef6ef;border-radius:6px}.muted{color:#687580;font-size:.9rem}@media(max-width:700px){.form-grid{grid-template-columns:1fr}}
</style></head><body>
<div class="admin">
<div class="row"><h1 style="margin-right:auto">Year Planner Admin</h1><a href="../">Public planner</a></div>
<p class="muted">Protect this <code>/admin/</code> directory with your web host’s directory/password protection. The application itself does not manage Microsoft or other user identities.</p>
<div class="card"><h2>Planner year</h2><div class="row"><?php foreach($years as $y):?><a href="./?year=<?=$y?>"<?php if($y===$selectedYear):?> style="font-weight:800"<?php endif;?>><?=$y?></a><?php endforeach;?></div>
<?php if($yearFrozen):?><p class="notice"><strong><?=$selectedYear?> is frozen.</strong> Previous-year planners are read-only and cannot be edited.</p><?php elseif($selectedYear===yp_current_year()+1 && !$yearPresent):?><p class="notice">The <?=$selectedYear?> planner has not been created.</p><form method="post" onsubmit="return confirm('Create <?=$selectedYear?> by copying <?=yp_current_year()?> calendar and shading settings?')"><input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="copy-next-year"><input type="hidden" name="year" value="<?=$selectedYear?>"><input type="hidden" name="confirm_copy" value="1"><button class="primary">Copy <?=yp_current_year()?> into <?=$selectedYear?></button></form><?php elseif($selectedYear===yp_current_year()+1):?><p class="notice"><strong>Reset options:</strong> either replace <?=$selectedYear?> with a fresh copy of <?=yp_current_year()?>, or blank <?=$selectedYear?> completely.</p><div class="row"><form method="post" onsubmit="return confirm('Replace <?=$selectedYear?> calendars and shading with <?=yp_current_year()?>?') && confirm('Final confirmation: reset <?=$selectedYear?> now?')"><input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="reset-next-year"><input type="hidden" name="year" value="<?=$selectedYear?>"><input type="hidden" name="confirm_reset" value="1"><button class="danger">Copy <?=yp_current_year()?> again</button></form><form method="post" onsubmit="return confirm('BLANK <?=$selectedYear?>? All calendars, shading and planner introduction will be removed.') && confirm('Final confirmation: blank <?=$selectedYear?> now?')"><input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="blank-next-year"><input type="hidden" name="year" value="<?=$selectedYear?>"><input type="hidden" name="confirm_blank" value="1"><button class="danger">Blank <?=$selectedYear?></button></form></div><?php endif;?>
<?php if($selectedYear===yp_current_year()):?><form method="post" class="row"><input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="toggle-previous-year"><label><input type="checkbox" name="show_previous" value="1" <?=$settings['showPreviousYear']?'checked':''?>> Show previous year to public visitors</label><button>Save year visibility</button></form><?php endif;?>
</div>
<?php if($message):?><p class="notice"><?=htmlspecialchars($message)?></p><?php endif;?>

<div class="card"><h2>Public ICS calendars — <?=$selectedYear?></h2>
<form method="post" class="row"><input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="sync"><input type="hidden" name="year" value="<?=$selectedYear?>"><button <?=$yearFrozen||!$yearPresent?'disabled':''?>>Refresh calendars for <?=$selectedYear?></button></form>
<?php foreach($calendars as $c):?>
<form method="post" class="card form-grid">
<input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="save-calendar"><input type="hidden" name="year" value="<?=$selectedYear?>"><input type="hidden" name="id" value="<?=htmlspecialchars($c['id'])?>">
<label>Name<input name="name" value="<?=htmlspecialchars($c['name'])?>" required></label>
<label>Colour<input name="colour" type="color" value="<?=htmlspecialchars($c['colour']??'#356a8a')?>"></label>
<label class="wide">Public ICS URL<input name="url" type="url" value="<?=htmlspecialchars($c['url'])?>" required></label>
<label><span>Enabled</span><input name="enabled" type="checkbox" <?=$c['enabled']?'checked':''?>></label>
<div class="row"><button class="primary">Save</button><button class="danger" formaction="./" name="action" value="delete-calendar" onclick="return confirm('Remove this calendar?')">Remove</button></div>
</form>
<?php endforeach;?>
<form method="post" class="card form-grid">
<input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="save-calendar"><input type="hidden" name="year" value="<?=$selectedYear?>">
<h3 class="wide">Add calendar</h3><label>Name<input name="name" required></label><label>Colour<input name="colour" type="color" value="#356a8a"></label><label class="wide">Public ICS URL<input name="url" type="url" required></label><label><span>Enabled</span><input name="enabled" type="checkbox" checked></label><div><button class="primary">Add calendar</button></div>
</form></div>

<div class="card"><h2>Shading — <?=$selectedYear?></h2><p class="muted"><?php if($yearFrozen):?>Frozen: view only.<?php else:?>Current and next-year shading can be edited here.<?php endif;?></p>
<?php foreach($shading as $s):?>
<form method="post" class="card form-grid">
<input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="save-shading"><input type="hidden" name="id" value="<?=htmlspecialchars($s['id'])?>">
<label>Name<input name="name" value="<?=htmlspecialchars($s['name'])?>" required></label><input type="hidden" name="year" value="<?=$selectedYear?>">
<label>Start<input type="date" name="start" value="<?=htmlspecialchars($s['start'])?>" required></label><label>End<input type="date" name="end" value="<?=htmlspecialchars($s['end'])?>" required></label><label>Colour<input name="colour" type="color" value="<?=htmlspecialchars($s['colour']??'#e5e7eb')?>"></label>
<div class="row"><button class="primary">Save</button><button class="danger" name="action" value="delete-shading" onclick="return confirm('Remove this shading?')">Remove</button></div>
</form>
<?php endforeach;?>
<form method="post" class="card form-grid">
<input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="save-shading">
<h3 class="wide">Add shading</h3><label>Name<input name="name" required></label><input type="hidden" name="year" value="<?=$selectedYear?>"><label>Start<input type="date" name="start" required></label><label>End<input type="date" name="end" required></label><label>Colour<input name="colour" type="color" value="#e5e7eb"></label><div><button class="primary">Add shading</button></div>
</form></div>
</div></body></html>
