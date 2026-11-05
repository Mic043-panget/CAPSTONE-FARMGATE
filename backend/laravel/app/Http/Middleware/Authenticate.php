<?php

namespace App\Http\Middleware;

use Illuminate\Auth\Middleware\Authenticate as Middleware;
use Illuminate\Http\Request;

class Authenticate extends Middleware
{
    /**
     * For API requests, return 401 instead of redirecting to a login page.
     */
    protected function redirectTo(Request $request): ?string
    {
        if ($request->expectsJson() || str_starts_with((string) $request->path(), 'api/')) {
            return null;
        }

        return route('login');
    }
}
