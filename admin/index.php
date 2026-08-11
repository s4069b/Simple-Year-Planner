<?php
declare(strict_types=1);
session_start();
require_once __DIR__ . '/../lib/ics.php';

if (empty($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(16));
$message='';

function admin_redirect(string $message): never {
    header('Location: ./?message=' . urlencode($message));
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
            $items=yp_calendars();
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
            yp_write_json(YP_DATA_DIR.'/calendars.json',$items);
            admin_redirect('Calendar saved.');
        }
        if ($action==='delete-calendar') {
            $id=$_POST['id'] ?? '';
            yp_write_json(YP_DATA_DIR.'/calendars.json', array_values(array_filter(yp_calendars(),fn($c)=>($c['id']??'')!==$id)));
            foreach(glob(YP_CACHE_DIR.'/'.$id.'-*.json')?:[] as $f) @unlink($f);
            admin_redirect('Calendar removed.');
        }
        if ($action==='save-shading') {
            $year=(int)($_POST['year']??0);
            if(!in_array($year,yp_allowed_years(),true)) throw new RuntimeException('Invalid year.');
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
            admin_redirect('Shading saved.');
        }
        if ($action==='delete-shading') {
            $id=$_POST['id']??'';
            yp_write_json(YP_DATA_DIR.'/shading.json',array_values(array_filter(yp_shading(),fn($s)=>($s['id']??'')!==$id)));
            admin_redirect('Shading removed.');
        }
        if ($action==='sync') {
            foreach(yp_allowed_years() as $year) yp_events_for_year($year,true);
            admin_redirect('Calendars refreshed.');
        }
    } catch(Throwable $e) {$message=$e->getMessage();}
}
if(isset($_GET['message']))$message=$_GET['message'];
$calendars=yp_calendars();
$shading=yp_shading();
$years=yp_allowed_years();
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Year Planner Admin</title><link rel="icon" href="../favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css">
<style>
.admin{max-width:1000px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid #d8dee5;border-radius:10px;padding:16px;margin:14px 0}.card h2,.card h3{margin-top:0}.form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.form-grid label{display:flex;flex-direction:column;gap:4px}.form-grid .wide{grid-column:1/-1}input,select,button{font:inherit;padding:8px;border:1px solid #cbd3dc;border-radius:6px}button{cursor:pointer;background:#fff}.primary{background:#172126;color:#fff}.danger{color:#a11}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.notice{padding:10px;background:#eef6ef;border-radius:6px}.muted{color:#687580;font-size:.9rem}@media(max-width:700px){.form-grid{grid-template-columns:1fr}}
</style></head><body>
<div class="admin">
<div class="row"><h1 style="margin-right:auto">Year Planner Admin</h1><a href="../">Public planner</a></div>
<p class="muted">Protect this <code>/admin/</code> directory with your web host’s directory/password protection. The application itself does not manage Microsoft or other user identities.</p>
<?php if($message):?><p class="notice"><?=htmlspecialchars($message)?></p><?php endif;?>

<div class="card"><h2>Public ICS calendars</h2>
<form method="post" class="row"><input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="sync"><button>Refresh all calendars now</button></form>
<?php foreach($calendars as $c):?>
<form method="post" class="card form-grid">
<input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="save-calendar"><input type="hidden" name="id" value="<?=htmlspecialchars($c['id'])?>">
<label>Name<input name="name" value="<?=htmlspecialchars($c['name'])?>" required></label>
<label>Colour<input name="colour" type="color" value="<?=htmlspecialchars($c['colour']??'#356a8a')?>"></label>
<label class="wide">Public ICS URL<input name="url" type="url" value="<?=htmlspecialchars($c['url'])?>" required></label>
<label><span>Enabled</span><input name="enabled" type="checkbox" <?=$c['enabled']?'checked':''?>></label>
<div class="row"><button class="primary">Save</button><button class="danger" formaction="./" name="action" value="delete-calendar" onclick="return confirm('Remove this calendar?')">Remove</button></div>
</form>
<?php endforeach;?>
<form method="post" class="card form-grid">
<input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="save-calendar">
<h3 class="wide">Add calendar</h3><label>Name<input name="name" required></label><label>Colour<input name="colour" type="color" value="#356a8a"></label><label class="wide">Public ICS URL<input name="url" type="url" required></label><label><span>Enabled</span><input name="enabled" type="checkbox" checked></label><div><button class="primary">Add calendar</button></div>
</form></div>

<div class="card"><h2>Shading</h2><p class="muted">Only the current year and next year can be entered.</p>
<?php foreach($shading as $s):?>
<form method="post" class="card form-grid">
<input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="save-shading"><input type="hidden" name="id" value="<?=htmlspecialchars($s['id'])?>">
<label>Name<input name="name" value="<?=htmlspecialchars($s['name'])?>" required></label><label>Year<select name="year"><?php foreach($years as $y):?><option <?=$y==($s['year']??0)?'selected':''?>><?=$y?></option><?php endforeach;?></select></label>
<label>Start<input type="date" name="start" value="<?=htmlspecialchars($s['start'])?>" required></label><label>End<input type="date" name="end" value="<?=htmlspecialchars($s['end'])?>" required></label><label>Colour<input name="colour" type="color" value="<?=htmlspecialchars($s['colour']??'#e5e7eb')?>"></label>
<div class="row"><button class="primary">Save</button><button class="danger" name="action" value="delete-shading" onclick="return confirm('Remove this shading?')">Remove</button></div>
</form>
<?php endforeach;?>
<form method="post" class="card form-grid">
<input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['csrf'])?>"><input type="hidden" name="action" value="save-shading">
<h3 class="wide">Add shading</h3><label>Name<input name="name" required></label><label>Year<select name="year"><?php foreach($years as $y):?><option><?=$y?></option><?php endforeach;?></select></label><label>Start<input type="date" name="start" required></label><label>End<input type="date" name="end" required></label><label>Colour<input name="colour" type="color" value="#e5e7eb"></label><div><button class="primary">Add shading</button></div>
</form></div>
</div></body></html>
