<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Models\Complaint;
use App\Models\Delivery;
use App\Models\RiderEarning;
use App\Models\RiderEarningHistory;
use App\Models\RiderProfile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RiderEarningsService
{
    public function __construct(private readonly SystemSettingsService $settings) {}

    public function recordCompletedDelivery(Delivery $delivery): RiderEarning
    {
        return DB::transaction(function () use ($delivery): RiderEarning {
            $locked = Delivery::query()->lockForUpdate()->with('order')->findOrFail($delivery->id);
            $existing = RiderEarning::query()->where('delivery_id', $locked->id)->lockForUpdate()->first();
            if ($existing) {
                return $existing;
            }

            $order = $locked->order;
            $eligible = $locked->status === DeliveryStatus::DELIVERED
                && $locked->rider_id !== null
                && $locked->pickup_verified_at !== null
                && $locked->delivery_verified_at !== null
                && $locked->has_delivery_proof
                && $locked->recipient_confirmed
                && filled($locked->delivery_recipient_name)
                && (bool) RiderProfile::query()->where('user_id', $locked->rider_id)->value('is_verified');

            $hasDispute = $order && Complaint::query()
                ->where('order_id', $order->id)
                ->whereIn('status', ['OPEN', 'UNDER_REVIEW'])
                ->exists();
            $distanceKm = max(0, (float) ($order?->delivery_distance_km ?? 0));
            $baseCents = self::toCents($this->settings->getDecimal('rider_base_compensation'));
            $perKmCents = self::toCents($this->settings->getDecimal('rider_per_km_compensation'));
            $minimumCents = self::toCents($this->settings->getDecimal('rider_minimum_compensation'));
            $maximumCents = self::toCents($this->settings->getDecimal('rider_maximum_compensation'));
            $distanceCents = (int) round($perKmCents * $distanceKm);
            $grossCents = $baseCents + $distanceCents;
            if ($minimumCents > 0) {
                $grossCents = max($grossCents, $minimumCents);
            }
            if ($maximumCents > 0) {
                $grossCents = min($grossCents, $maximumCents);
            }

            $eligibilityStatus = ! $eligible
                ? 'PENDING_ELIGIBILITY'
                : ($hasDispute ? 'NEEDS_REVIEW' : ($grossCents > 0 ? 'READY' : 'PENDING_ELIGIBILITY'));
            $reason = ! $eligible
                ? 'Delivery is not completed with the required rider, QR, and recipient evidence.'
                : ($hasDispute
                    ? 'An open or under-review order dispute requires administrator review.'
                    : ($grossCents > 0
                        ? 'Verified completed delivery; compensation calculated from the saved rider rate snapshot.'
                        : 'Configured rider compensation is zero; configure a rate before marking this earning payable.'));

            $earning = RiderEarning::query()->create([
                'reference' => $this->newReference('FG-REN'),
                'delivery_id' => $locked->id,
                'order_id' => $order?->id ?? abort(409, 'Delivery order is unavailable.'),
                'rider_id' => $locked->rider_id,
                'delivery_reference' => $locked->delivery_reference,
                'order_reference' => $order->order_reference,
                'completed_at' => $locked->delivery_verified_at ?? $locked->updated_at,
                'delivery_fee_cents' => self::toCents($order->delivery_fee ?? 0),
                'gross_amount_cents' => $grossCents,
                'deductions_cents' => 0,
                'adjustment_cents' => 0,
                'net_amount_cents' => $grossCents,
                'eligibility_status' => $eligibilityStatus,
                'eligibility_reason' => $reason,
                'payout_status' => 'AVAILABLE',
                'calculation_snapshot' => [
                    'version' => 1,
                    'currency' => 'PHP',
                    'distance_km' => $distanceKm,
                    'base_compensation_cents' => $baseCents,
                    'per_km_compensation_cents' => $perKmCents,
                    'distance_component_cents' => $distanceCents,
                    'minimum_compensation_cents' => $minimumCents,
                    'maximum_compensation_cents' => $maximumCents,
                    'delivery_fee_cents' => self::toCents($order->delivery_fee ?? 0),
                    'buyer_payment_status_ignored' => true,
                    'cod_collection_excluded' => true,
                ],
            ]);

            RiderEarningHistory::query()->create([
                'rider_earning_id' => $earning->id,
                'actor_id' => null,
                'action' => 'CALCULATED',
                'to_status' => $eligibilityStatus,
                'reason' => $reason,
                'snapshot' => $earning->calculation_snapshot,
            ]);

            return $earning;
        });
    }

    public static function toCents(mixed $amount): int
    {
        return (int) round((float) $amount * 100);
    }

    private function newReference(string $prefix): string
    {
        do {
            $reference = $prefix.'-'.now()->format('Y').'-'.Str::upper(Str::random(10));
        } while (RiderEarning::query()->where('reference', $reference)->exists());

        return $reference;
    }
}
