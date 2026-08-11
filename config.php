<?php
declare(strict_types=1);

define('YP_DATA_DIR', __DIR__ . '/data');
define('YP_CACHE_DIR', YP_DATA_DIR . '/cache');
define('YP_CACHE_SECONDS', 900); // 15 minutes
define('YP_DEFAULT_TIMEZONE', 'Australia/Brisbane');

date_default_timezone_set(YP_DEFAULT_TIMEZONE);
