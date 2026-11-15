<?php

namespace App\Services;

use App\Enums\Role;
use App\Models\RiderEarningsSetting;
use App\Models\RiderPayout;
use App\Models\RiderPayoutHistory;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class RiderPayoutService
{
    public function __construct(private readonly SystemSettingsService $settings) {}

    public function confirmManualPayout(
        RiderPayout $payout,
        User $admin,
        string $externalReference,
        string $method,
        string $reason,
        string $paidDate,
        int $amountCents,
    ): RiderPayout {
        return DB::transaction(function () use ($payout, $admin, $externalReference, $method, $reason, $paidDate, $amountCents): RiderPayout {
            abort_unless($admin->role === Role::ADMIN, 403);
            $config = RiderEarningsSetting::query()->lockForUpdate()->find(RiderEarningsSetting::SINGLETON_ID);
            abort_unless($config?->isConfigured(), 503, 'Rider earnings and cap settings must be explicitly configured before payouts can be recorded.');

            $locked = RiderPayout::query()->lockForUpdate()->findOrFail($payout->id);
            abort_unless($locked->status === 'PENDING', 409, 'Only a pending rider payout can be recorded as externally paid.');
            abort_unless($amountCents === $locked->amount_cents, 422, 'The recorded external transfer amount must exactly match the rider payout amount due.');

            $referenceHash = hash('sha256', mb_strtolower(trim($externalReference)));
            abort_unless(
                ! RiderPayout::query()->where('external_reference_hash', $referenceHash)->whereKeyNot($locked->id)->exists(),
                409,
                'This external transfer reference has already been recorded.',
            );

            $safeReason = $this->settings->sanitizeFinancialReason($reason) ?? '';
            $locked->forceFill([
                'status' => 'PAID',
                'recorded_by' => $admin->id,
                'method' => $method,
                'external_reference' => trim($externalReference),
                'external_reference_hash' => $referenceHash,
                'reason' => $safeReason,
                'paid_at' => Carbon::parse($paidDate)->startOfDay(),
            ]);
            try {
                $locked->save();
            } catch (QueryException $exception) {
                if ($this->isDuplicateReference($exception)) {
                    abort(409, 'This external transfer reference has already been recorded.');
                }

                throw $exception;
            }

            RiderPayoutHistory::query()->create([
                'rider_payout_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => 'MANUAL_PAYMENT_CONFIRMED',
                'from_status' => 'PENDING',
                'to_status' => 'PAID',
                'reason' => $safeReason,
            ]);

            return $locked->fresh(['rider:id,name', 'earning.delivery:id,delivery_reference', 'earning.order:id,order_reference']);
        });
    }

    private function isDuplicateReference(QueryException $exception): bool
    {
        $message = strtolower($exception->getMessage());

        return str_contains($message, 'external_reference_hash')
            || str_contains($message, 'rider_payouts_external_reference_hash_unique');
    }
}
