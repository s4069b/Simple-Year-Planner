<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/ics.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This sync script may only be run from the command line.\n");
}

$ok = true;

foreach (yp_allowed_years() as $year) {
    try {
        yp_events_for_year($year, true);
        fwrite(STDOUT, "Synced calendars for {$year}\n");
    } catch (Throwable $e) {
        $ok = false;
        fwrite(STDERR, "Sync failed for {$year}: {$e->getMessage()}\n");
    }
}

exit($ok ? 0 : 1);
