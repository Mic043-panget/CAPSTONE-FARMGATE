<?php

namespace App\Jobs;

use App\Mail\OrderStatusChangedMail;
use App\Models\OrderStatusEmailDelivery;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Mail;
use Throwable;

class SendOrderStatusEmail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [15, 60];

    public function __construct(public int $emailDeliveryId) {}

    public function handle(): void
    {
        $delivery = OrderStatusEmailDelivery::query()
            ->with(['order', 'recipient'])
            ->findOrFail($this->emailDeliveryId);
        if ($delivery->delivery_status === 'SENT') {
            return;
        }

        $delivery->increment('attempts');
        if (! $delivery->recipient || ! filled($delivery->recipient->email)) {
            $delivery->forceFill([
                'delivery_status' => 'FAILED',
                'error_code' => 'RECIPIENT_UNAVAILABLE',
            ])->save();

            return;
        }

        Mail::to($delivery->recipient->email)->send(new OrderStatusChangedMail(
            $delivery->recipient->name,
            $delivery->order->order_reference,
            $delivery->order_status,
            $delivery->reason,
            rtrim((string) config('services.frontend_url'), '/').'/#order/'.$delivery->order_id,
        ));

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
                'error_code' => $exception::class,
                'updated_at' => now(),
            ]);
    }
}
