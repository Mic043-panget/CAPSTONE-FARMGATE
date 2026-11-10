<?php

namespace App\Services;

use App\Models\PushSubscription;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

class WebPushNotificationSender
{
    /**
     * @param  array<string, mixed>  $payload
     * @param  iterable<PushSubscription>  $subscriptions
     */
    public function send(iterable $subscriptions, array $payload): array
    {
        $auth = [
            'VAPID' => [
                'subject' => (string) config('services.webpush.subject'),
                'publicKey' => (string) config('services.webpush.public_key'),
                'privateKey' => (string) config('services.webpush.private_key'),
            ],
        ];
        $webPush = new WebPush($auth, ['TTL' => 300, 'urgency' => 'high']);
        $reports = [];
        $encodedPayload = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        foreach ($subscriptions as $storedSubscription) {
            $subscription = $storedSubscription->subscription;
            $webPush->queueNotification(Subscription::create([
                'endpoint' => $subscription['endpoint'],
                'keys' => [
                    'p256dh' => $subscription['keys']['p256dh'],
                    'auth' => $subscription['keys']['auth'],
                ],
                'contentEncoding' => $subscription['contentEncoding'] ?? 'aes128gcm',
            ]), $encodedPayload);
        }

        foreach ($webPush->flush() as $report) {
            $reports[] = $report;
        }

        return $reports;
    }

    public static function isConfigured(): bool
    {
        return filled(config('services.webpush.public_key'))
            && filled(config('services.webpush.private_key'))
            && filled(config('services.webpush.subject'));
    }
}
