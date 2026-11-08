<?php

namespace App\Http\Middleware;

use App\Enums\Role;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureApprovedRider
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user()?->role === Role::RIDER) {
            abort_unless($request->user()->riderProfile()->where('is_verified', true)->exists(), 403, 'An approved rider application is required to use delivery features.');
        }

        return $next($request);
    }
}
