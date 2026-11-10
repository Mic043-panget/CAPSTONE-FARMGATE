<?php

namespace App\Jobs;

use App\Exceptions\MailDeliveryException;
use App\Mail\AdminMailConfigurationTest;
use App\Models\MailTestDelivery;
use App\Models\User;
use App\Services\EmailDeliveryConfiguration;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

class SendAdminMailConfigurationTest implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $timeout = 60;

    public array $backoff = [15, 60];

    public function __construct(public int $deliveryId) {}

    public function handle(EmailDeliveryConfiguration $configuration): void
    {
        $claim = DB::transaction(function (): ?array {
            $delivery = MailTestDelivery::query()->lockForUpdate()->findOrFail($this->deliveryId);
            if (in_array($delivery->status, ['delivered', 'failed'], true)) {
                return null;
            }

            $retryAfter = (int) config('queue.connections.'.config('queue.default').'.retry_after', 90);
            $staleAfter = max(60, $retryAfter - 10);
            if ($delivery->status === 'sending' && $delivery->updated_at->gt(now()->subSeconds($staleAfter))) {
                return null;
            }

            $recipient = User::query()->find($delivery->user_id);
            if (! $recipient || ! $recipient->email_verified_at || ! filter_var($recipient->email, FILTER_VALIDATE_EMAIL)) {
                $delivery->forceFill([
                    'status' => 'failed',
                    'last_error' => 'RECIPIENT_NOT_VERIFIED',
                    'attempts' => $delivery->attempts + 1,
                ])->save();

                return null;
            }

            $delivery->forceFill([
                'status' => 'sending',
                'attempts' => $delivery->attempts + 1,
                'last_error' => null,
            ])->save();

            return [$delivery, $recipient];
        });

        if ($claim === null) {
            return;
        }

        [$delivery, $recipient] = $claim;
        if (! $configuration->isConfigured()) {
            $delivery->forceFill(['status' => 'failed', 'last_error' => 'SMTP_NOT_CONFIGURED'])->save();

            return;
        }

        try {
            Mail::to($recipient->email)->send(new AdminMailConfigurationTest);
            $delivery->forceFill([
                'status' => 'delivered',
                'last_error' => null,
                'sent_at' => now(),
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
        MailTestDelivery::query()
            ->whereKey($this->deliveryId)
            ->where('status', '!=', 'delivered')
            ->update([
                'status' => 'failed',
                'last_error' => $exception instanceof MailDeliveryException
                    ? $exception->providerExceptionClass
                    : $exception::class,
                'updated_at' => now(),
            ]);

        Log::warning('A FARMGATE email configuration test failed.', [
            'delivery_id' => $this->deliveryId,
            'exception' => $exception::class,
        ]);
    }
}
