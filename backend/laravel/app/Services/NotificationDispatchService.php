<?php

namespace App\Services;

use App\Contracts\FarmgateNotification;
use App\Jobs\DeliverFarmgateNotificationEmail;
use App\Jobs\DeliverFarmgatePushNotification;
use App\Models\NotificationDelivery;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use JsonException;
use Throwable;

class NotificationDispatchService
{
    /**
     * Persist one recipient-scoped in-app notification and queue its channels.
     *
     * @throws JsonException
     */
    public function send(User $recipient, FarmgateNotification $notification): void
    {
        $data = $notification->toArray($recipient);
        $id = $this->notificationId($recipient, $notification, $data);
        $now = now();

        DB::transaction(function () use ($recipient, $notification, $data, $id, $now): void {
            $inserted = DB::table('notifications')->insertOrIgnore([
                'id' => $id,
                'type' => $notification::class,
                'notifiable_type' => $recipient->getMorphClass(),
                'notifiable_id' => $recipient->getKey(),
                'data' => json_encode($data, JSON_THROW_ON_ERROR),
                'read_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            if ($inserted === 0) {
                return;
            }

            $delivery = NotificationDelivery::query()->create([
                'notification_id' => $id,
                'notifiable_type' => $recipient->getMorphClass(),
                'notifiable_id' => $recipient->getKey(),
                'channel' => 'email',
                'status' => $this->emailStatus($recipient, $data),
            ]);

            $push = NotificationDelivery::query()->create([
                'notification_id' => $id,
                'notifiable_type' => $recipient->getMorphClass(),
                'notifiable_id' => $recipient->getKey(),
                'channel' => 'push',
                'status' => $this->pushStatus($recipient, $data),
            ]);

            if ($delivery->status === 'queued') {
                $this->dispatchEmail($delivery);
            }
            if ($push->status === 'queued') {
                $this->dispatchPush($push);
            }
        });
    }

    private function dispatchEmail(NotificationDelivery $delivery): void
    {
        $connection = (string) config('queue.default', 'database');
        if ($connection === 'sync') {
            $connection = 'database';
        }

        if ($connection === 'database') {
            // The database queue insert shares this transaction, so both the
            // notification outbox row and its job commit or roll back together.
            try {
                DeliverFarmgateNotificationEmail::dispatch($delivery->id)
                    ->onConnection('database')
                    ->onQueue('notifications');
            } catch (Throwable $exception) {
                $this->recordQueueFailure($delivery, $exception);
            }

            return;
        }

        DB::afterCommit(function () use ($delivery, $connection): void {
            try {
                DeliverFarmgateNotificationEmail::dispatch($delivery->id)
                    ->onConnection($connection)
                    ->onQueue('notifications');
            } catch (Throwable $exception) {
                $this->recordQueueFailure($delivery, $exception);
            }
        });
    }

    private function dispatchPush(NotificationDelivery $delivery): void
    {
        $connection = (string) config('queue.default', 'database');
        if ($connection === 'sync') {
            $connection = 'database';
        }

        if ($connection === 'database') {
            try {
                DeliverFarmgatePushNotification::dispatch($delivery->id)
                    ->onConnection('database')
                    ->onQueue('notifications');
            } catch (Throwable $exception) {
                $this->recordQueueFailure($delivery, $exception);
            }

            return;
        }

        DB::afterCommit(function () use ($delivery, $connection): void {
            try {
                DeliverFarmgatePushNotification::dispatch($delivery->id)
                    ->onConnection($connection)
                    ->onQueue('notifications');
            } catch (Throwable $exception) {
                $this->recordQueueFailure($delivery, $exception);
            }
        });
    }

    private function recordQueueFailure(NotificationDelivery $delivery, Throwable $exception): void
    {
        $delivery->forceFill([
            'status' => 'failed',
            'last_error' => $exception::class,
        ])->save();
        Log::warning('A FARMGATE notification channel could not be queued.', [
            'delivery_id' => $delivery->id,
            'channel' => $delivery->channel,
            'exception' => $exception::class,
        ]);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function emailStatus(User $recipient, array $data): string
    {
        if (! filled($recipient->email)) {
            return 'skipped';
        }

        $type = (string) ($data['type'] ?? '');
        $preference = match ($type) {
            'chat_message' => 'chat_notifications',
            'calendar_event' => 'event_notifications',
            'promotion_changed' => 'event_notifications',
            'order_update_requested' => 'order_notifications',
            default => null,
        };
        if ($preference !== null && ! $recipient->accountPreferenceEnabled($preference)) {
            return 'skipped';
        }

        if (! app(SystemSettingsService::class)->getBoolean('email_notifications_enabled')) {
            return 'skipped';
        }

        // Critical status mail is sent by the existing order-status outbox.
        if ($type === 'order_status_changed'
            && in_array($data['status'] ?? null, ['CANCELLED', 'REJECTED'], true)) {
            return 'managed';
        }

        if (! app(EmailDeliveryConfiguration::class)->isConfigured()) {
            return 'not_configured';
        }

        return 'queued';
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function pushStatus(User $recipient, array $data): string
    {
        $type = (string) ($data['type'] ?? '');
        $preference = match ($type) {
            'chat_message' => 'chat_notifications',
            'calendar_event', 'promotion_changed' => 'event_notifications',
            'order_update_requested' => 'order_notifications',
            default => null,
        };
        if ($preference !== null && ! $recipient->accountPreferenceEnabled($preference)) {
            return 'skipped';
        }
        if (! WebPushNotificationSender::isConfigured()) {
            return 'not_configured';
        }
        if (! $recipient->pushSubscriptions()->exists()) {
            return 'not_subscribed';
        }

        return 'queued';
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function notificationId(User $recipient, FarmgateNotification $notification, array $data): string
    {
        $payload = json_encode([
            $recipient->getMorphClass(),
            $recipient->getKey(),
            $notification::class,
            $data,
        ], JSON_THROW_ON_ERROR);
        $hex = substr(hash('sha256', $payload), 0, 32);
        $hex[12] = '5';
        $hex[16] = dechex((hexdec($hex[16]) & 0x3) | 0x8);

        return substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-'.substr($hex, 12, 4).'-'.substr($hex, 16, 4).'-'.substr($hex, 20, 12);
    }
}
