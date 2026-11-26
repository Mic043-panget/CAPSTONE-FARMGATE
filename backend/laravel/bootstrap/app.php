<?php

use App\Http\Middleware\AuditApiActions;
use App\Http\Middleware\Authenticate;
use App\Http\Middleware\ClearLegacySharedSessionCookies;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

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
        $schedule->command('calendar:send-reminders')->everyTenMinutes()->withoutOverlapping();
    })
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'auth' => Authenticate::class,
        ]);
        $middleware->append(ClearLegacySharedSessionCookies::class);
        $middleware->append(SecurityHeaders::class);
        $middleware->append(AuditApiActions::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->render(function (\Throwable $exception, Request $request) {
            if (! $request->is('api/*') && ! $request->expectsJson()) {
                return null;
            }

            if ($exception instanceof ValidationException
                || $exception instanceof AuthenticationException
                || $exception instanceof AuthorizationException) {
                return null;
            }

            $exceptionMessage = trim($exception->getMessage());
            $technicalMessage = preg_match('/SQLSTATE|PDOException|Illuminate\\\\|Symfony\\\\|stack trace|vendor\/|\/var\/www\/|\.php(?::\d+)?|call to undefined|syntax error|uncaught exception/i', $exceptionMessage) === 1;
            $safeExceptionMessage = $exceptionMessage !== ''
                && strlen($exceptionMessage) <= 500
                && ! $technicalMessage
                && ! preg_match('/<[^>]*>/', $exceptionMessage);

            if ($exception instanceof HttpExceptionInterface && $exception->getStatusCode() < 500) {
                $status = $exception->getStatusCode();
                $message = match ($status) {
                    404 => 'The requested information could not be found or is no longer available.',
                    405 => 'This action is not available.',
                    413 => 'The submitted data is too large. Reduce the file size or number of images and try again.',
                    419 => 'Your session has expired. Refresh the page and sign in again.',
                    429 => $safeExceptionMessage
                        ? $exceptionMessage
                        : 'You are making requests too quickly. Please wait a moment and try again.',
                    default => $safeExceptionMessage
                        ? $exceptionMessage
                        : 'The request could not be completed. Please check your information and try again.',
                };

                return response()->json(['message' => $message], $status);
            }

            $referenceId = (string) Str::uuid();
            $route = $request->route();
            $genericServerMessages = ['server error', 'internal server error', 'service unavailable', 'bad gateway', 'gateway timeout'];
            $message = $exception instanceof HttpExceptionInterface
                && $safeExceptionMessage
                && ! in_array(strtolower(rtrim($exceptionMessage, '.')), $genericServerMessages, true)
                    ? $exceptionMessage
                    : 'Farmgate could not complete the request. Please try again later.';

            Log::error('Unhandled API exception.', [
                'reference_id' => $referenceId,
                'exception_class' => $exception::class,
                'method' => $request->method(),
                'endpoint' => $route instanceof \Illuminate\Routing\Route ? $route->uri() : null,
            ]);

            return response()->json([
                'message' => $message,
                'reference_id' => $referenceId,
            ], $exception instanceof HttpExceptionInterface ? $exception->getStatusCode() : 500, [
                'X-Request-ID' => $referenceId,
            ]);
        });
    })->create();
