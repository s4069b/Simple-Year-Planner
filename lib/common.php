<?php
declare(strict_types=1);

require_once __DIR__ . '/../config.php';

function yp_read_json(string $file, array $fallback = []): array {
    if (!is_file($file)) return $fallback;
    $raw = file_get_contents($file);
    if ($raw === false || trim($raw) === '') return $fallback;
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : $fallback;
}

function yp_write_json(string $file, array $data): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    $tmp = $file . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false || file_put_contents($tmp, $json . PHP_EOL, LOCK_EX) === false) {
        throw new RuntimeException("Unable to write {$file}");
    }
    if (!rename($tmp, $file)) throw new RuntimeException("Unable to replace {$file}");
}

function yp_current_year(): int {
    return (int)date('Y');
}

function yp_allowed_years(): array {
    $y = yp_current_year();
    return [$y - 1, $y, $y + 1];
}

function yp_settings(): array {
    $settings = yp_read_json(YP_DATA_DIR . '/settings.json', []);
    return ['showPreviousYear' => ($settings['showPreviousYear'] ?? true) !== false];
}

function yp_write_settings(array $settings): void {
    yp_write_json(YP_DATA_DIR . '/settings.json', ['showPreviousYear' => ($settings['showPreviousYear'] ?? true) !== false]);
}

function yp_validate_year(?string $value): int {
    $year = (int)($value ?: yp_current_year());
    if (!in_array($year, yp_allowed_years(), true)) {
        http_response_code(404);
        exit('Only the previous year, current year and next year are available.');
    }
    return $year;
}

function yp_slug(string $value): string {
    $value = strtolower(trim($value));
    $value = preg_replace('/[^a-z0-9]+/', '-', $value) ?? '';
    return trim($value, '-') ?: 'calendar';
}

function yp_calendar_year_path(int $year): string {
    return YP_DATA_DIR . '/calendars-' . $year . '.json';
}

function yp_calendar_year_exists(int $year): bool {
    return is_file(yp_calendar_year_path($year));
}

function yp_calendars(?int $year = null): array {
    $year ??= yp_current_year();
    $path = yp_calendar_year_path($year);
    if (is_file($path)) return yp_read_json($path, []);

    // Migrate the old global calendar configuration into frozen snapshots for
    // current/past years. Deliberately leave next year absent until copied.
    if ($year <= yp_current_year()) {
        $legacy = yp_read_json(YP_DATA_DIR . '/calendars.json', []);
        yp_write_json($path, $legacy);
        return $legacy;
    }
    return [];
}

function yp_planner_year_present(int $year): bool {
    if ($year <= yp_current_year()) return true;
    if (yp_calendar_year_exists($year)) return true;
    foreach (yp_shading() as $shade) if ((int)($shade['year'] ?? 0) === $year) return true;
    foreach (yp_planner_intros() as $intro) if ((int)($intro['year'] ?? 0) === $year) return true;
    return false;
}

function yp_assert_editable_year(int $year): void {
    if (!in_array($year, yp_allowed_years(), true)) throw new RuntimeException('Invalid year.');
    if ($year < yp_current_year()) throw new RuntimeException($year . ' is frozen and cannot be edited.');
}

function yp_copy_current_to_next(bool $overwrite): void {
    $source = yp_current_year();
    $target = $source + 1;
    if (yp_planner_year_present($target) && !$overwrite) throw new RuntimeException($target . ' already exists. Use Reset to replace it.');

    yp_write_json(yp_calendar_year_path($target), array_map(fn($c) => $c, yp_calendars($source)));
    $all = yp_shading();
    $keep = array_values(array_filter($all, fn($s) => (int)($s['year'] ?? 0) !== $target));
    $copy = [];
    foreach ($all as $shade) {
        if ((int)($shade['year'] ?? 0) !== $source) continue;
        $ranges = !empty($shade['ranges']) && is_array($shade['ranges'])
            ? $shade['ranges']
            : ((!empty($shade['start']) && !empty($shade['end'])) ? [['start'=>$shade['start'],'end'=>$shade['end']]] : []);
        $newRanges = [];
        foreach ($ranges as $range) {
            $newRanges[] = [
                'start' => preg_replace('/^\d{4}/', (string)$target, (string)($range['start'] ?? '')),
                'end' => preg_replace('/^\d{4}/', (string)$target, (string)($range['end'] ?? '')),
            ];
        }
        $copy[] = [
            'id' => 'shade-' . substr(bin2hex(random_bytes(4)), 0, 8),
            'name' => (string)($shade['name'] ?? 'Shading'),
            'year' => $target,
            'ranges' => $newRanges,
            'colour' => yp_calendar_colour((string)($shade['colour'] ?? '#e5e7eb')),
        ];
    }
    yp_write_json(YP_DATA_DIR . '/shading.json', array_merge($keep, $copy));
}

function yp_blank_next_year(): void {
    $target = yp_current_year() + 1;
    $oldCalendars = yp_calendars($target);
    yp_write_json(yp_calendar_year_path($target), []);
    yp_write_json(YP_DATA_DIR . '/shading.json', array_values(array_filter(yp_shading(), fn($s) => (int)($s['year'] ?? 0) !== $target)));
    yp_write_json(YP_DATA_DIR . '/planner-intros.json', array_values(array_filter(yp_planner_intros(), fn($i) => (int)($i['year'] ?? 0) !== $target)));
    foreach ($oldCalendars as $calendar) {
        $id = (string)($calendar['id'] ?? '');
        if ($id !== '') @unlink(YP_CACHE_DIR . '/' . $id . '-' . $target . '.json');
    }
}

function yp_shading(): array {
    return yp_read_json(YP_DATA_DIR . '/shading.json', []);
}

function yp_calendar_colour(string $value): string {
    return preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? $value : '#356a8a';
}

function yp_text_colour_for(string $hex): string {
    $hex = ltrim($hex, '#');
    if (strlen($hex) !== 6) return '#ffffff';
    $r = hexdec(substr($hex,0,2)); $g = hexdec(substr($hex,2,2)); $b = hexdec(substr($hex,4,2));
    $l = (0.2126*$r + 0.7152*$g + 0.0722*$b);
    return $l > 160 ? '#172126' : '#ffffff';
}
