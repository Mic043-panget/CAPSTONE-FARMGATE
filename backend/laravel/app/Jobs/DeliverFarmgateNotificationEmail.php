<?php

namespace App\Jobs;

use App\Exceptions\MailDeliveryException;
use App\Mail\FarmgateNotificationMail;
use App\Models\NotificationDelivery;
use App\Models\User;
use App\Services\EmailDeliveryConfiguration;
use App\Services\NotificationLinkService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Throwable;

class DeliverFarmgateNotificationEmail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;

    public int $timeout = 60;

    public array $backoff = [15, 60, 180, 600];

    public function __construct(public int $deliveryId) {}

    public function handle(EmailDeliveryConfiguration $configuration): void
    {
        $claim = DB::transaction(function (): ?array {
            $delivery = NotificationDelivery::query()->lockForUpdate()->findOrFail($this->deliveryId);
            if (in_array($delivery->status, ['delivered', 'skipped', 'failed', 'not_configured'], true)) {
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

            if (! $notification || ! $recipient || ! filled($recipient->email)) {
                $delivery->forceFill([
                    'status' => 'failed',
                    'last_error' => 'RECIPIENT_UNAVAILABLE',
                    'attempts' => $delivery->attempts + 1,
                ])->save();

                return null;
            }

            $delivery->forceFill([
                'status' => 'sending',
                'attempts' => $delivery->attempts + 1,
                'last_error' => null,
            ])->save();

            return [$delivery, $notification, $recipient];
        });
        if ($claim === null) {
            return;
        }

        [$delivery, $notification, $recipient] = $claim;

        try {
            if (! $configuration->isConfigured()) {
                $delivery->forceFill([
                    'status' => 'not_configured',
                    'last_error' => 'SMTP_NOT_CONFIGURED',
                ])->save();

                return;
            }

            $data = json_decode($notification->data, true, 512, JSON_THROW_ON_ERROR);
            $data = is_array($data) ? $data : [];
            $link = app(NotificationLinkService::class)->for($recipient, $data, $delivery->notification_id);
            Mail::to($recipient->email)->send(new FarmgateNotificationMail(
                $recipient->name,
                $data,
                $link['url'],
                $link['label'],
                $notification->created_at,
                $recipient->role->value,
            ));

            $delivery->forceFill([
                'status' => 'delivered',
                'last_error' => null,
                'delivered_at' => now(),
            ])->save();
        } catch (Throwable $exception) {
            $delivery->forceFill([
                'status' => 'queued',
                'last_error' => $exception::class,
            ])->save();
            throw MailDeliveryException::from($exception);
        }
    }

    public function failed(Throwable $exception): void
    {
        NotificationDelivery::query()
            ->whereKey($this->deliveryId)
            ->whereNotIn('status', ['delivered', 'skipped'])
            ->update([
                'status' => 'failed',
                'last_error' => $exception instanceof MailDeliveryException
                    ? $exception->providerExceptionClass
                    : $exception::class,
                'updated_at' => now(),
            ]);
    }
}
