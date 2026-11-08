<?php

use App\Http\Middleware\AuditApiActions;
use App\Http\Middleware\Authenticate;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withSchedule(function (Schedule $schedule): void {
        $schedule->command('riders:process-deliveries')->everyMinute()->withoutOverlapping();
        $schedule->command('promotions:expire')->everyMinute()->withoutOverlapping();
        $schedule->command('cases:escalate')->everyMinute()->withoutOverlapping();
        $schedule->command('refunds:sync')->everyTenMinutes()->withoutOverlapping();
    })
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'auth' => Authenticate::class,
        ]);
        $middleware->append(SecurityHeaders::class);
        $middleware->append(AuditApiActions::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
