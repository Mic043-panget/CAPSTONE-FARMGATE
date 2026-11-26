<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Symfony\Component\HttpFoundation\Response;

class ClearLegacySharedSessionCookies
{
    private const FRONTEND_HOSTS = ['farmgates.site', 'www.farmgates.site'];

    private const MIGRATION_COOKIE = 'farmgate_session_scope_v2';

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (! in_array($request->getHost(), self::FRONTEND_HOSTS, true)
            || $request->cookies->get(self::MIGRATION_COOKIE) === '1') {
            return $response;
        }

        $response->headers->setCookie(Cookie::forget('farmgate-session', '/', '.farmgates.site'));
        $response->headers->setCookie(Cookie::forget('XSRF-TOKEN', '/', '.farmgates.site'));
        $response->headers->setCookie(Cookie::make(
            self::MIGRATION_COOKIE,
            '1',
            525600,
            '/',
            null,
            true,
            true,
            false,
            'lax',
        ));

        return $response;
    }
}
