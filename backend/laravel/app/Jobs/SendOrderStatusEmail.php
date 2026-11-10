<?php

namespace App\Jobs;

use App\Exceptions\MailDeliveryException;
use App\Mail\OrderStatusChangedMail;
use App\Models\OrderStatusEmailDelivery;
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

class SendOrderStatusEmail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [15, 60];

    public function __construct(public int $emailDeliveryId) {}

    public function handle(EmailDeliveryConfiguration $configuration, NotificationLinkService $links): void
    {
        $delivery = DB::transaction(function (): ?OrderStatusEmailDelivery {
            $delivery = OrderStatusEmailDelivery::query()->lockForUpdate()->findOrFail($this->emailDeliveryId);
            if (in_array($delivery->delivery_status, ['SENT', 'FAILED'], true)) {
                return null;
            }

            $retryAfter = (int) config('queue.connections.'.config('queue.default').'.retry_after', 90);
            $staleAfter = max(60, $retryAfter - 10);
            if ($delivery->delivery_status === 'SENDING' && $delivery->updated_at->gt(now()->subSeconds($staleAfter))) {
                return null;
            }

            $delivery->forceFill([
                'delivery_status' => 'SENDING',
                'attempts' => $delivery->attempts + 1,
            ])->save();

            return $delivery->load(['order', 'recipient']);
        });
        if ($delivery === null) {
            return;
        }

        if (! $configuration->isConfigured()) {
            $delivery->forceFill([
                'delivery_status' => 'FAILED',
                'error_code' => 'SMTP_NOT_CONFIGURED',
            ])->save();

            return;
        }

        if (! $delivery->recipient || ! filled($delivery->recipient->email)) {
            $delivery->forceFill([
                'delivery_status' => 'FAILED',
                'error_code' => 'RECIPIENT_UNAVAILABLE',
            ])->save();

            return;
        }

        $link = $links->forOrderRecipient($delivery->recipient, $delivery->order_id);

        try {
            Mail::to($delivery->recipient->email)->send(new OrderStatusChangedMail(
                $delivery->recipient->name,
                $delivery->order->order_reference,
                $delivery->order_status,
                null,
                $link['url'],
                $link['label'],
            ));
        } catch (Throwable $exception) {
            $delivery->forceFill([
                'delivery_status' => 'QUEUED',
                'error_code' => $exception::class,
            ])->save();
            throw MailDeliveryException::from($exception);
        }

        $delivery->forceFill([
            'delivery_status' => 'SENT',
            'error_code' => null,
            'sent_at' => now(),
        ])->save();
    }

    public function failed(Throwable $exception): void
    {
        OrderStatusEmailDelivery::query()
            ->whereKey($this->emailDeliveryId)
            ->where('delivery_status', '!=', 'SENT')
            ->update([
                'delivery_status' => 'FAILED',
                'error_code' => $exception instanceof MailDeliveryException
                    ? $exception->providerExceptionClass
                    : $exception::class,
                'updated_at' => now(),
            ]);
    }
}
