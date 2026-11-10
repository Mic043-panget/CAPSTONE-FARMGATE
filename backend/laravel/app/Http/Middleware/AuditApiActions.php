<?php

namespace App\Http\Middleware;

use App\Models\AuditLog;
use App\Models\SellerPayoutDestination;
use App\Services\AuditContext;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

class AuditApiActions
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->is('api/admin/audit-logs/report') || $request->is('api/admin/reports/export-audit')) {
            return $next($request);
        }
        $isMutation = in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true);
        $isRead = $request->method() === 'GET';
        if (! $request->is('api/*') || (! $isMutation && ! $isRead)) {
            return $next($request);
        }

        try {
            $response = $next($request);
        } catch (\Throwable $exception) {
            $this->record($request, $this->exceptionStatus($exception));
            throw $exception;
        }

        $statusCode = $response->getStatusCode();
        if ($isMutation || in_array($statusCode, [403, 404], true)) {
            $this->record($request, $statusCode);
        }

        return $response;
    }

    private function exceptionStatus(\Throwable $exception): int
    {
        return match (true) {
            $exception instanceof HttpExceptionInterface => $exception->getStatusCode(),
            $exception instanceof ModelNotFoundException => 404,
            $exception instanceof ValidationException => 422,
            $exception instanceof AuthenticationException => 401,
            $exception instanceof AuthorizationException => 403,
            default => 500,
        };
    }

    private function record(Request $request, int $statusCode): void
    {
        $changes = $statusCode < 400 ? app(AuditContext::class)->changes() : [];
        $firstChange = $changes[0] ?? null;
        $operations = array_values(array_unique(array_column($changes, 'operation')));
        $databaseAction = count($operations) === 1 ? $operations[0] : ($operations ? 'UPDATE' : 'NONE');
        $changedFields = $changes
            ? array_merge(...array_map(fn (array $change): array => $change['changed_fields'], $changes))
            : [];

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
            'description' => $request->method() === 'GET' && in_array($statusCode, [403, 404], true)
                ? 'Read access denied or requested record unavailable (HTTP '.$statusCode.').'
                : ($databaseAction === 'NONE'
                    ? $request->method().' '.$request->path().' completed without a business record change.'
                    : $request->method().' '.$request->path().' caused a '.$databaseAction.' operation on '.$firstChange['entity_type'].'.'),
            'reason' => $this->safeReason($request),
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

    private function safeReason(Request $request): ?string
    {
        $reason = $request->input('reason');
        if ($request->is('api/chat/*') || ! is_string($reason)) {
            return null;
        }

        $reason = preg_replace('/(?<!\d)(?:\d[ -]?){7,}\d(?!\d)/u', '[masked digits]', $reason) ?? $reason;
        $destination = $request->route('destination');
        if ($destination instanceof SellerPayoutDestination) {
            foreach ([$destination->account_holder, $destination->bank_name, $destination->account_number, $destination->wallet_number] as $privateValue) {
                if (filled($privateValue)) {
                    $reason = str_ireplace((string) $privateValue, '[destination detail redacted]', $reason);
                }
            }
        }

        return $reason;
    }
}
