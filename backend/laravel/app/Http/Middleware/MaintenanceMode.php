<?php

namespace App\Http\Middleware;

use App\Enums\Role;
use App\Services\SystemSettingsService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class MaintenanceMode
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! app(SystemSettingsService::class)->getBoolean('maintenance_mode')) {
            return $next($request);
        }

        if ($request->is('api/health') || $request->is('api/auth/*')) {
            return $next($request);
        }

        if ($request->user()?->role === Role::ADMIN) {
            return $next($request);
        }

        abort(Response::HTTP_SERVICE_UNAVAILABLE, 'The application is currently under maintenance.');
    }
}
