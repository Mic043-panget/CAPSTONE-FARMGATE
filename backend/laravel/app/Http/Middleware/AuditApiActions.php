<?php

namespace App\Http\Middleware;

use App\Models\AuditLog;
use App\Services\AuditContext;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuditApiActions
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->is('api/*') || ! in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            return $next($request);
        }

        try {
            $response = $next($request);
        } catch (\Throwable $exception) {
            $this->record($request, 500);
            throw $exception;
        }

        $this->record($request, $response->getStatusCode());

        return $response;
    }

    private function record(Request $request, int $statusCode): void
    {
        $changes = $statusCode < 400 ? app(AuditContext::class)->changes() : [];
        $firstChange = $changes[0] ?? null;
        $operations = array_values(array_unique(array_column($changes, 'operation')));
        $databaseAction = count($operations) === 1 ? $operations[0] : ($operations ? 'UPDATE' : 'NONE');
        $changedFields = array_merge(...array_map(fn (array $change): array => $change['changed_fields'], $changes));

        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => $request->method().' '.$request->path(),
            'method' => $request->method(),
            'route' => $request->route()?->uri() ?? $request->path(),
            'request_url' => $request->url(),
            'status_code' => $statusCode,
            'database_action' => $databaseAction,
            'entity_type' => $firstChange['entity_type'] ?? null,
            'entity_id' => $firstChange['entity_id'] ?? null,
            'description' => $databaseAction === 'NONE'
                ? $request->method().' '.$request->path().' completed without a business record change.'
                : $request->method().' '.$request->path().' caused a '.$databaseAction.' operation on '.$firstChange['entity_type'].'.',
            'reason' => ! $request->is('api/chat/*') && is_string($request->input('reason'))
                ? $request->input('reason')
                : null,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'metadata' => [
                'input_keys' => array_values(array_diff(array_keys($request->all()), [
                    'password', 'password_confirmation', 'current_password', 'token', 'access_token', 'secret', 'api_key',
                ])),
                'route_parameters' => $this->safeRouteParameters($request),
                'database_changes' => $changes,
            ],
            'before_values' => $firstChange['before'] ?? null,
            'after_values' => $firstChange['after'] ?? null,
            'changed_fields' => $changedFields,
        ]);

        app(AuditContext::class)->clear();
    }

    private function safeRouteParameters(Request $request): array
    {
        $safe = [];
        foreach ($request->route()?->parameters() ?? [] as $key => $value) {
            if ($value instanceof Model) {
                $safe[$key] = ['id' => $value->getKey()];
            } elseif (is_int($value) || (is_string($value) && ctype_digit($value))) {
                $safe[$key] = $value;
            } else {
                $safe[$key] = '[redacted]';
            }
        }

        return $safe;
    }
}
