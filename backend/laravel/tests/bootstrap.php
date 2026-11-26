<?php

$basePath = dirname(__DIR__);
$testingEnvironmentFile = $basePath.'/.env.testing';

if (! is_file($testingEnvironmentFile)) {
    throw new RuntimeException('Create backend/laravel/.env.testing with non-production test database settings before running PHPUnit; production .env is not used.');
}

require $basePath.'/vendor/autoload.php';

foreach ([
    'APP_KEY',
    'APP_NAME',
    'APP_URL',
    'DB_CONNECTION',
    'DB_DATABASE',
    'DB_HOST',
    'DB_PASSWORD',
    'DB_PORT',
    'DB_SOCKET',
    'DB_URL',
    'DB_USERNAME',
    'FRONTEND_URL',
    'LARAVEL_STORAGE_PATH',
] as $name) {
    unset($_ENV[$name], $_SERVER[$name]);
    putenv($name);
}

\Dotenv\Dotenv::createImmutable($basePath, '.env.testing')->load();

foreach (['APP_KEY', 'DB_HOST', 'DB_PORT', 'DB_PASSWORD', 'LARAVEL_STORAGE_PATH'] as $name) {
    $value = $_ENV[$name] ?? $_SERVER[$name] ?? getenv($name);
    if (! is_string($value) || trim($value) === '') {
        throw new RuntimeException("Set {$name} in the non-production .env.testing file before running PHPUnit.");
    }
}

if (($_ENV['DB_CONNECTION'] ?? getenv('DB_CONNECTION')) !== 'mysql'
    || ($_ENV['DB_DATABASE'] ?? getenv('DB_DATABASE')) !== 'farmgate_test'
    || ($_ENV['DB_USERNAME'] ?? getenv('DB_USERNAME')) !== 'farmgate_test_runner'
    || ($_ENV['DB_URL'] ?? getenv('DB_URL')) !== '') {
    throw new RuntimeException('PHPUnit is restricted to the farmgate_test schema and farmgate_test_runner account.');
}

$storagePath = (string) ($_ENV['LARAVEL_STORAGE_PATH'] ?? getenv('LARAVEL_STORAGE_PATH'));
$temporaryRoot = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR;
if (! str_starts_with($storagePath, $temporaryRoot)) {
    throw new RuntimeException('PHPUnit storage must be isolated under the system temporary directory.');
}

foreach (['app/public', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs'] as $directory) {
    $path = $storagePath.DIRECTORY_SEPARATOR.$directory;
    if (! is_dir($path) && ! mkdir($path, 0700, true) && ! is_dir($path)) {
        throw new RuntimeException('Unable to prepare isolated PHPUnit storage.');
    }
}
