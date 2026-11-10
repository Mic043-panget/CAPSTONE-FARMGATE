<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PushSubscription;
use App\Services\WebPushNotificationSender;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PushSubscriptionController extends Controller
{
    public function config(): JsonResponse
    {
        return response()->json([
            'enabled' => WebPushNotificationSender::isConfigured(),
            'public_key' => config('services.webpush.public_key'),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless(WebPushNotificationSender::isConfigured(), 503, 'Device notifications are not configured on this Farmgate server.');

        $data = $request->validate([
            'endpoint' => ['required', 'string', 'url', 'max:2048', 'regex:/^https:\/\//i'],
            'expirationTime' => ['nullable', 'integer'],
            'keys.p256dh' => ['required', 'string', 'max:256'],
            'keys.auth' => ['required', 'string', 'max:256'],
            'contentEncoding' => ['nullable', 'string', 'in:aes128gcm,aesgcm'],
        ]);
        abort_unless($this->isSupportedEndpoint($data['endpoint']), 422, 'This browser push service is not supported.');
        $endpointHash = hash('sha256', $data['endpoint']);
        $subscription = [
            'endpoint' => $data['endpoint'],
            'keys' => $data['keys'],
            'contentEncoding' => $data['contentEncoding'] ?? 'aes128gcm',
        ];

        PushSubscription::query()->updateOrCreate(
            ['endpoint_hash' => $endpointHash],
            ['user_id' => $request->user()->id, 'subscription' => $subscription, 'last_used_at' => now()],
        );

        return response()->json(['message' => 'Device notifications are enabled for this browser.'], 201);
    }

    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate([
            'endpoint' => ['required', 'string', 'url', 'max:2048', 'regex:/^https:\/\//i'],
        ]);
        $request->user()->pushSubscriptions()
            ->where('endpoint_hash', hash('sha256', $data['endpoint']))
            ->delete();

        return response()->json(['message' => 'Device notifications are disabled for this browser.']);
    }

    private function isSupportedEndpoint(string $endpoint): bool
    {
        $host = strtolower((string) parse_url($endpoint, PHP_URL_HOST));

        return in_array($host, ['fcm.googleapis.com', 'push.services.mozilla.com', 'web.push.apple.com'], true)
            || str_ends_with($host, '.push.services.mozilla.com')
            || str_ends_with($host, '.notify.windows.com');
    }
}
