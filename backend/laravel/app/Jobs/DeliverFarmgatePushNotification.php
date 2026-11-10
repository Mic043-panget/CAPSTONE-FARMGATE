<?php

namespace App\Jobs;

use App\Models\NotificationDelivery;
use App\Models\PushSubscription;
use App\Models\User;
use App\Services\NotificationLinkService;
use App\Services\WebPushNotificationSender;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class DeliverFarmgatePushNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;

    public int $timeout = 60;

    public array $backoff = [15, 60, 180, 600];

    public function __construct(public int $deliveryId) {}

    public function handle(WebPushNotificationSender $sender): void
    {
        $claim = DB::transaction(function (): ?array {
            $delivery = NotificationDelivery::query()->lockForUpdate()->findOrFail($this->deliveryId);
            if (in_array($delivery->status, ['delivered', 'skipped', 'failed', 'not_subscribed', 'not_configured'], true)) {
                return null;
            }
            $retryAfter = (int) config('queue.connections.'.config('queue.default').'.retry_after', 90);
            $staleAfter = max(60, $retryAfter - 10);
            if ($delivery->status === 'sending' && $delivery->updated_at->gt(now()->subSeconds($staleAfter))) {
                return null;
            }

            $notification = DB::table('notifications')
                ->where('id', $delivery->notification_id)
                ->where('notifiable_type', $delivery->notifiable_type)
                ->where('notifiable_id', $delivery->notifiable_id)
                ->first();
            $recipient = User::query()->find($delivery->notifiable_id);
            if (! $notification || ! $recipient) {
                $delivery->forceFill([
                    'status' => 'failed',
                    'last_error' => 'RECIPIENT_UNAVAILABLE',
                    'attempts' => $delivery->attempts + 1,
                ])->save();

                return null;
            }

            $subscriptions = $recipient->pushSubscriptions()->get();
            if ($subscriptions->isEmpty()) {
                $delivery->forceFill([
                    'status' => 'not_subscribed',
                    'last_error' => null,
                    'attempts' => $delivery->attempts + 1,
                ])->save();

                return null;
            }

            $delivery->forceFill([
                'status' => 'sending',
                'attempts' => $delivery->attempts + 1,
                'last_error' => null,
            ])->save();

            return [$delivery, $notification, $subscriptions, $recipient];
        });
        if ($claim === null) {
            return;
        }

        [$delivery, $notification, $subscriptions, $recipient] = $claim;
        $data = json_decode($notification->data, true, 512, JSON_THROW_ON_ERROR);

        try {
            $reports = $sender->send(
                $subscriptions,
                [
                    'title' => $this->title(is_array($data) ? $data : []),
                    'body' => $this->message(is_array($data) ? $data : []),
                    'url' => app(NotificationLinkService::class)->for(
                        $recipient,
                        is_array($data) ? $data : [],
                        $delivery->notification_id,
                    )['url'],
                    'notification_id' => $delivery->notification_id,
                ],
            );
            $successfulEndpoints = [];
            $expiredEndpoints = [];
            foreach ($reports as $report) {
                if ($report->isSuccess()) {
                    $successfulEndpoints[] = hash('sha256', $report->getEndpoint());
                } elseif ($report->isSubscriptionExpired()) {
                    $expiredEndpoints[] = hash('sha256', $report->getEndpoint());
                }
            }

            if ($expiredEndpoints !== []) {
                PushSubscription::query()
                    ->whereIn('endpoint_hash', $expiredEndpoints)
                    ->delete();
            }
            if ($successfulEndpoints !== []) {
                PushSubscription::query()
                    ->whereIn('endpoint_hash', $successfulEndpoints)
                    ->update(['last_used_at' => now(), 'updated_at' => now()]);
                $delivery->forceFill([
                    'status' => 'delivered',
                    'last_error' => null,
                    'delivered_at' => now(),
                ])->save();

                return;
            }
            if ($expiredEndpoints !== [] && count($expiredEndpoints) === count($reports)) {
                $delivery->forceFill(['status' => 'not_subscribed', 'last_error' => null])->save();

                return;
            }

            throw new RuntimeException('At least one device push delivery failed.');
        } catch (Throwable $exception) {
            $delivery->forceFill([
                'status' => 'queued',
                'last_error' => $exception::class,
            ])->save();
            throw $exception;
        }
    }

    public function failed(Throwable $exception): void
    {
        NotificationDelivery::query()
            ->whereKey($this->deliveryId)
            ->whereNotIn('status', ['delivered', 'skipped', 'not_subscribed'])
            ->update([
                'status' => 'failed',
                'last_error' => $exception::class,
                'updated_at' => now(),
            ]);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function title(array $data): string
    {
        $reference = $data['order_reference'] ?? $data['case_reference'] ?? $data['delivery_reference'] ?? null;
        $status = isset($data['status']) ? str_replace('_', ' ', strtolower((string) $data['status'])) : null;

        return match ($data['type'] ?? '') {
            'order_status_changed' => 'Order '.($reference ? $reference.' ' : '').($status ?? 'updated'),
            'order_case_updated' => ($reference ?? 'Case').' update',
            'chat_message' => 'Farmgate message needs your attention',
            'calendar_event' => $data['title'] ?? 'Farmgate event update',
            'promotion_changed' => $data['title'] ?? 'Farmgate promotion update',
            'listing_moderation_updated' => ($data['listing_name'] ?? 'Listing').' review update',
            default => 'Farmgate update',
        };
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function message(array $data): string
    {
        if (filled($data['message'] ?? null)) {
            return mb_substr((string) $data['message'], 0, 180);
        }

        return match ($data['type'] ?? '') {
            'order_status_changed' => 'The status of your order is now '.str_replace('_', ' ', strtolower((string) ($data['status'] ?? 'updated'))).'.',
            'chat_message' => 'A conversation requires your attention.',
            'order_case_updated' => 'There is a new update to your case.',
            default => 'There is a new update in your Farmgate account.',
        };
    }
}
